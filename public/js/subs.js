// Submarines: a 3D underwater flight model with the same interface as VehicleSim/BoatSim, plus models.
// W/S thrust, A/D yaw, Space rise, Ctrl/C dive. Neutral buoyancy below the surface, floats when surfaced,
// bumps off the sea floor, ice and cave rock. Past its crush depth the hull is damaged (server side).
// The big sub is kept level (people walk around inside it); the mini sub pitches as it climbs and dives.
import * as THREE from 'three';
import { VEHICLES } from '/shared/vehicles.js';
import { ICE_BOT } from '/shared/ice.js';
import { CAVE_ZONE } from '/shared/caves.js';
import { invRotY, rotY } from '/shared/building.js';
import { waveHeight } from './boats.js';

const V3 = THREE.Vector3, SUB = 1 / 60;

export class SubSim {
  constructor(type, world, physics) {
    this.def = VEHICLES[type]; this.type = type; this.world = world; this.physics = physics;
    this.pos = new V3(); this.q = new THREE.Quaternion(); this.vel = new V3(); this.ang = new V3();
    this.wheels = []; this.yaw = 0; this.yawRate = 0; this.pitch = 0; this.roll = 0;
    this.steer = 0; this.rpm = 0; this.throttle = 0; this.fuel = 1; this.engineOk = true; this.inWater = 1;
    this.speed = 0; this.impact = 0; this.maxImpact = 0; this.acc = 0; this.ignore = null; this.braking = false;
    this.time = () => performance.now() / 1000; this.stats = { crush: this.def.depths[0], thrust: 1, eff: 0 };
    const [hx, hy, hz] = this.def.half;
    // hull sample points (local): a ring around the middle, the nose and tail, keel and roof
    this.pts = [];
    const nz = this.def.big ? 6 : 2;
    for (let i = 0; i <= nz; i++) { const z = -hz + (2 * hz * i) / nz, w = this.def.big ? hx : hx * Math.cos((z / hz) * 1.1); for (const sx of [-1, 1]) this.pts.push([sx * w * 0.95, 0, z]); this.pts.push([0, -hy * 0.95, z], [0, hy * 0.92, z]); }
    this.pts.push([0, 0, hz], [0, 0, -hz]);
  }
  setState(p, q, vel) {
    this.pos.set(p[0], p[1], p[2]); this.q.set(q[0], q[1], q[2], q[3]).normalize();
    const f = new V3(0, 0, 1).applyQuaternion(this.q); this.yaw = Math.atan2(f.x, f.z);
    this.vel.set(vel?.[0] || 0, vel?.[1] || 0, vel?.[2] || 0);
  }
  flip() { this.pitch = this.roll = 0; this.vel.set(0, 0, 0); this.yawRate = 0; }
  get depth() { return Math.max(0, -this.pos.y); }
  step(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= SUB) { this.substep(SUB, input); this.acc -= SUB; }
    this.q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }
  substep(dt, input) {
    const def = this.def, [hx, hy, hz] = def.half, t = this.time();
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const fwd = new V3(s, 0, c), right = new V3(c, 0, -s);
    const canDrive = this.fuel > 0;
    const thr = canDrive ? input.throttle : 0, vert = canDrive ? (input.rise ? 1 : 0) - (input.sink ? 1 : 0) : 0;
    this.throttle = thr; this.vert = vert;
    const a = (def.thrust / def.mass) * this.stats.thrust, top = def.maxSpeed * Math.sqrt(this.stats.thrust);
    let vL = this.vel.dot(fwd), vS = this.vel.dot(right), vy = this.vel.y;
    vL += thr * (thr < 0 ? 0.55 : 1) * a * dt;
    vL -= (vL * Math.abs(vL) * (a / (top * top)) + vL * 0.12) * dt;
    vS *= Math.exp(-2.2 * dt);
    // vertical: thrusters against water drag; floats up to the surface when out of power
    const surfaceY = -hy * 0.45 + waveHeight(this.pos.x, this.pos.z, t) * 0.6;
    const caves0 = this.physics.caves, inCave = caves0 ? caves0.inVolume(this.pos.x, this.pos.y, this.pos.z) : this.pos.y < CAVE_ZONE;
    vy += vert * a * def.vert * dt - vy * (Math.abs(vy) * 0.6 + 0.8) * dt;
    if (!canDrive && !inCave) vy += 0.4 * dt;
    if (!inCave && this.pos.y > surfaceY) { vy -= 9.8 * dt * Math.min(1, (this.pos.y - surfaceY) * 2); if (vert <= 0) vy += (surfaceY - this.pos.y) * 4 * dt; }
    this.inWater = !inCave && this.pos.y > surfaceY + hy ? 0 : 1;
    // yaw
    this.steer += (input.steer * 0.6 - this.steer) * Math.min(1, dt * 6);
    const auth = Math.max(0.45, Math.min(1, Math.abs(vL) / 3));
    this.yawRate += (input.steer * def.turn * auth * (vL < -0.3 ? -1 : 1) - this.yawRate) * Math.min(1, dt * (def.big ? 1.5 : 3));
    this.yaw += this.yawRate * dt;
    this.vel.copy(fwd).multiplyScalar(vL).addScaledVector(right, vS); this.vel.y = vy;
    const old = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    // collisions: terrain / ice above / cave rock / structures and other vehicles
    this.impact = 0;
    const s2 = Math.sin(this.yaw), c2 = Math.cos(this.yaw), ice = this.ice, caves = this.physics.caves;
    const P = new V3();
    let blocked = false, grounded = false;
    for (const [lx, ly, lz] of this.pts) {
      P.set(this.pos.x + lx * c2 + lz * s2, this.pos.y + ly + lz * Math.sin(-this.pitch), this.pos.z - lx * s2 + lz * c2);
      if (caves ? caves.inVolume(P.x, P.y, P.z) : P.y < CAVE_ZONE) {
        if (caves && caves.rock(P.x, P.y, P.z) > 0) { blocked = true; break; }
        continue;
      }
      const g = this.world.ground(P.x, P.z);
      if (P.y < g + 0.15) {
        const sp = -Math.min(0, this.vel.y) + Math.hypot(this.vel.x, this.vel.z) * 0.4;
        if (sp > this.impact) this.impact = sp;
        this.pos.y += g + 0.15 - P.y; if (this.vel.y < 0) this.vel.y = 0;
        grounded = true;
      }
      if (ice && ice.frozen && P.y > ICE_BOT - 0.1 && ice.solid(P.x, P.z)) { this.pos.y -= P.y - (ICE_BOT - 0.1); if (this.vel.y > 0) this.vel.y = 0; }
    }
    if (grounded) { this.vel.x *= Math.exp(-1.5 * dt); this.vel.z *= Math.exp(-1.5 * dt); } // scraping along the sea floor
    if (blocked) {
      const sp = this.vel.length();
      if (sp > this.impact) this.impact = sp;
      this.pos.copy(old); this.vel.multiplyScalar(-0.25);
    }
    const list = this.physics.query(this.pos.x, this.pos.z, Math.hypot(hx, hz) + 1, this._col || (this._col = []));
    for (const col of list) {
      if (col.ghost || (this.ignore && (col.ref === this.ignore || col.ref?.veh === this.ignore.id))) continue;
      if (col.t !== 'box') continue;
      for (const [lx, ly, lz] of this.pts) {
        const x = this.pos.x + lx * c2 + lz * s2, z = this.pos.z - lx * s2 + lz * c2, y = this.pos.y + ly;
        if (y < col.y - col.hy || y > col.y + col.hy) continue;
        const [px, pz] = invRotY(x - col.x, z - col.z, col.yaw);
        const ex = col.hx - Math.abs(px), ez = col.hz - Math.abs(pz);
        if (ex <= 0 || ez <= 0) continue;
        const [wx, wz] = ex < ez ? rotY(Math.sign(px) || 1, 0, col.yaw) : rotY(0, Math.sign(pz) || 1, col.yaw);
        const pen = Math.min(ex, ez);
        this.pos.x += wx * pen; this.pos.z += wz * pen;
        const vn = this.vel.x * wx + this.vel.z * wz;
        if (vn < 0) { if (-vn > this.impact) this.impact = -vn; this.vel.x -= 1.2 * vn * wx; this.vel.z -= 1.2 * vn * wz; }
      }
    }
    if (this.impact > this.maxImpact) this.maxImpact = this.impact;
    // attitude: the mini sub noses down to dive and up to climb and banks into turns; the big one stays level
    if (!def.big) {
      this.pitch += (-Math.max(-0.5, Math.min(0.5, this.vel.y * 0.18)) - this.pitch) * Math.min(1, dt * 3);
      this.roll += (this.yawRate * Math.min(1, Math.abs(vL) / 5) * 0.25 - this.roll) * Math.min(1, dt * 3);
      if (this.inWater < 1) this.roll += Math.sin(t * 1.3) * 0.02 * dt;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    this.rpm += (Math.min(1.2, Math.abs(thr) * 0.6 + Math.abs(vert) * 0.3 + this.speed / top * 0.5) - this.rpm) * Math.min(1, dt * 4);
  }
}

// ---------------------------------------------------------------- models
const std = (o) => new THREE.MeshStandardMaterial({ flatShading: true, ...o });
const smooth = (o) => new THREE.MeshStandardMaterial({ flatShading: false, ...o });
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; return m; }
// a lofted hull with smooth normals: rounded-rectangle (superellipse) sections along z ([z, rx, ry, yOffset, n])
function loft(sections, seg = 28) {
  const pos = [], idx = [];
  for (const [z, rx, ry, oy, n = 2] of sections) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(Math.sign(c) * Math.abs(c) ** (2 / n) * rx, Math.sign(s) * Math.abs(s) ** (2 / n) * ry + oy, z);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k, b = a + seg + 1;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// a ducted propeller: shroud ring, hub, blades (the blades spin: returned as prop)
function ductedProp(r, mats, blades = 5) {
  const g = new THREE.Group(), prop = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.05, r * 0.9, 20, 1, true), mats.dark, 0, 0, 0, Math.PI / 2));
  g.add(mesh(new THREE.TorusGeometry(r * 1.1, r * 0.06, 6, 24), mats.paint, 0, 0, r * 0.45));
  g.add(mesh(new THREE.TorusGeometry(r * 1.07, r * 0.05, 6, 24), mats.paint, 0, 0, -r * 0.45));
  for (let k = 0; k < 4; k++) g.add(mesh(new THREE.BoxGeometry(r * 0.06, r * 2.1, r * 0.06), mats.dark, 0, 0, -r * 0.3, 0, 0, k * Math.PI / 4 + Math.PI / 8)); // stator vanes
  prop.add(mesh(new THREE.SphereGeometry(r * 0.22, 10, 8), mats.metal, 0, 0, 0));
  for (let k = 0; k < blades; k++) { const bl = new THREE.Group(); bl.rotation.z = (k / blades) * Math.PI * 2; bl.add(mesh(new THREE.BoxGeometry(r * 0.32, r * 0.92, r * 0.05), mats.metal, 0, r * 0.52, 0, 0, 0.5, 0)); prop.add(bl); }
  g.add(prop);
  return { g, prop };
}
export function makeSub(type) {
  const def = VEHICLES[type], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const [hx, hy, hz] = def.half;
  const paint = smooth({ color: def.color, roughness: 0.32, metalness: 0.3, side: THREE.DoubleSide });
  const ud = { body, paintMat: paint, wheels: [] };
  const dark = std({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }), metal = std({ color: 0x9aa2aa, roughness: 0.3, metalness: 0.85 });
  const white = smooth({ color: 0xeceeee, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }), orange = smooth({ color: 0xe8781e, roughness: 0.4, metalness: 0.2 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x8ad8f0, transparent: true, opacity: 0.28, shininess: 160, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 1.6 });
  const glow = (c, i = 1.4) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, flatShading: true });
  ud.headMat = lampMat;
  const mats = { paint, dark, metal };
  const props = [];
  if (type === 'minisub') {
    // ---- Mini Sub: a rounded pod with a big bubble canopy, two thruster pods on short pylons with ducted props,
    // a dorsal fin, side stripes, headlamps and the battery hatch on top at the back
    body.add(mesh(loft([[-hz, 0.18, 0.18, 0.05, 2], [-hz * 0.88, 0.5, 0.48, 0.03, 2.4], [-hz * 0.6, 0.86, 0.78, 0, 2.8], [-hz * 0.15, hx, hy, 0, 3], [hz * 0.25, hx * 0.98, hy * 0.97, 0, 3], [hz * 0.45, hx * 0.9, hy * 0.88, -0.02, 2.8]], 32), paint));
    body.add(mesh(new THREE.SphereGeometry(0.86, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), glass, 0, 0.0, hz * 0.45, Math.PI / 2));
    body.add(mesh(new THREE.TorusGeometry(0.85, 0.06, 8, 32), dark, 0, 0.0, hz * 0.45));
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.03, 0.12, hz * 1.2), orange, sx * (hx - 0.02), 0.18, -0.2)); // stripe
      body.add(mesh(new THREE.BoxGeometry(0.36, 0.12, 0.5), dark, sx * (hx + 0.12), -0.2, -0.35)); // pylon
      const pod = mesh(loft([[-0.75, 0.12, 0.12, 0], [-0.55, 0.24, 0.24, 0], [0.45, 0.24, 0.24, 0], [0.7, 0.12, 0.12, 0]], 18), paint, sx * (hx + 0.38), -0.22, -0.4); body.add(pod);
      const dp = ductedProp(0.27, mats, 4); dp.g.position.set(sx * (hx + 0.38), -0.22, -1.32); body.add(dp.g); props.push(dp.prop);
      body.add(mesh(new THREE.BoxGeometry(0.55, 0.04, 0.3), paint, sx * (hx + 0.55), -0.22, -0.95)); // fin
      body.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.1, 12), lampMat, sx * (hx + 0.38), -0.22, 0.32, Math.PI / 2)); // headlamp
      body.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), dark, sx * 0.42, -hy + 0.02, 0.2)); // skids
    }
    body.add(mesh(new THREE.BoxGeometry(0.05, 0.42, 0.65), paint, 0, hy * 0.82, -hz * 0.62, -0.25)); // dorsal fin
    body.add(mesh(new THREE.BoxGeometry(1.0, 0.05, 0.35), paint, 0, 0.05, -hz * 0.9)); // tail plane
    // the battery hatch (service point): a dark panel with a glowing charge strip
    const sv = def.service;
    body.add(mesh(new THREE.BoxGeometry(0.52, 0.05, 0.42), dark, sv[0], sv[1] - 0.04, sv[2], -0.15));
    body.add(mesh(new THREE.BoxGeometry(0.36, 0.02, 0.06), glow(0x40ff90), sv[0], sv[1] - 0.01, sv[2] - 0.08, -0.15));
    body.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.06), metal, sv[0] + 0.2, sv[1] - 0.01, sv[2] + 0.12));
    // cockpit
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), std({ color: 0x1c1d20, roughness: 0.85 }), 0, -0.55, 0.15));
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.55, 0.1), std({ color: 0x1c1d20, roughness: 0.85 }), 0, -0.3, -0.12, 0.15));
    body.add(mesh(new THREE.BoxGeometry(0.62, 0.22, 0.22), dark, 0, -0.22, 0.95, -0.6));
    body.add(mesh(new THREE.BoxGeometry(0.36, 0.14, 0.02), glow(0x3ab8e8, 1.1), 0, -0.15, 0.89, -0.6));
  } else {
    // ---- the Pacific, outside: a long rounded-square white hull with orange bands, a huge glass bow dome, a dorsal sail
    // with windows, side sponsons, lit portholes, twin ducted screws, tail fins, the docking cradle and the floor hatch
    const D = def, I = D.interior, grey = std({ color: 0x8a9096, roughness: 0.5, metalness: 0.4 });
    body.add(mesh(loft([[-hz, 1.2, 1.1, 0.3, 2.2], [-hz + 0.9, 3.3, 2.8, 0.1, 3], [-hz + 2.0, hx * 0.99, hy * 0.99, 0, 3.4], [hz - 2.4, hx, hy, 0, 3.4], [hz - 1.6, hx * 0.98, hy * 0.97, 0, 3.4]], 40), paint));
    // bow: glass dome on a dark collar
    const bz = hz - 1.6;
    const DD = 3.2; // dome depth
    body.add(mesh(new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(hx * 0.97, DD, hy * 0.95), glass, 0, 0, bz, Math.PI / 2));
    body.add(mesh(new THREE.TorusGeometry(1, 0.06, 8, 40).scale(hx * 0.98, hy * 0.96, 1), dark, 0, 0, bz));
    for (const t of [0.35, 0.62, 0.84]) { const k = Math.sqrt(1 - t * t); body.add(mesh(new THREE.TorusGeometry(1, 0.025, 4, 36).scale(hx * 0.97 * k, hy * 0.95 * k, 1), dark, 0, 0, bz + DD * t)); } // window frames
    body.add(mesh(new THREE.BoxGeometry(0.05, hy * 1.9, 0.05), dark, 0, 0, bz + 0.05));
    // bands, sponsons, portholes
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.05, 0.4, hz * 1.75), orange, sx * (hx + 0.005), 1.0, -0.6));
      body.add(mesh(new THREE.BoxGeometry(0.05, 0.12, hz * 1.75), dark, sx * (hx + 0.005), 0.6, -0.6));
      body.add(mesh(loft([[-hz * 0.75, 0.2, 0.3, 0], [-hz * 0.6, 0.55, 0.6, 0], [hz * 0.3, 0.55, 0.6, 0], [hz * 0.45, 0.2, 0.3, 0]], 18), white, sx * (hx + 0.25), -hy * 0.55, 0)); // sponson
      for (let z = -12; z <= 10; z += 3.2) { body.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 18), glow(0xbfe6ff, 0.9), sx * (hx - 0.02), 0.2, z, 0, 0, Math.PI / 2)); body.add(mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 18), dark, sx * (hx + 0.01), 0.2, z, 0, Math.PI / 2)); }
      for (const z of [hz * 0.62, hz * 0.2, -hz * 0.35]) body.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.24, 12), lampMat, sx * (hx * 0.85), -hy * 0.78, z, Math.PI / 2));
      // stern planes and twin ducted screws
      body.add(mesh(new THREE.BoxGeometry(2.6, 0.16, 3.4), paint, sx * (hx + 1.1), -0.6, -hz + 2.2, 0, 0, sx * 0.06));
      const dp = ductedProp(1.15, mats, 6); dp.g.position.set(sx * 2.3, -0.7, -hz - 0.4); body.add(dp.g); props.push(dp.prop);
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 1.6), dark, sx * 2.3, -0.7, -hz + 0.6));
    }
    body.add(mesh(new THREE.BoxGeometry(0.16, 3.2, 3.6), paint, 0, hy + 1.1, -hz + 2.0, 0.28)); // tail fin
    body.add(mesh(new THREE.BoxGeometry(0.16, 1.4, 2.4), paint, 0, -hy - 0.4, -hz + 2.2, -0.3)); // ventral fin
    // dorsal sail with a window band and a mast light
    body.add(mesh(loft([[-1.5, 0.3, 0.6, hy + 0.4, 3], [-0.6, 1.25, 1.1, hy + 0.5, 3.4], [4.5, 1.25, 1.1, hy + 0.5, 3.4], [6.2, 0.4, 0.7, hy + 0.3, 3]], 24), paint, 0, 0, 3));
    body.add(mesh(new THREE.BoxGeometry(2.52, 0.32, 4.2), glow(0x9ad8ff, 0.6), 0, hy + 0.9, 4.8));
    body.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), metal, 0, hy + 2.3, 4.0));
    body.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(0xff3020, 2), 0, hy + 3.0, 4.0));
    // docking cradle under the hull (the Mini Sub hangs here) and the floor hatch with its ladder
    const dk = D.dock;
    body.add(mesh(new THREE.BoxGeometry(2.8, 0.3, 4.6), dark, 0, -hy - 0.05, dk.z));
    for (const sx of [-1, 1]) for (const dz of [-1.3, 1.3]) body.add(mesh(new THREE.BoxGeometry(0.22, 1.2, 0.32), grey, sx * 1.2, -hy - 0.65, dk.z + dz));
    body.add(mesh(new THREE.TorusGeometry(1.0, 0.07, 6, 24), glow(0xffb020, 0.8), 0, -hy - 0.22, dk.z, Math.PI / 2));
    const hx2 = D.hatch.x, hz2 = D.hatch.z;
    body.add(mesh(new THREE.CylinderGeometry(0.65, 0.65, hy + I.y0 + 0.3, 18, 1, true), dark, hx2, (-hy + I.y0) / 2, hz2));
    body.add(mesh(new THREE.TorusGeometry(0.66, 0.06, 6, 20), glow(0x40e070, 0.8), hx2, -hy - 0.02, hz2, Math.PI / 2));
    for (let y = -hy - 0.2; y > -hy - 1.8; y -= 0.35) body.add(mesh(new THREE.BoxGeometry(0.6, 0.04, 0.05), metal, hx2, y, hz2 - 0.35));
    for (const sx of [-0.28, 0.28]) body.add(mesh(new THREE.BoxGeometry(0.05, 1.8, 0.05), metal, hx2 + sx, -hy - 0.95, hz2 - 0.35));

    // ---- inside: 8 m wide, 4 m tall, 33 m long
    const y0 = I.y0, y1 = I.y1, W2 = I.hx, Z = I.hz, H = y1 - y0, ym = (y0 + y1) / 2;
    const floorM = std({ color: 0x5c6269, roughness: 0.75, metalness: 0.45 }), panel = std({ color: 0xdfe3e3, roughness: 0.6, side: THREE.DoubleSide });
    const panel2 = std({ color: 0xc4ccd0, roughness: 0.6, side: THREE.DoubleSide }), rib = std({ color: 0x6a7078, roughness: 0.5, metalness: 0.5 });
    const pipeM = std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 }), hazard = std({ color: 0xe8b020, roughness: 0.5 }), fabric = std({ color: 0x35506a, roughness: 0.9 }), cushion = std({ color: 0x1c1d20, roughness: 0.85 });
    const wood = std({ color: 0x8a6a4a, roughness: 0.7 });
    const iz0 = -Z, iz1 = bz - 0.2; // the room runs into the dome at the bow
    body.add(mesh(new THREE.BoxGeometry(W2 * 2, 0.1, iz1 - iz0), floorM, 0, y0 - 0.05, (iz0 + iz1) / 2));
    body.add(mesh(new THREE.BoxGeometry(1.6, 0.02, iz1 - iz0 - 1), std({ color: 0x3e4349, roughness: 0.9 }), 0, y0 + 0.01, (iz0 + iz1) / 2)); // walkway
    for (let z = iz0 + 0.6; z < iz1; z += 0.6) body.add(mesh(new THREE.BoxGeometry(W2 * 2, 0.012, 0.03), rib, 0, y0 + 0.02, z));
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.06, H * 0.55, iz1 - iz0), panel, sx * (W2 + 0.05), y0 + H * 0.275, (iz0 + iz1) / 2)); // lower panels
      body.add(mesh(new THREE.BoxGeometry(0.06, H * 0.45, iz1 - iz0), panel2, sx * (W2 + 0.05), y0 + H * 0.775, (iz0 + iz1) / 2));
      body.add(mesh(new THREE.BoxGeometry(0.08, 0.06, iz1 - iz0), rib, sx * (W2 + 0.02), y0 + H * 0.55, (iz0 + iz1) / 2)); // dado rail
      for (let z = -12; z <= 10; z += 3.2) body.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 18), glow(0x9ad8ff, 0.5), sx * (W2 + 0.01), 0.2, z, 0, 0, Math.PI / 2)); // portholes inside
    }
    body.add(mesh(new THREE.BoxGeometry(W2 * 2, 0.06, iz1 - iz0), panel, 0, y1 + 0.03, (iz0 + iz1) / 2));
    body.add(mesh(new THREE.BoxGeometry(W2 * 2, H, 0.08), panel, 0, ym, iz0 - 0.04)); // stern wall
    for (let z = iz0 + 1.2; z < iz1 - 0.5; z += 1.6) {
      for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.14, H, 0.16), rib, sx * (W2 - 0.02), ym, z));
      body.add(mesh(new THREE.BoxGeometry(W2 * 2, 0.14, 0.16), rib, 0, y1 - 0.05, z));
    }
    for (const sx of [-1, 1]) for (const y of [y1 - 0.3, y1 - 0.52]) body.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, iz1 - iz0 - 1, 8), pipeM, sx * (W2 - 0.25), y, (iz0 + iz1) / 2, Math.PI / 2));
    body.add(mesh(new THREE.BoxGeometry(0.6, 0.08, iz1 - iz0 - 1), rib, 0, y1 - 0.1, (iz0 + iz1) / 2)); // cable tray
    for (let z = -14; z <= 13; z += 4.5) body.add(mesh(new THREE.BoxGeometry(1.0, 0.04, 0.4), lampMat, 0, y1 - 0.02, z));
    // bulkheads with hazard-striped door frames (bridge at z 12, engine room at z -8.5)
    for (const bzz of [12.0, -8.5]) {
      for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(W2 - 0.8, H, 0.18), panel, sx * (0.8 + (W2 - 0.8) / 2), ym, bzz));
      body.add(mesh(new THREE.BoxGeometry(1.6, y1 - (y0 + 2.6), 0.18), panel, 0, (y0 + 2.6 + y1) / 2, bzz));
      for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.12, 2.65, 0.24), hazard, sx * 0.8, y0 + 1.3, bzz));
      body.add(mesh(new THREE.BoxGeometry(1.72, 0.12, 0.24), hazard, 0, y0 + 2.62, bzz));
      body.add(mesh(new THREE.BoxGeometry(0.5, 0.18, 0.04), glow(bzz > 0 ? 0x40c0ff : 0x40ff90, 1), 0, y0 + 2.95, bzz + (bzz > 0 ? -0.12 : 0.12)));
    }
    // ---- bridge (bow): helm console with wheel and screens, captain's chair, two side stations, sonar table
    const hz0 = 15.7;
    body.add(mesh(new THREE.BoxGeometry(2.2, 0.95, 0.8), dark, 0, y0 + 0.47, hz0));
    body.add(mesh(new THREE.BoxGeometry(2.0, 0.6, 0.06), glow(0x1a7aa0, 1.2), 0, y0 + 1.2, hz0 - 0.32, -0.55));
    body.add(mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 18), metal, 0, y0 + 1.05, hz0 - 0.45, -0.45));
    for (let k = 0; k < 3; k++) body.add(mesh(new THREE.BoxGeometry(0.66, 0.03, 0.03), metal, 0, y0 + 1.05, hz0 - 0.45, -0.45, 0, k * 1.047));
    const sz = D.seats[0][2];
    body.add(mesh(new THREE.BoxGeometry(0.75, 0.14, 0.75), cushion, 0, y0 + 0.47, sz));
    body.add(mesh(new THREE.BoxGeometry(0.75, 0.85, 0.14), cushion, 0, y0 + 0.95, sz - 0.4, 0.12));
    body.add(mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.42, 8), metal, 0, y0 + 0.21, sz));
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.7, 1.0, 2.0), dark, sx * (W2 - 0.5), y0 + 0.5, 14.3));
      body.add(mesh(new THREE.BoxGeometry(0.05, 0.55, 1.6), glow(sx < 0 ? 0x30c870 : 0xd88a30, 1.2), sx * (W2 - 0.86), y0 + 1.28, 14.3, 0, 0, sx * 0.35));
      body.add(mesh(new THREE.BoxGeometry(0.55, 0.12, 0.55), cushion, sx * (W2 - 1.3), y0 + 0.45, 14.3));
    }
    body.add(mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.9, 20), dark, 0, y0 + 0.45, 13.0));
    body.add(mesh(new THREE.CircleGeometry(0.66, 28), glow(0x30e090, 0.9), 0, y0 + 0.91, 13.0, -Math.PI / 2)); // sonar table
    // ---- crew quarters (z 6 – 12): bunks along port, mess table and benches to starboard (fabricator on that wall)
    for (const bz2 of [9.0, 11.0]) for (const by of [y0 + 0.45, y0 + 1.55]) {
      body.add(mesh(new THREE.BoxGeometry(0.95, 0.12, 1.95), rib, -(W2 - 0.5), by, bz2));
      body.add(mesh(new THREE.BoxGeometry(0.85, 0.12, 1.85), fabric, -(W2 - 0.5), by + 0.12, bz2));
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 0.45), white, -(W2 - 0.5), by + 0.22, bz2 + 0.65));
    }
    for (const bz2 of [8.0, 10.0, 12.0 - 0.1]) body.add(mesh(new THREE.BoxGeometry(0.06, 2.4, 0.06), metal, -(W2 - 1.0), y0 + 1.2, bz2));
    body.add(mesh(new THREE.BoxGeometry(1.0, 0.08, 2.2), wood, W2 - 1.45, y0 + 0.78, 7.6));
    body.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.75, 8), metal, W2 - 1.45, y0 + 0.38, 7.6));
    for (const dx of [-0.75, 0.75]) body.add(mesh(new THREE.BoxGeometry(0.4, 0.45, 2.0), cushion, W2 - 1.45 + dx, y0 + 0.23, 7.6));
    // ---- the open hall: deck outline for building, the docking bay and the entrance hatch
    const dkz = D.deck.z, cells = D.deck.cells;
    const d0 = dkz + Math.min(...cells) * 1.5 - 1.5, d1 = dkz + Math.max(...cells) * 1.5 + 1.5;
    for (const z of [d0, d1]) body.add(mesh(new THREE.BoxGeometry(3.0, 0.02, 0.08), hazard, D.deck.x, y0 + 0.025, z));
    for (const sx of [-1.5, 1.5]) body.add(mesh(new THREE.BoxGeometry(0.08, 0.02, d1 - d0), hazard, D.deck.x + sx, y0 + 0.025, (d0 + d1) / 2));
    body.add(mesh(new THREE.BoxGeometry(0.6, 1.6, 1.3), dark, -(W2 - 0.35), y0 + 0.8, dk.z));
    body.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 1.0), glow(0x3ab8e8, 1.2), -(W2 - 0.67), y0 + 1.3, dk.z));
    body.add(mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 24), hazard, 0, y0 + 0.03, dk.z, Math.PI / 2));
    body.add(mesh(new THREE.CircleGeometry(0.85, 24), grey, 0, y0 + 0.02, dk.z, -Math.PI / 2));
    body.add(mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 20), hazard, hx2, y0 + 0.03, hz2, Math.PI / 2));
    body.add(mesh(new THREE.CircleGeometry(0.6, 20), std({ color: 0x2a6070, roughness: 0.3, metalness: 0.4 }), hx2, y0 + 0.02, hz2, -Math.PI / 2));
    for (const z of [3.5, -2.5]) body.add(mesh(new THREE.BoxGeometry(0.05, 0.55, 0.9), glow(0x1a6a8a, 1.1), W2 - 0.02, y0 + 1.7, z));
    // ---- engine room (z -8.5 .. stern): the drive with glowing rings, upgrade console, power cell rack
    body.add(mesh(new THREE.CylinderGeometry(1.25, 1.25, 3.0, 20), grey, 0, -0.9, -14.3, Math.PI / 2));
    for (const z of [-15.5, -14.3, -13.1]) body.add(mesh(new THREE.TorusGeometry(1.27, 0.07, 6, 24), glow(0x40e0ff, 1.4), 0, -0.9, z));
    body.add(mesh(new THREE.BoxGeometry(2.6, 0.45, 3.4), dark, 0, y0 + 0.22, -14.3));
    for (const sx of [-1, 1]) body.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), pipeM, sx * 1.6, -0.2, -13.0, Math.PI / 2));
    body.add(mesh(new THREE.BoxGeometry(0.6, 1.6, 1.2), dark, W2 - 0.35, y0 + 0.8, -11.2)); // upgrade console
    body.add(mesh(new THREE.BoxGeometry(0.05, 0.75, 0.9), glow(0xe8a030, 1.2), W2 - 0.67, y0 + 1.3, -11.2));
    // the power cell rack: a tall cabinet with six glowing cell bays (put Power Cells / Batteries in here)
    body.add(mesh(new THREE.BoxGeometry(0.75, 2.2, 2.0), dark, -(W2 - 0.4), y0 + 1.1, -12.2));
    for (let k = 0; k < 6; k++) {
      const cy = y0 + 0.55 + (k % 3) * 0.6, cz = -12.65 + Math.floor(k / 3) * 0.9;
      body.add(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.6), std({ color: 0x15171a }), -(W2 - 0.79), cy, cz));
      body.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10), glow(0x40ff90, 1.1), -(W2 - 0.82), cy, cz, Math.PI / 2, 0, 0));
    }
    body.add(mesh(new THREE.BoxGeometry(0.04, 0.12, 1.6), glow(0x40ff90, 1.4), -(W2 - 0.79), y0 + 2.1, -12.2));
    // lights: blue bridge, warm quarters, white hall, teal engine room
    for (const [z, c, i] of [[14.5, 0x9ad8ff, 1.6], [9.0, 0xffe2b8, 1.8], [-1.5, 0xf4f0e8, 2.4], [-13.0, 0x80f0ff, 1.8]]) { const L = new THREE.PointLight(c, i, 16, 1.2); L.position.set(0, y1 - 0.5, z); body.add(L); }
  }
  ud.props = props;
  const headlight = new THREE.SpotLight(0xfff0d0, 0, type === 'cyclops' ? 80 : 45, 0.6, 0.5, 1.1);
  headlight.position.set(0, -hy * 0.3, hz); headlight.target.position.set(0, -2, hz + 14);
  body.add(headlight); body.add(headlight.target);
  ud.headlight = headlight; ud.baseColor = paint.color.getHex();
  g.userData = ud;
  return g;
}
