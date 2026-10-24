// Chunk mesher: flood-fill sky/block lighting, smooth lighting + ambient occlusion,
// hidden-face removal and greedy meshing. Runs inside the worker pool.
import { CHUNK_SIZE, CHUNK_HEIGHT, SECTIONS } from './constants.js';
import {
  B, SHAPE, BLOCK_SHAPE, BLOCK_OPAQUE, BLOCK_TILES, BLOCK_LIGHT, BLOCK_ATTEN,
  BLOCK_CULLSELF, BLOCK_TORCH_DIR,
} from './blocks.js';

const M = 14; // neighbour margin used for light propagation
const PW = CHUNK_SIZE + 2 * M;
const PA = PW * PW;
const PH = CHUNK_HEIGHT + 2; // one floor layer (y = -1) and one ceiling layer (y = CHUNK_HEIGHT)
const VOL = PA * PH;

const vox = new Uint8Array(VOL);
const skyL = new Uint8Array(VOL);
const blkL = new Uint8Array(VOL);
const queue = new Int32Array(VOL);

const DOFF = [1, -1, PA, -PA, PW, -PW];
const UOFF = [PW, 1, 1];
const VOFF = [PA, PW, PA];

const cSky = new Uint8Array(4);
const cBlk = new Uint8Array(4);
const cOcc = new Uint8Array(4);
const mask = new Int32Array(256);
const ORDER_U = [0, 1, 2, 3];
const ORDER_V = [0, 3, 2, 1];

class GeoBuf {
  constructor(cap) {
    this.alloc(cap);
  }
  alloc(cap) {
    const old = this.cap ? this : null;
    this.cap = cap;
    const pos = new Float32Array(cap * 3);
    const uv = new Float32Array(cap * 2);
    const dat = new Uint8Array(cap * 4);
    const ind = new Uint32Array(Math.ceil(cap * 1.5));
    if (old) {
      pos.set(this.pos.subarray(0, this.vc * 3));
      uv.set(this.uv.subarray(0, this.vc * 2));
      dat.set(this.dat.subarray(0, this.vc * 4));
      ind.set(this.ind.subarray(0, this.ic));
    } else {
      this.vc = 0;
      this.ic = 0;
    }
    this.pos = pos;
    this.uv = uv;
    this.dat = dat;
    this.ind = ind;
  }
  reset() {
    this.vc = 0;
    this.ic = 0;
  }
  vertex(x, y, z, u, v, d0, d1, d2, d3) {
    if (this.vc >= this.cap) this.alloc(this.cap * 2);
    const i = this.vc++;
    const p = i * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    const q = i * 4;
    this.dat[q] = d0;
    this.dat[q + 1] = d1;
    this.dat[q + 2] = d2;
    this.dat[q + 3] = d3;
  }
  quadIndices(base, flip) {
    const ind = this.ind;
    let i = this.ic;
    if (!flip) {
      ind[i++] = base; ind[i++] = base + 1; ind[i++] = base + 2;
      ind[i++] = base; ind[i++] = base + 2; ind[i++] = base + 3;
    } else {
      ind[i++] = base + 1; ind[i++] = base + 2; ind[i++] = base + 3;
      ind[i++] = base + 1; ind[i++] = base + 3; ind[i++] = base;
    }
    this.ic = i;
  }
  result() {
    if (this.vc === 0) return null;
    const vc = this.vc;
    return {
      pos: this.pos.slice(0, vc * 3),
      uv: this.uv.slice(0, vc * 2),
      data: this.dat.slice(0, vc * 4),
      index: vc <= 65535 ? new Uint16Array(this.ind.subarray(0, this.ic)) : this.ind.slice(0, this.ic),
    };
  }
}

const opaqueBuf = new GeoBuf(16384);
const waterBuf = new GeoBuf(4096);

function buildVolume(chunks, topY) {
  vox.fill(B.BEDROCK, 0, PA);
  for (let y = 0; y < topY; y++) {
    const dstLayer = (y + 1) * PA;
    const srcLayer = y << 8;
    for (let pz = 0; pz < PW; pz++) {
      const lz = pz - M;
      const cz = lz < 0 ? 0 : (lz >= 16 ? 2 : 1);
      const sz = lz - (cz - 1) * 16;
      const srcRow = srcLayer | (sz << 4);
      const dst = dstLayer + pz * PW;
      const c0 = chunks[cz * 3], c1 = chunks[cz * 3 + 1], c2 = chunks[cz * 3 + 2];
      const s0 = srcRow + 16 - M;
      for (let i = 0; i < M; i++) vox[dst + i] = c0[s0 + i];
      const d1 = dst + M;
      for (let i = 0; i < 16; i++) vox[d1 + i] = c1[srcRow + i];
      const d2 = dst + M + 16;
      for (let i = 0; i < M; i++) vox[d2 + i] = c2[srcRow + i];
    }
  }
  // Everything above the copied region is air (clears stale data from the previous chunk).
  vox.fill(0, (topY + 1) * PA, VOL);
}

function propagate(light, head, tail, topLayer) {
  while (head !== tail) {
    const p = queue[head];
    head++;
    if (head === VOL) head = 0;
    const v = light[p];
    if (v <= 1) continue;
    const L = (p / PA) | 0;
    const r = p - L * PA;
    const z = (r / PW) | 0;
    const x = r - z * PW;
    let q, id, nv;
    if (x > 0) {
      q = p - 1; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
    if (x < PW - 1) {
      q = p + 1; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
    if (z > 0) {
      q = p - PW; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
    if (z < PW - 1) {
      q = p + PW; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
    if (L > 1) {
      q = p - PA; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
    if (L < topLayer - 1) {
      q = p + PA; id = vox[q];
      if (!BLOCK_OPAQUE[id]) { nv = v - 1 - BLOCK_ATTEN[id]; if (nv > light[q]) { light[q] = nv; queue[tail++] = q; if (tail === VOL) tail = 0; } }
    }
  }
}

function computeLight(topY) {
  const topLayer = topY + 1; // layer index of the first all-air layer
  skyL.fill(0, 0, topLayer * PA);
  skyL.fill(15, topLayer * PA, VOL);
  blkL.fill(0, 0, VOL);

  // Direct sky light falls straight down until it hits an opaque block.
  for (let i = 0; i < PA; i++) {
    let v = 15;
    for (let L = topLayer - 1; L >= 1; L--) {
      const p = L * PA + i;
      const id = vox[p];
      if (BLOCK_OPAQUE[id]) break;
      const at = BLOCK_ATTEN[id];
      if (at) { v -= at; if (v <= 0) break; }
      skyL[p] = v;
    }
  }

  let tail = 0;
  for (let L = 1; L < topLayer; L++) {
    for (let z = 0; z < PW; z++) {
      let p = L * PA + z * PW;
      for (let x = 0; x < PW; x++, p++) {
        const v = skyL[p];
        if (v < 2) continue;
        const t = v - 1;
        if ((x > 0 && skyL[p - 1] < t && !BLOCK_OPAQUE[vox[p - 1]]) ||
            (x < PW - 1 && skyL[p + 1] < t && !BLOCK_OPAQUE[vox[p + 1]]) ||
            (z > 0 && skyL[p - PW] < t && !BLOCK_OPAQUE[vox[p - PW]]) ||
            (z < PW - 1 && skyL[p + PW] < t && !BLOCK_OPAQUE[vox[p + PW]]) ||
            (skyL[p - PA] < t && !BLOCK_OPAQUE[vox[p - PA]])) {
          queue[tail++] = p;
        }
      }
    }
  }
  propagate(skyL, 0, tail, topLayer);

  tail = 0;
  for (let p = PA, e = topLayer * PA; p < e; p++) {
    const em = BLOCK_LIGHT[vox[p]];
    if (em) {
      blkL[p] = em;
      queue[tail++] = p;
    }
  }
  if (tail) propagate(blkL, 0, tail, topLayer);
}

// Smooth light + AO for the four corners of a face whose front (air side) cell is f.
// Corner order: 0 (u0,v0), 1 (u1,v0), 2 (u1,v1), 3 (u0,v1).
function computeCorners(f, ou, ov) {
  const sF = skyL[f], bF = blkL[f];
  const pu = f + ou, mu = f - ou, pv = f + ov, mv = f - ov;
  const oPU = BLOCK_OPAQUE[vox[pu]], oMU = BLOCK_OPAQUE[vox[mu]];
  const oPV = BLOCK_OPAQUE[vox[pv]], oMV = BLOCK_OPAQUE[vox[mv]];
  for (let k = 0; k < 4; k++) {
    let s1, s2, o1, o2;
    if (k === 0 || k === 3) { s1 = mu; o1 = oMU; } else { s1 = pu; o1 = oPU; }
    if (k < 2) { s2 = mv; o2 = oMV; } else { s2 = pv; o2 = oPV; }
    const dg = s1 + (s2 - f);
    const od = BLOCK_OPAQUE[vox[dg]];
    cOcc[k] = (o1 && o2) ? 3 : o1 + o2 + od;
    let ss = sF, bb = bF, n = 1;
    if (!o1) { ss += skyL[s1]; bb += blkL[s1]; n++; }
    if (!o2) { ss += skyL[s2]; bb += blkL[s2]; n++; }
    if (!(o1 && o2) && !od) { ss += skyL[dg]; bb += blkL[dg]; n++; }
    cSky[k] = Math.round((ss * 17) / n);
    cBlk[k] = Math.round((bb * 17) / n);
  }
}

function texCoord(d, x, y, z, out) {
  switch (d) {
    case 0: out[0] = -z; out[1] = y; break;
    case 1: out[0] = z; out[1] = y; break;
    case 2: out[0] = x; out[1] = z; break;
    case 3: out[0] = x; out[1] = -z; break;
    case 4: out[0] = x; out[1] = y; break;
    default: out[0] = -x; out[1] = y; break;
  }
}
const tc = [0, 0];

// Emit an axis-aligned face in plane `c` (along axis d>>1) spanning [u0,u1]x[v0,v1].
function pushFace(buf, d, c, u0, v0, u1, v1, tile) {
  const a = d >> 1;
  const s = (d & 1) === 0 ? 1 : -1;
  const uFirst = a === 2 ? s > 0 : s < 0;
  const order = uFirst ? ORDER_U : ORDER_V;
  const base = buf.vc;
  for (let k = 0; k < 4; k++) {
    const ci = order[k];
    const u = (ci === 1 || ci === 2) ? u1 : u0;
    const v = ci >= 2 ? v1 : v0;
    let x, y, z;
    if (a === 0) { x = c; y = v; z = u; } else if (a === 1) { x = u; y = c; z = v; } else { x = u; y = v; z = c; }
    texCoord(d, x, y, z, tc);
    buf.vertex(x, y, z, tc[0], tc[1], tile, cSky[ci], cBlk[ci], cOcc[ci] * 8 + d);
  }
  const o0 = order[0], o1 = order[1], o2 = order[2], o3 = order[3];
  const f02 = cOcc[o0] + cOcc[o2], f13 = cOcc[o1] + cOcc[o3];
  let flip = f02 > f13;
  if (f02 === f13) {
    const l02 = cSky[o0] + cBlk[o0] + cSky[o2] + cBlk[o2];
    const l13 = cSky[o1] + cBlk[o1] + cSky[o3] + cBlk[o3];
    flip = l02 < l13;
  }
  buf.quadIndices(base, flip);
}

function setUniform(sky, blk, occ) {
  cSky[0] = cSky[1] = cSky[2] = cSky[3] = sky;
  cBlk[0] = cBlk[1] = cBlk[2] = cBlk[3] = blk;
  cOcc[0] = cOcc[1] = cOcc[2] = cOcc[3] = occ;
}

// Arbitrary quad from 4 corner positions (CCW from the visible side).
function pushRawQuad(buf, pts, uvs, tile, sky, blk, face, doubleSided) {
  let base = buf.vc;
  for (let k = 0; k < 4; k++) {
    buf.vertex(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], uvs[k * 2], uvs[k * 2 + 1], tile, sky, blk, face);
  }
  buf.quadIndices(base, false);
  if (doubleSided) {
    base = buf.vc;
    for (let k = 3; k >= 0; k--) {
      buf.vertex(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], uvs[k * 2], uvs[k * 2 + 1], tile, sky, blk, face);
    }
    buf.quadIndices(base, false);
  }
}

const rawPts = new Float32Array(12);
const rawUv = new Float32Array(8);
const CROSS_UV = [0, 0, 1, 0, 1, 1, 0, 1];

function emitCross(buf, x, y, z, tile, sky, blk) {
  const a0 = 0.15, a1 = 0.85;
  rawUv.set(CROSS_UV);
  rawPts.set([x + a0, y, z + a0, x + a1, y, z + a1, x + a1, y + 1, z + a1, x + a0, y + 1, z + a0]);
  pushRawQuad(buf, rawPts, rawUv, tile, sky, blk, 6, true);
  rawPts.set([x + a1, y, z + a0, x + a0, y, z + a1, x + a0, y + 1, z + a1, x + a1, y + 1, z + a0]);
  pushRawQuad(buf, rawPts, rawUv, tile, sky, blk, 6, true);
}

// Box face corners in pushFace order for face d of box [x0..x1]x[y0..y1]x[z0..z1].
function boxFace(d, b, out) {
  const a = d >> 1;
  const s = (d & 1) === 0 ? 1 : -1;
  const uFirst = a === 2 ? s > 0 : s < 0;
  const order = uFirst ? ORDER_U : ORDER_V;
  const c = s > 0 ? b[3 + a] : b[a];
  let ua, va;
  if (a === 0) { ua = 2; va = 1; } else if (a === 1) { ua = 0; va = 2; } else { ua = 0; va = 1; }
  for (let k = 0; k < 4; k++) {
    const ci = order[k];
    const p = k * 3;
    out[p + a] = c;
    out[p + ua] = (ci === 1 || ci === 2) ? b[3 + ua] : b[ua];
    out[p + va] = ci >= 2 ? b[3 + va] : b[va];
    out[12 + k * 2] = (ci === 1 || ci === 2) ? 1 : 0;
    out[13 + k * 2] = ci >= 2 ? 1 : 0;
  }
}
const faceTmp = new Float32Array(20);
const boxTmp = new Float32Array(6);
const TORCH_LEAN = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

function emitTorch(buf, x, y, z, id, tile, sky, blk) {
  const dir = BLOCK_TORCH_DIR[id];
  const [fx, fz] = TORCH_LEAN[dir];
  const w = 1 / 16;
  boxTmp.set([-w, 0, -w, w, 10 / 16, w]);
  let bx = x + 0.5, by = y, bz = z + 0.5;
  if (dir) {
    bx -= fx * (0.5 - w);
    bz -= fz * (0.5 - w);
    by += 0.2;
  }
  const lean = dir ? 0.45 : 0;
  for (let d = 0; d < 6; d++) {
    if (d === 3 && !dir) continue;
    boxFace(d, boxTmp, faceTmp);
    for (let k = 0; k < 4; k++) {
      const ly = faceTmp[k * 3 + 1];
      rawPts[k * 3] = bx + faceTmp[k * 3] + fx * ly * lean;
      rawPts[k * 3 + 1] = by + ly;
      rawPts[k * 3 + 2] = bz + faceTmp[k * 3 + 2] + fz * ly * lean;
      const fu = faceTmp[12 + k * 2], fv = faceTmp[13 + k * 2];
      rawUv[k * 2] = (7 + fu * 2) / 16;
      if (d === 2) rawUv[k * 2 + 1] = (8 + fv * 2) / 16;
      else if (d === 3) rawUv[k * 2 + 1] = (fv * 2) / 16;
      else rawUv[k * 2 + 1] = (fv * 10) / 16;
    }
    pushRawQuad(buf, rawPts, rawUv, tile, sky, blk, d, false);
  }
}

function emitCactus(buf, x, y, z, id, p, sky, blk) {
  const i = 1 / 16;
  boxTmp.set([x + i, y, z + i, x + 1 - i, y + 1, z + 1 - i]);
  for (let d = 0; d < 6; d++) {
    if (d === 2 || d === 3) {
      const n = vox[p + DOFF[d]];
      if (BLOCK_OPAQUE[n] || n === id) continue;
    }
    boxFace(d, boxTmp, faceTmp);
    for (let k = 0; k < 4; k++) {
      rawPts[k * 3] = faceTmp[k * 3];
      rawPts[k * 3 + 1] = faceTmp[k * 3 + 1];
      rawPts[k * 3 + 2] = faceTmp[k * 3 + 2];
      rawUv[k * 2] = faceTmp[12 + k * 2];
      rawUv[k * 2 + 1] = faceTmp[13 + k * 2];
    }
    pushRawQuad(buf, rawPts, rawUv, BLOCK_TILES[id * 6 + d], sky, blk, d, false);
  }
}

function emitKey(key, d, sl, y0, u, v, w, h) {
  const a = d >> 1;
  const s = (d & 1) === 0 ? 1 : -1;
  const tile = key & 255;
  const occ = (key >> 8) & 3;
  const sky = (key >> 10) & 255;
  const blk = (key >> 18) & 255;
  const lowered = (key >> 26) & 1;
  const water = (key >> 28) & 1;
  let c, u0, v0;
  if (a === 0) { c = sl + (s > 0 ? 1 : 0); u0 = u; v0 = y0 + v; }
  else if (a === 1) { c = y0 + sl + (s > 0 ? 1 : 0); u0 = u; v0 = v; }
  else { c = sl + (s > 0 ? 1 : 0); u0 = u; v0 = y0 + v; }
  let v1 = v0 + h;
  if (lowered) {
    if (a === 1) c -= 0.125;
    else v1 -= 0.125;
  }
  setUniform(sky, blk, occ);
  pushFace(water ? waterBuf : opaqueBuf, d, c, u0, v0, u0 + w, v1, tile);
}

function greedy(d, sl, y0) {
  for (let v = 0; v < 16; v++) {
    for (let u = 0; u < 16;) {
      const key = mask[u + v * 16];
      if (!key) { u++; continue; }
      let w = 1;
      while (u + w < 16 && mask[u + w + v * 16] === key) w++;
      let h = 1;
      outer: while (v + h < 16) {
        const row = (v + h) * 16;
        for (let k = 0; k < w; k++) if (mask[u + k + row] !== key) break outer;
        h++;
      }
      for (let hh = 0; hh < h; hh++) {
        const row = (v + hh) * 16;
        for (let k = 0; k < w; k++) mask[u + k + row] = 0;
      }
      emitKey(key, d, sl, y0, u, v, w, h);
      u += w;
    }
  }
}

function meshSection(sy) {
  opaqueBuf.reset();
  waterBuf.reset();
  const y0 = sy * 16;
  for (let d = 0; d < 6; d++) {
    const a = d >> 1;
    const s = (d & 1) === 0 ? 1 : -1;
    const doff = DOFF[d];
    const ou = UOFF[a], ov = VOFF[a];
    for (let sl = 0; sl < 16; sl++) {
      let any = false;
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; u++) {
          const mi = u + v * 16;
          mask[mi] = 0;
          let x, y, z;
          if (a === 0) { x = sl; z = u; y = y0 + v; }
          else if (a === 1) { y = y0 + sl; x = u; z = v; }
          else { z = sl; x = u; y = y0 + v; }
          const p = (x + M) + (z + M) * PW + (y + 1) * PA;
          const id = vox[p];
          if (id === 0) continue;
          const shape = BLOCK_SHAPE[id];
          const f = p + doff;
          const nid = vox[f];
          if (shape === SHAPE.CUBE) {
            if (BLOCK_OPAQUE[nid] || (BLOCK_CULLSELF[id] && nid === id)) continue;
            const tile = BLOCK_TILES[id * 6 + d];
            computeCorners(f, ou, ov);
            if (cOcc[0] === cOcc[1] && cOcc[0] === cOcc[2] && cOcc[0] === cOcc[3] &&
                cSky[0] === cSky[1] && cSky[0] === cSky[2] && cSky[0] === cSky[3] &&
                cBlk[0] === cBlk[1] && cBlk[0] === cBlk[2] && cBlk[0] === cBlk[3]) {
              mask[mi] = tile | (cOcc[0] << 8) | (cSky[0] << 10) | (cBlk[0] << 18) | (1 << 27);
              any = true;
            } else {
              let c, u0, v0;
              if (a === 0) { c = x + (s > 0 ? 1 : 0); u0 = z; v0 = y; }
              else if (a === 1) { c = y + (s > 0 ? 1 : 0); u0 = x; v0 = z; }
              else { c = z + (s > 0 ? 1 : 0); u0 = x; v0 = y; }
              pushFace(opaqueBuf, d, c, u0, v0, u0 + 1, v0 + 1, tile);
            }
          } else if (shape === SHAPE.LIQUID) {
            if (nid === id || BLOCK_OPAQUE[nid]) continue;
            const above = vox[p + PA];
            const lowered = d !== 3 && above !== id && !BLOCK_OPAQUE[above] ? 1 : 0;
            const tile = BLOCK_TILES[id * 6 + d];
            mask[mi] = tile | (skyL[f] * 17 << 10) | (blkL[f] * 17 << 18) | (lowered << 26) | (1 << 27) | (1 << 28);
            any = true;
          }
        }
      }
      if (any) greedy(d, sl, y0);
    }
  }

  // Non-cube shapes: plants, torches, cactus.
  for (let y = y0; y < y0 + 16; y++) {
    for (let z = 0; z < 16; z++) {
      let p = M + (z + M) * PW + (y + 1) * PA;
      for (let x = 0; x < 16; x++, p++) {
        const id = vox[p];
        if (id === 0) continue;
        const shape = BLOCK_SHAPE[id];
        if (shape === SHAPE.CUBE || shape === SHAPE.LIQUID || shape === SHAPE.NONE) continue;
        const sky = skyL[p] * 17, blk = blkL[p] * 17;
        if (shape === SHAPE.CROSS) emitCross(opaqueBuf, x, y, z, BLOCK_TILES[id * 6], sky, blk);
        else if (shape === SHAPE.TORCH) emitTorch(opaqueBuf, x, y, z, id, BLOCK_TILES[id * 6], sky, blk);
        else if (shape === SHAPE.CACTUS) emitCactus(opaqueBuf, x, y, z, id, p, sky, blk);
      }
    }
  }

  const opaque = opaqueBuf.result();
  const water = waterBuf.result();
  if (!opaque && !water) return null;
  return { opaque, water };
}

function sectionEmpty(blocks, sy) {
  const start = sy * 4096, end = start + 4096;
  for (let i = start; i < end; i++) if (blocks[i] !== 0) return false;
  return true;
}

// chunks: 9 Uint8Arrays ordered (dz+1)*3 + (dx+1); maxYs: highest non-air y of each.
export function meshChunk(chunks, maxYs) {
  let maxY = 0;
  for (let i = 0; i < 9; i++) if (maxYs[i] > maxY) maxY = maxYs[i];
  const topY = Math.min(CHUNK_HEIGHT, maxY + 2);
  buildVolume(chunks, topY);
  computeLight(topY);
  const center = chunks[4];
  const centerMax = maxYs[4];
  const sections = [];
  for (let sy = 0; sy < SECTIONS; sy++) {
    if (sy * 16 > centerMax + 1 || sectionEmpty(center, sy)) { sections.push(null); continue; }
    sections.push(meshSection(sy));
  }
  return sections;
}
