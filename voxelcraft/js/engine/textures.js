// Procedural 16x16 pixel-art textures for every block tile, packed into a WebGL2 texture array.
import * as THREE from '../../lib/three.module.min.js';
import { TILE_NAMES, T } from './blocks.js';
import { mulberry32, hashString } from './noise.js';

const S = 16;

export class Tile {
  constructor() {
    this.data = new Uint8ClampedArray(S * S * 4);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x, y) {
    const i = (((y + S) % S) * S + ((x + S) % S)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x, y) {
    return this.data[(y * S + x) * 4 + 3];
  }
}

export function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function scale(c, f) {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function noiseFill(t, r, base, v) {
  const c = rgb(base);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, scale(c, 1 + (r() * 2 - 1) * v));
}
function paletteFill(t, r, pal) {
  const cols = pal.map(rgb);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, cols[Math.floor(r() * cols.length)]);
}
function speckle(t, r, hex, p, v = 0.05) {
  const c = rgb(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (r() < p) t.set(x, y, scale(c, 1 + (r() * 2 - 1) * v));
}
function border(t, hex, a = 255) {
  const c = rgb(hex);
  for (let i = 0; i < S; i++) { t.set(i, 0, c, a); t.set(i, S - 1, c, a); t.set(0, i, c, a); t.set(S - 1, i, c, a); }
}
function bevel(t, light, dark) {
  const l = rgb(light), d = rgb(dark);
  for (let i = 0; i < S; i++) { t.set(i, 0, l); t.set(0, i, l); t.set(i, S - 1, d); t.set(S - 1, i, d); }
}
function clear(t) {
  t.data.fill(0);
}

// Voronoi helper for cobblestone-like patterns (wraps for seamless tiling).
function voronoi(t, r, n, shades, edgeHex, noiseV) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([r() * S, r() * S, shades[Math.floor(r() * shades.length)]]);
  const edge = rgb(edgeHex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = null;
      for (const p of pts) {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const dx = x + 0.5 - (p[0] + ox * S), dy = y + 0.5 - (p[1] + oy * S);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
        }
      }
      const base = rgb(best[2]);
      if (d2 - d1 < 1.1) t.set(x, y, scale(edge, 1 + (r() * 2 - 1) * 0.1));
      else t.set(x, y, scale(base, 1 + (r() * 2 - 1) * noiseV - (d1 / 12) * 0.25));
    }
  }
}

const GRASS = [0x5c9e36, 0x68ac40, 0x4f8c2f, 0x74b84b, 0x5a9632, 0x62a43a];

function drawDirt(t, r) {
  noiseFill(t, r, 0x866043, 0.1);
  speckle(t, r, 0x6b4a32, 0.16);
  speckle(t, r, 0x9b7653, 0.08);
  speckle(t, r, 0x7a7068, 0.02);
}

function drawStone(t, r) {
  noiseFill(t, r, 0x7f7f7f, 0.07);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S), len = 2 + Math.floor(r() * 3);
    const c = r() < 0.5 ? rgb(0x6c6c6c) : rgb(0x909090);
    for (let k = 0; k < len; k++) t.set((x + k) % S, y, scale(c, 1 + (r() - 0.5) * 0.08));
  }
}

function drawPlanks(t, r, base = 0xa8864f, seam = 0x6f5532, grain = 0x94743f) {
  const b = rgb(base), sm = rgb(seam), g = rgb(grain);
  for (let board = 0; board < 4; board++) {
    const vx = Math.floor(r() * 12) + 2;
    for (let y = board * 4; y < board * 4 + 4; y++) {
      for (let x = 0; x < S; x++) {
        let c = scale(b, 1 + (r() * 2 - 1) * 0.05);
        if (r() < 0.12) c = g;
        if (y === board * 4 + 3) c = sm;
        else if (x === vx && board % 2 === 0) c = scale(sm, 1.1);
        else if (x === (vx + 8) % S && board % 2 === 1) c = scale(sm, 1.1);
        t.set(x, y, c);
      }
    }
  }
}

function drawLogSide(t, r, base, dark, light) {
  const b = rgb(base), d = rgb(dark), l = rgb(light);
  const colShade = [];
  for (let x = 0; x < S; x++) colShade.push(0.88 + r() * 0.22);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c = scale(b, colShade[x] + (r() - 0.5) * 0.06);
      if ((x % 4 === 1 && r() < 0.8) || r() < 0.05) c = d;
      else if (x % 5 === 3 && r() < 0.4) c = l;
      t.set(x, y, c);
    }
  }
}

function drawLogTop(t, r, bark, ringA, ringB, center) {
  const bk = rgb(bark), a = rgb(ringA), b = rgb(ringB), c = rgb(center);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let col;
      if (d > 6.6) col = bk;
      else if (d < 1.6) col = c;
      else col = Math.floor(d) % 2 === 0 ? a : b;
      t.set(x, y, scale(col, 1 + (r() - 0.5) * 0.1));
    }
  }
}

function drawLeaves(t, r, pal, holes) {
  const cols = pal.map(rgb);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (r() < holes) t.set(x, y, [0, 0, 0], 0);
      else t.set(x, y, cols[Math.floor(r() * cols.length)]);
    }
  }
}

function drawOre(t, r, colors) {
  drawStone(t, r);
  const cols = colors.map(rgb);
  const spots = 5 + Math.floor(r() * 2);
  for (let i = 0; i < spots; i++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const [ox, oy] = cells[k];
      t.set(cx + ox, cy + oy, k === 0 ? cols[2] : cols[r() < 0.6 ? 0 : 1]);
    }
  }
}

function drawCrack(t, stage) {
  clear(t);
  const r = mulberry32(777);
  const path = [];
  const starts = [[8, 8], [3, 5], [12, 3], [5, 12], [13, 12]];
  for (const s of starts) {
    let x = s[0], y = s[1];
    for (let k = 0; k < 9; k++) {
      path.push([x, y]);
      x += Math.round(r() * 2 - 1);
      y += Math.round(r() * 2 - 1);
      x = Math.max(0, Math.min(15, x));
      y = Math.max(0, Math.min(15, y));
    }
  }
  const n = Math.floor(path.length * (stage + 1) / 10);
  for (let i = 0; i < n; i++) t.set(path[i][0], path[i][1], [20, 20, 20], 210);
}

const DRAW = {
  grass_top(t, r) { paletteFill(t, r, GRASS); },
  grass_side(t, r) {
    drawDirt(t, r);
    const cols = GRASS.map(rgb);
    for (let x = 0; x < S; x++) {
      const depth = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
      for (let y = 0; y < depth; y++) t.set(x, y, scale(cols[Math.floor(r() * cols.length)], 0.92));
    }
  },
  snowy_grass_side(t, r) {
    drawDirt(t, r);
    for (let x = 0; x < S; x++) {
      const depth = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
      for (let y = 0; y < depth; y++) t.set(x, y, scale(rgb(0xf0f5f8), 1 - r() * 0.06));
    }
  },
  dirt: drawDirt,
  stone: drawStone,
  cobblestone(t, r) { voronoi(t, r, 10, [0x8a8a8a, 0x7a7a7a, 0x6c6c6c, 0x969696, 0x7f7f7f], 0x4e4e4e, 0.08); },
  mossy_cobblestone(t, r) {
    voronoi(t, r, 10, [0x8a8a8a, 0x7a7a7a, 0x6c6c6c, 0x969696], 0x4e4e4e, 0.08);
    const moss = [rgb(0x5a7f3a), rgb(0x4a6b2e), rgb(0x6a9147)];
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      t.set(x, y, moss[Math.floor(r() * 3)]);
      if (r() < 0.6) t.set(x + 1, y, moss[Math.floor(r() * 3)]);
    }
  },
  sand(t, r) { noiseFill(t, r, 0xdbd3a0, 0.04); speckle(t, r, 0xc8bd85, 0.12); speckle(t, r, 0xe9e3bd, 0.08); },
  gravel(t, r) {
    paletteFill(t, r, [0x8a8580, 0x6e6a66, 0xa39e98, 0x7a6f66, 0x5d5955, 0x948d86]);
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      const c = rgb([0xb0aaa4, 0x55514d, 0x8c7f72][Math.floor(r() * 3)]);
      t.set(x, y, c); t.set(x + 1, y, c); t.set(x, y + 1, scale(c, 0.85));
    }
  },
  water(t, r) {
    const base = rgb(0x2f62d6), light = rgb(0x4c84ee);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, scale(base, 1 + (r() - 0.5) * 0.08), 175);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S), len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) t.set((x + k) % S, y, light, 185);
    }
  },
  bedrock(t, r) { paletteFill(t, r, [0x2b2b2b, 0x4a4a4a, 0x6b6b6b, 0x1e1e1e, 0x575757, 0x3a3a3a]); },
  oak_log(t, r) { drawLogSide(t, r, 0x6b5232, 0x4d3a22, 0x7d6139); },
  oak_log_top(t, r) { drawLogTop(t, r, 0x6b5232, 0xb8945f, 0x9f7d4c, 0x8c6a3e); },
  birch_log(t, r) {
    noiseFill(t, r, 0xd8d6cf, 0.04);
    const dark = rgb(0x2f2f2f), gray = rgb(0xa9a69c);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S), len = 2 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) t.set((x + k) % S, y, k === 0 ? gray : dark);
    }
  },
  birch_log_top(t, r) { drawLogTop(t, r, 0xd8d6cf, 0xd6c08a, 0xc4ab73, 0xb79c63); },
  spruce_log(t, r) { drawLogSide(t, r, 0x3e2a17, 0x2b1d0f, 0x4d3620); },
  spruce_log_top(t, r) { drawLogTop(t, r, 0x3e2a17, 0x8a6a3c, 0x765930, 0x6a4f2a); },
  oak_leaves(t, r) { drawLeaves(t, r, [0x3d7c24, 0x4a8f2e, 0x2f6a1c, 0x56a035, 0x417f27], 0.2); },
  birch_leaves(t, r) { drawLeaves(t, r, [0x5d8f3a, 0x6aa045, 0x4f7f30, 0x7ab350], 0.2); },
  spruce_leaves(t, r) { drawLeaves(t, r, [0x2d5a2d, 0x3a6b38, 0x244a25, 0x41763f], 0.16); },
  planks(t, r) { drawPlanks(t, r); },
  coal_ore(t, r) { drawOre(t, r, [0x262626, 0x3a3a3a, 0x4d4d4d]); },
  iron_ore(t, r) { drawOre(t, r, [0xd8af93, 0xb8896b, 0xf0d6c2]); },
  gold_ore(t, r) { drawOre(t, r, [0xfcee4b, 0xd9a521, 0xfffbb0]); },
  diamond_ore(t, r) { drawOre(t, r, [0x5decf5, 0x23a8b2, 0xd2fffc]); },
  snow(t, r) { noiseFill(t, r, 0xf3f7fa, 0.02); speckle(t, r, 0xdce5ec, 0.1, 0.02); },
  cactus_side(t, r) {
    const base = rgb(0x2f7d2b), dark = rgb(0x1f5b1d), light = rgb(0x4aa045), spine = rgb(0xd8d8a0);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let c = scale(base, 1 + (r() - 0.5) * 0.1);
        if (x === 0 || x === 15) c = dark;
        else if (x === 4 || x === 8 || x === 12) c = light;
        t.set(x, y, c);
      }
    }
    for (let i = 0; i < 8; i++) t.set([4, 8, 12][i % 3] + (r() < 0.5 ? -1 : 1), Math.floor(r() * S), spine);
  },
  cactus_top(t, r) {
    drawLogTop(t, r, 0x1f5b1d, 0x2f7d2b, 0x3c8f37, 0x4aa045);
  },
  sandstone(t, r) {
    noiseFill(t, r, 0xd8cb8f, 0.04);
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < 3; y++) t.set(x, y, scale(rgb(0xe4d9a4), 1 + (r() - 0.5) * 0.05));
      t.set(x, 3, rgb(0xc4b67c));
      t.set(x, 12, rgb(0xc8ba80));
      for (let y = 13; y < S; y++) t.set(x, y, scale(rgb(0xcdbf86), 1 + (r() - 0.5) * 0.05));
    }
  },
  sandstone_top(t, r) { noiseFill(t, r, 0xdccf96, 0.035); speckle(t, r, 0xcabd82, 0.06); },
  glass(t, r) {
    clear(t);
    border(t, 0xcfe9f2);
    const hl = rgb(0xf2fbff);
    [[3, 3], [4, 2], [2, 4], [4, 4], [3, 5], [5, 3], [11, 10], [12, 11], [10, 11]].forEach(([x, y]) => t.set(x, y, hl, 200));
    for (let i = 1; i < 15; i++) if (r() < 0.3) t.set(i, 1, rgb(0xe6f6fb), 230);
  },
  crafting_table_top(t, r) {
    drawPlanks(t, r, 0xb08e58, 0x7a5c35, 0x9c7a46);
    border(t, 0x5e4426);
    const line = rgb(0x7a5b34);
    for (let i = 1; i < 15; i++) { t.set(i, 5, line); t.set(i, 10, line); t.set(5, i, line); t.set(10, i, line); }
  },
  crafting_table_side(t, r) {
    drawPlanks(t, r);
    for (let x = 0; x < S; x++) for (let y = 0; y < 3; y++) t.set(x, y, scale(rgb(0x7a5c35), 1 + (r() - 0.5) * 0.1));
    const gray = rgb(0x9a9a9a), dark = rgb(0x555555), wood = rgb(0x6b4d2b);
    for (let y = 5; y < 13; y++) { t.set(3, y, gray); t.set(4, y, y % 2 ? dark : gray); }
    for (let y = 6; y < 14; y++) t.set(11, y, wood);
    for (let x = 9; x < 14; x++) { t.set(x, 5, dark); t.set(x, 6, gray); }
  },
  crafting_table_front(t, r) {
    drawPlanks(t, r);
    for (let x = 0; x < S; x++) for (let y = 0; y < 3; y++) t.set(x, y, scale(rgb(0x7a5c35), 1 + (r() - 0.5) * 0.1));
    const gray = rgb(0x9a9a9a), wood = rgb(0x6b4d2b);
    for (let i = 0; i < 7; i++) t.set(4 + i, 13 - i, wood);
    for (let x = 4; x < 12; x++) t.set(x, 5 - Math.round(Math.abs(x - 8) * 0.4), gray);
    for (let y = 6; y < 13; y++) t.set(12, y, gray);
  },
  furnace_side(t, r) { noiseFill(t, r, 0x7a7a7a, 0.06); speckle(t, r, 0x6a6a6a, 0.15); border(t, 0x5a5a5a); },
  furnace_top(t, r) { noiseFill(t, r, 0x8a8a8a, 0.05); speckle(t, r, 0x777777, 0.12); border(t, 0x5f5f5f); },
  furnace_front(t, r) {
    DRAW.furnace_side(t, r);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) t.set(x, y, rgb(y === 8 ? 0x111111 : 0x262626));
    for (let x = 4; x < 12; x += 2) { t.set(x, 4, rgb(0x3a3a3a)); t.set(x, 5, rgb(0x3a3a3a)); }
  },
  furnace_front_on(t, r) {
    DRAW.furnace_front(t, r);
    const fire = [rgb(0xff9a1f), rgb(0xffd84a), rgb(0xd8421a), rgb(0xffb52a)];
    for (let y = 10; y < 14; y++) for (let x = 4; x < 12; x++) if (r() < 0.85) t.set(x, y, fire[Math.floor(r() * 4)]);
  },
  torch(t) {
    clear(t);
    const w1 = rgb(0x8a6b3e), w2 = rgb(0x6e532d);
    for (let y = 8; y < 16; y++) { t.set(7, y, w1); t.set(8, y, w2); }
    t.set(7, 7, rgb(0xffb52a)); t.set(8, 7, rgb(0xff9a1f));
    t.set(7, 6, rgb(0xfff2a8)); t.set(8, 6, rgb(0xffd84a));
  },
  tall_grass(t, r) {
    clear(t);
    const cols = [rgb(0x4f9a35), rgb(0x5fae43), rgb(0x3f8028), rgb(0x6cbb4c)];
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(r() * 14);
      const h = 5 + Math.floor(r() * 9);
      const c = cols[Math.floor(r() * cols.length)];
      const lean = r() < 0.5 ? -1 : 1;
      for (let k = 0; k < h; k++) {
        t.set(x, 15 - k, c);
        if (k > 3 && r() < 0.25) x = Math.max(0, Math.min(15, x + lean));
      }
    }
  },
  flower_red(t) {
    clear(t);
    const stem = rgb(0x3f8a2a), red = rgb(0xd8251e), hi = rgb(0xf05048), dark = rgb(0x3a1a0a);
    for (let y = 8; y < 16; y++) t.set(7, y, stem);
    t.set(6, 12, stem); t.set(5, 11, stem); t.set(8, 11, stem); t.set(9, 10, stem);
    for (let y = 4; y < 8; y++) for (let x = 5; x < 10; x++) t.set(x, y, (x + y) % 3 ? red : hi);
    t.set(5, 4, [0, 0, 0], 0); t.set(9, 4, [0, 0, 0], 0);
    t.set(7, 5, dark); t.set(7, 6, dark);
  },
  flower_yellow(t) {
    clear(t);
    const stem = rgb(0x3f8a2a), y1 = rgb(0xffe14a), y2 = rgb(0xf0c020);
    for (let y = 9; y < 16; y++) t.set(7, y, stem);
    t.set(6, 13, stem); t.set(8, 12, stem);
    for (let y = 5; y < 9; y++) for (let x = 6; x < 10; x++) t.set(x, y, (x + y) % 2 ? y1 : y2);
    t.set(7, 4, y1); t.set(8, 4, y2);
  },
  dead_bush(t, r) {
    clear(t);
    const c = rgb(0x8b6a3c), d = rgb(0x6a4f2a);
    for (let b = 0; b < 6; b++) {
      let x = 7 + (r() < 0.5 ? 0 : 1);
      let y = 15;
      const dir = b % 2 ? 1 : -1;
      const len = 5 + Math.floor(r() * 6);
      for (let k = 0; k < len; k++) {
        t.set(x, y, k % 3 ? c : d);
        y--;
        if (r() < 0.5) x += dir;
      }
    }
  },
  bricks(t, r) {
    const mortar = rgb(0xb3a89a), bricks = [rgb(0x9c4a36), rgb(0x8a3e2c), rgb(0xa85a44)];
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / 4);
      for (let x = 0; x < S; x++) {
        const off = row % 2 ? 4 : 0;
        if (y % 4 === 3 || (x + off) % 8 === 7) t.set(x, y, scale(mortar, 1 + (r() - 0.5) * 0.08));
        else {
          const bi = (Math.floor((x + off) / 8) + row * 3) % 3;
          t.set(x, y, scale(bricks[bi], 1 + (r() - 0.5) * 0.12));
        }
      }
    }
  },
  stone_bricks(t, r) {
    noiseFill(t, r, 0x7b7b7b, 0.05);
    const mortar = rgb(0x555555), hl = rgb(0x8f8f8f);
    for (let x = 0; x < S; x++) { t.set(x, 7, mortar); t.set(x, 15, mortar); t.set(x, 0, hl); t.set(x, 8, hl); }
    for (let y = 0; y < 8; y++) { t.set(15, y, mortar); t.set(0, y, hl); }
    for (let y = 8; y < 16; y++) { t.set(7, y, mortar); t.set(8, y, hl); }
  },
  wool(t, r) {
    noiseFill(t, r, 0xe8eaea, 0.03);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x + y * 3) % 7 === 0) t.set(x, y, rgb(0xd2d5d6));
  },
  iron_block(t, r) { noiseFill(t, r, 0xd9d9d9, 0.03); bevel(t, 0xf4f4f4, 0xa5a5a5); speckle(t, r, 0xc4c4c4, 0.1, 0); },
  gold_block(t, r) { noiseFill(t, r, 0xf5d63d, 0.04); bevel(t, 0xfff6a6, 0xc89a1c); speckle(t, r, 0xe8c22e, 0.1, 0); },
  diamond_block(t, r) { noiseFill(t, r, 0x63e6e0, 0.04); bevel(t, 0xd0fffb, 0x2fa8a3); speckle(t, r, 0x4fd2cc, 0.1, 0); },
  clay(t, r) { noiseFill(t, r, 0x9ea4b0, 0.04); speckle(t, r, 0x8d93a0, 0.15); speckle(t, r, 0xb0b6c1, 0.08); },
  bookshelf(t, r) {
    drawPlanks(t, r);
    const books = [0x8a2a20, 0x2a3f8a, 0x2f6a2a, 0x6b4a2a, 0xb89a5a, 0x7a2a6a].map(rgb);
    for (const [y0, y1] of [[2, 7], [9, 14]]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + Math.floor(r() * 2);
        const c = books[Math.floor(r() * books.length)];
        const top = y0 + Math.floor(r() * 2);
        for (let k = 0; k < w && x < 15; k++, x++) for (let y = top; y <= y1; y++) t.set(x, y, scale(c, y === top ? 1.25 : 1));
      }
    }
  },
  pumpkin_side(t, r) {
    noiseFill(t, r, 0xe38a1d, 0.05);
    for (let y = 0; y < S; y++) for (const x of [0, 4, 8, 12]) t.set(x, y, rgb(0xb86a10));
    for (let x = 0; x < S; x++) t.set(x, 0, rgb(0xc77512));
  },
  pumpkin_top(t, r) {
    noiseFill(t, r, 0xd9821a, 0.05);
    for (let i = 0; i < S; i++) { t.set(i, 7, rgb(0xb86a10)); t.set(7, i, rgb(0xb86a10)); }
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, rgb(0x5a4020));
  },
  glowstone(t, r) { voronoi(t, r, 8, [0xf9d48b, 0xffe9b0, 0xe8b860], 0x9c6a2a, 0.12); speckle(t, r, 0xfff6d8, 0.08, 0); },
};
for (let i = 0; i < 10; i++) DRAW['crack_' + i] = (t) => drawCrack(t, i);

// Replace RGB of fully transparent pixels with the average opaque colour to avoid dark mip halos.
function fixTransparentRGB(t) {
  let r = 0, g = 0, b = 0, n = 0;
  const d = t.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) return;
  r /= n; g /= n; b /= n;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
}

export function tileCanvas(tile, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (size === 16) ctx.putImageData(new ImageData(new Uint8ClampedArray(tile.data), 16, 16), 0, 0);
  else {
    const tmp = tileCanvas(tile, 16);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, size, size);
  }
  return c;
}

export function buildBlockTextures() {
  const tiles = TILE_NAMES.map((name) => {
    const t = new Tile();
    const draw = DRAW[name];
    if (draw) draw(t, mulberry32(hashString(name)));
    else noiseFill(t, mulberry32(1), 0xff00ff, 0.2);
    if (!name.startsWith('crack') && name !== 'water') fixTransparentRGB(t);
    return t;
  });
  const n = tiles.length;
  const data = new Uint8Array(S * S * 4 * n);
  for (let i = 0; i < n; i++) {
    const src = tiles[i].data;
    for (let y = 0; y < S; y++) {
      // Array textures are not flipped: row 0 is the bottom of the tile.
      const srcRow = (S - 1 - y) * S * 4;
      data.set(src.subarray(srcRow, srcRow + S * 4), (i * S * S + y * S) * 4);
    }
  }
  const texture = new THREE.DataArrayTexture(data, S, S, n);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const canvases = tiles.map((t) => tileCanvas(t));
  const threeTextures = new Map();
  function canvasTexture(tileIndex) {
    let tex = threeTextures.get(tileIndex);
    if (!tex) {
      tex = new THREE.CanvasTexture(canvases[tileIndex]);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      threeTextures.set(tileIndex, tex);
    }
    return tex;
  }
  function randomColor(tileIndex, r = Math.random) {
    const t = tiles[tileIndex];
    for (let k = 0; k < 12; k++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      const c = t.get(x, y);
      if (c[3] > 100) return c;
    }
    return [128, 128, 128, 255];
  }
  return { texture, tiles, canvases, canvasTexture, randomColor, count: n, T };
}

// ---------- Item & HUD pixel art ----------

// Draw from a text template; chars map to colours via the palette, '.' is transparent.
export function drawTemplate(t, rows, pal) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const c = pal[ch];
      if (c !== undefined) t.set(x, y, rgb(c));
    }
  }
}

export function outline(t, hex = 0x1c1c1c) {
  const c = rgb(hex);
  const add = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (t.alpha(x, y) > 0) continue;
      const n = (x > 0 && t.alpha(x - 1, y)) || (x < S - 1 && t.alpha(x + 1, y)) || (y > 0 && t.alpha(x, y - 1)) || (y < S - 1 && t.alpha(x, y + 1));
      if (n) add.push([x, y]);
    }
  }
  for (const [x, y] of add) t.set(x, y, c);
}

export function line(t, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    t.set(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export function tileToDataURL(t, scaleTo = 16) {
  return tileCanvas(t, scaleTo).toDataURL();
}

export function makeTile() {
  return new Tile();
}

export { mix, scale };
