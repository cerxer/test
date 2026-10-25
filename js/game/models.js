// Blocky creature models built from boxes with procedural pixel textures.
import * as THREE from '../../lib/three.module.min.js';
import { mulberry32, hashString } from '../engine/noise.js';

const PX = 1 / 16;
const texCache = new Map();
const matCache = new Map();

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

function canvasTex(key, w, h, paint) {
  let tex = texCache.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  paint(ctx, mulberry32(hashString(key)), w, h);
  tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  texCache.set(key, tex);
  return tex;
}

function noisePaint(pal) {
  return (ctx, r, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      ctx.fillStyle = hex(pal[Math.floor(r() * pal.length)]);
      ctx.fillRect(x, y, 1, 1);
    }
  };
}

// Template painter: base noise + template overlay ('.' keeps the base).
function facePaint(pal, rows, colors) {
  return (ctx, r, w, h) => {
    noisePaint(pal)(ctx, r, w, h);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        ctx.fillStyle = hex(colors[ch]);
        ctx.fillRect(x, y, 1, 1);
      }
    });
  };
}

function mat(key, w, h, paint) {
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: canvasTex(key, w, h, paint) });
    matCache.set(key, m);
  }
  return m;
}

// Build a box part. Pivot position (px,py,pz) and mesh offset (ox,oy,oz) are in pixels.
function part(parent, size, mats, pivot, offset = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(pivot[0] * PX, pivot[1] * PX, pivot[2] * PX);
  const geo = new THREE.BoxGeometry(size[0] * PX, size[1] * PX, size[2] * PX);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.position.set(offset[0] * PX, offset[1] * PX, offset[2] * PX);
  g.add(mesh);
  parent.add(g);
  return g;
}

// Head materials with a face on the +Z side.
function headMats(skin, face) {
  return [skin, skin, skin, skin, face, skin];
}

const BUILDERS = {
  cow() {
    const root = new THREE.Group();
    const hide = mat('cow_hide', 16, 16, (ctx, r) => {
      noisePaint([0xf2f2f2, 0xe8e8e8, 0xffffff])(ctx, r, 16, 16);
      ctx.fillStyle = '#2a2420';
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(r() * 14), y = Math.floor(r() * 14), w = 3 + Math.floor(r() * 4), h = 2 + Math.floor(r() * 4);
        ctx.fillRect(x, y, w, h);
      }
    });
    const leg = mat('cow_leg', 4, 8, facePaint([0xf2f2f2, 0xe8e8e8], ['', '', '', '', '', '', 'kkkk', 'kkkk'], { k: 0x3a3530 }));
    const skin = mat('cow_head', 8, 8, noisePaint([0x3a302a, 0x2a2420, 0x4a3e36]));
    const face = mat('cow_face', 8, 8, facePaint([0x3a302a, 0x2a2420],
      ['........', '.ww..ww.', '.wk..kw.', '........', '..pppp..', '.pppppp.', '.pnppnp.', '.pppppp.'],
      { w: 0xffffff, k: 0x111111, p: 0xd8a890, n: 0x6a4a3a }));
    const horn = mat('cow_horn', 2, 2, noisePaint([0xd8d0b8, 0xc8c0a8]));
    const legs = [];
    for (const [x, z] of [[-4, 6], [4, 6], [-4, -7], [4, -7]]) legs.push(part(root, [4, 12, 4], leg, [x, 12, z], [0, -6, 0]));
    const body = part(root, [12, 10, 18], hide, [0, 17, 0]);
    const head = part(root, [8, 8, 6], headMats(skin, face), [0, 20, 9], [0, 0, 3]);
    part(head, [1, 3, 1], horn, [-4.5, 4, 2]);
    part(head, [1, 3, 1], horn, [4.5, 4, 2]);
    return { root, legs, head, body };
  },
  pig() {
    const root = new THREE.Group();
    const pal = [0xf0a0a0, 0xeb9898, 0xf5abab];
    const skin = mat('pig_skin', 8, 8, noisePaint(pal));
    const face = mat('pig_face', 8, 8, facePaint(pal, ['........', '........', '.wk..kw.', '........'], { w: 0xffffff, k: 0x111111 }));
    const snoutM = mat('pig_snout', 4, 3, facePaint([0xe07a8a], ['....', '.k.k', '....'], { k: 0x8a3a4a }));
    const legs = [];
    for (const [x, z] of [[-3, 5], [3, 5], [-3, -5], [3, -5]]) legs.push(part(root, [4, 6, 4], skin, [x, 6, z], [0, -3, 0]));
    const body = part(root, [10, 8, 16], skin, [0, 10, 0]);
    const head = part(root, [8, 8, 8], headMats(skin, face), [0, 11, 8], [0, 1, 4]);
    part(head, [4, 3, 1], snoutM, [0, -0.5, 8.5]);
    return { root, legs, head, body };
  },
  sheep() {
    const root = new THREE.Group();
    const wool = mat('sheep_wool', 16, 16, noisePaint([0xeaeaea, 0xdedede, 0xf6f6f6, 0xd4d4d4]));
    const skinPal = [0xd8c8b0, 0xcdbda5];
    const skin = mat('sheep_skin', 8, 8, noisePaint(skinPal));
    const face = mat('sheep_face', 8, 8, facePaint(skinPal, ['........', '........', '.wk..kw.', '........', '...pp...', '........'], { w: 0xffffff, k: 0x111111, p: 0xc8a8a0 }));
    const legM = mat('sheep_leg', 4, 8, facePaint(skinPal, ['wwww', 'wwww', 'wwww'], { w: 0xeaeaea }));
    const legs = [];
    for (const [x, z] of [[-3, 6], [3, 6], [-3, -6], [3, -6]]) legs.push(part(root, [4, 12, 4], legM, [x, 12, z], [0, -6, 0]));
    const body = part(root, [11, 10, 17], wool, [0, 17, 0]);
    const head = part(root, [6, 6, 8], headMats(skin, face), [0, 19, 8], [0, 0, 3]);
    part(head, [7, 3, 5], wool, [0, 3.5, 1.5]);
    return { root, legs, head, body };
  },
  chicken() {
    const root = new THREE.Group();
    const white = mat('chicken_white', 8, 8, noisePaint([0xf6f6f6, 0xececec, 0xffffff]));
    const face = mat('chicken_face', 4, 6, facePaint([0xf6f6f6], ['....', 'k..k', '....'], { k: 0x111111 }));
    const beak = mat('chicken_beak', 2, 2, noisePaint([0xf0a020, 0xe09018]));
    const wattle = mat('chicken_wattle', 2, 2, noisePaint([0xd02020, 0xc01818]));
    const legM = mat('chicken_leg', 2, 4, noisePaint([0xf0a020]));
    const legs = [];
    for (const x of [-1.5, 1.5]) legs.push(part(root, [1, 5, 1], legM, [x, 5, 0], [0, -2.5, 0]));
    const body = part(root, [6, 6, 8], white, [0, 8, 0]);
    const wings = [part(root, [1, 4, 6], white, [-3.5, 10, 0], [0, -2, 0]), part(root, [1, 4, 6], white, [3.5, 10, 0], [0, -2, 0])];
    const head = part(root, [4, 6, 3], headMats(white, face), [0, 9, 4], [0, 3, 1]);
    part(head, [4, 2, 2], beak, [0, 3.5, 3.5]);
    part(head, [2, 2, 2], wattle, [0, 1.5, 3]);
    return { root, legs, head, body, wings };
  },
  zombie() {
    const root = new THREE.Group();
    const skinPal = [0x5a8a3c, 0x4f7d34, 0x669645];
    const skin = mat('zombie_skin', 8, 8, noisePaint(skinPal));
    const face = mat('zombie_face', 8, 8, facePaint(skinPal,
      ['........', '........', '........', '.kk..kk.', '........', '...nn...', '..mmmm..', '........'],
      { k: 0x1a2a10, n: 0x3a5a28, m: 0x2a3a1e }));
    const shirt = mat('zombie_shirt', 8, 12, noisePaint([0x2ba8a8, 0x259a9a, 0x30b4b4]));
    const pants = mat('zombie_pants', 4, 12, noisePaint([0x3a3aa8, 0x34349a, 0x4040b4]));
    const arm = mat('zombie_arm', 4, 12, facePaint(skinPal, ['ssss', 'ssss', 'ssss', 'ssss'], { s: 0x2ba8a8 }));
    const legs = [part(root, [4, 12, 4], pants, [-2, 12, 0], [0, -6, 0]), part(root, [4, 12, 4], pants, [2, 12, 0], [0, -6, 0])];
    const body = part(root, [8, 12, 4], shirt, [0, 18, 0]);
    const arms = [part(root, [4, 12, 4], arm, [-6, 22, 0], [0, -4, 0]), part(root, [4, 12, 4], arm, [6, 22, 0], [0, -4, 0])];
    const head = part(root, [8, 8, 8], headMats(skin, face), [0, 24, 0], [0, 4, 0]);
    return { root, legs, head, body, arms, armsForward: true };
  },
  skeleton() {
    const root = new THREE.Group();
    const bonePal = [0xc8c8c8, 0xbababa, 0xd4d4d4];
    const bone = mat('skel_bone', 4, 12, facePaint(bonePal, ['', '', '.gg.', '', '', '.gg.', '', '', '.gg.'], { g: 0x8a8a8a }));
    const skull = mat('skel_skull', 8, 8, noisePaint(bonePal));
    const face = mat('skel_face', 8, 8, facePaint(bonePal,
      ['........', '........', '.kk..kk.', '.kk..kk.', '...kk...', '........', '.k.k.k.k', '.kkkkkk.'],
      { k: 0x3a3a3a }));
    const ribs = mat('skel_ribs', 8, 12, facePaint([0x2a2a2a], ['...bb...', 'bbbbbbbb', '...bb...', 'bbbbbbbb', '...bb...', 'bbbbbbbb', '...bb...', '...bb...', '...bb...', '...bb...', 'bbbbbbbb', 'b......b'],
      { b: 0xc8c8c8 }));
    const bow = mat('skel_bow', 2, 8, noisePaint([0x8a6b3e, 0x6b4f2a]));
    const legs = [part(root, [2, 12, 2], bone, [-2, 12, 0], [0, -6, 0]), part(root, [2, 12, 2], bone, [2, 12, 0], [0, -6, 0])];
    const body = part(root, [8, 12, 4], ribs, [0, 18, 0]);
    const arms = [part(root, [2, 12, 2], bone, [-5, 22, 0], [0, -5, 0]), part(root, [2, 12, 2], bone, [5, 22, 0], [0, -5, 0])];
    part(arms[1], [1, 12, 1], bow, [0, -10, 1.5]);
    const head = part(root, [8, 8, 8], headMats(skull, face), [0, 24, 0], [0, 4, 0]);
    return { root, legs, head, body, arms, armsForward: true };
  },
  spider() {
    const root = new THREE.Group();
    const pal = [0x2f2a26, 0x3a332e, 0x262220, 0x4a403a];
    const skin = mat('spider_skin', 8, 8, noisePaint(pal));
    const face = mat('spider_face', 8, 8, facePaint(pal, ['........', '........', '...rr...', '.rr..rr.', '.rr..rr.', '........', '..k..k..', '........'], { r: 0xd02020, k: 0x111111 }));
    const abdomen = mat('spider_abd', 12, 12, (ctx, r) => {
      noisePaint(pal)(ctx, r, 12, 12);
      ctx.fillStyle = '#5a1a1a';
      ctx.fillRect(4, 2, 4, 2);
      ctx.fillRect(5, 5, 2, 4);
    });
    const legM = mat('spider_leg', 16, 2, noisePaint([0x2a2522, 0x3a332e]));
    const body = part(root, [6, 6, 6], skin, [0, 7, 0]);
    const head = part(root, [8, 8, 8], headMats(skin, face), [0, 7, 3], [0, 0, 4]);
    part(root, [10, 8, 12], abdomen, [0, 8, -3], [0, 0, -6]);
    const legs = [];
    const zs = [2, 0.7, -0.7, -2];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const g = part(root, [16, 2, 2], legM, [side * 3, 7, zs[i]], [side * 8, 0, 0]);
        g.rotation.z = side * 0.55;
        g.rotation.y = side * (0.75 - i * 0.5);
        g.userData.baseY = g.rotation.y;
        g.userData.side = side;
        legs.push(g);
      }
    }
    return { root, legs, head, body, spiderLegs: true };
  },
  creeper() {
    const root = new THREE.Group();
    const pal = [0x4db33d, 0x3a8a2e, 0x69c95a, 0x2e6e25, 0x5ac04a];
    const skin = mat('creeper_skin', 8, 12, noisePaint(pal));
    const face = mat('creeper_face', 8, 8, facePaint(pal,
      ['........', '.kk..kk.', '.kk..kk.', '...kk...', '..kkkk..', '..kkkk..', '..k..k..', '........'],
      { k: 0x111111 }));
    const legs = [];
    for (const [x, z] of [[-2, 3], [2, 3], [-2, -3], [2, -3]]) legs.push(part(root, [4, 6, 4], skin, [x, 6, z], [0, -3, 0]));
    const body = part(root, [8, 12, 4], skin, [0, 12, 0]);
    const head = part(root, [8, 8, 8], headMats(skin, face), [0, 18, 0], [0, 4, 0]);
    return { root, legs, head, body };
  },
};

// Builds a model with per-instance materials so mobs can be tinted (hurt flash, local light).
export function buildModel(type) {
  const m = BUILDERS[type]();
  const clones = new Map();
  m.root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((mt) => {
      let c = clones.get(mt);
      if (!c) { c = mt.clone(); clones.set(mt, c); }
      return c;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  m.materials = [...clones.values()];
  return m;
}

export function disposeModel(m) {
  for (const mt of m.materials) mt.dispose();
  m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
}
