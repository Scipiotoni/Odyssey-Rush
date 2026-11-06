// Weather visuals: rain streaks (GPU-animated), ground splashes, a scrolling cloud layer, darker stormy
// light and fog, branching lightning bolts with a real flash of light, and the sound (see rainaudio.js).
import * as THREE from 'three';
import { CAVE_ZONE } from '/shared/caves.js';
import { RainAudio } from './rainaudio.js';

const R = 26, H = 34; // rain volume around the camera (radius, height)

function cloudTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, S, S);
  // soft overlapping puffs, drawn wrapped so the texture tiles
  for (let i = 0; i < 260; i++) {
    const px = Math.random() * S, py = Math.random() * S, r = 18 + Math.random() * 70, a = 0.05 + Math.random() * 0.1;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5);
  return t;
}

export class Weather {
  constructor(game) {
    this.g = game;
    const scene = game.scene;
    this.target = { c: 0.1, r: 0, st: 0, w: 0.3, wd: 0 };
    this.cur = { c: 0.1, r: 0, st: 0, w: 0.3, wd: 0 };
    this.flash = 0; this.flashes = []; this.cover = 0; this.coverT = 0;
    this.audio = new RainAudio(game.audio);
    // ---- rain: line segments animated entirely in the vertex shader
    const N = 16000;
    const pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const sx = Math.random(), sy = Math.random(), sz = Math.random();
      for (let k = 0; k < 2; k++) { seed.set([sx, sy, sz], (i * 2 + k) * 3); pos.set([0, k, i / N], (i * 2 + k) * 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector2() }, uLight: { value: 1 }, uFlash: { value: 0 }, uClear: { value: 0 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } };
    this.rain = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, fog: true,
      vertexShader: `attribute vec3 seed; uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform vec2 uWind; uniform float uClear;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          float on = step(position.z, uAmt);
          float speed = 11.0 + seed.y * 4.0;
          vec3 p;
          p.x = uCam.x + mod(seed.x * ${2 * R}.0 - uCam.x + uWind.x * uTime * 0.6, ${2 * R}.0) - ${R}.0;
          p.z = uCam.z + mod(seed.z * ${2 * R}.0 - uCam.z + uWind.y * uTime * 0.6, ${2 * R}.0) - ${R}.0;
          float fall = mod(seed.y * ${H}.0 - uTime * speed, ${H}.0);
          p.y = uCam.y - 8.0 + fall;
          // streak: the top end trails back along the velocity (wind slants it)
          vec3 vel = normalize(vec3(uWind.x, -speed, uWind.y));
          p -= vel * position.y * (0.55 + seed.x * 0.35);
          float d = length(p.xz - uCam.xz);
          vA = on * (1.0 - smoothstep(${R - 6}.0, ${R}.0, d)) * step(uClear, d);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uLight; uniform float uFlash; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(vec3(0.62, 0.66, 0.72) * (0.35 + uLight * 0.65) + uFlash * 0.8, vA * 0.32);
          #include <fog_fragment>
        }`,
    }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
    // ---- snowfall: soft flakes drifting and swirling down (replaces rain in winter)
    const SN = 9000, sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) sp.set([Math.random(), Math.random(), Math.random()], i * 3);
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector2() }, uLight: { value: 1 }, uFlash: { value: 0 }, uClear: { value: 0 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } };
    this.snow = new THREE.Points(sgeo, new THREE.ShaderMaterial({
      uniforms: this.snowU, transparent: true, depthWrite: false, fog: true,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uAmt; uniform vec2 uWind; uniform float uClear; varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec3 s = position;
          float idx = fract(s.x * 7.13 + s.z * 3.71);
          float on = step(idx, uAmt);
          float speed = 1.1 + s.y * 0.9;
          float t = uTime;
          vec3 p;
          p.x = uCam.x + mod(s.x * 50.0 - uCam.x + uWind.x * t * 0.9 + sin(t * 0.8 + s.z * 40.0) * 0.8, 50.0) - 25.0;
          p.z = uCam.z + mod(s.z * 50.0 - uCam.z + uWind.y * t * 0.9 + cos(t * 0.7 + s.x * 40.0) * 0.8, 50.0) - 25.0;
          p.y = uCam.y - 6.0 + mod(s.y * 26.0 - t * speed, 26.0);
          float d = length(p.xz - uCam.xz);
          vA = on * (1.0 - smoothstep(19.0, 25.0, d)) * step(uClear, d);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp((0.6 + s.y * 0.9) * 22.0 / -mvPosition.z, 1.0, 7.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uLight; uniform float uFlash; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          vec2 q = gl_PointCoord - 0.5; float r = dot(q, q);
          if (r > 0.25 || vA < 0.01) discard;
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (0.45 + uLight * 0.55) + uFlash, vA * (1.0 - r * 3.0) * 0.9);
          #include <fog_fragment>
        }`,
    }));
    this.snow.frustumCulled = false; this.snow.visible = false;
    scene.add(this.snow);
    // ---- splashes: little crowns on the ground around you
    this.splashGeo = new THREE.RingGeometry(0.02, 0.05, 8); this.splashGeo.rotateX(-Math.PI / 2);
    this.splash = new THREE.InstancedMesh(this.splashGeo, new THREE.MeshBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.22, depthWrite: false }), 220);
    this.splash.frustumCulled = false; this.splash.count = 0; scene.add(this.splash);
    this.splashes = Array.from({ length: 220 }, () => ({ t: 1, x: 0, y: -999, z: 0 }));
    // ---- cloud layer
    this.cloudTex = cloudTexture();
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false, color: 0xffffff }));
    this.clouds.rotation.x = Math.PI / 2; this.clouds.renderOrder = -0.5; this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    // ---- lightning
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xf0f4ff, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x8aa8ff, transparent: true, opacity: 0.35, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolts = [];
    this.flashLight = new THREE.PointLight(0xdfe8ff, 0, 900, 1.2); scene.add(this.flashLight);
    this.skyFlash = new THREE.HemisphereLight(0xc8d8ff, 0x404860, 0); scene.add(this.skyFlash);
    this.detail = 2;
  }
  setDetail(v) { this.detail = v; this.maxDrops = [0.25, 0.5, 0.8, 1][v]; }
  setState(m) { this.target = { c: m.c, r: m.r, st: m.st, w: m.w, wd: m.wd }; if (this.first === undefined) { this.first = false; Object.assign(this.cur, this.target); } }

  // ---- a lightning strike at (x, y, z)
  bolt(m) {
    const g = this.g, cam = g.camera.position;
    const dist = Math.hypot(m.x - cam.x, m.z - cam.z), top = Math.max(m.y + 250, 420);
    const rng = (() => { let s = m.s >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const group = new THREE.Group();
    const segs = [];
    const branch = (x, y, z, toY, width, depth) => {
      let px = x, py = y, pz = z;
      while (py > toY) {
        const step = 10 + rng() * 22;
        const nx = px + (rng() - 0.5) * step * 0.9, nz = pz + (rng() - 0.5) * step * 0.9, ny = Math.max(toY, py - step);
        segs.push([px, py, pz, nx, ny, nz, width]);
        if (depth < 2 && rng() < 0.12) branch(nx, ny, nz, ny - 30 - rng() * 120, width * 0.5, depth + 1);
        px = nx; py = ny; pz = nz;
      }
    };
    branch(m.x + (rng() - 0.5) * 60, top, m.z + (rng() - 0.5) * 60, m.y, 1.6, 0);
    const _a = new THREE.Vector3(), _b = new THREE.Vector3();
    for (const [x0, y0, z0, x1, y1, z1, w] of segs) {
      _a.set(x0, y0, z0); _b.set(x1, y1, z1);
      const len = _a.distanceTo(_b);
      for (const [mat, k] of [[this.boltMat, 1], [this.glowMat, 5]]) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5 * k * (0.6 + dist / 4000), w * 0.5 * k * (0.6 + dist / 4000), len, 4, 1, true), mat);
        s.position.copy(_a).add(_b).multiplyScalar(0.5);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _b.clone().sub(_a).normalize());
        group.add(s);
      }
    }
    g.scene.add(group);
    // a strike flickers 2-4 times (return strokes)
    const strokes = 2 + Math.floor(rng() * 3);
    this.bolts.push({ group, t: 0, strokes, dur: 0.12 + strokes * 0.09, x: m.x, y: m.y, z: m.z, e: m.e, dist });
    // thunder arrives at the speed of sound
    const delay = dist / 343;
    const cave = cam.y < CAVE_ZONE;
    const ang = Math.atan2(m.x - cam.x, m.z - cam.z), yaw = g.player.yaw;
    const pan = Math.sin(ang - (yaw + Math.PI));
    setTimeout(() => this.audio.thunder(dist, m.e || 1, -pan, cave), delay * 1000);
  }

  update(dt) {
    const g = this.g, cam = g.camera.position, sky = g.sky, cur = this.cur, T = this.target;
    const cave = cam.y < CAVE_ZONE;
    for (const k of ['c', 'r', 'st', 'w']) cur[k] += (T[k] - cur[k]) * Math.min(1, dt * 0.25);
    cur.wd = T.wd;
    // ---- shelter check (roof or vehicle overhead) a few times a second
    this.coverT -= dt;
    if (this.coverT <= 0) {
      this.coverT = 0.3;
      const hit = !cave && g.physics.raycast(cam, new THREE.Vector3(0, 1, 0), 30, null, { noTerrain: true, filter: (c) => !c.ghost });
      this.covered = !!hit || !!g.vehicle;
    }
    this.cover += ((this.covered ? 1 : 0) - this.cover) * Math.min(1, dt * 4);
    // ---- rain (or snow in winter)
    const snowing = (g.season?.snow ?? 0) > 0.25 || g.season?.season === 3;
    const precip = cave ? 0 : cur.r * (this.maxDrops ?? 0.8);
    const rainAmt = snowing ? 0 : precip;
    const su = this.snowU;
    su.uTime.value += dt; su.uCam.value.copy(cam); su.uAmt.value = snowing ? Math.min(1, precip * 1.2 + cur.st * 0.2) : 0;
    su.uWind.value.set(Math.sin(cur.wd) * cur.w * (2 + cur.st * 5), Math.cos(cur.wd) * cur.w * (2 + cur.st * 5));
    su.uLight.value = Math.max(0.2, sky.dayLight); su.uFlash.value = this.flash; su.uClear.value = this.covered ? 4.5 : 0;
    this.snow.visible = su.uAmt.value > 0.005;
    this.rain.visible = rainAmt > 0.005;
    const u = this.rainU;
    u.uTime.value += dt; u.uCam.value.copy(cam); u.uAmt.value = rainAmt;
    const wx = Math.sin(cur.wd) * cur.w * 5, wz = Math.cos(cur.wd) * cur.w * 5;
    u.uWind.value.set(wx, wz);
    u.uLight.value = Math.max(0.15, sky.dayLight * (1 - cur.c * 0.5)); u.uFlash.value = this.flash;
    u.uClear.value = this.covered ? 4.5 : 0; // indoors: keep the drops out of the room you're standing in
    // splashes
    if (this.rain.visible) {
      const n = Math.floor(rainAmt * 120 * dt * 60 * 0.12) + (Math.random() < rainAmt ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const sp = this.splashes.find((x) => x.t >= 1);
        if (!sp) break;
        const a = Math.random() * 6.28, r = 1 + Math.random() * 12;
        sp.x = cam.x + Math.cos(a) * r; sp.z = cam.z + Math.sin(a) * r;
        sp.y = g.physics.groundAt(sp.x, sp.z, cam.y + 2, 60) + 0.02; sp.t = 0;
        if (sp.y < 0.05 && g.world.ground(sp.x, sp.z) < 0) sp.y = 0.05; // rings on water too
      }
    }
    let k = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const sp of this.splashes) {
      if (sp.t >= 1) continue;
      sp.t += dt * 3.2;
      const s = 0.5 + sp.t * 1.6;
      this.splash.setMatrixAt(k++, m4.compose(v.set(sp.x, sp.y, sp.z), q, sc.set(s, 1, s)));
    }
    this.splash.count = k; this.splash.instanceMatrix.needsUpdate = true;
    // ---- clouds, light and fog
    const day = sky.dayLight;
    this.clouds.position.set(cam.x, cam.y + 520, cam.z);
    this.cloudTex.offset.x += dt * 0.0015 * (0.3 + cur.w); this.cloudTex.offset.y += dt * 0.001 * (0.3 + cur.w);
    this.clouds.material.opacity = cave ? 0 : Math.min(1, cur.c * 1.15);
    const cg = (0.35 + day * 0.6) * (1 - cur.st * 0.55);
    this.clouds.material.color.setRGB(cg, cg, cg * 1.04);
    const gray = new THREE.Color().setRGB(0.42 * (0.2 + day * 0.8), 0.45 * (0.2 + day * 0.8), 0.5 * (0.2 + day * 0.8)).multiplyScalar(1 - cur.st * 0.45);
    const ov = cur.c * 0.85;
    sky.uniforms.top.value.lerp(gray, ov); sky.uniforms.hor.value.lerp(gray, ov * 0.9);
    sky.uniforms.sunCol.value.multiplyScalar(1 - cur.c * 0.85);
    if (!cave) {
      this.g.scene.fog.color.lerp(gray, ov);
      const vd = g.settings.viewDist;
      this.g.scene.fog.far = vd * (1 - cur.r * (snowing ? 0.78 : 0.62)) * (1 - cur.st * (snowing ? 0.5 : 0.15)); this.g.scene.fog.near = this.g.scene.fog.far * (0.12 - cur.r * 0.08);
      sky.sun.intensity *= 1 - cur.c * 0.72;
      sky.hemi.intensity *= 1 - cur.c * 0.3 - cur.st * 0.2;
      sky.starMat.opacity *= 1 - cur.c;
    }
    // ---- lightning flashes
    this.flash = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const ph = b.t / b.dur;
      const flick = Math.max(0, Math.sin(ph * b.strokes * Math.PI)) * (1 - ph * 0.5);
      b.group.visible = flick > 0.25;
      const near = Math.max(0, 1 - b.dist / 3500);
      this.flash = Math.max(this.flash, flick * (0.35 + near * 0.65) * b.e);
      if (b.dist < 900) { this.flashLight.position.set(b.x, b.y + 80, b.z); this.flashLight.intensity = flick * 6e4 * (1 - b.dist / 900) * (1 - day * 0.75); }
      if (b.t >= b.dur) { g.scene.remove(b.group); b.group.traverse((o) => o.geometry?.dispose()); this.bolts.splice(i, 1); if (!this.bolts.length) this.flashLight.intensity = 0; }
    }
    // also faint sheet lightning inside the clouds during storms
    if (!cave && cur.st > 0.5 && Math.random() < dt * cur.st * 0.12) this.flashes.push({ t: 0, d: 0.25 + Math.random() * 0.3, a: 0.15 + Math.random() * 0.25 });
    for (let i = this.flashes.length - 1; i >= 0; i--) { const f = this.flashes[i]; f.t += dt; this.flash = Math.max(this.flash, f.a * Math.max(0, Math.sin((f.t / f.d) * Math.PI * 2))); if (f.t > f.d) this.flashes.splice(i, 1); }
    if (cave) this.flash = 0;
    this.skyFlash.intensity = this.flash * (2.4 - day * 1.9);
    if (this.flash > 0.01) { const f = this.flash * (1 - day * 0.55), w = new THREE.Color(0.8, 0.85, 1); sky.uniforms.top.value.lerp(w, f * 0.6); sky.uniforms.hor.value.lerp(w, f * 0.5); this.g.scene.fog.color.lerp(w, f * 0.35); this.clouds.material.color.lerp(w, f); }
    // ---- the rest of the world reacts: wind in the grass and trees, wet darker ground
    if (g.nature) g.nature.windBoost = 1 + cur.w * 1.6 + cur.st * 0.8;
    if (g.terrain?.setWet) g.terrain.setWet(cave || snowing ? 0 : Math.min(1, cur.r * 1.4));
    this.audio.update(dt, { rain: cave || snowing ? 0 : cur.r, storm: cur.st, wind: cave ? 0 : Math.min(1, cur.w + (snowing ? cur.st * 0.4 : 0)), cover: this.cover, cave: cave ? 1 : 0 });
  }
}
