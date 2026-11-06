// Sculpted faceted wildlife (deer, boar, wolf, bear) with a real skeleton: body, neck, head, ears,
// tail and two-segment legs (hip + knee/hock), plus their procedural animation.
import * as THREE from 'three';
import { MAT, part, merge } from './models.js';

const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
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
const blob = (r, seed, amt = 0.16) => jit(ico(r, 1), amt, seed);
function joint(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
function mesh(parent, parts) { const m = new THREE.Mesh(merge(parts), MAT); m.castShadow = true; parent.add(m); return m; }

const SPEC = {
  // legH: hip height, bl/bh/bw: body length/height/width, nl: neck length, hs: head size
  deer: { legH: 0.78, bl: 1.25, bh: 0.5, bw: 0.42, nl: 0.55, neckUp: 0.95, hs: 0.26, thin: 0.075 },
  boar: { legH: 0.42, bl: 1.15, bh: 0.62, bw: 0.56, nl: 0.18, neckUp: 0.15, hs: 0.36, thin: 0.11 },
  wolf: { legH: 0.6, bl: 1.15, bh: 0.42, bw: 0.36, nl: 0.3, neckUp: 0.45, hs: 0.26, thin: 0.075 },
  bear: { legH: 0.62, bl: 1.4, bh: 0.86, bw: 0.82, nl: 0.25, neckUp: 0.2, hs: 0.42, thin: 0.17 },
};

export function makeAnimal(type, color, size = 1) {
  if (type === 'shark') return makeShark(color, size);
  if (type === 'cave_spider') return makeSpider(color, size);
  if (type === 'bat') return makeBat(color, size);
  const sp = SPEC[type] || SPEC.deer, s = size;
  const C = new THREE.Color(color);
  const main = C.getHex(), dark = C.clone().multiplyScalar(0.62).getHex(), darker = C.clone().multiplyScalar(0.42).getHex();
  const light = C.clone().lerp(new THREE.Color(0xf2e8d6), type === 'bear' ? 0.25 : 0.55).getHex();
  const nose = 0x1c1614, eye = 0x0a0a0a, hoof = 0x2a2018, bone = 0xe6dcc4;
  const g = new THREE.Group();
  const legH = sp.legH * s, bl = sp.bl * s, bh = sp.bh * s, bw = sp.bw * s;
  const body = joint(g, 0, legH, 0);
  // ---- torso: chest + hindquarters + belly, all faceted
  const torso = [
    part(blob(1, 1), main, { y: bh * 0.52, z: bl * 0.2, sx: bw * 0.55, sy: bh * 0.58, sz: bl * 0.36 }, 0.08),
    part(blob(1, 2), main, { y: bh * 0.5, z: -bl * 0.22, sx: bw * 0.5, sy: bh * 0.52, sz: bl * 0.34 }, 0.08),
    part(blob(1, 3), light, { y: bh * 0.22, z: 0, sx: bw * 0.42, sy: bh * 0.28, sz: bl * 0.4 }, 0.06),
  ];
  if (type === 'bear') torso.push(part(blob(1, 4), dark, { y: bh * 0.86, z: bl * 0.22, sx: bw * 0.45, sy: bh * 0.32, sz: bl * 0.22 }, 0.08)); // shoulder hump
  if (type === 'boar') for (let i = 0; i < 7; i++) torso.push(part(cone(0.05 * s, 0.16 * s, 4), darker, { y: bh * 1.02 - Math.abs(i - 2) * 0.02 * s, z: bl * (0.3 - i * 0.09), rx: -0.5 })); // bristle ridge
  if (type === 'wolf') torso.push(part(blob(1, 5), light, { y: bh * 0.62, z: bl * 0.33, sx: bw * 0.5, sy: bh * 0.5, sz: bl * 0.18 }, 0.1)); // ruff
  if (type === 'deer') torso.push(part(blob(1, 6), 0xf4eee2, { y: bh * 0.55, z: -bl * 0.47, sx: bw * 0.32, sy: bh * 0.3, sz: bl * 0.06 }, 0.04)); // white rump
  const chest = mesh(body, torso);

  // ---- neck + head
  const neck = joint(body, 0, bh * 0.68, bl * 0.4);
  const nl = sp.nl * s, nu = sp.neckUp;
  mesh(neck, [part(cyl(bw * 0.2, bw * 0.3, nl, 7), main, { y: Math.cos(nu) * nl * 0.5, z: Math.sin(nu) * nl * 0.5 * 0 + nl * 0.25, rx: 0.5 - nu * 0.3 }, 0.06)]);
  const head = joint(neck, 0, Math.cos(nu * 0.6) * nl * 0.95, nl * 0.45);
  const hs = sp.hs * s;
  const hp = [part(blob(1, 7, 0.12), main, { sx: hs * 0.58, sy: hs * 0.62, sz: hs * 0.75 }, 0.06)];
  const snoutL = type === 'wolf' ? 0.9 : type === 'deer' ? 0.8 : type === 'bear' ? 0.65 : 0.7;
  hp.push(part(blob(1, 8, 0.1), type === 'boar' ? dark : light, { y: -hs * 0.18, z: hs * snoutL, sx: hs * 0.34, sy: hs * 0.3, sz: hs * 0.5 }, 0.05));
  hp.push(part(type === 'boar' ? cyl(hs * 0.22, hs * 0.24, hs * 0.1, 8) : blob(1, 9, 0.1), nose, type === 'boar' ? { y: -hs * 0.18, z: hs * (snoutL + 0.48), rx: Math.PI / 2 } : { y: -hs * 0.1, z: hs * (snoutL + 0.42), sx: hs * 0.13, sy: hs * 0.1, sz: hs * 0.08 }));
  for (const sx of [-1, 1]) {
    hp.push(part(ico(hs * 0.075, 1), eye, { x: sx * hs * 0.36, y: hs * 0.12, z: hs * 0.42 }));
    if (type === 'boar') hp.push(part(cone(hs * 0.05, hs * 0.32, 5), bone, { x: sx * hs * 0.24, y: -hs * 0.12, z: hs * (snoutL + 0.2), rx: -1.1, rz: sx * 0.3 }));
    if (type === 'wolf') hp.push(part(cone(hs * 0.03, hs * 0.1, 3), 0xf4f0e8, { x: sx * hs * 0.12, y: -hs * 0.35, z: hs * (snoutL + 0.25), rx: Math.PI })); // fangs
  }
  if (type === 'deer') for (const sx of [-1, 1]) {
    // branching antlers
    const ap = (len, r, x, y, z, rx, rz) => hp.push(part(cyl(r * 0.6, r, len, 5), bone, { x, y, z, rx, rz }));
    ap(0.42 * s, 0.025 * s, sx * 0.07 * s, hs * 0.55 + 0.18 * s, 0, -0.35, -sx * 0.45);
    ap(0.3 * s, 0.018 * s, sx * 0.2 * s, hs * 0.55 + 0.38 * s, 0.05 * s, -0.9, -sx * 0.2);
    ap(0.26 * s, 0.016 * s, sx * 0.24 * s, hs * 0.55 + 0.46 * s, -0.08 * s, 0.3, -sx * 0.6);
    ap(0.2 * s, 0.014 * s, sx * 0.3 * s, hs * 0.55 + 0.58 * s, 0.02 * s, -0.4, -sx * 1.0);
  }
  mesh(head, hp);
  const ears = [-1, 1].map((sx) => {
    const e = joint(head, sx * hs * 0.38, hs * 0.42, -hs * 0.05);
    const tall = type === 'deer' ? 0.42 : type === 'wolf' ? 0.5 : type === 'bear' ? 0.22 : 0.34;
    mesh(e, [part(type === 'bear' ? ico(hs * 0.16, 0) : cone(hs * 0.15, hs * tall, 4), type === 'bear' ? dark : main, { y: hs * tall * 0.4, rz: -sx * (type === 'deer' ? 0.9 : 0.25), sz: 0.55 }),
      part(cone(hs * 0.08, hs * tall * 0.6, 3), light, { y: hs * tall * 0.34, z: hs * 0.03, rz: -sx * (type === 'deer' ? 0.9 : 0.25), sz: 0.4 })]);
    e.userData.side = sx;
    return e;
  });

  // ---- tail
  const tail = joint(body, 0, bh * 0.72, -bl * 0.5);
  const tp = [];
  if (type === 'wolf') { for (let i = 0; i < 4; i++) tp.push(part(blob(1, 20 + i, 0.2), i === 3 ? light : main, { y: -i * 0.09 * s, z: -0.08 * s - i * 0.1 * s, sx: 0.07 * s + i * 0.005, sy: 0.07 * s, sz: 0.1 * s })); }
  else if (type === 'deer') tp.push(part(cone(0.06 * s, 0.18 * s, 5), 0xf4eee2, { y: -0.04 * s, z: -0.06 * s, rx: -2.4 }));
  else if (type === 'boar') { tp.push(part(cyl(0.012 * s, 0.02 * s, 0.22 * s, 4), dark, { y: -0.09 * s, z: -0.04 * s, rx: 0.4 })); tp.push(part(ico(0.03 * s, 0), darker, { y: -0.2 * s, z: -0.08 * s })); }
  else tp.push(part(blob(1, 24), dark, { z: -0.05 * s, sx: 0.08 * s, sy: 0.07 * s, sz: 0.08 * s }));
  mesh(tail, tp);

  // ---- legs: hip -> upper leg, knee/hock -> lower leg + hoof/paw
  const legs = [];
  const th = sp.thin * s;
  for (const [lx, lz, front] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const hip = joint(body, lx * bw * 0.32, bh * 0.4, lz * bl * (front ? 0.33 : 0.32));
    const upper = legH * 0.52 + bh * 0.2;
    mesh(hip, [part(blob(1, 30 + lx + lz, 0.12), main, { y: -upper * 0.35, z: front ? 0 : -th * 0.4, sx: th * (front ? 1.25 : 1.6), sy: upper * 0.62, sz: th * (front ? 1.5 : 2.1) }, 0.06)]);
    const knee = joint(hip, 0, -upper * 0.82, front ? 0 : -th * 0.6);
    const lower = legH * 0.52;
    const lp = [part(cyl(th * 0.55, th * 0.75, lower, 6), type === 'bear' || type === 'wolf' ? main : dark, { y: -lower / 2 }, 0.05)];
    if (type === 'bear' || type === 'wolf') lp.push(part(blob(1, 40 + lx, 0.1), dark, { y: -lower + 0.03 * s, z: 0.04 * s, sx: th * 1.0, sy: th * 0.55, sz: th * 1.4 }));
    else lp.push(part(cyl(th * 0.7, th * 0.85, 0.08 * s, 6), hoof, { y: -lower + 0.04 * s }), part(cyl(th * 0.62, th * 0.6, 0.03 * s, 6), 0xf4eee2, { y: -lower + 0.1 * s }));
    mesh(knee, lp);
    legs.push({ hip, knee, front, side: lx });
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { type, body, bodyY: legH, chest, neck, head, ears, tail, legs, seed: Math.random() * 100, earT: 0 };
  return g;
}

// Procedural animation: speed (m/s), state (0 idle/wander, 1 flee/chase, 2 attack), t seconds.
export function animateAnimal(ud, e, speed, dt) {
  if (ud.type === 'shark') return animateShark(ud, e, speed, dt);
  if (ud.type === 'cave_spider') return animateSpider(ud, e, speed, dt);
  if (ud.type === 'bat') return animateBat(ud, e, speed, dt);
  const t = performance.now() / 1000;
  const running = speed > 3.5;
  e.walk = (e.walk || 0) + speed * dt * (running ? 1.35 : 2.6) / (ud.type === 'bear' ? 1.2 : 1);
  e.amt = (e.amt || 0) + (Math.min(1, speed / 2.5) - (e.amt || 0)) * Math.min(1, dt * 7);
  const a = e.amt, sw = a * (running ? 0.75 : 0.5);
  ud.legs.forEach((L, i) => {
    // walk: lateral sequence; gallop: front pair then back pair
    const ph = running ? (L.front ? 0 : Math.PI * 0.75) + (L.side > 0 ? 0.35 : 0) : (L.front ? 0 : Math.PI * 0.5) + (L.side > 0 ? Math.PI : 0);
    const c = Math.sin(e.walk + ph);
    L.hip.rotation.x = c * sw;
    const lift = Math.max(0, Math.cos(e.walk + ph)) * a * (running ? 1.2 : 0.8);
    L.knee.rotation.x = L.front ? lift : -lift * 0.9; // front knees fold back, hind hocks fold forward
  });
  ud.body.position.y = ud.bodyY + (running ? Math.abs(Math.sin(e.walk)) * 0.1 : Math.abs(Math.sin(e.walk * 2)) * 0.02) * a;
  ud.body.rotation.x = running ? Math.sin(e.walk) * 0.07 * a : 0;
  ud.body.rotation.z = Math.sin(e.walk) * 0.03 * a * (ud.type === 'bear' ? 2 : 1);  // bears waddle
  ud.chest.scale.set(1, 1 + Math.sin(t * (running ? 6 : 1.8) + ud.seed) * (running ? 0.03 : 0.012), 1); // breathing
  // head: graze (deer, boar), sniff, look around, lunge when attacking
  let nx = Math.sin(e.walk * 2) * 0.05 * a, ny = 0, hx = 0;
  const idle = a < 0.12;
  if (e.st === 2) { nx = Math.sin(t * 14) * 0.3 - 0.15; hx = -0.2; }
  else if (idle) {
    const graze = Math.sin(t * 0.23 + ud.seed) > 0.25;
    if (graze && (ud.type === 'deer' || ud.type === 'boar')) { nx = ud.type === 'deer' ? 1.05 : 0.55; hx = 0.35 + Math.sin(t * 5 + ud.seed) * 0.06; }
    else { nx = Math.sin(t * 0.6 + ud.seed) * 0.12; ny = Math.sin(t * 0.37 + ud.seed) * 0.45; hx = Math.sin(t * 0.9 + ud.seed) * 0.1; }
    if (ud.type === 'wolf' && Math.sin(t * 0.17 + ud.seed) > 0.6) { nx = 0.5; hx = 0.4 + Math.sin(t * 9) * 0.05; } // sniffing the ground
  }
  ud.neck.rotation.x += (nx - ud.neck.rotation.x) * Math.min(1, dt * 4);
  ud.neck.rotation.y += (ny - ud.neck.rotation.y) * Math.min(1, dt * 3);
  ud.head.rotation.x += (hx - ud.head.rotation.x) * Math.min(1, dt * 4);
  // ears flick now and then, pin back when running/attacking
  ud.earT -= dt;
  const flick = ud.earT < 0 && ud.earT > -0.15;
  if (ud.earT < -0.15) ud.earT = 2 + Math.random() * 5;
  for (const ear of ud.ears) ear.rotation.x = running || e.st === 2 ? 0.7 : flick ? -0.5 : Math.sin(t * 0.5 + ud.seed) * 0.08;
  // tail
  const wag = ud.type === 'wolf' ? (idle ? Math.sin(t * 3) * 0.25 : Math.sin(t * 9) * 0.3) : ud.type === 'deer' ? (Math.sin(t * 0.5 + ud.seed) > 0.8 ? Math.sin(t * 20) * 0.5 : 0) : Math.sin(t * 6) * 0.2;
  ud.tail.rotation.y = wag;
  ud.tail.rotation.x = ud.type === 'wolf' ? (running ? -0.2 : 0.35) : ud.type === 'deer' && running ? -0.9 : 0;
}

// ---- shark: torpedo body (grey back, white belly), dorsal + pectoral fins, a tail that sweeps side to side
function makeShark(color, s) {
  const g = new THREE.Group();
  const top = color, belly = 0xe8e6e0, dark = new THREE.Color(color).multiplyScalar(0.7).getHex();
  const body = joint(g, 0, 0.6 * s, 0);
  const torso = [];
  const seg = (z, r, sy = 0.85) => { const b = blob(r, z * 7, 0.06); b.scale(0.9, sy, 1.55); return b; };
  torso.push(part(seg(0, 0.42 * s), top, { z: 0.1 * s }), part(seg(1, 0.36 * s), top, { z: 0.75 * s }), part(seg(2, 0.3 * s), top, { z: -0.55 * s }));
  torso.push(part(seg(3, 0.36 * s, 0.5), belly, { y: -0.17 * s, z: 0.25 * s }), part(seg(4, 0.28 * s, 0.45), belly, { y: -0.13 * s, z: 0.85 * s }));
  // snout, eyes, gills, mouth
  torso.push(part(cone(0.24 * s, 0.55 * s, 6), top, { z: 1.25 * s, rx: Math.PI / 2, sy: 1, sx: 0.85 }));
  for (const x of [-1, 1]) {
    torso.push(part(ico(0.035 * s, 0), 0x0a0a0a, { x: x * 0.2 * s, y: 0.06 * s, z: 1.02 * s }));
    for (let k = 0; k < 4; k++) torso.push(part(new THREE.BoxGeometry(0.01 * s, 0.17 * s, 0.025 * s), dark, { x: x * 0.31 * s, y: -0.02 * s, z: (0.62 - k * 0.07) * s }));
    torso.push(part(cone(0.2 * s, 0.6 * s, 3), dark, { x: x * 0.42 * s, y: -0.18 * s, z: 0.45 * s, rz: x * 1.25, rx: 0.5, sx: 0.25 })); // pectoral fins
  }
  torso.push(part(new THREE.BoxGeometry(0.32 * s, 0.03 * s, 0.12 * s), 0x3a1414, { y: -0.14 * s, z: 1.05 * s }));
  torso.push(part(cone(0.24 * s, 0.6 * s, 3), dark, { y: 0.52 * s, z: 0.25 * s, rx: -0.35, sz: 0.2 })); // dorsal fin
  mesh(body, torso);
  const tail = joint(body, 0, 0, -0.85 * s);
  mesh(tail, [part(cone(0.2 * s, 0.75 * s, 6), top, { z: -0.3 * s, rx: -Math.PI / 2, sx: 0.7 }),
    part(cone(0.16 * s, 0.6 * s, 3), dark, { y: 0.28 * s, z: -0.72 * s, rx: -0.75, sz: 0.2 }), part(cone(0.12 * s, 0.4 * s, 3), dark, { y: -0.2 * s, z: -0.68 * s, rx: Math.PI + 0.85, sz: 0.2 })]);
  g.userData = { type: 'shark', body, tail, bodyY: 0.6 * s, seed: Math.random() * 10 };
  return g;
}
function animateShark(ud, e, speed, dt) {
  const t = performance.now() / 1000;
  e.walk = (e.walk || 0) + dt * (1.6 + speed * 0.7);
  ud.tail.rotation.y = Math.sin(e.walk * 2) * (0.35 + Math.min(0.3, speed * 0.04));
  ud.body.rotation.y = -Math.sin(e.walk * 2) * 0.06;
  ud.body.rotation.z = Math.sin(t * 0.7 + ud.seed) * 0.05;
  ud.body.position.y = ud.bodyY + Math.sin(t * 0.9 + ud.seed) * 0.08;
  ud.body.rotation.x = e.st === 2 ? Math.sin(t * 12) * 0.15 : 0;
}

// ---- cave spider: a hairy abdomen, a head with glowing eyes, eight jointed legs
function makeSpider(color, s) {
  const g = new THREE.Group(), body = joint(g, 0, 0.35 * s, 0);
  const dark = new THREE.Color(color).multiplyScalar(0.7).getHex();
  mesh(body, [part(blob(0.32 * s, 3, 0.2).scale(1, 0.8, 1.25), color, { z: -0.32 * s, y: 0.05 * s }), part(blob(0.2 * s, 5, 0.12), dark, { z: 0.12 * s }), part(blob(0.13 * s, 7, 0.1), color, { z: 0.32 * s, y: 0.02 * s }),
    ...[-1, 1].flatMap((x) => [part(ico(0.035 * s, 0), 0xff3a2a, { x: x * 0.05 * s, y: 0.07 * s, z: 0.42 * s }), part(ico(0.025 * s, 0), 0xff3a2a, { x: x * 0.09 * s, y: 0.09 * s, z: 0.38 * s })]),
    ...[-1, 1].map((x) => part(cone(0.03 * s, 0.14 * s, 4), 0x1a1210, { x: x * 0.05 * s, y: -0.04 * s, z: 0.44 * s, rx: Math.PI / 2 + 0.6 }))]);
  const legs = [];
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const hip = joint(body, side * 0.15 * s, 0, (0.22 - i * 0.12) * s);
    hip.rotation.y = side * (0.4 + i * 0.35) * (i < 2 ? -1 : 1) + (side < 0 ? Math.PI : 0);
    mesh(hip, [part(cyl(0.025 * s, 0.03 * s, 0.4 * s, 4), dark, { x: 0.2 * s, y: 0.12 * s, rz: -1.0 })]);
    const knee = joint(hip, 0.36 * s, 0.26 * s, 0);
    mesh(knee, [part(cyl(0.018 * s, 0.025 * s, 0.5 * s, 4), color, { x: 0.12 * s, y: -0.2 * s, rz: 0.55 })]);
    legs.push({ hip, knee, ph: i * 1.6 + (side > 0 ? Math.PI : 0) });
  }
  g.userData = { type: 'cave_spider', body, legs, bodyY: 0.35 * s, seed: Math.random() * 10 };
  return g;
}
function animateSpider(ud, e, speed, dt) {
  e.walk = (e.walk || 0) + dt * (2 + speed * 3);
  for (const L of ud.legs) { L.hip.rotation.x = Math.sin(e.walk + L.ph) * 0.35 * Math.min(1, speed); L.knee.rotation.z = Math.max(0, Math.cos(e.walk + L.ph)) * 0.4 * Math.min(1, speed); }
  ud.body.position.y = ud.bodyY + Math.abs(Math.sin(e.walk * 2)) * 0.03;
  ud.body.rotation.x = e.st === 2 ? -0.35 + Math.sin(performance.now() / 60) * 0.1 : 0;
}
// ---- bat: furry body, big ears, membrane wings that flap
function makeBat(color, s) {
  const g = new THREE.Group(), body = joint(g, 0, 0, 0);
  mesh(body, [part(blob(0.12 * s * 2, 9, 0.15).scale(0.8, 0.8, 1.2), color, {}), ...[-1, 1].map((x) => part(cone(0.05 * s * 2, 0.12 * s * 2, 3), color, { x: x * 0.07 * s * 2, y: 0.12 * s * 2, z: 0.08 * s * 2 }))]);
  const wings = [];
  for (const side of [-1, 1]) {
    const w = joint(body, side * 0.1 * s * 2, 0.02, 0);
    const geo = new THREE.BufferGeometry();
    const W = 0.6 * s * 2;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, side * W, 0.05, 0.05, side * W * 0.7, 0, -0.18, 0, 0, 0.12, side * W * 0.7, 0, -0.18, 0, 0, -0.12], 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x2a2020, side: THREE.DoubleSide, flatShading: true })); w.add(m);
    wings.push({ w, side });
  }
  g.userData = { type: 'bat', body, wings, bodyY: 0, seed: Math.random() * 10 };
  return g;
}
function animateBat(ud, e, speed, dt) {
  e.walk = (e.walk || 0) + dt * 22;
  for (const W of ud.wings) W.w.rotation.z = Math.sin(e.walk) * 0.9 * W.side;
  ud.body.position.y = Math.sin(e.walk * 0.5) * 0.06;
}
