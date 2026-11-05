// Snapshot interpolation buffer: render remote entities slightly in the past for smooth motion.
import * as THREE from 'three';

export const INTERP_DELAY = 110; // ms

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Interp {
  constructor() { this.s = []; }
  push(t, x, y, z, yaw = 0, q = null) {
    const last = this.s[this.s.length - 1];
    if (last && (last.x - x) ** 2 + (last.z - z) ** 2 > 30 * 30) this.s.length = 0; // teleport
    if (last && t <= last.t) t = last.t + 1;
    this.s.push({ t, x, y, z, yaw, q: q ? q.slice() : null });
    if (this.s.length > 8) this.s.shift();
  }
  // Fills out {x,y,z,yaw} and optionally a THREE.Quaternion outQ. Returns false if empty.
  sample(rt, out, outQ = null) {
    const s = this.s;
    if (!s.length) return false;
    let a = s[s.length - 1], b = a, f = 0;
    if (rt <= s[0].t) { a = b = s[0]; }
    else {
      for (let i = s.length - 1; i > 0; i--) if (rt >= s[i - 1].t) { a = s[i - 1]; b = s[i]; f = Math.min(1, (rt - a.t) / (b.t - a.t)); break; }
      if (rt > s[s.length - 1].t && s.length >= 2) {
        // extrapolate briefly past the newest snapshot
        a = s[s.length - 2]; b = s[s.length - 1];
        f = 1 + Math.min(rt - b.t, 150) / Math.max(1, b.t - a.t);
      }
    }
    out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
    out.yaw = a.yaw + wrap(b.yaw - a.yaw) * Math.min(f, 1);
    if (outQ && a.q && b.q) { _qa.fromArray(a.q); _qb.fromArray(b.q); outQ.slerpQuaternions(_qa, _qb, Math.min(f, 1)); }
    return true;
  }
}
