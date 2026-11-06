// Boats: a floating-hull simulation with the same interface as VehicleSim (so the vehicle networking,
// seats, fuel and damage all just work), plus low-poly lofted hull models.
// The hull rides the waves, banks into turns, squats under power, runs aground on shores and
// is locked solid in the ice when a lake freezes over (break the ice around it to free it).
import * as THREE from 'three';
import { VEHICLES } from '/shared/vehicles.js';
import { ICE_TOP } from '/shared/ice.js';
import { invRotY, rotY } from '/shared/building.js';

const V3 = THREE.Vector3, SUB = 1 / 60;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// same waves as the water shader (sky.js)
export function waveHeight(x, z, t) {
  const amp = 0.35 * (0.22 + 0.78 * smooth(4200, 6000, Math.hypot(x, z)));
  return (Math.sin(x * 0.11 + t * 1.3) * Math.cos(z * 0.13 + t * 1.1) + Math.sin((x + z) * 0.05 + t * 0.7) * 0.6) * amp;
}

export class BoatSim {
  constructor(type, world, physics) {
    this.def = VEHICLES[type]; this.type = type; this.world = world; this.physics = physics;
    this.pos = new V3(); this.q = new THREE.Quaternion(); this.vel = new V3(); this.ang = new V3();
    this.wheels = []; this.yaw = 0; this.yawRate = 0; this.pitch = 0; this.roll = 0; this.vy = 0;
    this.steer = 0; this.rpm = 0; this.throttle = 0; this.fuel = 1; this.engineOk = true; this.inWater = 1;
    this.speed = 0; this.impact = 0; this.maxImpact = 0; this.acc = 0; this.ignore = null; this.braking = false;
    this.time = () => performance.now() / 1000; this.stuck = false;
    const [hx, , hz] = this.def.half;
    // hull outline samples (local x,z) for grounding, ice and collisions
    this.rim = [[0, hz], [0, -hz], [hx, 0], [-hx, 0], [hx * 0.7, hz * 0.6], [-hx * 0.7, hz * 0.6], [hx * 0.8, -hz * 0.7], [-hx * 0.8, -hz * 0.7]];
  }
  setState(p, q, vel) {
    this.pos.set(p[0], p[1], p[2]); this.q.set(q[0], q[1], q[2], q[3]).normalize();
    const f = new V3(0, 0, 1).applyQuaternion(this.q); this.yaw = Math.atan2(f.x, f.z);
    this.vel.set(vel?.[0] || 0, 0, vel?.[2] || 0);
  }
  flip() { this.pitch = this.roll = 0; this.vel.set(0, 0, 0); this.yawRate = 0; this.pos.y = Math.max(this.pos.y, this.def.float); }
  step(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) { this.substep(SUB, input); this.acc -= SUB; }
    this.q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }
  substep(dt, input) {
    const def = this.def, [hx, hy, hz] = def.half, ice = this.ice, t = this.time();
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const W = (lx, lz) => [this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c];
    // frozen into the lake: nothing moves until someone breaks the ice around the hull
    this.stuck = !!(ice && ice.frozen && ice.solid(this.pos.x, this.pos.z));
    if (this.stuck) {
      this.vel.set(0, 0, 0); this.yawRate = 0; this.speed = 0; this.throttle = input.throttle;
      this.pos.y += (ICE_TOP - hy * 0.6 - this.pos.y) * Math.min(1, dt * 4);
      this.pitch *= 0.95; this.roll *= 0.95; this.rpm += ((input.throttle ? 0.5 : 0.05) - this.rpm) * dt * 3;
      return;
    }
    // what's under the hull
    let gMax = -Infinity, wet = 0;
    for (const [lx, lz] of this.rim) { const [x, z] = W(lx, lz), g = this.world.ground(x, z); gMax = Math.max(gMax, g); if (g < -0.25) wet++; }
    const gC = this.world.ground(this.pos.x, this.pos.z);
    this.inWater = wet / this.rim.length;
    const bottom = this.pos.y - hy;
    const aground = gMax > bottom - 0.02;
    // drive
    const canDrive = def.fuelCap === 0 || this.fuel > 0;
    const thr = canDrive ? input.throttle : 0;
    this.throttle = thr;
    const fwd = new V3(s, 0, c), right = new V3(c, 0, -s);
    let vL = this.vel.dot(fwd), vS = this.vel.dot(right);
    const a = def.thrust / def.mass;
    const push = (this.inWater > 0.4 ? 1 : 0.08) * (aground && this.inWater < 0.9 ? 0.4 : 1);
    vL += thr * (thr < 0 ? 0.5 : 1) * a * push * dt;
    vL -= (vL * Math.abs(vL) * (a / (def.maxSpeed * def.maxSpeed)) + vL * 0.15) * dt * def.drag;
    vS *= Math.exp(-(aground ? 6 : 2.6) * dt); // the keel stops sideways slip
    if (aground) vL *= Math.exp(-(this.inWater > 0.5 ? 0.8 : 5) * dt);
    if (input.handbrake) vL *= Math.exp(-1.5 * dt);
    this.braking = !!input.handbrake || thr < 0 && vL > 0.5;
    // steering: rudder authority grows with speed; oars (and a pivoting outboard) still turn you at rest
    this.steer += (input.steer * 0.6 - this.steer) * Math.min(1, dt * 6);
    const auth = Math.max(def.fuelCap === 0 ? 0.55 : 0.3, Math.min(1, Math.abs(vL) / 4)) * (this.inWater > 0.4 ? 1 : 0.15);
    const wantRate = input.steer * def.turn * auth * (vL < -0.3 ? -1 : 1);
    this.yawRate += (wantRate - this.yawRate) * Math.min(1, dt * 3);
    this.yaw += this.yawRate * dt;
    this.vel.copy(fwd).multiplyScalar(vL).addScaledVector(right, vS);
    // vertical: float on the waves, or rest on the ground when beached
    const waveC = waveHeight(this.pos.x, this.pos.z, t);
    let targetY = waveC + def.float;
    if (aground) targetY = Math.max(targetY, gMax + hy * 0.95);
    this.vy += ((targetY - this.pos.y) * 30 - this.vy * 7) * dt;
    // move, then resolve against ice edges, the shore and anything solid
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vy * dt;
    this.impact = 0;
    const s2 = Math.sin(this.yaw), c2 = Math.cos(this.yaw);
    for (const [lx, lz] of this.rim) {
      const x = this.pos.x + lx * c2 + lz * s2, z = this.pos.z - lx * s2 + lz * c2;
      const iceHit = ice && ice.frozen && ice.solid(x, z) && this.pos.y < ICE_TOP + 0.2;
      const g = this.world.ground(x, z), wall = g > this.pos.y + 0.15;
      if (iceHit || wall) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > this.impact) this.impact = sp * (iceHit ? 0.6 : 1);
        this.pos.x = ox; this.pos.z = oz;
        // bounce off a little
        const nx = this.pos.x - x, nz = this.pos.z - z, l = Math.hypot(nx, nz) || 1;
        const vn = (this.vel.x * nx + this.vel.z * nz) / l;
        if (vn < 0) { this.vel.x -= 1.3 * vn * nx / l; this.vel.z -= 1.3 * vn * nz / l; }
        break;
      }
    }
    // structures, rocks, other vehicles
    const list = this.physics.query(this.pos.x, this.pos.z, Math.hypot(hx, hz) + 1, this._col || (this._col = []));
    for (const col of list) {
      if (col.ghost || (this.ignore && (col.ref === this.ignore || col.ref?.veh === this.ignore.id))) continue;
      for (const [lx, lz] of this.rim) {
        const x = this.pos.x + lx * c2 + lz * s2, z = this.pos.z - lx * s2 + lz * c2, y = this.pos.y;
        let nx = 0, nz = 0, pen = 0;
        if (col.t === 'cyl') {
          if (y + hy < col.y || y - hy > col.y + col.h) continue;
          const dx = x - col.x, dz = z - col.z, d = Math.hypot(dx, dz);
          if (d >= col.r) continue;
          nx = dx / (d || 1); nz = dz / (d || 1); pen = col.r - d;
        } else {
          if (y + hy < col.y - col.hy || y - hy > col.y + col.hy) continue;
          const [px, pz] = invRotY(x - col.x, z - col.z, col.yaw);
          const ex = col.hx - Math.abs(px), ez = col.hz - Math.abs(pz);
          if (ex <= 0 || ez <= 0) continue;
          const [wx, wz] = ex < ez ? rotY(Math.sign(px) || 1, 0, col.yaw) : rotY(0, Math.sign(pz) || 1, col.yaw);
          nx = wx; nz = wz; pen = Math.min(ex, ez);
        }
        this.pos.x += nx * pen; this.pos.z += nz * pen;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { if (-vn > this.impact) this.impact = -vn; this.vel.x -= 1.2 * vn * nx; this.vel.z -= 1.2 * vn * nz; }
      }
    }
    if (this.impact > this.maxImpact) this.maxImpact = this.impact;
    // attitude: pitch from the waves along the hull and the bow lifting under power; bank into turns
    const [bx, bz] = W(0, hz * 0.8), [sx, sz] = W(0, -hz * 0.8), [px2, pz2] = W(hx, 0), [qx, qz] = W(-hx, 0);
    const wp = aground ? Math.atan2(this.world.ground(bx, bz) - this.world.ground(sx, sz), hz * 1.6) * 0.6 : Math.atan2(waveHeight(bx, bz, t) - waveHeight(sx, sz, t), hz * 1.6);
    const wr = aground ? 0 : Math.atan2(waveHeight(px2, pz2, t) - waveHeight(qx, qz, t), hx * 2);
    const squat = Math.min(0.12, Math.max(0, vL / def.maxSpeed) * (def.fuelCap ? 0.14 : 0.03));
    this.pitch += (-wp - squat - this.pitch) * Math.min(1, dt * 4);
    this.roll += (wr * 0.8 + this.yawRate * Math.min(1, Math.abs(vL) / 6) * 0.12 - this.roll) * Math.min(1, dt * 3);
    this.speed = Math.abs(vL);
    this.rpm += (Math.min(1.2, Math.abs(thr) * 0.55 + this.speed / def.maxSpeed * 0.6) - this.rpm) * Math.min(1, dt * 4);
    void gC;
  }
}

// ---------------------------------------------------------------- models
const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; return m; }
// lofted hull: cross-sections along z, each a hard-chined U (sharp low-poly edges)
function hullGeo(sections) {
  const pos = [];
  const ring = (s) => { const [z, w, top, deep] = s; return [[-w, top], [-w * 0.92, top - (top - deep) * 0.45], [-w * 0.45, deep], [w * 0.45, deep], [w * 0.92, top - (top - deep) * 0.45], [w, top]].map(([x, y]) => [x, y, z]); };
  for (let i = 0; i < sections.length - 1; i++) {
    const A = ring(sections[i]), B = ring(sections[i + 1]);
    for (let k = 0; k < A.length - 1; k++) pos.push(...A[k], ...B[k], ...B[k + 1], ...A[k], ...B[k + 1], ...A[k + 1]);
  }
  // transom (flat stern)
  const T = ring(sections[0]);
  for (let k = 1; k < T.length - 1; k++) pos.push(...T[0], ...T[k + 1], ...T[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
export function makeBoat(type) {
  const def = VEHICLES[type], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const [hx, hy, hz] = def.half;
  const paint = std({ color: def.color, roughness: type === 'rowboat' ? 0.8 : 0.35, metalness: type === 'rowboat' ? 0 : 0.2, side: THREE.DoubleSide });
  const ud = { body, paintMat: paint, wheels: [] };
  const wood = std({ color: 0x8a6038, roughness: 0.85 }), dark = std({ color: 0x3a2a1a, roughness: 0.9, side: THREE.DoubleSide }), metal = std({ color: 0x8a9096, roughness: 0.35, metalness: 0.8 }), black = std({ color: 0x18191b, roughness: 0.6 });
  if (type === 'rowboat') {
    // clinker-built wooden rowboat: planked hull, gunwale, three thwarts, oars in their rowlocks
    body.add(mesh(hullGeo([[-hz, hx * 0.62, hy, -hy * 0.4], [-hz * 0.5, hx * 0.95, hy * 0.92, -hy], [0, hx, hy * 0.9, -hy], [hz * 0.55, hx * 0.82, hy, -hy * 0.85], [hz * 0.9, hx * 0.3, hy * 1.15, -hy * 0.4], [hz, 0.02, hy * 1.3, hy * 0.2]]), paint));
    for (let k = 0; k < 3; k++) body.add(mesh(hullGeo([[-hz + 0.02, hx * 0.63, hy - 0.12 - k * 0.15, hy - 0.16 - k * 0.15], [0, hx * 1.01, hy * 0.9 - 0.1 - k * 0.15, hy * 0.9 - 0.14 - k * 0.15], [hz * 0.88, hx * 0.32, hy * 1.13 - 0.1 - k * 0.15, hy * 1.13 - 0.14 - k * 0.15]]), dark));
    for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.06, 0.06, hz * 1.75), wood, sx * (hx * 0.94), hy * 0.93, 0, 0, sx * 0.0, 0));
    for (const z of [-hz * 0.62, -0.15, hz * 0.45]) body.add(mesh(new THREE.BoxGeometry(hx * 1.75, 0.05, 0.28), wood, 0, hy * 0.35, z));
    body.add(mesh(new THREE.BoxGeometry(hx * 1.2, 0.04, hz * 1.4), dark, 0, -hy * 0.75, -0.1));
    for (const sx of [-1, 1]) {
      const oar = new THREE.Group(); oar.position.set(sx * hx * 0.95, hy * 0.98, -0.1);
      oar.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), wood, sx * 0.55, -0.15, 0, 0, 0, sx * 1.25));
      oar.add(mesh(new THREE.BoxGeometry(0.16, 0.5, 0.03), wood, sx * 1.6, -0.62, 0, 0, Math.PI / 2, sx * 1.25));
      body.add(oar); (ud.oars = ud.oars || []).push(oar);
    }
  } else {
    // fibreglass skiff: deep-V hull with a painted stripe, foredeck, centre console, windscreen, outboard
    const white = std({ color: 0xf2f2ec, roughness: 0.3 });
    body.add(mesh(hullGeo([[-hz, hx * 0.9, hy, -hy * 0.75], [-hz * 0.3, hx, hy, -hy], [hz * 0.4, hx * 0.9, hy * 1.05, -hy * 0.95], [hz * 0.85, hx * 0.45, hy * 1.15, -hy * 0.4], [hz, 0.04, hy * 1.25, hy * 0.3]]), paint));
    body.add(mesh(hullGeo([[-hz + 0.01, hx * 0.91, hy * 0.55, hy * 0.38], [-hz * 0.3, hx * 1.01, hy * 0.55, hy * 0.38], [hz * 0.4, hx * 0.91, hy * 0.6, hy * 0.43], [hz * 0.85, hx * 0.46, hy * 0.7, hy * 0.53]]), std({ color: 0x1e4a8a, roughness: 0.35, side: THREE.DoubleSide })));
    body.add(mesh(new THREE.BoxGeometry(hx * 1.8, 0.05, hz * 1.7), std({ color: 0x9a9a92, roughness: 0.8 }), 0, -hy * 0.35, -0.25));
    body.add(mesh(new THREE.BoxGeometry(hx * 1.4, 0.1, hz * 0.5), white, 0, hy * 0.9, hz * 0.62, -0.08));
    body.add(mesh(new THREE.BoxGeometry(0.75, 0.75, 0.6), white, 0.35, hy * 0.3, -1.25));
    body.add(mesh(new THREE.BoxGeometry(0.78, 0.4, 0.04), std({ color: 0x0b141b, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.7 }), 0.35, hy * 0.3 + 0.55, -1.0, -0.5));
    body.add(mesh(new THREE.TorusGeometry(0.15, 0.02, 4, 12), black, 0.35, hy * 0.3 + 0.48, -1.5, -0.6));
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [0, 0.9]]) body.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), std({ color: 0xe8e2d0, roughness: 0.7 }), x, -hy * 0.1, z));
    body.add(mesh(new THREE.BoxGeometry(0.05, 0.05, hz * 1.5), metal, hx * 0.92, hy * 1.02, 0.2)); body.add(mesh(new THREE.BoxGeometry(0.05, 0.05, hz * 1.5), metal, -hx * 0.92, hy * 1.02, 0.2));
    // outboard motor: cowling, leg, cavitation plate, propeller
    const ob = new THREE.Group(); ob.position.set(0, hy * 0.9, -hz - 0.15); body.add(ob);
    ob.add(mesh(new THREE.BoxGeometry(0.42, 0.5, 0.55), black, 0, 0.2, -0.1));
    ob.add(mesh(new THREE.BoxGeometry(0.42, 0.06, 0.55), std({ color: 0xd8a020, roughness: 0.4 }), 0, 0.05, -0.1));
    ob.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.18), black, 0, -0.45, -0.15));
    ob.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.35), black, 0, -0.75, -0.18));
    const prop = new THREE.Group(); prop.position.set(0, -0.85, -0.3); ob.add(prop);
    for (let k = 0; k < 3; k++) prop.add(mesh(new THREE.BoxGeometry(0.03, 0.2, 0.06), metal, 0, 0, 0, 0, 0, k * 2.09));
    ud.prop = prop; ud.outboard = ob;
  }
  const headlight = new THREE.SpotLight(0xfff0d0, 0, 50, 0.6, 0.5, 1.1);
  headlight.position.set(0, hy, hz); headlight.target.position.set(0, -1, hz + 12);
  body.add(headlight); body.add(headlight.target);
  ud.headlight = headlight; ud.baseColor = paint.color.getHex();
  g.userData = ud;
  return g;
}
