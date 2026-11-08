import { CAVE_ZONE } from '/shared/caves.js';
// Local first-person player controller.
import * as THREE from 'three';
import { audio } from './audio.js';
import { BREATH_MAX, breathDrain } from '/shared/ice.js';
import { ITEMS } from '/shared/items.js';
import { ICE_SURF } from './physics.js';

const WALK = 4.6, SPRINT = 7.4, CROUCH = 2.2, SWIM = 3.0, SWIM_FAST = 4.8, JUMP = 6.8, GRAV = 20;
const FLOAT_Y = -1.32; // feet height when treading water at the surface (head and shoulders out)

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.crouch = false; this.swimming = false; this.sprinting = false;
    this.eye = 1.62; this.bob = 0; this.stepT = 0; this.fallStart = null;
    this.radius = 0.35;
    this.recoil = 0;
    this.underwater = false; this.breath = BREATH_MAX; this.strokeT = 0; this.bubbleT = 0; this.climbT = 0; this.wasWet = false;
  }
  get height() { return this.crouch && !this.swimming ? 1.2 : 1.8; }

  look(dx, dy, sens) {
    this.yaw -= dx * 0.0022 * sens;
    this.pitch -= dy * 0.0022 * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  update(dt, input, active) {
    const g = this.game, ph = g.physics, w = g.world;
    const k = (c) => active && input.down(c);
    const crouchKey = k('ControlLeft') || k('KeyC');
    this.crouch = crouchKey;
    // what you wear: heavy armour slows you a little (never more than 8%), a wetsuit makes you swim faster
    let wt = 0, swimMul = 1;
    for (const s of ['head', 'chest', 'legs', 'back']) { const a = g.armor?.[s] && ITEMS[g.armor[s].id]?.armor; if (a) { wt += a.weight || 0; swimMul = Math.max(swimMul, a.swim || 1); } }
    const armorMul = 1 - Math.min(0.08, wt);
    let fx = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let sx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const len = Math.hypot(fx, sx) || 1; fx /= len; sx /= len;
    const fwd = [-Math.sin(this.yaw), -Math.cos(this.yaw)], right = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const inCave = g.caves ? g.caves.inVolume(this.pos.x, this.pos.y, this.pos.z) : this.pos.y < CAVE_ZONE;
    const groundY = inCave ? -1e6 : w.ground(this.pos.x, this.pos.z);
    // the water line here: the sea (0), whatever has leaked into a sealed room / the Pacific, or none (dry)
    const W = g.waterAt ? g.waterAt(this.pos) : { top: inCave ? -Infinity : 0 };
    const wTop = W.top;
    const waterDepth = wTop - this.pos.y;
    const onIce = this.onGround && ph.lastSurf === ICE_SURF;
    this.inside = !!W.inside;
    // caves under the sea are flooded: no surface down there, you swim everywhere
    this.flooded = wTop === Infinity;
    this.swimming = !onIce && (this.flooded || (waterDepth > 1.1 && (W.inside || groundY < wTop - 1.0)));
    const headY = this.pos.y + this.eye;
    this.underwater = this.swimming && (this.flooded || headY < wTop - 0.06);
    // in the air of a sealed room or a sub (walking, maybe wading)
    this.dry = this.inside && headY > wTop;
    this.sprinting = k('ShiftLeft') && fx > 0 && !this.crouch && !this.swimming;
    let speed = (this.swimming ? (k('ShiftLeft') ? SWIM_FAST : SWIM) * swimMul : this.crouch ? CROUCH : this.sprinting ? SPRINT : WALK) * (this.swimming ? 1 : armorMul);
    // slide: crouch while sprinting to drop into a fast slide (keeps fights moving); jump out of it to keep the speed
    this.slideCD = Math.max(0, (this.slideCD || 0) - dt);
    if (crouchKey && !this.wasCrouchKey && this.wasSprinting && this.onGround && !this.swimming && this.slideCD <= 0 && Math.hypot(this.vel.x, this.vel.z) > WALK) {
      this.slideT = 0.7; this.slideCD = 1.1; const hv = Math.hypot(this.vel.x, this.vel.z); this.slideDir = [this.vel.x / hv, this.vel.z / hv]; audio.slide?.();
    }
    this.wasCrouchKey = crouchKey; this.wasSprinting = this.sprinting;
    if (this.slideT > 0) {
      this.slideT -= dt;
      if (!this.onGround || this.swimming || !crouchKey) this.slideT = Math.min(this.slideT, 0);
      else { const sp = CROUCH + (SPRINT * 1.4 - CROUCH) * Math.max(0, this.slideT / 0.7) ** 0.7; this.slideSpeed = sp; }
    }
    this.sliding = this.slideT > 0;
    if (waterDepth > 0.4 && !this.swimming) speed *= 0.7; // wading
    if (g.encumbered) speed *= 0.85;
    // creative flight (server owner / admins): Z toggles it
    if (g.rules?.creative && (g.serverInfo?.owner || g.isAdmin) && input.hit?.('KeyZ') && active) { this.flying = !this.flying; g.ui?.toast(this.flying ? '🕊️ Flying — Space up, Ctrl down, Shift fast' : 'Flight off'); }
    if (!g.rules?.creative) this.flying = false;
    if (this.flying) {
      const sp = k('ShiftLeft') ? 30 : 12, cp = Math.cos(this.pitch), spp = Math.sin(this.pitch);
      const tx = (fwd[0] * fx * cp + right[0] * sx) * sp, tz = (fwd[1] * fx * cp + right[1] * sx) * sp;
      const ty = (spp * fx + (k('Space') ? 1 : 0) - (this.crouch ? 1 : 0)) * sp;
      const a = 1 - Math.exp(-6 * dt);
      this.vel.x += (tx - this.vel.x) * a; this.vel.y += (ty - this.vel.y) * a; this.vel.z += (tz - this.vel.z) * a;
      this.fallStart = null;
    } else if (this.swimming) {
      // swim where you look: pitch steers you down into the deep or back up to the light
      const submerged = this.flooded || headY < wTop - 0.35;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const steer = submerged || this.pitch < -0.35;
      const hx = fwd[0] * fx * (steer ? cp : 1) + right[0] * sx, hz = fwd[1] * fx * (steer ? cp : 1) + right[1] * sx;
      let vy = steer ? sp * fx * speed : 0;
      if (!submerged && vy > 0) vy = 0; // can't fly out of the water
      if (k('Space')) vy = Math.max(vy, 2.6);
      if (this.crouch) vy = Math.min(vy, -2.6);
      if (!k('Space') && !this.crouch && Math.abs(vy) < 0.2) {
        // buoyancy: drift slowly up, then bob gently at the surface
        vy = this.flooded ? 0.2 : submerged ? 0.9 : (wTop + FLOAT_Y + Math.sin(performance.now() / 700) * 0.05 - this.pos.y) * 2.2;
      }
      const a = 1 - Math.exp(-3.2 * dt);
      this.vel.x += (hx * speed - this.vel.x) * a;
      this.vel.z += (hz * speed - this.vel.z) * a;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-3 * dt));
      // climb out onto a ledge, a jetty, a shore or the edge of the ice
      this.climbT -= dt;
      if (fx > 0 && headY > wTop - 0.5 && !this.flooded && this.climbT <= 0) {
        const ax = this.pos.x + fwd[0] * 0.75, az = this.pos.z + fwd[1] * 0.75;
        const top = ph.groundAt(ax, az, this.pos.y, 1.95, 0.15);
        if (top > this.pos.y + 0.45 && top > wTop - 0.35 && (k('Space') || top - this.pos.y < 1.75)) {
          const clear = ph.groundAt(ax, az, top + 1.7, 0.05, 0.15) <= top + 0.06;
          if (clear) { this.pos.set(ax, top + 0.02, az); this.vel.set(fwd[0] * 1.5, 0, fwd[1] * 1.5); this.climbT = 0.6; audio.splash?.(0.35); }
        }
      }
    } else {
      let tx = (fwd[0] * fx + right[0] * sx) * speed, tz = (fwd[1] * fx + right[1] * sx) * speed;
      if (this.sliding) { tx = this.slideDir[0] * this.slideSpeed + (right[0] * sx) * 1.2; tz = this.slideDir[1] * this.slideSpeed + (right[1] * sx) * 1.2; }
      // ice is slippery: you keep sliding and take a while to get going
      const accel = this.sliding ? 30 : this.onGround ? (onIce ? 1.6 : 12) : 2.5;
      const a = 1 - Math.exp(-accel * dt);
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
      // ladders: hold W or Space to climb, let go to slide down slowly
      const lad = g.structures?.ladderNear?.(this.pos);
      if (lad && (fx > 0 || k('Space'))) { this.vel.y = 3.2; this.vel.x *= 0.6; this.vel.z *= 0.6; this.fallStart = null; }
      else if (lad && !this.onGround) { this.vel.y = Math.max(this.vel.y - GRAV * dt, -2); this.fallStart = null; }
      else this.vel.y -= GRAV * dt;
      if (k('Space') && this.onGround && !lad) { this.vel.y = JUMP; this.onGround = false; if (this.sliding) { this.slideT = 0; this.vel.x *= 1.05; this.vel.z *= 1.05; } } // slide-jump keeps your momentum
    }
    const wasGround = this.onGround;
    const preVy = this.vel.y;
    const res = ph.moveBody(this.pos, this.vel, this.radius, this.height, dt);
    this.onGround = res.ground;
    this.underIce = !!res.underIce || (this.underIce && this.underwater && res.ceiling);
    if (!wasGround && this.onGround && preVy < -2) g.held?.landed(-preVy);
    // ground snapping when walking down slopes
    if (wasGround && !this.onGround && this.vel.y <= 0 && !this.swimming && !inCave) {
      const gy = ph.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.3, this.radius * 0.5);
      if (this.pos.y - gy < 0.7) { this.pos.y = gy; this.vel.y = 0; this.onGround = true; }
    }
    // fall damage
    if (!this.onGround && !this.swimming) { if (this.fallStart === null || this.pos.y > this.fallStart) this.fallStart = this.pos.y; }
    if ((this.onGround || this.swimming) && this.fallStart !== null) {
      const drop = this.fallStart - this.pos.y;
      if (drop > 4.5 && !this.swimming && preVy < -10) g.net.send({ t: 'fall', d: (drop - 4.5) * 9 });
      this.fallStart = null;
    }
    // world bounds
    const lim = 8600;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x)); this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    if (!inCave && this.pos.y < groundY - 2) this.pos.y = groundY + 0.1; // never fall through the world
    if (inCave && this.pos.y < -260) this.pos.y = -200;
    // eye height & bob
    const targetEye = this.crouch && !this.swimming ? 1.05 : 1.62;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bob += hs * dt * 1.9;
      this.stepT -= hs * dt;
      if (this.stepT <= 0) { this.stepT = this.sprinting ? 2.4 : 1.9; audio.step(inCave ? 'rock' : waterDepth > 0.1 ? 'water' : ph.lastSurf === ICE_SURF ? 'ice' : ph.lastSurf ? 'concrete' : w.surface(this.pos.x, this.pos.z).name); }
    } else if (!this.swimming) this.bob *= 0.9;
    // water sounds and breath
    const wet = wTop !== Infinity && this.pos.y < wTop - 0.25 && (this.inside || groundY < -0.3);
    if (wet && !this.wasWet && preVy < -3) { audio.splash?.(Math.min(1, -preVy / 14)); g.effects?.burst({ x: this.pos.x, y: 0.1, z: this.pos.z }, { count: 16, color: 0xcfe6f2, speed: 3.5, size: 0.08, life: 0.7 }); }
    this.wasWet = wet;
    if (this.swimming) {
      const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
      this.strokeT -= dt * (0.4 + sp * 0.45);
      if (this.strokeT <= 0 && sp > 0.6) { this.strokeT = 1.4; audio.swimStroke?.(this.underwater); }
      this.bob += dt * 2.2;
    }
    const tank = g.armor?.back, tmax = tank && ITEMS[tank.id]?.armor?.air;
    if (tmax) { if (this.tankId !== tank.id) { this.tankId = tank.id; this.tank = tank.air ?? tmax; } this.tankMax = tmax; } else { this.tankMax = 0; this.tankId = null; }
    if (this.underwater) {
      const drain = breathDrain(-(this.pos.y + this.eye));
      if (this.tankMax && this.tank > 0) this.tank = Math.max(0, this.tank - dt * drain);
      else this.breath = Math.max(0, this.breath - dt * drain);
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) { this.bubbleT = this.tankMax && this.tank > 0 ? 1.2 + Math.random() * 0.8 : this.breath > 5 ? 2.5 + Math.random() * 3 : 0.6; audio.bubbles?.(); g.effects?.burst({ x: this.pos.x - Math.sin(this.yaw) * 0.3, y: this.pos.y + this.eye - 0.1, z: this.pos.z - Math.cos(this.yaw) * 0.3 }, { count: 6, color: 0xd8f4ff, speed: 0.35, size: 0.035, life: 1.6, gravity: -2.5 }); }
    } else { this.breath = Math.min(BREATH_MAX, this.breath + dt * 5); if (this.tankMax) this.tank = Math.min(this.tankMax, this.tank + dt * 6); }
    this.recoil *= Math.exp(-10 * dt);
  }

  applyCamera(cam) {
    const swim = this.swimming;
    const bobY = Math.sin(this.bob * 2) * (swim ? 0.05 : 0.04), bobX = Math.cos(this.bob) * 0.03;
    // step smoothing: small sudden height changes on the ground (ledges, dug bowls) ease in instead of snapping the view
    const tNow = performance.now() / 1000, dt = Math.min(0.1, tNow - (this._camT ?? tNow)); this._camT = tNow;
    const dyStep = this.pos.y - (this._lastY ?? this.pos.y);
    if (this.onGround && Math.abs(dyStep) > 0.06 && Math.abs(dyStep) < 0.8) this._camOff = (this._camOff || 0) - dyStep;
    this._lastY = this.pos.y;
    this._camOff = (this._camOff || 0) * Math.exp(-dt * 14);
    if (Math.abs(this._camOff) > 0.8) this._camOff = 0;
    cam.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + this.eye + bobY + this._camOff, this.pos.z - bobX * Math.sin(this.yaw));
    cam.rotation.set(this.pitch + this.recoil, this.yaw, swim ? Math.sin(this.bob) * 0.025 : 0, 'YXZ');
  }
}
