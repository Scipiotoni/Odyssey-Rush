// Low-poly procedural models built from primitives with vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TIERS, pieceBoxes } from '/shared/building.js';
import { ITEMS } from '/shared/items.js';

export const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const MAT_DS = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function paint(geo, color, vary = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i += 3) {
    const v = vary ? 1 + (Math.random() - 0.5) * vary : 1;
    for (let k = 0; k < 3 && i + k < n; k++) { col[(i + k) * 3] = _c.r * v; col[(i + k) * 3 + 1] = _c.g * v; col[(i + k) * 3 + 2] = _c.b * v; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// t: {x,y,z, rx,ry,rz, sx,sy,sz}
export function part(geo, color, t = {}, vary = 0) {
  const g = paint(geo, color, vary);
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0), _q, new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
  g.applyMatrix4(_m);
  return g;
}

export function merge(parts) {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function jitter(geo, amt, seed = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const r = h - Math.floor(h);
    const s = 1 + (r - 0.5) * amt;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  return geo;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dodec = (r, d = 0) => new THREE.DodecahedronGeometry(r, d);

// ---------------------------------------------------------------- nature
const cache = new Map();
function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

export function nodeGeometry(type) {
  return cached('node_' + type, () => {
    switch (type) {
      case 'tree_oak': {
        const parts = [
          part(cyl(0.2, 0.36, 4.4, 8), 0x6b4a2e, { y: 2.2 }, 0.06),
          part(cyl(0.08, 0.13, 2.0, 6), 0x6b4a2e, { x: 0.75, y: 3.7, rz: -0.85 }),
          part(cyl(0.07, 0.12, 1.8, 6), 0x5f4128, { x: -0.6, y: 3.9, z: 0.3, rz: 0.8, rx: 0.3 }),
        ];
        for (let i = 0; i < 3; i++) { const a = i * 2.1; parts.push(part(cyl(0.05, 0.14, 0.9, 5), 0x5f4128, { x: Math.cos(a) * 0.35, y: 0.18, z: Math.sin(a) * 0.35, rz: Math.cos(a) * 1.1, rx: -Math.sin(a) * 1.1 })); }
        const blobs = [[0, 5.4, 0, 2.3, 0x3f7a2c], [1.4, 4.7, 0.5, 1.6, 0x4a8a33], [-1.2, 4.9, -0.7, 1.6, 0x376b26], [0.3, 4.6, -1.3, 1.4, 0x447f2f], [-0.4, 6.3, 0.5, 1.4, 0x4f9236], [0.9, 5.9, -0.6, 1.2, 0x3c752a]];
        blobs.forEach(([x, y, z, r, c], i) => parts.push(part(jitter(ico(r, 1), 0.28, i + 1), c, { x, y, z, sy: 0.85 }, 0.12)));
        return merge(parts);
      }
      case 'tree_pine': {
        const parts = [part(cyl(0.16, 0.3, 3.2, 7), 0x5b3d24, { y: 1.6 }, 0.06)];
        const tiers = [[2.5, 3.2, 3.4], [2.1, 2.8, 4.9], [1.7, 2.5, 6.2], [1.25, 2.2, 7.4], [0.75, 1.8, 8.5]];
        tiers.forEach(([r, h, y], i) => parts.push(part(jitter(cone(r, h, 10), 0.12, i + 3), i % 2 ? 0x23653b : 0x1d5732, { y, ry: i * 0.6 }, 0.1)));
        return merge(parts);
      }
      case 'tree_palm': {
        const parts = [];
        for (let i = 0; i < 7; i++) { parts.push(part(cyl(0.16 - i * 0.012, 0.19 - i * 0.012, 1.35, 7), i % 2 ? 0x8a6d45 : 0x7a5f3a, { x: i * i * 0.035, y: 0.7 + i * 1.3, rz: -i * 0.055 })); }
        const top = [1.7, 9.3, 0];
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const dx = Math.sin(a), dz = Math.cos(a);
          parts.push(part(box(0.55, 0.04, 1.8), 0x3e8a2e, { x: top[0] + dx * 0.9, y: top[1] + 0.25, z: dz * 0.9, ry: a, rx: -0.25 }, 0.15));
          parts.push(part(box(0.45, 0.04, 1.5), 0x357a28, { x: top[0] + dx * 2.3, y: top[1] - 0.35, z: dz * 2.3, ry: a, rx: 0.55 }, 0.15));
        }
        for (let k = 0; k < 4; k++) { const a = k * 1.6; parts.push(part(ico(0.14, 1), 0x5a4020, { x: top[0] + Math.sin(a) * 0.25, y: top[1] - 0.15, z: Math.cos(a) * 0.25 })); }
        return merge(parts);
      }
      case 'tree_dead': return merge([
        part(cyl(0.13, 0.32, 5.2, 7), 0x5e5248, { y: 2.6 }, 0.05),
        part(cyl(0.05, 0.11, 2.4, 5), 0x5e5248, { x: 0.8, y: 3.6, rz: -0.95 }),
        part(cyl(0.05, 0.1, 2.0, 5), 0x544840, { x: -0.7, y: 4.2, rz: 0.85 }),
        part(cyl(0.04, 0.08, 1.6, 5), 0x5e5248, { z: 0.6, y: 4.8, rx: 0.85 }),
        part(cyl(0.03, 0.06, 1.2, 4), 0x544840, { x: 0.3, z: -0.5, y: 5.2, rx: -0.7, rz: -0.3 }),
        part(cyl(0.03, 0.05, 1.0, 4), 0x5e5248, { x: 1.5, y: 4.4, rz: -0.3 }),
      ]);
      case 'cactus': return merge([
        part(cyl(0.3, 0.36, 3.2, 10), 0x4f8a3a, { y: 1.6 }, 0.05),
        part(ico(0.3, 1), 0x4f8a3a, { y: 3.2, sy: 0.6 }),
        part(cyl(0.18, 0.18, 0.8, 8), 0x4f8a3a, { x: 0.5, y: 1.4, rz: Math.PI / 2 }), part(cyl(0.18, 0.18, 1.0, 8), 0x4f8a3a, { x: 0.85, y: 1.9 }), part(ico(0.18, 1), 0x4f8a3a, { x: 0.85, y: 2.4, sy: 0.6 }),
        part(cyl(0.16, 0.16, 0.6, 8), 0x4f8a3a, { x: -0.45, y: 1.9, rz: Math.PI / 2 }), part(cyl(0.16, 0.16, 0.8, 8), 0x4f8a3a, { x: -0.7, y: 2.3 }), part(ico(0.16, 1), 0x4f8a3a, { x: -0.7, y: 2.7, sy: 0.6 }),
        part(ico(0.1, 0), 0xe05080, { y: 3.38 }), part(ico(0.07, 0), 0xf0c040, { x: 0.85, y: 2.52 }),
      ]);
      case 'rock_stone': return merge([part(jitter(dodec(1.25, 1), 0.38, 4), 0x8d8a85, { y: 0.45, sy: 0.72 }, 0.1), part(jitter(dodec(0.45, 0), 0.4, 14), 0x7d7a75, { x: 1.2, y: 0.12, z: 0.4 }), part(jitter(dodec(0.3, 0), 0.4, 15), 0x8d8a85, { x: -0.9, y: 0.08, z: 0.9 })]);
      case 'rock_metal': case 'rock_sulfur': {
        const metal = type === 'rock_metal';
        const base = metal ? 0x6e6560 : 0x7d7a68, ore = metal ? 0xc0703a : 0xe0d040, ore2 = metal ? 0xa86030 : 0xd8c830;
        const parts = [part(jitter(dodec(1.25, 1), 0.38, metal ? 5 : 6), base, { y: 0.45, sy: 0.72 }, 0.1), part(jitter(dodec(0.4, 0), 0.4, 16), base, { x: 1.15, y: 0.1, z: -0.5 })];
        const spots = [[0.8, 0.8, 0.3], [-0.5, 1.0, 0.6], [0.1, 1.15, -0.7], [-0.9, 0.55, -0.4], [0.5, 0.45, 0.95]];
        spots.forEach(([x, y, z], i) => parts.push(part(new THREE.OctahedronGeometry(0.22 + (i % 2) * 0.08, 0), i % 2 ? ore : ore2, { x, y, z, rx: i, rz: i * 0.7, sy: 1.6 })));
        return merge(parts);
      }
      case 'loose_rock': return merge([part(jitter(dodec(0.2, 0), 0.35, 21), 0x9a968e, { y: 0.1, sy: 0.7 }, 0.1), part(jitter(dodec(0.08, 0), 0.3, 22), 0x8a867e, { x: 0.25, y: 0.04, z: 0.1 })]);
      case 'branch': return merge([part(cyl(0.035, 0.05, 1.3, 5), 0x6a4a2a, { y: 0.06, rz: Math.PI / 2, ry: 0.3 }), part(cyl(0.025, 0.035, 0.9, 5), 0x5e4126, { y: 0.07, x: 0.1, rz: Math.PI / 2, ry: -0.6 }), part(cyl(0.012, 0.02, 0.4, 4), 0x6a4a2a, { x: 0.3, y: 0.15, z: 0.15, rz: 0.9 }), part(box(0.1, 0.02, 0.06), 0x4a7a2a, { x: 0.45, y: 0.22, z: 0.2 })]);
      case 'hemp': {
        const parts = [part(cyl(0.025, 0.035, 1.3, 5), 0x5a8a30, { y: 0.65 })];
        for (let i = 0; i < 12; i++) { const a = i * 2.4, y = 0.35 + (i % 6) * 0.15; parts.push(part(box(0.06, 0.012, 0.32), 0x6aa23c, { x: Math.cos(a) * 0.14, y, z: Math.sin(a) * 0.14, ry: -a + Math.PI / 2, rx: 0.4 }, 0.2)); }
        parts.push(part(cone(0.09, 0.3, 6), 0xa8c860, { y: 1.4 }));
        return merge(parts);
      }
      case 'berry': {
        const parts = [part(jitter(ico(0.7, 1), 0.25, 7), 0x2f6b2a, { y: 0.55, sy: 0.8 }, 0.15), part(jitter(ico(0.45, 1), 0.25, 8), 0x387a30, { x: 0.4, y: 0.45, z: 0.2 }, 0.15)];
        for (let i = 0; i < 12; i++) { const a = i * 0.9; parts.push(part(ico(0.07, 1), i % 3 ? 0x4050c0 : 0x6a2a8a, { x: Math.cos(a) * 0.62, y: 0.45 + (i % 4) * 0.13, z: Math.sin(a) * 0.62 })); }
        return merge(parts);
      }
      case 'barrel': return merge([
        part(cyl(0.4, 0.4, 1.15, 14), 0x2d5d8a, { y: 0.575 }, 0.06),
        part(cyl(0.42, 0.42, 0.06, 14), 0x1d3d5a, { y: 0.3 }), part(cyl(0.42, 0.42, 0.06, 14), 0x1d3d5a, { y: 0.85 }),
        part(cyl(0.38, 0.38, 0.03, 14), 0x24496b, { y: 1.16 }), part(cyl(0.05, 0.05, 0.04, 8), 0x888888, { x: 0.2, y: 1.18 }),
      ]);
    }
    return merge([part(box(1, 1, 1), 0xff00ff)]);
  });
}

// cosmetic ground cover (no collision)
export function detailGeometry(kind) {
  return cached('detail_' + kind, () => {
    const blade = (h, w, a, lean, col) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, Math.sin(lean) * h * 0.4, h, Math.cos(lean) * 0.0], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      return part(g, col, { ry: a });
    };
    const parts = [];
    if (kind === 'grass' || kind === 'flower') {
      for (let i = 0; i < 7; i++) parts.push(blade(0.35 + (i % 3) * 0.12, 0.05, i * 0.9, (i - 3) * 0.2, i % 2 ? 0x5a9a3a : 0x4a8a30));
      if (kind === 'flower') { parts.push(part(ico(0.05, 0), [0xe8d040, 0xe05060, 0xf0f0f0, 0x9060d0][Math.floor(Math.random() * 4)], { y: 0.5, x: 0.05 })); parts.push(part(ico(0.045, 0), 0xf0f0f0, { y: 0.42, x: -0.08, z: 0.05 })); }
    } else if (kind === 'drygrass') { for (let i = 0; i < 6; i++) parts.push(blade(0.3 + (i % 3) * 0.1, 0.04, i * 1.1, (i - 3) * 0.25, i % 2 ? 0xb8a060 : 0xa08a50)); }
    else if (kind === 'pebbles') { for (let i = 0; i < 4; i++) parts.push(part(jitter(dodec(0.06 + (i % 2) * 0.04, 0), 0.3, 30 + i), 0x8a867e, { x: Math.cos(i * 1.7) * 0.25, y: 0.02, z: Math.sin(i * 1.7) * 0.25, sy: 0.6 })); }
    return merge(parts);
  });
}

// ---------------------------------------------------------------- humans & vehicles (see character.js / cars.js)
export { makeHumanoid, makeFPArm } from './character.js';
export { makeVehicle } from './cars.js';

// ---------------------------------------------------------------- animals
export function makeAnimal(type, color, size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.62) });
  const light = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xf0e6d0), 0.5) });
  const hoof = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  const s = size;
  const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
  const body = new THREE.Group(); g.add(body);
  let legH = 0.72 * s, bodyL = 1.25 * s, bodyH = 0.55 * s, bodyW = 0.46 * s;
  if (type === 'boar') { legH = 0.38 * s; bodyL = 1.15 * s; bodyH = 0.66 * s; bodyW = 0.58 * s; }
  if (type === 'bear') { legH = 0.62 * s; bodyL = 1.35 * s; bodyH = 0.85 * s; bodyW = 0.82 * s; }
  if (type === 'wolf') { legH = 0.58 * s; bodyL = 1.15 * s; bodyH = 0.42 * s; bodyW = 0.36 * s; }
  add(rb(bodyW, bodyH, bodyL, bodyH * 0.35), mat, 0, legH + bodyH / 2, 0, body);
  add(rb(bodyW * 0.85, bodyH * 0.5, bodyL * 0.7, bodyH * 0.2), light, 0, legH + bodyH * 0.18, 0, body);
  if (type === 'bear' || type === 'boar') add(rb(bodyW * 1.02, bodyH * 0.8, bodyL * 0.4, bodyH * 0.3), type === 'boar' ? dark : mat, 0, legH + bodyH * 0.62, bodyL * 0.28, body);
  const neck = new THREE.Group(); neck.position.set(0, legH + bodyH * 0.75, bodyL / 2 - 0.05 * s); body.add(neck);
  const hs = type === 'bear' ? 0.48 * s : type === 'boar' ? 0.4 * s : 0.3 * s;
  const hy = type === 'deer' ? 0.42 * s : type === 'wolf' ? 0.1 * s : 0.02;
  if (type === 'deer') { const n = add(rb(0.16 * s, 0.55 * s, 0.18 * s, 0.06 * s), mat, 0, 0.16 * s, 0.06, neck); n.rotation.x = 0.35; }
  add(rb(hs, hs * 0.9, hs * 1.15, hs * 0.3), mat, 0, hy, hs * 0.45, neck);
  add(rb(hs * 0.55, hs * 0.5, hs * 0.6, hs * 0.18), type === 'boar' ? dark : light, 0, hy - hs * 0.15, hs * 1.1, neck);
  add(rb(hs * 0.3, hs * 0.2, hs * 0.08, hs * 0.05), hoof, 0, hy - hs * 0.1, hs * 1.4, neck);
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(hs * 0.07, 6, 5), eye, sx * hs * 0.34, hy + hs * 0.15, hs * 0.85, neck);
    const ear = add(new THREE.ConeGeometry(hs * 0.14, hs * 0.38, 4), dark, sx * hs * 0.3, hy + hs * 0.5, hs * 0.25, neck);
    ear.rotation.z = -sx * 0.35;
  }
  if (type === 'deer') for (const sx of [-1, 1]) {
    const a = add(new THREE.CylinderGeometry(0.018, 0.028, 0.5 * s, 5), hoof, sx * 0.1, hy + 0.42 * s, 0.1, neck); a.rotation.z = -sx * 0.4;
    for (let k = 0; k < 2; k++) { const t = add(new THREE.CylinderGeometry(0.012, 0.018, 0.22 * s, 4), hoof, sx * (0.18 + k * 0.05), hy + (0.5 + k * 0.12) * s, 0.12 - k * 0.06, neck); t.rotation.z = -sx * 0.9; t.rotation.x = -0.4; }
  }
  if (type === 'boar') for (const sx of [-1, 1]) { const t = add(new THREE.ConeGeometry(0.02, 0.12, 5), new THREE.MeshLambertMaterial({ color: 0xeeeadd }), sx * 0.09, hy - 0.08, hs * 1.35, neck); t.rotation.x = -0.6; }
  if (type === 'wolf') { const sn = add(rb(hs * 0.45, hs * 0.38, hs * 0.55, hs * 0.12), mat, 0, hy - hs * 0.12, hs * 1.25, neck); }
  const tail = add(rb(0.09 * s, 0.09 * s, type === 'wolf' ? 0.5 * s : type === 'deer' ? 0.14 * s : 0.18 * s, 0.04 * s), type === 'deer' ? light : dark, 0, legH + bodyH * 0.82, -bodyL / 2 - 0.08 * s, body);
  tail.rotation.x = type === 'wolf' ? 0.6 : -0.3;
  const legs = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = new THREE.Group(); p.position.set(lx * bodyW * 0.3, legH + 0.04, lz * bodyL * 0.36); body.add(p);
    const th = type === 'bear' ? 0.2 * s : type === 'boar' ? 0.15 * s : 0.11 * s;
    add(rb(th * 1.2, legH * 0.55, th * 1.3, th * 0.4), mat, 0, -legH * 0.22, 0, p);
    add(rb(th, legH * 0.55, th, th * 0.35), dark, 0, -legH * 0.66, 0, p);
    add(rb(th * 1.1, 0.06 * s, th * 1.3, 0.02), hoof, 0, -legH + 0.03, 0.01, p);
    legs.push(p);
  }
  g.userData = { legs, neck, body, tail, tailRx: tail.rotation.x };
  return g;
}

// ---------------------------------------------------------------- building pieces
export const TIER_MATS = TIERS.map((t) => new THREE.MeshLambertMaterial({ color: t.color, flatShading: true }));
// Building piece geometry with per-tier surface detail (planks, stone blocks, metal panels, armour plates)
export function pieceGeometry(type, tier = 1) {
  return cached(`piece_${type}_${tier}`, () => {
    const parts = [];
    const col = TIERS[tier].color;
    const dk = new THREE.Color(col).multiplyScalar(0.7).getHex(), lt = new THREE.Color(col).multiplyScalar(1.15).getHex();
    for (const [cx, cy, cz, hx, hy, hz] of pieceBoxes(type)) {
      const h = [hx, hy, hz], c = [cx, cy, cz];
      if (tier === 0) {
        // twig: a frame of lashed sticks
        const st = 0.07, stick = 0x9a7a4a;
        const edge = (ax, o1, o2) => { const sz = [st, st, st]; sz[ax] = h[ax] * 2; const p = [...c]; const others = [0, 1, 2].filter((k) => k !== ax); p[others[0]] += o1 * (h[others[0]] - st / 2); p[others[1]] += o2 * (h[others[1]] - st / 2); parts.push(part(box(...sz), stick, { x: p[0], y: p[1], z: p[2] }, 0.15)); };
        for (let ax = 0; ax < 3; ax++) for (const o1 of [-1, 1]) for (const o2 of [-1, 1]) if (h[ax] > 0.15 || ax === 1) edge(ax, o1, o2);
        // diagonal brace on the largest face
        const thin = h.indexOf(Math.min(...h));
        if (thin !== 1) { const len = Math.hypot(h[thin === 0 ? 2 : 0] * 2, hy * 2); const ang = Math.atan2(hy * 2, h[thin === 0 ? 2 : 0] * 2); parts.push(part(box(thin === 0 ? st : len, st, thin === 0 ? len : st), stick, { x: cx, y: cy, z: cz, rz: thin === 2 ? ang : 0, rx: thin === 0 ? -ang : 0 }, 0.1)); }
        else { const len = Math.hypot(hx * 2, hz * 2); parts.push(part(box(len, st, st), stick, { x: cx, y: cy + hy - st / 2, z: cz, ry: Math.atan2(hz * 2, hx * 2) })); }
        continue;
      }
      parts.push(part(box(hx * 2, hy * 2, hz * 2), col, { x: cx, y: cy, z: cz }, tier === 2 ? 0.08 : 0.04));
      // detail on large faces: vertical faces use (u = horizontal axis, v = y); the top face uses (u = x, v = z)
      for (let ax = 0; ax < 3; ax++) for (const sgn of [-1, 1]) {
        if (ax === 1 && sgn < 0) continue;
        const others = [0, 1, 2].filter((k) => k !== ax);
        if (h[others[0]] < 0.25 || h[others[1]] < 0.25) continue;
        const u = ax === 1 ? 0 : others.find((k) => k !== 1), v = ax === 1 ? 2 : 1;
        const U = h[u] * 2, V = h[v] * 2;
        const strip = (uc, vc, ul, vl, color, d = 0.012) => {
          const sz = [0, 0, 0], p = [...c];
          sz[u] = ul; sz[v] = vl; sz[ax] = d * 2; p[u] += uc; p[v] += vc; p[ax] += sgn * h[ax];
          parts.push(part(box(sz[0], sz[1], sz[2]), color, { x: p[0], y: p[1], z: p[2] }));
        };
        if (tier === 1) { for (let t = -V / 2 + 0.3; t < V / 2 - 0.1; t += 0.3) strip(0, t, U - 0.02, 0.025, dk); strip(-U / 2 + 0.08, 0, 0.06, V - 0.04, dk, 0.02); strip(U / 2 - 0.08, 0, 0.06, V - 0.04, dk, 0.02); }
        else if (tier === 2) { let row = 0; for (let t = -V / 2 + 0.5; t < V / 2 - 0.1; t += 0.5, row++) strip(0, t, U - 0.02, 0.03, dk); row = 0; for (let t = -V / 2; t < V / 2 - 0.05; t += 0.5, row++) { const off = row % 2 ? 0.45 : 0; for (let q = -U / 2 + 0.9 + off; q < U / 2 - 0.1; q += 0.9) strip(q, t + 0.25, 0.03, 0.47, dk); } }
        else if (tier === 3) { for (let q = -U / 2 + 1; q < U / 2 - 0.1; q += 1) strip(q, 0, 0.04, V - 0.02, dk); strip(0, 0, U - 0.02, 0.1, dk, 0.018); for (let q = -U / 2 + 0.2; q < U / 2; q += 0.5) strip(q, 0, 0.05, 0.05, lt, 0.026); }
        else { strip(0, 0, U - 0.02, 0.06, dk, 0.02); strip(0, 0, 0.06, V - 0.02, dk, 0.02); for (const a of [-1, 1]) for (const b of [-1, 1]) { strip(a * U / 4, b * V / 4, U / 2 - 0.12, V / 2 - 0.12, lt, 0.03); strip(a * (U / 2 - 0.12), b * (V / 2 - 0.12), 0.07, 0.07, dk, 0.04); } }
      }
    }
    if (type === 'foundation' && tier > 0) parts.push(part(box(3.06, 0.12, 3.06), dk, { y: -0.06 }));
    return merge(parts);
  });
}
export const DOOR_MATS = { wood: new THREE.MeshLambertMaterial({ color: 0x7a5232, flatShading: true }), metal: new THREE.MeshLambertMaterial({ color: 0x6f7880, flatShading: true }), armored: new THREE.MeshLambertMaterial({ color: 0x3c444c, flatShading: true }) };
export function makeDoor(tier) {
  const g = new THREE.Group();
  const pivot = new THREE.Group(); pivot.position.set(-0.6, 0, 0); g.add(pivot);
  const slab = new THREE.Mesh(box(1.2, 2.2, 0.1), DOOR_MATS[tier] || DOOR_MATS.wood); slab.position.set(0.6, 1.1, 0); slab.castShadow = true; pivot.add(slab);
  const handle = new THREE.Mesh(box(0.06, 0.06, 0.25), new THREE.MeshLambertMaterial({ color: 0x222222 })); handle.position.set(1.05, 1.0, 0); pivot.add(handle);
  if (tier !== 'wood') { const band = new THREE.Mesh(box(1.22, 0.1, 0.12), new THREE.MeshLambertMaterial({ color: 0x333333 })); band.position.set(0.6, 0.5, 0); pivot.add(band); const b2 = band.clone(); b2.position.y = 1.7; pivot.add(b2); }
  g.userData.pivot = pivot;
  return g;
}

// ---------------------------------------------------------------- deployables / loot
export function deployGeometry(kind) {
  return cached('dep_' + kind, () => {
    switch (kind) {
      case 'campfire': {
        const parts = [];
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(part(dodec(0.15), 0x777777, { x: Math.cos(a) * 0.5, y: 0.1, z: Math.sin(a) * 0.5 })); }
        for (let i = 0; i < 4; i++) parts.push(part(cyl(0.06, 0.06, 0.8, 5), 0x5b3a20, { y: 0.15, ry: i * 0.8, rz: Math.PI / 2 - 0.3 }));
        return merge(parts);
      }
      case 'furnace': return merge([
        part(cyl(0.55, 0.65, 1.2, 7), 0x7f7a74, { y: 0.6 }, 0.1), part(cyl(0.2, 0.25, 0.4, 6), 0x5a5550, { y: 1.4 }),
        part(box(0.4, 0.3, 0.1), 0x201510, { y: 0.4, z: 0.58 }),
      ]);
      case 'workbench1': case 'workbench2': case 'workbench3': {
        const col = kind === 'workbench1' ? 0x7a5534 : kind === 'workbench2' ? 0x6a7078 : 0x3d4a55;
        return merge([
          part(box(2, 0.12, 1), col, { y: 0.85 }), part(box(0.1, 0.85, 0.1), 0x4a3a2a, { x: -0.9, y: 0.42, z: -0.4 }), part(box(0.1, 0.85, 0.1), 0x4a3a2a, { x: 0.9, y: 0.42, z: -0.4 }),
          part(box(0.1, 0.85, 0.1), 0x4a3a2a, { x: -0.9, y: 0.42, z: 0.4 }), part(box(0.1, 0.85, 0.1), 0x4a3a2a, { x: 0.9, y: 0.42, z: 0.4 }),
          part(box(0.4, 0.2, 0.3), 0x8a8a8a, { x: 0.5, y: 1.0 }), part(box(0.15, 0.4, 0.15), 0x555555, { x: -0.6, y: 1.1 }),
          part(box(1.9, 0.05, 0.9), kind === 'workbench3' ? 0x8a2020 : kind === 'workbench2' ? 0x2a5a8a : 0x5a8a2a, { y: 0.3 }),
        ]);
      }
      case 'small_box': return merge([part(box(0.9, 0.6, 0.6), 0x8a6238, { y: 0.3 }, 0.08), part(box(0.92, 0.06, 0.62), 0x5a3e22, { y: 0.45 })]);
      case 'large_box': return merge([part(box(1.5, 0.8, 0.9), 0x7a5532, { y: 0.4 }, 0.08), part(box(1.52, 0.06, 0.92), 0x4a3420, { y: 0.6 }), part(box(0.1, 0.82, 0.92), 0x4a3420, { y: 0.4 })]);
      case 'sleeping_bag': return merge([part(box(0.8, 0.15, 2), 0x4a6a8a, { y: 0.075 }, 0.05), part(box(0.7, 0.18, 0.4), 0xd8d0c0, { y: 0.1, z: -0.75 })]);
      case 'tool_cupboard': return merge([part(box(0.9, 1.8, 0.6), 0x6a5a40, { y: 0.9 }, 0.05), part(box(0.8, 0.05, 0.62), 0x3a3020, { y: 1.2 }), part(box(0.8, 0.05, 0.62), 0x3a3020, { y: 0.6 }), part(box(0.1, 0.1, 0.05), 0xd0b030, { x: 0.3, y: 1.0, z: 0.31 })]);
      case 'crate1': return merge([part(box(1.4, 0.8, 0.9), 0x8a7040, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x5a4a28, { y: 0.7 }), part(box(0.1, 0.82, 0.92), 0x5a4a28, { x: 0.5, y: 0.4 }), part(box(0.1, 0.82, 0.92), 0x5a4a28, { x: -0.5, y: 0.4 })]);
      case 'crate2': return merge([part(box(1.4, 0.8, 0.9), 0x4f5f35, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x2f3a20, { y: 0.7 }), part(box(0.4, 0.2, 0.02), 0xd0d0d0, { y: 0.45, z: 0.46 })]);
      case 'crate3': return merge([part(box(1.4, 0.8, 0.9), 0x2c3a4c, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x1a2230, { y: 0.7 }), part(box(0.5, 0.2, 0.02), 0xc8a030, { y: 0.45, z: 0.46 })]);
      case 'bag': return merge([part(jitter(ico(0.35, 0), 0.3, 9), 0x6a5236, { y: 0.25, sy: 0.75 }), part(cyl(0.08, 0.12, 0.2, 5), 0x4a3a26, { y: 0.55 })]);
    }
    return merge([part(box(0.5, 0.5, 0.5), 0xff00ff, { y: 0.25 })]);
  });
}

// ---------------------------------------------------------------- items (see items3d.js)
export { makeItemModel } from './items3d.js';

// ---------------------------------------------------------------- POI props
export function poiGeometry(layout) {
  const parts = [];
  for (const p of layout.props) {
    if (p.k === 'box') parts.push(part(box(p.sx, p.sy, p.sz), p.color, { x: p.x, y: p.y, z: p.z, ry: p.yaw, rz: p.roll || 0 }, 0.06));
    else parts.push(part(cyl(p.r, p.r, p.h, 10), p.color, { x: p.x, y: p.y, z: p.z }, 0.05));
  }
  return parts.length ? merge(parts) : null;
}
