// Odyssey Rush client entry point: wires networking, world streaming, player, vehicles and UI.
import * as THREE from 'three';
import { World, BIOME_NAMES, chunkKey, CHUNK } from '/shared/worldgen.js';
import { ITEMS, NODES, ANIMALS, INV_SIZE } from '/shared/items.js';
import { VEHICLES, VEHICLE_ENTER_RANGE } from '/shared/vehicles.js';
import { PIECES, TIERS, rotY } from '/shared/building.js';
import { Physics } from './physics.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Effects } from './effects.js';
import { Entities } from './entities.js';
import { Structures } from './structures.js';
import { VehicleSim, VehicleView } from './vehicles.js';
import { BoatSim } from './boats.js';
import { SubSim } from './subs.js';
import { Player } from './player.js';
import { Builder } from './building.js';
import { Painter } from './painter.js';
import { Nature } from './nature.js';
import { Gunsmith } from './gunsmith.js';
import { Caves, CAVE_ZONE, CAVE_TOP, LAVA_Y, layerAt } from '/shared/caves.js';
import { CaveWorld } from './caves3d.js';
import { Weather } from './weather.js';
import { Footprints } from './footprints.js';
import { IceView } from './ice.js';
import { SeaLife } from './sealife.js';
import { Fishing } from './fishing.js';
import { Home, deviceId } from './home.js';
import { FloodView } from './flood.js';
import { IceField, BREATH_MAX, ICE_TOP } from '/shared/ice.js';
import { SEASON } from './season.js';
import { seasonInfo, SEASON_NAMES, SEASON_ICONS } from '/shared/season.js';
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
    const srv = this.home?.sel || { id: 'main' };
    this.serverSel = srv;
    this.net.send({ t: 'hello', token, name, look: this.look, pass: pass || undefined, server: srv.id, spw: this.home?.spw || undefined, devToken: deviceId() });
  }

  initWorld(seed) {
    this.seed = seed;
    this.world = new World(seed);
    for (const [ix, iz, v] of this.pendingTerr || []) this.world.setMod(ix, iz, v);
    this.physics = new Physics(this.world);
    this.caves = new Caves(seed); this.caves.setMods(this.pendingCaveMods || []);
    this.physics.caves = this.caves;
    this.caves.surface = (x, z) => this.world.ground(x, z);
    this.caves.seaAbove = (x, z) => this.world.ground(x, z) < -8 && !(this.iceField && this.iceField.inland(x, z));
    this.sky = new Sky(this.scene);
    this.sky.sun.castShadow = this.settings.shadows;
    this.effects = new Effects(this.scene);
    this.terrain = new Terrain(this.scene, this.world, this.physics); this.terrain.caves = this.caves;
    this.terrain.shadows = this.settings.shadows;
    this.terrain.setViewDist(this.settings.viewDist);
    this.structures = new Structures(this.scene, this.physics, this.effects);
    this.nature = new Nature(this.scene, this.world, this.physics);
    this.caveWorld = new CaveWorld(this.scene, this.caves, this.world);
    this.audio = audio;
    this.footprints = new Footprints(this.scene, this.world);
    this.iceField = new IceField(this.world); this.physics.ice = this.iceField;
    this.iceView = new IceView(this.scene, this.iceField, this.world);
    this.seaLife = new SeaLife(this.scene, this.world); this.seaLife.ice = this.iceField;
    this.floodView = new FloodView(this.scene); this.structures.flood = new Map(); this.hullHI = new Map();
    if (this.pendingIce) this.applyIce(this.pendingIce);
    this.weather = new Weather(this); this.weather.setDetail(this.settings.detail ?? 2);
    if (this.pendingWeather) this.weather.setState(this.pendingWeather);
    this.structures.onChange = (x, z) => this.nature.grass.invalidate(x, z);
    this.nature.setDetail(this.settings.detail ?? 2); this.terrain.setDetail(this.settings.detail ?? 2);
    this.entities = new Entities(this.scene, this.effects);
    this.player = new Player(this);
    this.ui = new UI(this);
    this.builder = new Builder(this);
    this.painter = new Painter(this);
    this.gunsmith = new Gunsmith(this);
    this.held = new Held(this);
    this.fishing = new Fishing(this);
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
    this.weather?.setDetail(v);
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
    n.on('weather', (m) => this.weather?.setState(m));
    n.on('bolt', (m) => this.weather?.bolt(m));
    n.on('cmod', (m) => { if (!this.caves) return; this.caves.addMod(...m.m); const r = Math.abs(m.m[3]); this.caveWorld.dirty(m.m[0], m.m[1], m.m[2], r); if (Math.abs(m.m[1] - this.world.ground(m.m[0], m.m[2])) < r + 2.5) { this.terrain.refreshHoles(m.m[0], m.m[2], r); this.nature.grass?.invalidate?.(m.m[0], m.m[2]); } });
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
    n.on('server', (m) => { this.serverInfo = m; this.rules = m.settings; });
    n.on('rules', (m) => { this.rules = { ...this.rules, ...m.rules }; if (m.dayLen) this.dayLen = m.dayLen; if (m.yearLen) this.yearLen = m.yearLen; if (m.day !== undefined) this.day = m.day; if (m.year !== undefined) this.year = m.year; this.ui.toast('⚙️ Server settings changed'); });
    n.on('authfail', (m) => {
      this.authFailed = true;
      $('menustatus').textContent = m.m;
      $('playbtn').disabled = false;
      $('passinput').focus();
    });
    n.on('welcome', (m) => {
      this.onEnter?.(); this.onEnter = null;
      this.pendingTerr = m.terr || []; this.pendingCaveMods = m.cm || []; this.pendingWeather = m.wx; this.pendingIce = m.ice;
      this.rules = { ...this.rules, ...(m.rules || {}) };
      this.pid = m.pid; this.day = m.day; this.tpSeq = m.seq || 0; this.dayLen = m.dayLen; this.year = m.year ?? 1.05; this.yearLen = m.yearLen || 4800;
      this.initWorld(m.seed);
      if (this.serverInfo) setTimeout(() => this.ui.toast(`🌍 ${this.serverInfo.name}${this.serverInfo.id !== 'main' ? ` — invite code ${this.serverInfo.code}` : ''}${this.rules?.creative ? ' · 🧱 creative' : ''}`), 1500);
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
      if (ev && ev.code === 4003) { this.input.unlock(); $('loading').classList.remove('hidden'); $('loading').firstElementChild.textContent = 'This server was deleted by its owner.'; return; }
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
    n.on('inv', (m) => { this.inv = m.inv; this.armor = m.armor; if (this.ui.open === 'inv') this.ui.renderInventory(); else this.ui.renderHotbar(); if (this.ui.open === 'gunsmith') this.gunsmith.render(); });
    n.on('stats', (m) => { const was = this.stats.lvl; if (m.br !== undefined && this.player && Math.abs(m.br - this.player.breath) > 2) this.player.breath = m.br; if (m.o2 !== undefined && this.player && Math.abs(m.o2 - (this.player.tank ?? 0)) > 3) this.player.tank = m.o2; this.stats = m; this.ui.renderStats(m); if (m.lvl > was && was) audio.craftDone(); });
    n.on('queue', (m) => { const done = this.queue.length > m.q.length; this.queue = m.q; this.ui.renderQueue(m.q); if (done) audio.craftDone(); });
    n.on('gain', (m) => { this.ui.gain(m.id, m.n); audio.pickup(); });
    n.on('toast', (m) => this.ui.toast(m.m));
    n.on('chat', (m) => this.ui.chat(m.from, m.m, m.clan));
    n.on('claninfo', (m) => { this.clanInfo = m; if (this.ui.open === 'clan') this.ui.renderClan(); });
    n.on('time', (m) => { this.day = m.day; if (m.year !== undefined) this.year = m.year; });
    n.on('v_reset', (m) => { const v = this.vehicle; if (v && v.id === m.id && v.sim) { v.sim.setState(m.p, m.q, [0, 0, 0]); v.sim.ang.set(0, 0, 0); } });
    n.on('tp', (m) => { this.ride = null; this.tpSeq = m.seq || 0; this.player.pos.set(m.p[0], m.p[1], m.p[2]); this.player.vel.set(0, 0, 0); });
    n.on('rg', (m) => {
      const rc = { s: new Set(), l: new Set(), d: new Set(m.d) };
      if (m.fp) this.footprints?.add(m.k, m.fp, true);
      this.regionContents.set(m.k, rc);
      for (const s of m.s) { this.structures.upsert(s); rc.s.add(s.id); }
      for (const l of m.l) { this.entities.addLoot(l, this.physics); rc.l.add(l.id); }
      for (const id of m.d) this.terrain.setDepleted(id, true);
      this.refreshBags();
    });
    n.on('rgu', (m) => {
      this.footprints?.drop(m.k);
      const rc = this.regionContents.get(m.k);
      if (!rc) return;
      for (const id of rc.s) this.structures.remove(id);
      for (const id of rc.l) this.entities.removeLoot(id, this.physics);
      for (const id of rc.d) this.terrain.setDepleted(id, false);
      this.regionContents.delete(m.k);
    });
    const regionOf = (x, z) => chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    n.on('fp', (m) => { if (m.p.length) this.footprints?.add(regionOf(m.p[0][0], m.p[0][1]), m.p); });
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
    n.on('terr', (m) => { this.terrain.applyMods(m.m); this.iceField?.cache.clear(); });
    n.on('ice', (m) => this.applyIce(m));
    n.on('flood', (m) => { this.structures.flood.set(m.bid, m.f || {}); this.hullHI.set(m.bid, m.hi); });
    n.on('fishbite', (m) => this.fishing?.onBite(m));
    n.on('fishres', (m) => this.fishing?.onResult(m));
    n.on('fx', (m) => this.onFx(m));
    n.on('ex', (m) => this.entities.addExplosive(m));
    n.on('v_seat', (m) => this.onSeat(m));
  }

  // Cave entrances near (x,z): dug shafts and mine adits
  caveEntrances(x, z) {
    const out = [];
    for (const e of this.structures.map.values()) if (e.s.type === 'shaft' && Math.hypot(e.s.x - x, e.s.z - z) < 160) out.push({ id: e.s.id, x: e.s.x, z: e.s.z });
    const np = this.world.nearestPOI(x, z);
    if (np && np.d < 300) for (const pr of this.world.poiLayout(np.poi).props) if (pr.k === 'cave') out.push({ id: 'poi:' + np.poi.id, x: pr.x, z: pr.z });
    return out;
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
    if (m.k === 'leak') { const pos = new THREE.Vector3(...m.p); if (cam.distanceTo(pos) < 50) { audio.creak?.(); audio.leak?.(); } return; }
    if (m.k === 'weld') { const pos = new THREE.Vector3(...m.p); this.effects.burst(pos, { count: 14, color: 0xfff0a0, speed: 4, size: 0.03, life: 0.3, glow: true }); audio.mine(); return; }
    if (m.k === 'creak') { audio.creak?.(); this.effects.shake = Math.min(1, this.effects.shake + 0.25); return; }
    if (m.k === 'icebreak') {
      const pos = new THREE.Vector3(...m.p), d = cam.distanceTo(pos);
      if (d < 120) { audio.iceCrack(true, d); if (d < 60) { this.effects.burst(pos, { count: 40, color: 0xe4f0f8, speed: 4.5, size: 0.11, life: 1.1, gravity: 9 }); this.effects.burst(pos, { count: 18, color: 0xbfdcec, speed: 2.5, size: 0.06, life: 0.8 }); } }
      return;
    }
    if (m.k === 'cavedig') { const pos = new THREE.Vector3(...m.p); if (cam.distanceTo(pos) < 40) { audio.mine(); this.effects.burst(pos, { count: 14, color: m.ore ? [0x6a645c, 0xc07a3a, 0xd8c040, 0x7fe8ff, 0x3aa080, 0xe890b0, 0xd8dce0, 0xf4f4ff, 0x3a70ff][m.ore] : [0x5c4530, 0x8c5c38, 0x75706a, 0x484a52][m.layer || 0], speed: 3.5, size: 0.08, life: 0.8, gravity: 9 }); } return; }
    if (m.k === 'gunmod') { audio.click(); return; }
    if (m.k === 'throw') { this.held.showThrown(m.a, m.v, m.dur); return; }
    if (m.k === 'spray') { if (cam.distanceTo(new THREE.Vector3(...m.p)) < 30) audio.spray(); return; }
    if (m.k === 'shot') {
      const p = this.entities.players.get(m.pid);
      const o = p ? new THREE.Vector3(p.pos.x, p.pos.y + 1.45, p.pos.z) : new THREE.Vector3(...m.o);
      const dist = cam.distanceTo(o);
      audio.shot(m.q ? 'quiet' : m.w, dist);
      const rocket = !!ITEMS[m.w]?.gun?.blast;
      for (const e of m.e || []) {
        const end = new THREE.Vector3(e[0], e[1], e[2]);
        if (rocket) { this.held.launchRocket(o, end); continue; }
        this.effects.tracer(o, end);
        this.effects.burst(end, { count: 3, color: 0xccbb99, speed: 2, size: 0.05, life: 0.4 });
      }
      if (m.w !== 'bow' && !m.q) this.effects.flash(o, 3);
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
    else if (m.k === 'bite') { if (this.entities.animals.get(m.id)?.type === 'shark') { audio.hitFlesh(); audio.splash(0.3); } else audio.growl(); }
  }

  // ------------------------------------------------------------------ vehicles
  onSeat(m) {
    if (!m.id) { if (this.vehicle) this.leaveVehicleLocal(); return; }
    let view = this.vehicleViews.get(m.id);
    if (!view) { view = new VehicleView(this.scene, { id: m.id, type: m.v.type, var: m.v.var }, this.world, this.physics); this.vehicleViews.set(m.id, view); this.physics.dynamic.push(...view.colliders); }
    const veh = { id: m.id, seat: m.seat, view, sim: null, camMode: this.settings.vcam || 'third' };
    if (m.seat === 0) {
      const vdef = VEHICLES[m.v.type];
      const sim = vdef.sub ? new SubSim(m.v.type, this.world, this.physics) : vdef.boat ? new BoatSim(m.v.type, this.world, this.physics) : new VehicleSim(m.v.type, this.world, this.physics);
      if (vdef.sub && m.v.sub) { view.subInfo = { crush: m.v.sub[0], thrust: m.v.sub[1], eff: m.v.sub[2], hull: m.v.sub[3] }; }
      sim.ice = this.iceField; sim.time = () => this.sky.waterUniforms.uTime.value;
      sim.setState(m.v.p, m.v.q, m.v.vel);
      sim.fuel = m.v.fuel; sim.ignore = view.collider.ref;
      view.hp = m.v.hp;
      veh.sim = sim;
    }
    this.vehicle = veh;
    this.camOrbit.yaw = 0;
    const vd = VEHICLES[m.v.type];
    this.engine = vd.boat && !vd.fuelCap ? null : audio.engine();
    this.ui.toast(m.seat === 0 ? `${vd.sub ? 'Piloting' : vd.boat ? 'Steering' : 'Driving'} ${vd.name}${vd.sub ? ' — W/S thrust · A/D turn · Space rise · Ctrl dive' : ''}` : 'You are a passenger');
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
      if (def.boat && p.y < -1.3) p.y = -1.3; // over the side into the water
      const list = this.physics.query(p.x, p.z, 1);
      const blocked = list.some((c) => !c.ghost && c.ref !== v.view.collider.ref && (c.t === 'box' ? Math.abs(c.y - p.y) < c.hy + 1 && Math.hypot(c.x - p.x, c.z - p.z) < Math.max(c.hx, c.hz) : Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.4 && p.y < c.y + c.h));
      return blocked ? null : p;
    };
    let p;
    if (def.interior) p = new THREE.Vector3(0, def.deck.y + 0.02, seat[2] - 1.4).applyQuaternion(v.view.q).add(v.view.pos);
    else if (def.sub && v.view.pos.y < -def.half[1]) p = new THREE.Vector3(def.half[0] + 1.1, 0, 0).applyQuaternion(v.view.q).add(v.view.pos);
    else p = tryPos(side) || tryPos(-side) || v.view.pos.clone().add(new THREE.Vector3(0, def.half[1] + 0.6, 0));
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
    this.net.send({ t: 'v_state', p: [s.pos.x, s.pos.y, s.pos.z], q: [s.q.x, s.q.y, s.q.z, s.q.w], v: [s.vel.x, s.vel.y, s.vel.z], s: s.steer, r: s.rpm, th: force ? 0 : s.throttle, vt: force ? 0 : s.vert || 0 });
  }
  updateVehicle(dt, active) {
    const v = this.vehicle, input = this.input, def = VEHICLES[v.view.type];
    if (v.sim) {
      const k = (c) => active && input.down(c);
      const inp = { throttle: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), steer: (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0), handbrake: k('Space') && !def.sub, rise: k('Space'), sink: k('ControlLeft') || k('KeyC') };
      if (def.sub && v.view.subInfo) v.sim.stats = v.view.subInfo;
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
      if (!def.boat && s.inWater > 0.05 && Math.random() < s.vel.length() * dt * 0.8) this.effects.burst({ x: s.pos.x, y: 0.1, z: s.pos.z }, { count: 6, color: 0xdff0ff, speed: 3, up: 2, size: 0.15, life: 0.8, jitter: 2 });
      if (def.boat && !s.stuck && s.speed > 0.5 && s.inWater > 0.5) {
        // bow spray and a foaming wake
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(s.q);
        if (Math.random() < s.speed * dt * 1.2) this.effects.burst({ x: s.pos.x + f.x * def.half[2], y: 0.15, z: s.pos.z + f.z * def.half[2] }, { count: 3, color: 0xeef6fb, speed: 1 + s.speed * 0.25, up: 1.5, size: 0.1, life: 0.6 });
        if (Math.random() < s.speed * dt * 1.5) this.effects.burst({ x: s.pos.x - f.x * def.half[2], y: 0.05, z: s.pos.z - f.z * def.half[2] }, { count: 2, color: 0xffffff, speed: 0.5, up: 0.3, size: 0.18, life: 1.4, gravity: 0 });
      }
      if (def.boat && !def.fuelCap && (Math.abs(s.throttle) > 0 || Math.abs(s.steer) > 0.1)) { this.timers.oar = (this.timers.oar || 0) - dt; if (this.timers.oar <= 0) { this.timers.oar = 1.3; audio.swimStroke(false); } }
      this.ui.vehicleHud({ speed: s.speed, fuel: s.fuel, fuelCap: def.fuelCap, hp: v.view.hp, maxHp: def.hp, engineOk: s.engineOk, stuck: s.stuck, power: def.power, depth: def.sub ? s.depth : undefined, crush: def.sub ? s.stats.crush : undefined });
      if (def.sub && active && input.hit('KeyU')) this.net.send({ t: 'open', id: 'vm:' + v.id });
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
      const vin = this.caves.inVolume(v.view.pos.x, v.view.pos.y, v.view.pos.z);
      if (want.y < gy && !vin) want.y = gy;
      if (vin && this.caves.rock(want.x, want.y, want.z) > 0) want.lerp(target, 0.7); // keep the camera out of the rock
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
          else if (ITEMS[s.type]?.deploy?.slots && !['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3', 'gunsmith', 'fabricator'].includes(s.type)) { text = `<kbd>E</kbd> Open ${ITEMS[s.type].name}`; if (E) this.net.send({ t: 'open', id: s.id }); }
          else if (s.type === 'tool_cupboard') { const authed = s.auth?.includes(this.pid); text = `<kbd>E</kbd> ${authed ? 'Deauthorize' : 'Authorize'} at Tool Cupboard <small>(${s.auth?.length || 0} authorized)</small>`; if (E) this.net.send({ t: 'use', id: s.id }); }
          else if (s.type === 'sleeping_bag' || s.type === 'bed') { const nm = s.type === 'bed' ? 'bed' : 'sleeping bag'; text = s.o === this.pid ? `Your ${nm} (respawn point)` : `<kbd>E</kbd> Claim ${nm}`; if (E && s.o !== this.pid) this.net.send({ t: 'use', id: s.id }); }
          else if (['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3', 'gunsmith', 'fabricator'].includes(s.type)) { text = `<kbd>E</kbd> Use ${ITEMS[s.type].name}`; if (E) this.net.send({ t: 'open', id: s.id }); }
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
          } else if (def.interior && hit.col.role === 'dock') {
            const kid = [...this.vehicleViews.values()].find((o) => o.dockedIn === v.id);
            text = kid ? `<b>Docking bay</b> — Mini Sub 🔋 ${kid.fuel}/${VEHICLES.minisub.fuelCap} · 🔧 ${kid.hp}/${VEHICLES.minisub.hp}<br><kbd>E</kbd> Climb in and launch it` : '<b>Docking bay</b> — empty. Drive a Mini Sub up under the hull here to dock it.';
            if (kid && E) this.net.send({ t: 'undock', id: v.id });
          } else if (def.interior && hit.col.role === 'engine') {
            text = `<b>${def.name} engine room</b> 🔋 ${v.fuel}/${def.fuelCap} · crush depth ${v.subInfo?.crush ?? def.depths[0]} m<br><kbd>U</kbd> Upgrade console (modules) · <kbd>G</kbd> Swap in power cells/batteries (${countItem(this.inv, 'power_cell')} cells, ${countItem(this.inv, 'battery')} 🔋)`;
            if (active && this.input.hit('KeyU')) this.net.send({ t: 'open', id: 'vm:' + v.id });
            if (active && this.input.hit('KeyG')) this.net.send({ t: 'v_fuel', id: v.id });
          } else if (def.interior && hit.col.role !== 'helm') {
            const inside = this.inSubInterior(this.player.pos);
            target = `${def.name}${inside ? (v.leaks?.length ? ` — ⚠️ ${v.leaks.length} hull leak${v.leaks.length > 1 ? 's' : ''}! Seal them with a Repair Tool` : ' — helm at the bow, docking bay amidships, engine room at the stern') : ' — swim under it to the hatch to climb in'}`;
          } else if (def.deck && !def.interior && hit.col !== v.colliders[1]) {
            target = `${def.name} deck${v.nAttached ? '' : ' — build on it with the Building Plan'}`;
          } else {
            text = def.power
              ? `<b>${def.name}</b> 🔋 ${v.fuel}/${def.fuelCap} · 🔧 ${v.hp}/${def.hp} · crush depth ${v.subInfo?.crush ?? def.depths[0]} m<br><kbd>E</kbd> ${def.interior ? 'Take the helm' : v.driver ? 'Ride along' : 'Pilot'} · <kbd>G</kbd> Insert batteries (${countItem(this.inv, 'battery')} 🔋 ${countItem(this.inv, 'power_cell')} cells) · <kbd>U</kbd> Module bay${v.hp < def.hp ? ' · <kbd>H</kbd> Patch' : ''}`
              : `<b>${def.name}</b> ⛽ ${v.fuel}/${def.fuelCap} · 🔧 ${v.hp}/${def.hp}<br><kbd>E</kbd> ${v.driver ? 'Ride as passenger' : 'Drive'} · <kbd>G</kbd> Refuel (${countItem(this.inv, 'fuel')} fuel)${v.hp < def.hp ? ' · <kbd>H</kbd> Patch with metal' : ''}`;
            if (def.power && active && this.input.hit('KeyU')) this.net.send({ t: 'open', id: 'vm:' + v.id });
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
    const pp = this.player.pos;
    if (!text && !this.vehicle && this.alive) {
      // the Pacific's floor hatch: climb in from below, drop out from inside
      for (const v of this.vehicleViews.values()) {
        const def = VEHICLES[v.type];
        if (!def.hatch || v.pos.distanceTo(pp) > 25) continue;
        const l = pp.clone().sub(v.pos).applyQuaternion(_rq.copy(v.q).invert()), I = def.interior, h = def.hatch;
        const near = Math.hypot(l.x - h.x, l.z - h.z);
        if (Math.abs(l.x) < I.hx && Math.abs(l.z) < I.hz && l.y > I.y0 - 0.3 && l.y < I.y1 && near < 0.9) {
          text = '<kbd>E</kbd> Exit through the hatch';
          if (E) { this.player.pos.copy(new THREE.Vector3(h.x, -def.half[1] - 1.9, h.z).applyQuaternion(v.q).add(v.pos)); this.player.vel.set(0, -1, 0); this.ride = null; audio.door(); audio.splash(0.4); }
          break;
        }
        if (l.y < -def.half[1] + 0.2 && l.y > -def.half[1] - 4.5 && near < 2.4) {
          text = '<kbd>E</kbd> Climb up through the hatch';
          if (E) { this.player.pos.copy(new THREE.Vector3(h.x - 1.5, I.y0 + 0.05, h.z).applyQuaternion(v.q).add(v.pos)); this.player.vel.set(0, 0, 0); audio.door(); }
          break;
        }
      }
    }
    if (!text && !this.vehicle && this.alive) {
      if (pp.y < CAVE_ZONE) { if (this.caveWorld.nearLadder(pp)) { text = '<kbd>E</kbd> Climb up the ladder'; if (E) this.net.send({ t: 'cave_exit' }); } }
      else { const ce = this.caveEntrances(pp.x, pp.z).find((e) => Math.hypot(e.x - pp.x, e.z - pp.z) < 5.5); if (ce) { text = '<kbd>E</kbd> Climb down into the caves'; if (E) this.net.send({ t: 'cave_enter' }); } }
    }
    if (!text && pp.y > CAVE_ZONE && pp.y < 0.2 && this.world.ground(pp.x, pp.z) < 0.2 && !this.player.dry && !this.player.underwater && !this.vehicle) text = '<kbd>F</kbd> Drink water';
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
  // the water line at a position: {top, inside} (top = -Infinity: no water, Infinity: flooded cave)
  waterAt(pos) {
    const sub = this.inSubInterior(pos);
    if (sub) { const I = VEHICLES[sub.type].interior, fl = sub.broken ? 99 : sub.flood || 0; return { inside: true, sub, top: fl > 0.02 ? sub.pos.y + I.y0 + fl : -Infinity }; }
    if (pos.y < 1 && pos.y > CAVE_ZONE) { const r = this.structures.roomAt(pos.x, pos.y + 0.2, pos.z); if (r) return { inside: true, room: r, top: r.level > 0.02 ? r.floorY + r.level : -Infinity }; }
    if (this.caves.inVolume(pos.x, pos.y, pos.z)) {
      if (this.caves.flooded(pos.x, pos.z)) return { inside: false, top: Infinity };
      const lk = this.caves.lakeLevel(pos.x, pos.z);
      if (pos.y < lk + 1) return { inside: false, top: lk, cave: true }; // an underground lake
      return { inside: false, top: -Infinity, lava: pos.y < LAVA_Y + 0.6 };
    }
    return { inside: false, top: 0 };
  }
  // hull readout while you're inside a sealed space
  hullHud(Wc) {
    let txt = '';
    if (Wc.room) {
      const hi = this.hullHI.get(Wc.room.b.id), lvl = Wc.room.level;
      if (hi !== undefined) txt = `<span style="color:${hi < 0 ? '#ff6a4a' : hi < 3 ? '#ffc04a' : '#9fe0ff'}">🛡️ Hull integrity ${hi.toFixed(1)}</span>`;
      const leaks = Wc.room.room.shell.reduce((n, q) => n + (q.lk?.length || 0), 0);
      if (leaks) txt += ` · <span style="color:#ff6a4a">💦 ${leaks} leak${leaks > 1 ? 's' : ''}</span>`;
      if (lvl > 0.02) txt += ` · 🌊 ${Math.round((lvl / 3) * 100)}% flooded`;
    } else if (Wc.sub) {
      const v = Wc.sub;
      txt = `🛳️ ${VEHICLES[v.type].name} · 🔋 ${v.fuel} · 🔧 ${v.hp}/${VEHICLES[v.type].hp}`;
      if (v.leaks?.length) txt += ` · <span style="color:#ff6a4a">💦 ${v.leaks.length} leak${v.leaks.length > 1 ? 's' : ''}</span>`;
      if ((v.flood || 0) > 0.02) txt += ` · 🌊 ${Math.round((v.flood / 3.8) * 100)}% flooded`;
    }
    if (txt !== this._hullTxt) { this._hullTxt = txt; $('hullhud').innerHTML = txt; $('hullhud').classList.toggle('hidden', !txt); }
  }
  // clip volumes for the sea surface: sub hulls and air-filled rooms near the camera
  updateClips() {
    const cam = this.camera.position, list = [];
    for (const v of this.vehicleViews.values()) {
      const def = VEHICLES[v.type];
      if (!def.sub || v.pos.distanceTo(cam) > 150) continue;
      const I = def.interior, half = I ? [I.hx, (I.y1 - I.y0) / 2 + 0.1, I.hz] : [def.half[0] * 0.85, def.half[1] * 0.85, def.half[2] * 0.85];
      const c = I ? new THREE.Vector3(0, (I.y0 + I.y1) / 2, 0).applyQuaternion(v.q).add(v.pos) : v.pos.clone();
      list.push({ pos: c, quat: v.q, half, d: c.distanceTo(cam) });
    }
    for (const b of this.structures.buildings.values()) {
      if (Math.abs(b.x - cam.x) > 60 || Math.abs(b.z - cam.z) > 60 || b.y > 3) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      for (const r of this.structures.roomsOf(b)) for (const k of r.cells) {
        const [gx, gz, L] = k.split(',').map(Number), [dx, dz] = rotY(gx * 1.5, gz * 1.5, b.yaw);
        const c = new THREE.Vector3(b.x + dx, b.y + L * 3 + 1.5, b.z + dz);
        if (c.y - 1.5 > 0.5) continue;
        list.push({ pos: c, quat: q, half: [1.5, 1.5, 1.5], d: c.distanceTo(cam) });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this.clipBoxes = list.slice(0, 8);
    this.sky.setWaterClips(this.clipBoxes);
  }
  // inside the big sub's hull (dry, breathable)
  inSubInterior(pos) {
    for (const v of this.vehicleViews.values()) {
      const I = VEHICLES[v.type].interior;
      if (!I || Math.abs(v.pos.x - pos.x) > 12 || Math.abs(v.pos.z - pos.z) > 12) continue;
      const l = _rv.copy(pos).sub(v.pos).applyQuaternion(_rq.copy(v.q).invert());
      if (Math.abs(l.x) < I.hx && Math.abs(l.z) < I.hz && l.y > I.y0 - 0.3 && l.y < I.y1) return v;
    }
    return null;
  }
  applyIce(m) {
    const t = performance.now() / 1000;
    this.iceField.setFrozen(!!m.f);
    this.iceField.setHoles((m.h || []).map(([id, x, z, r, age]) => ({ id, x, z, r, born: t - age })));
  }
  // under the surface: murky green-blue fog that darkens with depth (and under the ice), the water's
  // surface seen from below, muffled sound, a breath bar
  underwaterView(dt) {
    const cam = this.camera.position, p = this.player;
    // where is the camera: in the sea, in a flooded cave, or inside a sealed space (a room, the Pacific, a sub's cockpit)
    const cockpit = this.vehicle && VEHICLES[this.vehicle.view.type].sub;
    const Wc = cockpit ? { inside: true, top: -Infinity } : this.waterAt(cam.clone().setY(cam.y - 1.0));
    const caveWet = !Wc.inside && Wc.top === Infinity;
    const inVol = this.caves.inVolume(cam.x, cam.y, cam.z);
    const seaOutside = inVol ? this.caves.flooded(cam.x, cam.z) : cam.y < -0.04 && this.world.ground(cam.x, cam.z) < cam.y;
    const inWater = Wc.inside ? cam.y < Wc.top : caveWet || seaOutside || (Wc.cave && cam.y < Wc.top);
    const below = inWater || seaOutside;
    const dryRoom = Wc.inside && !inWater;
    const water = this.sky.water.material;
    if (below) {
      const depth = Math.min(1, -cam.y / 28), lit = 0.25 + this.sky.dayLight * 0.75;
      const iced = this.iceField.frozen && this.iceField.solid(cam.x, cam.z) ? 0.45 : 1;
      const k = (1 - depth * 0.75) * lit * iced;
      const c = this.uwColor || (this.uwColor = new THREE.Color());
      c.setRGB(0.05 * k, 0.24 * k + 0.01, 0.27 * k + 0.02);
      if (caveWet) { c.setRGB(0.02, 0.07, 0.1); this.caveWorld.ambient.intensity = 0.75; this.caveWorld.ambient.color.setRGB(0.4, 0.75, 1); this.caveWorld.lantern.intensity = 2.6; } // the blue-black of a flooded cave, lit by your lamp and the glowing life
      if (Wc.inside && inWater) c.multiplyScalar(0.8).add(new THREE.Color(0.02, 0.05, 0.05)); // murky water that has leaked in
      // inside a dry hull the air is clear; the sea only starts beyond the windows
      this.scene.fog.color.copy(c); this.scene.fog.near = dryRoom ? 16 : 0.5; this.scene.fog.far = dryRoom ? 70 : Wc.inside ? 14 : caveWet ? 30 : 22 + 18 * lit * iced - depth * 10;
      this.scene.background = c;
      this.sky.sun.intensity *= 0.55 * (1 - depth * 0.6); this.sky.hemi.intensity *= 0.7;
      if (Wc.inside) { this.sky.hemi.intensity = inWater ? 0.6 : 1.0; this.sky.hemi.color.setRGB(0.9, 0.94, 1); this.sky.hemi.groundColor.setRGB(0.5, 0.52, 0.55); } // the habitat's own lights
      if (water.side !== THREE.DoubleSide) { water.side = THREE.DoubleSide; water.needsUpdate = true; }
      // the surface seen from below glows with the daylight coming through it
      water.emissive.setRGB(0.1 * lit, 0.42 * lit, 0.45 * lit).multiplyScalar(iced < 1 ? 0.3 : 1);
      this.sky.dome.visible = false; this.sky.stars.visible = false;
      this.weather.setHidden?.(true);
    } else if (this.wasBelow) {
      if (this.scene.background === this.uwColor) this.scene.background = null;
      water.side = THREE.FrontSide; water.needsUpdate = true; water.emissive.setRGB(0, 0, 0);
      this.sky.dome.visible = true; this.sky.stars.visible = true;
      this.weather.setHidden?.(false);
    }
    if (inWater !== this.wasUnderwater) {
      $('underwater').classList.toggle('hidden', !inWater);
      if (!inWater && this.wasUnderwater && p.breath < BREATH_MAX * 0.5) audio.gasp?.();
    }
    this.wasUnderwater = inWater; this.wasBelow = below; this.wasIndoors = Wc.inside;
    this.hullHud(Wc);
    audio.setUnderwater(inWater ? 1 : 0, inWater ? Math.min(1, -cam.y / 20) : 0);
    if (inWater) $('underwater').style.opacity = String(0.55 + Math.min(0.4, -cam.y / 40));
    // breath bar: shows while you're holding your breath or catching it back
    const br = p.breath, show = br < BREATH_MAX - 0.05 && this.alive;
    if (show !== this._brShow) { this._brShow = show; $('breathrow').classList.toggle('hidden', !show); }
    if (show) { $('breathbar').style.width = (br / BREATH_MAX) * 100 + '%'; $('breathrow').classList.toggle('low', br < 8); }
    // diving tank gauge (with the depth while you're down there)
    const tk = p.tankMax > 0 && this.alive && (inWater || p.tank < p.tankMax - 0.5);
    if (tk !== this._tkShow) { this._tkShow = tk; $('tankrow').classList.toggle('hidden', !tk); }
    if (tk) { $('tankbar').style.width = (p.tank / p.tankMax) * 100 + '%'; $('tankval').textContent = inWater ? Math.round(-cam.y) + 'm' : Math.ceil(p.tank) + 's'; $('tankrow').classList.toggle('low', p.tank < 15); }
  }

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
    for (const v of this.vehicleViews.values()) v.dockParent = v.dockedIn ? this.vehicleViews.get(v.dockedIn) : null;
    for (const v of this.vehicleViews.values()) if (!v.dockParent) v.update(dt, this.vehicle?.id === v.id ? this.vehicle.sim : null, this.effects, night);
    for (const v of this.vehicleViews.values()) if (v.dockParent) v.update(dt, null, this.effects, night);
    if (this.vehicle && this.vehicle.seat === 0 && this.vehicle.view.type === 'minisub' && this.vehicle.sim) {
      const s = this.vehicle.sim;
      for (const v of this.vehicleViews.values()) {
        const d = VEHICLES[v.type].dock;
        if (!d || v.broken || [...this.vehicleViews.values()].some((o) => o.dockedIn === v.id)) continue;
        const dp = new THREE.Vector3(d.x, d.y, d.z).applyQuaternion(v.q).add(v.pos);
        const dd = dp.distanceTo(s.pos);
        if (dd > 7) this.vehicle.dockArmed = true; // only after you've backed out of the bay once
        if (this.vehicle.dockArmed && dd < 3.2 && performance.now() - (this.lastDock || 0) > 3000) { this.lastDock = performance.now(); this.net.send({ t: 'dock' }); }
      }
    }
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
      this.net.send({ t: 'st', p: this.vehicle ? undefined : [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)], yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), cr: p.crouch ? 1 : 0, air: !p.onGround && !p.swimming ? 1 : 0, spr: p.sprinting ? 1 : 0, sw: p.swimming ? 1 : 0, sel: this.sel, seq: this.tpSeq, on: this.ride && !this.vehicle ? this.ride.vid : undefined });
    }
    // world
    const cp = this.vehicle ? this.vehicle.view.pos : this.player.pos;
    this.terrain.update(cp.x, cp.z, 5);
    // how far underground the camera is (0 on the surface, 1 = full darkness)
    { const c = this.camera.position; this.ugDepth = this.caves.inVolume(c.x, c.y - 0.5, c.z) ? Math.max(0, this.caves.depthAt(c.x, c.y, c.z)) : 0; this.ugDark = Math.min(1, Math.max(0, (this.ugDepth - 2) / 10)); }
    const underground = this.ugDark > 0.5;
    this.nature.update(dt, this.camera.position, cp, this.day, this.sky.dayLight, underground ? null : audio, this.season);
    this.caveWorld.update(this.camera.position, dt);
    // blue holes: swim (or steer a sub) down into one to drop into the flooded caves, up its shaft to come back
    this.timers.bh = (this.timers.bh || 0) - dt;
    if (this.timers.bh <= 0 && this.alive && (!this.vehicle || this.vehicle.seat === 0)) {
      this.timers.bh = 0.25;
      const P = this.vehicle ? this.vehicle.view.pos : this.player.pos;
      const h = this.world.blueHolesNear(P.x, P.z).find((q) => Math.hypot(q.x - P.x, q.z - P.z) < q.r * 0.8);
      if (h && (!this.vehicle || VEHICLES[this.vehicle.view.type].sub)) {
        const down = P.y > CAVE_ZONE ? P.y < this.world.ground(h.x, h.z) + 4 : P.y > CAVE_TOP - 6;
        if (down && performance.now() - (this.lastHole || 0) > 3500) { this.lastHole = performance.now(); this.net.send({ t: 'bluehole' }); }
      }
      this.blueHoles = this.world.blueHolesNear(cp.x, cp.z);
    }
    this.timers.entr = (this.timers.entr || 0) - dt;
    if (this.timers.entr <= 0) { this.timers.entr = 1; this.caveWorld.setEntrances(this.caveEntrances(cp.x, cp.z)); this.caveWorld.setBlueHoles(this.blueHoles || []); this.seaLife.setBlueHoles(this.blueHoles || []); }
    this.structures.update(dt, this.camera.position);
    this.entities.updatePlayers(dt, this.camera.position, this.vehicleViews);
    this.entities.updateAnimals(dt);
    this.entities.updateExplosives(dt, audio, this.camera.position);
    this.effects.update(dt);
    this.sky.update(this.day, this.camera.position, dt, this.settings.viewDist);
    // seasons: advance the year locally between server syncs and feed the season shaders
    this.year = ((this.year ?? 1.05) + dt / (this.yearLen || 4800)) % 4;
    this.season = seasonInfo(this.year);
    SEASON.uSnow.value = this.season.snow; SEASON.uFrost.value = this.season.frost; SEASON.uAutumn.value = this.season.autumn; SEASON.uBloom.value = this.season.bloom;
    this.weather.update(dt);
    this.footprints.update(dt, this.camera.position);
    this.iceView.light.value = 0.15 + this.sky.dayLight * 0.85;
    this.iceView.update(dt, this.camera.position, now / 1000);
    this.updateClips();
    this.seaLife.clips = this.clipBoxes; this.seaLife.indoors = !!this.wasIndoors;
    this.seaLife.update(dt, this.camera.position, !!this.wasUnderwater);
    this.floodView.update(dt, this);
    if (this.fishing.state !== 'idle' && (!ITEMS[this.inv[this.sel]?.id]?.fishing || this.vehicle || !this.alive)) this.fishing.cancel();
    if (this.ugDark > 0.01) {
      // underground: the daylight fades out a few metres in; black fog; your lantern and torches do the work
      const k = this.ugDark;
      this.sky.sun.intensity *= 1 - k; this.sky.hemi.intensity = this.sky.hemi.intensity * (1 - k) + 0.04 * k;
      this.scene.fog.color.lerp(new THREE.Color(0.02, 0.02, 0.025), k); this.scene.fog.near = this.scene.fog.near * (1 - k) + 6 * k; this.scene.fog.far = this.scene.fog.far * (1 - k) + 60 * k;
      if (k > 0.6) this.scene.background = this.caveBg || (this.caveBg = new THREE.Color(0x050506)); else if (this.scene.background === this.caveBg) this.scene.background = null;
      this.timers.drip = (this.timers.drip || 0) - dt;
      if (k > 0.5 && this.timers.drip <= 0) { this.timers.drip = 1.5 + Math.random() * 4; audio.drip(); }
    } else if (this.scene.background === this.caveBg) this.scene.background = null;
    this.underwaterView(dt);

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
      this.ui.topbar(this.player.yaw, this.ugDepth > 3 ? `🕯️ Underground · ${Math.round(this.ugDepth)} m deep · ${layerAt(this.ugDepth)[0]} · ${Math.round(cp.x)}, ${Math.round(cp.z)}` : `${np && np.d < 200 ? np.poi.name + ' · ' : ''}${b === 0 && this.iceField.inland(cp.x, cp.z) ? (this.iceField.frozen ? 'Frozen lake' : 'Lake') : BIOME_NAMES[b]} · ${Math.round(cp.x)}, ${Math.round(cp.z)}`, `${SEASON_ICONS[this.season?.season ?? 1]} ${SEASON_NAMES[this.season?.season ?? 1]} · ${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}${night ? ' 🌙' : ''}`);
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
game.home = new Home();
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
