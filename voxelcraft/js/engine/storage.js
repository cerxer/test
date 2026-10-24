// IndexedDB persistence for worlds and modified chunks (with an in-memory fallback).
import { CHUNK_VOLUME } from './constants.js';

const DB_NAME = 'voxelcraft';
const DB_VERSION = 1;

export function rleEncode(arr) {
  const out = new Uint8Array(arr.length * 2);
  let o = 0;
  let i = 0;
  const n = arr.length;
  while (i < n) {
    const v = arr[i];
    let run = 1;
    while (i + run < n && arr[i + run] === v && run < 255) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

export function rleDecode(enc, size = CHUNK_VOLUME) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) {
    const run = enc[i], v = enc[i + 1];
    out.fill(v, o, o + run);
    o += run;
  }
  return out;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function chunkId(worldId, cx, cz) {
  return worldId + '|' + cx + '|' + cz;
}

export class Storage {
  constructor() {
    this.db = null;
    this.memory = null;
  }

  async open() {
    try {
      if (!('indexedDB' in self) || !indexedDB) throw new Error('IndexedDB unavailable');
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chunks')) {
            const cs = db.createObjectStore('chunks');
            cs.createIndex('world', 'worldId');
          }
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
    } catch (e) {
      console.warn('Falling back to in-memory storage:', e);
      this.memory = { worlds: new Map(), chunks: new Map() };
    }
    return this;
  }

  get persistent() {
    return !!this.db;
  }

  tx(stores, mode = 'readonly') {
    return this.db.transaction(stores, mode);
  }

  async listWorlds() {
    let list;
    if (this.memory) list = [...this.memory.worlds.values()];
    else list = await req(this.tx('worlds').objectStore('worlds').getAll());
    return list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }

  async getWorld(id) {
    if (this.memory) return this.memory.worlds.get(id) || null;
    return (await req(this.tx('worlds').objectStore('worlds').get(id))) || null;
  }

  async saveWorld(meta) {
    const copy = JSON.parse(JSON.stringify(meta));
    if (this.memory) { this.memory.worlds.set(copy.id, copy); return; }
    const t = this.tx('worlds', 'readwrite');
    t.objectStore('worlds').put(copy);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  }

  async deleteWorld(id) {
    if (this.memory) {
      this.memory.worlds.delete(id);
      for (const k of [...this.memory.chunks.keys()]) if (k.startsWith(id + '|')) this.memory.chunks.delete(k);
      return;
    }
    const t = this.tx(['worlds', 'chunks'], 'readwrite');
    t.objectStore('worlds').delete(id);
    const index = t.objectStore('chunks').index('world');
    const cursorReq = index.openKeyCursor(IDBKeyRange.only(id));
    const store = t.objectStore('chunks');
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (c) { store.delete(c.primaryKey); c.continue(); }
    };
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  }

  async getChunkKeys(worldId) {
    const set = new Set();
    if (this.memory) {
      for (const k of this.memory.chunks.keys()) if (k.startsWith(worldId + '|')) {
        const [, cx, cz] = k.split('|');
        set.add(cx + ',' + cz);
      }
      return set;
    }
    const keys = await req(this.tx('chunks').objectStore('chunks').index('world').getAllKeys(IDBKeyRange.only(worldId)));
    for (const k of keys) {
      const [, cx, cz] = String(k).split('|');
      set.add(cx + ',' + cz);
    }
    return set;
  }

  async getChunk(worldId, cx, cz) {
    let rec;
    if (this.memory) rec = this.memory.chunks.get(chunkId(worldId, cx, cz));
    else rec = await req(this.tx('chunks').objectStore('chunks').get(chunkId(worldId, cx, cz)));
    if (!rec) return null;
    return rleDecode(rec.data);
  }

  // list: [{cx, cz, blocks}]
  async putChunks(worldId, list) {
    if (!list.length) return;
    const recs = list.map((c) => ({ key: chunkId(worldId, c.cx, c.cz), value: { worldId, cx: c.cx, cz: c.cz, data: rleEncode(c.blocks) } }));
    if (this.memory) { for (const r of recs) this.memory.chunks.set(r.key, r.value); return; }
    const t = this.tx('chunks', 'readwrite');
    const store = t.objectStore('chunks');
    for (const r of recs) store.put(r.value, r.key);
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  }
}
