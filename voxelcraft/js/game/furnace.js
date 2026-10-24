// Furnace block entities: smelting with fuel, persisted with the world.
import { B } from '../engine/blocks.js';
import { SMELTING, fuelValue } from './crafting.js';
import { maxStack, makeStack } from './items.js';

export const COOK_TIME = 8;

export class FurnaceManager {
  constructor(game) {
    this.game = game;
    this.map = new Map();
  }

  key(x, y, z) {
    return x + ',' + y + ',' + z;
  }

  get(x, y, z) {
    const k = this.key(x, y, z);
    let f = this.map.get(k);
    if (!f) {
      f = { x, y, z, input: null, fuel: null, output: null, burn: 0, burnTotal: 0, cook: 0, version: 0 };
      this.map.set(k, f);
    }
    return f;
  }

  remove(x, y, z, drop) {
    const k = this.key(x, y, z);
    const f = this.map.get(k);
    if (!f) return;
    this.map.delete(k);
    if (drop) {
      for (const s of [f.input, f.fuel, f.output]) {
        if (s) this.game.entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur);
      }
    }
    if (this.game.invUI) this.game.invUI.closeFurnaceIf(f);
  }

  smeltResult(f) {
    if (!f.input) return undefined;
    const r = SMELTING.get(f.input.id);
    if (r === undefined) return undefined;
    if (f.output && (f.output.id !== r || f.output.count >= maxStack(r))) return undefined;
    return r;
  }

  update(dt) {
    const w = this.game.world;
    for (const f of this.map.values()) {
      const id = w.getBlock(f.x, f.y, f.z);
      if (id === B.UNLOADED) continue;
      if (id !== B.FURNACE && id !== B.FURNACE_LIT) {
        this.map.delete(this.key(f.x, f.y, f.z));
        continue;
      }
      let result = this.smeltResult(f);
      if (f.burn <= 0 && result !== undefined && f.fuel) {
        const fv = fuelValue(f.fuel.id);
        if (fv > 0) {
          f.burn = f.burnTotal = fv;
          f.fuel.count--;
          if (f.fuel.count <= 0) f.fuel = null;
          f.version++;
        }
      }
      if (f.burn > 0) {
        f.burn = Math.max(0, f.burn - dt);
        if (result !== undefined) {
          f.cook += dt;
          if (f.cook >= COOK_TIME) {
            f.cook = 0;
            f.input.count--;
            if (f.input.count <= 0) f.input = null;
            if (f.output) f.output.count++;
            else f.output = makeStack(result, 1);
            f.version++;
          }
        } else f.cook = 0;
      } else f.cook = Math.max(0, f.cook - dt * 2);
      const lit = f.burn > 0;
      const want = lit ? B.FURNACE_LIT : B.FURNACE;
      if (id !== want) w.setBlock(f.x, f.y, f.z, want);
    }
  }

  serialize() {
    return [...this.map.values()].map((f) => ({
      x: f.x, y: f.y, z: f.z, input: f.input, fuel: f.fuel, output: f.output, burn: f.burn, burnTotal: f.burnTotal, cook: f.cook,
    }));
  }

  load(list) {
    this.map.clear();
    if (!Array.isArray(list)) return;
    for (const d of list) {
      const f = this.get(d.x, d.y, d.z);
      Object.assign(f, d, { version: 0 });
    }
  }
}
