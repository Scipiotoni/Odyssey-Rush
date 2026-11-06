// Underground rendering: faceted surface-nets meshes of the shared rock field in 16 m cubes around you. Underground
// it meshes everything nearby; on the surface only the chunks where the ground is open (cave mouths, ravines, holes you
// dug). Dirt layers by depth, ore and mineral veins in the vertex colours, glowing crystals and cave life, a lava floor
// in the deepest caverns and underground lakes.
import * as THREE from 'three';
import { CAVE_TOP, CAVE_BOTTOM, CAVE_ZONE, CAVE_CELL, CAVE_ARRIVE, LAVA_Y, QUAD, layerAt } from '/shared/caves.js';

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const CRYSTAL = new THREE.MeshLambertMaterial({ color: 0x7fe8ff, emissive: 0x3ab8e8, emissiveIntensity: 1.4, flatShading: true });
const CRYSTAL2 = new THREE.MeshLambertMaterial({ color: 0xc890ff, emissive: 0x9050e0, emissiveIntensity: 1.4, flatShading: true });
const WOOD = new THREE.MeshLambertMaterial({ color: 0x7a5534, flatShading: true });
const BEAM = new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
const GLOW_MATS = [0x40ffd8, 0x8aff60, 0xff60e0].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, flatShading: true }));
function glowGeo() {
  const stalk = new THREE.CylinderGeometry(0.03, 0.06, 0.6, 5); stalk.translate(0, 0.3, 0);
  const bulb = new THREE.IcosahedronGeometry(0.14, 0); bulb.translate(0, 0.65, 0);
  const parts = [stalk, bulb, stalk.clone().rotateZ(0.5).translate(0.12, -0.02, 0), bulb.clone().translate(0.32, -0.12, 0), stalk.clone().rotateX(-0.45).translate(0, -0.03, 0.14), bulb.clone().translate(0, -0.15, 0.3)];
  const pos = []; for (const p of parts) pos.push(...p.toNonIndexed().attributes.position.array);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
const GLOW_GEO = glowGeo();

const C = CAVE_CELL;
const _c = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// one 16 m cube of the rock field
function meshChunk(caves, cx, cy, cz) {
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
      if (up > 0.6 && depth > 25) _c.lerp(new THREE.Color(0.3 * v, 0.34 * v, 0.24 * v), 0.5);
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
  if (!pos.length && !crystals.length) return { geo: null, crystals, glows };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return { geo: g, crystals, glows };
}

const LAVA_MAT = new THREE.MeshLambertMaterial({ color: 0xff6a1a, emissive: 0xff4a00, emissiveIntensity: 1.8 });
const LAKE_MAT = new THREE.MeshPhongMaterial({ color: 0x1a4a6a, transparent: true, opacity: 0.75, shininess: 80, depthWrite: false, side: THREE.DoubleSide });

export class CaveWorld {
  constructor(scene, caves, world) {
    this.scene = scene; this.caves = caves; this.world = world;
    this.chunks = new Map(); this.queue = []; this.center = null; this.active = false; this.empty = new Set();
    this.lantern = new THREE.PointLight(0xffd8a0, 0, 9, 2);
    this.ambient = new THREE.HemisphereLight(0x6a7a9a, 0x2a2420, 0);
    scene.add(this.lantern); scene.add(this.ambient);
    this.ladders = new Map();
    this.crystalGeo = new THREE.OctahedronGeometry(0.35, 0); this.crystalGeo.scale(0.6, 1.8, 0.6);
    // the lava sea of the deepest caverns and underground lake surfaces (only visible where there's open cave)
    this.lava = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), LAVA_MAT); this.lava.visible = false; scene.add(this.lava);
    this.lavaLight = new THREE.PointLight(0xff6a20, 0, 40, 1.5); scene.add(this.lavaLight);
    this.lake = new THREE.Mesh(new THREE.PlaneGeometry(192, 192).rotateX(-Math.PI / 2), LAKE_MAT); this.lake.visible = false; scene.add(this.lake);
  }
  dirty(x, y, z, r) {
    r = Math.abs(r);
    for (let a = Math.floor((x - r - 1) / C); a <= Math.floor((x + r + 1) / C); a++) for (let b = Math.floor((y - r - 1) / C); b <= Math.floor((y + r + 1) / C); b++) for (let c = Math.floor((z - r - 1) / C); c <= Math.floor((z + r + 1) / C); c++) {
      const k = a + ',' + b + ',' + c;
      this.empty.delete(k);
      if (this.chunks.has(k)) { this.disposeChunk(this.chunks.get(k)); this.chunks.delete(k); }
      if (!this.queue.includes(k)) this.queue.unshift(k);
    }
  }
  disposeChunk(c) { for (const m of c.meshes) { this.scene.remove(m); m.geometry?.dispose?.(); } }
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
  // light falling down a blue-hole shaft from the sea floor
  setBlueHoles(list) {
    this.holes = this.holes || new Map();
    const want = new Set(list.map((h) => h.id));
    for (const [id, m] of this.holes) if (!want.has(id)) { this.scene.remove(m); this.holes.delete(id); }
    for (const h of list) {
      if (this.holes.has(h.id)) continue;
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 10, 24, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = -12; g.add(beam);
      const glow = new THREE.PointLight(0x3a90ff, 3, 40, 1.2); glow.position.y = -4; g.add(glow);
      g.position.set(h.x, CAVE_TOP + 4, h.z); g.userData.glow = glow; for (const ch of g.children) if (!ch.isLight) ch.visible = false; glow.intensity = 0;
      this.scene.add(g); this.holes.set(h.id, g);
    }
  }
  nearLadder(p) { for (const l of this.ladders.values()) if (Math.hypot(l.userData.x - p.x, l.userData.z - p.z) < 3) return l.userData; return null; }

  // which chunks to have around the camera
  wanted(cam) {
    const caves = this.caves, out = [];
    const cx = Math.floor(cam.x / C), cy = Math.floor(cam.y / C), cz = Math.floor(cam.z / C);
    const inside = caves.inVolume(cam.x, cam.y, cam.z) && caves.depthAt(cam.x, cam.y, cam.z) > 1;
    const R = inside ? 2 : 3;
    for (let i = -R; i <= R; i++) for (let k = -R; k <= R; k++) {
      if (Math.hypot(i, k) > R + 0.3) continue;
      const x = (cx + i) * C, z = (cz + k) * C;
      // is the ground open anywhere in this column?
      let open = false, sMin = Infinity, sMax = -Infinity;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const qx = Math.floor(x / QUAD) + a, qz = Math.floor(z / QUAD) + b;
        if (caves.quadOpen(qx, qz)) open = true;
        const s = caves.surface((qx + 0.5) * QUAD, (qz + 0.5) * QUAD); sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
      }
      const top = Math.floor((sMax + 2) / C), bot = Math.floor((sMin - 4) / C);
      if (inside) { for (let j = Math.min(top, cy + 1); j >= cy - 1; j--) out.push([cx + i, j, cz + k]); }
      else if (open) for (let j = top; j >= bot - 1; j--) out.push([cx + i, j, cz + k]);
    }
    return out;
  }
  update(cam, dt) {
    const caves = this.caves;
    const dep = caves.inVolume(cam.x, cam.y, cam.z) ? caves.depthAt(cam.x, cam.y, cam.z) : 0;
    const inCave = dep > 2;
    this.active = inCave;
    // just enough to see your hands and the next few metres: place torches to light the way
    this.lantern.intensity = inCave ? Math.min(0.55, (dep - 2) * 0.12) : 0;
    this.ambient.intensity = inCave ? 0.1 : 0; this.ambient.color.setHex(0x6a7a9a);
    if (inCave) this.lantern.position.set(cam.x, cam.y + 0.2, cam.z);
    for (const l of this.ladders.values()) l.visible = cam.y < CAVE_ZONE;
    // (the glow light stays in the scene with its intensity zeroed: adding/removing lights recompiles every shader)
    if (this.holes) for (const m of this.holes.values()) { const v = cam.y < CAVE_ZONE && caves.flooded(m.position.x, m.position.z); if (m.userData.v === v) continue; m.userData.v = v; for (const ch of m.children) if (!ch.isLight) ch.visible = v; if (m.userData.glow) m.userData.glow.intensity = v ? 3 : 0; }
    // lava and lakes near you
    this.lava.visible = cam.y < LAVA_Y + 60 && inCave;
    if (this.lava.visible) { this.lava.position.set(Math.round(cam.x / 8) * 8, LAVA_Y, Math.round(cam.z / 8) * 8); this.lavaLight.position.set(cam.x, LAVA_Y + 2, cam.z); this.lavaLight.intensity = Math.max(0, 1 - (cam.y - LAVA_Y) / 40) * 3; } else this.lavaLight.intensity = 0;
    const lk = caves.lakeLevel(cam.x, cam.z);
    this.lake.visible = inCave && lk > -1e9 && Math.abs(cam.y - lk) < 40;
    if (this.lake.visible) this.lake.position.set((Math.floor(cam.x / 192) + 0.5) * 192, lk, (Math.floor(cam.z / 192) + 0.5) * 192);
    // (re)plan which chunks to have when you move to another chunk
    const key = Math.floor(cam.x / C) + ',' + Math.floor(cam.y / C) + ',' + Math.floor(cam.z / C) + (inCave ? 'u' : 's');
    this.planT = (this.planT || 0) - dt;
    if (key !== this.center || this.planT <= 0) {
      this.center = key; this.planT = 2;
      const want = new Set(this.wanted(cam).map((c) => c.join(',')));
      for (const [k, c] of this.chunks) if (!want.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
      const [ccx, ccy, ccz] = key.replace(/[us]$/, '').split(',').map(Number);
      this.queue = [...want].filter((k) => !this.chunks.has(k) && !this.empty.has(k)).sort((a, b) => { const A = a.split(',').map(Number), B = b.split(',').map(Number); return Math.hypot(A[0] - ccx, (A[1] - ccy) * 1.5, A[2] - ccz) - Math.hypot(B[0] - ccx, (B[1] - ccy) * 1.5, B[2] - ccz); });
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 10) {
      const k = this.queue.shift();
      if (this.chunks.has(k) || this.empty.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number);
      const res = meshChunk(caves, x, y, z);
      if (!res) { this.empty.add(k); if (this.empty.size > 20000) this.empty.clear(); continue; }
      const meshes = [];
      if (res.geo) { const m = new THREE.Mesh(res.geo, MAT); this.scene.add(m); meshes.push(m); }
      if (res.crystals.length) {
        const im = new THREE.InstancedMesh(this.crystalGeo, res.crystals.length % 2 ? CRYSTAL : CRYSTAL2, res.crystals.length);
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        res.crystals.forEach(([x2, y2, z2, s2], i) => { e.set((Math.sin(x2) * 0.4) + (s2 < 0 ? Math.PI : 0), x2 + z2, Math.cos(z2) * 0.4); q.setFromEuler(e); mm.compose(new THREE.Vector3(x2, y2, z2), q, new THREE.Vector3(1, 0.7 + Math.abs(Math.sin(x2 * 3)) * 0.8, 1)); im.setMatrixAt(i, mm); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.scene.add(im); meshes.push(im);
      }
      for (let kind = 0; kind < 3; kind++) {
        const list = res.glows.filter((q) => q[3] === kind);
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(GLOW_GEO, GLOW_MATS[kind], list.length);
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        list.forEach(([x2, y2, z2], i) => { const sc = 0.7 + Math.abs(Math.sin(x2 * 7 + z2)) * 1.1; mm.compose(new THREE.Vector3(x2, y2 - 0.4, z2), q.setFromEuler(e.set(0, x2 * 3 + z2, 0)), new THREE.Vector3(sc, sc, sc)); im.setMatrixAt(i, mm); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.scene.add(im); meshes.push(im);
      }
      this.chunks.set(k, { meshes });
    }
  }
}
