// Cave rendering: faceted surface-nets meshes of the shared cave field, built in 16 m columns around you
// while you're underground; ore veins and moss in the vertex colours, glowing crystals, ladders up to
// every entrance, dark fog and a lantern glow.
import * as THREE from 'three';
import { CAVE_TOP, CAVE_BOTTOM, CAVE_ZONE, CAVE_CELL, CAVE_ARRIVE } from '/shared/caves.js';

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const CRYSTAL = new THREE.MeshLambertMaterial({ color: 0x7fe8ff, emissive: 0x3ab8e8, emissiveIntensity: 1.4, flatShading: true });
const CRYSTAL2 = new THREE.MeshLambertMaterial({ color: 0xc890ff, emissive: 0x9050e0, emissiveIntensity: 1.4, flatShading: true });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x7a5534, flatShading: true });
const BEAM = new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
const Y0 = CAVE_BOTTOM - 4, Y1 = CAVE_TOP + 4, RES = 1;
const NY = Math.ceil((Y1 - Y0) / RES) + 1;
const _c = new THREE.Color();

// Naive surface nets on a padded grid: samples x,z in [-1, CAVE_CELL+1], y over the band.
function meshChunk(caves, cx, cz) {
  const N = CAVE_CELL + 3, x0 = cx * CAVE_CELL - 1, z0 = cz * CAVE_CELL - 1;
  const idx = (i, j, k) => (j * N + k) * N + i;
  const d = new Float32Array(N * N * NY);
  for (let j = 0; j < NY; j++) for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) d[idx(i, j, k)] = caves.rock(x0 + i, Y0 + j * RES, z0 + k);
  // one vertex per sign-changing cell
  const vIndex = new Int32Array((N - 1) * (N - 1) * (NY - 1)).fill(-1);
  const cidx = (i, j, k) => (j * (N - 1) + k) * (N - 1) + i;
  const vp = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let j = 0; j < NY - 1; j++) for (let k = 0; k < N - 1; k++) for (let i = 0; i < N - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, e] = corners[c]; cv[c] = d[idx(i + a, j + b, k + e)]; if (cv[c] > 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] > 0) === (cv[b] > 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      const A = corners[a], Bc = corners[b];
      sx += A[0] + (Bc[0] - A[0]) * t; sy += A[1] + (Bc[1] - A[1]) * t; sz += A[2] + (Bc[2] - A[2]) * t; n++;
    }
    vIndex[cidx(i, j, k)] = vp.length / 3;
    vp.push(x0 + i + sx / n, Y0 + (j + sy / n) * RES, z0 + k + sz / n);
  }
  // quads for every sign-changing grid edge whose base sample lies inside this chunk
  const pos = [], col = [];
  const V = (c) => [vp[c * 3], vp[c * 3 + 1], vp[c * 3 + 2]];
  const tri = (a, b, c) => {
    const A = V(a), Bv = V(b), Cv = V(c);
    pos.push(...A, ...Bv, ...Cv);
    // colour per face: rock, ore veins, moss on floors
    const mx = (A[0] + Bv[0] + Cv[0]) / 3, my = (A[1] + Bv[1] + Cv[1]) / 3, mz = (A[2] + Bv[2] + Cv[2]) / 3;
    const nx = (Bv[1] - A[1]) * (Cv[2] - A[2]) - (Bv[2] - A[2]) * (Cv[1] - A[1]), ny = (Bv[2] - A[2]) * (Cv[0] - A[0]) - (Bv[0] - A[0]) * (Cv[2] - A[2]), nz = (Bv[0] - A[0]) * (Cv[1] - A[1]) - (Bv[1] - A[1]) * (Cv[0] - A[0]);
    const up = ny / (Math.hypot(nx, ny, nz) || 1);
    const ore = caves.ore(mx, my, mz), v = 0.85 + Math.sin(mx * 1.7 + mz * 1.3 + my * 2.1) * 0.08;
    if (ore > 0.5) _c.setRGB(0.62 * v, 0.38 * v, 0.2 * v);
    else if (ore < -0.5) _c.setRGB(0.72 * v, 0.66 * v, 0.24 * v);
    else if (up > 0.6) _c.setRGB(0.3 * v, 0.34 * v, 0.24 * v);          // mossy floor
    else _c.setRGB(0.42 * v, 0.39 * v, 0.36 * v);
    for (let q = 0; q < 3; q++) col.push(_c.r, _c.g, _c.b);
  };
  const crystals = [];
  for (let j = 1; j < NY - 1; j++) for (let k = 1; k < N - 1; k++) for (let i = 1; i < N - 1; i++) {
    if (i < 1 || k < 1 || i > CAVE_CELL || k > CAVE_CELL) continue;
    const a = d[idx(i, j, k)] > 0;
    // +x edge
    if (a !== (d[idx(i + 1, j, k)] > 0)) {
      const c0 = vIndex[cidx(i, j - 1, k - 1)], c1 = vIndex[cidx(i, j, k - 1)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i, j - 1, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c1, c2); tri(c0, c2, c3); } else { tri(c0, c2, c1); tri(c0, c3, c2); } }
    }
    // +y edge
    if (a !== (d[idx(i, j + 1, k)] > 0)) {
      const c0 = vIndex[cidx(i - 1, j, k - 1)], c1 = vIndex[cidx(i, j, k - 1)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i - 1, j, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c2, c1); tri(c0, c3, c2); } else { tri(c0, c1, c2); tri(c0, c2, c3); } }
      // crystals sprout from some floors and ceilings
      if (caves.crystal(x0 + i, Y0 + j * RES, z0 + k) && ((i * 7 + k * 13 + j) % 5 === 0)) crystals.push([x0 + i, Y0 + (j + 0.5) * RES, z0 + k, a ? 1 : -1]);
    }
    // +z edge
    if (a !== (d[idx(i, j, k + 1)] > 0)) {
      const c0 = vIndex[cidx(i - 1, j - 1, k)], c1 = vIndex[cidx(i, j - 1, k)], c2 = vIndex[cidx(i, j, k)], c3 = vIndex[cidx(i - 1, j, k)];
      if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) { if (a) { tri(c0, c2, c1); tri(c0, c3, c2); } else { tri(c0, c1, c2); tri(c0, c2, c3); } }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geo: g, crystals };
}

export class CaveWorld {
  constructor(scene, caves, world) {
    this.scene = scene; this.caves = caves; this.world = world;
    this.chunks = new Map(); this.queue = []; this.center = [NaN, NaN]; this.active = false;
    this.lantern = new THREE.PointLight(0xffd8a0, 0, 22, 1.3);
    this.ambient = new THREE.HemisphereLight(0x6a7a9a, 0x2a2420, 0);
    scene.add(this.lantern); scene.add(this.ambient);
    this.ladders = new Map();
    this.crystalGeo = new THREE.OctahedronGeometry(0.35, 0); this.crystalGeo.scale(0.6, 1.8, 0.6);
  }
  dirty(x, y, z, r) {
    const c0 = Math.floor((x - r - 1) / CAVE_CELL), c1 = Math.floor((x + r + 1) / CAVE_CELL), d0 = Math.floor((z - r - 1) / CAVE_CELL), d1 = Math.floor((z + r + 1) / CAVE_CELL);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) { const k = a + ',' + b; if (this.chunks.has(k)) { this.disposeChunk(this.chunks.get(k)); this.chunks.delete(k); this.queue.unshift(k); } }
  }
  disposeChunk(c) { for (const m of c.meshes) { this.scene.remove(m); m.geometry?.dispose?.(); } }
  // entrances (shafts + mine adits) get a ladder and a faint beam of daylight
  setEntrances(list) {
    const want = new Set(list.map((e) => e.id));
    for (const [id, l] of this.ladders) if (!want.has(id)) { this.scene.remove(l); this.ladders.delete(id); }
    for (const e of list) {
      if (this.ladders.has(e.id)) continue;
      const g = new THREE.Group();
      const fy = this.caves.floorBelow(e.x + 0.0, CAVE_ARRIVE + 3, e.z, 20) ?? CAVE_ARRIVE - 4;
      const h = CAVE_TOP + 6 - fy;
      for (const sx of [-0.3, 0.3]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), WOOD); r.position.set(sx, h / 2, 0); g.add(r); }
      for (let y = 0.3; y < h; y += 0.4) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.06), WOOD); r.position.set(0, y, 0); g.add(r); }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.8, h, 10, 1, true), BEAM); beam.position.y = h / 2; g.add(beam);
      g.position.set(e.x, fy, e.z);
      this.scene.add(g); this.ladders.set(e.id, g); g.userData = { x: e.x, z: e.z, id: e.id };
    }
  }
  nearLadder(p) { for (const l of this.ladders.values()) if (Math.hypot(l.userData.x - p.x, l.userData.z - p.z) < 3) return l.userData; return null; }
  update(cam, dt) {
    const inCave = cam.y < CAVE_ZONE;
    this.active = inCave;
    this.lantern.intensity = inCave ? 1.6 : 0;
    this.ambient.intensity = inCave ? 0.35 : 0;
    if (inCave) this.lantern.position.set(cam.x, cam.y + 0.2, cam.z);
    for (const c of this.chunks.values()) for (const m of c.meshes) m.visible = inCave;
    for (const l of this.ladders.values()) l.visible = inCave;
    if (!inCave) return;
    const cx = Math.floor(cam.x / CAVE_CELL), cz = Math.floor(cam.z / CAVE_CELL), R = 3;
    if (cx !== this.center[0] || cz !== this.center[1]) {
      this.center = [cx, cz];
      const want = new Set();
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (Math.hypot(i, j) <= R + 0.3) want.add((cx + i) + ',' + (cz + j));
      for (const [k, c] of this.chunks) if (!want.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
      this.queue = [...want].filter((k) => !this.chunks.has(k)).sort((a, b) => { const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number); return Math.hypot(ax - cx, az - cz) - Math.hypot(bx - cx, bz - cz); });
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 12) {
      const k = this.queue.shift();
      if (this.chunks.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      const { geo, crystals } = meshChunk(this.caves, x, z);
      const meshes = [];
      const m = new THREE.Mesh(geo, MAT); m.receiveShadow = false; m.castShadow = false; this.scene.add(m); meshes.push(m);
      if (crystals.length) {
        const im = new THREE.InstancedMesh(this.crystalGeo, crystals.length % 2 ? CRYSTAL : CRYSTAL2, crystals.length);
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        crystals.forEach(([x2, y2, z2, s], i) => { e.set((Math.sin(x2) * 0.4) + (s < 0 ? Math.PI : 0), x2 + z2, Math.cos(z2) * 0.4); q.setFromEuler(e); mm.compose(new THREE.Vector3(x2, y2, z2), q, new THREE.Vector3(1, 0.7 + Math.abs(Math.sin(x2 * 3)) * 0.8, 1)); im.setMatrixAt(i, mm); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.scene.add(im); meshes.push(im);
      }
      this.chunks.set(k, { meshes });
    }
  }
}
