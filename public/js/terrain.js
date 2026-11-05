// Streams terrain chunks (with LOD), resource node instances and POI props around the camera.
import * as THREE from 'three';
import { CHUNK, GRID, POI_CELL, HALF, chunkKey } from '/shared/worldgen.js';
import { NODES } from '/shared/items.js';
import { MAT, nodeGeometry, poiGeometry } from './models.js';

const TERRAIN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const NODE_RADIUS = 3;   // chunks around player with resource nodes
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Terrain {
  constructor(scene, world, physics) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.chunks = new Map();
    this.nodeChunks = new Map();
    this.pois = new Map();
    this.depleted = new Set();
    this.nodeIndex = new Map(); // nodeId -> {mesh, i, node}
    this.viewDist = 900;
    this.queue = [];
    this.center = [NaN, NaN];
    this.shadows = true;
  }

  setViewDist(v) { this.viewDist = v; this.center = [NaN, NaN]; }

  lodFor(d) { return d <= 2 ? 1 : d <= 4 ? 2 : d <= 7 ? 4 : 8; }

  update(px, pz, budgetMs = 6) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const R = Math.ceil(this.viewDist / CHUNK);
    if (cx !== this.center[0] || cz !== this.center[1]) {
      this.center = [cx, cz];
      const want = new Map();
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const d = Math.max(Math.abs(i), Math.abs(j));
        if (Math.hypot(i, j) > R + 0.5) continue;
        const x = cx + i, z = cz + j;
        if ((x + 0.5) * CHUNK < -HALF - 600 || (x + 0.5) * CHUNK > HALF + 600 || (z + 0.5) * CHUNK < -HALF - 600 || (z + 0.5) * CHUNK > HALF + 600) continue;
        want.set(chunkKey(x, z), { x, z, lod: this.lodFor(d), d });
      }
      for (const [k, c] of this.chunks) if (!want.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
      this.queue = [];
      for (const [k, w] of want) {
        const c = this.chunks.get(k);
        if (!c || c.lod !== w.lod) this.queue.push({ k, ...w });
      }
      this.queue.sort((a, b) => a.d - b.d);
      // resource nodes
      const nwant = new Set();
      for (let i = -NODE_RADIUS; i <= NODE_RADIUS; i++) for (let j = -NODE_RADIUS; j <= NODE_RADIUS; j++) nwant.add(chunkKey(cx + i, cz + j));
      for (const [k, nc] of this.nodeChunks) if (!nwant.has(k)) { this.disposeNodes(nc); this.nodeChunks.delete(k); }
      this.nodeQueue = [...nwant].filter((k) => !this.nodeChunks.has(k)).map((k) => { const [x, z] = k.split(',').map(Number); return { k, x, z, d: Math.hypot(x - cx, z - cz) }; }).sort((a, b) => a.d - b.d);
      this.updatePOIs(px, pz);
    }
    const t0 = performance.now();
    while ((this.nodeQueue?.length || this.queue.length) && performance.now() - t0 < budgetMs) {
      if (this.nodeQueue?.length && (!this.queue.length || this.nodeQueue[0].d <= this.queue[0].d + 1)) {
        const n = this.nodeQueue.shift();
        this.nodeChunks.set(n.k, this.buildNodes(n.x, n.z, n.k));
      } else {
        const q = this.queue.shift();
        const old = this.chunks.get(q.k);
        const c = this.buildChunk(q.x, q.z, q.lod);
        if (old) this.disposeChunk(old);
        this.chunks.set(q.k, c);
      }
    }
  }
  pending() { return this.queue.length + (this.nodeQueue?.length || 0); }

  buildChunk(cx, cz, lod) {
    const w = this.world;
    const seg = CHUNK / (GRID * lod);
    const n = seg + 1;
    const ix0 = cx * (CHUNK / GRID), iz0 = cz * (CHUNK / GRID);
    const H = new Float32Array(n * n), C = new Float32Array(n * n * 3);
    const col = [0, 0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gx = ix0 + i * lod, gz = iz0 + j * lod;
      H[j * n + i] = w.gridH(gx, gz);
    }
    const step = GRID * lod;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const h = H[j * n + i];
      const hx = H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)];
      const hz = H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i];
      const slope = Math.min(1, Math.hypot(hx, hz) / (2 * step));
      w.color((ix0 + i * lod) * GRID, (iz0 + j * lod) * GRID, h, slope, col);
      C.set(col, (j * n + i) * 3);
    }
    const tris = seg * seg * 2 + seg * 4 * 2;
    const pos = new Float32Array(tris * 9), cols = new Float32Array(tris * 9);
    let o = 0;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const pushTri = (a, b, c, pa, pb, pc) => {
      // a,b,c: grid indices; colour = average
      const r = (C[a * 3] + C[b * 3] + C[c * 3]) / 3, g = (C[a * 3 + 1] + C[b * 3 + 1] + C[c * 3 + 1]) / 3, bl = (C[a * 3 + 2] + C[b * 3 + 2] + C[c * 3 + 2]) / 3;
      for (const P of [pa, pb, pc]) { pos[o] = P[0]; pos[o + 1] = P[1]; pos[o + 2] = P[2]; cols[o] = r; cols[o + 1] = g; cols[o + 2] = bl; o += 3; }
    };
    const P = (i, j) => [ox + i * step, H[j * n + i], oz + j * step];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // split along b-c diagonal (matches World.ground)
      pushTri(a, c, b, P(i, j), P(i, j + 1), P(i + 1, j));
      pushTri(b, c, d, P(i + 1, j), P(i, j + 1), P(i + 1, j + 1));
    }
    // skirts hide LOD cracks
    const skirt = 6 * lod;
    const edge = (i0, j0, i1, j1) => {
      const a = j0 * n + i0, b = j1 * n + i1;
      const pa = P(i0, j0), pb = P(i1, j1);
      const qa = [pa[0], pa[1] - skirt, pa[2]], qb = [pb[0], pb[1] - skirt, pb[2]];
      pushTri(a, b, a, pa, qa, pb); pushTri(b, a, b, pb, qa, qb);
      pushTri(a, b, a, pa, pb, qa); pushTri(b, a, b, pb, qb, qa);
    };
    for (let i = 0; i < seg; i++) { edge(i, 0, i + 1, 0); edge(i, seg, i + 1, seg); edge(0, i, 0, i + 1); edge(seg, i, seg, i + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols.subarray(0, o), 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, TERRAIN_MAT);
    mesh.receiveShadow = lod <= 2;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    return { cx, cz, lod, mesh };
  }
  disposeChunk(c) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }

  buildNodes(cx, cz, k) {
    const nodes = this.world.chunkNodes(cx, cz);
    const byType = new Map();
    for (const n of nodes) { if (!byType.has(n.type)) byType.set(n.type, []); byType.get(n.type).push(n); }
    const meshes = [];
    const group = 'nodes:' + k;
    for (const [type, list] of byType) {
      const im = new THREE.InstancedMesh(nodeGeometry(type), MAT, list.length);
      im.castShadow = this.shadows && NODES[type].kind !== 'pick';
      im.receiveShadow = false;
      list.forEach((n, i) => {
        _q.setFromAxisAngle(_up, n.rot); _s.set(n.s, n.s, n.s); _p.set(n.x, n.y - 0.1, n.z);
        _m.compose(_p, _q, _s);
        n._mat = _m.clone();
        im.setMatrixAt(i, this.depleted.has(n.id) ? ZERO : n._mat);
        this.nodeIndex.set(n.id, { mesh: im, i, node: n });
        const def = NODES[type];
        if (def.kind !== 'pick') {
          n._col = this.physics.add(group, { t: 'cyl', x: n.x, y: n.y - 0.2, z: n.z, r: def.radius * n.s, h: def.height * n.s, ref: { kind: 'n', id: n.id, node: n } });
          if (this.depleted.has(n.id)) n._col.disabled = true, n._col.h = -100;
        } else {
          // pickables are raycast-only (thin cylinder that the body ignores)
          n._col = this.physics.add(group, { t: 'cyl', x: n.x, y: n.y, z: n.z, r: 0.5, h: def.height, ref: { kind: 'n', id: n.id, node: n }, ghost: true });
          if (this.depleted.has(n.id)) n._col.h = -100;
        }
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
    if (e.node._col) e.node._col.h = dep ? -100 : def.height * e.node.s;
  }
  // brief shake when a node is hit
  shakeNode(id, amt = 0.06) {
    const e = this.nodeIndex.get(id);
    if (!e || this.depleted.has(id)) return;
    const m = e.node._mat.clone();
    const n = e.node;
    _q.setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), amt);
    const r = new THREE.Quaternion().setFromAxisAngle(_up, n.rot).premultiply(_q);
    m.compose(_p.set(n.x, n.y - 0.1, n.z), r, _s.set(n.s, n.s, n.s));
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
