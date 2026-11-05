// DOM user interface: HUD, inventory, crafting, containers, map, chat, menus.
import { ITEMS, RECIPES, STATION_NAMES, STATION_PROVIDERS, STATION_RANGE, ARMOR_SLOTS, HOTBAR, INV_SIZE, stationRecipes } from '/shared/items.js';
import { PIECES, PIECE_ORDER, pieceCost, TIERS } from '/shared/building.js';
import { HALF, WORLD_SIZE, BIOME } from '/shared/worldgen.js';
import { audio } from './audio.js';
import { icons } from './icons.js';

// <img> for an item's rendered icon (falls back to the emoji until it's ready)
export function iconHTML(id, cls = 'ico') { const src = icons.get(id); return src ? `<img class="${cls}" src="${src}" alt="">` : `<span class="${cls} emo">${ITEMS[id]?.icon || '?'}</span>`; }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const CONTROLS = [
  ['WASD', 'Move'], ['Shift', 'Sprint'], ['Ctrl / C', 'Crouch'], ['Space', 'Jump / swim up'], ['LMB', 'Use / attack / build'], ['RMB', 'Aim · build menu · repair'],
  ['E', 'Interact / pick up / enter vehicle'], ['R', 'Reload · rotate piece · flip vehicle'], ['1-6 / wheel', 'Belt slots'], ['Tab', 'Inventory & crafting'],
  ['Q', 'Crafting'], ['M', 'Map'], ['L', 'Clan'], ['F', 'Drink water (stand in it)'], ['X', 'Demolish (hammer, own piece)'], ['V', 'Vehicle camera'], ['Enter', 'Chat'], ['Esc', 'Pause / settings'],
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
  prompt(html) { if (this._prompt !== html) { $('prompt').innerHTML = html || ''; this._prompt = html; } }
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
    $('vfuel').textContent = `⛽ ${Math.floor(v.fuel)} / ${v.fuelCap}${v.fuel <= 0 ? ' — OUT OF FUEL' : ''}${v.engineOk === false ? ' — ENGINE FLOODED' : ''}`;
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
    $('chatlog').appendChild(el);
    while ($('chatlog').children.length > 12) $('chatlog').firstChild.remove();
  }
  openChat() {
    this.open = 'chat';
    $('chat').classList.add('open');
    const inp = $('chatinput'); inp.classList.remove('hidden'); inp.value = ''; inp.focus();
  }
  closeChat(send) {
    const inp = $('chatinput');
    if (send && inp.value.trim()) this.game.net.send({ t: 'chat', m: inp.value.trim() });
    inp.classList.add('hidden'); inp.blur();
    $('chat').classList.remove('open');
    this.open = null;
  }

  // ------------------------------------------------------------------ inventory
  buildInventory() {
    const mk = (parent, c, i, key) => {
      const el = document.createElement('div'); el.className = 'slot'; el.dataset.c = c; el.dataset.i = i;
      if (key) el.dataset.key = key;
      el.addEventListener('mousedown', (e) => this.onSlotDown(e, el));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onSlotRight(el); });
      el.addEventListener('mouseenter', (e) => this.showTip(el, e));
      el.addEventListener('mouseleave', () => $('itemtip').classList.add('hidden'));
      parent.appendChild(el);
      return el;
    };
    this.armorEls = ARMOR_SLOTS.map((s) => mk($('armorslots'), 'a', s));
    this.invEls = [];
    for (let i = HOTBAR; i < INV_SIZE; i++) this.invEls[i] = mk($('invgrid'), 'p', i);
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
    ARMOR_SLOTS.forEach((s, k) => { const el = this.armorEls[k]; el.innerHTML = this.slotHTML(g.armor[s]) || `<span class="lbl">${s}</span>`; });
    for (let i = 0; i < INV_SIZE; i++) this.invEls[i].innerHTML = this.slotHTML(g.inv[i], i < HOTBAR ? i + 1 : null);
    const c = g.container;
    $('contpanel').classList.toggle('hidden', !c);
    $('craftpanel').classList.toggle('hidden', !!c && !c.station);
    if (c && c.station) this.renderCrafting();
    if (c) {
      $('conttitle').textContent = c.station ? `${c.title} — output (finished items stay here until you take them)` : c.title;
      const grid = $('contgrid');
      if (this.contEls.length !== c.slots.length) {
        grid.innerHTML = ''; this.contEls = [];
        c.slots.forEach((_, i) => {
          const el = document.createElement('div'); el.className = 'slot'; el.dataset.c = 'c'; el.dataset.i = i;
          el.addEventListener('mousedown', (e) => this.onSlotDown(e, el));
          el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onSlotRight(el); });
          el.addEventListener('mouseenter', (e) => this.showTip(el, e));
          el.addEventListener('mouseleave', () => $('itemtip').classList.add('hidden'));
          grid.appendChild(el); this.contEls.push(el);
        });
      }
      c.slots.forEach((st, i) => (this.contEls[i].innerHTML = this.slotHTML(st)));
    } else this.renderCrafting();
    this.renderHotbar();
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
        const range = r.i < HOTBAR ? [HOTBAR, INV_SIZE] : [0, HOTBAR];
        for (let i = range[0]; i < range[1]; i++) if (!g.inv[i]) { g.net.send({ t: 'move', from: r, to: { c: 'p', i } }); break; }
      } else if (r.c === 'a') g.net.send({ t: 'move', from: r, to: { c: 'p', i: firstFree(g.inv) } });
      return;
    }
    this.drag = { ...r, half: e.ctrlKey };
    const gh = document.createElement('div'); gh.id = 'dragghost'; gh.innerHTML = iconHTML(st.id);
    gh.style.left = e.clientX + 'px'; gh.style.top = e.clientY + 'px';
    document.body.appendChild(gh);
    this.dragEl = gh;
  }
  onMouseMove(e) { if (this.dragEl) { this.dragEl.style.left = e.clientX + 'px'; this.dragEl.style.top = e.clientY + 'px'; } }
  onMouseUp(e) {
    if (!this.drag) return;
    const el = e.target.closest?.('.slot');
    if (el && el.dataset.c) {
      const to = this.ref(el);
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
  endDrag() { this.drag = null; if (this.dragEl) { this.dragEl.remove(); this.dragEl = null; } }
  onSlotRight(el) {
    const r = this.ref(el), g = this.game;
    const st = this.stackAt(r.c, r.i);
    if (!st) return;
    const d = ITEMS[st.id];
    if (r.c === 'p' && (d.cat === 'food' || d.cat === 'medical')) return g.net.send({ t: 'eat', i: r.i });
    if (r.c === 'p' && d.armor) return g.net.send({ t: 'move', from: r, to: { c: 'a', i: d.armor.slot } });
    if (g.container) return g.net.send({ t: 'move', from: r, to: { c: r.c === 'c' ? 'p' : 'c', i: -1 } });
    if (r.c === 'a') return g.net.send({ t: 'move', from: r, to: { c: 'p', i: firstFree(g.inv) } });
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
      html += `<div class="rgroup">Crafting here (${c.queue.length})</div>` + c.queue.map((e, i) => {
        const left = Math.max(0, e.left - (now - c.recv) / 1000 - (i ? 0 : 0));
        return `<div class="recipe can" data-cancel="${i}"><span class="ic">${iconHTML(RECIPES[e.r].out, 'rico')}</span><span class="nm">${ITEMS[RECIPES[e.r].out].name}</span><span class="st">${Math.ceil(left)}s ✕</span></div>`;
      }).join('');
    }
    html += `<div class="rgroup">${station ? `${ITEMS[station].name} recipes` : 'Hand crafting — press E on a camp fire, furnace or workbench for more'}</div>`;
    for (const r of recipes.filter((r) => !q || ITEMS[r.out].name.toLowerCase().includes(q))) {
      const can = affordable(g.inv, r.cost);
      html += `<div class="recipe ${can ? 'can' : ''} ${this.selRecipe === r.id ? 'sel' : ''}" data-r="${r.id}"><span class="ic">${iconHTML(r.out, 'rico')}</span><span class="nm">${ITEMS[r.out].name}${r.n > 1 ? ' ×' + r.n : ''}</span><span class="st">${r.time}s</span></div>`;
    }
    if (!station) {
      const locked = RECIPES.filter((r) => r.station && (!q || ITEMS[r.out].name.toLowerCase().includes(q)));
      if (q && locked.length) html += `<div class="rgroup">Needs a station</div>` + locked.map((r) => `<div class="recipe locked"><span class="ic">${iconHTML(r.out, 'rico')}</span><span class="nm">${ITEMS[r.out].name}</span><span class="st">${STATION_NAMES[r.station]}</span></div>`).join('');
    }
    const list = $('craftlist');
    const scroll = list.scrollTop;
    list.innerHTML = html;
    list.scrollTop = scroll;
    list.querySelectorAll('.recipe[data-r]').forEach((el) => el.addEventListener('click', () => { this.selRecipe = +el.dataset.r; audio.click(); this.renderCrafting(); }));
    list.querySelectorAll('.recipe[data-cancel]').forEach((el) => el.addEventListener('click', () => { g.net.send({ t: 'ccancel', i: +el.dataset.cancel, st: c.id }); audio.click(); }));
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
  renderBuildMenu(hover = null) {
    if (!hover) this._wheelHover = null;
    const g = this.game, b = g.building;
    const C = 300, TAU = Math.PI * 2;
    const pt = (r, a) => [C + Math.sin(a) * r, C - Math.cos(a) * r];
    const sector = (r0, r1, a0, a1) => {
      const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      if (r0 <= 0) return `M${C},${C} L${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} Z`;
      return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
    };
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const costTxt = (c) => Object.entries(c).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ');
    let svg = `<svg viewBox="0 0 600 600">`;
    // outer ring
    const furnIds = Object.keys(ITEMS).filter((id) => ITEMS[id].deploy || ITEMS[id].door);
    const items = b.cat === 'construction' ? PIECE_ORDER.map((t) => ({ key: t, label: PIECES[t].name, icon: PIECES[t].icon, ok: true, sel: !b.furn && b.piece === t }))
      : furnIds.map((id) => { const n = countItem(g.inv, id); return { key: id, label: ITEMS[id].name.replace('Workbench Level', 'Workbench'), img: icons.get(id), icon: ITEMS[id].icon, n, ok: n > 0, sel: b.furn === id }; });
    const n = items.length, gap = 0.012;
    items.forEach((it, i) => {
      const a0 = (i / n) * TAU + gap, a1 = ((i + 1) / n) * TAU - gap, am = (a0 + a1) / 2;
      const fill = it.sel ? '#a8582e' : hover === 'o' + i ? '#5a4a3a' : 'rgba(30,30,30,.88)';
      svg += `<path class="seg ${it.ok ? '' : 'dis'}" data-o="${i}" d="${sector(178, 292, a0, a1)}" fill="${fill}" stroke="rgba(255,255,255,.15)"/>`;
      const [ix, iy] = pt(254, am), [tx, ty] = pt(200, am);
      if (it.img) svg += `<image href="${it.img}" x="${ix - 21}" y="${iy - 21}" width="42" height="42" opacity="${it.ok ? 1 : 0.4}"/>`;
      else svg += `<text x="${ix}" y="${iy}" font-size="30">${it.icon}</text>`;
      svg += `<text x="${tx}" y="${ty}" font-size="${n > 10 ? 10 : 12}">${esc(it.label)}${it.n !== undefined ? ` (${it.n})` : ''}</text>`;
    });
    // middle ring: categories
    const cats = [['construction', 'Construction', '🧱'], ['furniture', 'Furniture', '🪑']];
    cats.forEach(([k, label, ic], i) => {
      const a0 = i * Math.PI + 0.02, a1 = (i + 1) * Math.PI - 0.02, am = (a0 + a1) / 2;
      svg += `<path class="seg" data-c="${k}" d="${sector(112, 172, a0, a1)}" fill="${b.cat === k ? '#3d5a3a' : 'rgba(45,45,45,.92)'}" stroke="rgba(255,255,255,.15)"/>`;
      const [x, y] = pt(142, am);
      svg += `<text x="${x}" y="${y}" font-size="15" font-weight="700">${ic} ${label}</text>`;
    });
    // centre: material toggle
    TIERS.forEach((t, i) => {
      const a0 = (i / TIERS.length) * TAU + 0.02, a1 = ((i + 1) / TIERS.length) * TAU - 0.02, am = (a0 + a1) / 2;
      const on = b.tier === i;
      svg += `<path class="seg" data-t="${i}" d="${sector(36, 106, a0, a1)}" fill="${hex(t.color)}" opacity="${on ? 1 : 0.55}" stroke="${on ? '#fff' : 'rgba(0,0,0,.4)'}" stroke-width="${on ? 3 : 1}"/>`;
      const [x, y] = pt(74, am);
      svg += `<text x="${x}" y="${y}" font-size="10.5" font-weight="700" style="paint-order:stroke;stroke:#000;stroke-width:2px">${t.name.replace('Sheet ', '')}</text>`;
    });
    svg += `<circle cx="${C}" cy="${C}" r="33" fill="rgba(15,15,15,.95)" stroke="rgba(255,255,255,.2)"/>`;
    // centre info
    const hv = hover && hover[0] === 'o' ? items[+hover.slice(1)] : items.find((x) => x.sel);
    let info = '';
    if (b.cat === 'construction' && hv) info = costTxt(pieceCost(hv.key, b.tier));
    else if (hv && b.cat === 'furniture') info = hv.ok ? `You have ${hv.n}` : 'Craft it first';
    svg += `<text x="${C}" y="${C - 7}" font-size="11" font-weight="700">${esc(hv ? hv.label : '')}</text><text x="${C}" y="${C + 9}" font-size="8.5" opacity=".8">${esc(info).slice(0, 40)}</text>`;
    svg += `</svg>`;
    const box = $('buildwheel');
    box.innerHTML = svg;
    box.querySelectorAll('[data-o]').forEach((el) => {
      const it = items[+el.dataset.o];
      el.addEventListener('mouseenter', () => { if (this._wheelHover !== 'o' + el.dataset.o) { this._wheelHover = 'o' + el.dataset.o; this.renderBuildMenu(this._wheelHover); } });
      el.addEventListener('click', () => {
        if (!it.ok) return;
        audio.click();
        if (b.cat === 'construction') { b.piece = it.key; b.furn = null; } else b.furn = it.key;
        this.close();
      });
    });
    box.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('click', () => { b.cat = el.dataset.c; audio.click(); this.renderBuildMenu(); }));
    box.querySelectorAll('[data-t]').forEach((el) => el.addEventListener('click', () => { b.tier = +el.dataset.t; b.furn = null; b.cat = 'construction'; audio.click(); this.renderBuildMenu(); }));
  }

  // ------------------------------------------------------------------ panels
  show(which) {
    this.close(true);
    this.open = which;
    const el = { inv: 'invscreen', map: 'mapscreen', build: 'buildmenu', pause: 'pausescreen', death: 'deathscreen', clan: 'clanscreen' }[which];
    $(el).classList.remove('hidden');
    if (which === 'inv') this.renderInventory();
    if (which === 'map') this.renderMap();
    if (which === 'build') this.renderBuildMenu();
    if (which === 'clan') { this.renderClan(); this.game.net.send({ t: 'clan', a: 'info' }); }
    this.game.input.unlock();
  }
  close(silent) {
    for (const id of ['invscreen', 'mapscreen', 'buildmenu', 'pausescreen', 'deathscreen', 'clanscreen']) $(id).classList.add('hidden');
    $('itemtip').classList.add('hidden');
    this.endDrag();
    if (this.open === 'inv' && this.game.container) { this.game.net.send({ t: 'close' }); this.game.container = null; }
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
      const el = document.createElement('button'); el.className = 'alt'; el.textContent = `🛏️ Sleeping bag at ${b.x}, ${b.z}`;
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
function firstFree(inv) { for (let i = HOTBAR; i < inv.length; i++) if (!inv[i]) return i; for (let i = 0; i < HOTBAR; i++) if (!inv[i]) return i; return -1; }
export function itemDesc(st, short) {
  const d = ITEMS[st.id];
  if (!d) return st.id;
  let s = short ? '' : `<div class="bigico">${iconHTML(st.id, 'bico')}</div><b>${d.name}</b>${st.n > 1 ? ' ×' + st.n : ''}<br>`;
  if (d.gun) s += `Damage ${d.gun.dmg}${d.gun.pellets ? '×' + d.gun.pellets : ''} · ${d.gun.rate}/s · mag ${d.gun.mag} · ammo: ${ITEMS[d.gun.ammo].name}${st.a !== undefined && !short ? ` · loaded ${st.a}` : ''}`;
  else if (d.dig) s += 'LMB dig the ground (finds stone, sometimes ore) · RMB pile up dirt. Everyone sees your holes and mounds.';
  else if (d.tool && d.tool.hammer) s += 'LMB upgrade building piece · RMB repair · X demolish';
  else if (d.tool) s += `Damage ${d.tool.dmg} · tree ${d.tool.tree} · ore ${d.tool.ore}`;
  else if (d.plan) s += 'Place foundations, walls, floors… RMB to choose piece, R to rotate.';
  else if (d.armor) s += `${d.armor.slot} armor · ${Math.round(d.armor.prot * 100)}% protection · warmth ${d.armor.cold}`;
  else if (d.explosive) s += `Raiding explosive · ${d.explosive.dmg} structure damage · ${d.explosive.fuse}s fuse. LMB to place/throw.`;
  else if (d.cat === 'food') s += `Food +${d.food} · Water +${d.water}${d.heal ? ' · Health ' + (d.heal > 0 ? '+' : '') + d.heal : ''} · LMB to eat`;
  else if (d.cat === 'medical') s += `Heals ${d.heal} · LMB to use`;
  else if (d.deploy) s += { campfire: 'Press E on it to cook food and make charcoal & fuel. Keeps you warm.', furnace: 'Press E on it to smelt ore into metal & sulfur.', workbench1: 'Press E on it to craft tier 1 items.', workbench2: 'Press E on it to craft tier 1-2 items.', workbench3: 'Press E on it to craft tier 1-3 items.', small_box: 'Store 12 stacks.', large_box: 'Store 30 stacks.', sleeping_bag: 'Respawn point.', tool_cupboard: 'Claim a 30m building privilege. Authorize friends. Locks doors to authorized players.' }[d.deploy.kind] || '';
  else if (d.door) s += `Place in a doorway. ${d.door.hp} HP. Locked to tool cupboard authorized players.`;
  else if (st.id === 'wheel' || st.id === 'engine_parts') s += 'Used to repair broken vehicles.';
  else if (st.id === 'fuel') s += 'Fuel for vehicles. Press E on a vehicle while holding fuel in inventory to refuel.';
  else s += d.cat;
  return s;
}
