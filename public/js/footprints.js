// Footprints and tyre tracks in the snow, shared by the server. A fresh print is a crisp blue-grey hollow;
// over an hour it fills back in with snow until it's gone.
import * as THREE from 'three';
import { FOOTPRINT_LIFE } from '/shared/season.js';
import { footprintGeometry } from './season.js';

const MAX = 7000;
const FRESH = new THREE.Color(0.4, 0.46, 0.6), SNOW = new THREE.Color(0.88, 0.91, 0.97);

export class Footprints {
  constructor(scene, world) {
    this.world = world; this.byRegion = new Map(); this.dirty = true; this.t = 0;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, transparent: true, opacity: 0.92 });
    this.meshes = [0, 2].map((k) => {
      const m = new THREE.InstancedMesh(footprintGeometry(k), mat, MAX);
      m.count = 0; m.frustumCulled = false; m.renderOrder = 1; scene.add(m);
      m.setColorAt(0, FRESH);
      return m;
    });
  }
  // [x, z, yaw, ageSeconds, kind]
  add(region, list, replace = false) {
    const now = performance.now() / 1000;
    let arr = this.byRegion.get(region);
    if (!arr || replace) { arr = []; this.byRegion.set(region, arr); }
    for (const [x, z, yaw, age, kind] of list) arr.push({ x, z, yaw, born: now - age, kind, y: this.world.ground(x, z) });
    this.dirty = true;
  }
  drop(region) { if (this.byRegion.delete(region)) this.dirty = true; }
  update(dt, cam) {
    this.t -= dt;
    if (!this.dirty && this.t > 0) return;
    this.t = 4; this.dirty = false;
    const now = performance.now() / 1000;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), qy = new THREE.Quaternion(), c = new THREE.Color();
    const counts = [0, 0];
    for (const arr of this.byRegion.values()) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const f = arr[i], age = now - f.born;
        if (age > FOOTPRINT_LIFE) { arr.splice(i, 1); continue; }
        if (Math.abs(f.x - cam.x) > 140 || Math.abs(f.z - cam.z) > 140) continue;
        const mi = f.kind === 2 ? 1 : 0, mesh = this.meshes[mi];
        if (counts[mi] >= MAX) continue;
        const gn = this.world.groundNormal(f.x, f.z);
        n.set(gn[0], gn[1], gn[2]);
        q.setFromUnitVectors(up, n).multiply(qy.setFromAxisAngle(up, f.yaw));
        p.set(f.x, f.y + 0.03, f.z);
        mesh.setMatrixAt(counts[mi], m4.compose(p, q, s.set(f.kind === 1 ? -1 : 1, 1, 1)));
        // fills in with snow as it ages (the last quarter fades away fastest)
        const k = Math.pow(age / FOOTPRINT_LIFE, 0.8);
        mesh.setColorAt(counts[mi], c.copy(FRESH).lerp(SNOW, k));
        counts[mi]++;
      }
    }
    this.meshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }
}
