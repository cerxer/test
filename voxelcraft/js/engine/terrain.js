// Deterministic seeded terrain generation: biomes, mountains, rivers, caves, ores, trees.
import { SimplexNoise, mulberry32, hash2, hash3 } from './noise.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_VOLUME, SEA_LEVEL } from './constants.js';
import { B } from './blocks.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4, DESERT: 5,
  MOUNTAINS: 6, TAIGA: 7, SNOWY: 8, RIVER: 9,
};
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Desert', 'Mountains', 'Taiga', 'Snowy Tundra', 'River'];

const TREE_DENSITY = [0, 0, 0.004, 0.05, 0.045, 0.006, 0.01, 0.035, 0.008, 0];
const TREE = { OAK: 0, BIRCH: 1, SPRUCE: 2 };

function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function idx(x, y, z) {
  return x | (z << 4) | (y << 8);
}

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nCont = new SimplexNoise(s ^ 0x1234567);
    this.nHill = new SimplexNoise(s ^ 0x2345678);
    this.nPeak = new SimplexNoise(s ^ 0x3456789);
    this.nMask = new SimplexNoise(s ^ 0x456789a);
    this.nDetail = new SimplexNoise(s ^ 0x56789ab);
    this.nTemp = new SimplexNoise(s ^ 0x6789abc);
    this.nHum = new SimplexNoise(s ^ 0x789abcd);
    this.nRiver = new SimplexNoise(s ^ 0x89abcde);
    this.nCave1 = new SimplexNoise(s ^ 0x9abcdef);
    this.nCave2 = new SimplexNoise(s ^ 0xabcdef1);
    this.nCave3 = new SimplexNoise(s ^ 0xbcdef12);
    this.nMisc = new SimplexNoise(s ^ 0xcdef123);
    this._col = { h: 0, biome: 0, mmask: 0, temp: 0, hum: 0 };
  }

  // Height and biome of a world column. Pure function of (wx, wz) so chunks agree at borders.
  column(wx, wz, out = this._col) {
    const cont = this.nCont.fbm2(wx / 1000, wz / 1000, 4) * 2.2;
    const hill = this.nHill.fbm2(wx / 240, wz / 240, 4) * 2;
    const detail = this.nDetail.fbm2(wx / 45, wz / 45, 3) * 2;
    const mmask = smoothstep(0.1, 0.5, this.nMask.fbm2(wx / 1300 + 31.7, wz / 1300 - 17.3, 3) * 2) * smoothstep(-0.25, 0.1, cont);
    const peak = 1 - Math.abs(this.nPeak.fbm2(wx / 280, wz / 280, 5) * 2);

    let h;
    if (cont < -0.58) h = SEA_LEVEL - 4 + (cont + 0.58) * 40;
    else h = SEA_LEVEL - 4 + (cont + 0.58) * 20;
    h += hill * (4 + 8 * Math.max(0, Math.min(1, cont + 0.3)));
    h += detail * 1.8;
    const pk = Math.max(0, peak);
    h += mmask * (pk * pk * 58 + pk * 6 + 6);

    // Rivers carve winding channels down to below sea level.
    const rv = Math.abs(this.nRiver.fbm2(wx / 650, wz / 650, 3) * 2);
    let river = false;
    if (h > SEA_LEVEL - 4 && rv < 0.075) {
      const t = smoothstep(0.075, 0.02, rv) * (1 - mmask * 0.75);
      const target = SEA_LEVEL - 3 - t * 2;
      h = h + (target - h) * t;
      river = t > 0.45;
    }
    if (h > CHUNK_HEIGHT - 8) h = CHUNK_HEIGHT - 8;
    if (h < 6) h = 6;
    const hi = Math.floor(h);

    const temp = this.nTemp.fbm2(wx / 1400 + 100, wz / 1400 - 100, 3) * 2 - Math.max(0, hi - SEA_LEVEL - 20) * 0.006;
    const hum = this.nHum.fbm2(wx / 1100 - 300, wz / 1100 + 300, 3) * 2;

    let biome;
    if (hi < SEA_LEVEL) biome = river ? BIOME.RIVER : BIOME.OCEAN;
    else if (hi <= SEA_LEVEL + 1 && mmask < 0.3) biome = temp < -0.5 ? BIOME.SNOWY : BIOME.BEACH;
    else if (mmask > 0.45 && hi > SEA_LEVEL + 26) biome = BIOME.MOUNTAINS;
    else if (temp < -0.62) biome = BIOME.SNOWY;
    else if (temp < -0.35) biome = BIOME.TAIGA;
    else if (temp > 0.35 && hum < 0.05) biome = BIOME.DESERT;
    else if (hum > 0.35) biome = temp > 0.1 ? BIOME.FOREST : BIOME.BIRCH_FOREST;
    else if (hum > 0.0) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;

    out.h = hi;
    out.biome = biome;
    out.mmask = mmask;
    out.temp = temp;
    out.hum = hum;
    return out;
  }

  isCave(wx, y, wz, h, sealed, entrance) {
    if (y < 5) return false;
    if (sealed && y > h - 8) return false;
    if (!entrance && y > h - 4) return false;
    const fx = wx * 0.021, fy = y * 0.034, fz = wz * 0.021;
    const a = this.nCave1.noise3D(fx, fy, fz);
    if (a > -0.085 && a < 0.085) {
      const b = this.nCave2.noise3D(fx, fy, fz);
      if (a * a + b * b < 0.0065) return true;
    }
    if (y < 42) {
      const c = this.nCave3.noise3D(wx * 0.013, y * 0.024, wz * 0.013);
      if (c > 0.6 + (y - 18) * 0.004) return true;
    }
    return false;
  }

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const heights = new Int16Array(256);
    const biomes = new Uint8Array(256);
    const seed = this.seed;
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const col = { h: 0, biome: 0, mmask: 0, temp: 0, hum: 0 };

    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        this.column(wx, wz, col);
        const h = col.h, biome = col.biome;
        heights[lx + lz * 16] = h;
        biomes[lx + lz * 16] = biome;

        let top = B.GRASS, filler = B.DIRT, fillerDepth = 3 + (hash2(seed, wx, wz) < 0.5 ? 1 : 0);
        let under = B.STONE, underDepth = 0;
        switch (biome) {
          case BIOME.DESERT:
            top = B.SAND; filler = B.SAND; fillerDepth = 4; under = B.SANDSTONE; underDepth = 3; break;
          case BIOME.BEACH:
            top = B.SAND; filler = B.SAND; fillerDepth = 3; under = B.SANDSTONE; underDepth = 1; break;
          case BIOME.OCEAN:
          case BIOME.RIVER:
            if (h > SEA_LEVEL - 8) {
              const clay = this.nMisc.noise2D(wx / 14, wz / 14) > 0.55;
              top = clay ? B.CLAY : B.SAND; filler = clay ? B.CLAY : B.SAND; fillerDepth = clay ? 2 : 3;
            } else {
              const g = this.nMisc.noise2D(wx / 20 + 50, wz / 20) > 0;
              top = g ? B.GRAVEL : B.DIRT; filler = top; fillerDepth = 2;
            }
            break;
          case BIOME.SNOWY:
            top = B.SNOWY_GRASS; break;
          case BIOME.MOUNTAINS: {
            const n = this.nMisc.noise2D(wx / 16, wz / 16) * 5;
            if (h > 94 + n) { top = B.SNOW; filler = B.STONE; }
            else if (h > 82 + n) { top = B.STONE; filler = B.STONE; }
            break;
          }
          default:
            break;
        }
        if (h > 100 && biome !== BIOME.DESERT) { top = B.SNOW; filler = B.STONE; }

        const entrance = this.nMisc.noise2D(wx / 90 + 400, wz / 90) > 0.35;
        const sealed = h <= SEA_LEVEL + 2;
        const maxY = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= maxY; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < 4 && hash3(seed, wx, y, wz) < (4 - y) * 0.25) id = B.BEDROCK;
          else if (y <= h) {
            const depth = h - y;
            if (depth === 0) id = top;
            else if (depth < fillerDepth) id = filler;
            else if (depth < fillerDepth + underDepth) id = under;
            else id = B.STONE;
            if (this.isCave(wx, y, wz, h, sealed, entrance)) id = B.AIR;
          } else id = B.WATER;
          blocks[idx(lx, y, lz)] = id;
        }
      }
    }

    // Ores and underground blobs.
    const rng = mulberry32((seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
    this.vein(blocks, rng, B.DIRT, 4, 22, 5, 90);
    this.vein(blocks, rng, B.GRAVEL, 3, 20, 5, 70);
    this.vein(blocks, rng, B.COAL_ORE, 18, 10, 5, 110);
    this.vein(blocks, rng, B.IRON_ORE, 12, 7, 5, 64);
    this.vein(blocks, rng, B.GOLD_ORE, 3, 6, 5, 32);
    this.vein(blocks, rng, B.DIAMOND_ORE, rng() < 0.6 ? 2 : 1, 5, 4, 16);

    // Trees (scan a margin so canopies crossing chunk borders are complete).
    for (let dz = -3; dz < 19; dz++) {
      for (let dx = -3; dx < 19; dx++) {
        const wx = x0 + dx, wz = z0 + dz;
        const r = hash2(seed ^ 0x51f15e, wx, wz);
        if (r >= 0.05) continue;
        const inChunk = dx >= 0 && dx < 16 && dz >= 0 && dz < 16;
        let h, biome;
        if (inChunk) { h = heights[dx + dz * 16]; biome = biomes[dx + dz * 16]; }
        else { this.column(wx, wz, col); h = col.h; biome = col.biome; }
        if (r >= TREE_DENSITY[biome] || h <= SEA_LEVEL || h > 100) continue;
        if (biome === BIOME.MOUNTAINS && h > 80) continue;
        if (biome === BIOME.DESERT) {
          if (inChunk) this.placeCactus(blocks, dx, h, dz, wx, wz);
          continue;
        }
        if (inChunk) {
          const g = blocks[idx(dx, h, dz)];
          if (g !== B.GRASS && g !== B.SNOWY_GRASS && g !== B.DIRT) continue;
          if (blocks[idx(dx, h + 1, dz)] !== B.AIR) continue;
          blocks[idx(dx, h, dz)] = B.DIRT;
        } else {
          const entrance = this.nMisc.noise2D(wx / 90 + 400, wz / 90) > 0.35;
          if (this.isCave(wx, h, wz, h, h <= SEA_LEVEL + 2, entrance)) continue;
        }
        let type = TREE.OAK;
        const r2 = hash2(seed ^ 0xabc123, wx, wz);
        if (biome === BIOME.BIRCH_FOREST) type = r2 < 0.8 ? TREE.BIRCH : TREE.OAK;
        else if (biome === BIOME.FOREST) type = r2 < 0.2 ? TREE.BIRCH : TREE.OAK;
        else if (biome === BIOME.TAIGA || biome === BIOME.SNOWY || biome === BIOME.MOUNTAINS) type = TREE.SPRUCE;
        this.placeTree(blocks, dx, h + 1, dz, wx, wz, type, r2);
      }
    }

    // Ground plants.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = heights[lx + lz * 16];
        if (h <= SEA_LEVEL || h >= CHUNK_HEIGHT - 2) continue;
        const biome = biomes[lx + lz * 16];
        const wx = x0 + lx, wz = z0 + lz;
        const ground = blocks[idx(lx, h, lz)];
        const ai = idx(lx, h + 1, lz);
        if (blocks[ai] !== B.AIR) continue;
        const pr = hash2(seed ^ 0x9e3779b9, wx, wz);
        if (ground === B.GRASS) {
          let grassP = 0.06, flowerP = 0.008;
          if (biome === BIOME.PLAINS) { grassP = 0.2; flowerP = 0.025; }
          else if (biome === BIOME.TAIGA) { grassP = 0.05; flowerP = 0.002; }
          if (pr < grassP) blocks[ai] = B.TALL_GRASS;
          else if (pr < grassP + flowerP) blocks[ai] = hash2(seed, wx, wz) < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          else if (biome === BIOME.PLAINS && pr < grassP + flowerP + 0.0015) blocks[ai] = B.PUMPKIN;
        } else if (ground === B.SAND && biome === BIOME.DESERT) {
          if (pr < 0.01) blocks[ai] = B.DEAD_BUSH;
        }
      }
    }

    return blocks;
  }

  vein(blocks, rng, ore, count, size, minY, maxY) {
    for (let c = 0; c < count; c++) {
      let x = rng() * 16, y = minY + rng() * (maxY - minY), z = rng() * 16;
      for (let s = 0; s < size; s++) {
        const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
        if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by > 0 && by < CHUNK_HEIGHT) {
          const i = idx(bx, by, bz);
          if (blocks[i] === B.STONE) blocks[i] = ore;
        }
        x += rng() * 2 - 1;
        y += (rng() * 2 - 1) * 0.7;
        z += rng() * 2 - 1;
      }
    }
  }

  placeCactus(blocks, lx, h, lz, wx, wz) {
    if (blocks[idx(lx, h, lz)] !== B.SAND) return;
    const height = 1 + Math.floor(hash2(this.seed ^ 0x77, wx, wz) * 3);
    for (let i = 1; i <= height; i++) {
      const y = h + i;
      if (y >= CHUNK_HEIGHT || blocks[idx(lx, y, lz)] !== B.AIR) break;
      blocks[idx(lx, y, lz)] = B.CACTUS;
    }
  }

  placeTree(blocks, lx, y, lz, wx, wz, type, r) {
    const seed = this.seed;
    const set = (x, yy, z, id, trunk) => {
      if (x < 0 || x > 15 || z < 0 || z > 15 || yy < 1 || yy >= CHUNK_HEIGHT) return;
      const i = idx(x, yy, z);
      const cur = blocks[i];
      if (cur === B.AIR || cur === B.TALL_GRASS || cur === B.FLOWER_RED || cur === B.FLOWER_YELLOW ||
          (trunk && (cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES))) {
        blocks[i] = id;
      }
    };
    if (type === TREE.SPRUCE) {
      const height = 6 + Math.floor(r * 4);
      for (let i = 0; i < height; i++) set(lx, y + i, lz, B.SPRUCE_LOG, true);
      const radii = [0, 1, 1, 2, 1, 2, 3, 2, 3, 2];
      for (let i = 0; i <= height - 2; i++) {
        const ly = y + height - i;
        const rad = radii[Math.min(i, radii.length - 1)];
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dz * dz > rad * rad + 0.5) continue;
            if (dx === 0 && dz === 0 && i > 0) continue;
            set(lx + dx, ly, lz + dz, B.SPRUCE_LEAVES, false);
          }
        }
      }
      return;
    }
    const log = type === TREE.BIRCH ? B.BIRCH_LOG : B.OAK_LOG;
    const leaves = type === TREE.BIRCH ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const height = (type === TREE.BIRCH ? 5 : 4) + Math.floor(r * 3);
    for (let i = 0; i < height; i++) set(lx, y + i, lz, log, true);
    const topY = y + height;
    for (let ly = topY - 3; ly <= topY; ly++) {
      const rad = ly >= topY - 1 ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx === 0 && dz === 0 && ly < topY) continue;
          if (Math.abs(dx) === rad && Math.abs(dz) === rad) {
            if (ly === topY) continue;
            if (hash3(seed ^ 0x1eaf, wx + dx, ly, wz + dz) < 0.5) continue;
          }
          set(lx + dx, ly, lz + dz, leaves, false);
        }
      }
    }
  }

  findSpawn() {
    const col = { h: 0, biome: 0, mmask: 0, temp: 0, hum: 0 };
    // Prefer open plains near the origin, then any dry land.
    for (let ring = 0; ring < 40; ring++) {
      const r = ring * 16;
      const steps = Math.max(1, ring * 8);
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.column(x, z, col);
        if (col.biome === BIOME.PLAINS && col.h > SEA_LEVEL + 1 && col.h < 80) return { x, z, h: col.h };
      }
    }
    for (let ring = 0; ring < 80; ring++) {
      const r = ring * 12;
      const steps = Math.max(1, ring * 8);
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.column(x, z, col);
        if (col.biome !== BIOME.OCEAN && col.biome !== BIOME.RIVER && col.biome !== BIOME.BEACH &&
            col.h > SEA_LEVEL + 1 && col.h < 88) {
          return { x, z, h: col.h };
        }
      }
    }
    this.column(0, 0, col);
    return { x: 0, z: 0, h: Math.max(col.h, SEA_LEVEL) };
  }
}
