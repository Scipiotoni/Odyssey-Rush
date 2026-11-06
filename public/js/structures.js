// Client mirror of server structures: meshes, colliders and building indexes.
import * as THREE from 'three';
const _m = new THREE.Matrix4(), _ml = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
import { worldBoxes, buildIndex, slotKey, TIERS, LEVEL_H } from '/shared/building.js';
import { sealedRooms, cellAt, roomOfCell } from '/shared/sealed.js';
import { reinforceGeometry, TIER_MATS, pieceGeometry, makeDoor, deployGeometry, MAT, DOOR_MATS } from './models.js';
import { paintGeometry, paintedMaterial, applyDecals } from './paint.js';
import { WORLD_MAT } from './season.js';

export class Structures {
  constructor(scene, physics, effects) {
    this.scene = scene; this.physics = physics; this.effects = effects;
    this.map = new Map();       // id -> {s, obj}
    this.buildings = new Map(); // bid -> {x,y,z,yaw, pieces: Map id->s}
    this.fires = [];
    // wall torches share a small pool of lights that follow the nearest ones (lights cost every shader, and adding one recompiles them all)
    this.torchPool = Array.from({ length: 8 }, () => { const l = new THREE.PointLight(0xffa850, 0, 14, 1.5); scene.add(l); return l; });
    this.attached = new Map(); // vehicle id -> Set of struct ids riding on it (hauler deck)
  }
  // air-filled watertight rooms (shared/sealed.js); cached per building until anything changes. Water levels in them
  // come from the server ('flood' messages): this.flood bid -> {roomKey: metres}
  roomsOf(b) {
    if (b._roomRev === this.rev) return b._rooms;
    b._roomRev = this.rev;
    const pieces = [...b.pieces.values()];
    if (!pieces.some((p) => TIERS[p.tier]?.sealed)) return (b._rooms = []);
    const doors = new Map();
    for (const e of this.map.values()) {
      if (e.s.k !== 'door') continue;
      const dw = b.pieces.get(e.s.parent);
      if (dw) doors.set(slotKey(dw.gx, dw.gz, dw.level, 'edge'), { sealed: e.s.dt === 'sealed', open: !!e.s.open });
    }
    return (b._rooms = sealedRooms(pieces, doors));
  }
  ladderNear(p) {
    if (!this._ladders || this._ladRev !== this.rev) { this._ladRev = this.rev; this._ladders = [...this.map.values()].filter((e) => e.s.type === 'ladder').map((e) => e.s); }
    for (const s of this._ladders) if (Math.hypot(s.x - p.x, s.z - p.z) < 0.85 && p.y > s.y - 0.4 && p.y < s.y + 3.3) return s;
    return null;
  }
  dryOf(b) { const d = new Set(); for (const r of this.roomsOf(b)) for (const k of r.cells) d.add(k); return d; }
  roomAt(x, y, z) {
    for (const b of this.buildings.values()) {
      if (Math.abs(b.x - x) > 60 || Math.abs(b.z - z) > 60) continue;
      const rooms = this.roomsOf(b);
      if (!rooms.length) continue;
      const k = cellAt(b, x, y, z), room = k && roomOfCell(rooms, k);
      if (room) return { b, room, floorY: b.y + room.L * LEVEL_H, level: this.flood?.get(b.id)?.[room.key] || 0 };
    }
    return null;
  }
  // in a room's air (not under its water)
  dryAt(x, y, z) { const r = this.roomAt(x, y, z); return !!r && y > r.floorY + r.level; }
  countVehicle(vid) { return this.attached.get(vid)?.size || 0; }
  removeVehicle(vid) { for (const id of [...(this.attached.get(vid) || [])]) this.remove(id); this.attached.delete(vid); }

  upsert(s) {
    this.rev = (this.rev || 0) + 1;
    const old = this.map.get(s.id);
    if (old) {
      // tier change or door open/close -> rebuild visuals; hp only -> just store
      const visual = old.s.tier !== s.tier || old.s.rf !== s.rf || old.s.open !== s.open || old.s.auth !== s.auth || old.s.pa !== s.pa || JSON.stringify(old.s.dc) !== JSON.stringify(s.dc);
      old.s = s;
      if (s.k === 'piece') this.buildings.get(s.bid)?.pieces.set(s.id, s);
      if (!visual) return;
      this.remove(s.id, false);
    }
    let obj;
    if (s.k === 'piece') {
      const pg = pieceGeometry(s.type, s.tier || 0);
      obj = new THREE.Mesh(s.pa !== undefined ? paintGeometry(pg, `p_${s.type}_${s.tier || 0}`, s.pa) : pg, s.type === 'roof' ? WORLD_MAT : MAT); // snow settles on roofs
      if (s.rf) { const rg = reinforceGeometry(s.type, s.rf); if (rg) obj.add(new THREE.Mesh(rg, MAT)); }
      if (s.b) {
        let b = this.buildings.get(s.bid);
        if (!b) { b = { id: s.bid, x: s.b[0], y: s.b[1], z: s.b[2], yaw: s.b[3], pieces: new Map() }; this.buildings.set(s.bid, b); }
        b.pieces.set(s.id, s);
      }
    } else if (s.k === 'door') {
      obj = makeDoor(s.dt);
      if (s.pa !== undefined) { const slab = obj.userData.pivot.children[0]; slab.material = paintedMaterial(s.pa, DOOR_MATS[s.dt] || DOOR_MATS.wood); }
      obj.userData.decalRoot = obj.userData.pivot;
      if (s.open) obj.userData.pivot.rotation.y = -Math.PI / 2 * 0.95;
    } else {
      const dg = deployGeometry(s.type);
      obj = new THREE.Mesh(s.pa !== undefined ? paintGeometry(dg, 'd_' + s.type, s.pa) : dg, MAT);
      if (s.type === 'wall_torch') this.fires.push({ id: s.id, light: null, s, obj, torch: true });
      if (s.type === 'lamp') { const light = new THREE.PointLight(0xffe2a8, 5, 16, 1.4); light.position.y = 1.5; obj.add(light); }
      if (s.type === 'campfire' || s.type === 'furnace') {
        const light = new THREE.PointLight(0xff9040, 6, 14, 1.6);
        light.position.y = s.type === 'campfire' ? 0.6 : 1.0;
        obj.add(light);
        this.fires.push({ id: s.id, light, s });
      }
    }
    obj.position.set(s.x, s.y, s.z);
    obj.rotation.y = s.yaw;
    if (s.dc?.length) applyDecals(obj.userData.decalRoot || obj, s.dc);
    obj.traverse((o) => { if (!o.userData.decal) { o.castShadow = true; o.receiveShadow = true; } });
    if (s.veh) {
      // rides on a vehicle: transform follows the vehicle every frame, colliders are dynamic
      const [lx, ly, lz, lyaw] = s.l;
      const loc = { ...s, x: lx, y: ly, z: lz, yaw: lyaw };
      const ref = { kind: 's', id: s.id, veh: s.veh };
      const boxes = worldBoxes(loc);
      const dyn = boxes.map((b) => ({ t: 'box', ...b, rad: Math.hypot(b.hx, b.hz) + 0.3, ref, lb: b }));
      if (s.k === 'door' && s.open) for (const b of worldBoxes({ ...loc, open: false })) dyn.push({ t: 'box', ...b, rad: Math.hypot(b.hx, b.hz) + 0.3, ref, lb: b, ghost: true });
      if (!boxes.length) dyn.push({ t: 'box', x: lx, y: ly + 0.25, z: lz, hx: 0.5, hy: 0.25, hz: 0.5, yaw: lyaw, rad: 0.8, ref, lb: { x: lx, y: ly + 0.25, z: lz, yaw: lyaw }, ghost: true });
      obj.matrixAutoUpdate = false;
      if (s.k === 'door') obj.userData.pivot.matrixAutoUpdate = true;
      this.scene.add(obj);
      this.physics.dynamic.push(...dyn);
      let set = this.attached.get(s.veh);
      if (!set) { set = new Set(); this.attached.set(s.veh, set); }
      set.add(s.id);
      this.map.set(s.id, { s, obj, dyn, local: loc });
      return;
    }
    obj.matrixAutoUpdate = s.k === 'door';
    obj.updateMatrix();
    this.scene.add(obj);
    for (const b of worldBoxes(s)) this.physics.add('s:' + s.id, { t: 'box', ...b, ref: { kind: 's', id: s.id } });
    if (s.k === 'door' && s.open) for (const b of worldBoxes({ ...s, open: false })) this.physics.add('s:' + s.id, { t: 'box', ...b, ref: { kind: 's', id: s.id }, ghost: true });
    else if (!worldBoxes(s).length && s.type !== 'sleeping_bag') this.physics.add('s:' + s.id, { t: 'cyl', x: s.x, y: s.y, z: s.z, r: 0.5, h: 0.4, ref: { kind: 's', id: s.id }, ghost: true });
    if (s.type === 'sleeping_bag') this.physics.add('s:' + s.id, { t: 'box', x: s.x, y: s.y + 0.08, z: s.z, hx: 0.4, hy: 0.08, hz: 1, yaw: s.yaw, ref: { kind: 's', id: s.id }, ghost: true });
    this.map.set(s.id, { s, obj });
    if (s.k === 'piece' || s.type === 'bed' || s.type === 'rug') this.onChange?.(s.x, s.z);
  }

  remove(id, fx = false) {
    this.rev = (this.rev || 0) + 1;
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    this.physics.removeGroup('s:' + id);
    if (e.dyn) { this.physics.dynamic = this.physics.dynamic.filter((c) => !e.dyn.includes(c)); this.attached.get(e.s.veh)?.delete(id); }
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
      if (e.s.k !== 'piece' || e.s.veh) continue;
      const d = Math.hypot(e.s.x - x, e.s.z - z);
      if (d < bd) { bd = d; best = this.buildings.get(e.s.bid); }
    }
    return best;
  }

  // Move structures that ride on vehicles (call after the vehicle views have updated).
  updateAttached(views) {
    for (const [vid, set] of this.attached) {
      const v = views.get(vid);
      for (const id of set) {
        const e = this.map.get(id);
        if (!e) continue;
        e.obj.visible = !!v;
        if (!v) { for (const c of e.dyn) c.x = 1e9; continue; }
        const l = e.local;
        _ml.compose(_v.set(l.x, l.y, l.z), _qy.setFromAxisAngle(_up, l.yaw), _one);
        e.obj.matrix.copy(_m.compose(v.pos, v.q, _one)).multiply(_ml);
        e.obj.matrixWorldNeedsUpdate = true;
        _v.set(l.x, l.y, l.z).applyQuaternion(v.q).add(v.pos);
        e.s.x = _v.x; e.s.y = _v.y; e.s.z = _v.z; e.s.yaw = v.yaw + l.yaw;
        for (const c of e.dyn) {
          _v.set(c.lb.x, c.lb.y, c.lb.z).applyQuaternion(v.q);
          c.x = v.pos.x + _v.x; c.y = v.pos.y + _v.y; c.z = v.pos.z + _v.z; c.yaw = v.yaw + c.lb.yaw;
        }
      }
    }
  }

  update(dt, cam) {
    if (cam) {
      const ts = this.fires.filter((f) => f.torch).map((f) => [f, (f.s.x - cam.x) ** 2 + (f.s.y - cam.y) ** 2 + (f.s.z - cam.z) ** 2]).filter((a) => a[1] < 60 * 60).sort((a, b) => a[1] - b[1]);
      this.torchPool.forEach((l, i) => {
        const f = ts[i]?.[0];
        if (!f) { l.intensity = 0; return; }
        const p = new THREE.Vector3(0, 0.6, 0.12).applyMatrix4(f.obj.matrixWorld);
        l.position.copy(p); l.intensity = 3.2 + Math.random() * 1.2;
      });
    }
    for (const f of this.fires) {
      if (!f.light) continue;
      f.light.intensity = 5 + Math.random() * 2.5;
      if (Math.random() < dt * (f.torch ? 10 : 25)) this.effects.burst({ x: f.s.x, y: f.s.y + (f.s.type === 'campfire' ? 0.3 : f.torch ? 0.55 : 1.6), z: f.s.z }, { count: 1, color: Math.random() < 0.5 ? 0xffa030 : 0xff5010, speed: 0.6, up: 2, size: 0.12, life: 0.7, gravity: -2, drag: 1, glow: true, jitter: 0.3 });
    }
  }
}
