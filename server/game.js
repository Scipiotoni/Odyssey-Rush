// Authoritative game simulation: players, inventory, crafting, building, raiding,
// loot, animals, vehicles and persistence.
import { World, CHUNK, GRID, POI_FLAT, HALF, BIOME, chunkKey } from '../shared/worldgen.js';
import { FIST, DIG, ITEMS, RECIPES, NODES, NODE_RESPAWN, rollLoot, STATION_PROVIDERS, STATION_NAMES, STATION_RANGE, ANIMALS, INV_SIZE, newStack, itemMaxStack, ARMOR_SLOTS } from '../shared/items.js';
import { TIERS, PIECES, pieceCost, pieceTransform, canPlaceAny, buildIndex, unsupportedPieces, worldBoxes, BUILD_REACH, PRIV_RADIUS, rotY, invRotY } from '../shared/building.js';
import { VEHICLES, VEHICLE_ENTER_RANGE, restHeight } from '../shared/vehicles.js';
import { hash3, mulberry32 } from '../shared/noise.js';
import * as Inv from './inv.js';
import { sanitizeLook, encodeLook } from '../shared/look.js';

const VIEW_REGIONS = 2;           // regions (128m) around the player that are streamed
const SNAP_RANGE = 420;           // dynamic entity visibility (m)
const DAY_LENGTH = 40 * 60;       // seconds per full day
const TICK = 1 / 10;
const MELEE_MUL = [1, 0.2, 0.04, 0.015, 0.006];
const BULLET_MUL = [0.5, 0.04, 0.005, 0, 0];
const DOOR_TIER = { wood: 1, metal: 3, armored: 4 };
const CRATE_RESPAWN = 12 * 60;
const BAG_LIFETIME = 25 * 60;
const CORPSE_LIFETIME = 6 * 60;
const STARTER = []; // you wake up with nothing

const now = () => Date.now() / 1000;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const dist3 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
const regionOf = (x, z) => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
const rkey = (x, z) => { const [a, b] = regionOf(x, z); return chunkKey(a, b); };
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor({ seed = 1337, saved = null }) {
    this.seed = seed;
    this.world = new World(seed);
    this.players = new Map();   // token -> player
    this.byPid = new Map();     // pid -> player
    this.structs = new Map();   // id -> structure
    this.buildings = new Map(); // id -> building
    this.loot = new Map();      // id -> lootable (crate, bag, corpse)
    this.vehicles = new Map();
    this.animals = new Map();
    this.explosives = new Map();
    this.nodeState = new Map(); // nodeId -> {hp, until}
    this.regions = new Map();   // key -> {s:Set, l:Set, d:Set}
    this.clans = new Map();     // id -> {id, name, tag, leader, members:[pid], invites:[pid]}
    this.spawned = new Set();   // POI ids / wreck cells that have spawned their content
    this.nextId = 1;
    this.nextPid = 1;
    this.day = 0.3;
    this.chunkCache = new Map();
    this.load(saved);
    this.lastTick = now();
    this.acc = { stats: 0, save: 0, slow: 0 };
  }

  id(prefix) { return `${prefix}${(this.nextId++).toString(36)}`; }

  region(key) {
    let r = this.regions.get(key);
    if (!r) { r = { s: new Set(), l: new Set(), d: new Set() }; this.regions.set(key, r); }
    return r;
  }

  // ------------------------------------------------------------ persistence
  load(d) {
    if (!d) return;
    try {
      if (d.seed !== this.seed) { console.log('[world] seed changed, starting fresh world'); return; }
      this.nextId = d.nextId || 1; this.nextPid = d.nextPid || 1; this.day = d.day ?? 0.3;
      for (const p of d.players || []) { p.ws = null; p.online = false; p.regions = new Set(); p.queue = p.queue || []; p.openCont = null; p.vehicle = null; this.players.set(p.token, p); this.byPid.set(p.pid, p); }
      for (const b of d.buildings || []) this.buildings.set(b.id, b);
      for (const s of d.structs || []) {
        if (s.kind === 'deploy' && ITEMS[s.type]?.deploy?.station) { s.q ||= []; s.slots ||= Inv.emptySlots(ITEMS[s.type].deploy.slots); }
        this.structs.set(s.id, s); this.region(rkey(s.x, s.z)).s.add(s.id);
      }
      for (const l of d.loot || []) { this.loot.set(l.id, l); this.region(rkey(l.x, l.z)).l.add(l.id); }
      for (const v of d.vehicles || []) { v.seats = new Array(VEHICLES[v.type].seats.length).fill(0); this.vehicles.set(v.id, v); }
      for (const [id, st] of d.nodes || []) this.setNodeState(id, st);
      for (const k of d.spawned || []) this.spawned.add(k);
      for (const c of d.clans || []) this.clans.set(c.id, c);
      for (const [ix, iz, v] of d.terrain || []) this.world.setMod(ix, iz, v);
      console.log(`[world] loaded: ${this.players.size} players, ${this.structs.size} structures, ${this.vehicles.size} vehicles`);
    } catch (e) { console.error('[world] failed to load save:', e.message); }
  }
  // Serializable snapshot of the whole persistent world.
  serialize() {
    const strip = (p) => { const { ws, regions, openCont, vehicle, lastSt, air, spr, ...rest } = p; return rest; };
    const d = {
      seed: this.seed, nextId: this.nextId, nextPid: this.nextPid, day: this.day,
      players: [...this.players.values()].map(strip),
      buildings: [...this.buildings.values()],
      structs: [...this.structs.values()],
      loot: [...this.loot.values()],
      vehicles: [...this.vehicles.values()].map(({ seats, ...v }) => v),
      nodes: [...this.nodeState.entries()],
      spawned: [...this.spawned],
      clans: [...this.clans.values()],
      terrain: this.world.modList(),
    };
    return d;
  }


  // ------------------------------------------------------------ networking
  send(p, msg) { if (p && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  toRegion(key, msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.online && p !== except && p.regions.has(key) && p.ws.readyState === 1) p.ws.send(s);
  }
  toNear(x, z, range, msg, except) {
    const s = JSON.stringify(msg), r = range * range;
    for (const p of this.players.values()) if (p.online && p !== except && (p.x - x) ** 2 + (p.z - z) ** 2 < r && p.ws.readyState === 1) p.ws.send(s);
  }
  toAll(msg) { const s = JSON.stringify(msg); for (const p of this.players.values()) if (p.online && p.ws.readyState === 1) p.ws.send(s); }
  toast(p, m) { this.send(p, { t: 'toast', m }); }

  connect(ws) {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        if (msg.t === 'hello') return this.hello(ws, msg);
        const p = ws.player;
        if (!p) return;
        this.handle(p, msg);
      } catch (e) { console.error('handler error', msg.t, e); }
    });
    ws.on('close', () => { if (ws.player) this.disconnect(ws.player); });
  }

  hello(ws, msg) {
    const token = String(msg.token || '').slice(0, 64);
    const name = String(msg.name || 'Survivor').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Survivor';
    if (token.length < 8) return;
    let p = this.players.get(token);
    if (p && p.online && p.ws && p.ws !== ws) { const old = p.ws; old.player = null; try { old.close(4000, 'replaced'); } catch {} }
    if (!p) {
      const [x, y, z] = this.world.randomSpawn();
      p = { token, pid: this.nextPid++, name, x, y, z, yaw: 0, pitch: 0, hp: 100, food: 80, water: 80, xp: 0, alive: true, inv: Inv.emptySlots(INV_SIZE), armor: { head: null, chest: null, legs: null }, queue: [], sel: 0, kills: 0, deaths: 0, cr: 0, regions: new Set() };
      for (const [id, n] of STARTER) Inv.add(p.inv, id, n, true);
      this.players.set(token, p); this.byPid.set(p.pid, p);
      console.log(`[join] new player ${name} (#${p.pid})`);
    } else console.log(`[join] ${name} (#${p.pid}) returned${p.alive ? '' : ' to find themselves dead'}`);
    p.look = sanitizeLook(msg.look || p.look); p.lookStr = encodeLook(p.look);
    p.name = name; p.ws = ws; p.online = true; p.regions = new Set(); p.openCont = null; p.vehicle = null; p.lastSt = now();
    ws.player = p;
    this.send(p, { t: 'welcome', terr: this.world.modList(), seq: p.tpSeq || 0, pid: p.pid, seed: this.seed, day: this.day, dayLen: DAY_LENGTH, p: [p.x, p.y, p.z], yaw: p.yaw, alive: p.alive });
    this.sendInv(p); this.sendStats(p); this.sendQueue(p);
    if (!p.alive) this.send(p, { t: 'dead', by: p.killedBy || 'unknown', bags: this.bagsOf(p) });
    this.updateRegions(p, true);
    this.clanInfo(p);
    this.toAll({ t: 'chat', from: '', m: `${this.displayName(p)} woke up` });
  }

  disconnect(p) {
    p.online = false;
    if (p.vehicle) this.exitVehicle(p);
    p.ws = null; p.regions = new Set(); p.openCont = null;
    console.log(`[leave] ${p.name} is now sleeping at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    this.toAll({ t: 'chat', from: '', m: `${p.name} fell asleep` });
  }

  handle(p, m) {
    switch (m.t) {
      case 'st': return this.onState(p, m);
      case 'swing': return this.onSwing(p, m);
      case 'fire': return this.onFire(p, m);
      case 'reload': return this.onReload(p, m);
      case 'pick': return this.onPick(p, m);
      case 'craft': return this.onCraft(p, m);
      case 'ccancel': return this.onCraftCancel(p, m);
      case 'build': return this.onBuild(p, m);
      case 'deploy': return this.onDeploy(p, m);
      case 'upgrade': return this.onUpgrade(p, m);
      case 'repair': return this.onRepair(p, m);
      case 'use': return this.onUse(p, m);
      case 'open': return this.onOpen(p, m);
      case 'close': p.openCont = null; return;
      case 'take': return this.onTake(p, m);
      case 'move': return this.onMove(p, m);
      case 'drop': return this.onDrop(p, m);
      case 'eat': return this.onEat(p, m);
      case 'drink': return this.onDrink(p);
      case 'throw': return this.onThrow(p, m);
      case 'respawn': return this.onRespawn(p, m);
      case 'chat': return this.onChat(p, m);
      case 'v_enter': return this.onVehicleEnter(p, m);
      case 'v_exit': return this.exitVehicle(p, m.p);
      case 'v_state': return this.onVehicleState(p, m);
      case 'v_fuel': return this.onVehicleFuel(p, m);
      case 'v_repair': return this.onVehicleRepair(p, m);
      case 'v_crash': return this.onVehicleCrash(p, m);
      case 'v_hit': return this.onVehicleHit(p, m);
      case 'demolish': return this.onDemolish(p, m);
      case 'dig': return this.onDig(p, m);
      case 'clan': return this.onClan(p, m);
      case 'look': p.look = sanitizeLook(m.look); p.lookStr = encodeLook(p.look); return;
      case 'fall': if (p.alive && !p.vehicle) this.damagePlayer(p, Math.min(150, Math.max(0, num(m.d))), 'falling'); return;
    }
  }

  // ------------------------------------------------------------ player state
  sendInv(p) { p.invDirty = false; this.send(p, { t: 'inv', inv: p.inv, armor: p.armor }); }
  maxHp(p) { return Math.min(150, 100 + 2 * (this.level(p) - 1)); }
  level(p) { return Math.floor(Math.sqrt((p.xp || 0) / 60)) + 1; }
  gatherMul(p) { return Math.min(2, 1 + 0.04 * (this.level(p) - 1)); }
  addXp(p, n) {
    const l0 = this.level(p);
    p.xp = (p.xp || 0) + n;
    const l1 = this.level(p);
    if (l1 > l0) { this.toast(p, `⭐ Level ${l1}! Max health +2, gather rate +4%`); this.sendStats(p); }
  }
  sendStats(p) {
    this.send(p, { t: 'stats', hp: r2(p.hp), food: r2(p.food), water: r2(p.water), xp: p.xp | 0, lvl: this.level(p), maxhp: this.maxHp(p), cold: p.cold || 0, kills: p.kills, deaths: p.deaths });
  }
  sendQueue(p) {
    const t = now();
    this.send(p, { t: 'queue', q: p.queue.map((q) => ({ r: q.r, left: Math.max(0, q.end - t), total: RECIPES[q.r].time })) });
  }
  give(p, id, n, notify = true) {
    const left = Inv.add(p.inv, id, n);
    p.invDirty = true;
    if (left > 0) this.dropBag(p.x, p.y, p.z, [newStack(id, left)]);
    if (notify && n - left > 0) this.send(p, { t: 'gain', id, n: n - left });
  }
  armorProt(p, hs) {
    const pr = (s) => (p.armor[s] ? ITEMS[p.armor[s].id].armor.prot : 0);
    return hs ? pr('head') : pr('chest') * 0.6 + pr('legs') * 0.4;
  }

  onState(p, m) {
    if (!p.alive) return;
    const t = now();
    if (Array.isArray(m.p) && !p.vehicle) {
      const x = num(m.p[0], p.x), y = num(m.p[1], p.y), z = num(m.p[2], p.z);
      const dt = Math.max(0.05, t - (p.lastSt || t));
      const d = Math.hypot(x - p.x, z - p.z);
      if ((num(m.seq) | 0) < (p.tpSeq || 0)) {
        // stale packet sent before the client processed our last teleport
      } else if (d > 14 * dt + 4) {
        this.teleport(p, p.x, p.y, p.z);
      } else { p.x = x; p.y = y; p.z = z; }
    }
    p.lastSt = t;
    p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.cr = m.cr ? 1 : 0; p.air = m.air ? 1 : 0; p.spr = m.spr ? 1 : 0;
    p.sel = Math.max(0, Math.min(5, num(m.sel) | 0));
    this.updateRegions(p);
  }

  teleport(p, x, y, z, type = 'tp') {
    p.x = x; p.y = y; p.z = z;
    p.tpSeq = (p.tpSeq || 0) + 1;
    this.send(p, { t: type, p: [x, y, z], seq: p.tpSeq });
  }

  updateRegions(p, force = false) {
    const [rx, rz] = regionOf(p.x, p.z);
    const center = `${rx},${rz}`;
    if (!force && p.regionCenter === center) return;
    p.regionCenter = center;
    const want = new Set();
    for (let i = -VIEW_REGIONS; i <= VIEW_REGIONS; i++) for (let j = -VIEW_REGIONS; j <= VIEW_REGIONS; j++) want.add(chunkKey(rx + i, rz + j));
    for (const k of p.regions) if (!want.has(k)) { p.regions.delete(k); this.send(p, { t: 'rgu', k }); }
    for (const k of want) {
      if (p.regions.has(k)) continue;
      p.regions.add(k);
      const [cx, cz] = k.split(',').map(Number);
      this.ensureSpawned(cx, cz);
      const r = this.region(k);
      this.send(p, { t: 'rg', k, s: [...r.s].map((id) => this.sStruct(this.structs.get(id))).filter(Boolean), l: [...r.l].map((id) => this.sLoot(this.loot.get(id))).filter(Boolean), d: [...r.d] });
    }
  }

  // Spawns POI crates/vehicles and random wrecks the first time an area is visited.
  ensureSpawned(cx, cz) {
    const x = (cx + 0.5) * CHUNK, z = (cz + 0.5) * CHUNK;
    const np = this.world.nearestPOI(x, z);
    if (np && np.d < 200 && !this.spawned.has(np.poi.id)) {
      const poi = np.poi;
      this.spawned.add(poi.id);
      const lay = this.world.poiLayout(poi);
      lay.loot.forEach((l, i) => {
        const id = `cr_${poi.id}_${i}`;
        if (this.loot.has(id)) return;
        const y = l.y > poi.y + 0.5 ? l.y : this.world.ground(l.x, l.z);
        this.addLoot({ id, kind: 'crate', tier: l.tier, x: l.x, y, z: l.z, yaw: l.yaw, slots: this.lootSlots(l.tier), respawn: 0 });
      });
      lay.vehicles.forEach((v, i) => this.spawnWreck(`veh_${poi.id}_${i}`, v.type, v.x, v.z, v.yaw));
    }
    const wk = `w_${cx}_${cz}`;
    if (!this.spawned.has(wk)) {
      this.spawned.add(wk);
      if (hash3(cx, cz, 91, this.seed) < 0.014) {
        const rng = mulberry32(Math.floor(hash3(cx, cz, 92, this.seed) * 1e9));
        const wx = cx * CHUNK + 20 + rng() * 88, wz = cz * CHUNK + 20 + rng() * 88;
        const g = this.world.ground(wx, wz);
        const npp = this.world.nearestPOI(wx, wz);
        if (g > 1 && (!npp || npp.d > 100)) {
          const types = ['quad', 'buggy', 'truck', 'suv'];
          this.spawnWreck(`veh_${wk}`, types[Math.floor(rng() * 4)], wx, wz, rng() * 6.28);
          // a stash of parts near the wreck
          this.addLoot({ id: `cr_${wk}`, kind: 'crate', tier: 1, x: wx + 3, y: this.world.ground(wx + 3, wz + 2), z: wz + 2, yaw: rng() * 6, slots: this.lootSlots(1), respawn: 0 });
        }
      }
    }
  }
  lootSlots(tier) {
    const slots = Inv.emptySlots(12);
    for (const it of rollLoot(tier)) Inv.add(slots, it.id, it.n);
    return slots;
  }
  spawnWreck(id, type, x, z, yaw) {
    if (this.vehicles.has(id)) return;
    const def = VEHICLES[type];
    const y = this.world.ground(x, z) + restHeight(def) + 0.05;
    const needs = {};
    for (const k in def.repair) needs[k] = def.repair[k];
    const v = { id, type, x, y, z, q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], vel: [0, 0, 0], hp: 0, broken: true, needs, fuel: 0, steer: 0, rpm: 0, seats: new Array(def.seats.length).fill(0) };
    this.vehicles.set(id, v);
  }

  // ------------------------------------------------------------ serialization
  sStruct(s) {
    if (!s) return null;
    const o = { id: s.id, k: s.kind, type: s.type, hp: Math.ceil(s.hp), mhp: s.mhp, x: r2(s.x), y: r2(s.y), z: r2(s.z), yaw: s.yaw, o: s.owner };
    if (s.kind === 'piece') { o.tier = s.tier; o.bid = s.bid; o.gx = s.gx; o.gz = s.gz; o.level = s.level; o.rot = s.rot || 0; const b = this.buildings.get(s.bid); if (b) o.b = [b.x, b.y, b.z, b.yaw]; }
    if (s.kind === 'door') { o.dt = s.doorTier; o.open = !!s.open; o.parent = s.parent; }
    if (s.type === 'tool_cupboard') o.auth = s.auth;
    return o;
  }
  sLoot(l) {
    if (!l) return null;
    const filled = l.slots.filter(Boolean);
    return { id: l.id, kind: l.kind, tier: l.tier, x: r2(l.x), y: r2(l.y), z: r2(l.z), yaw: l.yaw || 0, an: l.an, empty: !filled.length, item: l.kind === 'bag' && filled.length === 1 ? filled[0].id : undefined };
  }

  addStruct(s) {
    this.structs.set(s.id, s);
    const k = rkey(s.x, s.z);
    this.region(k).s.add(s.id);
    this.toRegion(k, { t: 'sadd', s: this.sStruct(s) });
  }
  updStruct(s) { this.toRegion(rkey(s.x, s.z), { t: 'supd', s: this.sStruct(s) }); }
  addLoot(l) {
    this.loot.set(l.id, l);
    const k = rkey(l.x, l.z);
    this.region(k).l.add(l.id);
    this.toRegion(k, { t: 'ladd', l: this.sLoot(l) });
  }
  updLoot(l) { this.toRegion(rkey(l.x, l.z), { t: 'lupd', l: this.sLoot(l) }); }
  delLoot(l) {
    this.loot.delete(l.id);
    const k = rkey(l.x, l.z);
    this.region(k).l.delete(l.id);
    this.toRegion(k, { t: 'ldel', id: l.id });
  }
  dropBag(x, y, z, stacks, kind = 'bag') {
    const slots = Inv.emptySlots(Math.max(12, stacks.length));
    for (const s of stacks) if (s) Inv.addStack(slots, s);
    if (Inv.isEmpty(slots)) return null;
    const l = { id: this.id('L'), kind, x, y: Math.max(y, this.world.ground(x, z)), z, yaw: Math.random() * 6, slots, expires: now() + BAG_LIFETIME };
    this.addLoot(l);
    return l;
  }

  // ------------------------------------------------------------ spatial helpers
  structsNear(x, z, r = 1) {
    const [rx, rz] = regionOf(x, z), out = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const reg = this.regions.get(chunkKey(rx + i, rz + j));
      if (reg) for (const id of reg.s) { const s = this.structs.get(id); if (s) out.push(s); }
    }
    return out;
  }
  privBlocked(p, x, z) {
    for (const s of this.structsNear(x, z)) {
      if (s.type === 'tool_cupboard' && dist2(s, { x, z }) < PRIV_RADIUS * PRIV_RADIUS && !this.tcAuthed(s, p)) return true;
    }
    return false;
  }
  authorizedAt(p, x, z) {
    let anyTc = false;
    for (const s of this.structsNear(x, z)) {
      if (s.type === 'tool_cupboard' && dist2(s, { x, z }) < PRIV_RADIUS * PRIV_RADIUS) { anyTc = true; if (this.tcAuthed(s, p)) return true; }
    }
    return anyTc ? false : null; // null: no TC around
  }
  inPOI(x, z) { const n = this.world.nearestPOI(x, z); return n && n.d < POI_FLAT + 12; }

  // ------------------------------------------------------------ combat
  heldItem(p, sel) { const s = p.inv[sel]; return s ? { stack: s, def: ITEMS[s.id] } : null; }

  onSwing(p, m) {
    if (!p.alive || p.vehicle) return;
    let h = this.heldItem(p, num(m.sel) | 0);
    if (!h) h = { def: { tool: FIST } }; // bare hands
    if (!h.def.tool) return;
    const tool = h.def.tool, t = now();
    if (t - (p.lastSwing || 0) < 0.75 / tool.rate) return;
    p.lastSwing = t;
    this.toNear(p.x, p.z, 60, { t: 'fx', k: 'swing', pid: p.pid }, p);
    if (!m.k) return;
    const reach = tool.range + 2.5;
    if (m.k === 'n') return this.gatherNode(p, String(m.id), tool, reach);
    if (m.k === 'p') { const o = this.byPid.get(num(m.id)); if (o && o.alive && dist3(o, p) < reach + 1) this.damagePlayer(o, tool.dmg * (m.hs ? 1.5 : 1), p, !!m.hs); return; }
    if (m.k === 'a') { const a = this.animals.get(String(m.id)); if (a && dist3(a, p) < reach + 1.5) this.damageAnimal(a, tool.dmg, p); return; }
    if (m.k === 's') {
      const s = this.structs.get(String(m.id));
      if (!s || !this.nearStructPt(s, p, reach)) return;
      if (h.def.tool.hammer) return; // hammer hits are handled by upgrade/repair
      this.damageStruct(s, tool.dmg, 'melee', p);
      return;
    }
    if (m.k === 'v') { const v = this.vehicles.get(String(m.id)); if (v && dist3(v, p) < reach + 3) this.damageVehicle(v, tool.dmg * 0.3); }
  }
  nearStructPt(s, p, reach) { return dist3(s, p) < reach + 3; }

  onFire(p, m) {
    if (!p.alive) return;
    const sel = num(m.sel) | 0;
    const h = this.heldItem(p, sel);
    if (!h || !h.def.gun) return;
    const g = h.def.gun, t = now();
    if (t - (p.lastFire || 0) < 0.8 / g.rate) return;
    if ((h.stack.a || 0) <= 0) return;
    p.lastFire = t;
    h.stack.a -= 1;
    const o = Array.isArray(m.o) ? m.o.map((v) => num(v)) : [p.x, p.y + 1.6, p.z];
    const d = Array.isArray(m.d) ? m.d.map((v) => num(v)) : [0, 0, 1];
    this.toNear(p.x, p.z, 350, { t: 'fx', k: 'shot', pid: p.pid, w: h.stack.id, o, d, e: Array.isArray(m.e) ? m.e.slice(0, 12) : [] }, p);
    if (g.blast) {
      // rocket: explode at the first impact point (validated against range)
      const e0 = Array.isArray(m.e) && Array.isArray(m.e[0]) ? m.e[0].map((v) => num(v)) : null;
      if (e0 && Math.hypot(e0[0] - o[0], e0[1] - o[1], e0[2] - o[2]) <= g.range + 2 && Math.hypot(o[0] - p.x, o[2] - p.z) < 4) {
        const dly = Math.min(2, Math.hypot(e0[0] - o[0], e0[1] - o[1], e0[2] - o[2]) / 60);
        setTimeout(() => this.explode(e0[0], e0[1], e0[2], g.blast, p, null), dly * 1000);
      }
      return;
    }
    const hits = Array.isArray(m.hits) ? m.hits.slice(0, g.pellets || 1) : [];
    for (const hit of hits) {
      const dist = Math.hypot(num(hit.pt?.[0]) - o[0], num(hit.pt?.[1]) - o[1], num(hit.pt?.[2]) - o[2]);
      if (dist > g.range * 1.1) continue;
      const fall = dist > g.range * 0.5 ? 1 - (dist - g.range * 0.5) / g.range : 1;
      const dmg = g.dmg * fall;
      if (hit.k === 'p') { const o2 = this.byPid.get(num(hit.id)); if (o2 && o2 !== p && o2.alive && dist3(o2, p) < g.range + 5) this.damagePlayer(o2, dmg * (hit.hs ? 1.8 : 1), p, !!hit.hs); }
      else if (hit.k === 'a') { const a = this.animals.get(String(hit.id)); if (a) this.damageAnimal(a, dmg * (hit.hs ? 1.5 : 1), p); }
      else if (hit.k === 's') { const s = this.structs.get(String(hit.id)); if (s) this.damageStruct(s, dmg, 'bullet', p); }
      else if (hit.k === 'v') { const v = this.vehicles.get(String(hit.id)); if (v) this.damageVehicle(v, dmg * 0.25); }
      else if (hit.k === 'n') { const node = this.world.nodeById(String(hit.id)); if (node && node.type === 'barrel') this.gatherNode(p, node.id, { tree: 0, ore: 0, dmg: dmg }, 999); }
    }
  }

  onReload(p, m) {
    const h = this.heldItem(p, num(m.sel) | 0);
    if (!h || !h.def.gun) return;
    const g = h.def.gun, need = g.mag - (h.stack.a || 0);
    if (need <= 0) return;
    const have = Inv.count(p.inv, g.ammo);
    const n = Math.min(need, have);
    if (n <= 0) return this.toast(p, `No ${ITEMS[g.ammo].name}`);
    Inv.remove(p.inv, g.ammo, n);
    h.stack.a = (h.stack.a || 0) + n;
    this.sendInv(p);
  }

  damagePlayer(o, amt, src, hs = false) {
    if (!o.alive) return;
    if (src && src.pid && src !== o && this.sameClan(src, o)) return; // no friendly fire
    if (o.vehicle) amt *= 0.6;
    const dmg = amt * (1 - this.armorProt(o, hs));
    o.hp -= dmg;
    this.send(o, { t: 'hurt', dmg: r2(dmg), from: src && src.x !== undefined ? [src.x, src.z] : null });
    if (src && src.pid) this.send(src, { t: 'hitmark', hs, kill: o.hp <= 0 });
    if (o.hp <= 0) this.killPlayer(o, src?.name || (typeof src === 'string' ? src : 'the island'), src);
    else this.sendStats(o);
  }
  killPlayer(p, byName, src) {
    p.alive = false; p.hp = 0; p.deaths = (p.deaths || 0) + 1;
    if (src && src.pid && src !== p) { src.kills = (src.kills || 0) + 1; this.addXp(src, 25); this.sendStats(src); }
    if (p.vehicle) this.exitVehicle(p);
    const stacks = [...p.inv, ...ARMOR_SLOTS.map((s) => p.armor[s])];
    this.dropBag(p.x, p.y, p.z, stacks, 'bag');
    p.inv = Inv.emptySlots(INV_SIZE); p.armor = { head: null, chest: null, legs: null }; p.queue = [];
    p.killedBy = byName;
    this.sendInv(p);
    this.send(p, { t: 'dead', by: byName, bags: this.bagsOf(p) });
    this.toAll({ t: 'chat', from: '', m: `☠ ${p.name} was killed by ${byName}${p.online ? '' : ' while sleeping'}` });
  }
  bagsOf(p) {
    const out = [];
    for (const s of this.structs.values()) if (s.type === 'sleeping_bag' && s.owner === p.pid) out.push({ id: s.id, x: Math.round(s.x), z: Math.round(s.z) });
    return out;
  }
  onRespawn(p, m) {
    if (p.alive) return;
    let pos = null;
    if (m.bag) {
      const b = this.structs.get(String(m.bag));
      if (b && b.type === 'sleeping_bag' && b.owner === p.pid) {
        if (now() - (b.lastUse || 0) < 120) return this.toast(p, `Sleeping bag on cooldown (${Math.ceil(120 - (now() - b.lastUse))}s)`);
        b.lastUse = now(); pos = [b.x, b.y + 0.5, b.z];
      }
    }
    if (!pos) pos = this.world.randomSpawn();
    p.alive = true; p.hp = 60; p.food = Math.max(p.food, 50); p.water = Math.max(p.water, 50);
    for (const [id, n] of STARTER) Inv.add(p.inv, id, n, true);
    this.teleport(p, pos[0], pos[1], pos[2], 'spawn');
    this.sendInv(p); this.sendStats(p);
    this.updateRegions(p, true);
  }

  damageAnimal(a, dmg, p) {
    a.hp -= dmg;
    a.hurtBy = p ? p.pid : 0; a.hurtT = now();
    if (p) this.send(p, { t: 'hitmark', hs: false, kill: a.hp <= 0 });
    if (a.hp <= 0) {
      this.animals.delete(a.id);
      const def = ANIMALS[a.type];
      const slots = Inv.emptySlots(8);
      for (const k in def.drops) Inv.add(slots, k, def.drops[k]);
      this.addLoot({ id: this.id('C'), kind: 'corpse', an: a.type, x: a.x, y: a.y, z: a.z, yaw: a.yaw, slots, expires: now() + CORPSE_LIFETIME });
      if (p) this.addXp(p, 8);
    }
  }

  damageVehicle(v, dmg) {
    if (v.broken) return;
    v.hp -= dmg;
    if (v.hp <= 0) {
      v.hp = 0; v.broken = true;
      const def = VEHICLES[v.type];
      v.needs = { engine_parts: 1, scrap: Math.ceil(def.repair.scrap / 2), metal_frags: def.repair.metal_frags || 30 };
      this.toNear(v.x, v.z, 300, { t: 'fx', k: 'expl', p: [v.x, v.y, v.z], r: 3 });
      for (const pid of v.seats) if (pid) { const o = this.byPid.get(pid); if (o) { this.exitVehicle(o); this.damagePlayer(o, 30, 'a vehicle explosion'); } }
    }
  }

  // ------------------------------------------------------------ gathering
  setNodeState(id, st) {
    this.nodeState.set(id, st);
    const [cx, cz] = id.split('_');
    const k = `${cx},${cz}`;
    if (st.hp <= 0) this.region(k).d.add(id); else this.region(k).d.delete(id);
  }
  getNode(id) {
    const [cx, cz] = id.split('_').map(Number);
    const ck = chunkKey(cx, cz);
    let list = this.chunkCache.get(ck);
    if (!list) {
      if (this.chunkCache.size > 600) this.chunkCache.clear();
      list = this.world.chunkNodes(cx, cz);
      this.chunkCache.set(ck, list);
    }
    return list.find((n) => n.id === id);
  }
  gatherNode(p, id, tool, reach) {
    const node = this.getNode(id);
    if (!node) return;
    const def = NODES[node.type];
    if (Math.hypot(node.x - p.x, node.z - p.z) > reach + def.radius * node.s + 1) return;
    let st = this.nodeState.get(id);
    if (st && st.hp <= 0) return;
    const maxHp = (def.hp || 1) * node.s;
    if (!st) st = { hp: maxHp, until: 0 };
    if (def.kind === 'barrel') {
      st.hp -= tool.dmg;
      if (st.hp <= 0) {
        for (const it of rollLoot('barrel')) this.give(p, it.id, it.n);
        this.addXp(p, 3);
      }
    } else if (def.kind === 'tree' || def.kind === 'ore') {
      const power = def.kind === 'tree' ? tool.tree : tool.ore;
      if (power <= 0) return;
      const mul = this.gatherMul(p);
      for (const k in def.yield) {
        const n = Math.max(1, Math.round(def.yield[k] * power * mul * 0.6));
        this.give(p, k, n);
      }
      st.hp -= power;
      // bonus on final hit
      if (st.hp <= 0) { if (def.kind === 'ore') this.give(p, Object.keys(def.yield)[0], Math.round(20 * mul)); else this.give(p, 'wood', Math.round(15 * mul)); }
      this.addXp(p, 1);
    } else return;
    if (st.hp <= 0) { st.hp = 0; st.until = now() + NODE_RESPAWN; this.toRegion(id.split('_').slice(0, 2).join(','), { t: 'node', id, dep: 1 }); }
    this.setNodeState(id, st);
    this.send(p, { t: 'nodehit', id, frac: st.hp / maxHp });
  }
  onPick(p, m) {
    const id = String(m.id);
    const node = this.getNode(id);
    if (!node || !p.alive) return;
    const def = NODES[node.type];
    if (def.kind !== 'pick') return;
    if (Math.hypot(node.x - p.x, node.z - p.z) > 4) return;
    if (this.nodeState.get(id)?.hp <= 0) return;
    if (def.givesRock) {
      if (Inv.count(p.inv, 'rock') === 0) this.give(p, 'rock', 1);
      else this.give(p, 'stone', 8);
    }
    for (const k in def.yield) this.give(p, k, Math.round(def.yield[k] * this.gatherMul(p)));
    this.addXp(p, 1);
    this.setNodeState(id, { hp: 0, until: now() + NODE_RESPAWN * (def.givesRock ? 0.25 : 0.5) });
    this.toRegion(id.split('_').slice(0, 2).join(','), { t: 'node', id, dep: 1 });
  }

  // ------------------------------------------------------------ crafting
  // Hand recipes (no station) run in the player's own queue. Station recipes run in the
  // queue of the station itself: it keeps working while you are away and finished items
  // wait in the station's output slots until you open it and take them.
  stationFor(p, station) {
    const kinds = STATION_PROVIDERS[station];
    let best = null, bd = Infinity;
    for (const s of this.structsNear(p.x, p.z)) {
      if (s.kind !== 'deploy' || !s.q || !kinds.includes(s.type)) continue;
      const d = dist3(s, p);
      if (d < STATION_RANGE + 1 && d < bd) { best = s; bd = d; }
    }
    return best;
  }
  onCraft(p, m) {
    const r = RECIPES[num(m.r, -1)];
    const n = Math.max(1, Math.min(20, num(m.n, 1) | 0));
    if (!r || !p.alive) return;
    const st = r.station ? this.stationFor(p, r.station) : null;
    if (r.station && !st) return this.toast(p, `You need to be next to a ${STATION_NAMES[r.station]}`);
    if (!Inv.hasAll(p.inv, r.cost, n)) return this.toast(p, 'Not enough resources');
    const q = st ? st.q : p.queue;
    if (q.length >= 12) return this.toast(p, st ? `${ITEMS[st.type].name} queue is full` : 'Craft queue is full');
    Inv.removeAll(p.inv, r.cost, n);
    let end = Math.max(now(), q.length ? q[q.length - 1].end : 0);
    for (let i = 0; i < n; i++) { end += r.time; q.push({ r: r.id, end, p: p.pid }); }
    this.sendInv(p);
    if (st) { this.pushContainer(st.id); this.sendStations(p); } else this.sendQueue(p);
  }
  // Re-time the jobs from index `from` onwards after a cancellation.
  reflowJobs(q, from) {
    let t = from > 0 ? q[from - 1].end : now();
    for (let j = from; j < q.length; j++) { t = Math.max(t, now()) + RECIPES[q[j].r].time; q[j].end = t; }
  }
  onCraftCancel(p, m) {
    const i = num(m.i, -1) | 0;
    if (m.s) {
      // cancel a job queued at a station that the player is standing next to
      const st = this.structs.get(String(m.s));
      if (!st || !st.q || !p.alive || dist3(st, p) > STATION_RANGE + 2) return;
      const job = st.q[i];
      if (!job) return;
      if (job.p !== p.pid) return this.toast(p, 'Only the player who queued this can cancel it');
      st.q.splice(i, 1);
      this.reflowJobs(st.q, i);
      for (const k in RECIPES[job.r].cost) this.give(p, k, RECIPES[job.r].cost[k], false);
      this.sendInv(p); this.pushContainer(st.id); this.sendStations(p);
      return;
    }
    const q = p.queue[i];
    if (!q) return;
    p.queue.splice(i, 1);
    const r = RECIPES[q.r];
    for (const k in r.cost) this.give(p, k, r.cost[k], false);
    // shift remaining
    let t = now();
    for (const e of p.queue) { t += RECIPES[e.r].time; e.end = t; }
    this.sendInv(p); this.sendQueue(p);
  }
  // Whether `n` of `id` fits into the slots right now.
  fits(slots, id, n) {
    const max = itemMaxStack(id);
    let room = 0;
    for (const x of slots) room += !x ? max : x.id === id ? Math.max(0, max - x.n) : 0;
    return room >= n;
  }
  tickCrafting() {
    const t = now();
    for (const p of this.players.values()) {
      if (!p.queue.length || !p.online || !p.alive) continue;
      let changed = false;
      while (p.queue.length && p.queue[0].end <= t) {
        const q = p.queue.shift();
        const r = RECIPES[q.r];
        this.give(p, r.out, r.n);
        this.addXp(p, Math.ceil(r.time / 2));
        changed = true;
      }
      if (changed) { this.sendInv(p); this.sendQueue(p); }
    }
    // stations work whether or not anyone is standing next to them
    for (const s of this.structs.values()) {
      if (!s.q || !s.q.length) continue;
      let changed = false;
      while (s.q.length && s.q[0].end <= t) {
        const job = s.q[0], r = RECIPES[job.r];
        if (!this.fits(s.slots, r.out, r.n)) break; // output full: wait until it is emptied
        s.q.shift();
        Inv.add(s.slots, r.out, r.n);
        const crafter = this.byPid.get(job.p);
        if (crafter && crafter.online) this.addXp(crafter, Math.ceil(r.time / 2));
        changed = true;
      }
      if (changed) this.pushContainer(s.id);
    }
    if (t - (this.stqAt || 0) >= 1) {
      this.stqAt = t;
      for (const p of this.players.values()) if (p.online && p.alive) this.sendStations(p);
    }
  }
  // Crafting jobs of stations the player can reach (and the one they have open).
  stationJobs(p) {
    const t = now(), out = [], seen = new Set();
    const add = (s) => {
      if (seen.has(s.id) || !s.q || !s.q.length) return;
      seen.add(s.id);
      out.push({ id: s.id, name: ITEMS[s.type]?.name || 'Station', jobs: s.q.map((j, i) => ({ i, r: j.r, left: Math.max(0, Math.ceil(j.end - t)), m: j.p === p.pid ? 1 : 0 })) });
    };
    for (const s of this.structsNear(p.x, p.z)) if (s.kind === 'deploy' && dist3(s, p) <= STATION_RANGE + 2) add(s);
    const open = p.openCont && this.structs.get(p.openCont);
    if (open && open.q) add(open);
    return out;
  }
  sendStations(p) {
    const list = this.stationJobs(p);
    if (!list.length && !p.stqOn) return;
    p.stqOn = list.length > 0;
    this.send(p, { t: 'stq', st: list });
  }

  // ------------------------------------------------------------ building
  checkFoundationGround(b, gx, gz) {
    const t = pieceTransform(b, { type: 'foundation', gx, gz, level: 0 });
    for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 0]]) {
      const [dx, dz] = rotY(cx, cz, t.yaw);
      const g = this.world.ground(t.x + dx, t.z + dz);
      if (g > b.y + 0.35) return 'Ground is in the way';
      if (g < b.y - 2.9) return 'Too steep: foundation would float';
    }
    if (this.inPOI(t.x, t.z)) return "Can't build in monuments";
    if (this.world.ground(t.x, t.z) < -2) return 'Water is too deep';
    return null;
  }
  piecesOf(bid) { const out = []; for (const s of this.structs.values()) if (s.bid === bid && s.kind === 'piece') out.push(s); return out; }

  onBuild(p, m) {
    if (!p.alive) return;
    const type = String(m.type);
    if (!PIECES[type]) return;
    const plan = p.inv[p.sel];
    if (!plan || plan.id !== 'building_plan') return this.toast(p, 'Equip a building plan');
    const tier = Math.max(0, Math.min(TIERS.length - 1, num(m.tier, 0) | 0));
    const cost = pieceCost(type, tier);
    if (!Inv.hasAll(p.inv, cost)) return this.toast(p, `Need ${Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    let b, gx = num(m.gx) | 0, gz = num(m.gz) | 0, level = num(m.level) | 0;
    let isNew = false;
    if (m.bid && this.buildings.has(String(m.bid))) b = this.buildings.get(String(m.bid));
    else {
      if (type !== 'foundation') return this.toast(p, 'Start with a foundation');
      const x = num(m.x), y = num(m.y), z = num(m.z);
      b = { id: this.id('B'), x, y, z, yaw: num(m.yaw), owner: p.pid };
      gx = 0; gz = 0; level = 0; isNew = true;
      // keep new buildings from overlapping others
      for (const s of this.structsNear(x, z)) if (s.kind === 'piece' && Math.hypot(s.x - x, s.z - z) < 4.5) return this.toast(p, 'Too close to another building');
    }
    const t = pieceTransform(b, { type, gx, gz, level, rot: m.rot | 0 });
    if (dist3(t, p) > BUILD_REACH + 4) return this.toast(p, 'Too far away');
    if (this.privBlocked(p, t.x, t.z)) return this.toast(p, 'Building blocked: someone else owns this area (Tool Cupboard)');
    const pieces = isNew ? [] : this.piecesOf(b.id);
    const err = canPlaceAny(type, gx, gz, level, buildIndex(pieces), isNew);
    if (err) return this.toast(p, err);
    if (type === 'foundation') { const ge = this.checkFoundationGround(b, gx, gz); if (ge) return this.toast(p, ge); }
    if (isNew) this.buildings.set(b.id, b);
    Inv.removeAll(p.inv, cost);
    const s = { id: this.id('S'), created: now(), kind: 'piece', type, tier, hp: TIERS[tier].hp, mhp: TIERS[tier].hp, bid: b.id, gx, gz, level, rot: (m.rot | 0) & 3, owner: p.pid, ...t };
    this.addStruct(s);
    this.sendInv(p);
    this.addXp(p, 1);
  }

  onUpgrade(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || s.kind !== 'piece' || !p.alive) return;
    const ham = p.inv[p.sel];
    if (!ham || ham.id !== 'hammer') return;
    const tier = num(m.tier, s.tier + 1) | 0;
    if (tier <= s.tier || tier >= TIERS.length) return;
    if (dist3(s, p) > BUILD_REACH + 3) return;
    if (this.privBlocked(p, s.x, s.z)) return this.toast(p, 'Building blocked');
    const cost = pieceCost(s.type, tier);
    if (!Inv.hasAll(p.inv, cost)) return this.toast(p, `Need ${Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    Inv.removeAll(p.inv, cost);
    s.tier = tier; s.mhp = TIERS[tier].hp; s.hp = s.mhp;
    this.updStruct(s); this.sendInv(p);
    this.toNear(s.x, s.z, 80, { t: 'fx', k: 'upgrade', p: [s.x, s.y + 1, s.z], tier });
    this.addXp(p, 2 + tier);
  }
  onRepair(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || !p.alive || s.hp >= s.mhp) return;
    const ham = p.inv[p.sel];
    if (!ham || ham.id !== 'hammer') return;
    if (dist3(s, p) > BUILD_REACH + 3) return;
    if (now() - (s.lastDmg || 0) < 30) return this.toast(p, 'Recently damaged — wait 30s to repair');
    const frac = 1 - s.hp / s.mhp;
    let cost;
    if (s.kind === 'piece') cost = pieceCost(s.type, s.tier);
    else cost = { wood: 50 };
    const c = {};
    for (const k in cost) c[k] = Math.max(1, Math.ceil(cost[k] * frac * 0.5));
    if (!Inv.hasAll(p.inv, c)) return this.toast(p, 'Not enough resources to repair');
    Inv.removeAll(p.inv, c);
    s.hp = s.mhp;
    this.updStruct(s); this.sendInv(p);
  }
  onDemolish(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || !p.alive) return;
    if (s.owner !== p.pid) return this.toast(p, 'Only the builder can demolish this');
    if (now() - (s.created || 0) > 600 && s.kind === 'piece') return this.toast(p, 'Can only demolish within 10 minutes of placing');
    if (dist3(s, p) > BUILD_REACH + 3) return;
    this.destroyStruct(s, false);
  }

  onDeploy(p, m) {
    if (!p.alive) return;
    let sel = num(m.sel) | 0;
    if (m.item) {
      sel = p.inv.findIndex((x) => x && x.id === String(m.item));
      if (sel < 0) return this.toast(p, `You don't have a ${ITEMS[String(m.item)]?.name || 'that item'}`);
    }
    const st = p.inv[sel];
    if (!st) return;
    const def = ITEMS[st.id];
    if (def.door) {
      const dw = this.structs.get(String(m.door));
      if (!dw || dw.type !== 'doorway') return this.toast(p, 'Place doors in a doorway');
      if (dist3(dw, p) > BUILD_REACH + 3) return;
      for (const s of this.structs.values()) if (s.kind === 'door' && s.parent === dw.id) return this.toast(p, 'Doorway already has a door');
      if (this.privBlocked(p, dw.x, dw.z)) return this.toast(p, 'Building blocked');
      Inv.remove(p.inv, st.id, 1);
      const tier = DOOR_TIER[def.door.tier];
      this.addStruct({ id: this.id('S'), kind: 'door', type: 'door', doorTier: def.door.tier, tierIdx: tier, parent: dw.id, hp: def.door.hp, mhp: def.door.hp, owner: p.pid, x: dw.x, y: dw.y, z: dw.z, yaw: dw.yaw, open: false, created: now() });
      this.sendInv(p);
      return;
    }
    if (!def.deploy) return;
    const x = num(m.x), y = num(m.y), z = num(m.z);
    if (Math.hypot(x - p.x, z - p.z) > BUILD_REACH + 2) return this.toast(p, 'Too far away');
    if (this.inPOI(x, z)) return this.toast(p, "Can't deploy in monuments");
    const kind = def.deploy.kind;
    if (kind !== 'sleeping_bag' && kind !== 'campfire' && this.privBlocked(p, x, z)) return this.toast(p, 'Building blocked');
    if (kind === 'tool_cupboard') {
      for (const s of this.structsNear(x, z)) if (s.type === 'tool_cupboard' && dist2(s, { x, z }) < (PRIV_RADIUS * 1.4) ** 2) return this.toast(p, 'Another tool cupboard is too close');
    }
    Inv.remove(p.inv, st.id, 1);
    const s = { id: this.id('S'), kind: 'deploy', type: kind, hp: def.deploy.hp, mhp: def.deploy.hp, owner: p.pid, x, y, z, yaw: num(m.yaw), created: now() };
    if (def.deploy.slots) s.slots = Inv.emptySlots(def.deploy.slots);
    if (def.deploy.station) s.q = [];
    if (kind === 'tool_cupboard') s.auth = [p.pid];
    this.addStruct(s);
    this.sendInv(p);
    if (kind === 'sleeping_bag') this.toast(p, 'Sleeping bag placed — you can respawn here');
    if (kind === 'tool_cupboard') this.toast(p, 'Tool cupboard placed — this area is now yours. Others cannot build within 30m.');
  }

  damageStruct(s, dmg, type, src) {
    let mul = 1;
    if (s.kind === 'piece') mul = type === 'melee' ? MELEE_MUL[s.tier] : type === 'bullet' ? BULLET_MUL[s.tier] : 1;
    else if (s.kind === 'door') mul = type === 'melee' ? MELEE_MUL[s.tierIdx] : type === 'bullet' ? BULLET_MUL[s.tierIdx] : 1;
    else mul = type === 'melee' ? 0.5 : type === 'bullet' ? 0.15 : 1;
    const d = dmg * mul;
    if (d <= 0) return;
    s.hp -= d; s.lastDmg = now();
    if (src && src.pid) this.send(src, { t: 'shit', id: s.id, hp: Math.max(0, Math.ceil(s.hp)), mhp: s.mhp });
    if (s.hp <= 0) this.destroyStruct(s, true);
    else this.updStruct(s);
  }

  destroyStruct(s, effects) {
    if (!this.structs.has(s.id)) return;
    this.structs.delete(s.id);
    const k = rkey(s.x, s.z);
    this.region(k).s.delete(s.id);
    this.toRegion(k, { t: 'sdel', id: s.id, fx: effects ? 1 : 0 });
    const spill = s.slots ? s.slots.filter((it) => it && Math.random() < 0.6) : [];
    for (const j of s.q || []) for (const k in RECIPES[j.r].cost) spill.push(newStack(k, RECIPES[j.r].cost[k]));
    if (spill.length) this.dropBag(s.x, s.y + 0.3, s.z, spill);
    if (s.kind === 'piece') {
      // doors in destroyed doorway
      if (s.type === 'doorway') for (const d of [...this.structs.values()]) if (d.kind === 'door' && d.parent === s.id) this.destroyStruct(d, effects);
      const pieces = this.piecesOf(s.bid);
      if (!pieces.length) { this.buildings.delete(s.bid); }
      else for (const dead of unsupportedPieces(pieces)) this.destroyStruct(dead, true);
      // deployables that lost their floor
      for (const o of this.structsNear(s.x, s.z)) if (o.kind === 'deploy' && !this.hasSupport(o)) this.destroyStruct(o, true);
    }
  }
  hasSupport(o) {
    if (o.y - this.world.ground(o.x, o.z) < 0.6) return true;
    for (const s of this.structsNear(o.x, o.z, 0)) {
      if (s.kind !== 'piece' || (s.type !== 'foundation' && s.type !== 'floor' && s.type !== 'stairs')) continue;
      for (const b of worldBoxes(s)) {
        const [lx, lz] = invRotY(o.x - b.x, o.z - b.z, b.yaw);
        if (Math.abs(lx) <= b.hx + 0.2 && Math.abs(lz) <= b.hz + 0.2 && Math.abs(o.y - (b.y + b.hy)) < 0.6) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ terrain editing
  // Why is a grid vertex not editable? (null = ok)
  digBlocked(ix, iz) {
    const x = ix * GRID, z = iz * GRID;
    if (this.inPOI(x, z)) return "Can't dig in monuments";
    if (Math.hypot(x, z) > HALF * 0.97) return 'Too close to the edge of the world';
    for (const s of this.structsNear(x, z, 1)) {
      const r = s.kind === 'piece' ? 4.5 : 3;
      if (Math.hypot(s.x - x, s.z - z) < r + GRID) return 'Too close to a structure';
    }
    const [cx, cz] = regionOf(x, z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const k = chunkKey(cx + i, cz + j);
      let list = this.chunkCache.get(k);
      if (!list) { list = this.world.chunkNodes(cx + i, cz + j); this.chunkCache.set(k, list); }
      for (const n of list) if (Math.abs(n.x - x) < GRID + 1.5 && Math.abs(n.z - z) < GRID + 1.5 && !(this.nodeState.get(n.id)?.hp <= 0)) return 'Too close to a tree or rock';
    }
    return null;
  }
  editTerrain(ix, iz, delta) {
    const cur = this.world.getMod(ix, iz);
    const v = Math.max(DIG.min, Math.min(DIG.max, cur + delta));
    if (Math.abs(v - cur) < 0.01) return false;
    this.world.setMod(ix, iz, v);
    this.toAll({ t: 'terr', m: [[ix, iz, this.world.getMod(ix, iz)]] });
    return true;
  }
  onDig(p, m) {
    if (!p.alive || p.vehicle) return;
    const st = p.inv[num(m.sel) | 0];
    if (!st || !ITEMS[st.id].dig) return;
    const t = now();
    if (t - (p.lastDig || 0) < 0.35) return;
    p.lastDig = t;
    const pt = Array.isArray(m.pt) ? m.pt.map((v) => num(v)) : null;
    if (!pt || Math.hypot(pt[0] - p.x, pt[2] - p.z) > DIG.reach + 1) return;
    const ix = Math.round(pt[0] / GRID), iz = Math.round(pt[2] / GRID);
    if (Math.hypot(ix * GRID - p.x, iz * GRID - p.z) < 1.2 && !m.up) return this.toast(p, "Don't dig right under your feet");
    const err = this.digBlocked(ix, iz);
    if (err) return this.toast(p, err);
    if (m.up) {
      if (!Inv.hasAll(p.inv, DIG.raiseCost)) return this.toast(p, `Piling up dirt needs ${DIG.raiseCost.stone} Stone`);
      if (!this.editTerrain(ix, iz, DIG.step)) return this.toast(p, "Can't raise the ground any higher here");
      Inv.removeAll(p.inv, DIG.raiseCost); this.sendInv(p);
    } else {
      if (!this.editTerrain(ix, iz, -DIG.step)) return this.toast(p, "Can't dig any deeper here — bedrock");
      this.give(p, 'stone', 3 + Math.floor(Math.random() * 3));
      const r = Math.random();
      if (r < 0.06) this.give(p, 'metal_ore', 5 + Math.floor(Math.random() * 6));
      else if (r < 0.1) this.give(p, 'sulfur_ore', 5 + Math.floor(Math.random() * 6));
      else if (r < 0.11) this.give(p, 'scrap', 3);
      this.addXp(p, 1);
    }
    this.toNear(pt[0], pt[2], 60, { t: 'fx', k: 'dig', p: pt, up: !!m.up });
  }

  // ------------------------------------------------------------ interaction
  onUse(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || !p.alive || dist3(s, p) > 4.5) return;
    if (s.kind === 'door') {
      const auth = this.authorizedAt(p, s.x, s.z);
      if (auth === false || (auth === null && s.owner !== p.pid && !this.sameClan(p, this.byPid.get(s.owner)))) return this.toast(p, '🔒 Locked');
      s.open = !s.open;
      this.updStruct(s);
      this.toNear(s.x, s.z, 40, { t: 'fx', k: 'door', p: [s.x, s.y, s.z] });
      return;
    }
    if (s.type === 'tool_cupboard') {
      if (m.a === 'clear') { if (s.auth.includes(p.pid)) { s.auth = [p.pid]; this.toast(p, 'Authorization list cleared'); } }
      else if (s.auth.includes(p.pid)) { s.auth = s.auth.filter((x) => x !== p.pid); this.toast(p, 'You deauthorized yourself'); }
      else { s.auth.push(p.pid); this.toast(p, '✅ Authorized: you can now build here and open doors'); }
      this.updStruct(s);
      return;
    }
    if (s.type === 'sleeping_bag') {
      if (s.owner !== p.pid) { s.owner = p.pid; this.toast(p, 'You claimed this sleeping bag'); this.updStruct(s); }
    }
  }

  getContainer(id) {
    const s = this.structs.get(id);
    if (s && s.slots) return { obj: s, title: ITEMS[s.type]?.name || 'Box', slots: s.slots };
    const l = this.loot.get(id);
    if (l) return { obj: l, title: l.kind === 'crate' ? ['', 'Supply Crate', 'Military Crate', 'Elite Crate'][l.tier] : l.kind === 'corpse' ? `${ANIMALS[l.an]?.name || 'Animal'} Corpse` : 'Backpack', slots: l.slots };
    return null;
  }
  onOpen(p, m) {
    const id = String(m.id);
    const c = this.getContainer(id);
    if (!c || !p.alive || dist3(c.obj, p) > 4.5) return;
    p.openCont = id;
    this.send(p, { t: 'cont', id, title: c.title, slots: c.slots, st: c.obj.q ? 1 : 0 });
  }
  // pick up everything from a dropped bag / item
  onTake(p, m) {
    const l = this.loot.get(String(m.id));
    if (!l || l.kind !== 'bag' || !p.alive || dist3(l, p) > 4.5) return;
    let got = false;
    l.slots.forEach((st, i) => {
      if (!st) return;
      const left = Inv.addStack(p.inv, st);
      if (left < st.n) { got = true; this.send(p, { t: 'gain', id: st.id, n: st.n - left }); }
      if (left <= 0) l.slots[i] = null; else st.n = left;
    });
    if (!got) return this.toast(p, 'Inventory full');
    this.sendInv(p);
    this.afterContainerChange(l.id);
  }
  pushContainer(id) {
    const c = this.getContainer(id);
    for (const p of this.players.values()) if (p.online && p.openCont === id) this.send(p, { t: 'cont', id, title: c ? c.title : '', slots: c ? c.slots : null, st: c && c.obj.q ? 1 : 0 });
  }
  afterContainerChange(id) {
    const l = this.loot.get(id);
    if (l) {
      const empty = Inv.isEmpty(l.slots);
      if (empty && (l.kind === 'bag' || l.kind === 'corpse')) { this.delLoot(l); this.pushContainer(id); return; }
      if (empty && l.kind === 'crate' && !l.respawn) { l.respawn = now() + CRATE_RESPAWN; }
      this.updLoot(l);
    }
    this.pushContainer(id);
  }

  // Generic item move between player inv ('p'), armor ('a') and open container ('c').
  onMove(p, m) {
    if (!p.alive) return;
    const ref = (r) => {
      if (!r) return null;
      if (r.c === 'p') return { arr: p.inv, i: num(r.i, -1) | 0 };
      if (r.c === 'a') return { arr: p.armor, i: ARMOR_SLOTS.includes(r.i) ? r.i : null, armor: true };
      if (r.c === 'c' && p.openCont) {
        const c = this.getContainer(p.openCont);
        if (!c || dist3(c.obj, p) > 5) return null;
        return { arr: c.slots, i: num(r.i, -1) | 0, cont: p.openCont };
      }
      return null;
    };
    const A = ref(m.from), B = ref(m.to);
    if (!A || !B || A.i === null || B.i === null) return;
    if (!A.armor && (A.i < 0 || A.i >= A.arr.length)) return;
    const src = A.arr[A.i];
    if (!src) return;
    if (B.i === -1) {
      // quick move: to first free slot of target array
      if (B.armor) return;
      const left = Inv.addStack(B.arr, src);
      if (left <= 0) A.arr[A.i] = null; else src.n = left;
    } else {
      if (!B.armor && (B.i < 0 || B.i >= B.arr.length)) return;
      if (B.armor) { const ad = ITEMS[src.id].armor; if (!ad || ad.slot !== B.i) return; }
      const dst = B.arr[B.i];
      if (A.armor && dst) { const ad = ITEMS[dst.id].armor; if (!ad || ad.slot !== A.i) return; }
      const amount = Math.max(1, Math.min(src.n, num(m.n, src.n) | 0));
      if (dst && dst.id === src.id && ITEMS[src.id].stack > 1 && dst !== src) {
        const t = Math.min(ITEMS[src.id].stack - dst.n, amount);
        dst.n += t; src.n -= t;
        if (src.n <= 0) A.arr[A.i] = null;
      } else if (!dst && amount < src.n) {
        B.arr[B.i] = { ...src, n: amount }; src.n -= amount;
      } else {
        if (A.arr === B.arr && A.i === B.i) return;
        A.arr[A.i] = dst || null; B.arr[B.i] = src;
      }
    }
    this.sendInv(p);
    if (A.cont) this.afterContainerChange(A.cont); else if (B.cont) this.afterContainerChange(B.cont);
  }

  onDrop(p, m) {
    if (!p.alive) return;
    let st = null;
    if (m.c === 'p') { const i = num(m.i, -1) | 0; st = p.inv[i]; if (st) p.inv[i] = null; }
    else if (m.c === 'a' && ARMOR_SLOTS.includes(m.i)) { st = p.armor[m.i]; p.armor[m.i] = null; }
    if (!st) return;
    const fx = p.x + Math.sin(p.yaw) * -1.2, fz = p.z + Math.cos(p.yaw) * -1.2;
    this.dropBag(fx, this.world.ground(fx, fz), fz, [st]);
    this.sendInv(p);
  }

  onEat(p, m) {
    const i = num(m.i, -1) | 0;
    const st = p.inv[i];
    if (!st || !p.alive) return;
    const d = ITEMS[st.id];
    if (d.cat !== 'food' && d.cat !== 'medical') return;
    if (now() - (p.lastEat || 0) < 0.8) return;
    p.lastEat = now();
    if (d.food) p.food = Math.min(100, p.food + d.food);
    if (d.water) p.water = Math.min(100, p.water + d.water);
    if (d.heal) p.hp = Math.max(1, Math.min(this.maxHp(p), p.hp + d.heal));
    st.n -= 1; if (st.n <= 0) p.inv[i] = null;
    this.sendInv(p); this.sendStats(p);
  }
  onDrink(p) {
    if (!p.alive || now() - (p.lastDrink || 0) < 0.7) return;
    const g = this.world.ground(p.x, p.z);
    if (g > 0.2 || p.y > 1.8) return;
    p.lastDrink = now();
    p.water = Math.min(100, p.water + 15);
    // the ocean is salty: rivers & lakes inland are fresh
    if (Math.hypot(p.x, p.z) > HALF * 0.8) { p.water = Math.max(0, p.water - 10); p.hp -= 2; this.toast(p, 'Salt water! Find a river or lake.'); }
    this.sendStats(p);
  }

  onThrow(p, m) {
    let sel = num(m.sel) | 0;
    if (m.id && ITEMS[m.id]?.explosive && p.inv[sel]?.id !== m.id) sel = p.inv.findIndex((s) => s && s.id === m.id);
    if (sel < 0) return;
    const st = p.inv[sel];
    if (!st || !p.alive) return;
    const ex = ITEMS[st.id].explosive;
    if (!ex) return;
    const pt = Array.isArray(m.pt) ? m.pt.map((v) => num(v)) : null;
    if (!pt || Math.hypot(pt[0] - p.x, pt[1] - p.y - 1.6, pt[2] - p.z) > (ex.thrown ? 32 : 6)) return;
    st.n -= 1; if (st.n <= 0) p.inv[sel] = null;
    this.sendInv(p);
    const e = { id: this.id('E'), type: st.id, x: pt[0], y: pt[1], z: pt[2], at: now() + ex.fuse, owner: p.pid };
    this.explosives.set(e.id, e);
    this.toNear(e.x, e.z, 300, { t: 'ex', id: e.id, type: e.type, p: pt, fuse: ex.fuse });
  }
  tickExplosives() {
    const t = now();
    for (const e of [...this.explosives.values()]) {
      if (e.at > t) continue;
      this.explosives.delete(e.id);
      this.explode(e.x, e.y, e.z, ITEMS[e.type].explosive, this.byPid.get(e.owner), e.id);
    }
  }
  // Area damage to structures, players, animals and vehicles + crater.
  explode(x, y, z, ex, src, id) {
    const e = { x, y, z };
    this.toNear(x, z, 600, { t: 'fx', k: 'expl', id, p: [x, y, z], r: ex.radius });
    for (const s of this.structsNear(x, z)) {
      let best = Infinity;
      for (const b of worldBoxes(s).length ? worldBoxes(s) : [{ x: s.x, y: s.y + 0.5, z: s.z, hx: 0.5, hy: 0.5, hz: 0.5, yaw: 0 }]) {
        const [lx, lz] = invRotY(x - b.x, z - b.z, b.yaw);
        const dx = Math.max(0, Math.abs(lx) - b.hx), dy = Math.max(0, Math.abs(y - b.y) - b.hy), dz = Math.max(0, Math.abs(lz) - b.hz);
        best = Math.min(best, Math.hypot(dx, dy, dz));
      }
      if (best <= ex.radius) this.damageStruct(s, ex.dmg * (1 - 0.5 * best / ex.radius), 'explosive', src);
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (src && src !== p && this.sameClan(src, p)) continue;
      const d = Math.hypot(p.x - x, p.y + 1 - y, p.z - z);
      if (d < ex.radius * 1.6) this.damagePlayer(p, ex.playerDmg * (1 - d / (ex.radius * 1.6)), src || 'an explosion');
    }
    for (const a of [...this.animals.values()]) { const d = dist3(a, e); if (d < ex.radius * 1.6) this.damageAnimal(a, ex.playerDmg, src); }
    const ix = Math.round(x / GRID), iz = Math.round(z / GRID);
    if (y - this.world.ground(x, z) < 1.2 && !this.digBlocked(ix, iz)) this.editTerrain(ix, iz, -ex.radius * 0.18);
    for (const v of this.vehicles.values()) { const d = dist3(v, e); if (d < ex.radius * 1.6) this.damageVehicle(v, ex.dmg * 0.6 * (1 - d / (ex.radius * 1.6))); }
  }


  onChat(p, m) {
    const msg = String(m.m || '').replace(/[<>]/g, '').slice(0, 200).trim();
    if (!msg) return;
    if (msg.startsWith('/') && !msg.startsWith('/c ') && process.env.DEV) return this.devCommand(p, msg.slice(1).split(/\s+/));
    if (msg.startsWith('/c ')) {
      const c = this.clans.get(p.clan);
      if (!c) return this.toast(p, 'You are not in a clan');
      for (const pid of c.members) this.send(this.byPid.get(pid), { t: 'chat', from: `[${c.tag}] ${p.name}`, m: msg.slice(3), clan: 1 });
      return;
    }
    this.toAll({ t: 'chat', from: this.displayName(p), m: msg });
  }

  // ------------------------------------------------------------ clans
  sameClan(a, b) { return !!(a && b && a.clan && a.clan === b.clan && this.clans.has(a.clan)); }
  tcAuthed(tc, p) { return tc.auth.includes(p.pid) || (!!p.clan && tc.auth.some((pid) => this.sameClan(p, this.byPid.get(pid)))); }
  displayName(p) { const c = this.clans.get(p.clan); return c ? `[${c.tag}] ${p.name}` : p.name; }
  clanInfo(p) {
    const c = this.clans.get(p.clan);
    const invites = [...this.clans.values()].filter((k) => k.invites.includes(p.pid)).map((k) => ({ id: k.id, name: k.name, tag: k.tag, members: k.members.length }));
    const online = [...this.players.values()].filter((o) => o.online && o !== p).map((o) => ({ pid: o.pid, name: o.name, clan: this.clans.get(o.clan)?.tag || '' }));
    this.send(p, { t: 'claninfo', invites, online, clan: c ? { id: c.id, name: c.name, tag: c.tag, leader: c.leader, members: c.members.map((pid) => { const o = this.byPid.get(pid); return { pid, name: o?.name || '?', online: !!o?.online, alive: !!o?.alive }; }) } : null });
  }
  clanBroadcast(c) { for (const pid of c.members) { const o = this.byPid.get(pid); if (o?.online) this.clanInfo(o); } }
  onClan(p, m) {
    const a = String(m.a || '');
    let c = this.clans.get(p.clan);
    if (a === 'info') return this.clanInfo(p);
    if (a === 'create') {
      if (c) return this.toast(p, 'Leave your current clan first');
      const name = String(m.name || '').replace(/[<>&"]/g, '').trim().slice(0, 20);
      const tag = String(m.tag || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
      if (name.length < 3 || tag.length < 2) return this.toast(p, 'Clan name needs 3+ characters and the tag 2-5 letters/numbers');
      if ([...this.clans.values()].some((k) => k.tag === tag || k.name.toLowerCase() === name.toLowerCase())) return this.toast(p, 'That clan name or tag is taken');
      c = { id: this.id('K'), name, tag, leader: p.pid, members: [p.pid], invites: [] };
      this.clans.set(c.id, c); p.clan = c.id;
      this.toAll({ t: 'chat', from: '', m: `⚑ ${p.name} founded the clan [${tag}] ${name}` });
      return this.clanBroadcast(c);
    }
    if (a === 'accept' || a === 'decline') {
      const k = this.clans.get(String(m.id));
      if (!k || !k.invites.includes(p.pid)) return this.clanInfo(p);
      k.invites = k.invites.filter((x) => x !== p.pid);
      if (a === 'decline') return this.clanInfo(p);
      if (c) return this.toast(p, 'Leave your current clan first');
      if (k.members.length >= 12) return this.toast(p, 'That clan is full (12 members)');
      k.members.push(p.pid); p.clan = k.id;
      for (const pid of k.members) this.send(this.byPid.get(pid), { t: 'chat', from: '', m: `⚑ ${p.name} joined [${k.tag}]`, clan: 1 });
      return this.clanBroadcast(k);
    }
    if (!c) return this.toast(p, 'You are not in a clan');
    if (a === 'invite') {
      const target = [...this.players.values()].find((o) => o.pid === num(m.pid) || (m.name && o.name.toLowerCase() === String(m.name).toLowerCase()));
      if (!target || target === p) return this.toast(p, 'Player not found (they must have joined the server before)');
      if (target.clan === c.id) return this.toast(p, 'Already in your clan');
      if (!c.invites.includes(target.pid)) c.invites.push(target.pid);
      this.toast(p, `Invited ${target.name}`);
      if (target.online) { this.toast(target, `⚑ ${p.name} invited you to [${c.tag}] ${c.name} — press L to answer`); this.clanInfo(target); }
      return this.clanInfo(p);
    }
    if (a === 'leave' || (a === 'kick' && c.leader === p.pid)) {
      const pid = a === 'leave' ? p.pid : num(m.pid);
      if (!c.members.includes(pid)) return;
      c.members = c.members.filter((x) => x !== pid);
      const o = this.byPid.get(pid);
      if (o) { o.clan = null; this.clanInfo(o); if (a === 'kick') this.toast(o, `You were removed from [${c.tag}]`); }
      if (!c.members.length) { this.clans.delete(c.id); return; }
      if (c.leader === pid) c.leader = c.members[0];
      for (const q of c.members) this.send(this.byPid.get(q), { t: 'chat', from: '', m: `⚑ ${o?.name || 'A member'} ${a === 'kick' ? 'was kicked from' : 'left'} [${c.tag}]`, clan: 1 });
      return this.clanBroadcast(c);
    }
    if (a === 'promote' && c.leader === p.pid && c.members.includes(num(m.pid))) { c.leader = num(m.pid); return this.clanBroadcast(c); }
  }

  // Developer / admin commands (only when the server runs with DEV=1)
  devCommand(p, [cmd, a, b, c]) {
    if (cmd === 'tp') {
      const x = num(a), z = num(b);
      this.teleport(p, x, this.world.ground(x, z) + 1, z);
      this.updateRegions(p, true);
    } else if (cmd === 'tppoi') {
      const pois = this.world.allPOIs().filter((q) => !a || q.type === a);
      const q = pois[Math.floor(Math.random() * pois.length)];
      if (q) this.devCommand(p, ['tp', q.x + 30, q.z + 30]);
      this.toast(p, q ? `Teleported to ${q.name}` : 'No POI');
    } else if (cmd === 'give' && ITEMS[a]) { this.give(p, a, Math.max(1, num(b, 1))); this.sendInv(p); }
    else if (cmd === 'kit') {
      for (const [id, n] of [['wood', 2000], ['stone', 2000], ['metal_frags', 1000], ['hqm', 100], ['cloth', 300], ['leather', 200], ['scrap', 500], ['fuel', 200], ['building_plan', 1], ['hammer', 1], ['rifle', 1], ['rifle_ammo', 120], ['c4', 4], ['satchel', 6], ['wheel', 4], ['engine_parts', 2], ['tool_cupboard', 1], ['wood_door', 2], ['workbench3', 1], ['furnace', 1], ['metal_chest', 1], ['metal_mask', 1], ['metal_legs', 1]]) this.give(p, id, n, false);
      this.sendInv(p);
    } else if (cmd === 'day') { this.day = Math.max(0, Math.min(0.999, num(a, 0.5))); this.toAll({ t: 'time', day: this.day }); }
    else if (cmd === 'heal') { p.hp = this.maxHp(p); p.food = 100; p.water = 100; this.sendStats(p); }
    else this.toast(p, 'Commands: /tp x z · /tppoi [type] · /give id n · /kit · /day 0-1 · /heal');
  }

  // ------------------------------------------------------------ vehicles
  onVehicleEnter(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || !p.alive || p.vehicle) return;
    if (dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5) return;
    if (v.broken) return this.toast(p, 'This vehicle is broken — repair it first');
    let seat = v.seats.indexOf(0);
    if (m.seat !== undefined && v.seats[num(m.seat) | 0] === 0) seat = num(m.seat) | 0;
    if (seat < 0) return this.toast(p, 'No free seats');
    v.seats[seat] = p.pid;
    p.vehicle = { id: v.id, seat };
    this.send(p, { t: 'v_seat', id: v.id, seat, v: this.sVehicleFull(v) });
  }
  exitVehicle(p, pos) {
    if (!p.vehicle) return;
    const v = this.vehicles.get(p.vehicle.id);
    if (v) { const i = v.seats.indexOf(p.pid); if (i >= 0) v.seats[i] = 0; if (i === 0) { v.vel = [0, 0, 0]; } }
    p.vehicle = null;
    if (Array.isArray(pos) && v) {
      const x = num(pos[0], p.x), y = num(pos[1], p.y), z = num(pos[2], p.z);
      if (Math.hypot(x - v.x, z - v.z) < 8) { p.x = x; p.y = y; p.z = z; }
    }
    this.send(p, { t: 'v_seat', id: null });
  }
  onVehicleState(p, m) {
    if (!p.vehicle || p.vehicle.seat !== 0) return;
    const v = this.vehicles.get(p.vehicle.id);
    if (!v || !Array.isArray(m.p) || !Array.isArray(m.q)) return;
    const nx = num(m.p[0], v.x), ny = num(m.p[1], v.y), nz = num(m.p[2], v.z);
    const t = now(), dt = Math.max(0.03, t - (v.lastSt || t));
    if (Math.hypot(nx - v.x, nz - v.z) > 60 * dt + 5) return; // reject teleports
    v.lastSt = t;
    v.x = nx; v.y = ny; v.z = nz;
    v.q = m.q.slice(0, 4).map((x) => num(x));
    v.vel = Array.isArray(m.v) ? m.v.slice(0, 3).map((x) => num(x)) : [0, 0, 0];
    v.steer = num(m.s); v.rpm = num(m.r); v.thr = num(m.th);
    if (Math.abs(v.thr) > 0.05) { v.fuel = Math.max(0, v.fuel - VEHICLES[v.type].fuelUse * dt * Math.abs(v.thr)); }
    for (const pid of v.seats) { const o = this.byPid.get(pid); if (o) { o.x = v.x; o.y = v.y; o.z = v.z; this.updateRegions(o); } }
  }
  onVehicleFuel(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5) return;
    const def = VEHICLES[v.type];
    const room = Math.floor(def.fuelCap - v.fuel);
    const n = Math.min(room, Inv.count(p.inv, 'fuel'));
    if (n <= 0) return this.toast(p, room <= 0 ? 'Tank is full' : 'You have no Low Grade Fuel');
    Inv.remove(p.inv, 'fuel', n);
    v.fuel += n;
    this.sendInv(p);
    this.toast(p, `⛽ Added ${n} fuel (${Math.floor(v.fuel)}/${def.fuelCap})`);
  }
  onVehicleRepair(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5 || !p.alive) return;
    const def = VEHICLES[v.type];
    if (!v.broken) {
      // field repair with hammer: metal fragments restore health
      if (v.hp >= def.hp) return this.toast(p, 'Vehicle is in perfect condition');
      const n = Math.min(Inv.count(p.inv, 'metal_frags'), Math.ceil((def.hp - v.hp) / 5));
      if (n <= 0) return this.toast(p, 'Need Metal Fragments to patch it up');
      Inv.remove(p.inv, 'metal_frags', n); v.hp = Math.min(def.hp, v.hp + n * 5);
      this.sendInv(p); this.toast(p, `🔧 Patched to ${Math.floor(v.hp)}/${def.hp}`);
      return;
    }
    // install whatever parts we have
    let installed = [];
    for (const k in v.needs) {
      const n = Math.min(v.needs[k], Inv.count(p.inv, k));
      if (n > 0) { Inv.remove(p.inv, k, n); v.needs[k] -= n; installed.push(`${n} ${ITEMS[k].name}`); }
      if (v.needs[k] <= 0) delete v.needs[k];
    }
    if (!Object.keys(v.needs).length) {
      v.broken = false; v.hp = def.hp;
      if (v.fuel < 5) v.fuel = 5;
      this.toast(p, `✅ ${def.name} repaired! Add Low Grade Fuel and drive.`);
      this.addXp(p, 20);
      this.toNear(v.x, v.z, 60, { t: 'fx', k: 'upgrade', p: [v.x, v.y, v.z], tier: 3 });
    } else if (installed.length) this.toast(p, `Installed ${installed.join(', ')}`);
    else this.toast(p, `Still needs: ${Object.entries(v.needs).map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(', ')}`);
    this.sendInv(p);
  }
  onVehicleCrash(p, m) {
    if (!p.vehicle) return;
    const v = this.vehicles.get(p.vehicle.id);
    if (!v) return;
    const dmg = Math.min(400, Math.max(0, num(m.dmg)));
    this.damageVehicle(v, dmg);
    if (dmg > 40) for (const pid of v.seats) { const o = this.byPid.get(pid); if (o) this.damagePlayer(o, dmg * 0.15, 'a car crash'); }
  }
  onVehicleHit(p, m) {
    if (!p.vehicle || p.vehicle.seat !== 0) return;
    const v = this.vehicles.get(p.vehicle.id);
    const spd = Math.min(40, Math.max(0, num(m.spd)));
    if (!v || spd < 4) return;
    if (m.k === 'p') { const o = this.byPid.get(num(m.id)); if (o && o !== p && dist3(o, v) < 6 && !o.vehicle) this.damagePlayer(o, spd * 4, p); }
    if (m.k === 'a') { const a = this.animals.get(String(m.id)); if (a && dist3(a, v) < 6) this.damageAnimal(a, spd * 6, p); }
  }
  sVehicleFull(v) { return { id: v.id, type: v.type, p: [v.x, v.y, v.z], q: v.q, vel: v.vel, hp: v.hp, fuel: v.fuel, broken: v.broken, needs: v.needs }; }

  // ------------------------------------------------------------ animals
  tickAnimals(dt) {
    const t = now();
    const online = [...this.players.values()].filter((p) => p.online && p.alive);
    // spawn
    for (const p of online) {
      let near = 0;
      for (const a of this.animals.values()) if (dist2(a, p) < 220 * 220) near++;
      if (near < 4 && Math.random() < 0.05 && this.animals.size < 200) {
        const ang = Math.random() * Math.PI * 2, r = 110 + Math.random() * 80;
        const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
        const g = this.world.ground(x, z);
        if (g < 1 || this.inPOI(x, z)) continue;
        const b = this.world.biome(x, z);
        const pool = b === BIOME.FOREST ? ['deer', 'deer', 'boar', 'wolf', 'bear'] : b === BIOME.SNOW ? ['wolf', 'wolf', 'bear', 'deer'] : b === BIOME.GRASS ? ['deer', 'boar', 'boar', 'wolf'] : b === BIOME.SWAMP ? ['boar', 'wolf'] : b === BIOME.DESERT ? ['boar'] : ['deer'];
        const type = pool[Math.floor(Math.random() * pool.length)];
        const id = this.id('A');
        this.animals.set(id, { id, type, x, y: g, z, yaw: Math.random() * 6.28, hp: ANIMALS[type].hp, st: 0, tx: x, tz: z, until: 0, lastAtk: 0 });
      }
    }
    for (const a of [...this.animals.values()]) {
      const def = ANIMALS[a.type];
      let nearest = null, nd = Infinity;
      for (const p of online) { if (p.vehicle) continue; const d = Math.sqrt(dist2(a, p)); if (d < nd) { nd = d; nearest = p; } }
      let anyNear = false;
      for (const p of online) if (dist2(a, p) < 320 * 320) { anyNear = true; break; }
      if (!anyNear) { this.animals.delete(a.id); continue; }
      let speed = 0, tx = a.tx, tz = a.tz;
      const hurt = t - (a.hurtT || 0) < 10;
      const attacker = hurt ? this.byPid.get(a.hurtBy) : null;
      const isNight = this.day > 0.78 || this.day < 0.2;
      let mode = 'wander';
      if (def.aggro === true && nearest && nd < (isNight ? 40 : 28)) mode = 'chase';
      else if (def.aggro === 'defensive' && attacker && attacker.alive) { mode = 'chase'; nearest = attacker; nd = Math.sqrt(dist2(a, attacker)); }
      else if (def.aggro === true && attacker && attacker.alive) { mode = 'chase'; nearest = attacker; nd = Math.sqrt(dist2(a, attacker)); }
      else if (!def.aggro && nearest && (nd < 22 || hurt)) mode = 'flee';
      if (a.blocked > 0) { a.blocked -= dt; mode = 'wander'; }
      if (mode === 'chase' && nd > 70) mode = 'wander';
      if (mode === 'chase') {
        tx = nearest.x; tz = nearest.z; speed = def.speed; a.st = 1;
        if (nd < 2 + def.size && Math.abs(nearest.y - a.y) < 2.5) {
          speed = 0; a.st = 2;
          if (t - a.lastAtk > 1.3) { a.lastAtk = t; this.damagePlayer(nearest, def.dmg, `a ${def.name.toLowerCase()}`); this.toNear(a.x, a.z, 60, { t: 'fx', k: 'bite', id: a.id }); }
        }
      } else if (mode === 'flee') {
        tx = a.x + (a.x - nearest.x); tz = a.z + (a.z - nearest.z); speed = def.speed; a.st = 1;
      } else {
        a.st = 0;
        if (t > a.until || Math.hypot(a.tx - a.x, a.tz - a.z) < 1) { a.tx = a.x + (Math.random() - 0.5) * 40; a.tz = a.z + (Math.random() - 0.5) * 40; a.until = t + 4 + Math.random() * 8; a.idle = Math.random() < 0.4; }
        tx = a.tx; tz = a.tz; speed = a.idle ? 0 : def.speed * 0.25;
      }
      if (speed > 0) {
        const dx = tx - a.x, dz = tz - a.z, l = Math.hypot(dx, dz) || 1;
        const desired = Math.atan2(dx, dz);
        let dy = desired - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        a.yaw += Math.max(-4 * dt, Math.min(4 * dt, dy));
        const nx = a.x + Math.sin(a.yaw) * speed * dt, nz = a.z + Math.cos(a.yaw) * speed * dt;
        const g = this.world.ground(nx, nz);
        if (g < 0.2 || this.blockedAt(nx, g, nz)) { a.tx = a.x - dx; a.tz = a.z - dz; a.until = t + 3; a.blocked = 1.5; }
        else { a.x = nx; a.z = nz; a.y = g; }
      }
    }
  }
  blockedAt(x, y, z) {
    for (const s of this.structsNear(x, z, 0)) {
      for (const b of worldBoxes(s)) {
        const [lx, lz] = invRotY(x - b.x, z - b.z, b.yaw);
        if (Math.abs(lx) < b.hx + 0.5 && Math.abs(lz) < b.hz + 0.5 && y + 1 > b.y - b.hy && y < b.y + b.hy) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ main loop
  tick() {
    const t = now();
    const dt = Math.min(0.5, t - this.lastTick);
    this.lastTick = t;
    this.day = (this.day + dt / DAY_LENGTH) % 1;
    this.tickExplosives();
    this.tickCrafting();
    this.tickAnimals(dt);
    this.acc.stats += dt; this.acc.save += dt; this.acc.slow += dt;
    if (this.acc.stats >= 1) { this.tickStats(this.acc.stats); this.acc.stats = 0; }
    if (this.acc.slow >= 15) { this.tickSlow(); this.acc.slow = 0; }
    if (this.acc.save >= 60 && this.onSave) { this.acc.save = 0; this.onSave(); }
    this.sendSnapshots();
    for (const p of this.players.values()) if (p.invDirty && p.online) this.sendInv(p);
  }

  tickStats(dt) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (!p.online) continue; // sleepers don't starve
      p.food = Math.max(0, p.food - 0.045 * dt);
      p.water = Math.max(0, p.water - 0.07 * dt);
      if (p.food <= 0 || p.water <= 0) { p.hp -= 0.6 * dt; if (p.hp <= 0) { this.killPlayer(p, p.food <= 0 ? 'starvation' : 'dehydration'); continue; } }
      else if (p.food > 60 && p.water > 60 && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + 0.25 * dt);
      // cold: tundra / night / water
      const b = this.world.biome(p.x, p.z);
      const night = this.day > 0.78 || this.day < 0.2;
      let cold = 0;
      if (b === BIOME.SNOW) cold += 0.7;
      if (night) cold += 0.25;
      if (p.y < 0.5 && this.world.ground(p.x, p.z) < 0) cold += 0.3;
      let warmth = 0;
      for (const s of ARMOR_SLOTS) if (p.armor[s]) warmth += ITEMS[p.armor[s].id].armor.cold;
      for (const s of this.structsNear(p.x, p.z, 0)) if ((s.type === 'campfire' || s.type === 'furnace') && dist3(s, p) < 5) warmth += 1;
      p.cold = Math.max(0, cold - warmth);
      if (p.cold > 0.5) { p.hp -= (p.cold - 0.5) * 1.2 * dt; if (p.hp <= 0) { this.killPlayer(p, 'the cold'); continue; } }
      this.sendStats(p);
    }
    for (const p of this.players.values()) if (p.online && p.queue.length) this.sendQueue(p);
  }

  tickSlow() {
    const t = now();
    for (const [id, st] of this.nodeState) {
      if (st.hp <= 0 && st.until < t) {
        this.nodeState.delete(id);
        const k = id.split('_').slice(0, 2).join(',');
        this.region(k).d.delete(id);
        this.toRegion(k, { t: 'node', id, dep: 0 });
      } else if (st.hp > 0 && !st.until) { st.until = t + NODE_RESPAWN; }
      else if (st.hp > 0 && st.until < t) this.nodeState.delete(id);
    }
    for (const l of [...this.loot.values()]) {
      if (l.expires && l.expires < t) { this.delLoot(l); continue; }
      if (l.kind === 'crate' && l.respawn && l.respawn < t) {
        let near = false;
        for (const p of this.players.values()) if (p.online && dist2(p, l) < 60 * 60) { near = true; break; }
        if (!near) { l.slots = this.lootSlots(l.tier); l.respawn = 0; this.updLoot(l); }
      }
    }
    this.toAll({ t: 'time', day: this.day });
  }

  sendSnapshots() {
    const R2 = SNAP_RANGE * SNAP_RANGE;
    const all = [...this.players.values()];
    for (const p of all) {
      if (!p.online || !p.ws || p.ws.readyState !== 1) continue;
      const pl = [], ve = [], an = [];
      for (const o of all) {
        if (o === p || !o.alive || dist2(o, p) > R2) continue;
        const held = o.inv[o.sel]?.id || '';
        const flags = (o.cr ? 1 : 0) | (!o.online ? 2 : 0) | (o.vehicle ? 4 : 0) | (o.air ? 8 : 0) | (o.spr ? 16 : 0) | (this.sameClan(o, p) ? 32 : 0);
        pl.push([o.pid, r2(o.x), r2(o.y), r2(o.z), r2(o.yaw), r2(o.pitch), flags, held, ARMOR_SLOTS.map((s) => o.armor[s]?.id || '').join(','), o.name, o.vehicle ? o.vehicle.id : '', o.vehicle ? o.vehicle.seat : -1, o.lookStr || '', this.clans.get(o.clan)?.tag || '']);
      }
      for (const v of this.vehicles.values()) {
        if (dist2(v, p) > R2) continue;
        ve.push([v.id, v.type, r2(v.x), r2(v.y), r2(v.z), v.q.map((x) => Math.round(x * 1e4) / 1e4), Math.ceil(v.hp), v.broken ? 1 : 0, r2(v.steer || 0), r2(v.rpm || 0), v.seats[0] || 0, Math.floor(v.fuel), v.broken ? v.needs : 0, v.vel ? v.vel.map(r2) : [0, 0, 0]]);
      }
      for (const a of this.animals.values()) {
        if (dist2(a, p) > R2) continue;
        an.push([a.id, a.type, r2(a.x), r2(a.y), r2(a.z), r2(a.yaw), a.st, Math.ceil(a.hp)]);
      }
      p.ws.send(JSON.stringify({ t: 'snap', pl, ve, an }));
    }
  }
}
