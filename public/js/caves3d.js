// Underground rendering: faceted surface-nets meshes of the shared rock field in 16 m cubes around you. Underground
// it meshes everything nearby; on the surface only the chunks where the ground is open (cave mouths, ravines, holes you
// dug). Dirt layers by depth, ore and mineral veins in the vertex colours, glowing crystals and cave life, a lava floor
// in the deepest caverns and underground lakes.
import * as THREE from 'three';
import { CAVE_TOP, CAVE_BOTTOM, CAVE_ZONE, CAVE_CELL, CAVE_ARRIVE, LAVA_Y, QUAD, layerAt } from '/shared/caves.js';
import { meshChunkData } from './caveMesh.js';
import { TERRAIN_MAT } from './terrain.js';

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

const LAVA_MAT = new THREE.MeshLambertMaterial({ color: 0xff6a1a, emissive: 0xff4a00, emissiveIntensity: 1.8 });
const LAKE_MAT = new THREE.MeshPhongMaterial({ color: 0x1a4a6a, transparent: true, opacity: 0.75, shininess: 80, depthWrite: false, side: THREE.DoubleSide });

export class CaveWorld {
  constructor(scene, caves, world) {
    this.scene = scene; this.caves = caves; this.world = world;
    this.chunks = new Map(); this.queue = []; this.center = null; this.active = false; this.empty = new Set();
    // meshing happens in a worker (no hitches while you explore or dig); the main thread only builds the meshes
    this.ver = new Map(); this.inflight = new Map(); this.worker = null;
    try {
      const w = new Worker(new URL('./caveWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onWorker(e.data);
      w.onerror = (e) => { console.warn('cave worker failed, meshing on the main thread', e.message); this.worker = null; this.inflight.clear(); };
      this.worker = w;
    } catch { this.worker = null; }
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
  // the worker needs the same world: call once the seed and edits are known, then for every edit
  initWorker(seed, tmods, cmods) { this.worker?.postMessage({ type: 'init', seed, tmods, cmods }); }
  syncTerrain(list) { this.worker?.postMessage({ type: 'tmods', list }); }
  syncMod(m) { this.worker?.postMessage({ type: 'cmod', m }); }
  onWorker(m) {
    this.inflight.delete(m.k);
    if ((this.ver.get(m.k) || 0) !== m.ver) { if (!this.queue.includes(m.k)) this.queue.unshift(m.k); return; } // edited meanwhile
    if (!this.wantSet?.has(m.k)) return;
    if (m.empty) { const old = this.chunks.get(m.k); if (old) { this.disposeChunk(old); this.chunks.delete(m.k); } this.empty.add(m.k); if (this.empty.size > 20000) this.empty.clear(); return; }
    this.install(m.k, m);
  }
  install(k, res) {
    const meshes = [];
    if (res.pos) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(res.col, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(res.nrm, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, MAT); this.scene.add(m); meshes.push(m);
    }
    if (res.spos) {
      // untouched ground inside an opened square: the terrain's own material, so it matches the grass around it
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(res.spos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(res.scol, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(res.snrm, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, TERRAIN_MAT); m.receiveShadow = true; this.scene.add(m); meshes.push(m);
    }
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
    const old = this.chunks.get(k); if (old) this.disposeChunk(old);
    this.chunks.set(k, { meshes });
  }
  dirty(x, y, z, r) {
    r = Math.abs(r);
    for (let a = Math.floor((x - r - 1) / C); a <= Math.floor((x + r + 1) / C); a++) for (let b = Math.floor((y - r - 1) / C); b <= Math.floor((y + r + 1) / C); b++) for (let c = Math.floor((z - r - 1) / C); c <= Math.floor((z + r + 1) / C); c++) {
      const k = a + ',' + b + ',' + c;
      this.empty.delete(k);
      this.ver.set(k, (this.ver.get(k) || 0) + 1);
      // with the worker, keep showing the old mesh until the new one arrives (no flicker); it's swapped in install()
      if (!this.worker && this.chunks.has(k)) { this.disposeChunk(this.chunks.get(k)); this.chunks.delete(k); }
      if (this.worker && this.chunks.has(k)) this.stale = (this.stale || new Set()).add(k);
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
      // (the squares just beyond its edges count too: the last half metre of an opened square is drawn by the next cube)
      for (let a = -1; a < 5; a++) for (let b = -1; b < 5; b++) {
        const qx = Math.floor(x / QUAD) + a, qz = Math.floor(z / QUAD) + b;
        if (caves.quadOpen(qx, qz)) open = true;
        if (a < 0 || b < 0 || a > 3 || b > 3) continue;
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
      this.wantSet = want;
      for (const [k, c] of this.chunks) if (!want.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
      const [ccx, ccy, ccz] = key.replace(/[us]$/, '').split(',').map(Number);
      this.queue = [...want].filter((k) => (!this.chunks.has(k) || this.stale?.has(k)) && !this.empty.has(k)).sort((a, b) => { const A = a.split(',').map(Number), B = b.split(',').map(Number); return Math.hypot(A[0] - ccx, (A[1] - ccy) * 1.5, A[2] - ccz) - Math.hypot(B[0] - ccx, (B[1] - ccy) * 1.5, B[2] - ccz); });
    }
    if (this.worker) {
      // keep a few chunks in flight in the worker, nearest first
      while (this.queue.length && this.inflight.size < 4) {
        const k = this.queue.shift();
        if ((this.chunks.has(k) && !this.stale?.has(k)) || this.empty.has(k) || this.inflight.has(k)) continue;
        this.stale?.delete(k);
        const [x, y, z] = k.split(',').map(Number), ver = this.ver.get(k) || 0;
        this.inflight.set(k, ver);
        this.worker.postMessage({ type: 'mesh', k, cx: x, cy: y, cz: z, ver });
      }
      return;
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 10) {
      const k = this.queue.shift();
      if (this.chunks.has(k) || this.empty.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number);
      const res = meshChunkData(caves, x, y, z);
      if (!res) { this.empty.add(k); if (this.empty.size > 20000) this.empty.clear(); continue; }
      this.install(k, res);
    }
  }
}
