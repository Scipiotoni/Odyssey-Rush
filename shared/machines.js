// Base machines: refiners and the power grid.
// - Portable Refiner: place it anywhere, it burns Low Grade Fuel / Batteries / Power Cells from its own storage.
// - Base machines (mount 'wall': fixed to a wall of your base · 'base': on a floor, roof or the ground right by it)
//   share one power grid per building: Solar Panels and Fuel Generators make power, Battery Banks store the surplus,
//   Refinery / Salt Water Refiner / Charging Station / Electric Wall Light use it. No power, no work.
// Refining: whatever recipe's inputs are in the machine's storage gets processed; outputs land in the same storage.

export const MACHINES = {
  portable_refiner: { name: 'Portable Refiner', portable: true, refine: 'portable', speed: 1, burn: { fuel: 30, battery: 90, power_cell: 420 } },
  refinery: { name: 'Refinery', mount: 'wall', refine: 'base', speed: 2.2, draw: 60 },
  desalinator: { name: 'Salt Water Refiner', mount: 'wall', refine: 'salt', speed: 1.6, draw: 40, pump: true },
  solar_panel: { name: 'Solar Panel', mount: 'base', gen: 50, solar: true },
  fuel_generator: { name: 'Fuel Generator', mount: 'base', gen: 150, burn: { fuel: 45 } },
  battery_bank: { name: 'Battery Bank', mount: 'wall', store: 400000 }, // W·s (≈ 110 Wh)
  charger: { name: 'Charging Station', mount: 'wall', draw: 25, charge: true },
  wall_light: { name: 'Electric Wall Light', mount: 'wall', draw: 5, light: true },
};

// at: which refiners can do it ('portable' | 'base' (Refinery) | 'salt' (Salt Water Refiner)); default portable + base
export const REFINE = [
  { in: { salt_water: 1 }, out: { water_bottle: 1, salt: 1 }, time: 8, at: ['portable', 'base', 'salt'] },
  { in: { metal_ore: 10 }, out: { metal_frags: 10 }, time: 6 },
  { in: { sulfur_ore: 10 }, out: { sulfur: 10 }, time: 6 },
  { in: { copper_ore: 5 }, out: { copper: 3 }, time: 7 },
  { in: { lithium_ore: 5 }, out: { lithium: 2 }, time: 8 },
  { in: { titanium_ore: 5 }, out: { titanium: 1 }, time: 9, at: ['base'] },
  { in: { quartz: 2 }, out: { glass: 1 }, time: 8 },
  { in: { wood: 10 }, out: { charcoal: 6 }, time: 5 },
  { in: { animal_fat: 3, cloth: 1 }, out: { fuel: 4 }, time: 6 },
  { in: { scrap: 5 }, out: { metal_frags: 15 }, time: 6, at: ['base'] },
];
// the Salt Water Refiner's pump, when the base stands by or in the water (sea: water + salt · lakes and rivers: water)
export const PUMP = { time: 10 };
export const refinesAt = (r, kind) => (r.at || ['portable', 'base']).includes(kind);

// handheld flashlight: charge in %, drains while switched on
export const FLASH = { drain: 100 / (15 * 60), battery: 50, power_cell: 100, start: 50 };

// daylight 0..1 for solar panels (same curve as the client's sky)
export function sunFactor(day) {
  const sy = Math.sin((day - 0.25) * Math.PI * 2);
  return Math.max(0, Math.min(1, (sy + 0.12) / 0.4));
}
