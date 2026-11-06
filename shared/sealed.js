// Watertight rooms: a room whose floor, ceiling and every wall are Watertight Steel (portholes count,
// doorways need a closed Watertight Hatch) holds air, so you can stand, breathe and stay dry inside
// it even at the bottom of the sea. Shared by the server (breath, sharks) and the client (movement, view).
import { G, LEVEL_H, TIERS, slotKey, invRotY } from './building.js';

const MAX_ROOM = 64; // cells

// pieces: [{type, tier, gx, gz, level}] of one building; doors: Map doorwayKey -> {sealed, open}
export function dryCells(pieces, doors) {
  const idx = new Map();
  for (const p of pieces) if (p.type !== 'door') idx.set(p.type === 'stairs' ? slotKey(p.gx, p.gz, p.level, 'stairs') : slotKey(p.gx, p.gz, p.level, p.type === 'foundation' || p.type === 'floor' || p.type === 'roof' ? 'cell' : 'edge'), p);
  const sealed = (p) => p && TIERS[p.tier]?.sealed;
  const floorOk = (gx, gz, L) => { const f = idx.get(slotKey(gx, gz, L, 'cell')); return sealed(f) && (L === 0 ? f.type === 'foundation' : f.type === 'floor' || f.type === 'roof' || f.type === 'foundation'); };
  const ceilOk = (gx, gz, L) => { const c = idx.get(slotKey(gx, gz, L + 1, 'cell')); return sealed(c) && (c.type === 'floor' || c.type === 'roof') && !idx.has(slotKey(gx, gz, L, 'stairs')); };
  const dry = new Set(), seen = new Set();
  for (const p of pieces) {
    if (!(p.type === 'foundation' || p.type === 'floor' || p.type === 'roof')) continue;
    const L = p.level, start = `${p.gx},${p.gz},${L}`;
    if (seen.has(start)) continue;
    // flood the room from this cell; any leak floods the whole room
    const room = [], queue = [[p.gx, p.gz]];
    let leak = false;
    const inRoom = new Set([start]);
    while (queue.length) {
      const [gx, gz] = queue.pop();
      const key = `${gx},${gz},${L}`;
      seen.add(key); room.push(key);
      if (room.length > MAX_ROOM || !floorOk(gx, gz, L) || !ceilOk(gx, gz, L)) { leak = true; break; }
      for (const [ex, ez, nx, nz] of [[gx + 1, gz, gx + 2, gz], [gx - 1, gz, gx - 2, gz], [gx, gz + 1, gx, gz + 2], [gx, gz - 1, gx, gz - 2]]) {
        const w = idx.get(slotKey(ex, ez, L, 'edge'));
        if (w) {
          if (!sealed(w) || w.type === 'half_wall') { leak = true; break; }
          if (w.type === 'doorway') { const d = doors.get(slotKey(ex, ez, L, 'edge')); if (!d || !d.sealed || d.open) { leak = true; break; } }
          continue;
        }
        const nk = `${nx},${nz},${L}`;
        if (!inRoom.has(nk)) { inRoom.add(nk); queue.push([nx, nz]); }
      }
      if (leak) break;
    }
    if (!leak) for (const k of room) dry.add(k);
    else for (const k of inRoom) seen.add(k);
  }
  return dry;
}

// the dry-room cell (if any) a point is in. b: {x, y, z, yaw}
export function cellAt(b, x, y, z) {
  const [lx, lz] = invRotY(x - b.x, z - b.z, b.yaw);
  const gx = 2 * Math.round(lx / G), gz = 2 * Math.round(lz / G), L = Math.floor((y - b.y + 0.25) / LEVEL_H);
  if (Math.abs(lx - (gx * G) / 2) > G / 2 - 0.05 || Math.abs(lz - (gz * G) / 2) > G / 2 - 0.05) return null; // inside the walls only
  return `${gx},${gz},${L}`;
}
