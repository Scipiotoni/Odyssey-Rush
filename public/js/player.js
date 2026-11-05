import { CAVE_ZONE } from '/shared/caves.js';
// Local first-person player controller.
import * as THREE from 'three';
import { audio } from './audio.js';

const WALK = 4.6, SPRINT = 7.4, CROUCH = 2.2, SWIM = 3.2, JUMP = 6.8, GRAV = 20;

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
  }
  get height() { return this.crouch ? 1.2 : 1.8; }

  look(dx, dy, sens) {
    this.yaw -= dx * 0.0022 * sens;
    this.pitch -= dy * 0.0022 * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  update(dt, input, active) {
    const g = this.game, ph = g.physics, w = g.world;
    const k = (c) => active && input.down(c);
    this.crouch = k('ControlLeft') || k('KeyC');
    let fx = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let sx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const len = Math.hypot(fx, sx) || 1; fx /= len; sx /= len;
    const fwd = [-Math.sin(this.yaw), -Math.cos(this.yaw)], right = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const inCave = this.pos.y < CAVE_ZONE;
    const groundY = inCave ? -1e6 : w.ground(this.pos.x, this.pos.z);
    const waterDepth = inCave ? 0 : -this.pos.y; // sea level is 0 (no sea in the caves)
    this.swimming = waterDepth > 1.15 && groundY < -1.0;
    this.sprinting = k('ShiftLeft') && fx > 0 && !this.crouch && !this.swimming;
    let speed = this.swimming ? SWIM : this.crouch ? CROUCH : this.sprinting ? SPRINT : WALK;
    if (waterDepth > 0.4 && !this.swimming) speed *= 0.7; // wading
    if (g.encumbered) speed *= 0.85;
    const tx = (fwd[0] * fx + right[0] * sx) * speed, tz = (fwd[1] * fx + right[1] * sx) * speed;
    const accel = this.onGround || this.swimming ? 12 : 2.5;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;
    if (this.swimming) {
      const targetY = -1.25;
      let vy = (targetY - this.pos.y) * 2;
      if (k('Space')) vy = 2.5; if (this.crouch) vy = -2.5;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-4 * dt));
    } else {
      this.vel.y -= GRAV * dt;
      if (k('Space') && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
    }
    const wasGround = this.onGround;
    const preVy = this.vel.y;
    const res = ph.moveBody(this.pos, this.vel, this.radius, this.height, dt);
    this.onGround = res.ground;
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
    const targetEye = this.crouch ? 1.05 : 1.62;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bob += hs * dt * 1.9;
      this.stepT -= hs * dt;
      if (this.stepT <= 0) { this.stepT = this.sprinting ? 2.4 : 1.9; audio.step(inCave ? 'rock' : waterDepth > 0.1 ? 'water' : ph.lastSurf ? 'concrete' : w.surface(this.pos.x, this.pos.z).name); }
    } else this.bob *= 0.9;
    this.recoil *= Math.exp(-10 * dt);
  }

  applyCamera(cam) {
    const bobY = Math.sin(this.bob * 2) * 0.04, bobX = Math.cos(this.bob) * 0.03;
    cam.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + this.eye + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    cam.rotation.set(this.pitch + this.recoil, this.yaw, 0, 'YXZ');
  }
}
