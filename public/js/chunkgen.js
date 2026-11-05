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
