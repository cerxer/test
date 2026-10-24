// Worker: generates terrain and builds chunk meshes off the main thread.
import { TerrainGenerator } from './terrain.js';
import { meshChunk } from './mesher.js';

let generator = null;
let epoch = 0;

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      generator = new TerrainGenerator(msg.seed);
      epoch = msg.epoch;
      return;
    }
    if (msg.type === 'gen') {
      const blocks = generator.generate(msg.cx, msg.cz);
      self.postMessage({ type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, epoch, blocks }, [blocks.buffer]);
      return;
    }
    if (msg.type === 'mesh') {
      const sections = meshChunk(msg.chunks, msg.maxYs);
      const transfer = [];
      for (const s of sections) {
        if (!s) continue;
        for (const g of [s.opaque, s.water]) {
          if (!g) continue;
          transfer.push(g.pos.buffer, g.uv.buffer, g.data.buffer, g.index.buffer);
        }
      }
      self.postMessage({ type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, epoch, version: msg.version, sections }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.stack || err) });
  }
};
