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
        const bark = 0x6b4a2e, barkD = 0x56391f;
        const parts = [part(jitter(cyl(0.22, 0.38, 4.4, 9), 0.06, 3), bark, { y: 2.2 }, 0.06)];
        // root flare
        for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; parts.push(part(cyl(0.05, 0.16, 0.9, 5), barkD, { x: Math.cos(a) * 0.32, y: 0.16, z: Math.sin(a) * 0.32, rz: Math.cos(a) * 1.15, rx: -Math.sin(a) * 1.15 })); }
        // limbs
        const limbs = [[0.85, 3.8, 0.1, -0.9, 0.1, 2.2], [-0.7, 4.0, 0.35, 0.85, 0.3, 2.0], [0.15, 4.2, -0.75, 0.2, -0.85, 1.9], [-0.25, 4.6, -0.2, 0.35, 0, 1.4]];
        limbs.forEach(([x, y, z, rz, rx, l]) => parts.push(part(cyl(0.06, 0.13, l, 6), bark, { x, y, z, rz, rx })));
        // crown: layered clumps, darker underneath and lighter on top
        const clumps = [[0, 6.3, 0, 1.7, 0x4f9236], [1.6, 5.4, 0.4, 1.5, 0x46872f], [-1.5, 5.5, -0.5, 1.5, 0x3f7c2a], [0.4, 5.3, -1.6, 1.4, 0x447f2f], [-0.5, 5.4, 1.5, 1.45, 0x4a8a33],
          [1.1, 4.6, -1.0, 1.15, 0x356a24], [-1.2, 4.6, 0.9, 1.15, 0x346724], [0.9, 6.7, 0.8, 1.1, 0x5a9e3e], [-0.9, 6.6, -0.6, 1.1, 0x56993b], [0, 4.4, 0.2, 1.3, 0x2f5f20], [1.9, 4.9, 1.3, 0.9, 0x3c7529], [-1.9, 5.0, -1.4, 0.9, 0x3a7128]];
        clumps.forEach(([x, y, z, r, c], i) => parts.push(part(jitter(ico(r, 1), 0.32, i + 1), c, { x, y, z, sy: 0.82 }, 0.14)));
        return merge(parts);
      }
      case 'tree_pine': {
        const parts = [part(jitter(cyl(0.14, 0.32, 3.4, 8), 0.05, 2), 0x5b3d24, { y: 1.7 }, 0.06), part(cyl(0.06, 0.12, 5.5, 6), 0x5b3d24, { y: 5.2 })];
        const tiers = [[2.7, 2.4, 2.9], [2.45, 2.3, 3.9], [2.2, 2.2, 4.85], [1.9, 2.0, 5.8], [1.6, 1.9, 6.7], [1.3, 1.7, 7.55], [0.95, 1.5, 8.35], [0.6, 1.3, 9.1]];
        tiers.forEach(([r, h, y], i) => {
          const c = [0x1d5732, 0x23653b, 0x1f5c35, 0x276b3e][i % 4];
          parts.push(part(jitter(cone(r, h, 9), 0.16, i + 3), c, { y, ry: i * 0.7 }, 0.12));
          parts.push(part(jitter(cone(r * 0.92, h * 0.5, 9), 0.12, i + 30), 0x173f27, { y: y - h * 0.42, ry: i * 0.7 + 0.35 }, 0.08)); // dark underside
        });
        parts.push(part(cone(0.18, 0.7, 6), 0x2c7344, { y: 10.0 }));
        return merge(parts);
      }
      case 'tree_palm': {
        const parts = [];
        for (let i = 0; i < 8; i++) {
          parts.push(part(cyl(0.15 - i * 0.01, 0.19 - i * 0.01, 1.2, 8), i % 2 ? 0x8a6d45 : 0x7a5f3a, { x: i * i * 0.028, y: 0.6 + i * 1.15, rz: -i * 0.05 }));
          parts.push(part(cyl(0.2 - i * 0.01, 0.2 - i * 0.01, 0.08, 8), 0x6a5032, { x: i * i * 0.028, y: 1.18 + i * 1.15, rz: -i * 0.05 })); // ring scars
        }
        const top = [1.8, 9.4, 0];
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + (k % 2) * 0.2, droop = 0.25 + (k % 3) * 0.12;
          let px = top[0], py = top[1], pz = 0, pitch = -0.35 - (k % 2) * 0.15;
          for (let sgi = 0; sgi < 5; sgi++) {
            const len = 0.62, w = 0.75 - sgi * 0.12;
            const dx = Math.sin(a) * Math.cos(pitch) * len, dz = Math.cos(a) * Math.cos(pitch) * len, dy = Math.sin(-pitch) * len;
            parts.push(part(box(w, 0.03, len + 0.05), sgi % 2 ? 0x3e8a2e : 0x469636, { x: px + dx / 2, y: py + dy / 2, z: pz + dz / 2, ry: a, rx: pitch }, 0.12));
            parts.push(part(box(0.04, 0.05, len + 0.05), 0x5a7a2a, { x: px + dx / 2, y: py + dy / 2 + 0.02, z: pz + dz / 2, ry: a, rx: pitch }));
            px += dx; py += dy; pz += dz; pitch += droop;
          }
        }
        for (let k = 0; k < 5; k++) { const a = k * 1.3; parts.push(part(ico(0.15, 1), k % 2 ? 0x5a4020 : 0x4a3418, { x: top[0] + Math.sin(a) * 0.26, y: top[1] - 0.2 - (k % 2) * 0.1, z: Math.cos(a) * 0.26 })); }
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
    const plane = (w, h, col, t) => { const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); return part(g, col, t); };
    if (kind === 'grass' || kind === 'flower') {
      if (kind === 'grass') for (let i = 0; i < 7; i++) parts.push(blade(0.35 + (i % 3) * 0.12, 0.05, i * 0.9, (i - 3) * 0.2, i % 2 ? 0x5a9a3a : 0x4a8a30));
      else {
        // a few stems with five-petal heads; petals are white so each instance can be tinted
        for (let f = 0; f < 3; f++) {
          const fx = Math.cos(f * 2.1) * 0.08, fz = Math.sin(f * 2.1) * 0.08, h = 0.32 + f * 0.09;
          parts.push(part(cyl(0.006, 0.008, h, 4), 0x3f7a2a, { x: fx, y: h / 2, z: fz }));
          parts.push(part(box(0.09, 0.005, 0.03), 0x4a8a30, { x: fx + 0.03, y: h * 0.4, z: fz, rz: 0.4 }));
          for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; parts.push(part(new THREE.CircleGeometry(0.035, 5), 0xffffff, { x: fx + Math.cos(a) * 0.035, y: h + 0.005, z: fz + Math.sin(a) * 0.035, rx: -Math.PI / 2 + 0.25, rz: a })); }
          parts.push(part(ico(0.018, 0), 0x6a3a14, { x: fx, y: h + 0.015, z: fz }));
        }
      }
    } else if (kind === 'drygrass') { for (let i = 0; i < 6; i++) parts.push(blade(0.3 + (i % 3) * 0.1, 0.04, i * 1.1, (i - 3) * 0.25, i % 2 ? 0xb8a060 : 0xa08a50)); }
    else if (kind === 'pebbles') { for (let i = 0; i < 4; i++) parts.push(part(jitter(dodec(0.06 + (i % 2) * 0.04, 0), 0.3, 30 + i), 0x8a867e, { x: Math.cos(i * 1.7) * 0.25, y: 0.02, z: Math.sin(i * 1.7) * 0.25, sy: 0.6 })); }
    else if (kind === 'fern') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (let sgi = 0; sgi < 3; sgi++) parts.push(plane(0.18 - sgi * 0.04, 0.32, sgi ? 0x4f8f34 : 0x3f7a2a, { x: Math.sin(a) * (0.1 + sgi * 0.24), y: 0.05 + sgi * 0.2 - sgi * sgi * 0.06, z: Math.cos(a) * (0.1 + sgi * 0.24), ry: a, rx: 0.5 + sgi * 0.45 }));
      }
    } else if (kind === 'bush') {
      const cl = [[0, 0.35, 0, 0.45, 0x3d7a2c], [0.35, 0.25, 0.15, 0.32, 0x356e26], [-0.3, 0.28, -0.12, 0.34, 0x447f30], [0.05, 0.55, -0.1, 0.3, 0x4c8c36]];
      cl.forEach(([x, y, z, r, c], i) => parts.push(part(jitter(ico(r, 1), 0.3, 50 + i), c, { x, y, z, sy: 0.8 }, 0.15)));
    } else if (kind === 'mushroom') {
      const red = Math.random() < 0.5;
      [[0, 0, 1], [0.1, 0.05, 0.65], [-0.08, 0.07, 0.5]].forEach(([x, z, k], i) => {
        parts.push(part(cyl(0.018 * k, 0.025 * k, 0.12 * k, 6), 0xece4d4, { x, y: 0.06 * k, z }));
        parts.push(part(new THREE.SphereGeometry(0.06 * k, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), red ? 0xc8281e : 0x9a6a3a, { x, y: 0.11 * k, z }));
        if (red) for (let d = 0; d < 4; d++) parts.push(part(ico(0.008 * k, 0), 0xffffff, { x: x + Math.cos(d * 1.6) * 0.035 * k, y: 0.15 * k, z: z + Math.sin(d * 1.6) * 0.035 * k }));
      });
    } else if (kind === 'reeds') {
      for (let i = 0; i < 9; i++) parts.push(blade(1.1 + (i % 3) * 0.3, 0.035, i * 0.7, (i - 4) * 0.08, i % 2 ? 0x6a8a3a : 0x5a7a32));
      for (let i = 0; i < 3; i++) { const a = i * 2.2; parts.push(part(cyl(0.005, 0.005, 1.5, 3), 0x6a7a3a, { x: Math.cos(a) * 0.06, y: 0.75, z: Math.sin(a) * 0.06 })); parts.push(part(cyl(0.025, 0.025, 0.16, 6), 0x5a3a1e, { x: Math.cos(a) * 0.06, y: 1.42, z: Math.sin(a) * 0.06 })); }
    } else if (kind === 'stick') {
      parts.push(part(cyl(0.02, 0.028, 0.7, 4), 0x6a4a2a, { y: 0.025, rz: Math.PI / 2 }), part(cyl(0.012, 0.016, 0.3, 4), 0x5e4126, { x: 0.15, y: 0.03, z: 0.08, rz: Math.PI / 2, ry: 0.7 }));
    }
    return merge(parts);
  });
}

// ---------------------------------------------------------------- humans & vehicles (see character.js / cars.js)
export { makeHumanoid, makeFPArm } from './character.js';
export { makeVehicle } from './cars.js';

// ---------------------------------------------------------------- animals (see animals.js)
export { makeAnimal } from './animals.js';

// ---------------------------------------------------------------- building pieces
export const TIER_MATS = TIERS.map((t) => new THREE.MeshLambertMaterial({ color: t.color, flatShading: true }));
// Building piece geometry with per-tier surface detail (planks, stone blocks, metal panels, armour plates)
export function pieceGeometry(type, tier = 1) {
  return cached(`piece_${type}_${tier}`, () => {
    const parts = [];
    if (type === 'raft') {
      // compact raft: a lashed plank deck on three beams, floating on four barrels
      for (let k = 0; k < 7; k++) parts.push(part(box(0.4, 0.07, 2.96), k % 2 ? 0x9a6a3c : 0x8a5c32, { x: -1.29 + k * 0.43, y: -0.035 }, 0.15));
      for (const z of [-1.2, 0, 1.2]) parts.push(part(box(3.0, 0.12, 0.16), 0x5e3c22, { y: -0.13, z }));
      for (const [x, z] of [[-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0], [1.0, 1.0]]) {
        parts.push(part(cyl(0.3, 0.3, 0.9, 12), 0x3a6a8a, { x, y: -0.42, z, rx: Math.PI / 2 }));
        for (const dz of [-0.3, 0.3]) parts.push(part(cyl(0.31, 0.31, 0.05, 12), 0x24282c, { x, y: -0.42, z: z + dz, rx: Math.PI / 2 }));
      }
      for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) parts.push(part(cyl(0.05, 0.05, 0.12, 6), 0xb89a62, { x, y: -0.05, z }));
      return merge(parts);
    }
    if (type === 'dock') {
      // a wooden pier: plank deck, stringers, four pilings down into the water, cleats at the corners
      for (let k = 0; k < 7; k++) parts.push(part(box(0.4, 0.06, 2.96), k % 2 ? 0x9a6a3c : 0x8a5c32, { x: -1.29 + k * 0.43, y: -0.03 }, 0.15));
      for (const z of [-1.3, 1.3]) parts.push(part(box(3.0, 0.14, 0.16), 0x5e3c22, { y: -0.13, z }));
      for (const [x, z] of [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35]]) { parts.push(part(cyl(0.12, 0.14, 6, 8), 0x4a3020, { x, y: -3.0, z })); parts.push(part(box(0.18, 0.06, 0.08), 0x2a2a2a, { x: x * 0.9, y: 0.04, z: z * 0.9 })); }
      return merge(parts);
    }
    if (type === 'moonpool') {
      // a moonpool: steel deck with hazard-ringed bay doors (a Mini Sub comes up through them), a cradle and a console
      parts.push(part(box(3.0, 0.2, 3.0), 0x6a7078, { y: -0.1 }));
      parts.push(part(box(2.2, 0.03, 2.6), 0x3a4048, { y: 0.01 }));
      for (const sx of [-1, 1]) { parts.push(part(box(0.08, 0.035, 2.7), 0xe8b020, { x: sx * 1.12, y: 0.02 })); parts.push(part(box(2.3, 0.035, 0.08), 0xe8b020, { y: 0.02, z: sx * 1.33 })); }
      parts.push(part(box(0.03, 0.04, 2.5), 0x40c0ff, { y: 0.03 }));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(box(0.16, 0.5, 0.16), 0x3a3e44, { x: sx * 0.75, y: 0.25, z: sz * 0.9 }), part(box(0.5, 0.08, 0.2), 0x8a9096, { x: sx * 0.55, y: 0.5, z: sz * 0.9 }));
      parts.push(part(box(0.32, 1.1, 0.32), 0x2a2e33, { x: 1.25, y: 0.55, z: -1.25 }), part(box(0.28, 0.24, 0.04), 0x2ad0ff, { x: 1.25, y: 0.95, z: -1.08, rx: -0.3 }));
      for (const [x, z] of [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35]]) parts.push(part(cyl(0.16, 0.18, 5, 8), 0x5a6068, { x, y: -2.7, z }));
      return merge(parts);
    }
    if (type === 'sub_dock') {
      // the Pacific docking arm's base: a gate frame on the edge you walk through, with the hydraulic drum on top (the arm itself is added per piece)
      for (const sx of [-1, 1]) parts.push(part(box(0.2, 2.1, 0.6), 0x8a9096, { x: sx * 0.72, y: 1.05 }), part(box(0.22, 0.1, 0.62), 0xe8b020, { x: sx * 0.72, y: 0.05 }), part(box(0.04, 1.6, 0.06), 0xe8b020, { x: sx * 0.61, y: 1.05, z: 0.31 }));
      parts.push(part(box(1.64, 0.2, 0.6), 0x8a9096, { y: 2.2 }), part(box(1.66, 0.06, 0.62), 0xe8b020, { y: 2.32 }));
      parts.push(part(cyl(0.22, 0.22, 1.4, 12), 0x3a3e44, { y: 2.5, rz: Math.PI / 2 }), part(box(0.4, 0.14, 0.04), 0x40e070, { y: 2.05, z: 0.31 }));
      return merge(parts);
    }
    const col = TIERS[tier].color;
    const dk = new THREE.Color(col).multiplyScalar(0.7).getHex(), lt = new THREE.Color(col).multiplyScalar(1.15).getHex();
    for (const [cx, cy, cz, hx, hy, hz] of pieceBoxes(type)) {
      const h = [hx, hy, hz], c = [cx, cy, cz];
      if (tier === 0) {
        // twig: a solid woven panel of sticks inside a lashed frame (not see-through)
        const st = 0.07, stick = 0x9a7a4a;
        parts.push(part(box(Math.max(0.05, hx * 2 - 0.03), Math.max(0.05, hy * 2 - 0.03), Math.max(0.05, hz * 2 - 0.03)), 0xb08a52, { x: cx, y: cy, z: cz }, 0.18));
        {
          const thinAx = h.indexOf(Math.min(...h));
          const along = thinAx === 1 ? 0 : (thinAx === 0 ? 2 : 0); // sticks run horizontally
          const across = thinAx === 1 ? 2 : 1;
          for (let t = -h[across] + 0.09; t < h[across] - 0.05; t += 0.14) for (const sg of [-1, 1]) {
            const sz = [0.035, 0.035, 0.035], p = [cx, cy, cz];
            sz[along] = h[along] * 2 - 0.02; p[across] += t; p[thinAx] += sg * h[thinAx];
            parts.push(part(box(sz[0], sz[1], sz[2]), Math.random() < 0.5 ? 0x8a6a3e : 0xa07a48, { x: p[0], y: p[1], z: p[2] }, 0.15));
          }
        }
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
        else if (tier === 5) {
          // welded panels with bolted seams and rubber gaskets; walls get a round porthole
          for (const f of [-1 / 3, 1 / 3]) strip(f * U, 0, 0.05, V - 0.02, dk, 0.02);
          strip(0, V / 2 - 0.05, U - 0.02, 0.07, 0x1a1d1f, 0.02); strip(0, -V / 2 + 0.05, U - 0.02, 0.07, 0x1a1d1f, 0.02);
          for (let q = -U / 2 + 0.15; q < U / 2; q += 0.3) { strip(q, V / 2 - 0.15, 0.04, 0.04, lt, 0.028); strip(q, -V / 2 + 0.15, 0.04, 0.04, lt, 0.028); }
          if (ax !== 1 && type === 'wall' && U > 2.5) { strip(0, 0.15, 0.62, 0.62, 0xb08a3a, 0.03); strip(0, 0.15, 0.48, 0.48, 0x9fd8e8, 0.04); }
        }
        else { strip(0, 0, U - 0.02, 0.06, dk, 0.02); strip(0, 0, 0.06, V - 0.02, dk, 0.02); for (const a of [-1, 1]) for (const b of [-1, 1]) { strip(a * U / 4, b * V / 4, U / 2 - 0.12, V / 2 - 0.12, lt, 0.03); strip(a * (U / 2 - 0.12), b * (V / 2 - 0.12), 0.07, 0.07, dk, 0.04); } }
      }
    }
    if (type === 'foundation' && tier > 0) parts.push(part(box(3.06, 0.12, 3.06), dk, { y: -0.06 }));
    if (type === 'roof') {
      parts.push(part(new THREE.ConeGeometry(2.13, 1.15, 4, 1), tier === 0 ? 0x9a7a4a : col, { y: 0.575, ry: Math.PI / 4 }, 0.05));
      parts.push(part(new THREE.ConeGeometry(0.12, 0.3, 4), dk, { y: 1.2, ry: Math.PI / 4 }));
    }
    return merge(parts);
  });
}
// Reinforcement overlay: level 1 = steel X-braces & corner brackets, level 2 = + plating bands and rivets
export function reinforceGeometry(type, level) {
  return cached(`reinf_${type}_${level}`, () => {
    const parts = [];
    const steel = 0x4a4f55, light = 0x8a9096;
    for (const [cx, cy, cz, hx, hy, hz] of pieceBoxes(type)) {
      const h = [hx, hy, hz], c = [cx, cy, cz];
      for (let ax = 0; ax < 3; ax++) for (const sgn of [-1, 1]) {
        if (ax === 1 && sgn < 0) continue;
        const others = [0, 1, 2].filter((k) => k !== ax);
        if (h[others[0]] < 0.3 || h[others[1]] < 0.3) continue;
        const u = ax === 1 ? 0 : others.find((k) => k !== 1), v = ax === 1 ? 2 : 1;
        const U = h[u] * 2, V = h[v] * 2, d = 0.03;
        const put = (uc, vc, ul, vl, color, rot = 0, depth = d) => {
          const sz = [0, 0, 0], p = [...c];
          sz[u] = ul; sz[v] = vl; sz[ax] = depth * 2; p[u] += uc; p[v] += vc; p[ax] += sgn * (h[ax] + depth * 0.5);
          const t = { x: p[0], y: p[1], z: p[2] };
          if (rot) { if (ax === 2) t.rz = rot; else if (ax === 0) t.rx = rot; else t.ry = rot; }
          parts.push(part(box(sz[0], sz[1], sz[2]), color, t));
        };
        const diag = Math.hypot(U, V) - 0.1, ang = Math.atan2(V, U);
        put(0, 0, diag, 0.07, steel, ang); put(0, 0, diag, 0.07, steel, -ang);
        for (const a of [-1, 1]) for (const b of [-1, 1]) put(a * (U / 2 - 0.12), b * (V / 2 - 0.12), 0.22, 0.22, steel, 0, d * 1.3);
        put(0, 0, 0.2, 0.2, light, 0, d * 1.6);
        if (level >= 2) {
          for (const f of [-1 / 3, 1 / 3]) put(0, f * V, U - 0.04, 0.16, steel, 0, d * 1.2);
          for (const f of [-1 / 3, 1 / 3]) for (let q = -U / 2 + 0.25; q < U / 2 - 0.1; q += 0.5) put(q, f * V, 0.05, 0.05, light, 0, d * 2);
        }
      }
    }
    return parts.length ? merge(parts) : null;
  });
}

export const DOOR_MATS = { wood: new THREE.MeshLambertMaterial({ color: 0x7a5232, flatShading: true }), metal: new THREE.MeshLambertMaterial({ color: 0x6f7880, flatShading: true }), armored: new THREE.MeshLambertMaterial({ color: 0x3c444c, flatShading: true }), sealed: new THREE.MeshLambertMaterial({ color: 0x35606c, flatShading: true }) };
export function makeDoor(tier) {
  const g = new THREE.Group();
  const pivot = new THREE.Group(); pivot.position.set(-0.6, 0, 0); g.add(pivot);
  const slab = new THREE.Mesh(box(1.2, 2.2, 0.1), DOOR_MATS[tier] || DOOR_MATS.wood); slab.position.set(0.6, 1.1, 0); slab.castShadow = true; pivot.add(slab);
  const handle = new THREE.Mesh(box(0.06, 0.06, 0.25), new THREE.MeshLambertMaterial({ color: 0x222222 })); handle.position.set(1.05, 1.0, 0); pivot.add(handle);
  if (tier !== 'wood') { const band = new THREE.Mesh(box(1.22, 0.1, 0.12), new THREE.MeshLambertMaterial({ color: 0x333333 })); band.position.set(0.6, 0.5, 0); pivot.add(band); const b2 = band.clone(); b2.position.y = 1.7; pivot.add(b2); }
  if (tier === 'sealed') {
    const rub = new THREE.MeshLambertMaterial({ color: 0x1a1d1f }), brass = new THREE.MeshLambertMaterial({ color: 0xb08a3a });
    const gasket = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 4, 16), rub); gasket.scale.set(1, 1.9, 1); gasket.position.set(0.6, 1.1, 0.06); pivot.add(gasket);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 4, 10), brass); wheel.position.set(0.6, 1.15, 0.1); pivot.add(wheel);
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(box(0.34, 0.025, 0.025), brass); sp.position.set(0.6, 1.15, 0.1); sp.rotation.z = k * Math.PI / 3; pivot.add(sp); }
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshPhongMaterial({ color: 0x9fd8e8, shininess: 120, emissive: 0x0a2a30 })); port.position.set(0.6, 1.7, 0.056); pivot.add(port);
  }
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
      case 'shaft': {
        const parts = [part(cyl(1.15, 1.15, 0.04, 12), 0x050403, { y: 0.02 })];
        for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; parts.push(part(box(2.0, 0.22, 0.22), 0x6a4a2a, { x: Math.cos(a) * 1.05, y: 0.11, z: Math.sin(a) * 1.05, ry: -a + Math.PI / 2 })); }
        for (const sx of [-0.3, 0.3]) parts.push(part(box(0.08, 1.2, 0.08), 0x7a5534, { x: sx, y: 0.5, z: 0.0 }));
        for (let y = 0.3; y < 1.1; y += 0.35) parts.push(part(box(0.6, 0.05, 0.06), 0x7a5534, { y, z: 0 }));
        parts.push(part(box(0.15, 0.6, 0.15), 0x5a5048, { x: 1.3, y: 0.3, z: 0.6 }), part(cyl(0.12, 0.12, 0.3, 6), 0xb89a62, { x: 1.3, y: 0.75, z: 0.6 }));
        return merge(parts);
      }
      case 'gunsmith': {
        const steel = 0x5a6068, dark = 0x2a2c30, wood = 0x7a5534;
        const parts = [
          part(box(2.1, 0.08, 1.0), dark, { y: 0.9 }), part(box(2.08, 0.04, 0.98), wood, { y: 0.96 }),
          ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => part(box(0.08, 0.9, 0.08), steel, { x: sx * 0.98, y: 0.45, z: sz * 0.44 })),
          part(box(2.0, 0.05, 0.9), steel, { y: 0.25 }), part(box(0.6, 0.35, 0.8), 0x7a2020, { x: -0.65, y: 0.45 }),   // drawer cabinet
          ...[0.33, 0.47, 0.6].map((y) => part(box(0.58, 0.02, 0.02), 0xc0c0c0, { x: -0.65, y, z: -0.41 })),
          part(box(2.0, 1.0, 0.06), 0x9a8a6a, { y: 1.5, z: 0.48 }),                                                       // pegboard
          ...Array.from({ length: 24 }, (_, i) => part(box(0.02, 0.02, 0.02), 0x3a3020, { x: -0.9 + (i % 8) * 0.25, y: 1.15 + Math.floor(i / 8) * 0.3, z: 0.44 })),
          // a rifle on the wall rack
          part(box(1.1, 0.05, 0.04), dark, { x: 0.1, y: 1.72, z: 0.42 }), part(box(0.3, 0.1, 0.045), wood, { x: -0.55, y: 1.68, z: 0.42 }), part(box(0.05, 0.14, 0.04), dark, { x: 0.05, y: 1.62, z: 0.42 }),
          ...[-0.4, 0.4].map((x) => part(box(0.04, 0.08, 0.08), steel, { x, y: 1.68, z: 0.44 })),
          // vise
          part(box(0.18, 0.12, 0.14), 0x2a5a8a, { x: 0.75, y: 1.04, z: -0.3 }), part(box(0.2, 0.1, 0.06), 0x2a5a8a, { x: 0.75, y: 1.1, z: -0.4 }), part(cyl(0.012, 0.012, 0.3, 6), 0xc0c0c0, { x: 0.75, y: 1.08, z: -0.52, rx: Math.PI / 2 }),
          // tools, parts and a scope on the bench
          part(box(0.3, 0.04, 0.08), 0xb02a20, { x: 0.2, y: 1.0, z: -0.2, ry: 0.3 }), part(cyl(0.03, 0.03, 0.25, 10), dark, { x: -0.2, y: 1.01, z: -0.15, rz: Math.PI / 2 }), part(cyl(0.04, 0.03, 0.05, 10), dark, { x: -0.06, y: 1.01, z: -0.15, rz: Math.PI / 2 }),
          part(box(0.12, 0.08, 0.2), 0x4a4e52, { x: 0.45, y: 1.02, z: 0.1 }), part(box(0.06, 0.12, 0.03), 0x1e1f21, { x: 0.25, y: 1.04, z: 0.15, rz: 0.3 }),
          // lamp arm
          part(cyl(0.015, 0.015, 0.7, 6), steel, { x: -0.85, y: 1.3, z: -0.1 }), part(cyl(0.012, 0.012, 0.5, 6), steel, { x: -0.65, y: 1.62, z: -0.1, rz: -1.1 }), part(cone(0.1, 0.12, 8), 0xd8b030, { x: -0.43, y: 1.6, z: -0.1, rz: Math.PI }),
        ];
        return merge(parts);
      }
      case 'small_box': return merge([part(box(0.9, 0.6, 0.6), 0x8a6238, { y: 0.3 }, 0.08), part(box(0.92, 0.06, 0.62), 0x5a3e22, { y: 0.45 })]);
      case 'ladder': {
        const W = 0x7a5534;
        return merge([part(box(0.07, 3.2, 0.07), W, { x: -0.25, y: 1.6 }), part(box(0.07, 3.2, 0.07), W, { x: 0.25, y: 1.6 }), ...[0.3, 0.7, 1.1, 1.5, 1.9, 2.3, 2.7, 3.1].map((y) => part(box(0.5, 0.05, 0.06), 0x8a6544, { y }))]);
      }
      case 'wall_torch': return merge([part(box(0.05, 0.4, 0.05), 0x6a4a2a, { y: 0.2, rx: -0.3, z: -0.03 }), part(box(0.09, 0.1, 0.09), 0x3a2a1a, { y: 0.42, z: 0.03 }), part(new THREE.IcosahedronGeometry(0.07, 0), 0xffb040, { y: 0.52, z: 0.04 })]);
      case 'fabricator': {
        // a wall-mounted fabricator: white housing, a glowing print bay with nozzle arms, a screen
        const W = 0xe4e6e4, D = 0x3a3e44;
        return merge([part(box(1.0, 1.7, 0.55), W, { y: 0.85 }), part(box(0.8, 0.7, 0.05), D, { y: 0.95, z: 0.26 }), part(box(0.7, 0.05, 0.4), 0x40e0ff, { y: 0.65, z: 0.05 }),
          part(box(0.06, 0.06, 0.4), 0x9aa2aa, { x: -0.25, y: 1.2, z: 0.05 }), part(box(0.06, 0.06, 0.4), 0x9aa2aa, { x: 0.25, y: 1.2, z: 0.05 }), part(box(0.4, 0.22, 0.04), 0x1a6a8a, { y: 1.5, z: 0.28 }), part(box(1.04, 0.08, 0.6), 0xe07a20, { y: 0.06 })]);
      }
      // ---- machines (front faces +z; wall-mounted ones are centred on their depth, the building code pushes them flush)
      case 'portable_refiner': {
        const O = 0xd8862a, D = 0x3a3e44, M = 0x9aa2aa;
        return merge([part(box(0.8, 0.12, 0.6), D, { y: 0.06 }), part(cyl(0.26, 0.3, 0.6, 10), O, { x: -0.15, y: 0.42 }), part(cyl(0.27, 0.27, 0.06, 10), D, { x: -0.15, y: 0.74 }),
          part(box(0.3, 0.45, 0.4), M, { x: 0.22, y: 0.35 }), part(box(0.2, 0.12, 0.02), 0x40e070, { x: 0.22, y: 0.45, z: 0.21 }), part(cyl(0.04, 0.04, 0.5, 6), M, { x: -0.15, y: 1.0 }),
          part(cyl(0.035, 0.035, 0.35, 6), M, { x: 0.05, y: 0.62, rz: Math.PI / 2 })]);
      }
      case 'refinery': {
        const W = 0x8a9096, D = 0x2e3236, O = 0xe07a20;
        return merge([part(box(1.5, 1.6, 0.7), W, { y: 0.8 }), part(box(1.3, 0.5, 0.04), D, { y: 1.15, z: 0.36 }), part(box(0.5, 0.3, 0.03), 0x2ad0ff, { x: -0.35, y: 1.15, z: 0.38 }),
          part(cyl(0.22, 0.22, 0.55, 12), O, { x: 0.35, y: 0.45, z: 0.25 }), part(cyl(0.22, 0.22, 0.55, 12), O, { x: -0.35, y: 0.45, z: 0.25 }), part(box(1.52, 0.08, 0.72), O, { y: 1.62 }),
          part(cyl(0.05, 0.05, 1.4, 6), 0xb8bcc0, { y: 0.9, z: 0.37, rz: Math.PI / 2 }), part(box(0.12, 0.12, 0.03), 0x40e070, { x: 0.55, y: 1.42, z: 0.37 })]);
      }
      case 'desalinator': {
        const W = 0xdfe6ea, B = 0x2a7ab8, D = 0x2e3236;
        return merge([part(box(1.1, 1.4, 0.55), W, { y: 0.7 }), part(cyl(0.18, 0.18, 1.0, 12), B, { x: -0.3, y: 0.75, z: 0.22 }), part(cyl(0.18, 0.18, 1.0, 12), B, { x: 0.05, y: 0.75, z: 0.22 }),
          part(box(0.3, 0.5, 0.04), D, { x: 0.38, y: 0.95, z: 0.29 }), part(box(0.2, 0.12, 0.03), 0x40c0ff, { x: 0.38, y: 1.05, z: 0.31 }), part(cyl(0.06, 0.06, 0.6, 6), 0x9aa2aa, { x: 0.38, y: 0.25, z: 0.2 }),
          part(box(1.12, 0.07, 0.57), B, { y: 1.42 })]);
      }
      case 'solar_panel': {
        const parts = [part(cyl(0.05, 0.06, 0.9, 6), 0x9aa2aa, { y: 0.45 }), part(box(0.5, 0.06, 0.5), 0x3a3e44, { y: 0.03 }), part(box(1.6, 0.05, 1.0), 0xb8bcc0, { y: 1.0, rx: -0.45 })];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) parts.push(part(box(0.48, 0.02, 0.42), 0x16306a, { x: -0.52 + i * 0.52, y: 1.03 + (j - 0.5) * 0.44 * Math.sin(0.45), z: (j - 0.5) * 0.44 * Math.cos(0.45), rx: -0.45 }));
        return merge(parts);
      }
      case 'fuel_generator': {
        const Y = 0xd8b020, D = 0x2e3236;
        return merge([part(box(1.1, 0.7, 0.7), Y, { y: 0.45 }), part(box(1.2, 0.1, 0.8), D, { y: 0.05 }), part(box(0.5, 0.4, 0.05), D, { x: -0.2, y: 0.5, z: 0.36 }),
          part(cyl(0.16, 0.16, 0.3, 10), 0x9aa2aa, { x: 0.35, y: 0.95 }), part(cyl(0.05, 0.05, 0.4, 6), 0x5a5e64, { x: -0.4, y: 0.95 }), part(box(0.1, 0.1, 0.03), 0xff4020, { x: 0.35, y: 0.55, z: 0.36 })]);
      }
      case 'battery_bank': {
        const parts = [part(box(1.0, 1.2, 0.4), 0x3a3e44, { y: 0.6 })];
        for (let i = 0; i < 4; i++) parts.push(part(box(0.2, 0.9, 0.06), 0x40c060, { x: -0.33 + i * 0.22, y: 0.6, z: 0.2 }), part(box(0.08, 0.06, 0.06), 0xb8bcc0, { x: -0.33 + i * 0.22, y: 1.1, z: 0.2 }));
        return merge(parts);
      }
      case 'charger': return merge([part(box(0.5, 0.7, 0.3), 0x2e3236, { y: 0.35 }), part(box(0.36, 0.25, 0.04), 0x40c0ff, { y: 0.5, z: 0.16 }), part(box(0.4, 0.06, 0.2), 0xe07a20, { y: 0.12, z: 0.1 }), part(box(0.06, 0.12, 0.03), 0x40e070, { x: 0.15, y: 0.25, z: 0.16 })]);
      case 'wall_light': return merge([part(box(0.3, 0.12, 0.15), 0x3a3e44, { y: 0.15 }), part(box(0.26, 0.06, 0.12), 0xfff2c8, { y: 0.07, z: 0.01 })]);
      case 'vehicle_bay': {
        // Mobile Vehicle Bay: a floating pad on four pontoons, hazard-striped rim, a console mast and a parked builder drone
        const Y = 0xe8b020, D = 0x2a2e33, W = 0xdfe3e3;
        const parts = [part(box(3.2, 0.16, 3.2), W, { y: 0.1 }), part(box(2.6, 0.02, 2.6), 0x3a4048, { y: 0.19 })];
        for (const [x, z] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) parts.push(part(cyl(0.38, 0.38, 0.9, 10), 0xe07a20, { x, y: -0.12, z, rx: Math.PI / 2 }));
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; parts.push(part(box(0.8, 0.05, 0.12), k % 2 ? Y : D, { x: Math.cos(a) * 1.45, y: 0.2, z: Math.sin(a) * 1.45, ry: -a + Math.PI / 2 })); }
        for (const s of [-1, 1]) { parts.push(part(box(3.2, 0.06, 0.12), Y, { y: 0.21, z: s * 1.56 })); parts.push(part(box(0.12, 0.06, 3.2), Y, { x: s * 1.56, y: 0.21 })); }
        parts.push(part(box(0.3, 1.2, 0.3), D, { x: 1.25, y: 0.8, z: -1.25 }), part(box(0.5, 0.35, 0.06), 0x2ad0ff, { x: 1.25, y: 1.3, z: -1.08, rx: -0.3 }));
        parts.push(part(cyl(0.32, 0.32, 0.14, 12), D, { y: 0.32 }), part(cyl(0.2, 0.26, 0.14, 12), 0x40c0ff, { y: 0.44 }));
        for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; parts.push(part(box(0.5, 0.04, 0.06), D, { x: Math.cos(a) * 0.4, y: 0.42, z: Math.sin(a) * 0.4, ry: -a }), part(cyl(0.12, 0.12, 0.03, 10), 0x9aa2aa, { x: Math.cos(a) * 0.62, y: 0.45, z: Math.sin(a) * 0.62 })); }
        return merge(parts);
      }
      case 'wall_locker': {
        const W = 0xd8dcd8, D = 0x4a4e54;
        return merge([part(box(0.9, 1.9, 0.5), W, { y: 0.95 }), part(box(0.02, 1.8, 0.02), D, { y: 0.95, z: 0.26 }), part(box(0.06, 0.25, 0.04), 0x9aa2aa, { x: 0.12, y: 1.0, z: 0.27 }), part(box(0.06, 0.25, 0.04), 0x9aa2aa, { x: -0.12, y: 1.0, z: 0.27 }),
          ...[0.35, 0.75, 1.15, 1.55].map((y) => part(box(0.7, 0.02, 0.02), D, { y, z: 0.26 }))]);
      }
      case 'hull_reinforcement': {
        // a welded steel rib frame braced against the wall
        const S = 0x6a7480;
        return merge([part(box(0.25, 2.9, 0.25), S, { x: -1.2, y: 1.45 }), part(box(0.25, 2.9, 0.25), S, { x: 1.2, y: 1.45 }), part(box(2.6, 0.25, 0.25), S, { y: 2.8 }), part(box(2.6, 0.25, 0.25), S, { y: 0.12 }),
          part(box(0.18, 3.3, 0.18), 0x8a929a, { y: 1.45, rz: 0.72 }), part(box(0.18, 3.3, 0.18), 0x8a929a, { y: 1.45, rz: -0.72 })]);
      }
      case 'large_box': return merge([part(box(1.5, 0.8, 0.9), 0x7a5532, { y: 0.4 }, 0.08), part(box(1.52, 0.06, 0.92), 0x4a3420, { y: 0.6 }), part(box(0.1, 0.82, 0.92), 0x4a3420, { y: 0.4 })]);
      case 'sleeping_bag': return merge([part(box(0.8, 0.15, 2), 0x4a6a8a, { y: 0.075 }, 0.05), part(box(0.7, 0.18, 0.4), 0xd8d0c0, { y: 0.1, z: -0.75 })]);
      case 'tool_cupboard': return merge([part(box(0.9, 1.8, 0.6), 0x6a5a40, { y: 0.9 }, 0.05), part(box(0.8, 0.05, 0.62), 0x3a3020, { y: 1.2 }), part(box(0.8, 0.05, 0.62), 0x3a3020, { y: 0.6 }), part(box(0.1, 0.1, 0.05), 0xd0b030, { x: 0.3, y: 1.0, z: 0.31 })]);
      case 'crate1': return merge([part(box(1.4, 0.8, 0.9), 0x8a7040, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x5a4a28, { y: 0.7 }), part(box(0.1, 0.82, 0.92), 0x5a4a28, { x: 0.5, y: 0.4 }), part(box(0.1, 0.82, 0.92), 0x5a4a28, { x: -0.5, y: 0.4 })]);
      case 'crate2': return merge([part(box(1.4, 0.8, 0.9), 0x4f5f35, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x2f3a20, { y: 0.7 }), part(box(0.4, 0.2, 0.02), 0xd0d0d0, { y: 0.45, z: 0.46 })]);
      case 'crate3': return merge([part(box(1.4, 0.8, 0.9), 0x2c3a4c, { y: 0.4 }, 0.06), part(box(1.42, 0.1, 0.92), 0x1a2230, { y: 0.7 }), part(box(0.5, 0.2, 0.02), 0xc8a030, { y: 0.45, z: 0.46 })]);
      // ---------------- furniture
      case 'chair': return merge([
        part(box(0.48, 0.05, 0.46), 0x8a5a32, { y: 0.45 }, 0.05), part(box(0.46, 0.5, 0.05), 0x7a4e2a, { y: 0.72, z: 0.22 }),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => part(box(0.05, 0.45, 0.05), 0x5e3c22, { x: a * 0.2, y: 0.22, z: b * 0.19 })),
        part(box(0.44, 0.04, 0.03), 0x5e3c22, { y: 0.85, z: 0.23 }), part(box(0.4, 0.06, 0.4), 0xa83a2a, { y: 0.49 }),
      ]);
      case 'table': return merge([
        part(box(1.5, 0.07, 0.9), 0x8a5a32, { y: 0.78 }, 0.04), part(box(1.4, 0.08, 0.8), 0x6a4226, { y: 0.71 }),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => part(box(0.08, 0.72, 0.08), 0x5e3c22, { x: a * 0.66, y: 0.36, z: b * 0.36 })),
        part(cyl(0.05, 0.06, 0.12, 8), 0xe8e0d0, { x: 0.3, y: 0.87 }), part(cyl(0.1, 0.1, 0.015, 12), 0xd8d0c0, { x: -0.3, y: 0.82, z: 0.1 }),
      ]);
      case 'bed': return merge([
        part(box(1.1, 0.25, 2.1), 0x6a4226, { y: 0.17 }, 0.04), part(box(1.04, 0.16, 2.0), 0xeeeae2, { y: 0.36 }),
        part(box(1.06, 0.07, 1.35), 0x3a5a8a, { y: 0.46, z: 0.3 }, 0.05), part(box(0.8, 0.1, 0.36), 0xf6f4ee, { y: 0.48, z: -0.75 }),
        part(box(1.14, 0.8, 0.08), 0x5e3c22, { y: 0.45, z: -1.06 }), part(box(1.14, 0.45, 0.08), 0x5e3c22, { y: 0.25, z: 1.06 }),
      ]);
      case 'sofa': return merge([
        part(box(1.9, 0.3, 0.85), 0x5a6a7a, { y: 0.2 }, 0.04), part(box(1.9, 0.55, 0.2), 0x4e5e6e, { y: 0.55, z: 0.34 }),
        ...[-1, 1].map((a) => part(box(0.2, 0.45, 0.85), 0x4e5e6e, { x: a * 0.85, y: 0.38 })),
        ...[-0.4, 0.4].map((x) => part(box(0.78, 0.12, 0.62), 0x66788a, { x, y: 0.41, z: -0.06 }, 0.04)),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => part(box(0.06, 0.06, 0.06), 0x2a2018, { x: a * 0.88, y: 0.03, z: b * 0.36 })),
      ]);
      case 'bookshelf': {
        const ps = [part(box(1.2, 1.9, 0.04), 0x5e3c22, { y: 0.95, z: 0.18 }), ...[-1, 1].map((a) => part(box(0.05, 1.9, 0.4), 0x6a4226, { x: a * 0.58, y: 0.95 }))];
        for (let i = 0; i < 5; i++) ps.push(part(box(1.15, 0.04, 0.38), 0x7a4e2a, { y: 0.03 + i * 0.46 }));
        const cols = [0xa83a2a, 0x2a5a8a, 0x3a7a3a, 0xc8a040, 0x6a3a7a, 0x8a6a4a];
        for (let sh = 0; sh < 4; sh++) for (let k = 0; k < 9; k++) { const w = 0.07 + ((k * 7 + sh) % 3) * 0.02, hgt = 0.28 + ((k + sh * 3) % 4) * 0.03; ps.push(part(box(w, hgt, 0.26), cols[(k + sh) % 6], { x: -0.5 + k * 0.115, y: 0.05 + sh * 0.46 + hgt / 2, z: -0.02 })); }
        return merge(ps);
      }
      case 'wardrobe': return merge([
        part(box(1.1, 2.0, 0.62), 0x7a4e2a, { y: 1.0 }, 0.04), part(box(0.005, 1.8, 0.01), 0x3a2414, { y: 1.0, z: -0.315 }),
        ...[-1, 1].map((a) => part(box(0.04, 0.2, 0.04), 0xc8a040, { x: a * 0.07, y: 1.05, z: -0.33 })),
        part(box(1.16, 0.08, 0.66), 0x5e3c22, { y: 2.02 }), part(box(1.14, 0.1, 0.64), 0x5e3c22, { y: 0.05 }),
      ]);
      case 'fridge': return merge([
        part(box(0.76, 1.8, 0.72), 0xe8eaec, { y: 0.9 }, 0.02), part(box(0.74, 0.01, 0.01), 0x9a9ea2, { y: 1.15, z: -0.365 }),
        part(box(0.04, 0.4, 0.05), 0xb0b4b8, { x: 0.3, y: 1.45, z: -0.38 }), part(box(0.04, 0.3, 0.05), 0xb0b4b8, { x: 0.3, y: 0.85, z: -0.38 }),
      ]);
      case 'rug': return merge([part(box(1.8, 0.02, 1.2), 0x8a2a2a, { y: 0.011 }), part(box(1.5, 0.022, 0.9), 0xc8a050, { y: 0.012 }), part(box(1.2, 0.024, 0.6), 0x2a3a6a, { y: 0.013 })]);
      case 'lamp': return merge([
        part(cyl(0.16, 0.18, 0.04, 12), 0x2a2a2a, { y: 0.02 }), part(cyl(0.02, 0.02, 1.5, 8), 0x3a3a3a, { y: 0.77 }),
        part(cyl(0.12, 0.22, 0.28, 14), 0xf0e0b8, { y: 1.55 }), part(ico(0.05, 1), 0xfff6c8, { y: 1.5 }),
      ]);
      case 'plant_pot': return merge([
        part(cyl(0.18, 0.13, 0.32, 12), 0xb0583a, { y: 0.16 }), part(cyl(0.165, 0.165, 0.02, 12), 0x4a3020, { y: 0.31 }),
        ...[0, 1, 2, 3, 4, 5, 6].map((i) => part(box(0.08, 0.015, 0.4), i % 2 ? 0x3a8a3a : 0x2f7030, { y: 0.48 + (i % 3) * 0.06, ry: i * 0.9, rx: 0.7, x: Math.sin(i * 0.9) * 0.1, z: Math.cos(i * 0.9) * 0.1 })),
      ]);
      case 'painting': return merge([
        part(box(0.9, 0.7, 0.05), 0x6a4226, { y: 1.4 }), part(box(0.8, 0.6, 0.055), 0x7ab0d8, { y: 1.4 }),
        part(box(0.8, 0.22, 0.057), 0x5a8a3a, { y: 1.19 }), part(cone(0.2, 0.3, 4), 0x8a8a8a, { y: 1.45, x: 0.15, z: -0.03, sz: 0.1 }), part(ico(0.06, 0), 0xf0d040, { x: -0.25, y: 1.58, z: -0.03 }),
        part(box(0.05, 1.2, 0.05), 0x5e3c22, { y: 0.6, z: 0.15, rx: -0.15 }), part(box(0.6, 0.05, 0.05), 0x5e3c22, { y: 1.02, z: 0.0 }),
      ]);
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
    if (p.k === 'cave') continue;
    if (p.k === 'box') parts.push(part(box(p.sx, p.sy, p.sz), p.color, { x: p.x, y: p.y, z: p.z, ry: p.yaw, rz: p.roll || 0 }, 0.06));
    else parts.push(part(cyl(p.r, p.r, p.h, 10), p.color, { x: p.x, y: p.y, z: p.z }, 0.05));
  }
  return parts.length ? merge(parts) : null;
}
