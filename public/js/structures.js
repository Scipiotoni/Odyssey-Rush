// Client mirror of server structures: meshes, colliders and building indexes.
import * as THREE from 'three';
import { worldBoxes, buildIndex } from '/shared/building.js';
import { TIER_MATS, pieceGeometry, makeDoor, deployGeometry, MAT } from './models.js';

export class Structures {
  constructor(scene, physics, effects) {
    this.scene = scene; this.physics = physics; this.effects = effects;
    this.map = new Map();       // id -> {s, obj}
    this.buildings = new Map(); // bid -> {x,y,z,yaw, pieces: Map id->s}
    this.fires = [];
  }

  upsert(s) {
    const old = this.map.get(s.id);
    if (old) {
      // tier change or door open/close -> rebuild visuals; hp only -> just store
      const visual = old.s.tier !== s.tier || old.s.open !== s.open || old.s.auth !== s.auth;
      old.s = s;
      if (s.k === 'piece') this.buildings.get(s.bid)?.pieces.set(s.id, s);
      if (!visual) return;
      this.remove(s.id, false);
    }
    let obj;
    if (s.k === 'piece') {
      obj = new THREE.Mesh(pieceGeometry(s.type), TIER_MATS[s.tier] || TIER_MATS[0]);
      if (s.b) {
        let b = this.buildings.get(s.bid);
        if (!b) { b = { id: s.bid, x: s.b[0], y: s.b[1], z: s.b[2], yaw: s.b[3], pieces: new Map() }; this.buildings.set(s.bid, b); }
        b.pieces.set(s.id, s);
      }
    } else if (s.k === 'door') {
      obj = makeDoor(s.dt);
      if (s.open) obj.userData.pivot.rotation.y = -Math.PI / 2 * 0.95;
    } else {
      obj = new THREE.Mesh(deployGeometry(s.type), MAT);
      if (s.type === 'campfire' || s.type === 'furnace') {
        const light = new THREE.PointLight(0xff9040, 6, 14, 1.6);
        light.position.y = s.type === 'campfire' ? 0.6 : 1.0;
        obj.add(light);
        this.fires.push({ id: s.id, light, s });
      }
    }
    obj.position.set(s.x, s.y, s.z);
    obj.rotation.y = s.yaw;
    obj.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    obj.matrixAutoUpdate = s.k === 'door';
    obj.updateMatrix();
    this.scene.add(obj);
    for (const b of worldBoxes(s)) this.physics.add('s:' + s.id, { t: 'box', ...b, ref: { kind: 's', id: s.id } });
    if (s.k === 'door' && s.open) for (const b of worldBoxes({ ...s, open: false })) this.physics.add('s:' + s.id, { t: 'box', ...b, ref: { kind: 's', id: s.id }, ghost: true });
    else if (!worldBoxes(s).length && s.type !== 'sleeping_bag') this.physics.add('s:' + s.id, { t: 'cyl', x: s.x, y: s.y, z: s.z, r: 0.5, h: 0.4, ref: { kind: 's', id: s.id }, ghost: true });
    if (s.type === 'sleeping_bag') this.physics.add('s:' + s.id, { t: 'box', x: s.x, y: s.y + 0.08, z: s.z, hx: 0.4, hy: 0.08, hz: 1, yaw: s.yaw, ref: { kind: 's', id: s.id }, ghost: true });
    this.map.set(s.id, { s, obj });
  }

  remove(id, fx = false) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    this.physics.removeGroup('s:' + id);
    this.map.delete(id);
    this.fires = this.fires.filter((f) => f.id !== id);
    if (e.s.k === 'piece') {
      const b = this.buildings.get(e.s.bid);
      if (b) { b.pieces.delete(id); if (!b.pieces.size) this.buildings.delete(e.s.bid); }
    }
    if (fx) {
      const col = e.s.k === 'piece' ? TIER_MATS[e.s.tier].color.getHex() : 0x7a5534;
      this.effects.burst({ x: e.s.x, y: e.s.y + 1.2, z: e.s.z }, { count: 26, color: col, speed: 5, up: 1.2, size: 0.25, life: 1.4, gravity: 12, drag: 0.5, jitter: 1.5 });
    }
  }

  index(bid) {
    const b = this.buildings.get(bid);
    return buildIndex(b ? [...b.pieces.values()] : []);
  }

  // Building nearest to a point (within r metres of any piece)
  nearestBuilding(x, z, r = 10) {
    let best = null, bd = r;
    for (const e of this.map.values()) {
      if (e.s.k !== 'piece') continue;
      const d = Math.hypot(e.s.x - x, e.s.z - z);
      if (d < bd) { bd = d; best = this.buildings.get(e.s.bid); }
    }
    return best;
  }

  update(dt) {
    for (const f of this.fires) {
      f.light.intensity = 5 + Math.random() * 2.5;
      if (Math.random() < dt * 25) this.effects.burst({ x: f.s.x, y: f.s.y + (f.s.type === 'campfire' ? 0.3 : 1.6), z: f.s.z }, { count: 1, color: Math.random() < 0.5 ? 0xffa030 : 0xff5010, speed: 0.6, up: 2, size: 0.12, life: 0.7, gravity: -2, drag: 1, glow: true, jitter: 0.3 });
    }
  }
}
