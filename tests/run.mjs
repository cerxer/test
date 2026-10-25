// Headless unit tests for engine + gameplay logic. Run with: node tests/run.mjs
import { TerrainGenerator } from '../js/engine/terrain.js';
import { meshChunk } from '../js/engine/mesher.js';
import { B, BLOCKS, BLOCK_SOLID } from '../js/engine/blocks.js';
import { CHUNK_VOLUME, SEA_LEVEL } from '../js/engine/constants.js';
import { rleEncode, rleDecode } from '../js/engine/storage.js';
import { SimplexNoise } from '../js/engine/noise.js';
import { matchRecipe, SMELTING, fuelValue } from '../js/game/crafting.js';
import { I, ITEMS, maxStack } from '../js/game/items.js';
import { Inventory } from '../js/game/inventory.js';
import { moveBody } from '../js/game/physics.js';
import { Player } from '../js/game/player.js';
import * as THREE from '../lib/three.module.min.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function maxY(b) {
  for (let y = 127; y >= 0; y--) for (let i = 0; i < 256; i++) if (b[(y << 8) | i]) return y;
  return 0;
}

const gen = new TerrainGenerator(12345);
const cache = new Map();
const chunk = (x, z) => {
  const k = x + ',' + z;
  if (!cache.has(k)) cache.set(k, gen.generate(x, z));
  return cache.get(k);
};
function meshAt(cx, cz) {
  const arr = [], mys = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = chunk(cx + dx, cz + dz); arr.push(c.slice()); mys.push(maxY(c)); }
  return meshChunk(arr, mys);
}
function meshHash(secs) {
  let h = 0;
  for (const s of secs) if (s) for (const g of [s.opaque, s.water]) if (g) {
    for (const v of g.pos) h = (h * 31 + Math.round(v * 16)) | 0;
    for (const v of g.data) h = (h * 31 + v) | 0;
  }
  return h;
}

console.log('Noise & terrain');
test('simplex noise is deterministic and bounded', () => {
  const a = new SimplexNoise(7), b = new SimplexNoise(7);
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37, y = i * 0.11, z = i * 0.71;
    const v = a.noise3D(x, y, z);
    assert(v === b.noise3D(x, y, z), 'not deterministic');
    assert(v >= -1.01 && v <= 1.01, 'out of range ' + v);
  }
});
test('chunks are deterministic per seed', () => {
  const a = new TerrainGenerator(99).generate(3, -4), b = new TerrainGenerator(99).generate(3, -4);
  assert(a.length === CHUNK_VOLUME);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error('mismatch at ' + i);
});
test('different seeds give different worlds', () => {
  const a = new TerrainGenerator(1).generate(0, 0), b = new TerrainGenerator(2).generate(0, 0);
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert(diff > 1000, 'too similar');
});
test('bedrock floor and expected materials exist', () => {
  const counts = new Map();
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const c = chunk(cx, cz);
    for (let i = 0; i < 256; i++) assert(c[i] === B.BEDROCK, 'missing bedrock at y=0');
    for (const id of c) counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const id of [B.STONE, B.DIRT, B.COAL_ORE, B.IRON_ORE, B.AIR]) assert(counts.get(id) > 0, BLOCKS[id].name + ' missing');
});
test('caves carve air below the surface', () => {
  let caveAir = 0;
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const c = chunk(cx, cz);
    for (let i = 0; i < 256; i++) {
      const x = cx * 16 + (i & 15), z = cz * 16 + (i >> 4);
      const h = gen.column(x, z).h;
      for (let y = 6; y < h - 6; y++) if (c[i | (y << 8)] === B.AIR) caveAir++;
    }
  }
  assert(caveAir > 50, 'no caves found (' + caveAir + ')');
});
test('spawn point is on land', () => {
  const s = gen.findSpawn();
  assert(s.h > SEA_LEVEL, 'spawn below sea level');
});

console.log('Mesher');
test('meshes are valid (finite positions, indices in range)', () => {
  const secs = meshAt(0, 0);
  let quads = 0;
  for (const s of secs) if (s) for (const g of [s.opaque, s.water]) if (g) {
    const vc = g.pos.length / 3;
    for (const v of g.pos) assert(Number.isFinite(v), 'NaN position');
    for (const i of g.index) assert(i < vc, 'index out of range');
    assert(g.uv.length === vc * 2 && g.data.length === vc * 4, 'attribute size mismatch');
    quads += g.index.length / 6;
  }
  assert(quads > 100, 'suspiciously few quads');
});
test('meshing is independent of previously meshed chunks', () => {
  let tall = null, flat = null;
  for (let i = 0; i < 400 && (!tall || !flat); i++) {
    const cx = (i % 20) * 7 - 70, cz = Math.floor(i / 20) * 7 - 70;
    const m = maxY(chunk(cx, cz));
    if (m > 95 && !tall) tall = [cx, cz];
    if (m < 62 && !flat) flat = [cx, cz];
  }
  assert(tall && flat, 'could not find test chunks');
  const a = meshHash(meshAt(...flat));
  meshAt(...tall);
  assert(a === meshHash(meshAt(...flat)), 'stale data leaked between meshes');
});

console.log('Items, crafting & inventory');
const st = (id) => (id ? { id, count: 1 } : null);
test('basic recipes', () => {
  const P = B.PLANKS, S = I.STICK, C = B.COBBLESTONE;
  assert(matchRecipe([st(B.OAK_LOG), null, null, null], 2).id === P);
  assert(matchRecipe([st(P), null, st(P), null], 2).id === S);
  assert(matchRecipe([P, P, P, P].map(st), 2).id === B.CRAFTING_TABLE);
  assert(matchRecipe([C, C, C, C, 0, C, C, C, C].map(st), 3).id === B.FURNACE);
  assert(matchRecipe([0, I.COAL, 0, 0, S, 0, 0, 0, 0].map(st), 3).count === 4, 'torches');
  for (const [m, pick] of [[P, I.WOODEN_PICKAXE], [C, I.STONE_PICKAXE], [I.IRON_INGOT, I.IRON_PICKAXE]]) {
    assert(matchRecipe([m, m, m, 0, S, 0, 0, S, 0].map(st), 3).id === pick, 'pickaxe');
  }
  assert(matchRecipe([0, C, C, 0, S, C, 0, S, 0].map(st), 3).id === I.STONE_AXE, 'mirrored axe');
  assert(matchRecipe([0, P, 0, 0, P, 0, 0, S, 0].map(st), 3).id === I.WOODEN_SWORD, 'sword');
  assert(matchRecipe([0, P, 0, 0, S, 0, 0, S, 0].map(st), 3).id === I.WOODEN_SHOVEL, 'shovel');
  assert(matchRecipe([P, 0, 0, 0, P, 0, 0, 0, 0].map(st), 3) === null, 'diagonal is not a recipe');
});
test('smelting and fuel', () => {
  assert(SMELTING.get(B.IRON_ORE) === I.IRON_INGOT && SMELTING.get(B.SAND) === B.GLASS);
  assert(fuelValue(I.COAL) === 80 && fuelValue(B.PLANKS) > 0 && fuelValue(B.STONE) === 0);
});
test('every item has a name and sane stack size', () => {
  for (const [id, d] of ITEMS) {
    assert(d.name, 'unnamed item ' + id);
    assert(maxStack(id) === (d.tool ? 1 : 64), 'stack size ' + id);
  }
});
test('inventory stacking, overflow and tools', () => {
  const inv = new Inventory();
  assert(inv.add(B.DIRT, 100) === 0);
  assert(inv.slots[0].count === 64 && inv.slots[1].count === 36);
  assert(inv.add(I.WOODEN_PICKAXE, 1) === 0);
  const pick = inv.slots.find((s) => s && s.id === I.WOODEN_PICKAXE);
  assert(pick.dur === 59, 'tool durability');
  assert(inv.add(B.STONE, 64 * 40) > 0, 'overflow should be returned');
  const copy = new Inventory();
  copy.load(inv.serialize());
  assert(copy.count(B.DIRT) === 100, 'serialize round trip');
});

console.log('Storage');
test('RLE round trip', () => {
  const c = chunk(1, 1);
  const enc = rleEncode(c);
  const dec = rleDecode(enc);
  assert(enc.length < c.length / 4, 'poor compression ' + enc.length);
  for (let i = 0; i < c.length; i++) if (c[i] !== dec[i]) throw new Error('mismatch at ' + i);
});

console.log('Physics & player');
// Flat test world: stone below y=50, a wall at x=5, water pool around x<-20.
const fakeWorld = {
  getBlock(x, y, z) {
    if (y < 50) return x < -20 && y >= 45 ? B.WATER : B.STONE;
    if (x === 5 && y < 53) return B.STONE;
    return B.AIR;
  },
  isRendered: () => true,
};
function fakeGame() {
  return {
    world: fakeWorld,
    settings: { autoJump: false },
    audio: { step() {} },
    hurt: 0,
    died: null,
    onPlayerHurt() { this.hurt++; },
    onPlayerDeath(src) { this.died = src; },
  };
}
const noInput = (over = {}) => Object.assign({ moveVector: () => ({ x: 0, z: 0 }), consumeDoubleJump: () => false, jump: false, sneak: false, sprint: false }, over);
test('bodies land on the ground and do not pass through walls', () => {
  const body = { pos: new THREE.Vector3(0.5, 60, 0.5), vel: new THREE.Vector3(), hw: 0.3, h: 1.8 };
  for (let i = 0; i < 200; i++) { body.vel.y -= 32 / 60; moveBody(fakeWorld, body, 1 / 60); }
  assert(Math.abs(body.pos.y - 50) < 1e-6 && body.onGround, 'did not land at y=50: ' + body.pos.y);
  for (let i = 0; i < 120; i++) { body.vel.x = 5; body.vel.y -= 32 / 60; moveBody(fakeWorld, body, 1 / 60); }
  assert(body.pos.x <= 5 - 0.3 + 1e-6, 'walked through wall: ' + body.pos.x);
});
test('fall damage is applied on landing', () => {
  const g = fakeGame();
  const p = new Player(g);
  g.player = p;
  p.pos.set(0.5, 70, 0.5);
  p.update(1 / 60, noInput());
  for (let i = 0; i < 240 && !p.onGround; i++) p.update(1 / 60, noInput());
  assert(p.onGround && Math.abs(p.pos.y - 50) < 1e-3, 'not on ground');
  assert(p.health === 20 - Math.ceil(20 - 3.2), 'unexpected health ' + p.health);
});
test('jumping clears about 1.25 blocks', () => {
  const g = fakeGame();
  const p = new Player(g);
  p.pos.set(0.5, 50, 0.5);
  p.update(1 / 60, noInput());
  let maxY = 0;
  for (let i = 0; i < 60; i++) { p.update(1 / 60, noInput({ jump: i < 2 })); maxY = Math.max(maxY, p.pos.y); }
  assert(maxY - 50 > 1.1 && maxY - 50 < 1.5, 'jump height ' + (maxY - 50));
});
test('walking speed and sprinting', () => {
  const g = fakeGame();
  const p = new Player(g);
  p.pos.set(0.5, 50, 0.5);
  p.yaw = Math.PI / 2; // facing -X (away from the wall)
  for (let i = 0; i < 120; i++) p.update(1 / 60, noInput({ moveVector: () => ({ x: 0, z: 1 }) }));
  const walk = 0.5 - p.pos.x;
  assert(walk > 7.5 && walk < 9.2, 'walk distance ' + walk);
  const x0 = p.pos.x;
  for (let i = 0; i < 60; i++) p.update(1 / 60, noInput({ moveVector: () => ({ x: 0, z: 1 }), sprint: true }));
  assert(x0 - p.pos.x > 5, 'sprint too slow');
});
test('sneaking stops at ledges', () => {
  const world = { getBlock: (x, y, z) => (y < 50 && x <= 0 ? B.STONE : B.AIR), isRendered: () => true };
  const g = fakeGame();
  g.world = world;
  const p = new Player(g);
  p.pos.set(-0.5, 50, 0.5);
  p.yaw = -Math.PI / 2; // facing +X toward the ledge
  for (let i = 0; i < 180; i++) p.update(1 / 60, noInput({ moveVector: () => ({ x: 0, z: 1 }), sneak: true }));
  // Like Minecraft, the hitbox may overhang the edge but must still rest on the block (x < 1 + half width).
  assert(p.pos.y === 50 && p.pos.x < 1.3, 'fell off ledge while sneaking: ' + p.pos.x + ',' + p.pos.y);
});
test('swimming and drowning', () => {
  const g = fakeGame();
  const p = new Player(g);
  p.pos.set(-30.5, 46, 0.5);
  for (let i = 0; i < 60; i++) p.update(1 / 60, noInput());
  assert(p.inWater && p.headInWater, 'should be submerged');
  for (let i = 0; i < 60 * 20; i++) p.update(1 / 60, noInput());
  assert(p.health < 20, 'should take drowning damage');
  const y0 = p.pos.y;
  for (let i = 0; i < 30; i++) p.update(1 / 60, noInput({ jump: true }));
  assert(p.pos.y > y0, 'swimming up should rise');
});
test('creative mode ignores damage', () => {
  const g = fakeGame();
  const p = new Player(g);
  p.mode = 'creative';
  assert(!p.damage(10, 'test') && p.health === 20);
});
test('hunger drains with exhaustion and food restores it', () => {
  const g = fakeGame();
  const p = new Player(g);
  p.saturation = 0;
  p.exhaustion = 3.999;
  p.updateSurvival(0.5);
  assert(p.food === 19, 'food should drop ' + p.food);
  p.eat(ITEMS.get(I.STEAK).food);
  assert(p.food === 20 && p.saturation > 0);
});
test('all solid blocks are breakable or bedrock', () => {
  for (const d of BLOCKS) {
    if (!d || d.id === B.UNLOADED || !BLOCK_SOLID[d.id]) continue;
    assert(d.hardness >= 0 || d.id === B.BEDROCK, d.name + ' unbreakable');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
