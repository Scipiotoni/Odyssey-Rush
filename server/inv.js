// Inventory helpers operating on arrays of stacks ({id, n, a?} | null)
import { ITEMS, itemMaxStack, newStack } from '../shared/items.js';

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
  const order = [];
  if (preferHotbar || slots.length !== 30 || ITEMS[id].cat === 'tool' || ITEMS[id].cat === 'weapon') for (let i = 0; i < slots.length; i++) order.push(i);
  else { for (let i = 6; i < slots.length; i++) order.push(i); for (let i = 0; i < Math.min(6, slots.length); i++) order.push(i); }
  for (const i of order) {
    if (n <= 0) break;
    if (!slots[i]) {
      const t = Math.min(max, n);
      slots[i] = template ? { ...template, n: t } : newStack(id, t);
      n -= t;
    }
  }
  return n;
}

export function addStack(slots, stack) {
  return add(slots, stack.id, stack.n, false, stack);
}

export function emptySlots(n) { return new Array(n).fill(null); }

export function isEmpty(slots) { return slots.every((s) => !s); }
