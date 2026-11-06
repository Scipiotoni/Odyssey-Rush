// Frozen lakes, shared by server (validation, explosions, breath) and client (collision, rendering).
// In deep winter every inland lake and river freezes over with a slab of ice you can walk and drive on.
// A pickaxe (or a blast) breaks a hole through it; holes freeze back over after ICE_REGEN seconds —
// anyone still swimming underneath is then trapped under the ice.
import { HALF } from './worldgen.js';
import { hash3 } from './noise.js';

export const ICE_TOP = 0.3;      // walking surface (just above the calm lake waves)
export const ICE_BOT = -0.16;    // underside: the ceiling you bump into from below
export const ICE_CELL = 0.75;    // ice is built from cells this size (collision and mesh agree on it)
export const ICE_HOLE_R = 2.2;   // radius of a hole broken by a pickaxe
export const ICE_REGEN = 1200;   // seconds until a hole has frozen over again
export const ICE_HITS = 3;       // pickaxe hits to break through
export const BREATH_MAX = 30;    // seconds of air (at the surface)
// air use per second at a depth (m): x2 at 35 m, x4 at 105 m
export const breathDrain = (depth) => 1 + Math.min(105, Math.max(0, depth)) / 35; // capped at x4 (deep caves)

// lakes freeze a little after the snow arrives and thaw early in spring
export function iceFrozen(si) {
  return (si.season === 3 && si.progress > 0.1) || (si.season === 0 && si.progress < 0.15);
}

const HB = 16; // hole bucket size
const hk = (i, j) => i * 65536 + j;

export class IceField {
  constructor(world) {
    this.world = world;
    this.frozen = false;
    this.holes = [];          // {id, x, z, r, born}
    this.buckets = new Map();
    this.cache = new Map();
    this.rev = 0;             // bumped on any change, so meshes know to rebuild
  }
  setFrozen(f) { if (f !== this.frozen) { this.frozen = f; this.rev++; } }
  setHoles(list) {
    this.holes = list; this.buckets.clear();
    for (const h of list) {
      const r = h.r + 1;
      for (let i = Math.floor((h.x - r) / HB); i <= Math.floor((h.x + r) / HB); i++)
        for (let j = Math.floor((h.z - r) / HB); j <= Math.floor((h.z + r) / HB); j++) {
          const k = hk(i, j); let b = this.buckets.get(k); if (!b) { b = []; this.buckets.set(k, b); } b.push(h);
        }
    }
    this.rev++;
  }
  // inland water (not the sea, which never freezes over)
  inland(x, z) {
    const w = this.world;
    return Math.hypot(x, z) / HALF + w.nCoast.fbm(x / 1700, z / 1700, 3) * 0.16 < 0.7;
  }
  lakeCell(i, j) {
    const k = i * 100003 + j;
    let v = this.cache.get(k);
    if (v === undefined) {
      if (this.cache.size > 300000) this.cache.clear();
      const x = (i + 0.5) * ICE_CELL, z = (j + 0.5) * ICE_CELL;
      v = this.world.ground(x, z) < -0.08 && this.inland(x, z);
      this.cache.set(k, v);
    }
    return v;
  }
  holeCell(i, j) {
    const b = this.buckets.get(hk(Math.floor((i + 0.5) * ICE_CELL / HB), Math.floor((j + 0.5) * ICE_CELL / HB)));
    if (!b) return false;
    const x = (i + 0.5) * ICE_CELL, z = (j + 0.5) * ICE_CELL;
    const jag = (hash3(i, j, 7) - 0.5) * 0.9; // ragged broken edge
    for (const h of b) if ((x - h.x) ** 2 + (z - h.z) ** 2 < (h.r + jag) ** 2) return true;
    return false;
  }
  cellSolid(i, j) { return this.frozen && this.lakeCell(i, j) && !this.holeCell(i, j); }
  solid(x, z) { return this.frozen && this.cellSolid(Math.floor(x / ICE_CELL), Math.floor(z / ICE_CELL)); }
  lakeAt(x, z) { return this.lakeCell(Math.floor(x / ICE_CELL), Math.floor(z / ICE_CELL)); }
  inHole(x, z) { return this.holeCell(Math.floor(x / ICE_CELL), Math.floor(z / ICE_CELL)); }
}
