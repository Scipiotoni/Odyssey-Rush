// The underground: one volumetric rock field from the surface down to bedrock. Below the ground it's solid, except for
// branching tunnels at every depth (which break out of hillsides as cave mouths in some areas), ravines cutting down from
// the surface, caverns, and the deep cavern band at the bottom. rock(x,y,z) > 0 is solid, < 0 open. Players dig it
// anywhere (mods: carve spheres, or fill with a negative radius). Where it opens the surface the terrain gets a hole and
// the cave mesh takes over (quadOpen).
// Shared by the server (digging, loot spots, validation) and the client (meshing, collision).
import { mulberry32 } from './noise.js';

export const CAVE_TOP = -168, CAVE_BOTTOM = -238;   // the band caves live in
export const CAVE_ZONE = -120;                       // below this you're "in the caves"
export const CAVE_ARRIVE = -200;                     // entrances / shafts drop you here
export const CAVE_CELL = 16;                         // mesh chunk size (m)
export const LAVA_Y = -226;                          // the deepest caverns floor out in lava
export const QUAD = 4;                               // terrain grid quad (matches worldgen GRID)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// digging layers by depth below the surface: [name, depth from, hardness, colour]
export const LAYERS = [['Topsoil', 0, 1, [0.36, 0.27, 0.17]], ['Clay', 5, 0.85, [0.55, 0.36, 0.22]], ['Stone', 18, 0.68, [0.46, 0.44, 0.42]], ['Deepstone', 60, 0.5, [0.28, 0.29, 0.33]]];
export function layerAt(depth) { let L = LAYERS[0]; for (const l of LAYERS) if (depth >= l[1]) L = l; return L; }

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
    this.nM = makeNoise3(seed * 19 + 7); this.nK = makeNoise3(seed * 23 + 13); this.nR = makeNoise3(seed * 29 + 1);
    this.surface = null;  // (x, z) => ground height (set by client/server: world.ground)
    this.openCache = new Map();
    this.seaAbove = null; // (x, z) => true where the sea lies above: those caves are flooded
    this.mods = [];                // [x, y, z, r]
    this.modGrid = new Map();      // cell -> indices
  }
  // ---- player-carved spheres
  addMod(x, y, z, r) {
    const i = this.mods.length;
    // forget cached surface holes near it
    const R = Math.abs(r) + QUAD;
    for (let a = Math.floor((x - R) / QUAD); a <= Math.floor((x + R) / QUAD); a++) for (let b = Math.floor((z - R) / QUAD); b <= Math.floor((z + R) / QUAD); b++) this.openCache?.delete(a * 100003 + b);
    this.mods.push([x, y, z, r]);
    const ar = Math.abs(r), c0 = Math.floor((x - ar) / CAVE_CELL), c1 = Math.floor((x + ar) / CAVE_CELL), d0 = Math.floor((z - ar) / CAVE_CELL), d1 = Math.floor((z + ar) / CAVE_CELL);
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
  // natural field (no player edits)
  natural(x, y, z, s) {
    if (y < CAVE_BOTTOM - 6) return 1;
    const depth = s - y;
    if (depth < -2) return -1;                  // open air above the ground
    let d = depth * 0.12;
    if (y > CAVE_TOP - 4) {
      // spaghetti tunnels at every depth, a little wider the deeper you go
      const yy = y * 1.4;
      const a = this.nA(x * 0.026, yy * 0.026, z * 0.026), b = this.nB(x * 0.026 + 51, yy * 0.026, z * 0.026 - 27);
      let t = (Math.max(Math.abs(a), Math.abs(b)) - (0.07 + 0.05 * smooth(15, 100, depth))) * 0.6;
      // a solid crust near the surface, except where the hills have cave mouths
      const mouth = smooth(0.34, 0.5, this.nO(x * 0.0035, 3.3, z * 0.0035));
      t += smooth(6, 0.5, depth) * 0.35 * (1 - mouth);
      // ravines: long cracks cut down from the surface in some regions
      const rmask = smooth(0.38, 0.55, this.nR(x * 0.0007 + 40, 2.1, z * 0.0007));
      if (rmask > 0 && depth < 45) {
        const rv = Math.abs(this.nR(x * 0.0016, 0.5, z * 0.0016)), Dr = 20 + 22 * rmask;
        t = Math.min(t, (rv - 0.016 * rmask * smooth(Dr, Dr * 0.3, depth)) * 6);
      }
      // big caverns at middle depths
      if (depth > 30) t = Math.min(t, (0.52 - this.nC(x * 0.011, yy * 0.016, z * 0.011)) * 0.3 + smooth(42, 30, depth) * 0.25);
      d = Math.min(d, t);
    }
    if (y < CAVE_TOP + 8) d = Math.min(d, this.base(x, y, z));
    return d;
  }
  rock(x, y, z) {
    const s = this.surface ? this.surface(x, z) : 1e9;
    if (!this.surface && (y > CAVE_TOP + 6 || y < CAVE_BOTTOM - 6)) return 1;
    let d = this.natural(x, y, z, s);
    const l = this.modGrid.get(Math.floor(x / CAVE_CELL) * 100003 + Math.floor(z / CAVE_CELL));
    if (l) for (const i of l) {
      const m = this.mods[i], dd = (Math.hypot(x - m[0], y - m[1], z - m[2]) - Math.abs(m[3])) * 0.03;
      if (m[3] >= 0) { if (dd < d) d = dd; } else if (-dd > d) d = -dd; // carve or fill
    }
    return d;
  }
  // does the ground have a hole in this terrain quad (so the cave mesh is drawn there instead of the heightfield)?
  quadOpen(i, j) {
    const k = i * 100003 + j;
    let v = this.openCache.get(k);
    if (v === undefined) {
      if (this.openCache.size > 200000) this.openCache.clear();
      v = false;
      for (const [fx, fz] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
        const x = (i + fx) * QUAD, z = (j + fz) * QUAD, s = this.surface(x, z);
        if (this.rock(x, s - 0.5, z) < 0) { v = true; break; }
      }
      this.openCache.set(k, v);
    }
    return v;
  }
  open(x, z) { return !!this.surface && this.quadOpen(Math.floor(x / QUAD), Math.floor(z / QUAD)); }
  // is (x,y,z) inside the underground volume (use the rock field for collision) rather than on the heightfield?
  inVolume(x, y, z) {
    if (!this.surface) return y < CAVE_ZONE;
    const s = this.surface(x, z);
    return y < s - 0.4 || (y < s + 1.6 && this.open(x, z));
  }
  depthAt(x, y, z) { return this.surface ? this.surface(x, z) - y : 0; }
  // underground lakes: some regions have a water table in their caves
  lakeLevel(x, z) {
    const R = 192, i = Math.floor(x / R), j = Math.floor(z / R);
    const k = 'L' + i + '_' + j;
    this._lakes = this._lakes || new Map();
    let v = this._lakes.get(k);
    if (v === undefined) {
      const h = this.nM(i * 7.31 + 0.5, 91.7, j * 3.17 + 0.5) * 0.5 + 0.5;
      v = h < 0.32 && this.surface ? this.surface((i + 0.5) * R, (j + 0.5) * R) - 28 - h * 90 : -Infinity;
      if (v < CAVE_TOP + 10) v = -Infinity;
      this._lakes.set(k, v);
    }
    return v;
  }
  // ore veins inside the rock: >0.55 metal, < -0.55 sulfur, plus rare crystal pockets
  ore(x, y, z) { return this.nO(x * 0.06, y * 0.06, z * 0.06); }
  // the newer minerals: copper and titanium veins, lithium seams, quartz pockets; in the flooded caves under the
  // sea lithium is richer and the quartz pockets are blue kyanite instead
  mineral(x, y, z) {
    const a = this.nM(x * 0.07, y * 0.07, z * 0.07), b = this.nK(x * 0.06 + 50, y * 0.06, z * 0.06), wet = this.flooded(x, z);
    if (a > 0.58) return 'copper_ore';
    if (a < -0.6) return 'titanium_ore';
    if (b > (wet ? 0.5 : 0.63)) return 'lithium_ore';
    if (b < -0.64) return wet ? 'kyanite' : 'quartz';
    return null;
  }
  flooded(x, z) { return !!this.seaAbove && this.seaAbove(x, z); }
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
