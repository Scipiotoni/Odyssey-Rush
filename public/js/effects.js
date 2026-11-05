// Pooled cube particles, tracers, flashes and smoke.
import * as THREE from 'three';

const MAX = 4000;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.glow = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), 800);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3);
    this.glow.frustumCulled = false; this.glow.count = 0;
    scene.add(this.glow);
    this.parts = [];
    this.glows = [];
    this.tracers = [];
    this.lights = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    this.flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
    scene.add(this.flashLight);
    this.flashT = 0;
    this.shake = 0;
  }

  // opts: {count, color, speed, up, size, life, gravity, drag, spread, glow}
  burst(pos, opts) {
    const n = opts.count || 8;
    const list = opts.glow ? this.glows : this.parts;
    const cap = opts.glow ? 800 : MAX;
    for (let i = 0; i < n; i++) {
      if (list.length >= cap) list.shift();
      const sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      const dir = opts.dir;
      let vx = (Math.random() - 0.5) * 2, vy = Math.random() * (opts.up ?? 1), vz = (Math.random() - 0.5) * 2;
      if (dir) { const s = opts.spread ?? 0.6; vx = dir.x + (Math.random() - 0.5) * s; vy = dir.y + (Math.random() - 0.5) * s; vz = dir.z + (Math.random() - 0.5) * s; }
      const col = Array.isArray(opts.color) ? opts.color : null;
      const c = col ? _c.setRGB(col[0], col[1], col[2]) : _c.set(opts.color ?? 0xffffff);
      const v = opts.vary ?? 0.15;
      const k = 1 + (Math.random() - 0.5) * v;
      list.push({
        x: pos.x + (Math.random() - 0.5) * (opts.jitter || 0), y: pos.y + (Math.random() - 0.5) * (opts.jitter || 0), z: pos.z + (Math.random() - 0.5) * (opts.jitter || 0),
        vx: vx * sp, vy: vy * sp, vz: vz * sp, life: (opts.life || 0.8) * (0.6 + Math.random() * 0.6), t: 0,
        size: (opts.size || 0.08) * (0.6 + Math.random() * 0.8), grow: opts.grow || 0,
        g: opts.gravity ?? 9.8, drag: opts.drag ?? 1, r: c.r * k, gg: c.g * k, b: c.b * k, rot: Math.random() * 6,
      });
    }
  }
  tracer(a, b) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3));
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, t: 0 });
  }
  flash(pos, intensity = 3, dur = 0.06, color = 0xffc070) {
    this.flashLight.position.copy(pos); this.flashLight.intensity = intensity; this.flashLight.color.set(color); this.flashLight.distance = intensity * 6;
    this.flashT = dur;
  }
  explosion(pos, r = 3) {
    this.burst(pos, { count: 60, color: 0xffa030, speed: 10 * r / 3, up: 1.4, size: 0.35, life: 0.5, gravity: 2, drag: 3, glow: true });
    this.burst(pos, { count: 40, color: 0xffe080, speed: 6, up: 1.2, size: 0.25, life: 0.35, gravity: 0, drag: 4, glow: true });
    this.burst(pos, { count: 50, color: 0x3a3a3a, speed: 4, up: 1.6, size: 0.6, life: 2.2, gravity: -1.5, drag: 1.5, grow: 1.2 });
    this.burst(pos, { count: 40, color: 0x6a5a48, speed: 12, up: 1.5, size: 0.15, life: 1.6, gravity: 12, drag: 0.4 });
    this.flash(pos, 30, 0.25, 0xffa040);
  }
  smoke(pos, color = 0x444444, size = 0.5) {
    this.burst(pos, { count: 1, color, speed: 0.6, up: 1, size, life: 2.5, gravity: -1.2, drag: 0.8, grow: 0.8, jitter: 0.5 });
  }

  update(dt) {
    const step = (list, mesh) => {
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.t += dt;
        if (p.t >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
        p.vy -= p.g * dt;
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr; p.vy *= dr; p.vz *= dr;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += dt * 3;
      }
      for (const p of list) {
        if (n >= mesh.instanceMatrix.count) break;
        const f = 1 - p.t / p.life;
        const s = p.size * (p.grow ? 1 + p.t * p.grow : Math.min(1, f * 2));
        _q.setFromAxisAngle(_p.set(0.6, 1, 0.3).normalize(), p.rot);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
        mesh.setMatrixAt(n, _m);
        mesh.instanceColor.setXYZ(n, p.r, p.gg, p.b);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    };
    step(this.parts, this.mesh);
    step(this.glows, this.glow);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      tr.line.material.opacity = Math.max(0, 0.9 - tr.t * 12);
      if (tr.t > 0.08) { this.scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); this.tracers.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashLight.intensity = 0; }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
