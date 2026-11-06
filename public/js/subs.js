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
    const inCave = this.pos.y < CAVE_ZONE;
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
      if (P.y < CAVE_ZONE) {
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
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; return m; }
// a lofted hull: elliptical sections along z ([z, rx, ry, yOffset])
function loft(sections, seg = 10) {
  const pos = [];
  const ring = ([z, rx, ry, oy]) => { const out = []; for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; out.push([Math.cos(a) * rx, Math.sin(a) * ry + oy, z]); } return out; };
  for (let i = 0; i < sections.length - 1; i++) {
    const A = ring(sections[i]), B = ring(sections[i + 1]);
    for (let k = 0; k < seg; k++) pos.push(...A[k], ...A[k + 1], ...B[k + 1], ...A[k], ...B[k + 1], ...B[k]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
export function makeSub(type) {
  const def = VEHICLES[type], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const [hx, hy, hz] = def.half;
  const paint = std({ color: def.color, roughness: 0.35, metalness: 0.35, side: THREE.DoubleSide });
  const ud = { body, paintMat: paint, wheels: [] };
  const dark = std({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }), metal = std({ color: 0x9aa2aa, roughness: 0.3, metalness: 0.85 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x8ad8f0, transparent: true, opacity: 0.32, shininess: 140, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 1.5 });
  ud.headMat = lampMat;
  const props = [];
  if (type === 'minisub') {
    // a two-tone pod with a bubble canopy, twin thruster nacelles and a rear rudder
    body.add(mesh(loft([[-hz, 0.25, 0.25, 0], [-hz * 0.7, 0.75, 0.7, 0], [-hz * 0.1, hx, hy, 0], [hz * 0.45, hx * 0.92, hy * 0.92, 0], [hz * 0.8, hx * 0.55, hy * 0.6, -0.1]]), paint));
    body.add(mesh(new THREE.SphereGeometry(0.82, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), glass, 0, 0.05, hz * 0.62, Math.PI / 2 + 0.25));
    body.add(mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 20), dark, 0, 0.0, hz * 0.55, 0.25));
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.3, 10), dark, sx * (hx + 0.12), -0.25, -0.3, Math.PI / 2));
      const pr = new THREE.Group(); pr.position.set(sx * (hx + 0.12), -0.25, -1.0); body.add(pr); props.push(pr);
      for (let k = 0; k < 3; k++) pr.add(mesh(new THREE.BoxGeometry(0.05, 0.36, 0.04), metal, 0, 0, 0, 0, 0, k * 2.09));
      body.add(mesh(new THREE.BoxGeometry(0.05, 0.25, 0.5), dark, sx * 0.45, -0.75, 0.4)); // skids
      const L = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 8), lampMat, sx * 0.55, -0.35, hz * 0.85, Math.PI / 2); body.add(L);
    }
    body.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 0.5), paint, 0, 0.6, -hz * 0.85));
    body.add(mesh(new THREE.BoxGeometry(1.2, 0.05, 0.4), paint, 0, 0, -hz * 0.9));
    body.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), std({ color: 0x1c1d20, roughness: 0.85 }), 0, -0.55, 0.25)); // seat
    body.add(mesh(new THREE.BoxGeometry(0.6, 0.25, 0.2), dark, 0, -0.15, 1.0, -0.6)); // console
  } else {
    // the Leviathan: a long white hull with a huge bow window, a rear moon-pool doorway, fins and a big screw
    const sec = [[-hz - 0.6, 0.6, 0.6, 0.2], [-hz, hx * 0.95, hy * 0.95, 0], [-hz * 0.6, hx * 1.06, hy * 1.02, 0], [hz * 0.5, hx * 1.06, hy * 1.02, 0], [hz * 0.85, hx * 0.98, hy * 0.92, 0]];
    body.add(mesh(loft(sec, 14), paint));
    // bow: a faceted glass dome over the helm
    body.add(mesh(new THREE.SphereGeometry(2.45, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.05, hz * 0.85, Math.PI / 2, 0, 0));
    body.add(mesh(new THREE.TorusGeometry(2.4, 0.09, 6, 24), dark, 0, 0.05, hz * 0.85));
    // stripes and deck details outside
    for (const sx of [-1, 1]) {
      body.add(mesh(new THREE.BoxGeometry(0.06, 0.25, hz * 1.5), std({ color: 0xe07a20, roughness: 0.4 }), sx * hx * 1.07, 0.5, -0.4));
      body.add(mesh(new THREE.BoxGeometry(1.6, 0.12, 3.2), paint, sx * (hx + 0.8), -0.6, -hz * 0.8, 0, 0, sx * 0.1)); // stern planes
      for (const z of [hz * 0.7, -hz * 0.2]) body.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 10), lampMat, sx * hx * 0.9, -hy * 0.75, z, Math.PI / 2));
    }
    body.add(mesh(new THREE.BoxGeometry(0.12, 2.4, 3.4), paint, 0, hy + 0.7, -hz * 0.78, 0.25)); // tail fin
    body.add(mesh(new THREE.BoxGeometry(2.2, 0.9, 5), paint, 0, hy + 0.2, -1.5)); // conning hump
    const pr = new THREE.Group(); pr.position.set(0, 0.2, -hz - 0.7); body.add(pr); props.push(pr);
    pr.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), dark, 0, 0, 0, Math.PI / 2));
    for (let k = 0; k < 5; k++) pr.add(mesh(new THREE.BoxGeometry(0.12, 1.9, 0.08), metal, 0, 0, -0.1, 0, 0.3, k * 1.257));
    // ---- interior: deck plating, walls panels, helm, lights, the moon-pool doorway frame
    const floor = std({ color: 0x5a6068, roughness: 0.7, metalness: 0.4 }), panel = std({ color: 0xcfd4d6, roughness: 0.6, side: THREE.DoubleSide });
    body.add(mesh(new THREE.BoxGeometry(hx * 1.9, 0.1, hz * 1.9), floor, 0, -1.45, 0));
    for (let z = -hz + 1; z < hz - 0.5; z += 2) body.add(mesh(new THREE.BoxGeometry(hx * 1.9, 0.02, 0.04), dark, 0, -1.39, z));
    for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.06, 3.1, hz * 1.9), panel, sx * 2.22, 0.15, 0));
    body.add(mesh(new THREE.BoxGeometry(hx * 1.9, 0.06, hz * 1.9), panel, 0, 1.76, 0));
    body.add(mesh(new THREE.BoxGeometry(1.4, 0.9, 0.6), dark, 0, -0.95, 8.75));       // helm console
    body.add(mesh(new THREE.BoxGeometry(1.2, 0.5, 0.05), std({ color: 0x1a6a8a, emissive: 0x0a5a7a, emissiveIntensity: 1.2 }), 0, -0.35, 8.5, -0.5)); // screens
    body.add(mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), std({ color: 0x1c1d20, roughness: 0.85 }), 0, -1.15, 7.55)); // pilot seat
    for (const sx of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.15, 2.5, 0.25), metal, sx * 0.78, -0.2, -9.3));
    body.add(mesh(new THREE.BoxGeometry(1.7, 0.15, 0.25), metal, 0, 1.05, -9.3));
    for (const z of [-5, 0, 5]) { const L = new THREE.PointLight(0xf4f0e0, 1.6, 9, 1.4); L.position.set(0, 1.4, z); body.add(L); body.add(mesh(new THREE.BoxGeometry(0.8, 0.05, 0.3), lampMat, 0, 1.72, z)); }
  }
  ud.props = props;
  const headlight = new THREE.SpotLight(0xfff0d0, 0, type === 'cyclops' ? 70 : 45, 0.6, 0.5, 1.1);
  headlight.position.set(0, -hy * 0.3, hz); headlight.target.position.set(0, -2, hz + 14);
  body.add(headlight); body.add(headlight.target);
  ud.headlight = headlight; ud.baseColor = paint.color.getHex();
  g.userData = ud;
  return g;
}
