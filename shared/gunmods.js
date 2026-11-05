// Weapon attachments & finishes (shared by server for validation/stats and client for UI/visuals).
// Guns come bare; attachments are crafted at the Gunsmith Bench and fitted there.
import { ITEMS } from './items.js';

export const MOD_SLOTS = ['optic', 'muzzle', 'barrel', 'under', 'mag', 'stock'];
export const SLOT_NAMES = { optic: 'Optic', muzzle: 'Muzzle', barrel: 'Barrel', under: 'Underbarrel', mag: 'Magazine', stock: 'Stock', finish: 'Finish' };

// stat multipliers: dmg, rate, range, spread (all), spreadHip, spreadAds, recoil, recoilCrouch, mag, reload; zoom = ADS FOV factor
export const MODS = {
  red_dot: { slot: 'optic', name: 'Red Dot Sight', desc: 'Clear sight picture, slight zoom', zoom: 0.68, spreadAds: 0.85 },
  holo: { slot: 'optic', name: 'Holographic Sight', desc: 'Wide window, faster aim', zoom: 0.62, spreadAds: 0.8 },
  scope4: { slot: 'optic', name: '4x Scope', desc: 'Medium range magnified optic', zoom: 0.32, scope: true, spreadAds: 0.6 },
  scope8: { slot: 'optic', name: '8x Sniper Scope', desc: 'Long range, heavy', zoom: 0.16, scope: true, spreadAds: 0.45 },
  suppressor: { slot: 'muzzle', name: 'Suppressor', desc: 'Quiet shots, no muzzle flash, hidden on the map of sound', quiet: true, dmg: 0.92, range: 0.92 },
  muzzle_brake: { slot: 'muzzle', name: 'Muzzle Brake', desc: 'Much less recoil', recoil: 0.65 },
  compensator: { slot: 'muzzle', name: 'Compensator', desc: 'Less recoil and spread', recoil: 0.8, spread: 0.88 },
  long_barrel: { slot: 'barrel', name: 'Long Barrel', desc: 'More range and damage, slightly slower', range: 1.35, dmg: 1.1, spread: 0.85, rate: 0.94 },
  heavy_barrel: { slot: 'barrel', name: 'Heavy Fluted Barrel', desc: 'Very accurate, a bit slower', spread: 0.7, recoil: 0.9, rate: 0.92 },
  vertical_grip: { slot: 'under', name: 'Vertical Grip', desc: 'Less recoil', recoil: 0.75 },
  angled_grip: { slot: 'under', name: 'Angled Grip', desc: 'Less recoil and spread', recoil: 0.85, spread: 0.88 },
  laser: { slot: 'under', name: 'Laser Sight', desc: 'Far better hip-fire accuracy', spreadHip: 0.55, laser: true },
  flashlight: { slot: 'under', name: 'Weapon Light', desc: 'Lights up the dark (and caves)', light: true },
  bipod: { slot: 'under', name: 'Bipod', desc: 'Huge recoil reduction while crouched', recoilCrouch: 0.4 },
  ext_mag: { slot: 'mag', name: 'Extended Magazine', desc: '+50% rounds, slower reload', mag: 1.5, reload: 1.15 },
  drum_mag: { slot: 'mag', name: 'Drum Magazine', desc: '+150% rounds, much slower reload', mag: 2.5, reload: 1.45, spread: 1.05 },
  fast_mag: { slot: 'mag', name: 'Quick-Pull Magazine', desc: '30% faster reloads', reload: 0.7 },
  tac_stock: { slot: 'stock', name: 'Tactical Stock', desc: 'Steadier aim', recoil: 0.85, spread: 0.9 },
};
export const FINISHES = [
  { id: 'factory', name: 'Factory' },
  { id: 'black', name: 'Stealth Black', poly: 0x1c1d1f, tan: 0x1c1d1f },
  { id: 'desert', name: 'Desert Tan', poly: 0x9a8258, tan: 0x9a8258, olive: 0x9a8258 },
  { id: 'olive', name: 'Olive Drab', poly: 0x4e5636, tan: 0x4e5636 },
  { id: 'arctic', name: 'Arctic White', poly: 0xd8dcdc, tan: 0xd8dcdc, olive: 0xd8dcdc },
  { id: 'crimson', name: 'Crimson', poly: 0x8a1a16, tan: 0x8a1a16, olive: 0x8a1a16 },
  { id: 'cobalt', name: 'Cobalt', poly: 0x1e3a7a, tan: 0x1e3a7a, olive: 0x1e3a7a },
  { id: 'chrome', name: 'Chrome', metal: 0xc9ced3 },
  { id: 'gold', name: 'Gold', metal: 0xc9a040, poly: 0x1c1d1f, tan: 0x1c1d1f },
];
// which attachments each weapon accepts
export const GUN_SLOTS = {
  pistol: { optic: ['red_dot'], muzzle: ['suppressor', 'compensator'], under: ['laser', 'flashlight'], mag: ['ext_mag', 'fast_mag'] },
  revolver: { optic: ['red_dot'], barrel: ['long_barrel'], under: ['laser', 'flashlight'] },
  smg: { optic: ['red_dot', 'holo'], muzzle: ['suppressor', 'compensator', 'muzzle_brake'], barrel: ['long_barrel'], under: ['vertical_grip', 'angled_grip', 'laser', 'flashlight'], mag: ['ext_mag', 'drum_mag', 'fast_mag'], stock: ['tac_stock'] },
  rifle: { optic: ['red_dot', 'holo', 'scope4'], muzzle: ['suppressor', 'muzzle_brake', 'compensator'], barrel: ['long_barrel', 'heavy_barrel'], under: ['vertical_grip', 'angled_grip', 'laser', 'flashlight', 'bipod'], mag: ['ext_mag', 'drum_mag', 'fast_mag'], stock: ['tac_stock'] },
  shotgun: { optic: ['red_dot', 'holo'], muzzle: ['muzzle_brake'], barrel: ['long_barrel'], under: ['flashlight', 'laser'], mag: ['ext_mag'], stock: ['tac_stock'] },
  double_barrel: { barrel: ['long_barrel'] },
  bolt_rifle: { optic: ['red_dot', 'scope4', 'scope8'], muzzle: ['suppressor', 'muzzle_brake'], barrel: ['long_barrel', 'heavy_barrel'], under: ['bipod'], mag: ['ext_mag', 'fast_mag'] },
  lmg: { optic: ['red_dot', 'holo', 'scope4'], muzzle: ['muzzle_brake', 'compensator'], barrel: ['heavy_barrel'], under: ['bipod', 'vertical_grip'], mag: ['drum_mag', 'fast_mag'] },
  crossbow: { optic: ['red_dot', 'scope4'] },
  bow: {},
  rocket_launcher: { optic: ['scope4'] },
};
export function canMod(gunId, slot, mod) { return !!GUN_SLOTS[gunId]?.[slot]?.includes(mod); }
export function isModdable(gunId) { return !!GUN_SLOTS[gunId]; }

// Effective weapon stats after attachments.
export function gunStats(stack) {
  const base = ITEMS[stack?.id]?.gun;
  if (!base) return null;
  const g = { ...base, spreadHip: 1, spreadAds: 1, recoilCrouch: 1 };
  const mods = stack.mods || {};
  for (const slot of MOD_SLOTS) {
    const m = MODS[mods[slot]];
    if (!m || !canMod(stack.id, slot, mods[slot])) continue;
    for (const k of ['dmg', 'rate', 'range', 'spread', 'recoil', 'reload']) if (m[k]) g[k] *= m[k];
    for (const k of ['spreadHip', 'spreadAds', 'recoilCrouch']) if (m[k]) g[k] *= m[k];
    if (m.mag) g.mag = Math.max(g.mag + 1, Math.round(g.mag * m.mag));
    if (m.zoom) g.zoom = m.zoom;
    if (m.scope) g.scope = true;
    if (m.quiet) g.quiet = true;
    if (m.light) g.light = true;
    if (m.laser) g.laser = true;
  }
  return g;
}
export function modsKey(mods) {
  if (!mods) return '';
  return MOD_SLOTS.map((s) => mods[s] || '').join('.') + '.' + (mods.finish || '');
}
export function parseModsKey(k) {
  if (!k) return null;
  const p = k.split('.'), out = {};
  MOD_SLOTS.forEach((s, i) => { if (p[i]) out[s] = p[i]; });
  if (p[MOD_SLOTS.length]) out.finish = p[MOD_SLOTS.length];
  return out;
}
