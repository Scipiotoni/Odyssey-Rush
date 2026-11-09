// The cave mesher: surface nets over one 16 m cube of the shared rock field, with vertex colours by depth layer,
// ore and mineral veins, plus crystal and glow-plant spots. No three.js here, so it runs in a Web Worker
// (caveWorker.js) as well as on the main thread.
import { CAVE_CELL, QUAD, layerAt } from '/shared/caves.js';

const C = CAVE_CELL;
const _c = { r: 0, g: 0, b: 0, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// one 16 m cube of the rock field
export function meshChunkData(caves, cx, cy, cz) {
  const N = C + 3, x0 = cx * C - 1, y0 = cy * C - 1, z0 = cz * C - 1;
  const idx = (i, j, k) => (j * N + k) * N + i;
  // coarse look first: a cube that's solid rock (or open air) all through is skipped cheaply
  let cmin = Infinity, cmax = -Infinity;
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let c = 0; c <= 4; c++) { const v = caves.rock(x0 + a * 4.5, y0 + b * 4.5, z0 + c * 4.5); if (v < cmin) cmin = v; if (v > cmax) cmax = v; }
  if (cmin > 0.32 || cmax < -0.32) return null;
  const d = new Float32Array(N * N * N);
  let pos0 = false, neg0 = false;
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) { const v = caves.rock(x0 + i, y0 + j, z0 + k); d[idx(i, j, k)] = v; if (v > 0) pos0 = true; else neg0 = true; }
  if (!pos0 || !neg0) return null;
  const wet = caves.flooded(x0 + C / 2, z0 + C / 2);
  const vIndex = new Int32Array((N - 1) * (N - 1) * (N - 1)).fill(-1);
  const cidx = (i, j, k) => (j * (N - 1) + k) * (N - 1) + i;
  const vp = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let j = 0; j < N - 1; j++) for (let k = 0; k < N - 1; k++) for (let i = 0; i < N - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, e] = corners[c]; cv[c] = d[idx(i + a, j + b, k + e)]; if (cv[c] > 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] > 0) === (cv[b] > 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]), A = corners[a], Bc = corners[b];
      sx += A[0] + (Bc[0] - A[0]) * t; sy += A[1] + (Bc[1] - A[1]) * t; sz += A[2] + (Bc[2] - A[2]) * t; n++;
    }
    vIndex[cidx(i, j, k)] = vp.length / 3;
    vp.push(x0 + i + sx / n, y0 + j + sy / n, z0 + k + sz / n);
  }
  const pos = [], col = [];
  const V = (c) => [vp[c * 3], vp[c * 3 + 1], vp[c * 3 + 2]];
  const tri = (a, b, c) => {
    const A = V(a), Bv = V(b), Cv = V(c);
    const mx = (A[0] + Bv[0] + Cv[0]) / 3, my = (A[1] + Bv[1] + Cv[1]) / 3, mz = (A[2] + Bv[2] + Cv[2]) / 3;
    const s = caves.surface(mx, mz), depth = s - my;
    // the ground itself is drawn by the terrain heightfield, except where it has a hole
    if (depth < 1.3 && !caves.quadOpen(Math.floor(mx / QUAD), Math.floor(mz / QUAD))) return;
    pos.push(...A, ...Bv, ...Cv);
    const nx = (Bv[1] - A[1]) * (Cv[2] - A[2]) - (Bv[2] - A[2]) * (Cv[1] - A[1]), ny = (Bv[2] - A[2]) * (Cv[0] - A[0]) - (Bv[0] - A[0]) * (Cv[2] - A[2]), nz = (Bv[0] - A[0]) * (Cv[1] - A[1]) - (Bv[1] - A[1]) * (Cv[0] - A[0]);
    const up = ny / (Math.hypot(nx, ny, nz) || 1);
    const ore = caves.ore(mx, my, mz), v = 0.85 + Math.sin(mx * 1.7 + mz * 1.3 + my * 2.1) * 0.08;
    const min = ore > 0.5 || ore < -0.5 ? null : caves.mineral(mx, my, mz);
    if (depth < 0.6 && up > 0.5) _c.setRGB(0.36 * v, 0.5 * v, 0.24 * v);                    // grass at the rim of a hole
    else if (ore > 0.5 && depth > 8) _c.setRGB(0.62 * v, 0.38 * v, 0.2 * v);
    else if (ore < -0.5 && depth > 8) _c.setRGB(0.72 * v, 0.66 * v, 0.24 * v);
    else if (min === 'copper_ore' && depth > 12) _c.setRGB(0.22 * v, 0.52 * v, 0.42 * v);
    else if (min === 'lithium_ore' && depth > 12) _c.setRGB(0.78 * v, 0.56 * v, 0.66 * v);
    else if (min === 'titanium_ore' && depth > 12) _c.setRGB(0.74 * v, 0.76 * v, 0.8 * v);
    else if (min === 'quartz' && depth > 12) _c.setRGB(0.9 * v, 0.9 * v, 0.92 * v);
    else if (min === 'kyanite') _c.setRGB(0.22 * v, 0.38 * v, 0.9 * v);
    else if (wet) _c.setRGB((up > 0.6 ? 0.2 : 0.28) * v, (up > 0.6 ? 0.34 : 0.33) * v, (up > 0.6 ? 0.36 : 0.4) * v);
    else {
      // dug layers: topsoil, clay, stone, deepstone (blended), mossy cave floors
      const L = layerAt(depth), Ln = layerAt(depth + 2.5);
      const f = L === Ln ? 0 : smooth(0, 2.5, Ln[1] - depth);
      const c0 = L[3], c1 = Ln[3];
      _c.setRGB((c0[0] + (c1[0] - c0[0]) * (1 - f)) * v, (c0[1] + (c1[1] - c0[1]) * (1 - f)) * v, (c0[2] + (c1[2] - c0[2]) * (1 - f)) * v);
      if (up > 0.6 && depth > 25) _c.setRGB((_c.r + 0.3 * v) * 0.5, (_c.g + 0.34 * v) * 0.5, (_c.b + 0.24 * v) * 0.5);
    }
    for (let q = 0; q < 3; q++) col.push(_c.r, _c.g, _c.b);
  };
  const crystals = [], glows = [];
  for (let j = 1; j < N - 1; j++) for (let k = 1; k < N - 1; k++) for (let i = 1; i < N - 1; i++) {
    if (i > C || k > C || j > C) continue;
    const a = d[idx(i, j, k)] > 0;
    if (a !== (d[idx(i + 1, j, k)] > 0)) {
      const c0 = vIndex[cidx(i, j - 1, k - 1)], c1 = vIndex[cidx(i, j, k - 1)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i, j - 1, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c1, c2); tri(c0, c2, c3); } else { tri(c0, c2, c1); tri(c0, c3, c2); } }
    }
    if (a !== (d[idx(i, j + 1, k)] > 0)) {
      const c0 = vIndex[cidx(i - 1, j, k - 1)], c1 = vIndex[cidx(i, j, k - 1)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i - 1, j, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c2, c1); tri(c0, c3, c2); } else { tri(c0, c1, c2); tri(c0, c2, c3); } }
      const wx = x0 + i, wy = y0 + j, wz = z0 + k, dep = caves.surface(wx, wz) - wy;
      if (dep > 20 && caves.crystal(wx, wy, wz) && ((i * 7 + k * 13 + j) % 5 === 0)) crystals.push([wx, wy + 0.5, wz, a ? 1 : -1]);
      // bioluminescent anemones on flooded cave floors; glow-worm lights on deep dry ceilings
      if (a && dep > 6 && (wet ? (i * 31 + k * 17 + j * 7) % 6 === 0 : dep > 40 && (i * 31 + k * 17 + j * 7) % 23 === 0)) glows.push([wx + 0.5, wy + 0.5, wz + 0.5, (i * 13 + k * 7) % 3]);
    }
    if (a !== (d[idx(i, j, k + 1)] > 0)) {
      const c0 = vIndex[cidx(i - 1, j - 1, k)], c1 = vIndex[cidx(i, j - 1, k)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i - 1, j, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c2, c1); tri(c0, c3, c2); } else { tri(c0, c1, c2); tri(c0, c2, c3); } }
    }
  }
  if (!pos.length && !crystals.length) return { pos: null, crystals, glows };
  // flat normals (one per triangle, like computeVertexNormals on an unindexed mesh)
  const P = new Float32Array(pos), nrm = new Float32Array(P.length);
  for (let o = 0; o < P.length; o += 9) {
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2], vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let q = 0; q < 9; q += 3) { nrm[o + q] = nx; nrm[o + q + 1] = ny; nrm[o + q + 2] = nz; }
  }
  return { pos: P, col: new Float32Array(col), nrm, crystals, glows };
}

