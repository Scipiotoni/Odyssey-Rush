// High-detail low-poly weapon models. Guns point along -Z with the pistol grip at the origin and the
// bore around y≈0.055 (same frame as items3d.js, so viewmodels, third person and icons line up).
// Shapes are side profiles extruded with a small chamfer, so silhouettes read like real firearms.
// Parts are grouped by material: blued metal, bright metal, polymer, wood, rubber, glass and glow.
import * as THREE from 'three';
import { part, merge } from './models.js';
import { MODS, FINISHES, modsKey } from '/shared/gunmods.js';

// ---------------------------------------------------------------- materials
const MATS = {
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.36, flatShading: true }),
  bright: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.95, roughness: 0.18, flatShading: true }),
  poly: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.08, roughness: 0.72, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.55, flatShading: true }),
  rubber: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.95, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x3a6a8a, metalness: 0.4, roughness: 0.04, emissive: 0x0a1a28, transparent: true, opacity: 0.85 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  glowG: new THREE.MeshBasicMaterial({ color: 0x40ff60 }),
};
const K = {
  blued: 0x26282c, black: 0x1a1b1d, gun: 0x34373b, steel: 0x8a9096, chrome: 0xc9ced3, brass: 0xc9a24a, tan: 0x8c7650, olive: 0x4e5636,
  polyB: 0x1e1f21, polyG: 0x2a2c2e, wood: 0x5e3418, woodL: 0x7a4422, woodD: 0x40220e, rubber: 0x161616, red: 0xa02018, white: 0xe8e8e8, orange: 0xd86a1a,
};

// ---------------------------------------------------------------- geometry helpers
// side profile: points [[u, v]] with u = forward (towards the muzzle), v = up; extruded `w` wide in x
function prof(pts, w, bevel = 0.003) {
  const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const d = Math.max(0.001, w - bevel * 2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -d / 2);
  g.rotateY(Math.PI / 2); // u -> -z, extrusion -> x
  return g.toNonIndexed ? g : g;
}
// rounded profile from a few points (smooth corners)
function smooth(pts, n = 3) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    if (b[2] === undefined) { out.push([b[0], b[1]]); continue; }
    const r = b[2];
    const da = Math.hypot(a[0] - b[0], a[1] - b[1]), dc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const p0 = [b[0] + ((a[0] - b[0]) / da) * r, b[1] + ((a[1] - b[1]) / da) * r], p1 = [b[0] + ((c[0] - b[0]) / dc) * r, b[1] + ((c[1] - b[1]) / dc) * r];
    for (let k = 0; k <= n; k++) { const t = k / n, it = 1 - t; out.push([it * it * p0[0] + 2 * it * t * b[0] + t * t * p1[0], it * it * p0[1] + 2 * it * t * b[1] + t * t * p1[1]]); }
  }
  return out;
}
// tube along -z from z0 (back) to z0-len, at height y
const tube = (r0, r1, len, seg = 12) => { const g = new THREE.CylinderGeometry(r1, r0, len, seg); g.rotateX(-Math.PI / 2); return g; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const tor = (r, t, arc = Math.PI * 2, s = 14) => new THREE.TorusGeometry(r, t, 5, s, arc);

class B {
  constructor() { this.by = {}; }
  add(mat, geo, color, t = {}) { (this.by[mat] = this.by[mat] || []).push(part(geo, color, t)); return this; }
  // a tube centred between z = zBack and zFront (zFront < zBack)
  tube(mat, r0, r1, zBack, zFront, y, color, x = 0, seg = 12) { return this.add(mat, tube(r0, r1, zBack - zFront, seg), color, { x, y, z: (zBack + zFront) / 2 }); }
  // picatinny rail with cross slots
  rail(zBack, zFront, y, w = 0.022, color = K.black, x = 0, rz = 0) {
    const len = zBack - zFront;
    this.add('metal', box(w * 0.7, 0.008, len), color, { x, y, z: (zBack + zFront) / 2, rz });
    const n = Math.floor(len / 0.0105);
    for (let i = 0; i < n; i++) this.add('metal', box(w, 0.006, 0.0055), color, { x, y: y + 0.006, z: zBack - 0.006 - i * 0.0105, rz });
    return this;
  }
  screw(x, y, z, r = 0.004, axis = 'x', color = K.steel) { return this.add('bright', cyl(r, r, 0.004, 6), color, { x, y, z, rz: axis === 'x' ? Math.PI / 2 : 0, rx: axis === 'z' ? Math.PI / 2 : 0 }); }
  build() {
    const g = new THREE.Group();
    for (const k in this.by) { const m = new THREE.Mesh(merge(this.by[k]), MATS[k]); m.castShadow = true; g.add(m); }
    return g;
  }
}

// common bits ------------------------------------------------------
function pistolGrip(b, mat, color, z = 0.035, y = 0.0, ang = 0.32, len = 0.12, w = 0.03) {
  // grip with finger grooves and a beavertail, angled back
  const pts = smooth([[0.0, 0.0], [-0.032, 0.0, 0.01], [-0.04 - Math.sin(ang) * len, -len, 0.012], [-0.006 - Math.sin(ang) * len, -len - 0.006, 0.01],
    [0.004 - Math.sin(ang) * len * 0.66, -len * 0.66], [-0.002 - Math.sin(ang) * len * 0.5, -len * 0.5], [0.006 - Math.sin(ang) * len * 0.33, -len * 0.33], [0.004, -0.012]]);
  b.add(mat, prof(pts, w, 0.004), color, { y, z: z - 0.002 });
  // stipple texture panels
  for (let i = 0; i < 4; i++) b.add(mat, box(w + 0.002, 0.012, 0.024), new THREE.Color(color).multiplyScalar(0.8).getHex(), { y: y - 0.025 - i * 0.022, z: z + 0.016 + Math.sin(ang) * (0.025 + i * 0.022), rx: -ang });
}
function triggerGuard(b, z0, z1, y, color = K.black, w = 0.012) {
  const pts = [[z0, y], [z0 + 0.004, y - 0.03], [z1 - 0.004, y - 0.035], [z1, y - 0.03], [z1, y], [z1 - 0.004, y], [z1 - 0.006, y - 0.027], [z0 + 0.007, y - 0.024], [z0 + 0.004, y]];
  b.add('metal', prof(pts.map(([u, v]) => [-u, v]), w, 0.0015), color, {});
  b.add('metal', prof([[0, 0], [0.004, 0], [0.006, -0.018], [0.0, -0.022], [-0.002, -0.02], [0.002, -0.004]], 0.006, 0.001), K.steel, { y: y - 0.002, z: (z0 + z1) / 2 + 0.004 });
}
function muzzleBrake(b, z, y, r = 0.012, len = 0.05, color = K.black) {
  b.tube('metal', r, r, z, z - len, y, color, 0, 8);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.add('metal', box(0.004, r * 1.1, 0.008), K.rubber, { x: s * r * 0.95, y, z: z - 0.01 - i * 0.013 });
  b.add('metal', tor(r * 0.75, 0.002, Math.PI * 2, 10), K.rubber, { y, z: z - len - 0.001 });
}
function redDot(b, z, y) {
  b.add('metal', box(0.03, 0.012, 0.05), K.black, { y: y + 0.006, z });                     // mount
  b.tube('metal', 0.019, 0.021, z + 0.03, z - 0.035, y + 0.034, K.black, 0, 14);              // housing
  b.add('metal', box(0.012, 0.012, 0.014), K.black, { x: 0.024, y: y + 0.034, z: z + 0.005 }); // brightness knob
  b.add('glass', new THREE.CircleGeometry(0.016, 14), 0xffffff, { y: y + 0.034, z: z + 0.031 });
  b.add('glass', new THREE.CircleGeometry(0.018, 14), 0xffffff, { y: y + 0.034, z: z - 0.036, ry: Math.PI });
  b.add('glow', new THREE.SphereGeometry(0.0018, 6, 4), 0xffffff, { y: y + 0.034, z: z - 0.02 });
}
function scope(b, zBack, zFront, y, r = 0.02) {
  const mid = (zBack + zFront) / 2;
  b.tube('metal', r * 1.35, r, zBack, zBack - 0.06, y, K.black, 0, 16);              // eyepiece
  b.tube('rubber', r * 1.4, r * 1.4, zBack + 0.012, zBack, y, K.rubber, 0, 16);        // eye cup
  b.tube('metal', r, r, zBack - 0.06, zFront + 0.09, y, K.black, 0, 16);              // main tube
  b.tube('metal', r, r * 1.6, zFront + 0.09, zFront + 0.03, y, K.black, 0, 16);       // objective bell
  b.tube('metal', r * 1.6, r * 1.6, zFront + 0.03, zFront, y, K.black, 0, 16);
  b.add('metal', cyl(r * 0.6, r * 0.6, 0.028, 10), K.black, { y: y + r + 0.012, z: mid });      // elevation turret
  b.add('metal', cyl(r * 0.6, r * 0.6, 0.028, 10), K.black, { x: r + 0.012, y, z: mid, rz: Math.PI / 2 }); // windage
  b.add('bright', cyl(r * 0.62, r * 0.62, 0.004, 10), K.steel, { y: y + r + 0.027, z: mid });
  b.add('glass', new THREE.CircleGeometry(r * 1.5, 16), 0xffffff, { y, z: zFront - 0.001, ry: Math.PI });
  b.add('glass', new THREE.CircleGeometry(r * 1.2, 16), 0xffffff, { y, z: zBack + 0.013 });
  for (const zz of [zBack - 0.085, zFront + 0.12]) { // rings
    b.add('metal', tor(r * 1.08, 0.006, Math.PI * 2, 14), K.blued, { y, z: zz });
    b.add('metal', box(0.024, y - 0.075, 0.018), K.blued, { y: 0.075 + (y - 0.075) / 2 - 0.004, z: zz });
    b.screw(0.0, y + r + 0.008, zz, 0.003, 'y');
  }
}

// ---------------------------------------------------------------- magazines
const bigMag = (o) => o?.mods?.mag === 'ext_mag' || o?.mods?.mag === 'drum_mag';
// AR-style curved magazine; len > 1 = extended
function curvedMag(b, len = 1, color = K.tan) {
  const L = 0.17 * len, mag = [];
  const f = (t) => [0.088 + t * 0.03 * len + t * t * 0.03 * len, -0.005 - t * L];
  const r = (t) => [0.15 + t * 0.035 * len + t * t * 0.035 * len, -0.005 - t * L];
  for (let i = 0; i <= 6; i++) mag.push(f(i / 6));
  for (let i = 6; i >= 0; i--) mag.push(r(i / 6));
  b.add('poly', prof(mag, 0.026, 0.003), color, { y: -0.03 });
  for (const t0 of [0.25, 0.5, 0.75]) b.add('poly', prof([f(t0), f(t0 + 0.05), r(t0 + 0.05), r(t0)], 0.029, 0.001), new THREE.Color(color).multiplyScalar(0.82).getHex(), { y: -0.03 });
  const e0 = f(1), e1 = r(1);
  b.add('poly', prof([[e0[0] - 0.002, e0[1]], [e1[0] + 0.002, e1[1]], [e1[0] + 0.004, e1[1] - 0.014], [e0[0] - 0.004, e0[1] - 0.014]], 0.03, 0.002), K.black, { y: -0.03 });
}
// straight box magazine (smg / pistol / bolt)
function straightMag(b, z, top, len, depth, color = K.polyB, ang = 0) {
  b.add('poly', prof([[-z - depth / 2, top], [-z + depth / 2, top], [-z + depth / 2 + Math.sin(ang) * len, top - len], [-z - depth / 2 + Math.sin(ang) * len, top - len]], 0.026, 0.003), color, {});
  b.add('poly', box(0.03, 0.012, depth + 0.008), K.black, { y: top - len - 0.004, z: z - Math.sin(ang) * len, rx: -ang });
}
function drumMag(b, z, y, r = 0.065) {
  b.add('poly', cyl(r, r, 0.05, 16), K.polyB, { y, z, rz: Math.PI / 2 });
  b.add('poly', cyl(r * 0.94, r * 0.94, 0.054, 16), K.polyG, { y, z, rz: Math.PI / 2 });
  b.add('metal', cyl(r * 0.25, r * 0.25, 0.058, 8), K.steel, { y, z, rz: Math.PI / 2 });
  b.add('poly', box(0.026, 0.07, 0.04), K.polyB, { y: y + r * 0.9, z: z + 0.01 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add('poly', box(0.056, 0.01, 0.01), K.black, { y: y + Math.sin(a) * r * 0.98, z: z + Math.cos(a) * r * 0.98, rx: a }); }
}

// ---------------------------------------------------------------- weapons
const W = {};

W.rifle = (o) => {
  const b = new B(), y = 0.055;
  // lower receiver with magwell
  b.add('metal', prof([[-0.06, 0.035], [0.215, 0.035], [0.215, 0.012], [0.165, 0.008], [0.16, -0.035], [0.085, -0.035], [0.08, 0.004], [0.0, 0.0], [-0.06, 0.006]], 0.038, 0.003), K.gun, { y: 0.0 });
  // upper receiver + ejection port + forward assist + charging handle
  b.add('metal', prof([[-0.06, 0.035], [0.24, 0.035], [0.24, 0.078], [-0.035, 0.078], [-0.06, 0.06]], 0.036, 0.003), K.gun, {});
  b.add('metal', box(0.002, 0.018, 0.06), K.black, { x: 0.019, y: 0.058, z: -0.09 });
  b.add('metal', box(0.003, 0.004, 0.064), K.steel, { x: 0.0195, y: 0.069, z: -0.09 });
  b.add('metal', cyl(0.009, 0.009, 0.03, 8), K.gun, { x: 0.022, y: 0.066, z: 0.0, rx: Math.PI / 2 });
  b.add('metal', box(0.03, 0.01, 0.025), K.black, { y: 0.074, z: 0.06 });
  b.add('metal', box(0.012, 0.012, 0.01), K.black, { x: 0.016, y: 0.074, z: 0.075 });
  b.rail(0.055, -0.23, 0.079, 0.022);
  // handguard: octagonal M-LOK tube with slots, full-length top rail
  b.tube('poly', 0.03, 0.03, -0.24, -0.5, y, K.tan, 0, 8);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.add('poly', box(0.004, 0.009, 0.034), K.black, { x: s * 0.028, y: y - 0.004, z: -0.27 - i * 0.055 });
  for (let i = 0; i < 4; i++) b.add('poly', box(0.009, 0.004, 0.034), K.black, { y: y - 0.029, z: -0.27 - i * 0.055 });
  b.rail(-0.24, -0.5, 0.079, 0.022);
  b.add('metal', box(0.02, 0.035, 0.03), K.black, { y: 0.075, z: -0.47 });         // folding front sight base
  b.add('metal', box(0.006, 0.02, 0.006), K.black, { y: 0.1, z: -0.47 });
  // barrel + gas block + muzzle brake
  b.tube('metal', 0.0095, 0.009, -0.5, -0.64, y, K.blued, 0, 10);
  b.add('metal', box(0.018, 0.024, 0.022), K.black, { y: y + 0.004, z: -0.52 });
  // pistol grip + trigger guard + trigger, safety and mag release
  pistolGrip(b, 'poly', K.polyB, 0.03, 0.002, 0.32, 0.115, 0.03);
  triggerGuard(b, -0.075, 0.005, 0.002);
  b.add('metal', cyl(0.006, 0.006, 0.005, 8), K.steel, { x: 0.021, y: 0.018, z: 0.002, rz: Math.PI / 2 });
  b.add('metal', box(0.004, 0.008, 0.008), K.black, { x: 0.021, y: 0.004, z: -0.095 });
  // curved 30-round magazine (or the fitted extended / drum magazine)
  if (!bigMag(o)) curvedMag(b, 1);
  // buffer tube + adjustable stock with cheek riser and rubber butt pad
  b.tube('metal', 0.015, 0.015, 0.2, -0.045, 0.05, K.black, 0, 10);
  b.add('poly', prof(smooth([[-0.13, 0.035], [-0.13, 0.08, 0.01], [-0.31, 0.088, 0.012], [-0.33, 0.07], [-0.33, -0.065, 0.01], [-0.3, -0.07], [-0.2, 0.0], [-0.15, 0.02]]), 0.036, 0.004), K.tan, {});
  b.add('rubber', box(0.04, 0.155, 0.018), K.rubber, { y: 0.01, z: 0.335 });
  b.add('metal', box(0.04, 0.008, 0.008), K.steel, { y: -0.035, z: 0.24 });           // sling loop
  return b;
};

W.smg = (o) => {
  const b = new B(), y = 0.055;
  b.add('metal', prof([[-0.08, 0.02], [0.24, 0.02], [0.24, 0.085], [0.18, 0.09], [-0.05, 0.09], [-0.08, 0.07]], 0.042, 0.004), K.gun, {});
  b.add('metal', box(0.002, 0.02, 0.05), K.black, { x: 0.022, y: 0.065, z: -0.07 });
  for (let i = 0; i < 6; i++) b.add('metal', box(0.044, 0.004, 0.004), K.black, { y: 0.07, z: 0.03 - i * 0.008 }); // grip serrations
  b.rail(0.05, -0.2, 0.091, 0.02);
  // barrel shroud with cooling holes + suppressor-style muzzle
  b.tube('metal', 0.022, 0.022, -0.24, -0.34, y, K.black, 0, 10);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.add('metal', cyl(0.005, 0.005, 0.004, 6), K.rubber, { x: s * 0.021, y, z: -0.25 - i * 0.018, rz: Math.PI / 2 });
  b.tube('metal', 0.009, 0.009, -0.34, -0.37, y, K.blued, 0, 10);
  // straight double-stack magazine in the grip area front
  if (!bigMag(o)) straightMag(b, -0.095, 0.02, 0.15, 0.047);
  pistolGrip(b, 'poly', K.polyB, 0.03, 0.02, 0.22, 0.11, 0.032);
  triggerGuard(b, -0.065, 0.005, 0.02);
  // folding wire stock
  for (const s of [-1, 1]) b.add('metal', box(0.006, 0.006, 0.24), K.steel, { x: s * 0.018, y: 0.05, z: 0.19 });
  b.add('metal', box(0.042, 0.006, 0.006), K.steel, { y: 0.05, z: 0.07 });
  b.add('rubber', box(0.046, 0.1, 0.014), K.rubber, { y: 0.01, z: 0.31 });
  b.add('metal', box(0.006, 0.07, 0.006), K.steel, { x: 0.018, y: 0.015, z: 0.305 }); b.add('metal', box(0.006, 0.07, 0.006), K.steel, { x: -0.018, y: 0.015, z: 0.305 });
  b.add('metal', box(0.006, 0.016, 0.006), K.black, { y: 0.1, z: -0.19 }); // front post
  return b;
};

W.pistol = (o) => {
  const b = new B();
  // slide with rear + front serrations, ejection port, sights
  b.add('metal', prof([[-0.02, 0.045], [0.19, 0.045], [0.19, 0.072, 0.004], [0.17, 0.08], [-0.008, 0.08], [-0.02, 0.07]].map((p) => p.slice(0, p.length)), 0.03, 0.003), K.gun, {});
  for (let i = 0; i < 6; i++) b.add('metal', box(0.032, 0.026, 0.002), K.black, { y: 0.064, z: 0.008 - i * 0.005 });
  for (let i = 0; i < 4; i++) b.add('metal', box(0.032, 0.022, 0.002), K.black, { y: 0.066, z: -0.155 - i * 0.005 });
  b.add('metal', box(0.002, 0.014, 0.04), K.black, { x: 0.0155, y: 0.07, z: -0.06 });
  b.add('bright', box(0.008, 0.016, 0.03), K.chrome, { x: 0.006, y: 0.068, z: -0.06 }); // barrel hood visible in port
  b.add('metal', box(0.02, 0.008, 0.008), K.black, { y: 0.085, z: 0.01 }); b.add('glowG', box(0.003, 0.003, 0.002), 0xffffff, { x: 0.006, y: 0.087, z: 0.006 }); b.add('glowG', box(0.003, 0.003, 0.002), 0xffffff, { x: -0.006, y: 0.087, z: 0.006 });
  b.add('metal', box(0.005, 0.009, 0.006), K.black, { y: 0.084, z: -0.175 }); b.add('glowG', box(0.003, 0.003, 0.002), 0xffffff, { y: 0.087, z: -0.172 });
  b.tube('metal', 0.0065, 0.0065, -0.19, -0.195, 0.062, K.rubber, 0, 8);
  // polymer frame with accessory rail and trigger guard
  b.add('poly', prof([[-0.012, 0.045], [0.17, 0.045], [0.17, 0.022], [0.06, 0.018], [0.035, 0.0], [-0.01, 0.0]], 0.028, 0.003), K.polyB, {});
  b.rail(-0.08, -0.155, 0.024, 0.018, K.polyB);
  triggerGuard(b, -0.07, -0.005, 0.02, K.polyB);
  pistolGrip(b, 'poly', K.polyB, 0.0, 0.004, 0.25, 0.115, 0.03);
  if (!bigMag(o)) b.add('metal', box(0.03, 0.01, 0.042), K.black, { y: -0.115, z: 0.012, rx: -0.25 }); // mag base
  b.add('metal', box(0.004, 0.008, 0.012), K.black, { x: 0.016, y: 0.035, z: -0.03 }); // slide stop
  return b;
};

W.revolver = () => {
  const b = new B(), y = 0.065;
  b.add('bright', prof(smooth([[-0.035, 0.03], [0.05, 0.03], [0.05, 0.088], [0.012, 0.095, 0.01], [-0.03, 0.088], [-0.04, 0.06]]), 0.028, 0.003), K.steel, {});
  // fluted 6-shot cylinder
  b.add('bright', cyl(0.03, 0.03, 0.048, 12), K.steel, { y, z: -0.045 + 0.01, rx: Math.PI / 2 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26; b.add('metal', box(0.008, 0.008, 0.036), K.blued, { x: Math.cos(a) * 0.029, y: y + Math.sin(a) * 0.029, z: -0.035, rz: a }); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add('bright', cyl(0.0055, 0.0055, 0.003, 8), K.brass, { x: Math.cos(a) * 0.017, y: y + Math.sin(a) * 0.017, z: -0.011, rx: Math.PI / 2 }); }
  // barrel with full-length rib and ejector shroud, ramp front sight
  b.tube('bright', 0.012, 0.011, -0.07, -0.24, y + 0.004, K.steel, 0, 12);
  b.add('bright', box(0.012, 0.01, 0.17), K.steel, { y: y + 0.017, z: -0.155 });
  b.add('bright', box(0.016, 0.014, 0.15), K.steel, { y: y - 0.014, z: -0.15 });
  b.add('metal', prof([[0, 0], [0.012, 0], [0.002, 0.012], [0, 0.012]], 0.004, 0.0005), K.red, { y: y + 0.022, z: -0.225 });
  b.tube('metal', 0.006, 0.006, -0.24, -0.244, y + 0.004, K.rubber, 0, 8);
  // hammer, trigger, guard, rear notch
  b.add('bright', prof([[0, 0], [0.01, 0], [-0.008, 0.035], [-0.022, 0.038], [-0.014, 0.028]], 0.01, 0.001), K.steel, { y: 0.075, z: 0.035 });
  triggerGuard(b, -0.04, 0.02, 0.032, K.steel);
  // wood grip with checkering
  b.add('wood', prof(smooth([[0.02, 0.035], [-0.03, 0.035], [-0.07, -0.08, 0.012], [-0.03, -0.09, 0.012], [0.0, -0.06], [0.018, 0.0]]), 0.034, 0.005), K.wood, { z: 0.01 });
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.add('wood', box(0.002, 0.004, 0.03), K.woodD, { x: s * 0.0175, y: -0.012 - i * 0.012, z: 0.03 + i * 0.006, rx: 0.35 });
  b.screw(0.018, -0.02, 0.035, 0.004);
  return b;
};

W.shotgun = () => {
  const b = new B(), y = 0.065;
  // receiver with loading port + bead sight rib
  b.add('metal', prof(smooth([[-0.02, 0.025], [0.2, 0.025], [0.2, 0.085, 0.006], [0.0, 0.09, 0.012], [-0.02, 0.07]]), 0.04, 0.003), K.blued, {});
  b.add('metal', box(0.002, 0.016, 0.09), K.black, { x: 0.021, y: 0.06, z: -0.1 });
  b.add('metal', box(0.03, 0.004, 0.06), K.black, { y: 0.028, z: -0.12 }); // loading port
  b.add('bright', cyl(0.004, 0.004, 0.004, 6), K.steel, { x: 0.021, y: 0.04, z: -0.03, rz: Math.PI / 2 });
  // barrel + vent rib + magazine tube + bead
  b.tube('metal', 0.0125, 0.0125, -0.2, -0.75, y + 0.012, K.blued, 0, 12);
  b.add('metal', box(0.008, 0.005, 0.55), K.black, { y: y + 0.027, z: -0.475 });
  for (let i = 0; i < 12; i++) b.add('metal', box(0.006, 0.006, 0.004), K.black, { y: y + 0.022, z: -0.22 - i * 0.045 });
  b.add('bright', new THREE.SphereGeometry(0.003, 6, 4), K.chrome, { y: y + 0.033, z: -0.745 });
  b.tube('metal', 0.0115, 0.0115, -0.2, -0.68, y - 0.016, K.blued, 0, 12);
  b.tube('metal', 0.012, 0.012, -0.68, -0.7, y - 0.016, K.black, 0, 10);
  b.add('metal', box(0.012, 0.02, 0.014), K.black, { y: y - 0.002, z: -0.66 });
  // ribbed wooden pump forend
  b.add('wood', prof(smooth([[0.27, 0.035], [0.48, 0.035], [0.48, 0.0, 0.01], [0.27, -0.004, 0.01]]), 0.046, 0.006), K.woodL, { y: 0.0 });
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) b.add('wood', box(0.003, 0.03, 0.006), K.woodD, { x: s * 0.0235, y: 0.016, z: -0.29 - i * 0.021 });
  b.add('metal', box(0.03, 0.006, 0.08), K.black, { y: y - 0.008, z: -0.24 }); // action bar
  // stock with pistol grip and recoil pad
  b.add('wood', prof(smooth([[0.0, 0.082], [-0.16, 0.074, 0.03], [-0.41, 0.062], [-0.41, -0.088], [-0.14, -0.034, 0.04], [-0.05, -0.01, 0.02], [0.0, 0.025]]), 0.042, 0.007), K.wood, {});
  b.add('rubber', prof([[-0.41, 0.064], [-0.43, 0.064], [-0.43, -0.09], [-0.41, -0.09]], 0.044, 0.002), K.rubber, {});
  triggerGuard(b, -0.06, 0.02, 0.025);
  b.add('bright', cyl(0.0045, 0.0045, 0.006, 8), K.steel, { y: -0.02, z: 0.33 }); // sling stud
  return b;
};

W.double_barrel = () => {
  const b = new B(), y = 0.07;
  for (const s of [-1, 1]) { b.tube('metal', 0.0135, 0.0125, -0.1, -0.68, y, K.blued, s * 0.0135, 12); b.tube('metal', 0.006, 0.006, -0.68, -0.683, y, K.rubber, s * 0.0135, 8); }
  b.add('metal', box(0.012, 0.006, 0.58), K.black, { y: y + 0.014, z: -0.39 });
  b.add('bright', new THREE.SphereGeometry(0.0035, 6, 4), K.brass, { y: y + 0.02, z: -0.675 });
  // engraved steel action with hinge pin and top lever
  b.add('bright', prof(smooth([[-0.04, 0.04], [0.12, 0.04], [0.12, 0.088], [0.03, 0.092, 0.01], [-0.04, 0.085]]), 0.05, 0.003), K.chrome, {});
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.add('metal', tor(0.008 + i * 0.003, 0.0006, Math.PI * 0.8, 10), K.blued, { x: s * 0.0255, y: 0.064, z: -0.04 - i * 0.012, ry: Math.PI / 2 });
  b.add('bright', cyl(0.007, 0.007, 0.052, 10), K.steel, { y: 0.05, z: -0.12, rz: Math.PI / 2 });
  b.add('bright', prof([[0, 0], [0.04, 0], [0.04, 0.008], [0.005, 0.012]], 0.012, 0.001), K.steel, { y: 0.09, z: 0.01, ry: -0.3 });
  // splinter forend + stock with straight grip
  b.add('wood', prof(smooth([[0.1, 0.06], [0.36, 0.06], [0.37, 0.035, 0.008], [0.1, 0.03]]), 0.05, 0.006), K.woodL, {});
  b.add('wood', prof(smooth([[-0.04, 0.086], [-0.2, 0.08, 0.03], [-0.43, 0.07], [-0.43, -0.082], [-0.16, -0.026, 0.04], [-0.06, 0.012, 0.02], [-0.04, 0.04]]), 0.044, 0.007), K.wood, {});
  b.add('rubber', prof([[-0.43, 0.072], [-0.446, 0.072], [-0.446, -0.084], [-0.43, -0.084]], 0.046, 0.002), K.rubber, {});
  triggerGuard(b, -0.06, 0.02, 0.04, K.chrome);
  b.add('bright', prof([[0, 0], [0.004, 0], [0.006, -0.018], [0.0, -0.022]], 0.006, 0.001), K.steel, { y: 0.036, z: 0.0 }); // second trigger
  return b;
};

W.bolt_rifle = (o) => {
  const b = new B(), y = 0.06;
  // walnut stock: forend, grip, cheek piece, recoil pad
  b.add('wood', prof(smooth([[0.6, 0.052], [0.62, 0.03, 0.012], [0.4, 0.016], [0.12, 0.004], [0.04, -0.004], [-0.06, -0.05, 0.03], [-0.13, -0.045, 0.03], [-0.4, -0.088], [-0.4, 0.074], [-0.15, 0.084, 0.03], [-0.04, 0.05, 0.02], [0.12, 0.052]]), 0.046, 0.007), K.wood, {});
  b.add('wood', prof(smooth([[-0.12, 0.084], [-0.33, 0.094, 0.02], [-0.34, 0.07], [-0.12, 0.07]]), 0.03, 0.006), K.woodL, { x: 0.01 }); // cheek riser
  b.add('rubber', prof([[-0.4, 0.076], [-0.422, 0.076], [-0.422, -0.09], [-0.4, -0.09]], 0.048, 0.002), K.rubber, {});
  // receiver, bolt with knob, barrel, muzzle brake
  b.tube('metal', 0.017, 0.017, 0.06, -0.15, y + 0.01, K.blued, 0, 14);
  b.add('bright', cyl(0.004, 0.004, 0.065, 8), K.steel, { x: 0.035, y: y + 0.005, z: 0.03, rz: Math.PI / 2 - 0.25 });
  b.add('metal', new THREE.SphereGeometry(0.0095, 8, 6), K.black, { x: 0.068, y: y - 0.003, z: 0.03 });
  b.tube('bright', 0.015, 0.015, 0.085, 0.06, y + 0.01, K.steel, 0, 12);
  b.tube('metal', 0.012, 0.0085, -0.15, -0.86, y + 0.01, K.blued, 0, 12);
  // iron sights (an optic replaces them)
  if (!o.mods?.optic) { b.add('metal', box(0.02, 0.016, 0.01), K.black, { y: y + 0.027, z: -0.16 }); b.add('metal', box(0.004, 0.02, 0.006), K.black, { y: y + 0.024, z: -0.84 }); b.add('metal', box(0.018, 0.008, 0.02), K.black, { y: y + 0.014, z: -0.84 }); }
  triggerGuard(b, -0.06, 0.02, 0.0, K.blued);
  b.add('metal', box(0.03, 0.006, 0.09), K.blued, { y: -0.004, z: -0.07 }); // floor plate
  b.add('bright', cyl(0.0045, 0.0045, 0.006, 8), K.steel, { y: -0.075, z: 0.3 }); b.add('bright', cyl(0.0045, 0.0045, 0.006, 8), K.steel, { y: 0.02, z: -0.5 });
  return b;
};

W.lmg = (o) => {
  const b = new B(), y = 0.06;
  b.add('metal', prof([[-0.08, 0.015], [0.3, 0.015], [0.3, 0.1], [-0.06, 0.1], [-0.08, 0.08]], 0.064, 0.004), K.gun, {});
  b.add('metal', prof([[-0.04, 0.1], [0.24, 0.1], [0.22, 0.12], [-0.02, 0.12]], 0.06, 0.003), K.black, {}); // feed cover
  b.rail(0.02, -0.22, 0.121, 0.024);
  for (let i = 0; i < 5; i++) b.screw(0.033, 0.05, -0.02 - i * 0.06, 0.004);
  // ammo box with belt feeding in
  if (!bigMag(o)) { b.add('poly', prof(smooth([[0.04, 0.015], [0.21, 0.015], [0.21, -0.11, 0.01], [0.04, -0.11, 0.01]]), 0.1, 0.005), K.olive, { x: -0.02 }); b.add('metal', box(0.102, 0.012, 0.17), K.black, { x: -0.02, y: -0.04, z: -0.125 }); }
  for (let i = 0; i < 5; i++) b.add('bright', cyl(0.004, 0.004, 0.03, 6), K.brass, { x: 0.04 + i * 0.006, y: 0.03 + i * 0.012, z: -0.12, rz: Math.PI / 2 });
  // perforated heat shield, heavy barrel, flash hider, carry handle, bipod
  b.tube('metal', 0.028, 0.028, -0.3, -0.58, y, K.black, 0, 10);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.add('metal', box(0.006, 0.012, 0.022), K.rubber, { x: s * 0.027, y: y + 0.006, z: -0.32 - i * 0.042 });
  b.tube('metal', 0.012, 0.012, -0.58, -0.72, y, K.blued, 0, 10);
  if (!o.mods?.muzzle) b.tube('metal', 0.015, 0.014, -0.72, -0.76, y, K.black, 0, 6); // bare flash hider
  b.add('metal', prof([[0, 0], [0.012, 0], [0.03, 0.05], [0.13, 0.05], [0.15, 0], [0.162, 0], [0.14, 0.062], [0.02, 0.062]], 0.014, 0.002), K.black, { y: 0.1, z: -0.33 });
  pistolGrip(b, 'poly', K.polyB, 0.04, 0.016, 0.3, 0.115, 0.034);
  triggerGuard(b, -0.06, 0.02, 0.016);
  b.add('poly', prof(smooth([[-0.08, 0.09], [-0.36, 0.08, 0.012], [-0.38, -0.07, 0.01], [-0.3, -0.07], [-0.14, 0.0], [-0.08, 0.02]]), 0.05, 0.005), K.polyB, {});
  b.add('rubber', box(0.052, 0.15, 0.018), K.rubber, { y: 0.005, z: 0.385 });
  return b;
};

W.rocket_launcher = () => {
  const b = new B(), y = 0.085;
  b.tube('poly', 0.055, 0.055, 0.32, -0.7, y, K.olive, 0, 16);
  for (const z of [0.18, -0.05, -0.3, -0.55]) b.tube('metal', 0.058, 0.058, z, z - 0.025, y, K.black, 0, 16);
  b.tube('poly', 0.07, 0.058, 0.44, 0.32, y, K.black, 0, 16);        // rear venturi flare
  b.tube('poly', 0.058, 0.068, -0.7, -0.78, y, K.black, 0, 16);      // muzzle
  b.add('metal', tor(0.05, 0.004, Math.PI * 2, 16), K.steel, { y, z: 0.441 });
  // warhead peeking out
  b.add('poly', cyl(0.045, 0.045, 0.05, 12), K.olive, { y, z: -0.8, rx: Math.PI / 2 });
  b.add('poly', new THREE.ConeGeometry(0.045, 0.14, 12), K.olive, { y, z: -0.895, rx: -Math.PI / 2 });
  b.add('metal', cyl(0.008, 0.008, 0.03, 6), K.brass, { y, z: -0.975, rx: Math.PI / 2 });
  // grips, trigger, iron sight, shoulder pad, warning stripes
  pistolGrip(b, 'poly', K.polyB, -0.02, 0.025, 0.15, 0.11, 0.032);
  triggerGuard(b, -0.08, -0.02, 0.025);
  b.add('poly', prof(smooth([[0, 0], [0.04, 0], [0.04, -0.09, 0.01], [0, -0.09, 0.01]]), 0.03, 0.004), K.polyB, { y: 0.03, z: -0.32 });
  b.add('metal', box(0.012, 0.05, 0.1), K.black, { x: 0.06, y: y + 0.03, z: -0.12 });
  b.add('metal', prof([[0, 0], [0.04, 0], [0.04, 0.035], [0.028, 0.035], [0.028, 0.012], [0.012, 0.012], [0.012, 0.035], [0, 0.035]], 0.012, 0.001), K.black, { x: 0.066, y: y + 0.052, z: -0.1 });
  b.add('glass', new THREE.PlaneGeometry(0.014, 0.02), 0xffffff, { x: 0.066, y: y + 0.075, z: -0.12 });
  b.add('rubber', box(0.08, 0.035, 0.14), K.rubber, { y: y - 0.06, z: 0.16 });
  for (const z of [-0.62, -0.66]) b.tube('poly', 0.0565, 0.0565, z, z - 0.012, y, K.orange, 0, 16);
  return b;
};

W.crossbow = (o) => {
  const b = new B(), y = 0.05;
  b.add('wood', prof(smooth([[-0.5, 0.06], [0.12, 0.065], [0.18, 0.03, 0.01], [0.26, -0.06, 0.01], [0.34, -0.07, 0.01], [0.36, 0.06, 0.01], [0.2, 0.08], [0.12, 0.08], [0.04, 0.0], [-0.04, -0.1, 0.012], [-0.08, -0.1, 0.012], [-0.06, 0.03], [-0.5, 0.03]]).map(([u, v]) => [-u, v]), 0.045, 0.006), K.wood, {});
  b.add('metal', box(0.012, 0.006, 0.55), K.steel, { y: 0.067, z: -0.22 }); // flight groove rail
  // recurve limbs (tubes along curves) with metal riser and foot stirrup
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.12, 0, 0.03), new THREE.Vector3(s * 0.24, 0, 0.09), new THREE.Vector3(s * 0.29, 0, 0.07)];
    b.add('poly', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.011, 6, false), K.black, { y: y + 0.01, z: -0.46 });
    b.add('bright', cyl(0.012, 0.012, 0.012, 8), K.steel, { x: s * 0.285, y: y + 0.01, z: -0.39 });
  }
  b.add('metal', box(0.09, 0.03, 0.05), K.blued, { y: y + 0.01, z: -0.47 });
  b.add('metal', tor(0.05, 0.006, Math.PI, 12), K.blued, { y: y - 0.01, z: -0.53, rx: Math.PI / 2, rz: Math.PI });
  // string, latch, loaded bolt with fletching, scope
  for (const s of [-1, 1]) b.add('poly', cyl(0.0015, 0.0015, Math.hypot(0.285, 0.19), 3), 0xe8e0c8, { x: s * 0.142, y: 0.068, z: -0.29, rz: Math.PI / 2, ry: s * 0.59 });
  b.add('metal', box(0.03, 0.02, 0.03), K.blued, { y: 0.068, z: -0.2 });
  b.add('wood', cyl(0.004, 0.004, 0.42, 6), K.woodL, { y: 0.075, z: -0.38, rx: Math.PI / 2 });
  b.add('bright', new THREE.ConeGeometry(0.008, 0.04, 4), K.steel, { y: 0.075, z: -0.61, rx: -Math.PI / 2 });
  for (const a of [0, 2.1, 4.2]) b.add('poly', box(0.001, 0.014, 0.04), K.red, { x: Math.cos(a) * 0.006, y: 0.075 + Math.sin(a) * 0.006, z: -0.19, rz: a });
  b.rail(-0.02, -0.12, 0.082, 0.02);
  b.add('metal', prof([[0, 0], [0.004, 0], [0.006, -0.02], [0, -0.024]], 0.006, 0.001), K.steel, { y: 0.0, z: 0.03 });
  return b;
};

W.bow = () => {
  // recurve bow held vertically, string toward the player (+z)
  const b = new B();
  const half = (s) => [new THREE.Vector3(0, s * 0.06, 0), new THREE.Vector3(0, s * 0.22, -0.05), new THREE.Vector3(0, s * 0.38, -0.06), new THREE.Vector3(0, s * 0.47, -0.02), new THREE.Vector3(0, s * 0.5, -0.05)];
  for (const s of [-1, 1]) {
    b.add('wood', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(half(s)), 16, 0.014, 6, false), K.wood);
    b.add('wood', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(half(s).map((v) => v.clone().add(new THREE.Vector3(0, 0, 0.006)))), 16, 0.009, 5, false), K.woodL, { x: 0.006 });
    b.add('bright', new THREE.SphereGeometry(0.007, 6, 4), K.brass, { y: s * 0.47, z: -0.02 });
  }
  b.add('wood', cyl(0.022, 0.022, 0.13, 8), K.woodD, {});
  for (let i = 0; i < 7; i++) b.add('poly', tor(0.023, 0.003, Math.PI * 2, 8), K.rubber, { y: -0.05 + i * 0.016, rx: Math.PI / 2 }); // grip wrap
  b.add('bright', box(0.014, 0.012, 0.02), K.brass, { x: -0.022, y: 0.07, z: 0.0 }); // arrow rest
  b.add('poly', cyl(0.0012, 0.0012, 0.98, 3), 0xf0ead8, { z: 0.02, y: 0.0 }); // string
  return b;
};

// ---- melee
W.machete = () => {
  const b = new B();
  b.add('bright', prof(smooth([[0.06, 0.0], [0.4, -0.012], [0.46, 0.012, 0.02], [0.48, 0.05, 0.015], [0.38, 0.056], [0.06, 0.04]]).map(([u, v]) => [v - 0.02, u]), 0.006, 0.0015), K.steel, {});
  b.add('metal', box(0.007, 0.36, 0.008), K.blued, { y: 0.25, z: 0.022 });
  b.add('poly', prof(smooth([[0, 0], [0.04, 0.0], [0.045, 0.11, 0.01], [-0.005, 0.12, 0.01], [-0.008, 0.06]]).map(([u, v]) => [u - 0.02, v - 0.06]), 0.032, 0.006), K.polyB, {});
  for (let i = 0; i < 3; i++) b.screw(0.017, -0.03 + i * 0.035, 0.0, 0.004);
  return b;
};
W.sword = () => {
  const b = new B();
  b.add('bright', prof([[-0.025, 0.09], [0.025, 0.09], [0.022, 0.72], [0, 0.8], [-0.022, 0.72]].map(([u, v]) => [u, v]), 0.008, 0.002), K.chrome, {});
  b.add('metal', box(0.012, 0.55, 0.009), K.steel, { y: 0.4 });
  b.add('bright', prof(smooth([[-0.1, 0.07], [0.1, 0.07], [0.11, 0.09, 0.01], [-0.11, 0.09, 0.01]]), 0.03, 0.003), K.brass, {});
  b.add('poly', cyl(0.016, 0.016, 0.14, 8), K.woodD, {});
  for (let i = 0; i < 6; i++) b.add('poly', tor(0.017, 0.002, Math.PI * 2, 8), K.brass, { y: -0.06 + i * 0.024, rx: Math.PI / 2 });
  b.add('bright', new THREE.IcosahedronGeometry(0.028, 0), K.brass, { y: -0.085 });
  return b;
};
W.battle_axe = () => {
  const b = new B();
  b.add('wood', cyl(0.019, 0.024, 0.78, 8), K.woodD, { y: 0.2 });
  for (let i = 0; i < 5; i++) b.add('poly', tor(0.024, 0.003, Math.PI * 2, 8), K.rubber, { y: -0.12 + i * 0.03, rx: Math.PI / 2 });
  for (const s of [-1, 1]) b.add('bright', prof(smooth([[0.02, -0.04], [0.14, -0.1, 0.02], [0.17, 0.0], [0.14, 0.1, 0.02], [0.02, 0.04]]).map(([u, v]) => [s * u, v]), 0.012, 0.002), K.steel, { y: 0.52 });
  b.add('metal', box(0.05, 0.11, 0.05), K.blued, { y: 0.52 });
  b.add('bright', new THREE.ConeGeometry(0.02, 0.09, 6), K.steel, { y: 0.62 });
  for (let i = 0; i < 2; i++) b.screw(0.027, 0.5 + i * 0.04, 0.0, 0.005);
  return b;
};
W.wooden_spear = () => {
  const b = new B();
  b.add('wood', cyl(0.017, 0.021, 1.5, 8), K.wood, { y: 0.4 });
  b.add('bright', prof(smooth([[-0.02, 0.0], [0.03, 0.08, 0.02], [0.0, 0.22], [-0.03, 0.08, 0.02]].map(([u, v]) => [u, v])).map(([u, v]) => [u - 0.0, v]), 0.008, 0.002), K.steel, { y: 1.13 });
  for (let i = 0; i < 4; i++) b.add('poly', tor(0.02, 0.004, Math.PI * 2, 8), 0xb89a62, { y: 1.08 + i * 0.012, rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) b.add('poly', tor(0.021, 0.004, Math.PI * 2, 8), K.woodD, { y: 0.05 + i * 0.014, rx: Math.PI / 2 });
  return b;
};

// Where attachments go on each weapon (model space).
//  optic: top of rail/receiver; rail: does the gun already have a rail there; muzzle: end of the bare barrel;
//  under: bottom of the handguard; mag: magazine kind + position; stock: butt position
const MOUNTS = {
  rifle: { optic: [0.087, -0.08], rail: true, muzzle: [0.055, -0.64, 0.0095], under: [0.025, -0.36], mag: { kind: 'curved' }, stock: [0.088, 0.22] },
  smg: { optic: [0.099, -0.07], rail: true, muzzle: [0.055, -0.37, 0.009], under: [0.035, -0.17], mag: { kind: 'straight', z: -0.095, top: 0.02, len: 0.15, d: 0.047 }, stock: [0.06, 0.28] },
  pistol: { optic: [0.08, -0.045], muzzle: [0.062, -0.195, 0.0065], under: [0.018, -0.12], mag: { kind: 'pistol' } },
  revolver: { optic: [0.088, -0.14], muzzle: [0.069, -0.244, 0.011], under: [0.04, -0.17] },
  shotgun: { optic: [0.092, -0.09], muzzle: [0.077, -0.75, 0.0125], under: [0.035, -0.6], mag: { kind: 'tube' }, stock: [0.08, 0.3] },
  double_barrel: { muzzle: [0.07, -0.68, 0.013, true] },
  bolt_rifle: { optic: [0.088, -0.05], muzzle: [0.07, -0.86, 0.0085], under: [0.01, -0.45], mag: { kind: 'box', z: -0.07, top: 0.0, len: 0.07, d: 0.07 } },
  lmg: { optic: [0.13, -0.09], rail: true, muzzle: [0.06, -0.72, 0.012], under: [0.025, -0.62], mag: { kind: 'lmg' } },
  crossbow: { optic: [0.09, -0.07], rail: true },
  rocket_launcher: { optic: [0.16, -0.16] },
};
function fit(b, id, mods) {
  const M = MOUNTS[id];
  if (!M || !mods) return;
  // ---- optics
  if (mods.optic && M.optic) {
    const [y, z] = M.optic;
    if (!M.rail) b.rail(z + 0.05, z - 0.07, y - 0.008, 0.02);
    if (mods.optic === 'red_dot') redDot(b, z, y - 0.004);
    else if (mods.optic === 'holo') {
      b.add('metal', box(0.032, 0.012, 0.07), K.black, { y: y + 0.006, z });
      b.add('metal', prof([[0, 0], [0.07, 0], [0.07, 0.05], [0.055, 0.05], [0.055, 0.008], [0.015, 0.008], [0.015, 0.05], [0, 0.05]], 0.038, 0.002), K.black, { y: y + 0.012, z: z + 0.035 });
      b.add('glass', new THREE.PlaneGeometry(0.032, 0.034), 0xffffff, { y: y + 0.036, z: z - 0.002 });
      b.add('glow', tor(0.005, 0.0008, Math.PI * 2, 10), 0xffffff, { y: y + 0.036, z: z - 0.004 });
      b.add('metal', box(0.012, 0.012, 0.02), K.black, { x: 0.024, y: y + 0.02, z: z + 0.02 });
    } else {
      const big = mods.optic === 'scope8', r = big ? 0.02 : 0.016, h = y + (big ? 0.045 : 0.035);
      scope(b, z + (big ? 0.12 : 0.09), z - (big ? 0.24 : 0.14), h, r);
      if (big) { b.tube('rubber', r * 1.7, r * 1.7, z - 0.24, z - 0.3, h, K.rubber, 0, 16); }  // sunshade
    }
  }
  // ---- barrel
  let mz = M.muzzle ? M.muzzle[1] : 0;
  if (M.muzzle && mods.barrel) {
    const [y, z, r, dbl] = M.muzzle;
    const xs = dbl ? [-0.0135, 0.0135] : [0];
    if (mods.barrel === 'long_barrel') { for (const x of xs) b.tube('metal', r, r * 0.95, z, z - 0.16, y, K.blued, x, 10); b.tube('metal', r * 1.4, r * 1.4, z + 0.005, z - 0.012, y, K.black, 0, 10); mz = z - 0.16; }
    else if (mods.barrel === 'heavy_barrel') {
      b.tube('metal', r * 1.55, r * 1.45, z + 0.13, z, y, K.blued, 0, 12);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.add('metal', box(0.003, 0.003, 0.12), K.rubber, { x: Math.cos(a) * r * 1.5, y: y + Math.sin(a) * r * 1.5, z: z + 0.065 }); }
    }
  }
  // ---- muzzle devices
  if (M.muzzle && mods.muzzle) {
    const [y, , r] = M.muzzle, z = mz;
    if (mods.muzzle === 'suppressor') {
      b.tube('metal', r * 1.3, r * 1.3, z + 0.01, z - 0.012, y, K.black, 0, 10);
      b.tube('metal', 0.021, 0.021, z - 0.012, z - 0.19, y, K.black, 0, 14);
      for (let k = 0; k < 3; k++) b.tube('metal', 0.0215, 0.0215, z - 0.04 - k * 0.05, z - 0.046 - k * 0.05, y, K.gun, 0, 14);
      b.tube('metal', 0.006, 0.006, z - 0.19, z - 0.192, y, K.rubber, 0, 8);
    } else if (mods.muzzle === 'muzzle_brake') muzzleBrake(b, z, y, r * 1.35, 0.055);
    else {
      b.tube('metal', r * 1.3, r * 1.3, z, z - 0.05, y, K.black, 0, 8);
      for (let k = 0; k < 3; k++) b.add('metal', box(0.006, 0.004, 0.008), K.rubber, { y: y + r * 1.25, z: z - 0.012 - k * 0.012 });
    }
  } else if (M.muzzle && !mods.muzzle && mods.barrel === 'long_barrel') b.tube('metal', M.muzzle[2] * 1.2, M.muzzle[2] * 1.2, mz, mz - 0.01, M.muzzle[0], K.black, 0, 8);
  // ---- underbarrel
  if (M.under && mods.under) {
    const [y, z] = M.under;
    if (mods.under === 'vertical_grip') { b.add('poly', prof(smooth([[0, 0], [0.04, 0], [0.04, -0.08, 0.01], [0.002, -0.085, 0.01]]), 0.028, 0.004), K.polyB, { y, z: z + 0.02 }); for (let k = 0; k < 4; k++) b.add('poly', box(0.03, 0.004, 0.044), K.black, { y: y - 0.02 - k * 0.016, z: z + 0.0 }); }
    else if (mods.under === 'angled_grip') b.add('poly', prof([[0, 0], [0.065, 0], [0.055, -0.045], [0.018, -0.05]], 0.026, 0.004), K.polyB, { y, z: z + 0.03 });
    else if (mods.under === 'laser') { b.add('metal', box(0.026, 0.024, 0.07), K.black, { y: y - 0.012, z }); b.add('glow', cyl(0.004, 0.004, 0.002, 8), 0xffffff, { y: y - 0.008, z: z - 0.036, rx: Math.PI / 2 }); b.add('metal', cyl(0.006, 0.006, 0.01, 8), K.steel, { x: 0.014, y: y - 0.012, z: z + 0.01, rz: Math.PI / 2 }); }
    else if (mods.under === 'flashlight') { b.add('metal', box(0.018, 0.012, 0.03), K.black, { y: y - 0.006, z }); b.tube('metal', 0.016, 0.018, z + 0.035, z - 0.05, y - 0.028, K.black, 0, 12); b.add('glass', new THREE.CircleGeometry(0.016, 12), 0xffffff, { y: y - 0.028, z: z - 0.051, ry: Math.PI }); b.add('metal', tor(0.017, 0.002, Math.PI * 2, 12), K.steel, { y: y - 0.028, z: z - 0.05 }); }
    else if (mods.under === 'bipod') {
      b.add('metal', box(0.04, 0.02, 0.035), K.black, { y: y - 0.01, z });
      for (const sx of [-1, 1]) { b.add('metal', cyl(0.005, 0.005, 0.2, 6), K.steel, { x: sx * 0.022, y: y - 0.022, z: z + 0.1, rx: Math.PI / 2 - 0.12, rz: sx * 0.08 }); b.add('rubber', cyl(0.008, 0.008, 0.02, 6), K.rubber, { x: sx * 0.022, y: y - 0.035, z: z + 0.2, rx: Math.PI / 2 }); }
    }
  }
  // ---- magazines
  if (M.mag && mods.mag) {
    const k = M.mag.kind, m = mods.mag;
    if (k === 'curved') { if (m === 'ext_mag') curvedMag(b, 1.5); else if (m === 'drum_mag') drumMag(b, -0.15, -0.1, 0.075); else { /* quick-pull tab + tape */ b.add('poly', tor(0.012, 0.003, Math.PI, 8), K.red, { y: -0.225, z: -0.2 }); for (const yy of [-0.08, -0.15]) b.add('poly', box(0.03, 0.01, 0.06), K.black, { y: yy, z: -0.14 + yy * 0.25, rx: -0.3 }); } }
    else if (k === 'straight') { const mg = M.mag; if (m === 'ext_mag') straightMag(b, mg.z, mg.top, mg.len * 1.6, mg.d); else if (m === 'drum_mag') { b.add('poly', box(0.026, 0.04, mg.d), K.polyB, { y: mg.top - 0.02, z: mg.z }); drumMag(b, mg.z, mg.top - 0.1, 0.065); } else b.add('poly', tor(0.012, 0.003, Math.PI, 8), K.red, { y: mg.top - mg.len - 0.016, z: mg.z }); }
    else if (k === 'pistol') { if (m === 'ext_mag') { b.add('poly', prof([[-0.058, -0.106], [-0.014, -0.106], [-0.026, -0.178], [-0.07, -0.178]], 0.028, 0.003), K.polyB, {}); b.add('metal', box(0.03, 0.012, 0.048), K.black, { y: -0.184, z: 0.048, rx: -0.2 }); } else b.add('poly', tor(0.01, 0.0025, Math.PI, 8), K.red, { y: -0.125, z: 0.012 }); }
    else if (k === 'box') { const mg = M.mag; straightMag(b, mg.z, mg.top, m === 'ext_mag' ? mg.len * 1.8 : mg.len, mg.d, K.blued); if (m === 'fast_mag') b.add('poly', tor(0.01, 0.0025, Math.PI, 8), K.red, { y: mg.top - mg.len - 0.016, z: mg.z }); }
    else if (k === 'tube' && m === 'ext_mag') { b.tube('metal', 0.0115, 0.0115, -0.68, -0.74, 0.049, K.blued, 0, 12); b.add('metal', box(0.012, 0.03, 0.014), K.black, { y: 0.063, z: -0.73 }); }
    else if (k === 'lmg') { if (m === 'drum_mag') drumMag(b, -0.12, -0.06, 0.085); else { b.add('poly', prof(smooth([[0.04, 0.015], [0.21, 0.015], [0.21, -0.11, 0.01], [0.04, -0.11, 0.01]]), 0.1, 0.005), K.olive, { x: -0.02 }); b.add('poly', tor(0.014, 0.003, Math.PI, 8), K.red, { x: -0.02, y: -0.125, z: -0.12 }); } }
  }
  // ---- stock
  if (M.stock && mods.stock === 'tac_stock') {
    const [y, z] = M.stock;
    b.add('poly', prof(smooth([[0, 0], [-0.12, 0.004, 0.01], [-0.12, 0.022], [0, 0.02]]).map(([u, v]) => [u - z, v + y]), 0.034, 0.004), K.polyB, {});  // cheek riser
    b.add('rubber', box(0.046, 0.17, 0.03), K.rubber, { y: y - 0.075, z: z + 0.125 });
    for (let k = 0; k < 4; k++) b.add('rubber', box(0.048, 0.006, 0.032), K.black, { y: y - 0.02 - k * 0.035, z: z + 0.125 });
  }
}
// finishes: rebuild with a swapped palette
function withFinish(fid, fn) {
  const f = FINISHES.find((x) => x.id === fid);
  if (!f || f.id === 'factory') return fn();
  const saved = { ...K };
  if (f.poly) { K.polyB = f.poly; K.polyG = new THREE.Color(f.poly).multiplyScalar(1.25).getHex(); }
  if (f.tan) K.tan = f.tan;
  if (f.olive) K.olive = f.olive;
  if (f.metal) { K.gun = f.metal; K.blued = new THREE.Color(f.metal).multiplyScalar(0.85).getHex(); K.black = new THREE.Color(f.metal).multiplyScalar(0.7).getHex(); MATS.metal = MATS.bright; }
  try { return fn(); } finally { Object.assign(K, saved); MATS.metal = METAL; }
}
const METAL = MATS.metal;

export function hasWeaponModel(id) { return !!W[id]; }
const cache = new Map();
export function makeWeaponModel(id, mods = null) {
  const key = id + '|' + modsKey(mods);
  if (!cache.has(key)) cache.set(key, withFinish(mods?.finish, () => { const b = W[id]({ mods: mods || {} }); fit(b, id, mods); return b.build(); }));
  return cache.get(key).clone();
}
// Attachments on their own (inventory icons, dropped items): shown fitted to a ghost-free mount
export function hasModModel(id) { return !!MODS[id]; }
export function makeModModel(id) {
  const key = 'mod|' + id;
  if (!cache.has(key)) {
    const b = new B();
    const slot = MODS[id].slot;
    // reuse the rifle mounts but draw only the attachment itself
    fit(b, 'rifle', { [slot]: id });
    if (slot === 'mag' && id === 'fast_mag') curvedMag(b, 1);
    if (slot === 'barrel') b.tube('metal', 0.0095, 0.009, -0.52, -0.64, 0.055, K.blued, 0, 10);
    if (slot === 'stock') b.add('poly', prof(smooth([[-0.13, 0.035], [-0.13, 0.08, 0.01], [-0.31, 0.088, 0.012], [-0.33, 0.07], [-0.33, -0.065, 0.01], [-0.3, -0.07], [-0.2, 0.0], [-0.15, 0.02]]), 0.036, 0.004), K.polyB, {});
    const g = b.build();
    // centre it
    const bb = new THREE.Box3().setFromObject(g), c = bb.getCenter(new THREE.Vector3());
    g.children.forEach((m) => m.position.sub(c));
    cache.set(key, g);
  }
  return cache.get(key).clone();
}
