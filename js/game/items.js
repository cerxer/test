// Item registry: blocks are items with id < 256, other items use ids >= 256.
import { B, BLOCKS, BLOCK_SHAPE, SHAPE } from '../engine/blocks.js';
import { makeTile, drawTemplate, outline, line, rgb } from '../engine/textures.js';

export const I = {
  STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260, APPLE: 261,
  RAW_BEEF: 262, STEAK: 263, RAW_PORKCHOP: 264, COOKED_PORKCHOP: 265, RAW_CHICKEN: 266, COOKED_CHICKEN: 267,
  RAW_MUTTON: 268, COOKED_MUTTON: 269, ROTTEN_FLESH: 270, BONE: 271, STRING: 272, GUNPOWDER: 273,
  FEATHER: 274, LEATHER: 275, ARROW: 276, FLINT: 277, CLAY_BALL: 278, BRICK: 279, BREAD: 280,
  WOODEN_PICKAXE: 300, STONE_PICKAXE: 301, IRON_PICKAXE: 302, DIAMOND_PICKAXE: 303,
  WOODEN_AXE: 304, STONE_AXE: 305, IRON_AXE: 306, DIAMOND_AXE: 307,
  WOODEN_SHOVEL: 308, STONE_SHOVEL: 309, IRON_SHOVEL: 310, DIAMOND_SHOVEL: 311,
  WOODEN_SWORD: 312, STONE_SWORD: 313, IRON_SWORD: 314, DIAMOND_SWORD: 315,
};

const TIERS = [
  { name: 'Wooden', key: 'WOODEN', speed: 2, durability: 59, head: [0x9c7a46, 0x7a5c35, 0xb89a5a] },
  { name: 'Stone', key: 'STONE', speed: 4, durability: 131, head: [0x8a8a8a, 0x5f5f5f, 0xa8a8a8] },
  { name: 'Iron', key: 'IRON', speed: 6, durability: 250, head: [0xd8d8d8, 0x9a9a9a, 0xffffff] },
  { name: 'Diamond', key: 'DIAMOND', speed: 8, durability: 1561, head: [0x4ee6dc, 0x249e98, 0xc0fffa] },
];
const TOOL_TYPES = {
  PICKAXE: { type: 'pickaxe', name: 'Pickaxe', damage: [2, 3, 4, 5] },
  AXE: { type: 'axe', name: 'Axe', damage: [3, 4, 5, 6] },
  SHOVEL: { type: 'shovel', name: 'Shovel', damage: [1.5, 2.5, 3.5, 4.5] },
  SWORD: { type: 'sword', name: 'Sword', damage: [4, 5, 6, 7] },
};

export const ITEMS = new Map();

function add(id, def) {
  ITEMS.set(id, Object.assign({ id, maxStack: 64, isBlock: false }, def));
}

for (const b of BLOCKS) {
  if (!b || !b.item || b.id === B.AIR) continue;
  add(b.id, { name: b.name, isBlock: true, block: b.id });
}

add(I.STICK, { name: 'Stick', fuel: 5 });
add(I.COAL, { name: 'Coal', fuel: 80 });
add(I.IRON_INGOT, { name: 'Iron Ingot' });
add(I.GOLD_INGOT, { name: 'Gold Ingot' });
add(I.DIAMOND, { name: 'Diamond' });
add(I.APPLE, { name: 'Apple', food: { hunger: 4, saturation: 2.4 } });
add(I.RAW_BEEF, { name: 'Raw Beef', food: { hunger: 3, saturation: 1.8 } });
add(I.STEAK, { name: 'Steak', food: { hunger: 8, saturation: 12.8 } });
add(I.RAW_PORKCHOP, { name: 'Raw Porkchop', food: { hunger: 3, saturation: 1.8 } });
add(I.COOKED_PORKCHOP, { name: 'Cooked Porkchop', food: { hunger: 8, saturation: 12.8 } });
add(I.RAW_CHICKEN, { name: 'Raw Chicken', food: { hunger: 2, saturation: 1.2 } });
add(I.COOKED_CHICKEN, { name: 'Cooked Chicken', food: { hunger: 6, saturation: 7.2 } });
add(I.RAW_MUTTON, { name: 'Raw Mutton', food: { hunger: 2, saturation: 1.2 } });
add(I.COOKED_MUTTON, { name: 'Cooked Mutton', food: { hunger: 6, saturation: 9.6 } });
add(I.ROTTEN_FLESH, { name: 'Rotten Flesh', food: { hunger: 4, saturation: 0.8 } });
add(I.BREAD, { name: 'Pumpkin Bread', food: { hunger: 5, saturation: 6 } });
add(I.BONE, { name: 'Bone' });
add(I.STRING, { name: 'String' });
add(I.GUNPOWDER, { name: 'Gunpowder' });
add(I.FEATHER, { name: 'Feather' });
add(I.LEATHER, { name: 'Leather' });
add(I.ARROW, { name: 'Arrow' });
add(I.FLINT, { name: 'Flint' });
add(I.CLAY_BALL, { name: 'Clay Ball' });
add(I.BRICK, { name: 'Brick' });

for (const [tk, tt] of Object.entries(TOOL_TYPES)) {
  TIERS.forEach((tier, ti) => {
    const id = I[tier.key + '_' + tk];
    add(id, {
      name: tier.name + ' ' + tt.name,
      maxStack: 1,
      tool: { type: tt.type, tier: ti, speed: tier.speed, durability: tier.durability, damage: tt.damage[ti] },
      fuel: ti === 0 ? 10 : undefined,
      tierColors: tier.head,
    });
  });
}

ITEMS.get(B.PLANKS).fuel = 15;
ITEMS.get(B.OAK_LOG).fuel = 15;
ITEMS.get(B.BIRCH_LOG).fuel = 15;
ITEMS.get(B.SPRUCE_LOG).fuel = 15;
ITEMS.get(B.CRAFTING_TABLE).fuel = 15;
ITEMS.get(B.BOOKSHELF).fuel = 15;

export function itemDef(id) {
  return ITEMS.get(id);
}

export function maxStack(id) {
  const d = ITEMS.get(id);
  return d ? d.maxStack : 64;
}

export function makeStack(id, count = 1) {
  const d = ITEMS.get(id);
  const s = { id, count };
  if (d && d.tool) s.dur = d.tool.durability;
  return s;
}

// ---------- icons ----------

function toolIcon(type, colors) {
  const t = makeTile();
  const stick = [rgb(0x8a6b3e), rgb(0x6b4f2a)];
  const [base, dark, light] = colors.map(rgb);
  const drawStick = (x0, y0, x1, y1) => {
    let k = 0;
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (let x = x0, y = y0; ; x += dx, y += dy, k++) {
      t.set(x, y, stick[k % 2]);
      if (x === x1) break;
    }
  };
  if (type === 'pickaxe') {
    drawStick(3, 13, 10, 6);
    for (let a = 12; a <= 78; a += 3) {
      const rad = (a * Math.PI) / 180;
      for (const rr of [9, 10]) {
        const x = Math.round(3 + rr * Math.cos(rad)), y = Math.round(13 - rr * Math.sin(rad));
        t.set(x, y, rr === 10 ? dark : base);
      }
    }
    t.set(10, 4, light); t.set(9, 3, light); t.set(11, 5, light);
  } else if (type === 'axe') {
    drawStick(3, 13, 10, 6);
    const pts = [[8, 2], [9, 2], [7, 3], [8, 3], [9, 3], [10, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4],
      [7, 5], [8, 5], [9, 5], [11, 5], [12, 5], [8, 6], [12, 6], [12, 7]];
    for (const [x, y] of pts) t.set(x, y, base);
    for (const [x, y] of [[8, 2], [7, 3], [6, 4], [7, 5]]) t.set(x, y, dark);
    t.set(9, 3, light); t.set(10, 4, light);
  } else if (type === 'shovel') {
    drawStick(3, 13, 9, 7);
    for (let y = 1; y < 9; y++) for (let x = 7; x < 15; x++) {
      const d = Math.abs(x - 11) + Math.abs(y - 4.5);
      if (d < 3.6 && x + y > 10) t.set(x, y, d > 2.6 ? dark : base);
    }
    t.set(11, 3, light); t.set(12, 4, light);
  } else if (type === 'sword') {
    for (let i = 0; i < 9; i++) {
      t.set(5 + i, 10 - i, base);
      t.set(6 + i, 10 - i, light);
      t.set(5 + i, 11 - i, dark);
    }
    t.set(14, 1, light);
    for (let i = 0; i < 5; i++) t.set(2 + i, 8 + i, rgb(0x5a4020));
    t.set(3, 12, stick[0]); t.set(2, 13, stick[1]); t.set(1, 14, stick[0]);
  }
  outline(t, 0x1a1a1a);
  return t;
}

const ITEM_TEMPLATES = {
  [I.STICK]: [['................', '................', '................', '............#.', '...........#', '..........#', '.........#', '........#', '.......#', '......#', '.....#', '....#', '...#', '................'].map((r) => r.padEnd(16, '.')), { '#': 0x8a6b3e }],
  [I.COAL]: [['', '', '', '', '.....aab.', '....aabbba', '...abbcbbba', '...bbbbbcba', '...abcbbbba', '....abbbba', '.....aaba', '', ''], { a: 0x1a1a1a, b: 0x2f2f2f, c: 0x5a5a5a }],
  [I.IRON_INGOT]: [['', '', '', '', '', '......ccc', '....cbbbbc', '..cbbbbbbbc', '.abbbbbbbba', '..aabbbbaa', '....aaaa', '', ''], { a: 0x8a8a8a, b: 0xd8d8d8, c: 0xffffff }],
  [I.GOLD_INGOT]: [['', '', '', '', '', '......ccc', '....cbbbbc', '..cbbbbbbbc', '.abbbbbbbba', '..aabbbbaa', '....aaaa', '', ''], { a: 0xc4901a, b: 0xf5d63d, c: 0xfff6a6 }],
  [I.BRICK]: [['', '', '', '', '', '', '....cbbbbbb', '...cbbbbbbba', '..abbbbbbbba', '..aaaaaaaaa', '', ''], { a: 0x6a2a1a, b: 0xa04a30, c: 0xc86a50 }],
  [I.DIAMOND]: [['', '', '....cccccc', '...cbbbbbbc', '..cbbcbbbbbc', '..bbbbbbbbbb', '...abbbbbba', '....abbbba', '.....abba', '......aa', '', ''], { a: 0x1f8a85, b: 0x4ee6dc, c: 0xc0fffa }],
  [I.APPLE]: [['', '........d', '.......de', '......d.ee', '...rrrdrrr', '..rwrrrrrrr', '..rwrrrrrrr', '..rrrrrrrrr', '..rrrrrrrrr', '..rrrrrrrrr', '...rrrrrrr', '....rr.rr', ''], { r: 0xd8251e, w: 0xff8a7a, d: 0x5a3a1a, e: 0x3f8a2a }],
  [I.RAW_BEEF]: [['', '', '', '....rrrrr', '...rrwrrrr', '..rrrwrrrrr', '..rrrrwwrrr', '..rrrrrrwrr', '...rrrrrrr', '....rrrrr', '', ''], { r: 0xc83a32, w: 0xf0d0d0 }],
  [I.STEAK]: [['', '', '', '....bbbbb', '...bbwbbbb', '..bbbwbbbbb', '..bbbbwwbbb', '..bbbbbbwbb', '...bbbbbbb', '....bbbbb', '', ''], { b: 0x7a4a2a, w: 0xc8a070 }],
  [I.RAW_PORKCHOP]: [['', '', '', '.....ppp', '...pppppp', '..ppwwpppp', '..pppppwpp', '..pppppppp', '...pppppp', '....ppp', '', ''], { p: 0xf0a0a0, w: 0xfff0f0 }],
  [I.COOKED_PORKCHOP]: [['', '', '', '.....ppp', '...pppppp', '..ppwwpppp', '..pppppwpp', '..pppppppp', '...pppppp', '....ppp', '', ''], { p: 0xc8925a, w: 0xf0d8a8 }],
  [I.RAW_CHICKEN]: [['', '', '', '.......ppp', '......ppppp', '.....pppppp', '....ppppppp', '...wpppppp', '..ww.pppp', '.ww', '.w', ''], { p: 0xf2c8b8, w: 0xf8f8f0 }],
  [I.COOKED_CHICKEN]: [['', '', '', '.......ppp', '......ppppp', '.....pppppp', '....ppppppp', '...wpppppp', '..ww.pppp', '.ww', '.w', ''], { p: 0xc8823a, w: 0xf8f8f0 }],
  [I.RAW_MUTTON]: [['', '', '', '....rrrr', '...rrrrrw', '..rrrrrrrw', '..rrrrrrrw', '...rrrrrw', '....rrrw', '', ''], { r: 0xb8343a, w: 0xf0e0d0 }],
  [I.COOKED_MUTTON]: [['', '', '', '....rrrr', '...rrrrrw', '..rrrrrrrw', '..rrrrrrrw', '...rrrrrw', '....rrrw', '', ''], { r: 0x8a4a2a, w: 0xe0c8a0 }],
  [I.ROTTEN_FLESH]: [['', '', '', '....ggrr', '...grrrgg', '..rrggrrrr', '..rgrrrggr', '...rrggrr', '....rrr', '', ''], { r: 0x8a4a2a, g: 0x6a8a3a }],
  [I.BREAD]: [['', '', '', '', '....bbbbbb', '...bwbwbwbb', '..bbbbbbbbbb', '..abbbbbbbba', '...aaaaaaaa', '', ''], { a: 0x8a5a20, b: 0xc8903a, w: 0xe8c070 }],
  [I.BONE]: [['', '', '.........ww', '........wwww', '.........ww', '........w', '.......w', '......w', '.....w', '....w', '..ww', '.wwww', '..ww'], { w: 0xf0f0e0 }],
  [I.STRING]: [['', '', '..........w', '.........w', '........w', '.......w', '......w.', '.......w', '......w', '.....w', '....w', '...w', ''], { w: 0xf8f8f8 }],
  [I.GUNPOWDER]: [['', '', '', '', '', '.......g', '.....ggdg', '....gdgggd', '...ggdggdgg', '..gdgggdggg', '..ggggggggg', ''], { g: 0x5a5a5a, d: 0x2a2a2a }],
  [I.FEATHER]: [['', '...........w', '..........ww', '.........www', '........wwgw', '.......wwgw', '......wwgw', '.....wwgw', '....wwgw', '.....gw', '....g', '...g', '..g'], { w: 0xf8f8f8, g: 0xb0b0b0 }],
  [I.LEATHER]: [['', '', '', '...bbbbbbb', '..bbbbbbbbb', '..bbcbbbcbb', '..bbbbbbbbb', '...bbbbbbb', '...bb...bb', '', ''], { b: 0x8a4a22, c: 0xa86a3a }],
  [I.ARROW]: [['', '..........ggg', '..........gg', '.........s.g', '........s', '.......s', '......s', '.....s', '....s', '.f.s', '.ffs', '..ff', ''], { g: 0xc8c8c8, s: 0x8a6b3e, f: 0xf8f8f8 }],
  [I.FLINT]: [['', '', '', '.....aa', '....abba', '...abbbca', '...abbbba', '..abbbbba', '..abbbbba', '...aaaaa', '', ''], { a: 0x1a1a1a, b: 0x3a3a3a, c: 0x7a7a7a }],
  [I.CLAY_BALL]: [['', '', '', '', '.....aaa', '....abbba', '...abbcbba', '...abbbbba', '....abbba', '.....aaa', '', ''], { a: 0x7a808c, b: 0x9ea4b0, c: 0xc0c6d0 }],
};

// Isometric icon for full blocks drawn from the tile canvases.
function isoBlockIcon(canvases, def) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tiles = def.faceTiles;
  const top = canvases[tileIndexByName(tiles[2])];
  const left = canvases[tileIndexByName(tiles[4])];
  const right = canvases[tileIndexByName(tiles[0])];
  const k = 1 / 16;
  const inset = BLOCK_SHAPE[def.id] === SHAPE.CACTUS ? 2 : 0;
  ctx.setTransform(28 * k, 14 * k, -28 * k, 14 * k, 32, 4);
  ctx.drawImage(top, 0, 0);
  ctx.setTransform(28 * k, 14 * k, 0, 30 * k, 4 + inset, 18);
  ctx.drawImage(left, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.setTransform(28 * k, -14 * k, 0, 30 * k, 32, 32);
  ctx.drawImage(right, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, 16, 16);
  return c;
}

let tileIndexByName = null;

export const ICONS = new Map();       // id -> data URL
export const ICON_CANVAS = new Map(); // id -> canvas (16px for flat items, 64px for blocks)
export const ICON_FLAT = new Set();   // ids drawn as flat pixel art

export function buildItemIcons(textures, T) {
  tileIndexByName = (n) => T[n];
  for (const [id, def] of ITEMS) {
    let canvas;
    if (def.isBlock) {
      const bd = BLOCKS[id];
      const shape = BLOCK_SHAPE[id];
      if (shape === SHAPE.CROSS || shape === SHAPE.TORCH) {
        canvas = textures.canvases[T[bd.faceTiles[0]]];
        ICON_FLAT.add(id);
      } else canvas = isoBlockIcon(textures.canvases, bd);
    } else {
      let t;
      if (def.tool) t = toolIcon(def.tool.type, def.tierColors);
      else if (ITEM_TEMPLATES[id]) {
        t = makeTile();
        const [rows, pal] = ITEM_TEMPLATES[id];
        drawTemplate(t, rows, pal);
        if (id !== I.STRING) outline(t, 0x1a1a1a);
      } else {
        t = makeTile();
        line(t, 2, 2, 13, 13, rgb(0xff00ff));
      }
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.getContext('2d').putImageData(new ImageData(t.data, 16, 16), 0, 0);
      ICON_FLAT.add(id);
    }
    ICON_CANVAS.set(id, canvas);
    ICONS.set(id, canvas.toDataURL());
  }
}

// ---------- HUD icons (hearts, hunger, bubbles) ----------
export function buildHudIcons() {
  const heart = ['.##...##.', '#ww#.#rr#', '#wrr#rrr#', '#rrrrrrr#', '.#rrrrr#.', '..#rrr#..', '...#r#...', '....#....'];
  const food = ['.....##..', '....#ww#.', '...#ww#..', '..##b#...', '.#mmmb#..', '#mmmmm#..', '#mmmm#...', '#mmm#....', '.###.....'];
  const bubble = ['..####..', '.#wwbb#.', '#wbbbbb#', '#bbbbbb#', '#bbbbbb#', '#bbbbbb#', '.#bbbb#.', '..####..'];
  const make = (rows, pal, half) => {
    const c = document.createElement('canvas');
    c.width = 9; c.height = 9;
    const ctx = c.getContext('2d');
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        let ch = row[x];
        if (ch === '.') continue;
        if (half && ch !== '#' && x > 4) ch = 'e';
        const col = pal[ch];
        if (col === undefined) continue;
        ctx.fillStyle = '#' + col.toString(16).padStart(6, '0');
        ctx.fillRect(x, y, 1, 1);
      }
    });
    return c.toDataURL();
  };
  return {
    heartFull: make(heart, { '#': 0x1a0000, w: 0xff9a9a, r: 0xe0151b }),
    heartHalf: make(heart, { '#': 0x1a0000, w: 0xff9a9a, r: 0xe0151b, e: 0x3a0e0e }, true),
    heartEmpty: make(heart, { '#': 0x1a0000, w: 0x3a0e0e, r: 0x3a0e0e }),
    foodFull: make(food, { '#': 0x2a1500, w: 0xf0f0e0, b: 0xd0c8b0, m: 0xb86a2a }),
    foodHalf: make(food, { '#': 0x2a1500, w: 0xf0f0e0, b: 0xd0c8b0, m: 0xb86a2a, e: 0x3a2610 }, true),
    foodEmpty: make(food, { '#': 0x2a1500, w: 0x3a2610, b: 0x3a2610, m: 0x3a2610 }),
    bubble: make(bubble, { '#': 0x1a3a8a, w: 0xffffff, b: 0x6aa8ff }),
  };
}
