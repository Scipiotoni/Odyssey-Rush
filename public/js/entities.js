// Remote players, animals, lootables and live explosives.
import * as THREE from 'three';
import { ANIMALS } from '/shared/items.js';
import { VEHICLES } from '/shared/vehicles.js';
import { Interp, INTERP_DELAY } from './interp.js';
import { poseHumanoid } from './character.js';
import { decodeLook } from '/shared/look.js';
import { ITEMS as ITEMDEFS } from '/shared/items.js';
import { makeHumanoid, makeAnimal, makeItemModel, deployGeometry, MAT } from './models.js';
import { animateAnimal } from './animals.js';

const _v = new THREE.Vector3();
const _o = { x: 0, y: 0, z: 0, yaw: 0 };

function nameSprite(name, tag = '', mate = false) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillStyle = mate ? 'rgba(20,70,20,.6)' : 'rgba(0,0,0,.45)'; g.fillRect(0, 4, 256, 40);
  g.fillStyle = mate ? '#9cf08a' : '#fff'; g.fillText((tag ? `[${tag}] ` : '') + name, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  return s;
}

export class Entities {
  constructor(scene, effects) {
    this.scene = scene; this.effects = effects;
    this.players = new Map();
    this.animals = new Map();
    this.loot = new Map();
    this.explosives = new Map();
  }

  // ---------------------------------------------------------- players
  syncPlayers(list, vehicles) {
    const seen = new Set();
    for (const a of list) {
      const [pid, x, y, z, yaw, pitch, flags, held, armor, name, vid, seat, lookStr = '', tag = ''] = a;
      seen.add(pid);
      let p = this.players.get(pid);
      if (p && (p.lookStr !== lookStr || p.armor !== armor)) { this.scene.remove(p.model); this.players.delete(pid); p = null; }
      if (!p) {
        const model = makeHumanoid(decodeLook(lookStr), armor.split(','));
        this.scene.add(model);
        const tag = nameSprite(name); tag.position.y = 2.15; model.add(tag);
        p = { pid, model, tag, lookStr, pos: new THREE.Vector3(x, y, z), yaw, pitch, walk: 0, held: null, heldId: '', armor, name };
        this.players.set(pid, p);
      }
      if (!p.interp) p.interp = new Interp();
      p.interp.push(performance.now(), x, y, z, yaw);
      p.pitch = pitch; p.flags = flags; p.vid = vid; p.seat = seat;
      const tagKey = tag + (flags & 32 ? '*' : '');
      if (p.tagKey !== tagKey) { p.tagKey = tagKey; p.model.remove(p.tag); p.tag = nameSprite(name, tag, !!(flags & 32)); p.tag.position.y = 2.15; p.model.add(p.tag); }
      if (p.heldId !== held) {
        p.heldId = held;
        if (p.held) p.model.userData.hand.remove(p.held);
        p.held = held ? makeItemModel(held) : null;
        if (p.held) { p.held.rotation.x = -Math.PI / 2; p.model.userData.hand.add(p.held); }
      }
    }
    for (const [pid, p] of this.players) if (!seen.has(pid)) { this.scene.remove(p.model); this.players.delete(pid); }
  }
  updatePlayers(dt, camPos, vehicleViews) {
    for (const p of this.players.values()) {
      const ud = p.model.userData;
      const sleeping = p.flags & 2, inVeh = p.flags & 4, crouch = p.flags & 1;
      const before = p.pos.clone(), yaw0 = p.yaw;
      if (p.interp.sample(performance.now() - INTERP_DELAY, _o)) { p.pos.set(_o.x, _o.y, _o.z); p.yaw = _o.yaw; }
      const vx = (p.pos.x - before.x) / Math.max(dt, 1e-3), vz = (p.pos.z - before.z) / Math.max(dt, 1e-3), vy = (p.pos.y - before.y) / Math.max(dt, 1e-3);
      const speed = Math.min(12, Math.hypot(vx, vz));
      // smoothed velocity in the player's local frame (forward = -Z)
      p.sv = p.sv || { x: 0, z: 0, s: 0, turn: 0, vy: 0 };
      const ks = Math.min(1, dt * 8);
      p.sv.x += (vx - p.sv.x) * ks; p.sv.z += (vz - p.sv.z) * ks; p.sv.vy += (vy - p.sv.vy) * ks;
      const prevS = p.sv.s; p.sv.s += (speed - p.sv.s) * ks;
      let dyaw = p.yaw - yaw0; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      p.sv.turn += (Math.max(-6, Math.min(6, dyaw / Math.max(dt, 1e-3))) - p.sv.turn) * ks;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const sl = Math.max(0.3, Math.hypot(p.sv.x, p.sv.z));
      const fwd = (p.sv.x * fx + p.sv.z * fz) / sl, side = (p.sv.x * rx + p.sv.z * rz) / sl;
      p.model.position.copy(p.pos);
      p.model.rotation.set(0, p.yaw, 0);
      p.t = (p.t || 0) + dt;
      if (sleeping) poseHumanoid(ud, { mode: 'sleep', t: p.t }, dt);
      else if (inVeh) {
        const v = vehicleViews.get(p.vid);
        if (v && p.seat >= 0) {
          const s = VEHICLES[v.type].seats[p.seat] || [0, 0.5, 0];
          _v.set(s[0], s[1] - 0.45, s[2]).applyQuaternion(v.q).add(v.pos);
          p.model.position.copy(_v); p.model.quaternion.copy(v.q);
        }
        poseHumanoid(ud, { mode: p.seat === 0 ? 'drive' : 'sit', pitch: p.pitch, turn: v ? v.steer * 4 : 0, t: p.t }, dt);
      } else {
        const run = !!(p.flags & 16), air = !!(p.flags & 8);
        if (p.wasAir && !air) p.land = 1;
        p.wasAir = air;
        p.land = Math.max(0, (p.land || 0) - dt * 4);
        // stride: ~1.5 m per walk cycle, ~2.4 m per run cycle
        p.walk += p.sv.s * dt * (Math.PI * 2) / (run ? 2.4 : crouch ? 1.1 : 1.5);
        p.amt = (p.amt || 0) + (Math.min(1, p.sv.s / 3.5) - (p.amt || 0)) * Math.min(1, dt * 8);
        const d = ITEMDEFS[p.heldId];
        poseHumanoid(ud, { mode: 'stand', walk: p.walk, amt: p.amt, fwd, side, run, air, vy: p.sv.vy, land: p.land, accel: (p.sv.s - prevS) / Math.max(dt, 1e-3) * 0.1, turn: p.sv.turn, t: p.t, crouch: !!crouch, held: !!p.held, gun: !!d?.gun, pitch: p.pitch, swing: p.swingT > 0 ? 1 - p.swingT / 0.45 : 0, shot: Math.max(0, p.shotT || 0) / 0.12 }, dt);
        p.shotT = (p.shotT || 0) - dt;
      }
      if (p.swingT > 0) p.swingT -= dt;
      const dist = camPos.distanceTo(p.pos), mate = !!(p.flags & 32);
      p.tag.visible = !sleeping && (dist < 22 || (mate && dist < 400));
      const sc = mate ? Math.max(1, dist / 18) : 1;
      p.tag.scale.set(1.6 * sc, 0.3 * sc, 1);
    }
  }
  playerTargets() {
    const out = [];
    for (const p of this.players.values()) {
      const c = p.model.position, yaw = p.yaw;
      if (p.flags & 2) { out.push({ kind: 'p', id: p.pid, shapes: [{ t: 'box', x: c.x, y: c.y + 0.25, z: c.z, hx: 0.35, hy: 0.25, hz: 0.95, yaw }] }); continue; }
      const crouch = p.flags & 1;
      const hipY = p.flags & 4 ? 0.45 : crouch ? 0.62 : 0.92;
      out.push({ kind: 'p', id: p.pid, shapes: [
        { t: 'box', x: c.x, y: c.y + hipY * 0.5 + 0.15, z: c.z, hx: 0.3, hy: hipY * 0.5 + 0.15, hz: 0.18, yaw },
        { t: 'box', x: c.x, y: c.y + hipY + 0.33, z: c.z, hx: 0.3, hy: 0.33, hz: 0.18, yaw },
        { t: 'sphere', x: c.x, y: c.y + hipY + 0.82, z: c.z, r: 0.2, head: true },
      ] });
    }
    return out;
  }

  // ---------------------------------------------------------- animals
  syncAnimals(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, type, x, y, z, yaw, st, hp] = a;
      seen.add(id);
      let e = this.animals.get(id);
      if (!e) {
        const def = ANIMALS[type];
        const model = makeAnimal(type, def.color, def.size);
        this.scene.add(model);
        e = { id, type, model, pos: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x, y, z), yaw, tyaw: yaw, walk: 0 };
        this.animals.set(id, e);
      }
      if (!e.interp) e.interp = new Interp();
      e.interp.push(performance.now(), x, y, z, yaw);
      e.st = st; e.hp = hp;
    }
    for (const [id, e] of this.animals) if (!seen.has(id)) { this.scene.remove(e.model); this.animals.delete(id); }
  }
  updateAnimals(dt) {
    for (const e of this.animals.values()) {
      const before = e.pos.clone();
      if (e.interp.sample(performance.now() - INTERP_DELAY, _o)) { e.pos.set(_o.x, _o.y, _o.z); e.yaw = _o.yaw; }
      const speed = before.distanceTo(e.pos) / Math.max(dt, 1e-3);
      e.model.position.copy(e.pos); e.model.rotation.y = e.yaw;
      animateAnimal(e.model.userData, e, speed, dt);
    }
  }
  animalTargets() {
    const out = [];
    for (const e of this.animals.values()) {
      const s = ANIMALS[e.type].size;
      out.push({ kind: 'a', id: e.id, shapes: [{ t: 'box', x: e.pos.x, y: e.pos.y + 0.75 * s, z: e.pos.z, hx: 0.35 * s, hy: 0.45 * s, hz: 0.75 * s, yaw: e.yaw }, { t: 'sphere', x: e.pos.x + Math.sin(e.yaw) * 0.9 * s, y: e.pos.y + 1.0 * s, z: e.pos.z + Math.cos(e.yaw) * 0.9 * s, r: 0.3 * s, head: true }] });
    }
    return out;
  }

  // ---------------------------------------------------------- loot
  addLoot(l, physics) {
    this.removeLoot(l.id, physics);
    let obj;
    if (l.kind === 'crate') obj = new THREE.Mesh(deployGeometry('crate' + (l.tier || 1)), MAT);
    else if (l.kind === 'corpse') {
      const def = ANIMALS[l.an] || ANIMALS.deer;
      obj = makeAnimal(l.an || 'deer', new THREE.Color(def.color).multiplyScalar(0.7).getHex(), def.size);
      obj.rotation.z = Math.PI / 2; obj.position.y = 0.3 * def.size;
      const w = new THREE.Group(); w.add(obj); obj = w;
    } else if (l.item && ITEMDEFS[l.item]) {
      // a single dropped item: show the item itself lying on the ground
      const d = ITEMDEFS[l.item];
      const m = makeItemModel(l.item);
      const long = d.tool || d.gun || d.cat === 'weapon' || l.item === 'arrow';
      if (d.gun) m.rotation.set(0, 0, Math.PI / 2);          // lie on its side
      else if (long) m.rotation.set(0, 0, Math.PI / 2);
      m.scale.setScalar(d.deploy ? 1 : 1.5);
      const w = new THREE.Group(); w.add(m);
      const bb = new THREE.Box3().setFromObject(w);
      m.position.y -= bb.min.y - 0.01;
      obj = w;
    } else obj = new THREE.Mesh(deployGeometry('bag'), MAT);
    obj.position.set(l.x, l.y, l.z);
    obj.rotation.y = l.yaw || 0;
    obj.traverse((o) => (o.castShadow = true));
    this.scene.add(obj);
    const col = physics.add('loot:' + l.id, l.kind === 'crate'
      ? { t: 'box', x: l.x, y: l.y + 0.4, z: l.z, hx: 0.7, hy: 0.4, hz: 0.45, yaw: l.yaw || 0, ref: { kind: 'l', id: l.id } }
      : { t: 'cyl', x: l.x, y: l.y, z: l.z, r: l.kind === 'corpse' ? 0.7 : 0.4, h: 0.6, ref: { kind: 'l', id: l.id }, ghost: true });
    this.loot.set(l.id, { data: l, obj, col });
  }
  removeLoot(id, physics) {
    const e = this.loot.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    physics.removeGroup('loot:' + id);
    this.loot.delete(id);
  }

  // ---------------------------------------------------------- explosives
  addExplosive(m) {
    const model = makeItemModel(m.type);
    model.position.set(m.p[0], m.p[1] + 0.05, m.p[2]);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.y = 0.12; model.add(led);
    this.scene.add(model);
    this.explosives.set(m.id, { model, led, t: 0, fuse: m.fuse, beep: 0 });
  }
  removeExplosive(id) { const e = this.explosives.get(id); if (e) { this.scene.remove(e.model); this.explosives.delete(id); } }
  updateExplosives(dt, audio, camPos) {
    for (const [id, e] of this.explosives) {
      e.t += dt; e.beep -= dt;
      const rate = e.t > e.fuse - 2 ? 0.15 : 0.6;
      if (e.beep <= 0) { e.beep = rate; e.led.visible = true; if (camPos.distanceTo(e.model.position) < 30) audio.beep(); setTimeout(() => (e.led.visible = false), 60); }
      if (e.t > e.fuse + 3) this.removeExplosive(id);
      if (e.model.userData.flame) e.model.userData.flame.scale.setScalar(1 + Math.random() * 0.3);
    }
  }
}
