// Targeting, mining, placing, attacking, eating, and block-update rules (support, falling, water spread).
import * as THREE from '../../lib/three.module.min.js';
import {
  B, BLOCKS, BLOCK_SOLID, BLOCK_REPLACEABLE, BLOCK_SHAPE, SHAPE, BLOCK_TORCH_DIR, T, shapeBox,
} from '../engine/blocks.js';
import { itemDef } from './items.js';

const TORCH_FOR_NORMAL = { '1,0,0': B.TORCH_E, '-1,0,0': B.TORCH_W, '0,0,1': B.TORCH_S, '0,0,-1': B.TORCH_N };
const TORCH_ATTACH = [[0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
const H_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Interaction {
  constructor(game) {
    this.game = game;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6, depthWrite: false }));
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    game.scene.add(this.highlight);
    this.crackTextures = [];
    for (let i = 0; i < 10; i++) this.crackTextures.push(game.textures.canvasTexture(T['crack_' + i]));
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, depthWrite: false, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    game.scene.add(this.crack);
    this.target = null;
    this.targetMob = null;
    this.breakKey = null;
    this.breakProgress = 0;
    this.breakSoundTimer = 0;
    this.breakCooldown = 0;
    this.useCooldown = 0;
    this.attackCooldown = 0;
    this.swingTimer = 0;
    this.eating = 0;
    this.eatSoundTimer = 0;
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.waterQueue = [];
    this.waterPending = new Set();
  }

  reset() {
    this.resetBreak();
    this.waterQueue = [];
    this.waterPending.clear();
    this.highlight.visible = false;
  }

  resetBreak() {
    this.breakKey = null;
    this.breakProgress = 0;
    this.crack.visible = false;
  }

  update(dt, input, active) {
    const g = this.game, p = g.player;
    this.breakCooldown -= dt;
    this.useCooldown -= dt;
    this.attackCooldown -= dt;
    this.swingTimer -= dt;
    this.processWater(dt);
    if (!active || p.dead) {
      this.highlight.visible = false;
      this.resetBreak();
      this.eating = 0;
      g.hand.eating = false;
      return;
    }
    p.eyePosition(this.origin);
    p.lookDirection(this.dir);
    const reach = p.creative ? 6 : 5;
    const hit = g.world.raycast(this.origin, this.dir, reach);
    const mob = g.entities.raycastMob(this.origin, this.dir, Math.min(hit ? hit.dist : reach, 3.6));
    this.target = hit;
    this.targetMob = mob;
    this.updateHighlight(mob ? null : hit);

    const held = p.inventory.selectedStack;
    const def = held ? itemDef(held.id) : null;

    if (input.attackPressed && mob) this.attack(mob);
    else if (input.attackHeld && mob && this.attackCooldown <= 0 && this.swingTimer <= 0) this.attack(mob);
    else if (input.attackHeld && !mob && hit) this.mine(dt, hit, held, input.attackPressed);
    else {
      this.resetBreak();
      if (input.attackPressed) g.hand.swing();
    }

    const interactive = hit && BLOCKS[hit.id].interact && !p.sneaking;
    if (input.useHeld && def && def.food && !p.creative && p.food < 20 && !interactive) {
      this.eating += dt;
      g.hand.eating = true;
      this.eatSoundTimer -= dt;
      if (this.eatSoundTimer <= 0) {
        this.eatSoundTimer = 0.22;
        g.audio.eat();
        g.particles.eatCrumbs(this.origin, this.dir, held.id);
      }
      if (this.eating >= 1.6) {
        p.eat(def.food);
        p.inventory.removeFromSlot(p.inventory.selected, 1);
        this.eating = 0;
        g.audio.burp();
      }
    } else {
      this.eating = 0;
      g.hand.eating = false;
      if (input.usePressed || (input.useHeld && this.useCooldown <= 0)) {
        if (this.use(hit, held, def, input.usePressed)) this.useCooldown = 0.22;
      }
    }
  }

  updateHighlight(hit) {
    if (!hit) {
      this.highlight.visible = false;
      return;
    }
    const box = BLOCK_SHAPE[hit.id] === SHAPE.CUBE ? [0, 0, 0, 1, 1, 1] : shapeBox(hit.id);
    this.highlight.position.set(hit.x + (box[0] + box[3]) / 2, hit.y + (box[1] + box[4]) / 2, hit.z + (box[2] + box[5]) / 2);
    this.highlight.scale.set(box[3] - box[0] + 0.006, box[4] - box[1] + 0.006, box[5] - box[2] + 0.006);
    this.highlight.visible = true;
  }

  // ---------- mining ----------

  breakTime(id, held) {
    const d = BLOCKS[id];
    if (!d || d.hardness < 0) return Infinity;
    if (d.hardness === 0) return 0.05;
    const tool = held ? itemDef(held.id)?.tool : null;
    let speed = 1;
    if (tool && d.tool && tool.type === d.tool) speed = tool.speed;
    else if (tool && tool.type === 'sword' && (id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES)) speed = 1.5;
    let t = (d.hardness * (this.canHarvest(id, held) ? 1.5 : 5)) / speed;
    if (this.game.player.headInWater) t *= 3;
    return t;
  }

  canHarvest(id, held) {
    const d = BLOCKS[id];
    if (d.level < 0) return true;
    const tool = held ? itemDef(held.id)?.tool : null;
    return !!tool && tool.type === d.tool && tool.tier >= d.level;
  }

  mine(dt, hit, held, pressed) {
    const g = this.game, p = g.player;
    if (p.creative) {
      if (pressed || this.breakCooldown <= 0) {
        this.destroyBlock(hit.x, hit.y, hit.z, false);
        this.breakCooldown = 0.22;
        g.hand.swing();
      }
      return;
    }
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    if (this.breakKey !== key) {
      this.breakKey = key;
      this.breakProgress = 0;
    }
    if (this.swingTimer <= 0) { g.hand.swing(); this.swingTimer = 0.25; }
    const time = this.breakTime(hit.id, held);
    if (!isFinite(time)) return;
    if (this.breakCooldown > 0) return;
    this.breakProgress += dt / time;
    this.breakSoundTimer -= dt;
    if (this.breakSoundTimer <= 0) {
      this.breakSoundTimer = 0.24;
      g.audio.dig(BLOCKS[hit.id].sound, false);
      g.particles.blockHit(hit);
    }
    if (this.breakProgress >= 1) {
      const harvest = this.canHarvest(hit.id, held);
      this.destroyBlock(hit.x, hit.y, hit.z, harvest);
      if (held) {
        const td = itemDef(held.id)?.tool;
        if (td && BLOCKS[hit.id].hardness > 0) g.damageHeldTool(td.type === 'sword' ? 2 : 1);
      }
      p.exhaustion += 0.005;
      this.resetBreak();
      this.breakCooldown = 0.1;
      return;
    }
    const stage = Math.min(9, Math.floor(this.breakProgress * 10));
    this.crackMat.map = this.crackTextures[stage];
    const box = BLOCK_SHAPE[hit.id] === SHAPE.CUBE ? [0, 0, 0, 1, 1, 1] : shapeBox(hit.id);
    this.crack.position.set(hit.x + (box[0] + box[3]) / 2, hit.y + (box[1] + box[4]) / 2, hit.z + (box[2] + box[5]) / 2);
    this.crack.scale.set(box[3] - box[0] + 0.004, box[4] - box[1] + 0.004, box[5] - box[2] + 0.004);
    this.crack.visible = true;
  }

  getDrops(id) {
    const d = BLOCKS[id];
    if (!d || d.drops === null) return [];
    if (typeof d.drops === 'function') return d.drops(Math.random);
    return [{ id: d.drops, count: 1 }];
  }

  // Remove a block with effects, drops and neighbour updates.
  destroyBlock(x, y, z, drops = true, effects = true) {
    const g = this.game, w = g.world;
    const id = w.getBlock(x, y, z);
    if (id === B.AIR || id === B.UNLOADED || id === B.WATER) return false;
    if (w.setBlock(x, y, z, B.AIR) < 0) return false;
    if (effects) {
      g.particles.blockBreak(x, y, z, id);
      g.audio.dig(BLOCKS[id].sound, true);
    }
    if (drops) for (const st of this.getDrops(id)) g.entities.spawnItem(x + 0.5, y + 0.4, z + 0.5, st.id, st.count, st.dur);
    if (id === B.FURNACE || id === B.FURNACE_LIT) g.furnaces.remove(x, y, z, true);
    this.onBlockRemoved(x, y, z);
    return true;
  }

  // ---------- placing / using ----------

  use(hit, held, def, pressed) {
    const g = this.game, p = g.player, w = g.world;
    if (!hit) return false;
    const bdef = BLOCKS[hit.id];
    if (bdef.interact && !p.sneaking) {
      if (!pressed) return false;
      g.openBlockUI(bdef.interact, hit);
      return true;
    }
    if (!held || !def || !def.isBlock) return false;
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    let replacing = false;
    if (BLOCK_REPLACEABLE[hit.id]) { tx = hit.x; ty = hit.y; tz = hit.z; replacing = true; }
    if (ty < 0 || ty >= 128) return false;
    const existing = w.getBlock(tx, ty, tz);
    if (existing === B.UNLOADED || !BLOCK_REPLACEABLE[existing]) return false;
    let place = def.block;
    if (place === B.TORCH) {
      if (replacing || hit.ny === 1) place = B.TORCH;
      else if (hit.ny === -1) return false;
      else place = TORCH_FOR_NORMAL[hit.nx + ',' + hit.ny + ',' + hit.nz];
      if (!place) return false;
    }
    if (!this.supportOK(place, tx, ty, tz)) return false;
    if (BLOCK_SOLID[place]) {
      if (p.intersectsBlock(tx, ty, tz)) return false;
      if (g.entities.blockOccupied(tx, ty, tz)) return false;
    }
    if (existing !== B.AIR && existing !== B.WATER) this.destroyBlock(tx, ty, tz, true, false);
    w.setBlock(tx, ty, tz, place);
    if (!p.creative) p.inventory.removeFromSlot(p.inventory.selected, 1);
    g.audio.place(BLOCKS[place].sound);
    g.hand.swing();
    this.checkFall(tx, ty, tz);
    this.onBlockPlaced(tx, ty, tz);
    return true;
  }

  supportOK(id, x, y, z) {
    const d = BLOCKS[id];
    const w = this.game.world;
    if (!d || !d.support) return true;
    if (d.support === 'ground') {
      const b = w.getBlock(x, y - 1, z);
      return b === B.GRASS || b === B.DIRT || b === B.SNOWY_GRASS;
    }
    if (d.support === 'sand') {
      const b = w.getBlock(x, y - 1, z);
      return id === B.CACTUS ? (b === B.SAND || b === B.CACTUS) : (b === B.SAND || b === B.DIRT);
    }
    if (d.support === 'torch') {
      const o = TORCH_ATTACH[BLOCK_TORCH_DIR[id]];
      const b = w.getBlock(x + o[0], y + o[1], z + o[2]);
      return !!BLOCK_SOLID[b] && BLOCK_SHAPE[b] === SHAPE.CUBE;
    }
    return true;
  }

  attack(mob) {
    if (this.attackCooldown > 0) return;
    const g = this.game, p = g.player;
    const held = p.inventory.selectedStack;
    const tool = held ? itemDef(held.id)?.tool : null;
    let dmg = tool ? tool.damage : 1;
    const crit = !p.onGround && p.vel.y < 0 && !p.inWater && !p.flying;
    if (crit) dmg *= 1.5;
    const dx = mob.pos.x - p.pos.x, dz = mob.pos.z - p.pos.z;
    if (mob.hurt(dmg, dx, dz, p.sprinting ? 9 : 6)) {
      if (crit) g.particles.crit(mob.pos.x, mob.pos.y + mob.height * 0.6, mob.pos.z);
      if (tool && !p.creative) g.damageHeldTool(tool.type === 'sword' ? 1 : 2);
    }
    this.attackCooldown = 0.32;
    this.swingTimer = 0.32;
    g.hand.swing();
    p.exhaustion += 0.1;
  }

  // ---------- block updates ----------

  onBlockPlaced(x, y, z) {
    // A solid block placed under a falling block column, or on top of plants etc.
    this.checkSupport(x, y + 1, z);
  }

  onBlockRemoved(x, y, z) {
    const w = this.game.world;
    this.checkSupport(x, y + 1, z);
    for (const [dx, dz] of H_DIRS) this.checkSupport(x + dx, y, z + dz);
    this.checkFall(x, y + 1, z);
    if (w.getBlock(x, y + 1, z) === B.WATER) this.scheduleWater(x, y, z, 0, 0.25);
    else {
      for (const [dx, dz] of H_DIRS) {
        if (w.getBlock(x + dx, y, z + dz) === B.WATER) { this.scheduleWater(x, y, z, 1, 0.35); break; }
      }
    }
  }

  checkSupport(x, y, z) {
    const id = this.game.world.getBlock(x, y, z);
    const d = BLOCKS[id];
    if (d && d.support && !this.supportOK(id, x, y, z)) this.destroyBlock(x, y, z, true, true);
  }

  checkFall(x, y, z) {
    const g = this.game, w = g.world;
    const id = w.getBlock(x, y, z);
    if (!BLOCKS[id] || !BLOCKS[id].falls) return;
    const below = w.getBlock(x, y - 1, z);
    if (below === B.AIR || (BLOCK_REPLACEABLE[below] && below !== B.UNLOADED)) {
      w.setBlock(x, y, z, B.AIR);
      g.entities.spawnFallingBlock(x, y, z, id);
      this.onBlockRemoved(x, y, z);
    }
  }

  scheduleWater(x, y, z, dist, delay) {
    const key = x + ',' + y + ',' + z;
    if (this.waterPending.has(key) || this.waterQueue.length > 400) return;
    this.waterPending.add(key);
    this.waterQueue.push({ x, y, z, dist, t: delay, key });
  }

  processWater(dt) {
    if (!this.waterQueue.length) return;
    const w = this.game.world;
    const due = [];
    const keep = [];
    for (const e of this.waterQueue) {
      e.t -= dt;
      if (e.t <= 0) due.push(e); else keep.push(e);
    }
    this.waterQueue = keep;
    for (const e of due) {
      this.waterPending.delete(e.key);
      const cur = w.getBlock(e.x, e.y, e.z);
      if (cur !== B.AIR && !(BLOCK_REPLACEABLE[cur] && cur !== B.WATER && cur !== B.UNLOADED)) continue;
      if (cur !== B.AIR) this.destroyBlock(e.x, e.y, e.z, true, false);
      w.setBlock(e.x, e.y, e.z, B.WATER);
      const below = w.getBlock(e.x, e.y - 1, e.z);
      if (below === B.AIR || (BLOCK_REPLACEABLE[below] && below !== B.WATER && below !== B.UNLOADED)) {
        this.scheduleWater(e.x, e.y - 1, e.z, e.dist, 0.2);
      } else if (below !== B.WATER && e.dist < 3) {
        for (const [dx, dz] of H_DIRS) {
          const n = w.getBlock(e.x + dx, e.y, e.z + dz);
          if (n === B.AIR || (BLOCK_REPLACEABLE[n] && n !== B.WATER && n !== B.UNLOADED)) this.scheduleWater(e.x + dx, e.y, e.z + dz, e.dist + 1, 0.45);
        }
      }
    }
  }
}
