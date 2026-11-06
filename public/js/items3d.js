// Detailed low-poly 3D models for every item. Tools point along +Y (handle at the origin),
// guns point along -Z (grip at the origin). Used for viewmodels, third-person, dropped items and icons.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ITEMS } from '/shared/items.js';
import { MAT, part, merge, deployGeometry } from './models.js';
import { hasWeaponModel, makeWeaponModel, hasModModel, makeModModel } from './guns3d.js';

const C = {
  wood: 0x8a5a32, dwood: 0x5e3c22, lwood: 0xb08050, metal: 0xaab0b6, dmetal: 0x3c3f44, black: 0x1f2022, steel: 0x7d848b,
  stone: 0x8e8a84, leather: 0x6b4426, cloth: 0xc8b48a, rope: 0xb89a62, brass: 0xc8a040, red: 0xb02a20, olive: 0x4f5a34, rubber: 0x222222,
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rb = (w, h, d, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
const cyl = (rt, rb_, h, s = 10) => new THREE.CylinderGeometry(rt, rb_, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const tor = (r, t, arc = Math.PI * 2, s = 16) => new THREE.TorusGeometry(r, t, 6, s, arc);
function jit(geo, amt, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.99 + y * 78.23 + z * 37.72 + seed) * 43758.55;
    const s = 1 + (h - Math.floor(h) - 0.5) * amt;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  return geo;
}
const rock = (r, seed) => jit(new THREE.DodecahedronGeometry(r, 1), 0.35, seed);
function helix(r, len, turns, t) {
  const pts = [];
  for (let i = 0; i <= turns * 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, (i / (turns * 16)) * len - len / 2, Math.sin(a) * r)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 16, t, 5, false);
}
function gear(r, th, teeth, color, t = {}) {
  const parts = [part(cyl(r * 0.82, r * 0.82, th, 16), color, { ...t, rx: Math.PI / 2 })];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    parts.push(part(box(r * 0.28, r * 0.28, th), color, { x: (t.x || 0) + Math.cos(a) * r * 0.9, y: (t.y || 0) + Math.sin(a) * r * 0.9, z: t.z || 0, rz: a }));
  }
  parts.push(part(cyl(r * 0.25, r * 0.25, th * 1.2, 10), 0x555555, { ...t, rx: Math.PI / 2 }));
  return parts;
}
const cartridge = (r, len, x, z, tip = C.brass, caseC = C.brass) => [part(cyl(r, r, len, 10), caseC, { x, y: len / 2, z }), part(cone(r, len * 0.45, 10), tip, { x, y: len + len * 0.22, z })];

// returns an array of parts
function build(id) {
  const d = ITEMS[id];
  const P = part;
  switch (id) {
    // ---------------- resources
    case 'wood': return [[-0.07, 0.07], [0.07, 0.07], [0, 0.19]].flatMap(([x, y]) => [P(cyl(0.07, 0.07, 0.42, 9), C.wood, { x, y, rx: Math.PI / 2 }, 0.1), P(cyl(0.06, 0.06, 0.425, 9), C.lwood, { x, y, rx: Math.PI / 2 })]);
    case 'stone': return [P(rock(0.11, 1), C.stone, { y: 0.08 }, 0.1), P(rock(0.08, 2), 0x9a968f, { x: 0.13, y: 0.06, z: 0.05 }, 0.1), P(rock(0.07, 3), 0x7f7b76, { x: -0.1, y: 0.05, z: 0.08 }, 0.1)];
    case 'metal_ore': case 'sulfur_ore': {
      const oc = id === 'metal_ore' ? 0xc0703a : 0xe0d040;
      return [P(rock(0.13, 4), 0x6e6560, { y: 0.1 }, 0.1), ...[0, 1, 2, 3].map((i) => P(new THREE.OctahedronGeometry(0.045, 0), oc, { x: Math.cos(i * 1.7) * 0.1, y: 0.13 + (i % 2) * 0.05, z: Math.sin(i * 1.7) * 0.1, sy: 1.6, rz: i }))];
    }
    case 'metal_frags': return [0, 1, 2, 3, 4].map((i) => P(box(0.1 + (i % 2) * 0.04, 0.015, 0.07), i % 2 ? C.metal : C.steel, { x: Math.cos(i * 2.3) * 0.06, y: 0.01 + i * 0.016, z: Math.sin(i * 2.3) * 0.06, ry: i * 1.1, rx: (i - 2) * 0.15 }));
    case 'sulfur': return [P(cone(0.14, 0.12, 10), 0xe0d040, { y: 0.06 }, 0.1), P(new THREE.OctahedronGeometry(0.04, 0), 0xf0e060, { x: 0.08, y: 0.03, sy: 1.5 })];
    case 'charcoal': return [0, 1, 2, 3].map((i) => P(rock(0.05, 10 + i), 0x1c1c1c, { x: Math.cos(i * 1.6) * 0.07, y: 0.04 + (i === 3 ? 0.05 : 0), z: Math.sin(i * 1.6) * 0.07 }, 0.2));
    case 'hqm': return [P(rb(0.22, 0.06, 0.1, 0.012), 0x8fb0c8, { y: 0.03 }), P(rb(0.18, 0.02, 0.07, 0.006), 0xb8d0e0, { y: 0.065 })];
    case 'cloth': return [P(cyl(0.06, 0.06, 0.26, 12), C.cloth, { y: 0.06, rz: Math.PI / 2 }, 0.05), P(cyl(0.062, 0.062, 0.03, 12), C.rope, { y: 0.06, x: 0.07, rz: Math.PI / 2 }), P(cyl(0.062, 0.062, 0.03, 12), C.rope, { y: 0.06, x: -0.07, rz: Math.PI / 2 }), P(box(0.12, 0.004, 0.1), C.cloth, { x: 0.18, y: 0.003 })];
    case 'leather': return [P(jit(box(0.26, 0.03, 0.2), 0.15, 5), C.leather, { y: 0.015 }), P(jit(box(0.22, 0.02, 0.17), 0.15, 6), 0x7a5232, { y: 0.04, ry: 0.3 })];
    case 'animal_fat': return [P(ico(0.08, 1), 0xe8d8a0, { y: 0.07, sy: 0.75 }, 0.08), P(box(0.17, 0.005, 0.17), 0xc8b48a, { y: 0.004, ry: 0.4 })];
    case 'bone': return [0.3, -0.4].flatMap((a, i) => [P(cyl(0.018, 0.018, 0.26, 7), 0xeee6d0, { y: 0.03 + i * 0.03, rz: Math.PI / 2, ry: a }), ...[-1, 1].map((sx) => P(ico(0.03, 1), 0xeee6d0, { x: Math.cos(a) * sx * 0.13, y: 0.03 + i * 0.03, z: -Math.sin(a) * sx * 0.13 }))]);
    case 'scrap': return [...gear(0.06, 0.02, 8, 0x8a7a6a, { y: 0.03, x: -0.05 }), P(box(0.12, 0.012, 0.08), 0x6a5a4a, { x: 0.06, y: 0.02, ry: 0.5 }), P(cyl(0.012, 0.012, 0.1, 6), C.steel, { x: 0.03, y: 0.05, z: 0.05, rz: 1.2 }), P(cyl(0.022, 0.022, 0.012, 6), C.steel, { x: 0.02, y: 0.06, z: -0.06 })];
    case 'gunpowder': return [P(ico(0.08, 1), 0x9a8a6a, { y: 0.07, sy: 1.0 }, 0.05), P(cyl(0.035, 0.05, 0.05, 8), 0x7a6a4a, { y: 0.15 }), P(cone(0.06, 0.04, 10), 0x2a2a2a, { y: 0.17 })];
    case 'fuel': return [P(rb(0.18, 0.24, 0.08, 0.015), C.red, { y: 0.12 }), P(box(0.06, 0.03, 0.03), 0x7a1a14, { x: -0.03, y: 0.25 }), P(cyl(0.015, 0.02, 0.05, 8), 0x333333, { x: 0.06, y: 0.26, rz: -0.4 }), P(box(0.12, 0.008, 0.085), 0x7a1a14, { y: 0.12 })];
    // ---------------- components
    case 'rope': return [P(tor(0.07, 0.018, Math.PI * 2, 18), C.rope, { y: 0.02, rx: Math.PI / 2 }), P(tor(0.055, 0.018, Math.PI * 2, 18), C.rope, { y: 0.05, rx: Math.PI / 2 }), P(cyl(0.012, 0.012, 0.12, 5), C.rope, { x: 0.08, y: 0.02, rz: 1.4 })];
    case 'spring': return [P(helix(0.035, 0.16, 6, 0.008), C.steel, { y: 0.08 })];
    case 'pipe': return [P(cyl(0.03, 0.03, 0.3, 12), 0x8a8f94, { y: 0.03, rz: Math.PI / 2 }), P(cyl(0.036, 0.036, 0.04, 12), 0x6a6f74, { x: 0.13, y: 0.03, rz: Math.PI / 2 })];
    case 'gears': return [...gear(0.07, 0.025, 10, 0x9a9070, { y: 0.07 }), ...gear(0.045, 0.025, 8, 0x8a8070, { x: 0.1, y: 0.04, z: 0.03 })];
    case 'tech_trash': return [P(box(0.18, 0.012, 0.12), 0x2a6a3a, { y: 0.006 }), P(box(0.04, 0.012, 0.04), 0x111111, { x: -0.04, y: 0.016 }), P(box(0.05, 0.01, 0.025), 0x111111, { x: 0.04, y: 0.016, z: 0.02 }), P(box(0.02, 0.02, 0.02), C.brass, { x: 0.06, y: 0.02, z: -0.04 }), P(cyl(0.012, 0.012, 0.03, 8), 0x2a4aa0, { x: -0.06, y: 0.025, z: 0.04 })];
    case 'explosives': return [...[-1, 0, 1].map((i) => P(cyl(0.025, 0.025, 0.2, 10), 0xc03020, { x: i * 0.05, y: 0.025, rx: Math.PI / 2 })), P(box(0.16, 0.055, 0.03), 0x333333, { y: 0.025 }), P(cyl(0.004, 0.004, 0.1, 4), 0xdddddd, { y: 0.05, z: 0.12, rx: 1 })];
    case 'wheel': return [P(tor(0.09, 0.04, Math.PI * 2, 18), C.rubber, { y: 0.09 }), P(cyl(0.06, 0.06, 0.06, 14), C.metal, { y: 0.09, rx: Math.PI / 2 }), P(cyl(0.02, 0.02, 0.07, 8), 0x555555, { y: 0.09, rx: Math.PI / 2 })];
    case 'engine_parts': return [P(rb(0.16, 0.1, 0.1, 0.01), 0x5a5e62, { y: 0.05 }), ...[-0.05, 0, 0.05].map((x) => P(cyl(0.02, 0.02, 0.06, 8), 0x8a8e92, { x, y: 0.12 })), P(cyl(0.035, 0.035, 0.015, 12), 0x333333, { x: -0.09, y: 0.05, rz: Math.PI / 2 }), P(box(0.12, 0.015, 0.05), 0x2a2a2a, { y: 0.155 })];
    // ---------------- food & medical
    case 'berries': return [...[0, 1, 2, 3, 4, 5, 6].map((i) => P(ico(0.025, 1), i % 3 ? 0x3a48b0 : 0x5a2a8a, { x: Math.cos(i * 1.3) * 0.04, y: 0.03 + (i % 2) * 0.03, z: Math.sin(i * 1.3) * 0.04 })), P(box(0.06, 0.004, 0.03), 0x3a7a2a, { y: 0.08, ry: 0.5 })];
    case 'raw_meat': case 'cooked_meat': {
      const c = id === 'raw_meat' ? 0xb03838 : 0x7a4422, f = id === 'raw_meat' ? 0xf0d0c0 : 0xb08050;
      return [P(jit(ico(0.1, 1), 0.2, 8), c, { y: 0.04, sy: 0.35, sx: 1.2 }, 0.08), P(cyl(0.012, 0.012, 0.12, 6), 0xeee6d0, { x: 0.14, y: 0.03, rz: Math.PI / 2 }), P(tor(0.09, 0.012, Math.PI, 10), f, { y: 0.045, rx: Math.PI / 2, sx: 1.2 })];
    }
    case 'water_bottle': {
      const prof = [[0, 0], [0.04, 0], [0.042, 0.01], [0.042, 0.15], [0.03, 0.19], [0.016, 0.21], [0.016, 0.23], [0, 0.23]].map(([x, y]) => new THREE.Vector2(x, y));
      return [P(new THREE.LatheGeometry(prof, 12), 0x7ab8e0), P(cyl(0.018, 0.018, 0.02, 10), 0x2a5aa0, { y: 0.24 }), P(cyl(0.043, 0.043, 0.06, 12), 0xe8e8e8, { y: 0.09 })];
    }
    case 'bandage': return [P(cyl(0.045, 0.045, 0.07, 14), 0xf2f0e8, { y: 0.035 }), P(cyl(0.015, 0.015, 0.072, 10), 0xd0ccc0, { y: 0.035 }), P(box(0.06, 0.002, 0.07), 0xf2f0e8, { x: 0.07, y: 0.001 })];
    case 'medkit': return [P(rb(0.22, 0.14, 0.08, 0.015), 0xe8e8e8, { y: 0.07 }), P(box(0.1, 0.03, 0.005), 0xd02020, { y: 0.07, z: 0.042 }), P(box(0.03, 0.1, 0.005), 0xd02020, { y: 0.07, z: 0.042 }), P(tor(0.03, 0.006, Math.PI, 8), 0x333333, { y: 0.14 })];
    // ---------------- tools
    case 'rock': return [P(rock(0.1, 3), C.stone, { y: 0.02 }, 0.12)];
    case 'torch': return [P(cyl(0.022, 0.028, 0.55, 8), C.dwood, { y: 0.14 }), P(cyl(0.045, 0.035, 0.12, 8), 0x9a8a6a, { y: 0.42 }, 0.1), P(tor(0.04, 0.008, Math.PI * 2, 10), C.rope, { y: 0.38, rx: Math.PI / 2 })];
    case 'stone_hatchet': return [P(cyl(0.02, 0.025, 0.56, 8), C.wood, { y: 0.12 }), P(rock(0.05, 7), C.stone, { y: 0.36, z: -0.05, sz: 1.6, sx: 0.6 }), P(tor(0.026, 0.009, Math.PI * 2, 10), C.rope, { y: 0.34, rx: Math.PI / 2 }), P(tor(0.026, 0.009, Math.PI * 2, 10), C.rope, { y: 0.38, rx: Math.PI / 2 })];
    case 'stone_pickaxe': return [P(cyl(0.02, 0.025, 0.6, 8), C.wood, { y: 0.12 }), P(cone(0.035, 0.22, 6), C.stone, { y: 0.4, z: -0.11, rx: -Math.PI / 2 }), P(cone(0.035, 0.22, 6), C.stone, { y: 0.4, z: 0.11, rx: Math.PI / 2 }), P(tor(0.026, 0.009, Math.PI * 2, 10), C.rope, { y: 0.4, rx: Math.PI / 2 })];
    case 'metal_hatchet': return [P(cyl(0.02, 0.025, 0.58, 8), C.dwood, { y: 0.12 }), P(rb(0.022, 0.08, 0.1, 0.006), C.metal, { y: 0.37, z: -0.04 }), P(box(0.012, 0.13, 0.04), 0xd0d4d8, { y: 0.37, z: -0.1 }), P(rb(0.03, 0.05, 0.04, 0.006), C.dmetal, { y: 0.37, z: 0.02 }), P(cyl(0.024, 0.024, 0.12, 8), C.black, { y: -0.08 })];
    case 'metal_pickaxe': return [P(cyl(0.02, 0.025, 0.62, 8), C.dwood, { y: 0.12 }), P(rb(0.04, 0.05, 0.08, 0.008), C.dmetal, { y: 0.42 }), P(cone(0.03, 0.22, 6), C.metal, { y: 0.42, z: -0.14, rx: -Math.PI / 2 - 0.15 }), P(box(0.05, 0.025, 0.16), C.metal, { y: 0.42, z: 0.11, rx: 0.15 }), P(cyl(0.024, 0.024, 0.12, 8), C.black, { y: -0.08 })];
    case 'hammer': return [P(cyl(0.018, 0.022, 0.42, 8), C.wood, { y: 0.06 }), P(rb(0.05, 0.05, 0.12, 0.008), C.dmetal, { y: 0.29, z: -0.02 }), P(cyl(0.028, 0.028, 0.03, 10), C.metal, { y: 0.29, z: -0.09, rx: Math.PI / 2 }), P(box(0.02, 0.03, 0.08), C.dmetal, { y: 0.3, z: 0.07, rx: -0.4 }), P(cyl(0.022, 0.022, 0.1, 8), C.red, { y: -0.08 })];
    case 'shovel': return [P(cyl(0.018, 0.022, 0.75, 8), C.wood, { y: 0.17 }), P(rb(0.14, 0.035, 0.035, 0.01), C.black, { y: -0.22 }), P(rb(0.16, 0.2, 0.015, 0.006), C.steel, { y: 0.63, rx: 0.15 }), P(cone(0.08, 0.06, 4), C.steel, { y: 0.75, rx: 0.15, ry: Math.PI / 4, sz: 0.2 })];
    case 'steel_shovel': return [P(cyl(0.017, 0.02, 0.78, 8), C.steel, { y: 0.18 }), P(rb(0.13, 0.03, 0.03, 0.01), C.rubber, { y: -0.2 }), P(cyl(0.022, 0.022, 0.16, 8), C.rubber, { y: -0.12 }), P(rb(0.19, 0.24, 0.016, 0.006), 0x9aa4ad, { y: 0.68, rx: 0.15 }), P(cone(0.1, 0.07, 4), 0x9aa4ad, { y: 0.83, rx: 0.15, ry: Math.PI / 4, sz: 0.2 }), P(box(0.2, 0.02, 0.03), 0x6e767e, { y: 0.56, z: -0.01 })];
    case 'power_drill': return [
      P(rb(0.05, 0.16, 0.06, 0.012), 0xe0a020, { y: 0.02 }), P(rb(0.09, 0.05, 0.1, 0.01), C.dmetal, { y: -0.08 }), P(box(0.07, 0.012, 0.08), 0x3ac870, { y: -0.05 }),
      P(rb(0.07, 0.08, 0.22, 0.02), 0xe0a020, { y: 0.14, z: -0.05 }), P(cyl(0.035, 0.035, 0.03, 12), C.dmetal, { y: 0.14, z: 0.075, rx: Math.PI / 2 }),
      P(box(0.012, 0.03, 0.02), C.black, { y: 0.08, z: -0.035 }),
      P(cyl(0.026, 0.02, 0.06, 10), C.dmetal, { y: 0.14, z: -0.19, rx: Math.PI / 2 }), P(cyl(0.008, 0.004, 0.16, 6), 0xd0d4d8, { y: 0.14, z: -0.3, rx: Math.PI / 2 }), P(helix(0.009, 0.12, 4, 0.003), 0xd0d4d8, { y: 0.14, z: -0.3, rx: Math.PI / 2 })];
    case 'spray_can': return [P(cyl(0.035, 0.035, 0.17, 14), 0xd8342a, { y: 0.085 }), P(cyl(0.036, 0.036, 0.035, 14), 0xe8e8e8, { y: 0.1 }), P(cyl(0.036, 0.03, 0.02, 14), 0xb8bcc0, { y: 0.18 }), P(cyl(0.016, 0.016, 0.03, 10), 0xf2f2f2, { y: 0.2 }), P(box(0.012, 0.012, 0.02), 0x222222, { y: 0.212, z: -0.014 }), P(tor(0.036, 0.004, Math.PI * 2, 14), 0x8a1c16, { y: 0.004, rx: Math.PI / 2 })];
    case 'building_plan': return [P(box(0.24, 0.006, 0.3), 0x2f5f9a, {}), P(box(0.25, 0.01, 0.04), 0x6a4a2a, { z: -0.15, y: 0.004 }), ...[0, 1, 2].map((i) => P(box(0.18, 0.008, 0.004), 0xe8f0ff, { y: 0.004, z: -0.06 + i * 0.06 })), P(box(0.004, 0.008, 0.2), 0xe8f0ff, { x: 0.05, y: 0.004 })];
    // ---------------- melee weapons
    case 'wooden_spear': return [P(cyl(0.018, 0.022, 1.55, 8), C.wood, { y: 0.35 }), P(cone(0.024, 0.16, 6), C.lwood, { y: 1.2 }), P(tor(0.021, 0.007, Math.PI * 2, 8), C.rope, { y: 1.08, rx: Math.PI / 2 }), P(tor(0.021, 0.007, Math.PI * 2, 8), C.leather, { y: 0.1, rx: Math.PI / 2 })];
    case 'machete': return [P(rb(0.03, 0.12, 0.035, 0.008), C.black, {}), P(box(0.006, 0.42, 0.06), 0xc8ccd0, { y: 0.27, z: -0.008 }), P(box(0.008, 0.38, 0.012), 0x8a8f94, { y: 0.25, z: 0.02 }), P(box(0.04, 0.012, 0.05), C.dmetal, { y: 0.065 })];
    case 'sword': return [P(cyl(0.017, 0.017, 0.14, 8), C.leather, {}), P(ico(0.025, 0), C.brass, { y: -0.08 }), P(rb(0.16, 0.025, 0.03, 0.008), C.brass, { y: 0.08 }), P(box(0.05, 0.62, 0.008), 0xd0d4d8, { y: 0.4 }), P(cone(0.025, 0.08, 4), 0xd0d4d8, { y: 0.75, sz: 0.2 }), P(box(0.01, 0.55, 0.01), 0x9aa0a6, { y: 0.38 })];
    case 'battle_axe': return [P(cyl(0.02, 0.025, 0.75, 8), C.dwood, { y: 0.2 }), ...[-1, 1].map((s) => P(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 12, 1, false, s > 0 ? 0 : Math.PI, Math.PI), d.tint || C.metal, { y: 0.52, z: s * 0.025, rx: Math.PI / 2 })), P(rb(0.05, 0.09, 0.07, 0.01), C.dmetal, { y: 0.52 }), P(cone(0.02, 0.08, 6), C.dmetal, { y: 0.62 }), P(tor(0.024, 0.007, Math.PI * 2, 8), C.leather, { y: 0.0, rx: Math.PI / 2 })];
    // ---------------- ranged
    case 'bow': return [P(tor(0.38, 0.016, Math.PI * 0.85, 18), C.wood, { rz: Math.PI * 0.575 }), P(cyl(0.022, 0.022, 0.12, 8), C.leather, { x: -0.38 }), P(box(0.003, 0.7, 0.003), 0xeeeeee, { x: -0.1 })];
    case 'crossbow': return [P(rb(0.04, 0.05, 0.55, 0.01), C.wood, { y: 0.03, z: -0.12 }), P(rb(0.035, 0.12, 0.08, 0.01), C.dwood, { y: -0.04, z: 0.06, rx: -0.3 }), P(tor(0.25, 0.012, Math.PI * 0.7, 14), C.dmetal, { y: 0.04, z: -0.42, rx: -Math.PI / 2, rz: Math.PI * 0.15 + Math.PI / 2 }), P(box(0.48, 0.003, 0.003), 0xdddddd, { y: 0.05, z: -0.3 }), P(cyl(0.006, 0.006, 0.4, 5), C.lwood, { y: 0.065, z: -0.3, rx: Math.PI / 2 }), P(cone(0.012, 0.04, 4), C.steel, { y: 0.065, z: -0.52, rx: -Math.PI / 2 })];
    case 'revolver': return [P(rb(0.035, 0.06, 0.14, 0.01), C.dmetal, { y: 0.05, z: -0.02 }), P(cyl(0.012, 0.012, 0.16, 10), C.black, { y: 0.065, z: -0.16, rx: Math.PI / 2 }), P(cyl(0.032, 0.032, 0.05, 6), C.steel, { y: 0.05, z: -0.05, rx: Math.PI / 2 }), P(rb(0.032, 0.11, 0.045, 0.012), C.wood, { y: -0.03, z: 0.05, rx: -0.3 }), P(box(0.008, 0.02, 0.008), C.black, { y: 0.09, z: -0.23 }), P(box(0.01, 0.025, 0.02), C.black, { y: 0.085, z: 0.04 })];
    case 'pistol': return [P(rb(0.034, 0.045, 0.19, 0.008), C.dmetal, { y: 0.07, z: -0.07 }), P(rb(0.032, 0.03, 0.17, 0.006), C.black, { y: 0.035, z: -0.06 }), P(rb(0.032, 0.12, 0.05, 0.01), C.black, { y: -0.02, z: 0.02, rx: -0.2 }), P(tor(0.022, 0.005, Math.PI, 8), C.black, { y: 0.02, z: -0.03, ry: Math.PI / 2 }), ...[0, 1, 2, 3].map((i) => P(box(0.036, 0.03, 0.004), 0x555555, { y: 0.07, z: 0.0 + i * 0.008 }))];
    case 'shotgun': return [P(cyl(0.016, 0.016, 0.7, 10), C.black, { y: 0.07, z: -0.38, rx: Math.PI / 2 }), P(cyl(0.013, 0.013, 0.5, 8), C.dmetal, { y: 0.04, z: -0.32, rx: Math.PI / 2 }), P(rb(0.04, 0.04, 0.16, 0.01), C.wood, { y: 0.04, z: -0.38 }), P(rb(0.045, 0.07, 0.2, 0.01), C.dmetal, { y: 0.05, z: -0.02 }), P(rb(0.04, 0.09, 0.3, 0.015), C.wood, { y: 0.02, z: 0.22, rx: 0.12 }), P(rb(0.03, 0.08, 0.04, 0.01), C.wood, { y: -0.03, z: 0.06, rx: -0.3 })];
    case 'double_barrel': return [...[-1, 1].map((s) => P(cyl(0.016, 0.016, 0.6, 10), C.dmetal, { x: s * 0.017, y: 0.06, z: -0.35, rx: Math.PI / 2 })), P(rb(0.06, 0.03, 0.35, 0.008), C.wood, { y: 0.035, z: -0.25 }), P(rb(0.05, 0.07, 0.12, 0.01), C.steel, { y: 0.045, z: -0.02 }), P(rb(0.042, 0.1, 0.32, 0.015), C.wood, { y: 0.0, z: 0.2, rx: 0.15 }), P(box(0.008, 0.02, 0.03), C.black, { y: 0.09, z: 0.0 })];
    case 'smg': return [P(rb(0.045, 0.07, 0.3, 0.01), C.dmetal, { y: 0.05, z: -0.08 }), P(cyl(0.022, 0.022, 0.18, 10), C.black, { y: 0.055, z: -0.3, rx: Math.PI / 2 }), P(rb(0.03, 0.16, 0.04, 0.008), C.black, { y: -0.06, z: -0.12 }), P(rb(0.032, 0.1, 0.045, 0.01), C.black, { y: -0.03, z: 0.03, rx: -0.25 }), P(box(0.01, 0.06, 0.18), C.steel, { x: 0.02, y: 0.05, z: 0.17 }), P(box(0.01, 0.06, 0.18), C.steel, { x: -0.02, y: 0.05, z: 0.17 }), P(box(0.05, 0.08, 0.015), C.black, { y: 0.04, z: 0.26 }), P(box(0.012, 0.02, 0.02), C.black, { y: 0.095, z: -0.2 })];
    case 'rifle': return [P(rb(0.045, 0.075, 0.24, 0.01), 0x3a3a35, { y: 0.05, z: -0.06 }), P(rb(0.05, 0.06, 0.24, 0.015), C.black, { y: 0.05, z: -0.3 }), P(cyl(0.012, 0.012, 0.2, 8), C.black, { y: 0.055, z: -0.5, rx: Math.PI / 2 }), P(box(0.02, 0.025, 0.04), C.black, { y: 0.055, z: -0.61 }), P(rb(0.035, 0.17, 0.065, 0.012), C.black, { y: -0.07, z: -0.12, rx: 0.25 }), P(rb(0.032, 0.1, 0.045, 0.01), C.black, { y: -0.03, z: 0.04, rx: -0.3 }), P(rb(0.04, 0.09, 0.24, 0.015), C.olive, { y: 0.03, z: 0.25 }), P(rb(0.03, 0.035, 0.12, 0.006), C.black, { y: 0.11, z: -0.06 }), P(box(0.012, 0.04, 0.01), C.black, { y: 0.1, z: -0.4 })];
    case 'bolt_rifle': return [P(rb(0.045, 0.06, 0.75, 0.015), C.wood, { y: 0.02, z: -0.08 }), P(rb(0.04, 0.09, 0.22, 0.02), C.wood, { y: 0.0, z: 0.25, rx: 0.12 }), P(cyl(0.012, 0.014, 0.5, 8), C.black, { y: 0.06, z: -0.62, rx: Math.PI / 2 }), P(rb(0.04, 0.05, 0.2, 0.008), C.dmetal, { y: 0.06, z: -0.05 }), P(cyl(0.022, 0.022, 0.26, 12), C.black, { y: 0.12, z: -0.06, rx: Math.PI / 2 }), P(cyl(0.028, 0.022, 0.05, 12), C.black, { y: 0.12, z: -0.2, rx: Math.PI / 2 }), P(cyl(0.026, 0.022, 0.04, 12), C.black, { y: 0.12, z: 0.08, rx: Math.PI / 2 }), P(cyl(0.02, 0.02, 0.004, 12), 0x3a6a9a, { y: 0.12, z: 0.1, rx: Math.PI / 2 }), P(cyl(0.007, 0.007, 0.06, 6), C.steel, { x: 0.04, y: 0.06, z: 0.02, rz: Math.PI / 2 }), P(ico(0.012, 0), C.steel, { x: 0.07, y: 0.06, z: 0.02 })];
    case 'lmg': return [P(rb(0.06, 0.09, 0.3, 0.012), C.dmetal, { y: 0.05, z: -0.05 }), P(cyl(0.03, 0.03, 0.35, 10), C.black, { y: 0.06, z: -0.38, rx: Math.PI / 2 }), P(cyl(0.013, 0.013, 0.16, 8), C.black, { y: 0.06, z: -0.62, rx: Math.PI / 2 }), P(rb(0.1, 0.1, 0.1, 0.015), C.olive, { x: 0.0, y: -0.04, z: -0.08 }), P(rb(0.035, 0.1, 0.045, 0.01), C.black, { y: -0.03, z: 0.06, rx: -0.3 }), P(rb(0.045, 0.08, 0.25, 0.015), C.black, { y: 0.03, z: 0.25 }), P(cyl(0.006, 0.006, 0.18, 5), C.steel, { x: 0.03, y: -0.02, z: -0.5, rx: 0.5 }), P(cyl(0.006, 0.006, 0.18, 5), C.steel, { x: -0.03, y: -0.02, z: -0.5, rx: 0.5 }), P(box(0.07, 0.015, 0.08), C.dmetal, { y: 0.1, z: -0.04 })];
    case 'rocket_launcher': return [P(cyl(0.055, 0.055, 1.0, 14), C.olive, { y: 0.08, z: -0.2, rx: Math.PI / 2 }), P(cyl(0.065, 0.065, 0.08, 14), C.black, { y: 0.08, z: -0.7, rx: Math.PI / 2 }), P(cyl(0.065, 0.06, 0.12, 14), C.black, { y: 0.08, z: 0.3, rx: Math.PI / 2 }), P(rb(0.035, 0.1, 0.045, 0.01), C.black, { y: -0.01, z: -0.05, rx: -0.2 }), P(rb(0.035, 0.1, 0.045, 0.01), C.black, { y: -0.01, z: -0.35 }), P(rb(0.03, 0.06, 0.08, 0.008), C.black, { x: 0.065, y: 0.12, z: -0.2 }), P(cone(0.045, 0.1, 10), 0x7a8a5a, { y: 0.08, z: -0.78, rx: -Math.PI / 2 })];
    // ---------------- ammo
    case 'arrow': return [P(cyl(0.006, 0.006, 0.6, 5), C.lwood, { y: 0.3 }), P(cone(0.015, 0.05, 4), C.steel, { y: 0.62 }), ...[0, 1, 2].map((i) => P(box(0.002, 0.07, 0.025), 0xd04030, { y: 0.05, ry: (i / 3) * Math.PI * 2, x: Math.cos((i / 3) * Math.PI * 2) * 0.008, z: Math.sin((i / 3) * Math.PI * 2) * 0.008 }))];
    case 'pistol_ammo': return [[-0.025, 0], [0.025, 0], [0, 0.03]].flatMap(([x, z]) => cartridge(0.011, 0.03, x, z, 0x8a6a3a));
    case 'rifle_ammo': return [[-0.022, 0], [0.022, 0], [0, 0.03]].flatMap(([x, z]) => cartridge(0.01, 0.06, x, z, 0xb88a40));
    case 'shells': return [[-0.026, 0], [0.026, 0], [0, 0.04]].flatMap(([x, z]) => [P(cyl(0.017, 0.017, 0.06, 10), 0xb02a20, { x, y: 0.04, z }), P(cyl(0.018, 0.018, 0.018, 10), C.brass, { x, y: 0.009, z })]);
    case 'rocket': return [P(cyl(0.035, 0.035, 0.36, 12), 0x5a6a3a, { y: 0.18 }), P(cone(0.035, 0.12, 12), 0x7a8a5a, { y: 0.42 }), ...[0, 1, 2, 3].map((i) => P(box(0.004, 0.08, 0.05), C.dmetal, { y: 0.04, ry: (i * Math.PI) / 2, x: Math.cos((i * Math.PI) / 2) * 0.04, z: -Math.sin((i * Math.PI) / 2) * 0.04 }))];
    // ---------------- explosives
    case 'satchel': return [P(rb(0.22, 0.15, 0.1, 0.03), 0x6a5a3a, { y: 0.075 }, 0.05), P(rb(0.2, 0.06, 0.104, 0.02), 0x5a4a2a, { y: 0.13 }), P(tor(0.08, 0.008, Math.PI, 10), C.leather, { y: 0.15 }), P(cyl(0.004, 0.004, 0.1, 4), 0xdddddd, { x: 0.08, y: 0.18, rz: 0.6 })];
    case 'c4': return [P(rb(0.22, 0.07, 0.14, 0.01), 0xa8a070, { y: 0.035 }), P(rb(0.09, 0.03, 0.06, 0.006), C.black, { y: 0.085 }), P(box(0.06, 0.004, 0.035), 0x2aff60, { y: 0.1 }), P(box(0.012, 0.012, 0.012), 0xff2020, { x: 0.035, y: 0.1, z: -0.02 }), ...[-0.06, 0.06].map((x) => P(box(0.01, 0.075, 0.15), 0x333333, { x, y: 0.035 })), P(tor(0.04, 0.004, Math.PI, 8), 0xd02020, { x: -0.08, y: 0.08, rx: Math.PI / 2 })];
    case 'grenade': return [P(jit(ico(0.04, 1), 0.08, 3), 0x4a5a30, { y: 0.045, sy: 1.2 }), P(cyl(0.015, 0.018, 0.025, 8), C.dmetal, { y: 0.1 }), P(box(0.012, 0.06, 0.01), C.steel, { x: 0.02, y: 0.08, rz: -0.2 }), P(tor(0.012, 0.003, Math.PI * 2, 8), C.steel, { x: -0.02, y: 0.11 })];
    // ---------------- armour
    case 'cloth_hood': case 'leather_hat': case 'metal_mask': {
      const c = d.armor.color;
      if (id === 'metal_mask') return [P(rb(0.2, 0.24, 0.2, 0.05), c, { y: 0.12 }), P(box(0.14, 0.022, 0.01), C.black, { y: 0.14, z: -0.1 }), ...[-1, 1].map((s) => P(cyl(0.008, 0.008, 0.01, 6), 0xcccccc, { x: s * 0.08, y: 0.2, z: -0.1, rx: Math.PI / 2 }))];
      if (id === 'leather_hat') return [P(cyl(0.09, 0.1, 0.1, 12), c, { y: 0.05 }), P(cyl(0.16, 0.16, 0.012, 16), c, { y: 0.005 }), P(cyl(0.101, 0.101, 0.02, 12), 0x3a2414, { y: 0.02 })];
      return [P(ico(0.11, 1), c, { y: 0.11, sy: 1.15 }, 0.06), ...[-1, 1].map((s) => P(box(0.03, 0.02, 0.01), C.black, { x: s * 0.04, y: 0.13, z: -0.105 })), P(tor(0.08, 0.008, Math.PI * 2, 12), C.rope, { y: 0.03, rx: Math.PI / 2 })];
    }
    case 'cloth_shirt': case 'leather_vest': case 'metal_chest': {
      const c = d.armor.color;
      const parts = [P(rb(0.24, 0.28, 0.08, 0.03), c, { y: 0.14 })];
      if (id !== 'metal_chest') parts.push(...[-1, 1].map((s) => P(rb(0.08, 0.14, 0.07, 0.02), c, { x: s * 0.14, y: 0.22, rz: s * 0.5 })));
      else parts.push(P(box(0.2, 0.012, 0.085), 0x6a7278, { y: 0.17 }), ...[-1, 1].map((s) => P(rb(0.09, 0.05, 0.09, 0.015), c, { x: s * 0.14, y: 0.27 })));
      parts.push(P(box(0.08, 0.02, 0.082), id === 'leather_vest' ? 0x3a2414 : C.black, { y: 0.27 }));
      return parts;
    }
    case 'small_bag': case 'backpack': case 'large_backpack': {
      const c = d.armor.color, k = id === 'large_backpack' ? 1.25 : id === 'small_bag' ? 0.65 : 1;
      const parts = [P(rb(0.22 * k, 0.28 * k, 0.12 * k, 0.03), c, { y: 0.14 * k }), P(rb(0.18 * k, 0.1 * k, 0.04, 0.015), new THREE.Color(c).multiplyScalar(0.7).getHex(), { y: 0.09 * k, z: -0.07 * k }),
        P(rb(0.23 * k, 0.05 * k, 0.13 * k, 0.015), new THREE.Color(c).multiplyScalar(0.75).getHex(), { y: 0.27 * k }), P(box(0.04, 0.025, 0.012), 0x9a9a90, { y: 0.09 * k, z: -0.095 * k }),
        ...[-1, 1].map((s) => P(box(0.03, 0.24 * k, 0.012), 0x2a2018, { x: s * 0.06 * k, y: 0.14 * k, z: 0.07 * k }))];
      if (id === 'large_backpack') parts.push(P(cyl(0.06, 0.06, 0.3, 10), 0x6a4a2a, { y: 0.4, rz: Math.PI / 2 }));
      if (id === 'small_bag') parts.push(P(tor(0.1, 0.008, Math.PI, 10), 0x2a2018, { y: 0.2 }));
      return parts;
    }
    case 'o2_tank': case 'o2_tank_large': {
      const c = d.armor.color, two = id === 'o2_tank_large';
      const tank = (x) => [P(cyl(0.06, 0.06, 0.34, 12), c, { x, y: 0.19 }), P(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), c, { x, y: 0.36 }), P(cyl(0.02, 0.02, 0.05, 8), 0x9a9a90, { x, y: 0.43 })];
      return [...(two ? [...tank(-0.065), ...tank(0.065)] : tank(0)), P(box(two ? 0.2 : 0.14, 0.03, 0.03), 0x2a2018, { y: 0.26, z: 0.06 }), P(tor(0.05, 0.008, Math.PI * 2, 10), 0x222222, { y: 0.46, z: -0.04 })];
    }
    case 'repair_tool': return [P(box(0.06, 0.14, 0.05), 0xe8a030, { y: 0.07 }), P(cyl(0.025, 0.03, 0.2, 8), 0x4a4e54, { y: 0.1, z: 0.12, rx: Math.PI / 2 }), P(cyl(0.012, 0.012, 0.06, 6), 0x9aa2aa, { y: 0.1, z: 0.25, rx: Math.PI / 2 }), P(box(0.05, 0.05, 0.08), 0x2a2e33, { y: 0.17, z: 0.02 })];
    case 'fishing_rod': return [P(cyl(0.008, 0.016, 0.9, 6), 0x6a4a2a, { y: 0.45 }), P(cyl(0.035, 0.035, 0.03, 10), 0x777777, { y: 0.15, z: 0.03, rx: Math.PI / 2 }), P(cyl(0.02, 0.02, 0.12, 6), 0x2a2018, { y: 0.06 })];
    case 'raw_fish': case 'cooked_fish': case 'raw_big_fish': case 'cooked_big_fish': {
      const k = id.includes('big') ? 1.6 : 1, c = id.startsWith('raw') ? 0x8aa2b0 : 0xb0723a;
      return [P(new THREE.SphereGeometry(0.06 * k, 8, 6), c, { y: 0.06 * k, sx: 2.2, sy: 0.8 }), P(new THREE.ConeGeometry(0.05 * k, 0.07 * k, 4), c, { x: -0.16 * k, y: 0.06 * k, rz: -Math.PI / 2 })];
    }
    case 'pearl': return [P(new THREE.SphereGeometry(0.04, 12, 8), 0xf4efe6, { y: 0.04 })];
    case 'copper_ore': case 'lithium_ore': case 'titanium_ore': {
      const c = { copper_ore: 0x3a9a78, lithium_ore: 0xd890b0, titanium_ore: 0xc8ccd4 }[id];
      return [P(new THREE.IcosahedronGeometry(0.09, 0), 0x5a5550, { y: 0.08 }), P(new THREE.IcosahedronGeometry(0.06, 0), c, { x: 0.05, y: 0.11, z: 0.02 }), P(new THREE.IcosahedronGeometry(0.045, 0), c, { x: -0.06, y: 0.06, z: -0.03 })];
    }
    case 'quartz': case 'kyanite': { const c = id === 'quartz' ? 0xf0f0ff : 0x3a6aff; return [0, 1.1, -1.0, 2.2].map((a, i) => P(new THREE.OctahedronGeometry(0.05, 0), c, { x: Math.cos(a) * 0.04, y: 0.08 + (i % 2) * 0.03, z: Math.sin(a) * 0.04, sy: 2.4, rz: Math.cos(a) * 0.4 })); }
    case 'copper': return [P(new THREE.TorusGeometry(0.08, 0.025, 6, 14), 0xc8763a, { y: 0.05, rx: Math.PI / 2 }), P(new THREE.TorusGeometry(0.06, 0.02, 6, 14), 0xd8864a, { y: 0.09, rx: Math.PI / 2 })];
    case 'lithium': return [P(cyl(0.05, 0.05, 0.14, 10), 0xe8e8f0, { y: 0.07 }), P(cyl(0.035, 0.035, 0.03, 10), 0xd890b0, { y: 0.15 })];
    case 'titanium': return [P(box(0.2, 0.06, 0.08), 0xb8bcc4, { y: 0.03 }), P(box(0.16, 0.04, 0.06), 0xc8ccd4, { y: 0.08 })];
    case 'glass': return [P(box(0.2, 0.15, 0.015), 0x9fe0f0, { y: 0.08 })];
    case 'battery': return [P(cyl(0.05, 0.05, 0.16, 10), 0x2a2e33, { y: 0.08 }), P(cyl(0.051, 0.051, 0.05, 10), 0x3ac870, { y: 0.12 }), P(cyl(0.02, 0.02, 0.02, 8), 0xb8bcc4, { y: 0.17 })];
    case 'power_cell': return [P(box(0.12, 0.22, 0.12), 0x2a2e33, { y: 0.11 }), P(box(0.125, 0.06, 0.125), 0x3ab8e8, { y: 0.16 }), P(box(0.04, 0.03, 0.04), 0xb8bcc4, { y: 0.235 })];
    case 'depth_mk1': case 'depth_mk2': case 'depth_mk3': case 'thruster_module': case 'hull_module': case 'efficiency_module': {
      const c = { depth_mk1: 0x3ab8e8, depth_mk2: 0x3a70ff, depth_mk3: 0x9a50ff, thruster_module: 0xe8a030, hull_module: 0x9aa2aa, efficiency_module: 0x3ac870 }[id];
      return [P(box(0.18, 0.1, 0.14), 0x3a3e44, { y: 0.05 }), P(box(0.12, 0.02, 0.1), c, { y: 0.105 }), P(box(0.04, 0.04, 0.16), 0xb8bcc4, { x: 0.09, y: 0.05 })];
    }
    case 'minisub_kit': case 'cyclops_kit': case 'rowboat_kit': {
      const c = { minisub_kit: 0xe8c43a, cyclops_kit: 0xd8dcd8, rowboat_kit: 0x7a5232 }[id];
      return [P(box(0.3, 0.2, 0.22), 0x8a6a42, { y: 0.1 }), P(box(0.31, 0.04, 0.23), c, { y: 0.14 }), P(box(0.32, 0.02, 0.05), 0x2a2018, { y: 0.2 })];
    }
    case 'cloth_pants': case 'leather_pants': case 'metal_legs': {
      const c = d.armor.color;
      if (id === 'metal_legs') return [P(rb(0.26, 0.04, 0.08, 0.01), C.leather, { y: 0.3 }), ...[-1, 0, 1].map((s) => P(rb(0.09, 0.22, 0.012, 0.004), c, { x: s * 0.085, y: 0.17, rz: s * 0.05 }))];
      return [P(rb(0.22, 0.06, 0.08, 0.02), c, { y: 0.3 }), ...[-1, 1].map((s) => P(rb(0.09, 0.28, 0.075, 0.02), c, { x: s * 0.06, y: 0.14, rz: s * 0.04 }))];
    }
  }
  if (d?.deploy) return null;
  if (d?.door) return [P(rb(0.2, 0.36, 0.02, 0.005), { wood: 0x7a5232, metal: 0x6f7880, armored: 0x3c444c, sealed: 0x35606c }[d.door.tier], { y: 0.18 }), P(box(0.02, 0.02, 0.04), C.black, { x: 0.07, y: 0.17 })];
  return [P(box(0.12, 0.12, 0.12), 0x888888)];
}

const geoCache = new Map();
export function itemGeometry(id) {
  if (!geoCache.has(id)) {
    const parts = build(id);
    geoCache.set(id, parts ? merge(parts) : null);
  }
  return geoCache.get(id);
}

export function makeItemModel(id, mods = null) {
  const g = new THREE.Group();
  const d = ITEMS[id];
  if (!d) return g;
  if (hasWeaponModel(id)) { g.add(makeWeaponModel(id, mods)); return g; }
  if (hasModModel(id)) { const m = makeModModel(id); m.rotation.y = -Math.PI / 2; m.scale.setScalar(1.6); g.add(m); return g; }
  const geo = itemGeometry(id);
  if (geo) { const m = new THREE.Mesh(geo, MAT); m.castShadow = true; g.add(m); }
  else if (d.deploy) { const m = new THREE.Mesh(deployGeometry(d.deploy.kind), MAT); m.scale.setScalar(0.2); m.castShadow = true; g.add(m); }
  if (!g.children.length) { const m = new THREE.Mesh(rb(0.14, 0.14, 0.14, 0.02), MAT); m.position.y = 0.07; g.add(m); } // never an empty model
  if (id === 'torch') {
    const f = new THREE.Mesh(cone(0.05, 0.17, 6), new THREE.MeshBasicMaterial({ color: 0xffa030 }));
    f.position.y = 0.55; g.add(f); g.userData.flame = f;
  }
  return g;
}
