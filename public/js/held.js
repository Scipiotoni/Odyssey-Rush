// Held item behaviour: melee, gathering, guns, explosives, consumables and the first-person viewmodel.
import * as THREE from 'three';
import { ITEMS, NODES, FIST } from '/shared/items.js';
import { makeItemModel, makeFPArm } from './models.js';
import { audio } from './audio.js';
import { countItem } from './ui.js';

const _d = new THREE.Vector3();

export class Held {
  constructor(game) {
    this.game = game;
    this.vm = new THREE.Group();
    game.camera.add(this.vm);
    this.vmItem = null; this.vmId = null;
    this.arm = makeFPArm(game.look);
    this.coolUntil = 0; this.swingT = 0; this.reload = 0; this.useT = 0; this.ads = 0; this.kick = 0;
    this.torchLight = new THREE.PointLight(0xffa050, 0, 18, 1.5);
    this.torchLight.position.set(0.1, 0.6, -1.4);
    game.camera.add(this.torchLight);
  }
  item() { const st = this.game.inv[this.game.sel]; return st ? { st, d: ITEMS[st.id] } : null; }

  refreshModel() {
    const it = this.item();
    const id = it ? it.st.id : null;
    if (id === this.vmId) return;
    this.vmId = id;
    if (this.vmItem) this.vm.remove(this.vmItem);
    this.vm.remove(this.arm);
    this.reload = 0; this.useT = 0; this.game.ui.progress(null);
    if (!id) { this.vmItem = null; this.vm.add(this.arm); this.isGun = false; return; } // bare fists
    this.vmItem = makeItemModel(id);
    this.vmItem.traverse((o) => { o.castShadow = false; if (o.material) { o.material = o.material.clone(); o.material.depthTest = true; } });
    this.vm.add(this.vmItem);
    this.vm.add(this.arm);
    const d = ITEMS[id];
    this.isGun = !!d.gun;
    this.vmItem.rotation.set(d.gun ? 0 : 0.25, d.gun ? 0 : -0.3, 0);
    this.vmItem.scale.setScalar(d.gun ? 1 : 0.6);
    if (!d.gun) this.vmItem.position.set(0.02, -0.05, 0);
  }

  swingAnim() { this.swingT = 0.35; }

  update(dt, input, active) {
    const g = this.game;
    this.refreshModel();
    this.kick *= Math.exp(-14 * dt);
    if (this.swingT > 0) this.swingT -= dt;
    const it = this.item();
    // torch light
    this.torchLight.intensity = it && ITEMS[it.st.id].light ? 7 + Math.random() * 1.5 : 0;
    if (this.vmItem?.userData.flame) this.vmItem.userData.flame.scale.setScalar(0.9 + Math.random() * 0.3);
    // viewmodel pose
    const p = g.player;
    const sw = this.swingT > 0 ? Math.sin((1 - this.swingT / 0.35) * Math.PI) : 0;
    const bob = Math.sin(p.bob) * 0.012, bobY = Math.abs(Math.cos(p.bob)) * 0.012;
    const aiming = active && input.mouse.right && this.isGun;
    this.ads += ((aiming ? 1 : 0) - this.ads) * (1 - Math.exp(-14 * dt));
    const rx = this.reload > 0 ? -0.6 : 0;
    this.vm.position.set(0.3 * (1 - this.ads) + bob, -0.3 + 0.12 * this.ads - bobY - (this.reload > 0 ? 0.08 : 0), -0.62 + this.kick * 0.08);
    this.vm.rotation.set(-sw * 1.3 + this.kick * 0.15 + rx, sw * 0.4, 0);
    g.camera.fov += ((g.settings.fov * (1 - this.ads * 0.25)) - g.camera.fov) * (1 - Math.exp(-14 * dt));
    g.camera.updateProjectionMatrix();
    if (!it && active) {
      g.builder.hide();
      if (input.mouse.left && performance.now() >= this.coolUntil) this.melee(null, { tool: FIST });
      return;
    }
    if (!it || !active) { if (!it) g.builder.hide(); return this.idlePrompt(); }
    const { st, d } = it;
    // reload / use progress
    if (this.reload > 0) {
      this.reload -= dt;
      g.ui.progress(1 - this.reload / d.gun.reload, 'Reloading');
      if (this.reload <= 0) { g.net.send({ t: 'reload', sel: g.sel }); g.ui.progress(null); }
      return;
    }
    if (this.useT > 0) {
      this.useT -= dt;
      g.ui.progress(1 - this.useT / d.useTime, `Using ${d.name}`);
      if (this.useT <= 0) { g.net.send({ t: 'eat', i: g.sel }); g.ui.progress(null); }
      return;
    }
    const L = input.mouse.left, LP = input.mouse.leftPressed;
    if (d.plan) {
      g.builder.updatePlan();
      if (LP) g.builder.placePlan();
      if (input.mouse.rightPressed) g.ui.show('build');
      if (input.hit('KeyR')) g.builder.rot = (g.builder.rot + 1) & 3;
      return;
    }
    if (d.deploy || d.door) { g.builder.updateDeploy(st.id); if (LP) g.builder.placeDeploy(); return; }
    g.builder.hide();
    if (d.tool?.hammer) { g.builder.updateHammer(input); return; }
    if (d.gun) {
      if (input.hit('KeyR')) this.startReload(st, d);
      if ((d.gun.auto ? L : LP) && performance.now() >= this.coolUntil) {
        if ((st.a || 0) > 0) this.fire(st, d);
        else { audio.click(); this.coolUntil = performance.now() + 300; if (countItem(g.inv, d.gun.ammo) > 0) this.startReload(st, d); }
      }
      this.idlePrompt();
      return;
    }
    if (d.dig) {
      const hit = this.ray(4.5);
      const onGround = hit && hit.kind === 'terrain';
      g.ui.prompt(onGround ? '<kbd>LMB</kbd> dig · <kbd>RMB</kbd> pile up dirt (5 stone)' : '<small>Aim at the ground to dig</small>');
      const R = input.mouse.right;
      if ((L || R) && performance.now() >= this.coolUntil) {
        this.coolUntil = performance.now() + 420;
        this.swingT = 0.35;
        if (onGround) setTimeout(() => g.net.send({ t: 'dig', sel: g.sel, pt: [hit.point.x, hit.point.y, hit.point.z], up: R && !L }), 120);
        else if (L) this.melee(st, d);
      }
      return;
    }
    if (d.tool) {
      if (L && performance.now() >= this.coolUntil) this.melee(st, d);
      this.idlePrompt();
      return;
    }
    if (d.explosive) {
      g.ui.prompt(`<kbd>LMB</kbd> place ${d.name} (${d.explosive.fuse}s fuse) — stick it to a wall or door`);
      if (LP) {
        const hit = this.ray(5);
        const pt = hit ? hit.point : { x: g.camera.position.x + this.dir().x * 2, y: g.world.ground(g.player.pos.x, g.player.pos.z), z: g.camera.position.z + this.dir().z * 2 };
        if (hit) { const dd = this.dir(); pt.x -= dd.x * 0.08; pt.y -= dd.y * 0.08; pt.z -= dd.z * 0.08; }
        g.net.send({ t: 'throw', sel: g.sel, pt: [pt.x, pt.y, pt.z] });
        this.swingAnim();
      }
      return;
    }
    if (d.cat === 'food' || d.cat === 'medical') {
      g.ui.prompt(`<kbd>LMB</kbd> ${d.cat === 'food' ? 'eat' : 'use'} ${d.name}`);
      if (LP) { if (d.useTime) this.useT = d.useTime; else { g.net.send({ t: 'eat', i: g.sel }); audio.pickup(); } }
      return;
    }
    if (d.armor && LP) g.net.send({ t: 'move', from: { c: 'p', i: g.sel }, to: { c: 'a', i: d.armor.slot } });
    this.idlePrompt();
  }
  idlePrompt() { this.game.builder.hide(); }

  dir() { return _d.set(0, 0, -1).applyQuaternion(this.game.camera.quaternion).clone(); }
  targets() { return [...this.game.entities.playerTargets(), ...this.game.entities.animalTargets()]; }
  ray(range, dir = this.dir(), filter = (c) => !c.ghost) {
    return this.game.physics.raycast(this.game.camera.position, dir, range, this.targets(), { filter });
  }

  startReload(st, d) {
    if ((st.a || 0) >= d.gun.mag || countItem(this.game.inv, d.gun.ammo) <= 0) return;
    this.reload = d.gun.reload;
    audio.click();
  }

  melee(st, d) {
    const g = this.game, tool = d.tool;
    this.coolUntil = performance.now() + 1000 / tool.rate;
    this.swingT = 0.35;
    audio.swing();
    setTimeout(() => {
      const hit = this.ray(tool.range + 0.4);
      const msg = { t: 'swing', sel: g.sel };
      if (hit && hit.kind && hit.kind !== 'terrain' && hit.kind !== 'prop') {
        msg.k = hit.kind; msg.id = hit.id; msg.hs = hit.hs;
        msg.pt = [hit.point.x, hit.point.y, hit.point.z];
        if (hit.kind === 'n') {
          const node = hit.ref.node, nd = NODES[node.type];
          if (!st && (nd.kind === 'tree' || nd.kind === 'ore') && performance.now() - (this._fistTip || 0) > 6000) { this._fistTip = performance.now(); g.ui.toast('Your bare hands won\'t do much — find a loose rock on the ground and press E to pick it up'); }
          if (nd.kind === 'tree') { audio.chop(); g.effects.burst(hit.point, { count: 8, color: 0x8a6a40, speed: 3, size: 0.07, life: 0.7 }); g.terrain.shakeNode(node.id); }
          else if (nd.kind === 'ore') { audio.mine(); g.effects.burst(hit.point, { count: 10, color: node.type === 'rock_sulfur' ? 0xd8c840 : node.type === 'rock_metal' ? 0xa86030 : 0x8a8680, speed: 4, size: 0.08, life: 0.7 }); g.effects.burst(hit.point, { count: 3, color: 0xffe0a0, speed: 5, size: 0.03, life: 0.25, glow: true }); }
          else if (nd.kind === 'barrel') { audio.hitStruct(); g.effects.burst(hit.point, { count: 6, color: 0x2d5d8a, speed: 3, size: 0.07 }); }
          else { msg.k = null; }
        } else if (hit.kind === 'p' || hit.kind === 'a') { audio.hitFlesh(); g.effects.burst(hit.point, { count: 10, color: 0x8a1010, speed: 2.5, size: 0.06, life: 0.6 }); }
        else if (hit.kind === 's' || hit.kind === 'v') { audio.hitStruct(); g.effects.burst(hit.point, { count: 6, color: 0x999999, speed: 3, size: 0.06 }); }
        else if (hit.kind === 'l') msg.k = null;
      } else if (hit && hit.kind === 'terrain') { g.effects.burst(hit.point, { count: 5, color: g.world.surface(hit.point.x, hit.point.z).dust, speed: 2, size: 0.06 }); }
      if (!msg.k) { delete msg.k; delete msg.id; }
      g.net.send(msg);
    }, 130);
  }

  fire(st, d) {
    const g = this.game, gun = d.gun, p = g.player;
    this.coolUntil = performance.now() + 1000 / gun.rate;
    st.a = (st.a || 1) - 1;
    this.kick = 1;
    const moving = Math.hypot(p.vel.x, p.vel.z) > 1;
    let spread = gun.spread * (this.ads > 0.5 ? 0.45 : 1) * (moving ? 1.8 : 1) * (p.onGround ? 1 : 2.5) * (p.crouch ? 0.7 : 1);
    const pellets = gun.pellets || 1;
    const base = this.dir();
    const o = g.camera.position.clone();
    const muzzle = new THREE.Vector3(0.25 * (1 - this.ads), -0.15, -0.9).applyMatrix4(g.camera.matrixWorld);
    const hits = [], ends = [];
    for (let i = 0; i < pellets; i++) {
      const dir = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread)).normalize();
      if (st.id === 'bow') dir.y += 0.0; // arrows fly straight enough at these ranges
      const hit = g.physics.raycast(o, dir, gun.range, this.targets(), { filter: (c) => !c.ghost, step: 1.5 });
      const end = hit ? hit.point : { x: o.x + dir.x * gun.range, y: o.y + dir.y * gun.range, z: o.z + dir.z * gun.range };
      ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
      if (st.id !== 'bow' || i === 0) g.effects.tracer(muzzle, end);
      if (hit) {
        if (hit.kind === 'p' || hit.kind === 'a') g.effects.burst(hit.point, { count: 8, color: 0x8a1010, speed: 3, size: 0.06, life: 0.5 });
        else if (hit.kind === 'terrain') g.effects.burst(hit.point, { count: 6, color: g.world.surface(hit.point.x, hit.point.z).dust, speed: 2.5, size: 0.07, life: 0.6 });
        else g.effects.burst(hit.point, { count: 5, color: 0xffd080, speed: 4, size: 0.03, life: 0.2, glow: true });
        if (['p', 'a', 's', 'v', 'n'].includes(hit.kind)) hits.push({ k: hit.kind, id: hit.id, hs: !!hit.hs, pt: [hit.point.x, hit.point.y, hit.point.z] });
      }
    }
    if (st.id !== 'bow') { g.effects.flash(muzzle, 4); g.effects.burst(muzzle, { count: 3, color: 0xffd070, speed: 1.5, size: 0.06, life: 0.06, gravity: 0, glow: true }); }
    audio.shot(st.id);
    p.recoil += gun.recoil * (this.ads > 0.5 ? 0.6 : 1);
    p.pitch += gun.recoil * 0.5; p.yaw += (Math.random() - 0.5) * gun.recoil * 0.4;
    g.net.send({ t: 'fire', sel: g.sel, o: [o.x, o.y, o.z], d: [base.x, base.y, base.z], hits, e: ends });
    g.ui.renderHotbar();
    if (st.id === 'bow' && countItem(g.inv, 'arrow') > 0) setTimeout(() => this.startReload(st, d), 250);
  }
}
