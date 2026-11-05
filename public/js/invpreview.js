// Live 3D preview of your own survivor in the inventory (wears your armor, looks toward the cursor).
import * as THREE from 'three';
import { makeHumanoid, poseHumanoid } from './character.js';
import { ARMOR_SLOTS } from '/shared/items.js';

export class InvPreview {
  constructor(game, canvas) {
    this.game = game; this.canvas = canvas;
    this.renderer = null; this.model = null; this.key = '';
    this.mx = 0; this.my = 0; this.t = 0; this.running = false;
    addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      this.mx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 260));
      this.my = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.22)) / 260));
    });
  }
  init() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, this.canvas.width / this.canvas.height, 0.1, 20);
    this.camera.position.set(0, 1.0, -4.0);
    this.camera.lookAt(0, 0.92, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a4a3a, 1.6));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4); key.position.set(-2, 3, -3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa8c4ff, 1.0); rim.position.set(3, 2, 2); this.scene.add(rim);
  }
  start() {
    this.init();
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.render(dt);
    };
    loop();
  }
  stop() { this.running = false; }
  render(dt) {
    const g = this.game;
    const armor = ARMOR_SLOTS.map((s) => g.armor?.[s]?.id || null);
    const key = JSON.stringify([g.look, armor]);
    if (key !== this.key) {
      if (this.model) this.scene.remove(this.model);
      this.model = makeHumanoid(g.look, armor);
      this.scene.add(this.model);
      this.key = key;
    }
    this.t += dt;
    // body turns a little toward the cursor, the head follows it more
    this.model.rotation.y = -this.mx * 0.55;
    poseHumanoid(this.model.userData, { mode: 'stand', walk: 0, amt: 0, t: this.t, pitch: -this.my * 0.5, turn: 0 }, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
