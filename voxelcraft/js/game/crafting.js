// Crafting recipes (shaped + shapeless), smelting recipes and furnace fuel.
import { B } from '../engine/blocks.js';
import { I, itemDef } from './items.js';

const RECIPES = [];

function shaped(pattern, key, id, count = 1) {
  const h = pattern.length, w = Math.max(...pattern.map((r) => r.length));
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = pattern[y][x] || ' ';
    cells.push(ch === ' ' ? 0 : key[ch]);
  }
  RECIPES.push({ type: 'shaped', w, h, cells, result: { id, count } });
}

function shapeless(ingredients, id, count = 1) {
  RECIPES.push({ type: 'shapeless', ingredients: ingredients.slice().sort((a, b) => a - b), result: { id, count } });
}

const P = B.PLANKS, S = I.STICK;
shapeless([B.OAK_LOG], P, 4);
shapeless([B.BIRCH_LOG], P, 4);
shapeless([B.SPRUCE_LOG], P, 4);
shaped(['P', 'P'], { P }, S, 4);
shaped(['PP', 'PP'], { P }, B.CRAFTING_TABLE);
shaped(['CCC', 'C C', 'CCC'], { C: B.COBBLESTONE }, B.FURNACE);
shaped(['c', 'S'], { c: I.COAL, S }, B.TORCH, 4);

const MATERIALS = [
  [P, 'WOODEN'], [B.COBBLESTONE, 'STONE'], [I.IRON_INGOT, 'IRON'], [I.DIAMOND, 'DIAMOND'],
];
for (const [m, tier] of MATERIALS) {
  shaped(['MMM', ' S ', ' S '], { M: m, S }, I[tier + '_PICKAXE']);
  shaped(['MM', 'MS', ' S'], { M: m, S }, I[tier + '_AXE']);
  shaped(['M', 'S', 'S'], { M: m, S }, I[tier + '_SHOVEL']);
  shaped(['M', 'M', 'S'], { M: m, S }, I[tier + '_SWORD']);
}

shaped(['SS', 'SS'], { S: B.SAND }, B.SANDSTONE);
shaped(['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
shaped(['SS', 'SS'], { S: I.STRING }, B.WOOL);
shaped(['BB', 'BB'], { B: I.BRICK }, B.BRICKS);
shaped(['CC', 'CC'], { C: I.CLAY_BALL }, B.CLAY);
shaped(['PPP', 'BBB', 'PPP'], { P, B: I.LEATHER }, B.BOOKSHELF);
shaped(['III', 'III', 'III'], { I: I.IRON_INGOT }, B.IRON_BLOCK);
shaped(['III', 'III', 'III'], { I: I.GOLD_INGOT }, B.GOLD_BLOCK);
shaped(['III', 'III', 'III'], { I: I.DIAMOND }, B.DIAMOND_BLOCK);
shapeless([B.IRON_BLOCK], I.IRON_INGOT, 9);
shapeless([B.GOLD_BLOCK], I.GOLD_INGOT, 9);
shapeless([B.DIAMOND_BLOCK], I.DIAMOND, 9);
shaped(['CV', 'VC'], { C: B.COBBLESTONE, V: B.OAK_LEAVES }, B.MOSSY_COBBLESTONE, 2);
shaped(['GG', 'GG'], { G: I.GUNPOWDER }, B.GLOWSTONE);
shaped(['f', 'S', 'F'], { f: I.FLINT, S, F: I.FEATHER }, I.ARROW, 4);
shapeless([B.PUMPKIN], I.BREAD, 2);

// grid: array of stacks (or null), width w (2 or 3). Returns { id, count } or null.
export function matchRecipe(grid, w) {
  let minX = w, minY = w, maxX = -1, maxY = -1;
  const ids = [];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const s = grid[y * w + x];
      if (!s) continue;
      ids.push(s.id);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!ids.length) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const sorted = ids.slice().sort((a, b) => a - b);
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (r.ingredients.length !== sorted.length) continue;
      if (r.ingredients.every((v, i) => v === sorted[i])) return r.result;
      continue;
    }
    if (r.w !== bw || r.h !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < bh && ok; y++) {
        for (let x = 0; x < bw && ok; x++) {
          const s = grid[(minY + y) * w + minX + x];
          const want = r.cells[y * bw + (mirror ? bw - 1 - x : x)];
          if ((s ? s.id : 0) !== want) ok = false;
        }
      }
      if (ok) return r.result;
    }
  }
  return null;
}

export const SMELTING = new Map([
  [B.IRON_ORE, I.IRON_INGOT],
  [B.GOLD_ORE, I.GOLD_INGOT],
  [B.SAND, B.GLASS],
  [B.COBBLESTONE, B.STONE],
  [B.OAK_LOG, I.COAL],
  [B.BIRCH_LOG, I.COAL],
  [B.SPRUCE_LOG, I.COAL],
  [B.CLAY, B.BRICKS],
  [I.CLAY_BALL, I.BRICK],
  [I.RAW_BEEF, I.STEAK],
  [I.RAW_PORKCHOP, I.COOKED_PORKCHOP],
  [I.RAW_CHICKEN, I.COOKED_CHICKEN],
  [I.RAW_MUTTON, I.COOKED_MUTTON],
  [B.COAL_ORE, I.COAL],
  [B.DIAMOND_ORE, I.DIAMOND],
]);

export function fuelValue(id) {
  const d = itemDef(id);
  return d && d.fuel ? d.fuel : 0;
}

export function recipeCount() {
  return RECIPES.length;
}
