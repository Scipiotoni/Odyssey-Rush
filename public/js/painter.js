// Spray Can: paint vehicles and buildings with colours and decals.
import * as THREE from 'three';
import { PAINT_COLORS, PAINT_NAMES, DECALS, DECAL_SIZES, SPRAY_RANGE } from '/shared/paint.js';

const _ray = new THREE.Raycaster(), _inv = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const SIZE_NAMES = ['Small', 'Medium', 'Large'];

export class Painter {
  constructor(game) {
    this.game = game;
    this.color = 4; this.decal = 0; this.size = 1;
    try { const s = JSON.parse(localStorage.getItem('or_paint') || '{}'); if (s.c >= 0) this.color = s.c; if (s.d >= 0) this.decal = s.d; if (s.s >= 0) this.size = s.s; } catch {}
    this.cool = 0;
  }
  save() { try { localStorage.setItem('or_paint', JSON.stringify({ c: this.color, d: this.decal, s: this.size })); } catch {} }

  // What the crosshair is on: {kind, id, root (decal frame), point & normal in root-local space}
  target() {
    const g = this.game, cam = g.camera;
    const o = cam.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = g.physics.raycast(o, d, SPRAY_RANGE, null, { filter: (c) => !c.ghost || c.ref?.kind === 's' });
    if (!hit || (hit.kind !== 's' && hit.kind !== 'v')) return null;
    let root, name;
    if (hit.kind === 'v') {
      const v = g.vehicleViews.get(hit.id);
      if (!v) return null;
      root = v.group; name = v.def.name;
    } else {
      const e = g.structures.map.get(hit.id);
      if (!e) return null;
      root = e.obj.userData.decalRoot || e.obj; name = e.s.k === 'piece' ? 'wall' : e.s.k === 'door' ? 'door' : 'object';
      if (e.s.k === 'piece') name = e.s.type.replace('_', ' ');
    }
    root.updateMatrixWorld(true);
    // exact surface point + face normal from the visible mesh (not the collision box)
    _ray.set(o, d); _ray.far = SPRAY_RANGE + 1;
    const hits = _ray.intersectObject(root, true).filter((h) => !h.object.userData.decal && h.face);
    let local = null;
    if (hits.length) {
      const h = hits[0];
      const n = h.face.normal.clone().applyMatrix3(_nm.getNormalMatrix(h.object.matrixWorld)).normalize();
      if (n.dot(d) > 0) n.negate();
      _inv.copy(root.matrixWorld).invert();
      const lp = h.point.clone().applyMatrix4(_inv);
      const ln = n.transformDirection(_inv);
      local = { p: [lp.x, lp.y, lp.z], n: [ln.x, ln.y, ln.z], world: h.point };
    }
    return { kind: hit.kind, id: hit.id, name, local, point: local ? local.world : hit.point };
  }

  update(input) {
    const g = this.game;
    g.builder.hide();
    this.cool -= 1 / 60;
    const t = this.target();
    const sw = `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;background:#${new THREE.Color(PAINT_COLORS[this.color]).getHexString()}"></span>`;
    const keys = `<small><kbd>LMB</kbd> paint colour · <kbd>RMB</kbd> spray decal · <kbd>X</kbd> clean · <kbd>R</kbd> palette</small>`;
    if (!t) g.ui.prompt(`🎨 ${sw} ${PAINT_NAMES[this.color]} · ${DECALS[this.decal]} (${SIZE_NAMES[this.size]})<br><small>Aim at a vehicle, wall, door or furniture</small><br>${keys}`);
    else g.ui.prompt(`🎨 ${sw} <b>${PAINT_NAMES[this.color]}</b> → ${t.name} · decal: ${DECALS[this.decal]} (${SIZE_NAMES[this.size]})<br>${keys}`);
    if (input.hit('KeyR')) { g.ui.show('paint'); return; }
    if (!t || this.cool > 0) return;
    const base = { t: 'paint', k: t.kind, id: t.id, sel: g.sel };
    let sent = false;
    if (input.mouse.leftPressed) { g.net.send({ ...base, m: 'color', c: this.color }); sent = true; }
    else if (input.mouse.rightPressed && t.local) { g.net.send({ ...base, m: 'decal', d: this.decal, c: this.color, sz: this.size, p: t.local.p, n: t.local.n, r: 0 }); sent = true; }
    else if (input.mouse.rightPressed) g.ui.toast("Can't spray a decal there");
    else if (input.hit('KeyX')) { g.net.send({ ...base, m: 'clear' }); sent = true; }
    if (sent) {
      this.cool = 0.25;
      g.held.swingAnim(0.2);
      g.effects.burst(t.point, { count: 18, color: PAINT_COLORS[this.color], speed: 1.2, up: 0.2, size: 0.07, life: 0.5, gravity: 1, drag: 2, jitter: 0.25 });
    }
  }
}
export { SIZE_NAMES };
