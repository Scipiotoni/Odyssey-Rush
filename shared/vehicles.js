// Vehicle type definitions shared by client (physics/rendering) and server (repair/health).
// Suspension is derived so every vehicle sits at ~35% compression at rest.

function vehicle(v) {
  const { mass, rest, wheelR, half, track, axles, arch, steerFront = true, awd = true } = v;
  const k = (mass * 9.81) / 4 / (0.35 * rest);
  const c = 2 * 0.45 * Math.sqrt((k * mass) / 4);
  const wy = -half[1] + arch * wheelR + 0.65 * rest; // wheel mount height so the wheel sits in its arch
  v.spring = Math.round(k);
  v.damper = Math.round(c);
  v.wheels = [
    [-track, wy, axles[0], steerFront ? 1 : 0, awd ? 1 : 0], [track, wy, axles[0], steerFront ? 1 : 0, awd ? 1 : 0],
    [-track, wy, axles[1], 0, 1], [track, wy, axles[1], 0, 1],
  ];
  return v;
}

export const VEHICLES = {
  quad: vehicle({
    name: 'ATV', mass: 340, hp: 300, fuelCap: 60, fuelUse: 0.05,
    half: [0.6, 0.38, 1.0], com: [0, -0.15, 0], track: 0.6, axles: [0.72, -0.72], arch: 0.2, awd: false,
    wheelR: 0.34, rest: 0.4, engine: 2400, maxSpeed: 23, steer: 0.62, brake: 3400,
    seats: [[0, 0.05, -0.15]], color: 0x4f6f34, style: 'atv',
    repair: { wheel: 2, engine_parts: 1, scrap: 20 },
  }),
  buggy: vehicle({
    name: 'Rally Hatchback', mass: 1150, hp: 650, fuelCap: 80, fuelUse: 0.08,
    half: [0.9, 0.7, 2.05], com: [0, -0.3, 0.1], track: 0.79, axles: [1.3, -1.28], arch: 0.55,
    wheelR: 0.36, rest: 0.42, engine: 7600, maxSpeed: 37, steer: 0.55, brake: 10500,
    seats: [[-0.4, -0.22, 0.05], [0.4, -0.22, 0.05], [-0.4, -0.2, -0.85], [0.4, -0.2, -0.85]], color: 0xd0402a, style: 'hatch',
    repair: { wheel: 3, engine_parts: 1, scrap: 40, metal_frags: 50 },
  }),
  suv: vehicle({
    name: 'Offroad SUV', mass: 1900, hp: 900, fuelCap: 100, fuelUse: 0.1,
    half: [0.97, 0.8, 2.4], com: [0, -0.35, 0.1], track: 0.85, axles: [1.48, -1.42], arch: 0.5,
    wheelR: 0.43, rest: 0.5, engine: 11500, maxSpeed: 33, steer: 0.52, brake: 17000,
    seats: [[-0.42, -0.16, 0.2], [0.42, -0.16, 0.2], [-0.42, -0.12, -0.75], [0.42, -0.12, -0.75]], color: 0x2c4a3a, style: 'suv',
    repair: { wheel: 4, engine_parts: 2, scrap: 60, metal_frags: 120 },
  }),
  truck: vehicle({
    name: 'Double-Cab Pickup', mass: 2100, hp: 1100, fuelCap: 120, fuelUse: 0.12,
    half: [1.0, 0.85, 2.7], com: [0, -0.35, 0.3], track: 0.87, axles: [1.72, -1.62], arch: 0.45,
    wheelR: 0.45, rest: 0.52, engine: 13000, maxSpeed: 30, steer: 0.5, brake: 19000,
    seats: [[-0.42, -0.1, 0.45], [0.42, -0.1, 0.45], [-0.42, -0.08, -0.4], [0.42, -0.08, -0.4]], color: 0x2a4f7a, style: 'pickup',
    repair: { wheel: 4, engine_parts: 2, scrap: 75, metal_frags: 150 },
  }),
};
export const VEHICLE_ENTER_RANGE = 3.8;

// Height of the chassis centre above the ground when resting on its wheels.
export function restHeight(def) {
  return -def.wheels[0][1] + def.rest + def.wheelR - (def.mass * 9.81) / 4 / def.spring;
}
