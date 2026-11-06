// Authoritative game simulation: players, inventory, crafting, building, raiding,
// loot, animals, vehicles and persistence.
import crypto from 'crypto';
import { World, CHUNK, GRID, POI_FLAT, HALF, BIOME, chunkKey } from '../shared/worldgen.js';
import { STATION_KINDS, STATION_OUTPUT_SLOTS, stationRecipes, FIST, DIG, ITEMS, RECIPES, NODES, NODE_RESPAWN, rollLoot, STATION_PROVIDERS, STATION_RANGE, ANIMALS, INV_SIZE, HOTBAR, newStack, ARMOR_SLOTS, backpackRows } from '../shared/items.js';
import { G, LEVEL_H, slotKey, pieceMaxHp, REINFORCE, reinforceCost, TIERS, PIECES, pieceCost, pieceTransform, canPlaceAny, buildIndex, unsupportedPieces, worldBoxes, BUILD_REACH, PRIV_RADIUS, rotY, invRotY } from '../shared/building.js';
import { VEHICLES, VEHICLE_ENTER_RANGE, SPAWNABLE, restHeight, quatRotate, quatYaw, subStats } from '../shared/vehicles.js';
import { hash3, mulberry32 } from '../shared/noise.js';
import * as Inv from './inv.js';
import { seasonInfo, SEASON_DAYS, SEASONS, SEASON_NAMES, FOOTPRINT_LIFE } from '../shared/season.js';
import { Caves, CAVE_ZONE, CAVE_ARRIVE, CAVE_TOP } from '../shared/caves.js';
import { dryCells, cellAt, sealedRooms, hullIntegrity, roomOfCell, HULL_BASE } from '../shared/sealed.js';
import { IceField, iceFrozen, ICE_TOP, ICE_HOLE_R, ICE_REGEN, BREATH_MAX, breathDrain } from '../shared/ice.js';
import { gunStats, canMod, MODS, FINISHES, modsKey, isModdable } from '../shared/gunmods.js';
import { playerSpec, canPlace, rowOf, sizeOf, occupancy, specOf } from '../shared/grid.js';
import { PAINT_COLORS, DECALS, DECAL_SIZES, MAX_DECALS, SPRAY_RANGE } from '../shared/paint.js';
import { sanitizeLook, encodeLook } from '../shared/look.js';

const VIEW_REGIONS = 2;           // regions (128m) around the player that are streamed
const SNAP_RANGE = 420;           // dynamic entity visibility (m)
const DAY_LENGTH = 40 * 60;       // seconds per full day
const TICK = 1 / 10;
const MELEE_MUL = [1, 0.2, 0.04, 0.015, 0.006, 0.009];
const BULLET_MUL = [0.5, 0.04, 0.005, 0, 0, 0];
const DOOR_TIER = { wood: 1, metal: 3, armored: 4, sealed: 5 };
const CRATE_RESPAWN = 12 * 60;
const BAG_LIFETIME = 25 * 60;
const CORPSE_LIFETIME = 6 * 60;
const STARTER = []; // you wake up with nothing

const now = () => Date.now() / 1000;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const dist3 = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
function hashPassword(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }
function checkPassword(pass, a) {
  const h = Buffer.from(hashPassword(pass, a.salt), 'hex'), w = Buffer.from(a.hash, 'hex');
  return h.length === w.length && crypto.timingSafeEqual(h, w);
}
const WEATHER_TARGETS = { clear: { cloud: 0.12, rain: 0, storm: 0, wind: 0.3 }, overcast: { cloud: 0.75, rain: 0, storm: 0, wind: 0.5 }, rain: { cloud: 0.9, rain: 0.65, storm: 0.05, wind: 0.65 }, storm: { cloud: 1, rain: 1, storm: 1, wind: 1 } };
const ADMIN_HELP = 'Admin: /season spring|summer|autumn|winter [late] · /weather clear|overcast|rain|storm · /cave — drop into the caves below you · /resetserver — wipe the world (asks for confirmation) · /items [search] — item spawner (click to get items) · /give <item> [amount] (item id or name, e.g. /give assault_rifle or /give c4 10) · /tpdeath — teleport to where you last died · /tp x z [y] · /tppoi [type] · /kit · /heal · /day 0-1';
const regionOf = (x, z) => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
const rkey = (x, z) => { const [a, b] = regionOf(x, z); return chunkKey(a, b); };
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export const DEFAULT_SETTINGS = { pvp: true, dayMinutes: 40, seasonDays: 2, gather: 1, hunger: 1, animals: true, sharks: true, difficulty: 'normal', creative: false, maxPlayers: 24 };
export function cleanSettings(x = {}, base = DEFAULT_SETTINGS) {
  const n = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  return {
    pvp: x.pvp === undefined ? base.pvp : !!x.pvp,
    dayMinutes: Math.round(n(x.dayMinutes, 5, 180, base.dayMinutes)),
    seasonDays: Math.round(n(x.seasonDays, 1, 14, base.seasonDays)),
    gather: Math.round(n(x.gather, 0.25, 10, base.gather) * 100) / 100,
    hunger: Math.round(n(x.hunger, 0, 4, base.hunger) * 100) / 100,
    animals: x.animals === undefined ? base.animals : !!x.animals,
    sharks: x.sharks === undefined ? base.sharks : !!x.sharks,
    difficulty: ['peaceful', 'normal', 'hardcore'].includes(x.difficulty) ? x.difficulty : base.difficulty,
    creative: x.creative === undefined ? base.creative : !!x.creative,
    maxPlayers: Math.round(n(x.maxPlayers, 1, 64, base.maxPlayers)),
  };
}

export class Game {
  constructor({ seed = 1337, saved = null, settings = null, ownerHash = null }) {
    this.seed = seed;
    this.settings = cleanSettings(settings || {});
    this.ownerHash = ownerHash; // the server owner (hash of their device token) is its admin
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
    this.activeStations = new Set();
    this.caves = new Caves(seed);
    this.caveOpened = new Set();  // entrance ids whose arrival chamber has been carved
    this.accounts = new Map();  // lower-case name -> {name, salt, hash, token, created}
    this.authFails = new Map(); // ip -> {n, until}
    this.clans = new Map();     // id -> {id, name, tag, leader, members:[pid], invites:[pid]}
    this.spawned = new Set();   // POI ids / wreck cells that have spawned their content
    this.nextId = 1;
    this.nextPid = 1;
    this.day = 0.3;
    this.year = 1.05;            // starts in early summer; 0 spring, 1 summer, 2 autumn, 3 winter
    this.prints = new Map();     // region key -> [[x, z, yaw, time, kind]] footprints / tyre tracks in the snow
    this.newPrints = new Map();
    this.ice = new IceField(this.world); // frozen lakes in winter; holes: {id, x, z, r, born}
    this.caves.seaAbove = (x, z) => this.world.ground(x, z) < -8 && !this.ice.inland(x, z); // caves under the sea are flooded
    this.chunkCache = new Map();
    this.load(saved);
    this.ice.setFrozen(iceFrozen(seasonInfo(this.year)));
    this.lastTick = now();
    this.acc = { stats: 0, save: 0, slow: 0, weather: 0 };
    // weather: clear -> overcast -> rain -> storm cycle shared by everyone
    this.weather = { state: 'clear', until: now() + 300 + Math.random() * 600, cloud: 0.1, rain: 0, storm: 0, wind: 0.3, windDir: Math.random() * 6.28 };
  }

  get dayLen() { return this.settings.dayMinutes * 60; }
  rulesMsg() { const st = this.settings; return { pvp: st.pvp, creative: st.creative, difficulty: st.difficulty }; }
  // new settings from the owner, live
  applySettings(st) {
    this.settings = cleanSettings(st, this.settings);
    for (const p of this.players.values()) if (p.online) this.send(p, { t: 'rules', rules: this.rulesMsg(), dayLen: this.dayLen, yearLen: this.dayLen * this.settings.seasonDays, day: this.day, year: this.year });
    if (!this.settings.animals) for (const a of [...this.animals.values()]) if (a.type !== 'shark') this.animals.delete(a.id);
    if (!this.settings.sharks) for (const a of [...this.animals.values()]) if (a.type === 'shark') this.animals.delete(a.id);
  }
  onlineCount() { let n = 0; for (const p of this.players.values()) if (p.online) n++; return n; }
  id(prefix) { return `${prefix}${(this.nextId++).toString(36)}`; }

  region(key) {
    let r = this.regions.get(key);
    if (!r) { r = { s: new Set(), l: new Set(), d: new Set() }; this.regions.set(key, r); }
    return r;
  }

  // ------------------------------------------------------------ persistence
  load(d) {
    if (!d) return;
    for (const a of d.accounts || []) this.accounts.set(a.name.toLowerCase(), a);
    if (d.customSeed) this.customSeed = true;
    try {
      if (d.seed !== this.seed) { console.log('[world] seed changed, starting fresh world'); return; }
      this.nextId = d.nextId || 1; this.nextPid = d.nextPid || 1; this.day = d.day ?? 0.3; this.year = d.year ?? 1.05;
      for (const p of d.players || []) { p.ws = null; p.online = false; p.regions = new Set(); p.queue = p.queue || []; p.openCont = null; p.vehicle = null; this.migrateInv(p); this.players.set(p.token, p); this.byPid.set(p.pid, p); }
      this.caves.setMods(d.caveMods || []); for (const k of d.caveOpened || []) this.caveOpened.add(k);
      for (const b of d.buildings || []) this.buildings.set(b.id, b);
      for (const s of d.structs || []) if (s.slots) Inv.normalize(s.slots, { grow: true });
      for (const l of d.loot || []) if (l.slots) Inv.normalize(l.slots, { grow: true });
      for (const s of d.structs || []) { this.structs.set(s.id, s); if (!s.veh) this.region(rkey(s.x, s.z)).s.add(s.id); if (s.queue?.length) this.activeStations.add(s.id); if (s.kind === 'piece') { const m = pieceMaxHp(s.tier, s.reinf); if (s.mhp !== m) { s.hp = Math.max(1, (s.hp / s.mhp) * m); s.mhp = m; } } }
      for (const l of d.loot || []) { this.loot.set(l.id, l); this.region(rkey(l.x, l.z)).l.add(l.id); }
      for (const v of d.vehicles || []) { if (!VEHICLES[v.type]) continue; v.seats = new Array(VEHICLES[v.type].seats.length).fill(0); v.attached = new Set(); if (v.var === undefined) v.var = Math.floor(hash3(v.id.length, v.x | 0, v.z | 0, 3) * 1000); this.vehicles.set(v.id, v); }
      for (const s of this.structs.values()) if (s.veh) { const v = this.vehicles.get(s.veh); if (v) v.attached.add(s.id); else this.structs.delete(s.id); }
      for (const [id, st] of d.nodes || []) this.setNodeState(id, st);
      for (const k of d.spawned || []) this.spawned.add(k);
      for (const c of d.clans || []) this.clans.set(c.id, c);
      for (const [ix, iz, v] of d.terrain || []) this.world.setMod(ix, iz, v);
      if (Array.isArray(d.iceHoles)) this.ice.setHoles(d.iceHoles.filter((h) => now() - h.born < ICE_REGEN));
      console.log(`[world] loaded: ${this.players.size} players, ${this.structs.size} structures, ${this.vehicles.size} vehicles`);
    } catch (e) { console.error('[world] failed to load save:', e.message); }
  }
  // Serializable snapshot of the whole persistent world.
  serialize() {
    const strip = (p) => { const { ws, regions, openCont, vehicle, lastSt, air, spr, sw, fish, dry, tokenHash, ...rest } = p; return rest; };
    const d = {
      seed: this.seed, nextId: this.nextId, nextPid: this.nextPid, day: this.day, year: this.year,
      players: [...this.players.values()].map(strip),
      buildings: [...this.buildings.values()],
      structs: [...this.structs.values()],
      loot: [...this.loot.values()],
      vehicles: [...this.vehicles.values()].map(({ seats, attached, ...v }) => v),
      nodes: [...this.nodeState.entries()],
      spawned: [...this.spawned],
      clans: [...this.clans.values()],
      accounts: [...this.accounts.values()],
      caveMods: this.caves.mods,
      caveOpened: [...this.caveOpened],
      customSeed: !!this.customSeed,
      terrain: this.world.modList(),
      iceHoles: this.ice.holes,
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

  connect(ws, first = null) {
    if (first) setImmediate(() => { try { this.hello(ws, first); } catch (e) { console.error('hello error', e); } });
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
    let token = String(msg.token || '').slice(0, 64);
    const name = String(msg.name || 'Survivor').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Survivor';
    if (token.length < 8) return;
    // ---- accounts: a name with a password can be used from any device
    const pass = typeof msg.pass === 'string' ? msg.pass.slice(0, 72) : '';
    const ip = ws._socket?.remoteAddress || '?';
    const fail = (m) => {
      const f = this.authFails.get(ip) || { n: 0, until: 0 };
      f.n++; if (f.n >= 5) { f.until = now() + 60; f.n = 0; }
      this.authFails.set(ip, f);
      try { ws.send(JSON.stringify({ t: 'authfail', m })); } catch {}
      setTimeout(() => { try { ws.close(4001, 'auth'); } catch {} }, 200);
    };
    if ((this.authFails.get(ip)?.until || 0) > now()) return fail('Too many wrong passwords — wait a minute and try again');
    const key = name.toLowerCase();
    const acct = this.accounts.get(key);
    let created = false;
    if (acct) {
      if (pass) { if (!checkPassword(pass, acct)) return fail(`Wrong password for "${acct.name}"`); token = acct.token; }
      else if (acct.token !== token) return fail(`"${acct.name}" is a protected account — enter its password to sign in`);
    } else if (pass) {
      if (pass.length < 4) return fail('Pick a password of at least 4 characters');
      const salt = crypto.randomBytes(16).toString('hex');
      this.accounts.set(key, { name, salt, hash: hashPassword(pass, salt), token, created: Date.now() });
      created = true;
      console.log(`[account] created "${name}"`);
    }
    try { ws.send(JSON.stringify({ t: 'acct', token, name: acct?.name || name, protected: !!(acct || created), created })); } catch {}
    let p = this.players.get(token);
    if (p && p.online && p.ws && p.ws !== ws) { const old = p.ws; old.player = null; try { old.close(4000, 'replaced'); } catch {} }
    if (!p) {
      const [x, y, z] = this.world.randomSpawn();
      p = { token, pid: this.nextPid++, name, x, y, z, yaw: 0, pitch: 0, hp: 100, food: 80, water: 80, xp: 0, alive: true, inv: Inv.emptySlots(INV_SIZE), armor: { head: null, chest: null, legs: null, back: null }, queue: [], sel: 0, kills: 0, deaths: 0, cr: 0, regions: new Set() };
      this.fixInv(p);
      for (const [id, n] of STARTER) Inv.add(p.inv, id, n, true);
      this.players.set(token, p); this.byPid.set(p.pid, p);
      console.log(`[join] new player ${name} (#${p.pid})`);
    } else console.log(`[join] ${name} (#${p.pid}) returned${p.alive ? '' : ' to find themselves dead'}`);
    p.look = sanitizeLook(msg.look || p.look); p.lookStr = encodeLook(p.look);
    p.name = name; p.ws = ws; p.online = true; p.regions = new Set(); p.openCont = null; p.vehicle = null; p.lastSt = now();
    this.fixInv(p);
    if (p.pendingDrop?.length) { this.dropBag(p.x, p.y, p.z, p.pendingDrop); this.toast(p, '🎒 Inventories got smaller: items that no longer fit are in a bag at your feet. Craft a Small Bag or Backpack for more room.'); } p.pendingDrop = null;
    ws.player = p;
    p.tokenHash = crypto.createHash('sha256').update(String(msg.devToken || msg.token || '')).digest('hex');
    this.send(p, { t: 'welcome', year: this.year, yearLen: this.dayLen * this.settings.seasonDays, wx: this.weatherMsg(), cm: this.caves.mods, ice: this.iceMsg(), terr: this.world.modList(), seq: p.tpSeq || 0, pid: p.pid, seed: this.seed, day: this.day, dayLen: this.dayLen, rules: this.rulesMsg(), p: [p.x, p.y, p.z], yaw: p.yaw, alive: p.alive });
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
      case 'reinforce': return this.onReinforce(p, m);
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
      case 'vst': return this.onVehicleStructs(p, m);
      case 'paint': return this.onPaint(p, m);
      case 'vpaint': return this.onVehiclePaintReq(p, m);
      case 'agive': return this.onAdminGive(p, m);
      case 'reset_world': return this.onResetWorld(p, m);
      case 'gunmod': return this.onGunMod(p, m);
      case 'cave_enter': return this.onCaveEnter(p, m);
      case 'launch': return this.onLaunch(p, m);
      case 'bluehole': return this.onBlueHole(p, m);
      case 'cave_exit': return this.onCaveExit(p, m);
      case 'cavedig': return this.onCaveDig(p, m);
      case 'icebreak': return this.onIceBreak(p, m);
      case 'repair_leak': return this.onRepairLeak(p, m);
      case 'undock': return this.onUndock(p, m);
      case 'dock': return this.onDock(p, m);
      case 'fishcast': return this.onFishCast(p, m);
      case 'fishreel': return this.onFishReel(p, m);
      case 'throwrock': return this.onThrowRock(p, m);
      case 'rockland': return this.onRockLand(p, m);
      case 'look': p.look = sanitizeLook(m.look); p.lookStr = encodeLook(p.look); return;
      case 'fall': if (p.alive && !p.vehicle) this.damagePlayer(p, Math.min(150, Math.max(0, num(m.d))), 'falling'); return;
    }
  }

  // ------------------------------------------------------------ player state
  sendInv(p) { p.invDirty = false; this.send(p, { t: 'inv', inv: p.inv, armor: p.armor }); }
  maxHp(p) { return Math.min(150, 100 + 2 * (this.level(p) - 1)); }
  level(p) { return Math.floor(Math.sqrt((p.xp || 0) / 60)) + 1; }
  gatherMul(p) { return Math.min(2, 1 + 0.04 * (this.level(p) - 1)) * this.settings.gather; }
  addXp(p, n) {
    const l0 = this.level(p);
    p.xp = (p.xp || 0) + n;
    const l1 = this.level(p);
    if (l1 > l0) { this.toast(p, `⭐ Level ${l1}! Max health +2, gather rate +4%`); this.sendStats(p); }
  }
  sendStats(p) {
    this.send(p, { t: 'stats', hp: r2(p.hp), food: r2(p.food), water: r2(p.water), xp: p.xp | 0, lvl: this.level(p), maxhp: this.maxHp(p), cold: p.cold || 0, br: r2(p.breath ?? BREATH_MAX), o2: p.armor?.back?.air !== undefined ? r2(p.armor.back.air) : undefined, kills: p.kills, deaths: p.deaths });
  }
  sendQueue(p) {
    const t = now();
    this.send(p, { t: 'queue', q: p.queue.map((q) => ({ r: q.r, left: Math.max(0, q.end - t), total: RECIPES[q.r].time })) });
  }
  give(p, id, n, notify = true) {
    const left = Inv.add(p.inv, id, n);
    p.invDirty = true;
    if (left > 0) { this.dropBag(p.x, p.y, p.z, [newStack(id, left)]); if (notify) this.toast(p, `🎒 Inventory full — ${ITEMS[id].name} dropped at your feet`); }
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
      } else if (d > (14 + this.rideSpeed(m.on, x, z)) * dt + 4) {
        this.teleport(p, p.x, p.y, p.z);
      } else { p.x = x; p.y = y; p.z = z; }
    }
    p.lastSt = t;
    p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.cr = m.cr ? 1 : 0; p.air = m.air ? 1 : 0; p.spr = m.spr ? 1 : 0; p.sw = m.sw ? 1 : 0;
    p.sel = Math.max(0, Math.min(5, num(m.sel) | 0));
    this.updateRegions(p);
    if (p.y < CAVE_ZONE && t - (p.caveLootT || 0) > 3) { p.caveLootT = t; this.ensureCaveLoot(p); }
    if (!p.vehicle && !p.air) this.footstep(p);
  }

  // speed of the vehicle a player says they're standing on (hauler deck), if plausible
  rideSpeed(id, x, z) {
    const v = id && this.vehicles.get(String(id));
    if (!v || Math.hypot(v.x - x, v.z - z) > VEHICLES[v.type].half[2] + 6) return 0;
    return Math.hypot(v.vel?.[0] || 0, v.vel?.[2] || 0) * 1.3 + 4;
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
      this.send(p, { t: 'rg', k, fp: this.printsMsg(k), s: [...r.s].map((id) => this.sStruct(this.structs.get(id))).filter(Boolean), l: [...r.l].map((id) => this.sLoot(this.loot.get(id))).filter(Boolean), d: [...r.d] });
    }
  }

  // Spawns POI crates/vehicles and random wrecks the first time an area is visited.
  ensureSpawned(cx, cz) {
    const x = (cx + 0.5) * CHUNK, z = (cz + 0.5) * CHUNK;
    const np = this.world.nearestPOI(x, z);
    if (np && np.d < 200 && !this.spawned.has(np.poi.id + ':' + np.poi.type)) {
      const poi = np.poi;
      this.spawned.add(poi.id + ':' + poi.type);
      const lay = this.world.poiLayout(poi);
      lay.loot.forEach((l, i) => {
        const id = `cr_${poi.id}_${poi.type}_${i}`;
        if (this.loot.has(id)) return;
        const y = l.y > poi.y + 0.5 ? l.y : this.world.ground(l.x, l.z);
        this.addLoot({ id, kind: 'crate', tier: l.tier, x: l.x, y, z: l.z, yaw: l.yaw, slots: this.lootSlots(l.tier), respawn: 0 });
      });
      lay.vehicles.forEach((v, i) => this.spawnWreck(`veh_${poi.id}_${poi.type}_${i}`, v.type === 'truck' && hash3(poi.x | 0, poi.z | 0, i, 77) < 0.35 ? 'hauler' : v.type, v.x, v.z, v.yaw));
    }
    const bk = `b_${cx}_${cz}`;
    if (!this.spawned.has(bk)) {
      this.spawned.add(bk);
      // a boat moored at the water's edge now and then (rowboats on lakes, skiffs on the coast)
      if (hash3(cx, cz, 93, this.seed) < 0.06) {
        const rng = mulberry32(Math.floor(hash3(cx, cz, 94, this.seed) * 1e9));
        for (let k = 0; k < 14; k++) {
          const bx = cx * CHUNK + 10 + rng() * 108, bz = cz * CHUNK + 10 + rng() * 108, g = this.world.ground(bx, bz);
          if (g > -1.4 || g < -5) continue;
          let shore = false;
          for (let a = 0; a < 8 && !shore; a++) if (this.world.ground(bx + Math.cos(a * 0.785) * 12, bz + Math.sin(a * 0.785) * 12) > 0.5) shore = true;
          if (!shore) continue;
          const type = this.ice.inland(bx, bz) || rng() < 0.4 ? 'rowboat' : 'motorboat', def = VEHICLES[type];
          const spot = this.findWaterSpot(type, bx, bz, rng() * 6.28);
          if (!spot) continue;
          const id = `boat_${bk}`;
          if (!this.vehicles.has(id)) this.vehicles.set(id, { id, type, x: spot.x, y: spot.y, z: spot.z, q: [0, Math.sin(spot.yaw / 2), 0, Math.cos(spot.yaw / 2)], vel: [0, 0, 0], hp: def.hp, broken: false, needs: {}, fuel: Math.round(def.fuelCap * 0.3), steer: 0, rpm: 0, var: Math.floor(rng() * 1000), seats: new Array(def.seats.length).fill(0), attached: new Set() });
          break;
        }
      }
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
          const types = ['quad', 'buggy', 'truck', 'suv', 'buggy', 'hauler'];
          this.spawnWreck(`veh_${wk}`, types[Math.floor(rng() * 6)], wx, wz, rng() * 6.28);
          // a stash of parts near the wreck
          this.addLoot({ id: `cr_${wk}`, kind: 'crate', tier: 1, x: wx + 3, y: this.world.ground(wx + 3, wz + 2), z: wz + 2, yaw: rng() * 6, slots: this.lootSlots(1), respawn: 0 });
        }
      }
    }
  }
  lootSlots(tier) {
    return Inv.pack(rollLoot(tier).flatMap((it) => { const out = [], mx = ITEMS[it.id].stack || 1; for (let n = it.n; n > 0; n -= mx) out.push(newStack(it.id, Math.min(mx, n))); return out; }), 12);
  }
  spawnWreck(id, type, x, z, yaw) {
    if (this.vehicles.has(id)) return;
    const def = VEHICLES[type];
    const spot = this.findClearSpot(type, x, z, yaw, [0, 4, 8, 14, 22]);
    if (!spot) return;
    const needs = {};
    for (const k in def.repair) needs[k] = def.repair[k];
    const v = { id, type, x: spot.x, y: spot.y, z: spot.z, q: [0, Math.sin(spot.yaw / 2), 0, Math.cos(spot.yaw / 2)], vel: [0, 0, 0], hp: 0, broken: true, needs, fuel: 0, steer: 0, rpm: 0, var: Math.floor(Math.random() * 1000), seats: new Array(def.seats.length).fill(0), attached: new Set() };
    this.vehicles.set(id, v);
    return v;
  }
  // Open water deep enough for a boat's hull near (x,z), clear of other vehicles
  findWaterSpot(type, x, z, yaw, ignoreVeh = null, minDepth = 1.2) {
    const def = VEHICLES[type], [hx, , hz] = def.half;
    for (const dist of [0, 5, 9, 14, 20, 28, 38, 50]) for (let a = 0; a < (dist ? 12 : 1); a++) {
      const ang = yaw + a * Math.PI / 6, cx = x + Math.sin(ang) * dist, cz = z + Math.cos(ang) * dist;
      let ok = this.world.ground(cx, cz) < -minDepth;
      for (const [lx, lz] of [[0, hz], [0, -hz], [hx, 0], [-hx, 0], [0, hz / 2], [0, -hz / 2]]) { if (!ok) break; const [dx, dz] = rotY(lx, lz, yaw); if (this.world.ground(cx + dx, cz + dz) > (def.sub ? -minDepth * 0.85 : -0.5)) ok = false; }
      if (!ok) continue;
      if ([...this.vehicles.values()].some((v) => v.id !== ignoreVeh && Math.hypot(v.x - cx, v.z - cz) < hz + Math.hypot(...VEHICLES[v.type].half) + 1)) continue;
      return { x: cx, y: def.float ?? -def.half[1] * 0.45, z: cz, yaw };
    }
    return null;
  }
  // Find a flat, open spot for a vehicle near (x,z): no water, trees, rocks, buildings, props or other vehicles.
  findClearSpot(type, x, z, yaw, dists = [0, 6, 10, 15, 20, 28], ignoreVeh = null) {
    const def = VEHICLES[type], [hx, , hz] = def.half;
    const angles = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.2, -2.2, 2.7, -2.7, Math.PI];
    const fwd = [Math.sin(yaw), Math.cos(yaw)];
    for (const dist of dists) for (const a of dist === 0 ? [0] : angles) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = fwd[0] * ca + fwd[1] * sa, dz = -fwd[0] * sa + fwd[1] * ca;
      const cx = x + dx * dist, cz = z + dz * dist;
      if (this.footprintClear(def, cx, cz, yaw, ignoreVeh)) {
        let gmax = -Infinity;
        for (const [px, pz] of this.footprintPts(def, cx, cz, yaw)) gmax = Math.max(gmax, this.world.ground(px, pz));
        return { x: cx, y: gmax + restHeight(def) + 0.25, z: cz, yaw };
      }
    }
    return null;
  }
  footprintPts(def, cx, cz, yaw) {
    const [hx, , hz] = def.half, pts = [];
    for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 1 / Math.max(1, Math.ceil(hz))) {
      const [rx, rz] = rotY(i * (hx + 0.4), j * (hz + 0.4), yaw);
      pts.push([cx + rx, cz + rz]);
    }
    return pts;
  }
  footprintClear(def, cx, cz, yaw, ignoreVeh) {
    const pts = this.footprintPts(def, cx, cz, yaw);
    let gmin = Infinity, gmax = -Infinity;
    for (const [px, pz] of pts) { const g = this.world.ground(px, pz); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    if (gmin < 0.3 || gmax - gmin > 1.4 + def.half[2] * 0.18) return false;          // water / too steep
    const R = Math.hypot(def.half[0], def.half[2]) + 1;
    for (const v of this.vehicles.values()) if (v.id !== ignoreVeh && Math.hypot(v.x - cx, v.z - cz) < R + Math.hypot(...VEHICLES[v.type].half.filter((_, i) => i !== 1))) return false;
    // trees & rocks
    const [c0, c1] = regionOf(cx, cz);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const k = chunkKey(c0 + i, c1 + j);
      let list = this.chunkCache.get(k);
      if (!list) { list = this.world.chunkNodes(c0 + i, c1 + j); this.chunkCache.set(k, list); }
      for (const n of list) {
        if (Math.hypot(n.x - cx, n.z - cz) > R + 2 || NODES[n.type].kind === 'pick' || this.nodeState.get(n.id)?.hp <= 0) continue;
        for (const [px, pz] of pts) if (Math.hypot(n.x - px, n.z - pz) < NODES[n.type].radius * n.s + 0.6) return false;
      }
    }
    // buildings, deployables and monument props
    const boxes = [];
    for (const st of this.structsNear(cx, cz)) if (Math.hypot(st.x - cx, st.z - cz) < R + 4) boxes.push(...worldBoxes(st));
    const np = this.world.nearestPOI(cx, cz);
    if (np && np.d < 120) for (const pr of this.world.poiLayout(np.poi).props) if (pr.k !== 'cave') boxes.push(pr.k === 'box' ? { x: pr.x, z: pr.z, hx: pr.sx / 2, hz: pr.sz / 2, yaw: pr.yaw } : { x: pr.x, z: pr.z, hx: pr.r, hz: pr.r, yaw: 0 });
    for (const b of boxes) for (const [px, pz] of pts) {
      const [lx, lz] = invRotY(px - b.x, pz - b.z, b.yaw);
      if (Math.abs(lx) < b.hx + 0.4 && Math.abs(lz) < b.hz + 0.4) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ vehicle-mounted structures (hauler deck)
  deckBuilding(v) {
    const id = 'D' + v.id;
    let b = this.buildings.get(id);
    if (!b) { const d = VEHICLES[v.type].deck; b = { id, x: d.x, y: d.y, z: d.z, yaw: 0, veh: v.id, owner: v.owner || 0 }; this.buildings.set(id, b); }
    return b;
  }
  deckFoundations(v) { const d = VEHICLES[v.type].deck; return d.cells.map((gz) => ({ type: 'foundation', gx: 0, gz, level: 0, virtual: true })); }
  attachedWorld(v, l) {
    const [x, y, z] = quatRotate(v.q, [l.x, l.y, l.z]);
    return { x: v.x + x, y: v.y + y, z: v.z + z, yaw: quatYaw(v.q) + (l.yaw || 0) };
  }
  refreshAttached(v) {
    if (!v.attached || !v.attached.size) return;
    for (const id of v.attached) { const s = this.structs.get(id); if (s) Object.assign(s, this.attachedWorld(v, s.local)); }
  }
  canUseDeck(p, v) {
    if (!v.owner) return true;
    const o = this.byPid.get(v.owner);
    return v.owner === p.pid || this.sameClan(p, o);
  }
  onVehicleStructs(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || !v.attached) return;
    this.send(p, { t: 'vst', id: v.id, s: [...v.attached].map((id) => this.sStruct(this.structs.get(id))).filter(Boolean) });
  }

  // ------------------------------------------------------------ serialization
  sStruct(s) {
    if (!s) return null;
    const o = { id: s.id, k: s.kind, type: s.type, hp: Math.ceil(s.hp), mhp: s.mhp, x: r2(s.x), y: r2(s.y), z: r2(s.z), yaw: s.yaw, o: s.owner };
    if (s.leaks?.length) o.lk = s.leaks;
    if (s.kind === 'piece') { o.tier = s.tier; o.rf = s.reinf || 0; o.bid = s.bid; o.gx = s.gx; o.gz = s.gz; o.level = s.level; o.rot = s.rot || 0; const b = this.buildings.get(s.bid); if (b) o.b = [b.x, b.y, b.z, b.yaw]; }
    if (s.kind === 'door') { o.dt = s.doorTier; o.open = !!s.open; o.parent = s.parent; }
    if (s.type === 'tool_cupboard') o.auth = s.auth;
    if (s.paint !== undefined) o.pa = s.paint;
    if (s.decals?.length) o.dc = s.decals;
    if (s.veh) { o.veh = s.veh; o.l = [r2(s.local.x), r2(s.local.y), r2(s.local.z), s.local.yaw || 0]; }
    return o;
  }
  sLoot(l) {
    if (!l) return null;
    const filled = l.slots.filter(Boolean);
    return { id: l.id, kind: l.kind, tier: l.tier, x: r2(l.x), y: r2(l.y), z: r2(l.z), yaw: l.yaw || 0, an: l.an, empty: !filled.length, item: l.kind === 'bag' && filled.length === 1 ? filled[0].id : undefined };
  }

  addStruct(s) {
    this.structRev = (this.structRev || 0) + 1;
    this.structs.set(s.id, s);
    if (s.veh) {
      const v = this.vehicles.get(s.veh);
      v.attached.add(s.id); Object.assign(s, this.attachedWorld(v, s.local));
      this.toNear(v.x, v.z, SNAP_RANGE, { t: 'sadd', s: this.sStruct(s) });
      return;
    }
    const k = rkey(s.x, s.z);
    this.region(k).s.add(s.id);
    this.toRegion(k, { t: 'sadd', s: this.sStruct(s) });
  }
  updStruct(s) { this.structRev = (this.structRev || 0) + 1; if (s.veh) this.toNear(s.x, s.z, SNAP_RANGE, { t: 'supd', s: this.sStruct(s) }); else this.toRegion(rkey(s.x, s.z), { t: 'supd', s: this.sStruct(s) }); }
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
    const slots = Inv.pack(stacks, 12);
    if (Inv.isEmpty(slots)) return null;
    const l = { id: this.id('L'), kind, x, y: Math.max(y, this.world.ground(x, z)), z, yaw: Math.random() * 6, slots, expires: now() + BAG_LIFETIME };
    this.addLoot(l);
    return l;
  }

  // ------------------------------------------------------------ spatial helpers
  structsNear(x, z, r = 1) {
    const [rx, rz] = regionOf(x, z), out = [];
    for (const v of this.vehicles.values()) if (v.attached && v.attached.size && Math.abs(v.x - x) < (r + 0.5) * CHUNK + 20 && Math.abs(v.z - z) < (r + 0.5) * CHUNK + 20) for (const id of v.attached) { const s = this.structs.get(id); if (s) out.push(s); }
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const reg = this.regions.get(chunkKey(rx + i, rz + j));
      if (reg) for (const id of reg.s) { const s = this.structs.get(id); if (s) out.push(s); }
    }
    return out;
  }
  nearStation(p, station) {
    if (!station) return true;
    const kinds = STATION_PROVIDERS[station];
    for (const s of this.structsNear(p.x, p.z)) {
      if (s.kind === 'deploy' && kinds.includes(s.type) && dist3(s, p) < STATION_RANGE + 1) return true;
    }
    return false;
  }
  privBlocked(p, x, z, st = null) {
    if (st?.veh) { const v = this.vehicles.get(st.veh); return !!v && !this.canUseDeck(p, v); }
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
    const g = gunStats(h.stack), t = now();
    if (t - (p.lastFire || 0) < 0.8 / g.rate) return;
    if ((h.stack.a || 0) <= 0) return;
    p.lastFire = t;
    h.stack.a -= 1;
    const o = Array.isArray(m.o) ? m.o.map((v) => num(v)) : [p.x, p.y + 1.6, p.z];
    const d = Array.isArray(m.d) ? m.d.map((v) => num(v)) : [0, 0, 1];
    this.toNear(p.x, p.z, g.quiet ? 90 : 350, { t: 'fx', k: 'shot', pid: p.pid, w: h.stack.id, q: g.quiet ? 1 : 0, o, d, e: Array.isArray(m.e) ? m.e.slice(0, 12) : [] }, p);
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
    const g = gunStats(h.stack), need = g.mag - (h.stack.a || 0);
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
    if (src && src.pid && src !== o && !this.settings.pvp) return; // PvP off on this server
    if (this.settings.difficulty === 'peaceful' && typeof src === 'string' && /^a /.test(src)) return; // animals don't hurt you
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
    p.lastDeath = { x: p.x, y: p.y, z: p.z };
    if (src && src.pid && src !== p) { src.kills = (src.kills || 0) + 1; this.addXp(src, 25); this.sendStats(src); }
    if (p.vehicle) this.exitVehicle(p);
    const stacks = [...p.inv, ...ARMOR_SLOTS.map((s) => p.armor[s])];
    this.dropBag(p.x, p.y, p.z, stacks, 'bag');
    p.inv = Inv.emptySlots(INV_SIZE); p.armor = { head: null, chest: null, legs: null, back: null }; p.queue = [];
    this.fixInv(p);
    p.killedBy = byName;
    if (this.settings.difficulty === 'hardcore') { p.xp = 0; p.kills = 0; for (const s2 of this.structs.values()) if ((s2.type === 'sleeping_bag' || s2.type === 'bed') && s2.owner === p.pid) s2.owner = 0; this.toast(p, '💀 Hardcore: your survivor is gone — level, kills and respawn points are wiped'); }
    this.sendInv(p);
    this.send(p, { t: 'dead', by: byName, bags: this.bagsOf(p) });
    this.toAll({ t: 'chat', from: '', m: `☠ ${p.name} was killed by ${byName}${p.online ? '' : ' while sleeping'}` });
  }
  bagsOf(p) {
    const out = [];
    for (const s of this.structs.values()) if ((s.type === 'sleeping_bag' || s.type === 'bed') && s.owner === p.pid) out.push({ id: s.id, x: Math.round(s.x), z: Math.round(s.z) });
    return out;
  }
  onRespawn(p, m) {
    if (p.alive) return;
    let pos = null;
    if (m.bag) {
      const b = this.structs.get(String(m.bag));
      if (b && (b.type === 'sleeping_bag' || b.type === 'bed') && b.owner === p.pid) {
        const cd = b.type === 'bed' ? 60 : 120;
        if (now() - (b.lastUse || 0) < cd) return this.toast(p, `${b.type === 'bed' ? 'Bed' : 'Sleeping bag'} on cooldown (${Math.ceil(cd - (now() - b.lastUse))}s)`);
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
    if (VEHICLES[v.type].sub && v.modules) dmg *= 1 - subStats(VEHICLES[v.type], v.modules, ITEMS).hull * 0.5;
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
  onCraft(p, m) {
    const r = RECIPES[num(m.r, -1)];
    const n = Math.max(1, Math.min(20, num(m.n, 1) | 0));
    if (!r || !p.alive) return;
    if (r.station) {
      // station recipes are crafted *in* the station (press E on it); the result stays there until collected
      const st = this.structs.get(String(m.st || ''));
      if (!st || !STATION_KINDS.includes(st.type) || dist3(st, p) > STATION_RANGE + 1.5) return this.toast(p, 'Open the right crafting station (press E on it) to make this');
      if (!stationRecipes(st.type).includes(r)) return this.toast(p, `A ${ITEMS[st.type].name} can't make that`);
      if (!this.settings.creative && !Inv.hasAll(p.inv, r.cost, n)) return this.toast(p, 'Not enough resources');
      this.ensureStation(st);
      if (st.queue.length + n > 20) return this.toast(p, 'This station is busy (20 jobs max)');
      if (!this.settings.creative) Inv.removeAll(p.inv, r.cost, n);
      let end = Math.max(now(), st.queue.length ? st.queue[st.queue.length - 1].end : 0);
      for (let i = 0; i < n; i++) { end += r.time; st.queue.push({ r: r.id, end, by: p.pid }); }
      this.activeStations.add(st.id);
      this.sendInv(p); this.pushContainer(st.id);
      return;
    }
    if (!this.settings.creative && !Inv.hasAll(p.inv, r.cost, n)) return this.toast(p, 'Not enough resources');
    if (p.queue.length >= 12) return this.toast(p, 'Craft queue is full');
    if (!this.settings.creative) Inv.removeAll(p.inv, r.cost, n);
    let end = Math.max(now(), p.queue.length ? p.queue[p.queue.length - 1].end : 0);
    for (let i = 0; i < n; i++) { end += r.time; p.queue.push({ r: r.id, end }); }
    this.sendInv(p); this.sendQueue(p);
  }
  ensureStation(st) {
    if (!st.slots) st.slots = Inv.emptySlots(STATION_OUTPUT_SLOTS);
    if (!st.queue) st.queue = [];
  }
  onCraftCancel(p, m) {
    const i = num(m.i, -1) | 0;
    let queue = p.queue, st = null;
    if (m.st) {
      st = this.structs.get(String(m.st));
      if (!st || !st.queue || dist3(st, p) > STATION_RANGE + 1.5) return;
      queue = st.queue;
    }
    const q = queue[i];
    if (!q) return;
    queue.splice(i, 1);
    const r = RECIPES[q.r];
    for (const k in r.cost) this.give(p, k, r.cost[k], false);
    let t = now();
    for (const e of queue) { t += RECIPES[e.r].time; e.end = t; }
    this.sendInv(p);
    if (st) this.pushContainer(st.id); else this.sendQueue(p);
  }
  stationQueue(st) { const t = now(); return (st.queue || []).map((q) => ({ r: q.r, left: Math.max(0, q.end - t), total: RECIPES[q.r].time })); }
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
    // station jobs finish into the station's output slots
    for (const id of [...this.activeStations]) {
      const st = this.structs.get(id);
      if (!st || !st.queue || !st.queue.length) { this.activeStations.delete(id); continue; }
      let changed = false;
      while (st.queue.length && st.queue[0].end <= t) {
        const r = RECIPES[st.queue[0].r];
        const probe = st.slots.map((x) => (x ? { ...x } : null));
        if (Inv.add(probe, r.out, r.n) > 0) { for (const e of st.queue) e.end += 2; break; } // output full: wait
        const q = st.queue.shift();
        Inv.add(st.slots, r.out, r.n);
        const by = this.byPid.get(q.by);
        if (by) this.addXp(by, Math.ceil(r.time / 2));
        changed = true;
      }
      if (changed) this.pushContainer(id);
    }
  }

  // ------------------------------------------------------------ building
  checkFoundationGround(b, gx, gz, tier = 0) {
    const t = pieceTransform(b, { type: 'foundation', gx, gz, level: 0 });
    for (const [cx, cz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 0]]) {
      const [dx, dz] = rotY(cx, cz, t.yaw);
      const g = this.world.ground(t.x + dx, t.z + dz);
      if (g > b.y + 0.35) return 'Ground is in the way';
      if (g < b.y - 2.9) return 'Too steep: foundation would float';
    }
    if (this.inPOI(t.x, t.z)) return "Can't build in monuments";
    if (this.world.ground(t.x, t.z) < -2 && !TIERS[tier]?.sealed) return 'Water is too deep — build underwater with Watertight Steel';
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
    if (!this.settings.creative && !Inv.hasAll(p.inv, cost)) return this.toast(p, `Need ${Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    let b, gx = num(m.gx) | 0, gz = num(m.gz) | 0, level = num(m.level) | 0;
    let isNew = false;
    if (m.veh) return this.onDeckBuild(p, m, type, tier, cost, gx, gz, level);
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
    if (type === 'foundation') { const ge = this.checkFoundationGround(b, gx, gz, tier); if (ge) return this.toast(p, ge); }
    if (isNew) this.buildings.set(b.id, b);
    if (!this.settings.creative) Inv.removeAll(p.inv, cost);
    const s = { id: this.id('S'), created: now(), kind: 'piece', type, tier, reinf: 0, hp: pieceMaxHp(tier), mhp: pieceMaxHp(tier), bid: b.id, gx, gz, level, rot: (m.rot | 0) & 3, owner: p.pid, ...t };
    this.addStruct(s);
    this.sendInv(p);
    this.addXp(p, 1);
  }

  onDeckBuild(p, m, type, tier, cost, gx, gz, level) {
    const v = this.vehicles.get(String(m.veh));
    const def = v && VEHICLES[v.type];
    if (!def?.deck) return this.toast(p, 'You can only build on a hauler deck');
    if (dist3(v, p) > def.half[2] + 8) return this.toast(p, 'Too far away');
    if (!this.canUseDeck(p, v)) return this.toast(p, 'This hauler belongs to someone else');
    if (type === 'foundation') return this.toast(p, 'The deck is already a foundation — build walls and floors on it');
    const d = def.deck;
    if (Math.abs(gx) > 1 || gz < Math.min(...d.cells) - 1 || gz > Math.max(...d.cells) + 1 || level > d.levels) return this.toast(p, 'Outside the deck');
    const b = this.deckBuilding(v);
    const pieces = this.piecesOf(b.id);
    const err = canPlaceAny(type, gx, gz, level, buildIndex([...pieces, ...this.deckFoundations(v)]), false);
    if (err) return this.toast(p, err);
    if (!this.settings.creative) Inv.removeAll(p.inv, cost);
    if (!v.owner) { v.owner = p.pid; b.owner = p.pid; this.toast(p, `🚛 You claimed this ${def.name} — only you and your clan can build on it`); }
    const local = pieceTransform(b, { type, gx, gz, level, rot: m.rot | 0 });
    this.addStruct({ id: this.id('S'), created: now(), kind: 'piece', type, tier, reinf: 0, hp: pieceMaxHp(tier), mhp: pieceMaxHp(tier), bid: b.id, gx, gz, level, rot: (m.rot | 0) & 3, owner: p.pid, veh: v.id, local, x: 0, y: 0, z: 0, yaw: 0 });
    this.sendInv(p);
  }
  onUpgrade(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || s.kind !== 'piece' || !p.alive) return;
    const ham = p.inv[p.sel];
    if (!ham || ham.id !== 'hammer') return;
    const tier = num(m.tier, s.tier + 1) | 0;
    if (tier <= s.tier || tier >= TIERS.length) return;
    if (dist3(s, p) > BUILD_REACH + 3) return;
    if (this.privBlocked(p, s.x, s.z, s)) return this.toast(p, 'Building blocked');
    const cost = pieceCost(s.type, tier);
    if (!this.settings.creative && !Inv.hasAll(p.inv, cost)) return this.toast(p, `Need ${Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    if (!this.settings.creative) Inv.removeAll(p.inv, cost);
    s.tier = tier; s.mhp = pieceMaxHp(tier, s.reinf); s.hp = s.mhp;
    this.updStruct(s); this.sendInv(p);
    this.toNear(s.x, s.z, 80, { t: 'fx', k: 'upgrade', p: [s.x, s.y + 1, s.z], tier });
    this.addXp(p, 2 + tier);
  }
  onReinforce(p, m) {
    const s = this.structs.get(String(m.id));
    if (!s || s.kind !== 'piece' || !p.alive) return;
    const ham = p.inv[p.sel];
    if (!ham || ham.id !== 'hammer') return;
    const lvl = (s.reinf || 0) + 1;
    if (lvl >= REINFORCE.length) return this.toast(p, 'Already fully reinforced');
    if (dist3(s, p) > BUILD_REACH + 3) return;
    if (this.privBlocked(p, s.x, s.z, s)) return this.toast(p, 'Building blocked');
    const cost = reinforceCost(s.type, lvl);
    if (!this.settings.creative && !Inv.hasAll(p.inv, cost)) return this.toast(p, `Need ${Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`);
    if (!this.settings.creative) Inv.removeAll(p.inv, cost);
    const before = s.mhp;
    s.reinf = lvl; s.mhp = pieceMaxHp(s.tier, lvl); s.hp += s.mhp - before;
    this.updStruct(s); this.sendInv(p);
    this.toNear(s.x, s.z, 80, { t: 'fx', k: 'upgrade', p: [s.x, s.y + 1, s.z], tier: 3 });
    this.toast(p, `🔩 ${REINFORCE[lvl].name}: max HP ${s.mhp}`);
    this.addXp(p, 3);
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
    if (m.id && p.inv[sel]?.id !== m.id) sel = p.inv.findIndex((x) => x && x.id === m.id);
    if (sel < 0) return this.toast(p, "You don't have that item");
    const st = p.inv[sel];
    if (!st) return;
    const def = ITEMS[st.id];
    if (def.door) {
      const dw = this.structs.get(String(m.door));
      if (!dw || dw.type !== 'doorway') return this.toast(p, 'Place doors in a doorway');
      if (dist3(dw, p) > BUILD_REACH + 3) return;
      for (const s of this.structs.values()) if (s.kind === 'door' && s.parent === dw.id) return this.toast(p, 'Doorway already has a door');
      if (this.privBlocked(p, dw.x, dw.z, dw)) return this.toast(p, 'Building blocked');
      Inv.remove(p.inv, st.id, 1);
      const tier = DOOR_TIER[def.door.tier];
      this.addStruct({ id: this.id('S'), kind: 'door', type: 'door', doorTier: def.door.tier, tierIdx: tier, parent: dw.id, hp: def.door.hp, mhp: def.door.hp, owner: p.pid, x: dw.x, y: dw.y, z: dw.z, yaw: dw.yaw, open: false, created: now(), ...(dw.veh ? { veh: dw.veh, local: { ...dw.local } } : {}) });
      this.sendInv(p);
      return;
    }
    if (!def.deploy) return;
    if (m.veh) {
      const v = this.vehicles.get(String(m.veh)), vd = v && VEHICLES[v.type];
      if (!vd?.deck || dist3(v, p) > vd.half[2] + 8) return;
      if (!this.canUseDeck(p, v)) return this.toast(p, 'This hauler belongs to someone else');
      const l = { x: num(m.lx), y: num(m.ly), z: num(m.lz), yaw: num(m.lyaw) };
      const zs = vd.deck.cells.map((c) => vd.deck.z + c * 1.5);
      if (Math.abs(l.x) > 1.5 || l.z < Math.min(...zs) - 1.5 || l.z > Math.max(...zs) + 1.5 || l.y < vd.deck.y - 0.2 || l.y > vd.deck.y + vd.deck.levels * 3 + 0.3) return this.toast(p, 'Place it on the deck');
      if (def.deploy.kind === 'tool_cupboard') return this.toast(p, "Tool cupboards can't go on vehicles — the hauler's owner and clan already control it");
      Inv.remove(p.inv, st.id, 1);
      if (!v.owner) v.owner = p.pid;
      const s = { id: this.id('S'), kind: 'deploy', type: def.deploy.kind, hp: def.deploy.hp, mhp: def.deploy.hp, owner: p.pid, veh: v.id, local: l, x: 0, y: 0, z: 0, yaw: 0, created: now() };
      if (def.deploy.slots) s.slots = Inv.emptySlots(def.deploy.slots);
      this.addStruct(s);
      this.sendInv(p);
      return;
    }
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
    if (kind === 'tool_cupboard') s.auth = [p.pid];
    this.addStruct(s);
    this.sendInv(p);
    if (kind === 'sleeping_bag' || kind === 'bed') this.toast(p, `${def.name} placed — you can respawn here`);
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
    this.structRev = (this.structRev || 0) + 1;
    if (!this.structs.has(s.id)) return;
    this.structs.delete(s.id);
    if (s.veh) { this.vehicles.get(s.veh)?.attached.delete(s.id); this.toNear(s.x, s.z, SNAP_RANGE, { t: 'sdel', id: s.id, fx: effects ? 1 : 0 }); }
    else {
      const k = rkey(s.x, s.z);
      this.region(k).s.delete(s.id);
      this.toRegion(k, { t: 'sdel', id: s.id, fx: effects ? 1 : 0 });
    }
    if (s.slots) this.dropBag(s.x, s.y + 0.3, s.z, s.slots.filter((it, i) => it && Math.random() < 0.6));
    if (s.kind === 'piece') {
      // doors in destroyed doorway
      if (s.type === 'doorway') for (const d of [...this.structs.values()]) if (d.kind === 'door' && d.parent === s.id) this.destroyStruct(d, effects);
      const pieces = this.piecesOf(s.bid);
      if (!pieces.length) { this.buildings.delete(s.bid); }
      else {
        const bb = this.buildings.get(s.bid), dv = bb?.veh ? this.vehicles.get(bb.veh) : null;
        for (const dead of unsupportedPieces(dv ? [...pieces, ...this.deckFoundations(dv)] : pieces)) if (dead.id) this.destroyStruct(dead, true);
      }
      // deployables that lost their floor
      for (const o of this.structsNear(s.x, s.z)) if (o.kind === 'deploy' && !this.hasSupport(o)) this.destroyStruct(o, true);
    }
  }
  hasSupport(o) {
    if (o.veh) return true;
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
      if (!this.editTerrain(ix, iz, -DIG.step)) {
        // at the bottom of a maxed-out hole you break through into the cave layer: a shaft with a ladder
        const sx = ix * GRID, sz = iz * GRID;
        for (const o of this.structsNear(sx, sz, 0)) if (o.type === 'shaft' && Math.hypot(o.x - sx, o.z - sz) < 6) return this.toast(p, 'There is already a shaft here — press E on it to climb down');
        if (this.inPOI(sx, sz)) return this.toast(p, "Can't dig into the caves inside a monument");
        const sy = this.world.ground(sx, sz);
        const s = { id: this.id('S'), kind: 'deploy', type: 'shaft', hp: 99999, mhp: 99999, owner: p.pid, x: sx, y: sy + 0.02, z: sz, yaw: 0, created: now() };
        this.addStruct(s);
        this.openCaveAt(s.id, sx, sz);
        this.addXp(p, 10);
        return this.toast(p, '⛏️ You broke through into the caves! Press E on the shaft to climb down the ladder.');
      }
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
      const auth = s.veh ? this.canUseDeck(p, this.vehicles.get(s.veh)) || null : this.authorizedAt(p, s.x, s.z);
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
    if (s.type === 'sleeping_bag' || s.type === 'bed') {
      if (s.owner !== p.pid) { s.owner = p.pid; this.toast(p, 'You claimed this sleeping bag'); this.updStruct(s); }
    }
  }

  getContainer(id) {
    if (id.startsWith('vm:')) {
      const v = this.vehicles.get(id.slice(3)), def = v && VEHICLES[v.type];
      if (!def?.moduleSlots) return null;
      if (!v.modules) v.modules = Inv.emptySlots(def.moduleSlots);
      return { obj: v, title: `${def.name} — Module Bay (crush depth ${subStats(def, v.modules, ITEMS).crush} m)`, slots: v.modules, modules: true, range: def.half[2] + 5 };
    }
    const s = this.structs.get(id);
    if (s && STATION_KINDS.includes(s.type)) { this.ensureStation(s); return { obj: s, title: ITEMS[s.type].name, slots: s.slots, station: s.type }; }
    if (s && s.slots) return { obj: s, title: ITEMS[s.type]?.name || 'Box', slots: s.slots };
    const l = this.loot.get(id);
    if (l) return { obj: l, title: l.kind === 'crate' ? ['', 'Supply Crate', 'Military Crate', 'Elite Crate'][l.tier] : l.kind === 'corpse' ? `${ANIMALS[l.an]?.name || 'Animal'} Corpse` : 'Backpack', slots: l.slots };
    return null;
  }
  onOpen(p, m) {
    const id = String(m.id);
    const c = this.getContainer(id);
    if (!c || !p.alive || dist3(c.obj, p) > (c.range || 4.5)) return;
    p.openCont = id;
    this.send(p, { t: 'cont', id, title: c.title, slots: c.slots, station: c.station, queue: c.station ? this.stationQueue(c.obj) : undefined });
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
    for (const p of this.players.values()) if (p.online && p.openCont === id) this.send(p, { t: 'cont', id, title: c ? c.title : '', slots: c ? c.slots : null, station: c?.station, queue: c?.station ? this.stationQueue(c.obj) : undefined });
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

  // ------------------------------------------------------------ grid inventory
  fixInv(p) {
    p.armor = p.armor || {};
    if (p.armor.back === undefined) p.armor.back = null;
    p.inv.spec = playerSpec(backpackRows(p.armor));
  }
  // Old saves: 30 one-cell slots -> 6 quick slots + Tetris grid. Items that no longer fit go in a bag on next login.
  migrateInv(p) {
    if (!Array.isArray(p.inv)) p.inv = Inv.emptySlots(INV_SIZE);
    if (p.inv.length !== INV_SIZE) {
      const old = p.inv, arr = Inv.emptySlots(INV_SIZE);
      for (let i = 0; i < HOTBAR; i++) arr[i] = old[i] || null;
      let k = HOTBAR;
      for (let i = HOTBAR; i < old.length; i++) if (old[i]) { if (k < INV_SIZE) arr[k++] = old[i]; else (p.pendingDrop = p.pendingDrop || []).push(old[i]); }
      p.inv = arr;
    }
    this.fixInv(p);
    const left = Inv.normalize(p.inv);
    // anything sitting in locked rows (no bag) also goes into the bag
    const spec = specOf(p.inv);
    for (let a = spec.start; a < p.inv.length; a++) { const st = p.inv[a]; if (st && rowOf(spec, a) + sizeOf(st.id)[1] > spec.rows) { left.push(st); p.inv[a] = null; } }
    if (left.length) p.pendingDrop = [...(p.pendingDrop || []), ...left];
  }
  // Would the grid still hold everything with a bag giving `rows` extra rows?
  bagFits(p, rows) {
    const spec = playerSpec(rows);
    for (let a = spec.start; a < p.inv.length; a++) { const st = p.inv[a]; if (st && rowOf(spec, a) + sizeOf(st.id)[1] > spec.rows) return false; }
    return true;
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
        if (!c || dist3(c.obj, p) > (c.range || 5)) return null;
        return { arr: c.slots, i: num(r.i, -1) | 0, cont: p.openCont, modules: !!c.modules };
      }
      return null;
    };
    const A = ref(m.from), B = ref(m.to);
    if (!A || !B || A.i === null || B.i === null) return;
    if (!A.armor && (A.i < 0 || A.i >= A.arr.length)) return;
    const src = A.arr[A.i];
    if (!src) return;
    let ok = false;
    if (B.modules && !ITEMS[src.id]?.module) return this.toast(p, 'Only submarine modules fit in the module bay');
    if (A.armor && B.armor) return;
    if (A.armor) ok = this.unequip(p, A.i, B);
    else if (B.armor) ok = this.equip(p, A, B.i);
    else if (B.i === -1) {
      const left = Inv.addStack(B.arr, src);
      ok = left < src.n;
      if (left <= 0) A.arr[A.i] = null; else src.n = left;
      if (!ok) this.toast(p, B.arr === p.inv ? 'Not enough room in your inventory' : 'Not enough room in there');
    } else ok = Inv.move(A.arr, A.i, B.arr, B.i, m.n !== undefined ? num(m.n) | 0 : undefined);
    this.fixInv(p);
    this.sendInv(p);
    if (A.cont) this.afterContainerChange(A.cont); else if (B.cont) this.afterContainerChange(B.cont);
  }
  // armor slot -> inventory / container cell (B.i = cell, or -1 for "anywhere")
  unequip(p, slot, B) {
    const src = p.armor[slot];
    if (slot === 'back' && !this.bagFits(p, 0)) { this.toast(p, '🎒 Empty the extra backpack rows first'); return false; }
    p.armor[slot] = null; this.fixInv(p);
    if (B.i === -1) {
      if (Inv.addStack(B.arr, src) <= 0) return true;
    } else if (B.i >= 0 && B.i < B.arr.length) {
      if (canPlace(B.arr, B.i, src.id)) { B.arr[B.i] = src; return true; }
      // swap with an item of the same armor slot under the cursor
      const t = occupancy(B.arr)[B.i], dst = t >= 0 ? B.arr[t] : null;
      if (dst && ITEMS[dst.id].armor?.slot === slot && (slot !== 'back' || this.bagFits(p, ITEMS[dst.id].armor.rows))) {
        B.arr[t] = null;
        if (canPlace(B.arr, B.i, src.id)) { B.arr[B.i] = src; p.armor[slot] = dst; this.fixInv(p); return true; }
        B.arr[t] = dst;
      }
    }
    p.armor[slot] = src; this.fixInv(p);
    this.toast(p, 'No room there');
    return false;
  }
  // inventory / container cell -> armor slot
  equip(p, A, slot) {
    const src = A.arr[A.i], ad = ITEMS[src.id].armor;
    if (!ad || ad.slot !== slot) return false;
    const dst = p.armor[slot];
    A.arr[A.i] = null;
    if (slot === 'back' && A.arr === p.inv && !this.bagFits(p, ad.rows)) { A.arr[A.i] = src; this.toast(p, '🎒 That bag is smaller — empty the extra rows first'); return false; }
    p.armor[slot] = src; this.fixInv(p);
    if (!dst) return true;
    if (canPlace(A.arr, A.i, dst.id)) { A.arr[A.i] = dst; return true; }
    if (Inv.addStack(A.arr, dst) <= 0) return true;
    A.arr[A.i] = src; p.armor[slot] = dst; this.fixInv(p);
    this.toast(p, 'No room for the item you took off');
    return false;
  }

  onDrop(p, m) {
    if (!p.alive) return;
    let st = null;
    if (m.c === 'p') { const i = num(m.i, -1) | 0; st = p.inv[i]; if (st) p.inv[i] = null; }
    else if (m.c === 'a' && ARMOR_SLOTS.includes(m.i)) {
      if (m.i === 'back' && !this.bagFits(p, 0)) return this.toast(p, '🎒 Empty the extra backpack rows first');
      st = p.armor[m.i]; p.armor[m.i] = null; this.fixInv(p);
    }
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

  // ---- Gunsmith Bench: fit / remove attachments and pick a finish
  onGunMod(p, m) {
    const bench = this.structs.get(String(m.bench));
    if (!p.alive || !bench || bench.type !== 'gunsmith' || dist3(bench, p) > STATION_RANGE + 1.5) return this.toast(p, 'Stand at a Gunsmith Bench');
    const i = num(m.i, -1) | 0, st = p.inv[i];
    if (!st || !isModdable(st.id)) return;
    st.mods = st.mods || {};
    if (m.finish !== undefined) {
      const f = FINISHES.find((x) => x.id === m.finish);
      if (!f) return;
      if (f.id === 'factory') delete st.mods.finish; else st.mods.finish = f.id;
    } else {
      const slot = String(m.slot), mod = m.mod ? String(m.mod) : null;
      const cur = st.mods[slot];
      if (mod && !canMod(st.id, slot, mod)) return this.toast(p, "That doesn't fit this weapon");
      if (mod === cur) return;
      if (mod && Inv.count(p.inv, mod) <= 0) return this.toast(p, `You need a ${ITEMS[mod].name} — craft one at this bench`);
      if (mod) Inv.remove(p.inv, mod, 1);
      if (cur) { const left = Inv.add(p.inv, cur, 1); if (left) this.dropBag(p.x, p.y, p.z, [newStack(cur, 1)]); }
      if (mod) st.mods[slot] = mod; else delete st.mods[slot];
      // the magazine may hold fewer rounds now: give the extra ammo back
      const g = gunStats(st);
      if ((st.a || 0) > g.mag) { const extra = st.a - g.mag; st.a = g.mag; const left = Inv.add(p.inv, g.ammo, extra); if (left) this.dropBag(p.x, p.y, p.z, [newStack(g.ammo, left)]); }
    }
    if (!Object.keys(st.mods).length) delete st.mods;
    this.toNear(p.x, p.z, 20, { t: 'fx', k: 'gunmod', p: [bench.x, bench.y, bench.z] });
    this.sendInv(p);
  }
  // ------------------------------------------------------------ seasons & footprints in the snow
  snowAt(x, z, y) {
    if (y !== undefined && y < CAVE_ZONE) return false;
    const g = this.world.ground(x, z), b = this.world.biome(x, z, g);
    if (g < 0.2 || b === BIOME.DESERT) return false;
    return b === BIOME.SNOW || seasonInfo(this.year).snow > 0.3;
  }
  addPrint(x, z, yaw, kind) {
    const k = rkey(x, z);
    let l = this.prints.get(k);
    if (!l) { l = []; this.prints.set(k, l); }
    const pr = [r2(x), r2(z), r2(yaw), Math.floor(now()), kind];
    l.push(pr); if (l.length > 5000) l.shift();
    let n = this.newPrints.get(k); if (!n) { n = []; this.newPrints.set(k, n); } n.push(pr);
  }
  footstep(p) {
    if (p.printX === undefined) { p.printX = p.x; p.printZ = p.z; return; }
    const lx = p.printX, lz = p.printZ;
    const d = Math.hypot(p.x - lx, p.z - lz);
    if (d < (p.cr ? 0.5 : p.spr ? 0.95 : 0.72)) return;
    p.printX = p.x; p.printZ = p.z;
    if (d > 6 || !this.snowAt(p.x, p.z, p.y) || p.y - this.world.ground(p.x, p.z) > 0.4) return;
    p.printSide = !p.printSide;
    const yaw = Math.atan2(p.x - lx, p.z - lz), side = p.printSide ? 1 : -1;
    this.addPrint(p.x + Math.cos(yaw) * 0.13 * side, p.z - Math.sin(yaw) * 0.13 * side, yaw, p.printSide ? 0 : 1);
  }
  tyreTracks(v) {
    if (v.printX === undefined) { v.printX = v.x; v.printZ = v.z; return; }
    const lx = v.printX, lz = v.printZ, d = Math.hypot(v.x - lx, v.z - lz);
    if (d < 1.4) return;
    v.printX = v.x; v.printZ = v.z;
    if (d > 12 || !this.snowAt(v.x, v.z)) return;
    const yaw = Math.atan2(v.x - lx, v.z - lz), def = VEHICLES[v.type], tr = def.track || 0.8;
    for (const sd of [-1, 1]) this.addPrint(v.x + Math.cos(yaw) * tr * sd, v.z - Math.sin(yaw) * tr * sd, yaw, 2);
  }
  printsMsg(k) {
    const l = this.prints.get(k), t = now();
    return l ? l.filter((pr) => t - pr[3] < FOOTPRINT_LIFE).map((pr) => [pr[0], pr[1], pr[2], Math.floor(t - pr[3]), pr[4]]) : [];
  }
  flushPrints() {
    if (!this.newPrints.size) return;
    for (const [k, l] of this.newPrints) this.toRegion(k, { t: 'fp', p: l.map((pr) => [pr[0], pr[1], pr[2], 0, pr[4]]) });
    this.newPrints.clear();
  }
  expirePrints() {
    const t = now();
    for (const [k, l] of this.prints) { const keep = l.filter((pr) => t - pr[3] < FOOTPRINT_LIFE); if (keep.length) this.prints.set(k, keep); else this.prints.delete(k); }
  }
  // ------------------------------------------------------------ weather
  setWeather(state, quick = false) {
    const W = this.weather;
    W.state = state;
    const dur = { clear: [600, 1500], overcast: [180, 420], rain: [240, 600], storm: [180, 420] }[state];
    W.until = now() + dur[0] + Math.random() * (dur[1] - dur[0]);
    if (quick) { const T = WEATHER_TARGETS[state]; W.cloud = T.cloud; W.rain = T.rain; W.storm = T.storm; W.wind = T.wind; }
    this.toAll(this.weatherMsg());
  }
  weatherMsg() { const W = this.weather; return { t: 'weather', s: W.state, c: r2(W.cloud), r: r2(W.rain), st: r2(W.storm), w: r2(W.wind), wd: r2(W.windDir) }; }
  tickWeather(dt) {
    const W = this.weather, t = now();
    if (t > W.until) {
      const r = Math.random();
      const next = { clear: 'overcast', overcast: r < 0.6 ? 'rain' : 'clear', rain: r < 0.38 ? 'storm' : r < 0.75 ? 'overcast' : 'rain', storm: 'rain' }[W.state];
      this.setWeather(next);
    }
    // ease toward the state's targets (a storm rolls in over a minute or two)
    const T = WEATHER_TARGETS[W.state], k = Math.min(1, dt / 70);
    W.cloud += (T.cloud - W.cloud) * k; W.rain += (T.rain - W.rain) * k; W.storm += (T.storm - W.storm) * k; W.wind += (T.wind - W.wind) * k;
    W.windDir += (Math.random() - 0.5) * dt * 0.01;
    this.acc.weather += dt;
    if (this.acc.weather >= 4) { this.acc.weather = 0; this.toAll(this.weatherMsg()); }
    // lightning: strikes around online players, more often as the storm peaks
    if (W.storm > 0.35 && seasonInfo(this.year).season !== 3) {
      const online = [...this.players.values()].filter((p) => p.online && p.y > CAVE_ZONE);
      if (online.length && Math.random() < dt * W.storm * 0.22) {
        const p = online[Math.floor(Math.random() * online.length)];
        const close = Math.random() < 0.08;
        const d = close ? 25 + Math.random() * 60 : 120 + Math.random() * 2200, a = Math.random() * Math.PI * 2;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        this.toNear(x, z, 4200, { t: 'bolt', x: r2(x), z: r2(z), y: r2(this.world.ground(x, z)), s: Math.floor(Math.random() * 1e9), e: r2(0.6 + Math.random() * 0.4) });
        // a strike right on top of someone in the open hurts
        for (const o of online) if (Math.hypot(o.x - x, o.z - z) < 4 && !o.vehicle) this.damagePlayer(o, 45, 'lightning');
      }
    }
  }
  // ------------------------------------------------------------ caves
  caveMod(x, y, z, r) {
    this.caves.addMod(r2(x), r2(y), r2(z), r);
    if (this.caves.mods.length > 60000) this.caves.setMods(this.caves.mods.slice(-50000)); // keep the save bounded
    this.toAll({ t: 'cmod', m: [r2(x), r2(y), r2(z), r] });
  }
  // carve a chamber below an entrance so you always land somewhere open, plus a short tunnel outwards
  openCaveAt(key, x, z) {
    if (this.caveOpened.has(key)) return;
    this.caveOpened.add(key);
    this.caveMod(x, CAVE_ARRIVE, z, 5);
    const a = hash3(x | 0, z | 0, 9, this.seed) * Math.PI * 2;
    for (let k = 1; k <= 4; k++) this.caveMod(x + Math.cos(a) * k * 4, CAVE_ARRIVE - 1, z + Math.sin(a) * k * 4, 3);
  }
  caveEntrances(x, z, r) {
    const out = [];
    for (const s of this.structsNear(x, z, 0)) if (s.type === 'shaft' && Math.hypot(s.x - x, s.z - z) < r) out.push({ id: s.id, x: s.x, z: s.z });
    const np = this.world.nearestPOI(x, z);
    if (np && np.d < 200) for (const pr of this.world.poiLayout(np.poi).props) if (pr.k === 'cave' && Math.hypot(pr.x - x, pr.z - z) < r) out.push({ id: 'poi:' + np.poi.id, x: pr.x, z: pr.z });
    return out;
  }
  onCaveEnter(p, m) {
    if (!p.alive || p.vehicle || p.y < CAVE_ZONE) return;
    const e = this.caveEntrances(p.x, p.z, 6)[0];
    if (!e) return;
    this.openCaveAt(e.id, e.x, e.z);
    const fy = this.caves.floorBelow(e.x, CAVE_ARRIVE + 3, e.z, 20) ?? CAVE_ARRIVE - 4;
    this.teleport(p, e.x + 1.2, fy + 0.1, e.z + 0.6);
    this.toast(p, '🕯️ You climb down into the caves. Dig with a shovel or pickaxe to carve your own tunnels — ore veins glint in the rock. Find the ladder (E) to climb back up.');
  }
  onCaveExit(p) {
    if (!p.alive || p.y > CAVE_ZONE) return;
    const e = this.caveEntrances(p.x, p.z, 5)[0];
    if (!e) return this.toast(p, 'Find a ladder to climb up');
    this.teleport(p, e.x + 1.6, this.world.ground(e.x + 1.6, e.z + 0.8) + 0.4, e.z + 0.8);
  }
  // ------------------------------------------------------------ blue holes into the flooded caves
  openBlueHole(h) {
    if (this.caveOpened.has(h.id)) return;
    this.caveOpened.add(h.id);
    // a wide vertical shaft from the cave roof down to a big flooded chamber (wide enough for the big sub)
    for (let y = CAVE_TOP + 3; y >= CAVE_ARRIVE; y -= 4) this.caveMod(h.x, y, h.z, 11);
    this.caveMod(h.x, CAVE_ARRIVE - 4, h.z, 14);
    const a = hash3(h.x | 0, h.z | 0, 19, this.seed) * Math.PI * 2;
    for (let k = 1; k <= 6; k++) this.caveMod(h.x + Math.cos(a) * (10 + k * 6), CAVE_ARRIVE - 4 + Math.sin(k) * 2, h.z + Math.sin(a) * (10 + k * 6), 7);
  }
  onBlueHole(p) {
    if (!p.alive) return;
    const t = now();
    if (t - (p.lastHole || 0) < 3) return;
    const h = this.world.blueHolesNear(p.x, p.z).find((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + 5);
    if (!h) return;
    const down = p.y > CAVE_ZONE;
    const seabed = this.world.ground(h.x, h.z);
    if (down && p.y > seabed + 9) return;          // you have to swim down into it
    if (!down && p.y < CAVE_TOP - 11) return;      // or up to the top of the shaft
    p.lastHole = t;
    this.openBlueHole(h);
    const ny = down ? CAVE_TOP - 15 : seabed + 5;
    const v = p.vehicle && this.vehicles.get(p.vehicle.id);
    if (v) {
      if (p.vehicle.seat !== 0) return;
      const dy = ny - v.y, dx = h.x - v.x, dz = h.z - v.z;
      // people walking around inside a big sub come along
      for (const o of this.players.values()) if (o !== p && o.alive && !o.vehicle && this.inSubInterior(v, o)) this.teleport(o, o.x + dx, o.y + dy, o.z + dz);
      v.x = h.x; v.y = ny; v.z = h.z; v.vel = [0, 0, 0];
      if (v.docked) this.refreshDocked(v);
      for (const pid of v.seats) { const o = this.byPid.get(pid); if (o) { o.x = v.x; o.y = v.y; o.z = v.z; o.lastHole = t; } }
      this.refreshAttached(v);
      this.send(p, { t: 'v_reset', id: v.id, p: [v.x, v.y, v.z], q: v.q });
    } else this.teleport(p, h.x + 1, ny, h.z);
    this.toast(p, down ? '🌀 You sink down the blue hole into a flooded cave system. Swim back up the shaft to return.' : '🌊 Back out on the sea floor');
  }
  // ------------------------------------------------------------ watertight rooms
  roomsOf(bid) {
    const rev = this.structRev || 0;
    this.roomCache = this.roomCache || new Map();
    const c = this.roomCache.get(bid);
    if (c && c.rev === rev) return c;
    const pieces = [], doors = new Map();
    for (const st of this.structs.values()) if (st.kind === 'piece' && st.bid === bid) pieces.push(st);
    for (const st of this.structs.values()) {
      if (st.kind !== 'door') continue;
      const dw = this.structs.get(st.parent);
      if (dw && dw.bid === bid) doors.set(slotKey(dw.gx, dw.gz, dw.level, 'edge'), { sealed: st.doorTier === 'sealed', open: !!st.open });
    }
    const rooms = pieces.some((p) => TIERS[p.tier]?.sealed) ? sealedRooms(pieces, doors) : [];
    const out = { rev, rooms, pieces };
    this.roomCache.set(bid, out);
    return out;
  }
  dryOf(bid) { const d = new Set(); for (const r of this.roomsOf(bid).rooms) for (const k of r.cells) d.add(k); return d; }
  // the sealed room a point is in: {b, room, floorY, level (water depth in it)}
  roomAt(x, y, z) {
    const bids = new Set();
    for (const st of this.structsNear(x, z, 0)) if (st.kind === 'piece' && TIERS[st.tier]?.sealed && !st.veh) bids.add(st.bid);
    for (const bid of bids) {
      const b = this.buildings.get(bid);
      if (!b) continue;
      const k = cellAt(b, x, y, z), room = k && roomOfCell(this.roomsOf(bid).rooms, k);
      if (room) return { b, room, floorY: b.y + room.L * LEVEL_H, level: b.flood?.[room.key] || 0 };
    }
    return null;
  }
  // ---- flooding: hull integrity, leaks springing below zero, rooms filling up and draining once the leaks are fixed
  tickFlood(dt) {
    const bids = new Set();
    for (const st of this.structs.values()) if (st.kind === 'piece' && !st.veh && TIERS[st.tier]?.sealed && st.y < 0) bids.add(st.bid);
    for (const bid of bids) {
      const b = this.buildings.get(bid);
      if (!b) continue;
      const { rooms, pieces } = this.roomsOf(bid);
      if (!rooms.length) { if (b.flood) delete b.flood; continue; }
      let anyone = false;
      for (const p of this.players.values()) if (p.online && Math.abs(p.x - b.x) < 120 && Math.abs(p.z - b.z) < 120) { anyone = true; break; }
      const depth = -(b.y + 1.5);
      let reinf = 0;
      for (const st of this.structsNear(b.x, b.z, 0)) if (st.type === 'hull_reinforcement' && Math.hypot(st.x - b.x, st.z - b.z) < 40 && Math.abs(st.y - b.y) < 12) reinf++;
      const hi = depth > 0 ? hullIntegrity(pieces, depth, reinf) : HULL_BASE;
      b.hi = hi;
      // leaks: the weaker the hull, the more often (only while someone is around to notice)
      if (hi < 0 && anyone) {
        b.leakT = (b.leakT || 0) + dt;
        if (b.leakT > 45 / (1 + -hi * 0.35)) {
          b.leakT = 0;
          const room = rooms[Math.floor(Math.random() * rooms.length)];
          const total = rooms.reduce((n, r2_) => n + r2_.shell.reduce((m2, q) => m2 + (q.leaks?.length || 0), 0), 0);
          const cand = total >= 8 ? [] : room.shell.filter((q) => q.type !== 'foundation' && (q.leaks?.length || 0) < 3);
          const q = cand[Math.floor(Math.random() * cand.length)];
          if (q) {
            q.leaks = q.leaks || [];
            const edge = PIECES[q.type].slot === 'edge';
            q.leaks.push(edge ? [r2((Math.random() - 0.5) * 2.4), r2(0.4 + Math.random() * 2.2), Math.random() < 0.5 ? -0.13 : 0.13] : [r2((Math.random() - 0.5) * 2.4), -0.22, r2((Math.random() - 0.5) * 2.4)]);
            this.updStruct(q);
            this.toNear(q.x, q.z, 60, { t: 'fx', k: 'leak', p: [q.x, q.y + 1.5, q.z] });
            for (const p of this.players.values()) if (p.online && Math.hypot(p.x - b.x, p.z - b.z) < 40) this.toast(p, `⚠️ Hull breach! Hull integrity ${hi.toFixed(1)} — fix leaks with a Repair Tool, add Hull Reinforcement Frames`);
          }
        }
      } else b.leakT = 0;
      // water level per room
      const flood = b.flood || (b.flood = {});
      let changed = false;
      const keys = new Set();
      for (const room of rooms) {
        keys.add(room.key);
        let n = 0;
        for (const q of room.shell) n += q.leaks?.length || 0;
        const was = flood[room.key] || 0;
        const lvl = n ? Math.min(LEVEL_H, was + n * 0.02 * dt) : Math.max(0, was - 0.03 * dt);
        if (Math.abs(lvl - was) > 1e-4) { changed = true; if (lvl > 0) flood[room.key] = lvl; else delete flood[room.key]; }
      }
      for (const k of Object.keys(flood)) if (!keys.has(k)) { delete flood[k]; changed = true; }
      if (anyone && (changed || (this.floodT = (this.floodT || 0) + 1) % 5 === 0)) this.toNear(b.x, b.z, 120, { t: 'flood', bid, f: Object.fromEntries(Object.entries(flood).map(([k, v]) => [k, r2(v)])), hi: r2(hi) });
    }
  }
  onRepairLeak(p, m) {
    if (!p.alive) return;
    const st = p.inv[p.sel];
    if (!st || !ITEMS[st.id]?.repair) return;
    const pt = Array.isArray(m.pt) ? m.pt.map((v) => num(v)) : null;
    if (!pt || Math.hypot(pt[0] - p.x, pt[1] - p.y - 1.4, pt[2] - p.z) > 5) return;
    const near = (list, toWorld) => { let bi = -1, bd = 2.2; list.forEach((l, i) => { const w = toWorld(l), d = Math.hypot(w[0] - pt[0], w[1] - pt[1], w[2] - pt[2]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    if (m.vid) {
      const v = this.vehicles.get(String(m.vid));
      if (!v?.leaks?.length) return;
      const i = near(v.leaks, (l) => { const w = quatRotate(v.q, l); return [v.x + w[0], v.y + w[1], v.z + w[2]]; });
      if (i < 0) return;
      v.leaks.splice(i, 1); v.hp = Math.min(VEHICLES[v.type].hp, v.hp + 60);
      return this.toast(p, v.leaks.length ? `🔧 Leak sealed — ${v.leaks.length} left` : '🔧 All leaks sealed');
    }
    const s2 = this.structs.get(String(m.id));
    if (!s2?.leaks?.length) return;
    const i = near(s2.leaks, (l) => { const [dx, dz] = rotY(l[0], l[2], s2.yaw); return [s2.x + dx, s2.y + l[1], s2.z + dz]; });
    if (i < 0) return;
    s2.leaks.splice(i, 1);
    if (!s2.leaks.length) delete s2.leaks;
    this.updStruct(s2);
    this.toNear(s2.x, s2.z, 40, { t: 'fx', k: 'weld', p: pt });
  }
  inDryRoom(x, y, z) { const r = this.roomAt(x, y, z); return !!r && y > r.floorY + r.level; }
  inDryRoomOld(x, y, z) {
    const bids = new Set();
    for (const st of this.structsNear(x, z, 0)) if (st.kind === 'piece' && TIERS[st.tier]?.sealed && !st.veh) bids.add(st.bid);
    for (const bid of bids) {
      const b = this.buildings.get(bid);
      if (!b) continue;
      const k = cellAt(b, x, y, z);
      if (k && this.dryOf(bid).has(k)) return true;
    }
    return false;
  }
  // ------------------------------------------------------------ frozen lakes
  iceMsg() { const t = now(); return { f: this.ice.frozen ? 1 : 0, h: this.ice.holes.map((h) => [h.id, r2(h.x), r2(h.z), h.r, Math.floor(t - h.born)]) }; }
  sendIce() { this.toAll({ t: 'ice', ...this.iceMsg() }); }
  tickIce() {
    const f = iceFrozen(seasonInfo(this.year)), t = now();
    let changed = false;
    if (f !== this.ice.frozen) { this.ice.setFrozen(f); changed = true; if (!f && this.ice.holes.length) this.ice.setHoles([]); }
    const keep = this.ice.holes.filter((h) => t - h.born < ICE_REGEN);
    if (keep.length !== this.ice.holes.length) { this.ice.setHoles(keep); changed = true; }
    if (changed) this.sendIce();
  }
  breakIce(x, z, r, src) {
    if (!this.ice.frozen || !this.ice.lakeAt(x, z)) return false;
    const holes = this.ice.holes.filter((h) => Math.hypot(h.x - x, h.z - z) > 0.6);
    holes.push({ id: this.id('ih'), x, z, r, born: now() });
    if (holes.length > 400) holes.shift();
    this.ice.setHoles(holes);
    this.sendIce();
    this.toNear(x, z, 120, { t: 'fx', k: 'icebreak', p: [x, ICE_TOP, z], r });
    return true;
  }
  onIceBreak(p, m) {
    if (!p.alive || p.vehicle || !this.ice.frozen) return;
    const st = p.inv[num(m.sel) | 0], d = st && ITEMS[st.id];
    if (!d || !d.tool?.ore) return;
    const t = now();
    if (t - (p.lastIce || 0) < 0.3) return;
    p.lastIce = t;
    const x = num(m.x), z = num(m.z);
    if (Math.hypot(x - p.x, z - p.z) > 5 || Math.abs(p.y - ICE_TOP) > 3.5 || !this.ice.solid(x, z)) return;
    this.breakIce(x, z, ICE_HOLE_R, p);
  }
  // ------------------------------------------------------------ fishing
  onFishCast(p, m) {
    if (!p.alive || p.vehicle) return;
    const st = p.inv[num(m.sel) | 0];
    if (!st || !ITEMS[st.id]?.fishing) return;
    const x = num(m.x), z = num(m.z), g = this.world.ground(x, z);
    if (Math.hypot(x - p.x, z - p.z) > 28 || g > -0.4 || (this.ice.frozen && this.ice.solid(x, z))) return;
    const t = now(), sea = !this.ice.inland(x, z), hole = this.ice.frozen && this.ice.lakeAt(x, z);
    // fish bite sooner through a quiet ice hole and in deep water, slower in the shallows
    const wait = (hole ? 3 : 4) + Math.random() * (hole ? 7 : 10) + (g > -1.5 ? 4 : 0);
    if (p.fish?.timer) clearTimeout(p.fish.timer);
    p.fish = { id: num(m.id), x, z, depth: -g, sea, hole, bite: t + wait, until: t + wait + 1.6 };
    p.fish.timer = setTimeout(() => { if (p.fish && p.fish.id === num(m.id)) this.send(p, { t: 'fishbite', id: p.fish.id }); }, wait * 1000);
  }
  onFishReel(p, m) {
    const f = p.fish;
    if (!f) return;
    clearTimeout(f.timer); p.fish = null;
    if (m.cancel) return;
    const t = now();
    if (t < f.bite) return this.send(p, { t: 'fishres', id: f.id, ok: 0 });
    if (t > f.until) { this.send(p, { t: 'fishres', id: f.id, ok: 0 }); return this.toast(p, 'It got away…'); }
    const r = Math.random(), big = r < (f.sea ? 0.18 + Math.min(0.2, f.depth / 150) : 0.14 + (f.hole ? 0.08 : 0));
    const pick = (l) => l[Math.floor(Math.random() * l.length)];
    let id = 'raw_fish', n = 1, name;
    if (f.sea && Math.random() < 0.05) { id = 'pearl'; name = 'an oyster with a pearl inside'; }
    else if (!f.sea && Math.random() < 0.05) { id = 'leather'; n = 3; name = 'an old boot (3 leather)'; }
    else if (big) { id = 'raw_big_fish'; const kg = (3 + Math.random() * (f.sea ? 18 : 9)).toFixed(1); name = `a ${kg} kg ${pick(f.sea ? ['Cod', 'Tuna', 'Sea Bass', 'Halibut'] : f.hole ? ['Pike', 'Lake Trout', 'Burbot'] : ['Pike', 'Carp', 'Salmon'])}`; }
    else { const kg = (0.3 + Math.random() * 1.4).toFixed(1); name = `a ${kg} kg ${pick(f.sea ? ['Mackerel', 'Herring', 'Sardine', 'Sea Bream'] : f.hole ? ['Perch', 'Arctic Char', 'Whitefish'] : ['Perch', 'Trout', 'Roach', 'Bream'])}`; }
    this.give(p, id, n);
    this.addXp(p, big ? 4 : 2);
    this.send(p, { t: 'fishres', id: f.id, ok: 1 });
    this.toast(p, `🎣 You caught ${name}!`);
  }
  onCaveDig(p, m) {
    if (!p.alive || p.y > CAVE_ZONE) return;
    const st = p.inv[num(m.sel) | 0], d = st && ITEMS[st.id];
    if (!d || !(d.dig || d.tool?.ore)) return;
    const t = now();
    if (t - (p.lastDig || 0) < 0.35) return;
    p.lastDig = t;
    const pt = Array.isArray(m.pt) ? m.pt.slice(0, 3).map((v) => num(v)) : null;
    if (!pt || Math.hypot(pt[0] - p.x, pt[1] - p.y - 1.4, pt[2] - p.z) > 5.5 || pt[1] > CAVE_TOP + 4) return;
    if (this.caves.rock(pt[0], pt[1], pt[2]) < -0.05) return; // nothing solid there
    const ore = this.caves.ore(pt[0], pt[1], pt[2]), crystal = this.caves.crystal(pt[0], pt[1], pt[2]);
    const shovel = !!d.dig;
    this.caveMod(pt[0], pt[1], pt[2], shovel ? 1.35 : 0.95);
    const k = shovel ? 1 : 1.6 * (d.tool.ore || 1);
    this.give(p, 'stone', Math.round((4 + Math.random() * 4) * k));
    if (ore > 0.5) this.give(p, 'metal_ore', Math.round((5 + Math.random() * 6) * k));
    else if (ore < -0.5) this.give(p, 'sulfur_ore', Math.round((5 + Math.random() * 6) * k));
    if (crystal) this.give(p, 'hqm', 1 + Math.floor(Math.random() * 2 * k));
    const min = this.caves.mineral(pt[0], pt[1], pt[2]);
    if (min) this.give(p, min, Math.max(1, Math.round((min === 'kyanite' || min === 'quartz' ? 1 + Math.random() * 2 : 4 + Math.random() * 5) * k)));
    this.addXp(p, 1);
    this.toNear(pt[0], pt[2], 40, { t: 'fx', k: 'cavedig', p: pt, ore: ore > 0.5 ? 1 : ore < -0.5 ? 2 : crystal ? 3 : min ? 4 + ['copper_ore', 'lithium_ore', 'titanium_ore', 'quartz', 'kyanite'].indexOf(min) : 0 });
  }
  // loot crates waiting in the larger caverns (spawned the first time someone explores nearby)
  ensureCaveLoot(p) {
    const C = 48, cx = Math.floor(p.x / C), cz = Math.floor(p.z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const k = `cv_${cx + i}_${cz + j}`;
      if (this.spawned.has(k)) continue;
      this.spawned.add(k);
      const h = hash3(cx + i, cz + j, 61, this.seed);
      if (h > 0.35) continue;
      const rng = mulberry32(Math.floor(h * 1e9));
      for (let tries = 0; tries < 6; tries++) {
        const x = (cx + i + rng()) * C, z = (cz + j + rng()) * C;
        const fy = this.caves.floorBelow(x, CAVE_TOP - 4, z, 70);
        if (fy === null || this.caves.rock(x, fy + 2, z) > 0) continue;
        this.addLoot({ id: k, kind: 'crate', tier: rng() < 0.15 ? 3 : 2, x, y: fy, z, yaw: rng() * 6, slots: this.lootSlots(rng() < 0.15 ? 3 : 2), respawn: 0 });
        break;
      }
    }
  }
  // Rocks: thrown in an arc, hurt what they hit and land as a pickup
  onThrowRock(p, m) {
    const sel = num(m.sel) | 0, st = p.inv[sel];
    if (!p.alive || !st || st.id !== 'rock') return;
    const t = now();
    if (t - (p.lastRock || 0) < 0.55) return;
    p.lastRock = t;
    st.n -= 1; if (st.n <= 0) p.inv[sel] = null;
    p.rockInFlight = (p.rockInFlight || 0) + 1;
    this.sendInv(p);
    const a = Array.isArray(m.a) ? m.a.slice(0, 3).map((v) => num(v)) : [p.x, p.y + 1.5, p.z], v = Array.isArray(m.v) ? m.v.slice(0, 3).map((x) => Math.max(-40, Math.min(40, num(x)))) : [0, 0, 0];
    this.toNear(p.x, p.z, 120, { t: 'fx', k: 'throw', a, v, dur: Math.min(3, num(m.dur)) }, p);
  }
  onRockLand(p, m) {
    if (!(p.rockInFlight > 0)) return;
    p.rockInFlight--;
    const pt = Array.isArray(m.pt) ? m.pt.slice(0, 3).map((v) => num(v)) : null;
    if (!pt || Math.hypot(pt[0] - p.x, pt[2] - p.z) > 45) return;
    const h = m.hit;
    if (h && h.k === 'p') { const o = this.byPid.get(num(h.id)); if (o && o !== p && o.alive && Math.hypot(o.x - pt[0], o.z - pt[2]) < 3) this.damagePlayer(o, h.hs ? 22 : 12, p, !!h.hs); }
    else if (h && h.k === 'a') { const a = this.animals.get(String(h.id)); if (a && Math.hypot(a.x - pt[0], a.z - pt[2]) < 4) this.damageAnimal(a, h.hs ? 30 : 18, p); }
    const gy = this.world.ground(pt[0], pt[2]);
    this.dropBag(pt[0], Math.max(gy, pt[1] - 0.05), pt[2], [newStack('rock', 1)]);
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
    if (y < CAVE_ZONE) this.caveMod(x, y, z, Math.min(4, (ex.radius || 3) * 0.9)); // blasting opens up the caves
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
    if (this.ice.frozen && Math.abs(y - ICE_TOP) < 2.5 && this.ice.lakeAt(x, z)) this.breakIce(x, z, 1.6 + (ex.radius || 3) * 0.6, src);
    else if (y - this.world.ground(x, z) < 1.2 && !this.digBlocked(ix, iz)) this.editTerrain(ix, iz, -ex.radius * 0.18);
    for (const v of this.vehicles.values()) { const d = dist3(v, e); if (d < ex.radius * 1.6) this.damageVehicle(v, ex.dmg * 0.6 * (1 - d / (ex.radius * 1.6))); }
  }


  onChat(p, m) {
    const msg = String(m.m || '').replace(/[<>]/g, '').slice(0, 200).trim();
    if (!msg) return;
    if (/^\/(spawn|unstuck|help|admin|password)\b/.test(msg)) return this.publicCommand(p, msg.slice(1).split(/\s+/));
    if (this.settings.creative && /^\/(items|give|kit|heal|day|tp)\b/.test(msg)) return this.devCommand(p, msg.slice(1).split(/\s+/)); // creative servers: the item spawner for everyone
    if (msg.startsWith('/') && !msg.startsWith('/c ')) {
      if (this.isAdmin(p)) return this.devCommand(p, msg.slice(1).split(/\s+/));
      return this.toast(p, 'Unknown command — type /help');
    }
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

  // Commands available to everyone
  isAdmin(p) { return !!(process.env.DEV || p.admin || (this.ownerHash && p.tokenHash === this.ownerHash)); }
  publicCommand(p, [cmd, a]) {
    if (cmd === 'help') {
      this.send(p, { t: 'chat', from: '', m: 'Commands: /spawn atv|jeep|jeep4|pickup|hauler — spawn a working vehicle in a clear spot in front of you · /unstuck — free the vehicle you are in or next to · /c message — clan chat · /password new — protect your name with a password so you can sign in on other devices · /admin password — unlock admin commands' });
      if (this.isAdmin(p)) this.send(p, { t: 'chat', from: '', m: ADMIN_HELP });
      return;
    }
    if (cmd === 'password') {
      const pw = String(a || '');
      if (pw.length < 4) return this.toast(p, 'Usage: /password <new password> (at least 4 characters)');
      const key = p.name.toLowerCase(), acct = this.accounts.get(key);
      if (acct && acct.token !== p.token) return this.toast(p, 'That name belongs to another account');
      const salt = crypto.randomBytes(16).toString('hex');
      this.accounts.set(key, { name: p.name, salt, hash: hashPassword(pw, salt), token: p.token, created: acct?.created || Date.now() });
      this.onSave?.();
      return this.toast(p, `🔐 ${acct ? 'Password changed' : 'Account protected'} — sign in as "${p.name}" with this password on any device`);
    }
    if (cmd === 'admin') {
      const pw = process.env.ADMIN_PASSWORD;
      if (this.isAdmin(p)) return this.toast(p, 'You are already an admin — /help lists the commands');
      if (!pw) return this.toast(p, 'Admin commands are disabled on this server (no ADMIN_PASSWORD set)');
      const t = now();
      if (t - (p.lastAdminTry || 0) < 3) return this.toast(p, 'Wait a moment before trying again');
      p.lastAdminTry = t;
      if (String(a || '') !== pw) return this.toast(p, '❌ Wrong admin password');
      p.admin = true;
      console.log(`[admin] ${p.name} unlocked admin commands`);
      this.send(p, { t: 'chat', from: '', m: '✅ Admin unlocked. ' + ADMIN_HELP });
      return;
    }
    if (!p.alive) return;
    if (cmd === 'spawn') {
      const type = SPAWNABLE[String(a || '').toLowerCase()];
      if (!type) return this.toast(p, 'Usage: /spawn atv | jeep | jeep4 | pickup | hauler | rowboat | motorboat | minisub | cyclops');
      const t = now();
      if (!process.env.DEV && t - (p.lastSpawn || 0) < 30) return this.toast(p, `Wait ${Math.ceil(30 - (t - p.lastSpawn))}s before spawning another vehicle`);
      const spot = VEHICLES[type].boat || VEHICLES[type].sub ? this.findWaterSpot(type, p.x, p.z, p.yaw + Math.PI, null, VEHICLES[type].sub ? VEHICLES[type].half[1] * 2 + 1.5 : 1.2) : this.findClearSpot(type, p.x, p.z, p.yaw + Math.PI, [6, 9, 13, 18, 25, 33, 42, 55].map((d) => d + VEHICLES[type].half[2]));
      if (!spot) return this.toast(p, VEHICLES[type].boat || VEHICLES[type].sub ? 'No open water nearby — stand by a lake, river or the sea' : 'No clear, flat spot nearby — try an open area');
      // each player keeps at most 2 spawned vehicles (oldest empty one is removed)
      p.spawnedVeh = (p.spawnedVeh || []).filter((id) => this.vehicles.has(id));
      if (p.spawnedVeh.length >= 2 && !process.env.DEV) {
        const old = p.spawnedVeh.find((id) => { const v = this.vehicles.get(id); return v && !v.seats.some(Boolean) && !(v.attached && v.attached.size); });
        if (!old) return this.toast(p, 'You already have 2 spawned vehicles in use');
        this.vehicles.delete(old); p.spawnedVeh = p.spawnedVeh.filter((x) => x !== old);
      }
      const def = VEHICLES[type], id = this.id('V');
      const v = { id, type, x: spot.x, y: spot.y, z: spot.z, q: [0, Math.sin(spot.yaw / 2), 0, Math.cos(spot.yaw / 2)], vel: [0, 0, 0], hp: def.hp, broken: false, needs: {}, fuel: Math.round(def.fuelCap * 0.5), steer: 0, rpm: 0, var: Math.floor(Math.random() * 1000), seats: new Array(def.seats.length).fill(0), attached: new Set(), spawnedBy: p.pid };
      this.vehicles.set(id, v);
      if (def.outfit) this.outfitPacific(v);
      p.spawnedVeh.push(id); p.lastSpawn = t;
      return this.toast(p, `🚙 ${def.name} spawned ${Math.round(Math.hypot(spot.x - p.x, spot.z - p.z))}m away (half a tank of fuel)`);
    }
    if (cmd === 'unstuck') {
      let v = p.vehicle ? this.vehicles.get(p.vehicle.id) : null;
      if (!v) { let bd = 12; for (const o of this.vehicles.values()) { const d = dist3(o, p); if (d < bd) { bd = d; v = o; } } }
      if (!v) return this.toast(p, 'No vehicle nearby');
      const yaw = quatYaw(v.q);
      const spot = VEHICLES[v.type].boat || VEHICLES[v.type].sub ? this.findWaterSpot(v.type, v.x, v.z, yaw, v.id) : this.findClearSpot(v.type, v.x, v.z, yaw, [0, 4, 8, 12, 18], v.id);
      if (!spot) return this.toast(p, "Couldn't find a clear spot near the vehicle");
      v.x = spot.x; v.y = spot.y; v.z = spot.z; v.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]; v.vel = [0, 0, 0];
      this.refreshAttached(v);
      const driver = this.byPid.get(v.seats[0]);
      if (driver) this.send(driver, { t: 'v_reset', id: v.id, p: [v.x, v.y, v.z], q: v.q });
      return this.toast(p, `🔧 ${VEHICLES[v.type].name} freed`);
    }
  }

  // Developer / admin commands (only when the server runs with DEV=1)
  devCommand(p, [cmd, a, b, c]) {
    if (cmd === 'tp') {
      const x = num(a), z = num(b);
      this.teleport(p, x, c !== undefined ? num(c) : this.world.ground(x, z) + 1, z);
      this.updateRegions(p, true);
    } else if (cmd === 'tppoi') {
      const pois = this.world.allPOIs().filter((q) => !a || q.type === a);
      const q = pois[Math.floor(Math.random() * pois.length)];
      if (q) this.devCommand(p, ['tp', q.x + 30, q.z + 30]);
      this.toast(p, q ? `Teleported to ${q.name}` : 'No POI');
    } else if (cmd === 'give') {
      const id = this.findItem([a, b, c].filter((x) => x !== undefined && isNaN(+x)).join('_'));
      if (!id) return this.toast(p, `No item "${a || ''}" — open /items to browse`);
      const nArg = [b, c].find((x) => x !== undefined && !isNaN(+x));
      const n = Math.max(1, Math.min(10000, nArg !== undefined ? num(nArg, 1) | 0 : ITEMS[id].stack || 1));
      this.give(p, id, n); this.sendInv(p);
    } else if (cmd === 'season') {
      const i = SEASONS.indexOf(String(a || ''));
      if (i < 0) return this.toast(p, 'Usage: /season spring | summer | autumn | winter [late]');
      this.year = i + (b === 'late' ? 0.6 : i === 3 ? 0.3 : 0.02);
      this.toAll({ t: 'time', day: this.day, year: this.year, jump: 1 });
      this.tickIce();
      this.toast(p, `${['🌸', '☀️', '🍂', '❄️'][i]} It is now ${SEASON_NAMES[i]}`);
    } else if (cmd === 'leak') {
      // spring a leak in the sealed room (or the Pacific) you're standing in
      const sub = this.subAround(p);
      if (sub) { const I = VEHICLES[sub.type].interior; (sub.leaks = sub.leaks || []).push([r2(I.hx - 0.05), r2(I.y0 + 1.2), r2((Math.random() - 0.5) * 10)]); return this.toast(p, '💦 Leak sprung in the Pacific'); }
      const r = this.roomAt(p.x, p.y + 0.2, p.z);
      const q = r && r.room.shell.find((x) => PIECES[x.type].slot === 'edge');
      if (!q) return this.toast(p, 'Stand inside a sealed room');
      (q.leaks = q.leaks || []).push([0, 1.2, 0.13]); this.updStruct(q);
      return this.toast(p, '💦 Leak sprung');
    } else if (cmd === 'weather') {
      if (!WEATHER_TARGETS[a]) return this.toast(p, 'Usage: /weather clear | overcast | rain | storm');
      this.setWeather(a, b === 'now');
      this.toast(p, `🌦️ Weather → ${a}${b === 'now' ? ' (instantly)' : ' (rolling in)'}`);
    } else if (cmd === 'cave') {
      const key = `adm_${Math.round(p.x)}_${Math.round(p.z)}`;
      this.openCaveAt(key, p.x, p.z);
      const fy = this.caves.floorBelow(p.x, CAVE_ARRIVE + 3, p.z, 20) ?? CAVE_ARRIVE - 4;
      this.teleport(p, p.x, fy + 0.1, p.z);
    } else if (cmd === 'resetserver') {
      // step 1: hand the admin a one-time code; the client shows a confirmation dialog
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      p.resetCode = { code, until: now() + 120 };
      this.send(p, { t: 'reset_confirm', code, stats: { players: this.players.size, structs: this.structs.size, vehicles: this.vehicles.size, accounts: this.accounts.size } });
    } else if (cmd === 'items') {
      this.send(p, { t: 'admin_items', q: [a, b, c].filter(Boolean).join(' ') });
    } else if (cmd === 'tpdeath') {
      const d = p.lastDeath;
      if (!d) return this.toast(p, "You haven't died yet");
      if (!p.alive) return this.toast(p, 'Respawn first, then use /tpdeath');
      if (p.vehicle) this.exitVehicle(p);
      this.teleport(p, d.x, Math.max(d.y, this.world.ground(d.x, d.z)) + 0.5, d.z);
      this.updateRegions(p, true);
      this.toast(p, `☠ Teleported to your last death (${Math.round(d.x)}, ${Math.round(d.z)})`);
    }
    else if (cmd === 'kit') {
      for (const [id, n] of [['wood', 2000], ['stone', 2000], ['metal_frags', 1000], ['hqm', 100], ['cloth', 300], ['leather', 200], ['scrap', 500], ['fuel', 200], ['building_plan', 1], ['hammer', 1], ['rifle', 1], ['rifle_ammo', 120], ['c4', 4], ['satchel', 6], ['wheel', 4], ['engine_parts', 2], ['tool_cupboard', 1], ['wood_door', 2], ['workbench3', 1], ['furnace', 1], ['metal_chest', 1], ['metal_mask', 1], ['metal_legs', 1]]) this.give(p, id, n, false);
      this.sendInv(p);
    } else if (cmd === 'day') { this.day = Math.max(0, Math.min(0.999, num(a, 0.5))); this.toAll({ t: 'time', day: this.day }); }
    else if (cmd === 'heal') { p.hp = this.maxHp(p); p.food = 100; p.water = 100; p.breath = BREATH_MAX; this.sendStats(p); }
    else this.toast(p, ADMIN_HELP);
  }
  // step 2: the admin typed RESET + the code and confirmed twice
  onResetWorld(p, m) {
    if (!this.isAdmin(p)) return;
    const rc = p.resetCode;
    if (!rc || now() > rc.until) return this.toast(p, 'Reset code expired — type /resetserver again');
    if (String(m.code || '').toUpperCase() !== rc.code || m.word !== 'RESET') return this.toast(p, 'Confirmation did not match — nothing was reset');
    p.resetCode = null;
    console.log(`[admin] ${p.name} RESET THE SERVER${m.newIsland ? ' (new island)' : ''}`);
    this.toAll({ t: 'server_reset', by: p.name, newIsland: !!m.newIsland });
    setTimeout(() => this.onReset?.({ newIsland: !!m.newIsland }), 300);
  }
  findItem(q) {
    q = String(q || '').toLowerCase().trim();
    if (!q) return null;
    if (ITEMS[q]) return q;
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nq = norm(q);
    const ids = Object.keys(ITEMS);
    return ids.find((id) => norm(ITEMS[id].name) === nq || norm(id) === nq) || ids.find((id) => norm(ITEMS[id].name).includes(nq) || norm(id).includes(nq)) || null;
  }
  onAdminGive(p, m) {
    if (!this.isAdmin(p) || !ITEMS[m.id] || !p.alive) return;
    const n = Math.max(1, Math.min(10000, num(m.n, 1) | 0));
    this.give(p, m.id, n); this.sendInv(p);
  }

  // ------------------------------------------------------------ spray paint
  onPaint(p, m) {
    if (!p.alive || p.inv[num(m.sel, p.sel) | 0]?.id !== 'spray_can') return;
    const kind = m.k, id = String(m.id);
    const tgt = kind === 'v' ? this.vehicles.get(id) : kind === 's' ? this.structs.get(id) : null;
    if (!tgt) return;
    const reach = SPRAY_RANGE + 2 + (kind === 'v' ? Math.hypot(...VEHICLES[tgt.type].half) : 3);
    if (dist3(tgt, p) > reach) return;
    // permission: vehicles owned by someone (hauler) → owner/clan; structures → building privilege
    if (kind === 'v' ? tgt.owner && !this.canUseDeck(p, tgt) : this.privBlocked(p, tgt.x, tgt.z, tgt)) return this.toast(p, '🔒 You need building privilege to paint this');
    const mode = m.m;
    if (mode === 'color') {
      const c = num(m.c, -1) | 0;
      tgt.paint = c >= 0 && c < PAINT_COLORS.length ? c : undefined;
    } else if (mode === 'decal') {
      const d = num(m.d, -1) | 0, c = num(m.c, 0) | 0, sz = num(m.sz, 1) | 0;
      if (d < 0 || d >= DECALS.length || c < 0 || c >= PAINT_COLORS.length || sz < 0 || sz >= DECAL_SIZES.length) return;
      if (!Array.isArray(m.p) || !Array.isArray(m.n)) return;
      const P = m.p.slice(0, 3).map((x) => Math.max(-12, Math.min(12, num(x)))), N = m.n.slice(0, 3).map((x) => num(x));
      const nl = Math.hypot(...N) || 1;
      tgt.decals = tgt.decals || [];
      tgt.decals.push({ d, c, sz, p: P.map(r3), n: N.map((x) => r3(x / nl)), r: r2(num(m.r)) });
      if (tgt.decals.length > MAX_DECALS) tgt.decals.shift();
    } else if (mode === 'clear') { tgt.decals = []; tgt.paint = undefined; }
    else return;
    if (kind === 'v') { tgt.decRev = (tgt.decRev || 0) + 1; this.sendVehiclePaint(tgt); }
    else this.updStruct(tgt);
    this.toNear(tgt.x, tgt.z, 40, { t: 'fx', k: 'spray', p: [tgt.x, tgt.y, tgt.z], c: m.c | 0 });
  }
  sendVehiclePaint(v, to = null) {
    const msg = { t: 'vpaint', id: v.id, pa: v.paint ?? -1, dc: v.decals || [], rev: v.decRev || 0 };
    if (to) this.send(to, msg); else this.toNear(v.x, v.z, SNAP_RANGE, msg);
  }
  onVehiclePaintReq(p, m) { const v = this.vehicles.get(String(m.id)); if (v) this.sendVehiclePaint(v, p); }

  // ------------------------------------------------------------ vehicles
  onVehicleEnter(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || !p.alive || p.vehicle) return;
    if (dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5 + Math.max(0, VEHICLES[v.type].half[2] - 2)) return;
    if (v.broken) return this.toast(p, 'This vehicle is broken — repair it first');
    if (v.dockedIn) return this.toast(p, 'Docked — release it from the docking console inside the Pacific');
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
      if (Math.hypot(x - v.x, z - v.z) < Math.max(8, VEHICLES[v.type].half[2] + 3)) { p.x = x; p.y = y; p.z = z; }
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
    const vd = VEHICLES[v.type];
    if (vd.power) v.fuel = Math.max(0, v.fuel - vd.fuelUse * dt * (0.12 + Math.abs(v.thr) + Math.abs(num(m.vt)) * 0.5) * (1 - subStats(vd, v.modules, ITEMS).eff));
    else if (Math.abs(v.thr) > 0.05) { v.fuel = Math.max(0, v.fuel - vd.fuelUse * dt * Math.abs(v.thr)); }
    for (const pid of v.seats) { const o = this.byPid.get(pid); if (o) { o.x = v.x; o.y = v.y; o.z = v.z; this.updateRegions(o); } }
    this.refreshAttached(v);
    if (v.docked) this.refreshDocked(v);
    this.tyreTracks(v);
  }
  onVehicleFuel(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5 + Math.max(0, VEHICLES[v.type].half[2] - 2)) return;
    const def = VEHICLES[v.type];
    if (def.power) {
      // swap in batteries / power cells (the old ones are used up)
      let added = 0;
      for (const id of ['power_cell', 'battery']) {
        while (v.fuel + ITEMS[id].power * 0.5 <= def.fuelCap && Inv.count(p.inv, id) > 0) { Inv.remove(p.inv, id, 1); v.fuel = Math.min(def.fuelCap, v.fuel + ITEMS[id].power); added++; }
      }
      if (!added) return this.toast(p, v.fuel >= def.fuelCap - 5 ? 'Fully charged' : 'You have no Batteries or Power Cells');
      this.sendInv(p);
      return this.toast(p, `🔋 Charged to ${Math.floor(v.fuel)}/${def.fuelCap}`);
    }
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
    if (!v || dist3(v, p) > VEHICLE_ENTER_RANGE + 2.5 + Math.max(0, VEHICLES[v.type].half[2] - 2) || !p.alive) return;
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
  sVehicleFull(v) { return { id: v.id, type: v.type, var: v.var || 0, p: [v.x, v.y, v.z], q: v.q, vel: v.vel, hp: v.hp, fuel: v.fuel, broken: v.broken, needs: v.needs, sub: VEHICLES[v.type].sub ? this.subInfo(v) : undefined }; }
  // ------------------------------------------------------------ submarines
  subInfo(v) { const st = subStats(VEHICLES[v.type], v.modules, ITEMS); return [st.crush, r2(st.thrust), r2(st.eff), r2(st.hull)]; }
  inSubInterior(v, o) {
    const I = VEHICLES[v.type].interior;
    if (!I) return false;
    const [qx, qy, qz, qw] = v.q, l = quatRotate([-qx, -qy, -qz, qw], [o.x - v.x, o.y - v.y, o.z - v.z]);
    return Math.abs(l[0]) < I.hx && Math.abs(l[2]) < I.hz && l[1] > I.y0 - 0.3 && l[1] < I.y1;
  }
  subAround(o) { for (const v of this.vehicles.values()) if (VEHICLES[v.type].interior && Math.abs(v.x - o.x) < 16 && Math.abs(v.z - o.z) < 16 && this.inSubInterior(v, o)) return v; return null; }
  // pressure on the hull below crush depth, a second at a time
  tickSubs(dt) {
    for (const v of this.vehicles.values()) {
      const def = VEHICLES[v.type];
      // the Pacific's interior: leaks let water in, it drains once they're sealed; a wrecked hull fills right up
      if (def.interior) {
        const H = def.interior.y1 - def.interior.y0, n = v.leaks?.length || 0, was = v.flood || 0;
        v.flood = v.broken ? Math.min(H, was + 0.25 * dt) : n ? Math.min(H, was + n * 0.03 * dt) : Math.max(0, was - 0.06 * dt);
        if (v.docked) { const c = this.vehicles.get(v.docked); if (c && c.fuel < VEHICLES.minisub.fuelCap && v.fuel > 1) { const q = Math.min(2 * dt, VEHICLES.minisub.fuelCap - c.fuel); c.fuel += q; v.fuel -= q * 0.8; } }
      }
      if (!def.sub || v.broken || v.dockedIn) continue;
      const st = subStats(def, v.modules, ITEMS), depth = -v.y;
      if (depth <= st.crush) { v.crushWarn = 0; continue; }
      const dmg = (6 + (depth - st.crush) * 1.2) * dt * (1 - st.hull);
      this.damageVehicle(v, dmg);
      // the pressure pops leaks in the Pacific's hull
      if (def.interior && (v.leaks?.length || 0) < 6 && Math.random() < 0.12 * dt) {
        const I = def.interior, side = Math.random() < 0.5 ? -1 : 1;
        (v.leaks = v.leaks || []).push([r2(side * (I.hx - 0.05)), r2(I.y0 + 0.4 + Math.random() * 2.6), r2((Math.random() - 0.5) * 2 * (I.hz - 1.5))]);
      }
      const driver = this.byPid.get(v.seats[0]);
      if (driver && now() - (v.crushWarn || 0) > 6) { v.crushWarn = now(); this.toast(driver, `⚠️ HULL CRUSHING — ${Math.round(depth)} m is below your crush depth of ${st.crush} m. Climb, or fit a better depth module!`); }
      if (!driver) continue;
      this.send(driver, { t: 'fx', k: 'creak', id: v.id });
    }
  }
  // the Pacific comes fitted out: a fabricator and lockers inside, and a Mini Sub in its docking bay
  outfitPacific(v) {
    const def = VEHICLES[v.type];
    for (const [kind, lx, lz, yaw] of def.outfit) {
      const d = ITEMS[kind].deploy;
      const s2 = { id: this.id('S'), kind: 'deploy', type: kind, hp: d.hp, mhp: d.hp, owner: v.owner || 0, veh: v.id, local: { x: lx, y: def.interior.y0, z: lz, yaw }, x: 0, y: 0, z: 0, yaw: 0, created: now() };
      if (d.slots) s2.slots = Inv.emptySlots(d.slots);
      this.addStruct(s2);
    }
    const md = VEHICLES.minisub, id = this.id('V');
    const m = { id, type: 'minisub', x: v.x, y: v.y, z: v.z, q: v.q.slice(), vel: [0, 0, 0], hp: md.hp, broken: false, needs: {}, fuel: md.fuelCap, steer: 0, rpm: 0, var: Math.floor(Math.random() * 1000), seats: new Array(md.seats.length).fill(0), attached: new Set(), owner: v.owner, dockedIn: v.id };
    this.vehicles.set(id, m); v.docked = id;
    this.refreshDocked(v);
  }
  dockPose(v) { const d = VEHICLES[v.type].dock, w = quatRotate(v.q, [d.x, d.y, d.z]); return { x: v.x + w[0], y: v.y + w[1], z: v.z + w[2] }; }
  refreshDocked(v) {
    const c = v.docked && this.vehicles.get(v.docked);
    if (!c) { v.docked = null; return; }
    Object.assign(c, this.dockPose(v)); c.q = v.q.slice(); c.vel = v.vel ? v.vel.slice() : [0, 0, 0];
  }
  // from the docking console inside: drop into the Mini Sub and release it
  onUndock(p, m) {
    const v = this.vehicles.get(String(m.id));
    if (!v || !p.alive || p.vehicle || !this.inSubInterior(v, p)) return;
    const c = v.docked && this.vehicles.get(v.docked);
    if (!c) return this.toast(p, 'The docking bay is empty — drive a Mini Sub up into it to dock');
    if (c.broken) return this.toast(p, 'The docked Mini Sub is wrecked — repair it first');
    if (v.y > -VEHICLES[v.type].half[1] * 0.3) return this.toast(p, 'Dive first — the bay opens under water');
    v.docked = null; c.dockedIn = null;
    const pose = this.dockPose(v); c.x = pose.x; c.y = pose.y - 0.8; c.z = pose.z;
    c.seats[0] = p.pid; p.vehicle = { id: c.id, seat: 0 }; p.x = c.x; p.y = c.y; p.z = c.z;
    this.send(p, { t: 'v_seat', id: c.id, seat: 0, v: this.sVehicleFull(c) });
    this.toast(p, '🔓 Mini Sub released from the docking bay');
  }
  // drive the Mini Sub up under a Pacific's bay to dock: you climb up into the Pacific and the sub recharges
  onDock(p) {
    const c = p.vehicle && this.vehicles.get(p.vehicle.id);
    if (!c || p.vehicle.seat !== 0 || c.type !== 'minisub') return;
    for (const v of this.vehicles.values()) {
      if (!VEHICLES[v.type].dock || v.docked || v.broken) continue;
      const d = this.dockPose(v);
      if (Math.hypot(d.x - c.x, d.y - c.y, d.z - c.z) > 4) continue;
      v.docked = c.id; c.dockedIn = v.id; c.vel = [0, 0, 0];
      this.refreshDocked(v);
      c.seats[0] = 0; p.vehicle = null;
      const I = VEHICLES[v.type].interior, w = quatRotate(v.q, [-1.2, I.y0 + 0.05, VEHICLES[v.type].dock.z]);
      this.send(p, { t: 'v_seat', id: null });
      this.teleport(p, v.x + w[0], v.y + w[1], v.z + w[2]);
      return this.toast(p, '🔒 Docked — you climb up into the Pacific. The Mini Sub recharges from its power.');
    }
  }
  // launch a vehicle kit into the water in front of you
  onLaunch(p, m) {
    if (!p.alive || p.vehicle) return;
    const i = num(m.sel) | 0, st = p.inv[i], d = st && ITEMS[st.id];
    if (!d?.launch) return;
    const type = d.launch, def = VEHICLES[type];
    const spot = this.findWaterSpot(type, p.x, p.z, p.yaw + Math.PI, null, def.sub ? def.half[1] * 2 + 1.5 : 1.2);
    if (!spot) return this.toast(p, def.sub ? `Needs deeper open water (over ${Math.ceil(def.half[1] * 2 + 1.5)} m) in front of you` : 'Needs open water in front of you');
    Inv.remove(p.inv, st.id, 1); this.sendInv(p);
    const id = this.id('V');
    const y = def.sub ? -def.half[1] * 0.45 : spot.y;
    const nv = { id, type, x: spot.x, y, z: spot.z, q: [0, Math.sin(spot.yaw / 2), 0, Math.cos(spot.yaw / 2)], vel: [0, 0, 0], hp: def.hp, broken: false, needs: {}, fuel: Math.round(def.fuelCap * (def.sub ? 0.5 : 0.3)), steer: 0, rpm: 0, var: Math.floor(Math.random() * 1000), seats: new Array(def.seats.length).fill(0), attached: new Set(), owner: p.pid };
    this.vehicles.set(id, nv);
    if (def.outfit) this.outfitPacific(nv);
    this.toast(p, `${def.sub ? '🌊' : '🚣'} ${def.name} launched${def.sub ? ' — charge it with batteries (G), fit modules at its module bay (U)' : ''}`);
  }

  // ------------------------------------------------------------ animals
  tickAnimals(dt) {
    const t = now();
    const online = [...this.players.values()].filter((p) => p.online && p.alive);
    // spawn
    for (const p of online) {
      let near = 0;
      for (const a of this.animals.values()) if (dist2(a, p) < 220 * 220) near++;
      if (this.settings.animals && near < 4 && Math.random() < 0.05 && this.animals.size < 200) {
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
    // sharks patrol the open sea around swimmers and boats
    for (const p of online) {
      if (!this.settings.sharks || p.y > 0.6 || p.y < CAVE_ZONE || this.ice.inland(p.x, p.z) || this.world.ground(p.x, p.z) > -6) continue;
      let near = 0;
      for (const a of this.animals.values()) if (a.type === 'shark' && dist2(a, p) < 160 * 160) near++;
      if (near >= 2 || Math.random() > 0.04) continue;
      const ang = Math.random() * Math.PI * 2, r = 60 + Math.random() * 40, x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
      const g = this.world.ground(x, z);
      if (g > -8 || this.ice.inland(x, z)) continue;
      const id = this.id('A');
      this.animals.set(id, { id, type: 'shark', x, y: Math.max(g + 2, -4 - Math.random() * 10), z, yaw: Math.random() * 6.28, hp: ANIMALS.shark.hp, st: 0, tx: x, tz: z, until: 0, lastAtk: 0 });
    }
    for (const a of [...this.animals.values()]) {
      const def = ANIMALS[a.type];
      if (def.swim) { this.tickSwimmer(a, def, online, t, dt); continue; }
      let nearest = null, nd = Infinity;
      for (const p of online) { if (p.vehicle || Math.abs(p.y - a.y) > 40) continue; const d = Math.sqrt(dist2(a, p)); if (d < nd) { nd = d; nearest = p; } }
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
  // sea creatures: swim in 3D, circle, then charge anyone in the water (not boats, not dry rooms)
  tickSwimmer(a, def, online, t, dt) {
    let nearest = null, nd = Infinity, anyNear = false;
    for (const p of online) {
      const d2 = dist2(a, p);
      if (d2 < 320 * 320) anyNear = true;
      if (p.vehicle || p.y > -0.4 || p.dry) continue;
      const d = Math.hypot(Math.sqrt(d2), p.y + 1 - a.y);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (!anyNear) { this.animals.delete(a.id); return; }
    const hurt = t - (a.hurtT || 0) < 10;
    let tx = a.tx, tz = a.tz, ty = a.ty ?? a.y, speed;
    if (nearest && (nd < 35 || hurt)) {
      // circle in, then strike
      a.st = 1; speed = def.speed * (nd < 10 ? 1.3 : 0.85);
      const circ = nd > 9 ? 0.9 : 0;
      const ang = Math.atan2(a.x - nearest.x, a.z - nearest.z) + circ;
      tx = nearest.x + Math.sin(ang) * Math.min(nd, 8) * (circ ? 1 : 0); tz = nearest.z + Math.cos(ang) * Math.min(nd, 8) * (circ ? 1 : 0); ty = nearest.y + 0.9;
      if (nd < 2.4 + def.size * 0.5) {
        a.st = 2;
        if (t - a.lastAtk > 1.6) { a.lastAtk = t; this.damagePlayer(nearest, def.dmg, `a ${def.name.toLowerCase()}`); this.toNear(a.x, a.z, 60, { t: 'fx', k: 'bite', id: a.id }); }
      }
    } else {
      a.st = 0; speed = def.speed * 0.35;
      if (t > a.until || Math.hypot(a.tx - a.x, a.tz - a.z) < 2) { a.tx = a.x + (Math.random() - 0.5) * 60; a.tz = a.z + (Math.random() - 0.5) * 60; a.ty = -2 - Math.random() * 12; a.until = t + 6 + Math.random() * 8; }
      tx = a.tx; tz = a.tz; ty = a.ty;
    }
    const dx = tx - a.x, dz = tz - a.z;
    let dy = Math.atan2(dx, dz) - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    a.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, dy));
    const nx = a.x + Math.sin(a.yaw) * speed * dt, nz = a.z + Math.cos(a.yaw) * speed * dt;
    const g = this.world.ground(nx, nz);
    if (g > -2.5 || this.ice.inland(nx, nz)) { a.tx = a.x - dx; a.tz = a.z - dz; a.until = t + 4; a.yaw += Math.PI * 0.5; return; } // keep to deep water
    a.x = nx; a.z = nz;
    a.y += Math.max(-2 * dt, Math.min(2 * dt, Math.max(g + 1.2, Math.min(-1.3, ty)) - a.y));
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
    this.day = (this.day + dt / this.dayLen) % 1;
    const ps = Math.floor(this.year);
    this.year = (this.year + dt / (this.dayLen * this.settings.seasonDays)) % 4;
    if (Math.floor(this.year) !== ps) { const si = Math.floor(this.year); this.toAll({ t: 'chat', from: '', m: ['🌸 Spring is here — the snow melts and the flowers come back.', '☀️ Summer has arrived.', '🍂 Autumn: the leaves are turning.', '❄️ Winter has come. Snow will cover the island — dress warm and keep a fire going.'][si] }); this.toAll({ t: 'time', day: this.day, year: this.year }); }
    this.tickExplosives();
    this.tickCrafting();
    this.tickAnimals(dt);
    this.tickWeather(dt);
    this.acc.stats += dt; this.acc.save += dt; this.acc.slow += dt;
    if (this.acc.stats >= 1) { this.tickStats(this.acc.stats); this.tickSubs(this.acc.stats); this.tickFlood(this.acc.stats); this.acc.stats = 0; }
    if (this.acc.slow >= 15) { this.tickSlow(); this.acc.slow = 0; }
    if (this.acc.save >= 60 && this.onSave) { this.acc.save = 0; this.onSave(); }
    this.flushPrints();
    this.sendSnapshots();
    for (const p of this.players.values()) if (p.invDirty && p.online) this.sendInv(p);
  }

  tickStats(dt) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (!p.online) continue; // sleepers don't starve
      if (now() - (p.lastSt || 0) > 5) continue; // tab closed / hidden / connection stalled: no hunger or thirst while away
      p.food = Math.max(0, p.food - 0.045 * dt * this.settings.hunger);
      p.water = Math.max(0, p.water - 0.07 * dt * this.settings.hunger);
      if ((p.food <= 0 || p.water <= 0) && this.settings.difficulty !== 'peaceful') { p.hp -= 0.6 * dt; if (p.hp <= 0) { this.killPlayer(p, p.food <= 0 ? 'starvation' : 'dehydration'); continue; } }
      else if (p.food > 60 && p.water > 60 && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + 0.25 * dt);
      // cold: tundra / night / water
      const b = this.world.biome(p.x, p.z);
      const night = this.day > 0.78 || this.day < 0.2;
      let cold = 0;
      if (b === BIOME.SNOW) cold += 0.7;
      if (p.y > CAVE_ZONE && b !== BIOME.DESERT) { const si = seasonInfo(this.year); cold += si.cold + (si.season === 3 ? this.weather.rain * 0.25 : 0); } // winter (and snowfall) bites
      if (night) cold += 0.25;
      if (p.y < 0.1 && this.world.ground(p.x, p.z) < 0) cold += 0.3 + (this.ice.frozen && this.ice.lakeAt(p.x, p.z) ? 0.6 : 0); // icy water bites hard
      let warmth = 0;
      for (const s of ARMOR_SLOTS) if (p.armor[s]) warmth += ITEMS[p.armor[s].id].armor.cold;
      for (const s of this.structsNear(p.x, p.z, 0)) if ((s.type === 'campfire' || s.type === 'furnace') && dist3(s, p) < 5) warmth += 1;
      p.cold = Math.max(0, cold - warmth);
      if (p.cold > 0.5) { p.hp -= (p.cold - 0.5) * 1.2 * dt; if (p.hp <= 0) { this.killPlayer(p, 'the cold'); continue; } }
      // breath: holding it underwater, drowning when it runs out
      const head = p.y + (p.cr ? 1.05 : 1.55);
      // inside a sealed room or the Pacific the water line is whatever has leaked in (none if it's dry)
      const sub = this.subAround(p), room = sub ? null : head < 1 ? this.roomAt(p.x, p.y + 0.2, p.z) : null;
      const wl = sub ? sub.y + VEHICLES[sub.type].interior.y0 + (sub.broken ? 99 : sub.flood || 0) : room ? room.floorY + room.level : null;
      p.dry = wl !== null && head > wl;
      const under = !p.vehicle && (wl !== null ? head < wl - 0.05 : p.y > CAVE_ZONE ? head < -0.1 && this.world.ground(p.x, p.z) < head : this.caves.flooded(p.x, p.z));
      if (p.breath === undefined) p.breath = BREATH_MAX;
      // the deeper you are, the faster a breath (or a tank) runs out
      const drain = breathDrain(-head);
      const tank = p.armor.back, tmax = tank && ITEMS[tank.id]?.armor?.air;
      if (tmax && tank.air === undefined) tank.air = tmax;
      if (under && tmax && tank.air > 0) tank.air = Math.max(0, tank.air - dt * drain);
      else if (under) p.breath = Math.max(0, p.breath - dt * drain);
      else { p.breath = Math.min(BREATH_MAX, p.breath + dt * 5); if (tmax) tank.air = Math.min(tmax, tank.air + dt * 6); } // tanks top up from the air
      if (under && p.breath <= 0) { p.hp -= 9 * dt; if (p.hp <= 0) { p.breath = BREATH_MAX; this.killPlayer(p, 'drowning'); continue; } }
      this.sendStats(p);
    }
    for (const p of this.players.values()) if (p.online && p.queue.length) this.sendQueue(p);
  }

  tickSlow() {
    const t = now();
    this.expirePrints();
    this.tickIce();
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
    this.toAll({ t: 'time', day: this.day, year: this.year });
  }

  sendSnapshots() {
    const R2 = SNAP_RANGE * SNAP_RANGE;
    const all = [...this.players.values()];
    for (const p of all) {
      if (!p.online || !p.ws || p.ws.readyState !== 1) continue;
      const pl = [], ve = [], an = [];
      for (const o of all) {
        if (o === p || !o.alive || dist2(o, p) > R2) continue;
        const hs = o.inv[o.sel], held = hs ? hs.id + (hs.mods ? '|' + modsKey(hs.mods) : '') : '';
        const flags = (o.cr ? 1 : 0) | (!o.online ? 2 : 0) | (o.vehicle ? 4 : 0) | (o.air ? 8 : 0) | (o.spr ? 16 : 0) | (this.sameClan(o, p) ? 32 : 0) | (o.sw && !o.vehicle ? 64 : 0);
        pl.push([o.pid, r2(o.x), r2(o.y), r2(o.z), r2(o.yaw), r2(o.pitch), flags, held, ARMOR_SLOTS.map((s) => o.armor[s]?.id || '').join(','), o.name, o.vehicle ? o.vehicle.id : '', o.vehicle ? o.vehicle.seat : -1, o.lookStr || '', this.clans.get(o.clan)?.tag || '']);
      }
      for (const v of this.vehicles.values()) {
        if (dist2(v, p) > R2) continue;
        ve.push([v.id, v.type, r2(v.x), r2(v.y), r2(v.z), v.q.map((x) => Math.round(x * 1e4) / 1e4), Math.ceil(v.hp), v.broken ? 1 : 0, r2(v.steer || 0), r2(v.rpm || 0), v.seats[0] || 0, Math.floor(v.fuel), v.broken ? v.needs : 0, v.vel ? v.vel.map(r2) : [0, 0, 0], v.var || 0, v.attached ? v.attached.size : 0, v.decRev || 0, VEHICLES[v.type].sub ? this.subInfo(v) : 0, v.dockedIn || 0, VEHICLES[v.type].interior ? [r2(v.flood || 0), v.leaks || []] : 0]);
      }
      for (const a of this.animals.values()) {
        if (dist2(a, p) > R2) continue;
        an.push([a.id, a.type, r2(a.x), r2(a.y), r2(a.z), r2(a.yaw), a.st, Math.ceil(a.hp)]);
      }
      p.ws.send(JSON.stringify({ t: 'snap', pl, ve, an }));
    }
  }
}
