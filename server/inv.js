// Inventory helpers operating on arrays of stacks ({id, n, a?} | null) laid out as Tetris-style grids
// (see shared/grid.js). Arrays can carry a non-serialised `spec` property (player inventories do).
import { ITEMS, itemMaxStack, newStack } from '../shared/items.js';
import { specOf, canPlace, findSpot, occupancy, footprint, sizeOf, isValid } from '../shared/grid.js';

export function count(slots, id) {
  let n = 0;
  for (const s of slots) if (s && s.id === id) n += s.n;
  return n;
}

export function hasAll(slots, cost, mul = 1) {
  for (const k in cost) if (count(slots, k) < cost[k] * mul) return false;
  return true;
}

export function remove(slots, id, n) {
  for (let i = slots.length - 1; i >= 0 && n > 0; i--) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(n, s.n);
    s.n -= take; n -= take;
    if (s.n <= 0) slots[i] = null;
  }
  return n <= 0;
}

export function removeAll(slots, cost, mul = 1) {
  for (const k in cost) remove(slots, k, cost[k] * mul);
}

// Adds n of id; returns leftover count that did not fit.
export function add(slots, id, n, preferHotbar = false, template = null) {
  if (!ITEMS[id]) return 0;
  const max = itemMaxStack(id);
  if (max > 1) {
    for (const s of slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < max) { const t = Math.min(max - s.n, n); s.n += t; n -= t; }
    }
  }
  const spec = specOf(slots);
  const preferQuick = spec.start > 0 && (preferHotbar || ITEMS[id].cat === 'tool' || ITEMS[id].cat === 'weapon');
  while (n > 0) {
    const a = findSpot(slots, id, { preferQuick }, spec);
    if (a < 0) break;
    const t = Math.min(max, n);
    slots[a] = template ? { ...template, n: t } : newStack(id, t);
    n -= t;
  }
  return n;
}

export function addStack(slots, stack) {
  return add(slots, stack.id, stack.n, false, stack);
}

export function emptySlots(n) { return new Array(n).fill(null); }

export function isEmpty(slots) { return slots.every((s) => !s); }

// Does a stack fit somewhere (merging or a free spot)? Doesn't modify slots.
export function fits(slots, id, n = 1) {
  const probe = slots.map((x) => (x ? { ...x } : null));
  probe.spec = slots.spec;
  return add(probe, id, n) <= 0;
}

// Move (part of) the stack at A[ai] so its anchor lands on B[bi]. Merges same items,
// swaps with a single overlapped item when both fit. Returns true when something changed.
export function move(A, ai, B, bi, amount) {
  const src = A[ai];
  if (!src || bi < 0 || bi >= B.length) return false;
  if (A === B && ai === bi) return false;
  amount = Math.max(1, Math.min(src.n, amount ?? src.n));
  const specB = specOf(B), occB = occupancy(B, specB);
  const max = itemMaxStack(src.id);
  // merge into a stack of the same item under the cursor
  const under = occB[bi];
  if (under !== -1 && !(A === B && under === ai) && B[under].id === src.id && max > 1) {
    const dst = B[under];
    const t = Math.min(max - dst.n, amount);
    if (t <= 0) return false;
    dst.n += t; src.n -= t;
    if (src.n <= 0) A[ai] = null;
    return true;
  }
  const ignore = A === B ? [ai] : [];
  if (amount < src.n) {
    // split: only into free space
    if (!canPlace(B, bi, src.id, [], specB, occB)) return false;
    B[bi] = { ...src, n: amount }; src.n -= amount;
    return true;
  }
  if (canPlace(B, bi, src.id, ignore, specB, occB)) {
    A[ai] = null; B[bi] = src;
    return true;
  }
  // swap with exactly one overlapped item
  const [w, h] = sizeOf(src.id, bi < specB.start);
  const cells = footprint(B.length, specB, bi, w, h);
  if (!cells) return false;
  const hit = new Set();
  for (const c of cells) if (occB[c] !== -1 && !ignore.includes(occB[c])) hit.add(occB[c]);
  if (hit.size !== 1) return false;
  const t = [...hit][0], dst = B[t];
  A[ai] = null; B[t] = null;
  if (canPlace(B, bi, src.id)) {
    B[bi] = src;
    if (canPlace(A, ai, dst.id)) { A[ai] = dst; return true; }
    B[bi] = null;
  }
  A[ai] = src; B[t] = dst; // revert
  return false;
}

// Pack loose stacks into a new grid (bags, corpses), growing it until everything fits.
export function pack(stacks, minLen = 12, cols = 6) {
  const list = stacks.filter(Boolean);
  let area = 0;
  for (const s of list) { const [w, h] = sizeOf(s.id); area += w * h; }
  let len = Math.max(minLen, Math.ceil((area * 1.25) / cols) * cols);
  for (let tries = 0; tries < 40; tries++, len += cols) {
    const slots = emptySlots(len);
    // biggest first packs tighter
    const sorted = [...list].sort((a, b) => sizeOf(b.id)[0] * sizeOf(b.id)[1] - sizeOf(a.id)[0] * sizeOf(a.id)[1]);
    if (sorted.every((s) => addStack(slots, { ...s }) <= 0)) return slots;
  }
  return emptySlots(minLen);
}

// Repair a layout from an old save (items used to be 1 cell each). Keeps quick slots, re-places
// grid items (allowing locked rows) and returns stacks that couldn't fit.
export function normalize(slots, { grow = false } = {}) {
  const spec = specOf(slots);
  if (isValid(slots, spec)) return [];
  const loose = [];
  for (let a = spec.start; a < slots.length; a++) if (slots[a]) { loose.push(slots[a]); slots[a] = null; }
  loose.sort((a, b) => sizeOf(b.id)[0] * sizeOf(b.id)[1] - sizeOf(a.id)[0] * sizeOf(a.id)[1]);
  const open = { ...spec, rows: Math.ceil((slots.length - spec.start) / spec.cols) };
  const out = [];
  for (const s of loose) {
    let a = findSpot(slots, s.id, { quick: false }, open);
    while (a < 0 && grow && slots.length < 600) { for (let i = 0; i < spec.cols; i++) slots.push(null); open.rows++; a = findSpot(slots, s.id, { quick: false }, open); }
    if (a < 0) out.push(s); else slots[a] = s;
  }
  return out;
}
