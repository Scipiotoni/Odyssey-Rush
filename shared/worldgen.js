// Deterministic procedural world: a 16 km island with biomes, rivers, lakes,
// mountains, resource nodes and points of interest. Used by client & server.
import { Simplex2, hash3, hashRng, clamp, lerp, smoothstep } from './noise.js';

export const WORLD_SIZE = 16000;
export const HALF = WORLD_SIZE / 2;
export const SEA_LEVEL = 0;
export const CHUNK = 128;          // terrain chunk size (m)
export const GRID = 4;             // LOD0 terrain quad size (m)
export const NODE_CELL = 8;        // resource node grid cell (m)
export const POI_CELL = 640;       // POI grid cell (m)
export const BH_CELL = 560;        // blue hole grid cell (m)
export const POI_FLAT = 46;        // radius of flattened POI pad
export const POI_BLEND = 90;       // radius where blending ends

export const BIOME = { OCEAN: 0, BEACH: 1, GRASS: 2, FOREST: 3, DESERT: 4, SWAMP: 5, SNOW: 6, ROCK: 7 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Grasslands', 'Forest', 'Desert', 'Swamp', 'Tundra', 'Mountains'];

// Surface physical properties (used for vehicles, footsteps, particles)
export const SURFACE = {
  [BIOME.OCEAN]: { name: 'sand', grip: 0.55, roll: 0.06, dust: [0.76, 0.70, 0.52] },
  [BIOME.BEACH]: { name: 'sand', grip: 0.6, roll: 0.05, dust: [0.86, 0.79, 0.58] },
  [BIOME.GRASS]: { name: 'grass', grip: 0.92, roll: 0.018, dust: [0.45, 0.42, 0.30] },
  [BIOME.FOREST]: { name: 'dirt', grip: 0.85, roll: 0.025, dust: [0.36, 0.29, 0.20] },
  [BIOME.DESERT]: { name: 'sand', grip: 0.58, roll: 0.055, dust: [0.89, 0.74, 0.50] },
  [BIOME.SWAMP]: { name: 'mud', grip: 0.45, roll: 0.09, dust: [0.25, 0.21, 0.14] },
  [BIOME.SNOW]: { name: 'snow', grip: 0.38, roll: 0.04, dust: [0.95, 0.97, 1.0] },
  [BIOME.ROCK]: { name: 'rock', grip: 1.0, roll: 0.015, dust: [0.55, 0.53, 0.50] },
};
export const SURFACE_BUILT = { name: 'concrete', grip: 1.05, roll: 0.012, dust: [0.6, 0.6, 0.6] };

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
    const s = seed * 7919;
    this.nCoast = new Simplex2(s + 1);
    this.nCont = new Simplex2(s + 2);
    this.nHill = new Simplex2(s + 3);
    this.nDetail = new Simplex2(s + 4);
    this.nMtnMask = new Simplex2(s + 5);
    this.nRidge = new Simplex2(s + 6);
    this.nLake = new Simplex2(s + 7);
    this.nRiver = new Simplex2(s + 8);
    this.nTemp = new Simplex2(s + 9);
    this.nMoist = new Simplex2(s + 10);
    this.nColor = new Simplex2(s + 11);
    this._poiCache = new Map();
    this._hCache = new Map();
    this.mods = new Map(); // terrain edits (digging / explosions): grid key -> height offset
  }

  // ---------- Terrain edits ----------
  static gridKey(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); }
  getMod(ix, iz) { return this.mods.get(World.gridKey(ix, iz)) || 0; }
  setMod(ix, iz, v) {
    const k = World.gridKey(ix, iz);
    if (Math.abs(v) < 1e-3) this.mods.delete(k); else this.mods.set(k, Math.round(v * 100) / 100);
    this._hCache.delete(k);
  }
  modList() {
    const out = [];
    for (const [k, v] of this.mods) out.push([Math.floor(k / 8192) - 4096, (k % 8192) - 4096, v]);
    return out;
  }

  // ---------- Terrain ----------
  rawHeight(x, z) {
    const r = Math.sqrt(x * x + z * z) / HALF;
    const d = r + this.nCoast.fbm(x / 1700, z / 1700, 3) * 0.16;
    const mask = 1 - smoothstep(0.74, 0.96, d);
    const cont = this.nCont.fbm(x / 3200, z / 3200, 3);
    const hill = this.nHill.fbm(x / 650, z / 650, 4);
    const det = this.nDetail.noise(x / 70, z / 70);
    const mtn = smoothstep(0.12, 0.55, this.nMtnMask.fbm(x / 2600 + 50, z / 2600 - 30, 2));
    let h = 10 + cont * 16 + hill * 13 + det * 1.4;
    if (mtn > 0) h += mtn * this.nRidge.ridged(x / 950, z / 950, 4) * 190;
    // lakes
    const ln = this.nLake.fbm(x / 800, z / 800, 2);
    if (ln > 0.5) h -= (ln - 0.5) * 150 * (1 - mtn);
    // rivers
    const rn = Math.abs(this.nRiver.fbm(x / 2300, z / 2300, 3));
    if (rn < 0.04) {
      const carve = smoothstep(0.04, 0.008, rn) * (1 - mtn) * mask;
      if (carve > 0) h = lerp(h, Math.min(h, -2.6), carve);
    }
    if (mask >= 1) return h;
    return Math.max(-114, h * mask + (mask - 1) * 45 + this.seaFloor(x, z, d) * (1 - mask) * (1 - mask));
  }
  // Below the coastal shelf the sea floor drops away into a deep basin with canyons, trenches and
  // seamounts that rise into reefs. Kept above the cave zone (y > -120).
  seaFloor(x, z, d) {
    const deep = smoothstep(0.9, 1.08, d);
    if (deep <= 0) return 0;
    const mount = smoothstep(0.35, 0.75, this.nMtnMask.fbm(x / 900 - 20, z / 900 + 40, 3));
    let extra = -deep * 42 - deep * this.nHill.fbm(x / 300, z / 300, 3) * 6;
    extra -= deep * smoothstep(0.55, 0.95, this.nRidge.ridged(x / 1700, z / 1700, 2)) * 22; // trenches
    extra += deep * mount * 58; // seamounts / reefs
    return Math.max(-70, extra);
  }

  // Height including POI flattening.
  height(x, z) {
    let h = this.rawHeight(x, z);
    const ci = Math.floor((x + HALF) / POI_CELL), cj = Math.floor((z + HALF) / POI_CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const p = this.poiAt(ci + di, cj + dj);
      if (!p) continue;
      const dx = x - p.x, dz = z - p.z;
      const dd = dx * dx + dz * dz;
      if (dd > POI_BLEND * POI_BLEND) continue;
      const t = smoothstep(POI_BLEND, POI_FLAT, Math.sqrt(dd));
      h = lerp(h, p.y, t);
    }
    return h;
  }

  // Height of the rendered (LOD0) triangle mesh at a point. Used for collisions.
  gridH(ix, iz) {
    const key = (ix + 4096) * 8192 + (iz + 4096);
    let v = this._hCache.get(key);
    if (v === undefined) {
      if (this._hCache.size > 400000) this._hCache.clear();
      v = this.height(ix * GRID, iz * GRID) + (this.mods.get(key) || 0);
      this._hCache.set(key, v);
    }
    return v;
  }
  ground(x, z) {
    const gx = x / GRID, gz = z / GRID;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const hb = this.gridH(ix + 1, iz), hc = this.gridH(ix, iz + 1);
    if (fx + fz < 1) {
      const ha = this.gridH(ix, iz);
      return ha + (hb - ha) * fx + (hc - ha) * fz;
    }
    const hd = this.gridH(ix + 1, iz + 1);
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }
  groundNormal(x, z, out = [0, 1, 0]) {
    const e = 0.6;
    const hx = this.ground(x + e, z) - this.ground(x - e, z);
    const hz = this.ground(x, z + e) - this.ground(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  // ---------- Biomes ----------
  temperature(x, z, h) {
    return this.nTemp.fbm(x / 4200, z / 4200, 2) * 0.7 - (z / HALF) * 0.55 - Math.max(0, h - 30) * 0.006;
  }
  moisture(x, z) { return this.nMoist.fbm(x / 2600 + 99, z / 2600, 3); }

  biome(x, z, h = this.height(x, z)) {
    if (h < -1.5) return BIOME.OCEAN;
    if (h < 2.4) return BIOME.BEACH;
    const T = this.temperature(x, z, h);
    const M = this.moisture(x, z);
    if (h > 125 || T < -0.42) return BIOME.SNOW;
    if (h > 75) return BIOME.ROCK;
    if (T > 0.3 && M < 0.05) return BIOME.DESERT;
    if (M > 0.3 && h < 22 && T > -0.2) return BIOME.SWAMP;
    if (M > 0.0) return BIOME.FOREST;
    return BIOME.GRASS;
  }
  surface(x, z) { return SURFACE[this.biome(x, z)]; }

  // Vertex color for terrain [r,g,b]
  color(x, z, h, slope, out) {
    const b = this.biome(x, z, h);
    const v = this.nColor.noise(x / 37, z / 37) * 0.05 + this.nColor.noise(x / 300, z / 300) * 0.05;
    let r, g, bl;
    switch (b) {
      case BIOME.OCEAN: {
        // pale sand in the shallows, sea-grass meadows, dark silt and bare rock in the deep
        const dep = smoothstep(-4, -60, h), grass = smoothstep(0.1, 0.35, this.nColor.noise(x / 60, z / 60)) * (1 - dep) * smoothstep(-2, -6, h);
        r = lerp(0.66, 0.3, dep); g = lerp(0.6, 0.3, dep); bl = lerp(0.44, 0.3, dep);
        r = lerp(r, 0.26, grass); g = lerp(g, 0.42, grass); bl = lerp(bl, 0.2, grass);
        if (slope > 0.5) { const t = smoothstep(0.5, 0.8, slope); r = lerp(r, 0.36, t); g = lerp(g, 0.35, t); bl = lerp(bl, 0.34, t); }
        break;
      }
      case BIOME.BEACH: r = 0.86; g = 0.79; bl = 0.56; break;
      case BIOME.GRASS: r = 0.42; g = 0.62; bl = 0.25; break;
      case BIOME.FOREST: r = 0.25; g = 0.45; bl = 0.18; break;
      case BIOME.DESERT: r = 0.86; g = 0.68; bl = 0.42; break;
      case BIOME.SWAMP: r = 0.30; g = 0.34; bl = 0.18; break;
      case BIOME.SNOW: r = 0.92; g = 0.94; bl = 0.98; break;
      default: r = 0.5; g = 0.48; bl = 0.45;
    }
    if (slope > 0.55 && b !== BIOME.BEACH && b !== BIOME.OCEAN) {
      const t = smoothstep(0.55, 0.85, slope);
      const rr = b === BIOME.DESERT ? 0.68 : b === BIOME.SNOW ? 0.6 : 0.45;
      r = lerp(r, rr, t); g = lerp(g, rr * 0.95, t); bl = lerp(bl, rr * 0.88, t);
    }
    // POI pads look dirt-ish
    const p = this.nearestPOI(x, z);
    if (p && p.d < POI_FLAT + 5) { const t = smoothstep(POI_FLAT + 5, POI_FLAT - 15, p.d) * 0.7; r = lerp(r, 0.48, t); g = lerp(g, 0.44, t); bl = lerp(bl, 0.38, t); }
    out[0] = clamp(r + v, 0, 1); out[1] = clamp(g + v, 0, 1); out[2] = clamp(bl + v, 0, 1);
    return out;
  }

  // ---------- Blue holes: sinkholes in the sea floor that drop into the flooded caves below ----------
  blueHoleAt(ci, cj) {
    const key = 'bh' + ci + '_' + cj;
    this._bhCache = this._bhCache || new Map();
    if (this._bhCache.has(key)) return this._bhCache.get(key);
    let h = null;
    if (hash3(ci, cj, 71, this.seed) < 0.45) {
      const x = ci * BH_CELL + BH_CELL * 0.25 + hash3(ci, cj, 72, this.seed) * BH_CELL * 0.5, z = cj * BH_CELL + BH_CELL * 0.25 + hash3(ci, cj, 73, this.seed) * BH_CELL * 0.5;
      const y = this.rawHeight(x, z), np = this.nearestPOI(x, z);
      if (y < -26 && y > -112 && (!np || np.d > 90)) h = { id: key, x, z, y, r: 9 };
    }
    this._bhCache.set(key, h);
    return h;
  }
  blueHolesNear(x, z, R = 1) {
    const ci = Math.floor(x / BH_CELL), cj = Math.floor(z / BH_CELL), out = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const h = this.blueHoleAt(ci + i, cj + j); if (h) out.push(h); }
    return out;
  }

  // ---------- Points of interest ----------
  poiAt(ci, cj) {
    const n = WORLD_SIZE / POI_CELL;
    if (ci < 0 || cj < 0 || ci >= n || cj >= n) return null;
    const key = ci * 1000 + cj;
    if (this._poiCache.has(key)) return this._poiCache.get(key);
    let poi = null;
    const rng = hashRng(ci, cj, 31, this.seed);
    if (rng() < 0.55) {
      const x = -HALF + (ci + 0.5) * POI_CELL + (rng() - 0.5) * (POI_CELL - 220);
      const z = -HALF + (cj + 0.5) * POI_CELL + (rng() - 0.5) * (POI_CELL - 220);
      // sample flatness
      const y = this.rawHeight(x, z);
      let ok = y > 4 && y < 95;
      if (ok) {
        for (let a = 0; a < 8 && ok; a++) {
          const hx = this.rawHeight(x + Math.cos(a) * 40, z + Math.sin(a) * 40);
          if (hx < 1.5) ok = false;
        }
      }
      if (ok) {
        const r = rng();
        let type = r < 0.26 ? 'ruins' : r < 0.44 ? 'gas' : r < 0.58 ? 'farm' : r < 0.70 ? 'radio' : r < 0.82 ? 'military' : 'junkyard';
        // newer monument types (decided by a separate hash so positions and the old types' layouts don't move)
        const h = hash3(ci, cj, 55, this.seed);
        if (h < 0.45) type = NEW_POIS[Math.floor((h / 0.45) * NEW_POIS.length)];
        poi = { id: `${ci}_${cj}`, ci, cj, x, z, y: y + 0.3, yaw: Math.floor(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.6, type };
        poi.name = poiName(type, ci, cj, this.seed);
      }
      // out at sea: sunken sites on the sea floor (decided by their own hash so land POIs don't move)
      else if (y < -14 && y > -55 && hash3(ci, cj, 63, this.seed) < 0.7) {
        const type = SEA_POIS[Math.floor(hash3(ci, cj, 64, this.seed) * SEA_POIS.length)];
        poi = { id: `${ci}_${cj}`, ci, cj, x, z, y: y + 0.3, yaw: hash3(ci, cj, 65, this.seed) * Math.PI * 2, type, sea: true };
        poi.name = poiName(type, ci, cj, this.seed);
      }
    }
    this._poiCache.set(key, poi);
    return poi;
  }
  nearestPOI(x, z) {
    const ci = Math.floor((x + HALF) / POI_CELL), cj = Math.floor((z + HALF) / POI_CELL);
    let best = null, bd = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const p = this.poiAt(ci + di, cj + dj);
      if (!p) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { poi: best, d: bd } : null;
  }
  allPOIs() {
    const n = WORLD_SIZE / POI_CELL, out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const p = this.poiAt(i, j); if (p) out.push(p); }
    return out;
  }

  // Layout of a POI: props (static colliders), loot spots and vehicle spots, in WORLD coords.
  poiLayout(poi) {
    if (poi._layout) return poi._layout;
    const rng = hashRng(poi.ci, poi.cj, 77, this.seed);
    const props = [], loot = [], vehicles = [];
    const c = Math.cos(poi.yaw), s = Math.sin(poi.yaw);
    const W = (lx, lz) => [poi.x + lx * c + lz * s, poi.z - lx * s + lz * c];
    const box = (lx, ly, lz, sx, sy, sz, color, yaw = 0) => {
      const [x, z] = W(lx, lz);
      props.push({ k: 'box', x, y: poi.y + ly, z, sx, sy, sz, color, yaw: poi.yaw + yaw });
    };
    const cyl = (lx, ly, lz, r, h, color) => { const [x, z] = W(lx, lz); props.push({ k: 'cyl', x, y: poi.y + ly, z, r, h, color }); };
    const lootAt = (lx, lz, tier, ly = 0) => { const [x, z] = W(lx, lz); loot.push({ x, y: poi.y + ly, z, tier, yaw: poi.yaw }); };
    const vehAt = (lx, lz, yaw, type) => { const [x, z] = W(lx, lz); vehicles.push({ x, z, yaw: poi.yaw + yaw, type }); };
    const CONC = 0x8a8780, RUST = 0x8a5a3a, WOOD = 0x7a5534, DARK = 0x444444, OLIVE = 0x5b6b3a, RED = 0xa03a2a, WHITE = 0xd8d4cc;
    // a ruined building with walls of random heights and a doorway gap
    const ruinBuilding = (bx, bz, w, d, hMax, color, roof) => {
      const t = 0.4;
      const wallSeg = (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 3));
        for (let i = 0; i < n; i++) {
          if (rng() < 0.15) continue;
          const f = (i + 0.5) / n, cx = x0 + (x1 - x0) * f, cz = z0 + (z1 - z0) * f;
          const h = hMax * (0.35 + rng() * 0.65);
          const yaw = Math.atan2(x1 - x0, z1 - z0);
          box(bx + cx, h / 2, bz + cz, t, h, len / n, color, yaw);
        }
      };
      wallSeg(-w / 2, -d / 2, w / 2, -d / 2); wallSeg(w / 2, -d / 2, w / 2, d / 2);
      wallSeg(w / 2, d / 2, -w / 2, d / 2); wallSeg(-w / 2, d / 2, -w / 2, -d / 2);
      if (roof) box(bx, hMax + 0.15, bz, w, 0.3, d, color);
    };
    switch (poi.type) {
      case 'ruins': {
        const n = 3 + Math.floor(rng() * 4);
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2, r = 8 + rng() * 26;
          const bx = Math.cos(a) * r, bz = Math.sin(a) * r, w = 6 + rng() * 6, d = 6 + rng() * 6;
          ruinBuilding(bx, bz, w, d, 3 + rng() * 4, rng() < 0.5 ? CONC : 0x9a8f7f, false);
          lootAt(bx, bz, rng() < 0.2 ? 2 : 1);
        }
        for (let i = 0; i < 6; i++) box((rng() - 0.5) * 70, 0.4, (rng() - 0.5) * 70, 1 + rng() * 2, 0.8, 1 + rng() * 2, 0x777068, rng() * 3);
        if (rng() < 0.7) vehAt((rng() - 0.5) * 50, 38, rng() * 6, ['buggy', 'quad', 'suv'][Math.floor(rng() * 3)]);
        break;
      }
      case 'gas': {
        for (const [px, pz] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) box(px, 2.5, pz, 0.5, 5, 0.5, WHITE);
        box(0, 5.2, 0, 15, 0.5, 11, RED);
        box(-2.5, 0.7, 0, 1, 1.4, 0.6, DARK); box(2.5, 0.7, 0, 1, 1.4, 0.6, DARK);
        // shop
        box(0, 2, 15, 14, 0.4, 0.4, CONC); // decorative trim
        box(-7, 2, 19, 0.4, 4, 8, CONC); box(7, 2, 19, 0.4, 4, 8, CONC);
        box(0, 2, 23, 14, 4, 0.4, CONC);
        box(-4.5, 2, 15, 5, 4, 0.4, CONC); box(4.5, 2, 15, 5, 4, 0.4, CONC); box(0, 3.4, 15, 4, 1.2, 0.4, CONC);
        box(0, 4.15, 19, 14.4, 0.3, 8.4, 0x6b6b6b);
        lootAt(-3, 20, 1); lootAt(4, 21, 2); lootAt(10, -8, 1);
        vehAt(-14, 0, 0.2, ['truck', 'buggy', 'suv'][Math.floor(rng() * 3)]);
        if (rng() < 0.5) vehAt(14, 10, 1.4, 'quad');
        break;
      }
      case 'farm': {
        // barn
        box(-10, 3.5, 0, 0.4, 7, 14, RED); box(10, 3.5, 0, 0.4, 7, 14, RED);
        box(0, 3.5, -7, 20, 7, 0.4, RED);
        box(-6.5, 3.5, 7, 7, 7, 0.4, RED); box(6.5, 3.5, 7, 7, 7, 0.4, RED); box(0, 6, 7, 6, 2, 0.4, RED);
        box(-5.2, 8.1, 0, 11.2, 0.35, 14.6, DARK, 0); props[props.length - 1].roll = 0.5;
        box(5.2, 8.1, 0, 11.2, 0.35, 14.6, DARK, 0); props[props.length - 1].roll = -0.5;
        cyl(18, 6, -4, 3, 12, 0xb8b8b0); cyl(18, 12.5, -4, 3.2, 1, 0x888888);
        for (let i = -4; i <= 4; i++) { box(i * 5, 0.6, 30, 0.2, 1.2, 5, WOOD, Math.PI / 2); box(-25, 0.6, i * 5 + 8, 0.2, 1.2, 5, WOOD); }
        box(-4, 0.6, -2, 2, 1.2, 1.2, 0xc8b060); box(-4, 0.6, 0.5, 2, 1.2, 1.2, 0xc8b060);
        lootAt(0, -3, 1); lootAt(6, 3, 1); lootAt(18, 2, 1);
        vehAt(-20, -12, 0.8, 'truck');
        break;
      }
      case 'radio': {
        const H = 34;
        for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(px * 0.9, H / 2, pz * 0.9, 0.3, H, 0.3, 0xb0b0b0);
        for (let y = 4; y < H; y += 5) { box(0, y, -1.8, 3.6, 0.2, 0.2, 0xb0b0b0); box(0, y, 1.8, 3.6, 0.2, 0.2, 0xb0b0b0); box(-1.8, y, 0, 0.2, 0.2, 3.6, 0xb0b0b0); box(1.8, y, 0, 0.2, 0.2, 3.6, 0xb0b0b0); }
        box(0, H + 0.5, 0, 0.8, 1, 0.8, RED);
        // bunker
        box(10, 1.5, 0, 0.5, 3, 8, CONC); box(18, 1.5, 0, 0.5, 3, 8, CONC); box(14, 1.5, 4, 8.5, 3, 0.5, CONC);
        box(11.8, 1.5, -4, 4, 3, 0.5, CONC); box(16.8, 1.5, -4, 2.8, 3, 0.5, CONC); box(14, 3.15, 0, 8.5, 0.3, 8.5, CONC);
        lootAt(14, 1, 2); lootAt(15.5, 2, 2); lootAt(-5, 6, 1);
        if (rng() < 0.5) vehAt(-16, -10, 0.4, rng() < 0.5 ? 'buggy' : 'suv');
        break;
      }
      case 'military': {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (i === 0) continue; box(Math.cos(a) * 24, 0.6, Math.sin(a) * 24, 1.2, 1.2, 12, OLIVE, -a); }
        for (const [tx, tz] of [[-8, -6], [8, -6], [0, 8]]) { box(tx, 1.4, tz, 5, 2.8, 7, OLIVE); box(tx, 2.9, tz, 5.4, 0.2, 7.4, 0x4b5a30); lootAt(tx, tz, rng() < 0.5 ? 3 : 2); }
        for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) box(16 + px, 3.5, 14 + pz, 0.3, 7, 0.3, WOOD);
        box(16, 7.1, 14, 3.6, 0.2, 3.6, WOOD); box(16, 7.7, 15.7, 3.6, 1, 0.2, WOOD); box(16, 7.7, 12.3, 3.6, 1, 0.2, WOOD);
        box(-14, 1.3, 10, 6, 2.6, 2.4, 0x5c6b4a); box(-14, 1.3, 13, 6, 2.6, 2.4, 0x4a5a6b);
        lootAt(16, 14, 3, 7.2);
        vehAt(-12, -16, 0.3, rng() < 0.5 ? 'truck' : 'suv');
        break;
      }
      case 'lighthouse': {
        // striped tower with a lantern room, keeper's cottage, fuel shed and a jetty
        for (let i = 0; i < 9; i++) cyl(0, i * 2.4, 0, 3.2 - i * 0.18, 2.5, i % 2 ? RED : WHITE);
        cyl(0, 21.8, 0, 2.2, 0.4, DARK);
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; box(Math.cos(a) * 1.9, 23.4, Math.sin(a) * 1.9, 0.15, 3, 0.15, DARK); }
        cyl(0, 22.2, 0, 1.6, 2.6, 0xf2e8a0); cyl(0, 25, 0, 2.2, 0.5, RED); cyl(0, 25.5, 0, 1.2, 0.8, RED);
        box(0, 21.9, 0, 5.6, 0.2, 5.6, 0x6a6a6a);
        ruinBuilding(12, 4, 8, 6, 3.2, WHITE, true); box(12, 3.6, 4, 9, 0.3, 7, RED);
        box(-10, 1.2, 6, 3, 2.4, 3, 0x6e6e6e); cyl(-10, 0, 10, 0.9, 1.4, RED);
        for (let i = 0; i < 6; i++) box(0, 0.5, -10 - i * 3, 3, 0.25, 3, WOOD);
        for (let i = 0; i < 4; i++) { box(-1.6, 0.4, -11 - i * 4, 0.3, 1.8, 0.3, WOOD); box(1.6, 0.4, -11 - i * 4, 0.3, 1.8, 0.3, WOOD); }
        lootAt(12, 4, 2); lootAt(0, 0, 1, 22.1); lootAt(-10, 6, 1);
        break;
      }
      case 'crash': {
        // a broken cargo plane: fuselage sections, torn wings, tail fin, scattered cargo and scorched ground
        const AL = 0xa8acb0, ALD = 0x7a7e82, SOOT = 0x2a2624;
        box(0, 2.2, 0, 4.2, 4.2, 12, AL); box(0, 2.6, 7.5, 3.6, 3.6, 4, AL, 0.08); box(0, 2.9, 10.6, 2.6, 2.6, 3, ALD, 0.12); // nose
        box(0.5, 1.8, -11, 4, 3.6, 8, AL, 0.35); props[props.length - 1].roll = 0.18;                              // broken rear section
        box(1.5, 4.8, -15.5, 0.4, 5, 4, AL, 0.35);                                                                    // tail fin
        box(10, 1.0, 1, 14, 0.5, 4, AL, -0.08); props[props.length - 1].roll = -0.12;                                // right wing
        box(-9, 0.6, -2, 9, 0.5, 3.6, ALD, 0.3); props[props.length - 1].roll = 0.3;                                 // torn left wing
        cyl(8, 0, 4, 1.1, 1.8, 0x3a3a3a); cyl(-7, 0, 1, 1.1, 1.8, SOOT);                                              // engines
        for (let i = 0; i < 10; i++) box((rng() - 0.5) * 34, 0.6, (rng() - 0.5) * 34, 1.2 + rng(), 1.2, 1.2 + rng(), [0x6a5a3a, 0x4a5a3a, 0x8a6a3a][i % 3], rng() * 3);
        for (let i = 0; i < 8; i++) box((rng() - 0.5) * 24, 0.06, (rng() - 0.5) * 30, 2 + rng() * 3, 0.1, 2 + rng() * 3, SOOT, rng() * 3);
        lootAt(0, 1, 3, 0.3); lootAt(0, -4, 3, 0.3); lootAt(9, -6, 2); lootAt(-12, 8, 2);
        break;
      }
      case 'cabin': {
        // log cabin with porch and chimney, outhouse, woodpile, a hunter's stand
        const LOG = 0x6a4a2a, LOGL = 0x8a6038;
        for (let i = 0; i < 6; i++) { box(0, 0.25 + i * 0.5, -4, 10, 0.5, 0.5, i % 2 ? LOG : LOGL); box(0, 0.25 + i * 0.5, 4, 10, 0.5, 0.5, i % 2 ? LOGL : LOG); box(-5, 0.25 + i * 0.5, 0, 0.5, 0.5, 8, i % 2 ? LOG : LOGL); if (i < 2 || i > 3) box(5, 0.25 + i * 0.5, -2.5, 0.5, 0.5, 3, i % 2 ? LOGL : LOG); box(5, 0.25 + i * 0.5, 2.5, 0.5, 0.5, 3, i % 2 ? LOG : LOGL); }
        box(-2.6, 3.6, 0, 5.8, 0.25, 9.4, DARK); props[props.length - 1].roll = 0.45; box(2.6, 3.6, 0, 5.8, 0.25, 9.4, DARK); props[props.length - 1].roll = -0.45;
        box(-3.5, 3.4, -3.2, 1, 3.4, 1, 0x7a7068);                                            // chimney
        box(7, 0.2, 0, 4, 0.2, 8, LOGL); for (const z of [-3.6, 3.6]) box(8.8, 1.3, z, 0.25, 2.4, 0.25, LOG); box(7, 2.5, 0, 4.2, 0.2, 8.4, DARK);
        box(-9, 1.2, 7, 1.6, 2.4, 1.6, LOG); box(-9, 2.5, 7, 1.9, 0.2, 1.9, DARK);
        for (let i = 0; i < 3; i++) box(-8, 0.3 + i * 0.4, -6, 3, 0.4, 1.2, LOGL);
        for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(14 + px, 2.5, 8 + pz, 0.2, 5, 0.2, WOOD);
        box(14, 5.1, 8, 2.6, 0.2, 2.6, WOOD); box(14, 5.6, 9.2, 2.6, 0.8, 0.15, WOOD);
        lootAt(0, 0, 2); lootAt(-3, 2, 1); lootAt(14, 8, 2, 5.2);
        break;
      }
      case 'mine': {
        // a mine cut into a rocky hill: timber-framed entrance (leads into the caves), rails, carts, ore heaps, shed
        const ROCK = 0x9a948a, ROCKD = 0x847e74;
        for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3; box(Math.sin(a) * 14, 3 + (i % 3), -10 + Math.cos(a) * 4 - 6, 6 + rng() * 3, 6 + (i % 3) * 2, 6, i % 2 ? ROCK : ROCKD, a); }
        box(0, 3, -14, 10, 7, 6, ROCKD);
        box(-2, 2, -10.8, 0.5, 4, 0.5, WOOD); box(2, 2, -10.8, 0.5, 4, 0.5, WOOD); box(0, 4.2, -10.8, 5, 0.5, 0.6, WOOD);
        box(0, 2, -11.3, 3.5, 4, 0.3, 0x0c0b0a);                                                                         // dark adit
        for (let i = 0; i < 8; i++) box(0, 0.08, -9 + i * 2.2, 2.2, 0.12, 0.35, WOOD);
        box(-0.6, 0.15, 0, 0.12, 0.12, 18, 0x5a5a5a); box(0.6, 0.15, 0, 0.12, 0.12, 18, 0x5a5a5a);
        box(0, 0.7, -3, 1.4, 0.9, 2, RUST); box(0, 0.7, 4, 1.4, 0.9, 2, RUST);
        for (let i = 0; i < 4; i++) box(8 + i * 2, 0.5, 6 + (i % 2) * 2, 2.4, 1 + rng(), 2.4, i % 2 ? 0xa87a4a : 0x8a8a2a, rng() * 3);
        ruinBuilding(-12, 6, 7, 6, 3, WOOD, true);
        lootAt(-12, 6, 2); lootAt(2, -8, 2); lootAt(10, 9, 1);
        props.push({ k: 'cave', ...Object.fromEntries([['x', W(0, -10.2)[0]], ['z', W(0, -10.2)[1]]]), y: poi.y, yaw: poi.yaw });
        break;
      }
      case 'bunker': {
        // half-buried command bunker: blast walls, sandbags, a blast door, antenna mast, watch posts
        for (let i = 0; i < 4; i++) box(0, 1.6, -6 + i * 4, 14, 3.2, 0.6, CONC); box(-7, 1.6, 0, 0.6, 3.2, 12.6, CONC); box(7, 1.6, 2, 0.6, 3.2, 8.6, CONC);
        box(0, 3.4, 0, 15, 0.5, 13, 0x6a6862); box(0, 4.0, 0, 13, 0.7, 11, 0x5a6a3a);                                // roof + turf
        box(7.2, 1.6, -4.4, 0.3, 3, 2.6, 0x4a4e52);                                                                      // blast door
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; box(Math.cos(a) * 18, 0.45, Math.sin(a) * 18, 2.4, 0.9, 1, 0xa8946a, -a); }
        box(-3, 9, 3, 0.3, 10, 0.3, 0x9a9a9a); box(-3, 14.2, 3, 2.4, 0.15, 0.15, 0x9a9a9a); box(-3, 13, 3, 0.15, 0.15, 2.4, 0x9a9a9a);
        for (const [tx, tz] of [[15, 15], [-15, -15]]) { for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(tx + px, 2.5, tz + pz, 0.25, 5, 0.25, OLIVE); box(tx, 5.1, tz, 2.6, 0.2, 2.6, OLIVE); box(tx, 5.6, tz + 1.2, 2.6, 1, 0.15, OLIVE); }
        lootAt(0, -2, 3); lootAt(-4, 4, 3); lootAt(4, 4, 2); lootAt(15, 15, 2, 5.2);
        vehAt(-14, 12, 0.6, rng() < 0.4 ? 'hauler' : 'truck');
        break;
      }
      case 'village': {
        // a handful of roofed houses around a well, fences and a little church tower
        const houses = [[-14, -10], [12, -12], [-16, 10], [14, 12], [0, 18]];
        houses.forEach(([hx, hz], i) => { const w = 6 + rng() * 2, d = 6 + rng() * 2; ruinBuilding(hx, hz, w, d, 3, [WHITE, 0xc8b89a, 0x9ab0a8][i % 3], true); box(hx, 3.5, hz, w + 0.6, 0.3, d + 0.6, [RED, DARK, 0x7a4a2a][i % 3]); lootAt(hx, hz, rng() < 0.25 ? 2 : 1); });
        cyl(0, 0, 0, 1.3, 1, 0x8a8680); box(-1.2, 1.6, 0, 0.2, 2.2, 0.2, WOOD); box(1.2, 1.6, 0, 0.2, 2.2, 0.2, WOOD); box(0, 2.7, 0, 2.8, 0.2, 0.4, WOOD);
        ruinBuilding(0, -22, 7, 10, 5, 0xd8d0c0, true); box(0, 7, -26, 3, 6, 3, 0xd8d0c0); cyl(0, 10, -26, 1.2, 2, RED);
        for (let i = -3; i <= 3; i++) { box(i * 4, 0.5, 28, 0.15, 1, 4, WOOD, Math.PI / 2); box(-28, 0.5, i * 4, 0.15, 1, 4, WOOD); }
        lootAt(0, -22, 2);
        if (rng() < 0.6) vehAt(20, 0, 1.2, ['buggy', 'suv', 'truck'][Math.floor(rng() * 3)]);
        break;
      }
      case 'observatory': {
        // round building with a big dome and a tilted telescope, solar panels, a dish
        cyl(0, 0, 0, 7, 5, WHITE); cyl(0, 5, 0, 7.3, 0.4, 0x8a8a8a);
        for (let i = 0; i < 5; i++) cyl(0, 5.4 + i * 0.9, 0, 6.8 - i * i * 0.26, 0.9, 0xd8dcdc);
        box(0, 8.6, 0, 1.6, 0.4, 7, 0x2a2a2a);                                                                              // dome slit
        box(0, 9.6, 1.5, 1.2, 1.2, 6, 0x3a3e44, 0); props[props.length - 1].roll = 0.0;
        for (let i = 0; i < 6; i++) { box(-16 + (i % 3) * 4, 1.2, 10 + Math.floor(i / 3) * 4, 3.4, 0.12, 2, 0x1e2a4a, 0); props[props.length - 1].roll = 0.5; box(-16 + (i % 3) * 4, 0.55, 10 + Math.floor(i / 3) * 4, 0.2, 1.1, 0.2, 0x9a9a9a); }
        box(14, 3, -8, 0.4, 6, 0.4, 0x9a9a9a); cyl(14, 6, -8, 3, 0.5, WHITE);
        ruinBuilding(12, 8, 6, 5, 3, CONC, true);
        lootAt(0, 2, 3); lootAt(-3, -3, 2); lootAt(12, 8, 2);
        break;
      }
      case 'shipwreck': {
        // a rusting freighter on its side: hull plates, bridge tower, spilled containers, mast
        const HULL = 0x7a3a2a, HULLD = 0x5a2a1e;
        for (let i = 0; i < 6; i++) { box(0, 3.2, -20 + i * 7, 9, 6.4, 7.2, i % 2 ? HULL : HULLD, 0); props[props.length - 1].roll = 0.25; }
        box(1.5, 0.6, 20, 6, 1.2, 6, HULLD, 0.3);                                                                          // bow
        box(-1, 8.5, -15, 6, 5, 6, WHITE, 0); props[props.length - 1].roll = 0.25; box(-1.6, 11.4, -15, 4, 1.2, 4, 0x2a3a4a, 0); props[props.length - 1].roll = 0.25;
        box(-2, 12, 5, 0.4, 14, 0.4, 0x8a8a8a, 0); props[props.length - 1].roll = 0.25;
        const cols = [0x2e5d8a, 0x8a2e2e, 0x2e8a5d, 0xd8a030, 0x6a6a6a];
        for (let i = 0; i < 9; i++) box(10 + (rng() - 0.5) * 12, 1.3 + (i % 3 === 2 ? 2.6 : 0), (rng() - 0.5) * 34, 2.6, 2.6, 6, cols[i % cols.length], rng() * 3);
        lootAt(0, -2, 2, 0.4); lootAt(-1, -15, 3, 6.4); lootAt(10, 6, 2);
        break;
      }
      // ---- under the sea
      case 'sunken_ship': {
        // an old three-masted ship broken in two on the sea floor, cargo spilled around it
        const WD = 0x4a3a2a, WD2 = 0x3a2e22, MOSS = 0x3a5a3a;
        for (let i = 0; i < 5; i++) { box(0, 2.4 - i * 0.1, -16 + i * 6.2, 7.5 - Math.abs(i - 2) * 0.8, 4.8, 6, i % 2 ? WD : WD2, 0); props[props.length - 1].roll = 0.18; }
        box(0.5, 1.6, 15, 4, 3.2, 5, WD2, 0.35); props[props.length - 1].roll = -0.3;                               // the broken bow
        box(0, 5.4, -14, 6, 1.2, 6, WD, 0); props[props.length - 1].roll = 0.18;                                        // sterncastle
        for (const [mz, mh, lean] of [[-8, 13, 0.2], [2, 15, 0.45], [15, 9, 1.0]]) { box(1.2 + lean * 3, mh / 2 + 2, mz, 0.5, mh, 0.5, WD2, 0); props[props.length - 1].roll = lean; }
        box(4, 0.4, -4, 9, 0.8, 1.6, MOSS, 0.4);
        for (let i = 0; i < 7; i++) box(8 + (rng() - 0.5) * 10, 0.5, (rng() - 0.5) * 30, 1.2, 1, 1.2, i % 2 ? 0x6a4a2a : 0x5a5a52, rng() * 3); // barrels and chests
        lootAt(0, -12, 3, 0.4); lootAt(1, 3, 2, 0.4); lootAt(9, 8, 2);
        break;
      }
      case 'sunken_ruins': {
        // a drowned temple: a stepped platform, rings of columns (some toppled), arches and statues
        const MARB = 0xb8b2a2, MARBD = 0x8a8678;
        box(0, 0.6, 0, 24, 1.2, 18, MARBD); box(0, 1.5, 0, 18, 0.6, 12, MARB);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2, x = Math.cos(a) * 8, z = Math.sin(a) * 5;
          if (rng() < 0.3) { box(x * 1.5, 0.6, z * 1.6, 1.1, 1.1, 6, MARB, a + 1.2); continue; } // toppled
          cyl(x, 1.8 + 3, z, 0.55, 6, MARB);
        }
        box(0, 8.3, 0, 18, 1.0, 1.4, MARB); box(0, 9.2, 0, 6, 0.8, 1.2, MARBD);
        for (const sx of [-1, 1]) { box(sx * 16, 3, 10, 1.2, 6, 1.2, MARB); box(sx * 16, 3, 14, 1.2, 6, 1.2, MARB); box(sx * 16, 6.4, 12, 1.2, 0.8, 5.2, MARB); }
        box(0, 3, -4, 1.4, 3, 1.4, MARBD); box(0, 5, -4, 1, 1, 1, MARB);                                                 // a worn statue
        lootAt(0, 0, 2, 1.8); lootAt(-6, 3, 1, 1.8); lootAt(16, 12, 2);
        break;
      }
      case 'sunken_sub': {
        // a war-era submarine resting at an angle: hull, conning tower, periscope, torn hatch
        const SUB = 0x3a4448, SUBD = 0x2a3236;
        for (let i = 0; i < 7; i++) { const r = 2.6 - Math.abs(i - 3) * 0.35; box(0, r + 0.2, -21 + i * 7, r * 2, r * 2, 7.1, i % 2 ? SUB : SUBD, 0); props[props.length - 1].roll = 0.12; box(0, r * 1.7 + 0.2, -21 + i * 7, r * 1.4, r * 0.8, 7.1, SUB, 0); }
        box(0, 6.8, -2, 2.6, 3.6, 7, SUB); cyl(0.6, 10.5, -3, 0.15, 4, 0x6a6a6a);
        box(0, 0.6, 26, 1.4, 1.2, 4, SUBD, 0.2);
        for (let i = 0; i < 4; i++) box(5 + rng() * 6, 0.4, -10 + rng() * 20, 1.4, 0.8, 0.9, 0x5a5a52, rng() * 3);
        lootAt(0, -2, 3, 5); lootAt(5, 8, 2);
        break;
      }
      case 'sunken_plane': {
        // a cargo plane that ditched at sea: fuselage, a broken wing, tail fin, scattered containers
        const AL = 0x8a9096, ALD = 0x5a6066;
        for (let i = 0; i < 5; i++) { box(0, 2.2, -12 + i * 5.5, 4.4, 4.2, 5.6, i % 2 ? AL : ALD, 0.04 * i); box(0, 4.5, -12 + i * 5.5, 3.2, 0.6, 5.6, AL, 0.04 * i); }
        box(9, 1.2, -2, 14, 0.5, 4, AL, 0.1); props[props.length - 1].roll = 0.12;
        box(-6, 0.6, 2, 7, 0.4, 3.5, ALD, -0.5); props[props.length - 1].roll = -0.3;
        box(0, 6, -13, 0.4, 5, 3.5, AL);
        for (let i = 0; i < 5; i++) box((rng() - 0.5) * 24, 1.3, 14 + rng() * 10, 2.6, 2.6, 6, [0x2e5d8a, 0x8a2e2e, 0xd8a030][i % 3], rng() * 3);
        lootAt(0, -4, 2, 0.4); lootAt(0, 4, 3, 0.4); lootAt(-4, 18, 1);
        break;
      }
      case 'junkyard': {
        for (let i = -2; i <= 2; i++) box(i * 12, 1.5, -30, 12, 3, 0.3, 0x6e6e6e);
        for (let i = -2; i <= 2; i++) box(i * 12, 1.5, 30, 12, 3, 0.3, 0x6e6e6e);
        const keep = [[-8, 18], [10, 20], [-20, -18], [18, 5], [-18, 10], [5, -22], [22, 0]];
        for (let i = 0; i < 10; i++) {
          const x = (rng() - 0.5) * 50, z = (rng() - 0.5) * 40, yaw = rng() * 3;
          if (keep.some(([kx, kz]) => Math.hypot(kx - x, kz - z) < 7)) continue;
          const st = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < st; k++) box(x + (rng() - 0.5) * 0.5, 0.7 + k * 1.35, z, 2, 1.3, 4.2, [RUST, 0x6a7a8a, 0x8a3a3a, 0x7a7a5a][Math.floor(rng() * 4)], yaw + (rng() - 0.5) * 0.3);
        }
        box(22, 1.3, 0, 2.6, 2.6, 6, 0x2e5d8a); box(22, 3.9, 0.5, 2.6, 2.6, 6, 0x8a2e2e);
        lootAt(18, 5, 2); lootAt(-18, 10, 1); lootAt(5, -22, 2);
        vehAt(-8, 18, 1.2, 'buggy'); vehAt(10, 20, 0.1, 'truck'); vehAt(-20, -18, 2.4, rng() < 0.5 ? 'quad' : 'suv');
        break;
      }
    }
    poi._layout = { props, loot, vehicles };
    return poi._layout;
  }

  // ---------- Resource nodes ----------
  // Returns list of nodes for a terrain chunk. Each: {id, type, x, y, z, s (scale), rot}
  chunkNodes(cx, cz) {
    const out = [];
    const per = CHUNK / NODE_CELL;
    for (let i = 0; i < per; i++) for (let j = 0; j < per; j++) {
      const rng = hashRng(cx * per + i, cz * per + j, 7, this.seed);
      const r = rng();
      if (r > 0.55) continue; // nothing in most cells; densities below sum < 0.55
      const x = cx * CHUNK + (i + 0.15 + rng() * 0.7) * NODE_CELL;
      const z = cz * CHUNK + (j + 0.15 + rng() * 0.7) * NODE_CELL;
      const h = this.height(x, z);
      if (h < 0.6) continue;
      const p = this.nearestPOI(x, z);
      if (p && p.d < POI_FLAT + 8) continue;
      const b = this.biome(x, z, h);
      const type = pickNode(b, r);
      if (!type) continue;
      const slope = 1 - this.groundNormal(x, z)[1];
      if (slope > 0.35 && !type.startsWith('rock')) continue;
      out.push({ id: `${cx}_${cz}_${i * per + j}`, type, x, y: this.ground(x, z), z, s: 0.8 + rng() * 0.6, rot: rng() * Math.PI * 2 });
    }
    return out;
  }
  nodeById(id) {
    const [cx, cz, idx] = id.split('_').map(Number);
    if (!Number.isFinite(idx)) return null;
    return this.chunkNodes(cx, cz).find((n) => n.id === id) || null;
  }

  // Random spawn on a beach
  randomSpawn(rnd = Math.random) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rnd() * Math.PI * 2;
      for (let r = HALF * 0.98; r > HALF * 0.5; r -= 8) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = this.height(x, z);
        if (h > 1.2) {
          // go a bit further inland
          const x2 = Math.cos(a) * (r - 20), z2 = Math.sin(a) * (r - 20);
          const h2 = this.ground(x2, z2);
          if (h2 > 1) return [x2, h2 + 1, z2];
          break;
        }
      }
    }
    return [0, this.ground(0, 0) + 2, 0];
  }
}

// Biome -> node density table [type, cumulative probability threshold]
const NODE_TABLE = {
  [BIOME.BEACH]: [['loose_rock', 0.07], ['branch', 0.09], ['tree_palm', 0.115], ['rock_stone', 0.125], ['barrel', 0.128], ['hemp', 0.14]],
  [BIOME.GRASS]: [['loose_rock', 0.025], ['branch', 0.04], ['tree_oak', 0.09], ['rock_stone', 0.115], ['rock_metal', 0.125], ['rock_sulfur', 0.13], ['hemp', 0.17], ['berry', 0.19], ['barrel', 0.193]],
  [BIOME.FOREST]: [['loose_rock', 0.02], ['branch', 0.07], ['tree_oak', 0.29], ['tree_pine', 0.43], ['rock_stone', 0.46], ['rock_metal', 0.475], ['rock_sulfur', 0.48], ['hemp', 0.505], ['berry', 0.535], ['barrel', 0.537]],
  [BIOME.DESERT]: [['loose_rock', 0.03], ['cactus', 0.065], ['rock_stone', 0.1], ['rock_metal', 0.115], ['rock_sulfur', 0.14], ['barrel', 0.144]],
  [BIOME.SWAMP]: [['loose_rock', 0.02], ['branch', 0.05], ['tree_dead', 0.15], ['hemp', 0.21], ['rock_stone', 0.22], ['berry', 0.24], ['barrel', 0.243]],
  [BIOME.SNOW]: [['loose_rock', 0.03], ['branch', 0.05], ['tree_pine', 0.19], ['rock_stone', 0.23], ['rock_metal', 0.255], ['rock_sulfur', 0.27]],
  [BIOME.ROCK]: [['loose_rock', 0.05], ['rock_stone', 0.11], ['rock_metal', 0.15], ['rock_sulfur', 0.175], ['tree_pine', 0.19]],
};
function pickNode(b, r) {
  const t = NODE_TABLE[b];
  if (!t) return null;
  for (const [type, th] of t) if (r < th) return type;
  return null;
}

const NAME_A = ['Old', 'North', 'Rusty', 'Silent', 'Broken', 'Grey', 'Lost', 'Dusty', 'Red', 'Iron', 'Cold', 'Hollow', 'Black', 'Stone', 'Wild', 'Crooked'];
const SEA_POIS = ['sunken_ship', 'sunken_ruins', 'sunken_sub', 'sunken_plane'];
const NEW_POIS = ['lighthouse', 'crash', 'cabin', 'mine', 'bunker', 'village', 'observatory', 'shipwreck'];
export const POI_TYPES = ['ruins', 'gas', 'farm', 'radio', 'military', 'junkyard', ...NEW_POIS];
const NAME_B = { lighthouse: ['Lighthouse', 'Beacon', 'Light'], crash: ['Crash Site', 'Wreck', 'Air Disaster'], cabin: ['Ranger Cabin', 'Hunting Lodge', 'Lookout'], mine: ['Mine', 'Quarry', 'Dig Site'], bunker: ['Bunker', 'Command Post', 'Silo'], village: ['Village', 'Hamlet', 'Settlement'], observatory: ['Observatory', 'Station', 'Array'], shipwreck: ['Shipwreck', 'Hulk', 'Beached Freighter'], ruins: ['Ruins', 'Township', 'Village', 'Outskirts'], gas: ['Gas Stop', 'Fuel Depot', 'Service Station'], farm: ['Farm', 'Ranch', 'Homestead'], radio: ['Radio Tower', 'Relay', 'Antenna'], military: ['Outpost', 'Checkpoint', 'Base'], junkyard: ['Junkyard', 'Scrapyard', 'Salvage'], sunken_ship: ['Galleon Wreck', 'Sunken Ship', 'Lost Frigate'], sunken_ruins: ['Drowned Temple', 'Sunken City', 'Old Sanctum'], sunken_sub: ['Submarine Wreck', 'Lost Sub', 'U-Boat Grave'], sunken_plane: ['Ditched Cargo Plane', 'Sunken Airlifter', 'Flight 7 Wreck'] };
function poiName(type, ci, cj, seed) {
  const a = NAME_A[Math.floor(hash3(ci, cj, 5, seed) * NAME_A.length)];
  const list = NAME_B[type];
  return `${a} ${list[Math.floor(hash3(ci, cj, 6, seed) * list.length)]}`;
}

export function chunkKey(cx, cz) { return `${cx},${cz}`; }
export function chunkOf(x, z) { return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]; }
