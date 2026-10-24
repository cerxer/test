// Entities: creatures with AI, dropped items, falling blocks and arrows.
import * as THREE from '../../lib/three.module.min.js';
import { moveBody, canStepUp, boxCollides } from './physics.js';
import { buildModel, disposeModel } from './models.js';
import { B, BLOCKS, BLOCK_SOLID, BLOCK_SHAPE, SHAPE, T } from '../engine/blocks.js';
import { I, itemDef, ICON_CANVAS } from './items.js';
import { rayBox } from '../engine/world.js';

export const MOB_SPECS = {
  cow: { hostile: false, health: 10, width: 0.9, height: 1.4, speed: 1.4, sound: 'cow',
    drops: () => [{ id: I.RAW_BEEF, count: 1 + rnd(3) }, { id: I.LEATHER, count: rnd(3) }] },
  pig: { hostile: false, health: 10, width: 0.9, height: 0.9, speed: 1.5, sound: 'pig',
    drops: () => [{ id: I.RAW_PORKCHOP, count: 1 + rnd(3) }] },
  sheep: { hostile: false, health: 8, width: 0.9, height: 1.3, speed: 1.4, sound: 'sheep',
    drops: () => [{ id: B.WOOL, count: 1 }, { id: I.RAW_MUTTON, count: 1 + rnd(2) }] },
  chicken: { hostile: false, health: 4, width: 0.5, height: 0.8, speed: 1.3, sound: 'chicken',
    drops: () => [{ id: I.RAW_CHICKEN, count: 1 }, { id: I.FEATHER, count: rnd(3) }] },
  zombie: { hostile: true, health: 20, width: 0.6, height: 1.95, speed: 2.4, follow: 28, burns: true, sound: 'zombie',
    drops: () => [{ id: I.ROTTEN_FLESH, count: rnd(3) }] },
  skeleton: { hostile: true, health: 20, width: 0.6, height: 1.95, speed: 2.4, follow: 24, burns: true, sound: 'skeleton',
    drops: () => [{ id: I.BONE, count: rnd(3) }, { id: I.ARROW, count: rnd(3) }] },
  spider: { hostile: true, health: 16, width: 1.3, height: 0.9, speed: 3.2, follow: 24, sound: 'spider',
    drops: () => [{ id: I.STRING, count: rnd(3) }] },
  creeper: { hostile: true, health: 20, width: 0.6, height: 1.7, speed: 2.2, follow: 20, sound: 'creeper',
    drops: () => [{ id: I.GUNPOWDER, count: rnd(3) }] },
};
const PASSIVE = ['cow', 'pig', 'sheep', 'chicken'];
const HOSTILE_WEIGHTS = [['zombie', 35], ['skeleton', 25], ['spider', 20], ['creeper', 20]];

function rnd(n) {
  return Math.floor(Math.random() * n);
}

const _v = new THREE.Vector3();

class Mob {
  constructor(mgr, type, x, y, z) {
    this.mgr = mgr;
    this.type = type;
    this.spec = MOB_SPECS[type];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.hw = this.spec.width / 2;
    this.h = this.spec.height;
    this.height = this.spec.height;
    this.yaw = Math.random() * Math.PI * 2;
    this.headYaw = 0;
    this.headPitch = 0;
    this.health = this.spec.health;
    this.hurtTime = 0;
    this.invuln = 0;
    this.deathTime = -1;
    this.onGround = false;
    this.walkPhase = Math.random() * 10;
    this.walkAmount = 0;
    this.wanderTimer = 1 + Math.random() * 4;
    this.wanderTarget = null;
    this.fleeTimer = 0;
    this.attackCooldown = 1;
    this.shootTimer = 1.5 + Math.random();
    this.fuse = 0;
    this.burnTimer = 0;
    this.onFire = false;
    this.avoidTimer = 0;
    this.avoidDir = 1;
    this.lightTimer = 0;
    this.brightness = 1;
    this.soundTimer = 4 + Math.random() * 12;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.model = buildModel(type);
    this.model.root.position.copy(this.pos);
    mgr.group.add(this.model.root);
  }

  get alive() {
    return this.deathTime < 0;
  }

  hurt(dmg, kx, kz, strength = 6) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= dmg;
    this.hurtTime = 0.35;
    this.invuln = 0.4;
    const len = Math.hypot(kx, kz) || 1;
    this.vel.x += (kx / len) * strength;
    this.vel.z += (kz / len) * strength;
    if (strength > 0) this.vel.y = Math.max(this.vel.y, 5);
    if (!this.spec.hostile) this.fleeTimer = 5;
    this.mgr.game.audio.mob(this.spec.sound, 'hurt', this.distToPlayer());
    if (this.health <= 0) this.die(true);
    return true;
  }

  die(drops) {
    if (!this.alive) return;
    this.deathTime = 0;
    this.fuse = 0;
    if (drops) {
      for (const d of this.spec.drops()) {
        if (d.count > 0) this.mgr.spawnItem(this.pos.x, this.pos.y + 0.5, this.pos.z, d.id, d.count);
      }
    }
  }

  distToPlayer() {
    return this.pos.distanceTo(this.mgr.game.player.pos);
  }

  lineOfSight() {
    const g = this.mgr.game;
    const eye = _v.set(this.pos.x, this.pos.y + this.h * 0.85, this.pos.z);
    const target = g.player.eyePosition(new THREE.Vector3());
    const dir = target.clone().sub(eye);
    const dist = dir.length();
    dir.divideScalar(dist || 1);
    const hit = g.world.raycast(eye.clone(), dir, dist);
    return !hit || hit.dist >= dist - 0.3 || !BLOCK_SOLID[hit.id];
  }

  update(dt) {
    const g = this.mgr.game, w = g.world, p = g.player;
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCooldown -= dt;

    if (!w.isLoaded(Math.floor(this.pos.x), Math.floor(this.pos.z))) return true;

    if (!this.alive) {
      this.deathTime += dt;
      this.model.root.rotation.z = Math.min(1, this.deathTime / 0.45) * (Math.PI / 2);
      this.physics(dt, 0, 0, 0);
      this.applyTint(dt);
      if (this.deathTime > 0.9) {
        g.particles.poof(this.pos.x, this.pos.y + this.h / 2, this.pos.z);
        return false;
      }
      return true;
    }

    const dx = p.pos.x - this.pos.x, dy = p.pos.y - this.pos.y, dz = p.pos.z - this.pos.z;
    const hdist = Math.hypot(dx, dz);
    const dist = Math.hypot(hdist, dy);
    const canTarget = this.spec.hostile && !p.dead && !p.creative && dist < this.spec.follow;
    let mx = 0, mz = 0, speed = this.spec.speed, chasing = false;
    let lookAtPlayer = dist < 8;

    if (this.spec.hostile && canTarget) {
      chasing = true;
      lookAtPlayer = true;
      if (this.type === 'skeleton') {
        const los = this.lineOfSight();
        if (hdist > 11 || !los) { mx = dx; mz = dz; }
        else if (hdist < 6) { mx = -dx; mz = -dz; }
        else { mx = -dz * this.strafe; mz = dx * this.strafe; speed *= 0.6; }
        this.shootTimer -= dt;
        if (los && dist < 18 && this.shootTimer <= 0) {
          this.shootTimer = 1.8 + Math.random() * 0.8;
          this.mgr.shootArrow(this, p);
        }
        if (Math.random() < dt * 0.3) this.strafe *= -1;
      } else if (this.type === 'creeper') {
        if (dist < 2.8 && this.lineOfSight()) {
          if (this.fuse === 0) g.audio.fuse(dist);
          this.fuse += dt;
        } else {
          this.fuse = Math.max(0, this.fuse - dt * 1.5);
          mx = dx; mz = dz;
        }
        if (dist > 7) this.fuse = 0;
        if (this.fuse >= 1.5) {
          g.explode(this.pos.x, this.pos.y + 0.8, this.pos.z, 3.2);
          this.deathTime = 1;
          return false;
        }
      } else {
        mx = dx; mz = dz;
        const reach = this.type === 'spider' ? 1.5 : 1.25;
        if (hdist < reach + this.hw && Math.abs(dy) < 1.6 && this.attackCooldown <= 0) {
          this.attackCooldown = 1.0;
          const dmg = this.type === 'spider' ? 2 : 3;
          if (p.damage(dmg, this.type)) p.knockback(dx, dz, 5);
        } else if (this.type === 'spider' && this.onGround && hdist > 2 && hdist < 5 && this.attackCooldown <= 0 && Math.random() < dt * 2) {
          this.vel.y = 6.5;
          this.vel.x += (dx / hdist) * 5;
          this.vel.z += (dz / hdist) * 5;
        }
      }
    } else if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      mx = -dx; mz = -dz;
      speed *= 1.7;
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 6;
        if (Math.random() < 0.65) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 7;
          this.wanderTarget = new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y, this.pos.z + Math.sin(a) * r);
        } else this.wanderTarget = null;
      }
      if (this.wanderTarget) {
        mx = this.wanderTarget.x - this.pos.x;
        mz = this.wanderTarget.z - this.pos.z;
        if (Math.hypot(mx, mz) < 0.6) { this.wanderTarget = null; mx = mz = 0; }
      }
      speed *= this.spec.hostile ? 0.5 : 0.7;
    }

    let len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      if (this.avoidTimer > 0) {
        this.avoidTimer -= dt;
        const ax = -mz * this.avoidDir, az = mx * this.avoidDir;
        mx = mx * 0.3 + ax; mz = mz * 0.3 + az;
        len = Math.hypot(mx, mz);
        mx /= len; mz /= len;
      }
      // Avoid cliffs (passive mobs and wanderers are more careful).
      const maxDrop = chasing ? 4 : 2;
      if (this.onGround && !this.dropSafe(mx, mz, maxDrop)) {
        mx = mz = 0;
        this.wanderTarget = null;
        this.wanderTimer = Math.min(this.wanderTimer, 0.5);
      }
    }

    this.physics(dt, mx, mz, speed);

    if (len > 0.001 && (this.hitX || this.hitZ)) {
      if (this.onGround && canStepUp(w, this, mx, mz)) this.vel.y = 8.4;
      else if (this.type === 'spider' && chasing) this.vel.y = 3.5;
      else if (this.avoidTimer <= 0) {
        this.avoidTimer = 0.8 + Math.random();
        this.avoidDir = Math.random() < 0.5 ? 1 : -1;
        this.wanderTarget = null;
      }
    }

    // Face movement direction (or the player).
    let targetYaw = this.yaw;
    if (len > 0.001 && (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 0.1) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    else if (lookAtPlayer) targetYaw = Math.atan2(dx, dz);
    let dyaw = targetYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yaw += dyaw * Math.min(1, dt * 8);
    let hy = lookAtPlayer ? Math.atan2(dx, dz) - this.yaw : 0;
    while (hy > Math.PI) hy -= Math.PI * 2;
    while (hy < -Math.PI) hy += Math.PI * 2;
    hy = Math.max(-1, Math.min(1, hy));
    this.headYaw += (hy - this.headYaw) * Math.min(1, dt * 6);
    const hp = lookAtPlayer ? -Math.atan2(dy + 1.2 - this.h * 0.8, hdist + 0.01) : 0;
    this.headPitch += (Math.max(-0.8, Math.min(0.8, hp)) - this.headPitch) * Math.min(1, dt * 6);

    // Undead burn in daylight.
    if (this.spec.burns) {
      this.burnTimer -= dt;
      const exposed = g.sky.daylight > 0.6 && !this.inWater && w.isSkyExposed(Math.floor(this.pos.x), Math.floor(this.pos.y + this.h), Math.floor(this.pos.z));
      this.onFire = exposed;
      if (exposed) {
        if (Math.random() < dt * 8) g.particles.flame(this.pos.x, this.pos.y + Math.random() * this.h, this.pos.z);
        if (this.burnTimer <= 0) {
          this.burnTimer = 1;
          this.health -= 1;
          this.hurtTime = 0.2;
          if (this.health <= 0) this.die(true);
        }
      }
    }

    this.soundTimer -= dt;
    if (this.soundTimer <= 0) {
      this.soundTimer = 6 + Math.random() * 14;
      if (dist < 24) g.audio.mob(this.spec.sound, 'idle', dist);
    }

    this.animate(dt);
    return true;
  }

  dropSafe(mx, mz, maxDrop) {
    const w = this.mgr.game.world;
    const ax = Math.floor(this.pos.x + mx * (this.hw + 0.5)), az = Math.floor(this.pos.z + mz * (this.hw + 0.5));
    const y = Math.floor(this.pos.y);
    for (let k = 0; k <= maxDrop + 1; k++) {
      const id = w.getBlock(ax, y - k, az);
      if (BLOCK_SOLID[id] || id === B.WATER) return k <= maxDrop + 1;
    }
    return false;
  }

  physics(dt, mx, mz, speed) {
    const w = this.mgr.game.world;
    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.3), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER;
    const k = 1 - Math.exp(-dt * (this.onGround ? 10 : (this.inWater ? 4 : 1.5)));
    if (this.onGround || this.inWater || mx || mz) {
      this.vel.x += (mx * speed - this.vel.x) * k;
      this.vel.z += (mz * speed - this.vel.z) * k;
    }
    if (this.inWater) {
      this.vel.y += (2.2 - this.vel.y) * Math.min(1, dt * 3);
    } else {
      this.vel.y -= 32 * dt;
      if (this.vel.y < -60) this.vel.y = -60;
    }
    const fallStart = this.pos.y;
    const wasGround = this.onGround;
    moveBody(w, this, dt, false);
    if (!this.onGround && this.vel.y < 0) this.fallAccum = (this.fallAccum || 0) + Math.max(0, fallStart - this.pos.y);
    if (this.onGround && !wasGround) {
      if ((this.fallAccum || 0) > 3.5 && this.alive) this.hurt(Math.ceil(this.fallAccum - 3), 0, 0, 0);
      this.fallAccum = 0;
    }
    if (this.inWater) this.fallAccum = 0;
  }

  animate(dt) {
    const m = this.model;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.walkAmount += (Math.min(1, hs / 2) - this.walkAmount) * Math.min(1, dt * 8);
    this.walkPhase += hs * dt * 3.2;
    const swing = Math.sin(this.walkPhase) * 0.8 * this.walkAmount;
    if (m.spiderLegs) {
      m.legs.forEach((l, i) => {
        const ph = this.walkPhase * 1.5 + (i % 2 ? Math.PI : 0) + Math.floor(i / 2) * 0.8;
        l.rotation.y = l.userData.baseY + Math.sin(ph) * 0.35 * this.walkAmount;
        l.rotation.z = l.userData.side * (0.55 + Math.max(0, Math.cos(ph)) * 0.25 * this.walkAmount);
      });
    } else if (m.legs.length === 4) {
      m.legs[0].rotation.x = swing; m.legs[3].rotation.x = swing;
      m.legs[1].rotation.x = -swing; m.legs[2].rotation.x = -swing;
    } else if (m.legs.length === 2) {
      m.legs[0].rotation.x = swing;
      m.legs[1].rotation.x = -swing;
    }
    if (m.arms) {
      if (m.armsForward) {
        const sway = Math.sin(this.walkPhase * 0.5) * 0.06;
        m.arms[0].rotation.x = -Math.PI / 2 + sway;
        m.arms[1].rotation.x = -Math.PI / 2 - sway;
      }
    }
    if (m.wings) {
      const flap = this.onGround ? 0 : Math.sin(performance.now() * 0.03) * 0.7 + 0.7;
      m.wings[0].rotation.z = flap;
      m.wings[1].rotation.z = -flap;
    }
    if (m.head) {
      m.head.rotation.y = this.headYaw;
      m.head.rotation.x = this.headPitch;
    }
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    if (this.type === 'creeper') {
      const f = this.fuse / 1.5;
      const s = 1 + f * 0.25 + (f > 0 ? Math.sin(this.fuse * 18) * 0.02 : 0);
      m.root.scale.set(s, 1 + f * 0.1, s);
    }
    this.applyTint(dt);
  }

  applyTint(dt) {
    const g = this.mgr.game;
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.5;
      this.brightness = g.lightLevelAt(this.pos.x, this.pos.y + this.h * 0.6, this.pos.z);
    }
    const b = this.brightness;
    let r = b, gg = b, bb = b;
    if (this.hurtTime > 0 || !this.alive) { gg *= 0.4; bb *= 0.4; r = Math.min(1.5, r * 1.3); }
    if (this.type === 'creeper' && this.fuse > 0 && Math.floor(this.fuse * 8) % 2 === 0) { r = gg = bb = 2.2; }
    if (this.onFire) { r *= 1.3; gg *= 0.9; bb *= 0.6; }
    for (const mt of this.model.materials) mt.color.setRGB(r, gg, bb);
  }

  dispose() {
    this.mgr.group.remove(this.model.root);
    disposeModel(this.model);
  }
}

// ---------- dropped items ----------
const itemGeoCache = new Map();
const itemMatCache = new Map();

function itemVisual(game, id) {
  const def = itemDef(id);
  const bd = def && def.isBlock ? BLOCKS[id] : null;
  if (bd && (BLOCK_SHAPE[id] === SHAPE.CUBE || BLOCK_SHAPE[id] === SHAPE.CACTUS)) {
    let mats = itemMatCache.get(id);
    if (!mats) {
      mats = bd.faceTiles.map((t) => new THREE.MeshLambertMaterial({ map: game.textures.canvasTexture(T[t]), alphaTest: 0.3 }));
      itemMatCache.set(id, mats);
    }
    let geo = itemGeoCache.get('cube');
    if (!geo) { geo = new THREE.BoxGeometry(0.26, 0.26, 0.26); itemGeoCache.set('cube', geo); }
    return new THREE.Mesh(geo, mats);
  }
  let mat = itemMatCache.get(id);
  if (!mat) {
    const canvas = ICON_CANVAS.get(id);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    itemMatCache.set(id, mat);
  }
  let geo = itemGeoCache.get('flat');
  if (!geo) { geo = new THREE.PlaneGeometry(0.4, 0.4); itemGeoCache.set('flat', geo); }
  return new THREE.Mesh(geo, mat);
}

class ItemEntity {
  constructor(mgr, x, y, z, id, count, dur, pickupDelay = 0.6) {
    this.mgr = mgr;
    this.id = id;
    this.count = count;
    this.dur = dur;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3);
    this.hw = 0.125;
    this.h = 0.25;
    this.age = 0;
    this.pickupDelay = pickupDelay;
    this.spin = Math.random() * Math.PI * 2;
    this.mesh = itemVisual(mgr.game, id);
    mgr.group.add(this.mesh);
  }

  update(dt) {
    const g = this.mgr.game, w = g.world;
    this.age += dt;
    this.pickupDelay -= dt;
    if (this.age > 300) return false;
    if (!w.isLoaded(Math.floor(this.pos.x), Math.floor(this.pos.z))) return true;
    const inWater = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) === B.WATER;
    if (inWater) this.vel.y += (1.2 - this.vel.y) * Math.min(1, dt * 3);
    else this.vel.y -= 20 * dt;
    const f = Math.exp(-dt * (this.onGround ? 8 : 0.5));
    this.vel.x *= f;
    this.vel.z *= f;
    const p = g.player;
    const dx = p.pos.x - this.pos.x, dy = p.pos.y + 0.6 - this.pos.y, dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (this.pickupDelay <= 0 && !p.dead && d < 2.2) {
      if (p.inventory.canFit(this.id, 1) && d > 0.01) {
        const pull = 12 * dt / d;
        this.vel.x = dx * 6; this.vel.y = dy * 6; this.vel.z = dz * 6;
        this.pos.x += dx * Math.min(1, pull); this.pos.z += dz * Math.min(1, pull);
      }
      if (d < 0.9) {
        const left = p.inventory.add(this.id, this.count, this.dur);
        if (left < this.count) g.audio.pickup();
        this.count = left;
        if (left <= 0) return false;
      }
    }
    if (boxCollides(w, this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw, this.pos.x + this.hw, this.pos.y + this.h, this.pos.z + this.hw)) {
      this.pos.y += dt * 4;
      this.vel.y = Math.max(this.vel.y, 0);
    } else moveBody(w, this, dt, false);
    this.spin += dt * 1.6;
    const bob = Math.sin(this.age * 2.5) * 0.06 + 0.12;
    this.mesh.position.set(this.pos.x, this.pos.y + bob + 0.05, this.pos.z);
    this.mesh.rotation.y = this.spin;
    return true;
  }

  dispose() {
    this.mgr.group.remove(this.mesh);
  }
}

class FallingBlock {
  constructor(mgr, x, y, z, id) {
    this.mgr = mgr;
    this.id = id;
    this.pos = new THREE.Vector3(x + 0.5, y, z + 0.5);
    this.vel = new THREE.Vector3();
    this.hw = 0.49;
    this.h = 0.98;
    this.mesh = itemVisual(mgr.game, id);
    this.mesh.scale.setScalar(1 / 0.26);
    mgr.group.add(this.mesh);
    this.age = 0;
  }
  update(dt) {
    const g = this.mgr.game, w = g.world;
    this.age += dt;
    this.vel.y = Math.max(-40, this.vel.y - 32 * dt);
    moveBody(w, this, dt, false);
    this.mesh.position.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
    if (this.onGround || this.age > 20) {
      const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + 0.5), z = Math.floor(this.pos.z);
      const cur = w.getBlock(x, y, z);
      if (cur === B.AIR || cur === B.WATER || cur === B.TALL_GRASS) {
        w.setBlock(x, y, z, this.id);
        g.interaction.onBlockPlaced(x, y, z);
      } else this.mgr.spawnItem(this.pos.x, this.pos.y + 0.5, this.pos.z, this.id, 1);
      return false;
    }
    return true;
  }
  dispose() {
    this.mgr.group.remove(this.mesh);
  }
}

class Arrow {
  constructor(mgr, pos, vel, shooter) {
    this.mgr = mgr;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.shooter = shooter;
    this.stuck = false;
    this.life = 0;
    if (!Arrow.geo) {
      Arrow.geo = new THREE.BoxGeometry(0.06, 0.06, 0.55);
      Arrow.mat = new THREE.MeshLambertMaterial({ color: 0x8a6b3e });
    }
    this.mesh = new THREE.Mesh(Arrow.geo, Arrow.mat);
    mgr.group.add(this.mesh);
    this.orient();
  }
  orient() {
    this.mesh.position.copy(this.pos);
    _v.copy(this.pos).add(this.vel);
    this.mesh.lookAt(_v);
  }
  update(dt) {
    const g = this.mgr.game;
    this.life += dt;
    if (this.stuck) return this.life < 12;
    if (this.life > 8) return false;
    this.vel.y -= 20 * dt;
    const speed = this.vel.length();
    const step = speed * dt;
    const dir = this.vel.clone().divideScalar(speed || 1);
    const p = g.player;
    if (!p.dead && this.shooter !== p) {
      const hit = rayBox(this.pos, dir, 0, 0, 0, [p.pos.x - 0.35, p.pos.y, p.pos.z - 0.35, p.pos.x + 0.35, p.pos.y + 1.8, p.pos.z + 0.35]);
      if (hit && hit.t <= step) {
        if (p.damage(2 + rnd(3), 'arrow')) p.knockback(this.vel.x, this.vel.z, 3);
        return false;
      }
    }
    const bhit = g.world.raycast(this.pos, dir, step);
    if (bhit && BLOCK_SOLID[bhit.id]) {
      this.pos.addScaledVector(dir, bhit.dist);
      this.stuck = true;
      this.life = 0;
      this.orient();
      this.mesh.position.copy(this.pos);
      return true;
    }
    this.pos.addScaledVector(dir, step);
    this.orient();
    return true;
  }
  dispose() {
    this.mgr.group.remove(this.mesh);
  }
}

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mobs = [];
    this.items = [];
    this.others = [];
    this.spawnTimer = 2;
    this.passiveTimer = 3;
  }

  clear() {
    for (const e of [...this.mobs, ...this.items, ...this.others]) e.dispose();
    this.mobs = [];
    this.items = [];
    this.others = [];
  }

  spawnMob(type, x, y, z) {
    const m = new Mob(this, type, x, y, z);
    this.mobs.push(m);
    return m;
  }

  spawnItem(x, y, z, id, count, dur, delay) {
    if (!itemDef(id)) return null;
    // Merge with a nearby identical stack to keep entity counts low.
    for (const e of this.items) {
      if (e.id === id && e.dur === undefined && dur === undefined && e.pos.distanceToSquared(_v.set(x, y, z)) < 1 && e.count + count <= 64) {
        e.count += count;
        return e;
      }
    }
    const e = new ItemEntity(this, x, y, z, id, count, dur, delay);
    this.items.push(e);
    if (this.items.length > 300) this.items.shift().dispose();
    return e;
  }

  spawnFallingBlock(x, y, z, id) {
    this.others.push(new FallingBlock(this, x, y, z, id));
  }

  shootArrow(mob, player) {
    const from = new THREE.Vector3(mob.pos.x, mob.pos.y + mob.h * 0.8, mob.pos.z);
    const to = player.eyePosition(new THREE.Vector3());
    to.y -= 0.3;
    const d = to.clone().sub(from);
    const dist = d.length();
    const speed = 22;
    const t = dist / speed;
    d.y += 0.5 * 20 * t * t;
    d.normalize().multiplyScalar(speed);
    d.x += (Math.random() - 0.5) * 1.2;
    d.y += (Math.random() - 0.5) * 1.2;
    d.z += (Math.random() - 0.5) * 1.2;
    from.addScaledVector(d.clone().normalize(), 0.6);
    this.others.push(new Arrow(this, from, d, mob));
    this.game.audio.bow(mob.distToPlayer());
  }

  raycastMob(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const hit = rayBox(origin, dir, 0, 0, 0, [m.pos.x - m.hw, m.pos.y, m.pos.z - m.hw, m.pos.x + m.hw, m.pos.y + m.h, m.pos.z + m.hw]);
      if (hit && hit.t < bestT) { bestT = hit.t; best = m; }
    }
    return best;
  }

  blockOccupied(x, y, z) {
    for (const m of this.mobs) {
      if (!m.alive) continue;
      if (x + 1 > m.pos.x - m.hw && x < m.pos.x + m.hw && y + 1 > m.pos.y && y < m.pos.y + m.h && z + 1 > m.pos.z - m.hw && z < m.pos.z + m.hw) return true;
    }
    return false;
  }

  counts() {
    let hostile = 0, passive = 0;
    for (const m of this.mobs) { if (m.spec.hostile) hostile++; else passive++; }
    return { hostile, passive };
  }

  // Called when a freshly generated chunk becomes available.
  onChunkGenerated(chunk) {
    if (Math.random() > 0.12) return;
    const c = this.counts();
    if (c.passive >= 24) return;
    const type = PASSIVE[rnd(PASSIVE.length)];
    const n = 2 + rnd(3);
    const bx = chunk.cx * 16, bz = chunk.cz * 16;
    for (let i = 0; i < n; i++) {
      const x = bx + 2 + rnd(12), z = bz + 2 + rnd(12);
      const y = this.surfaceSpawnY(x, z, true);
      if (y > 0) this.spawnMob(type, x + 0.5, y, z + 0.5);
    }
  }

  surfaceSpawnY(x, z, needGrass) {
    const w = this.game.world;
    const top = w.getTopSolidY(x, z);
    if (top < 0) return -1;
    const ground = w.getBlock(x, top, z);
    if (needGrass && ground !== B.GRASS && ground !== B.SNOWY_GRASS) return -1;
    if (ground === B.OAK_LEAVES || ground === B.BIRCH_LEAVES || ground === B.SPRUCE_LEAVES) return -1;
    const a = w.getBlock(x, top + 1, z), b = w.getBlock(x, top + 2, z);
    if (BLOCK_SOLID[a] || BLOCK_SOLID[b] || a === B.WATER) return -1;
    return top + 1;
  }

  trySpawnHostile() {
    const g = this.game, w = g.world, p = g.player;
    const night = g.sky.daylight < 0.35;
    const ang = Math.random() * Math.PI * 2, d = 18 + Math.random() * 22;
    const x = Math.floor(p.pos.x + Math.cos(ang) * d), z = Math.floor(p.pos.z + Math.sin(ang) * d);
    if (!w.isRendered(x, z)) return;
    let y = -1;
    if (night && Math.random() < 0.6) y = this.surfaceSpawnY(x, z, false);
    else {
      // Look for a dark cave floor near the player's height.
      let yy = Math.floor(p.pos.y) + rnd(24) - 12;
      for (let k = 0; k < 10 && yy > 1; k++, yy--) {
        if (BLOCK_SOLID[w.getBlock(x, yy - 1, z)] && !BLOCK_SOLID[w.getBlock(x, yy, z)] && !BLOCK_SOLID[w.getBlock(x, yy + 1, z)] &&
            w.getBlock(x, yy, z) !== B.WATER) { y = yy; break; }
      }
    }
    if (y < 1) return;
    const below = w.getBlock(x, y - 1, z);
    if (below === B.OAK_LEAVES || below === B.BIRCH_LEAVES || below === B.SPRUCE_LEAVES || below === B.GLASS) return;
    // Daytime spawns only happen deep under solid cover (caves); at night any dark spot works.
    if (!night && w.skyAccess(x, y, z, 3).opaque < 3) return;
    if (w.blockLightAt(x, y, z) > 7) return;
    let r = Math.random() * 100, type = 'zombie';
    for (const [t, wgt] of HOSTILE_WEIGHTS) { if (r < wgt) { type = t; break; } r -= wgt; }
    const spec = MOB_SPECS[type];
    if (boxCollides(w, x + 0.5 - spec.width / 2, y, z + 0.5 - spec.width / 2, x + 0.5 + spec.width / 2, y + spec.height, z + 0.5 + spec.width / 2)) return;
    this.spawnMob(type, x + 0.5, y, z + 0.5);
  }

  trySpawnPassive() {
    const g = this.game, p = g.player;
    const ang = Math.random() * Math.PI * 2, d = 24 + Math.random() * 30;
    const x = Math.floor(p.pos.x + Math.cos(ang) * d), z = Math.floor(p.pos.z + Math.sin(ang) * d);
    if (!g.world.isRendered(x, z)) return;
    const y = this.surfaceSpawnY(x, z, true);
    if (y < 0) return;
    const type = PASSIVE[rnd(PASSIVE.length)];
    const n = 1 + rnd(3);
    for (let i = 0; i < n; i++) {
      const xx = x + rnd(3) - 1, zz = z + rnd(3) - 1;
      const yy = this.surfaceSpawnY(xx, zz, true);
      if (yy > 0) this.spawnMob(type, xx + 0.5, yy, zz + 0.5);
    }
  }

  update(dt) {
    const g = this.game, p = g.player;
    const settings = g.settings;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.8;
      const c = this.counts();
      const cap = settings.mobs === false ? 0 : (g.isTouch ? 8 : 14);
      if (c.hostile < cap) this.trySpawnHostile();
    }
    this.passiveTimer -= dt;
    if (this.passiveTimer <= 0) {
      this.passiveTimer = 5;
      const c = this.counts();
      if (c.passive < 10 && g.sky.daylight > 0.5 && settings.mobs !== false) this.trySpawnPassive();
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const d = m.pos.distanceTo(p.pos);
      let keep = m.update(dt);
      if (keep && m.alive) {
        if (m.spec.hostile && d > 80) keep = false;
        else if (!m.spec.hostile && d > 120) keep = false;
        else if (m.spec.hostile && !m.spec.burns && g.sky.daylight > 0.8 && d > 28 && Math.random() < dt / 30) keep = false;
        // Push mobs out of the player.
        const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
        const hd = Math.hypot(dx, dz), min = m.hw + p.hw;
        if (hd < min && hd > 0.001 && Math.abs(m.pos.y - p.pos.y) < 1.5) {
          const push = (min - hd) * 4 * dt;
          m.vel.x += (dx / hd) * push * 20;
          m.vel.z += (dz / hd) * push * 20;
        }
      }
      if (!keep) {
        m.dispose();
        this.mobs.splice(i, 1);
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].update(dt)) { this.items[i].dispose(); this.items.splice(i, 1); }
    }
    for (let i = this.others.length - 1; i >= 0; i--) {
      if (!this.others[i].update(dt)) { this.others[i].dispose(); this.others.splice(i, 1); }
    }
  }
}
