// Pure terrain-chunk mesh data generation (runs inside Web Workers, or on the main thread as a fallback).
import { CHUNK, GRID } from '/shared/worldgen.js';

// Returns {pos: Float32Array, col: Float32Array, nrm: Float32Array} for a chunk at a given LOD (1,2,4,8).
export function buildChunkData(w, cx, cz, lod) {
  const seg = CHUNK / (GRID * lod);
  const n = seg + 1;
  const ix0 = cx * (CHUNK / GRID), iz0 = cz * (CHUNK / GRID);
  const H = new Float32Array(n * n), C = new Float32Array(n * n * 3);
  const col = [0, 0, 0];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = w.gridH(ix0 + i * lod, iz0 + j * lod);
  const step = GRID * lod;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h = H[j * n + i];
    const hx = H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)];
    const hz = H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i];
    const slope = Math.min(1, Math.hypot(hx, hz) / (2 * step));
    w.color((ix0 + i * lod) * GRID, (iz0 + j * lod) * GRID, h, slope, col);
    // freshly dug earth looks like dirt
    if (lod <= 2) {
      const m = w.getMod(ix0 + i * lod, iz0 + j * lod);
      if (m) { const t = Math.min(1, Math.abs(m) / 1.2) * 0.75; col[0] += (0.42 - col[0]) * t; col[1] += (0.32 - col[1]) * t; col[2] += (0.2 - col[2]) * t; }
    }
    C[(j * n + i) * 3] = col[0]; C[(j * n + i) * 3 + 1] = col[1]; C[(j * n + i) * 3 + 2] = col[2];
  }
  const tris = seg * seg * 2 + seg * 4 * 4;
  const pos = new Float32Array(tris * 9), cols = new Float32Array(tris * 9), nrm = new Float32Array(tris * 9);
  let o = 0;
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const tri = (a, b, c, ax, ay, az, bx, by, bz, qx, qy, qz) => {
    const r = (C[a * 3] + C[b * 3] + C[c * 3]) / 3, g = (C[a * 3 + 1] + C[b * 3 + 1] + C[c * 3 + 1]) / 3, bl = (C[a * 3 + 2] + C[b * 3 + 2] + C[c * 3 + 2]) / 3;
    // flat face normal
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = qx; pos[o + 7] = qy; pos[o + 8] = qz;
    for (let k = 0; k < 9; k += 3) { cols[o + k] = r; cols[o + k + 1] = g; cols[o + k + 2] = bl; nrm[o + k] = nx; nrm[o + k + 1] = ny; nrm[o + k + 2] = nz; }
    o += 9;
  };
  const X = (i) => ox + i * step, Z = (j) => oz + j * step, Y = (i, j) => H[j * n + i];
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // split along the b-c diagonal (matches World.ground)
    tri(a, c, b, X(i), Y(i, j), Z(j), X(i), Y(i, j + 1), Z(j + 1), X(i + 1), Y(i + 1, j), Z(j));
    tri(b, c, d, X(i + 1), Y(i + 1, j), Z(j), X(i), Y(i, j + 1), Z(j + 1), X(i + 1), Y(i + 1, j + 1), Z(j + 1));
  }
  // skirts hide cracks between LODs
  const sk = 6 * lod;
  const edge = (i0, j0, i1, j1) => {
    const a = j0 * n + i0, b = j1 * n + i1;
    const ax = X(i0), ay = Y(i0, j0), az = Z(j0), bx = X(i1), by = Y(i1, j1), bz = Z(j1);
    tri(a, b, a, ax, ay, az, ax, ay - sk, az, bx, by, bz); tri(b, a, b, bx, by, bz, ax, ay - sk, az, bx, by - sk, bz);
    tri(a, b, a, ax, ay, az, bx, by, bz, ax, ay - sk, az); tri(b, a, b, bx, by, bz, bx, by - sk, bz, ax, ay - sk, az);
  };
  for (let i = 0; i < seg; i++) { edge(i, 0, i + 1, 0); edge(i, seg, i + 1, seg); edge(0, i, 0, i + 1); edge(seg, i, seg, i + 1); }
  return { pos: pos.slice(0, o), col: cols.slice(0, o), nrm: nrm.slice(0, o) };
}

// The colour the terrain mesh (LOD 1) gives the ground triangle under (x, z): the cave mesh uses it for the untouched
// ground inside an opened square, so a dug hole doesn't change the look of the grass around it.
const _vc = new Map(), _col = [0, 0, 0];
function vertexColor(w, ix, iz) {
  const key = (ix + 4096) * 8192 + (iz + 4096);
  let c = _vc.get(key);
  if (c) return c;
  if (_vc.size > 60000) _vc.clear();
  const h = w.gridH(ix, iz), hx = w.gridH(ix + 1, iz) - w.gridH(ix - 1, iz), hz = w.gridH(ix, iz + 1) - w.gridH(ix, iz - 1);
  w.color(ix * GRID, iz * GRID, h, Math.min(1, Math.hypot(hx, hz) / (2 * GRID)), _col);
  const m = w.getMod(ix, iz);
  if (m) { const t = Math.min(1, Math.abs(m) / 1.2) * 0.75; _col[0] += (0.42 - _col[0]) * t; _col[1] += (0.32 - _col[1]) * t; _col[2] += (0.2 - _col[2]) * t; }
  c = [_col[0], _col[1], _col[2]];
  _vc.set(key, c);
  return c;
}
export function forgetGroundColors() { _vc.clear(); }
export function terrainTriColor(w, x, z, out) {
  const gx = x / GRID, gz = z / GRID, ix = Math.floor(gx), iz = Math.floor(gz);
  const tri = gx - ix + (gz - iz) < 1 ? [[ix, iz], [ix, iz + 1], [ix + 1, iz]] : [[ix + 1, iz], [ix, iz + 1], [ix + 1, iz + 1]];
  out[0] = out[1] = out[2] = 0;
  for (const [a, b] of tri) { const c = vertexColor(w, a, b); out[0] += c[0] / 3; out[1] += c[1] / 3; out[2] += c[2] / 3; }
  return out;
}

// Where the ground has a hole (open squares), the cave mesh draws the ground; along the edge where an open square meets
// intact terrain the two can differ by a few centimetres (more near natural cave mouths). A short dirt skirt hanging from
// the terrain's cut edge closes that step, so you never see through it.
const SKIRT = 0.8;
export function holeSkirts(w, isOpen, i0, j0, n) {
  const pos = [], col = [], nrm = [];
  const gc = [0, 0, 0];
  const add = (x0, z0, x1, z1, nx, nz) => {
    const h0 = w.ground(x0, z0), h1 = w.ground(x1, z1);
    const v = [[x0, h0 - 0.03, z0], [x1, h1 - 0.03, z1], [x1, h1 - SKIRT, z1], [x0, h0 - SKIRT, z0]]; // (just under the seam, so it never shows on it)
    // coloured and lit like the ground at the edge, so the seam doesn't show; both faces (the terrain material is one-sided)
    terrainTriColor(w, (x0 + x1) / 2 + nx * 0.5, (z0 + z1) / 2 + nz * 0.5, gc);
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]]) {
      for (const k of [a, b, c]) { pos.push(...v[k]); col.push(gc[0], gc[1], gc[2]); nrm.push(0, 1, 0); }
    }
  };
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const qi = i0 + a, qj = j0 + b;
    if (!isOpen(qi, qj)) continue;
    const x0 = qi * GRID, x1 = x0 + GRID, z0 = qj * GRID, z1 = z0 + GRID;
    if (!isOpen(qi - 1, qj)) add(x0, z0, x0, z1, 1, 0);
    if (!isOpen(qi + 1, qj)) add(x1, z0, x1, z1, -1, 0);
    if (!isOpen(qi, qj - 1)) add(x0, z0, x1, z0, 0, 1);
    if (!isOpen(qi, qj + 1)) add(x0, z1, x1, z1, 0, -1);
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), nrm: new Float32Array(nrm) };
}
