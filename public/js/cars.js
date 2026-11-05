// Modern vehicle models: curved extruded body profiles with wheel arches, glass greenhouse,
// pillars, LED lights, grilles, mirrors, interiors and detailed wheels.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { VEHICLES } from '/shared/vehicles.js';
import { bakeByMaterial } from './bake.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
// shared (non-paint) materials
const M = {
  trim: std({ color: 0x141516, roughness: 0.75, metalness: 0.1 }),
  plastic: std({ color: 0x222426, roughness: 0.85, metalness: 0.05 }),
  chrome: std({ color: 0xdadde0, roughness: 0.15, metalness: 1 }),
  glass: std({ color: 0x0b141b, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.78 }),
  rubber: std({ color: 0x181818, roughness: 0.95, metalness: 0 }),
  alloy: std({ color: 0xb8bcc2, roughness: 0.28, metalness: 0.9 }),
  gunmetal: std({ color: 0x3a3d42, roughness: 0.35, metalness: 0.85 }),
  disc: std({ color: 0x77797c, roughness: 0.4, metalness: 0.8 }),
  caliper: std({ color: 0xc0281e, roughness: 0.4, metalness: 0.3 }),
  interior: std({ color: 0x2a2b2e, roughness: 0.9, metalness: 0 }),
  seat: std({ color: 0x1c1d20, roughness: 0.85, metalness: 0 }),
  plate: std({ color: 0xf2f2ea, roughness: 0.5, metalness: 0.1 }),
  white: std({ color: 0xf4f4f4, roughness: 0.4, metalness: 0.1 }),
};

function extrude(shape, width, bevel, mat) {
  const depth = Math.max(0.01, width - 2 * bevel);
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 3, curveSegments: 16 });
  g.rotateY(-Math.PI / 2); // shape x -> +z (forward), extrusion -> x (width)
  g.translate(depth / 2, 0, 0);
  g = toCreasedNormals(g, Math.PI / 5);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function poly(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; return m; }
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// a bar between two points in the (z,y) plane at a given x
function bar(z0, y0, z1, y1, x, w, t, mat) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const m = mesh(box(w, t, len), mat, x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
  return m;
}
// body side outline with wheel arches cut out of the bottom edge
function bodyShape(def, bottom, front, back) {
  const R = def.wheelR + 0.07, yc = def.wheels[0][1] - def.rest * 0.65;
  const s = new THREE.Shape();
  const arch = (zc) => {
    const sn = Math.max(-0.99, (bottom - yc) / R);
    const a0 = Math.PI - Math.asin(sn), a1 = Math.asin(sn);
    s.absarc(zc, yc, R, a0, a1, true);
  };
  const [zf, zr] = [def.wheels[0][2], def.wheels[2][2]];
  s.moveTo(back[0][0], bottom);
  arch(zr); arch(zf);
  front(s);
  back.forEach(([z, y], i) => (i === 0 ? s.lineTo(z, y) : s.lineTo(z, y)));
  return s;
}

// ---------------------------------------------------------------- wheels
function makeWheel(R, width, style) {
  const g = new THREE.Group();
  // tyre: lathe with rounded shoulders, axis along X
  const w = width / 2;
  const prof = [[R * 0.66, -w], [R * 0.9, -w], [R * 0.98, -w * 0.75], [R, -w * 0.35], [R, w * 0.35], [R * 0.98, w * 0.75], [R * 0.9, w], [R * 0.66, w]].map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, 26); tyre.rotateZ(Math.PI / 2);
  g.add(mesh(tyre, M.rubber));
  if (style !== 'alloy') {
    // chunky tread blocks
    const tb = box(width * 0.9, R * 0.1, R * 0.18);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const b = mesh(tb, M.rubber, (i % 2 ? 0.04 : -0.04) * width, Math.cos(a) * R, Math.sin(a) * R, a);
      g.add(b);
    }
  }
  // rim + spokes on the outer (+x) face
  const rimMat = style === 'alloy' ? M.alloy : M.gunmetal;
  const rim = new THREE.CylinderGeometry(R * 0.64, R * 0.64, width * 0.84, 24, 1, true); rim.rotateZ(Math.PI / 2);
  g.add(mesh(rim, rimMat));
  const barrel = new THREE.CylinderGeometry(R * 0.6, R * 0.6, width * 0.7, 20); barrel.rotateZ(Math.PI / 2);
  g.add(mesh(barrel, M.trim, -width * 0.06));
  const disc = new THREE.CylinderGeometry(R * 0.45, R * 0.45, 0.03, 20); disc.rotateZ(Math.PI / 2);
  g.add(mesh(disc, M.disc, width * 0.12));
  const spokes = style === 'atv' ? 4 : style === 'alloy' ? 5 : 6;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const sp = mesh(box(0.035, R * 0.56, style === 'alloy' ? R * 0.12 : R * 0.16), rimMat, width * 0.38, Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32, a);
    g.add(sp);
  }
  const hub = new THREE.CylinderGeometry(R * 0.14, R * 0.16, 0.06, 12); hub.rotateZ(Math.PI / 2);
  g.add(mesh(hub, style === 'alloy' ? M.chrome : rimMat, width * 0.42));
  const lip = new THREE.TorusGeometry(R * 0.64, 0.012, 6, 28); lip.rotateY(Math.PI / 2);
  g.add(mesh(lip, style === 'alloy' ? M.chrome : rimMat, width * 0.42));
  return g;
}

// ---------------------------------------------------------------- shared details
function addLightsAndTrim(g, ud, o) {
  const head = std({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2 });
  const tail = std({ color: 0x6a0808, emissive: 0xff1a10, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.2 });
  ud.headMat = head; ud.tailMat = tail;
  for (const sx of [-1, 1]) {
    // headlight housing + LED strip
    g.add(mesh(rbox(o.hlW, o.hlH, 0.08, 0.02), M.trim, sx * o.hlX, o.hlY, o.front - 0.02, 0, sx * -0.12));
    g.add(mesh(box(o.hlW * 0.8, o.hlH * 0.55, 0.03), head, sx * o.hlX, o.hlY + 0.005, o.front + 0.025, 0, sx * -0.12));
    g.add(mesh(box(o.hlW * 0.9, 0.018, 0.02), head, sx * o.hlX, o.hlY - o.hlH * 0.42, o.front + 0.03, 0, sx * -0.12));
    // taillights
    g.add(mesh(rbox(o.tlW, o.tlH, 0.06, 0.015), tail, sx * o.tlX, o.tlY, o.back + 0.01));
    // mirrors
    const mir = new THREE.Group(); mir.position.set(sx * (o.W / 2 + 0.07), o.mirY, o.mirZ);
    mir.add(mesh(rbox(0.16, 0.11, 0.1, 0.03), o.paint)); mir.add(mesh(box(0.1, 0.035, 0.04), M.trim, -sx * 0.08, -0.02, 0.02));
    mir.add(mesh(box(0.005, 0.08, 0.1), M.chrome, sx * 0.0, 0, -0.051));
    g.add(mir);
    // side skirt
    g.add(mesh(box(0.04, 0.07, o.skirtLen), M.trim, sx * (o.W / 2 + 0.005), o.bottom + 0.06, o.skirtZ));
    // door seams & handles
    for (const z of o.seams) g.add(mesh(box(0.012, o.seamH, 0.01), M.trim, sx * (o.W / 2 + 0.003), o.seamY, z));
    for (const z of o.handles) g.add(mesh(rbox(0.03, 0.035, 0.16, 0.012), M.chrome, sx * (o.W / 2 + 0.01), o.handleY, z));
  }
  // number plates
  g.add(mesh(box(0.46, 0.11, 0.015), M.plate, 0, o.plateY, o.back - 0.01));
  g.add(mesh(box(0.46, 0.11, 0.015), M.plate, 0, o.plateFY, o.front + 0.02));
}
function addInterior(g, o) {
  for (const [x, z] of o.seats) {
    g.add(mesh(rbox(0.46, 0.14, 0.48, 0.05), M.seat, x, o.seatY, z));
    g.add(mesh(rbox(0.44, 0.55, 0.12, 0.05), M.seat, x, o.seatY + 0.3, z - 0.24, -0.12));
    g.add(mesh(rbox(0.22, 0.14, 0.1, 0.04), M.seat, x, o.seatY + 0.64, z - 0.3));
  }
  g.add(mesh(rbox(o.W - 0.2, 0.18, 0.4, 0.05), M.interior, 0, o.dashY, o.dashZ));
  const sw = new THREE.TorusGeometry(0.17, 0.022, 8, 20);
  g.add(mesh(sw, M.trim, o.seats[0][0], o.dashY + 0.07, o.dashZ - 0.25, -0.35));
  g.add(mesh(box(o.W - 0.12, 0.04, o.floorLen), M.interior, 0, o.floorY, o.floorZ));
}

// ---------------------------------------------------------------- body styles
function hatch(g, def, ud, paint) {
  const W = def.half[0] * 2, bottom = -def.half[1] + 0.04;
  const body = bodyShape(def, bottom, (s) => {
    s.lineTo(1.92, bottom); s.quadraticCurveTo(2.08, bottom + 0.02, 2.08, -0.42); s.lineTo(2.05, -0.18);
    s.quadraticCurveTo(2.0, -0.04, 1.72, -0.01); s.quadraticCurveTo(1.25, 0.07, 0.76, 0.13); s.lineTo(-1.62, 0.17);
    s.quadraticCurveTo(-2.0, 0.18, -2.04, 0.0); s.lineTo(-2.06, -0.32); s.quadraticCurveTo(-2.07, bottom + 0.02, -1.95, bottom);
  }, [[-1.95, bottom]]);
  g.add(extrude(body, W, 0.07, paint));
  const gh = new THREE.Shape(); gh.moveTo(0.8, 0.12); gh.quadraticCurveTo(0.35, 0.48, -0.05, 0.62); gh.quadraticCurveTo(-0.8, 0.68, -1.5, 0.62); gh.lineTo(-1.9, 0.18); gh.closePath();
  g.add(extrude(gh, W * 0.86, 0.03, M.glass));
  const roof = new THREE.Shape(); roof.moveTo(-0.02, 0.6); roof.quadraticCurveTo(-0.8, 0.67, -1.54, 0.61); roof.lineTo(-1.58, 0.67); roof.quadraticCurveTo(-0.8, 0.735, -0.02, 0.665); roof.closePath();
  g.add(extrude(roof, W * 0.9, 0.03, paint));
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.43;
    g.add(bar(0.79, 0.13, -0.03, 0.63, x, 0.06, 0.06, paint));
    g.add(bar(-0.58, 0.15, -0.58, 0.67, x, 0.06, 0.08, M.trim));
    g.add(bar(-1.52, 0.63, -1.92, 0.19, x, 0.07, 0.12, paint));
  }
  // rally kit: spoiler, stripe, fog lights, mud flaps, hood vent
  g.add(mesh(rbox(W * 0.86, 0.04, 0.3, 0.015), paint, 0, 0.7, -1.55, 0.12));
  g.add(mesh(box(0.06, 0.06, 0.06), M.trim, 0.55, 0.66, -1.55)); g.add(mesh(box(0.06, 0.06, 0.06), M.trim, -0.55, 0.66, -1.55));
  for (const sx of [-1, 1]) g.add(mesh(box(0.012, 0.09, 3.3), M.white, sx * (W / 2 + 0.006), -0.24, 0.05));
  for (const sx of [-1, 1]) { const f = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14); f.rotateX(Math.PI / 2); g.add(mesh(f, ud.fog = ud.fog || std({ color: 0xffffe0, emissive: 0xfff0a0, emissiveIntensity: 0.4 }), sx * 0.35, -0.46, 2.07)); }
  for (const z of [1.3 - 0.5, -1.28 - 0.5]) for (const sx of [-1, 1]) g.add(mesh(box(0.25, 0.22, 0.02), M.plastic, sx * 0.72, -0.62, z));
  g.add(mesh(rbox(0.4, 0.05, 0.25, 0.02), M.trim, 0, 0.1, 1.2, -0.06));
  g.add(mesh(rbox(0.72, 0.15, 0.05, 0.03), M.trim, 0, -0.24, 2.06)); g.add(mesh(rbox(1.1, 0.12, 0.05, 0.03), M.trim, 0, -0.5, 2.05));
  addLightsAndTrim(g, ud, { W, front: 2.03, back: -2.06, bottom, hlW: 0.42, hlH: 0.1, hlX: 0.58, hlY: -0.08, tlW: 0.34, tlH: 0.1, tlX: 0.62, tlY: 0.02, mirY: 0.2, mirZ: 0.68, skirtLen: 1.6, skirtZ: 0.0, seams: [0.72, -0.5, -1.3], seamH: 0.62, seamY: -0.2, handles: [0.0, -0.95], handleY: 0.02, plateY: -0.3, plateFY: -0.36, paint });
  addInterior(g, { W, seats: [[-0.4, 0.05], [0.4, 0.05], [-0.4, -0.85], [0.4, -0.85]], seatY: -0.32, dashY: 0.12, dashZ: 0.72, floorLen: 2.6, floorY: -0.42, floorZ: -0.2 });
}

function suv(g, def, ud, paint) {
  const W = def.half[0] * 2, bottom = -def.half[1] + 0.06;
  const body = bodyShape(def, bottom, (s) => {
    s.lineTo(2.25, bottom); s.quadraticCurveTo(2.42, bottom + 0.02, 2.42, -0.5); s.lineTo(2.4, -0.06);
    s.quadraticCurveTo(2.37, 0.08, 2.15, 0.1); s.lineTo(1.05, 0.2); s.lineTo(-2.25, 0.22);
    s.quadraticCurveTo(-2.4, 0.22, -2.4, 0.05); s.lineTo(-2.42, -0.55); s.quadraticCurveTo(-2.42, bottom + 0.02, -2.3, bottom);
  }, [[-2.3, bottom]]);
  g.add(extrude(body, W, 0.08, paint));
  const gh = poly([[1.08, 0.19], [0.47, 0.74], [-2.18, 0.76], [-2.33, 0.24]]);
  g.add(extrude(gh, W * 0.88, 0.03, M.glass));
  g.add(extrude(poly([[0.5, 0.74], [-2.22, 0.76], [-2.24, 0.82], [0.45, 0.8]]), W * 0.92, 0.03, paint));
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.44;
    g.add(bar(1.08, 0.2, 0.47, 0.75, x, 0.07, 0.07, paint));
    g.add(bar(-0.52, 0.22, -0.52, 0.77, x, 0.07, 0.1, M.trim));
    g.add(bar(-1.55, 0.22, -1.55, 0.77, x, 0.07, 0.1, M.trim));
    g.add(bar(-2.18, 0.77, -2.33, 0.23, x, 0.08, 0.16, paint));
    g.add(mesh(box(0.05, 0.05, 2.3), M.trim, sx * 0.72, 0.86, -0.9));
    // fender flares
    for (const z of [def.wheels[0][2], def.wheels[2][2]]) {
      const fl = new THREE.TorusGeometry(def.wheelR + 0.1, 0.06, 6, 18, Math.PI); fl.rotateY(Math.PI / 2);
      g.add(mesh(fl, M.plastic, sx * (W / 2 + 0.02), def.wheels[0][1] - def.rest * 0.65, z));
    }
  }
  // roof bars, snorkel, spare wheel, grille & skid plate
  for (const z of [0.1, -1.6]) g.add(mesh(box(W * 0.8, 0.04, 0.05), M.trim, 0, 0.9, z));
  const sn = new THREE.CylinderGeometry(0.05, 0.05, 0.75, 10);
  g.add(mesh(sn, M.plastic, W / 2 + 0.06, 0.4, 1.0)); g.add(mesh(rbox(0.14, 0.1, 0.18, 0.03), M.plastic, W / 2 + 0.06, 0.8, 1.04));
  const spare = makeWheel(def.wheelR * 0.95, 0.26, 'offroad'); spare.rotation.y = Math.PI / 2; spare.position.set(0, -0.05, -2.52); g.add(spare);
  g.add(mesh(rbox(1.15, 0.32, 0.06, 0.03), M.trim, 0, -0.18, 2.42));
  for (let i = 0; i < 4; i++) g.add(mesh(box(1.05, 0.025, 0.02), M.chrome, 0, -0.29 + i * 0.075, 2.45));
  g.add(mesh(box(1.3, 0.06, 0.5), M.alloy, 0, bottom + 0.02, 2.2, 0.3));
  g.add(mesh(rbox(1.6, 0.16, 0.12, 0.03), M.plastic, 0, -0.55, 2.43));
  addLightsAndTrim(g, ud, { W, front: 2.4, back: -2.42, bottom, hlW: 0.3, hlH: 0.16, hlX: 0.72, hlY: -0.12, tlW: 0.14, tlH: 0.32, tlX: 0.86, tlY: -0.05, mirY: 0.3, mirZ: 0.92, skirtLen: 1.9, skirtZ: 0.03, seams: [0.98, -0.52, -1.52], seamH: 0.72, seamY: -0.22, handles: [0.25, -0.75], handleY: 0.06, plateY: -0.4, plateFY: -0.42, paint });
  addInterior(g, { W, seats: [[-0.42, 0.2], [0.42, 0.2], [-0.42, -0.75], [0.42, -0.75]], seatY: -0.28, dashY: 0.18, dashZ: 0.92, floorLen: 3.6, floorY: -0.4, floorZ: -0.5 });
}

function pickup(g, def, ud, paint) {
  const W = def.half[0] * 2, bottom = -def.half[1] + 0.08;
  const body = bodyShape(def, bottom, (s) => {
    s.lineTo(2.55, bottom); s.quadraticCurveTo(2.72, bottom + 0.02, 2.72, -0.5); s.lineTo(2.7, 0.0);
    s.quadraticCurveTo(2.66, 0.15, 2.42, 0.17); s.lineTo(1.25, 0.25); s.lineTo(-2.66, 0.27);
    s.lineTo(-2.7, -0.6); s.quadraticCurveTo(-2.7, bottom + 0.02, -2.6, bottom);
  }, [[-2.6, bottom]]);
  g.add(extrude(body, W, 0.08, paint));
  g.add(extrude(poly([[1.28, 0.24], [0.62, 0.8], [-0.72, 0.82], [-0.78, 0.26]]), W * 0.88, 0.03, M.glass));
  g.add(extrude(poly([[0.64, 0.8], [-0.74, 0.82], [-0.75, 0.88], [0.6, 0.86]]), W * 0.92, 0.03, paint));
  // cab back wall
  g.add(mesh(box(W * 0.92, 0.6, 0.06), paint, 0, 0.55, -0.8));
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.44;
    g.add(bar(1.28, 0.25, 0.62, 0.81, x, 0.07, 0.07, paint));
    g.add(bar(-0.1, 0.26, -0.1, 0.82, x, 0.07, 0.1, M.trim));
    g.add(bar(-0.76, 0.26, -0.73, 0.82, x, 0.08, 0.12, paint));
    // bed side rails
    g.add(mesh(rbox(0.09, 0.07, 1.82, 0.02), M.plastic, sx * (W / 2 - 0.04), 0.31, -1.75));
    for (const z of [def.wheels[0][2], def.wheels[2][2]]) {
      const fl = new THREE.TorusGeometry(def.wheelR + 0.1, 0.06, 6, 18, Math.PI); fl.rotateY(Math.PI / 2);
      g.add(mesh(fl, M.plastic, sx * (W / 2 + 0.02), def.wheels[0][1] - def.rest * 0.65, z));
    }
  }
  // bed liner, tailgate, sport bar
  g.add(mesh(box(W * 0.86, 0.03, 1.78), M.plastic, 0, 0.275, -1.75));
  g.add(mesh(box(W * 0.9, 0.012, 0.01), M.trim, 0, 0.1, -2.705));
  for (const sx of [-1, 1]) { g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 10), M.alloy, sx * 0.75, 0.56, -0.95)); }
  const sb = new THREE.CylinderGeometry(0.04, 0.04, 1.5, 10); sb.rotateZ(Math.PI / 2); g.add(mesh(sb, M.alloy, 0, 0.84, -0.95));
  // grille & bumper
  g.add(mesh(rbox(1.3, 0.38, 0.06, 0.04), M.chrome, 0, -0.12, 2.71));
  for (let i = 0; i < 3; i++) g.add(mesh(box(1.22, 0.06, 0.03), M.trim, 0, -0.22 + i * 0.1, 2.74));
  g.add(mesh(rbox(W * 0.98, 0.16, 0.14, 0.04), M.plastic, 0, -0.55, 2.72));
  g.add(mesh(rbox(W * 0.95, 0.14, 0.12, 0.04), M.plastic, 0, -0.62, -2.72));
  g.add(mesh(box(0.08, 0.08, 0.2), M.alloy, 0, -0.7, -2.82));
  addLightsAndTrim(g, ud, { W, front: 2.69, back: -2.71, bottom, hlW: 0.34, hlH: 0.14, hlX: 0.78, hlY: -0.02, tlW: 0.09, tlH: 0.4, tlX: 0.94, tlY: 0.0, mirY: 0.36, mirZ: 1.15, skirtLen: 2.0, skirtZ: 0.05, seams: [1.15, -0.1, -0.78, -0.86], seamH: 0.78, seamY: -0.2, handles: [0.5, -0.45], handleY: 0.1, plateY: -0.35, plateFY: -0.42, paint });
  addInterior(g, { W, seats: [[-0.42, 0.45], [0.42, 0.45], [-0.42, -0.4], [0.42, -0.4]], seatY: -0.22, dashY: 0.24, dashZ: 1.12, floorLen: 2.0, floorY: -0.35, floorZ: 0.25 });
}

function atv(g, def, ud, paint) {
  const add = (geo, mat, x, y, z, rx = 0) => g.add(mesh(geo, mat, x, y, z, rx));
  add(rbox(0.5, 0.14, 1.5, 0.04), M.trim, 0, -0.1, 0);
  add(rbox(1.08, 0.12, 0.62, 0.06), paint, 0, 0.12, 0.62);
  add(rbox(1.08, 0.12, 0.6, 0.06), paint, 0, 0.12, -0.62);
  add(rbox(0.5, 0.28, 0.62, 0.08), paint, 0, 0.14, 0.12);
  add(rbox(0.4, 0.12, 0.62, 0.05), M.seat, 0, 0.28, -0.3);
  add(rbox(0.7, 0.04, 0.3, 0.01), M.plastic, 0, 0.21, -0.85); add(rbox(0.7, 0.04, 0.26, 0.01), M.plastic, 0, 0.21, 0.88);
  const hb = new THREE.CylinderGeometry(0.02, 0.02, 0.76, 8); hb.rotateZ(Math.PI / 2);
  add(hb, M.chrome, 0, 0.5, 0.42);
  add(new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8), M.trim, 0, 0.35, 0.38, -0.3);
  for (const sx of [-1, 1]) {
    const gr = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8); gr.rotateZ(Math.PI / 2);
    add(gr, M.rubber, sx * 0.42, 0.5, 0.42);
    add(rbox(0.12, 0.3, 0.24, 0.03), M.plastic, sx * 0.3, -0.05, 0);
  }
  const head = std({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 0.5 });
  const tail = std({ color: 0x6a0808, emissive: 0xff1a10, emissiveIntensity: 0.35 });
  ud.headMat = head; ud.tailMat = tail;
  for (const sx of [-1, 1]) { add(rbox(0.16, 0.07, 0.04, 0.015), head, sx * 0.2, 0.12, 0.94); add(box(0.1, 0.05, 0.03), tail, sx * 0.3, 0.12, -0.93); }
}

export function makeVehicle(type) {
  const def = VEHICLES[type];
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const paint = std({ color: def.color, metalness: 0.55, roughness: 0.3 });
  const ud = { body, paintMat: paint };
  ({ hatch, suv, pickup, atv })[def.style](body, def, ud, paint);
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  bakeByMaterial(body);
  const wheels = [];
  const style = def.style === 'hatch' ? 'alloy' : def.style === 'atv' ? 'atv' : 'offroad';
  for (const w of def.wheels) {
    const pivot = new THREE.Group(); pivot.position.set(w[0], w[1] - def.rest * 0.5, w[2]); g.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const wheel = makeWheel(def.wheelR, def.wheelR * (def.style === 'atv' ? 0.75 : 0.62), style);
    if (w[0] < 0) wheel.rotation.y = Math.PI; // spokes face outward
    bakeByMaterial(wheel);
    spin.add(wheel);
    if (def.style !== 'atv') { const cal = mesh(rbox(0.06, 0.14, 0.1, 0.02), M.caliper, (w[0] < 0 ? -1 : 1) * def.wheelR * 0.1, def.wheelR * 0.32, 0.06); pivot.add(cal); }
    wheels.push({ pivot, spin, def: w });
  }
  const headlight = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.45, 1.1);
  headlight.position.set(0, 0, def.half[2]); headlight.target.position.set(0, -1.2, def.half[2] + 12);
  body.add(headlight); body.add(headlight.target);
  Object.assign(ud, { wheels, headlight });
  g.userData = ud;
  return g;
}
