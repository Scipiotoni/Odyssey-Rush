// Customisable humanoid: jointed limbs, face, hair styles, facial hair, clothing and armour.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LOOK_FIELDS, DEFAULT_LOOK, lookColor } from '/shared/look.js';
import { ITEMS } from '/shared/items.js';
import { bakeVertexColors } from './bake.js';

const VC = new THREE.MeshLambertMaterial({ vertexColors: true });

const HEIGHTS = [0.92, 0.96, 1.0, 1.04, 1.08];
const geoCache = new Map();
const G = (key, fn) => { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); };
const rbox = (w, h, d, r) => G(`rb${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.05, h / 2.05, d / 2.05)));
const caps = (r, len) => G(`cp${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sph = (r) => G(`sp${r}`, () => new THREE.SphereGeometry(r, 12, 9));
const cyl = (rt, rb, h) => G(`cy${rt}_${rb}_${h}`, () => new THREE.CylinderGeometry(rt, rb, h, 12));
const lam = (color) => new THREE.MeshLambertMaterial({ color });
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

function mk(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

export function makeHumanoid(look = DEFAULT_LOOK, armorIds = []) {
  const L = { ...DEFAULT_LOOK, ...look };
  const fem = L.body === 1;
  const root = new THREE.Group();
  const rig = new THREE.Group(); rig.scale.setScalar(HEIGHTS[L.height] ?? 1); root.add(rig);
  const skinC = lookColor(L, 'skin'), hairC = lookColor(L, 'hairColor'), topC = lookColor(L, 'topColor'), pantsC = lookColor(L, 'pantsColor'), shoeC = lookColor(L, 'shoes');
  const mats = { skin: lam(skinC), hair: lam(hairC), top: lam(topC), topDark: lam(shade(topC, 0.75)), pants: lam(pantsC), pantsDark: lam(shade(pantsC, 0.75)), shoe: lam(shoeC), sole: lam(0x222222), lip: lam(shade(skinC, 0.7)), nose: lam(shade(skinC, 0.93)),
    eyeW: new THREE.MeshBasicMaterial({ color: 0xf2f2ee }), iris: new THREE.MeshBasicMaterial({ color: lookColor(L, 'eyes') }), stubble: new THREE.MeshLambertMaterial({ color: shade(hairC, 1), transparent: true, opacity: 0.45 }) };
  const sleeveUpper = L.top === 3 ? mats.skin : mats.top;          // tank top: bare arms
  const sleeveLower = L.top === 1 || L.top === 2 || L.top === 4 ? mats.top : mats.skin;
  const legLower = L.pants === 2 ? mats.skin : mats.pants;

  // hips / pelvis
  const hips = new THREE.Group(); hips.position.y = 0.92; rig.add(hips);
  const pw = fem ? 0.36 : 0.33;
  mk(rbox(pw, 0.17, 0.21, 0.05), mats.pants, 0, 0.02, 0, hips);
  // torso
  const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
  const tw = fem ? 0.36 : 0.42;
  const torso = mk(rbox(tw, 0.46, 0.23, 0.07), mats.top, 0, 0.25, 0, spine);
  if (fem) mk(rbox(0.3, 0.12, 0.07, 0.035), mats.top, 0, 0.33, -0.11, spine);
  mk(rbox(tw * 0.92, 0.07, 0.235, 0.03), mats.topDark, 0, 0.04, 0, spine); // hem
  if (L.top === 2) { mk(rbox(0.28, 0.14, 0.1, 0.05), mats.top, 0, 0.47, 0.12, spine); mk(rbox(0.2, 0.1, 0.03, 0.015), mats.topDark, 0, 0.17, -0.12, spine); }
  if (L.top === 4) { mk(rbox(0.02, 0.4, 0.01, 0.005), mats.sole, 0, 0.25, -0.118, spine); mk(rbox(0.3, 0.06, 0.2, 0.03), mats.topDark, 0, 0.47, 0.02, spine); }
  if (L.top === 0 || L.top === 3) mk(rbox(0.12, 0.03, 0.02, 0.01), mats.skin, 0, 0.47, -0.112, spine); // neckline
  // neck + head
  mk(cyl(0.052, 0.058, 0.1), mats.skin, 0, 0.51, 0, spine);
  const head = new THREE.Group(); head.position.y = 0.55; spine.add(head);
  mk(rbox(0.22, 0.25, 0.23, 0.08), mats.skin, 0, 0.125, 0, head);
  mk(rbox(0.16, 0.07, 0.04, 0.02), mats.skin, 0, 0.03, -0.1, head); // jaw
  for (const sx of [-1, 1]) {
    mk(rbox(0.045, 0.028, 0.012, 0.006), mats.eyeW, sx * 0.05, 0.14, -0.116, head);
    mk(rbox(0.022, 0.024, 0.012, 0.005), mats.iris, sx * 0.05, 0.14, -0.121, head);
    if (L.hair !== 0 || true) mk(rbox(0.055, 0.012, 0.014, 0.005), mats.hair, sx * 0.05, 0.175, -0.117, head);
    mk(rbox(0.022, 0.06, 0.04, 0.01), mats.skin, sx * 0.113, 0.12, 0.0, head); // ears
  }
  mk(rbox(0.032, 0.055, 0.035, 0.012), mats.nose, 0, 0.1, -0.124, head);
  mk(rbox(0.065, 0.012, 0.01, 0.005), mats.lip, 0, 0.055, -0.118, head);
  // hair
  const hairG = new THREE.Group(); head.add(hairG);
  const H = (w, h, d, x, y, z, r = 0.03) => mk(rbox(w, h, d, r), mats.hair, x, y, z, hairG);
  if (L.hair >= 1) {
    // cap wraps the top/back of the skull; its front edge sits behind the forehead
    const thick = L.hair === 1 ? 0.012 : 0.03;
    H(0.22 + thick * 2, 0.1 + thick, 0.24 + thick, 0, 0.205 + thick / 2, 0.012 + thick / 2, 0.06);
    H(0.22 + thick * 2, 0.12, 0.05, 0, 0.13, 0.1 + thick * 0.6, 0.02);
    for (const sx of [-1, 1]) H(0.02, 0.07, 0.1, sx * (0.11 + thick * 0.6), 0.17, 0.03, 0.008);
    if (L.hair >= 2) H(0.2, 0.04, 0.05, 0.01, 0.245, -0.095, 0.02); // fringe
  }
  if (L.hair === 3) for (let i = 0; i < 7; i++) H(0.06, 0.05, 0.06, Math.sin(i * 2.3) * 0.08, 0.28 + (i % 2) * 0.015, Math.cos(i * 1.7) * 0.08, 0.02);
  if (L.hair === 4) { H(0.24, 0.36, 0.06, 0, 0.06, 0.12, 0.03); for (const sx of [-1, 1]) H(0.035, 0.28, 0.16, sx * 0.118, 0.07, 0.04, 0.015); }
  if (L.hair === 5) { const t = mk(caps(0.035, 0.2), mats.hair, 0, 0.06, 0.16, hairG); t.rotation.x = 0.35; mk(sph(0.045), mats.hair, 0, 0.21, 0.13, hairG); }
  if (L.hair === 6) { hairG.clear(); for (let i = 0; i < 5; i++) H(0.04, 0.1, 0.06, 0, 0.27 + Math.sin(i) * 0.01, -0.09 + i * 0.05, 0.015); }
  if (L.hair === 7) mk(sph(0.07), mats.hair, 0, 0.29, 0.07, hairG);
  // facial hair
  if (L.beard === 1) mk(rbox(0.2, 0.09, 0.03, 0.02), mats.stubble, 0, 0.05, -0.108, head);
  if (L.beard === 2) { mk(rbox(0.21, 0.11, 0.07, 0.035), mats.hair, 0, 0.04, -0.095, head); mk(rbox(0.08, 0.015, 0.012, 0.005), mats.lip, 0, 0.06, -0.133, head); }
  if (L.beard === 3) mk(rbox(0.09, 0.022, 0.02, 0.008), mats.hair, 0, 0.074, -0.128, head);
  if (L.beard === 4) { mk(rbox(0.06, 0.06, 0.03, 0.012), mats.hair, 0, 0.02, -0.12, head); mk(rbox(0.07, 0.018, 0.015, 0.006), mats.hair, 0, 0.074, -0.127, head); }
  // arms
  const arm = (sx) => {
    const sh = new THREE.Group(); sh.position.set(sx * (tw / 2 + 0.045), 0.42, 0); spine.add(sh);
    mk(sph(0.065), sleeveUpper, 0, 0, 0, sh);
    mk(caps(0.054, 0.2), sleeveUpper, 0, -0.14, 0, sh);
    if (L.top === 0) mk(cyl(0.062, 0.062, 0.05), mats.topDark, 0, -0.17, 0, sh);
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    mk(sph(0.053), sleeveLower === mats.top ? mats.top : sleeveUpper, 0, 0, 0, el);
    mk(caps(0.047, 0.19), sleeveLower, 0, -0.12, 0, el);
    if (sleeveLower === mats.top) mk(cyl(0.052, 0.052, 0.04), mats.topDark, 0, -0.23, 0, el);
    const hand = new THREE.Group(); hand.position.y = -0.29; el.add(hand);
    mk(rbox(0.075, 0.1, 0.05, 0.02), mats.skin, 0, -0.02, 0, hand);
    mk(rbox(0.03, 0.05, 0.03, 0.012), mats.skin, sx * -0.035, 0.0, -0.03, hand);
    return { sh, el, hand };
  };
  const aL = arm(-1), aR = arm(1);
  // legs
  const leg = (sx) => {
    const hp = new THREE.Group(); hp.position.set(sx * (pw / 2 - 0.07), -0.02, 0); hips.add(hp);
    mk(caps(0.075, 0.28), mats.pants, 0, -0.2, 0, hp);
    if (L.pants === 1) mk(rbox(0.05, 0.12, 0.1, 0.02), mats.pantsDark, sx * 0.075, -0.24, 0, hp);
    const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn);
    mk(sph(0.07), mats.pants, 0, 0, 0, kn);
    mk(sph(0.077), mats.pants, 0, 0.43, 0, kn);
    mk(caps(0.062, 0.27), legLower, 0, -0.2, 0, kn);
    if (L.pants === 2) mk(cyl(0.08, 0.08, 0.06), mats.pantsDark, 0, 0.02, 0, kn);
    if (L.pants === 3) mk(cyl(0.066, 0.066, 0.05), mats.pantsDark, 0, -0.36, 0, kn);
    const ft = new THREE.Group(); ft.position.y = -0.42; kn.add(ft);
    mk(sph(0.06), L.pants === 2 ? mats.skin : mats.pants, 0, 0.03, 0, ft);
    mk(rbox(0.11, 0.08, 0.25, 0.035), mats.shoe, 0, -0.03, -0.04, ft);
    mk(rbox(0.115, 0.025, 0.26, 0.01), mats.sole, 0, -0.068, -0.04, ft);
    return { hp, kn, ft };
  };
  const lL = leg(-1), lR = leg(1);
  const armor = new THREE.Group(); spine.add(armor);
  const helmet = new THREE.Group(); head.add(helmet);
  root.userData = { rig, hips, spine, torso, head, hairG, helmet, armor, armL: aL.sh, armR: aR.sh, elbowL: aL.el, elbowR: aR.el, legL: lL.hp, legR: lR.hp, kneeL: lL.kn, kneeR: lR.kn, hand: aR.hand, mats, look: L, eyes: null };
  if (armorIds && armorIds.some(Boolean)) setHumanoidArmor(root, armorIds);
  if (!root.userData.hairG.visible) root.userData.hairG.clear();
  // merge every joint's parts into a single vertex-coloured mesh (~16 draw calls per character)
  bakeVertexColors(root, VC, new THREE.Color(skinC));
  return root;
}

// Armour: tints clothing and adds plates / helmets.
function setHumanoidArmor(h, armorIds) {
  const ud = h.userData;
  const [head, chest, legs] = armorIds;
  ud.helmet.clear(); ud.armor.clear();
  ud.hairG.visible = true;
  const col = (id) => ITEMS[id]?.armor?.color ?? 0x888888;
  if (head) {
    const m = lam(col(head));
    if (head === 'metal_mask') {
      mk(rbox(0.26, 0.29, 0.27, 0.06), m, 0, 0.13, 0, ud.helmet);
      mk(rbox(0.16, 0.025, 0.02, 0.008), new THREE.MeshBasicMaterial({ color: 0x111111 }), 0, 0.145, -0.136, ud.helmet);
      ud.hairG.visible = false;
    } else if (head === 'cloth_hood') { mk(rbox(0.27, 0.3, 0.28, 0.1), m, 0, 0.15, 0.01, ud.helmet); ud.hairG.visible = false; mk(rbox(0.12, 0.05, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: 0x111111 }), 0, 0.14, -0.138, ud.helmet); }
    else { mk(rbox(0.26, 0.1, 0.27, 0.04), m, 0, 0.26, 0.005, ud.helmet); mk(rbox(0.34, 0.02, 0.34, 0.01), m, 0, 0.22, 0, ud.helmet); }
  }
  if (chest) {
    const m = lam(col(chest));
    const metal = chest === 'metal_chest';
    mk(rbox(metal ? 0.46 : 0.45, metal ? 0.36 : 0.42, 0.27, 0.06), m, 0, 0.28, 0, ud.armor);
    if (metal) for (const sx of [-1, 1]) mk(rbox(0.13, 0.08, 0.16, 0.03), m, sx * 0.25, 0.44, 0, ud.armor);
  }
  ud.mats.pants.color.set(legs ? col(legs) : lookColor(ud.look, 'pantsColor'));
  if (legs === 'metal_legs') mk(rbox(0.4, 0.22, 0.26, 0.04), lam(col(legs)), 0, -0.12, 0, ud.armor);
}

// First-person arm (sleeve + hand) matching the character look
export function makeFPArm(look = DEFAULT_LOOK) {
  const L = { ...DEFAULT_LOOK, ...look };
  const g = new THREE.Group();
  const sleeve = L.top === 1 || L.top === 2 || L.top === 4;
  const skin = lam(lookColor(L, 'skin'));
  const arm = new THREE.Mesh(caps(0.045, 0.34), sleeve ? lam(lookColor(L, 'topColor')) : skin);
  arm.rotation.x = Math.PI / 2; arm.position.set(0.04, -0.1, 0.22); g.add(arm);
  if (sleeve) { const cuff = new THREE.Mesh(cyl(0.05, 0.05, 0.04), lam(shade(lookColor(L, 'topColor'), 0.75))); cuff.rotation.x = Math.PI / 2; cuff.position.set(0.04, -0.1, 0.03); g.add(cuff); }
  const hand = new THREE.Mesh(rbox(0.075, 0.09, 0.11, 0.025), skin); hand.position.set(0.04, -0.09, -0.02); g.add(hand);
  const thumb = new THREE.Mesh(rbox(0.03, 0.03, 0.06, 0.01), skin); thumb.position.set(0.0, -0.06, -0.04); g.add(thumb);
  return g;
}

// Pose the rig. st: {mode:'stand'|'sit'|'sleep', walk, amt (0..1 stride), crouch, held, pitch, swing (0..1), t}
export function poseHumanoid(ud, st) {
  const { hips, spine, head, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR } = ud;
  hips.rotation.set(0, 0, 0); spine.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0);
  for (const j of [armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR]) j.rotation.set(0, 0, 0);
  hips.position.y = 0.92;
  armL.rotation.z = -0.08; armR.rotation.z = 0.08;
  if (st.mode === 'sleep') {
    hips.rotation.x = -Math.PI / 2; hips.position.y = 0.16;
    armL.rotation.z = -0.15; armR.rotation.z = 0.15; kneeL.rotation.x = -0.15; legL.rotation.x = 0.1;
    return;
  }
  if (st.mode === 'sit') {
    hips.position.y = 0.45;
    legL.rotation.x = legR.rotation.x = 1.45; kneeL.rotation.x = kneeR.rotation.x = -1.35;
    armL.rotation.x = armR.rotation.x = 0.9; elbowL.rotation.x = elbowR.rotation.x = 0.55;
    head.rotation.x = (st.pitch || 0) * 0.4;
    return;
  }
  const w = st.walk || 0, a = st.amt || 0;
  const s = Math.sin(w), c = Math.cos(w);
  legL.rotation.x = s * 0.75 * a; legR.rotation.x = -s * 0.75 * a;
  kneeL.rotation.x = -Math.max(0, -c) * 1.1 * a - 0.05; kneeR.rotation.x = -Math.max(0, c) * 1.1 * a - 0.05;
  hips.position.y = 0.92 - Math.abs(c) * 0.03 * a;
  spine.rotation.y = s * 0.08 * a; spine.rotation.x = 0.04 * a;
  armL.rotation.x = -s * 0.55 * a; elbowL.rotation.x = 0.25 + Math.max(0, -s) * 0.4 * a;
  armR.rotation.x = s * 0.55 * a; elbowR.rotation.x = 0.25 + Math.max(0, s) * 0.4 * a;
  if (st.crouch) {
    hips.position.y = 0.62; legL.rotation.x += 1.0; legR.rotation.x += 1.0; kneeL.rotation.x -= 1.7; kneeR.rotation.x -= 1.7;
    spine.rotation.x = 0.35; head.rotation.x = -0.3;
  }
  if (st.held) {
    armR.rotation.x = 1.15 + (st.pitch || 0) * 0.8 + (st.swing ? Math.sin(st.swing * Math.PI) * 1.1 : 0);
    elbowR.rotation.x = 0.35;
    if (st.gun) { armL.rotation.x = 1.25 + (st.pitch || 0) * 0.8; armL.rotation.z = 0.45; elbowL.rotation.x = 0.6; }
  }
  head.rotation.x += (st.pitch || 0) * 0.5;
}
