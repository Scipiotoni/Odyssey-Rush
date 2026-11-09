// Living world: wind-swayed grass and vegetation, ambient wildlife (birds, butterflies, fireflies,
// rabbits, falling leaves) and ambience sounds. Purely cosmetic and client-side.
import * as THREE from 'three';
import { BIOME, POI_FLAT } from '/shared/worldgen.js';
import { hashRng } from '/shared/noise.js';
import { injectSeason } from './season.js';

// ---------------------------------------------------------------- wind shader
export const WIND = { uTime: { value: 0 }, uWind: { value: 1 }, uFade: { value: 60 } };
// Clone a material and bend its vertices with the wind: more at the top (y / height).
// fade = distance (m) at which the geometry shrinks into the ground (used by grass).
export function windMaterial(base, { amp = 0.1, height = 1, freq = 1.4, fade = 0, key = '', season = null } = {}) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind; sh.uniforms.uFade = WIND.uFade;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 wp = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #ifdef USE_INSTANCING
          wp += instanceMatrix[3].xyz;
        #endif
        float hh = clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.6);
        float k = hh * hh * ${amp.toFixed(4)} * uWind;
        float t = uTime * ${freq.toFixed(3)};
        float gust = sin(t * 0.21 + wp.x * 0.013) * 0.5 + 0.75;
        float g = (sin(t + wp.x * 0.09 + wp.z * 0.07) * 0.7 + sin(t * 2.6 + wp.x * 0.37 + wp.z * 0.29) * 0.3) * gust;
        transformed.x += g * k;
        transformed.z += (cos(t * 0.83 + wp.z * 0.11) * 0.45 + 0.25) * k * gust;
        ${fade ? `float dc = distance(wp.xz, cameraPosition.xz);
        float fs = 1.0 - smoothstep(uFade * 0.72, uFade, dc);
        transformed *= fs;` : ''}
      }`);
    if (season) injectSeason(sh, season);
  };
  m.customProgramCacheKey = () => 'wind:' + key + amp + height + fade + (season || '');
  return m;
}

// ---------------------------------------------------------------- grass
const CELL = 16; // grass cells of 16 m; how many around the player depends on the detail setting
let RADIUS = 3;
const VC = new THREE.MeshLambertMaterial({ vertexColors: true }); // blades are built two-sided with upward normals so both sides are lit
const GRASS_MAT = windMaterial(VC, { amp: 0.14, height: 0.55, freq: 1.7, fade: 1, key: 'grass', season: 'grass' });

function tuftGeometry(blades, hMin, hMax, seed) {
  const rnd = hashRng(seed, 1, 2, 3);
  const pos = [], col = [], nrm = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.16, h = hMin + rnd() * (hMax - hMin), w = 0.03 + rnd() * 0.025;
    const lean = (rnd() - 0.5) * 0.5 * h, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const ca = Math.cos(a + 1.57), sa = Math.sin(a + 1.57);
    const base = pos.length / 3;
    // base L/R, middle L/R, tip — a tapered, slightly bent blade
    const ring = [[-w, 0, 0.42], [w, 0, 0.42], [-w * 0.6, h * 0.55, 0.72], [w * 0.6, h * 0.55, 0.72], [0, h, 1.0]];
    ring.forEach(([dx, y, c], k) => {
      const bend = (y / h) ** 1.6 * lean;
      pos.push(ox + ca * dx + Math.cos(a) * bend, y, oz + sa * dx + Math.sin(a) * bend);
      const v = c * (0.9 + rnd() * 0.2);
      col.push(v, v, v);
      nrm.push(0, 1, 0);
    });
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
    idx.push(base, base + 3, base + 1, base, base + 2, base + 3, base + 2, base + 4, base + 3); // back side
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
const TUFTS = [tuftGeometry(9, 0.18, 0.4, 1), tuftGeometry(11, 0.25, 0.55, 2), tuftGeometry(8, 0.45, 1.05, 3)]; // short, normal, tall (reeds)
// per-biome: density per m², tuft kind, colour (h,s,l) and jitter
const GRASS_BIOMES = {
  [BIOME.GRASS]: { d: 0.95, kind: 1, hsl: [0.25, 0.62, 0.34], scale: [0.8, 1.3] },
  [BIOME.FOREST]: { d: 0.7, kind: 1, hsl: [0.28, 0.55, 0.27], scale: [0.8, 1.25] },
  [BIOME.SWAMP]: { d: 0.8, kind: 2, hsl: [0.19, 0.38, 0.33], scale: [0.9, 1.6] },
  [BIOME.BEACH]: { d: 0.06, kind: 0, hsl: [0.13, 0.4, 0.55], scale: [0.6, 1.0] },
  [BIOME.DESERT]: { d: 0.05, kind: 0, hsl: [0.12, 0.45, 0.52], scale: [0.6, 1.0] },
  [BIOME.ROCK]: { d: 0.12, kind: 0, hsl: [0.22, 0.28, 0.38], scale: [0.6, 1.0] },
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

class Grass {
  constructor(scene, world, physics) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.cells = new Map(); this.queue = []; this.center = [NaN, NaN]; this.density = 1;
  }
  invalidate(x, z) {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    const c = this.cells.get(k);
    if (c) { this.dispose(c); this.cells.delete(k); this.queue.unshift(k); }
  }
  setDensity(d, radius) { RADIUS = radius; WIND.uFade.value = CELL * (radius + 0.4); if (d !== this.density || radius !== this.radius) { this.radius = radius; this.density = d; for (const c of this.cells.values()) this.dispose(c); this.cells.clear(); this.center = [NaN, NaN]; } }
  update(px, pz) {
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    if (cx !== this.center[0] || cz !== this.center[1]) {
      this.center = [cx, cz];
      const want = new Set();
      for (let i = -RADIUS; i <= RADIUS; i++) for (let j = -RADIUS; j <= RADIUS; j++) if (Math.hypot(i, j) <= RADIUS + 0.5) want.add(`${cx + i},${cz + j}`);
      for (const [k, c] of this.cells) if (!want.has(k)) { this.dispose(c); this.cells.delete(k); }
      this.queue = [...want].filter((k) => !this.cells.has(k)).sort((a, b) => { const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number); return Math.hypot(ax - cx, az - cz) - Math.hypot(bx - cx, bz - cz); });
    }
    // build the nearest cell each frame, and a second one only if that was quick (no hitches when moving fast)
    const t0 = performance.now();
    for (let n = 0; n < 2 && this.queue.length && (n === 0 || performance.now() - t0 < 3); n++) {
      const k = this.queue.shift();
      if (this.cells.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      this.cells.set(k, this.build(x, z));
    }
  }
  build(cx, cz) {
    const w = this.world, rnd = hashRng(cx, cz, 909, w.seed);
    const x0 = cx * CELL, z0 = cz * CELL;
    // skip cells inside monuments
    const np = w.nearestPOI(x0 + CELL / 2, z0 + CELL / 2);
    const inPoi = (x, z) => np && Math.hypot(x - np.poi.x, z - np.poi.z) < POI_FLAT + 4;
    // structures in this cell? then check each tuft so grass doesn't poke through floors
    const cols = this.physics.query(x0 + CELL / 2, z0 + CELL / 2, CELL * 0.8, []).filter((c) => !c.ghost && c.ref?.kind === 's');
    const lists = [[], [], []];
    const tries = Math.round(CELL * CELL * 1.5 * this.density);
    for (let i = 0; i < tries; i++) {
      const x = x0 + rnd() * CELL, z = z0 + rnd() * CELL, r = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      const h = w.ground(x, z);
      if (h < 0.5) continue;
      const b = w.biome(x, z, h), def = GRASS_BIOMES[b];
      if (!def || r > def.d) continue;
      if (w.groundNormal(x, z)[1] < 0.78) continue;
      if (inPoi(x, z)) continue;
      if (this.physics.caves?.surface && this.physics.caves.open(x, z)) continue; // no grass floating over a hole
      if (cols.length) { const g = this.physics.groundAt(x, z, h + 4, 8); if (this.physics.lastSurf && g > h - 0.6) continue; }
      // a little clumping: grass thins out in noisy patches
      if (Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) * Math.sin(z * 0.19 + x * 0.05) > 0.55 && r2 < 0.6) continue;
      const tall = b === BIOME.SWAMP ? 2 : r2 < 0.18 ? 0 : def.kind;
      const sc = def.scale[0] + r3 * (def.scale[1] - def.scale[0]);
      _c.setHSL(def.hsl[0] + (r4 - 0.5) * 0.04, def.hsl[1] * (0.85 + r2 * 0.3), def.hsl[2] * (0.85 + r3 * 0.3));
      lists[tall].push([x, h - 0.03, z, r4 * 6.283, sc, _c.r, _c.g, _c.b]);
    }
    const meshes = [];
    lists.forEach((L, kind) => {
      if (!L.length) return;
      const im = new THREE.InstancedMesh(TUFTS[kind], GRASS_MAT, L.length);
      L.forEach(([x, y, z, a, sc, r, g, b], i) => {
        _q.setFromAxisAngle(_up, a); _s.set(sc, sc * (0.85 + (i % 7) * 0.05), sc); _p.set(x, y, z);
        im.setMatrixAt(i, _m.compose(_p, _q, _s));
        im.setColorAt(i, _c.setRGB(r, g, b));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.frustumCulled = true; im.castShadow = false; im.receiveShadow = true;
      this.scene.add(im); meshes.push(im);
    });
    return { meshes };
  }
  dispose(c) { for (const m of c.meshes) { this.scene.remove(m); m.dispose(); } }
}

// ---------------------------------------------------------------- ambient wildlife
const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
function wingGeo(span, chord) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, chord * 0.5, span, 0, chord * 0.1, span * 0.8, 0, -chord * 0.5, 0, 0, -chord * 0.4], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}
function makeBird(color, size = 1) {
  const g = new THREE.Group();
  const m = lam(color, { side: THREE.DoubleSide }), dk = lam(new THREE.Color(color).multiplyScalar(0.6));
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.09 * size, 0.42 * size, 5), m); body.rotation.x = Math.PI / 2; g.add(body);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 * size, 0), dk); head.position.z = 0.2 * size; head.position.y = 0.02; g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025 * size, 0.08 * size, 4), lam(0xe0a030)); beak.rotation.x = Math.PI / 2; beak.position.z = 0.29 * size; g.add(beak);
  const tail = new THREE.Mesh(wingGeo(0.12 * size, 0.18 * size), m); tail.rotation.set(0, Math.PI / 2, Math.PI / 2); tail.position.z = -0.22 * size; g.add(tail);
  const wings = [-1, 1].map((s) => { const p = new THREE.Group(); const w = new THREE.Mesh(wingGeo(0.42 * size, 0.2 * size), m); w.scale.x = s; p.add(w); g.add(p); return p; });
  g.userData = { wings, mat: m, dk };
  return g;
}
function makeButterfly(color) {
  const g = new THREE.Group();
  const m = lam(color, { side: THREE.DoubleSide, emissive: new THREE.Color(color).multiplyScalar(0.15) });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 4), lam(0x222222)); body.rotation.x = Math.PI / 2; g.add(body);
  const wings = [-1, 1].map((s) => {
    const p = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.03, 0.07, 0, 0.06, 0.08, 0, 0.0, 0.05, 0, -0.05, 0, 0, -0.03], 3));
    geo.setIndex([0, 1, 2, 0, 2, 4, 2, 3, 4]); geo.computeVertexNormals();
    const w = new THREE.Mesh(geo, m); w.scale.x = s; p.add(w); g.add(p); return p;
  });
  g.userData = { wings };
  return g;
}
function makeRabbit(color) {
  const g = new THREE.Group();
  const m = lam(color), lt = lam(new THREE.Color(color).lerp(new THREE.Color(0xf4ece0), 0.55)), eye = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const ic = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const body = new THREE.Mesh(ic(0.13), m); body.scale.set(0.9, 0.85, 1.25); body.position.set(0, 0.14, 0); g.add(body);
  const head = new THREE.Group(); head.position.set(0, 0.24, 0.13); g.add(head);
  const hm = new THREE.Mesh(ic(0.075), m); hm.scale.set(0.9, 0.9, 1.1); head.add(hm);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.1, 2, 4), m); ear.position.set(s * 0.03, 0.1, -0.02); ear.rotation.set(-0.35, 0, s * 0.18); head.add(ear);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 5, 4), eye); e.position.set(s * 0.045, 0.015, 0.05); head.add(e);
  }
  const tail = new THREE.Mesh(ic(0.04, 0), lt); tail.position.set(0, 0.17, -0.17); g.add(tail);
  const feet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.2), m); feet.position.set(0, 0.03, -0.04); g.add(feet);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { body, head };
  return g;
}

let _dot = null;
function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}
const BUTTERFLY_COLORS = [0xf0a020, 0xe8e8f0, 0x4a90e0, 0xe05878, 0xf2d040, 0x9a60e0];

export class Nature {
  constructor(scene, world, physics) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.grass = new Grass(scene, world, physics);
    this.t = 0;
    this.flocks = [];
    for (let f = 0; f < 3; f++) {
      const n = 5 + f * 2, birds = [];
      for (let i = 0; i < n; i++) { const b = makeBird(0x3a3a40, 1); scene.add(b); birds.push({ m: b, off: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8), ph: Math.random() * 6 }); }
      this.flocks.push({ birds, c: new THREE.Vector3(), a: Math.random() * 6.28, r: 40 + f * 30, h: 28 + f * 9, sp: 0.07 + f * 0.02, kind: null });
    }
    this.butterflies = [];
    for (let i = 0; i < 14; i++) { const b = makeButterfly(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]); b.visible = false; scene.add(b); this.butterflies.push({ m: b, p: new THREE.Vector3(), home: new THREE.Vector3(), v: new THREE.Vector3(), ph: Math.random() * 6, alive: false }); }
    this.rabbits = [];
    for (let i = 0; i < 5; i++) { const r = makeRabbit(i % 2 ? 0x8a7258 : 0xa8957a); r.visible = false; scene.add(r); this.rabbits.push({ m: r, p: new THREE.Vector3(), yaw: 0, hop: 0, t: 0, alive: false, flee: 0 }); }
    // fireflies + pollen as point clouds
    const pts = (n, color, size, blending = THREE.AdditiveBlending) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      const m = new THREE.PointsMaterial({ color, size, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false, blending, sizeAttenuation: true, fog: true });
      const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p);
      return { p, g, m, n, data: Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, ph: Math.random() * 6, sp: 0.5 + Math.random(), init: false })) };
    };
    this.fireflies = pts(90, 0xd8ff70, 0.22);
    this.pollen = pts(50, 0xfff6d0, 0.05, THREE.NormalBlending);
    // falling leaves
    const leafGeo = new THREE.PlaneGeometry(0.12, 0.08);
    this.leafMesh = new THREE.InstancedMesh(leafGeo, lam(0xffffff, { side: THREE.DoubleSide }), 50);
    this.leafMesh.frustumCulled = false; scene.add(this.leafMesh);
    this.leaves = Array.from({ length: 50 }, (_, i) => ({ p: new THREE.Vector3(0, -999, 0), rot: new THREE.Euler(), sp: 0.4 + Math.random() * 0.5, ph: Math.random() * 6, col: [0xc8642a, 0xd8a030, 0x8a9a30, 0xa04a20][i % 4] }));
    this.leaves.forEach((l, i) => this.leafMesh.setColorAt(i, _c.set(l.col)));
    this.sound = { bird: 2, cricket: 1, owl: 20, wave: 3 };
  }

  setDetail(v) {
    this.detail = v;
    this.grass.setDensity([0, 0.45, 1, 1.35][v], [0, 2, 3, 4][v]);
    this.butterflies.forEach((b, i) => { b.off = i >= [3, 7, 14, 14][v]; if (b.off) { b.alive = false; b.m.visible = false; } });
    this.rabbits.forEach((r, i) => { r.off = i >= [1, 3, 5, 5][v]; if (r.off) { r.alive = false; r.m.visible = false; } });
    this.flocks.forEach((f, i) => { f.off = i >= [1, 2, 3, 3][v]; for (const b of f.birds) b.m.visible = !f.off; });
  }
  update(dt, cam, player, day, light, audio, season = null) {
    const S = season || { season: 1, snow: 0, bloom: 1, autumn: 0 };
    const winter = S.snow > 0.3;
    this.t += dt;
    WIND.uTime.value = this.t;
    WIND.uWind.value = (0.85 + Math.sin(this.t * 0.07) * 0.35) * (this.windBoost || 1);
    const w = this.world, px = player.x, pz = player.z;
    this.grass.update(px, pz);
    const night = light < 0.35;
    const g0 = w.ground(px, pz), biome = w.biome(px, pz, g0);
    const green = biome === BIOME.GRASS || biome === BIOME.FOREST || biome === BIOME.SWAMP;

    // ---- birds by day (gulls near the coast), bats at night
    for (const f of this.flocks) {
      if (f.off) continue;
      f.a += f.sp * dt * (night ? 2.2 : 1);
      const cx = px + Math.cos(f.a * 0.37) * f.r * 0.4, cz = pz + Math.sin(f.a * 0.29) * f.r * 0.4;
      f.c.set(cx + Math.cos(f.a) * f.r, 0, cz + Math.sin(f.a) * f.r);
      const gb = w.ground(f.c.x, f.c.z);
      const coast = gb < 2;
      const kind = night ? 'bat' : coast ? 'gull' : 'bird';
      if (kind !== f.kind) {
        f.kind = kind;
        const col = kind === 'bat' ? 0x1e1a1c : kind === 'gull' ? 0xeef0f2 : 0x3a3a40;
        for (const b of f.birds) { b.m.userData.mat.color.set(col); b.m.userData.dk.color.set(new THREE.Color(col).multiplyScalar(kind === 'gull' ? 0.85 : 0.6)); }
      }
      const alt = Math.max(gb, 0) + (night ? 9 : f.h);
      const tang = new THREE.Vector3(-Math.sin(f.a), 0, Math.cos(f.a));
      f.birds.forEach((b, i) => {
        const wob = Math.sin(this.t * 0.8 + b.ph) * 1.5;
        b.m.position.set(f.c.x + b.off.x + wob, alt + b.off.y + Math.sin(this.t * 0.6 + b.ph) * 1.2, f.c.z + b.off.z);
        b.m.rotation.set(0, Math.atan2(tang.x, tang.z), Math.sin(this.t * 0.5 + b.ph) * 0.25);
        const flap = night ? Math.sin(this.t * 22 + b.ph) * 0.9 : (Math.sin(this.t * 0.9 + b.ph) > 0.2 ? Math.sin(this.t * 12 + b.ph) * 0.8 : 0.12); // glide now and then
        b.m.userData.wings[0].rotation.z = flap; b.m.userData.wings[1].rotation.z = -flap;
        b.m.visible = !f.off && (biome !== BIOME.SNOW || !night);
      });
    }

    // ---- butterflies over meadows by day
    for (const b of this.butterflies) {
      if (b.off) continue;
      const want = !night && green && light > 0.5 && S.bloom > 0.25 && !winter;
      if (!b.alive || b.p.distanceTo(cam) > 34) {
        b.alive = false; b.m.visible = false;
        if (want && Math.random() < dt * 2) {
          const a = Math.random() * 6.28, r = 6 + Math.random() * 22;
          const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, h = w.ground(x, z);
          const bb = w.biome(x, z, h);
          if (h > 0.6 && (bb === BIOME.GRASS || bb === BIOME.FOREST)) { b.home.set(x, h + 0.6, z); b.p.copy(b.home); b.alive = true; b.m.visible = true; }
        }
        continue;
      }
      if (!want) { b.alive = false; b.m.visible = false; continue; }
      b.ph += dt;
      const tx = b.home.x + Math.sin(b.ph * 0.7) * 2.5 + Math.sin(b.ph * 1.9) * 0.8, tz = b.home.z + Math.cos(b.ph * 0.6) * 2.5 + Math.cos(b.ph * 2.3) * 0.7;
      const ty = w.ground(tx, tz) + 0.5 + Math.abs(Math.sin(b.ph * 1.3)) * 0.9;
      const nx = b.p.x + (tx - b.p.x) * Math.min(1, dt * 1.5), nz = b.p.z + (tz - b.p.z) * Math.min(1, dt * 1.5);
      b.m.rotation.y = Math.atan2(nx - b.p.x, nz - b.p.z);
      b.p.set(nx, b.p.y + (ty - b.p.y) * Math.min(1, dt * 2), nz);
      b.m.position.copy(b.p);
      const f = Math.sin(this.t * 26 + b.ph * 3) * 1.1;
      b.m.userData.wings[0].rotation.z = f; b.m.userData.wings[1].rotation.z = -f;
    }

    // ---- rabbits: hop around, bolt away from you
    for (const r of this.rabbits) {
      if (r.off) continue;
      const want = !night && (green || winter) && biome !== BIOME.SWAMP;
      const d = Math.hypot(r.p.x - px, r.p.z - pz);
      if (!r.alive || d > 60) {
        r.alive = false; r.m.visible = false;
        if (want && Math.random() < dt * 0.5) {
          const a = Math.random() * 6.28, rr = 18 + Math.random() * 25;
          const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr, h = w.ground(x, z);
          if (h > 0.8 && w.groundNormal(x, z)[1] > 0.85) { r.p.set(x, h, z); r.yaw = Math.random() * 6.28; r.alive = true; r.m.visible = true; r.t = 1 + Math.random() * 2; r.flee = 0; }
        }
        continue;
      }
      if (d < 7) r.flee = 3;
      r.t -= dt;
      const fleeing = r.flee > 0;
      if (fleeing) { r.flee -= dt; r.yaw = Math.atan2(r.p.x - px, r.p.z - pz) + Math.sin(this.t * 3) * 0.3; }
      if (fleeing || r.t < 0) {
        // hopping
        r.hop += dt * (fleeing ? 9 : 5.5);
        const sp = fleeing ? 6.5 : 1.6;
        r.p.x += Math.sin(r.yaw) * sp * dt; r.p.z += Math.cos(r.yaw) * sp * dt;
        if (!fleeing && r.hop > Math.PI * 4) { r.hop = 0; r.t = 1.5 + Math.random() * 3; r.yaw += (Math.random() - 0.5) * 2.5; }
      }
      const gy = w.ground(r.p.x, r.p.z);
      if (gy < 0.3) { r.yaw += Math.PI; }
      const hopY = (fleeing || r.t < 0) ? Math.abs(Math.sin(r.hop)) * (fleeing ? 0.35 : 0.18) : 0;
      r.m.position.set(r.p.x, gy + hopY, r.p.z);
      r.m.rotation.y = r.yaw;
      r.m.userData.body.rotation.x = hopY ? -Math.cos(r.hop) * 0.25 : 0;
      r.m.userData.head.rotation.x = r.t > 0 && !fleeing ? Math.sin(this.t * 2 + r.yaw) * 0.25 + 0.2 : 0; // nibbling
      r.p.y = gy;
    }

    // ---- fireflies at night, pollen motes by day
    const cloud = (c, want, area, yMin, yMax, motion) => {
      c.m.opacity += ((want ? 1 : 0) - c.m.opacity) * Math.min(1, dt * 0.8);
      c.p.visible = c.m.opacity > 0.02;
      if (!c.p.visible) return;
      const arr = c.g.attributes.position.array;
      c.data.forEach((f, i) => {
        if (!f.init || Math.hypot(f.x - px, f.z - pz) > area || Math.hypot(f.x - cam.x, f.y - cam.y, f.z - cam.z) < 3) {
          const a = Math.random() * 6.28, r = 4 + Math.random() * (area - 4);
          f.x = px + Math.cos(a) * r; f.z = pz + Math.sin(a) * r; f.y = w.ground(f.x, f.z) + yMin + Math.random() * (yMax - yMin); f.init = true;
        }
        motion(f, i);
        arr[i * 3] = f.x; arr[i * 3 + 1] = f.y; arr[i * 3 + 2] = f.z;
      });
      c.g.attributes.position.needsUpdate = true;
    };
    cloud(this.fireflies, night && green && !winter && S.season !== 2, 30, 0.4, 2.6, (f) => {
      f.ph += dt * f.sp;
      f.x += Math.sin(f.ph * 0.9) * dt * 0.6; f.z += Math.cos(f.ph * 0.7) * dt * 0.6; f.y += Math.sin(f.ph * 1.3) * dt * 0.3;
    });
    this.fireflies.m.size = 0.16 + Math.max(0, Math.sin(this.t * 3)) * 0.1;
    cloud(this.pollen, !night && light > 0.6 && green && S.bloom > 0.5, 18, 0.3, 3, (f) => {
      f.ph += dt * f.sp * 0.4; f.x += (Math.sin(f.ph) * 0.2 + 0.15) * dt; f.z += Math.cos(f.ph * 0.8) * 0.2 * dt; f.y += Math.sin(f.ph * 1.7) * 0.05 * dt;
    });

    // ---- leaves drifting down in forests
    const forest = !winter && (biome === BIOME.FOREST || (S.autumn > 0.3 && green));
    this.leaves.forEach((l, i) => {
      if (l.p.y < w.ground(l.p.x, l.p.z) + 0.05 || Math.hypot(l.p.x - px, l.p.z - pz) > 26) {
        if (forest && Math.random() < dt * 1.5) { const a = Math.random() * 6.28, r = Math.random() * 22; l.p.set(px + Math.cos(a) * r, 0, pz + Math.sin(a) * r); l.p.y = w.ground(l.p.x, l.p.z) + 5 + Math.random() * 5; }
        else l.p.y = -999;
      } else {
        l.ph += dt;
        l.p.y -= l.sp * dt; l.p.x += Math.sin(l.ph * 1.7) * dt * 0.8 + dt * 0.3; l.p.z += Math.cos(l.ph * 1.3) * dt * 0.5;
        l.rot.set(l.ph * 2.1, l.ph * 1.3, Math.sin(l.ph * 3) * 1.2);
      }
      _q.setFromEuler(l.rot);
      this.leafMesh.setMatrixAt(i, _m.compose(l.p, _q, _s.set(1, 1, 1)));
    });
    this.leafMesh.instanceMatrix.needsUpdate = true;

    // ---- ambience sounds
    if (audio && audio.ok) {
      const s = this.sound;
      s.bird -= dt; s.cricket -= dt; s.owl -= dt; s.wave -= dt;
      if (!night && green && s.bird <= 0) { s.bird = (winter ? 8 : 2) + Math.random() * 6; audio.birdsong(Math.random()); }
      if (night && green && !winter && S.season !== 2 && s.cricket <= 0) { s.cricket = 0.35 + Math.random() * 0.5; audio.cricket(); }
      if (night && biome === BIOME.FOREST && s.owl <= 0) { s.owl = 18 + Math.random() * 30; audio.owl(); }
      if (g0 < 3 && s.wave <= 0) { s.wave = 4 + Math.random() * 3; audio.wave(); }
      if (!night && biome === BIOME.BEACH && s.bird <= 0) { s.bird = 5 + Math.random() * 8; audio.gull(); }
    }
  }
}
