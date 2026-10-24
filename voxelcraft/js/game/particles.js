// Pooled cube particles rendered with a single InstancedMesh.
import * as THREE from '../../lib/three.module.min.js';
import { BLOCKS, BLOCK_SOLID, T } from '../engine/blocks.js';
import { ICON_CANVAS } from './items.js';

const MAX = 900;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Particles {
  constructor(game) {
    this.game = game;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
    this.n = 0;
    this.px = new Float32Array(MAX); this.py = new Float32Array(MAX); this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX); this.vz = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX); this.grav = new Float32Array(MAX);
    this.cr = new Float32Array(MAX); this.cg = new Float32Array(MAX); this.cb = new Float32Array(MAX);
    this.iconColors = new Map();
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 1) {
    let i = this.n;
    if (i >= MAX) i = Math.floor(Math.random() * MAX);
    else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grav[i] = grav;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b;
  }

  blockColors(id) {
    const d = BLOCKS[id];
    const tex = this.game.textures;
    const tiles = d && d.faceTiles ? d.faceTiles : ['stone'];
    return () => tex.randomColor(T[tiles[Math.floor(Math.random() * tiles.length)]]);
  }

  blockBreak(x, y, z, id) {
    const pick = this.blockColors(id);
    const L = this.game.lightLevelAt(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < 26; i++) {
      const c = pick();
      const ox = Math.random(), oy = Math.random(), oz = Math.random();
      this.emit(x + ox, y + oy, z + oz, (ox - 0.5) * 4, Math.random() * 4 + 1, (oz - 0.5) * 4,
        0.5 + Math.random() * 0.6, 0.07 + Math.random() * 0.07, (c[0] / 255) * L, (c[1] / 255) * L, (c[2] / 255) * L);
    }
  }

  blockHit(hit) {
    const pick = this.blockColors(hit.id);
    const L = this.game.lightLevelAt(hit.x + 0.5 + hit.nx, hit.y + 0.5 + hit.ny, hit.z + 0.5 + hit.nz);
    for (let i = 0; i < 4; i++) {
      const c = pick();
      const x = hit.x + 0.5 + hit.nx * 0.52 + (hit.nx ? 0 : Math.random() - 0.5);
      const y = hit.y + 0.5 + hit.ny * 0.52 + (hit.ny ? 0 : Math.random() - 0.5);
      const z = hit.z + 0.5 + hit.nz * 0.52 + (hit.nz ? 0 : Math.random() - 0.5);
      this.emit(x, y, z, hit.nx * 1.5 + (Math.random() - 0.5), 1.5 + Math.random(), hit.nz * 1.5 + (Math.random() - 0.5),
        0.35 + Math.random() * 0.3, 0.06, (c[0] / 255) * L, (c[1] / 255) * L, (c[2] / 255) * L);
    }
  }

  poof(x, y, z) {
    for (let i = 0; i < 14; i++) {
      const s = 0.8 + Math.random() * 0.2;
      this.emit(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.5, 0.12, s, s, s, -0.1);
    }
  }

  flame(x, y, z) {
    this.emit(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, 0, 1.2, 0, 0.4, 0.08, 1, 0.55 + Math.random() * 0.3, 0.1, -0.2);
  }

  crit(x, y, z) {
    for (let i = 0; i < 10; i++) {
      this.emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.5, 0.06, 1, 0.95, 0.6, 0.6);
    }
  }

  explosion(x, y, z, r) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, s = Math.random() * r * 2.2;
      const g = 0.45 + Math.random() * 0.4;
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1.5, Math.sin(a) * Math.cos(e) * s,
        0.8 + Math.random() * 0.9, 0.25 + Math.random() * 0.35, g, g, g, -0.15);
    }
    for (let i = 0; i < 20; i++) {
      this.emit(x, y, z, (Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10, 0.3 + Math.random() * 0.3, 0.15, 1, 0.7, 0.2, 0.2);
    }
  }

  eatCrumbs(origin, dir, itemId) {
    let cols = this.iconColors.get(itemId);
    if (!cols) {
      cols = [];
      const c = ICON_CANVAS.get(itemId);
      if (c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] > 128) cols.push([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
      }
      if (!cols.length) cols.push([0.8, 0.5, 0.3]);
      this.iconColors.set(itemId, cols);
    }
    const x = origin.x + dir.x * 0.5, y = origin.y + dir.y * 0.5 - 0.15, z = origin.z + dir.z * 0.5;
    for (let i = 0; i < 4; i++) {
      const c = cols[Math.floor(Math.random() * cols.length)];
      this.emit(x, y, z, dir.x + (Math.random() - 0.5) * 1.5, 1 + Math.random(), dir.z + (Math.random() - 0.5) * 1.5, 0.5, 0.05, c[0], c[1], c[2]);
    }
  }

  update(dt) {
    const w = this.game.world;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.n;
        if (i !== last) {
          this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
          this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last]; this.grav[i] = this.grav[last];
          this.cr[i] = this.cr[last]; this.cg[i] = this.cg[last]; this.cb[i] = this.cb[last];
        }
        continue;
      }
      this.vy[i] -= 18 * this.grav[i] * dt;
      const nx = this.px[i] + this.vx[i] * dt, ny = this.py[i] + this.vy[i] * dt, nz = this.pz[i] + this.vz[i] * dt;
      if (w && BLOCK_SOLID[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) {
        this.vx[i] *= 0.3; this.vz[i] *= 0.3; this.vy[i] = 0;
      } else {
        this.px[i] = nx; this.py[i] = ny; this.pz[i] = nz;
      }
      if (this.grav[i] < 0) { this.vx[i] *= 0.96; this.vz[i] *= 0.96; }
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (this.grav[i] < 0 ? 0.6 + t * 0.6 : 1);
      _p.set(this.px[i], this.py[i], this.pz[i]);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _c.setRGB(this.cr[i], this.cg[i], this.cb[i]);
      this.mesh.setColorAt(i, _c);
      i++;
    }
    this.mesh.count = this.n;
    if (this.n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
