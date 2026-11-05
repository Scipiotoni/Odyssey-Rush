// Main-menu character creator with a live 3D preview.
import * as THREE from 'three';
import { LOOK_FIELDS, sanitizeLook, randomLook, lookOptions } from '/shared/look.js';
import { makeHumanoid, poseHumanoid } from './character.js';

const $ = (id) => document.getElementById(id);

export class Creator {
  constructor(onChange) {
    this.onChange = onChange;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('or_look') || 'null'); } catch {}
    this.look = saved ? sanitizeLook(saved) : randomLook();
    this.save();
    const canvas = $('preview');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 300, canvas.clientHeight || 400, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, (canvas.clientWidth || 300) / (canvas.clientHeight || 400), 0.1, 20);
    this.camera.position.set(0, 1.15, 4.4);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3a2a, 1.4));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.2); key.position.set(2, 3, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2); rim.position.set(-3, 2, -2); this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.06, 32), new THREE.MeshLambertMaterial({ color: 0x3a3226 }));
    disc.position.y = -0.03; this.scene.add(disc);
    this.yaw = Math.PI - 0.45; this.drag = null; this.t = 0;
    canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag !== null) { this.yaw += (e.clientX - this.drag) * 0.012; this.drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => (this.drag = null));
    this.buildOptions();
    this.rebuild();
    $('randlook').onclick = () => { this.look = randomLook(); this.changed(); };
    this.running = true;
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.render(); };
    loop();
  }
  save() { try { localStorage.setItem('or_look', JSON.stringify(this.look)); } catch {} }
  changed() { this.save(); this.renderOptions(); this.rebuild(); this.onChange?.(this.look); }
  rebuild() {
    if (this.model) this.scene.remove(this.model);
    this.model = makeHumanoid(this.look);
    this.scene.add(this.model);
  }
  buildOptions() {
    const box = $('lookopts');
    box.innerHTML = '';
    this.rows = {};
    for (const f of LOOK_FIELDS) {
      const row = document.createElement('div'); row.className = 'lookrow';
      row.innerHTML = `<span class="lk">${f.label}</span><button class="arrow" data-d="-1">◀</button><span class="lv"></span><button class="arrow" data-d="1">▶</button>`;
      row.querySelectorAll('.arrow').forEach((b) => (b.onclick = () => {
        const n = lookOptions(f);
        this.look[f.key] = (this.look[f.key] + +b.dataset.d + n) % n;
        this.changed();
      }));
      box.appendChild(row);
      this.rows[f.key] = row.querySelector('.lv');
    }
    this.renderOptions();
  }
  renderOptions() {
    for (const f of LOOK_FIELDS) {
      const v = this.look[f.key], el = this.rows[f.key];
      if (f.colors) el.innerHTML = `<i class="sw" style="background:#${f.colors[v].toString(16).padStart(6, '0')}"></i>${v + 1}/${f.colors.length}`;
      else el.textContent = f.names[v];
    }
  }
  render() {
    this.t += 1 / 60;
    if (this.drag === null) this.yaw += 0.004;
    this.model.rotation.y = this.yaw;
    poseHumanoid(this.model.userData, { mode: 'stand', walk: 0, amt: 0 });
    this.model.userData.spine.rotation.x = Math.sin(this.t * 1.6) * 0.015;
    this.model.userData.armL.rotation.z = -0.12 - Math.sin(this.t * 1.6) * 0.02;
    this.model.userData.armR.rotation.z = 0.12 + Math.sin(this.t * 1.6) * 0.02;
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.running = false; this.renderer.dispose(); }
}
