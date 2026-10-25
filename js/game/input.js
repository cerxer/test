// Keyboard / mouse / pointer-lock input, merged with on-screen touch controls.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.left = false;
    this.right = false;
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
    this.locked = false;
    this.active = false; // gameplay input is being captured
    this.onKey = null; // (code, event) => void, for UI shortcuts
    this.onLockChange = null;
    this.lastSpace = 0;
    this.doubleJump = false;
    this.lastW = 0;
    this.sprintLatch = false;
    this.touch = {
      enabled: false,
      moveX: 0, moveY: 0,
      lookDX: 0, lookDY: 0,
      jump: false, sneak: false, sprint: false,
      attack: false, use: false,
      attackPressed: false, usePressed: false,
    };

    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.left = false;
      if (e.button === 2) this.right = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      if (this.onLockChange) this.onLockChange(false, true);
    });
  }

  handleKeyDown(e) {
    const code = e.code;
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (typing) return;
    if (this.active && ['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F3', 'ControlLeft', 'ControlRight'].includes(code)) e.preventDefault();
    if (this.active && (e.ctrlKey || e.metaKey) && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(code)) e.preventDefault();
    if (!e.repeat) {
      if (code === 'Space' && this.active) {
        const now = performance.now();
        if (now - this.lastSpace < 300) { this.doubleJump = true; this.lastSpace = 0; } else this.lastSpace = now;
      }
      if (code === 'KeyW' && this.active) {
        const now = performance.now();
        if (now - this.lastW < 280) this.sprintLatch = true;
        this.lastW = now;
      }
    }
    this.keys.add(code);
    if (this.onKey) this.onKey(code, e);
  }

  handleMouseDown(e) {
    if (!this.active || !this.locked) return;
    if (e.button === 0) { this.left = true; this.leftPressed = true; }
    if (e.button === 2) { this.right = true; this.rightPressed = true; }
    if (e.button === 1) { this.middlePressed = true; e.preventDefault(); }
  }

  releaseAll() {
    this.keys.clear();
    this.left = this.right = false;
    this.sprintLatch = false;
  }

  requestLock() {
    if (this.touch.enabled) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => { if (this.onLockChange) this.onLockChange(false, true); });
    } catch (e) {
      if (this.onLockChange) this.onLockChange(false, true);
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(code) {
    return this.keys.has(code);
  }

  moveVector() {
    let x = 0, z = 0;
    if (this.key('KeyW') || this.key('ArrowUp')) z += 1;
    if (this.key('KeyS') || this.key('ArrowDown')) z -= 1;
    if (this.key('KeyD') || this.key('ArrowRight')) x += 1;
    if (this.key('KeyA') || this.key('ArrowLeft')) x -= 1;
    if (this.touch.enabled) { x += this.touch.moveX; z += this.touch.moveY; }
    if (z <= 0) this.sprintLatch = false;
    return { x, z };
  }

  get jump() {
    return this.key('Space') || this.touch.jump;
  }
  get sneak() {
    return this.key('ControlLeft') || this.key('ControlRight') || this.key('KeyC') || this.touch.sneak;
  }
  get sprint() {
    return this.key('ShiftLeft') || this.key('ShiftRight') || this.sprintLatch || this.touch.sprint;
  }
  get attackHeld() {
    return this.left || this.touch.attack;
  }
  get useHeld() {
    return this.right || this.touch.use;
  }
  get attackPressed() {
    return this.leftPressed || this.touch.attackPressed;
  }
  get usePressed() {
    return this.rightPressed || this.touch.usePressed;
  }

  consumeDoubleJump() {
    const d = this.doubleJump;
    this.doubleJump = false;
    return d;
  }

  consumeLook() {
    const r = { dx: this.mouseDX, dy: this.mouseDY, tdx: this.touch.lookDX, tdy: this.touch.lookDY };
    this.mouseDX = this.mouseDY = 0;
    this.touch.lookDX = this.touch.lookDY = 0;
    return r;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.leftPressed = this.rightPressed = false;
    this.middlePressed = false;
    this.touch.attackPressed = this.touch.usePressed = false;
  }
}
