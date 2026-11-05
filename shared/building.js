// Grid-based building system shared by client & server.
// A "building" has an origin + yaw. Pieces live on its grid:
//  - cell pieces (foundation, floor, stairs) at doubled coords (2i, 2j)
//  - edge pieces (wall, doorway, window) at doubled coords with one odd component
//  - level L: floor height = origin.y + L * LEVEL_H
export const G = 3;          // cell size (m)
export const LEVEL_H = 3;    // wall height (m)
export const BUILD_REACH = 6;
export const PRIV_RADIUS = 30; // tool cupboard privilege radius

export const TIERS = [
  { name: 'Twig', hp: 60, cost: { wood: 50 }, color: 0xc9a66b },
  { name: 'Wood', hp: 600, cost: { wood: 200 }, color: 0x8b5e34 },
  { name: 'Stone', hp: 1400, cost: { stone: 300 }, color: 0x9c9a94 },
  { name: 'Sheet Metal', hp: 2800, cost: { metal_frags: 200 }, color: 0x7d858c },
  { name: 'Armored', hp: 5500, cost: { hqm: 25 }, color: 0x4d5560 },
];

// Reinforcement (hammer + R): bolted braces / plating on top of the material. Each level adds +50% max HP.
export const REINFORCE = [
  null,
  { name: 'Braced', cost: { wood: 150, metal_frags: 60 } },
  { name: 'Plated', cost: { metal_frags: 250, hqm: 6 } },
];
export function pieceMaxHp(tier, reinf = 0) { return Math.round(TIERS[tier].hp * (1 + 0.5 * (reinf || 0))); }
export function reinforceCost(type, level) {
  const base = REINFORCE[level].cost, m = PIECES[type].costMul, out = {};
  for (const k in base) out[k] = Math.ceil(base[k] * m);
  return out;
}

export const PIECES = {
  foundation: { name: 'Foundation', slot: 'cell', costMul: 1, icon: '⬛' },
  floor: { name: 'Floor', slot: 'cell', costMul: 0.5, icon: '▭' },
  wall: { name: 'Wall', slot: 'edge', costMul: 1, icon: '▮' },
  doorway: { name: 'Doorway', slot: 'edge', costMul: 0.7, icon: '🚪' },
  window: { name: 'Window', slot: 'edge', costMul: 0.7, icon: '🪟' },
  half_wall: { name: 'Low Wall', slot: 'edge', costMul: 0.5, icon: '▬' },
  stairs: { name: 'Stairs', slot: 'cell', costMul: 1, icon: '🪜' },
  roof: { name: 'Roof', slot: 'cell', costMul: 0.75, icon: '🔺' },
};
export const PIECE_ORDER = ['foundation', 'wall', 'doorway', 'window', 'half_wall', 'floor', 'roof', 'stairs'];

export function pieceCost(type, tier) {
  const base = TIERS[tier].cost, m = PIECES[type].costMul, out = {};
  for (const k in base) out[k] = Math.ceil(base[k] * m);
  return out;
}

export function rotY(lx, lz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [lx * c + lz * s, -lx * s + lz * c];
}
export function invRotY(wx, wz, yaw) { return rotY(wx, wz, -yaw); }

// World transform of a grid piece: returns {x,y,z,yaw}
export function pieceTransform(b, p) {
  const lx = (p.gx * G) / 2, lz = (p.gz * G) / 2;
  const [dx, dz] = rotY(lx, lz, b.yaw);
  let yaw = b.yaw;
  if (PIECES[p.type]?.slot === 'edge' || p.type === 'door') { if (Math.abs(p.gx) % 2 === 1) yaw += Math.PI / 2; }
  else if (p.type === 'stairs') yaw += (p.rot || 0) * Math.PI / 2;
  return { x: b.x + dx, y: b.y + p.level * LEVEL_H, z: b.z + dz, yaw };
}

// Collision boxes in piece-local frame: [cx, cy, cz, hx, hy, hz]
export function pieceBoxes(type, open = false) {
  switch (type) {
    case 'foundation': return [[0, -1.5, 0, 1.5, 1.5, 1.5]];
    case 'floor': return [[0, -0.1, 0, 1.5, 0.1, 1.5]];
    case 'roof': return [[0, -0.1, 0, 1.5, 0.1, 1.5], [0, 0.35, 0, 0.9, 0.35, 0.9]];
    case 'wall': return [[0, 1.5, 0, 1.5, 1.5, 0.1]];
    case 'half_wall': return [[0, 0.6, 0, 1.5, 0.6, 0.1]];
    case 'doorway': return [[-1.05, 1.5, 0, 0.45, 1.5, 0.1], [1.05, 1.5, 0, 0.45, 1.5, 0.1], [0, 2.6, 0, 0.6, 0.4, 0.1]];
    case 'window': return [[-1.05, 1.5, 0, 0.45, 1.5, 0.1], [1.05, 1.5, 0, 0.45, 1.5, 0.1], [0, 0.5, 0, 0.6, 0.5, 0.1], [0, 2.5, 0, 0.6, 0.5, 0.1]];
    case 'stairs': {
      const out = [];
      for (let k = 0; k < 6; k++) { const h = (k + 1) * 0.5; out.push([0, h / 2, -1.25 + k * 0.5, 1.5, h / 2, 0.25]); }
      return out;
    }
    case 'door': return open ? [] : [[0, 1.1, 0, 0.6, 1.1, 0.06]];
    // deployables
    case 'workbench1': case 'workbench2': case 'workbench3': return [[0, 0.45, 0, 1.0, 0.45, 0.5]];
    case 'gunsmith': return [[0, 0.47, 0, 1.05, 0.47, 0.5]];
    case 'small_box': return [[0, 0.3, 0, 0.45, 0.3, 0.3]];
    case 'large_box': return [[0, 0.4, 0, 0.75, 0.4, 0.45]];
    case 'furnace': return [[0, 0.7, 0, 0.6, 0.7, 0.6]];
    case 'tool_cupboard': return [[0, 0.9, 0, 0.45, 0.9, 0.3]];
    // furniture
    case 'chair': return [[0, 0.25, 0, 0.26, 0.25, 0.26]];
    case 'table': return [[0, 0.4, 0, 0.75, 0.4, 0.45]];
    case 'bed': return [[0, 0.25, 0, 0.55, 0.25, 1.05]];
    case 'sofa': return [[0, 0.3, 0, 0.95, 0.3, 0.42]];
    case 'bookshelf': return [[0, 0.95, 0, 0.6, 0.95, 0.2]];
    case 'wardrobe': return [[0, 1.0, 0, 0.55, 1.0, 0.32]];
    case 'fridge': return [[0, 0.9, 0, 0.38, 0.9, 0.36]];
    case 'loot_crate': return [[0, 0.4, 0, 0.7, 0.4, 0.45]];
    default: return [];
  }
}

export function isEdge(gx, gz) { return (Math.abs(gx) % 2) + (Math.abs(gz) % 2) === 1; }
export function isCell(gx, gz) { return Math.abs(gx) % 2 === 0 && Math.abs(gz) % 2 === 0; }
export function slotKey(gx, gz, level, cls) { return `${cls}:${gx}:${gz}:${level}`; }

// Cells adjacent to an edge
export function edgeCells(gx, gz) {
  if (Math.abs(gx) % 2 === 1) return [[gx - 1, gz], [gx + 1, gz]];
  return [[gx, gz - 1], [gx, gz + 1]];
}
// Edges around a cell
export function cellEdges(gx, gz) { return [[gx + 1, gz], [gx - 1, gz], [gx, gz + 1], [gx, gz - 1]]; }

// Can a piece of `type` be placed at (gx,gz,level) given the slot index? Returns null if ok, else reason.
export function canPlace(type, gx, gz, level, idx, isFirst) {
  const def = PIECES[type];
  if (!def) return 'Unknown piece';
  if (def.slot === 'cell' && !isCell(gx, gz)) return 'Bad slot';
  if (def.slot === 'edge' && !isEdge(gx, gz)) return 'Bad slot';
  const key = slotKey(gx, gz, level, type === 'stairs' ? 'stairs' : def.slot);
  if (idx.has(key)) return 'Occupied';
  if (level < 0 || level > 8) return 'Too high';
  if (type === 'foundation') {
    if (level !== 0) return 'Foundations go on the ground';
    if (isFirst) return null;
    // must neighbour another foundation
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (idx.get(slotKey(gx + dx, gz + dz, 0, 'cell'))?.type === 'foundation') return null;
    return 'Must connect to a foundation';
  }
  if (type === 'floor' || type === 'roof') {
    if (level < 1) return 'Floors need walls below';
    for (const [ex, ez] of cellEdges(gx, gz)) { const w = idx.get(slotKey(ex, ez, level - 1, 'edge')); if (w && w.type !== 'half_wall') return null; }
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const f = idx.get(slotKey(gx + dx, gz + dz, level, 'cell')); if (f && (f.type === 'floor' || f.type === 'roof')) return null; }
    return 'Needs a wall or floor to support it';
  }
  if (type === 'stairs') {
    const below = idx.get(slotKey(gx, gz, level, 'cell'));
    // stairs live in their own key space so they can sit on a floor/foundation cell
    return below ? null : 'Place on a foundation or floor';
  }
  // edge pieces
  for (const [cx, cz] of edgeCells(gx, gz)) {
    const c = idx.get(slotKey(cx, cz, level, 'cell'));
    if (c && (c.type === 'foundation' || c.type === 'floor')) return null;
  }
  const below = idx.get(slotKey(gx, gz, level - 1, 'edge'));
  if (below && below.type !== 'half_wall') return null;
  return 'Needs a foundation or floor';
}

// Stairs use a separate slot class so they can coexist with the floor beneath them.
export function pieceSlotKey(p) {
  const def = PIECES[p.type];
  if (p.type === 'stairs') return slotKey(p.gx, p.gz, p.level, 'stairs');
  return slotKey(p.gx, p.gz, p.level, def.slot);
}

// Build an index that also includes stairs keys.
export function buildIndex(pieces) {
  const m = new Map();
  for (const p of pieces) if (p.type !== 'door') m.set(pieceSlotKey(p), p);
  return m;
}

export function canPlaceAny(type, gx, gz, level, idx, isFirst) {
  if (type === 'stairs') {
    if (idx.has(slotKey(gx, gz, level, 'stairs'))) return 'Occupied';
    if (idx.has(slotKey(gx, gz, level + 1, 'cell'))) return 'Blocked by floor above';
    return canPlace(type, gx, gz, level, idx, isFirst);
  }
  if ((type === 'floor' || type === 'roof') && idx.has(slotKey(gx, gz, level - 1, 'stairs'))) return 'Stairs below';
  return canPlace(type, gx, gz, level, idx, isFirst);
}

// After removal, find pieces that lost support (cascading collapse).
export function unsupportedPieces(pieces) {
  let alive = pieces.filter((p) => p.type !== 'door');
  const dead = [];
  for (let iter = 0; iter < 20; iter++) {
    const idx = buildIndex(alive);
    const next = [];
    let changed = false;
    for (const p of alive) {
      if (p.type === 'foundation') { next.push(p); continue; }
      const tmp = new Map(idx); tmp.delete(pieceSlotKey(p));
      const r = canPlaceAny(p.type, p.gx, p.gz, p.level, tmp, false);
      if (r && r !== 'Blocked by floor above' && r !== 'Stairs below') { dead.push(p); changed = true; }
      else next.push(p);
    }
    alive = next;
    if (!changed) break;
  }
  return dead;
}

// Ray vs oriented (yaw-only) box. Box: center c, half extents h, yaw. Returns t or -1.
export function rayOBB(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz, yaw, maxT = 1e9) {
  const [lox, loz] = invRotY(ox - cx, oz - cz, yaw);
  const [ldx, ldz] = invRotY(dx, dz, yaw);
  const loy = oy - cy, ldy = dy;
  let tmin = 0, tmax = maxT;
  const o = [lox, loy, loz], d = [ldx, ldy, ldz], h = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < -h[i] || o[i] > h[i]) return -1; continue; }
    let t1 = (-h[i] - o[i]) / d[i], t2 = (h[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// World-space boxes for a structure record s ({x,y,z,yaw,type,open})
export function worldBoxes(s) {
  const out = [];
  for (const [cx, cy, cz, hx, hy, hz] of pieceBoxes(s.type, s.open)) {
    const [dx, dz] = rotY(cx, cz, s.yaw);
    out.push({ x: s.x + dx, y: s.y + cy, z: s.z + dz, hx, hy, hz, yaw: s.yaw });
  }
  return out;
}
