// Renders 3D item models into small transparent PNG icons (cached, generated a few per frame).
import * as THREE from 'three';
import { ITEMS } from '/shared/items.js';
import { makeItemModel } from './items3d.js';

const SIZE = 128;

class IconRenderer {
  constructor() {
    this.cache = new Map();
    this.queue = [];
    this.listeners = new Set();
    this.ok = true;
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = SIZE;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    } catch { this.ok = false; return; }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50463a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.5, 2.5, 2.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1); rim.position.set(-2, 1, -2); this.scene.add(rim);
    // a soft studio environment so metal parts get reflections in the icons
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.8;
      this.envReady = true;
    }).catch(() => (this.envReady = true));
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.01, 50);
    const tick = () => { this.process(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  onReady(fn) { this.listeners.add(fn); }
  get(id) {
    if (!this.ok || !ITEMS[id]) return null;
    const v = this.cache.get(id);
    if (v) return v;
    if (v === undefined) { this.cache.set(id, null); this.queue.push(id); }
    return null;
  }
  process() {
    if (!this.queue.length || !this.envReady) return;
    const done = [];
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 6) {
      const id = this.queue.shift();
      try { this.cache.set(id, this.render(id)); done.push(id); } catch (e) { console.warn('icon failed', id, e); }
    }
    if (done.length) for (const fn of this.listeners) fn(done);
  }
  render(id) {
    const d = ITEMS[id];
    const model = makeItemModel(id);
    const pivot = new THREE.Group(); pivot.add(model);
    // pose by category: guns side-on, long tools diagonal, everything else 3/4 from above
    if (d.gun && id !== 'bow') { model.rotation.set(0, -Math.PI / 2, 0); pivot.rotation.set(0.25, -0.35, 0.12); }
    else if (id === 'bow') { pivot.rotation.set(0.1, 0.2, 0.35); }
    else if (d.tool || (d.cat === 'weapon' && !d.gun) || id === 'arrow' || id === 'torch') { model.rotation.set(0, 0.9, 0); pivot.rotation.set(0.35, 0, -0.78); }
    else { pivot.rotation.set(0.5, 0.6, 0); }
    this.scene.add(pivot);
    pivot.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(pivot);
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.62 + 0.001;
    const dist = r / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.set(c.x, c.y, c.z + dist * 1.05);
    this.camera.lookAt(c);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(pivot);
    return this.canvas.toDataURL('image/png');
  }
}
export const icons = new IconRenderer();
