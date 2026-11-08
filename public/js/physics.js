// Client-side collision world: spatial hash of static colliders (boxes & cylinders),
// player movement resolution and raycasting.
import { rayOBB, invRotY, rotY } from '/shared/building.js';
import { CAVE_ZONE } from '/shared/caves.js';
import { ICE_TOP, ICE_BOT } from '/shared/ice.js';

// marker for 'standing on lake ice' (lastSurf): slippery for feet and tyres
export const ICE_SURF = { ice: true };

const CELL = 8;
const ck = (i, j) => i * 100003 + j;

export class Physics {
  constructor(world) {
    this.world = world;
    this.cells = new Map();
    this.groups = new Map(); // group key -> colliders[]
    this.dynamic = [];       // per-frame dynamic colliders (vehicles)
    this._stamp = 0;
  }

  // collider: {t:'box', x,y,z,hx,hy,hz,yaw, ref} | {t:'cyl', x,y,z,r,h, ref}
  add(group, c) {
    let list = this.groups.get(group);
    if (!list) { list = []; this.groups.set(group, list); }
    list.push(c);
    const rad = c.t === 'box' ? Math.hypot(c.hx, c.hz) : c.r;
    c.rad = rad;
    c.cells = [];
    const i0 = Math.floor((c.x - rad) / CELL), i1 = Math.floor((c.x + rad) / CELL);
    const j0 = Math.floor((c.z - rad) / CELL), j1 = Math.floor((c.z + rad) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = ck(i, j);
      let cell = this.cells.get(k);
      if (!cell) { cell = []; this.cells.set(k, cell); }
      cell.push(c); c.cells.push(k);
    }
    return c;
  }
  removeGroup(group) {
    const list = this.groups.get(group);
    if (!list) return;
    for (const c of list) for (const k of c.cells) {
      const cell = this.cells.get(k);
      if (!cell) continue;
      const i = cell.indexOf(c);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) this.cells.delete(k);
    }
    this.groups.delete(group);
  }
  removeCollider(group, c) {
    const list = this.groups.get(group);
    if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
    for (const k of c.cells) { const cell = this.cells.get(k); if (cell) { const i = cell.indexOf(c); if (i >= 0) cell.splice(i, 1); } }
  }

  query(x, z, r, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = this.cells.get(ck(i, j));
      if (!cell) continue;
      for (const c of cell) if (c._s !== stamp) { c._s = stamp; out.push(c); }
    }
    for (const c of this.dynamic) if (Math.abs(c.x - x) < r + c.rad && Math.abs(c.z - z) < r + c.rad) out.push(c);
    return out;
  }

  // Highest walkable surface at (x,z) not more than `maxUp` above y.
  groundAt(x, z, y, maxUp = 0.55, r = 0.0, ignore = null) {
    if (this.caves && this.caves.inVolume(x, y, z)) {
      // cave floor, or anything solid down there (the big sub's deck, structures you built)
      let g = this.caves.floorBelow(x, y + maxUp, z, maxUp + 6) ?? -1e6, surf = null;
      for (const c of this.query(x, z, r + 0.5, this._q1 || (this._q1 = []))) {
        if (c.ghost || c.t !== 'box' || (ignore && (c.ref === ignore || (c.ref && c.ref.veh && c.ref.veh === ignore.id)))) continue;
        const [lx, lz] = invRotY(x - c.x, z - c.z, c.yaw);
        if (Math.abs(lx) > c.hx + r || Math.abs(lz) > c.hz + r) continue;
        const top = c.y + c.hy;
        if (top <= y + maxUp && top > g) { g = top; surf = c; }
      }
      this.lastSurf = surf;
      return g;
    }
    let g = this.world.ground(x, z), surf = null;
    const list = this.query(x, z, r + 0.5, this._q1 || (this._q1 = []));
    for (const c of list) {
      if (c.ghost || (ignore && (c.ref === ignore || (c.ref && c.ref.veh && c.ref.veh === ignore.id)))) continue;
      if (c.t === 'box') {
        const [lx, lz] = invRotY(x - c.x, z - c.z, c.yaw);
        if (Math.abs(lx) > c.hx + r || Math.abs(lz) > c.hz + r) continue;
        const top = c.y + c.hy;
        if (top <= y + maxUp && top > g) { g = top; surf = c; }
      } else {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 > (c.r + r) ** 2) continue;
        const top = c.y + c.h;
        if (top <= y + maxUp && top > g) { g = top; surf = c; }
      }
    }
    // frozen lake
    const ice = this.ice;
    if (ice && ice.frozen && ICE_TOP <= y + maxUp && ICE_TOP > g && ice.solid(x, z)) { g = ICE_TOP; surf = ICE_SURF; }
    this.lastSurf = surf;
    return g;
  }
  // the ice slab as a solid: climbing onto it from a hole is a ledge, swimming into it from below is a ceiling
  _iceResolve(p, vel, h, px, pz, res) {
    const ice = this.ice;
    if (!ice || !ice.frozen || p.y >= ICE_TOP - 0.001 || p.y + h <= ICE_BOT || !ice.solid(p.x, p.z)) return;
    if (ICE_TOP - p.y < 0.4 && vel.y <= 1) { p.y = ICE_TOP; if (vel.y < 0) vel.y = 0; res.ground = true; return; }
    const fromHole = !ice.solid(px, pz);
    if (fromHole && p.y + h > ICE_BOT + 0.25) {
      // the edge of the hole: a wall at head height
      p.x = px; p.z = pz; res.wall = true; return;
    }
    // under the ice: the head stays below its underside
    p.y = ICE_BOT - h; if (vel.y > 0) vel.y = 0; res.ceiling = true; res.underIce = true;
  }

  // Resolve a vertical-cylinder body (feet position p, radius r, height h) against colliders.
  // Returns {ground:boolean, ceiling:boolean}. Mutates p and vel.
  moveBody(p, vel, r, h, dt, stepH = 0.55, ignore = null) {
    const res = { ground: false, ceiling: false };
    if (this.caves && this.caves.inVolume(p.x, p.y, p.z)) return this.caveMove(p, vel, r, h, dt, stepH, res);
    const steps = Math.max(1, Math.ceil((Math.hypot(vel.x, vel.z) * dt) / (r * 0.8)));
    const sdt = dt / steps;
    const list = this._q2 || (this._q2 = []);
    for (let s = 0; s < steps; s++) {
      const px = p.x, pz = p.z;
      p.x += vel.x * sdt; p.z += vel.z * sdt; p.y += vel.y * sdt;
      this._iceResolve(p, vel, h, px, pz, res);
      this.query(p.x, p.z, r + 2, list);
      for (let it = 0; it < 2; it++) {
        for (const c of list) {
          if (c.ghost || (c.ref && ignore && (c.ref === ignore || (c.ref.veh && c.ref.veh === ignore.id)))) continue;
          if (c.t === 'box') this._boxResolve(p, vel, r, h, c, stepH, res);
          else this._cylResolve(p, vel, r, h, c, stepH, res);
        }
      }
      const g = this.groundAt(p.x, p.z, p.y, stepH * (res.ground || vel.y <= 0 ? 1 : 0.1), r * 0.5, ignore);
      if (p.y <= g + 0.001) {
        if (vel.y <= 0.01 || g - p.y < stepH) { p.y = g; if (vel.y < 0) vel.y = 0; res.ground = true; }
      }
    }
    return res;
  }
  // Movement inside the cave rock field: push out of walls along the density gradient, step up small ledges.
  caveMove(p, vel, r, h, dt, stepH, res) {
    const C = this.caves, rock = (x, y, z) => C.rock(x, y, z);
    const steps = Math.max(1, Math.ceil((Math.hypot(vel.x, vel.y, vel.z) * dt) / 0.2));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      p.x += vel.x * sdt; p.y += vel.y * sdt; p.z += vel.z * sdt;
      // walls: at knee, chest and head height, estimate the distance to the rock from the field and its slope and push
      // straight out by exactly the overlap (smooth: no stepping back and forth against curved walls)
      const E = 0.12;
      for (const yo of [stepH + 0.05, h * 0.55, h - 0.1]) {
        for (let it = 0; it < 2; it++) {
          const y = p.y + yo, v = rock(p.x, y, p.z);
          if (v < -0.2) break; // well clear
          const gx = (rock(p.x + E, y, p.z) - rock(p.x - E, y, p.z)) / (2 * E), gz = (rock(p.x, y, p.z + E) - rock(p.x, y, p.z - E)) / (2 * E), gy = (rock(p.x, y + E, p.z) - rock(p.x, y - E, p.z)) / (2 * E);
          const g = Math.hypot(gx, gy, gz), gh = Math.hypot(gx, gz);
          if (g < 1e-5 || gh < 0.35 * g) break; // floor or ceiling, not a wall
          const sdf = v / g, over = sdf + r; // > 0: the body overlaps the rock by this much
          if (over <= 0) break;
          const nx = -gx / gh, nz = -gz / gh, push = Math.min(over, 0.35);
          p.x += nx * push; p.z += nz * push;
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; }
        }
      }
      // ceiling
      if (vel.y > 0 && rock(p.x, p.y + h + 0.05, p.z) > 0) { vel.y = 0; res.ceiling = true; }
      // colliders down here too (vehicles, structures)
      const list = this.query(p.x, p.z, r + 2, this._q2 || (this._q2 = []));
      for (const c of list) { if (c.ghost) continue; if (c.t === 'box') this._boxResolve(p, vel, r, h, c, stepH, res); else this._cylResolve(p, vel, r, h, c, stepH, res); }
      const gc = this.groundAt(p.x, p.z, p.y, stepH * (vel.y <= 0 ? 1 : 0.1), r * 0.5);
      if (this.lastSurf && p.y <= gc + 0.001 && (vel.y <= 0.01 || gc - p.y < stepH)) { p.y = gc; if (vel.y < 0) vel.y = 0; res.ground = true; continue; }
      // floor: if the feet are in rock, lift up to the surface (small ledges step up)
      if (rock(p.x, p.y, p.z) > 0) {
        // stand exactly on the surface: find where the rock ends above the feet (bisection, no 5 cm steps)
        let lo = 0, hi = -1;
        for (let dy = 0.15; dy <= stepH + 0.6; dy += 0.15) if (rock(p.x, p.y + dy, p.z) <= 0) { hi = dy; break; } else lo = dy;
        if (hi > 0) { for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (rock(p.x, p.y + m, p.z) > 0) lo = m; else hi = m; } p.y += hi + 0.005; }
        else p.y += 0.2; // buried (a hole filled in on you): climb out
        if (vel.y < 0) vel.y = 0;
        res.ground = true;
      } else if (vel.y <= 0.01 && rock(p.x, p.y - 0.06, p.z) > 0) { res.ground = true; if (vel.y < 0) vel.y = 0; }
    }
    return res;
  }
  _boxResolve(p, vel, r, h, c, stepH, res) {
    const top = c.y + c.hy, bot = c.y - c.hy;
    if (p.y >= top - 0.001 || p.y + h <= bot) return;
    const [lx, lz] = invRotY(p.x - c.x, p.z - c.z, c.yaw);
    const cx = Math.max(-c.hx, Math.min(c.hx, lx)), cz = Math.max(-c.hz, Math.min(c.hz, lz));
    let dx = lx - cx, dz = lz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    // step up onto low obstacles
    if (top - p.y <= stepH && vel.y <= 1) { p.y = top; if (vel.y < 0) vel.y = 0; res.ground = true; return; }
    // bonk head
    if (p.y + h - bot < 0.35 && vel.y > 0 && p.y < bot) { vel.y = 0; p.y = bot - h; res.ceiling = true; return; }
    let nx, nz, pen;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
    else {
      // centre inside the box: push out along the smallest axis
      const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + r; }
    }
    const [wx, wz] = rotY(nx, nz, c.yaw);
    p.x += wx * pen; p.z += wz * pen;
    const vn = vel.x * wx + vel.z * wz;
    if (vn < 0) { vel.x -= vn * wx; vel.z -= vn * wz; }
  }
  _cylResolve(p, vel, r, h, c, stepH, res) {
    const top = c.y + c.h;
    if (p.y >= top - 0.001 || p.y + h <= c.y) return;
    const dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, rr = r + c.r;
    if (d2 >= rr * rr) return;
    if (top - p.y <= stepH && vel.y <= 1) { p.y = top; if (vel.y < 0) vel.y = 0; res.ground = true; return; }
    const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d, pen = rr - d;
    p.x += nx * pen; p.z += nz * pen;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
  }

  // Raycast against terrain + colliders + optional extra targets.
  // targets: [{kind, id, shape:'box'|'sphere', ... }]
  raycast(o, d, maxT, targets = null, opts = {}) {
    let best = { t: maxT, kind: null };
    // cave rock march
    if (this.caves && this.caves.inVolume(o.x, o.y, o.z) && !opts.noTerrain) {
      const C = this.caves, st = 0.25;
      let prev = 0;
      for (let t = st; t <= maxT; t += st) {
        if (C.rock(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) > 0) {
          let a = prev, b = t;
          for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (C.rock(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m) > 0) b = m; else a = m; }
          best = { t: b, kind: 'cave' };
          break;
        }
        prev = t;
      }
    } else if (!opts.noTerrain) {
      let prevT = 0, prevF = o.y - this.world.ground(o.x, o.z);
      if (prevF < 0) best = { t: 0, kind: 'terrain' };
      else {
        const step = opts.step || 0.8;
        for (let t = step; t <= maxT + step; t += step) {
          const tt = Math.min(t, maxT);
          const x = o.x + d.x * tt, y = o.y + d.y * tt, z = o.z + d.z * tt;
          let f = y - this.world.ground(x, z);
          // a hole in the ground: the ray carries on into it unless it meets the rock
          if (f < 0 && this.caves?.open(x, z)) {
            if (this.caves.rock(x, y, z) < 0) { prevT = tt; prevF = f; if (tt >= maxT) break; continue; }
            best = { t: tt, kind: 'cave' }; break;
          }
          if (f < 0) {
            let a = prevT, b = tt;
            for (let k = 0; k < 8; k++) {
              const m = (a + b) / 2;
              const fm = o.y + d.y * m - this.world.ground(o.x + d.x * m, o.z + d.z * m);
              if (fm < 0) b = m; else a = m;
            }
            best = { t: b, kind: 'terrain' };
            break;
          }
          prevT = tt; prevF = f;
          if (tt >= maxT) break;
        }
      }
    }
    // lake ice, from above or from below
    const ice = this.ice;
    if (ice && ice.frozen && !opts.noTerrain && o.y > CAVE_ZONE && Math.abs(d.y) > 1e-4) {
      const plane = o.y >= ICE_TOP ? ICE_TOP : o.y <= ICE_BOT ? ICE_BOT : null;
      if (plane !== null) {
        const t = (plane - o.y) / d.y;
        if (t > 0 && t < best.t && ice.solid(o.x + d.x * t, o.z + d.z * t)) best = { t, kind: 'ice', under: plane === ICE_BOT };
      }
    }
    // colliders along the ray
    const seen = new Set();
    const len = Math.min(best.t, maxT);
    const list = this._q3 || (this._q3 = []);
    for (let t = 0; t <= len + CELL; t += CELL * 0.7) {
      const tt = Math.min(t, len);
      this.query(o.x + d.x * tt, o.z + d.z * tt, CELL * 0.6, list);
      for (const c of list) {
        if (seen.has(c)) continue;
        seen.add(c);
        if (opts.filter && !opts.filter(c)) continue;
        let hit = -1;
        if (c.t === 'box') hit = rayOBB(o.x, o.y, o.z, d.x, d.y, d.z, c.x, c.y, c.z, c.hx, c.hy, c.hz, c.yaw, best.t);
        else hit = rayCyl(o, d, c, best.t);
        if (hit >= 0 && hit < best.t) best = { t: hit, kind: c.ref ? c.ref.kind : 'prop', id: c.ref?.id, ref: c.ref, col: c };
      }
      if (tt >= len) break;
    }
    if (targets) for (const tg of targets) {
      let hit = -1, hs = false;
      for (const s of tg.shapes) {
        let th = -1;
        if (s.t === 'sphere') th = raySphere(o, d, s, best.t);
        else th = rayOBB(o.x, o.y, o.z, d.x, d.y, d.z, s.x, s.y, s.z, s.hx, s.hy, s.hz, s.yaw, best.t);
        if (th >= 0 && (hit < 0 || th < hit)) { hit = th; hs = !!s.head; }
      }
      if (hit >= 0 && hit < best.t) best = { t: hit, kind: tg.kind, id: tg.id, ref: tg, hs };
    }
    if (!best.kind) return null;
    best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }
}

function raySphere(o, d, s, maxT) {
  const ox = o.x - s.x, oy = o.y - s.y, oz = o.z - s.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : -1;
}
function rayCyl(o, d, c, maxT) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  let t = -1;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - c.r * c.r;
    const disc = b * b - a * cc;
    if (disc < 0) return -1;
    t = (-b - Math.sqrt(disc)) / a;
    if (t < 0) { if (cc < 0) t = 0; else return -1; }
  } else if (ox * ox + oz * oz <= c.r * c.r) t = 0; else return -1;
  const y = o.y + d.y * t;
  if (y < c.y || y > c.y + c.h) {
    // check top cap
    if (Math.abs(d.y) > 1e-6) {
      const tc = (c.y + c.h - o.y) / d.y;
      if (tc >= 0 && tc <= maxT && (o.x + d.x * tc - c.x) ** 2 + (o.z + d.z * tc - c.z) ** 2 <= c.r * c.r) return tc;
    }
    return -1;
  }
  return t <= maxT ? t : -1;
}
