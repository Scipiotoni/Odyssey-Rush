// The cave layer: a volumetric rock field far below the island (so it never touches the surface terrain).
// rock(x,y,z) > 0 is solid rock, < 0 is open cave. Players carve it with shovels/pickaxes (mods = spheres).
// Shared by the server (digging, loot spots, validation) and the client (meshing, collision).
import { mulberry32 } from './noise.js';

export const CAVE_TOP = -168, CAVE_BOTTOM = -238;   // the band caves live in
export const CAVE_ZONE = -120;                       // below this you're "in the caves"
export const CAVE_ARRIVE = -200;                     // entrances / shafts drop you here
export const CAVE_CELL = 16;                         // mesh chunk size (m)

// ---- 3D simplex noise (Gustavson), seeded
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
function makeNoise3(seed) {
  const rnd = mulberry32(seed >>> 0), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G = 1 / 6;
  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G, x0 = xin - i + t, y0 = yin - j + t, z0 = zin - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const x1 = x0 - i1 + G, y1 = y0 - j1 + G, z1 = z0 - k1 + G, x2 = x0 - i2 + 2 * G, y2 = y0 - j2 + 2 * G, z2 = z0 - k2 + 2 * G, x3 = x0 - 1 + 3 * G, y3 = y0 - 1 + 3 * G, z3 = z0 - 1 + 3 * G;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { g = G3[pm12[ii + perm[jj + perm[kk]]]]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { g = G3[pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { g = G3[pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { g = G3[pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]]; tt *= tt; n += tt * tt * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
    return 32 * n;
  };
}

export class Caves {
  constructor(seed) {
    this.seed = seed;
    this.nA = makeNoise3(seed * 7 + 11); this.nB = makeNoise3(seed * 13 + 5); this.nC = makeNoise3(seed * 3 + 29); this.nO = makeNoise3(seed * 17 + 3);
    this.mods = [];                // [x, y, z, r]
    this.modGrid = new Map();      // cell -> indices
  }
  // ---- player-carved spheres
  addMod(x, y, z, r) {
    const i = this.mods.length;
    this.mods.push([x, y, z, r]);
    const c0 = Math.floor((x - r) / CAVE_CELL), c1 = Math.floor((x + r) / CAVE_CELL), d0 = Math.floor((z - r) / CAVE_CELL), d1 = Math.floor((z + r) / CAVE_CELL);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) { const k = a * 100003 + b; let l = this.modGrid.get(k); if (!l) { l = []; this.modGrid.set(k, l); } l.push(i); }
    return i;
  }
  setMods(list) { this.mods = []; this.modGrid.clear(); for (const m of list || []) this.addMod(m[0], m[1], m[2], m[3]); }
  // ---- the rock field
  base(x, y, z) {
    // band: solid above CAVE_TOP and below CAVE_BOTTOM, with soft edges
    const pen = Math.max(0, (CAVE_BOTTOM + 8 - y) / 5, (y - (CAVE_TOP - 8)) / 5);
    const yy = y * 1.6; // squash vertically: caves are wider than tall
    // spaghetti tunnels: where two noise fields are both near zero
    const a = this.nA(x * 0.018, yy * 0.018, z * 0.018), b = this.nB(x * 0.018 + 31, yy * 0.018, z * 0.018 - 17);
    const tunnel = Math.max(Math.abs(a), Math.abs(b)) - 0.1;
    // big caverns
    const c = this.nC(x * 0.0085, yy * 0.012, z * 0.0085) + this.nC(x * 0.03, yy * 0.03, z * 0.03) * 0.15;
    const cavern = 0.42 - c;
    // flat-ish floors in caverns: rock rises from below near the band bottom
    return Math.min(tunnel * 0.6, cavern * 0.35) + pen * 0.1;
  }
  rock(x, y, z) {
    if (y > CAVE_TOP + 6 || y < CAVE_BOTTOM - 6) return 1;
    let d = this.base(x, y, z);
    const l = this.modGrid.get(Math.floor(x / CAVE_CELL) * 100003 + Math.floor(z / CAVE_CELL));
    if (l) for (const i of l) { const m = this.mods[i]; const dd = (Math.hypot(x - m[0], y - m[1], z - m[2]) - m[3]) * 0.03; if (dd < d) d = dd; }
    return d;
  }
  // ore veins inside the rock: >0.55 metal, < -0.55 sulfur, plus rare crystal pockets
  ore(x, y, z) { return this.nO(x * 0.06, y * 0.06, z * 0.06); }
  crystal(x, y, z) { return this.nO(x * 0.15 + 100, y * 0.15, z * 0.15) > 0.62; }
  // first floor below (x, y, z): highest y' <= y where rock below and air above, or null
  floorBelow(x, y, z, maxDrop = 40) {
    let prev = this.rock(x, y, z);
    for (let d = 0.25; d < maxDrop; d += 0.25) {
      const r = this.rock(x, y - d, z);
      if (r > 0 && prev <= 0) {
        let lo = y - d, hi = y - d + 0.25;
        for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (this.rock(x, m, z) > 0) lo = m; else hi = m; }
        return hi;
      }
      prev = r;
    }
    return null;
  }
}
