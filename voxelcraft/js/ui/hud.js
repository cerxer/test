// In-game HUD: hotbar, hearts, hunger, air bubbles, item names, debug overlay.
import { ICONS, ICON_FLAT, itemDef } from '../game/items.js';
import { MAX_AIR } from '../game/player.js';

export function slotContentHTML(stack) {
  if (!stack) return '';
  const def = itemDef(stack.id);
  if (!def) return '';
  let html = `<div class="icon${ICON_FLAT.has(stack.id) ? ' flat' : ''}" style="background-image:url(${ICONS.get(stack.id)})"></div>`;
  if (stack.count > 1) html += `<span class="count">${stack.count}</span>`;
  if (def.tool && stack.dur !== undefined && stack.dur < def.tool.durability) {
    const f = Math.max(0, stack.dur / def.tool.durability);
    const hue = Math.round(f * 120);
    html += `<div class="dur"><b style="width:${f * 100}%;background:hsl(${hue},100%,45%)"></b></div>`;
  }
  return html;
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.hotbarEl = document.getElementById('hotbar');
    this.heartsEl = document.getElementById('hearts');
    this.hungerEl = document.getElementById('hunger');
    this.bubblesEl = document.getElementById('bubbles');
    this.itemNameEl = document.getElementById('item-name');
    this.debugEl = document.getElementById('debug');
    this.fpsEl = document.getElementById('fps');
    this.flashEl = document.getElementById('damage-flash');
    this.waterEl = document.getElementById('water-overlay');
    this.toastEl = document.getElementById('toast');
    this.clickToPlay = document.getElementById('click-to-play');
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'hb-slot';
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        game.selectSlot(i);
      });
      this.hotbarEl.appendChild(s);
      this.slots.push(s);
    }
    const icons = game.hudIcons;
    const mk = (parent) => {
      const arr = [];
      for (let i = 0; i < 10; i++) { const el = document.createElement('i'); parent.appendChild(el); arr.push(el); }
      return arr;
    };
    this.heartIcons = mk(this.heartsEl);
    this.foodIcons = mk(this.hungerEl);
    this.bubbleIcons = mk(this.bubblesEl);
    this.icons = icons;
    this.lastInvVersion = -1;
    this.lastSelected = -1;
    this.lastHealth = -1;
    this.lastFood = -1;
    this.lastAir = -1;
    this.lastMode = null;
    this.itemNameTimer = 0;
    this.toastTimer = 0;
    this.debugVisible = false;
    this.debugTimer = 0;
    this.frames = 0;
    this.fpsTime = 0;
    this.fps = 0;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  setRow(icons, value, full, half, empty, blinkPrev) {
    for (let i = 0; i < 10; i++) {
      const v = value - i * 2;
      const url = v >= 2 ? full : v === 1 ? half : empty;
      const el = icons[i];
      if (el.dataset.url !== url) {
        el.dataset.url = url;
        el.style.backgroundImage = `url(${url})`;
      }
      if (blinkPrev) { el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); }
    }
  }

  update(dt) {
    const g = this.game, p = g.player, inv = p.inventory;
    if (inv.version !== this.lastInvVersion || inv.selected !== this.lastSelected) {
      for (let i = 0; i < 9; i++) {
        this.slots[i].innerHTML = slotContentHTML(inv.slots[i]);
        this.slots[i].classList.toggle('sel', i === inv.selected);
      }
      const stack = inv.selectedStack;
      const prevSel = this.lastSelected;
      const prevId = this.lastSelectedId;
      this.lastSelectedId = stack ? stack.id : 0;
      if (prevSel !== inv.selected || prevId !== this.lastSelectedId) {
        if (stack) this.showItemName(itemDef(stack.id).name);
      }
      this.lastInvVersion = inv.version;
      this.lastSelected = inv.selected;
    }
    const creative = p.creative;
    if (this.lastMode !== p.mode) {
      this.heartsEl.style.visibility = creative ? 'hidden' : 'visible';
      this.hungerEl.style.visibility = creative ? 'hidden' : 'visible';
      this.lastMode = p.mode;
      this.lastHealth = this.lastFood = -1;
    }
    if (!creative) {
      const h = Math.ceil(p.health);
      if (h !== this.lastHealth) {
        this.setRow(this.heartIcons, h, this.icons.heartFull, this.icons.heartHalf, this.icons.heartEmpty, h < this.lastHealth);
        this.lastHealth = h;
      }
      const f = Math.ceil(p.food);
      if (f !== this.lastFood) {
        this.setRow(this.foodIcons, f, this.icons.foodFull, this.icons.foodHalf, this.icons.foodEmpty, false);
        this.lastFood = f;
      }
    }
    const showAir = !creative && (p.headInWater || p.air < MAX_AIR - 0.01);
    const air = showAir ? Math.ceil((p.air / MAX_AIR) * 10) : -1;
    if (air !== this.lastAir) {
      for (let i = 0; i < 10; i++) {
        const el = this.bubbleIcons[i];
        el.style.backgroundImage = i < air ? `url(${this.icons.bubble})` : 'none';
      }
      this.lastAir = air;
    }

    if (this.itemNameTimer > 0) {
      this.itemNameTimer -= dt;
      if (this.itemNameTimer <= 0) this.itemNameEl.classList.remove('on');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
      this.fpsEl.classList.toggle('hidden', !g.settings.showFps || this.debugVisible);
      this.fpsEl.textContent = this.fps + ' FPS';
    }
    if (this.debugVisible) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.25;
        this.debugEl.innerHTML = g.debugLines(this.fps).map((l) => `<span>${l}</span>`).join('\n');
      }
    }
  }

  showItemName(name) {
    this.itemNameEl.textContent = name;
    this.itemNameEl.classList.add('on');
    this.itemNameTimer = 2;
  }

  toast(msg, time = 2.5) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    this.toastTimer = time;
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('hidden', !this.debugVisible);
  }

  flashDamage() {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }

  setUnderwater(on) {
    this.waterEl.classList.toggle('on', on);
  }

  setClickToPlay(on) {
    this.clickToPlay.classList.toggle('hidden', !on);
  }

  invalidate() {
    this.lastInvVersion = -1;
    this.lastHealth = this.lastFood = this.lastAir = -2;
    this.lastMode = null;
  }
}
