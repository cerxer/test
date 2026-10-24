// World: chunk lifecycle (load / generate / mesh / unload), block access, raycasting, saving.
import * as THREE from '../../lib/three.module.min.js';
import { CHUNK_HEIGHT, SECTIONS, chunkKey } from './constants.js';
import {
  B, BLOCK_OPAQUE, BLOCK_LIGHT, BLOCK_ATTEN, BLOCK_TARGETABLE, BLOCK_SHAPE, SHAPE, BLOCK_SOLID, shapeBox,
} from './blocks.js';
import { TerrainGenerator } from './terrain.js';

const NEW = 0, LOADING = 1, GENERATING = 2, READY = 3;

class WorkerPool {
  constructor(count, onResult) {
    this.workers = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => { w.busy = false; onResult(e.data); };
      w.onerror = (e) => {
        console.error('Worker error:', e.message || e);
        w.busy = false;
        onResult({ type: 'error', message: e.message || 'worker error', fatal: true });
      };
      this.workers.push(w);
    }
  }
  idleWorker() {
    for (const w of this.workers) if (!w.busy) return w;
    return null;
  }
  broadcast(msg) {
    for (const w of this.workers) w.postMessage(msg);
  }
  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = null;
    this.state = NEW;
    this.maxY = 0;
    this.meshes = new Array(SECTIONS * 2).fill(null);
    this.needsMesh = true;
    this.meshing = false;
    this.hasMesh = false;
    this.lazyUntil = 0;
    this.lights = [];
  }
}

const _sphereCenter = new THREE.Vector3();

export class World {
  constructor({ scene, seed, worldId, storage, materials, savedKeys, workerCount = 2 }) {
    this.scene = scene;
    this.seed = seed;
    this.worldId = worldId;
    this.storage = storage;
    this.materials = materials;
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.savedKeys = savedKeys || new Set();
    this.dirtySave = new Set();
    this.urgent = new Set();
    this.renderDistance = 6;
    this.time = 0;
    this.unloadTimer = 0;
    this.taskId = 1;
    this.tasks = new Map();
    this.pendingDB = 0;
    this.lastChunk = null;
    this.onChunkLoaded = null;
    this.disposed = false;
    this.errors = 0;
    this.stats = { generated: 0, meshed: 0 };
    this.offsets = [];
    this.buildOffsets(20);
    this.pool = new WorkerPool(workerCount, (msg) => this.onWorkerMessage(msg));
    this.pool.broadcast({ type: 'init', seed, epoch: 1 });
  }

  buildOffsets(R) {
    const list = [];
    const lim = (R + 2.5) * (R + 2.5);
    for (let dz = -R - 3; dz <= R + 3; dz++) {
      for (let dx = -R - 3; dx <= R + 3; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= lim) list.push({ dx, dz, d2 });
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.offsets = list;
  }

  // ---------- scheduling ----------

  update(px, pz, dt) {
    if (this.disposed) return;
    this.time += dt;
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    const rd = this.renderDistance;
    this.unloadTimer -= dt;
    if (this.unloadTimer <= 0) {
      this.unloadTimer = 1;
      this.unloadFar(pcx, pcz, rd + 3);
    }
    for (let guard = 0; guard < 8; guard++) {
      const w = this.pool.idleWorker();
      if (!w) break;
      const task = this.nextTask(pcx, pcz, rd);
      if (!task) break;
      this.dispatch(w, task);
    }
  }

  neighborsReady(c) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        if (!n || n.state !== READY) return false;
      }
    }
    return true;
  }

  nextTask(pcx, pcz, rd) {
    for (const c of this.urgent) {
      if (this.chunks.get(c.key) !== c || !c.needsMesh) { this.urgent.delete(c); continue; }
      if (c.meshing) continue;
      if (this.neighborsReady(c)) { this.urgent.delete(c); return { kind: 'mesh', chunk: c }; }
    }
    const dataR2 = (rd + 2) * (rd + 2);
    const meshR2 = (rd + 0.5) * (rd + 0.5);
    for (const o of this.offsets) {
      if (o.d2 > dataR2) break;
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const key = chunkKey(cx, cz);
      let c = this.chunks.get(key);
      if (!c) {
        c = new Chunk(cx, cz);
        this.chunks.set(key, c);
      }
      if (c.state === NEW) {
        if (this.savedKeys.has(cx + ',' + cz)) { this.loadFromDB(c); continue; }
        return { kind: 'gen', chunk: c };
      }
      if (c.state !== READY) continue;
      if (o.d2 <= meshR2 && c.needsMesh && !c.meshing && c.lazyUntil <= this.time && this.neighborsReady(c)) {
        return { kind: 'mesh', chunk: c };
      }
    }
    return null;
  }

  dispatch(w, task) {
    const id = this.taskId++;
    const c = task.chunk;
    w.busy = true;
    if (task.kind === 'gen') {
      c.state = GENERATING;
      this.tasks.set(id, { kind: 'gen', chunk: c });
      w.postMessage({ type: 'gen', id, cx: c.cx, cz: c.cz });
      return;
    }
    const arrays = [], maxYs = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        arrays.push(n.blocks.slice());
        maxYs.push(n.maxY);
      }
    }
    c.meshing = true;
    c.needsMesh = false;
    this.tasks.set(id, { kind: 'mesh', chunk: c });
    w.postMessage({ type: 'mesh', id, cx: c.cx, cz: c.cz, chunks: arrays, maxYs }, arrays.map((a) => a.buffer));
  }

  loadFromDB(c) {
    c.state = LOADING;
    this.pendingDB++;
    this.storage.getChunk(this.worldId, c.cx, c.cz).then((blocks) => {
      this.pendingDB--;
      if (this.disposed || this.chunks.get(c.key) !== c) return;
      if (blocks) this.onChunkData(c, blocks, false);
      else {
        this.savedKeys.delete(c.cx + ',' + c.cz);
        c.state = NEW;
      }
    }).catch((e) => {
      this.pendingDB--;
      console.error('Chunk load failed', e);
      this.savedKeys.delete(c.cx + ',' + c.cz);
      c.state = NEW;
    });
  }

  onWorkerMessage(msg) {
    if (this.disposed) return;
    const t = this.tasks.get(msg.id);
    this.tasks.delete(msg.id);
    if (msg.type === 'error') {
      this.errors++;
      console.error('Worker task failed:', msg.message);
      if (t) {
        if (t.kind === 'gen') t.chunk.state = NEW;
        else { t.chunk.meshing = false; t.chunk.needsMesh = true; t.chunk.lazyUntil = this.time + 1; }
      }
      return;
    }
    if (!t) return;
    const c = t.chunk;
    if (this.chunks.get(c.key) !== c) return;
    if (msg.type === 'gen') {
      this.stats.generated++;
      this.onChunkData(c, msg.blocks, true);
    } else if (msg.type === 'mesh') {
      c.meshing = false;
      this.stats.meshed++;
      this.applyMesh(c, msg.sections);
    }
  }

  onChunkData(c, blocks, fresh) {
    c.blocks = blocks;
    c.state = READY;
    c.needsMesh = true;
    let maxY = 0;
    outer: for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const base = y << 8;
      for (let i = 0; i < 256; i++) if (blocks[base + i] !== 0) { maxY = y; break outer; }
    }
    c.maxY = maxY;
    c.lights = [];
    const x0 = c.cx * 16, z0 = c.cz * 16;
    for (let i = 0, n = (maxY + 1) << 8; i < n; i++) {
      const l = BLOCK_LIGHT[blocks[i]];
      if (l) c.lights.push([x0 + (i & 15), i >> 8, z0 + ((i >> 4) & 15), l]);
    }
    if (this.onChunkLoaded) this.onChunkLoaded(c, fresh);
  }

  applyMesh(c, sections) {
    for (let sy = 0; sy < SECTIONS; sy++) {
      const s = sections[sy];
      c.meshes[sy * 2] = this.updateMesh(c, c.meshes[sy * 2], s && s.opaque, this.materials.opaque, sy);
      c.meshes[sy * 2 + 1] = this.updateMesh(c, c.meshes[sy * 2 + 1], s && s.water, this.materials.water, sy);
    }
    c.hasMesh = true;
  }

  updateMesh(c, mesh, g, material, sy) {
    if (!g) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('data', new THREE.BufferAttribute(g.data, 4));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    _sphereCenter.set(8, sy * 16 + 8, 8);
    geo.boundingSphere = new THREE.Sphere(_sphereCenter.clone(), 14);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, sy * 16, 0), new THREE.Vector3(16, sy * 16 + 16, 16));
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, material);
      mesh.position.set(c.cx * 16, 0, c.cz * 16);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      this.group.add(mesh);
    }
    return mesh;
  }

  unloadFar(pcx, pcz, R) {
    const r2 = R * R;
    const toSave = [];
    for (const c of this.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz <= r2) continue;
      if (this.dirtySave.has(c)) {
        toSave.push({ cx: c.cx, cz: c.cz, blocks: c.blocks });
        this.savedKeys.add(c.cx + ',' + c.cz);
        this.dirtySave.delete(c);
      }
      this.disposeChunk(c);
    }
    if (toSave.length) this.storage.putChunks(this.worldId, toSave).catch((e) => console.error('Save failed', e));
  }

  disposeChunk(c) {
    for (let i = 0; i < c.meshes.length; i++) {
      const m = c.meshes[i];
      if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes[i] = null; }
    }
    this.chunks.delete(c.key);
    this.urgent.delete(c);
    if (this.lastChunk === c) this.lastChunk = null;
  }

  // ---------- block access ----------

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const cx = x >> 4, cz = z >> 4;
    let c = this.lastChunk;
    if (!c || c.cx !== cx || c.cz !== cz) {
      c = this.chunks.get(chunkKey(cx, cz));
      if (!c || c.state !== READY) return B.UNLOADED;
      this.lastChunk = c;
    }
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  isLoaded(x, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return !!c && c.state === READY;
  }

  isRendered(x, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return !!c && c.hasMesh;
  }

  markDirty(c, urgent) {
    c.needsMesh = true;
    if (urgent) {
      this.urgent.add(c);
      c.lazyUntil = 0;
    } else if (!this.urgent.has(c) && c.lazyUntil < this.time) {
      c.lazyUntil = this.time + 0.35;
    }
  }

  // Returns the previous block id, or -1 if the position is not loaded.
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CHUNK_HEIGHT) return -1;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || c.state !== READY) return -1;
    const lx = x & 15, lz = z & 15;
    const i = lx | (lz << 4) | (y << 8);
    const old = c.blocks[i];
    if (old === id) return old;
    c.blocks[i] = id;
    if (id !== B.AIR && y > c.maxY) c.maxY = y;
    this.dirtySave.add(c);
    if (BLOCK_LIGHT[old]) c.lights = c.lights.filter((l) => !(l[0] === x && l[1] === y && l[2] === z));
    if (BLOCK_LIGHT[id]) c.lights.push([x, y, z, BLOCK_LIGHT[id]]);
    const lightChange = BLOCK_OPAQUE[old] !== BLOCK_OPAQUE[id] || BLOCK_LIGHT[old] !== BLOCK_LIGHT[id] || BLOCK_ATTEN[old] !== BLOCK_ATTEN[id];
    this.markDirty(c, true);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        if (!n || n.state !== READY) continue;
        const bx = dx === 0 || (dx < 0 ? lx === 0 : lx === 15);
        const bz = dz === 0 || (dz < 0 ? lz === 0 : lz === 15);
        if (bx && bz) this.markDirty(n, true);
        else if (lightChange) this.markDirty(n, false);
      }
    }
    return old;
  }

  // Highest solid block y in a column (or -1).
  getTopSolidY(x, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || c.state !== READY) return -1;
    const base = (x & 15) | ((z & 15) << 4);
    for (let y = c.maxY; y >= 0; y--) if (BLOCK_SOLID[c.blocks[base | (y << 8)]]) return y;
    return -1;
  }

  // True if nothing opaque (or leaves) is above this position.
  isSkyExposed(x, y, z) {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || c.state !== READY) return false;
    const base = (x & 15) | ((z & 15) << 4);
    for (let yy = Math.max(0, y + 1); yy <= c.maxY; yy++) {
      const id = c.blocks[base | (yy << 8)];
      if (BLOCK_OPAQUE[id] || (BLOCK_ATTEN[id] && id !== B.WATER)) return false;
    }
    return true;
  }

  // Cover above a position: number of opaque blocks (up to `limit`) and whether leaves shade it.
  skyAccess(x, y, z, limit = 8) {
    const out = { opaque: 0, leaves: false };
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || c.state !== READY) { out.opaque = limit; return out; }
    const base = (x & 15) | ((z & 15) << 4);
    for (let yy = Math.max(0, y + 1); yy <= c.maxY && out.opaque < limit; yy++) {
      const id = c.blocks[base | (yy << 8)];
      if (BLOCK_OPAQUE[id]) out.opaque++;
      else if (BLOCK_ATTEN[id] && id !== B.WATER) out.leaves = true;
    }
    return out;
  }

  // Approximate block light (torches etc.) at a position.
  blockLightAt(x, y, z) {
    let best = 0;
    const cx = x >> 4, cz = z >> 4;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!c) continue;
        for (const l of c.lights) {
          const v = l[3] - (Math.abs(l[0] - x) + Math.abs(l[1] - y) + Math.abs(l[2] - z));
          if (v > best) best = v;
        }
      }
    }
    return best;
  }

  // ---------- raycasting ----------

  // Amanatides & Woo voxel traversal. Returns { x, y, z, id, nx, ny, nz, dist } or null.
  raycast(origin, dir, maxDist) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMX = dx !== 0 ? (dx > 0 ? x + 1 - origin.x : origin.x - x) * tDX : Infinity;
    let tMY = dy !== 0 ? (dy > 0 ? y + 1 - origin.y : origin.y - y) * tDY : Infinity;
    let tMZ = dz !== 0 ? (dz > 0 ? z + 1 - origin.z : origin.z - z) * tDZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      if (id === B.UNLOADED) return null;
      if (BLOCK_TARGETABLE[id]) {
        const shape = BLOCK_SHAPE[id];
        if (shape === SHAPE.CUBE) return { x, y, z, id, nx, ny, nz, dist: t };
        const hit = rayBox(origin, dir, x, y, z, shapeBox(id));
        if (hit && hit.t <= maxDist) return { x, y, z, id, nx: hit.nx, ny: hit.ny, nz: hit.nz, dist: hit.t };
      }
      if (tMX < tMY) {
        if (tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; nx = -stepX; ny = 0; nz = 0; }
        else { z += stepZ; t = tMZ; tMZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
      } else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tMZ; tMZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  // ---------- persistence ----------

  async saveDirty() {
    if (!this.dirtySave.size) return;
    const list = [];
    for (const c of this.dirtySave) {
      list.push({ cx: c.cx, cz: c.cz, blocks: c.blocks });
      this.savedKeys.add(c.cx + ',' + c.cz);
    }
    this.dirtySave.clear();
    await this.storage.putChunks(this.worldId, list);
  }

  // Fraction of chunks within radius r (in chunks) around a position that have meshes.
  loadProgress(px, pz, r) {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    let total = 0, done = 0;
    const r2 = (r + 0.5) * (r + 0.5);
    for (const o of this.offsets) {
      if (o.d2 > r2) break;
      total++;
      const c = this.chunks.get(chunkKey(pcx + o.dx, pcz + o.dz));
      if (c && c.hasMesh) done++;
    }
    return total ? done / total : 1;
  }

  countStats() {
    let meshes = 0, ready = 0;
    for (const c of this.chunks.values()) {
      if (c.state === READY) ready++;
      for (const m of c.meshes) if (m) meshes++;
    }
    return { chunks: this.chunks.size, ready, meshes, tasks: this.tasks.size };
  }

  dispose() {
    this.disposed = true;
    this.pool.terminate();
    for (const c of [...this.chunks.values()]) this.disposeChunk(c);
    this.scene.remove(this.group);
  }
}

// Ray vs. axis-aligned box inside block (bx, by, bz). Returns { t, nx, ny, nz } or null.
export function rayBox(o, d, bx, by, bz, box) {
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  const mins = [bx + box[0], by + box[1], bz + box[2]];
  const maxs = [bx + box[3], by + box[4], bz + box[5]];
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ds[a]) < 1e-9) {
      if (os[a] < mins[a] || os[a] > maxs[a]) return null;
      continue;
    }
    let t1 = (mins[a] - os[a]) / ds[a], t2 = (maxs[a] - os[a]) / ds[a];
    let sgn = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sgn = 1; }
    if (t1 > tmin) {
      tmin = t1;
      nx = ny = nz = 0;
      if (a === 0) nx = sgn; else if (a === 1) ny = sgn; else nz = sgn;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), nx, ny, nz };
}
