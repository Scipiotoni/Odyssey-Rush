// Radial build wheel (opened with RMB while holding a Building Plan).
// Outer ring: building menus (Construction, Doors, Furniture). Click a menu to
// open its items on the ring. Centre: material toggle (◀ ▶) that the pieces are
// built from. Selecting an item sets what the building plan will place.
import { PIECES, PIECE_ORDER, TIERS, pieceCost } from '/shared/building.js';
import { ITEMS } from '/shared/items.js';
import { audio } from './audio.js';
import { countItem } from './ui.js';

const MENUS = [
  { id: 'construction', name: 'Construction', icon: '🧱', items: PIECE_ORDER.map((id) => ({ kind: 'piece', id })) },
  { id: 'doors', name: 'Doors', icon: '🚪', items: ['wood_door', 'metal_door', 'armored_door'].map((id) => ({ kind: 'item', id })) },
  { id: 'furniture', name: 'Furniture', icon: '🪑', items: ['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3', 'small_box', 'large_box', 'sleeping_bag', 'tool_cupboard'].map((id) => ({ kind: 'item', id })) },
];

const C = 300;          // svg centre
const R_CENTRE = 112;   // material toggle radius
const R_IN = 122;       // ring inner radius
const R_OUT = 290;      // ring outer radius
const GAP = 0.03;       // radians between segments
const $ = (id) => document.getElementById(id);

const pt = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
function annulus(r1, r2, a0, a1) {
  const [x1, y1] = pt(r2, a0), [x2, y2] = pt(r2, a1), [x3, y3] = pt(r1, a1), [x4, y4] = pt(r1, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${large} 0 ${x4},${y4} Z`;
}
// Half of the centre disc: side -1 = left, +1 = right
function half(side) {
  const [x1, y1] = pt(R_CENTRE, -Math.PI / 2), [x2, y2] = pt(R_CENTRE, Math.PI / 2);
  const sweep = side < 0 ? 0 : 1;
  return `M${x1},${y1} A${R_CENTRE},${R_CENTRE} 0 0 ${sweep} ${x2},${y2} Z`;
}
// Split a name into at most 3 short lines for the ring labels
function wrap(name) {
  const words = name.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 13 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class BuildWheel {
  constructor(game) {
    this.game = game;
    this.menu = null;   // null = top level (menus), otherwise a MENUS id
    this.hover = null;  // { kind, id, label } of the hovered segment
    this.root = $('buildmenu');
    this.wrap = $('buildwheel');
    this.info = $('bwinfo');
    this.title = $('bwtitle');
    this.wrap.addEventListener('click', (e) => this.onClick(e));
    this.wrap.addEventListener('pointerover', (e) => this.onOver(e));
    this.wrap.addEventListener('pointerleave', () => { this.hover = null; this.renderInfo(); });
    this.wrap.addEventListener('wheel', (e) => { e.preventDefault(); this.cycleMaterial(Math.sign(e.deltaY)); }, { passive: false });
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root && e.button === 0) return this.game.ui.close();
      if (e.button === 2) { e.preventDefault(); if (this.menu) this.setMenu(null); else this.game.ui.close(); }
    });
  }

  reset() { this.menu = null; this.hover = null; this.render(); }

  get builder() { return this.game.building; }

  // The items on the ring at the current level.
  entries() {
    if (!this.menu) return MENUS.map((m) => ({ kind: 'menu', id: m.id, name: m.name, icon: m.icon, count: m.items.length }));
    const m = MENUS.find((x) => x.id === this.menu);
    const out = [{ kind: 'back', id: 'back', name: 'Back', icon: '‹' }];
    for (const it of m.items) {
      if (it.kind === 'piece') out.push({ kind: 'piece', id: it.id, name: PIECES[it.id].name, icon: PIECES[it.id].icon });
      else { const d = ITEMS[it.id]; out.push({ kind: 'item', id: it.id, name: d.name, icon: d.icon }); }
    }
    return out;
  }
  isSelected(e) {
    const b = this.builder;
    if (e.kind === 'piece') return !b.deploy && b.piece === e.id;
    if (e.kind === 'item') return b.deploy === e.id;
    return false;
  }
  // Whether a ring entry can be built right now (for dimming)
  available(e) {
    if (e.kind === 'piece') return this.canAfford(pieceCost(e.id, this.builder.tier));
    if (e.kind === 'item') return countItem(this.game.inv, e.id) > 0;
    return true;
  }
  canAfford(cost) { for (const k in cost) if (countItem(this.game.inv, k) < cost[k]) return false; return true; }

  render() {
    const b = this.builder;
    const list = this.entries();
    const step = (Math.PI * 2) / list.length;
    const segs = list.map((e, i) => {
      const mid = -Math.PI / 2 + i * step;
      const a0 = mid - step / 2 + GAP, a1 = mid + step / 2 - GAP;
      const cls = ['bw-seg', e.kind === 'back' ? 'bw-back' : '', this.isSelected(e) ? 'sel' : '', e.kind !== 'menu' && e.kind !== 'back' && !this.available(e) ? 'dim' : ''].join(' ');
      const [lx, ly] = pt((R_IN + R_OUT) / 2, mid);
      const lines = wrap(e.name);
      const tspans = lines.map((t, k) => `<tspan x="${lx}" dy="${k === 0 ? 0 : 15}">${esc(t)}</tspan>`).join('');
      const count = e.kind === 'menu' ? `<tspan x="${lx}" dy="15" class="bw-sub">${e.count} items</tspan>` : '';
      return `<g class="${cls}" data-k="${e.kind}" data-id="${esc(e.id)}">
        <path d="${annulus(R_IN, R_OUT, a0, a1)}"></path>
        <text class="bw-icon" x="${lx}" y="${ly - 16}">${esc(e.icon)}</text>
        <text class="bw-txt" x="${lx}" y="${ly + 6}">${tspans}${count}</text>
      </g>`;
    }).join('');
    const tier = TIERS[b.tier];
    const applies = !b.deploy;
    const pips = TIERS.map((t, i) => `<circle cx="${C - 40 + i * 20}" cy="${C + 58}" r="6" fill="#${t.color.toString(16).padStart(6, '0')}" class="${i === b.tier ? 'pip on' : 'pip'}"></circle>`).join('');
    this.wrap.innerHTML = `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
      ${segs}
      <g class="bw-centre">
        <circle cx="${C}" cy="${C}" r="${R_CENTRE}" class="bw-disc"></circle>
        <path d="${half(-1)}" class="bw-half" data-dir="-1"></path>
        <path d="${half(1)}" class="bw-half" data-dir="1"></path>
        <text x="${C - 72}" y="${C + 8}" class="bw-arrow">◀</text>
        <text x="${C + 72}" y="${C + 8}" class="bw-arrow">▶</text>
        <text x="${C}" y="${C - 30}" class="bw-small">MATERIAL</text>
        <text x="${C}" y="${C + 6}" class="bw-mat" style="fill:#${tier.color.toString(16).padStart(6, '0')}">${esc(tier.name)}</text>
        <text x="${C}" y="${C + 24}" class="bw-small${applies ? '' : ' na'}">${applies ? 'for pieces' : 'fixed for items'}</text>
        ${pips}
      </g>
    </svg>`;
    this.title.textContent = this.menu ? `Building — ${MENUS.find((m) => m.id === this.menu).name}` : 'Building — choose a menu';
    this.renderInfo();
  }

  renderInfo() {
    const b = this.builder, g = this.game, h = this.hover;
    const sel = b.deploy ? ITEMS[b.deploy].name : PIECES[b.piece].name;
    let txt = `<div>Selected: <b>${esc(sel)}</b>${b.deploy ? '' : ` · ${esc(TIERS[b.tier].name)}`}</div>`;
    if (h && h.kind === 'menu') txt += `<div class="bw-hov">${esc(h.name)} — click to open</div>`;
    else if (h && h.kind === 'piece') {
      const cost = pieceCost(h.id, b.tier);
      const parts = Object.entries(cost).map(([k, v]) => `<span class="${countItem(g.inv, k) < v ? 'miss' : ''}">${v} ${ITEMS[k].name} (${countItem(g.inv, k)})</span>`).join(' · ');
      txt += `<div class="bw-hov"><b>${esc(PIECES[h.id].name)}</b> in ${esc(TIERS[b.tier].name)}: ${parts}</div>`;
    } else if (h && h.kind === 'item') {
      const have = countItem(g.inv, h.id);
      txt += `<div class="bw-hov"><b>${esc(ITEMS[h.id].name)}</b> — ${have ? `you have ${have}` : '<span class="miss">none in your inventory, craft one first</span>'}</div>`;
    } else if (h && h.kind === 'back') txt += '<div class="bw-hov">Back to menus</div>';
    txt += '<div class="bw-tip">Centre ◀ ▶ or mouse wheel: change material · Click an item to select it · RMB / Esc: back / close</div>';
    this.info.innerHTML = txt;
  }

  setMenu(id) { this.menu = id; this.hover = null; audio.click(); this.render(); }

  cycleMaterial(dir) {
    const b = this.builder;
    b.tier = (b.tier + (dir || 1) + TIERS.length) % TIERS.length;
    audio.click();
    this.render();
  }

  onOver(e) {
    const seg = e.target.closest?.('.bw-seg');
    const h = seg ? { kind: seg.dataset.k, id: seg.dataset.id, name: seg.querySelector('.bw-txt')?.textContent || '' } : null;
    if (h && h.kind === 'menu') h.name = MENUS.find((m) => m.id === h.id).name;
    if (h && h.kind === 'piece') h.name = PIECES[h.id].name;
    if (h && h.kind === 'item') h.name = ITEMS[h.id].name;
    const same = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.id === b.id);
    if (!same(h, this.hover)) { this.hover = h; this.renderInfo(); }
  }

  onClick(e) {
    const half = e.target.closest?.('.bw-half');
    if (half) return this.cycleMaterial(+half.dataset.dir);
    const seg = e.target.closest?.('.bw-seg');
    if (!seg) return;
    const k = seg.dataset.k, id = seg.dataset.id;
    if (k === 'menu') return this.setMenu(id);
    if (k === 'back') return this.setMenu(null);
    const b = this.builder;
    if (k === 'piece') { b.piece = id; b.deploy = null; }
    else if (k === 'item') { b.deploy = id; }
    audio.click();
    this.game.ui.close();
  }
}
