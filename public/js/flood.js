// Water that has leaked into sealed rooms and the Pacific: a sloshing surface at the current level in every flooded
// room cell (and across the sub's deck), and jets of spray from each hull breach with a hiss you can hear.
import * as THREE from 'three';
import { VEHICLES } from '/shared/vehicles.js';
import { rotY } from '/shared/building.js';
import { audio } from './audio.js';

const MAX = 300;

export class FloodView {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1, 4, 4); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhongMaterial({ color: 0x2a7a9a, transparent: true, opacity: 0.62, shininess: 90, specular: 0x88aacc, side: THREE.DoubleSide, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.t;
      sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 wp = instanceMatrix * vec4(position, 1.0); transformed.y += sin(wp.x * 2.1 + uT * 2.3) * cos(wp.z * 1.7 + uT * 1.9) * 0.025 / max(0.3, instanceMatrix[1][1]); }`);
    };
    this.t = { value: 0 };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._y = new THREE.Vector3(0, 1, 0);
    this.sprayT = 0; this.hissT = 0;
  }
  update(dt, g) {
    this.t.value += dt;
    const cam = g.camera.position, m = this._m, q = this._q, p = this._p, s = this._s;
    let n = 0;
    // flooded rooms
    for (const b of g.structures.buildings.values()) {
      const f = g.structures.flood?.get(b.id);
      if (!f || Math.abs(b.x - cam.x) > 90 || Math.abs(b.z - cam.z) > 90) continue;
      q.setFromAxisAngle(this._y, b.yaw);
      for (const r of g.structures.roomsOf(b)) {
        const lvl = f[r.key];
        if (!lvl || lvl < 0.02) continue;
        for (const k of r.cells) {
          if (n >= MAX) break;
          const [gx, gz, L] = k.split(',').map(Number), [dx, dz] = rotY(gx * 1.5, gz * 1.5, b.yaw);
          m.compose(p.set(b.x + dx, b.y + L * 3 + Math.min(2.95, lvl), b.z + dz), q, s.set(3, 1, 3));
          this.mesh.setMatrixAt(n++, m);
        }
      }
    }
    // the Pacific's deck
    const leaks = [];
    for (const v of g.vehicleViews.values()) {
      const I = VEHICLES[v.type].interior;
      if (!I || v.pos.distanceTo(cam) > 120) continue;
      if ((v.flood || 0) > 0.02 && n < MAX) {
        m.compose(p.set(0, I.y0 + Math.min(I.y1 - I.y0 - 0.05, v.flood), 0).applyQuaternion(v.q).add(v.pos), v.q, s.set(I.hx * 2, 1, I.hz * 2));
        this.mesh.setMatrixAt(n++, m);
      }
      for (const l of v.leaks || []) leaks.push({ p: new THREE.Vector3(l[0], l[1], l[2]).applyQuaternion(v.q).add(v.pos), dir: new THREE.Vector3(-Math.sign(l[0]) || 1, 0, 0).applyQuaternion(v.q) });
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
    // hull breaches on base pieces
    for (const e of g.structures.map.values()) {
      if (!e.s.lk || Math.abs(e.s.x - cam.x) > 40 || Math.abs(e.s.z - cam.z) > 40) continue;
      for (const l of e.s.lk) {
        const [dx, dz] = rotY(l[0], l[2], e.s.yaw), [nx, nz] = rotY(0, Math.sign(l[2]) || 1, e.s.yaw);
        leaks.push({ p: new THREE.Vector3(e.s.x + dx, e.s.y + l[1], e.s.z + dz), dir: new THREE.Vector3(nx, l[1] < 0 ? 1 : 0, nz) });
      }
    }
    this.leaks = leaks;
    if (!leaks.length) return;
    // spray jets and the hiss of the nearest one
    this.sprayT -= dt;
    if (this.sprayT <= 0) {
      this.sprayT = 0.06;
      for (const L of leaks) if (L.p.distanceTo(cam) < 30) g.effects.burst(L.p.clone().addScaledVector(L.dir, 0.05), { count: 3, color: 0xd8f0ff, speed: 3.5, size: 0.05, life: 0.5, gravity: 6, spread: 0.3, dir: L.dir });
    }
    this.hissT -= dt;
    let nd = Infinity; for (const L of leaks) nd = Math.min(nd, L.p.distanceTo(cam));
    if (this.hissT <= 0 && nd < 18) { this.hissT = 0.5; audio.leak?.(1 / (1 + nd * 0.25)); }
  }
}
