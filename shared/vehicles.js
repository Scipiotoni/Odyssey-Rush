// Vehicle type definitions shared by client (physics/rendering) and server (repair/health).
// Suspension is derived so every vehicle sits at ~35% compression at rest.

function vehicle(v) {
  const { mass, rest, wheelR, half, track, axles, arch, steerFront = true, awd = true } = v;
  const k = (mass * 9.81) / (axles.length * 2) / (0.35 * rest);
  const c = 2 * 0.42 * Math.sqrt((k * mass) / (axles.length * 2));
  const wy = -half[1] + arch * wheelR + 0.65 * rest; // wheel mount height so the wheel sits in its arch
  v.spring = Math.round(k);
  v.damper = Math.round(c);
  v.wheels = [];
  axles.forEach((z, i) => {
    const steer = i === 0 && steerFront ? 1 : 0, drive = awd || i > 0 ? 1 : 0;
    v.wheels.push([-track, wy, z, steer, drive], [track, wy, z, steer, drive]);
  });
  return v;
}

export const VEHICLES = {
  quad: vehicle({
    name: 'ATV', mass: 340, hp: 300, fuelCap: 60, fuelUse: 0.05,
    half: [0.6, 0.38, 1.0], com: [0, -0.15, 0], track: 0.6, axles: [0.72, -0.72], arch: 0.2, awd: false,
    wheelR: 0.34, rest: 0.4, engine: 2400, maxSpeed: 23, steer: 0.62, brake: 3400, offroad: 1.15,
    seats: [[0, 0.05, -0.15]], color: 0x4f6f34, style: 'atv', service: [0, 0.42, 0.42], cells: 1,
    repair: { wheel: 2, engine_parts: 1, scrap: 20 },
  }),
  // ---- 4x4 jeeps: boxy body, long-travel soft suspension, big tyres, all-wheel drive, offroad grip
  buggy: vehicle({
    name: 'Scout 4x4', mass: 1550, hp: 750, fuelCap: 80, fuelUse: 0.08,
    half: [0.92, 0.82, 1.95], com: [0, -0.4, 0], track: 0.8, axles: [1.22, -1.18], arch: 0.42,
    wheelR: 0.43, rest: 0.6, engine: 9200, maxSpeed: 31, steer: 0.6, brake: 15000, offroad: 1.3,
    seats: [[-0.4, -0.05, -0.05], [0.4, -0.05, -0.05], [-0.38, 0.0, -1.0], [0.38, 0.0, -1.0]], color: 0x5a6a3a, style: 'jeep2', service: [-0.95, 0.25, -1.35], cells: 2,
    repair: { wheel: 3, engine_parts: 1, scrap: 40, metal_frags: 60 },
  }),
  suv: vehicle({
    name: 'Scout 4x4 Long', mass: 1800, hp: 900, fuelCap: 100, fuelUse: 0.1,
    half: [0.92, 0.82, 2.35], com: [0, -0.4, 0.05], track: 0.8, axles: [1.5, -1.42], arch: 0.42,
    wheelR: 0.43, rest: 0.6, engine: 10400, maxSpeed: 30, steer: 0.56, brake: 17000, offroad: 1.3,
    seats: [[-0.4, -0.05, 0.25], [0.4, -0.05, 0.25], [-0.38, 0.0, -0.75], [0.38, 0.0, -0.75]], color: 0x8a2a22, style: 'jeep4', service: [-0.95, 0.25, -1.75], cells: 2,
    repair: { wheel: 4, engine_parts: 2, scrap: 60, metal_frags: 120 },
  }),
  truck: vehicle({
    name: 'Scout 4x4 Pickup', mass: 2050, hp: 1050, fuelCap: 120, fuelUse: 0.12,
    half: [0.95, 0.82, 2.75], com: [0, -0.4, 0.3], track: 0.82, axles: [1.82, -1.7], arch: 0.42,
    wheelR: 0.45, rest: 0.62, engine: 12000, maxSpeed: 29, steer: 0.52, brake: 19000, offroad: 1.3,
    seats: [[-0.4, -0.05, 0.6], [0.4, -0.05, 0.6], [-0.38, 0.0, -0.35], [0.38, 0.0, -0.35]], color: 0x2a4a6a, style: 'jeepPickup', service: [-0.98, 0.25, -0.55], cells: 2,
    repair: { wheel: 4, engine_parts: 2, scrap: 75, metal_frags: 150 },
  }),
  // ---- big futuristic 6-wheel hauler with a buildable deck (mobile base)
  hauler: vehicle({
    name: 'Atlas Hauler', mass: 7200, hp: 3500, fuelCap: 300, fuelUse: 0.25,
    half: [1.55, 1.05, 7.0], com: [0, -0.6, -0.8], track: 1.38, axles: [4.9, -2.7, -4.7], arch: 0.5,
    wheelR: 0.78, rest: 0.7, engine: 42000, maxSpeed: 23, steer: 0.42, brake: 70000, offroad: 1.2,
    seats: [[-0.65, 0.95, 5.6], [0.65, 0.95, 5.6]], color: 0x2c3138, style: 'hauler', service: [-1.58, 0.1, 3.3], cells: 4,
    // local deck: building grid origin (centre cell), cells along z, top surface at y
    deck: { x: 0, y: 0.12, z: -2.4, cells: [-2, 0, 2], levels: 2 },
    repair: { wheel: 6, engine_parts: 3, scrap: 200, hqm: 25, gears: 4 },
  }),
  // ---- boats (no wheels: floating hull physics in public/js/boats.js). y of the centre floats at `float`.
  rowboat: {
    name: 'Rowboat', boat: true, mass: 260, hp: 350, fuelCap: 0, fuelUse: 0, wheels: [],
    half: [0.75, 0.35, 2.1], com: [0, -0.15, 0], float: 0.12, thrust: 900, maxSpeed: 4.2, turn: 0.9, drag: 1.4,
    seats: [[0, -0.05, -0.15], [0, -0.05, -1.35]], color: 0x7a5232, style: 'rowboat',
    repair: { wood: 200, rope: 1 },
  },
  motorboat: {
    name: 'Skiff Motorboat', boat: true, mass: 620, hp: 700, fuelCap: 60, fuelUse: 0.06, wheels: [],
    half: [1.0, 0.45, 2.9], com: [0, -0.2, -0.3], float: 0.18, thrust: 5200, maxSpeed: 15, turn: 1.1, drag: 1.1,
    seats: [[0.35, 0.02, -1.9], [-0.4, 0.02, -0.4], [0.4, 0.02, -0.4], [0, 0.02, 0.9]], color: 0xe8e8e0, style: 'motorboat', service: [0, 0.55, -2.75], cells: 1,
    repair: { metal_frags: 120, engine_parts: 1, scrap: 30 },
  },
  // ---- submarines (battery powered, 3D physics in public/js/subs.js). depths: crush depth with no / MK1 / MK2 / MK3 depth module
  minisub: {
    name: 'Mini Sub', sub: true, power: true, mass: 900, hp: 600, fuelCap: 100, fuelUse: 0.35, wheels: [],
    half: [0.95, 0.85, 1.8], com: [0, 0, 0], thrust: 4300, maxSpeed: 11, turn: 1.25, vert: 0.55,
    depths: [60, 130, 220, 320], moduleSlots: 2,
    seats: [[0, -0.35, 0.25]], color: 0xe8c43a, style: 'minisub', service: [0, 0.8, -0.95], cells: 2,
    repair: { scrap: 40, titanium: 4, metal_frags: 150 },
  },
  // the Pacific (id kept as 'cyclops' for old saves): a big walk-in sub, 37 m long and 8 m wide inside. Bridge under the
  // bow dome; a long empty hall you fit out yourself (place lockers, boxes, benches anywhere; build on the marked deck);
  // an enclosed vehicle bay on the port side that a Mini Sub docks into from below; the engine room with the upgrade
  // console and the power cell rack at the stern. You get in and out through a hatch in the floor.
  cyclops: {
    name: 'Pacific', sub: true, power: true, big: true, mass: 60000, hp: 6500, fuelCap: 720, fuelUse: 1.1, wheels: [],
    half: [4.3, 3.5, 18.5], com: [0, 0, 0], thrust: 165000, maxSpeed: 7, turn: 0.26, vert: 0.4,
    depths: [120, 200, 290, 400], moduleSlots: 4, cells: 6,
    seats: [[0, -1.7, 14.7]], color: 0xdcdcd6, style: 'cyclops',
    interior: { hx: 3.9, y0: -2.2, y1: 1.9, hz: 16.8 },
    // [cx, cy, cz, hx, hy, hz, role]: hull shell, two bulkheads with doors, then the things you use
    boxes: [[0, -2.5, 0, 4.1, 0.3, 17.0], [0, 2.15, 0, 4.1, 0.25, 17.0], [4.0, -0.15, 0, 0.1, 2.05, 17.0], [-4.0, -0.15, 0, 0.1, 2.05, 17.0],
      [0, -0.15, 16.95, 4.1, 2.05, 0.1], [0, -0.15, -16.95, 4.1, 2.05, 0.1],
      [2.35, -0.15, 12.0, 1.55, 2.05, 0.1], [-2.35, -0.15, 12.0, 1.55, 2.05, 0.1], [0, 1.15, 12.0, 0.8, 0.75, 0.1],
      [2.35, -0.15, -8.5, 1.55, 2.05, 0.1], [-2.35, -0.15, -8.5, 1.55, 2.05, 0.1], [0, 1.15, -8.5, 0.8, 0.75, 0.1],
      [0, -1.75, 15.7, 1.1, 0.45, 0.4, 'helm'], [-0.3, -1.45, -2.25, 0.28, 0.75, 0.28, 'dock'], [-0.4, -0.15, -5.0, 0.05, 2.05, 2.45], [-2.15, -0.15, -7.45, 1.75, 2.05, 0.05], [-2.15, -0.15, -2.55, 1.75, 2.05, 0.05], [3.5, -1.4, -11.2, 0.35, 0.8, 0.6, 'engine'],
      [-3.45, -1.1, -12.2, 0.4, 1.1, 1.0, 'cells'], [0, -0.9, -14.3, 1.25, 1.3, 1.6],
      // outside: the roof you can walk on (top at 3.5) and the dorsal sail
      [0, 3.35, -1.0, 4.0, 0.15, 15.0], [0, 4.3, 5.2, 1.2, 0.8, 3.6]],
    deck: { x: 0.9, y: -2.2, z: 3.0, cells: [-2, 0, 2], levels: 0 },
    // the vehicle bay: the docked Mini Sub sits inside at (x, y, z); it docks / launches through the bay door below (door = y)
    dock: { x: -2.1, y: -1.3, z: -5.0, door: -4.8 },
    hatch: { x: 2.6, z: -6.6 },
    topHatch: { x: 1.6, z: -3.5, y: 3.5 }, // on the roof behind the sail, with a ladder down into the hall
    fresh: true, // comes empty: no fittings, no Mini Sub
    repair: { scrap: 300, titanium: 30, metal_frags: 1000 },
  },
};
export const VEHICLE_ENTER_RANGE = 3.8;
// a sub's crush depth and upgrades from the modules in its bay ([{id}...] stacks, item defs passed in)
export function subStats(def, modules, ITEMS) {
  let depth = 0, thrust = 0, hull = 0, eff = 0;
  for (const st of modules || []) { const m = st && ITEMS[st.id]?.module; if (!m) continue; depth = Math.max(depth, m.depth || 0); thrust += m.thrust || 0; hull += m.hull || 0; eff += m.eff || 0; }
  return { crush: def.depths ? def.depths[depth] : 0, thrust: 1 + Math.min(0.75, thrust), hull: Math.min(0.6, hull), eff: Math.min(0.6, eff) };
}
export const SPAWNABLE = { atv: 'quad', jeep: 'buggy', scout: 'buggy', jeep4: 'suv', long: 'suv', pickup: 'truck', truck: 'truck', hauler: 'hauler', mobilebase: 'hauler', rowboat: 'rowboat', boat: 'motorboat', sub: 'minisub', minisub: 'minisub', submarine: 'minisub', cyclops: 'cyclops', bigsub: 'cyclops', leviathan: 'cyclops', pacific: 'cyclops', motorboat: 'motorboat', skiff: 'motorboat' };

// Height of the chassis centre above the ground when resting on its wheels.
export function restHeight(def) {
  if (def.boat) return def.float;
  if (def.sub) return 0;
  const perWheel = (def.mass * 9.81) / def.wheels.length;
  return -def.wheels[0][1] + def.rest + def.wheelR - perWheel / def.spring;
}

// Rotate a local vector by quaternion q=[x,y,z,w] (no three.js needed on the server)
export function quatRotate(q, v) {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz, iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
export function quatYaw(q) { const f = quatRotate(q, [0, 0, 1]); return Math.atan2(f[0], f[2]); }
