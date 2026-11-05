// Held item behaviour (melee, gathering, guns, rockets, grenades, explosives, consumables)
// and an animated first-person viewmodel: equip, wind-up/strike/recover swings, spring recoil,
// reload motion, look sway, walk/sprint bob, landing dip, idle breathing, aiming and scopes.
import * as THREE from 'three';
import { ITEMS, NODES, FIST } from '/shared/items.js';
import { makeItemModel, makeFPArm } from './models.js';
import { audio } from './audio.js';
import { countItem } from './ui.js';

const _d = new THREE.Vector3();
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
// melee swing pose for progress p (0..1): [rotX, rotY, rotZ, posX, posY, posZ]
function swingPose(p, heavy) {
  const W = heavy ? 0.36 : 0.28, S = W + 0.2;
  const wind = [0.75, -0.25, 0.35, 0.04, 0.07, 0.06], strike = [-1.25, 0.55, -0.25, -0.12, -0.08, -0.18];
  let a, b, t;
  if (p < W) { a = [0, 0, 0, 0, 0, 0]; b = wind; t = ease(p / W); }
  else if (p < S) { a = wind; b = strike; t = Math.pow((p - W) / (S - W), 0.6); }
  else { a = strike; b = [0, 0, 0, 0, 0, 0]; t = ease((p - S) / (1 - S)); }
  return a.map((v, i) => lerp(v, b[i], t));
}

export class Held {
  constructor(game) {
    this.game = game;
    this.vm = new THREE.Group();     // animated root
    game.camera.add(this.vm);
    this.vmItem = null; this.vmId = undefined;
    this.arm = makeFPArm(game.look);
    this.coolUntil = 0; this.reload = 0; this.reloadDur = 1; this.useT = 0; this.ads = 0;
    this.swing = null;               // {t, dur, heavy}
    this.equip = 0;
    this.kick = { p: 0, v: 0, r: 0, rv: 0 };
    this.sway = { x: 0, y: 0 }; this.sprint = 0; this.dip = { p: 0, v: 0 }; this.time = 0;
    this.projectiles = [];
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
    this.reload = 0; this.useT = 0; this.swing = null; this.game.ui.progress(null);
    this.equip = 0; // play the raise animation
    if (id) audio.click();
    if (!id) { this.vmItem = null; this.vm.add(this.arm); this.isGun = false; this.gun = null; return; } // bare fists
    this.vmItem = makeItemModel(id);
    this.vmItem.traverse((o) => { o.castShadow = false; });
    this.vm.add(this.vmItem);
    this.vm.add(this.arm);
    const d = ITEMS[id];
    this.isGun = !!d.gun; this.gun = d.gun || null;
    if (d.gun) { this.vmItem.rotation.set(0, 0, 0); this.vmItem.scale.setScalar(1); this.vmItem.position.set(0, 0, 0); }
    else if (d.tool || d.cat === 'weapon' || d.cat === 'tool') { this.vmItem.rotation.set(0.35, -0.3, 0.1); this.vmItem.scale.setScalar(0.62); this.vmItem.position.set(0.02, -0.06, 0); }
    else { this.vmItem.rotation.set(0.4, 0.6, 0); this.vmItem.scale.setScalar(1.1); this.vmItem.position.set(0.0, 0.0, -0.08); }
  }

  swingAnim(dur = 0.4, heavy = false) { this.swing = { t: 0, dur, heavy }; }

  // ------------------------------------------------------------ viewmodel animation
  animate(dt, input, active) {
    const g = this.game, p = g.player;
    this.time += dt;
    this.equip = Math.min(1, this.equip + dt / 0.32);
    // spring recoil
    const k = this.kick, K = 260, D = 2 * Math.sqrt(K) * 0.85;
    k.v += (-K * k.p - D * k.v) * dt; k.p += k.v * dt;
    k.rv += (-K * k.r - D * k.rv) * dt; k.r += k.rv * dt;
    // landing dip
    const dp = this.dip; dp.v += (-180 * dp.p - 22 * dp.v) * dt; dp.p += dp.v * dt;
    // look sway (lags behind mouse movement)
    const mx = active ? input.mouse.dx : 0, my = active ? input.mouse.dy : 0;
    this.sway.x += (Math.max(-0.08, Math.min(0.08, -mx * 0.0016)) - this.sway.x) * Math.min(1, dt * 9);
    this.sway.y += (Math.max(-0.08, Math.min(0.08, -my * 0.0016)) - this.sway.y) * Math.min(1, dt * 9);
    // sprint & aim blends
    this.sprint += ((p.sprinting && !this.swing && this.reload <= 0 ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    const aiming = active && input.mouse.right && this.isGun && this.reload <= 0 && !p.sprinting;
    this.ads += ((aiming ? 1 : 0) - this.ads) * Math.min(1, dt * 13);
    // walk bob (figure-eight), stronger when sprinting
    const spd = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4.6) * (p.onGround ? 1 : 0.2);
    const bobA = (0.012 + this.sprint * 0.012) * spd * (1 - this.ads * 0.85);
    const bx = Math.sin(p.bob) * bobA, by = -Math.abs(Math.cos(p.bob)) * bobA;
    const breathe = Math.sin(this.time * 1.6) * 0.003 * (1 - this.ads);
    // swing
    let sw = [0, 0, 0, 0, 0, 0];
    if (this.swing) {
      this.swing.t += dt;
      const pr = this.swing.t / this.swing.dur;
      if (pr >= 1) this.swing = null; else sw = swingPose(pr, this.swing.heavy);
    }
    // reload: lower & tilt, with a "mag out / mag in" dip
    let rl = [0, 0, 0, 0, 0, 0];
    if (this.reload > 0) {
      const pr = 1 - this.reload / this.reloadDur, env = Math.sin(Math.min(1, pr) * Math.PI);
      const jolt = Math.exp(-Math.pow((pr - 0.55) / 0.06, 2)) * 0.05;
      rl = [-0.35 * env, 0.15 * env, 0.65 * env, -0.03 * env, -0.09 * env - jolt, 0.04 * env];
    }
    const eq = 1 - ease(this.equip);
    const ax = 0.27 * (1 - this.ads), ay = -0.27 + 0.105 * this.ads, az = -0.55 + 0.1 * this.ads;
    this.vm.position.set(
      ax + bx + this.sway.x * 0.3 + sw[3] + rl[3] + this.sprint * 0.06,
      ay + by + breathe - eq * 0.35 + sw[4] + rl[4] - this.sprint * 0.05 - dp.p * 0.6 + this.sway.y * 0.2,
      az + k.p * 0.9 + sw[5] + rl[5] + this.sprint * 0.04,
    );
    this.vm.rotation.set(
      k.r + sw[0] + rl[0] - eq * 0.8 + this.sway.y - this.sprint * 0.3 + dp.p * 0.8,
      sw[1] + rl[1] + this.sway.x + this.sprint * 0.55,
      sw[2] + rl[2] + this.sway.x * 0.5 + this.sprint * 0.25 + bx * 2,
    );
    // field of view / scope
    const zoom = this.gun?.zoom ?? 0.78;
    const targetFov = g.settings.fov * (1 - this.ads * (1 - zoom));
    g.camera.fov += (targetFov - g.camera.fov) * Math.min(1, dt * 14);
    g.camera.updateProjectionMatrix();
    const scoped = !!(this.gun?.scope && this.ads > 0.85);
    document.getElementById('scope')?.classList.toggle('hidden', !scoped);
    document.getElementById('crosshair')?.classList.toggle('hidden', scoped || this.ads > 0.7);
    this.vm.visible = !scoped && this.vm.visible;
  }
  landed(speed) { if (speed > 3) this.dip.v += Math.min(4, speed * 0.25); }

  // ------------------------------------------------------------ projectiles (rockets / grenades)
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const f = Math.min(1, pr.t / pr.dur);
      if (pr.kind === 'rocket') {
        pr.mesh.position.lerpVectors(pr.a, pr.b, f);
        if (Math.random() < 0.9) this.game.effects.smoke(pr.mesh.position, 0x9a9a9a, 0.35);
        this.game.effects.burst(pr.mesh.position, { count: 1, color: 0xffa030, speed: 0.5, size: 0.15, life: 0.12, gravity: 0, glow: true });
      } else {
        pr.mesh.position.set(pr.a.x + pr.v.x * pr.t, pr.a.y + pr.v.y * pr.t - 4.9 * pr.t * pr.t, pr.a.z + pr.v.z * pr.t);
        pr.mesh.rotation.x += dt * 10;
      }
      if (f >= 1) { this.game.scene.remove(pr.mesh); this.projectiles.splice(i, 1); pr.done?.(); }
    }
  }

  update(dt, input, active) {
    const g = this.game;
    this.refreshModel();
    this.vm.visible = true;
    this.animate(dt, input, active);
    this.updateProjectiles(dt);
    const it = this.item();
    this.torchLight.intensity = it && ITEMS[it.st.id].light ? 7 + Math.random() * 1.5 : 0;
    if (this.vmItem?.userData.flame) this.vmItem.userData.flame.scale.setScalar(0.9 + Math.random() * 0.3);
    if (this.equip < 0.6) return; // still raising the item
    if (!it && active) {
      g.builder.hide();
      if (input.mouse.left && performance.now() >= this.coolUntil) this.melee(null, { tool: FIST });
      return;
    }
    if (!it || !active) { if (!it) g.builder.hide(); return this.idlePrompt(); }
    const { st, d } = it;
    if (this.reload > 0) {
      this.reload -= dt;
      g.ui.progress(1 - this.reload / this.reloadDur, 'Reloading');
      if (this.reload <= 0) { g.net.send({ t: 'reload', sel: g.sel }); g.ui.progress(null); audio.click(); }
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
      const b = g.builder;
      if (b.furn && countItem(g.inv, b.furn) <= 0) b.furn = null; // ran out of that furniture
      if (b.furn) { b.updateDeploy(b.furn); if (LP) { b.placeDeploy(); this.swingAnim(0.3); } }
      else { b.updatePlan(); if (LP) { b.placePlan(); this.swingAnim(0.3); } }
      if (input.mouse.rightPressed) g.ui.show('build');
      if (input.hit('KeyR')) g.builder.rot = (g.builder.rot + 1) & 3;
      return;
    }
    if (d.deploy || d.door) { g.builder.updateDeploy(st.id); if (LP) g.builder.placeDeploy(); return; }
    g.builder.hide();
    if (d.spray) { g.painter.update(input); return; }
    if (d.tool?.hammer) { g.builder.updateHammer(input); return; }
    if (d.gun) {
      if (input.hit('KeyR')) this.startReload(st, d);
      if ((d.gun.auto ? L : LP) && performance.now() >= this.coolUntil && !g.player.sprinting) {
        if ((st.a || 0) > 0) this.fire(st, d);
        else { audio.click(); this.coolUntil = performance.now() + 300; if (countItem(g.inv, d.gun.ammo) > 0) this.startReload(st, d); }
      }
      if (d.gun.scope) g.ui.prompt(this.ads > 0.85 ? '' : '<small><kbd>RMB</kbd> scope</small>');
      else this.idlePrompt();
      return;
    }
    if (d.dig) {
      const hit = this.ray(4.5);
      const onGround = hit && hit.kind === 'terrain';
      g.ui.prompt(onGround ? '<kbd>LMB</kbd> dig · <kbd>RMB</kbd> pile up dirt (5 stone)' : '<small>Aim at the ground to dig</small>');
      const R = input.mouse.right;
      if ((L || R) && performance.now() >= this.coolUntil) {
        this.coolUntil = performance.now() + 450;
        this.swingAnim(0.45, true);
        if (onGround) setTimeout(() => g.net.send({ t: 'dig', sel: g.sel, pt: [hit.point.x, hit.point.y, hit.point.z], up: R && !L }), 200);
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
      if (d.explosive.thrown) { g.ui.prompt(`<kbd>LMB</kbd> throw ${d.name} (${d.explosive.fuse}s fuse)`); if (LP && performance.now() >= this.coolUntil) this.throwGrenade(st, d); return; }
      g.ui.prompt(`<kbd>LMB</kbd> place ${d.name} (${d.explosive.fuse}s fuse) — stick it to a wall or door`);
      if (LP) {
        const hit = this.ray(5);
        const pt = hit ? hit.point : { x: g.camera.position.x + this.dir().x * 2, y: g.world.ground(g.player.pos.x, g.player.pos.z), z: g.camera.position.z + this.dir().z * 2 };
        if (hit) { const dd = this.dir(); pt.x -= dd.x * 0.08; pt.y -= dd.y * 0.08; pt.z -= dd.z * 0.08; }
        g.net.send({ t: 'throw', sel: g.sel, pt: [pt.x, pt.y, pt.z] });
        this.swingAnim(0.45);
      }
      return;
    }
    if (d.cat === 'food' || d.cat === 'medical') {
      g.ui.prompt(`<kbd>LMB</kbd> ${d.cat === 'food' ? 'eat' : 'use'} ${d.name}`);
      if (LP) { this.swingAnim(0.5); if (d.useTime) this.useT = d.useTime; else { g.net.send({ t: 'eat', i: g.sel }); audio.pickup(); } }
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
    this.reload = this.reloadDur = d.gun.reload;
    audio.click();
  }

  melee(st, d) {
    const g = this.game, tool = d.tool;
    const dur = Math.max(0.3, Math.min(0.6, 0.8 / tool.rate));
    const heavy = tool.dmg >= 40 || tool.tree >= 25 || tool.ore >= 25;
    this.coolUntil = performance.now() + 1000 / tool.rate;
    this.swingAnim(dur, heavy);
    setTimeout(() => audio.swing(), dur * 280);
    setTimeout(() => {
      const hit = this.ray(tool.range + 0.4);
      const msg = { t: 'swing', sel: g.sel };
      if (hit && hit.kind && hit.kind !== 'terrain' && hit.kind !== 'prop') {
        msg.k = hit.kind; msg.id = hit.id; msg.hs = hit.hs;
        msg.pt = [hit.point.x, hit.point.y, hit.point.z];
        this.kick.rv -= 3; // impact jolt
        if (hit.kind === 'n') {
          const node = hit.ref.node, nd = NODES[node.type];
          if (!st && (nd.kind === 'tree' || nd.kind === 'ore') && performance.now() - (this._fistTip || 0) > 6000) { this._fistTip = performance.now(); g.ui.toast('Your bare hands won\'t do much — find a loose rock on the ground and press E to pick it up'); }
          if (nd.kind === 'tree') { audio.chop(); g.effects.burst(hit.point, { count: 10, color: 0x8a6a40, speed: 3, size: 0.07, life: 0.7 }); g.effects.burst(hit.point, { count: 4, color: 0x4a8a33, speed: 2, size: 0.06, life: 1.2, gravity: 2 }); g.terrain.shakeNode(node.id); }
          else if (nd.kind === 'ore') { audio.mine(); g.effects.burst(hit.point, { count: 10, color: node.type === 'rock_sulfur' ? 0xd8c840 : node.type === 'rock_metal' ? 0xa86030 : 0x8a8680, speed: 4, size: 0.08, life: 0.7 }); g.effects.burst(hit.point, { count: 4, color: 0xffe0a0, speed: 5, size: 0.03, life: 0.25, glow: true }); }
          else if (nd.kind === 'barrel') { audio.hitStruct(); g.effects.burst(hit.point, { count: 6, color: 0x2d5d8a, speed: 3, size: 0.07 }); }
          else { msg.k = null; }
        } else if (hit.kind === 'p' || hit.kind === 'a') { audio.hitFlesh(); g.effects.burst(hit.point, { count: 10, color: 0x8a1010, speed: 2.5, size: 0.06, life: 0.6 }); }
        else if (hit.kind === 's' || hit.kind === 'v') { audio.hitStruct(); g.effects.burst(hit.point, { count: 6, color: 0x999999, speed: 3, size: 0.06 }); }
        else if (hit.kind === 'l') msg.k = null;
      } else if (hit && hit.kind === 'terrain') { g.effects.burst(hit.point, { count: 5, color: g.world.surface(hit.point.x, hit.point.z).dust, speed: 2, size: 0.06 }); }
      if (!msg.k) { delete msg.k; delete msg.id; }
      g.net.send(msg);
    }, dur * 420);
  }

  fire(st, d) {
    const g = this.game, gun = d.gun, p = g.player;
    this.coolUntil = performance.now() + 1000 / gun.rate;
    st.a = (st.a || 1) - 1;
    const rk = gun.recoil * (this.ads > 0.5 ? 0.6 : 1);
    this.kick.v += 1.2 + rk * 25; this.kick.rv += 2 + rk * 60;
    const moving = Math.hypot(p.vel.x, p.vel.z) > 1;
    const spread = gun.spread * (this.ads > 0.5 ? 0.4 : 1) * (moving ? 1.8 : 1) * (p.onGround ? 1 : 2.5) * (p.crouch ? 0.7 : 1);
    const pellets = gun.pellets || 1;
    const base = this.dir();
    const o = g.camera.position.clone();
    const muzzle = new THREE.Vector3(0.27 * (1 - this.ads), -0.15, -1.0).applyMatrix4(g.camera.matrixWorld);
    const hits = [], ends = [];
    for (let i = 0; i < pellets; i++) {
      const dir = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread)).normalize();
      const hit = g.physics.raycast(o, dir, gun.range, gun.blast ? null : this.targets(), { filter: (c) => !c.ghost, step: 1.5 });
      const end = hit ? hit.point : { x: o.x + dir.x * gun.range, y: o.y + dir.y * gun.range, z: o.z + dir.z * gun.range };
      ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
      if (gun.blast) { this.launchRocket(muzzle, end); continue; }
      if (gun.ammo !== 'arrow' || i === 0) g.effects.tracer(muzzle, end);
      if (hit) {
        if (hit.kind === 'p' || hit.kind === 'a') g.effects.burst(hit.point, { count: 8, color: 0x8a1010, speed: 3, size: 0.06, life: 0.5 });
        else if (hit.kind === 'terrain') g.effects.burst(hit.point, { count: 6, color: g.world.surface(hit.point.x, hit.point.z).dust, speed: 2.5, size: 0.07, life: 0.6 });
        else g.effects.burst(hit.point, { count: 5, color: 0xffd080, speed: 4, size: 0.03, life: 0.2, glow: true });
        if (['p', 'a', 's', 'v', 'n'].includes(hit.kind)) hits.push({ k: hit.kind, id: hit.id, hs: !!hit.hs, pt: [hit.point.x, hit.point.y, hit.point.z] });
      }
    }
    if (gun.ammo !== 'arrow') { g.effects.flash(muzzle, gun.blast ? 8 : 4); g.effects.burst(muzzle, { count: gun.blast ? 12 : 3, color: 0xffd070, speed: 1.5, size: 0.06, life: 0.06, gravity: 0, glow: true }); }
    if (gun.blast) for (let i = 0; i < 8; i++) g.effects.smoke(muzzle.clone().addScaledVector(base, -1.2), 0xaaaaaa, 0.5);
    audio.shot(gun.ammo === 'arrow' ? 'bow' : gun.pellets || gun.blast || gun.dmg > 60 ? 'shotgun' : st.id);
    p.recoil += rk;
    p.pitch += rk * 0.5; p.yaw += (Math.random() - 0.5) * rk * 0.4;
    g.net.send({ t: 'fire', sel: g.sel, o: [o.x, o.y, o.z], d: [base.x, base.y, base.z], hits, e: ends });
    g.ui.renderHotbar();
    if (gun.mag === 1 && countItem(g.inv, gun.ammo) > 0) setTimeout(() => this.startReload(st, d), 250);
  }

  launchRocket(from, to) {
    const mesh = makeItemModel('rocket');
    mesh.scale.setScalar(1.2);
    const a = from.clone(), b = new THREE.Vector3(to.x, to.y, to.z);
    mesh.position.copy(a);
    mesh.lookAt(b); mesh.rotateX(Math.PI / 2);
    this.game.scene.add(mesh);
    this.projectiles.push({ kind: 'rocket', mesh, a, b, t: 0, dur: Math.max(0.05, a.distanceTo(b) / 60) });
  }

  throwGrenade(st, d) {
    const g = this.game;
    this.coolUntil = performance.now() + 900;
    this.swingAnim(0.5);
    const o = g.camera.position.clone().add(new THREE.Vector3(0.2, -0.1, -0.3).applyQuaternion(g.camera.quaternion));
    const v = this.dir().multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0));
    // simulate the arc until it hits something
    let pos = o.clone(), t = 0, land = null;
    const step = 0.03;
    for (; t < 3; t += step) {
      const nx = o.x + v.x * (t + step), ny = o.y + v.y * (t + step) - 4.9 * (t + step) ** 2, nz = o.z + v.z * (t + step);
      const seg = new THREE.Vector3(nx - pos.x, ny - pos.y, nz - pos.z), len = seg.length();
      const hit = g.physics.raycast(pos, seg.normalize(), len, null, { filter: (c) => !c.ghost, step: 0.3 });
      if (hit) { land = hit.point; t += step * (hit.t / len); break; }
      pos.set(nx, ny, nz);
    }
    if (!land) land = pos;
    const mesh = makeItemModel('grenade'); mesh.scale.setScalar(1.3);
    g.scene.add(mesh);
    const sel = g.sel;
    this.projectiles.push({ kind: 'grenade', mesh, a: o, v, t: 0, dur: t, done: () => g.net.send({ t: 'throw', sel, id: st.id, pt: [land.x, land.y + 0.05, land.z] }) });
    audio.swing();
  }
}
