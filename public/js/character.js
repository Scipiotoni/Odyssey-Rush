// Customisable humanoid: sculpted body, detailed face, hair, clothing & armour, plus a
// procedural animation system with smooth pose blending (walk/run/strafe/crouch/jump/aim/swing/sit/sleep).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_LOOK, lookColor } from '/shared/look.js';
import { ITEMS } from '/shared/items.js';
import { bakeVertexColors } from './bake.js';

const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: true }); // faceted low-poly look
const HEIGHTS = [0.92, 0.96, 1.0, 1.04, 1.08];
const geoCache = new Map();
const G = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };
const rbox = (w, h, d, r) => G(`rb${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.05, h / 2.05, d / 2.05)));
const sph = (r, ws = 8, hs = 6) => G(`sp${r}_${ws}`, () => new THREE.SphereGeometry(r, Math.min(ws, 10), Math.min(hs, 8)));
const cap = (r, coverage, tilt) => G(`cap${r}_${coverage}_${tilt}`, () => { const g = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI * coverage); g.rotateX(tilt); return g; });
const taper = (r0, r1, len) => G(`tp${r0}_${r1}_${len}`, () => { const g = new THREE.CylinderGeometry(r1, r0, len, 7, 2); g.translate(0, -len / 2, 0); return g; }); // hangs down from origin
const capsule = (r, len) => G(`cs${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 2, 7));
const lathe = (key, pts, zs = 0.62) => G(key, () => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 9); g.scale(1, 1, zs); return g; });
const lam = (color, opacity = 1) => { const m = new THREE.MeshLambertMaterial({ color }); if (opacity < 1) { m.transparent = true; m.opacity = opacity; } return m; };
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// Angular low-poly head: wide cheekbones, tapered jaw and chin, slightly flattened face.
const headGeo = (fem) => G('head' + fem, () => {
  const g = new THREE.SphereGeometry(0.105, 8, 7);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = y / 0.105;
    if (ny < 0.15) { const t = (0.15 - ny) / 1.15; x *= 1 - t * (fem ? 0.5 : 0.4); z *= 1 - t * 0.2; }
    if (z < 0) z *= 0.9;
    // chin: the lower front of the same mesh is drawn forward and down (no separate lump)
    if (ny < -0.35 && z < 0) { const t = Math.min(1, (-0.35 - ny) / 0.65); const front = Math.min(1, -z / 0.07); z -= t * front * (fem ? 0.012 : 0.018); y -= t * front * 0.01; }
    p.setXYZ(i, x * 0.93, y * 1.15, z);
  }
  g.computeVertexNormals();
  return g;
});

function mk(geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

export function makeHumanoid(look = DEFAULT_LOOK, armorIds = []) {
  const L = { ...DEFAULT_LOOK, ...look };
  const fem = L.body === 1;
  const [armHead, armChest, armLegs, armBack] = armorIds || [];
  const root = new THREE.Group();
  const rig = joint(root, 0, 0, 0); rig.scale.setScalar(HEIGHTS[L.height] ?? 1);
  const skinC = lookColor(L, 'skin'), hairC = lookColor(L, 'hairColor'), topC = lookColor(L, 'topColor');
  const pantsC = armLegs ? ITEMS[armLegs]?.armor?.color ?? lookColor(L, 'pantsColor') : lookColor(L, 'pantsColor');
  const shoeC = lookColor(L, 'shoes');
  const M = {
    skin: lam(skinC), skinD: lam(shade(skinC, 0.86)), lip: lam(mix(skinC, 0x8a3030, 0.35)), hair: lam(hairC), brow: lam(shade(hairC, 0.85)),
    top: lam(topC), topD: lam(shade(topC, 0.72)), topL: lam(mix(topC, 0xffffff, 0.15)), pants: lam(pantsC), pantsD: lam(shade(pantsC, 0.7)), seam: lam(mix(pantsC, 0xd8b060, 0.35)),
    shoe: lam(shoeC), sole: lam(mix(shoeC, 0x202020, 0.7)), lace: lam(mix(shoeC, 0xffffff, 0.6)), belt: lam(0x2a2018), metal: lam(0xb8b0a0),
    white: lam(0xf4f2ee), pupil: lam(0x0a0a0a), stubble: lam(hairC, 0.4), eye: lam(mix(lookColor(L, 'eyes'), 0x101010, 0.6)), mouth: lam(mix(skinC, 0x301010, 0.6)),
    pack: lam(mix(topC, 0x9a8a5a, 0.75)), packD: lam(shade(mix(topC, 0x9a8a5a, 0.75), 0.7)), strap: lam(0x3a3020),
  };
  const sleeveLong = L.top === 1 || L.top === 2 || L.top === 4;
  const bareArms = L.top === 3;
  const shorts = L.pants === 2;

  // ---------------- pelvis & legs
  const hips = joint(rig, 0, 0.94, 0);
  const hw = fem ? 0.155 : 0.142;
  mk(lathe(`pelvis${fem}`, [[0.001, -0.11], [hw * 0.8, -0.1], [hw, -0.05], [hw * 0.98, 0.04], [hw * 0.93, 0.08], [0.001, 0.08]], 0.66), M.pants, hips);
  if (!sleeveLong) mk(G('belt' + fem, () => { const g = new THREE.TorusGeometry(hw * 0.95, 0.016, 6, 24); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.66); return g; }), M.belt, hips, 0, 0.065, 0);
  if (!sleeveLong) mk(rbox(0.045, 0.032, 0.01, 0.005), M.metal, hips, 0, 0.065, -hw * 0.66 - 0.006);
  const leg = (sx) => {
    const hp = joint(hips, sx * 0.082, -0.045, 0);
    mk(sph(0.076), M.pants, hp, 0, 0, 0);
    mk(taper(shorts ? 0.082 : 0.078, shorts ? 0.074 : 0.062, 0.42), M.pants, hp, 0, 0, 0);
    if (L.pants === 1) mk(rbox(0.04, 0.12, 0.1, 0.01), M.pantsD, hp, sx * 0.072, -0.2, 0, 0, 0, sx * 0.08);   // cargo pocket
    if (L.pants === 0) mk(rbox(0.004, 0.36, 0.006, 0.002), M.seam, hp, sx * 0.07, -0.2, 0);
    if (shorts) mk(taper(0.08, 0.08, 0.03), M.pantsD, hp, 0, -0.4, 0);
    const kn = joint(hp, 0, -0.43, 0);
    mk(sph(shorts ? 0.05 : 0.061), shorts ? M.skin : M.pants, kn);
    if (L.pants === 1) mk(rbox(0.1, 0.11, 0.04, 0.012), M.pantsD, kn, 0, -0.03, -0.05, -0.1);       // knee patch
    mk(taper(shorts ? 0.05 : 0.061, shorts ? 0.038 : 0.048, 0.41), shorts ? M.skin : M.pants, kn);
    if (L.pants === 3) mk(taper(0.052, 0.052, 0.05), M.pantsD, kn, 0, -0.36, 0);
    const an = joint(kn, 0, -0.42, 0);
    if (shorts || L.pants === 3) mk(taper(0.042, 0.042, 0.06), M.white, an, 0, 0.04, 0);          // socks
    // sneakers: rounded upper, white sole, toe cap, laces
    mk(rbox(0.1, 0.075, 0.24, 0.03), M.shoe, an, 0, -0.02, -0.045);
    mk(rbox(0.09, 0.05, 0.1, 0.02), M.shoe, an, 0, 0.02, 0.02);
    mk(rbox(0.108, 0.03, 0.255, 0.012), M.white, an, 0, -0.065, -0.045);
    mk(rbox(0.09, 0.02, 0.06, 0.008), M.white, an, 0, -0.04, -0.15);
    mk(rbox(0.045, 0.008, 0.09, 0.003), M.lace, an, 0, 0.018, -0.07, 0.3);
    return { hp, kn, an };
  };
  const lL = leg(-1), lR = leg(1);

  // ---------------- torso
  const spine = joint(hips, 0, 0.07, 0);
  const waist = fem ? 0.125 : 0.142;
  mk(lathe(`abd${fem}`, [[0.001, -0.02], [hw * 0.93, -0.02], [waist, 0.08], [waist * 1.03, 0.2], [0.001, 0.2]], 0.62), M.top, spine);
  const chest = joint(spine, 0, 0.19, 0);
  const sh = fem ? 0.155 : 0.185;
  const chestPts = fem
    ? [[0.001, -0.02], [waist * 1.03, -0.02], [0.14, 0.1], [0.15, 0.18], [sh, 0.25], [sh * 0.8, 0.3], [0.06, 0.335], [0.001, 0.335]]
    : [[0.001, -0.02], [waist * 1.03, -0.02], [0.165, 0.1], [0.18, 0.19], [sh, 0.25], [sh * 0.82, 0.305], [0.065, 0.34], [0.001, 0.34]];
  mk(lathe(`chest${fem}`, chestPts, 0.62), M.top, chest, 0, 0, 0, 0, 0, 0, sleeveLong ? 1.06 : 1, 1, sleeveLong ? 1.14 : 1);
  if (fem) for (const sx of [-1, 1]) mk(sph(0.05), M.top, chest, sx * 0.052, 0.165, -0.06, 0, 0, 0, 1, 0.85, 0.55);
  else mk(sph(0.11), M.top, chest, 0, 0.18, -0.03, 0, 0, 0, 1.45, 0.8, 0.62); // broad chest
  // clothing details
  if (!armChest && (L.top === 0 || L.top === 1)) {
    mk(G('vneck', () => { const g = new THREE.ConeGeometry(0.04, 0.09, 3); g.rotateX(Math.PI); return g; }), M.skin, chest, 0, 0.29, -0.1, 0.15, 0, 0, 1, 1, 0.35);
    mk(rbox(fem ? 0.24 : 0.3, 0.09, 0.03, 0.01), M.topD, chest, 0, 0.215, -0.095, 0.05);           // chest panel
  }
  if (!armChest && (L.top === 0 || L.top === 3)) mk(G('collar', () => { const g = new THREE.TorusGeometry(0.06, 0.009, 6, 18); g.rotateX(Math.PI / 2 - 0.25); return g; }), M.topD, chest, 0, 0.325, -0.01);
  if (!armChest && L.top === 3) for (const sx of [-1, 1]) mk(rbox(0.035, 0.012, 0.18, 0.005), M.topD, chest, sx * 0.1, 0.305, 0, 0, 0, sx * 0.2);
  if (!armChest && L.top === 2) {
    mk(G('hood', () => { const g = new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); g.rotateX(-1.9); return g; }), M.topD, chest, 0, 0.35, 0.06, 0, 0, 0, 1.05, 0.7, 0.8);
    mk(rbox(0.16, 0.08, 0.02, 0.01), M.topD, spine, 0, 0.1, -waist * 0.64 - 0.008);
    for (const sx of [-1, 1]) mk(capsule(0.004, 0.09), M.white, chest, sx * 0.03, 0.24, -0.11);
  }
  if (!armChest && L.top === 4) {
    mk(rbox(0.008, 0.33, 0.006, 0.003), M.metal, chest, 0, 0.13, -0.112);
    mk(rbox(0.008, 0.2, 0.006, 0.003), M.metal, spine, 0, 0.09, -waist * 0.64 - 0.004);
    for (const sx of [-1, 1]) mk(rbox(0.06, 0.12, 0.012, 0.005), M.topD, chest, sx * 0.05, 0.27, -0.1, -0.2, 0, sx * 0.35);
    mk(G('jcollar', () => { const g = new THREE.TorusGeometry(0.075, 0.018, 6, 18, Math.PI * 1.4); g.rotateX(Math.PI / 2); g.rotateY(Math.PI * 0.8); return g; }), M.topD, chest, 0, 0.32, 0.0);
  }
  // hem
  mk(G('hem' + fem, () => { const g = new THREE.TorusGeometry(hw * 0.95, 0.012, 5, 24); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.64); return g; }), M.topD, spine, 0, -0.01, 0);

  // ---------------- neck & head
  const neck = joint(chest, 0, 0.33, 0);
  mk(taper(0.05, 0.048, 0.09), M.skin, neck, 0, 0.09, 0);
  const head = joint(neck, 0, 0.06, 0); head.scale.setScalar(1.2);
  mk(headGeo(fem), M.skin, head, 0, 0.125, 0);                                                  // one angular low-poly head
  for (const sx of [-1, 1]) {
    mk(G('eye', () => new THREE.SphereGeometry(0.018, 5, 3)), M.eye, head, sx * 0.039, 0.136, -0.09, 0, 0, sx * -0.12, 1.15, 0.5, 0.45); // dark almond eye
    mk(rbox(0.04, 0.008, 0.01, 0.003), M.skinD, head, sx * 0.04, 0.155, -0.093, 0, 0, sx * (fem ? -0.14 : -0.07));  // soft brow ridge
    mk(sph(0.022, 5, 4), M.skin, head, sx * 0.094, 0.12, 0.01, 0, 0, 0, 0.45, 1, 0.75);           // ears
  }
  mk(G('nose2', () => { const g = new THREE.ConeGeometry(0.016, 0.045, 4); g.rotateX(-0.3); return g; }), M.skinD, head, 0, 0.108, -0.098, 0, Math.PI / 4, 0, 1, 1, 0.85);

  // ---------------- hair
  const hairG = joint(head, 0, 0, 0);
  const helmeted = armHead === 'metal_mask' || armHead === 'cloth_hood';
  if (!helmeted && L.hair >= 1) {
    const r = L.hair === 1 ? 0.112 : 0.118;
    mk(cap(r, 0.5, 0.55), M.hair, hairG, 0, 0.13, 0.008, 0, 0, 0, 0.97, 1.08, 1.04);
    if (L.hair >= 2 && L.hair !== 6) {
      // chunky faceted volume swept up and back
      const blob = G('hblob', () => new THREE.IcosahedronGeometry(0.06, 0));
      const locks = [[0, 0.225, -0.05, 0.3, 0, 1.5, 0.8, 1.1], [-0.05, 0.215, -0.02, 0.1, 0.4, 1.0, 0.75, 1.2], [0.05, 0.22, -0.02, -0.1, -0.4, 1.0, 0.8, 1.2], [0, 0.22, 0.05, -0.3, 0, 1.6, 0.7, 1.1], [-0.07, 0.18, 0.03, 0, 0.5, 0.6, 0.9, 1.1], [0.07, 0.18, 0.03, 0, -0.5, 0.6, 0.9, 1.1]];
      for (const [x, y, z, rx, rz, sx_, sy_, sz_] of locks) mk(blob, M.hair, hairG, x, y, z, rx, 0, rz, sx_, sy_ * (L.hair === 3 ? 1.3 : 1), sz_);
      if (L.hair === 3) for (const [x, z, r] of [[0.03, -0.07, -0.4], [-0.03, -0.04, 0.5], [0.0, 0.0, 0.1]]) mk(G('tuft', () => new THREE.ConeGeometry(0.03, 0.08, 4)), M.hair, hairG, x, 0.27, z, -0.5, 0, r);
    }
      }
  if (!helmeted) {
    if (L.hair === 3) for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; mk(G('spike', () => new THREE.ConeGeometry(0.03, 0.07, 6)), M.hair, hairG, Math.cos(a) * 0.06, 0.24, Math.sin(a) * 0.06 + 0.01, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
    if (L.hair === 4) { mk(capsule(0.08, 0.16), M.hair, hairG, 0, 0.04, 0.07, 0.15, 0, 0, 1.25, 1, 0.55); for (const sx of [-1, 1]) mk(capsule(0.025, 0.16), M.hair, hairG, sx * 0.095, 0.05, -0.01, 0, 0, sx * 0.08); }
    if (L.hair === 5) { mk(sph(0.03), M.belt, hairG, 0, 0.13, 0.115); mk(capsule(0.03, 0.18), M.hair, hairG, 0, 0.02, 0.14, 0.35); }
    if (L.hair === 6) { for (let i = 0; i < 6; i++) mk(G('mo', () => new THREE.ConeGeometry(0.022, 0.09, 6)), M.hair, hairG, 0, 0.245 - Math.abs(i - 2.5) * 0.012, -0.08 + i * 0.035, -0.3 + i * 0.12); mk(cap(0.111, 0.5, 0.55), M.stubble, hairG, 0, 0.13, 0.008, 0, 0, 0, 0.97, 1.08, 1.04); }
    if (L.hair === 7) mk(sph(0.055), M.hair, hairG, 0, 0.24, 0.06);
  }
  // facial hair
  const beardGeo = G('beard', () => { const g = new THREE.SphereGeometry(0.08, 9, 5, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5); g.rotateX(0.35); return g; });
  if (!helmeted && L.beard === 1) mk(beardGeo, M.stubble, head, 0, 0.075, -0.03, 0, 0, 0, 1.12, 0.95, 1.0);
  if (!helmeted && L.beard === 2) { mk(beardGeo, M.hair, head, 0, 0.07, -0.034, 0, 0, 0, 1.22, 1.3, 1.12); mk(sph(0.04, 6, 4), M.hair, head, 0, 0.012, -0.075, 0, 0, 0, 1.2, 0.9, 0.9); mk(capsule(0.009, 0.04), M.hair, head, 0, 0.074, -0.105, 0, 0, Math.PI / 2); }
  if (!helmeted && L.beard === 3) mk(capsule(0.009, 0.045), M.hair, head, 0, 0.074, -0.106, 0, 0, Math.PI / 2);
  if (!helmeted && L.beard === 4) { mk(sph(0.028), M.hair, head, 0, 0.022, -0.085, 0, 0, 0, 1, 1.1, 0.8); mk(capsule(0.008, 0.04), M.hair, head, 0, 0.074, -0.106, 0, 0, Math.PI / 2); }

  // ---------------- arms
  const arm = (sx) => {
    const shJ = joint(chest, sx * (sh - 0.01), 0.245, 0.005);
    const aw = bareArms ? 0.052 : 0.064;
    mk(sph(aw + 0.004), bareArms ? M.skin : M.top, shJ, 0, -0.01, 0);                                // shoulder
    mk(taper(aw, aw * 0.88, 0.29), bareArms ? M.skin : M.top, shJ);
    if (!sleeveLong && !bareArms) { mk(taper(0.064, 0.06, 0.15), M.top, shJ); mk(G('cuffS', () => { const g = new THREE.TorusGeometry(0.061, 0.008, 5, 16); g.rotateX(Math.PI / 2); return g; }), M.topD, shJ, 0, -0.15, 0); }
    if (!sleeveLong) mk(taper(0.05, 0.046, 0.14), M.skin, shJ, 0, -0.14, 0);
    const el = joint(shJ, 0, -0.275, 0);
    const fw = sleeveLong ? 0.056 : 0.045;
    mk(sph(fw), sleeveLong ? M.top : M.skin, el);
    mk(taper(fw, sleeveLong ? 0.05 : 0.036, 0.25), sleeveLong ? M.top : M.skin, el);
    if (sleeveLong) mk(G('cuffL', () => { const g = new THREE.TorusGeometry(0.048, 0.012, 5, 10); g.rotateX(Math.PI / 2); return g; }), M.topD, el, 0, -0.235, 0);
    const wr = joint(el, 0, -0.25, 0);
    mk(rbox(0.064, 0.11, 0.035, 0.014), M.skin, wr, 0, -0.05, -0.005, 0.15);                // mitten hand
    mk(rbox(0.022, 0.05, 0.022, 0.008), M.skin, wr, sx * -0.036, -0.035, -0.02, 0.2, 0, sx * 0.35); // thumb
    const grip = joint(wr, 0, -0.085, -0.02);
    return { sh: shJ, el, wr, grip };
  };
  const aL = arm(-1), aR = arm(1);

  // ---------------- armour & wearables
  const armor = joint(chest, 0, 0, 0);
  const helmet = joint(head, 0, 0, 0);
  const acol = (id) => ITEMS[id]?.armor?.color ?? 0x888888;
  const stitch = lam(0x3a2a18), rope = lam(0xb89a62), rivet = lam(0xc8c0b0), rust = lam(0x8a4a24), fur = lam(0xd8c8a8), furD = lam(0x9a8264);
  const sleeve = (sx, m, mD, len, r0, r1, cuff = true) => {
    const shJ = sx < 0 ? aL.sh : aR.sh;
    mk(sph(r0 + 0.006), m, shJ, 0, -0.01, 0, 0, 0, 0, 1.08, 1, 1.08);
    mk(taper(r0, r1, len), m, shJ);
    if (cuff) mk(G(`cuff${r1}`, () => { const g = new THREE.TorusGeometry(r1, 0.009, 5, 12); g.rotateX(Math.PI / 2); return g; }), mD, shJ, 0, -len + 0.005, 0);
    return shJ;
  };
  const legWrap = (L_, m, len, r0, r1, onKnee = false) => mk(taper(r0, r1, len), m, onKnee ? L_.kn : L_.hp);
  if (armHead) {
    const c = acol(armHead), m = lam(c), mD = lam(shade(c, 0.7)), mL = lam(mix(c, 0xffffff, 0.15));
    if (armHead === 'metal_mask') {
      // welded scrap helmet: dome, faceted face plate with a visor slit, cheek guards, rivets and rust
      mk(G('mdome', () => { const g = new THREE.SphereGeometry(0.125, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62); return g; }), m, helmet, 0, 0.14, 0.005, 0, 0, 0, 1, 1.12, 1.05);
      mk(G('mface', () => { const g = new THREE.CylinderGeometry(0.118, 0.1, 0.2, 7, 1, true, Math.PI * 0.55, Math.PI * 0.9); return g; }), mL, helmet, 0, 0.11, 0.0, 0, Math.PI, 0);
      mk(rbox(0.13, 0.022, 0.03, 0.006), M.pupil, helmet, 0, 0.14, -0.118);                       // visor slit
      mk(rbox(0.15, 0.018, 0.03, 0.006), mD, helmet, 0, 0.163, -0.116);                           // brow bar
      mk(rbox(0.012, 0.1, 0.03, 0.004), mD, helmet, 0, 0.085, -0.123);                            // nose ridge weld
      for (let k = 0; k < 4; k++) mk(rbox(0.07, 0.006, 0.01, 0.002), M.pupil, helmet, 0, 0.065 - k * 0.012, -0.12, 0, 0, 0); // breathing slots
      for (const sx of [-1, 1]) {
        mk(rbox(0.03, 0.12, 0.1, 0.01), m, helmet, sx * 0.112, 0.09, -0.02, 0, sx * 0.2, 0);      // cheek guard
        for (const [y, z] of [[0.19, -0.1], [0.12, -0.12], [0.06, -0.11], [0.14, 0.09]]) mk(sph(0.007, 5, 4), rivet, helmet, sx * 0.075, y, z);
        mk(sph(0.018, 6, 4), rust, helmet, sx * 0.06, 0.21, 0.04, 0, 0, 0, 1.4, 0.4, 1.2);       // rust patch
      }
      mk(rbox(0.02, 0.06, 0.18, 0.008), mD, helmet, 0, 0.245, 0.01);                            // top weld seam
    } else if (armHead === 'cloth_hood') {
      // burlap sack hood: lumpy, eye holes, stitched seam, drape over the neck tied with rope
      mk(G('sack', () => { const g = new THREE.SphereGeometry(0.128, 10, 8); const p = g.attributes.position; for (let i2 = 0; i2 < p.count; i2++) { const x = p.getX(i2), y = p.getY(i2), z = p.getZ(i2); const k = 1 + Math.sin(x * 61 + y * 37) * 0.04 + Math.sin(z * 53 - y * 29) * 0.035; p.setXYZ(i2, x * k, y * k, z * k); } g.computeVertexNormals(); return g; }), m, helmet, 0, 0.13, 0.008, 0, 0, 0, 1, 1.16, 1.06);
      mk(G('sackpeak', () => new THREE.ConeGeometry(0.05, 0.09, 5)), m, helmet, 0, 0.28, 0.03, -0.5, 0, 0.2);
      for (const sx of [-1, 1]) { mk(G('eyehole', () => new THREE.CircleGeometry(0.022, 7)), M.pupil, helmet, sx * 0.042, 0.142, -0.134, 0, 0, 0, 1.2, 0.8, 1); mk(G('eyering', () => new THREE.TorusGeometry(0.023, 0.004, 4, 10)), stitch, helmet, sx * 0.042, 0.142, -0.133, 0, 0, 0, 1.2, 0.8, 1); }
      for (let k = 0; k < 7; k++) mk(rbox(0.006, 0.018, 0.006, 0.002), stitch, helmet, 0, 0.26 - k * 0.032, -0.06 - Math.sin(k * 0.45) * 0.07, -0.5 + k * 0.25);  // seam
      mk(G('drape', () => new THREE.CylinderGeometry(0.1, 0.15, 0.1, 9, 1, true)), m, helmet, 0, 0.005, 0.01);
      mk(G('rope', () => { const g = new THREE.TorusGeometry(0.085, 0.011, 6, 16); g.rotateX(Math.PI / 2); return g; }), rope, helmet, 0, 0.03, 0.0);
      mk(capsule(0.008, 0.05), rope, helmet, 0.02, -0.01, -0.09, 0.3, 0, 0.3);
    } else {
      // hide hood: leather hat with a pinched crown, wide stitched brim and a band
      mk(G('hcrown', () => { const g = new THREE.CylinderGeometry(0.095, 0.118, 0.11, 9); const p = g.attributes.position; for (let i2 = 0; i2 < p.count; i2++) if (p.getY(i2) > 0) p.setY(i2, p.getY(i2) - Math.abs(p.getX(i2)) * 0.25); g.computeVertexNormals(); return g; }), m, helmet, 0, 0.225, 0.005);
      mk(G('hbrim', () => { const g = new THREE.CylinderGeometry(0.2, 0.19, 0.012, 16); const p = g.attributes.position; for (let i2 = 0; i2 < p.count; i2++) { const x = p.getX(i2); p.setY(i2, p.getY(i2) + (Math.abs(x) / 0.2) ** 2 * 0.035); } g.computeVertexNormals(); return g; }), mD, helmet, 0, 0.17, 0.005);
      mk(G('hband', () => new THREE.CylinderGeometry(0.12, 0.12, 0.024, 12)), lam(0x2a1a0e), helmet, 0, 0.19, 0.005);
      mk(rbox(0.016, 0.03, 0.012, 0.004), rivet, helmet, 0.08, 0.19, -0.09);
      mk(G('feather', () => { const g = new THREE.ConeGeometry(0.012, 0.12, 4); return g; }), lam(0xe8e0d0), helmet, 0.11, 0.24, 0.04, 0, 0, -0.5);
      mk(cap(0.122, 0.48, 0.2), m, helmet, 0, 0.13, 0.005, 0, 0, 0, 1, 1.02, 1.04);
    }
  }
  if (armChest) {
    const c = acol(armChest), m = lam(c), mD = lam(shade(c, 0.72)), mL = lam(mix(c, 0xffffff, 0.12));
    const over = (k, pts) => pts.map(([r, y]) => [r === 0.001 ? r : r + k, y]);
    if (armChest === 'metal_chest') {
      // shaped breast + back plate, plated belly, layered pauldrons, leather straps, rivets
      mk(lathe(`plate${fem}`, over(0.02, chestPts).slice(1, -1).concat([[0.001, 0.32]]).map(([r, y], k) => [r, y]), 0.7), m, armor, 0, 0, 0, 0, 0, 0, 1.02, 1, 1.05);
      mk(rbox(0.07, 0.24, 0.02, 0.008), mL, armor, 0, 0.16, -0.13, 0.04);                     // centre ridge
      for (let k = 0; k < 3; k++) mk(rbox(waist * 2.05, 0.05, waist * 1.45, 0.012), k % 2 ? mD : m, spine, 0, 0.17 - k * 0.055, 0);   // banded belly plates
      for (const sx of [-1, 1]) sleeve(sx, lam(0x4a3a2a), lam(0x2a1a0e), 0.285, 0.079, 0.07); // padded gambeson sleeves under the plates
      for (const sx of [-1, 1]) {
        const shJ = sx < 0 ? aL.sh : aR.sh;
        for (let k = 0; k < 3; k++) mk(G(`paul${k}`, () => { const g = new THREE.SphereGeometry(0.085 - k * 0.006, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); return g; }), k % 2 ? mD : m, shJ, sx * 0.01, 0.02 - k * 0.04, 0, 0, 0, sx * 0.25, 1.1, 0.8 - k * 0.1, 1.1);
        for (const [y, z] of [[0.28, -0.12], [0.2, -0.135], [0.1, -0.13], [0.24, 0.12]]) mk(sph(0.008, 5, 4), rivet, armor, sx * 0.1, y, z);
        mk(rbox(0.03, 0.2, 0.012, 0.004), lam(0x3a2414), armor, sx * 0.17, 0.15, 0, 0, 0, sx * 0.05);   // side straps
        mk(sph(0.02, 6, 4), rust, armor, sx * 0.09, 0.13, -0.135, 0, 0, 0, 1.4, 1, 0.3);
      }
      mk(rbox(0.2, 0.012, 0.012, 0.004), M.pupil, armor, 0, 0.255, -0.142);                  // weld line
    } else {
      const hide = armChest === 'leather_vest';
      // garment over the torso (chest + belly), hem, sleeves
      mk(lathe(`tunic${fem}${hide}`, over(hide ? 0.014 : 0.012, chestPts), 0.66), m, armor);
      mk(lathe(`tunicA${fem}${hide}`, over(0.014, [[0.001, -0.05], [hw * 1.02, -0.05], [waist * 1.02, 0.08], [waist * 1.05, 0.2], [0.001, 0.2]]), 0.66), m, spine);
      if (hide) {
        // open front with lacing, fur collar and shoulder fur, belt with pouch
        mk(rbox(0.03, 0.42, 0.012, 0.004), lam(0x2a1a0e), armor, 0, 0.12, -0.125);
        for (let k = 0; k < 6; k++) mk(rbox(0.05, 0.005, 0.006, 0.002), rope, armor, 0, 0.27 - k * 0.055, -0.13, 0, 0, k % 2 ? 0.5 : -0.5);
        mk(G('furcollar', () => { const g = new THREE.TorusGeometry(0.1, 0.035, 6, 14); g.rotateX(Math.PI / 2); return g; }), fur, chest, 0, 0.31, 0.0, 0, 0, 0, 1.1, 1, 0.85);
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; mk(G('furtuft', () => new THREE.ConeGeometry(0.02, 0.05, 4)), k % 2 ? fur : furD, chest, Math.cos(a) * 0.11, 0.33, Math.sin(a) * 0.095, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); }
        for (const sx of [-1, 1]) sleeve(sx, m, lam(0x2a1a0e), 0.285, 0.079, 0.07);
        mk(G('vbelt' + fem, () => { const g = new THREE.TorusGeometry(hw * 1.0, 0.018, 5, 22); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.68); return g; }), lam(0x2a1a0e), hips, 0, 0.07, 0);
        mk(rbox(0.06, 0.07, 0.035, 0.012), mD, hips, 0.1, 0.03, -0.07, 0, -0.4, 0);   // pouch
        mk(rbox(0.04, 0.04, 0.01, 0.006), rivet, hips, 0, 0.07, -hw * 0.68 - 0.012);  // buckle
      } else {
        // burlap tunic: frayed hem, patches, stitched seams, rope belt, rough short sleeves
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; mk(G('fray', () => new THREE.ConeGeometry(0.03, 0.05, 3)), k % 2 ? m : mD, spine, Math.cos(a) * hw * 1.02, -0.075, Math.sin(a) * hw * 0.7, Math.PI + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3); }
        mk(rbox(0.08, 0.07, 0.012, 0.01), lam(shade(c, 0.6)), armor, -0.07, 0.18, -0.128, 0.1, 0, 0.2);    // patch
        for (let k = 0; k < 4; k++) mk(rbox(0.004, 0.016, 0.004, 0.001), stitch, armor, -0.07 + 0.035, 0.205 - k * 0.018, -0.134);
        mk(rbox(0.06, 0.05, 0.012, 0.008), lam(mix(c, 0x6a5a3a, 0.5)), spine, 0.06, 0.08, -waist * 0.7 - 0.01, 0, 0, -0.15);
        for (let k = 0; k < 9; k++) mk(rbox(0.005, 0.02, 0.005, 0.001), stitch, armor, 0.0, 0.3 - k * 0.035, -0.13);
        mk(G('ropebelt' + fem, () => { const g = new THREE.TorusGeometry(hw * 1.03, 0.012, 5, 22); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.68); return g; }), rope, hips, 0, 0.06, 0);
        mk(capsule(0.009, 0.09), rope, hips, 0.05, 0.0, -hw * 0.68, 0.1, 0, 0.2);
        for (const sx of [-1, 1]) sleeve(sx, m, mD, 0.285, 0.079, 0.07);
      }
    }
  }
  if (armLegs) {
    const c = acol(armLegs), m = lam(c), mD = lam(shade(c, 0.7));
    const boots = lam(0x3a2414), bootsD = lam(0x24160a);
    // leather boots over the shoes (fully covering the sneaker and its sole)
    const boot = (L_) => {
      mk(taper(0.066, 0.061, 0.13), boots, L_.an, 0, 0.11, 0);
      mk(rbox(0.118, 0.085, 0.262, 0.03), boots, L_.an, 0, -0.018, -0.045);
      mk(rbox(0.124, 0.036, 0.272, 0.01), bootsD, L_.an, 0, -0.068, -0.045);
      mk(G('bootcuff', () => { const g = new THREE.TorusGeometry(0.066, 0.01, 5, 12); g.rotateX(Math.PI / 2); return g; }), bootsD, L_.an, 0, 0.11, 0);
    };
    if (armLegs === 'metal_legs') {
      // roadsign kilt: painted sign plates hanging from a belt, plus shin guards and boots
      const signs = [[0xd8b21e, 0x222222], [0xc8281e, 0xf0f0f0], [0x2a6ad0, 0xf0f0f0], [0x2a8a3a, 0xf0f0f0], [0xd8b21e, 0x222222]];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + Math.PI / 2, [cA, cB] = signs[k % signs.length];
        const px = Math.cos(a) * (hw + 0.012), pz = Math.sin(a) * (hw * 0.72 + 0.012);
        const plate = mk(rbox(0.085, 0.17, 0.01, 0.004), lam(cA), hips, px, -0.06, pz, 0.12 * Math.sin(a), -a + Math.PI / 2, 0);
        mk(rbox(0.06, 0.012, 0.012, 0.002), lam(cB), plate, 0, 0.03, -0.004);   // painted stripe
        mk(sph(0.008, 5, 4), rivet, plate, 0, 0.07, -0.006);
      }
      mk(G('kbelt' + fem, () => { const g = new THREE.TorusGeometry(hw * 1.06, 0.02, 5, 22); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.72); return g; }), lam(0x2a1a0e), hips, 0, 0.03, 0);
      for (const L_ of [lL, lR]) {
        mk(rbox(0.11, 0.3, 0.05, 0.012), m, L_.kn, 0, -0.17, -0.04);           // shin guard
        mk(sph(0.055, 7, 5), mD, L_.kn, 0, -0.01, -0.035, 0, 0, 0, 1.1, 1, 0.8); // knee cap
        for (const y of [-0.08, -0.26]) mk(rbox(0.13, 0.016, 0.1, 0.004), lam(0x2a1a0e), L_.kn, 0, y, 0);
        boot(L_);
      }
    } else {
      const hide = armLegs === 'leather_pants';
      for (const L_ of [lL, lR]) {
        legWrap(L_, m, 0.42, 0.087, 0.07);
        legWrap(L_, m, 0.39, 0.07, 0.058, true);
        mk(sph(0.08, 8, 6), m, L_.hp, 0, 0, 0, 0, 0, 0, 1.05, 1, 1.05);
        if (hide) {
          mk(rbox(0.1, 0.11, 0.05, 0.016), mD, L_.kn, 0, -0.02, -0.05);      // knee pad
          for (let k = 0; k < 5; k++) mk(rbox(0.006, 0.006, 0.03, 0.002), rope, L_.hp, 0.075, -0.06 - k * 0.07, 0, 0, 0, 0.6);  // side lacing
        } else {
          mk(rbox(0.07, 0.08, 0.012, 0.01), lam(shade(c, 0.62)), L_.hp, 0.02, -0.25, -0.07, 0.05);  // patch
          mk(G('ankle', () => { const g = new THREE.TorusGeometry(0.06, 0.01, 5, 12); g.rotateX(Math.PI / 2); return g; }), rope, L_.kn, 0, -0.37, 0);
        }
        boot(L_);
      }
    }
  }

  if (armBack) {
    // bag on the back (+z is behind the character): bigger bag = bigger pack
    const c = acol(armBack), m = lam(c), md = lam(shade(c, 0.7)), strap = lam(0x2a2018), buckle = lam(0x9a9a90);
    const big = armBack === 'large_backpack', small = armBack === 'small_bag';
    const [bw, bh, bd] = big ? [0.34, 0.5, 0.2] : small ? [0.22, 0.2, 0.1] : [0.3, 0.36, 0.16];
    const by = big ? 0.12 : small ? 0.06 : 0.12, bz = 0.13 + bd / 2;
    mk(rbox(bw, bh, bd, 0.04), m, chest, 0, by, bz);
    mk(rbox(bw * 0.8, bh * 0.38, 0.05, 0.02), md, chest, 0, by - bh * 0.18, bz + bd / 2 + 0.015);    // front pocket
    mk(rbox(bw * 1.02, 0.06, bd * 1.04, 0.02), md, chest, 0, by + bh / 2 - 0.02, bz);                  // top flap
    for (const sx of [-1, 1]) {
      mk(rbox(0.035, 0.3, 0.02, 0.008), strap, chest, sx * 0.1, 0.14, -0.1 + 0.2, 0.15, 0, 0);       // shoulder straps over the shoulders
      mk(rbox(0.035, 0.22, 0.02, 0.008), strap, chest, sx * 0.1, 0.12, -0.12, -0.1, 0, 0);
    }
    mk(rbox(0.05, 0.03, 0.02, 0.005), buckle, chest, 0, by - bh * 0.18, bz + bd / 2 + 0.045);
    if (big) {
      mk(G('bedroll', () => new THREE.CylinderGeometry(0.07, 0.07, 0.4, 10).rotateZ(Math.PI / 2)), lam(0x6a4a2a), chest, 0, by + bh / 2 + 0.06, bz);
      mk(rbox(0.32, 0.05, 0.02, 0.01), strap, chest, 0, by + bh / 2 + 0.06, bz + 0.075);
    }
  }
  root.userData = { rig, hips, spine, chest, neck, head, hand: aR.grip, handL: aL.grip, armL: aL.sh, armR: aR.sh, elbowL: aL.el, elbowR: aR.el, wristL: aL.wr, wristR: aR.wr, legL: lL.hp, legR: lR.hp, kneeL: lL.kn, kneeR: lR.kn, ankleL: lL.an, ankleR: lR.an, look: L, pose: null };
  bakeVertexColors(root, VC, new THREE.Color(skinC));
  return root;
}

// First-person arm (sleeve + hand) matching the character look
export function makeFPArm(look = DEFAULT_LOOK) {
  const L = { ...DEFAULT_LOOK, ...look };
  const g = new THREE.Group();
  const sleeve = L.top === 1 || L.top === 2 || L.top === 4;
  const skin = lam(lookColor(L, 'skin')), top = lam(lookColor(L, 'topColor'));
  const arm = mk(taper(0.034, 0.046, 0.36), sleeve ? top : skin, g, 0.04, -0.1, -0.03, -Math.PI / 2);
  if (sleeve) mk(G('fpcuff', () => { const t = new THREE.TorusGeometry(0.04, 0.01, 6, 16); return t; }), lam(shade(lookColor(L, 'topColor'), 0.72)), g, 0.04, -0.1, 0.0);
  mk(rbox(0.075, 0.07, 0.09, 0.02), skin, g, 0.04, -0.09, -0.05);
  mk(rbox(0.07, 0.05, 0.06, 0.018), skin, g, 0.04, -0.105, -0.1, 0.6);
  mk(capsule(0.013, 0.035), skin, g, 0.0, -0.07, -0.07, -1.0, 0, 0.6);
  arm.castShadow = false;
  return g;
}

// ---------------------------------------------------------------- animation
const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
const ease = (t) => t * t * (3 - 2 * t);

// st: {mode:'stand'|'sit'|'drive'|'sleep', walk (phase), amt (0..1 locomotion blend), fwd, side (local move dir),
//      run, air, vy, crouch, held, gun, pitch, swing (0..1), shot (0..1), turn (rad/s), land (0..1), t}
// dt: when given, joints blend smoothly toward the pose; otherwise they snap.
export function poseHumanoid(ud, st, dt) {
  const T = {};
  for (const j of JOINTS) T[j] = [0, 0, 0];
  let hipY = 0.94;
  const t = st.t || 0, pitch = st.pitch || 0;
  if (st.mode === 'sleep') {
    T.hips = [0, 0, Math.PI / 2]; hipY = 0.17;
    T.legL = [0.75, 0, 0]; T.legR = [0.55, 0, 0]; T.kneeL = [-1.1, 0, 0]; T.kneeR = [-0.9, 0, 0];
    T.armL = [0.9, 0, 0.25]; T.armR = [0.7, 0, -0.1]; T.elbowL = [1.3, 0, 0]; T.elbowR = [1.1, 0, 0];
    T.spine = [-0.25 + Math.sin(t * 0.9) * 0.02, 0, 0]; T.neck = [-0.2, 0, 0]; T.ankleL = T.ankleR = [0.4, 0, 0];
  } else if (st.mode === 'sit' || st.mode === 'drive') {
    hipY = 0.45;
    T.legL = T.legR = [1.45, 0, 0]; T.kneeL = T.kneeR = [-1.35, 0, 0]; T.ankleL = T.ankleR = [0.1, 0, 0];
    T.spine = [0.06, 0, 0]; T.head = [pitch * 0.4, 0, 0];
    if (st.mode === 'drive') { T.armL = [1.15, 0, 0.22]; T.armR = [1.15, 0, -0.22]; T.elbowL = T.elbowR = [0.55, 0, 0]; T.spine[2] = -(st.turn || 0) * 0.05; }
    else { T.armL = [0.4, 0, 0.05]; T.armR = [0.4, 0, -0.05]; T.elbowL = T.elbowR = [0.95, 0, 0]; }
  } else {
    const w = st.walk || 0, a = st.amt || 0, run = st.run && !st.crouch ? 1 : 0;
    const back = (st.fwd ?? 1) < -0.3 ? -1 : 1, side = st.side || 0;
    const fwdAmt = Math.max(0.25, Math.abs(st.fwd ?? 1));
    const s = Math.sin(w), c = Math.cos(w);
    const legA = (0.5 + run * 0.4) * a * fwdAmt * (st.crouch ? 0.6 : 1);
    const kneeA = (0.85 + run * 0.75) * a;
    // legs: swing + knee lift on the forward swing + foot roll
    T.legL = [s * legA * back, 0, -side * Math.max(0, s) * 0.25 * a - 0.03];
    T.legR = [-s * legA * back, 0, side * Math.max(0, -s) * 0.25 * a + 0.03];
    T.kneeL = [-(0.08 + Math.max(0, c * back) * kneeA + run * 0.25 * a), 0, 0];
    T.kneeR = [-(0.08 + Math.max(0, -c * back) * kneeA + run * 0.25 * a), 0, 0];
    T.ankleL = [Math.max(0, -s) * 0.35 * a - T.legL[0] * 0.2, 0, 0];
    T.ankleR = [Math.max(0, s) * 0.35 * a - T.legR[0] * 0.2, 0, 0];
    // pelvis: double bounce, sway and twist; torso counter-twist and lean
    hipY = 0.94 - (0.5 + 0.5 * Math.cos(2 * w)) * (0.025 + run * 0.05) * a;
    T.hips = [0, s * (0.1 + run * 0.06) * a, s * 0.04 * a - (st.turn || 0) * 0.03];
    T.spine = [-((0.03 + run * 0.2) * a * back + Math.max(-0.1, Math.min(0.15, (st.accel || 0) * 0.04))), -s * 0.08 * a, -(st.turn || 0) * 0.04];
    T.chest = [-run * 0.06 * a, -s * (0.1 + run * 0.08) * a, 0];
    T.neck = [(0.03 + run * 0.2) * a, s * 0.12 * a, 0];
    // arms: counter swing with elbow pump
    const armA = (0.42 + run * 0.6) * a;
    T.armL = [-s * armA * back, 0, -0.1 - run * 0.1]; T.armR = [s * armA * back, 0, 0.1 + run * 0.1];
    T.elbowL = [0.18 + run * 1.15 * a + Math.max(0, -s) * 0.3 * a, 0, 0]; T.elbowR = [0.18 + run * 1.15 * a + Math.max(0, s) * 0.3 * a, 0, 0];
    // idle: breathing, weight shift, looking around
    const idle = 1 - Math.min(1, a * 2.5);
    if (idle > 0) {
      const br = Math.sin(t * 1.55);
      T.chest[0] -= br * 0.02 * idle; T.armL[2] -= (0.04 + br * 0.02) * idle; T.armR[2] += (0.04 + br * 0.02) * idle;
      T.hips[2] += Math.sin(t * 0.45) * 0.035 * idle; hipY -= (0.5 + 0.5 * Math.sin(t * 0.45)) * 0.008 * idle;
      T.legL[2] -= Math.sin(t * 0.45) * 0.03 * idle; T.legR[2] -= Math.sin(t * 0.45) * 0.03 * idle;
      T.kneeL[0] -= (0.5 + 0.5 * Math.sin(t * 0.45)) * 0.12 * idle;
      T.head[1] += (Math.sin(t * 0.31) * 0.35 + Math.sin(t * 0.83) * 0.1) * idle * (st.held ? 0.3 : 1);
      T.elbowL[0] += 0.06 * idle; T.elbowR[0] += 0.06 * idle;
    }
    if (st.crouch) {
      hipY -= 0.33;
      T.legL[0] += 1.15; T.legR[0] += 1.15; T.kneeL[0] -= 1.95; T.kneeR[0] -= 1.95; T.ankleL[0] += 0.75; T.ankleR[0] += 0.75;
      T.spine[0] -= 0.45; T.neck[0] += 0.3;
    }
    if (st.air) {
      const up = (st.vy || 0) > 0;
      T.legL = [up ? 0.9 : 0.45, 0, -0.05]; T.legR = [up ? 0.1 : 0.25, 0, 0.05];
      T.kneeL = [up ? -1.3 : -0.7, 0, 0]; T.kneeR = [up ? -0.5 : -0.6, 0, 0]; T.ankleL = [0.3, 0, 0]; T.ankleR = [0.2, 0, 0];
      T.armL = [0.5, 0, -0.55]; T.armR = [0.5, 0, 0.55]; T.elbowL = T.elbowR = [0.6, 0, 0];
      T.spine[0] = -0.12; hipY = 0.94;
    }
    if (st.land > 0) { const l = ease(st.land); hipY -= 0.14 * l; T.kneeL[0] -= 0.7 * l; T.kneeR[0] -= 0.7 * l; T.legL[0] += 0.35 * l; T.legR[0] += 0.35 * l; T.spine[0] -= 0.25 * l; }
    // held items
    if (st.gun) {
      const kick = (st.shot || 0) * 0.3;
      T.armR = [1.32 + pitch * 0.9 + kick, 0, 0.08]; T.elbowR = [0.45 - kick * 0.5, 0, 0]; T.wristR = [-0.15, 0, 0];
      T.armL = [1.42 + pitch * 0.9 + kick, 0, 0.62]; T.elbowL = [0.7, 0, 0]; T.wristL = [0, 0, -0.3];
      T.chest[1] += 0.22; T.neck[1] -= 0.18; T.spine[0] += pitch * 0.2;
      if (!st.air) { T.armR[0] += Math.sin(w) * 0.03 * a; T.armL[0] += Math.sin(w) * 0.03 * a; }
    } else if (st.held) {
      // carry the tool in front, swing it overhead with a body twist
      let ax = 0.55 + pitch * 0.4, ex = 0.75, tw = 0, lean = 0;
      if (st.swing) {
        const p = st.swing;
        if (p < 0.32) { const q = ease(p / 0.32); ax = ax + (2.6 - ax) * q; ex = 0.75 + 0.6 * q; tw = -0.35 * q; }
        else if (p < 0.5) { const q = (p - 0.32) / 0.18; ax = 2.6 - 2.5 * q; ex = 1.35 - 1.1 * q; tw = -0.35 + 0.75 * q; lean = 0.25 * q; }
        else { const q = ease((p - 0.5) / 0.5); ax = 0.1 + (0.55 + pitch * 0.4 - 0.1) * q; ex = 0.25 + 0.5 * q; tw = 0.4 * (1 - q); lean = 0.25 * (1 - q); }
        T.armL = [0.5 + lean, 0, -0.2]; T.elbowL = [0.6, 0, 0];
      }
      T.armR = [ax, 0, 0.12]; T.elbowR = [ex, 0, 0];
      T.chest[1] += tw; T.spine[0] -= lean;
    }
    T.head[0] += pitch * 0.5; T.neck[0] += pitch * 0.15;
  }
  // apply (smoothed)
  const k = dt ? 1 - Math.exp(-dt * 16) : 1;
  for (const j of JOINTS) {
    const o = ud[j], r = T[j];
    o.rotation.x += (r[0] - o.rotation.x) * k; o.rotation.y += (r[1] - o.rotation.y) * k; o.rotation.z += (r[2] - o.rotation.z) * k;
  }
  ud.hips.position.y += (hipY - ud.hips.position.y) * k;
}
