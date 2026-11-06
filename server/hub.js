// The server hub: many worlds in one process. Each "server" has its own saved world (its own Game) and settings.
// Public servers are listed on the home screen; private ones are joined with an invite code (+ optional password).
// Owners (identified by a hash of their device token) change settings live. Idle worlds are saved and unloaded.
import crypto from 'crypto';
import { Game, DEFAULT_SETTINGS, cleanSettings } from './game.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SERVERS = 60, MAX_PER_OWNER = 3, MAX_LOADED = 6, IDLE_UNLOAD = 10 * 60;
const now = () => Date.now() / 1000;
function hashPw(pw) { const salt = crypto.randomBytes(8).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
function checkPw(pw, h) { if (!h) return true; const [salt, hex] = h.split(':'); try { return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), crypto.scryptSync(String(pw || ''), salt, 32)); } catch { return false; } }

export class Hub {
  constructor(store, { seed = 1337 } = {}) {
    this.store = store; this.seed = seed;
    this.servers = new Map(); // id -> meta {id, name, code, public, pw, owner, settings, seed, created, official}
    this.loaded = new Map();  // id -> {game, idleSince}
  }
  async init() {
    let reg = null;
    try { reg = await this.store.load('servers'); } catch (e) { console.error('[hub] registry load failed', e.message); }
    for (const m of reg?.servers || []) this.servers.set(m.id, m);
    if (!this.servers.has('main')) this.servers.set('main', { id: 'main', name: 'Odyssey Rush — Official', code: 'OFFICIAL', public: true, pw: null, owner: null, settings: { ...DEFAULT_SETTINGS }, created: now(), official: true });
    await this.game('main');
    await this.saveRegistry();
  }
  async saveRegistry() { try { await this.store.save({ servers: [...this.servers.values()] }, 'servers'); } catch (e) { console.error('[hub] registry save failed', e.message); } }

  // load (or return) a server's world
  async game(id) {
    const L = this.loaded.get(id);
    if (L) return L.game;
    const meta = this.servers.get(id);
    if (!meta) return null;
    if (this._loading?.[id]) return this._loading[id];
    this._loading = this._loading || {};
    this._loading[id] = (async () => {
      // make room: unload the idlest world
      if (this.loaded.size >= MAX_LOADED) {
        const idle = [...this.loaded.entries()].filter(([k, v]) => k !== 'main' && v.game.onlineCount() === 0).sort((a, b) => (a[1].idleSince || 0) - (b[1].idleSince || 0))[0];
        if (idle) await this.unload(idle[0]);
      }
      let saved = null;
      try { saved = await this.store.load(id); } catch (e) { console.error('[hub] load failed', id, e.message); }
      const seed = id === 'main' ? (saved?.customSeed ? saved.seed : this.seed) : saved?.seed ?? meta.seed;
      const game = new Game({ seed, saved, settings: meta.settings, ownerHash: meta.owner });
      game.onSave = () => this.saveGame(id);
      game.onReset = (o) => this.resetWorld(id, o);
      this.loaded.set(id, { game, idleSince: now() });
      console.log(`[hub] loaded server ${id} (${meta.name}, seed ${seed})`);
      delete this._loading[id];
      return game;
    })();
    return this._loading[id];
  }
  async saveGame(id) {
    const L = this.loaded.get(id);
    if (!L || L.saving) return;
    L.saving = true;
    try { const n = await this.store.save(L.game.serialize(), id); console.log(`[store] saved ${id} (${(n / 1024).toFixed(0)} KB)`); }
    catch (e) { console.error('[store] save failed', id, e.message); }
    finally { L.saving = false; }
  }
  async unload(id) {
    const L = this.loaded.get(id);
    if (!L) return;
    await this.saveGame(id);
    this.loaded.delete(id);
    console.log(`[hub] unloaded idle server ${id}`);
  }
  async saveAll() { for (const id of this.loaded.keys()) await this.saveGame(id); await this.saveRegistry(); }
  async resetWorld(id, { newIsland }) {
    const L = this.loaded.get(id), meta = this.servers.get(id);
    if (!L || !meta) return;
    const old = L.game;
    const seed = newIsland ? 1 + Math.floor(Math.random() * 2 ** 30) : old.seed;
    const keep = { seed, customSeed: newIsland || !!old.customSeed, accounts: [...old.accounts.values()] };
    for (const p of old.players.values()) { try { p.ws?.close(4002, 'reset'); } catch {} }
    const game = new Game({ seed, saved: keep, settings: meta.settings, ownerHash: meta.owner });
    game.onSave = () => this.saveGame(id); game.onReset = (o) => this.resetWorld(id, o);
    L.game = game; meta.seed = seed;
    await this.saveGame(id); await this.saveRegistry();
    console.log(`[hub] world ${id} reset (seed ${seed})`);
  }
  tick() {
    const t = now();
    for (const [id, L] of this.loaded) {
      try { L.game.tick(); } catch (e) { console.error('tick error', id, e); }
      if (L.game.onlineCount() > 0) L.idleSince = t;
      else if (id !== 'main' && t - L.idleSince > IDLE_UNLOAD && !L.saving) this.unload(id);
    }
  }

  // ---- what the home screen sees
  view(m, mine = false) {
    const L = this.loaded.get(m.id);
    return { id: m.id, name: m.name, official: !!m.official, public: !!m.public, locked: !!m.pw, players: L ? L.game.onlineCount() : 0, settings: m.settings, code: mine || m.public ? m.code : undefined, mine };
  }
  list() { return [...this.servers.values()].filter((m) => m.public).map((m) => this.view(m)).sort((a, b) => (b.official - a.official) || (b.players - a.players)); }
  mine(token) { const h = sha(token); return [...this.servers.values()].filter((m) => m.owner && m.owner === h).map((m) => this.view(m, true)); }
  byCode(code) { const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); for (const m of this.servers.values()) if (m.code === c) return m; return null; }
  newCode() { for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; if (!this.byCode(c)) return c; } }
  async create(b) {
    const token = String(b.token || ''), owner = token.length >= 8 ? sha(token) : null;
    if (!owner) return { error: 'Missing device token' };
    if ([...this.servers.values()].filter((m) => m.owner === owner).length >= MAX_PER_OWNER) return { error: `You can own up to ${MAX_PER_OWNER} servers — delete one first` };
    if (this.servers.size >= MAX_SERVERS) return { error: 'The host is full — try again later' };
    const name = String(b.name || '').replace(/[<>&"]/g, '').trim().slice(0, 40) || 'My Server';
    const id = crypto.randomBytes(5).toString('hex');
    const seed = Number.isFinite(+b.seed) && +b.seed > 0 ? Math.floor(+b.seed) % 2 ** 30 : 1 + Math.floor(Math.random() * 2 ** 30);
    const meta = { id, name, code: this.newCode(), public: !!b.public, pw: b.password ? hashPw(String(b.password).slice(0, 64)) : null, owner, settings: cleanSettings(b.settings || {}), seed, created: now() };
    this.servers.set(id, meta);
    await this.saveRegistry();
    return { server: this.view(meta, true) };
  }
  async update(b) {
    const meta = this.servers.get(String(b.id || ''));
    if (!meta || meta.official || !meta.owner || meta.owner !== sha(String(b.token || ''))) return { error: 'Not your server' };
    if (b.delete) {
      const L = this.loaded.get(meta.id);
      if (L) { for (const p of L.game.players.values()) { try { p.ws?.close(4003, 'deleted'); } catch {} } this.loaded.delete(meta.id); }
      this.servers.delete(meta.id); await this.store.remove?.(meta.id); await this.saveRegistry();
      return { ok: true };
    }
    if (b.name !== undefined) meta.name = String(b.name).replace(/[<>&"]/g, '').trim().slice(0, 40) || meta.name;
    if (b.public !== undefined) meta.public = !!b.public;
    if (b.password !== undefined) meta.pw = b.password ? hashPw(String(b.password).slice(0, 64)) : null;
    if (b.newCode) meta.code = this.newCode();
    if (b.settings) meta.settings = cleanSettings(b.settings, meta.settings);
    const L = this.loaded.get(meta.id);
    if (L) L.game.applySettings(meta.settings);
    if (b.newIsland) { await this.game(meta.id); await this.resetWorld(meta.id, { newIsland: true }); }
    await this.saveRegistry();
    return { server: this.view(meta, true) };
  }

  // ---- a player connecting: the first message says which server
  async route(ws, msg) {
    const meta = this.servers.get(String(msg.server || 'main')) || (msg.code ? this.byCode(msg.code) : null) || this.servers.get('main');
    const fail = (m) => { try { ws.send(JSON.stringify({ t: 'authfail', m })); ws.close(4001, 'auth'); } catch {} };
    const owner = meta.owner && meta.owner === sha(String(msg.devToken || msg.token || ''));
    if (meta.pw && !owner && !checkPw(msg.spw, meta.pw)) return fail(msg.spw ? 'Wrong server password' : 'This server needs a password');
    const game = await this.game(meta.id);
    if (!game) return fail('Server not found');
    const already = [...game.players.values()].some((p) => p.token === String(msg.token) && p.online);
    if (!already && game.onlineCount() >= meta.settings.maxPlayers) return fail(`${meta.name} is full (${meta.settings.maxPlayers} players)`);
    ws.serverId = meta.id;
    try { ws.send(JSON.stringify({ t: 'server', id: meta.id, name: meta.name, code: meta.code, owner: !!owner, settings: meta.settings })); } catch {}
    game.connect(ws, msg);
  }
}
