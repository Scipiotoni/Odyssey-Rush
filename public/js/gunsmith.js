// Gunsmith Bench screen: pick a weapon, fit attachments into its slots, choose a finish,
// see a live 3D preview and how every change moves the stats.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEMS, RECIPES } from '/shared/items.js';
import { GUN_SLOTS, MODS, FINISHES, SLOT_NAMES, gunStats, isModdable } from '/shared/gunmods.js';
import { makeItemModel } from './items3d.js';
import { iconHTML, countItem } from './ui.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + new THREE.Color(c).getHexString();

class Preview {
  constructor(canvas) {
    this.canvas = canvas; this.renderer = null; this.key = ''; this.rot = 0; this.drag = null; this.running = false;
    canvas.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, r: this.rot }; });
    addEventListener('mouseup', () => (this.drag = null));
    addEventListener('mousemove', (e) => { if (this.drag) this.rot = this.drag.r + (e.clientX - this.drag.x) * 0.01; });
  }
  init() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.2));
    const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(1.5, 2, 2.5); this.scene.add(k);
    this.camera = new THREE.PerspectiveCamera(24, this.canvas.width / this.canvas.height, 0.01, 50);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
  }
  show(id, mods) {
    this.init();
    const key = id + JSON.stringify(mods || {});
    if (key !== this.key) {
      this.key = key;
      this.pivot.clear();
      if (!id) return;
      const m = makeItemModel(id, mods);
      m.rotation.y = -Math.PI / 2;
      const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      m.position.sub(c);
      this.pivot.add(m);
      const r = Math.max(sz.x, sz.z, sz.y * 2.2) * 0.62;
      this.camera.position.set(0, r * 0.12, r / Math.tan((24 * Math.PI) / 360));
      this.camera.lookAt(0, 0, 0);
    }
  }
  start() {
    this.init();
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (!this.drag) this.rot += 0.004;
      this.pivot.rotation.set(0.12, Math.sin(this.rot) * 0.65, 0);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  stop() { this.running = false; }
}

export class Gunsmith {
  constructor(game) { this.game = game; this.bench = null; this.sel = -1; this.preview = new Preview($('gsprev')); }
  guns() { return this.game.inv.map((s, i) => ({ s, i })).filter(({ s }) => s && isModdable(s.id)); }
  open(benchId) {
    this.bench = benchId;
    const g = this.guns();
    if (!g.some((x) => x.i === this.sel)) this.sel = g.length ? g[0].i : -1;
    this.game.ui.show('gunsmith');
    this.preview.start();
    this.render();
  }
  close() { this.preview.stop(); }
  send(m) { this.game.net.send({ t: 'gunmod', bench: this.bench, i: this.sel, ...m }); audio.click(); }
  render() {
    const g = this.game, inv = g.inv;
    const list = this.guns();
    if (!list.some((x) => x.i === this.sel)) this.sel = list.length ? list[0].i : -1;
    $('gslist').innerHTML = list.length ? list.map(({ s, i }) => `<button class="gsgun${i === this.sel ? ' sel' : ''}" data-i="${i}">${iconHTML(s.id)}<span>${ITEMS[s.id].name}<small>${Object.keys(s.mods || {}).filter((k) => k !== 'finish').length} attachments</small></span></button>`).join('') : '<p class="hint">Put a gun in your inventory to customize it.</p>';
    $('gslist').querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => { this.sel = +el.dataset.i; audio.click(); this.render(); }));
    const st = inv[this.sel];
    if (!st) { $('gsslots').innerHTML = ''; $('gsstats').innerHTML = ''; $('gsname').textContent = 'No weapon selected'; this.preview.show(null); return; }
    this.preview.show(st.id, st.mods);
    $('gsname').textContent = ITEMS[st.id].name;
    const mods = st.mods || {};
    // ---- slots
    let html = '';
    for (const [slot, opts] of Object.entries(GUN_SLOTS[st.id])) {
      const cur = mods[slot];
      html += `<div class="gsslot"><h4>${SLOT_NAMES[slot]} <small>${cur ? MODS[cur].name : 'empty'}</small></h4><div class="gsopts">`;
      html += `<button class="gsopt${!cur ? ' sel' : ''}" data-slot="${slot}" data-mod="">None</button>`;
      for (const id of opts) {
        const have = countItem(inv, id), on = cur === id;
        const rec = RECIPES.find((r) => r.out === id);
        const cost = rec ? Object.entries(rec.cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ') : '';
        html += `<button class="gsopt${on ? ' sel' : ''}${!on && !have ? ' need' : ''}" data-slot="${slot}" data-mod="${id}" title="${MODS[id].desc}${!on && !have ? ' — craft it here: ' + cost : ''}">${iconHTML(id, 'gsico')}<span>${MODS[id].name}</span><small>${on ? 'fitted' : have ? `×${have}` : 'craft'}</small></button>`;
      }
      html += '</div></div>';
    }
    html += `<div class="gsslot"><h4>Finish <small>${FINISHES.find((f) => f.id === (mods.finish || 'factory')).name}</small></h4><div class="gsopts fin">` +
      FINISHES.map((f) => `<button class="gsfin${(mods.finish || 'factory') === f.id ? ' sel' : ''}" data-fin="${f.id}" title="${f.name}" style="background:${f.id === 'factory' ? 'linear-gradient(135deg,#8c7650 50%,#1e1f21 50%)' : f.metal && !f.poly ? `linear-gradient(135deg, ${hex(f.metal)}, #fff 60%, ${hex(f.metal)})` : f.metal ? `linear-gradient(135deg, ${hex(f.metal)} 50%, ${hex(f.poly)} 50%)` : hex(f.poly)}"></button>`).join('') + '</div></div>';
    $('gsslots').innerHTML = html;
    $('gsslots').querySelectorAll('[data-slot]').forEach((el) => el.addEventListener('click', () => {
      const mod = el.dataset.mod || null, slot = el.dataset.slot;
      if (mod && mods[slot] !== mod && countItem(inv, mod) <= 0) { g.ui.toast(`Craft a ${MODS[mod].name} at this bench first (Fabrication list)`); return; }
      this.send({ slot, mod });
    }));
    $('gsslots').querySelectorAll('[data-fin]').forEach((el) => el.addEventListener('click', () => this.send({ finish: el.dataset.fin })));
    // ---- stats: base vs fitted
    const base = gunStats({ id: st.id }), now = gunStats(st);
    const rows = [
      ['Damage', (x) => x.dmg * (x.pellets || 1), 120], ['Fire rate', (x) => x.rate, 10], ['Range', (x) => x.range, 500],
      ['Accuracy', (x) => 0.004 / (x.spread * Math.min(x.spreadHip, 1)), 1.3], ['Aim accuracy', (x) => 0.004 / (x.spread * x.spreadAds), 3], ['Recoil control', (x) => 0.02 / x.recoil, 2.2],
      ['Magazine', (x) => x.mag, 150], ['Reload speed', (x) => 2 / x.reload, 1.4], ['Zoom', (x) => 1 / (x.zoom ?? 0.78), 6.5],
    ];
    $('gsstats').innerHTML = rows.map(([n, f, max]) => {
      const a = f(base), b = f(now), pa = Math.min(100, (a / max) * 100), pb = Math.min(100, (b / max) * 100);
      const d = b - a, cls = Math.abs(d) < 1e-6 ? '' : d > 0 ? 'up' : 'down';
      return `<div class="gsstat ${cls}"><span>${n}</span><div class="bar"><div class="base" style="width:${pa}%"></div><div class="now" style="width:${pb}%"></div></div><b>${n === 'Magazine' ? Math.round(b) : b >= 10 ? Math.round(b) : b.toFixed(2)}</b></div>`;
    }).join('') + (now.quiet ? '<div class="gsflag">🔇 Suppressed: quiet, no muzzle flash</div>' : '') + (now.scope ? '<div class="gsflag">🔭 Scoped</div>' : '') + (now.light ? '<div class="gsflag">🔦 Lights up the dark</div>' : '') + (now.laser ? '<div class="gsflag">🔴 Laser dot for hip fire</div>' : '');
  }
}
