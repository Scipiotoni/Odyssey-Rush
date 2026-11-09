// Web Worker: builds terrain chunk meshes and resource-node lists off the main thread. It also has its own copy of the
// cave rock field, so it cuts the holes over cave mouths and dug holes here and tells the main thread which ground
// squares are open (so the main thread never has to work that out itself).
import { World, CHUNK } from '/shared/worldgen.js';
import { Caves, QUAD } from '/shared/caves.js';
import { buildChunkData, holeSkirts } from './chunkgen.js';

let world = null, caves = null, tmv = 0; // tmv: how many terrain edits we've had (the main thread checks it)
function cutHoles(d, cx, cz) {
  const n = CHUNK / QUAD, i0 = Math.floor((cx * CHUNK) / QUAD), j0 = Math.floor((cz * CHUNK) / QUAD);
  const mask = new Uint8Array(n * n);
  let any = false;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (caves.quadOpen(i0 + a, j0 + b)) { mask[b * n + a] = 1; any = true; }
  const quads = { i0, j0, n, mask, nm: caves.mods.length, tv: tmv };
  if (!any) return { d, quads };
  const P = d.pos, keep = new Uint8Array(P.length / 9);
  let k = 0;
  for (let t = 0; t < keep.length; t++) {
    const o = t * 9, mx = (P[o] + P[o + 3] + P[o + 6]) / 3, mz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    const qi = Math.floor(mx / QUAD) - i0, qj = Math.floor(mz / QUAD) - j0;
    const open = qi >= 0 && qj >= 0 && qi < n && qj < n ? mask[qj * n + qi] : caves.quadOpen(Math.floor(mx / QUAD), Math.floor(mz / QUAD));
    if (!open) { keep[t] = 1; k++; }
  }
  const isOpen = (qi, qj) => { const a = qi - i0, b = qj - j0; return a >= 0 && b >= 0 && a < n && b < n ? !!mask[b * n + a] : caves.quadOpen(qi, qj); };
  const sk = holeSkirts(world, isOpen, i0, j0, n);
  const m = k * 9 + sk.pos.length;
  const out = { pos: new Float32Array(m), col: new Float32Array(m), nrm: new Float32Array(m) };
  let w = 0;
  for (let t = 0; t < keep.length; t++) if (keep[t]) { out.pos.set(P.subarray(t * 9, t * 9 + 9), w); out.col.set(d.col.subarray(t * 9, t * 9 + 9), w); out.nrm.set(d.nrm.subarray(t * 9, t * 9 + 9), w); w += 9; }
  out.pos.set(sk.pos, w); out.col.set(sk.col, w); out.nrm.set(sk.nrm, w);
  return { d: { ...d, ...out }, quads };
}
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    world = new World(m.seed); for (const [ix, iz, v] of m.mods || []) world.setMod(ix, iz, v);
    caves = new Caves(m.seed); caves.surface = (x, z) => world.ground(x, z); caves.surface0 = (x, z) => world.ground0(x, z); caves.setMods(m.cmods || []);
    return;
  }
  if (m.type === 'mods') { for (const [ix, iz, v] of m.list) world.setMod(ix, iz, v); caves?.openCache.clear(); tmv = m.v ?? tmv + 1; return; }
  if (m.type === 'cmod') { caves?.addMod(...m.m); return; }
  if (!world) return;
  if (m.type === 'chunk') {
    let d = buildChunkData(world, m.cx, m.cz, m.lod), quads = null;
    if (m.lod <= 2 && caves) ({ d, quads } = cutHoles(d, m.cx, m.cz));
    self.postMessage({ type: 'chunk', id: m.id, k: m.k, lod: m.lod, ver: m.ver, cut: !!quads, quads, ...d }, [d.pos.buffer, d.col.buffer, d.nrm.buffer]);
  } else if (m.type === 'nodes') {
    self.postMessage({ type: 'nodes', id: m.id, k: m.k, ver: m.ver, nodes: world.chunkNodes(m.cx, m.cz) });
  }
};
