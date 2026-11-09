// DOM user interface: HUD, inventory, crafting, containers, map, chat, menus.
import { BAY_BUILDS, ITEMS, RECIPES, STATION_NAMES, STATION_PROVIDERS, STATION_RANGE, ARMOR_SLOTS, HOTBAR, INV_SIZE, stationRecipes } from '/shared/items.js';
import { PIECES, PIECE_ORDER, pieceCost, TIERS } from '/shared/building.js';
import { HALF, WORLD_SIZE, BIOME } from '/shared/worldgen.js';
import { audio } from './audio.js';
import { VEHICLES } from '/shared/vehicles.js';
const VEHICLES_NAME = (k) => VEHICLES[k]?.name || k;
import { ACTIONS, keyLabel } from './input.js';
import { icons } from './icons.js';
import { PAINT_COLORS, PAINT_NAMES, DECALS } from '/shared/paint.js';
import { decalPreview } from './paint.js';
import { SIZE_NAMES } from './painter.js';
import { InvPreview } from './invpreview.js';
import { playerSpec, defaultSpec, occupancy, canPlace, findSpot, footprint, sizeOf, rowOf } from '/shared/grid.js';
import { backpackRows, GRID_COLS } from '/shared/items.js';
const PITCH = 62, CELL = 56; // grid cell size + gap (px)

// <img> for an item's rendered icon (falls back to the emoji until it's ready)
export function iconHTML(id, cls = 'ico') { const src = icons.get(id); return src ? `<img class="${cls}" src="${src}" alt="">` : `<span class="${cls} emo">${ITEMS[id]?.icon || '?'}</span>`; }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const CONTROLS = [
  ['WASD', 'Move'], ['Shift', 'Sprint'], ['Ctrl / C', 'Crouch'], ['Space', 'Jump / swim up'], ['LMB', 'Use / attack / build'], ['RMB', 'Aim · build menu · repair'],
  ['E', 'Interact / pick up / enter vehicle'], ['R', 'Reload · rotate piece · flip vehicle'], ['1-6 / wheel', 'Belt slots'], ['Tab', 'Inventory & crafting'],
  ['Q', 'Crafting'], ['M', 'Map'], ['L', 'Clan'], ['F', 'Drink water (stand in it)'], ['X', 'Demolish (hammer, own piece)'], ['V', 'Vehicle camera'], ['T / Enter', 'Chat (/help for commands)'], ['Esc', 'Pause / settings'],
];

const BIOME_COLORS = { [BIOME.OCEAN]: [30, 70, 105], [BIOME.BEACH]: [214, 198, 140], [BIOME.GRASS]: [110, 160, 70], [BIOME.FOREST]: [55, 105, 45], [BIOME.DESERT]: [215, 170, 105], [BIOME.SWAMP]: [80, 90, 55], [BIOME.SNOW]: [230, 235, 245], [BIOME.ROCK]: [130, 125, 118] };

export class UI {
  constructor(game) {
    this.game = game;
    this.open = null; // 'inv' | 'map' | 'build' | 'pause' | 'death' | 'chat'
    this.drag = null;
    this.selRecipe = null;
    this.buildHotbar();
    this.buildInventory();
    this.buildMenus();
    this.mapCanvas = $('mapcanvas');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.mapImg = this.mapCtx.createImageData(500, 500);
    this.loadExplored();
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    $('craftsearch').addEventListener('input', () => this.renderCrafting());
    icons.onReady(() => { clearTimeout(this._icoT); this._icoT = setTimeout(() => { this.renderHotbar(); if (this.open === 'inv') this.renderInventory(); }, 50); });
  }

  // ------------------------------------------------------------------ HUD
  buildHotbar() {
    const hb = $('hotbar');
    hb.innerHTML = '';
    this.hotbarEls = [];
    for (let i = 0; i < HOTBAR; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      hb.appendChild(el);
      this.hotbarEls.push(el);
    }
  }
  slotHTML(st, key) {
    if (!st) return key ? `<span class="k">${key}</span>` : '';
    const d = ITEMS[st.id] || { icon: '?', name: st.id };
    let n = st.n > 1 ? `<span class="n">${st.n}</span>` : '';
    if (d.gun) n = `<span class="n">${st.a || 0}</span>`;
    if (d.flashlight) n = `<span class="n">${st.on ? '💡' : ''}${Math.round(st.c ?? 50)}%</span>`;
    return `${key ? `<span class="k">${key}</span>` : ''}${iconHTML(st.id)}${n}`;
  }
  renderHotbar() {
    const g = this.game;
    for (let i = 0; i < HOTBAR; i++) {
      const el = this.hotbarEls[i];
      el.innerHTML = this.slotHTML(g.inv[i], i + 1);
      el.classList.toggle('sel', i === g.sel);
    }
    const st = g.inv[g.sel];
    const gun = st && ITEMS[st.id]?.gun;
    $('ammo').innerHTML = gun ? `${st.a || 0}<small> / ${countItem(g.inv, gun.ammo)}</small>` : '';
  }
  renderStats(s) {
    this.lastStats = s;
    const pct = (v, m = 100) => Math.max(0, Math.min(100, (v / m) * 100)) + '%';
    $('hpbar').style.width = pct(s.hp, s.maxhp); $('hpval').textContent = Math.ceil(s.hp);
    $('foodbar').style.width = pct(s.food); $('foodval').textContent = Math.ceil(s.food);
    $('waterbar').style.width = pct(s.water); $('waterval').textContent = Math.ceil(s.water);
    $('lvl').textContent = `Lv ${s.lvl} · ${s.xp} xp · ${s.kills || 0} kills`;
    $('cold').classList.toggle('hidden', !(s.cold > 0.5));
  }
  toast(m) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = m;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }
  gain(id, n) {
    const d = ITEMS[id]; if (!d) return;
    const last = $('gains').firstChild;
    if (last && last.dataset.id === id && Date.now() - +last.dataset.t < 1500) {
      last.dataset.n = +last.dataset.n + n; last.dataset.t = Date.now();
      last.innerHTML = `+${last.dataset.n} ${iconHTML(id, 'gico')} ${d.name}`;
      last.style.animation = 'none'; void last.offsetWidth; last.style.animation = '';
      return;
    }
    const el = document.createElement('div'); el.className = 'gain'; el.dataset.id = id; el.dataset.n = n; el.dataset.t = Date.now();
    el.innerHTML = `+${n} ${iconHTML(id, 'gico')} ${d.name}`;
    $('gains').prepend(el);
    setTimeout(() => el.remove(), 3000);
  }
  prompt(html) { if (this._prompt !== html) { $('prompt').innerHTML = html ? this.game.input.relabel(html) : ''; this._prompt = html; } }
  target(html) { if (this._target !== html) { $('target').innerHTML = html || ''; this._target = html; } }
  progress(frac, text) {
    if (frac === null) { $('progress').classList.add('hidden'); return; }
    $('progress').classList.remove('hidden'); $('progressfill').style.width = frac * 100 + '%'; $('progresstext').textContent = text || '';
  }
  hitmarker(hs) {
    const el = $('hitmarker'); el.classList.add('show'); el.classList.toggle('hs', !!hs);
    clearTimeout(this._hm); this._hm = setTimeout(() => el.classList.remove('show'), 90);
  }
  hurt(fromAngle) {
    $('vignette').classList.add('hurt'); setTimeout(() => $('vignette').classList.remove('hurt'), 120);
    if (fromAngle !== null) { const d = $('hurtdir'); d.style.transform = `rotate(${fromAngle}rad)`; d.classList.add('show'); setTimeout(() => d.classList.remove('show'), 150); }
  }
  topbar(heading, loc, clock) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('compass').textContent = dirs[Math.round((((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    $('locinfo').textContent = loc; $('clock').textContent = clock;
  }
  renderQueue(q) {
    $('queue').innerHTML = q.map((e, i) => `<div class="qi">${ITEMS[RECIPES[e.r].out].icon} ${ITEMS[RECIPES[e.r].out].name} <b>${Math.ceil(e.left)}s</b></div>`).join('');
  }
  vehicleHud(v) {
    if (!v) { $('vehiclehud').classList.add('hidden'); return; }
    $('vehiclehud').classList.remove('hidden');
    $('speedo').textContent = Math.round(Math.abs(v.speed) * 3.6);
    if (v.power) { const warn = v.depth > v.crush * 0.9; $('vfuel').innerHTML = `🔋 ${Math.floor(v.fuel)} / ${v.fuelCap}${v.fuel <= 0 ? ' — NO POWER' : ''}${v.depth !== undefined ? `<br><span style="color:${v.depth > v.crush ? '#ff5a4a' : warn ? '#ffc04a' : '#9fe0ff'}">🌊 ${Math.round(v.depth)} m · crush depth ${v.crush} m${v.depth > v.crush ? ' — HULL CRUSHING!' : ''}</span>` : ''}`; $('vhp').textContent = `🔧 ${Math.ceil(v.hp)} / ${v.maxHp}`; return; }
    $('vfuel').textContent = v.fuelCap ? `⛽ ${Math.floor(v.fuel)} / ${v.fuelCap}${v.fuel <= 0 ? ' — OUT OF FUEL' : ''}${v.engineOk === false ? ' — ENGINE FLOODED' : ''}${v.stuck ? ' — FROZEN IN THE ICE' : ''}` : `🚣 Oars${v.stuck ? ' — FROZEN IN THE ICE (break the ice around the hull)' : ''}`;
    $('vhp').textContent = `🔧 ${Math.ceil(v.hp)} / ${v.maxHp}`;
  }

  // ------------------------------------------------------------------ clans
  renderClan() {
    const g = this.game, info = g.clanInfo || { clan: null, invites: [], online: [] };
    const send = (m) => g.net.send({ t: 'clan', ...m });
    const box = $('clanbox');
    const c = info.clan;
    let h = '';
    if (!c) {
      h += `<h2>Clans</h2><p class="hint">Clanmates share building rights at each other's tool cupboards, open each other's doors, can't hurt each other, see each other's names from far away and on the map, and get clan chat (<kbd>/c message</kbd>).</p>`;
      h += `<h3>Found a clan</h3><div class="row"><input id="clanname" maxlength="20" placeholder="Clan name"><input id="clantag" maxlength="5" placeholder="TAG" style="width:80px"><button id="clancreate">Create</button></div>`;
      h += `<h3>Invites</h3>` + (info.invites.length ? info.invites.map((i) => `<div class="mem"><span class="nm">[${esc(i.tag)}] ${esc(i.name)} <small>(${i.members} members)</small></span><button data-acc="${i.id}">Join</button><button class="alt" data-dec="${i.id}">Decline</button></div>`).join('') : '<p class="hint">No invites yet.</p>');
    } else {
      const lead = c.leader === g.pid;
      h += `<h2><span>[${esc(c.tag)}]</span> ${esc(c.name)}</h2><p class="hint">${c.members.length}/12 members · clan chat: <kbd>/c message</kbd></p>`;
      h += `<h3>Members</h3><div class="list">` + c.members.map((m) => `<div class="mem"><i class="dot ${m.online ? 'on' : ''}"></i><span class="nm">${esc(m.name)}${m.pid === c.leader ? ' 👑' : ''}${m.pid === g.pid ? ' (you)' : ''}</span>${lead && m.pid !== g.pid ? `<button class="alt" data-pro="${m.pid}">Make leader</button><button data-kick="${m.pid}">Kick</button>` : ''}</div>`).join('') + `</div>`;
      h += `<h3>Invite players</h3><div class="row"><input id="clanin" placeholder="Player name"><button id="claninv">Invite</button></div><div class="list">` + info.online.filter((o) => !c.members.some((m) => m.pid === o.pid)).map((o) => `<div class="mem"><i class="dot on"></i><span class="nm">${o.clan ? `[${esc(o.clan)}] ` : ''}${esc(o.name)}</span><button data-inv="${o.pid}">Invite</button></div>`).join('') + `</div>`;
      h += `<div class="row" style="margin-top:12px"><button class="alt" id="clanleave">Leave clan</button></div>`;
    }
    h += `<div class="hint">Press <kbd>L</kbd> or <kbd>Esc</kbd> to close</div>`;
    box.innerHTML = h;
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((el) => (el.onclick = () => fn(el)));
    on('#clancreate', () => send({ a: 'create', name: $('clanname').value, tag: $('clantag').value }));
    on('[data-acc]', (el) => send({ a: 'accept', id: el.dataset.acc }));
    on('[data-dec]', (el) => send({ a: 'decline', id: el.dataset.dec }));
    on('[data-kick]', (el) => send({ a: 'kick', pid: +el.dataset.kick }));
    on('[data-pro]', (el) => send({ a: 'promote', pid: +el.dataset.pro }));
    on('[data-inv]', (el) => send({ a: 'invite', pid: +el.dataset.inv }));
    on('#claninv', () => send({ a: 'invite', name: $('clanin').value }));
    on('#clanleave', () => { if (confirm('Leave your clan?')) send({ a: 'leave' }); });
    box.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  }

  // ------------------------------------------------------------------ chat
  chat(from, m, clan) {
    const el = document.createElement('div');
    if (clan) el.classList.add('clanmsg');
    if (!from) { el.className = 'sys'; el.textContent = m; } else el.innerHTML = `<b>${esc(from)}:</b> ${esc(m)}`;
    // keep the last 200 lines; only the newest 8 show while the chat is closed. Open it (T / Enter) to scroll back
    const log = $('chatlog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.appendChild(el);
    while (log.children.length > 200) log.firstChild.remove();
    const n = log.children.length;
    if (n > 8) log.children[n - 9].classList.add('old');
    if (atBottom || !$('chat').classList.contains('open')) log.scrollTop = log.scrollHeight;
  }
  openChat() {
    this.open = 'chat';
    $('chat').classList.add('open');
    const log = $('chatlog'); log.scrollTop = log.scrollHeight;
    const inp = $('chatinput'); inp.classList.remove('hidden'); inp.value = ''; inp.focus();
    if (!inp._scrollKeys) {
      inp._scrollKeys = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'PageUp' || (e.key === 'ArrowUp' && e.ctrlKey)) { log.scrollTop -= log.clientHeight * 0.8; e.preventDefault(); }
        if (e.key === 'PageDown' || (e.key === 'ArrowDown' && e.ctrlKey)) { log.scrollTop += log.clientHeight * 0.8; e.preventDefault(); }
      });
    }
  }
  closeChat(send) {
    const inp = $('chatinput');
    if (send && inp.value.trim()) this.game.net.send({ t: 'chat', m: inp.value.trim() });
    inp.classList.add('hidden'); inp.blur();
    $('chat').classList.remove('open');
    $('chatlog').scrollTop = $('chatlog').scrollHeight;
    this.open = null;
  }

  // ------------------------------------------------------------------ inventory
  buildInventory() {
    const mk = (parent, c, i, key, cls = 'slot') => {
      const el = document.createElement('div'); el.className = cls; el.dataset.c = c; el.dataset.i = i;
      if (key) el.dataset.key = key;
      el.addEventListener('mousedown', (e) => this.onSlotDown(e, el));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onSlotRight(el); });
      el.addEventListener('mouseenter', (e) => this.showTip(el, e));
      el.addEventListener('mouseleave', () => $('itemtip').classList.add('hidden'));
      parent.appendChild(el);
      return el;
    };
    this.armorEls = ARMOR_SLOTS.map((s) => mk($('armorslots'), 'a', s));
    this.preview = new InvPreview(this.game, $('invpreview'));
    document.querySelectorAll('.pdatabs [data-go]').forEach((el) => el.addEventListener('click', () => { audio.click(); this.show(el.dataset.go); }));
    this.mkSlot = mk;
    this.invEls = [];
    for (let i = HOTBAR; i < INV_SIZE; i++) this.invEls[i] = mk($('invgrid'), 'p', i);
    this.invTiles = document.createElement('div'); this.invTiles.className = 'gtiles'; $('invgrid').appendChild(this.invTiles);
    this.contTiles = document.createElement('div'); this.contTiles.className = 'gtiles';
    for (let i = 0; i < HOTBAR; i++) this.invEls[i] = mk($('beltgrid'), 'p', i, i + 1);
    this.contEls = [];
    $('invscreen').addEventListener('mouseup', (e) => {
      if (this.drag && (e.target === $('invscreen'))) { this.game.net.send({ t: 'drop', c: this.drag.c, i: this.drag.i }); this.endDrag(); }
    });
  }
  stackAt(c, i) {
    const g = this.game;
    if (c === 'p') return g.inv[i];
    if (c === 'a') return g.armor[i];
    if (c === 'c') return g.container?.slots?.[i];
    return null;
  }
  renderInventory() {
    const g = this.game;
    const ghost = { head: '⛑️', chest: '🦺', legs: '👖', back: '🎒' };
    ARMOR_SLOTS.forEach((s, k) => { const el = this.armorEls[k]; el.innerHTML = this.slotHTML(g.armor[s]) || `<span class="ghost">${ghost[s] || ''}</span><span class="lbl">${s}</span>`; });
    const st = this.lastStats;
    if (st) {
      const bar = (v, m, cls) => `<div class="mcbar ${cls}"><div style="width:${Math.max(0, Math.min(100, (v / m) * 100))}%"></div></div>`;
      $('invinfo').innerHTML = `<div class="nm">${(g.name || 'Survivor').replace(/[<>&]/g, '')} <span class="lv">LV ${st.lvl}</span></div>${bar(st.xp % 100, 100, 'xp')}
        <div class="row">❤ ${Math.ceil(st.hp)}</div>${bar(st.hp, st.maxhp, 'hp')}<div class="row">🍖 ${Math.ceil(st.food)}</div>${bar(st.food, 100, 'food')}<div class="row">💧 ${Math.ceil(st.water)}</div>${bar(st.water, 100, 'water')}
        <div class="row small">${st.kills || 0} kills · ${st.deaths || 0} deaths</div>`;
    }
    for (let i = 0; i < HOTBAR; i++) this.invEls[i].innerHTML = this.slotHTML(g.inv[i], i + 1);
    const ps = this.pspec();
    for (let i = HOTBAR; i < INV_SIZE; i++) { const el = this.invEls[i]; el.innerHTML = ''; el.classList.toggle('locked', rowOf(ps, i) >= ps.rows); }
    this.renderTiles(this.invTiles, g.inv, ps, 'p');
    const lockedRows = 6 - ps.rows;
    $('invbaghint').innerHTML = lockedRows > 0 ? `🔒 ${lockedRows} more row${lockedRows > 1 ? 's' : ''} with a bag — Small Bag +1, Backpack +2, Expedition Pack +4` : '';
    const c = g.container;
    $('contpanel').classList.toggle('hidden', !c);
    $('craftpanel').classList.toggle('hidden', !!c && !c.station);
    if (c && c.station) this.renderCrafting();
    if (c) {
      $('conttitle').innerHTML = (c.station ? `${c.title} — output (finished items stay here until you take them)` : c.title) + (c.station === 'gunsmith' ? ' <button id="gsopen" class="gsbtn">🔧 Customize weapons</button>' : '');
      if (c.station === 'gunsmith') $('gsopen').onclick = () => this.game.gunsmith.open(c.id);
      $('continfo').innerHTML = c.info || ''; $('continfo').classList.toggle('hidden', !c.info);
      const grid = $('contgrid');
      if (this.contEls.length !== c.slots.length) {
        grid.innerHTML = ''; this.contEls = [];
        c.slots.forEach((_, i) => this.contEls.push(this.mkSlot(grid, 'c', i)));
        grid.appendChild(this.contTiles);
      }
      this.renderTiles(this.contTiles, c.slots, defaultSpec(c.slots.length), 'c');
    } else this.renderCrafting();
    this.renderHotbar();
  }
  pspec() { return playerSpec(backpackRows(this.game.armor)); }
  specFor(c) { return c === 'p' ? this.pspec() : defaultSpec(this.game.container?.slots?.length || 0); }
  arrFor(c) { return c === 'p' ? this.game.inv : c === 'c' ? this.game.container?.slots : null; }
  // Items as tiles spanning their footprint, laid over the grid cells.
  renderTiles(layer, slots, spec, c) {
    layer.innerHTML = '';
    for (let a = spec.start; a < slots.length; a++) {
      const st = slots[a];
      if (!st) continue;
      const [w, h] = sizeOf(st.id);
      const k = a - spec.start, col = k % spec.cols, row = Math.floor(k / spec.cols);
      const el = this.mkSlot(layer, c, a, null, 'slot gtile' + (w * h > 1 ? ' big' : '') + (row + h > spec.rows ? ' over' : ''));
      el.style.left = col * PITCH + 'px'; el.style.top = row * PITCH + 'px';
      el.style.width = w * PITCH - (PITCH - CELL) + 'px'; el.style.height = h * PITCH - (PITCH - CELL) + 'px';
      el.innerHTML = this.slotHTML(st);
      const ico = el.querySelector('.ico');
      if (ico && w * h > 1) { ico.style.width = (w * PITCH - 6) * 0.9 + 'px'; ico.style.height = (h * PITCH - 6) * 0.9 + 'px'; ico.style.objectFit = 'contain'; }
    }
  }
  // Where would the dragged item's anchor land if dropped on element `el`?
  dropAnchor(el) {
    const c = el.dataset.c, i = el.dataset.c === 'a' ? el.dataset.i : +el.dataset.i;
    if (c === 'a') return { c, i };
    const spec = this.specFor(c);
    if (i < spec.start) return { c, i };
    const k = i - spec.start, col = k % spec.cols - (this.drag.ox || 0), row = Math.floor(k / spec.cols) - (this.drag.oy || 0);
    return { c, i: spec.start + Math.max(0, row) * spec.cols + Math.max(0, Math.min(spec.cols - 1, col)) };
  }
  clearDropPreview() { document.querySelectorAll('.slot.dropok, .slot.dropbad').forEach((x) => x.classList.remove('dropok', 'dropbad')); }
  dropPreview(e) {
    this.clearDropPreview();
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.slot');
    if (!el || !el.dataset.c || el.dataset.c === 'a' || el.classList.contains('gtile')) return;
    const st = this.stackAt(this.drag.c, this.drag.i);
    if (!st) return;
    const to = this.dropAnchor(el), arr = this.arrFor(to.c), spec = this.specFor(to.c);
    if (!arr) return;
    const quick = to.i < spec.start, [w, h] = sizeOf(st.id, quick);
    const cells = footprint(arr.length, spec, to.i, w, h);
    const occ = occupancy(arr, spec);
    const ignore = to.c === this.drag.c ? [this.drag.i] : [];
    let ok = cells && canPlace(arr, to.i, st.id, ignore, spec, occ);
    if (!ok && cells) { // merging onto the same item / swapping with exactly one item also works
      const hit = new Set(cells.map((x) => occ[x]).filter((x) => x !== -1 && !ignore.includes(x)));
      ok = hit.size === 1;
    }
    const els = to.c === 'p' ? this.invEls : this.contEls;
    for (const x of cells || [to.i]) els[x]?.classList.add(ok ? 'dropok' : 'dropbad');
  }
  ref(el) { return { c: el.dataset.c, i: el.dataset.c === 'a' ? el.dataset.i : +el.dataset.i }; }
  onSlotDown(e, el) {
    if (e.button !== 0) return;
    const r = this.ref(el);
    const st = this.stackAt(r.c, r.i);
    if (!st) return;
    audio.click();
    if (e.shiftKey) {
      const g = this.game;
      if (g.container) g.net.send({ t: 'move', from: r, to: { c: r.c === 'c' ? 'p' : 'c', i: -1 } });
      else if (r.c === 'p') {
        // belt <-> main
        let to = -1;
        if (r.i < HOTBAR) to = findSpot(g.inv, st.id, { quick: false }, this.pspec());
        else for (let i = 0; i < HOTBAR; i++) if (!g.inv[i]) { to = i; break; }
        if (to >= 0) g.net.send({ t: 'move', from: r, to: { c: 'p', i: to } }); else this.toast('No room');
      } else if (r.c === 'a') g.net.send({ t: 'move', from: r, to: { c: 'p', i: -1 } });
      return;
    }
    let ox = 0, oy = 0;
    if (el.classList.contains('gtile')) { const b = el.getBoundingClientRect(); ox = Math.floor((e.clientX - b.left) / PITCH); oy = Math.floor((e.clientY - b.top) / PITCH); }
    this.drag = { ...r, half: e.ctrlKey, ox, oy };
    document.body.classList.add('dragging');
    const [w, h] = sizeOf(st.id);
    const gh = document.createElement('div'); gh.id = 'dragghost'; gh.innerHTML = iconHTML(st.id);
    gh.style.width = w * PITCH - 6 + 'px'; gh.style.height = h * PITCH - 6 + 'px';
    gh.style.marginLeft = ((w * PITCH) / 2 - ox * PITCH - PITCH / 2) + 'px'; gh.style.marginTop = ((h * PITCH) / 2 - oy * PITCH - PITCH / 2) + 'px';
    gh.style.left = e.clientX + 'px'; gh.style.top = e.clientY + 'px';
    document.body.appendChild(gh);
    this.dragEl = gh;
  }
  onMouseMove(e) { if (this.dragEl) { this.dragEl.style.left = e.clientX + 'px'; this.dragEl.style.top = e.clientY + 'px'; this.dropPreview(e); } }
  onMouseUp(e) {
    if (!this.drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.slot');
    if (el && el.dataset.c) {
      const to = this.dropAnchor(el);
      if (!(to.c === this.drag.c && to.i === this.drag.i)) {
        const st = this.stackAt(this.drag.c, this.drag.i);
        const msg = { t: 'move', from: { c: this.drag.c, i: this.drag.i }, to };
        if (this.drag.half && st) msg.n = Math.ceil(st.n / 2);
        this.game.net.send(msg);
      }
      this.endDrag();
    } else if (!e.target.closest?.('.invcol')) {
      // dropped outside: handled by invscreen listener
      setTimeout(() => this.endDrag(), 0);
    } else this.endDrag();
  }
  endDrag() { this.drag = null; document.body.classList.remove('dragging'); this.clearDropPreview(); if (this.dragEl) { this.dragEl.remove(); this.dragEl = null; } }
  onSlotRight(el) {
    const r = this.ref(el), g = this.game;
    const st = this.stackAt(r.c, r.i);
    if (!st) return;
    const d = ITEMS[st.id];
    if (r.c === 'p' && (d.cat === 'food' || d.cat === 'medical')) return g.net.send({ t: 'eat', i: r.i });
    if (r.c === 'p' && d.armor) return g.net.send({ t: 'move', from: r, to: { c: 'a', i: d.armor.slot } });
    if (g.container) return g.net.send({ t: 'move', from: r, to: { c: r.c === 'c' ? 'p' : 'c', i: -1 } });
    if (r.c === 'a') return g.net.send({ t: 'move', from: r, to: { c: 'p', i: -1 } });
  }
  showTip(el, e) {
    const st = this.stackAt(el.dataset.c, el.dataset.c === 'a' ? el.dataset.i : +el.dataset.i);
    const tip = $('itemtip');
    if (!st) { tip.classList.add('hidden'); return; }
    tip.innerHTML = itemDesc(st);
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    tip.style.left = r.right + 6 + 'px'; tip.style.top = r.top + 'px';
  }

  // ------------------------------------------------------------------ crafting
  stationsNear() {
    const g = this.game, out = new Set();
    for (const e of g.structures.map.values()) {
      if (e.s.k !== 'deploy') continue;
      if (Math.hypot(e.s.x - g.player.pos.x, e.s.y - g.player.pos.y, e.s.z - g.player.pos.z) > STATION_RANGE) continue;
      for (const st in STATION_PROVIDERS) if (STATION_PROVIDERS[st].includes(e.s.type)) out.add(st);
    }
    return out;
  }
  renderCrafting() {
    const g = this.game;
    const c = g.container, station = c && c.station;
    const q = $('craftsearch').value.trim().toLowerCase();
    const recipes = station ? stationRecipes(station) : RECIPES.filter((r) => !r.station);
    $('craftstation').textContent = station ? `— ${ITEMS[station].name}` : '— by hand';
    let html = '';
    if (station && c.queue && c.queue.length) {
      const now = performance.now();
      html += `<div class="rgroup">Crafting here (${c.queue.length}) — click to cancel</div><div class="rgrid">` + c.queue.map((e, i) => {
        const left = Math.max(0, e.left - (now - c.recv) / 1000);
        return `<div class="slot rslot queue" data-cancel="${i}" data-tip="${ITEMS[RECIPES[e.r].out].name} — ${Math.ceil(left)}s left (click to cancel)">${iconHTML(RECIPES[e.r].out)}<span class="tm">${Math.ceil(left)}s</span></div>`;
      }).join('') + '</div>';
    }
    html += `<div class="rgroup">${station ? `${ITEMS[station].name} recipes` : 'Hand crafting — press E on a camp fire, furnace or workbench for more'}</div><div class="rgrid">`;
    const tipOf = (r) => `${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''} · ${r.time}s|${Object.entries(r.cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ')}`;
    for (const r of recipes.filter((r) => !q || ITEMS[r.out].name.toLowerCase().includes(q))) {
      const can = affordable(g.inv, r.cost);
      html += `<div class="slot rslot ${can ? 'can' : 'no'} ${this.selRecipe === r.id ? 'sel' : ''}" data-r="${r.id}" data-tip="${tipOf(r)}">${iconHTML(r.out)}${r.n > 1 ? `<span class="n">${r.n}</span>` : ''}</div>`;
    }
    html += '</div>';
    if (!station) {
      const locked = RECIPES.filter((r) => r.station && !r.bay && (!q || ITEMS[r.out].name.toLowerCase().includes(q)));
      if (q && locked.length) html += `<div class="rgroup">Needs a station</div><div class="rgrid">` + locked.map((r) => `<div class="slot rslot locked" data-tip="${ITEMS[r.out].name}|Made at: ${STATION_NAMES[r.station]}">${iconHTML(r.out)}</div>`).join('') + '</div>';
    }
    const list = $('craftlist');
    const scroll = list.scrollTop;
    list.innerHTML = html;
    list.scrollTop = scroll;
    list.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => { const [a, b] = el.dataset.tip.split('|'); const tip = $('itemtip'); tip.innerHTML = `<b>${a}</b>${b ? `<br><span class="sub">${b}</span>` : ''}`; tip.classList.remove('hidden'); const r = el.getBoundingClientRect(); tip.style.left = r.right + 6 + 'px'; tip.style.top = r.top + 'px'; });
      el.addEventListener('mouseleave', () => $('itemtip').classList.add('hidden'));
    });
    list.querySelectorAll('.rslot[data-r]').forEach((el) => el.addEventListener('click', () => { this.selRecipe = +el.dataset.r; audio.click(); this.renderCrafting(); }));
    list.querySelectorAll('.rslot[data-cancel]').forEach((el) => el.addEventListener('click', () => { g.net.send({ t: 'ccancel', i: +el.dataset.cancel, st: c.id }); audio.click(); }));
    const det = $('craftdetail');
    const r = RECIPES[this.selRecipe];
    if (!r || !recipes.includes(r)) { det.innerHTML = `<span class="hint">${station ? 'Select a recipe. Crafted items appear in the output slots above — drag them to your inventory.' : 'Select a recipe. Workbench, furnace and camp fire items are made at the station itself: walk up to it and press E.'}</span>`; return; }
    const cost = Object.entries(r.cost).map(([k, v]) => `<span class="${countItem(g.inv, k) < v ? 'miss' : ''}">${iconHTML(k, 'gico')} ${v} ${ITEMS[k].name} (${countItem(g.inv, k)})</span>`).join('');
    det.innerHTML = `<div class="bigico">${iconHTML(r.out, 'bico')}</div><b>${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''}</b> <small>${r.station ? 'Requires ' + STATION_NAMES[r.station] : ''}</small><div class="cost">${cost}</div><div>${itemDesc({ id: r.out, n: 1 }, true)}</div><div style="margin-top:6px"><button id="c1">Craft</button><button id="c5" class="alt">×5</button></div>`;
    const st = station ? c.id : undefined;
    $('c1').onclick = () => { g.net.send({ t: 'craft', r: r.id, n: 1, st }); audio.click(); };
    $('c5').onclick = () => { g.net.send({ t: 'craft', r: r.id, n: 5, st }); audio.click(); };
  }

  // ------------------------------------------------------------------ build menu
  buildMenus() {
    $('buildmenu').addEventListener('contextmenu', (e) => { e.preventDefault(); this.close(); });
    const ctl = CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd> ${v}</div>`).join('');
    $('controls').innerHTML = ctl; $('menucontrols').innerHTML = ctl;
  }
  // Radial build wheel: centre = material, middle ring = category, outer ring = pieces / furniture
  // No Man's Sky-style build menu: a tab per building material, then Furniture, Base Items and Large Electronics.
  // Cards show what each costs (red where you're short); Q / E switch tabs, click a card to build it.
  buildTabs() {
    return [...TIERS.map((t, i) => ({ k: 't' + i, label: t.name, sw: t.color })), { k: 'raft', label: '🛟 Rafts' }, { k: 'furniture', label: '🪑 Furniture' }, { k: 'base', label: '🧰 Base Items' }, { k: 'tech', label: '⚡ Large Electronics' }];
  }
  renderBuildMenu(hoverKey = null) {
    const g = this.game, b = g.building;
    if (!b.tab) b.tab = b.cat === 'construction' ? 't' + (b.tier || 0) : 'furniture';
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const have = (id) => countItem(g.inv, id);
    const costHTML = (c) => Object.entries(c).map(([k, v]) => `<span class="${have(k) >= v ? 'ok' : 'short'}">${iconHTML(k, 'cico')}${v} ${esc(ITEMS[k].name)} <small>(${have(k)})</small></span>`).join('');
    const tabs = this.buildTabs();
    let cards = [];
    const matTab = /^t\d+$/.test(b.tab);
    if (matTab) {
      const tier = +b.tab.slice(1);
      cards = PIECE_ORDER.map((t) => { const c = pieceCost(t, tier); return { key: t, piece: true, name: PIECES[t].name, icon: PIECES[t].icon, ok: Object.entries(c).every(([k, v]) => have(k) >= v), cost: c, sel: !b.furn && b.piece === t && b.tier === tier, desc: `${TIERS[tier].name} ${PIECES[t].name}` }; });
    } else if (b.tab === 'raft') {
      const c = pieceCost('raft', 1);
      cards = [{ key: 'raft', piece: true, name: PIECES.raft.name, icon: PIECES.raft.icon, ok: Object.entries(c).every(([k, v]) => have(k) >= v), cost: c, sel: !b.furn && b.piece === 'raft', desc: 'Compact Raft — a floating foundation. Place it on open water and build walls, floors and more on it.' }];
    } else {
      const ids = Object.keys(ITEMS).filter((id) => { const d = ITEMS[id], dp = d.deploy; if (!dp && !d.door) return false; if (b.tab === 'tech') return !!dp?.tech; if (b.tab === 'furniture') return !!dp?.furniture; return !dp?.tech && !dp?.furniture; });
      cards = ids.map((id) => { const n = have(id), r = RECIPES.find((x) => x.out === id); return { key: id, name: ITEMS[id].name, img: icons.get(id), icon: ITEMS[id].icon, n, ok: n > 0, recipe: r, sel: b.furn === id }; });
    }
    const hv = cards.find((c) => c.key === hoverKey) || cards.find((c) => c.sel) || cards[0];
    const tech = (id) => {
      const M = { portable_refiner: 'Refines anywhere. Burns Low Grade Fuel, Batteries or Power Cells from its storage.', refinery: 'Mount on a wall of your base. Refines ores, quartz, wood, scrap and salt water twice as fast. Uses 60 W of base power.', desalinator: 'Mount on a wall of a base by the sea: pumps sea water and makes Water Bottles and Salt. Also takes Salt Water bottles. Uses 40 W.', solar_panel: 'Makes up to 50 W in daylight for every machine in this base. Place it on a floor, roof or foundation.', fuel_generator: 'Burns Low Grade Fuel for 150 W when the sun can\'t keep up. Place it in your base.', battery_bank: 'Mount on a wall. Stores spare power for the night (≈110 Wh).', charger: 'Mount on a wall. Recharges Flashlights you put in it. Uses 25 W.', wall_light: 'Mount on a wall. Bright electric light while the base has power. Uses 5 W.' };
      return M[id] || '';
    };
    let info = '';
    if (hv) {
      if (hv.piece) info = `<h3>${esc(hv.desc)}</h3><div class="bcost">${costHTML(hv.cost)}</div>`;
      else {
        const r = hv.recipe;
        info = `<h3>${esc(hv.name)}</h3><p>${hv.n > 0 ? `You have <b>${hv.n}</b> — click to place it.` : 'Craft it first.'}</p>${tech(hv.key) ? `<p class="bdesc">${tech(hv.key)}</p>` : ''}${r ? `<div class="bcap">Recipe${r.station ? ` <small>(at the ${STATION_NAMES[r.station]})</small>` : ''}:</div><div class="bcost">${costHTML(r.cost)}</div>` : ''}`;
      }
    }
    $('buildwheel').innerHTML = `<div class="nmsbuild">
      <div class="btabs">${tabs.map((t) => `<button data-tab="${t.k}" class="${b.tab === t.k ? 'on' : ''}">${t.sw !== undefined ? `<i style="background:${hex(t.sw)}"></i>` : ''}${esc(t.label)}</button>`).join('')}</div>
      <div class="bbody"><div class="bgrid">${cards.map((c) => `<button class="bcard${c.sel ? ' sel' : ''}${c.ok ? '' : ' dis'}" data-k="${c.key}">${c.img ? `<img src="${c.img}" alt="">` : `<span class="emo">${c.icon}</span>`}<span class="bn">${esc(c.name)}</span>${c.n !== undefined ? `<span class="bq">${c.n}</span>` : ''}</button>`).join('') || '<p>Nothing here yet.</p>'}</div>
      <div class="binfo">${info}</div></div>
      <div class="hint"><kbd>Q</kbd> / <kbd>E</kbd> switch tabs · click to build · right-click or Esc to close</div></div>`;
    const box = $('buildwheel');
    box.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { b.tab = el.dataset.tab; audio.click(); this.renderBuildMenu(); }));
    box.querySelectorAll('[data-k]').forEach((el) => {
      const c = cards.find((x) => x.key === el.dataset.k);
      el.addEventListener('mouseenter', () => { if (this._bHover !== c.key) { this._bHover = c.key; this.renderBuildMenu(c.key); } });
      el.addEventListener('click', () => {
        if (!c.piece && !c.ok) { this.toast(`Craft a ${c.name} first`); return; }
        audio.click();
        if (c.piece) { b.piece = c.key; b.tier = c.key === 'raft' ? 1 : +b.tab.slice(1); b.furn = null; b.cat = 'construction'; } else { b.furn = c.key; b.cat = 'furniture'; }
        this.close();
      });
    });
    if (!this._bKeys) {
      this._bKeys = true;
      document.addEventListener('keydown', (e) => {
        if (this.open !== 'build' || (e.code !== 'KeyQ' && e.code !== 'KeyE')) return;
        const t = this.buildTabs(), i = t.findIndex((x) => x.k === b.tab);
        b.tab = t[(i + (e.code === 'KeyE' ? 1 : t.length - 1)) % t.length].k; audio.click(); this.renderBuildMenu(); e.preventDefault();
      });
    }
  }

  // ------------------------------------------------------------------ spray paint palette
  renderPaint() {
    const pt = this.game.painter, box = $('paintbox');
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    box.innerHTML = `<h2>🎨 Spray Can</h2>
      <h3>Colour <small>(LMB paints the whole thing, also tints decals)</small></h3>
      <div class="swatches">${PAINT_COLORS.map((c, i) => `<button class="sw${i === pt.color ? ' sel' : ''}" data-c="${i}" title="${PAINT_NAMES[i]}" style="background:${hex(c)}"></button>`).join('')}</div>
      <h3>Decal <small>(RMB sprays it where you aim)</small></h3>
      <div class="decals">${DECALS.map((n, i) => `<button class="dc${i === pt.decal ? ' sel' : ''}" data-d="${i}" title="${n}"><img src="${decalPreview(i, pt.color)}" alt=""><span>${n}</span></button>`).join('')}</div>
      <h3>Decal size</h3>
      <div class="sizes">${SIZE_NAMES.map((n, i) => `<button class="${i === pt.size ? 'sel' : ''}" data-s="${i}">${n}</button>`).join('')}</div>
      <div class="hint">X while aiming cleans paint and decals off · R or Esc to close</div>`;
    const pick = (sel, fn) => box.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => { fn(el); pt.save(); audio.click(); this.renderPaint(); }));
    pick('[data-c]', (el) => (pt.color = +el.dataset.c));
    pick('[data-d]', (el) => (pt.decal = +el.dataset.d));
    pick('[data-s]', (el) => (pt.size = +el.dataset.s));
  }

  // ------------------------------------------------------------------ Mobile Vehicle Bay
  showBay(id) {
    const g = this.game, e = g.structures.map.get(id);
    if (!e) return;
    this.show('bay');
    const s = e.s, have = (k) => countItem(g.inv, k), creative = !!g.rules?.creative;
    const V = [['motorboat', '🚤', 'A fast skiff with an outboard motor. Runs on Low Grade Fuel.'], ['minisub', '🐟', 'One-seat submarine with twin thrusters. Comes fully charged. Docks inside the Pacific.'], ['cyclops', '🐋', 'The Pacific: a 37 m walk-in submarine you fit out yourself. Needs deep water around the bay.']];
    const h = g.holos?.get(id), left = h ? Math.max(0, Math.ceil(h.end - performance.now() / 1000)) : 0;
    $('baybox').innerHTML = `<h2>🛳️ Mobile Vehicle Bay</h2>
      ${s.bb ? `<div class="srvnote">🛠️ Building a <b>${esc(VEHICLES_NAME(s.bb[0]))}</b>${left ? ` — about ${left} s left` : ''}. It launches into the water next to the bay.</div>` : '<div class="srvnote">Pick a vessel to build. It\'s assembled next to the bay and launched into the water. (Rowboats are still crafted as kits.)</div>'}
      <div class="baygrid">${V.map(([k, ic, desc]) => { const B = BAY_BUILDS[k], ok = creative || Object.entries(B.cost).every(([i, n]) => have(i) >= n);
        return `<div class="baycard"><div class="bayhead"><span class="emo">${ic}</span><b>${esc(VEHICLES_NAME(k))}</b><small>⏱ ${B.time} s</small></div><div class="bdesc">${desc}</div>
          <div class="bcost">${Object.entries(B.cost).map(([i, n]) => `<span class="${have(i) >= n ? 'ok' : 'short'}">${iconHTML(i, 'cico')}${n} ${esc(ITEMS[i].name)} <small>(${have(i)})</small></span>`).join('')}</div>
          <button data-b="${k}" ${ok && !s.bb ? '' : 'disabled'}>${s.bb ? 'Busy' : ok ? 'Build' : 'Missing materials'}</button></div>`; }).join('')}</div>
      <div class="srvbtns"><button id="baypack" class="alt" ${s.bb ? 'disabled' : ''}>📦 Pack up the bay</button><button id="bayclose">Close</button></div>`;
    $('baybox').querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { g.net.send({ t: 'baybuild', id, v: b.dataset.b }); audio.click(); this.close(); }));
    $('baypack').onclick = () => { g.net.send({ t: 'baypack', id }); audio.click(); this.close(); };
    $('bayclose').onclick = () => this.close();
  }

  // ------------------------------------------------------------------ controls: rebind any key
  showKeys() {
    if (this.open !== 'keys') this.show('keys');
    const inp = this.game.input, box = $('keysbox');
    const used = {}; for (const [a] of ACTIONS) { const k = inp.bindOf(a); (used[k] = used[k] || []).push(a); }
    box.innerHTML = `<h2>⌨️ Controls</h2><div class="hint">Click a key, then press the new one (Esc cancels). Mouse buttons and the number keys 1–6 stay as they are.</div>
      <div class="keyrows">${ACTIONS.map(([a, label, d]) => { const k = inp.bindOf(a); return `<div class="keyrow"><span>${esc(label)}</span><button data-a="${a}" class="${used[k].length > 1 ? 'clash' : k !== d ? 'changed' : ''}" title="${used[k].length > 1 ? 'Also used by: ' + used[k].filter((x) => x !== a).join(', ') : ''}">${esc(keyLabel(k))}</button></div>`; }).join('')}</div>
      <div class="srvbtns"><button id="keysreset" class="alt">↺ Reset to defaults</button><button id="keysdone">Done</button></div>`;
    box.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      b.textContent = 'Press a key…'; b.classList.add('wait');
      inp.capture = (code) => { if (code !== 'Escape') inp.setBind(b.dataset.a, code); audio.click(); this.showKeys(); };
    }));
    $('keysreset').onclick = () => { inp.resetBinds(); audio.click(); this.showKeys(); };
    $('keysdone').onclick = () => { inp.capture = null; this.show('pause'); };
  }

  // ------------------------------------------------------------------ vehicle spawner (/spawn or the pause menu)
  showSpawn() {
    this.show('spawn');
    const V = [['atv', '🏍️', 'ATV', 'Land'], ['jeep', '🚙', 'Jeep', 'Land'], ['jeep4', '🚐', '4x4', 'Land'], ['pickup', '🛻', 'Pickup', 'Land'], ['hauler', '🚚', 'Hauler', 'Land — build on its deck'],
      ['rowboat', '🛶', 'Rowboat', 'Water'], ['motorboat', '🚤', 'Motorboat', 'Water'],
      ['minisub', '🐟', 'Mini Sub', 'Submarine — nearest deep water, or beside you while diving'], ['pacific', '🐋', 'Pacific', 'Big walk-in submarine — needs deep sea']];
    const box = $('spawngrid');
    box.innerHTML = V.map(([k, e, n, w]) => `<button class="islot vslot" data-v="${k}"><span class="emo">${e}</span><b>${n}</b><small>${w}</small></button>`).join('');
    box.querySelectorAll('[data-v]').forEach((el) => el.addEventListener('click', () => { this.game.net.send({ t: 'chat', m: '/spawn ' + el.dataset.v }); audio.click(); this.close(); }));
  }

  // ------------------------------------------------------------------ admin item spawner
  showItems(q) {
    this.show('items');
    const inp = $('itemsearch');
    inp.value = q || '';
    if (!inp._wired) {
      inp._wired = true;
      inp.addEventListener('input', () => this.renderItems());
      inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.blur(); this.close(); } e.stopPropagation(); });
    }
    this.renderItems();
    setTimeout(() => inp.focus(), 30);
  }
  renderItems() {
    const q = $('itemsearch').value.toLowerCase().trim();
    const cats = {};
    for (const [id, d] of Object.entries(ITEMS)) {
      if (q && !d.name.toLowerCase().includes(q) && !id.includes(q) && !(d.cat || '').includes(q)) continue;
      (cats[d.cat || 'misc'] = cats[d.cat || 'misc'] || []).push(id);
    }
    const grid = $('itemgrid');
    grid.innerHTML = Object.entries(cats).map(([c, ids]) => `<h3>${c}</h3><div class="igrid">${ids.map((id) => `<button class="islot" data-id="${id}" title="${ITEMS[id].name} (${id})">${iconHTML(id)}<span>${ITEMS[id].name}</span></button>`).join('')}</div>`).join('') || '<p>No items match.</p>';
    grid.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.id, amt = +$('itemamt').value;
      this.game.net.send({ t: 'agive', id, n: amt || ITEMS[id].stack || 1 });
      audio.pickup();
    }));
  }

  // ------------------------------------------------------------------ panels
  show(which) {
    this.close(true);
    this.open = which;
    const el = { inv: 'invscreen', map: 'mapscreen', build: 'buildmenu', pause: 'pausescreen', death: 'deathscreen', clan: 'clanscreen', paint: 'paintscreen', items: 'itemscreen', spawn: 'spawnscreen', keys: 'keysscreen', bay: 'bayscreen', reset: 'resetscreen', gunsmith: 'gunsmithscreen' }[which];
    $(el).classList.remove('hidden');
    if (which === 'inv') { this.renderInventory(); this.preview.start(); }
    if (which === 'inv') { const d = this.game.day ?? 0.5, h = Math.floor(d * 24), m = Math.floor((d * 24 - h) * 60); $('pdaclock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
    document.body.classList.toggle('invopen', which === 'inv');
    if (which === 'map') this.renderMap();
    if (which === 'build') this.renderBuildMenu();
    if (which === 'paint') this.renderPaint();
    if (which === 'items') this.renderItems();
    if (which === 'clan') { this.renderClan(); this.game.net.send({ t: 'clan', a: 'info' }); }
    this.game.input.unlock();
  }
  close(silent) {
    for (const id of ['invscreen', 'mapscreen', 'buildmenu', 'pausescreen', 'deathscreen', 'clanscreen', 'paintscreen', 'itemscreen', 'resetscreen', 'gunsmithscreen', 'spawnscreen', 'keysscreen', 'bayscreen']) $(id).classList.add('hidden');
    this.game.input.capture = null;
    $('itemtip').classList.add('hidden');
    this.endDrag();
    if (this.open === 'inv' && this.game.container) { this.game.net.send({ t: 'close' }); this.game.container = null; }
    if (this.preview) this.preview.stop();
    if (this.open === 'gunsmith') this.game.gunsmith?.close();
    document.body.classList.remove('invopen');
    const was = this.open;
    this.open = null;
    if (!silent && was !== 'death') this.game.input.lock();
  }

  death(by, bags) {
    this.show('death');
    $('deathby').textContent = `Killed by ${by}`;
    const opts = $('respawnopts');
    opts.innerHTML = '';
    const b0 = document.createElement('button'); b0.textContent = '🏖️ Respawn on a random beach'; b0.onclick = () => this.game.net.send({ t: 'respawn' }); opts.appendChild(b0);
    for (const b of bags || []) {
      const el = document.createElement('button'); el.className = 'alt'; el.textContent = `🛏️ Respawn at bed / sleeping bag (${b.x}, ${b.z})`;
      el.onclick = () => this.game.net.send({ t: 'respawn', bag: b.id });
      opts.appendChild(el);
    }
  }

  // ------------------------------------------------------------------ map / fog of war
  loadExplored() {
    this.explored = new Uint8Array(500 * 500);
    this.discovered = new Set();
    try {
      const k = 'or_explored_' + this.game.seed;
      const s = localStorage.getItem(k);
      if (s) { const bin = atob(s); for (let i = 0; i < bin.length && i * 8 < this.explored.length; i++) { const b = bin.charCodeAt(i); for (let j = 0; j < 8; j++) this.explored[i * 8 + j] = (b >> j) & 1; } }
      const d = localStorage.getItem('or_pois_' + this.game.seed);
      if (d) JSON.parse(d).forEach((x) => this.discovered.add(x));
    } catch {}
    this.mapDirty = true;
  }
  saveExplored() {
    try {
      let s = '';
      for (let i = 0; i < this.explored.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b |= this.explored[i + j] << j; s += String.fromCharCode(b); }
      localStorage.setItem('or_explored_' + this.game.seed, btoa(s));
      localStorage.setItem('or_pois_' + this.game.seed, JSON.stringify([...this.discovered]));
    } catch {}
  }
  reveal(x, z) {
    const cx = Math.floor((x + HALF) / 32), cz = Math.floor((z + HALF) / 32), R = 9;
    let changed = false;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      if (i * i + j * j > R * R) continue;
      const px = cx + i, pz = cz + j;
      if (px < 0 || pz < 0 || px >= 500 || pz >= 500) continue;
      const k = pz * 500 + px;
      if (!this.explored[k]) { this.explored[k] = 1; changed = true; }
    }
    if (changed) this.mapDirty = true;
    const np = this.game.world.nearestPOI(x, z);
    if (np && np.d < 160 && !this.discovered.has(np.poi.id)) { this.discovered.add(np.poi.id); this.toast(`📍 Discovered: ${np.poi.name}`); }
  }
  renderMap() {
    const w = this.game.world, img = this.mapImg.data;
    if (this.mapDirty) {
      for (let pz = 0; pz < 500; pz++) for (let px = 0; px < 500; px++) {
        const k = pz * 500 + px, o = k * 4;
        if (!this.explored[k]) { img[o] = 22; img[o + 1] = 26; img[o + 2] = 30; img[o + 3] = 255; continue; }
        if (img[o + 3] === 254) continue; // cached
        const x = -HALF + px * 32 + 16, z = -HALF + pz * 32 + 16;
        const h = w.height(x, z);
        const b = w.biome(x, z, h);
        let [r, g, bl] = BIOME_COLORS[b];
        if (h < 0) { const d = Math.min(1, -h / 30); r = 60 - d * 35; g = 120 - d * 55; bl = 160 - d * 60; }
        else { const sh = 0.85 + Math.min(0.3, h / 400); r *= sh; g *= sh; bl *= sh; }
        img[o] = r; img[o + 1] = g; img[o + 2] = bl; img[o + 3] = 254;
      }
      this.mapDirty = false;
    }
    const ctx = this.mapCtx;
    ctx.putImageData(this.mapImg, 0, 0);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (const p of w.allPOIs()) {
      if (!this.discovered.has(p.id)) continue;
      const mx = (p.x + HALF) / 32, mz = (p.z + HALF) / 32;
      ctx.fillStyle = '#e0a040'; ctx.fillRect(mx - 2, mz - 2, 4, 4);
      ctx.fillStyle = '#fff'; ctx.fillText(p.name, mx, mz - 5);
    }
    for (const p of this.game.entities.players.values()) if (p.flags & 32) { const mx = (p.pos.x + HALF) / 32, mz = (p.pos.z + HALF) / 32; ctx.fillStyle = '#6ad04a'; ctx.beginPath(); ctx.arc(mx, mz, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(p.name, mx, mz - 6); }
    for (const b of this.game.bags || []) { const mx = (b.x + HALF) / 32, mz = (b.z + HALF) / 32; ctx.fillStyle = '#60c0ff'; ctx.fillRect(mx - 2, mz - 2, 4, 4); }
    const sv = this.game.spawnMark;
    if (sv) { const mx = (sv.x + HALF) / 32, mz = (sv.z + HALF) / 32; ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, mz, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#ffd24a'; ctx.fillText('Your ' + sv.name, mx, mz - 8); }
    const pp = this.game.player.pos, yaw = this.game.player.yaw;
    const mx = (pp.x + HALF) / 32, mz = (pp.z + HALF) / 32;
    ctx.save(); ctx.translate(mx, mz); ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = '#ff4030'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    let n = 0; for (let i = 0; i < this.explored.length; i++) n += this.explored[i];
    $('mapinfo').textContent = `Position ${Math.round(pp.x)}, ${Math.round(pp.z)} · Explored ${((n / (500 * 500)) * 100).toFixed(2)}% of the map · ${this.discovered.size} places discovered · North is up`;
  }
}

export function countItem(inv, id) { let n = 0; for (const s of inv) if (s && s.id === id) n += s.n; return n; }
function affordable(inv, cost) { for (const k in cost) if (countItem(inv, k) < cost[k]) return false; return true; }
export function itemDesc(st, short) {
  const d = ITEMS[st.id];
  if (!d) return st.id;
  let s = short ? '' : `<div class="bigico">${iconHTML(st.id, 'bico')}</div><b>${d.name}</b>${st.n > 1 ? ' ×' + st.n : ''}<br>`;
  if (d.gun) s += `Damage ${d.gun.dmg}${d.gun.pellets ? '×' + d.gun.pellets : ''} · ${d.gun.rate}/s · mag ${d.gun.mag} · ammo: ${ITEMS[d.gun.ammo].name}${st.a !== undefined && !short ? ` · loaded ${st.a}` : ''}`;
  else if (d.dig) s += 'LMB dig the ground (finds stone, sometimes ore) · RMB pile up dirt. Everyone sees your holes and mounds.';
  else if (d.armor && d.armor.slot !== 'back') { const A = d.armor; s += [`Protection ${Math.round(A.prot * 100)}%`, A.bullet !== undefined ? `vs bullets ${Math.round(A.bullet * 100)}%` : '', A.melee !== undefined ? `vs melee ${Math.round(A.melee * 100)}%` : '', `warmth ${Math.round(A.cold * 100)}%`, A.weight ? `${Math.round(A.weight * 100)}% slower` : '', A.camo ? 'camouflage: hides your name tag beyond 8 m' : '', A.swim ? `swim ${Math.round((A.swim - 1) * 100)}% faster, warm in water` : ''].filter(Boolean).join(' · ') + '. Armour never stops more than 60% of a hit.'; }
  else if (d.flashlight) s += 'LMB switch on/off · R put in a Battery (+50%) or Power Cell (+100%) · or charge it in a Charging Station. A full charge lasts 15 minutes.';
  else if (d.bottle) s += 'Hold it and LMB while standing in water: the sea gives Salt Water, lakes and rivers fresh water.';
  else if (st.id === 'salt_water') s += "Too salty to drink — refine it (Portable Refiner, Refinery or Salt Water Refiner) into a Water Bottle and Salt.";
  else if (d.deploy?.tech) s += 'Large electronics — place it from the build menu (⚡ tab). Base machines share the power of their base.';
  else if (d.spray) s += 'Paint vehicles, walls, doors and furniture. LMB paints the colour · RMB sprays a decal · X cleans · R opens the palette (16 colours, 16 decals, 3 sizes).';
  else if (d.tool && d.tool.hammer) s += 'LMB upgrade material · R reinforce (+50% HP, twice) · RMB repair · X demolish';
  else if (d.tool) s += `Damage ${d.tool.dmg} · tree ${d.tool.tree} · ore ${d.tool.ore}`;
  else if (d.plan) s += 'Place foundations, walls, floors… RMB to choose piece, R to rotate.';
  else if (d.armor?.slot === 'back') s += `Bag: wear it on your back for +${d.armor.rows} inventory row${d.armor.rows > 1 ? 's' : ''} (${d.armor.rows * 6} cells). Right-click to wear.`;
  else if (d.armor) s += `${d.armor.slot} armor · ${Math.round(d.armor.prot * 100)}% protection · warmth ${d.armor.cold}`;
  else if (d.explosive) s += `Raiding explosive · ${d.explosive.dmg} structure damage · ${d.explosive.fuse}s fuse. LMB to place/throw.`;
  else if (d.cat === 'food') s += `Food +${d.food} · Water +${d.water}${d.heal ? ' · Health ' + (d.heal > 0 ? '+' : '') + d.heal : ''} · LMB to eat`;
  else if (d.cat === 'medical') s += `Heals ${d.heal} · LMB to use`;
  else if (d.deploy?.furniture) s += (d.deploy.slots ? `Furniture with ${d.deploy.slots} storage slots. ` : 'Furniture. ') + (d.deploy.respawn ? 'You can respawn here. ' : '') + (d.deploy.light ? 'Lights up the room. ' : '') + 'Place it with the item or from the Building Plan wheel (Furniture).';
  else if (d.deploy) s += { campfire: 'Press E on it to cook food and make charcoal & fuel. Keeps you warm.', furnace: 'Press E on it to smelt ore into metal & sulfur.', workbench1: 'Press E on it to craft tier 1 items.', workbench2: 'Press E on it to craft tier 1-2 items.', workbench3: 'Press E on it to craft tier 1-3 items.', small_box: 'Store 12 stacks.', large_box: 'Store 30 stacks.', sleeping_bag: 'Respawn point.', tool_cupboard: 'Claim a 30m building privilege. Authorize friends. Locks doors to authorized players.' }[d.deploy.kind] || '';
  else if (d.door) s += `Place in a doorway. ${d.door.hp} HP. Locked to tool cupboard authorized players.`;
  else if (st.id === 'wheel' || st.id === 'engine_parts') s += 'Used to repair broken vehicles.';
  else if (st.id === 'fuel') s += 'Fuel for vehicles: open the fuel cap (look at it and press E) and put it in the tank. Also burns in Fuel Generators and the Portable Refiner.';
  else s += d.cat;
  return s;
}
