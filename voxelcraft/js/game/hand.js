// First-person held item / arm, rendered in its own overlay scene.
import * as THREE from '../../lib/three.module.min.js';
import { BLOCKS, BLOCK_SHAPE, SHAPE, T } from '../engine/blocks.js';
import { itemDef, ICON_CANVAS } from './items.js';

export class Hand {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.ambient = new THREE.AmbientLight(0xffffff, Math.PI * 0.62);
    this.light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.45);
    this.light.position.set(-0.4, 1, 0.7);
    this.scene.add(this.ambient, this.light);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.itemKey = null;
    this.mesh = null;
    this.materials = [];
    this.swingT = 1;
    this.eating = false;
    this.eatT = 0;
    this.equipT = 1;
    this.brightness = 1;
    this.lightTimer = 0;
    this.texCache = new Map();
  }

  resize(aspect, fov) {
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  iconTexture(id) {
    let t = this.texCache.get(id);
    if (!t) {
      t = new THREE.CanvasTexture(ICON_CANVAS.get(id));
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      this.texCache.set(id, t);
    }
    return t;
  }

  setItem(stack) {
    const id = stack ? stack.id : 0;
    if (id === this.itemKey) return;
    this.itemKey = id;
    this.equipT = 0;
    if (this.mesh) {
      this.holder.remove(this.mesh);
      this.mesh.geometry.dispose();
      for (const m of this.materials) m.dispose();
    }
    this.materials = [];
    const def = id ? itemDef(id) : null;
    let mesh;
    if (!def) {
      const m = new THREE.MeshLambertMaterial({ color: 0xd9a37c });
      this.materials = [m];
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.7), m);
      mesh.position.set(0.38, -0.38, -0.42);
      mesh.rotation.set(0.25, -0.15, 0.1);
      this.base = { x: 0.38, y: -0.38, z: -0.42, rx: 0.25, ry: -0.15, rz: 0.1 };
    } else if (def.isBlock && (BLOCK_SHAPE[id] === SHAPE.CUBE || BLOCK_SHAPE[id] === SHAPE.CACTUS)) {
      const tex = this.game.textures;
      this.materials = BLOCKS[id].faceTiles.map((t) => new THREE.MeshLambertMaterial({ map: tex.canvasTexture(T[t]), alphaTest: 0.3 }));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), this.materials);
      this.base = { x: 0.42, y: -0.38, z: -0.62, rx: 0.1, ry: 0.78, rz: 0 };
    } else {
      const m = new THREE.MeshLambertMaterial({ map: this.iconTexture(id), alphaTest: 0.5, side: THREE.DoubleSide });
      this.materials = [m];
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), m);
      this.base = { x: 0.44, y: -0.3, z: -0.72, rx: 0.05, ry: -1.05, rz: 0.3 };
    }
    this.mesh = mesh;
    this.holder.add(mesh);
  }

  swing() {
    if (this.swingT > 0.6) this.swingT = 0;
  }

  update(dt, player) {
    this.setItem(player.inventory.selectedStack);
    this.swingT = Math.min(1, this.swingT + dt / 0.28);
    this.equipT = Math.min(1, this.equipT + dt / 0.2);
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      const target = this.game.lightLevelAt(player.pos.x, player.pos.y + player.currentEye, player.pos.z);
      this.brightness = target;
    }
    for (const m of this.materials) m.color.setScalar(this.brightness * (this.itemKey ? 1 : 1));
    if (!this.itemKey && this.materials[0]) this.materials[0].color.setRGB(0.85 * this.brightness, 0.64 * this.brightness, 0.49 * this.brightness);

    const b = this.base;
    const bob = this.game.settings.viewBobbing ? player.bobAmount : 0;
    const ph = player.bobPhase;
    let x = b.x + Math.sin(ph) * 0.025 * bob;
    let y = b.y - Math.abs(Math.cos(ph)) * 0.03 * bob - (1 - this.equipT) * 0.4;
    let z = b.z;
    let rx = b.rx, ry = b.ry, rz = b.rz;
    if (this.swingT < 1) {
      const s = Math.sin(this.swingT * Math.PI);
      const s2 = Math.sin(Math.sqrt(this.swingT) * Math.PI);
      x -= s2 * 0.18;
      y += Math.sin(Math.sqrt(this.swingT) * Math.PI * 2) * 0.1 - s * 0.05;
      z -= s * 0.12;
      rx -= s * 0.9;
      ry += s2 * 0.35;
    }
    if (this.eating) {
      this.eatT += dt;
      x -= 0.18;
      y += 0.08 + Math.abs(Math.sin(this.eatT * 14)) * 0.04;
      rx += 0.3;
    } else this.eatT = 0;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(rx, ry, rz);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
