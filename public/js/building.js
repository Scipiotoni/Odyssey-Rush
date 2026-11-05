// Building plan / deployable / hammer placement logic with snapping ghosts.
import * as THREE from 'three';
import { G, LEVEL_H, BUILD_REACH, PIECES, TIERS, pieceTransform, canPlaceAny, pieceCost, invRotY, rotY } from '/shared/building.js';
import { POI_FLAT } from '/shared/worldgen.js';
import { ITEMS } from '/shared/items.js';
import { pieceGeometry, deployGeometry } from './models.js';
import { countItem } from './ui.js';

const OK = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.35, depthWrite: false });
const BAD = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false });

export class Builder {
  constructor(game) {
    this.game = game;
    this.piece = 'foundation';  // selected construction piece (when deploy is null)
    this.deploy = null;         // selected furniture / door item id (from the build wheel)
    this.tier = 0;              // material the pieces are built from (index into TIERS)
    this.rot = 0;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), OK);
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    game.scene.add(this.ghost);
    this.plan = null;
    this.ghostKey = '';
  }
  hide() { this.ghost.visible = false; this.plan = null; }
  setGhost(key, geoFn) { if (this.ghostKey !== key) { this.ghost.geometry = geoFn(); this.ghostKey = key; } }

  aim(reach = BUILD_REACH) {
    const g = this.game, cam = g.camera;
    const o = cam.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = g.physics.raycast(o, d, reach, null, { filter: (c) => !c.ghost || c.ref?.kind === 's' });
    return { o, d, hit, point: hit ? hit.point : { x: o.x + d.x * reach, y: o.y + d.y * reach, z: o.z + d.z * reach } };
  }

  foundationGround(b, gx, gz) {
    const w = this.game.world;
    const t = pieceTransform(b, { type: 'foundation', gx, gz, level: 0 });
    for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 0]]) {
      const [dx, dz] = rotY(cx, cz, t.yaw);
      const gy = w.ground(t.x + dx, t.z + dz);
      if (gy > b.y + 0.35) return 'Ground is in the way';
      if (gy < b.y - 2.9) return 'Too steep';
    }
    const np = w.nearestPOI(t.x, t.z);
    if (np && np.d < POI_FLAT + 12) return "Can't build in monuments";
    if (w.ground(t.x, t.z) < -2) return 'Water is too deep';
    return null;
  }

  // ------------------------------------------------------------ building plan
  updatePlan() {
    const g = this.game, type = this.piece;
    const { point, hit } = this.aim();
    const b = g.structures.nearestBuilding(point.x, point.z, 9);
    let plan = null, err = null;
    if (b) {
      const [lx, lz] = invRotY(point.x - b.x, point.z - b.z, b.yaw);
      const fx = lx / G, fz = lz / G, ly = point.y - b.y;
      let gx, gz, level;
      if (PIECES[type].slot === 'cell') {
        gx = 2 * Math.round(fx); gz = 2 * Math.round(fz);
        level = type === 'foundation' ? 0 : type === 'floor' ? Math.max(1, Math.round(ly / LEVEL_H)) : Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
      } else {
        const i = Math.round(fx), j = Math.round(fz), dx = fx - i, dz = fz - j;
        if (Math.abs(dx) > Math.abs(dz)) { gx = 2 * i + Math.sign(dx || 1); gz = 2 * j; } else { gx = 2 * i; gz = 2 * j + Math.sign(dz || 1); }
        level = Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
      }
      err = canPlaceAny(type, gx, gz, level, g.structures.index(b.id), false);
      if (!err && type === 'foundation') err = this.foundationGround(b, gx, gz);
      const t = pieceTransform(b, { type, gx, gz, level, rot: this.rot });
      plan = { type, bid: b.id, gx, gz, level, rot: this.rot, tier: this.tier, t };
    } else if (type === 'foundation') {
      if (!hit || hit.kind !== 'terrain') err = 'Aim at the ground';
      const yaw = g.player.yaw;
      let maxG = -Infinity;
      for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 0]]) { const [dx, dz] = rotY(cx, cz, yaw); maxG = Math.max(maxG, g.world.ground(point.x + dx, point.z + dz)); }
      const nb = { x: point.x, y: maxG + 0.1, z: point.z, yaw };
      if (!err) err = this.foundationGround(nb, 0, 0);
      plan = { type, x: nb.x, y: nb.y, z: nb.z, yaw, tier: this.tier, t: { x: nb.x, y: nb.y, z: nb.z, yaw } };
    } else err = 'Place a foundation first';
    if (plan && !err) { const cost = pieceCost(type, this.tier); for (const k in cost) if (countItem(g.inv, k) < cost[k]) { err = `Need ${cost[k]} ${ITEMS[k].name}`; break; } }
    this.plan = plan; this.err = err;
    if (plan) {
      this.setGhost('p:' + type, () => pieceGeometry(type));
      this.ghost.material = err ? BAD : OK;
      this.ghost.position.set(plan.t.x, plan.t.y, plan.t.z); this.ghost.rotation.set(0, plan.t.yaw, 0);
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    const cost = pieceCost(type, this.tier);
    g.ui.prompt(`<b>${PIECES[type].name}</b> in ${TIERS[this.tier].name} (${Object.entries(cost).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', ')})${err ? ` — <span style="color:#ff8a7a">${err}</span>` : ''}<br><small><kbd>LMB</kbd> place · <kbd>RMB</kbd> pieces · <kbd>R</kbd> rotate</small>`);
  }
  placePlan() {
    const p = this.plan;
    if (!p) return;
    if (this.err) { this.game.ui.toast(this.err); return; }
    if (p.bid) this.game.net.send({ t: 'build', type: p.type, bid: p.bid, gx: p.gx, gz: p.gz, level: p.level, rot: p.rot, tier: p.tier });
    else this.game.net.send({ t: 'build', type: p.type, x: p.x, y: p.y, z: p.z, yaw: p.yaw, tier: p.tier });
  }

  // ------------------------------------------------------------ deployables & doors
  updateDeploy(itemId) {
    const g = this.game, d = ITEMS[itemId];
    const { hit } = this.aim(5);
    let err = null, plan = null;
    if (countItem(g.inv, itemId) <= 0) err = `You have no ${d.name}`;
    if (d.door) {
      const s = hit && hit.kind === 's' ? g.structures.map.get(hit.id)?.s : null;
      if (!s || s.type !== 'doorway') err = 'Aim at a doorway';
      else {
        for (const e of g.structures.map.values()) if (e.s.k === 'door' && e.s.parent === s.id) err = 'Doorway already has a door';
        plan = { door: s.id, t: s, item: itemId };
      }
      this.setGhost('door', () => { const b = new THREE.BoxGeometry(1.2, 2.2, 0.1); b.translate(0, 1.1, 0); return b; });
    } else {
      if (!hit) err = 'Too far';
      else {
        const p = hit.point;
        const gy = g.physics.groundAt(p.x, p.z, p.y + 0.1, 0.3);
        if (Math.abs(gy - p.y) > 0.2) err = 'Needs a flat surface';
        const np = g.world.nearestPOI(p.x, p.z);
        if (np && np.d < POI_FLAT + 12) err = "Can't deploy in monuments";
        plan = { t: { x: p.x, y: gy, z: p.z, yaw: g.player.yaw }, item: itemId };
      }
      this.setGhost('d:' + d.deploy.kind, () => deployGeometry(d.deploy.kind));
    }
    this.plan = plan; this.err = err;
    if (plan) {
      this.ghost.material = err ? BAD : OK;
      this.ghost.position.set(plan.t.x, plan.t.y, plan.t.z); this.ghost.rotation.set(0, plan.t.yaw, 0);
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    g.ui.prompt(`Place <b>${d.name}</b>${err ? ` — <span style="color:#ff8a7a">${err}</span>` : ''}<br><small><kbd>LMB</kbd> place</small>`);
  }
  placeDeploy() {
    const p = this.plan;
    if (!p) return;
    if (this.err) { this.game.ui.toast(this.err); return; }
    if (p.door) this.game.net.send({ t: 'deploy', sel: this.game.sel, item: p.item, door: p.door });
    else this.game.net.send({ t: 'deploy', sel: this.game.sel, item: p.item, x: p.t.x, y: p.t.y, z: p.t.z, yaw: p.t.yaw });
  }

  // ------------------------------------------------------------ hammer
  updateHammer(input) {
    const g = this.game;
    this.ghost.visible = false;
    const { hit } = this.aim(4.5);
    const e = hit && hit.kind === 's' ? g.structures.map.get(hit.id) : null;
    if (!e) { g.ui.prompt('<small>Hammer: aim at a building piece. <kbd>LMB</kbd> upgrade · <kbd>RMB</kbd> repair · <kbd>X</kbd> demolish</small>'); return; }
    const s = e.s;
    const name = s.k === 'piece' ? `${TIERS[s.tier].name} ${PIECES[s.type].name}` : s.k === 'door' ? `${s.dt} door` : ITEMS[s.type]?.name || s.type;
    let txt = `<b>${name}</b> ${s.hp}/${s.mhp}`;
    if (s.k === 'piece' && s.tier < TIERS.length - 1) {
      const c = pieceCost(s.type, s.tier + 1);
      txt += `<br><kbd>LMB</kbd> upgrade to ${TIERS[s.tier + 1].name} (${Object.entries(c).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', ')})`;
    }
    if (s.hp < s.mhp) txt += ` · <kbd>RMB</kbd> repair`;
    g.ui.prompt(txt);
    if (input.mouse.leftPressed && s.k === 'piece' && s.tier < TIERS.length - 1) { g.net.send({ t: 'upgrade', id: s.id, tier: s.tier + 1 }); g.held.swingAnim(); }
    if (input.mouse.rightPressed) { g.net.send({ t: 'repair', id: s.id }); g.held.swingAnim(); }
    if (input.hit('KeyX')) g.net.send({ t: 'demolish', id: s.id });
  }
}
