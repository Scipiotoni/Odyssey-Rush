// Web Worker: meshes cave chunks off the main thread (the main thread only turns the arrays into meshes).
// It keeps its own copy of the world and the rock field, kept in sync with terrain edits and dug holes.
import { World } from '/shared/worldgen.js';
import { Caves } from '/shared/caves.js';
import { IceField } from '/shared/ice.js';
import { meshChunkData } from './caveMesh.js';

let world = null, caves = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    world = new World(m.seed); for (const [ix, iz, v] of m.tmods || []) world.setMod(ix, iz, v);
    caves = new Caves(m.seed); caves.surface = (x, z) => world.ground(x, z); caves.setMods(m.cmods || []);
    const ice = new IceField(world);
    caves.seaAbove = (x, z) => world.ground(x, z) < -8 && !ice.inland(x, z); // same as the main thread
    return;
  }
  if (!caves) return;
  if (m.type === 'tmods') { for (const [ix, iz, v] of m.list) world.setMod(ix, iz, v); caves.openCache.clear(); return; }
  if (m.type === 'cmod') { caves.addMod(...m.m); return; }
  if (m.type === 'mesh') {
    const d = meshChunkData(caves, m.cx, m.cy, m.cz);
    if (!d) return self.postMessage({ type: 'mesh', k: m.k, ver: m.ver, empty: true });
    const tr = d.pos ? [d.pos.buffer, d.col.buffer, d.nrm.buffer] : [];
    self.postMessage({ type: 'mesh', k: m.k, ver: m.ver, ...d }, tr);
  }
};
