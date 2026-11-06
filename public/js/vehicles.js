// Rigid-body vehicle simulation with raycast suspension, tyre friction circles,
// surface-dependent grip/rolling resistance, buoyancy & drag in water and impulse-based
// chassis collisions against terrain, trees, rocks, structures and other vehicles.
import * as THREE from 'three';
import { VEHICLES } from '/shared/vehicles.js';
import { SURFACE_BUILT } from '/shared/worldgen.js';
import { ICE_SURF } from './physics.js';
const SURFACE_ICE = { name: 'ice', grip: 0.2, roll: 0.006, dust: [0.85, 0.9, 0.97] };
import { invRotY, rotY } from '/shared/building.js';
import { makeVehicle } from './models.js';
import { applyDecals, PAINT_COLORS } from './paint.js';
import { Interp, INTERP_DELAY } from './interp.js';
const _io = { x: 0, y: 0, z: 0, yaw: 0 };

const V3 = THREE.Vector3;
const G = 9.81;
const SUB = 1 / 120;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _r = new V3(), _n = [0, 1, 0];
const _qi = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _col = [];

export class VehicleSim {
  constructor(type, world, physics) {
    const def = (this.def = VEHICLES[type]);
    this.type = type; this.world = world; this.physics = physics;
    this.pos = new V3(); this.q = new THREE.Quaternion(); this.vel = new V3(); this.ang = new V3();
    const [hx, hy, hz] = def.half, m = def.mass;
    const k = 1.6; // extra inertia = more stable
    this.invI = new V3(12 / (m * k * ((2 * hy) ** 2 + (2 * hz) ** 2)), 12 / (m * k * ((2 * hx) ** 2 + (2 * hz) ** 2)), 12 / (m * k * ((2 * hx) ** 2 + (2 * hy) ** 2)));
    this.com = new V3(...def.com);
    this.wheels = def.wheels.map((w) => ({ local: new V3(w[0], w[1], w[2]), steer: !!w[3], drive: !!w[4], comp: 0, prev: 0, contact: false, spin: 0, spinV: 0, slip: 0, surf: null, point: new V3(), water: false, load: 0 }));
    this.nDrive = this.wheels.filter((w) => w.drive).length;
    // chassis sample points (body-local)
    this.points = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.points.push(new V3(sx * hx, sy * hy, sz * hz));
    const per = (len) => Math.max(2, Math.ceil(len / 0.6));
    for (const y of [-hy * 0.4, hy * 0.6]) {
      const nx = per(hx * 2), nz = per(hz * 2);
      for (let i = 1; i < nx; i++) { const x = -hx + (2 * hx * i) / nx; this.points.push(new V3(x, y, hz), new V3(x, y, -hz)); }
      for (let i = 1; i < nz; i++) { const z = -hz + (2 * hz * i) / nz; this.points.push(new V3(hx, y, z), new V3(-hx, y, z)); }
    }
    this.points.push(new V3(0, hy, 0), new V3(0, -hy, 0), new V3(0, -hy, hz * 0.5), new V3(0, -hy, -hz * 0.5));
    this.steer = 0; this.rpm = 0; this.throttle = 0; this.engineOk = true; this.fuel = 1;
    this.impact = 0; this.acc = 0; this.ignore = null; this.speed = 0; this.inWater = 0;
  }

  setState(p, q, vel) {
    this.pos.set(p[0], p[1], p[2]);
    this.q.set(q[0], q[1], q[2], q[3]).normalize();
    this.vel.set(vel?.[0] || 0, vel?.[1] || 0, vel?.[2] || 0);
    this.ang.set(0, 0, 0);
  }

  applyInvI(v, out) {
    _qi.copy(this.q).invert();
    out.copy(v).applyQuaternion(_qi);
    out.set(out.x * this.invI.x, out.y * this.invI.y, out.z * this.invI.z).applyQuaternion(this.q);
    return out;
  }
  impulse(point, J, comW) {
    this.vel.addScaledVector(J, 1 / this.def.mass);
    _r.subVectors(point, comW);
    _c.crossVectors(_r, J);
    this.applyInvI(_c, _d);
    this.ang.add(_d);
  }
  pointVel(point, comW, out) { _r.subVectors(point, comW); return out.crossVectors(this.ang, _r).add(this.vel); }

  // resolve a contact at world point with normal n (THREE.Vector3) and penetration depth
  contact(point, n, depth, comW, mu = 0.6, e = 0.1) {
    const vp = this.pointVel(point, comW, _a);
    const vn = vp.dot(n);
    if (vn < 0) {
      _r.subVectors(point, comW);
      const rn = _b.crossVectors(_r, n);
      this.applyInvI(rn, _c);
      const k = 1 / this.def.mass + n.dot(_c.cross(_r));
      const jn = (-(1 + e) * vn) / k;
      if (-vn > this.impact) this.impact = -vn;
      const J = _d.copy(n).multiplyScalar(jn);
      this.impulse(point, J, comW);
      // friction
      const vp2 = this.pointVel(point, comW, _a);
      const vt = vp2.addScaledVector(n, -vp2.dot(n));
      const vtl = vt.length();
      if (vtl > 1e-4) {
        const jt = Math.min(mu * jn, vtl / k);
        this.impulse(point, vt.multiplyScalar(-jt / vtl), comW);
      }
    }
    if (depth > 0.005) this.pos.addScaledVector(n, Math.min(depth, 0.3) * 0.5);
  }

  ground(x, z, y) { return this.physics.groundAt(x, z, y, 0.6, 0, this.ignore); }
  ignores(c) { return this.ignore && (c.ref === this.ignore || (c.ref && c.ref.veh === this.ignore.id)); }

  step(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) { this.substep(SUB, input); this.acc -= SUB; }
  }

  substep(dt, input) {
    const def = this.def, m = def.mass;
    const up = _n3(0, 1, 0).applyQuaternion(this.q);
    const fwdBody = _n3(0, 0, 1).applyQuaternion(this.q);
    const comW = this.com.clone().applyQuaternion(this.q).add(this.pos);
    const F = new V3(0, -G * m, 0), T = new V3();
    const addForce = (f, at) => { F.add(f); _r.subVectors(at, comW); T.add(_c.crossVectors(_r, f)); };
    const vLongBody = this.vel.dot(fwdBody);
    this.speed = vLongBody;
    // driver input -> throttle / brake
    let thr = 0, brake = 0;
    const w = input.throttle;
    if (w > 0) { if (vLongBody < -1.2) brake = 1; else thr = w; }
    else if (w < 0) { if (vLongBody > 1.2) brake = 1; else thr = w; }
    const canDrive = this.engineOk && this.fuel > 0;
    if (!canDrive) thr = 0;
    this.throttle = thr;
    this.braking = !!brake || !!input.handbrake;
    const steerTarget = input.steer * def.steer / (1 + Math.abs(vLongBody) * 0.045);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 6);
    const maxV = thr >= 0 ? def.maxSpeed : def.maxSpeed * 0.35;
    const curve = Math.max(0, 1 - (Math.abs(vLongBody) / maxV) ** 2);
    // wheels
    const L = def.rest + def.wheelR;
    let contacts = 0;
    for (const wh of this.wheels) {
      const mount = wh.local.clone().applyQuaternion(this.q).add(this.pos);
      // ray along -up
      let t = -1;
      const f = (tt) => { const y = mount.y - up.y * tt; return y - this.ground(mount.x - up.x * tt, mount.z - up.z * tt, mount.y); };
      if (f(0) < 0) t = 0;
      else {
        let prev = 0;
        for (let s = 1; s <= 4; s++) {
          const tt = (L * s) / 4;
          if (f(tt) < 0) { let a = prev, b = tt; for (let k = 0; k < 5; k++) { const mm = (a + b) / 2; if (f(mm) < 0) b = mm; else a = mm; } t = b; break; }
          prev = tt;
        }
      }
      wh.prev = wh.comp;
      if (t < 0) { wh.contact = false; wh.comp = 0; wh.load = 0; wh.spinV *= 0.995; if (wh.drive && canDrive) wh.spinV += thr * 40 * dt; continue; }
      contacts++;
      wh.contact = true;
      wh.comp = L - t;
      const P = wh.point.copy(mount).addScaledVector(up, -t);
      this.ground(P.x, P.z, mount.y);
      const surfBox = this.physics.lastSurf;
      this.world.groundNormal(P.x, P.z, _n);
      const n = surfBox ? up.clone().set(0, 1, 0) : new V3(_n[0], _n[1], _n[2]);
      const onIce = surfBox === ICE_SURF;
      const surf = onIce ? SURFACE_ICE : surfBox ? SURFACE_BUILT : this.world.surface(P.x, P.z);
      wh.surf = surf;
      wh.water = P.y < -0.05;
      const compVel = (wh.comp - wh.prev) / dt;
      let Fs = def.spring * wh.comp + def.damper * compVel;
      if (wh.comp > def.rest * 0.92) Fs += (wh.comp - def.rest * 0.92) * def.spring * 8; // bump stop
      Fs = Math.max(0, Fs);
      wh.load = Fs;
      addForce(up.clone().multiplyScalar(Fs), P);
      // tyre frame
      const fwd = (wh.steer ? _n3(Math.sin(this.steer), 0, Math.cos(this.steer)) : _n3(0, 0, 1)).applyQuaternion(this.q);
      fwd.addScaledVector(n, -fwd.dot(n)).normalize();
      const side = new V3().crossVectors(n, fwd).normalize();
      const vp = this.pointVel(P, comW, new V3());
      const vLong = vp.dot(fwd), vLat = vp.dot(side);
      const N = Fs;
      let grip = surf.grip * (wh.water ? 0.6 : 1) * (surfBox && !onIce ? 1 : def.offroad || 1);
      if (input.handbrake && !wh.steer) grip *= 0.45;
      let Fx = 0;
      if (wh.drive && canDrive) Fx += (thr * def.engine * curve) / this.nDrive;
      if (brake) Fx -= Math.max(-def.brake / 4, Math.min(def.brake / 4, vLong * N * 4));
      if (input.handbrake && !wh.steer) Fx -= Math.max(-def.brake / 3, Math.min(def.brake / 3, vLong * N * 4));
      if (!thr && !brake && Math.abs(vLong) < 1.5) Fx -= vLong * N * 1.5;
      Fx -= surf.roll * N * Math.tanh(vLong * 2) * (wh.water ? 3 : 1);
      let Fy = -vLat * N * 2.4;
      const maxF = grip * N;
      const mag = Math.hypot(Fx, Fy);
      wh.slip = 0;
      if (mag > maxF && mag > 0) { const s = maxF / mag; wh.slip = 1 - s; Fx *= s; Fy *= s; }
      addForce(fwd.clone().multiplyScalar(Fx).addScaledVector(side, Fy), P);
      // wheel spin (visual)
      const target = vLong / def.wheelR + (wh.drive && wh.slip > 0.2 ? thr * 25 : 0);
      wh.spinV += (target - wh.spinV) * Math.min(1, dt * 20);
    }
    this.grounded = contacts;
    // aerodynamic drag
    const sp = this.vel.length();
    F.addScaledVector(this.vel, -1.1 * sp);
    // water: buoyancy & drag per chassis corner
    let sub = 0;
    const hy = def.half[1];
    for (let i = 0; i < 8; i++) {
      const P = this.points[i].clone().applyQuaternion(this.q).add(this.pos);
      if (P.y < 0) {
        const depth = Math.min(-P.y, hy * 2);
        sub += depth / (hy * 2) / 8;
        addForce(_n3(0, (m * G * 1.6 * depth) / (hy * 2) / 8, 0), P);
        const vp = this.pointVel(P, comW, new V3());
        addForce(vp.multiplyScalar(-m * 0.35 / 8), P);
      }
    }
    this.inWater = sub;
    const engineP = _n3(0, 0, def.half[2] * 0.6).applyQuaternion(this.q).add(this.pos);
    this.engineOk = engineP.y > -0.35 || sub < 0.4;
    // integrate velocity
    this.vel.addScaledVector(F, dt / m);
    this.applyInvI(T, _d);
    this.ang.addScaledVector(_d, dt);
    this.ang.multiplyScalar(Math.exp(-(0.25 + sub * 3) * dt));
    // chassis collisions
    this.impact = 0;
    const rad = Math.hypot(...def.half) + 1;
    this.physics.query(this.pos.x, this.pos.z, rad, _col);
    for (const p of this.points) {
      const P = p.clone().applyQuaternion(this.q).add(this.pos);
      // terrain
      const g = this.world.ground(P.x, P.z);
      if (P.y < g) {
        this.world.groundNormal(P.x, P.z, _n);
        const nn = new V3(_n[0], _n[1], _n[2]);
        this.contact(P, nn, (g - P.y) * nn.y, comW, 0.5, 0.05);
      }
      for (const c of _col) {
        if (c.ghost || this.ignores(c)) continue;
        if (c.t === 'cyl') {
          if (P.y < c.y || P.y > c.y + c.h) continue;
          const dx = P.x - c.x, dz = P.z - c.z, d2 = dx * dx + dz * dz;
          if (d2 >= c.r * c.r) continue;
          const d = Math.sqrt(d2) || 1e-3;
          this.contact(P, new V3(dx / d, 0, dz / d), c.r - d, comW, 0.3, 0.2);
        } else {
          const [lx, lz] = invRotY(P.x - c.x, P.z - c.z, c.yaw);
          const ly = P.y - c.y;
          const px = c.hx - Math.abs(lx), py = c.hy - Math.abs(ly), pz = c.hz - Math.abs(lz);
          if (px <= 0 || py <= 0 || pz <= 0) continue;
          let nl;
          if (py < px && py < pz) nl = [0, Math.sign(ly) || 1, 0];
          else if (px < pz) nl = [Math.sign(lx) || 1, 0, 0];
          else nl = [0, 0, Math.sign(lz) || 1];
          const [wx, wz] = rotY(nl[0], nl[2], c.yaw);
          this.contact(P, new V3(wx, nl[1], wz), Math.min(px, py, pz), comW, 0.4, 0.15);
        }
      }
    }
    // integrate position / orientation
    this.pos.addScaledVector(this.vel, dt);
    const wq = _qt.set(this.ang.x, this.ang.y, this.ang.z, 0).multiply(this.q);
    this.q.x += 0.5 * wq.x * dt; this.q.y += 0.5 * wq.y * dt; this.q.z += 0.5 * wq.z * dt; this.q.w += 0.5 * wq.w * dt;
    this.q.normalize();
    // rpm (visual / audio)
    let ws = 0;
    for (const wh of this.wheels) if (wh.drive) ws += Math.abs(wh.spinV);
    ws /= this.nDrive;
    const target = Math.min(1.2, (ws * def.wheelR) / def.maxSpeed + Math.abs(thr) * 0.25);
    this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
    for (const wh of this.wheels) wh.spin += wh.spinV * dt;
    if (this.impact > (this.maxImpact || 0)) this.maxImpact = this.impact;
  }

  flip() {
    const fwd = _n3(0, 0, 1).applyQuaternion(this.q);
    const yaw = Math.atan2(fwd.x, fwd.z);
    this.q.setFromAxisAngle(new V3(0, 1, 0), yaw);
    this.pos.y = this.world.ground(this.pos.x, this.pos.z) + 1.5;
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
  }
}
function _n3(x, y, z) { return new V3(x, y, z); }

// ---------------------------------------------------------------- views
export class VehicleView {
  constructor(scene, data, world, physics) {
    this.id = data.id; this.type = data.type; this.world = world; this.physics = physics;
    this.def = VEHICLES[data.type];
    this.variant = data.var || 0;
    this.group = makeVehicle(data.type, this.variant);
    scene.add(this.group);
    this.scene = scene;
    this.pos = new V3(); this.q = new THREE.Quaternion();
    this.tPos = new V3(); this.tQ = new THREE.Quaternion(); this.vel = new V3();
    this.steer = 0; this.rpm = 0; this.hp = 0; this.broken = true; this.fuel = 0; this.needs = null; this.driver = 0;
    this.spin = 0; this.first = true;
    const ref = { kind: 'v', id: data.id, deck: !!this.def.deck };
    // local collision boxes [cx,cy,cz,hx,hy,hz]; the hauler is a low deck + tall cab so you can stand and build on the back
    this.boxes = this.def.deck
      ? [[0, this.def.deck.y - 0.57, -2.4, 1.52, 0.57, 4.55], [0, 0.8, 4.6, 1.5, 1.4, 2.4]]
      : [[0, 0, 0, ...this.def.half]];
    this.colliders = this.boxes.map(([, , , hx, hy, hz]) => ({ t: 'box', x: 0, y: 0, z: 0, hx, hy, hz, yaw: 0, rad: Math.hypot(hx, hz) + 0.5, ref }));
    this.collider = this.colliders[0];
    this.smokeT = 0;
    this.paint = -1; this.decRev = 0; this.netDecRev = 0;
  }
  setPaint(m) {
    this.paint = m.pa; this.decRev = m.rev;
    applyDecals(this.group, m.dc);
  }
  setNet(a) {
    // [id, type, x, y, z, q, hp, broken, steer, rpm, driver, fuel, needs, vel]
    this.tPos.set(a[2], a[3], a[4]); this.tQ.set(a[5][0], a[5][1], a[5][2], a[5][3]);
    this.hp = a[6]; this.broken = !!a[7]; this.steer = a[8]; this.rpm = a[9]; this.driver = a[10]; this.fuel = a[11]; this.needs = a[12] || null;
    this.vel.set(a[13][0], a[13][1], a[13][2]);
    this.nAttached = a[15] || 0;
    this.netDecRev = a[16] || 0;
    if (!this.interp) this.interp = new Interp();
    this.interp.push(performance.now(), a[2], a[3], a[4], 0, a[5]);
    if (this.first) { this.pos.copy(this.tPos); this.q.copy(this.tQ); this.first = false; }
    this.lastNet = performance.now();
  }
  update(dt, sim, effects, night) {
    const g = this.group, ud = g.userData;
    if (sim) { this.pos.copy(sim.pos); this.q.copy(sim.q); this.steer = sim.steer; }
    else {
      if (this.interp && this.interp.sample(performance.now() - INTERP_DELAY, _io, this.q)) this.pos.set(_io.x, _io.y, _io.z);
      else { this.pos.copy(this.tPos); this.q.copy(this.tQ); }
    }
    g.position.copy(this.pos); g.quaternion.copy(this.q);
    const up = _b.set(0, 1, 0).applyQuaternion(this.q);
    const L = this.def.rest + this.def.wheelR;
    const missing = this.broken && this.needs ? this.needs.wheel || 0 : 0;
    ud.wheels.forEach((w, i) => {
      w.spin.visible = i >= missing;
      let comp = 0;
      if (sim) comp = sim.wheels[i].comp;
      else {
        const m = _c.set(w.def[0], w.def[1], w.def[2]).applyQuaternion(this.q).add(this.pos);
        const gy = this.world.ground(m.x, m.z);
        comp = Math.max(0, Math.min(this.def.rest, L - (m.y - gy) / Math.max(0.3, up.y)));
      }
      w.pivot.position.y = w.def[1] - this.def.rest + comp;
      w.pivot.rotation.y = w.def[3] ? this.steer : 0;
      if (sim) w.spin.rotation.x = sim.wheels[i].spin;
      else { const fwd = _d.set(0, 0, 1).applyQuaternion(this.q); w.spin.rotation.x += (this.vel.dot(fwd) / this.def.wheelR) * dt; }
    });
    // boats: spin the propeller, swing the outboard with the helm, pull the oars
    if (ud.prop) ud.prop.rotation.z += (sim ? sim.rpm : this.rpm) * dt * 60;
    if (ud.outboard) ud.outboard.rotation.y = -this.steer * 0.8;
    if (ud.oars) { this.oarT = (this.oarT || 0) + dt * (0.6 + Math.min(1, (sim ? sim.speed : this.vel.length()) / 3) * 2.4) * ((sim ? Math.abs(sim.throttle) || Math.abs(this.steer) > 0.1 : this.vel.length() > 0.3) ? 1 : 0); ud.oars.forEach((o, i) => { o.rotation.y = Math.sin(this.oarT * 2) * 0.5 * (i ? -1 : 1); o.rotation.z = Math.cos(this.oarT * 2) * 0.12 * (i ? -1 : 1); }); }
    const tint = this.broken ? 0x6b4a32 : this.paint >= 0 ? PAINT_COLORS[this.paint] : ud.baseColor ?? this.def.color;
    if (ud._tint !== tint) { ud.paintMat.color.set(tint); ud.paintMat.roughness = this.broken ? 0.85 : 0.3; ud.paintMat.metalness = this.broken ? 0.15 : 0.55; ud._tint = tint; }
    const drivenNow = sim || this.driver;
    ud.headlight.intensity = drivenNow && night ? 40 : 0;
    if (ud.headMat) ud.headMat.emissiveIntensity = drivenNow ? (night ? 3 : 0.9) : 0.12;
    if (ud.tailMat) ud.tailMat.emissiveIntensity = sim && sim.braking ? 3 : drivenNow ? (night ? 1 : 0.4) : 0.1;
    if (ud.fog) ud.fog.emissiveIntensity = drivenNow && night ? 2 : 0.15;
    // collider for players / other vehicles
    const fwd = _d.set(0, 0, 1).applyQuaternion(this.q);
    this.yaw = Math.atan2(fwd.x, fwd.z);
    this.boxes.forEach((b, i) => {
      const c = this.colliders[i], o = _c.set(b[0], b[1], b[2]).applyQuaternion(this.q);
      c.x = this.pos.x + o.x; c.y = this.pos.y + o.y; c.z = this.pos.z + o.z; c.yaw = this.yaw;
    });
    // damage smoke
    const maxHp = this.def.hp;
    const hp = sim ? this.hp : this.hp;
    if (!this.broken && hp < maxHp * 0.35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.15; effects.smoke(_c.set(0, this.def.half[1], this.def.half[2] * 0.7).applyQuaternion(this.q).add(this.pos), hp < maxHp * 0.15 ? 0x222222 : 0x777777, 0.4); }
    }
  }
  dispose() { this.scene.remove(this.group); }
}
