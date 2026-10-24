// Swept AABB vs. voxel collision used by the player and all entities.
import { BLOCK_SOLID } from '../engine/blocks.js';

const EPS = 1e-4;

// True if any solid block intersects the box.
export function boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) {
  const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (BLOCK_SOLID[world.getBlock(x, y, z)]) return true;
      }
    }
  }
  return false;
}

// Clamp a movement of `d` along `axis` (0 x, 1 y, 2 z) so that box b does not enter solid blocks.
function sweep(world, b, axis, d) {
  if (d === 0) return 0;
  let minX = b[0], minY = b[1], minZ = b[2], maxX = b[3], maxY = b[4], maxZ = b[5];
  if (axis === 0) { if (d > 0) maxX += d; else minX += d; }
  else if (axis === 1) { if (d > 0) maxY += d; else minY += d; }
  else { if (d > 0) maxZ += d; else minZ += d; }
  const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
  const bmin = b[axis], bmax = b[axis + 3];
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!BLOCK_SOLID[world.getBlock(x, y, z)]) continue;
        const c = axis === 0 ? x : axis === 1 ? y : z;
        if (d > 0) {
          if (c >= bmax - EPS) d = Math.min(d, Math.max(0, c - bmax));
        } else if (c + 1 <= bmin + EPS) {
          d = Math.max(d, Math.min(0, c + 1 - bmin));
        }
      }
    }
  }
  return d;
}

// body: { pos: Vector3 (feet centre), vel: Vector3, hw (half width), h (height) }
// Moves the body and sets onGround / hitX / hitY / hitZ flags.
export function moveBody(world, body, dt, sneakEdges = false) {
  const p = body.pos, v = body.vel, hw = body.hw, h = body.h;
  const b = [p.x - hw, p.y, p.z - hw, p.x + hw, p.y + h, p.z + hw];
  body.hitX = body.hitY = body.hitZ = false;

  const dy = v.y * dt;
  const ry = sweep(world, b, 1, dy);
  const wasGround = body.onGround;
  body.onGround = dy < 0 && ry > dy + 1e-7;
  if (ry !== dy) { body.hitY = true; v.y = 0; }
  b[1] += ry; b[4] += ry;

  let dx = v.x * dt;
  if (sneakEdges && (wasGround || body.onGround) && dx !== 0) {
    while (dx !== 0 && !boxCollides(world, b[0] + dx, b[1] - 0.6, b[2], b[3] + dx, b[1], b[5])) {
      if (Math.abs(dx) < 0.02) dx = 0;
      else dx -= Math.sign(dx) * 0.02;
    }
  }
  if (dx !== v.x * dt) v.x = dt > 0 ? dx / dt : 0;
  const rx = sweep(world, b, 0, dx);
  if (Math.abs(rx - dx) > 1e-9) { body.hitX = true; v.x = 0; }
  b[0] += rx; b[3] += rx;

  let dz = v.z * dt;
  if (sneakEdges && (wasGround || body.onGround) && dz !== 0) {
    while (dz !== 0 && !boxCollides(world, b[0], b[1] - 0.6, b[2] + dz, b[3], b[1], b[5] + dz)) {
      if (Math.abs(dz) < 0.02) dz = 0;
      else dz -= Math.sign(dz) * 0.02;
    }
  }
  if (dz !== v.z * dt) v.z = dt > 0 ? dz / dt : 0;
  const rz = sweep(world, b, 2, dz);
  if (Math.abs(rz - dz) > 1e-9) { body.hitZ = true; v.z = 0; }
  b[2] += rz; b[5] += rz;

  p.set((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
}

// Is a one-block step ahead in direction (dx, dz) climbable with a jump?
export function canStepUp(world, body, dx, dz) {
  const p = body.pos, hw = body.hw;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (dx / len) * 0.4, oz = (dz / len) * 0.4;
  const blocked = boxCollides(world, p.x - hw + ox, p.y + 0.05, p.z - hw + oz, p.x + hw + ox, p.y + 1, p.z + hw + oz);
  if (!blocked) return false;
  return !boxCollides(world, p.x - hw + ox, p.y + 1.05, p.z - hw + oz, p.x + hw + ox, p.y + 1.05 + body.h, p.z + hw + oz);
}
