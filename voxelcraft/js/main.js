// VoxelCraft entry point: renderer, game state machine and main loop.
import './engine/three-setup.js';
import * as THREE from '../lib/three.module.min.js';
import { buildBlockTextures } from './engine/textures.js';
import { createChunkMaterials } from './engine/material.js';
import { World } from './engine/world.js';
import { Storage } from './engine/storage.js';
import { B, BLOCKS, T } from './engine/blocks.js';
import { BIOME_NAMES } from './engine/terrain.js';
import { hashString } from './engine/noise.js';
import { buildItemIcons, buildHudIcons, itemDef, maxStack } from './game/items.js';
import { Player } from './game/player.js';
import { Input } from './game/input.js';
import { Interaction } from './game/interaction.js';
import { EntityManager } from './game/entities.js';
import { Particles } from './game/particles.js';
import { Sky } from './game/sky.js';
import { Hand } from './game/hand.js';
import { GameAudio } from './game/audio.js';
import { FurnaceManager } from './game/furnace.js';
import { HUD } from './ui/hud.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { TouchControls } from './ui/touch.js';
import { Screens } from './ui/screens.js';
import { loadSettings, detectTouch } from './settings.js';

const NULL_INPUT = {
  moveVector: () => ({ x: 0, z: 0 }),
  consumeDoubleJump: () => false,
  jump: false, sneak: false, sprint: false,
  attackHeld: false, useHeld: false, attackPressed: false, usePressed: false,
};

const DEATH_MESSAGES = {
  fall: 'You hit the ground too hard',
  drown: 'You drowned',
  zombie: 'You were slain by a Zombie',
  skeleton: 'You were shot by a Skeleton',
  arrow: 'You were shot by a Skeleton',
  spider: 'You were slain by a Spider',
  explosion: 'You were blown up by a Creeper',
  cactus: 'You were pricked to death',
  starve: 'You starved to death',
  void: 'You fell out of the world',
};

const PICK_MAP = { [B.TORCH_E]: B.TORCH, [B.TORCH_W]: B.TORCH, [B.TORCH_S]: B.TORCH, [B.TORCH_N]: B.TORCH, [B.FURNACE_LIT]: B.FURNACE, [B.SNOWY_GRASS]: B.GRASS };
const FACING = ['South (+Z)', 'East (+X)', 'North (-Z)', 'West (-X)'];

class Game {
  constructor() {
    this.settings = loadSettings();
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc4dcff, 60, 100);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.textures = buildBlockTextures();
    buildItemIcons(this.textures, T);
    this.hudIcons = buildHudIcons();
    this.materials = createChunkMaterials(this.textures.texture);
    this.audio = new GameAudio();
    this.input = new Input(this.canvas);
    this.storage = new Storage();
    this.player = new Player(this);
    this.entities = new EntityManager(this);
    this.particles = new Particles(this);
    this.sky = new Sky(this);
    this.hand = new Hand(this);
    this.furnaces = new FurnaceManager(this);
    this.interaction = new Interaction(this);
    this.hud = new HUD(this);
    this.invUI = new InventoryUI(this);
    this.touch = new TouchControls(this);
    this.ui = new Screens(this);

    this.world = null;
    this.worldMeta = null;
    this.state = 'menu';
    this.overlay = null;
    this.time = 0.05;
    this.elapsed = 0;
    this.saveTimer = 30;
    this.shake = 0;
    this.fovCurrent = this.settings.fov;
    this.expectUnlock = false;
    this.cameraUnderwater = false;
    this.isTouch = false;
    this.errorCount = 0;
    this.saving = null;
    this._waterFog = new THREE.Color();
    this._tmp = new THREE.Vector3();

    this.input.onKey = (code, e) => this.onKey(code, e);
    this.input.onLockChange = (locked, error) => this.onLockChange(locked, error);
    this.canvas.addEventListener('click', () => {
      if (this.state === 'game' && !this.overlay && !this.input.locked && !this.isTouch) this.input.requestLock();
    });
    document.getElementById('click-to-play').addEventListener('click', () => {
      this.audio.ensure();
      this.input.requestLock();
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'game') {
        this.saveGame();
        if (!this.overlay) this.pause();
      }
    });
    window.addEventListener('pagehide', () => this.saveGame());
    document.addEventListener('pointerdown', () => this.audio.ensure(), { capture: true });
    this.applySettings();
    this.lastFrame = performance.now();
    this.loop = this.loop.bind(this);
  }

  // ---------- settings / layout ----------

  applySettings() {
    const s = this.settings;
    this.isTouch = s.touchControls === 'on' || (s.touchControls === 'auto' && detectTouch());
    this.touch.setEnabled(this.isTouch && this.state === 'game');
    this.audio.setVolume(s.volume);
    if (this.world) this.world.renderDistance = s.renderDistance;
    this.materials.uniforms.uMinLight.value = 0.02 + s.brightness * 0.14;
    document.body.classList.toggle('touch', this.isTouch);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const s = this.settings;
    const pr = s.pixelRatio === 'auto' ? Math.min(devicePixelRatio || 1, this.isTouch ? 1.5 : 2) : s.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hand.resize(w / h, 70);
    this.ui.updateRotateHint();
  }

  // ---------- world lifecycle ----------

  async createWorld({ name, seedText, mode }) {
    const st = (seedText || '').trim();
    let seed;
    if (!st) seed = Math.floor(Math.random() * 2147483647);
    else if (/^-?\d+$/.test(st)) seed = Number(BigInt.asUintN(32, BigInt(st)));
    else seed = hashString(st);
    const meta = {
      id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name, seed, seedText: st || String(seed), mode,
      created: Date.now(), lastPlayed: Date.now(), time: 0.03, player: null, furnaces: [],
    };
    await this.storage.saveWorld(meta);
    await this.startWorld(meta);
  }

  async loadWorld(id) {
    const meta = await this.storage.getWorld(id);
    if (meta) await this.startWorld(meta);
  }

  async startWorld(meta) {
    this.ui.showLoading('Loading World', meta.name);
    this.disposeWorld();
    const savedKeys = await this.storage.getChunkKeys(meta.id);
    this.worldMeta = meta;
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.world = new World({
      scene: this.scene, seed: meta.seed, worldId: meta.id, storage: this.storage,
      materials: this.materials, savedKeys, workerCount: workers,
    });
    this.world.renderDistance = this.settings.renderDistance;
    this.world.onChunkLoaded = (c, fresh) => {
      if (fresh && this.state === 'game' && this.settings.mobs) this.entities.onChunkGenerated(c);
    };
    this.player = new Player(this);
    this.player.mode = meta.mode || 'survival';
    this.entities.clear();
    this.particles.clear();
    this.interaction.reset();
    this.furnaces.load(meta.furnaces);
    if (meta.player) {
      this.player.load(meta.player);
      this.spawnPending = false;
    } else {
      const s = this.world.generator.findSpawn();
      this.player.pos.set(s.x + 0.5, s.h + 1, s.z + 0.5);
      this.player.spawn.copy(this.player.pos);
      this.spawnPending = true;
      if (this.player.creative) this.giveCreativeKit();
    }
    this.time = meta.time ?? 0.03;
    this.state = 'loading';
    this.overlay = null;
    this.loadStart = performance.now();
    this.hud.invalidate();
  }

  giveCreativeKit() {
    const kit = [B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.PLANKS, B.OAK_LOG, B.GLASS, B.BRICKS, B.TORCH];
    kit.forEach((id, i) => this.player.inventory.set(i, { id, count: maxStack(id) }));
  }

  updateLoading(dt) {
    const p = this.player;
    this.world.update(p.pos.x, p.pos.z, dt);
    const r = Math.min(this.settings.renderDistance, 3);
    const prog = this.world.loadProgress(p.pos.x, p.pos.z, r);
    const st = this.world.stats;
    this.ui.setLoadingProgress(prog, `Generated ${st.generated} chunks · built ${st.meshed} meshes`);
    this.updateCamera(dt);
    this.sky.update(dt, this.time, this.camera);
    this.updateUniforms();
    const waited = performance.now() - this.loadStart;
    if (prog >= 1 || (waited > 30000 && this.world.isRendered(Math.floor(p.pos.x), Math.floor(p.pos.z)))) this.enterGame();
  }

  enterGame() {
    if (this.spawnPending) this.findSafeSpawn();
    else this.ensurePlayerSafe();
    this.spawnPending = false;
    this.state = 'game';
    this.overlay = null;
    this.ui.hideAll();
    this.hud.show(true);
    this.hud.invalidate();
    this.touch.setEnabled(this.isTouch);
    this.ui.updateRotateHint();
    if (this.settings.mobs) for (let i = 0; i < 8; i++) this.entities.trySpawnPassive();
    if (this.player.dead) {
      this.overlay = 'dead';
      this.ui.showDeath('You died');
      this.touch.setVisible(false);
    } else if (!this.isTouch) this.hud.setClickToPlay(true);
    this.hud.toast(this.worldMeta.name, 2);
    this.saveGame();
  }

  findSafeSpawn() {
    const w = this.world, p = this.player;
    const bx = Math.floor(p.pos.x), bz = Math.floor(p.pos.z);
    for (let pass = 0; pass < 2; pass++) for (let r = 0; r < 24; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = bx + dx, z = bz + dz;
          const top = w.getTopSolidY(x, z);
          if (top < 0) continue;
          const id = w.getBlock(x, top, z);
          if (id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES || id === B.CACTUS) continue;
          if (w.getBlock(x, top + 1, z) === B.WATER) continue;
          if (pass === 0 && !w.isSkyExposed(x, top + 1, z)) continue;
          p.pos.set(x + 0.5, top + 1, z + 0.5);
          p.spawn.copy(p.pos);
          return;
        }
      }
    }
    this.ensurePlayerSafe();
    p.spawn.copy(p.pos);
  }

  ensurePlayerSafe() {
    const p = this.player;
    for (let i = 0; i < 130 && p.isStuck(); i++) p.pos.y += 1;
  }

  disposeWorld() {
    this.entities.clear();
    this.particles.clear();
    this.interaction.reset();
    if (this.world) this.world.dispose();
    this.world = null;
  }

  async saveGame() {
    if (!this.world || !this.worldMeta || this.state !== 'game') return;
    const meta = this.worldMeta;
    meta.player = this.player.serialize();
    meta.mode = this.player.mode;
    meta.time = this.time;
    meta.furnaces = this.furnaces.serialize();
    meta.lastPlayed = Date.now();
    const job = (async () => {
      try {
        await this.storage.saveWorld(meta);
        await this.world.saveDirty();
      } catch (e) {
        console.error('Save failed', e);
        this.hud.toast('Saving failed!');
      }
    })();
    this.saving = job;
    return job;
  }

  async quitToTitle() {
    if (this.invUI.isOpen) this.invUI.close();
    await this.saveGame();
    if (this.saving) await this.saving;
    this.expectUnlock = this.input.locked;
    this.input.exitLock();
    this.disposeWorld();
    this.state = 'menu';
    this.overlay = null;
    this.hud.show(false);
    this.hud.setClickToPlay(false);
    this.touch.setEnabled(false);
    this.ui.updateRotateHint();
    this.ui.show('main');
  }

  // ---------- overlays ----------

  onLockChange(locked, error) {
    if (this.state !== 'game') return;
    if (locked) { this.hud.setClickToPlay(false); return; }
    if (error) { this.hud.setClickToPlay(!this.overlay && !this.isTouch); return; }
    if (this.expectUnlock) { this.expectUnlock = false; return; }
    if (!this.overlay && !this.isTouch) this.pause();
  }

  onKey(code, e) {
    this.audio.ensure();
    if (this.state !== 'game') return;
    if (code === 'Escape') {
      if (this.overlay === 'inventory') this.closeInventory();
      else if (this.overlay === 'pause') { if (performance.now() - this.pausedAt > 400) this.resume(); }
      else if (this.overlay === 'settings') this.ui.action('settings-done');
      else if (!this.overlay && !this.input.locked) this.pause();
      return;
    }
    if (code === 'KeyE') {
      if (this.overlay === 'inventory') this.closeInventory();
      else if (!this.overlay) this.openInventory();
      return;
    }
    if (this.overlay) return;
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) this.selectSlot(n - 1);
    } else if (code === 'KeyQ') this.dropSelected(e.ctrlKey);
    else if (code === 'F3') this.hud.toggleDebug();
  }

  openInventory(mode, opts) {
    if (this.overlay || this.player.dead) return;
    this.overlay = 'inventory';
    this.invUI.open(mode || (this.player.creative ? 'creative' : 'inventory'), opts);
    this.expectUnlock = this.input.locked;
    this.input.exitLock();
    this.input.releaseAll();
    this.touch.setVisible(false);
    this.hud.setClickToPlay(false);
  }

  closeInventory() {
    if (this.overlay !== 'inventory') return;
    this.invUI.close();
    this.overlay = null;
    this.touch.setVisible(true);
    if (!this.isTouch) this.input.requestLock();
  }

  toggleInventory() {
    if (this.overlay === 'inventory') this.closeInventory();
    else this.openInventory();
  }

  openBlockUI(kind, hit) {
    if (kind === 'crafting') this.openInventory('crafting');
    else if (kind === 'furnace') this.openInventory('furnace', { furnace: this.furnaces.get(hit.x, hit.y, hit.z) });
  }

  pause() {
    if (this.state !== 'game' || this.overlay === 'pause' || this.overlay === 'settings' || this.overlay === 'dead') return;
    if (this.overlay === 'inventory') this.invUI.close();
    this.overlay = 'pause';
    this.pausedAt = performance.now();
    this.expectUnlock = this.input.locked;
    this.input.exitLock();
    this.input.releaseAll();
    this.ui.showPause();
    this.touch.setVisible(false);
    this.hud.setClickToPlay(false);
    this.saveGame();
  }

  resume() {
    if (this.overlay !== 'pause') return;
    this.overlay = null;
    this.ui.hideAll();
    this.touch.setVisible(true);
    if (!this.isTouch) this.input.requestLock();
  }

  toggleGameMode() {
    const p = this.player;
    p.mode = p.creative ? 'survival' : 'creative';
    if (!p.creative) p.flying = false;
    if (this.worldMeta) this.worldMeta.mode = p.mode;
    this.hud.invalidate();
    this.hud.toast('Game mode: ' + (p.creative ? 'Creative' : 'Survival'));
  }

  onPlayerHurt() {
    this.audio.hurt();
    this.hud.flashDamage();
  }

  onPlayerDeath(source) {
    const p = this.player, inv = p.inventory;
    if (!p.creative) {
      for (const s of inv.slots) if (s) this.entities.spawnItem(p.pos.x, p.pos.y + 1, p.pos.z, s.id, s.count, s.dur, 1);
      inv.clear();
    }
    if (this.overlay === 'inventory') this.invUI.close();
    this.overlay = 'dead';
    this.expectUnlock = this.input.locked;
    this.input.exitLock();
    this.input.releaseAll();
    this.touch.setVisible(false);
    this.hud.setClickToPlay(false);
    this.ui.showDeath(DEATH_MESSAGES[source] || 'You died');
    this.saveGame();
  }

  respawn() {
    this.player.respawn();
    this.ensurePlayerSafe();
    this.overlay = null;
    this.ui.hideAll();
    this.touch.setVisible(true);
    this.hud.invalidate();
    if (!this.isTouch) this.input.requestLock();
    this.saveGame();
  }

  // ---------- gameplay helpers ----------

  selectSlot(i) {
    this.player.inventory.selected = i;
  }

  dropSelected(all) {
    const inv = this.player.inventory;
    const s = inv.selectedStack;
    if (!s) return;
    const n = all ? s.count : 1;
    const stack = { id: s.id, count: n, dur: s.dur };
    inv.removeFromSlot(inv.selected, n);
    this.dropStack(stack);
  }

  dropStack(stack) {
    const p = this.player;
    const eye = p.eyePosition(new THREE.Vector3());
    const dir = p.lookDirection(new THREE.Vector3());
    const e = this.entities.spawnItem(eye.x + dir.x * 0.4, eye.y - 0.35, eye.z + dir.z * 0.4, stack.id, stack.count, stack.dur, 1.5);
    if (e) {
      e.pickupDelay = 1.5;
      e.vel.set(dir.x * 6, dir.y * 6 + 1.5, dir.z * 6);
    }
  }

  damageHeldTool(n) {
    const p = this.player;
    if (p.creative) return;
    const inv = p.inventory, s = inv.selectedStack;
    if (!s || s.dur === undefined) return;
    s.dur -= n;
    if (s.dur <= 0) {
      inv.set(inv.selected, null);
      this.audio.toolBreak();
      this.hud.toast(itemDef(s.id).name + ' broke!', 1.5);
    } else inv.changed();
  }

  pickBlock() {
    const hit = this.interaction.target;
    if (!hit) return;
    let id = PICK_MAP[hit.id] ?? hit.id;
    if (!itemDef(id)) return;
    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.selected = i; return; }
    if (this.player.creative) inv.set(inv.selected, { id, count: maxStack(id) });
  }

  explode(x, y, z, power) {
    const w = this.world, r = power;
    const R = Math.ceil(r);
    const p = this.player;
    for (let dy = -R; dy <= R; dy++) {
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > r * (0.75 + Math.random() * 0.4)) continue;
          const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
          const id = w.getBlock(bx, by, bz);
          if (id === B.AIR || id === B.BEDROCK || id === B.WATER || id === B.UNLOADED) continue;
          this.interaction.destroyBlock(bx, by, bz, Math.random() < 0.3, false);
        }
      }
    }
    this.particles.explosion(x, y, z, r);
    const pd = Math.hypot(p.pos.x - x, p.pos.y + 0.9 - y, p.pos.z - z);
    this.audio.explosion(pd);
    const reach = r * 2;
    if (pd < reach) {
      const f = 1 - pd / reach;
      const dmg = Math.floor(f * f * 20 + f * 4);
      if (p.damage(dmg, 'explosion', true)) p.knockback(p.pos.x - x, p.pos.z - z, f * 14);
      this.shake = 0.5 * f + 0.1;
    }
    for (const m of this.entities.mobs) {
      const md = Math.hypot(m.pos.x - x, m.pos.y + m.h / 2 - y, m.pos.z - z);
      if (md < reach && m.alive) {
        const f = 1 - md / reach;
        m.invuln = 0;
        m.hurt(Math.floor(f * f * 20 + f * 4), m.pos.x - x, m.pos.z - z, f * 12);
      }
    }
  }

  // Approximate brightness (0..1) at a world position for lighting entities.
  lightLevelAt(x, y, z) {
    const w = this.world;
    if (!w) return 1;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const cover = w.skyAccess(bx, by, bz, 5);
    const sky = cover.opaque === 0 ? (cover.leaves ? 0.82 : 1) : Math.max(0.04, 0.72 - cover.opaque * 0.17);
    const s = sky * this.sky.sunLight;
    const b = w.blockLightAt(bx, by, bz) / 15;
    const min = this.materials.uniforms.uMinLight.value;
    return Math.min(1, Math.max(0.06 + min, s, b * 0.95));
  }

  // ---------- per-frame ----------

  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!(dt > 0)) dt = 0.001;
    if (dt > 0.1) dt = 0.1;
    this.elapsed += dt;
    try {
      if (this.state === 'loading') this.updateLoading(dt);
      else if (this.state === 'game') this.updateGame(dt);
      this.render();
      this.errorCount = Math.max(0, this.errorCount - dt);
    } catch (e) {
      console.error(e);
      this.errorCount += 1;
      if (this.errorCount > 20) showFatal(e);
    }
    this.input.endFrame();
  }

  updateGame(dt) {
    const p = this.player;
    const paused = this.overlay === 'pause' || this.overlay === 'settings';
    const active = !this.overlay && (this.isTouch || this.input.locked);
    this.input.active = active;
    if (!this.isTouch) this.hud.setClickToPlay(!this.overlay && !this.input.locked);
    if (paused) {
      this.input.consumeLook();
      this.world.update(p.pos.x, p.pos.z, dt);
      this.updateCamera(0);
      this.sky.update(0, this.time, this.camera);
      this.updateUniforms();
      return;
    }

    const t = this.input.touch;
    if (t.tap) {
      t.tap = false;
      if (this.interaction.targetMob) t.attackPressed = true;
      else t.usePressed = true;
    }

    const look = this.input.consumeLook();
    if (active) {
      const s = 0.0022 * this.settings.sensitivity;
      const iy = this.settings.invertY ? -1 : 1;
      p.applyLook(look.dx * s, look.dy * s * iy);
      const ts = 0.0055 * this.settings.touchSensitivity;
      p.applyLook(look.tdx * ts, look.tdy * ts);
      const wheel = this.input.consumeWheel();
      if (wheel) this.selectSlot((p.inventory.selected + wheel + 9) % 9);
      if (this.input.middlePressed) this.pickBlock();
    } else this.input.consumeWheel();

    this.time = (this.time + dt / (this.settings.dayLength * 60)) % 1;
    const input = active ? this.input : NULL_INPUT;
    const steps = dt > 0.04 ? 2 : 1;
    for (let i = 0; i < steps; i++) p.update(dt / steps, input);
    this.interaction.update(dt, input, active);
    this.entities.update(dt);
    this.particles.update(dt);
    this.furnaces.update(dt);
    this.world.update(p.pos.x, p.pos.z, dt);
    this.updateCamera(dt);
    this.sky.update(dt, this.time, this.camera);
    this.updateUniforms();
    this.hud.update(dt);
    this.hud.setUnderwater(this.cameraUnderwater);
    this.invUI.update(dt);
    this.touch.update();
    this.hand.update(dt, p);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      this.saveGame();
    }
  }

  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    p.eyePosition(cam.position);
    let roll = 0;
    if (this.settings.viewBobbing && !p.flying) {
      const b = p.bobAmount, ph = p.bobPhase;
      cam.position.y += Math.abs(Math.cos(ph)) * 0.06 * b - 0.03 * b;
      const side = Math.sin(ph) * 0.035 * b;
      cam.position.x += Math.cos(p.yaw) * side;
      cam.position.z -= Math.sin(p.yaw) * side;
      roll = Math.sin(ph) * 0.006 * b;
    }
    if (p.hurtTime > 0) roll += Math.sin(p.hurtTime * 25) * 0.06 * (p.hurtTime / 0.4);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    if (p.dead) {
      cam.position.y = p.pos.y + 0.3;
      roll = 0.6;
    }
    cam.rotation.set(p.pitch, p.yaw, roll);

    const w = this.world;
    if (w) {
      const cx = Math.floor(cam.position.x), cy = Math.floor(cam.position.y), cz = Math.floor(cam.position.z);
      const id = w.getBlock(cx, cy, cz);
      this.cameraUnderwater = id === B.WATER && (cam.position.y - cy < 0.875 || w.getBlock(cx, cy + 1, cz) === B.WATER);
    }
    let target = this.settings.fov;
    if (p.sprinting && p.speedNow > 3) target *= 1.12;
    if (this.cameraUnderwater) target *= 0.92;
    this.fovCurrent += (target - this.fovCurrent) * Math.min(1, dt * 10 || 1);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
      this.hand.resize(cam.aspect, 70);
    }
  }

  updateUniforms() {
    const u = this.materials.uniforms;
    const sky = this.sky;
    u.uSunLight.value = sky.sunLight;
    if (sky.sunDir.y > -0.05) u.uSunDir.value.copy(sky.sunDir);
    else u.uSunDir.value.copy(sky.sunDir).negate();
    u.uDirStrength.value = 0.35 + 0.65 * sky.daylight;
    u.uTime.value = this.elapsed;
    const rd = this.settings.renderDistance * 16;
    let fogColor = sky.fogColor, near = rd * 0.5, far = rd * 0.94;
    if (this.cameraUnderwater) {
      fogColor = this._waterFog.setRGB(0.06, 0.15, 0.4).multiplyScalar(0.3 + 0.7 * sky.sunLight);
      near = 0.5;
      far = 20;
    }
    u.uFogColor.value.copy(fogColor);
    u.uFogNear.value = near;
    u.uFogFar.value = far;
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = near;
    this.scene.fog.far = far;
    this.renderer.setClearColor(fogColor);
    sky.group.visible = !this.cameraUnderwater;
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    if (this.state === 'game' || this.state === 'loading') {
      r.render(this.scene, this.camera);
      if (this.state === 'game' && !this.player.dead && this.overlay !== 'pause' && this.overlay !== 'settings') this.hand.render(r);
    }
  }

  debugLines(fps) {
    const p = this.player, w = this.world;
    if (!w) return [];
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const col = w.generator.column(bx, bz, {});
    const st = w.countStats();
    const info = this.renderer.info.render;
    const yawDeg = ((((-p.yaw * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const facing = FACING[Math.round(((-p.yaw / (Math.PI / 2)) % 4 + 4 + 2) % 4) % 4];
    const hours = Math.floor((this.time * 24 + 6) % 24), mins = Math.floor((this.time * 24 * 60) % 60);
    const t = this.interaction.target;
    const lines = [
      `VoxelCraft 1.0  ${fps} fps`,
      `XYZ: ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block: ${bx} ${by} ${bz}  Chunk: ${bx >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${yawDeg.toFixed(1)}°)`,
      `Biome: ${BIOME_NAMES[col.biome]}  Light: ${this.lightLevelAt(x, y + 1, z).toFixed(2)}`,
      `Chunks: ${st.ready}/${st.chunks} loaded, ${st.meshes} meshes, ${st.tasks} tasks`,
      `Draw calls: ${info.calls}  Triangles: ${info.triangles}`,
      `Mobs: ${this.entities.mobs.length}  Items: ${this.entities.items.length}  Particles: ${this.particles.n}`,
      `Time: ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}  Daylight: ${this.sky.daylight.toFixed(2)}`,
      `Mode: ${p.mode}${p.flying ? ' (flying)' : ''}  Seed: ${this.worldMeta ? this.worldMeta.seedText : ''}`,
    ];
    if (t) lines.push(`Target: ${BLOCKS[t.id].name} @ ${t.x} ${t.y} ${t.z}`);
    return lines;
  }
}

function showFatal(err) {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = 'VoxelCraft hit an unrecoverable error.\n\n' + (err && err.stack ? err.stack : String(err)) +
    '\n\nTry reloading the page. If the problem persists, make sure your browser supports WebGL2 and ES modules.';
}

async function boot() {
  window.__voxelcraftStarted = true;
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) {
    showFatal('This browser or device does not support WebGL2, which VoxelCraft requires.');
    return;
  }
  const game = new Game();
  window.voxelcraft = game;
  await game.storage.open();
  game.ui.init();
  requestAnimationFrame(game.loop);
}

boot().catch((e) => {
  console.error(e);
  showFatal(e);
});
