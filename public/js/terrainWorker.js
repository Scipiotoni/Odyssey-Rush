// Web Worker: builds terrain chunk meshes and resource-node lists off the main thread.
import { World } from '/shared/worldgen.js';
import { buildChunkData } from './chunkgen.js';

let world = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { world = new World(m.seed); for (const [ix, iz, v] of m.mods || []) world.setMod(ix, iz, v); return; }
  if (m.type === 'mods') { for (const [ix, iz, v] of m.list) world.setMod(ix, iz, v); return; }
  if (!world) return;
  if (m.type === 'chunk') {
    const d = buildChunkData(world, m.cx, m.cz, m.lod);
    self.postMessage({ type: 'chunk', id: m.id, k: m.k, lod: m.lod, ver: m.ver, ...d }, [d.pos.buffer, d.col.buffer, d.nrm.buffer]);
  } else if (m.type === 'nodes') {
    self.postMessage({ type: 'nodes', id: m.id, k: m.k, ver: m.ver, nodes: world.chunkNodes(m.cx, m.cz) });
  }
};
