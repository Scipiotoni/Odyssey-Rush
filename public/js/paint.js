// Spray paint: painted geometry tints and procedurally drawn decal textures (no image files).
import * as THREE from 'three';
import { PAINT_COLORS, DECALS, DECAL_SIZES } from '/shared/paint.js';

// ---------------------------------------------------------------- painted pieces
// Keep the light/dark detail of the original vertex colours but shift them toward the paint colour.
const paintedGeo = new Map();
export function paintGeometry(geo, key, paint) {
  const k = key + '|' + paint;
  let g = paintedGeo.get(k);
  if (g) return g;
  g = geo.clone();
  const col = g.getAttribute('color');
  if (col) {
    const pc = new THREE.Color(PAINT_COLORS[paint]);
    const a = col.array;
    for (let i = 0; i < a.length; i += 3) {
      const lum = a[i] * 0.3 + a[i + 1] * 0.55 + a[i + 2] * 0.15;
      const shade = 0.72 + Math.min(0.5, lum * 0.9); // keep wood grain / stone blocks readable
      a[i] = Math.min(1, pc.r * shade); a[i + 1] = Math.min(1, pc.g * shade); a[i + 2] = Math.min(1, pc.b * shade);
    }
    col.needsUpdate = true;
  }
  paintedGeo.set(k, g);
  return g;
}
const paintMats = new Map();
export function paintedMaterial(paint, base) {
  const k = paint + '|' + (base?.uuid || '');
  let m = paintMats.get(k);
  if (!m) { m = (base || new THREE.MeshLambertMaterial({ flatShading: true })).clone(); m.color = new THREE.Color(PAINT_COLORS[paint]).multiplyScalar(0.95); paintMats.set(k, m); }
  return m;
}

// ---------------------------------------------------------------- decal textures
const S = 256;
function star(ctx, cx, cy, r1, r2, n, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath();
}
const DRAW = [
  // Skull
  (c) => {
    c.beginPath(); c.ellipse(128, 108, 78, 74, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(82, 150, 92, 62, 14); c.fill(); c.stroke();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.ellipse(96, 112, 22, 25, 0.15, 0, Math.PI * 2); c.ellipse(160, 112, 22, 25, -0.15, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(128, 138); c.lineTo(116, 162); c.lineTo(140, 162); c.closePath(); c.fill();
    for (let i = 0; i < 4; i++) c.fillRect(96 + i * 20, 186, 8, 28);
    c.restore();
  },
  (c) => { star(c, 128, 134, 112, 46, 5); c.fill(); c.stroke(); }, // Star
  (c) => { // Flames
    c.beginPath(); c.moveTo(20, 230);
    const tips = [[40, 120], [70, 160], [96, 40], [128, 150], [150, 70], [178, 150], [206, 20], [222, 160], [240, 110]];
    let x0 = 20;
    for (const [x, y] of tips) { c.quadraticCurveTo((x0 + x) / 2 - 10, 200, x, y); c.quadraticCurveTo(x + 6, 190, x + 12, 200); x0 = x; }
    c.lineTo(248, 230); c.closePath(); c.fill(); c.stroke();
  },
  (c) => { c.beginPath(); c.moveTo(150, 10); c.lineTo(60, 140); c.lineTo(122, 140); c.lineTo(96, 246); c.lineTo(200, 100); c.lineTo(136, 100); c.lineTo(176, 10); c.closePath(); c.fill(); c.stroke(); }, // Lightning
  (c) => { c.beginPath(); c.moveTo(128, 232); c.bezierCurveTo(-40, 120, 40, -10, 128, 70); c.bezierCurveTo(216, -10, 296, 120, 128, 232); c.fill(); c.stroke(); }, // Heart
  (c) => { for (const x of [62, 112, 162]) { c.fillRect(x, 0, 32, S); c.strokeRect(x, -4, 32, S + 8); } }, // Racing stripes
  (c) => { c.beginPath(); c.arc(128, 128, 112, 0, Math.PI * 2); c.fill(); c.stroke(); c.save(); c.globalCompositeOperation = 'destination-out'; c.font = 'bold 170px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('7', 128, 140); c.restore(); }, // Number 7
  (c) => { // Target
    c.save(); c.lineWidth = 22; c.strokeStyle = '#fff';
    for (const r of [104, 62]) { c.beginPath(); c.arc(128, 128, r, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(128, 128, 22, 0, Math.PI * 2); c.fill();
    c.fillRect(120, 0, 16, 60); c.fillRect(120, 196, 16, 60); c.fillRect(0, 120, 60, 16); c.fillRect(196, 120, 60, 16); c.restore();
  },
  (c) => { // Hazard
    c.beginPath(); c.moveTo(128, 14); c.lineTo(244, 222); c.lineTo(12, 222); c.closePath(); c.fill(); c.stroke();
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillRect(116, 80, 24, 82); c.beginPath(); c.arc(128, 190, 15, 0, Math.PI * 2); c.fill(); c.restore();
  },
  (c) => { // Paw
    c.beginPath(); c.ellipse(128, 170, 62, 52, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    for (const [x, y, a] of [[56, 104, -0.4], [100, 62, -0.1], [156, 62, 0.1], [200, 104, 0.4]]) { c.beginPath(); c.ellipse(x, y, 24, 32, a, 0, Math.PI * 2); c.fill(); c.stroke(); }
  },
  (c) => { // Smiley
    c.beginPath(); c.arc(128, 128, 112, 0, Math.PI * 2); c.fill(); c.stroke();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.ellipse(90, 100, 14, 22, 0, 0, Math.PI * 2); c.ellipse(166, 100, 14, 22, 0, 0, Math.PI * 2); c.fill();
    c.lineWidth = 18; c.beginPath(); c.arc(128, 132, 62, 0.25, Math.PI - 0.25); c.stroke(); c.restore();
  },
  (c) => { c.beginPath(); c.moveTo(16, 96); c.lineTo(140, 96); c.lineTo(140, 36); c.lineTo(244, 128); c.lineTo(140, 220); c.lineTo(140, 160); c.lineTo(16, 160); c.closePath(); c.fill(); c.stroke(); }, // Arrow
  (c) => { // Flower
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; c.beginPath(); c.ellipse(128 + Math.cos(a) * 60, 128 + Math.sin(a) * 60, 46, 30, a, 0, Math.PI * 2); c.fill(); c.stroke(); }
    c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(128, 128, 30, 0, Math.PI * 2); c.fill(); c.restore();
    c.beginPath(); c.arc(128, 128, 18, 0, Math.PI * 2); c.fill();
  },
  (c) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) c.fillRect(i * 64, j * 64, 64, 64); c.strokeRect(2, 2, S - 4, S - 4); }, // Checker
  (c) => { c.beginPath(); c.moveTo(24, 200); c.lineTo(14, 60); c.lineTo(78, 120); c.lineTo(128, 30); c.lineTo(178, 120); c.lineTo(242, 60); c.lineTo(232, 200); c.closePath(); c.fill(); c.stroke(); c.fillRect(24, 212, 208, 26); c.strokeRect(24, 212, 208, 26); }, // Crown
  (c) => { // Tag (graffiti scribble)
    c.save(); c.lineWidth = 26; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#fff';
    c.beginPath(); c.moveTo(20, 170); c.bezierCurveTo(40, 40, 90, 40, 80, 170); c.bezierCurveTo(90, 90, 140, 70, 140, 170); c.bezierCurveTo(150, 60, 220, 60, 200, 150); c.quadraticCurveTo(190, 200, 240, 190); c.stroke();
    c.lineWidth = 10; c.beginPath(); c.moveTo(16, 214); c.lineTo(240, 222); c.stroke(); c.restore();
  },
];
const texCache = new Map();
export function decalTexture(d) {
  let t = texCache.get(d);
  if (t) return t;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = 8; c.lineJoin = 'round';
  (DRAW[d] || DRAW[0])(c);
  // spray-paint speckle around the edges
  const id = c.getImageData(0, 0, S, S), px = id.data;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0 && Math.random() < 0.025) px[i] *= 0.55;
  c.putImageData(id, 0, 0);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(d, t);
  return t;
}
export function decalPreview(d, color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.drawImage(decalTexture(d).image, 0, 0, 64, 64);
  // tint the white parts (black outline stays black), then mask back to the decal's alpha
  c.fillStyle = '#' + new THREE.Color(PAINT_COLORS[color]).getHexString();
  c.globalCompositeOperation = 'multiply'; c.fillRect(0, 0, 64, 64);
  c.globalCompositeOperation = 'destination-in'; c.drawImage(decalTexture(d).image, 0, 0, 64, 64);
  return cv.toDataURL();
}

const decalMats = new Map();
function decalMaterial(d, color) {
  const k = d + '|' + color;
  let m = decalMats.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: decalTexture(d), color: PAINT_COLORS[color], transparent: true, alphaTest: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    decalMats.set(k, m);
  }
  return m;
}
const _z = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _up2 = new THREE.Vector3(), _mb = new THREE.Matrix4();
const planes = DECAL_SIZES.map((s) => new THREE.PlaneGeometry(s, s));
// One decal mesh in the target's local frame: {d, c, sz, p:[x,y,z], n:[x,y,z], r}
export function makeDecal(dc) {
  const m = new THREE.Mesh(planes[dc.sz] || planes[1], decalMaterial(dc.d, dc.c));
  _n.set(dc.n[0], dc.n[1], dc.n[2]).normalize();
  m.position.set(dc.p[0] + _n.x * 0.015, dc.p[1] + _n.y * 0.015, dc.p[2] + _n.z * 0.015);
  // keep the decal upright on walls; on floors/roofs "up" points along -z
  const up = Math.abs(_n.y) > 0.9 ? _up2.set(0, 0, -1) : _up2.set(0, 1, 0);
  _x.crossVectors(up, _n).normalize(); _y.crossVectors(_n, _x);
  m.quaternion.setFromRotationMatrix(_mb.makeBasis(_x, _y, _n)).multiply(_q.setFromAxisAngle(_z, dc.r || 0));
  m.renderOrder = 2;
  m.userData.decal = true;
  return m;
}
// Replace the decal children of an object.
export function applyDecals(obj, list) {
  for (const ch of [...obj.children]) if (ch.userData.decal) obj.remove(ch);
  for (const dc of list || []) obj.add(makeDecal(dc));
}
export { PAINT_COLORS, DECALS };
