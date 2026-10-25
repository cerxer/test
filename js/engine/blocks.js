// Block registry. Shared by the main thread (gameplay) and workers (terrain + meshing).

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'sand', 'gravel', 'water', 'bedrock',
  'oak_log', 'oak_log_top', 'oak_leaves', 'birch_log', 'birch_log_top', 'birch_leaves',
  'spruce_log', 'spruce_log_top', 'spruce_leaves', 'planks',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'snow',
  'cactus_side', 'cactus_top', 'sandstone', 'sandstone_top', 'glass',
  'crafting_table_top', 'crafting_table_side', 'crafting_table_front',
  'furnace_front', 'furnace_front_on', 'furnace_side', 'furnace_top',
  'torch', 'tall_grass', 'flower_red', 'flower_yellow', 'dead_bush',
  'bricks', 'stone_bricks', 'wool', 'iron_block', 'gold_block', 'diamond_block', 'clay',
  'snowy_grass_side', 'mossy_cobblestone', 'bookshelf', 'pumpkin_side', 'pumpkin_top', 'glowstone',
  'crack_0', 'crack_1', 'crack_2', 'crack_3', 'crack_4', 'crack_5', 'crack_6', 'crack_7', 'crack_8', 'crack_9',
];
export const T = {};
TILE_NAMES.forEach((n, i) => { T[n] = i; });

export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, TORCH: 3, CACTUS: 4, LIQUID: 5 };

// Face order everywhere: 0 +X (east), 1 -X (west), 2 +Y (top), 3 -Y (bottom), 4 +Z (south), 5 -Z (north)
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLESTONE: 4, SAND: 5, GRAVEL: 6, WATER: 7, BEDROCK: 8,
  OAK_LOG: 9, OAK_LEAVES: 10, BIRCH_LOG: 11, BIRCH_LEAVES: 12, SPRUCE_LOG: 13, SPRUCE_LEAVES: 14,
  PLANKS: 15, COAL_ORE: 16, IRON_ORE: 17, GOLD_ORE: 18, DIAMOND_ORE: 19, SNOW: 20, CACTUS: 21,
  SANDSTONE: 22, GLASS: 23, CRAFTING_TABLE: 24, FURNACE: 25, FURNACE_LIT: 26,
  TORCH: 27, TORCH_E: 28, TORCH_W: 29, TORCH_S: 30, TORCH_N: 31,
  TALL_GRASS: 32, FLOWER_RED: 33, FLOWER_YELLOW: 34, DEAD_BUSH: 35,
  BRICKS: 36, STONE_BRICKS: 37, WOOL: 38, IRON_BLOCK: 39, GOLD_BLOCK: 40, DIAMOND_BLOCK: 41,
  CLAY: 42, SNOWY_GRASS: 43, MOSSY_COBBLESTONE: 44, BOOKSHELF: 45, PUMPKIN: 46, GLOWSTONE: 47,
  UNLOADED: 255,
};

// Item ids referenced by block drops (defined fully in game/items.js).
export const DROP_ITEM = { COAL: 257, DIAMOND: 260, APPLE: 261, STICK: 256, CLAY_BALL: 278, FLINT: 277 };

const defs = [];
function def(id, d) { defs[id] = Object.assign({ id }, d); }

def(B.AIR, { name: 'Air', shape: 'none', solid: false, opaque: false, item: false, replaceable: true });
def(B.GRASS, { name: 'Grass Block', tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drops: B.DIRT, sound: 'grass' });
def(B.DIRT, { name: 'Dirt', tiles: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'gravel' });
def(B.STONE, { name: 'Stone', tiles: 'stone', hardness: 1.5, tool: 'pickaxe', level: 0, drops: B.COBBLESTONE, sound: 'stone' });
def(B.COBBLESTONE, { name: 'Cobblestone', tiles: 'cobblestone', hardness: 2, tool: 'pickaxe', level: 0, sound: 'stone' });
def(B.SAND, { name: 'Sand', tiles: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', falls: true });
def(B.GRAVEL, { name: 'Gravel', tiles: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel', falls: true,
  drops: (r) => (r() < 0.1 ? [{ id: DROP_ITEM.FLINT, count: 1 }] : [{ id: B.GRAVEL, count: 1 }]) });
def(B.WATER, { name: 'Water', tiles: 'water', shape: 'liquid', solid: false, opaque: false, atten: 1, item: false, replaceable: true, hardness: -1 });
def(B.BEDROCK, { name: 'Bedrock', tiles: 'bedrock', hardness: -1, sound: 'stone' });
def(B.OAK_LOG, { name: 'Oak Log', tiles: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(B.OAK_LEAVES, { name: 'Oak Leaves', tiles: 'oak_leaves', transparent: true, atten: 1, hardness: 0.2, sound: 'grass',
  drops: (r) => (r() < 0.05 ? [{ id: DROP_ITEM.APPLE, count: 1 }] : r() < 0.04 ? [{ id: DROP_ITEM.STICK, count: 1 }] : []) });
def(B.BIRCH_LOG, { name: 'Birch Log', tiles: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(B.BIRCH_LEAVES, { name: 'Birch Leaves', tiles: 'birch_leaves', transparent: true, atten: 1, hardness: 0.2, sound: 'grass',
  drops: (r) => (r() < 0.04 ? [{ id: DROP_ITEM.STICK, count: 1 }] : []) });
def(B.SPRUCE_LOG, { name: 'Spruce Log', tiles: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(B.SPRUCE_LEAVES, { name: 'Spruce Leaves', tiles: 'spruce_leaves', transparent: true, atten: 1, hardness: 0.2, sound: 'grass',
  drops: (r) => (r() < 0.04 ? [{ id: DROP_ITEM.STICK, count: 1 }] : []) });
def(B.PLANKS, { name: 'Oak Planks', tiles: 'planks', hardness: 2, tool: 'axe', sound: 'wood' });
def(B.COAL_ORE, { name: 'Coal Ore', tiles: 'coal_ore', hardness: 3, tool: 'pickaxe', level: 0, sound: 'stone', drops: DROP_ITEM.COAL });
def(B.IRON_ORE, { name: 'Iron Ore', tiles: 'iron_ore', hardness: 3, tool: 'pickaxe', level: 1, sound: 'stone' });
def(B.GOLD_ORE, { name: 'Gold Ore', tiles: 'gold_ore', hardness: 3, tool: 'pickaxe', level: 2, sound: 'stone' });
def(B.DIAMOND_ORE, { name: 'Diamond Ore', tiles: 'diamond_ore', hardness: 3, tool: 'pickaxe', level: 2, sound: 'stone', drops: DROP_ITEM.DIAMOND });
def(B.SNOW, { name: 'Snow Block', tiles: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow' });
def(B.CACTUS, { name: 'Cactus', tiles: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, shape: 'cactus', opaque: false, hardness: 0.4, sound: 'wool', support: 'sand' });
def(B.SANDSTONE, { name: 'Sandstone', tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', level: 0, sound: 'stone' });
def(B.GLASS, { name: 'Glass', tiles: 'glass', transparent: true, cullSelf: true, hardness: 0.3, sound: 'glass', drops: null });
def(B.CRAFTING_TABLE, { name: 'Crafting Table', tiles: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side', front: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'crafting' });
def(B.FURNACE, { name: 'Furnace', tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', level: 0, sound: 'stone', interact: 'furnace' });
def(B.FURNACE_LIT, { name: 'Lit Furnace', tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, hardness: 3.5, tool: 'pickaxe', level: 0, sound: 'stone', interact: 'furnace', light: 13, drops: B.FURNACE, item: false });
const torch = { name: 'Torch', tiles: 'torch', shape: 'torch', solid: false, opaque: false, light: 14, hardness: 0, sound: 'wood', drops: B.TORCH, support: 'torch' };
def(B.TORCH, Object.assign({}, torch, { torchDir: 0 }));
def(B.TORCH_E, Object.assign({}, torch, { torchDir: 1, item: false }));
def(B.TORCH_W, Object.assign({}, torch, { torchDir: 2, item: false }));
def(B.TORCH_S, Object.assign({}, torch, { torchDir: 3, item: false }));
def(B.TORCH_N, Object.assign({}, torch, { torchDir: 4, item: false }));
def(B.TALL_GRASS, { name: 'Grass', tiles: 'tall_grass', shape: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass', replaceable: true, support: 'ground', drops: null });
def(B.FLOWER_RED, { name: 'Poppy', tiles: 'flower_red', shape: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass', support: 'ground' });
def(B.FLOWER_YELLOW, { name: 'Dandelion', tiles: 'flower_yellow', shape: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass', support: 'ground' });
def(B.DEAD_BUSH, { name: 'Dead Bush', tiles: 'dead_bush', shape: 'cross', solid: false, opaque: false, hardness: 0, sound: 'grass', replaceable: true, support: 'sand',
  drops: (r) => (r() < 0.5 ? [{ id: DROP_ITEM.STICK, count: 1 }] : []) });
def(B.BRICKS, { name: 'Bricks', tiles: 'bricks', hardness: 2, tool: 'pickaxe', level: 0, sound: 'stone' });
def(B.STONE_BRICKS, { name: 'Stone Bricks', tiles: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', level: 0, sound: 'stone' });
def(B.WOOL, { name: 'White Wool', tiles: 'wool', hardness: 0.8, sound: 'wool' });
def(B.IRON_BLOCK, { name: 'Block of Iron', tiles: 'iron_block', hardness: 5, tool: 'pickaxe', level: 1, sound: 'stone' });
def(B.GOLD_BLOCK, { name: 'Block of Gold', tiles: 'gold_block', hardness: 3, tool: 'pickaxe', level: 2, sound: 'stone' });
def(B.DIAMOND_BLOCK, { name: 'Block of Diamond', tiles: 'diamond_block', hardness: 5, tool: 'pickaxe', level: 2, sound: 'stone' });
def(B.CLAY, { name: 'Clay', tiles: 'clay', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: () => [{ id: DROP_ITEM.CLAY_BALL, count: 4 }] });
def(B.SNOWY_GRASS, { name: 'Snowy Grass Block', tiles: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, hardness: 0.6, tool: 'shovel', drops: B.DIRT, sound: 'snow', item: false });
def(B.MOSSY_COBBLESTONE, { name: 'Mossy Cobblestone', tiles: 'mossy_cobblestone', hardness: 2, tool: 'pickaxe', level: 0, sound: 'stone' });
def(B.BOOKSHELF, { name: 'Bookshelf', tiles: { top: 'planks', bottom: 'planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood' });
def(B.PUMPKIN, { name: 'Pumpkin', tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood' });
def(B.GLOWSTONE, { name: 'Glowstone', tiles: 'glowstone', hardness: 0.3, sound: 'glass', light: 15 });
def(B.UNLOADED, { name: 'Unloaded', shape: 'none', solid: true, opaque: false, item: false, hardness: -1 });

const SHAPE_BY_NAME = { none: SHAPE.NONE, cube: SHAPE.CUBE, cross: SHAPE.CROSS, torch: SHAPE.TORCH, cactus: SHAPE.CACTUS, liquid: SHAPE.LIQUID };

export const BLOCKS = [];
export const BLOCK_SHAPE = new Uint8Array(256);
export const BLOCK_SOLID = new Uint8Array(256);
export const BLOCK_OPAQUE = new Uint8Array(256);
export const BLOCK_LIGHT = new Uint8Array(256);
export const BLOCK_ATTEN = new Uint8Array(256);
export const BLOCK_CULLSELF = new Uint8Array(256);
export const BLOCK_TORCH_DIR = new Uint8Array(256);
export const BLOCK_TILES = new Uint16Array(256 * 6);
export const BLOCK_REPLACEABLE = new Uint8Array(256);
export const BLOCK_TARGETABLE = new Uint8Array(256);

for (let id = 0; id < 256; id++) {
  const d = defs[id];
  if (!d) continue;
  const shapeName = d.shape || 'cube';
  d.shapeId = SHAPE_BY_NAME[shapeName];
  if (d.solid === undefined) d.solid = shapeName === 'cube' || shapeName === 'cactus';
  if (d.opaque === undefined) d.opaque = shapeName === 'cube' && !d.transparent;
  if (d.hardness === undefined) d.hardness = 1;
  if (d.level === undefined) d.level = -1;
  if (d.item === undefined) d.item = true;
  if (d.drops === undefined) d.drops = id;
  if (!d.sound) d.sound = 'stone';
  BLOCKS[id] = d;
  BLOCK_SHAPE[id] = d.shapeId;
  BLOCK_SOLID[id] = d.solid ? 1 : 0;
  BLOCK_OPAQUE[id] = d.opaque ? 1 : 0;
  BLOCK_LIGHT[id] = d.light || 0;
  BLOCK_ATTEN[id] = d.atten || 0;
  BLOCK_CULLSELF[id] = d.cullSelf ? 1 : 0;
  BLOCK_TORCH_DIR[id] = d.torchDir || 0;
  BLOCK_REPLACEABLE[id] = d.replaceable ? 1 : 0;
  BLOCK_TARGETABLE[id] = id !== B.AIR && id !== B.WATER && id !== B.UNLOADED ? 1 : 0;
  if (d.tiles) {
    let faces;
    if (typeof d.tiles === 'string') faces = [d.tiles, d.tiles, d.tiles, d.tiles, d.tiles, d.tiles];
    else {
      const side = d.tiles.side;
      const front = d.tiles.front || side;
      faces = [side, side, d.tiles.top, d.tiles.bottom, front, front];
    }
    for (let f = 0; f < 6; f++) BLOCK_TILES[id * 6 + f] = T[faces[f]];
    d.faceTiles = faces;
  }
}

export function blockDef(id) {
  return BLOCKS[id];
}

// Collision / selection box for non-cube shapes, in block-local coordinates.
export function shapeBox(id) {
  const shape = BLOCK_SHAPE[id];
  if (shape === SHAPE.CROSS) return [0.15, 0, 0.15, 0.85, 0.8, 0.85];
  if (shape === SHAPE.CACTUS) return [0.0625, 0, 0.0625, 0.9375, 1, 0.9375];
  if (shape === SHAPE.TORCH) {
    switch (BLOCK_TORCH_DIR[id]) {
      case 1: return [0, 0.2, 0.35, 0.3, 0.8, 0.65];
      case 2: return [0.7, 0.2, 0.35, 1, 0.8, 0.65];
      case 3: return [0.35, 0.2, 0, 0.65, 0.8, 0.3];
      case 4: return [0.35, 0.2, 0.7, 0.65, 0.8, 1];
      default: return [0.4, 0, 0.4, 0.6, 0.6, 0.6];
    }
  }
  return [0, 0, 0, 1, 1, 1];
}
