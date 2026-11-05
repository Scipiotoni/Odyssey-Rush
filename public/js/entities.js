// Remote players, animals, lootables and live explosives.
import * as THREE from 'three';
import { ANIMALS } from '/shared/items.js';
import { VEHICLES } from '/shared/vehicles.js';
import { makeHumanoid, setHumanoidArmor, makeAnimal, makeItemModel, deployGeometry, MAT } from './models.js';

const _v = new THREE.Vector3();

function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 4, 256, 40);
  g.fillStyle = '#fff'; g.fillText(name, 128, 34);
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
      const [pid, x, y, z, yaw, pitch, flags, held, armor, name, vid, seat] = a;
      seen.add(pid);
      let p = this.players.get(pid);
      if (!p) {
        const model = makeHumanoid();
        this.scene.add(model);
        const tag = nameSprite(name); tag.position.y = 2.15; model.add(tag);
        p = { pid, model, tag, pos: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x, y, z), yaw, tyaw: yaw, pitch, walk: 0, held: null, heldId: '', armor: '', name };
        this.players.set(pid, p);
      }
      p.target.set(x, y, z); p.tyaw = yaw; p.pitch = pitch; p.flags = flags; p.vid = vid; p.seat = seat;
      if (p.armor !== armor) { p.armor = armor; setHumanoidArmor(p.model, armor.split(',')); }
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
      const before = p.pos.clone();
      const k = 1 - Math.exp(-dt * 14);
      if (p.pos.distanceTo(p.target) > 10) p.pos.copy(p.target); else p.pos.lerp(p.target, k);
      let dy = p.tyaw - p.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      p.yaw += dy * k;
      const speed = before.distanceTo(p.pos) / Math.max(dt, 1e-3);
      p.model.position.copy(p.pos);
      p.model.rotation.set(0, p.yaw, 0);
      ud.hips.rotation.set(0, 0, 0);
      ud.hips.position.y = crouch ? 0.7 : 0.95;
      if (sleeping) {
        ud.hips.rotation.x = -Math.PI / 2; ud.hips.position.y = 0.2;
        ud.legL.rotation.x = ud.legR.rotation.x = 0; ud.armL.rotation.x = ud.armR.rotation.x = 0;
      } else if (inVeh) {
        const v = vehicleViews.get(p.vid);
        if (v && p.seat >= 0) {
          const s = VEHICLES[v.type].seats[p.seat] || [0, 0.5, 0];
          _v.set(s[0], s[1] - 0.45, s[2]).applyQuaternion(v.q).add(v.pos);
          p.model.position.copy(_v); p.model.quaternion.copy(v.q);
        }
        ud.legL.rotation.x = ud.legR.rotation.x = Math.PI / 2; ud.armL.rotation.x = ud.armR.rotation.x = 1.1;
        ud.hips.position.y = 0.45;
      } else {
        p.walk += Math.min(speed, 8) * dt * 1.6;
        const sw = Math.min(1, speed / 3) * 0.7;
        ud.legL.rotation.x = Math.sin(p.walk) * sw; ud.legR.rotation.x = -Math.sin(p.walk) * sw;
        ud.armL.rotation.x = -Math.sin(p.walk) * sw * 0.7;
        ud.armR.rotation.x = p.held ? 1.25 + p.pitch * 0.8 + (p.swingT > 0 ? Math.sin((1 - p.swingT / 0.35) * Math.PI) * 1.2 : 0) : Math.sin(p.walk) * sw * 0.7;
        ud.head.rotation.x = p.pitch * 0.5;
        if (crouch) { ud.legL.rotation.x += 0.8; ud.legR.rotation.x += 0.8; }
      }
      if (p.swingT > 0) p.swingT -= dt;
      p.tag.visible = !sleeping && camPos.distanceTo(p.pos) < 22;
    }
  }
  playerTargets() {
    const out = [];
    for (const p of this.players.values()) {
      const c = p.model.position, yaw = p.yaw;
      if (p.flags & 2) { out.push({ kind: 'p', id: p.pid, shapes: [{ t: 'box', x: c.x, y: c.y + 0.25, z: c.z, hx: 0.35, hy: 0.25, hz: 0.95, yaw }] }); continue; }
      const crouch = p.flags & 1;
      const hipY = p.flags & 4 ? 0.45 : crouch ? 0.7 : 0.95;
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
      e.target.set(x, y, z); e.tyaw = yaw; e.st = st; e.hp = hp;
    }
    for (const [id, e] of this.animals) if (!seen.has(id)) { this.scene.remove(e.model); this.animals.delete(id); }
  }
  updateAnimals(dt) {
    for (const e of this.animals.values()) {
      const before = e.pos.clone();
      const k = 1 - Math.exp(-dt * 8);
      e.pos.lerp(e.target, k);
      let dy = e.tyaw - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      e.yaw += dy * k;
      const speed = before.distanceTo(e.pos) / Math.max(dt, 1e-3);
      e.model.position.copy(e.pos); e.model.rotation.y = e.yaw;
      e.walk += speed * dt * 2.2;
      const sw = Math.min(1, speed / 3) * 0.6;
      e.model.userData.legs.forEach((l, i) => (l.rotation.x = Math.sin(e.walk + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * sw));
      e.model.userData.neck.rotation.x = e.st === 2 ? Math.sin(performance.now() / 80) * 0.3 : 0;
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
