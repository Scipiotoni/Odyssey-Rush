// Life under the sea (client-side ambience, deterministic placement): swaying kelp forests and sea grass,
// coral reefs on the shallow banks and seamounts, schools of fish that scatter when you swim at them,
// pulsing jellyfish in the deep and the odd whale gliding past with its song.
import * as THREE from 'three';
import { hash3 } from '/shared/noise.js';
import { audio } from './audio.js';

const CELL = 8, R = 104;           // placement grid and radius around the camera
const MAX_KELP = 1600, MAX_GRASS = 2600, MAX_CORAL = 900, SCHOOLS = 9, PER_SCHOOL = 26, JELLY = 26;
const CORAL_COLS = [0xe0607a, 0xf08a3a, 0x9a5ad0, 0xf0d040, 0x40c8b8, 0xff7aa8, 0xd84a3a, 0x7ad070];

const swayUniforms = { uTime: { value: 0 } };
function swayMat(color, amp, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 wp0 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float k = position.y * position.y;
        float ph = wp0.x * 0.37 + wp0.z * 0.29;
        transformed.x += sin(uTime * 0.9 + ph + position.y * 0.6) * ${amp.toFixed(3)} * k;
        transformed.z += cos(uTime * 0.7 + ph * 1.3 + position.y * 0.5) * ${(amp * 0.7).toFixed(3)} * k;
      }`);
  };
  m.customProgramCacheKey = () => 'sway' + amp;
  return m;
}

// ribbon of kelp: unit height (scaled per instance), a few blades with gas bladders
function kelpGeo() {
  const parts = [];
  for (let b = 0; b < 3; b++) {
    const g = new THREE.PlaneGeometry(0.28, 1, 1, 8), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.5, w = 0.6 + Math.sin(y * 9 + b) * 0.25; p.setXYZ(i, p.getX(i) * w + Math.sin(y * 5 + b * 2) * 0.12, y, 0); }
    g.rotateY(b * 2.1); g.translate((b - 1) * 0.12, 0, (b % 2) * 0.1);
    parts.push(g);
  }
  return mergeGeos(parts);
}
function grassGeo() {
  const parts = [];
  for (let b = 0; b < 3; b++) { const g = new THREE.PlaneGeometry(0.16, 1, 1, 3); g.translate(0, 0.5, 0); g.rotateY(b * 1.05); parts.push(g); }
  return mergeGeos(parts);
}
function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g of list) { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
function coralGeos() {
  // branching coral, sea fan, brain coral, tube sponge
  const branch = []; for (let i = 0; i < 6; i++) { const c = new THREE.ConeGeometry(0.07, 0.6 + (i % 3) * 0.2, 5); c.translate(0, 0.3, 0); c.rotateZ((i - 2.5) * 0.28); c.rotateY(i * 1.3); branch.push(c); }
  const fan = new THREE.CircleGeometry(0.55, 9, 0, Math.PI); fan.scale(1, 1.2, 1);
  const brain = new THREE.IcosahedronGeometry(0.4, 1); brain.scale(1, 0.62, 1); brain.translate(0, 0.15, 0);
  const tubes = []; for (let i = 0; i < 4; i++) { const c = new THREE.CylinderGeometry(0.07, 0.09, 0.5 + i * 0.15, 6, 1, true); c.translate(Math.cos(i * 1.6) * 0.12, 0.25 + i * 0.07, Math.sin(i * 1.6) * 0.12); tubes.push(c); }
  return [mergeGeos(branch), mergeGeos([fan]), brain, mergeGeos(tubes)];
}
function fishGeo() {
  // a small faceted fish pointing +z; tail at -z
  const body = new THREE.OctahedronGeometry(0.12, 0); body.scale(0.45, 0.8, 1.6);
  const tail = new THREE.ConeGeometry(0.1, 0.16, 3); tail.rotateX(-Math.PI / 2); tail.scale(0.25, 1, 1); tail.translate(0, 0, -0.24);
  return mergeGeos([body, tail]);
}

export class SeaLife {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.t = 0; this.cx = null; this.cz = null;
    this.kelp = new THREE.InstancedMesh(kelpGeo(), swayMat(0x7a8a34, 0.03), MAX_KELP);
    this.grass = new THREE.InstancedMesh(grassGeo(), swayMat(0x3e7a3a, 0.18), MAX_GRASS);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
    this.corals = coralGeos().map((g) => new THREE.InstancedMesh(g, cm, MAX_CORAL));
    for (const m of [this.kelp, this.grass, ...this.corals]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    // fish: each school has its own colour; tails wiggle in the shader
    const fm = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60, specular: 0x557788, flatShading: true });
    fm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = swayUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float ph = float(gl_InstanceID) * 1.7; float k = clamp(-position.z * 4.0, 0.0, 1.0); transformed.x += sin(uTime * 14.0 + ph) * 0.06 * k; }`);
    };
    fm.customProgramCacheKey = () => 'fishwiggle';
    this.fish = new THREE.InstancedMesh(fishGeo(), fm, SCHOOLS * PER_SCHOOL);
    this.fish.count = 0; this.fish.frustumCulled = false; scene.add(this.fish);
    this.schools = [];
    // jellyfish: translucent glowing bells with trailing tentacles
    const bell = new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const tent = []; for (let i = 0; i < 6; i++) { const c = new THREE.CylinderGeometry(0.012, 0.004, 1.1, 3); c.translate(Math.cos(i) * 0.2, -0.55, Math.sin(i) * 0.2); tent.push(c); }
    const jg = mergeGeos([bell, ...tent]);
    this.jelly = new THREE.InstancedMesh(jg, new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x6a3a8a, transparent: true, opacity: 0.55, shininess: 90, depthWrite: false, side: THREE.DoubleSide }), JELLY);
    this.jelly.count = 0; this.jelly.frustumCulled = false; scene.add(this.jelly);
    this.jellies = [];
    this.whale = null; this.whaleT = 20;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  seaAt(x, z) { const g = this.world.ground(x, z); return g < -1.2 && !this.ice?.inland(x, z) ? g : null; }

  rebuild(cam) {
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s, c = this._c;
    let nk = 0, ng = 0; const nc = [0, 0, 0, 0];
    const i0 = Math.floor((cam.x - R) / CELL), i1 = Math.floor((cam.x + R) / CELL), j0 = Math.floor((cam.z - R) / CELL), j1 = Math.floor((cam.z + R) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x0 = i * CELL, z0 = j * CELL;
      const gc = this.seaAt(x0 + CELL / 2, z0 + CELL / 2);
      if (gc === null) continue;
      const depth = -gc;
      const forest = this.world.nColor.noise(x0 / 140 + 9, z0 / 140 - 4), reef = this.world.nColor.noise(x0 / 90 - 31, z0 / 90 + 17);
      for (let k = 0; k < 6; k++) {
        const h = hash3(i, j, k, 41), x = x0 + hash3(i, j, k, 42) * CELL, z = z0 + hash3(i, j, k, 43) * CELL;
        const g = this.world.ground(x, z), d = -g;
        if (d < 1.2) continue;
        // kelp forests from 4 to 30 m, reaching most of the way to the surface
        if (forest > 0.15 && d > 4 && d < 30 && h < 0.55 && nk < MAX_KELP) {
          const ht = Math.min(d - 1.2, 3 + hash3(i, j, k, 44) * 10);
          m.compose(p.set(x, g - 0.1, z), q.setFromEuler(e.set(0, h * 30, 0)), s.set(1, ht, 1));
          this.kelp.setMatrixAt(nk++, m);
        } else if (d < 12 && h < 0.8 && ng < MAX_GRASS) {
          // sea-grass meadows in the shallows
          m.compose(p.set(x, g - 0.05, z), q.setFromEuler(e.set(0, h * 20, 0)), s.set(1, 0.3 + hash3(i, j, k, 45) * 0.6, 1));
          this.grass.setMatrixAt(ng++, m);
        }
        // coral reefs on banks and seamounts (warm, sunlit water)
        if (reef > 0.05 && d > 1.5 && d < 26 && hash3(i, j, k, 46) < 0.75) {
          const kind = Math.floor(hash3(i, j, k, 47) * 4);
          if (nc[kind] >= MAX_CORAL) continue;
          const sc = 0.6 + hash3(i, j, k, 48) * 1.4;
          const nx = x + (hash3(i, j, k, 49) - 0.5) * 2, nz = z + (hash3(i, j, k, 50) - 0.5) * 2;
          m.compose(p.set(nx, this.world.ground(nx, nz) - 0.05, nz), q.setFromEuler(e.set(0, h * 40, 0)), s.set(sc, sc, sc));
          this.corals[kind].setMatrixAt(nc[kind], m);
          this.corals[kind].setColorAt(nc[kind], c.setHex(CORAL_COLS[Math.floor(hash3(i, j, k, 51) * CORAL_COLS.length)]).multiplyScalar(d > 15 ? 0.7 : 1));
          nc[kind]++;
        }
      }
      void depth;
    }
    this.kelp.count = nk; this.grass.count = ng; this.kelp.instanceMatrix.needsUpdate = this.grass.instanceMatrix.needsUpdate = true;
    this.corals.forEach((cm, i) => { cm.count = nc[i]; cm.instanceMatrix.needsUpdate = true; if (cm.instanceColor) cm.instanceColor.needsUpdate = true; });
  }

  spawnSchool(cam) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 45, x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      const g = this.seaAt(x, z);
      if (g === null || g > -3) continue;
      const y = Math.max(g + 1.2, Math.min(-1, cam.y + (Math.random() - 0.5) * 10));
      const cols = [0xc8d4dc, 0xe8c040, 0x5a8ac8, 0xe07040, 0x9ac8a0, 0xd8d8e8];
      return { x, y, z, vx: 0, vz: 0, yaw: Math.random() * 6.28, col: cols[Math.floor(Math.random() * cols.length)], size: 0.6 + Math.random() * 1.2, spread: 1.5 + Math.random() * 2.5, t: Math.random() * 100, scatter: 0, fish: Array.from({ length: PER_SCHOOL }, () => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() * 6.28]) };
    }
    return null;
  }

  update(dt, cam, underwater) {
    this.t += dt; swayUniforms.uTime.value = this.t;
    // only near the sea: plants within a cell or two of the shore or below you
    const near = cam.y < 25 && (this.seaAt(cam.x, cam.z) !== null || this.seaAt(cam.x + 60, cam.z) !== null || this.seaAt(cam.x - 60, cam.z) !== null || this.seaAt(cam.x, cam.z + 60) !== null || this.seaAt(cam.x, cam.z - 60) !== null);
    const vis = near && cam.y > -125;
    for (const m of [this.kelp, this.grass, ...this.corals, this.fish, this.jelly]) m.visible = vis;
    if (!vis) return;
    const ci = Math.floor(cam.x / 24), cj = Math.floor(cam.z / 24);
    if (ci !== this.cx || cj !== this.cz) { this.cx = ci; this.cz = cj; this.rebuild(cam); }
    this.updateFish(dt, cam, underwater);
    this.updateJelly(dt, cam, underwater);
    this.updateWhale(dt, cam, underwater);
  }

  updateFish(dt, cam, underwater) {
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s, c = this._c;
    // keep schools around you, recycle far ones
    this.schools = this.schools.filter((sc) => Math.hypot(sc.x - cam.x, sc.z - cam.z) < 90);
    while (this.schools.length < SCHOOLS) { const sc = this.spawnSchool(cam); if (!sc) break; this.schools.push(sc); }
    let n = 0;
    for (const sc of this.schools) {
      sc.t += dt;
      // wander: smooth heading changes; scatter away from a nearby swimmer
      const dx = sc.x - cam.x, dy = sc.y - cam.y, dz = sc.z - cam.z, d = Math.hypot(dx, dy, dz);
      if (d < 5 && underwater) sc.scatter = 1;
      sc.scatter = Math.max(0, sc.scatter - dt * 0.4);
      sc.yaw += Math.sin(sc.t * 0.3) * dt * 0.6 + (sc.scatter > 0.5 ? (Math.atan2(dx, dz) - sc.yaw) * dt * 3 : 0);
      const sp = 1.2 + sc.scatter * 5;
      const nx = sc.x + Math.sin(sc.yaw) * sp * dt, nz = sc.z + Math.cos(sc.yaw) * sp * dt;
      const g = this.seaAt(nx, nz);
      if (g === null || g > -2.5) sc.yaw += Math.PI * dt * 2; else { sc.x = nx; sc.z = nz; sc.y = Math.max(g + 1, Math.min(-0.8, sc.y + Math.sin(sc.t * 0.2) * dt * 0.3)); }
      const spr = sc.spread * (1 + sc.scatter * 1.5);
      for (const f of sc.fish) {
        if (n >= this.fish.count && n >= SCHOOLS * PER_SCHOOL) break;
        const w = sc.t * (0.8 + f[3] * 0.05) + f[3];
        p.set(sc.x + (f[0] + Math.sin(w) * 0.25) * spr * 2, sc.y + (f[1] + Math.sin(w * 1.3) * 0.15) * spr, sc.z + (f[2] + Math.cos(w) * 0.25) * spr * 2);
        m.compose(p, q.setFromEuler(e.set(Math.sin(w * 0.7) * 0.15, sc.yaw + Math.sin(w) * 0.3, 0)), s.set(sc.size, sc.size, sc.size));
        this.fish.setMatrixAt(n, m); this.fish.setColorAt(n, c.setHex(sc.col));
        n++;
      }
    }
    this.fish.count = n; this.fish.instanceMatrix.needsUpdate = true; if (this.fish.instanceColor) this.fish.instanceColor.needsUpdate = true;
  }

  updateJelly(dt, cam) {
    const m = this._m, q = this._q, p = this._p, s = this._s;
    this.jellies = this.jellies.filter((j) => Math.hypot(j.x - cam.x, j.z - cam.z) < 70);
    for (let tries = 0; this.jellies.length < JELLY && tries < 4; tries++) {
      const a = Math.random() * 6.28, r = 10 + Math.random() * 55, x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r, g = this.seaAt(x, z);
      if (g === null || g > -12) continue;
      this.jellies.push({ x, z, y: Math.max(g + 3, -3 - Math.random() * 25), ph: Math.random() * 6.28, sz: 0.5 + Math.random() * 1.1 });
    }
    let n = 0;
    for (const j of this.jellies) {
      j.ph += dt * 1.6;
      const pulse = Math.sin(j.ph);
      j.y += (Math.max(0, pulse) * 0.5 - 0.12) * dt;
      j.x += Math.sin(j.ph * 0.1) * dt * 0.1;
      m.compose(p.set(j.x, Math.min(-1.2, j.y), j.z), q.identity(), s.set(j.sz * (1 + pulse * 0.12), j.sz * (1 - pulse * 0.15), j.sz * (1 + pulse * 0.12)));
      this.jelly.setMatrixAt(n++, m);
    }
    this.jelly.count = n; this.jelly.instanceMatrix.needsUpdate = true;
  }

  // the occasional whale far below in the deep, singing
  updateWhale(dt, cam, underwater) {
    this.whaleT -= dt;
    if (!this.whale && this.whaleT <= 0) {
      this.whaleT = 50 + Math.random() * 90;
      const a = Math.random() * 6.28, x = cam.x + Math.cos(a) * 70, z = cam.z + Math.sin(a) * 70, g = this.seaAt(x, z);
      if (g !== null && g < -30) { this.whale = { mesh: makeWhale(), x, z, y: Math.max(g + 8, -18), yaw: a + Math.PI + 0.6, t: 0, sang: false }; this.scene.add(this.whale.mesh); }
    }
    const w = this.whale;
    if (!w) return;
    w.t += dt;
    w.x += Math.sin(w.yaw) * 3 * dt; w.z += Math.cos(w.yaw) * 3 * dt; w.yaw += Math.sin(w.t * 0.1) * dt * 0.05;
    w.mesh.position.set(w.x, w.y + Math.sin(w.t * 0.3) * 1.5, w.z); w.mesh.rotation.set(Math.sin(w.t * 0.3 + 1) * 0.05, w.yaw, 0);
    w.mesh.userData.tail.rotation.x = Math.sin(w.t * 0.9) * 0.3;
    if (underwater && !w.sang && Math.hypot(w.x - cam.x, w.z - cam.z) < 90) { w.sang = true; audio.whaleSong?.(); }
    if (w.t > 70 || this.seaAt(w.x, w.z) === null) { this.scene.remove(w.mesh); this.whale = null; }
  }
}

function makeWhale() {
  const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0x3a4652, flatShading: true }), belly = new THREE.MeshLambertMaterial({ color: 0xa8aeb2, flatShading: true });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1).scale(1, 0.75, 4.2), mat); g.add(body);
  const bel = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1).scale(0.9, 0.45, 3.6), belly); bel.position.set(0, -0.8, 1); g.add(bel);
  for (const sx of [-1, 1]) { const fin = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 3).scale(0.25, 1, 1), mat); fin.position.set(sx * 2.4, -1, 3); fin.rotation.set(0.6, 0, sx * 1.9); g.add(fin); }
  const tail = new THREE.Group(); tail.position.set(0, 0, -9); g.add(tail);
  const stock = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4, 6).rotateX(-Math.PI / 2), mat); stock.position.z = -1.5; tail.add(stock);
  const fluke = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 1.8), mat); fluke.position.z = -3.6; tail.add(fluke);
  g.userData.tail = tail;
  return g;
}
