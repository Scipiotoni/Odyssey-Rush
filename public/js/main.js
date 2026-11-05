// Odyssey Rush client entry point: wires networking, world streaming, player, vehicles and UI.
import * as THREE from 'three';
import { World, BIOME_NAMES, chunkKey, CHUNK } from '/shared/worldgen.js';
import { ITEMS, NODES, ANIMALS, INV_SIZE } from '/shared/items.js';
import { VEHICLES, VEHICLE_ENTER_RANGE } from '/shared/vehicles.js';
import { PIECES, TIERS } from '/shared/building.js';
import { Physics } from './physics.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Effects } from './effects.js';
import { Entities } from './entities.js';
import { Structures } from './structures.js';
import { VehicleSim, VehicleView } from './vehicles.js';
import { Player } from './player.js';
import { Builder } from './building.js';
import { Painter } from './painter.js';
import { Nature } from './nature.js';
import { Held } from './held.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { UI, countItem, CONTROLS } from './ui.js';
import { Creator } from './creator.js';
import { makeHumanoid, poseHumanoid } from './character.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { audio } from './audio.js';
const _rv = new THREE.Vector3(), _rq = new THREE.Quaternion();

const $ = (id) => document.getElementById(id);
const MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
const DEFAULTS = { viewDist: 900, sens: 1, fov: 75, shadows: true, volume: 0.6, detail: MOBILE ? 1 : 2 };

class Game {
  constructor() {
    this.settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('or_settings') || '{}') };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, [1, 1, 1.25, 1.5][this.settings.detail ?? 2]));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    $('game').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // soft studio reflections for glossy materials (car paint, glass, chrome)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 5000);
    this.scene.add(this.camera);
    addEventListener('resize', () => { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); });
    this.input = new Input(this.renderer.domElement);
    this.net = new Net();
    this.inv = new Array(INV_SIZE).fill(null);
    this.armor = { head: null, chest: null, legs: null };
    this.sel = 0; this.container = null; this.stats = { hp: 100, food: 100, water: 100, lvl: 1, xp: 0, maxhp: 100 };
    this.queue = []; this.bags = [];
    this.ready = false; this.alive = true;
    this.vehicleViews = new Map();
    this.regionContents = new Map();
    this.vehicle = null; // {id, seat, view, sim, camMode}
    this.camOrbit = { yaw: 0, pitch: 0.25 };
    this.lastSend = 0; this.lastT = performance.now();
    this.nodeFrac = new Map();
    this.timers = { reveal: 0, save: 0, vstate: 0, crash: 0 };
    this.hitCooldown = new Map();
  }

  async start(name, pass = '') {
    audio.init(); audio.resume(); audio.setVolume(this.settings.volume);
    let token = localStorage.getItem('or_token');
    if (!token) { token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('or_token', token); }
    localStorage.setItem('or_name', name);
    this.name = name;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    $('menustatus').textContent = 'Connecting…';
    await this.net.connect(url);
    this.bindNet();
    this.net.send({ t: 'hello', token, name, look: this.look, pass: pass || undefined });
  }

  initWorld(seed) {
    this.seed = seed;
    this.world = new World(seed);
    for (const [ix, iz, v] of this.pendingTerr || []) this.world.setMod(ix, iz, v);
    this.physics = new Physics(this.world);
    this.sky = new Sky(this.scene);
    this.sky.sun.castShadow = this.settings.shadows;
    this.effects = new Effects(this.scene);
    this.terrain = new Terrain(this.scene, this.world, this.physics);
    this.terrain.shadows = this.settings.shadows;
    this.terrain.setViewDist(this.settings.viewDist);
    this.structures = new Structures(this.scene, this.physics, this.effects);
    this.nature = new Nature(this.scene, this.world, this.physics);
    this.structures.onChange = (x, z) => this.nature.grass.invalidate(x, z);
    this.nature.setDetail(this.settings.detail ?? 2); this.terrain.setDetail(this.settings.detail ?? 2);
    this.entities = new Entities(this.scene, this.effects);
    this.player = new Player(this);
    this.ui = new UI(this);
    this.builder = new Builder(this);
    this.painter = new Painter(this);
    this.held = new Held(this);
    this.avatar = makeHumanoid(this.look); this.avatar.visible = false; this.scene.add(this.avatar);
    this.building = this.builder;
    this.input.onKey = (code, e) => this.onKey(code, e);
    this.input.onUnlock = () => { if (this.ready && !this.ui.open) this.ui.show('pause'); };
    this.setupSettings();
    $('chatinput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.ui.closeChat(true); this.input.lock(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.ui.closeChat(false); this.input.lock(); }
      e.stopPropagation();
    });
    $('resume').onclick = () => this.ui.close();
  }

  // Detail level 0-3: dense grass, ground cover, wildlife, tree distance and render resolution
  applyDetail(v) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, [1, 1, 1.25, 1.5][v]));
    this.renderer.setSize(innerWidth, innerHeight);
    this.nature?.setDetail(v);
    this.terrain?.setDetail(v);
  }
  setupSettings() {
    const s = this.settings;
    const bind = (id, key, fmt, apply) => {
      const el = $(id), lab = $(id + '-v');
      if (el.type === 'checkbox') el.checked = s[key]; else el.value = s[key];
      if (lab) lab.textContent = fmt(s[key]);
      el.oninput = () => {
        s[key] = el.type === 'checkbox' ? el.checked : +el.value;
        if (lab) lab.textContent = fmt(s[key]);
        localStorage.setItem('or_settings', JSON.stringify(s));
        apply(s[key]);
      };
    };
    bind('set-view', 'viewDist', (v) => v + 'm', (v) => this.terrain.setViewDist(v));
    bind('set-sens', 'sens', (v) => (+v).toFixed(1), () => {});
    bind('set-fov', 'fov', (v) => v + '°', () => {});
    bind('set-detail', 'detail', () => '', (v) => this.applyDetail(v));
    bind('set-shadows', 'shadows', () => '', (v) => { this.renderer.shadowMap.enabled = v; this.sky.sun.castShadow = v; this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); });
    bind('set-vol', 'volume', (v) => Math.round(v * 100) + '%', (v) => audio.setVolume(v));
  }

  // ------------------------------------------------------------------ networking
  bindNet() {
    const n = this.net;
    n.on('reset_confirm', (m) => this.showResetDialog(m));
    n.on('server_reset', (m) => {
      this.resetting = m;
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('or_explored_') || k.startsWith('or_pois_')) localStorage.removeItem(k); } catch {}
      this.ui.close(true);
      $('loading').classList.remove('hidden');
      $('loading').firstElementChild.textContent = `🌋 ${m.by} reset the server${m.newIsland ? ' with a brand-new island' : ''} — everyone starts fresh. Rejoining…`;
    });
    n.on('acct', (m) => {
      if (m.token) localStorage.setItem('or_token', m.token);
      if (m.name) localStorage.setItem('or_name', m.name);
      this.accountProtected = m.protected;
      if (m.created) this.pendingNote = `🔐 Account created — sign in as "${m.name}" with your password on any device.`;
    });
    n.on('authfail', (m) => {
      this.authFailed = true;
      $('menustatus').textContent = m.m;
      $('playbtn').disabled = false;
      $('passinput').focus();
    });
    n.on('welcome', (m) => {
      this.onEnter?.(); this.onEnter = null;
      this.pendingTerr = m.terr || [];
      this.pid = m.pid; this.day = m.day; this.tpSeq = m.seq || 0; this.dayLen = m.dayLen;
      this.initWorld(m.seed);
      this.player.pos.set(m.p[0], m.p[1], m.p[2]);
      this.player.yaw = m.yaw || 0;
      this.alive = m.alive;
      $('menu').classList.add('hidden');
      $('loading').classList.remove('hidden');
      this.loadStart = performance.now();
      requestAnimationFrame(() => this.loop());
    });
    n.on('close', (ev) => {
      if (this.authFailed || (ev && ev.code === 4001)) { this.authFailed = false; return; }
      if (ev && ev.code === 4000) { this.input.unlock(); $('loading').classList.remove('hidden'); $('loading').firstElementChild.textContent = 'You joined from another tab or device. Close this one.'; return; }
      // Connection lost (server restart / network blip): wait for the server, then rejoin automatically.
      this.input.unlock();
      $('loading').classList.remove('hidden');
      if (!this.resetting) $('loading').firstElementChild.textContent = 'Connection lost — reconnecting…';
      const retry = async () => {
        try { const r = await fetch('/health', { cache: 'no-store' }); if (r.ok) { sessionStorage.setItem('or_autoplay', '1'); location.reload(); return; } } catch {}
        setTimeout(retry, 2000);
      };
      setTimeout(retry, 1000);
    });
    n.on('inv', (m) => { this.inv = m.inv; this.armor = m.armor; if (this.ui.open === 'inv') this.ui.renderInventory(); else this.ui.renderHotbar(); });
    n.on('stats', (m) => { const was = this.stats.lvl; this.stats = m; this.ui.renderStats(m); if (m.lvl > was && was) audio.craftDone(); });
    n.on('queue', (m) => { const done = this.queue.length > m.q.length; this.queue = m.q; this.ui.renderQueue(m.q); if (done) audio.craftDone(); });
    n.on('gain', (m) => { this.ui.gain(m.id, m.n); audio.pickup(); });
    n.on('toast', (m) => this.ui.toast(m.m));
    n.on('chat', (m) => this.ui.chat(m.from, m.m, m.clan));
    n.on('claninfo', (m) => { this.clanInfo = m; if (this.ui.open === 'clan') this.ui.renderClan(); });
    n.on('time', (m) => (this.day = m.day));
    n.on('v_reset', (m) => { const v = this.vehicle; if (v && v.id === m.id && v.sim) { v.sim.setState(m.p, m.q, [0, 0, 0]); v.sim.ang.set(0, 0, 0); } });
    n.on('tp', (m) => { this.ride = null; this.tpSeq = m.seq || 0; this.player.pos.set(m.p[0], m.p[1], m.p[2]); this.player.vel.set(0, 0, 0); });
    n.on('rg', (m) => {
      const rc = { s: new Set(), l: new Set(), d: new Set(m.d) };
      this.regionContents.set(m.k, rc);
      for (const s of m.s) { this.structures.upsert(s); rc.s.add(s.id); }
      for (const l of m.l) { this.entities.addLoot(l, this.physics); rc.l.add(l.id); }
      for (const id of m.d) this.terrain.setDepleted(id, true);
      this.refreshBags();
    });
    n.on('rgu', (m) => {
      const rc = this.regionContents.get(m.k);
      if (!rc) return;
      for (const id of rc.s) this.structures.remove(id);
      for (const id of rc.l) this.entities.removeLoot(id, this.physics);
      for (const id of rc.d) this.terrain.setDepleted(id, false);
      this.regionContents.delete(m.k);
    });
    const regionOf = (x, z) => chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    n.on('sadd', (m) => { this.structures.upsert(m.s); if (!m.s.veh) this.regionContents.get(regionOf(m.s.x, m.s.z))?.s.add(m.s.id); this.refreshBags(); if (m.s.o === this.pid) audio.hitStruct(); });
    n.on('supd', (m) => this.structures.upsert(m.s));
    n.on('vpaint', (m) => { const v = this.vehicleViews.get(m.id); if (v) v.setPaint(m); });
    n.on('admin_items', (m) => this.ui.showItems(m.q));
    n.on('vst', (m) => { for (const st of m.s) this.structures.upsert(st); this.refreshBags(); });
    n.on('sdel', (m) => { const e = this.structures.map.get(m.id); this.structures.remove(m.id, m.fx); if (e) this.regionContents.get(regionOf(e.s.x, e.s.z))?.s.delete(m.id); if (m.fx) audio.hitStruct(); this.refreshBags(); });
    n.on('ladd', (m) => { this.entities.addLoot(m.l, this.physics); this.regionContents.get(regionOf(m.l.x, m.l.z))?.l.add(m.l.id); });
    n.on('lupd', (m) => { const e = this.entities.loot.get(m.l.id); if (e && e.data.item !== m.l.item) this.entities.addLoot(m.l, this.physics); else if (e) e.data = m.l; });
    n.on('ldel', (m) => this.entities.removeLoot(m.id, this.physics));
    n.on('node', (m) => {
      this.terrain.setDepleted(m.id, !!m.dep);
      const [cx, cz] = m.id.split('_');
      const rc = this.regionContents.get(`${cx},${cz}`);
      if (rc) { if (m.dep) rc.d.add(m.id); else rc.d.delete(m.id); }
      if (m.dep) {
        const e = this.terrain.nodeIndex.get(m.id);
        if (e && NODES[e.node.type].kind === 'tree') this.effects.burst({ x: e.node.x, y: e.node.y + 3, z: e.node.z }, { count: 30, color: 0x3f7a2c, speed: 3, size: 0.25, life: 1.5, gravity: 6, jitter: 3 });
        else if (e && NODES[e.node.type].kind === 'ore') this.effects.burst({ x: e.node.x, y: e.node.y + 0.6, z: e.node.z }, { count: 20, color: 0x8a8680, speed: 4, size: 0.2, life: 1.2, gravity: 12 });
      }
    });
    n.on('nodehit', (m) => this.nodeFrac.set(m.id, m.frac));
    n.on('shit', (m) => { this.lastStructHit = { ...m, t: performance.now() }; this.ui.hitmarker(false); });
    n.on('cont', (m) => {
      if (!m.slots) { this.container = null; if (this.ui.open === 'inv') this.ui.renderInventory(); return; }
      this.container = { id: m.id, title: m.title, slots: m.slots, station: m.station, queue: m.queue, recv: performance.now() };
      if (this.ui.open !== 'inv') this.ui.show('inv'); else this.ui.renderInventory();
    });
    n.on('hurt', (m) => {
      audio.hurt();
      let ang = null;
      if (m.from) { const a = Math.atan2(m.from[0] - this.player.pos.x, m.from[1] - this.player.pos.z); ang = -(a - Math.atan2(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw))); }
      this.ui.hurt(ang);
      this.effects.shake = Math.min(1, this.effects.shake + m.dmg / 40);
    });
    n.on('hitmark', (m) => { this.ui.hitmarker(m.hs); audio.hitmark(); if (m.kill) this.ui.toast('☠ Kill'); });
    n.on('dead', (m) => {
      this.alive = false; this.bags = m.bags || [];
      if (this.vehicle) this.leaveVehicleLocal();
      this.container = null;
      if (this.ready) this.ui.death(m.by, m.bags); else this.pendingDeath = m;
    });
    n.on('spawn', (m) => {
      this.alive = true; this.tpSeq = m.seq || 0;
      this.player.pos.set(m.p[0], m.p[1], m.p[2]); this.player.vel.set(0, 0, 0);
      this.ui.close();
      this.terrain.center = [NaN, NaN];
    });
    n.on('snap', (m) => this.onSnap(m));
    n.on('terr', (m) => this.terrain.applyMods(m.m));
    n.on('fx', (m) => this.onFx(m));
    n.on('ex', (m) => this.entities.addExplosive(m));
    n.on('v_seat', (m) => this.onSeat(m));
  }

  // Admin world reset: two typed confirmations + a final "are you sure"
  showResetDialog(m) {
    this.ui.show('reset');
    const st = m.stats || {};
    $('resetstats').textContent = `Currently: ${st.players || 0} survivors, ${st.structs || 0} building pieces & deployables, ${st.vehicles || 0} vehicles. ${st.accounts || 0} accounts will be kept.`;
    $('resetcode').textContent = m.code;
    $('resetword').value = ''; $('resetcodein').value = ''; $('resetisland').checked = false;
    const go = $('resetgo');
    const check = () => { go.disabled = !($('resetword').value.trim().toUpperCase() === 'RESET' && $('resetcodein').value.trim().toUpperCase() === m.code); };
    $('resetword').oninput = check; $('resetcodein').oninput = check;
    for (const id of ['resetword', 'resetcodein']) $(id).onkeydown = (e) => e.stopPropagation();
    check();
    $('resetcancel').onclick = () => { this.ui.close(); this.ui.toast('Reset cancelled — nothing changed'); };
    go.onclick = () => {
      if (go.disabled) return;
      const island = $('resetisland').checked;
      if (!window.confirm(`Last chance: wipe the entire world${island ? ' and make a new island' : ''} for everyone? This cannot be undone.`)) return;
      this.net.send({ t: 'reset_world', code: m.code, word: 'RESET', newIsland: island });
      go.disabled = true; go.textContent = 'Resetting…';
    };
    setTimeout(() => $('resetword').focus(), 30);
  }

  // Standing on a moving vehicle (hauler deck / its buildings): move with it.
  carryRider() {
    const r = this.ride;
    if (!r) return;
    const v = this.vehicleViews.get(r.vid);
    if (!v || v.yaw === undefined) { this.ride = null; return; }
    const p = this.player.pos;
    _rv.copy(r.l).applyQuaternion(v.q).add(v.pos);
    if (_rv.distanceTo(p) > 25) { this.ride = null; return; }
    p.copy(_rv);
    let dy = v.yaw - r.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.player.yaw += dy;
  }
  updateRide() {
    const p = this.player.pos, ph = this.physics;
    if (this.player.onGround) {
      const g = ph.groundAt(p.x, p.z, p.y + 0.1, 0.3, 0.2);
      const ref = ph.lastSurf?.ref;
      const vid = ref && Math.abs(g - p.y) < 0.35 ? (ref.kind === 'v' && ref.deck ? ref.id : ref.veh) : null;
      this.ride = vid ? { vid } : null;
    }
    if (this.ride) {
      const v = this.vehicleViews.get(this.ride.vid);
      if (!v || v.yaw === undefined) { this.ride = null; return; }
      this.ride.l = (this.ride.l || new THREE.Vector3()).copy(p).sub(v.pos).applyQuaternion(_rq.copy(v.q).invert());
      this.ride.yaw = v.yaw;
    }
  }

  refreshBags() {
    this.bags = [];
    for (const e of this.structures.map.values()) if ((e.s.type === 'sleeping_bag' || e.s.type === 'bed') && e.s.o === this.pid) this.bags.push({ id: e.s.id, x: Math.round(e.s.x), z: Math.round(e.s.z) });
  }

  onSnap(m) {
    if (!this.ready && !this.world) return;
    this.entities.syncPlayers(m.pl);
    this.entities.syncAnimals(m.an);
    const seen = new Set();
    for (const a of m.ve) {
      seen.add(a[0]);
      let v = this.vehicleViews.get(a[0]);
      if (!v) { v = new VehicleView(this.scene, { id: a[0], type: a[1], var: a[14] }, this.world, this.physics); this.vehicleViews.set(a[0], v); this.physics.dynamic.push(...v.colliders); }
      v.setNet(a);
      // mobile-base structures on this vehicle: fetch them when our copy is out of date
      if (v.netDecRev !== v.decRev && performance.now() - (v.paintAt || -1e9) > 2000) { v.paintAt = performance.now(); this.net.send({ t: 'vpaint', id: a[0] }); }
      if (v.nAttached !== this.structures.countVehicle(a[0]) && performance.now() - (v.vstAt || -1e9) > 3000) { v.vstAt = performance.now(); this.net.send({ t: 'vst', id: a[0] }); }
      if (this.vehicle && this.vehicle.id === a[0] && this.vehicle.sim) { this.vehicle.sim.fuel = a[11]; v.hp = a[6]; }
    }
    for (const [id, v] of this.vehicleViews) if (!seen.has(id) && !(this.vehicle && this.vehicle.id === id)) {
      v.dispose(); this.vehicleViews.delete(id);
      this.physics.dynamic = this.physics.dynamic.filter((c) => !v.colliders.includes(c));
      this.structures.removeVehicle(id);
    }
  }

  onFx(m) {
    const cam = this.camera.position;
    if (m.k === 'throw') { this.held.showThrown(m.a, m.v, m.dur); return; }
    if (m.k === 'spray') { if (cam.distanceTo(new THREE.Vector3(...m.p)) < 30) audio.spray(); return; }
    if (m.k === 'shot') {
      const p = this.entities.players.get(m.pid);
      const o = p ? new THREE.Vector3(p.pos.x, p.pos.y + 1.45, p.pos.z) : new THREE.Vector3(...m.o);
      const dist = cam.distanceTo(o);
      audio.shot(m.w, dist);
      const rocket = !!ITEMS[m.w]?.gun?.blast;
      for (const e of m.e || []) {
        const end = new THREE.Vector3(e[0], e[1], e[2]);
        if (rocket) { this.held.launchRocket(o, end); continue; }
        this.effects.tracer(o, end);
        this.effects.burst(end, { count: 3, color: 0xccbb99, speed: 2, size: 0.05, life: 0.4 });
      }
      if (m.w !== 'bow') this.effects.flash(o, 3);
      if (p) p.shotT = 0.12;
    } else if (m.k === 'swing') { const p = this.entities.players.get(m.pid); if (p) p.swingT = 0.45; }
    else if (m.k === 'expl') {
      const pos = new THREE.Vector3(...m.p);
      this.effects.explosion(pos, m.r);
      const d = cam.distanceTo(pos);
      audio.explosion(d);
      this.effects.shake = Math.min(1.5, this.effects.shake + 30 / (d + 5));
      if (m.id) this.entities.removeExplosive(m.id);
    } else if (m.k === 'upgrade') this.effects.burst(new THREE.Vector3(...m.p), { count: 25, color: TIERS[m.tier]?.color ?? 0xaaaaaa, speed: 3, size: 0.12, life: 0.9, jitter: 2 });
    else if (m.k === 'door') audio.door();
    else if (m.k === 'dig') {
      const p = new THREE.Vector3(...m.p);
      this.effects.burst(p, { count: 14, color: m.up ? 0x7a6040 : this.world.surface(p.x, p.z).dust, speed: 3.5, up: 1.6, size: 0.12, life: 0.9, gravity: 12 });
      this.effects.burst(p, { count: 4, color: 0x5a4632, speed: 1, up: 1, size: 0.35, life: 1.4, gravity: -0.5, grow: 1, drag: 1.5 });
      audio.dig(cam.distanceTo(p));
    }
    else if (m.k === 'bite') audio.growl();
  }

  // ------------------------------------------------------------------ vehicles
  onSeat(m) {
    if (!m.id) { if (this.vehicle) this.leaveVehicleLocal(); return; }
    let view = this.vehicleViews.get(m.id);
    if (!view) { view = new VehicleView(this.scene, { id: m.id, type: m.v.type, var: m.v.var }, this.world, this.physics); this.vehicleViews.set(m.id, view); this.physics.dynamic.push(...view.colliders); }
    const veh = { id: m.id, seat: m.seat, view, sim: null, camMode: this.settings.vcam || 'third' };
    if (m.seat === 0) {
      const sim = new VehicleSim(m.v.type, this.world, this.physics);
      sim.setState(m.v.p, m.v.q, m.v.vel);
      sim.fuel = m.v.fuel; sim.ignore = view.collider.ref;
      view.hp = m.v.hp;
      veh.sim = sim;
    }
    this.vehicle = veh;
    this.camOrbit.yaw = 0;
    this.engine = audio.engine();
    this.ui.toast(m.seat === 0 ? `Driving ${VEHICLES[m.v.type].name}` : 'You are a passenger');
  }
  leaveVehicleLocal() {
    const v = this.vehicle;
    if (!v) return;
    this.engine?.stop(); this.engine = null;
    this.vehicle = null;
    this.ui.vehicleHud(null);
    // place player beside the vehicle
    const def = VEHICLES[v.view.type];
    const seat = def.seats[v.seat] || [0, 0, 0];
    const side = seat[0] < 0 ? -1 : 1;
    const tryPos = (sx) => {
      const p = new THREE.Vector3(sx * (def.half[0] + 0.9), 0, seat[2]).applyQuaternion(v.view.q).add(v.view.pos);
      p.y = this.physics.groundAt(p.x, p.z, p.y + 2, 3) + 0.05;
      const list = this.physics.query(p.x, p.z, 1);
      const blocked = list.some((c) => !c.ghost && c.ref !== v.view.collider.ref && (c.t === 'box' ? Math.abs(c.y - p.y) < c.hy + 1 && Math.hypot(c.x - p.x, c.z - p.z) < Math.max(c.hx, c.hz) : Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.4 && p.y < c.y + c.h));
      return blocked ? null : p;
    };
    const p = tryPos(side) || tryPos(-side) || v.view.pos.clone().add(new THREE.Vector3(0, def.half[1] + 0.6, 0));
    this.player.pos.copy(p); this.player.vel.set(0, 0, 0);
    if (v.sim) { v.view.vel.copy(v.sim.vel); v.view.tPos.copy(v.sim.pos); v.view.tQ.copy(v.sim.q); v.view.interp = null; }
    return p;
  }
  exitVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    if (v.sim) this.sendVehicleState(true);
    const p = this.leaveVehicleLocal();
    this.net.send({ t: 'v_exit', p: [p.x, p.y, p.z] });
  }
  sendVehicleState(force) {
    const v = this.vehicle;
    if (!v || !v.sim) return;
    const s = v.sim;
    this.net.send({ t: 'v_state', p: [s.pos.x, s.pos.y, s.pos.z], q: [s.q.x, s.q.y, s.q.z, s.q.w], v: [s.vel.x, s.vel.y, s.vel.z], s: s.steer, r: s.rpm, th: force ? 0 : s.throttle });
  }
  updateVehicle(dt, active) {
    const v = this.vehicle, input = this.input, def = VEHICLES[v.view.type];
    if (v.sim) {
      const k = (c) => active && input.down(c);
      const inp = { throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), steer: (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0), handbrake: k('Space') };
      v.sim.step(dt, inp);
      if (active && input.hit('KeyR') && v.sim.vel.length() < 3) v.sim.flip();
      this.timers.vstate -= dt;
      if (this.timers.vstate <= 0) { this.timers.vstate = 1 / 15; this.sendVehicleState(); }
      // crashes
      this.timers.crash -= dt;
      if (v.sim.maxImpact > 7.5 && this.timers.crash <= 0) {
        const dmg = (v.sim.maxImpact - 7.5) ** 2 * def.mass / 350;
        this.net.send({ t: 'v_crash', dmg });
        this.effects.shake = Math.min(1.2, this.effects.shake + dmg / 150);
        audio.hitStruct();
        this.timers.crash = 0.5;
      }
      v.sim.maxImpact = 0;
      // run over players & animals
      const s = v.sim, spd = s.vel.length();
      if (spd > 4) {
        const qi = s.q.clone().invert();
        const check = (kind, id, pos) => {
          const l = pos.clone().sub(s.pos).applyQuaternion(qi);
          if (Math.abs(l.x) < def.half[0] + 0.5 && Math.abs(l.z) < def.half[2] + 0.5 && l.y > -def.half[1] - 2 && l.y < def.half[1] + 0.5) {
            const key = kind + id, t = performance.now();
            if ((this.hitCooldown.get(key) || 0) > t) return;
            this.hitCooldown.set(key, t + 1000);
            this.net.send({ t: 'v_hit', k: kind, id, spd });
            s.vel.multiplyScalar(0.85);
            this.effects.burst(pos.clone().add(new THREE.Vector3(0, 1, 0)), { count: 14, color: 0x8a1010, speed: 4, size: 0.08 });
          }
        };
        for (const p of this.entities.players.values()) if (!(p.flags & 4) && p.pos.distanceTo(s.pos) < 6) check('p', p.pid, p.pos);
        for (const a of this.entities.animals.values()) if (a.pos.distanceTo(s.pos) < 6) check('a', a.id, a.pos);
      }
      // wheel effects
      for (const wh of s.wheels) {
        if (!wh.contact) continue;
        const sp = Math.abs(wh.spinV * def.wheelR);
        const rate = (sp > 3 ? 0.25 : 0) + wh.slip * 1.5;
        if (Math.random() < rate * dt * 30) {
          if (wh.water) this.effects.burst(wh.point, { count: 3, color: 0xcfe6f5, speed: 2 + sp * 0.2, up: 2, size: 0.12, life: 0.7 });
          else this.effects.burst(wh.point, { count: 1, color: wh.surf.dust, speed: 1 + sp * 0.1, up: 1.2, size: wh.surf.name === 'mud' ? 0.12 : 0.25, life: wh.surf.name === 'snow' ? 1.0 : 1.6, gravity: wh.surf.name === 'mud' ? 9 : 0.5, drag: 1.2, grow: wh.surf.name === 'mud' ? 0 : 1.2 });
        }
      }
      if (s.inWater > 0.05 && Math.random() < s.vel.length() * dt * 0.8) this.effects.burst({ x: s.pos.x, y: 0.1, z: s.pos.z }, { count: 6, color: 0xdff0ff, speed: 3, up: 2, size: 0.15, life: 0.8, jitter: 2 });
      this.ui.vehicleHud({ speed: s.speed, fuel: s.fuel, fuelCap: def.fuelCap, hp: v.view.hp, maxHp: def.hp, engineOk: s.engineOk });
      this.engine?.set(s.rpm, Math.abs(s.throttle));
    } else {
      this.ui.vehicleHud({ speed: v.view.vel.length(), fuel: v.view.fuel, fuelCap: def.fuelCap, hp: v.view.hp, maxHp: def.hp });
      this.engine?.set(v.view.rpm || 0, v.view.driver ? 0.4 : 0);
    }
    // player follows seat
    const seat = def.seats[v.seat] || [0, 0.5, 0];
    const seatW = new THREE.Vector3(seat[0], seat[1], seat[2]).applyQuaternion(v.view.q).add(v.view.pos);
    this.player.pos.copy(seatW);
    if (active && input.hit('KeyV')) { v.camMode = v.camMode === 'third' ? 'first' : 'third'; this.settings.vcam = v.camMode; localStorage.setItem('or_settings', JSON.stringify(this.settings)); }
    if (active && input.hit('KeyE')) this.exitVehicle();
  }
  vehicleCamera(dt) {
    const v = this.vehicle, def = VEHICLES[v.view.type], cam = this.camera;
    const sens = this.settings.sens * 0.0022;
    if (this.input.locked && !this.ui.open) { this.camOrbit.yaw -= this.input.mouse.dx * sens; this.camOrbit.pitch = Math.max(-1.2, Math.min(1.3, this.camOrbit.pitch + this.input.mouse.dy * sens * (v.camMode === 'third' ? 1 : -1))); }
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.view.q);
    const heading = Math.atan2(fwd.x, fwd.z);
    if (v.camMode === 'first') {
      const seat = def.seats[v.seat];
      cam.position.copy(new THREE.Vector3(seat[0], seat[1] + 0.7, seat[2]).applyQuaternion(v.view.q).add(v.view.pos));
      const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.camOrbit.pitch * 0.8, Math.PI + this.camOrbit.yaw, 0, 'YXZ'));
      cam.quaternion.copy(v.view.q).multiply(look);
      this.player.yaw = heading + Math.PI + this.camOrbit.yaw;
    } else {
      const dist = 4 + def.half[2] * 1.6;
      const yaw = heading + Math.PI + this.camOrbit.yaw;
      const pitch = this.camOrbit.pitch;
      const target = v.view.pos.clone().add(new THREE.Vector3(0, def.half[1] + 1.2, 0));
      const want = target.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist));
      const gy = this.world.ground(want.x, want.z) + 0.6;
      if (want.y < gy) want.y = gy;
      if (!this.vcamPos || this.vcamPos.distanceTo(want) > 30) this.vcamPos = want.clone();
      this.vcamPos.lerp(want, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.vcamPos);
      cam.lookAt(target);
      this.player.yaw = yaw + Math.PI;
    }
    if (this.effects.shake > 0) { cam.position.x += (Math.random() - 0.5) * this.effects.shake * 0.15; cam.position.y += (Math.random() - 0.5) * this.effects.shake * 0.15; }
  }

  // own body is only visible when driving with the chase camera
  updateAvatar() {
    const v = this.vehicle, a = this.avatar;
    a.visible = !!(v && v.camMode === 'third');
    if (!a.visible) return;
    const def = VEHICLES[v.view.type], s = def.seats[v.seat] || [0, 0.5, 0];
    a.position.copy(new THREE.Vector3(s[0], s[1] - 0.45, s[2]).applyQuaternion(v.view.q).add(v.view.pos));
    a.quaternion.copy(v.view.q);
    poseHumanoid(a.userData, { mode: v.seat === 0 ? 'drive' : 'sit', turn: (v.sim ? v.sim.steer : v.view.steer) * 4, t: performance.now() / 1000 }, 1 / 60);
  }

  // ------------------------------------------------------------------ interaction
  interact(active) {
    if (this.vehicle) return;
    const cam = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = this.physics.raycast(cam, dir, 3.6, this.entities.playerTargets(), {});
    const E = active && this.input.hit('KeyE');
    let text = '', target = '';
    if (hit) {
      if (hit.kind === 'n') {
        const node = hit.ref.node, def = NODES[node.type];
        if (def.kind === 'pick') { text = `<kbd>E</kbd> Pick up ${{ hemp: 'Hemp (cloth)', berry: 'Berries', loose_rock: 'Rock', branch: 'Branch (wood)' }[node.type]}`; if (E) this.net.send({ t: 'pick', id: node.id }); }
        else {
          const f = this.nodeFrac.get(node.id);
          const nm = { tree: 'Tree', ore: node.type === 'rock_metal' ? 'Metal Ore' : node.type === 'rock_sulfur' ? 'Sulfur Ore' : 'Stone', barrel: 'Barrel' }[def.kind];
          target = `${nm}${f !== undefined ? `<div class="tbar"><div style="width:${f * 100}%"></div></div>` : ''}`;
        }
      } else if (hit.kind === 'l') {
        const l = this.entities.loot.get(hit.id)?.data;
        if (l) {
          if (l.item) {
            text = `<kbd>E</kbd> Pick up ${ITEMS[l.item].name}`;
            if (E) this.net.send({ t: 'take', id: l.id });
          } else {
            const name = l.kind === 'crate' ? ['', 'Supply Crate', 'Military Crate', 'Elite Crate'][l.tier] : l.kind === 'corpse' ? `${ANIMALS[l.an]?.name || 'Animal'} corpse` : 'Backpack';
            text = `<kbd>E</kbd> Loot ${name}${l.empty ? ' (empty)' : ''}`;
            if (E) this.net.send({ t: 'open', id: l.id });
          }
        }
      } else if (hit.kind === 's') {
        const s = this.structures.map.get(hit.id)?.s;
        if (s) {
          if (s.k === 'door') { text = `<kbd>E</kbd> ${s.open ? 'Close' : 'Open'} door`; if (E) this.net.send({ t: 'use', id: s.id }); }
          else if (ITEMS[s.type]?.deploy?.slots && !['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3'].includes(s.type)) { text = `<kbd>E</kbd> Open ${ITEMS[s.type].name}`; if (E) this.net.send({ t: 'open', id: s.id }); }
          else if (s.type === 'tool_cupboard') { const authed = s.auth?.includes(this.pid); text = `<kbd>E</kbd> ${authed ? 'Deauthorize' : 'Authorize'} at Tool Cupboard <small>(${s.auth?.length || 0} authorized)</small>`; if (E) this.net.send({ t: 'use', id: s.id }); }
          else if (s.type === 'sleeping_bag' || s.type === 'bed') { const nm = s.type === 'bed' ? 'bed' : 'sleeping bag'; text = s.o === this.pid ? `Your ${nm} (respawn point)` : `<kbd>E</kbd> Claim ${nm}`; if (E && s.o !== this.pid) this.net.send({ t: 'use', id: s.id }); }
          else if (['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3'].includes(s.type)) { text = `<kbd>E</kbd> Use ${ITEMS[s.type].name}`; if (E) this.net.send({ t: 'open', id: s.id }); }
          else if (s.k === 'deploy') { text = `${ITEMS[s.type]?.name}`; }
          else if (s.k === 'piece') target = `${TIERS[s.tier].name} ${PIECES[s.type].name}<div class="tbar"><div style="width:${(s.hp / s.mhp) * 100}%"></div></div>`;
        }
      } else if (hit.kind === 'v') {
        const v = this.vehicleViews.get(hit.id);
        if (v) {
          const def = VEHICLES[v.type];
          if (v.broken) {
            const needs = v.needs ? Object.entries(v.needs).map(([k, n]) => `${n}× ${ITEMS[k].name} (have ${countItem(this.inv, k)})`).join(', ') : '';
            text = `<b>Broken ${def.name}</b><br>Needs: ${needs}<br><kbd>E</kbd> Install parts`;
            if (E) this.net.send({ t: 'v_repair', id: v.id });
          } else if (def.deck && hit.col !== v.colliders[1]) {
            target = `${def.name} deck${v.nAttached ? '' : ' — build on it with the Building Plan'}`;
          } else {
            text = `<b>${def.name}</b> ⛽ ${v.fuel}/${def.fuelCap} · 🔧 ${v.hp}/${def.hp}<br><kbd>E</kbd> ${v.driver ? 'Ride as passenger' : 'Drive'} · <kbd>G</kbd> Refuel (${countItem(this.inv, 'fuel')} fuel)${v.hp < def.hp ? ' · <kbd>H</kbd> Patch with metal' : ''}`;
            if (E) this.net.send({ t: 'v_enter', id: v.id });
            if (active && this.input.hit('KeyG')) this.net.send({ t: 'v_fuel', id: v.id });
            if (active && this.input.hit('KeyH')) this.net.send({ t: 'v_repair', id: v.id });
          }
        }
      } else if (hit.kind === 'p') {
        const p = this.entities.players.get(hit.id);
        if (p) target = `${p.name}${p.flags & 2 ? ' 💤 (sleeping)' : ''}`;
      }
    }
    if (!text && this.player.pos.y < 0.2 && this.world.ground(this.player.pos.x, this.player.pos.z) < 0.2) text = '<kbd>F</kbd> Drink water';
    if (this.lastStructHit && performance.now() - this.lastStructHit.t < 1500) target = `Structure ${this.lastStructHit.hp}/${this.lastStructHit.mhp}`;
    if (!this.input.locked && !this.ui.open) text = 'Click to play';
    const it = this.inv[this.sel];
    const d = it && ITEMS[it.id];
    if (!d || !(d.plan || d.deploy || d.door || d.tool?.hammer || d.spray || d.explosive || d.cat === 'food' || d.cat === 'medical') || text) this.ui.prompt(text);
    this.ui.target(target);
    if (active && this.input.hit('KeyF')) this.net.send({ t: 'drink' });
  }

  onKey(code, e) {
    if (!this.ready) return;
    const ui = this.ui;
    if (ui.open === 'death' || ui.open === 'chat') return;
    if (code === 'Tab' || code === 'KeyQ' || code === 'KeyI') { if (ui.open === 'inv') ui.close(); else if (!ui.open) ui.show('inv'); }
    else if (code === 'KeyM') { if (ui.open === 'map') ui.close(); else if (!ui.open) ui.show('map'); }
    else if (code === 'KeyL') { if (ui.open === 'clan') ui.close(); else if (!ui.open) ui.show('clan'); }
    else if (code === 'Escape') { if (ui.open && ui.open !== 'pause') ui.close(); }
    else if ((code === 'Enter' || code === 'KeyT') && !ui.open) { e?.preventDefault(); this.input.unlock(); ui.openChat(); }
    else if (code === 'KeyB' && ui.open === 'build') ui.close();
    else if (code === 'KeyR' && ui.open === 'paint') ui.close();
  }

  // ------------------------------------------------------------------ main loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.ready) {
      this.terrain.update(this.player.pos.x, this.player.pos.z, 40);
      // only the ground around you has to exist before you can play; the rest streams in while you walk
      const near = this.terrain.nearReady(this.player.pos.x, this.player.pos.z, 1);
      $('loadpct').textContent = near ? '100%' : Math.min(95, Math.round((now - this.loadStart) / 30)) + '%';
      this.sky.update(this.day, this.camera.position, 0, this.settings.viewDist);
      if (near || now - this.loadStart > 6000) {
        this.ready = true;
        $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
        this.player.pos.y = Math.max(this.player.pos.y, this.physics.groundAt(this.player.pos.x, this.player.pos.z, this.player.pos.y + 50, 100) + 0.1);
        this.input.lock();
        this.ui.renderHotbar(); this.ui.renderStats(this.stats);
        if (this.pendingNote) { this.ui.chat('', this.pendingNote); this.pendingNote = null; }
        this.ui.chat('', 'You wake up with nothing. Look for a loose rock on the ground and press E to pick it up, then hit trees and boulders. Craft tools with Tab and build a base before night falls. Press M for the map.');
        if (this.pendingDeath || !this.alive) { const m = this.pendingDeath || { by: 'unknown', bags: [] }; this.ui.death(m.by, m.bags); }
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const input = this.input;
    const active = input.locked && !this.ui.open && this.alive;
    this.day = (this.day + dt / this.dayLen) % 1;
    // hotbar
    if (active && !this.vehicle) {
      for (let i = 0; i < 6; i++) if (input.hit('Digit' + (i + 1))) this.sel = i;
      if (input.mouse.wheel) this.sel = (this.sel + input.mouse.wheel + 6) % 6;
    }
    if (this.sel !== this._lastSel) { this._lastSel = this.sel; this.ui.renderHotbar(); }
    if (this.vehicle) {
      this.updateVehicle(dt, active);
      this.held.vm.visible = false;
    } else {
      if (active) this.player.look(input.mouse.dx, input.mouse.dy, this.settings.sens);
      if (this.alive) { this.carryRider(); this.player.update(dt, input, active); this.updateRide(); }
      this.held.vm.visible = this.alive;
    }
    // vehicles
    const night = this.sky.dayLight < 0.35;
    for (const v of this.vehicleViews.values()) v.update(dt, this.vehicle?.id === v.id ? this.vehicle.sim : null, this.effects, night);
    this.structures.updateAttached(this.vehicleViews);
    // camera
    this.updateAvatar();
    if (this.vehicle) this.vehicleCamera(dt);
    else {
      this.player.applyCamera(this.camera);
      if (this.effects.shake > 0) { this.camera.rotation.x += (Math.random() - 0.5) * this.effects.shake * 0.03; this.camera.rotation.y += (Math.random() - 0.5) * this.effects.shake * 0.03; }
    }
    this.camera.updateMatrixWorld();
    if (!this.vehicle && this.alive) this.held.update(dt, input, active);
    else if (this.vehicle) { this.builder.hide(); }
    this.interact(active);
    // network state
    if (now - this.lastSend > 66) {
      this.lastSend = now;
      const p = this.player;
      this.net.send({ t: 'st', p: this.vehicle ? undefined : [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)], yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), cr: p.crouch ? 1 : 0, air: !p.onGround && !p.swimming ? 1 : 0, spr: p.sprinting ? 1 : 0, sel: this.sel, seq: this.tpSeq, on: this.ride && !this.vehicle ? this.ride.vid : undefined });
    }
    // world
    const cp = this.vehicle ? this.vehicle.view.pos : this.player.pos;
    this.terrain.update(cp.x, cp.z, 5);
    this.nature.update(dt, this.camera.position, cp, this.day, this.sky.dayLight, audio);
    this.structures.update(dt);
    this.entities.updatePlayers(dt, this.camera.position, this.vehicleViews);
    this.entities.updateAnimals(dt);
    this.entities.updateExplosives(dt, audio, this.camera.position);
    this.effects.update(dt);
    this.sky.update(this.day, this.camera.position, dt, this.settings.viewDist);
    // hud
    this.timers.reveal -= dt;
    if (this.timers.reveal <= 0) {
      this.timers.reveal = 1;
      this.ui.reveal(cp.x, cp.z);
      if (this.ui.open === 'map') this.ui.renderMap();
      if (this.ui.open === 'inv' && (!this.container || this.container.station)) this.ui.renderCrafting();
      const b = this.world.biome(cp.x, cp.z);
      const np = this.world.nearestPOI(cp.x, cp.z);
      const h = this.day * 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      this.ui.topbar(this.player.yaw, `${np && np.d < 200 ? np.poi.name + ' · ' : ''}${BIOME_NAMES[b]} · ${Math.round(cp.x)}, ${Math.round(cp.z)}`, `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}${night ? ' 🌙' : ' ☀️'}`);
      this.ui.renderQueue(this.queue.map((q) => ({ ...q, left: Math.max(0, q.left - (now - (q._t || (q._t = now))) / 1000) })));
    }
    this.timers.save -= dt;
    if (this.timers.save <= 0) { this.timers.save = 30; this.ui.saveExplored(); }
    // compass while not in vehicle updates every frame for smoothness
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }
}

// ------------------------------------------------------------------ menu
const game = new Game();
$('menucontrols').innerHTML = CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd> ${v}</div>`).join('');
const creator = new Creator((look) => (game.look = look));
game.look = creator.look;
document.addEventListener('mousedown', () => audio.resume());
document.addEventListener('keydown', () => audio.resume());
window.__game = game;
$('nameinput').value = localStorage.getItem('or_name') || '';
const play = async () => {
  const name = $('nameinput').value.trim() || 'Survivor';
  const pass = $('passinput').value;
  $('playbtn').disabled = true;
  $('menustatus').textContent = '';
  game.onEnter = () => creator.dispose();
  try { await game.start(name, pass); } catch (e) { $('menustatus').textContent = 'Could not connect to the server — it may be waking up, try again in a few seconds.'; $('playbtn').disabled = false; console.error(e); }
};
$('playbtn').onclick = play;
$('nameinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
$('passinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
if (sessionStorage.getItem('or_autoplay') && localStorage.getItem('or_name')) { sessionStorage.removeItem('or_autoplay'); play(); }
