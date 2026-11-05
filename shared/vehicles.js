// Vehicle type definitions shared by client (physics/rendering) and server (repair/health).
export const VEHICLES = {
  quad: {
    name: 'Quad Bike', mass: 320, hp: 300, fuelCap: 60, fuelUse: 0.05,
    // chassis half extents (m) and centre-of-mass offset
    half: [0.6, 0.35, 1.0], com: [0, -0.15, 0],
    wheels: [[-0.62, -0.25, 0.75, 1, 0], [0.62, -0.25, 0.75, 1, 0], [-0.62, -0.25, -0.75, 0, 1], [0.62, -0.25, -0.75, 0, 1]], // x,y,z, steer, drive
    wheelR: 0.36, rest: 0.42, spring: 5600, damper: 640, engine: 2200, maxSpeed: 22, steer: 0.62, brake: 3200,
    seats: [[0, 0.45, -0.1]], color: 0x5f7f3a,
    repair: { wheel: 2, engine_parts: 1, scrap: 20 },
  },
  buggy: {
    name: 'Dune Buggy', mass: 720, hp: 600, fuelCap: 80, fuelUse: 0.08,
    half: [0.95, 0.45, 1.8], com: [0, -0.25, 0],
    wheels: [[-1.05, -0.3, 1.35, 1, 1], [1.05, -0.3, 1.35, 1, 1], [-1.05, -0.3, -1.3, 0, 1], [1.05, -0.3, -1.3, 0, 1]],
    wheelR: 0.48, rest: 0.55, spring: 9800, damper: 1300, engine: 5600, maxSpeed: 30, steer: 0.55, brake: 8000,
    seats: [[-0.42, 0.55, -0.1], [0.42, 0.55, -0.1]], color: 0xc2702b,
    repair: { wheel: 3, engine_parts: 1, scrap: 40, metal_frags: 50 },
  },
  truck: {
    name: 'Offroad Pickup', mass: 1650, hp: 1000, fuelCap: 120, fuelUse: 0.12,
    half: [1.05, 0.65, 2.6], com: [0, -0.3, 0.2],
    wheels: [[-1.05, -0.45, 1.75, 1, 1], [1.05, -0.45, 1.75, 1, 1], [-1.05, -0.45, -1.7, 0, 1], [1.05, -0.45, -1.7, 0, 1]],
    wheelR: 0.55, rest: 0.6, spring: 19500, damper: 2700, engine: 11500, maxSpeed: 27, steer: 0.5, brake: 17000,
    seats: [[-0.45, 0.75, 0.3], [0.45, 0.75, 0.3], [-0.5, 0.75, -1.5], [0.5, 0.75, -1.5]], color: 0x2f5c7a,
    repair: { wheel: 4, engine_parts: 2, scrap: 75, metal_frags: 150 },
  },
};
export const VEHICLE_ENTER_RANGE = 3.5;

// Height of the chassis centre above the ground when resting on its wheels.
export function restHeight(def) {
  return -def.wheels[0][1] + def.rest + def.wheelR - (def.mass * 9.81) / 4 / def.spring;
}
