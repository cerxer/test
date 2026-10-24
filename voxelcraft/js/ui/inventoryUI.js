// Inventory / crafting table / furnace / creative screens with click and drag-and-drop item management.
import { itemDef, maxStack, makeStack, ITEMS } from '../game/items.js';
import { matchRecipe, SMELTING, fuelValue } from '../game/crafting.js';
import { COOK_TIME } from '../game/furnace.js';
import { sameItem } from '../game/inventory.js';
import { slotContentHTML } from './hud.js';

const COLS = 'grid-template-columns:repeat(9,var(--slot))';

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('screen-inventory');
    this.panel = document.getElementById('inv-panel');
    this.cursorEl = document.getElementById('cursor-item');
    this.tooltip = document.getElementById('tooltip');
    this.cursor = null;
    this.mode = null;
    this.craft = [];
    this.craftW = 2;
    this.furnace = null;
    this.slotEls = [];
    this.lastClick = { t: 0, key: '' };
    this.drag = null;
    this.creativeTab = 'blocks';
    this.mouse = { x: -100, y: -100 };
    this.lastInvVersion = -1;
    this.lastFurnaceVersion = -1;
    this.refreshTimer = 0;

    document.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.isOpen) {
        this.positionCursor();
        this.updateTooltip(e.target, e.pointerType);
      }
    });
    document.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.screen.addEventListener('pointerdown', (e) => {
      if (e.target === this.screen && this.cursor) {
        this.game.dropStack(this.cursor);
        this.cursor = null;
        this.render();
      }
    });
    this.screen.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen() {
    return this.mode !== null;
  }

  open(mode, opts = {}) {
    this.mode = mode;
    this.craftW = mode === 'crafting' ? 3 : 2;
    this.craft = new Array(this.craftW * this.craftW).fill(null);
    this.furnace = opts.furnace || null;
    this.build();
    this.screen.classList.remove('hidden');
    this.cursorEl.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    for (const s of this.craft) if (s) this.giveBack(s);
    this.craft = [];
    if (this.cursor) { this.giveBack(this.cursor); this.cursor = null; }
    this.mode = null;
    this.furnace = null;
    this.drag = null;
    this.screen.classList.add('hidden');
    this.cursorEl.classList.add('hidden');
    this.tooltip.classList.add('hidden');
  }

  giveBack(stack) {
    const left = this.game.player.inventory.add(stack.id, stack.count, stack.dur);
    if (left > 0) this.game.dropStack(Object.assign({}, stack, { count: left }));
  }

  // ---------- slot model ----------

  getStack(key) {
    const inv = this.game.player.inventory;
    if (key.startsWith('inv:')) return inv.slots[+key.slice(4)];
    if (key.startsWith('craft:')) return this.craft[+key.slice(6)];
    if (key.startsWith('fur:')) return this.furnace ? this.furnace[key.slice(4)] : null;
    if (key === 'out') {
      const r = matchRecipe(this.craft, this.craftW);
      return r ? makeStack(r.id, r.count) : null;
    }
    if (key.startsWith('pal:')) return makeStack(+key.slice(4), 1);
    return null;
  }

  setStack(key, s) {
    if (s && s.count <= 0) s = null;
    if (key.startsWith('inv:')) this.game.player.inventory.set(+key.slice(4), s);
    else if (key.startsWith('craft:')) this.craft[+key.slice(6)] = s;
    else if (key.startsWith('fur:') && this.furnace) {
      this.furnace[key.slice(4)] = s;
      this.furnace.version++;
    }
  }

  accepts(key, stack) {
    if (key === 'fur:fuel') return fuelValue(stack.id) > 0;
    if (key === 'fur:output' || key === 'out' || key.startsWith('pal:')) return false;
    return true;
  }

  touched(key) {
    if (key.startsWith('inv:')) this.game.player.inventory.changed();
    else if (key.startsWith('fur:') && this.furnace) this.furnace.version++;
  }

  // ---------- actions ----------

  handleClick(key, button, shift) {
    if (key === 'out') { this.takeOutput(shift); return; }
    if (key.startsWith('pal:')) { this.clickPalette(+key.slice(4), button, shift); return; }
    if (key === 'trash') { this.cursor = null; this.render(); return; }
    const slot = this.getStack(key);
    if (shift) { if (slot) this.quickMove(key); this.render(); return; }
    if (key === 'fur:output') {
      if (slot) {
        if (!this.cursor) { this.cursor = slot; this.setStack(key, null); }
        else if (sameItem(this.cursor, slot) && this.cursor.count + slot.count <= maxStack(slot.id)) {
          this.cursor.count += slot.count;
          this.setStack(key, null);
        }
      }
      this.render();
      return;
    }
    const c = this.cursor;
    if (button === 2) {
      if (!c && slot) {
        const half = Math.ceil(slot.count / 2);
        this.cursor = Object.assign({}, slot, { count: half });
        slot.count -= half;
        this.setStack(key, slot.count > 0 ? slot : null);
      } else if (c && !slot) {
        if (this.accepts(key, c)) {
          this.setStack(key, Object.assign({}, c, { count: 1 }));
          c.count--;
          if (c.count <= 0) this.cursor = null;
        }
      } else if (c && slot && sameItem(c, slot)) {
        if (slot.count < maxStack(slot.id)) {
          slot.count++;
          c.count--;
          if (c.count <= 0) this.cursor = null;
          this.touched(key);
        }
      } else if (c && slot && this.accepts(key, c)) {
        this.setStack(key, c);
        this.cursor = slot;
      }
    } else if (!c) {
      if (slot) { this.cursor = slot; this.setStack(key, null); }
    } else if (!slot) {
      if (this.accepts(key, c)) { this.setStack(key, c); this.cursor = null; }
    } else if (sameItem(slot, c)) {
      const n = Math.min(c.count, maxStack(slot.id) - slot.count);
      slot.count += n;
      c.count -= n;
      if (c.count <= 0) this.cursor = null;
      this.touched(key);
    } else if (this.accepts(key, c)) {
      this.setStack(key, c);
      this.cursor = slot;
    }
    this.render();
  }

  moveIntoInv(stack, from, to) {
    const inv = this.game.player.inventory;
    const max = maxStack(stack.id);
    let left = stack.count;
    if (stack.dur === undefined && max > 1) {
      for (let i = from; i < to && left > 0; i++) {
        const s = inv.slots[i];
        if (s && s.id === stack.id && s.dur === undefined && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = from; i < to && left > 0; i++) {
      if (!inv.slots[i]) {
        const n = Math.min(left, max);
        inv.slots[i] = Object.assign({}, stack, { count: n });
        left -= n;
      }
    }
    inv.changed();
    return left;
  }

  moveIntoSlot(key, stack) {
    const cur = this.getStack(key);
    const max = maxStack(stack.id);
    if (!cur) { this.setStack(key, Object.assign({}, stack)); return 0; }
    if (sameItem(cur, stack)) {
      const n = Math.min(stack.count, max - cur.count);
      cur.count += n;
      this.touched(key);
      return stack.count - n;
    }
    return stack.count;
  }

  quickMove(key) {
    const s = this.getStack(key);
    if (!s) return;
    if (key.startsWith('inv:')) {
      const i = +key.slice(4);
      const inv = this.game.player.inventory;
      if (this.mode === 'creative') { inv.set(i, null); return; }
      let left = s.count;
      if (this.mode === 'furnace') {
        if (SMELTING.has(s.id)) left = this.moveIntoSlot('fur:input', s);
        else if (fuelValue(s.id) > 0) left = this.moveIntoSlot('fur:fuel', s);
        else left = i < 9 ? this.moveIntoInv(s, 9, 36) : this.moveIntoInv(s, 0, 9);
      } else left = i < 9 ? this.moveIntoInv(s, 9, 36) : this.moveIntoInv(s, 0, 9);
      if (left <= 0) inv.set(i, null);
      else { s.count = left; inv.changed(); }
      return;
    }
    const left = this.game.player.inventory.add(s.id, s.count, s.dur);
    if (left <= 0) this.setStack(key, null);
    else { s.count = left; this.touched(key); }
  }

  consumeGrid() {
    for (let i = 0; i < this.craft.length; i++) {
      const s = this.craft[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) this.craft[i] = null;
    }
  }

  takeOutput(shift) {
    const inv = this.game.player.inventory;
    const res = matchRecipe(this.craft, this.craftW);
    if (!res) return;
    if (shift) {
      for (let guard = 0; guard < 64; guard++) {
        const r = matchRecipe(this.craft, this.craftW);
        if (!r || r.id !== res.id || !inv.canFit(r.id, r.count)) break;
        inv.add(r.id, r.count);
        this.consumeGrid();
      }
    } else {
      const max = maxStack(res.id);
      if (!this.cursor) this.cursor = makeStack(res.id, res.count);
      else if (this.cursor.id === res.id && this.cursor.dur === undefined && this.cursor.count + res.count <= max) this.cursor.count += res.count;
      else return;
      this.consumeGrid();
    }
    this.game.audio.click();
    this.render();
  }

  clickPalette(id, button, shift) {
    const max = maxStack(id);
    if (shift) this.game.player.inventory.add(id, max);
    else if (this.cursor && this.cursor.id === id && this.cursor.dur === undefined) this.cursor.count = Math.min(max, this.cursor.count + (button === 2 ? 1 : max));
    else this.cursor = makeStack(id, button === 2 ? 1 : max);
    this.render();
  }

  onSlotPointerDown(e, key) {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 && e.button !== 2) return;
    const now = performance.now();
    const dbl = e.button === 0 && this.lastClick.key === key && now - this.lastClick.t < 320;
    this.lastClick = { key, t: now };
    if (dbl && this.cursor && !this.getStack(key) && (key.startsWith('inv:') || key.startsWith('craft:') || key.startsWith('fur:'))) {
      this.setStack(key, this.cursor);
      this.cursor = null;
      this.quickMove(key);
      this.lastClick.t = 0;
      this.render();
      return;
    }
    const had = !!this.cursor;
    this.handleClick(key, e.button, e.shiftKey);
    this.drag = { key, pickedUp: (!had || key.startsWith('pal:')) && !!this.cursor, button: e.button };
  }

  onPointerUp(e) {
    if (!this.drag || !this.isOpen) return;
    const d = this.drag;
    this.drag = null;
    if (!d.pickedUp || !this.cursor || d.button !== 0) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = el && el.closest ? el.closest('.slot') : null;
    if (!slot || slot.dataset.key === d.key) return;
    const key = slot.dataset.key;
    if (key === 'out' || key.startsWith('pal:')) return;
    this.lastClick = { key: '', t: 0 };
    this.handleClick(key, 0, false);
  }

  // ---------- rendering ----------

  slot(key, extra = '') {
    return `<div class="slot ${extra}" data-key="${key}"></div>`;
  }

  build() {
    const m = this.mode;
    let h = '<button class="panel-close" data-close="1">✕</button>';
    if (m === 'creative') {
      const items = [...ITEMS.values()].filter((d) => (this.creativeTab === 'blocks' ? d.isBlock : !d.isBlock));
      h += `<div class="creative-tabs"><button data-tab="blocks" class="${this.creativeTab === 'blocks' ? 'on' : ''}">Blocks</button>` +
        `<button data-tab="items" class="${this.creativeTab === 'items' ? 'on' : ''}">Items, Tools &amp; Food</button></div>`;
      h += `<div class="grid palette" style="${COLS}">${items.map((d) => this.slot('pal:' + d.id)).join('')}</div>`;
      h += '<div class="inv-sep"></div><h3>Hotbar <span class="hint">(shift-click palette items to add, drop on ✕ to delete)</span></h3>';
      h += `<div style="display:flex;gap:10px"><div class="grid" style="${COLS}">`;
      for (let i = 0; i < 9; i++) h += this.slot('inv:' + i);
      h += `</div>${this.slot('trash', 'trash')}</div>`;
    } else {
      h += '<div class="inv-top">';
      if (m === 'furnace') {
        h += `<div class="furnace-col">${this.slot('fur:input')}<div class="flame"><div class="fill" id="fur-flame"></div></div>${this.slot('fur:fuel')}</div>`;
        h += '<div class="arrow"><div class="fill" id="fur-arrow"></div></div>';
        h += this.slot('fur:output', 'output');
      } else {
        const w = this.craftW;
        h += `<div><h3>Crafting</h3><div class="grid" style="grid-template-columns:repeat(${w},var(--slot))">`;
        for (let i = 0; i < w * w; i++) h += this.slot('craft:' + i);
        h += '</div></div><div class="arrow"></div>' + this.slot('out', 'output');
      }
      h += '</div><h3>Inventory</h3>';
      h += `<div class="grid" style="${COLS}">`;
      for (let i = 9; i < 36; i++) h += this.slot('inv:' + i);
      h += `</div><div class="inv-sep"></div><div class="grid" style="${COLS}">`;
      for (let i = 0; i < 9; i++) h += this.slot('inv:' + i);
      h += '</div>';
    }
    this.panel.innerHTML = h;
    this.slotEls = [...this.panel.querySelectorAll('.slot')];
    for (const el of this.slotEls) {
      el.addEventListener('pointerdown', (e) => this.onSlotPointerDown(e, el.dataset.key));
    }
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.game.closeInventory());
    for (const b of this.panel.querySelectorAll('[data-tab]')) {
      b.addEventListener('click', () => {
        this.creativeTab = b.dataset.tab;
        this.build();
        this.render();
      });
    }
    this.flameEl = this.panel.querySelector('#fur-flame');
    this.arrowEl = this.panel.querySelector('#fur-arrow');
  }

  render() {
    if (!this.isOpen) return;
    for (const el of this.slotEls) {
      const key = el.dataset.key;
      if (key === 'trash') continue;
      const html = slotContentHTML(this.getStack(key));
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
    }
    this.renderFurnace();
    this.cursorEl.innerHTML = slotContentHTML(this.cursor);
    this.positionCursor();
    this.lastInvVersion = this.game.player.inventory.version;
    if (this.furnace) this.lastFurnaceVersion = this.furnace.version;
  }

  renderFurnace() {
    if (!this.furnace || !this.flameEl) return;
    const f = this.furnace;
    this.flameEl.style.height = (f.burnTotal ? (f.burn / f.burnTotal) * 100 : 0) + '%';
    this.arrowEl.style.width = Math.min(1, f.cook / COOK_TIME) * 22 + 'px';
  }

  positionCursor() {
    this.cursorEl.style.left = this.mouse.x + 'px';
    this.cursorEl.style.top = this.mouse.y + 'px';
  }

  updateTooltip(target, pointerType) {
    const slot = target && target.closest ? target.closest('.slot') : null;
    if (!slot || this.cursor || pointerType === 'touch') { this.tooltip.classList.add('hidden'); return; }
    const s = this.getStack(slot.dataset.key);
    if (!s) { this.tooltip.classList.add('hidden'); return; }
    const def = itemDef(s.id);
    let extra = '';
    if (def.tool) extra = `<small>Durability: ${s.dur ?? def.tool.durability} / ${def.tool.durability} · Damage ${def.tool.damage}</small>`;
    else if (def.food) extra = `<small>Restores ${def.food.hunger / 2} hunger</small>`;
    this.tooltip.innerHTML = def.name + extra;
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = this.mouse.x + 14 + 'px';
    this.tooltip.style.top = this.mouse.y - 30 + 'px';
  }

  update(dt) {
    if (!this.isOpen) return;
    this.refreshTimer -= dt;
    const invChanged = this.game.player.inventory.version !== this.lastInvVersion;
    const furChanged = this.furnace && this.furnace.version !== this.lastFurnaceVersion;
    if (invChanged || furChanged) this.render();
    else if (this.furnace && this.refreshTimer <= 0) {
      this.refreshTimer = 0.1;
      this.renderFurnace();
    }
  }

  closeFurnaceIf(f) {
    if (this.furnace === f) this.game.closeInventory();
  }
}
