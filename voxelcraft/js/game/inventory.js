// Player inventory: 36 slots (0-8 hotbar, 9-35 main storage) of stacks { id, count, dur? }.
import { maxStack, itemDef } from './items.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export function sameItem(a, b) {
  return a && b && a.id === b.id && a.dur === undefined && b.dur === undefined;
}

export function cloneStack(s) {
  return s ? Object.assign({}, s) : null;
}

export class Inventory {
  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
    this.selected = 0;
    this.version = 0;
  }

  changed() {
    this.version++;
  }

  get(i) {
    return this.slots[i];
  }

  set(i, stack) {
    this.slots[i] = stack && stack.count > 0 ? stack : null;
    this.changed();
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  // Adds items; returns the number that did not fit.
  add(id, count, dur) {
    const max = maxStack(id);
    let left = count;
    if (dur === undefined && max > 1) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.dur === undefined && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        const s = { id, count: n };
        const def = itemDef(id);
        if (dur !== undefined) s.dur = dur;
        else if (def && def.tool) s.dur = def.tool.durability;
        this.slots[i] = s;
        left -= n;
      }
    }
    if (left !== count) this.changed();
    return left;
  }

  addStack(stack) {
    return this.add(stack.id, stack.count, stack.dur);
  }

  canFit(id, count) {
    const max = maxStack(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.id === id && s.dur === undefined && max > 1) room += max - s.count;
      if (room >= count) return true;
    }
    return room >= count;
  }

  removeFromSlot(i, n = 1) {
    const s = this.slots[i];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[i] = null;
    this.changed();
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  clear() {
    this.slots.fill(null);
    this.changed();
  }

  serialize() {
    return { slots: this.slots.map(cloneStack), selected: this.selected };
  }

  load(data) {
    this.slots.fill(null);
    if (data && Array.isArray(data.slots)) {
      data.slots.forEach((s, i) => {
        if (s && i < this.slots.length && itemDef(s.id)) this.slots[i] = cloneStack(s);
      });
      this.selected = data.selected || 0;
    }
    this.changed();
  }
}
