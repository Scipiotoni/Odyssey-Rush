// Low-poly procedural models built from primitives with vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TIERS, pieceBoxes } from '/shared/building.js';
import { VEHICLES } from '/shared/vehicles.js';
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
const dodec = (r) => new THREE.DodecahedronGeometry(r, 0);

// ---------------------------------------------------------------- nature
const cache = new Map();
function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

export function nodeGeometry(type) {
  return cached('node_' + type, () => {
    switch (type) {
      case 'tree_oak': return merge([
        part(cyl(0.22, 0.38, 4.2, 5), 0x6b4a2e, { y: 2.1 }),
        part(jitter(ico(2.4, 0), 0.35, 1), 0x3f7a2c, { y: 5.2, sy: 0.85 }, 0.15),
        part(jitter(ico(1.7, 0), 0.35, 2), 0x4a8a33, { x: 1.2, y: 4.4, z: 0.6 }, 0.15),
        part(jitter(ico(1.6, 0), 0.35, 3), 0x376b26, { x: -1.0, y: 4.6, z: -0.8 }, 0.15),
      ]);
      case 'tree_pine': return merge([
        part(cyl(0.18, 0.32, 3, 5), 0x5b3d24, { y: 1.5 }),
        part(cone(2.3, 3.6, 7), 0x1f5a35, { y: 3.8 }, 0.1),
        part(cone(1.8, 3.0, 7), 0x23653b, { y: 5.6 }, 0.1),
        part(cone(1.2, 2.6, 7), 0x287040, { y: 7.3 }, 0.1),
      ]);
      case 'tree_palm': {
        const parts = [];
        for (let i = 0; i < 5; i++) parts.push(part(cyl(0.17 - i * 0.015, 0.2 - i * 0.015, 1.9, 5), 0x8a6d45, { x: i * i * 0.06, y: 0.95 + i * 1.8, rz: -i * 0.07 }));
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          parts.push(part(box(0.7, 0.06, 3.2), 0x3e8a2e, { x: 1.5 + Math.sin(a) * 1.3, y: 9.2, z: Math.cos(a) * 1.3, ry: a, rx: 0.35 }, 0.15));
        }
        return merge(parts);
      }
      case 'tree_dead': return merge([
        part(cyl(0.15, 0.3, 5, 5), 0x5e5248, { y: 2.5 }),
        part(cyl(0.07, 0.12, 2.2, 4), 0x5e5248, { x: 0.7, y: 3.6, rz: -0.9 }),
        part(cyl(0.06, 0.1, 1.8, 4), 0x5e5248, { x: -0.6, y: 4.2, rz: 0.8 }),
        part(cyl(0.05, 0.08, 1.4, 4), 0x5e5248, { z: 0.5, y: 4.8, rx: 0.8 }),
      ]);
      case 'cactus': return merge([
        part(cyl(0.3, 0.35, 3, 6), 0x4f8a3a, { y: 1.5 }),
        part(cyl(0.18, 0.18, 0.8, 6), 0x4f8a3a, { x: 0.5, y: 1.4, rz: Math.PI / 2 }),
        part(cyl(0.18, 0.18, 1.0, 6), 0x4f8a3a, { x: 0.85, y: 1.9 }),
        part(cyl(0.16, 0.16, 0.6, 6), 0x4f8a3a, { x: -0.45, y: 1.9, rz: Math.PI / 2 }),
        part(cyl(0.16, 0.16, 0.8, 6), 0x4f8a3a, { x: -0.7, y: 2.3 }),
      ]);
      case 'rock_stone': return merge([part(jitter(dodec(1.25), 0.45, 4), 0x8d8a85, { y: 0.45, sy: 0.75 }, 0.12)]);
      case 'rock_metal': return merge([
        part(jitter(dodec(1.25), 0.45, 5), 0x6e6560, { y: 0.45, sy: 0.75 }, 0.12),
        part(dodec(0.3), 0xc0703a, { x: 0.8, y: 0.8, z: 0.3 }), part(dodec(0.25), 0xc0703a, { x: -0.5, y: 1.0, z: 0.6 }), part(dodec(0.28), 0xa86030, { x: 0.1, y: 1.1, z: -0.8 }),
      ]);
      case 'rock_sulfur': return merge([
        part(jitter(dodec(1.25), 0.45, 6), 0x7d7a68, { y: 0.45, sy: 0.75 }, 0.12),
        part(dodec(0.3), 0xe0d040, { x: 0.8, y: 0.8, z: 0.3 }), part(dodec(0.25), 0xd8c830, { x: -0.5, y: 1.0, z: 0.6 }), part(dodec(0.28), 0xe8d850, { x: 0.1, y: 1.1, z: -0.8 }),
      ]);
      case 'hemp': {
        const parts = [];
        for (let i = 0; i < 6; i++) { const a = i * 1.1; parts.push(part(cone(0.12, 1.3, 4), 0x6aa23c, { x: Math.cos(a) * 0.15, y: 0.65, z: Math.sin(a) * 0.15, rx: Math.cos(a) * 0.25, rz: Math.sin(a) * 0.25 }, 0.2)); }
        parts.push(part(ico(0.18, 0), 0xa8c860, { y: 1.35 }));
        return merge(parts);
      }
      case 'berry': {
        const parts = [part(jitter(ico(0.7, 0), 0.3, 7), 0x2f6b2a, { y: 0.55, sy: 0.8 }, 0.15)];
        for (let i = 0; i < 7; i++) { const a = i * 0.9; parts.push(part(ico(0.1, 0), 0x4050c0, { x: Math.cos(a) * 0.6, y: 0.5 + (i % 3) * 0.2, z: Math.sin(a) * 0.6 })); }
        return merge(parts);
      }
      case 'barrel': return merge([
        part(cyl(0.4, 0.4, 1.15, 8), 0x2d5d8a, { y: 0.575 }, 0.1),
        part(cyl(0.42, 0.42, 0.08, 8), 0x1d3d5a, { y: 0.3 }), part(cyl(0.42, 0.42, 0.08, 8), 0x1d3d5a, { y: 0.85 }),
      ]);
    }
    return merge([part(box(1, 1, 1), 0xff00ff)]);
  });
}

// ---------------------------------------------------------------- humans
const SKIN = 0xd9a77e, SHIRT = 0x6b6b5e, PANTS = 0x4a4a3e;
export function makeHumanoid() {
  const g = new THREE.Group();
  const mats = { skin: new THREE.MeshLambertMaterial({ color: SKIN, flatShading: true }), head: new THREE.MeshLambertMaterial({ color: SKIN, flatShading: true }), chest: new THREE.MeshLambertMaterial({ color: SHIRT, flatShading: true }), legs: new THREE.MeshLambertMaterial({ color: PANTS, flatShading: true }) };
  const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
  const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
  const torso = mk(box(0.5, 0.62, 0.28), mats.chest, 0, 0.33, 0); hips.add(torso);
  const head = mk(box(0.28, 0.3, 0.28), mats.head, 0, 0.82, 0); hips.add(head);
  const eyes = mk(box(0.2, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0x222222 }), 0, 0.85, -0.145); hips.add(eyes);
  const limb = (w, h, mat) => { const p = new THREE.Group(); const m = mk(box(w, h, w), mat, 0, -h / 2, 0); p.add(m); return p; };
  const armL = limb(0.16, 0.62, mats.chest); armL.position.set(-0.34, 0.6, 0); hips.add(armL);
  const armR = limb(0.16, 0.62, mats.chest); armR.position.set(0.34, 0.6, 0); hips.add(armR);
  const legL = limb(0.2, 0.92, mats.legs); legL.position.set(-0.13, 0.0, 0); hips.add(legL);
  const legR = limb(0.2, 0.92, mats.legs); legR.position.set(0.13, 0.0, 0); hips.add(legR);
  const hand = new THREE.Group(); hand.position.set(0, -0.6, -0.05); armR.add(hand);
  g.userData = { hips, torso, head, armL, armR, legL, legR, hand, mats, eyes };
  return g;
}
export function setHumanoidArmor(h, armorIds) {
  const { mats } = h.userData;
  const [head, chest, legs] = armorIds;
  mats.head.color.set(head ? ITEMS[head]?.armor?.color ?? SKIN : SKIN);
  mats.chest.color.set(chest ? ITEMS[chest]?.armor?.color ?? SHIRT : SHIRT);
  mats.legs.color.set(legs ? ITEMS[legs]?.armor?.color ?? PANTS : PANTS);
}

// ---------------------------------------------------------------- animals
export function makeAnimal(type, color, size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), flatShading: true });
  const s = size;
  const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const body = new THREE.Group(); g.add(body);
  let legH = 0.7 * s, bodyL = 1.3 * s, bodyH = 0.6 * s, bodyW = 0.5 * s;
  if (type === 'boar') { legH = 0.4 * s; bodyL = 1.2 * s; bodyH = 0.7 * s; bodyW = 0.6 * s; }
  if (type === 'bear') { legH = 0.65 * s; bodyL = 1.4 * s; bodyH = 0.9 * s; bodyW = 0.85 * s; }
  if (type === 'wolf') { legH = 0.6 * s; bodyL = 1.2 * s; bodyH = 0.45 * s; bodyW = 0.38 * s; }
  add(box(bodyW, bodyH, bodyL), mat, 0, legH + bodyH / 2, 0, body);
  const neck = new THREE.Group(); neck.position.set(0, legH + bodyH * 0.8, bodyL / 2); body.add(neck);
  const headSize = type === 'bear' ? 0.5 * s : 0.35 * s;
  add(box(headSize, headSize, headSize * 1.4), mat, 0, type === 'deer' ? 0.35 * s : 0.05, headSize * 0.5, neck);
  add(box(headSize * 0.5, headSize * 0.45, headSize * 0.5), dark, 0, type === 'deer' ? 0.28 * s : 0, headSize * 1.3, neck);
  if (type === 'deer') { add(box(0.18 * s, 0.6 * s, 0.18 * s), mat, 0, 0.1 * s, 0.05, neck); add(cyl(0.02, 0.03, 0.5, 4), dark, 0.12, 0.75 * s, 0.1, neck).rotation.z = -0.4; add(cyl(0.02, 0.03, 0.5, 4), dark, -0.12, 0.75 * s, 0.1, neck).rotation.z = 0.4; }
  if (type === 'boar') { add(box(0.04, 0.12, 0.04), new THREE.MeshLambertMaterial({ color: 0xeeeedd }), 0.1, -0.05, headSize * 1.5, neck); add(box(0.04, 0.12, 0.04), new THREE.MeshLambertMaterial({ color: 0xeeeedd }), -0.1, -0.05, headSize * 1.5, neck); }
  if (type === 'wolf') { add(cone(0.06, 0.15, 4), dark, 0.09, 0.25, 0.1, neck); add(cone(0.06, 0.15, 4), dark, -0.09, 0.25, 0.1, neck); }
  const tail = add(box(0.08 * s, 0.08 * s, type === 'wolf' ? 0.5 * s : 0.2 * s), dark, 0, legH + bodyH * 0.8, -bodyL / 2 - 0.1, body);
  tail.rotation.x = 0.5;
  const legs = [];
  for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = new THREE.Group(); p.position.set(lx * bodyW * 0.32, legH, lz * bodyL * 0.38); body.add(p);
    add(box(0.14 * s, legH, 0.14 * s), dark, 0, -legH / 2, 0, p);
    legs.push(p);
  }
  g.userData = { legs, neck, body };
  return g;
}

// ---------------------------------------------------------------- vehicles
export function makeVehicle(type) {
  const def = VEHICLES[type];
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const [hx, hy, hz] = def.half;
  const paintMat = new THREE.MeshLambertMaterial({ color: def.color, flatShading: true });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, flatShading: true });
  const metal = new THREE.MeshLambertMaterial({ color: 0x8a8f94, flatShading: true });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9cc4d8, flatShading: true, transparent: true, opacity: 0.55 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  const add = (geo, mat, x, y, z, rx = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  if (type === 'quad') {
    add(box(hx * 1.4, hy * 0.8, hz * 1.6), paintMat, 0, 0, 0);
    add(box(0.5, 0.25, 0.9), darkMat, 0, 0.3, -0.15);
    add(box(hx * 1.9, 0.08, 0.6), paintMat, 0, 0.12, 0.75); add(box(hx * 1.9, 0.08, 0.6), paintMat, 0, 0.12, -0.75);
    add(cyl(0.03, 0.03, 0.9, 4), metal, 0, 0.55, 0.5, 0).rotation.z = Math.PI / 2;
    add(box(0.15, 0.1, 0.05), lightMat, 0.2, 0.15, 1.0); add(box(0.15, 0.1, 0.05), lightMat, -0.2, 0.15, 1.0);
  } else if (type === 'buggy') {
    add(box(hx * 1.7, 0.25, hz * 1.9), paintMat, 0, -0.15, 0);
    add(box(hx * 1.5, 0.35, 0.9), paintMat, 0, 0.1, 1.2);
    add(box(hx * 1.5, 0.5, 0.9), darkMat, 0, 0.15, -1.25);
    for (const sx of [-1, 1]) {
      add(cyl(0.05, 0.05, 1.3, 5), metal, sx * 0.8, 0.75, 0.25);
      add(cyl(0.05, 0.05, 1.3, 5), metal, sx * 0.8, 0.75, -0.6);
      const top = add(cyl(0.05, 0.05, 0.9, 5), metal, sx * 0.8, 1.38, -0.18); top.rotation.x = Math.PI / 2;
      add(box(0.45, 0.5, 0.15), darkMat, sx * 0.42, 0.25, -0.35);
    }
    add(box(1.65, 0.06, 0.06), metal, 0, 1.38, 0.25); add(box(1.65, 0.06, 0.06), metal, 0, 1.38, -0.6);
    add(box(0.18, 0.12, 0.05), lightMat, 0.5, 0.2, 1.66); add(box(0.18, 0.12, 0.05), lightMat, -0.5, 0.2, 1.66);
  } else {
    add(box(hx * 2, 0.7, hz * 2), paintMat, 0, -0.05, 0);
    add(box(hx * 1.9, 0.75, 1.9), paintMat, 0, 0.65, 0.3);
    add(box(hx * 1.75, 0.6, 0.06), glass, 0, 0.68, 1.27, -0.25);
    add(box(0.06, 0.45, 1.5), glass, hx * 0.96, 0.7, 0.3); add(box(0.06, 0.45, 1.5), glass, -hx * 0.96, 0.7, 0.3);
    add(box(hx * 2, 0.4, 0.08), paintMat, 0, 0.5, -hz + 0.04); add(box(0.08, 0.4, 2.2), paintMat, hx - 0.04, 0.5, -1.45); add(box(0.08, 0.4, 2.2), paintMat, -hx + 0.04, 0.5, -1.45);
    add(box(hx * 2.05, 0.2, 0.25), darkMat, 0, -0.25, hz + 0.05);
    add(box(0.25, 0.15, 0.05), lightMat, 0.7, 0.15, hz + 0.01); add(box(0.25, 0.15, 0.05), lightMat, -0.7, 0.15, hz + 0.01);
    add(box(0.25, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xaa1010 }), 0.8, 0.15, -hz - 0.01); add(box(0.25, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xaa1010 }), -0.8, 0.15, -hz - 0.01);
    add(box(1.9, 0.06, 0.06), metal, 0, 1.15, -0.9); add(cyl(0.04, 0.04, 0.6, 4), metal, 0.9, 0.9, -0.9); add(cyl(0.04, 0.04, 0.6, 4), metal, -0.9, 0.9, -0.9);
  }
  // wheels
  const wheels = [];
  const wgeo = new THREE.CylinderGeometry(def.wheelR, def.wheelR, def.wheelR * 0.75, 10); wgeo.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(def.wheelR * 0.45, def.wheelR * 0.45, def.wheelR * 0.78, 6); hub.rotateZ(Math.PI / 2);
  for (const w of def.wheels) {
    const pivot = new THREE.Group(); pivot.position.set(w[0], w[1] - def.rest * 0.5, w[2]); g.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const tyre = new THREE.Mesh(wgeo, darkMat); tyre.castShadow = true; spin.add(tyre);
    spin.add(new THREE.Mesh(hub, metal));
    wheels.push({ pivot, spin, def: w });
  }
  // headlight
  const headlight = new THREE.SpotLight(0xfff0c0, 0, 45, 0.6, 0.5, 1.2);
  headlight.position.set(0, 0.3, hz); headlight.target.position.set(0, -0.5, hz + 10);
  body.add(headlight); body.add(headlight.target);
  g.userData = { body, wheels, paintMat, headlight };
  return g;
}

// ---------------------------------------------------------------- building pieces
export const TIER_MATS = TIERS.map((t, i) => new THREE.MeshLambertMaterial({ color: t.color, flatShading: true, transparent: i === 0, opacity: i === 0 ? 0.85 : 1 }));
export function pieceGeometry(type) {
  return cached('piece_' + type, () => {
    const parts = [];
    for (const [cx, cy, cz, hx, hy, hz] of pieceBoxes(type)) {
      const g = box(hx * 2, hy * 2, hz * 2); g.translate(cx, cy, cz); parts.push(g.index ? g.toNonIndexed() : g);
    }
    if (type === 'foundation') { const g = box(3.06, 0.12, 3.06); g.translate(0, -0.06, 0); parts.push(g.toNonIndexed()); }
    for (const p of parts) p.deleteAttribute('uv');
    const m = mergeGeometries(parts, false); m.computeVertexNormals(); m.computeBoundingSphere();
    return m;
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

// ---------------------------------------------------------------- held items (view models)
export function makeItemModel(id) {
  const g = new THREE.Group();
  const d = ITEMS[id];
  if (!d) return g;
  const wood = 0x7a5534, metal = d.tint || 0x9aa0a6, stone = 0x8a8680, dark = 0x2c2c2c;
  const M = (geo) => { const m = new THREE.Mesh(geo, MAT); m.castShadow = true; g.add(m); return m; };
  switch (id) {
    case 'rock': M(merge([part(jitter(dodec(0.12), 0.4, 3), stone)])); break;
    case 'torch': M(merge([part(cyl(0.025, 0.03, 0.6, 5), wood, { y: 0.1 }), part(cyl(0.05, 0.04, 0.12, 5), 0x9a8a6a, { y: 0.42 })])); {
      const f = new THREE.Mesh(cone(0.05, 0.18, 5), new THREE.MeshBasicMaterial({ color: 0xffa030 })); f.position.y = 0.56; g.add(f); g.userData.flame = f;
    } break;
    case 'stone_hatchet': case 'metal_hatchet': M(merge([part(cyl(0.022, 0.026, 0.6, 5), wood, { y: 0.1 }), part(box(0.04, 0.12, 0.16), id === 'stone_hatchet' ? stone : metal, { y: 0.34, z: -0.06 })])); break;
    case 'stone_pickaxe': case 'metal_pickaxe': M(merge([part(cyl(0.022, 0.026, 0.62, 5), wood, { y: 0.1 }), part(box(0.04, 0.05, 0.42), id === 'stone_pickaxe' ? stone : metal, { y: 0.38 })])); break;
    case 'shovel': M(merge([part(cyl(0.02, 0.024, 0.8, 5), wood, { y: 0.15 }), part(box(0.14, 0.03, 0.03), wood, { y: -0.24 }), part(box(0.16, 0.2, 0.02), metal, { y: 0.62, rx: 0.15 })])); break;
    case 'hammer': M(merge([part(cyl(0.02, 0.025, 0.45, 5), wood, { y: 0.05 }), part(box(0.07, 0.07, 0.2), metal, { y: 0.26 })])); break;
    case 'building_plan': M(merge([part(box(0.25, 0.01, 0.32), 0x3a6aa8, { rx: -0.5 }), part(box(0.2, 0.012, 0.02), 0xffffff, { rx: -0.5, y: 0.01 })])); break;
    case 'wooden_spear': M(merge([part(cyl(0.02, 0.025, 1.6, 5), wood, { y: 0.3 }), part(cone(0.03, 0.15, 4), 0x9a8060, { y: 1.15 })])); break;
    case 'machete': M(merge([part(box(0.035, 0.12, 0.035), dark, { y: 0 }), part(box(0.01, 0.5, 0.06), metal, { y: 0.3 })])); break;
    case 'bow': {
      const t = new THREE.TorusGeometry(0.4, 0.015, 4, 10, Math.PI * 0.9); t.rotateZ(Math.PI * 0.55);
      M(merge([part(t, wood, { rz: 0 }), part(box(0.003, 0.76, 0.003), 0xdddddd, { x: -0.08 })]));
    } break;
    case 'revolver': M(merge([part(box(0.04, 0.05, 0.24), dark, { y: 0.05, z: -0.06 }), part(cyl(0.035, 0.035, 0.06, 6), 0x555555, { y: 0.045, rx: Math.PI / 2 }), part(box(0.035, 0.11, 0.05), wood, { y: -0.03, z: 0.06, rx: -0.3 })])); break;
    case 'shotgun': M(merge([part(box(0.05, 0.06, 0.8), dark, { y: 0.05, z: -0.25 }), part(box(0.05, 0.04, 0.3), wood, { y: 0.0, z: -0.25 }), part(box(0.05, 0.1, 0.32), wood, { y: 0.0, z: 0.25 })])); break;
    case 'smg': M(merge([part(box(0.05, 0.08, 0.45), 0x3a3a3a, { y: 0.05, z: -0.1 }), part(box(0.03, 0.15, 0.04), dark, { y: -0.06, z: -0.05 }), part(box(0.035, 0.1, 0.05), dark, { y: -0.03, z: 0.1, rx: -0.3 }), part(box(0.02, 0.02, 0.15), 0x555555, { y: 0.06, z: -0.4 })])); break;
    case 'rifle': M(merge([part(box(0.05, 0.08, 0.6), 0x3a3a35, { y: 0.05, z: -0.15 }), part(box(0.04, 0.18, 0.06), dark, { y: -0.07, z: -0.12, rx: 0.2 }), part(box(0.045, 0.11, 0.25), wood, { y: 0.02, z: 0.25 }), part(box(0.02, 0.02, 0.25), 0x555555, { y: 0.06, z: -0.55 }), part(box(0.03, 0.04, 0.12), dark, { y: 0.11, z: -0.1 })])); break;
    case 'satchel': M(merge([part(box(0.22, 0.16, 0.1), 0x6a5a3a), part(box(0.04, 0.2, 0.02), 0x4a3a2a, { y: 0.12 })])); break;
    case 'c4': M(merge([part(box(0.22, 0.08, 0.14), 0xa8a070), part(box(0.08, 0.04, 0.06), dark, { y: 0.06 }), part(box(0.02, 0.02, 0.02), 0xff2020, { y: 0.085, x: 0.02 })])); break;
    case 'bandage': M(merge([part(cyl(0.05, 0.05, 0.08, 8), 0xf0f0f0, { rz: Math.PI / 2 })])); break;
    case 'medkit': M(merge([part(box(0.2, 0.14, 0.08), 0xd0d0d0), part(box(0.1, 0.03, 0.01), 0xd02020, { z: 0.045 }), part(box(0.03, 0.1, 0.01), 0xd02020, { z: 0.045 })])); break;
    default: {
      if (d.cat === 'food') M(merge([part(ico(0.07, 0), d.icon === '🫐' ? 0x4050c0 : 0xa04030)]));
      else if (d.cat === 'deployable') M(merge([part(box(0.18, 0.14, 0.14), 0x8a6238)]));
      else M(merge([part(box(0.12, 0.12, 0.12), 0x888888)]));
    }
  }
  return g;
}

// ---------------------------------------------------------------- POI props
export function poiGeometry(layout) {
  const parts = [];
  for (const p of layout.props) {
    if (p.k === 'box') parts.push(part(box(p.sx, p.sy, p.sz), p.color, { x: p.x, y: p.y, z: p.z, ry: p.yaw, rz: p.roll || 0 }, 0.06));
    else parts.push(part(cyl(p.r, p.r, p.h, 10), p.color, { x: p.x, y: p.y, z: p.z }, 0.05));
  }
  return parts.length ? merge(parts) : null;
}
