// Tetris-style inventory grids, shared by the server (authoritative) and the client (previews).
//
// A container is a flat array of slots. A stack lives at its *anchor* cell (its top-left corner)
// and covers itemSize(id) = [w, h] cells to the right and below; the covered cells stay null.
// spec = { cols, start, rows }:
//   - cells before `start` are single "quick slots" that hold any item regardless of size
//   - cells from `start` on form a grid `cols` wide; only the first `rows` rows accept new items
//     (rows past that are locked — items already there can still be taken out)
import { itemSize, GRID_COLS, HOTBAR, INV_SIZE, BASE_ROWS, MAX_ROWS } from './items.js';

export function defaultSpec(len) { return { cols: GRID_COLS, start: 0, rows: Math.ceil(len / GRID_COLS) }; }
export function playerSpec(bagRows) { return { cols: GRID_COLS, start: HOTBAR, rows: Math.min(MAX_ROWS, BASE_ROWS + (bagRows || 0)) }; }
export function specOf(slots) { return slots.spec || (slots.length === INV_SIZE ? playerSpec(0) : defaultSpec(slots.length)); }

export function sizeOf(id, quick) { return quick ? [1, 1] : itemSize(id); }

// Cells covered by an item of size [w,h] anchored at `a`, or null if it sticks out of the grid.
export function footprint(len, spec, a, w, h) {
  if (a < 0 || a >= len) return null;
  if (a < spec.start) return [a];
  const k = a - spec.start, c = k % spec.cols, r = Math.floor(k / spec.cols);
  if (c + w > spec.cols) return null;
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = spec.start + (r + y) * spec.cols + c + x;
    if (i >= len) return null;
    out.push(i);
  }
  return out;
}
export function rowOf(spec, a) { return a < spec.start ? -1 : Math.floor((a - spec.start) / spec.cols); }

// cell -> anchor index covering it (or -1)
export function occupancy(slots, spec = specOf(slots)) {
  const occ = new Int32Array(slots.length).fill(-1);
  for (let a = 0; a < slots.length; a++) {
    const s = slots[a];
    if (!s) continue;
    const [w, h] = sizeOf(s.id, a < spec.start);
    const cells = footprint(slots.length, spec, a, w, h) || [a];
    for (const i of cells) if (occ[i] === -1) occ[i] = a;
  }
  return occ;
}

// Can an item with `id` be anchored at `a`? `ignore` = anchors to treat as empty (the item being moved).
export function canPlace(slots, a, id, ignore = [], spec = specOf(slots), occ = occupancy(slots, spec)) {
  const quick = a < spec.start;
  const [w, h] = sizeOf(id, quick);
  const cells = footprint(slots.length, spec, a, w, h);
  if (!cells) return false;
  if (!quick && rowOf(spec, a) + h > spec.rows) return false; // locked rows
  for (const i of cells) if (occ[i] !== -1 && !ignore.includes(occ[i])) return false;
  return true;
}

// First anchor where `id` fits, scanning the grid row by row (and the quick slots last unless preferQuick).
export function findSpot(slots, id, { preferQuick = false, quick = true, ignore = [] } = {}, spec = specOf(slots)) {
  const occ = occupancy(slots, spec);
  const grid = [], qs = [];
  for (let a = spec.start; a < slots.length; a++) grid.push(a);
  if (quick) for (let a = 0; a < spec.start; a++) qs.push(a);
  for (const a of preferQuick ? [...qs, ...grid] : [...grid, ...qs]) if (canPlace(slots, a, id, ignore, spec, occ)) return a;
  return -1;
}

// Are the anchors valid (no overlaps, nothing out of bounds)? Used to migrate old saves.
export function isValid(slots, spec = specOf(slots)) {
  const seen = new Int32Array(slots.length).fill(-1);
  for (let a = 0; a < slots.length; a++) {
    const s = slots[a];
    if (!s) continue;
    const [w, h] = sizeOf(s.id, a < spec.start);
    const cells = footprint(slots.length, spec, a, w, h);
    if (!cells) return false;
    for (const i of cells) { if (seen[i] !== -1) return false; seen[i] = a; }
  }
  return true;
}
