// Streams terrain chunks (with LOD), resource node instances and POI props around the camera.
// Heavy generation runs in a pool of Web Workers so the frame rate stays smooth while exploring.
import * as THREE from 'three';
import { CHUNK, GRID, POI_CELL, HALF, chunkKey } from '/shared/worldgen.js';
import { NODES } from '/shared/items.js';
import { MAT, nodeGeometry, poiGeometry } from './models.js';
import { buildChunkData } from './chunkgen.js';

const TERRAIN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const NODE_RADIUS = 3;   // chunks around player with resource nodes
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Terrain {
  constructor(scene, world, physics) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.chunks = new Map();      // k -> {cx, cz, lod, ver, mesh}
    this.nodeChunks = new Map();
    this.pois = new Map();
    this.depleted = new Set();
    this.nodeIndex = new Map();   // nodeId -> {mesh, i, node}
    this.viewDist = 900;
    this.queue = []; this.nodeQueue = [];
    this.wantT = new Map(); this.wantN = new Set();
    this.ver = new Map();         // chunk key -> edit version
    this.inflight = new Set();
    this.center = [NaN, NaN];
    this.shadows = true;
    this.workers = [];
    this.rr = 0;
    try {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onWorker(e.data);
        w.onerror = (e) => { console.warn('terrain worker failed, using main thread', e.message); this.workers = []; this.inflight.clear(); this.center = [NaN, NaN]; };
        w.postMessage({ type: 'init', seed: world.seed, mods: world.modList() });
        this.workers.push(w);
      }
    } catch (e) { console.warn('Web Workers unavailable, generating on main thread', e); this.workers = []; }
    this.maxInflight = this.workers.length * 2;
  }

  setViewDist(v) { this.viewDist = v; this.center = [NaN, NaN]; }
  lodFor(d) { return d <= 2 ? 1 : d <= 4 ? 2 : d <= 7 ? 4 : 8; }

  // Terrain edits from the server: [[ix, iz, value], ...]
  applyMods(list) {
    const dirty = new Set();
    for (const [ix, iz, v] of list) {
      this.world.setMod(ix, iz, v);
      const x = ix * GRID, z = iz * GRID;
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) dirty.add(chunkKey(Math.floor((x + dx * GRID) / CHUNK), Math.floor((z + dz * GRID) / CHUNK)));
    }
    for (const w of this.workers) w.postMessage({ type: 'mods', list });
    for (const k of dirty) {
      this.ver.set(k, (this.ver.get(k) || 0) + 1);
      const lod = this.wantT.get(k);
      if (lod) { const [cx, cz] = k.split(',').map(Number); this.queue.unshift({ k, x: cx, z: cz, lod, d: 0 }); }
    }
  }

  update(px, pz, budgetMs = 6) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const R = Math.ceil(this.viewDist / CHUNK);
    if (cx !== this.center[0] || cz !== this.center[1]) {
      this.center = [cx, cz];
      this.wantT = new Map();
      const jobs = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        if (Math.hypot(i, j) > R + 0.5) continue;
        const x = cx + i, z = cz + j;
        if ((x + 0.5) * CHUNK < -HALF - 600 || (x + 0.5) * CHUNK > HALF + 600 || (z + 0.5) * CHUNK < -HALF - 600 || (z + 0.5) * CHUNK > HALF + 600) continue;
        const d = Math.max(Math.abs(i), Math.abs(j)), lod = this.lodFor(d), k = chunkKey(x, z);
        this.wantT.set(k, lod);
        const c = this.chunks.get(k);
        if (!c || c.lod !== lod) jobs.push({ k, x, z, lod, d: Math.hypot(i, j) });
      }
      for (const [k, c] of this.chunks) if (!this.wantT.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
      this.queue = jobs.sort((a, b) => a.d - b.d);
      this.wantN = new Set();
      for (let i = -NODE_RADIUS; i <= NODE_RADIUS; i++) for (let j = -NODE_RADIUS; j <= NODE_RADIUS; j++) this.wantN.add(chunkKey(cx + i, cz + j));
      for (const [k, nc] of this.nodeChunks) if (!this.wantN.has(k)) { this.disposeNodes(nc); this.nodeChunks.delete(k); }
      this.nodeQueue = [...this.wantN].filter((k) => !this.nodeChunks.has(k)).map((k) => { const [x, z] = k.split(',').map(Number); return { k, x, z, d: Math.hypot(x - cx, z - cz) }; }).sort((a, b) => a.d - b.d);
      this.updatePOIs(px, pz);
    }
    if (this.workers.length) this.dispatch();
    else this.buildSync(budgetMs);
  }

  dispatch() {
    while (this.inflight.size < this.maxInflight && (this.queue.length || this.nodeQueue.length)) {
      const takeNodes = this.nodeQueue.length && (!this.queue.length || this.nodeQueue[0].d <= this.queue[0].d + 1);
      const job = takeNodes ? this.nodeQueue.shift() : this.queue.shift();
      const type = takeNodes ? 'nodes' : 'chunk';
      if (type === 'chunk' && this.wantT.get(job.k) !== job.lod) continue;
      if (type === 'nodes' && (!this.wantN.has(job.k) || this.nodeChunks.has(job.k))) continue;
      const ver = this.ver.get(job.k) || 0;
      const id = `${type}:${job.k}:${job.lod || 0}:${ver}`;
      if (this.inflight.has(id)) continue;
      this.inflight.add(id);
      this.workers[this.rr++ % this.workers.length].postMessage({ type, id, k: job.k, cx: job.x, cz: job.z, lod: job.lod, ver });
    }
  }
  onWorker(m) {
    this.inflight.delete(m.id);
    if (m.type === 'chunk') {
      if (this.wantT.get(m.k) !== m.lod || (this.ver.get(m.k) || 0) !== m.ver) return;
      this.installChunk(m.k, m.lod, m.ver, m);
    } else if (m.type === 'nodes') {
      if (!this.wantN.has(m.k) || this.nodeChunks.has(m.k)) return;
      this.nodeChunks.set(m.k, this.buildNodes(m.nodes, m.k));
    }
  }
  buildSync(budgetMs) {
    const t0 = performance.now();
    while ((this.nodeQueue.length || this.queue.length) && performance.now() - t0 < budgetMs) {
      if (this.nodeQueue.length && (!this.queue.length || this.nodeQueue[0].d <= this.queue[0].d + 1)) {
        const n = this.nodeQueue.shift();
        if (this.wantN.has(n.k) && !this.nodeChunks.has(n.k)) this.nodeChunks.set(n.k, this.buildNodes(this.world.chunkNodes(n.x, n.z), n.k));
      } else {
        const q = this.queue.shift();
        if (this.wantT.get(q.k) !== q.lod) continue;
        this.installChunk(q.k, q.lod, this.ver.get(q.k) || 0, buildChunkData(this.world, q.x, q.z, q.lod));
      }
    }
  }
  pending() { return this.queue.length + this.nodeQueue.length + this.inflight.size; }

  installChunk(k, lod, ver, d) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, TERRAIN_MAT);
    mesh.receiveShadow = lod <= 2;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    const old = this.chunks.get(k);
    if (old) this.disposeChunk(old);
    const [cx, cz] = k.split(',').map(Number);
    this.chunks.set(k, { cx, cz, lod, ver, mesh });
  }
  disposeChunk(c) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }

  buildNodes(nodes, k) {
    const byType = new Map();
    for (const n of nodes) { if (!byType.has(n.type)) byType.set(n.type, []); byType.get(n.type).push(n); }
    const meshes = [];
    const group = 'nodes:' + k;
    for (const [type, list] of byType) {
      const im = new THREE.InstancedMesh(nodeGeometry(type), MAT, list.length);
      im.castShadow = this.shadows && NODES[type].kind !== 'pick';
      im.receiveShadow = false;
      const def = NODES[type];
      list.forEach((n, i) => {
        _q.setFromAxisAngle(_up, n.rot); _s.set(n.s, n.s, n.s); _p.set(n.x, n.y - 0.1, n.z);
        _m.compose(_p, _q, _s);
        n._mat = _m.clone();
        const dep = this.depleted.has(n.id);
        im.setMatrixAt(i, dep ? ZERO : n._mat);
        this.nodeIndex.set(n.id, { mesh: im, i, node: n });
        if (def.kind !== 'pick') n._col = this.physics.add(group, { t: 'cyl', x: n.x, y: n.y - 0.2, z: n.z, r: def.radius * n.s, h: dep ? -100 : def.height * n.s, ref: { kind: 'n', id: n.id, node: n } });
        // pickables are raycast-only (the body ignores ghost colliders)
        else n._col = this.physics.add(group, { t: 'cyl', x: n.x, y: n.y, z: n.z, r: 0.5, h: dep ? -100 : def.height, ref: { kind: 'n', id: n.id, node: n }, ghost: true });
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      meshes.push(im);
    }
    return { k, meshes, nodes, group };
  }
  disposeNodes(nc) {
    for (const m of nc.meshes) { this.scene.remove(m); m.dispose(); }
    for (const n of nc.nodes) this.nodeIndex.delete(n.id);
    this.physics.removeGroup(nc.group);
  }
  setDepleted(id, dep) {
    if (dep) this.depleted.add(id); else this.depleted.delete(id);
    const e = this.nodeIndex.get(id);
    if (!e) return;
    e.mesh.setMatrixAt(e.i, dep ? ZERO : e.node._mat);
    e.mesh.instanceMatrix.needsUpdate = true;
    const def = NODES[e.node.type];
    if (e.node._col) e.node._col.h = dep ? -100 : def.height * (def.kind === 'pick' ? 1 : e.node.s);
  }
  // brief shake when a node is hit
  shakeNode(id, amt = 0.06) {
    const e = this.nodeIndex.get(id);
    if (!e || this.depleted.has(id)) return;
    const n = e.node;
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), amt);
    const r = new THREE.Quaternion().setFromAxisAngle(_up, n.rot).premultiply(tilt);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(n.x, n.y - 0.1, n.z), r, new THREE.Vector3(n.s, n.s, n.s));
    e.mesh.setMatrixAt(e.i, m); e.mesh.instanceMatrix.needsUpdate = true;
    clearTimeout(e._t);
    e._t = setTimeout(() => { if (!this.depleted.has(id)) { e.mesh.setMatrixAt(e.i, n._mat); e.mesh.instanceMatrix.needsUpdate = true; } }, 120);
  }

  updatePOIs(px, pz) {
    const ci = Math.floor((px + HALF) / POI_CELL), cj = Math.floor((pz + HALF) / POI_CELL);
    const want = new Set();
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const p = this.world.poiAt(ci + i, cj + j);
      if (!p || Math.hypot(p.x - px, p.z - pz) > this.viewDist + 200) continue;
      want.add(p.id);
      if (this.pois.has(p.id)) continue;
      const lay = this.world.poiLayout(p);
      const geo = poiGeometry(lay);
      const mesh = geo ? new THREE.Mesh(geo, MAT) : null;
      if (mesh) { mesh.castShadow = this.shadows; mesh.receiveShadow = true; this.scene.add(mesh); }
      const group = 'poi:' + p.id;
      for (const pr of lay.props) {
        if (pr.k === 'box') this.physics.add(group, { t: 'box', x: pr.x, y: pr.y, z: pr.z, hx: pr.sx / 2, hy: pr.sy / 2 + (pr.roll ? 0.6 : 0), hz: pr.sz / 2, yaw: pr.yaw, ref: { kind: 'prop' } });
        else this.physics.add(group, { t: 'cyl', x: pr.x, y: pr.y - pr.h / 2, z: pr.z, r: pr.r, h: pr.h, ref: { kind: 'prop' } });
      }
      this.pois.set(p.id, { poi: p, mesh, group });
    }
    for (const [id, e] of this.pois) if (!want.has(id)) { if (e.mesh) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); } this.physics.removeGroup(e.group); this.pois.delete(id); }
  }
}
