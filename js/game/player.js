// First-person player: movement physics, swimming, flying, fall damage and survival stats.
import * as THREE from '../../lib/three.module.min.js';
import { moveBody, boxCollides, canStepUp } from './physics.js';
import { B, BLOCKS } from '../engine/blocks.js';
import { Inventory } from './inventory.js';

const GRAVITY = 32;
const JUMP_VELOCITY = 9.0;
export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
export const MAX_AIR = 15;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hw = 0.3;
    this.h = 1.8;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.mode = 'survival';
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.fallDistance = 0;
    this.invuln = 0;
    this.hurtTime = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.cactusTimer = 0;
    this.jumpCooldown = 0;
    this.dead = false;
    this.spawn = new THREE.Vector3();
    this.inventory = new Inventory();
    this.currentEye = 1.62;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepDist = 0;
    this.speedNow = 0;
  }

  get creative() {
    return this.mode === 'creative';
  }

  eyePosition(out) {
    return out.set(this.pos.x, this.pos.y + this.currentEye, this.pos.z);
  }

  lookDirection(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = Math.PI / 2 - 0.001;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    this.yaw %= Math.PI * 2;
  }

  update(dt, input) {
    const world = this.game.world;
    if (this.dead) return;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.hurtTime = Math.max(0, this.hurtTime - dt);

    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    if (!world.isRendered(bx, bz)) {
      this.vel.set(0, 0, 0);
      return;
    }

    const feet = world.getBlock(bx, Math.floor(this.pos.y + 0.1), bz);
    const body = world.getBlock(bx, Math.floor(this.pos.y + 0.8), bz);
    this.inWater = feet === B.WATER || body === B.WATER;
    const eyeY = this.pos.y + this.currentEye;
    const eyeBlock = world.getBlock(bx, Math.floor(eyeY), bz);
    const aboveEye = world.getBlock(bx, Math.floor(eyeY) + 1, bz);
    this.headInWater = eyeBlock === B.WATER && (aboveEye === B.WATER || eyeY - Math.floor(eyeY) < 0.86);

    const mv = input.moveVector();
    let fwd = mv.z, str = mv.x;
    const len = Math.hypot(fwd, str);
    if (len > 1) { fwd /= len; str /= len; }

    if (!this.creative) this.flying = false;
    else if (input.consumeDoubleJump()) { this.flying = !this.flying; this.vel.y = 0; }

    this.sneaking = input.sneak && !this.flying;
    this.sprinting = input.sprint && fwd > 0.3 && !this.sneaking && (this.creative || this.food > 6);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * str;
    let wz = -cos * fwd - sin * str;
    let speed;
    if (this.flying) speed = this.sprinting ? 21.6 : 10.9;
    else if (this.sneaking) speed = 1.31;
    else if (this.sprinting) speed = 5.61;
    else speed = 4.32;
    if (this.inWater && !this.flying) speed *= 0.55;
    wx *= speed;
    wz *= speed;

    const v = this.vel;
    if (this.flying) {
      const k = 1 - Math.exp(-dt * 8);
      v.x += (wx - v.x) * k;
      v.z += (wz - v.z) * k;
      const vy = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      v.y += (vy * 8 - v.y) * k;
    } else if (this.inWater) {
      const k = 1 - Math.exp(-dt * 5);
      v.x += (wx - v.x) * k;
      v.z += (wz - v.z) * k;
      v.y -= 12 * dt;
      if (input.jump) v.y += 30 * dt;
      v.y *= Math.exp(-dt * 2.5);
      v.y = Math.max(-4, Math.min(4.2, v.y));
    } else {
      const k = 1 - Math.exp(-dt * (this.onGround ? 16 : 2.8));
      if (this.onGround || len > 0) {
        v.x += (wx - v.x) * k;
        v.z += (wz - v.z) * k;
      }
      v.y -= GRAVITY * dt;
      if (v.y < -78) v.y = -78;
      const autoJump = this.game.settings.autoJump && len > 0.1 && canStepUp(world, this, wx, wz);
      if ((input.jump || autoJump) && this.onGround && this.jumpCooldown <= 0) {
        v.y = JUMP_VELOCITY;
        this.jumpCooldown = 0.15;
        if (this.sprinting) {
          v.x += -sin * 2.2;
          v.z += -cos * 2.2;
          this.exhaustion += 0.2;
        } else this.exhaustion += 0.05;
      }
    }

    const px0 = this.pos.x, py0 = this.pos.y, pz0 = this.pos.z;
    moveBody(world, this, dt, this.sneaking);
    if (this.inWater && (this.hitX || this.hitZ) && input.jump) v.y = 5.5;
    if (this.flying && this.onGround && !input.jump) this.flying = false;

    const hd = Math.hypot(this.pos.x - px0, this.pos.z - pz0);
    this.speedNow = dt > 0 ? hd / dt : 0;

    if (!this.onGround && !this.inWater && !this.flying && this.pos.y < py0) this.fallDistance += py0 - this.pos.y;
    if (this.onGround) {
      if (this.fallDistance > 3 && !this.creative) this.damage(Math.ceil(this.fallDistance - 3.2), 'fall');
      if (this.fallDistance > 1.2) this.game.audio.step(this.groundSound(), 1.2);
      this.fallDistance = 0;
    }
    if (this.inWater || this.flying) this.fallDistance = 0;

    if (this.onGround && !this.flying) {
      this.stepDist += hd;
      if (this.stepDist > 2.1) {
        this.stepDist = 0;
        this.game.audio.step(this.groundSound(), this.sneaking ? 0.3 : 0.6);
      }
    }
    const moving = this.onGround && hd > 0.001 && !this.flying;
    this.bobPhase += hd * 2.2;
    this.bobAmount += ((moving ? Math.min(1, this.speedNow / 4.3) : 0) - this.bobAmount) * Math.min(1, dt * 8);

    if (this.sprinting) this.exhaustion += 0.1 * hd;
    else if (this.inWater) this.exhaustion += 0.015 * hd;
    else this.exhaustion += 0.01 * hd;

    const targetEye = this.sneaking ? 1.32 : 1.62;
    this.currentEye += (targetEye - this.currentEye) * Math.min(1, dt * 12);

    this.updateSurvival(dt);
  }

  groundSound() {
    const w = this.game.world;
    const id = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    const d = BLOCKS[id];
    return d ? d.sound : 'stone';
  }

  touchingBlock(id) {
    const w = this.game.world;
    const p = this.pos, e = 0.05;
    const x0 = Math.floor(p.x - this.hw - e), x1 = Math.floor(p.x + this.hw + e);
    const z0 = Math.floor(p.z - this.hw - e), z1 = Math.floor(p.z + this.hw + e);
    const y0 = Math.floor(p.y - e), y1 = Math.floor(p.y + this.h);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (w.getBlock(x, y, z) === id) return true;
    }
    return false;
  }

  updateSurvival(dt) {
    if (this.creative) {
      this.health = MAX_HEALTH;
      this.food = MAX_FOOD;
      this.air = MAX_AIR;
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.exhaustion += dt * 0.006;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    if (this.food >= 18 && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      const interval = this.food >= MAX_FOOD && this.saturation > 0 ? 0.6 : 4;
      if (this.regenTimer >= interval) {
        this.regenTimer = 0;
        this.heal(1);
        this.exhaustion += 6;
      }
    } else this.regenTimer = 0;

    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1, 'starve', true);
      }
    } else this.starveTimer = 0;

    if (this.headInWater) {
      this.air -= dt;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer += dt;
        if (this.drownTimer >= 1) { this.drownTimer = 0; this.damage(2, 'drown', true); }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 6);
      this.drownTimer = 0;
    }

    if (this.touchingBlock(B.CACTUS)) {
      this.cactusTimer += dt;
      if (this.cactusTimer >= 0.5) { this.cactusTimer = 0; this.damage(1, 'cactus'); }
    } else this.cactusTimer = 0.5;

    if (this.pos.y < -20) this.damage(4, 'void', true);
  }

  damage(amount, source, bypass = false) {
    if (this.creative || this.dead || amount <= 0) return false;
    if (this.invuln > 0 && !bypass) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.5;
    this.hurtTime = 0.4;
    this.exhaustion += 0.1;
    this.game.onPlayerHurt(source, amount);
    if (this.health <= 0) {
      this.dead = true;
      this.game.onPlayerDeath(source);
    }
    return true;
  }

  knockback(dx, dz, strength = 6) {
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / len) * strength;
    this.vel.z += (dz / len) * strength;
    this.vel.y = Math.max(this.vel.y, 5);
  }

  heal(n) {
    this.health = Math.min(MAX_HEALTH, this.health + n);
  }

  eat(food) {
    this.food = Math.min(MAX_FOOD, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
  }

  respawn() {
    this.pos.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.fallDistance = 0;
    this.dead = false;
    this.invuln = 2;
  }

  // Would a solid block at (x,y,z) intersect the player?
  intersectsBlock(x, y, z) {
    const p = this.pos, e = 0.001;
    return x + 1 > p.x - this.hw + e && x < p.x + this.hw - e &&
      y + 1 > p.y + e && y < p.y + this.h - e &&
      z + 1 > p.z - this.hw + e && z < p.z + this.hw - e;
  }

  isStuck() {
    const w = this.game.world, p = this.pos;
    return boxCollides(w, p.x - this.hw, p.y, p.z - this.hw, p.x + this.hw, p.y + this.h, p.z + this.hw);
  }

  serialize() {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z],
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      food: this.food,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      air: this.air,
      flying: this.flying,
      spawn: [this.spawn.x, this.spawn.y, this.spawn.z],
      inventory: this.inventory.serialize(),
      dead: this.dead,
    };
  }

  load(d) {
    if (!d) return;
    if (d.pos) this.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    if (d.spawn) this.spawn.set(d.spawn[0], d.spawn[1], d.spawn[2]);
    this.yaw = d.yaw || 0;
    this.pitch = d.pitch || 0;
    this.health = d.health ?? MAX_HEALTH;
    this.food = d.food ?? MAX_FOOD;
    this.saturation = d.saturation ?? 5;
    this.exhaustion = d.exhaustion || 0;
    this.air = d.air ?? MAX_AIR;
    this.flying = !!d.flying;
    this.inventory.load(d.inventory);
    this.dead = !!d.dead;
  }
}
