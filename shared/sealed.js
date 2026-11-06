// Watertight rooms: a room whose floor, ceiling and every wall are Watertight Steel (portholes count,
// doorways need a Watertight Hatch, open or shut) holds air, so you can stand, breathe and stay dry inside
// it even at the bottom of the sea. Shared by the server (breath, sharks) and the client (movement, view).
import { G, LEVEL_H, TIERS, slotKey, invRotY } from './building.js';

const MAX_ROOM = 64; // cells

// pieces: [{type, tier, gx, gz, level}] of one building; doors: Map doorwayKey -> {sealed, open}
// Returns the sealed rooms: [{key, L, cells: [cellKey], shell: [boundary pieces]}]. Like a real habitat, a Watertight
// Hatch keeps the sea out whether it's open or shut; a missing or non-watertight piece leaves the room open to the sea.
export function sealedRooms(pieces, doors) {
  const idx = new Map();
  for (const p of pieces) if (p.type !== 'door') idx.set(p.type === 'stairs' ? slotKey(p.gx, p.gz, p.level, 'stairs') : slotKey(p.gx, p.gz, p.level, p.type === 'foundation' || p.type === 'floor' || p.type === 'roof' ? 'cell' : 'edge'), p);
  const sealed = (p) => p && TIERS[p.tier]?.sealed;
  const floorOf = (gx, gz, L) => { const f = idx.get(slotKey(gx, gz, L, 'cell')); return sealed(f) && (L === 0 ? f.type === 'foundation' : f.type === 'floor' || f.type === 'roof' || f.type === 'foundation') ? f : null; };
  const ceilOf = (gx, gz, L) => { const c = idx.get(slotKey(gx, gz, L + 1, 'cell')); return sealed(c) && (c.type === 'floor' || c.type === 'roof') && !idx.has(slotKey(gx, gz, L, 'stairs')) ? c : null; };
  const rooms = [], seen = new Set();
  for (const p of pieces) {
    if (!(p.type === 'foundation' || p.type === 'floor' || p.type === 'roof')) continue;
    const L = p.level, start = `${p.gx},${p.gz},${L}`;
    if (seen.has(start)) continue;
    const cells = [], shell = new Set(), queue = [[p.gx, p.gz]], inRoom = new Set([start]);
    let leak = false;
    while (queue.length && !leak) {
      const [gx, gz] = queue.pop();
      const key = `${gx},${gz},${L}`;
      seen.add(key); cells.push(key);
      const fl = floorOf(gx, gz, L), cl = ceilOf(gx, gz, L);
      if (cells.length > MAX_ROOM || !fl || !cl) { leak = true; break; }
      shell.add(fl); shell.add(cl);
      for (const [ex, ez, nx, nz] of [[gx + 1, gz, gx + 2, gz], [gx - 1, gz, gx - 2, gz], [gx, gz + 1, gx, gz + 2], [gx, gz - 1, gx, gz - 2]]) {
        const w = idx.get(slotKey(ex, ez, L, 'edge'));
        if (w) {
          if (!sealed(w) || w.type === 'half_wall') { leak = true; break; }
          if (w.type === 'doorway') { const d = doors.get(slotKey(ex, ez, L, 'edge')); if (!d || !d.sealed) { leak = true; break; } }
          shell.add(w);
          continue;
        }
        const nk = `${nx},${nz},${L}`;
        if (!inRoom.has(nk)) { inRoom.add(nk); queue.push([nx, nz]); }
      }
    }
    for (const k of inRoom) seen.add(k);
    if (!leak) { cells.sort(); rooms.push({ key: cells[0], L, cells, shell: [...shell] }); }
  }
  return rooms;
}
export function dryCells(pieces, doors) {
  const dry = new Set();
  for (const r of sealedRooms(pieces, doors)) for (const k of r.cells) dry.add(k);
  return dry;
}

// ---- hull integrity (how a habitat holds up against the pressure). Starts at 10; foundations and reinforcement frames
// add strength, every wall, floor and especially portholes take some away, and those losses grow with depth.
// Below 0 the hull starts to spring leaks.
export const HULL_BASE = 10, HULL_REINFORCEMENT = 6;
export const HULL_PIECE = { foundation: 1.2, floor: -0.5, roof: -0.5, wall: -0.6, window: -1.5, doorway: -0.8, half_wall: 0, stairs: 0 };
export function hullIntegrity(pieces, depth, reinforcements = 0) {
  let pos = HULL_BASE + reinforcements * HULL_REINFORCEMENT, neg = 0;
  for (const p of pieces) { if (!TIERS[p.tier]?.sealed) continue; const v = HULL_PIECE[p.type] || 0; if (v > 0) pos += v; else neg += v; }
  return pos + neg * (1 + Math.max(0, depth) / 40);
}
export function roomOfCell(rooms, cell) { for (const r of rooms) if (r.cells.includes(cell)) return r; return null; }

// the dry-room cell (if any) a point is in. b: {x, y, z, yaw}
export function cellAt(b, x, y, z) {
  const [lx, lz] = invRotY(x - b.x, z - b.z, b.yaw);
  const gx = 2 * Math.round(lx / G), gz = 2 * Math.round(lz / G), L = Math.floor((y - b.y + 0.25) / LEVEL_H);
  if (Math.abs(lx - (gx * G) / 2) > G / 2 - 0.05 || Math.abs(lz - (gz * G) / 2) > G / 2 - 0.05) return null; // inside the walls only
  return `${gx},${gz},${L}`;
}
