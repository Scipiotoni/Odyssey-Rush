// Fishing rod: cast a float onto open water (a lake, a river, the sea, or a hole in the winter ice),
// wait for a bite, then strike (LMB) while the float is pulled under. The server decides what bites.
import * as THREE from 'three';
import { audio } from './audio.js';

export class Fishing {
  constructor(game) {
    this.g = game; this.state = 'idle'; // idle | out | bite
    const float = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe03020 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), new THREE.MeshLambertMaterial({ color: 0x222222 })); stick.position.y = 0.09;
    float.add(top, bot, stick); float.visible = false;
    this.float = float; game.scene.add(float);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false; this.line.visible = false; game.scene.add(this.line);
    this.pt = new THREE.Vector3(); this.t = 0;
  }
  // where the cast lands: the first point the view ray meets the water surface (and nothing solid before it)
  aim() {
    const g = this.g, o = g.camera.position, d = g.held.dir();
    if (d.y > -0.04) {
      // aiming flat or up: lob it 14 m out
      const t = 14;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      return this.check(x, z, o);
    }
    const t = (0.02 - o.y) / d.y;
    if (t < 2 || t > 26) return { err: t > 26 ? 'Too far to cast' : null };
    const hit = g.physics.raycast(o, d, t, null, { filter: (c) => !c.ghost });
    if (hit && hit.kind !== 'ice') return { err: null };
    return this.check(o.x + d.x * t, o.z + d.z * t, o);
  }
  check(x, z) {
    const g = this.g, ground = g.world.ground(x, z);
    if (ground > -0.4) return { err: null };
    if (g.iceField.frozen && g.iceField.solid(x, z)) return { err: 'The lake is frozen — break a hole with a pickaxe to fish through' };
    return { x, z };
  }
  cancel(msg) {
    if (this.state !== 'idle') this.g.net.send({ t: 'fishreel', cancel: 1 });
    this.state = 'idle'; this.float.visible = this.line.visible = false;
    if (msg) this.g.ui.toast(msg);
  }
  onBite(m) { if (this.state === 'out' && m.id === this.id) { this.state = 'bite'; this.biteT = performance.now(); audio.splash(0.15); audio.plop?.(); } }
  onResult(m) {
    if (m.id !== this.id) return;
    this.state = 'idle'; this.float.visible = this.line.visible = false;
    if (m.ok) { audio.splash(0.4); this.g.effects.burst(this.pt.clone().setY(0.1), { count: 14, color: 0xcfe6f2, speed: 3, size: 0.06, life: 0.6 }); }
  }
  update(dt, input) {
    const g = this.g, LP = input.mouse.leftPressed;
    this.t += dt;
    if (this.state === 'idle') {
      const a = this.aim();
      g.ui.prompt(a.x !== undefined ? '<kbd>LMB</kbd> cast the line' : `<small>${a.err || 'Aim at open water to cast'}</small>`);
      if (LP && a.x !== undefined && performance.now() >= g.held.coolUntil) {
        this.id = Math.floor(Math.random() * 1e9); this.state = 'out'; this.pt.set(a.x, 0.02, a.z);
        g.net.send({ t: 'fishcast', sel: g.sel, x: a.x, z: a.z, id: this.id });
        g.held.swingAnim(0.5); audio.swing(); setTimeout(() => audio.splash(0.12), 500);
        g.held.coolUntil = performance.now() + 700;
      }
    } else {
      const cam = g.camera.position;
      if (Math.hypot(this.pt.x - cam.x, this.pt.z - cam.z) > 32) return this.cancel('The line snapped — you walked too far');
      if (g.iceField.frozen && g.iceField.solid(this.pt.x, this.pt.z)) return this.cancel('The hole froze over');
      const biting = this.state === 'bite';
      g.ui.prompt(biting ? '<b style="color:#ffd070">Something bites! <kbd>LMB</kbd> strike now!</b>' : '<small>Waiting for a bite… <kbd>LMB</kbd> reel in</small>');
      if (LP && performance.now() >= g.held.coolUntil) {
        g.net.send({ t: 'fishreel', id: this.id }); g.held.swingAnim(0.4);
        this.state = 'reeling'; setTimeout(() => { if (this.state === 'reeling') { this.state = 'idle'; this.float.visible = this.line.visible = false; } }, 1500);
      }
    }
    this.draw();
  }
  draw() {
    const g = this.g, on = this.state === 'out' || this.state === 'bite' || this.state === 'reeling';
    this.float.visible = this.line.visible = on;
    if (!on) return;
    const t = performance.now() / 1000;
    const dip = this.state === 'bite' ? -0.09 + Math.sin(t * 22) * 0.04 : Math.sin(t * 2.2) * 0.012;
    this.float.position.set(this.pt.x, this.pt.y + dip, this.pt.z);
    // the line sags from the rod tip to the float
    const cam = g.camera, tip = new THREE.Vector3(0.32, 0.12, -1.25).applyQuaternion(cam.quaternion).add(cam.position);
    const p = this.line.geometry.attributes.position;
    for (let i = 0; i < 16; i++) {
      const f = i / 15;
      p.setXYZ(i, tip.x + (this.float.position.x - tip.x) * f, tip.y + (this.float.position.y + 0.12 - tip.y) * f - Math.sin(f * Math.PI) * 0.6, tip.z + (this.float.position.z - tip.z) * f);
    }
    p.needsUpdate = true;
  }
}
