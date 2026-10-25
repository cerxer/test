// On-screen touch controls: joystick, look-drag, tap-to-use / hold-to-break, action buttons.

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.root = document.getElementById('touch-ui');
    this.look = document.getElementById('touch-look');
    this.joy = document.getElementById('joystick');
    this.knob = document.getElementById('joystick-knob');
    this.flyBtn = document.getElementById('t-fly');
    this.enabled = false;
    this.joyId = null;
    this.lookTouches = new Map();
    this.sneakToggled = false;
    this.lastJump = 0;

    this.joy.addEventListener('pointerdown', (e) => this.joyStart(e));
    this.joy.addEventListener('pointermove', (e) => this.joyMove(e));
    this.joy.addEventListener('pointerup', (e) => this.joyEnd(e));
    this.joy.addEventListener('pointercancel', (e) => this.joyEnd(e));

    this.look.addEventListener('pointerdown', (e) => this.lookStart(e));
    this.look.addEventListener('pointermove', (e) => this.lookMove(e));
    this.look.addEventListener('pointerup', (e) => this.lookEnd(e));
    this.look.addEventListener('pointercancel', (e) => this.lookEnd(e, true));

    const t = this.input.touch;
    this.holdButton('t-jump', (on) => {
      t.jump = on;
      if (on) {
        const now = performance.now();
        if (now - this.lastJump < 320) this.input.doubleJump = true;
        this.lastJump = now;
      }
    });
    this.holdButton('t-break', (on) => { t.attack = on; if (on) t.attackPressed = true; });
    this.holdButton('t-place', (on) => { t.use = on; if (on) t.usePressed = true; });
    this.holdButton('t-sneak', (on, el) => {
      if (this.game.player.flying) { t.sneak = on; el.classList.toggle('active', on); return; }
      if (on) {
        this.sneakToggled = !this.sneakToggled;
        t.sneak = this.sneakToggled;
      }
      el.classList.toggle('active', this.sneakToggled);
    }, true);
    this.tapButton('t-inv', () => game.toggleInventory());
    this.tapButton('t-pause', () => game.pause());
    this.tapButton('t-drop', () => game.dropSelected(false));
    this.tapButton('t-fly', () => {
      const p = game.player;
      if (p.creative) { p.flying = !p.flying; p.vel.y = 0; }
    });
  }

  holdButton(id, fn, manualActive = false) {
    const el = document.getElementById(id);
    const ids = new Set();
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      if (!manualActive) el.classList.add('active');
      this.game.audio.ensure();
      fn(true, el);
    });
    const end = (e) => {
      if (!ids.has(e.pointerId)) return;
      ids.delete(e.pointerId);
      if (!manualActive) el.classList.remove('active');
      fn(false, el);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  tapButton(id, fn) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.game.audio.ensure();
      fn();
    });
  }

  setEnabled(on) {
    this.enabled = on;
    this.input.touch.enabled = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  setVisible(on) {
    this.root.classList.toggle('hidden', !(on && this.enabled));
    if (!on) this.reset();
  }

  reset() {
    const t = this.input.touch;
    t.moveX = t.moveY = 0;
    t.jump = t.attack = t.use = false;
    if (!this.sneakToggled) t.sneak = false;
    t.sprint = false;
    this.joyId = null;
    this.lookTouches.clear();
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  update() {
    this.flyBtn.classList.toggle('hidden', !this.game.player.creative);
    if (!this.game.player.flying && !this.sneakToggled) this.input.touch.sneak = false;
  }

  joyStart(e) {
    e.preventDefault();
    this.joyId = e.pointerId;
    this.joy.setPointerCapture(e.pointerId);
    this.game.audio.ensure();
    this.joyMove(e);
  }

  joyMove(e) {
    if (e.pointerId !== this.joyId) return;
    const r = this.joy.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const rad = r.width / 2;
    let dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const t = this.input.touch;
    const dead = 0.12;
    t.moveX = Math.abs(dx) > dead ? dx : 0;
    t.moveY = Math.abs(dy) > dead ? -dy : 0;
    t.sprint = len > 0.97 && -dy > 0.6;
    this.knob.style.transform = `translate(calc(-50% + ${dx * rad * 0.6}px), calc(-50% + ${dy * rad * 0.6}px))`;
  }

  joyEnd(e) {
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    const t = this.input.touch;
    t.moveX = t.moveY = 0;
    t.sprint = false;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  lookStart(e) {
    e.preventDefault();
    this.look.setPointerCapture(e.pointerId);
    this.game.audio.ensure();
    const info = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, holding: false };
    info.timer = setTimeout(() => {
      if (!info.moved && this.lookTouches.get(e.pointerId) === info) {
        info.holding = true;
        this.input.touch.attack = true;
        this.input.touch.attackPressed = true;
      }
    }, 330);
    this.lookTouches.set(e.pointerId, info);
  }

  lookMove(e) {
    const info = this.lookTouches.get(e.pointerId);
    if (!info) return;
    const dx = e.clientX - info.x, dy = e.clientY - info.y;
    info.x = e.clientX;
    info.y = e.clientY;
    if (Math.hypot(e.clientX - info.sx, e.clientY - info.sy) > 12) info.moved = true;
    this.input.touch.lookDX += dx;
    this.input.touch.lookDY += dy;
  }

  lookEnd(e, cancel = false) {
    const info = this.lookTouches.get(e.pointerId);
    if (!info) return;
    clearTimeout(info.timer);
    this.lookTouches.delete(e.pointerId);
    if (info.holding) {
      let anyHolding = false;
      for (const o of this.lookTouches.values()) if (o.holding) anyHolding = true;
      if (!anyHolding) this.input.touch.attack = false;
    } else if (!cancel && !info.moved && performance.now() - info.t < 330) {
      this.input.touch.tap = true;
    }
  }
}
