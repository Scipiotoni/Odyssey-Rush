// Building plan / deployable / hammer placement logic with snapping ghosts.
import * as THREE from 'three';
import { RAFT_Y, isBase, REINFORCE, reinforceCost, G, LEVEL_H, BUILD_REACH, PIECES, TIERS, pieceTransform, canPlaceAny, buildIndex, pieceCost, invRotY, rotY } from '/shared/building.js';
import { POI_FLAT } from '/shared/worldgen.js';
import { ITEMS } from '/shared/items.js';
import { pieceGeometry, deployGeometry } from './models.js';
import { countItem, isFree } from './ui.js';

const _l = new THREE.Vector3(), _iq = new THREE.Quaternion(), _yq = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
const OK = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.35, depthWrite: false });
const BAD = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false });

export class Builder {
  constructor(game) {
    this.game = game;
    this.piece = 'foundation';
    this.tier = 0;        // material chosen in the build wheel
    this.cat = 'construction';
    this.furn = null;     // furniture item id when placing furniture with the plan
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

  // where the aim crosses the sea surface (for rafts and things that float), or null
  waterPoint(reach = BUILD_REACH + 2) {
    const cam = this.game.camera.position, dir = this.game.held.dir();
    // swimming (eyes at the waterline): a spot a few metres ahead on the water
    if (cam.y < 0.5) { const l = Math.hypot(dir.x, dir.z) || 1; return new THREE.Vector3(cam.x + (dir.x / l) * 3.5, 0, cam.z + (dir.z / l) * 3.5); }
    if (dir.y > -0.02) return null;
    const t = -cam.y / dir.y;
    return t < reach ? new THREE.Vector3(cam.x + dir.x * t, 0, cam.z + dir.z * t) : null;
  }
  raftWater(b, gx, gz) {
    if (Math.abs(b.y - RAFT_Y) > 0.3) return 'Rafts float at sea level — start a separate raft base on the water';
    const w = this.game.world, t = pieceTransform(b, { type: 'raft', gx, gz, level: 0 });
    let wet = 0;
    for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const [dx, dz] = rotY(cx, cz, t.yaw); if (w.ground(t.x + dx, t.z + dz) < -0.25) wet++; }
    if (w.ground(t.x, t.z) > -0.5 || wet < 2) return 'Rafts need open water under them (at least 0.5 m deep)';
    return null;
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
    if (w.ground(t.x, t.z) < -2 && !TIERS[this.tier]?.sealed) return 'Water is too deep — build underwater with Watertight Steel';
    return null;
  }

  // Vehicle with a buildable deck that the crosshair is on (hauler), with the aim point in its local frame.
  deckHit(hit) {
    const ref = hit?.ref;
    const vid = ref && (ref.veh || (ref.kind === 'v' && ref.deck ? ref.id : null));
    const view = vid && this.game.vehicleViews.get(vid);
    if (!view || !view.def.deck || view.yaw === undefined) return null;
    const p = hit.point;
    _l.set(p.x, p.y, p.z).sub(view.pos).applyQuaternion(_iq.copy(view.q).invert());
    return { view, l: _l.clone() };
  }
  toWorld(view, t) {
    const w = new THREE.Vector3(t.x, t.y, t.z).applyQuaternion(view.q).add(view.pos);
    return { pos: w, quat: view.q.clone().multiply(_yq.setFromAxisAngle(_Y, t.yaw)) };
  }
  snap(type, fx, fz, ly) {
    let gx, gz, level;
    if (PIECES[type].slot === 'cell') {
      gx = 2 * Math.round(fx); gz = 2 * Math.round(fz);
      level = isBase(type) ? 0 : type === 'floor' || type === 'roof' ? Math.max(1, Math.round(ly / LEVEL_H)) : Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
    } else {
      const i = Math.round(fx), j = Math.round(fz), dx = fx - i, dz = fz - j;
      if (Math.abs(dx) > Math.abs(dz)) { gx = 2 * i + Math.sign(dx || 1); gz = 2 * j; } else { gx = 2 * i; gz = 2 * j + Math.sign(dz || 1); }
      level = Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
    }
    return { gx, gz, level };
  }
  updateDeckPlan(type, dk) {
    const g = this.game, { view } = dk, d = view.def.deck;
    const { gx, gz, level } = this.snap(type, (dk.l.x - d.x) / G, (dk.l.z - d.z) / G, dk.l.y - d.y);
    const bid = 'D' + view.id;
    const pieces = [];
    for (const e of g.structures.map.values()) if (e.s.k === 'piece' && e.s.bid === bid) pieces.push(e.s);
    let err = null;
    if (type === 'foundation') err = 'The deck is already a foundation — build walls, floors and stairs on it';
    else if (Math.abs(gx) > 1 || gz < Math.min(...d.cells) - 1 || gz > Math.max(...d.cells) + 1) err = 'Outside the deck';
    else if (level > d.levels) err = `Too high for the ${view.def.name}`;
    else err = canPlaceAny(type, gx, gz, level, buildIndex([...pieces, ...d.cells.map((c) => ({ type: 'foundation', gx: 0, gz: c, level: 0 }))]), false);
    const t = pieceTransform({ x: d.x, y: d.y, z: d.z, yaw: 0 }, { type, gx, gz, level, rot: this.rot });
    const w = this.toWorld(view, t);
    return { plan: { type, veh: view.id, gx, gz, level, rot: this.rot, w }, err };
  }

  // ------------------------------------------------------------ building plan
  updatePlan() {
    const g = this.game, type = this.piece;
    let { point, hit } = this.aim();
    if (type === 'raft') { const wp = this.waterPoint(); if (wp && (!point || hit?.kind === 'terrain' || point.y < -0.2)) { point = wp; hit = null; } }
    const dk = this.deckHit(hit);
    if (dk) {
      let { plan, err } = this.updateDeckPlan(type, dk);
      if (!err) { const cost = isFree(g) ? {} : pieceCost(type, this.tier); for (const k in cost) if (countItem(g.inv, k) < cost[k]) { err = `Need ${cost[k]} ${ITEMS[k].name}`; break; } }
      this.plan = plan; this.err = err;
      this.setGhost('p:' + type, () => pieceGeometry(type, 1));
      this.ghost.material = err ? BAD : OK;
      this.ghost.position.copy(plan.w.pos); this.ghost.quaternion.copy(plan.w.quat);
      this.ghost.visible = true;
      const cost = pieceCost(type, this.tier);
      g.ui.prompt(`🚛 <b>${TIERS[this.tier].name} ${PIECES[type].name}</b> on the ${dk.view.def.name} deck (${Object.entries(cost).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', ')})${err ? ` — <span style="color:#ff8a7a">${err}</span>` : ''}<br><small><kbd>LMB</kbd> place · <kbd>RMB</kbd> build wheel · <kbd>R</kbd> rotate</small>`);
      return;
    }
    const b = g.structures.nearestBuilding(point.x, point.z, 9);
    let plan = null, err = null;
    if (b) {
      const [lx, lz] = invRotY(point.x - b.x, point.z - b.z, b.yaw);
      const fx = lx / G, fz = lz / G, ly = point.y - b.y;
      let gx, gz, level;
      if (PIECES[type].slot === 'cell') {
        gx = 2 * Math.round(fx); gz = 2 * Math.round(fz);
        level = isBase(type) ? 0 : type === 'floor' || type === 'roof' ? Math.max(1, Math.round(ly / LEVEL_H)) : Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
      } else {
        const i = Math.round(fx), j = Math.round(fz), dx = fx - i, dz = fz - j;
        if (Math.abs(dx) > Math.abs(dz)) { gx = 2 * i + Math.sign(dx || 1); gz = 2 * j; } else { gx = 2 * i; gz = 2 * j + Math.sign(dz || 1); }
        level = Math.max(0, Math.floor((ly + 0.3) / LEVEL_H));
      }
      err = canPlaceAny(type, gx, gz, level, g.structures.index(b.id), false);
      if (!err && type === 'foundation') err = this.foundationGround(b, gx, gz);
      if (type === 'raft' && Math.abs(b.y - RAFT_Y) > 0.3) {
        // next to a foundation on the shore: the raft snaps to its grid but floats at sea level (its own raft base)
        const t = pieceTransform(b, { type, gx, gz, level: 0 }), nb = { x: t.x, y: RAFT_Y, z: t.z, yaw: b.yaw };
        if (!err) err = this.raftWater(nb, 0, 0);
        const other = g.structures.nearestBuilding(t.x, t.z, 2.2);
        if (!err && other && other.id !== b.id) err = 'Occupied';
        plan = { type, align: b.id, gx, gz, level: 0, rot: this.rot, t: { x: t.x, y: RAFT_Y, z: t.z, yaw: b.yaw } };
      } else {
        if (!err && type === 'raft') err = this.raftWater(b, gx, gz);
        const t = pieceTransform(b, { type, gx, gz, level, rot: this.rot });
        plan = { type, bid: b.id, gx, gz, level, rot: this.rot, t };
      }
    } else if (type === 'raft') {
      // the first raft of a new floating base: anywhere on open water
      if (!point || Math.abs(point.y) > 0.2) err = 'Aim at the water';
      const yaw = g.player.yaw, nb = { x: point?.x || 0, y: RAFT_Y, z: point?.z || 0, yaw };
      if (!err) err = this.raftWater(nb, 0, 0);
      if (!err && g.structures.nearestBuilding(nb.x, nb.z, 4.5)) err = 'Too close to another building';
      plan = { type, x: nb.x, y: nb.y, z: nb.z, yaw, t: { x: nb.x, y: nb.y, z: nb.z, yaw } };
    } else if (type === 'foundation') {
      if (!hit || hit.kind !== 'terrain') err = 'Aim at the ground';
      const yaw = g.player.yaw;
      let maxG = -Infinity;
      for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 0]]) { const [dx, dz] = rotY(cx, cz, yaw); maxG = Math.max(maxG, g.world.ground(point.x + dx, point.z + dz)); }
      const nb = { x: point.x, y: maxG + 0.1, z: point.z, yaw };
      if (!err) err = this.foundationGround(nb, 0, 0);
      plan = { type, x: nb.x, y: nb.y, z: nb.z, yaw, t: { x: nb.x, y: nb.y, z: nb.z, yaw } };
    } else err = 'Place a foundation first';
    if (plan && !err) { const cost = isFree(g) ? {} : pieceCost(type, this.tier); for (const k in cost) if (countItem(g.inv, k) < cost[k]) { err = `Need ${cost[k]} ${ITEMS[k].name}`; break; } }
    this.plan = plan; this.err = err;
    if (plan) {
      this.setGhost('p:' + type, () => pieceGeometry(type, 1));
      this.ghost.material = err ? BAD : OK;
      this.ghost.position.set(plan.t.x, plan.t.y, plan.t.z); this.ghost.rotation.set(0, plan.t.yaw, 0);
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    const cost = pieceCost(type, this.tier);
    g.ui.prompt(`<b>${TIERS[this.tier].name} ${PIECES[type].name}</b> (${Object.entries(cost).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', ')})${err ? ` — <span style="color:#ff8a7a">${err}</span>` : ''}<br><small><kbd>LMB</kbd> place · <kbd>RMB</kbd> build wheel · <kbd>R</kbd> rotate</small>`);
  }
  placePlan() {
    const p = this.plan;
    if (!p) return;
    if (this.err) { this.game.ui.toast(this.err); return; }
    if (p.veh) this.game.net.send({ t: 'build', type: p.type, tier: this.tier, veh: p.veh, gx: p.gx, gz: p.gz, level: p.level, rot: p.rot });
    else if (p.align) this.game.net.send({ t: 'build', type: p.type, tier: this.tier, align: p.align, gx: p.gx, gz: p.gz, level: 0, rot: p.rot });
    else if (p.bid) this.game.net.send({ t: 'build', type: p.type, tier: this.tier, bid: p.bid, gx: p.gx, gz: p.gz, level: p.level, rot: p.rot });
    else this.game.net.send({ t: 'build', type: p.type, tier: this.tier, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  }

  // ------------------------------------------------------------ deployables & doors
  updateDeploy(itemId) {
    const g = this.game, d = ITEMS[itemId];
    this.deployId = itemId;
    const { hit } = this.aim(5);
    let err = null, plan = null;
    if (d.door) {
      const s = hit && hit.kind === 's' ? g.structures.map.get(hit.id)?.s : null;
      if (!s || s.type !== 'doorway') err = 'Aim at a doorway';
      else {
        for (const e of g.structures.map.values()) if (e.s.k === 'door' && e.s.parent === s.id) err = 'Doorway already has a door';
        plan = { door: s.id, t: s };
      }
      this.setGhost('door', () => { const b = new THREE.BoxGeometry(1.2, 2.2, 0.1); b.translate(0, 1.1, 0); return b; });
    } else if (d.deploy?.water) {
      // floats: aim at open water at least 2.5 m deep
      const wp = this.waterPoint(9);
      if (!wp) err = 'Aim at the water';
      else if (g.world.ground(wp.x, wp.z) > -2.5) err = 'Needs open water at least 2.5 m deep';
      plan = wp ? { t: { x: wp.x, y: 0.05, z: wp.z, yaw: g.player.yaw } } : null;
      this.setGhost('d:' + d.deploy.kind, () => deployGeometry(d.deploy.kind));
    } else {
      const dk = d.deploy && this.deckHit(hit);
      if (dk) {
        const p = hit.point, v = dk.view;
        const gy = g.physics.groundAt(p.x, p.z, p.y + 0.1, 0.3);
        if (Math.abs(gy - p.y) > 0.2 && !d.deploy.wall) err = 'Needs a flat surface';
        if (d.deploy.kind === 'tool_cupboard') err = "Tool cupboards can't go on vehicles";
        let lyaw = g.player.yaw - v.yaw;
        const l = dk.l;
        if (d.deploy.wall) {
          // on a wall inside (the Pacific): back flush to the wall, facing you
          const dir = g.held.dir().applyQuaternion(_iq.copy(v.q).invert()), back = d.deploy.depth ? d.deploy.depth / 2 + 0.11 : 0.12;
          l.x -= dir.x * back; l.z -= dir.z * back; l.y -= (d.deploy.h || 0.7) / 2; lyaw = Math.atan2(dir.x, dir.z) + Math.PI;
        }
        plan = { veh: v.id, l: [l.x, l.y, l.z, lyaw], t: { x: p.x, y: p.y, z: p.z, yaw: g.player.yaw }, w: this.toWorld(v, { x: l.x, y: l.y, z: l.z, yaw: lyaw }) };
      } else if (!hit) err = 'Too far';
      else {
        const p = hit.point;
        const gy = g.physics.groundAt(p.x, p.z, p.y + 0.1, 0.3);
        if (Math.abs(gy - p.y) > 0.2 && !d.deploy?.wall) err = 'Needs a flat surface';
        const np = g.world.nearestPOI(p.x, p.z);
        if (np && np.d < POI_FLAT + 12) err = "Can't deploy in monuments";
        plan = { t: { x: p.x, y: gy, z: p.z, yaw: g.player.yaw } };
        if (d.deploy?.wall) {
          // mounted on whatever you aim at: torches where you point, ladders standing on the floor against the wall
          // machines sit flush with their back to the wall, centred on where you aim (h, depth from the item)
          const dir = g.held.dir(), back = d.deploy.depth ? d.deploy.depth / 2 + 0.11 : 0.12, bx = p.x - dir.x * back, bz = p.z - dir.z * back;
          const fy = d.deploy.kind === 'ladder' ? g.physics.groundAt(bx - dir.x * 0.2, bz - dir.z * 0.2, p.y + 0.3, 0.6) : p.y - (d.deploy.h || 0.7) / 2;
          plan = { t: { x: bx, y: fy > p.y - 4 ? fy : p.y - 1, z: bz, yaw: Math.atan2(dir.x, dir.z) + Math.PI } };
          if (d.deploy.tech && hit.kind !== 's') err = 'Mount it on a wall of your base';
        }
      }
      this.setGhost('d:' + d.deploy.kind, () => deployGeometry(d.deploy.kind));
    }
    this.plan = plan; this.err = err;
    if (plan) {
      this.ghost.material = err ? BAD : OK;
      if (plan.w) { this.ghost.position.copy(plan.w.pos); this.ghost.quaternion.copy(plan.w.quat); }
      else { this.ghost.position.set(plan.t.x, plan.t.y, plan.t.z); this.ghost.rotation.set(0, plan.t.yaw, 0); }
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    g.ui.prompt(`Place <b>${d.name}</b>${err ? ` — <span style="color:#ff8a7a">${err}</span>` : ''}<br><small><kbd>LMB</kbd> place</small>`);
  }
  placeDeploy() {
    const p = this.plan;
    if (!p) return;
    if (this.err) { this.game.ui.toast(this.err); return; }
    const id = this.deployId;
    if (p.door) this.game.net.send({ t: 'deploy', sel: this.game.sel, id, door: p.door });
    else if (p.veh) this.game.net.send({ t: 'deploy', sel: this.game.sel, id, veh: p.veh, lx: p.l[0], ly: p.l[1], lz: p.l[2], lyaw: p.l[3] });
    else this.game.net.send({ t: 'deploy', sel: this.game.sel, id, x: p.t.x, y: p.t.y, z: p.t.z, yaw: p.t.yaw });
  }

  // ------------------------------------------------------------ hammer
  updateHammer(input) {
    const g = this.game;
    this.ghost.visible = false;
    const { hit } = this.aim(4.5);
    const e = hit && hit.kind === 's' ? g.structures.map.get(hit.id) : null;
    if (!e) { g.ui.prompt('<small>Hammer: aim at a building piece. <kbd>LMB</kbd> upgrade material · <kbd>R</kbd> reinforce · <kbd>RMB</kbd> repair · <kbd>X</kbd> demolish</small>'); return; }
    const s = e.s;
    const rf = s.rf || 0;
    const name = s.k === 'piece' ? `${rf ? REINFORCE[rf].name + ' ' : ''}${TIERS[s.tier].name} ${PIECES[s.type].name}` : s.k === 'door' ? `${s.dt} door` : ITEMS[s.type]?.name || s.type;
    const ct = (c) => Object.entries(c).map(([k, v]) => v + ' ' + ITEMS[k].name).join(', ');
    let txt = `<b>${name}</b> ${s.hp}/${s.mhp}`;
    if (s.k === 'piece' && s.tier < TIERS.length - 1 && s.type !== 'raft') txt += `<br><kbd>LMB</kbd> upgrade to ${TIERS[s.tier + 1].name} (${ct(pieceCost(s.type, s.tier + 1))})`;
    if (s.k === 'piece' && rf < REINFORCE.length - 1) txt += `<br><kbd>R</kbd> reinforce: ${REINFORCE[rf + 1].name} +50% HP (${ct(reinforceCost(s.type, rf + 1))})`;
    if (s.hp < s.mhp) txt += `<br><kbd>RMB</kbd> repair`;
    g.ui.prompt(txt);
    if (input.mouse.leftPressed && s.k === 'piece' && s.tier < TIERS.length - 1 && s.type !== 'raft') { g.net.send({ t: 'upgrade', id: s.id, tier: s.tier + 1 }); g.held.swingAnim(); }
    if (input.hit('KeyR') && s.k === 'piece' && rf < REINFORCE.length - 1) { g.net.send({ t: 'reinforce', id: s.id }); g.held.swingAnim(0.5, true); }
    if (input.mouse.rightPressed) { g.net.send({ t: 'repair', id: s.id }); g.held.swingAnim(); }
    if (input.hit('KeyX')) g.net.send({ t: 'demolish', id: s.id });
  }
}
