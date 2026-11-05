// Item, recipe, loot and gathering definitions (shared by client & server).

export const INV_SIZE = 30;     // slots 0..5 are the hotbar
export const HOTBAR = 6;
export const ARMOR_SLOTS = ['head', 'chest', 'legs'];

// cat: resource | tool | weapon | ammo | armor | medical | food | deployable | explosive | component
export const ITEMS = {
  // --- resources ---
  wood: { name: 'Wood', cat: 'resource', stack: 1000, icon: '🪵' },
  stone: { name: 'Stone', cat: 'resource', stack: 1000, icon: '🪨' },
  metal_ore: { name: 'Metal Ore', cat: 'resource', stack: 1000, icon: '⛰️' },
  sulfur_ore: { name: 'Sulfur Ore', cat: 'resource', stack: 1000, icon: '🟡' },
  metal_frags: { name: 'Metal Fragments', cat: 'resource', stack: 1000, icon: '🔩' },
  sulfur: { name: 'Sulfur', cat: 'resource', stack: 1000, icon: '🧂' },
  charcoal: { name: 'Charcoal', cat: 'resource', stack: 1000, icon: '⬛' },
  hqm: { name: 'High Quality Metal', cat: 'resource', stack: 100, icon: '🧊' },
  cloth: { name: 'Cloth', cat: 'resource', stack: 500, icon: '🧵' },
  leather: { name: 'Leather', cat: 'resource', stack: 500, icon: '🟫' },
  animal_fat: { name: 'Animal Fat', cat: 'resource', stack: 500, icon: '🥓' },
  bone: { name: 'Bone Fragments', cat: 'resource', stack: 500, icon: '🦴' },
  scrap: { name: 'Scrap', cat: 'resource', stack: 1000, icon: '⚙️' },
  gunpowder: { name: 'Gunpowder', cat: 'resource', stack: 1000, icon: '💥' },
  fuel: { name: 'Low Grade Fuel', cat: 'resource', stack: 500, icon: '⛽' },
  // --- components ---
  rope: { name: 'Rope', cat: 'component', stack: 50, icon: '➰' },
  spring: { name: 'Metal Spring', cat: 'component', stack: 20, icon: '🌀' },
  pipe: { name: 'Metal Pipe', cat: 'component', stack: 20, icon: '🧪' },
  gears: { name: 'Gears', cat: 'component', stack: 20, icon: '⚙' },
  tech_trash: { name: 'Tech Trash', cat: 'component', stack: 20, icon: '💾' },
  explosives: { name: 'Explosives', cat: 'component', stack: 100, icon: '🧨' },
  wheel: { name: 'Vehicle Wheel', cat: 'component', stack: 4, icon: '🛞' },
  engine_parts: { name: 'Engine Parts', cat: 'component', stack: 5, icon: '🔧' },
  // --- food / medical ---
  berries: { name: 'Berries', cat: 'food', stack: 20, icon: '🫐', food: 8, water: 6, heal: 0 },
  raw_meat: { name: 'Raw Meat', cat: 'food', stack: 20, icon: '🥩', food: 6, water: 0, heal: -3 },
  cooked_meat: { name: 'Cooked Meat', cat: 'food', stack: 20, icon: '🍖', food: 30, water: 0, heal: 6 },
  water_bottle: { name: 'Water Bottle', cat: 'food', stack: 5, icon: '💧', food: 0, water: 45, heal: 0 },
  bandage: { name: 'Bandage', cat: 'medical', stack: 10, icon: '🩹', heal: 15, useTime: 1.5 },
  medkit: { name: 'Medkit', cat: 'medical', stack: 5, icon: '💉', heal: 50, useTime: 3 },
  // --- tools ---
  rock: { name: 'Rock', cat: 'tool', stack: 1, icon: '🪨', tool: { tree: 8, ore: 8, dmg: 8, range: 2.2, rate: 1.4 } },
  torch: { name: 'Torch', cat: 'tool', stack: 1, icon: '🔥', tool: { tree: 2, ore: 2, dmg: 6, range: 2, rate: 1.4 }, light: true },
  stone_hatchet: { name: 'Stone Hatchet', cat: 'tool', stack: 1, icon: '🪓', tool: { tree: 18, ore: 4, dmg: 12, range: 2.4, rate: 1.4 } },
  stone_pickaxe: { name: 'Stone Pickaxe', cat: 'tool', stack: 1, icon: '⛏️', tool: { tree: 4, ore: 18, dmg: 12, range: 2.4, rate: 1.3 } },
  metal_hatchet: { name: 'Metal Hatchet', cat: 'tool', stack: 1, icon: '🪓', tool: { tree: 32, ore: 6, dmg: 20, range: 2.5, rate: 1.6 }, tint: 0x9aa4ad },
  metal_pickaxe: { name: 'Metal Pickaxe', cat: 'tool', stack: 1, icon: '⛏️', tool: { tree: 6, ore: 32, dmg: 20, range: 2.5, rate: 1.5 }, tint: 0x9aa4ad },
  shovel: { name: 'Shovel', cat: 'tool', stack: 1, icon: '🪏', tool: { tree: 2, ore: 4, dmg: 12, range: 3.2, rate: 2.2 }, dig: true },
  hammer: { name: 'Hammer', cat: 'tool', stack: 1, icon: '🔨', tool: { tree: 0, ore: 0, dmg: 5, range: 3.5, rate: 2 }, hammer: true },
  building_plan: { name: 'Building Plan', cat: 'tool', stack: 1, icon: '📐', plan: true },
  spray_can: { name: 'Spray Can', cat: 'tool', stack: 1, icon: '🎨', spray: true },
  // --- melee weapons ---
  wooden_spear: { name: 'Wooden Spear', cat: 'weapon', stack: 1, icon: '🗡️', tool: { tree: 2, ore: 1, dmg: 32, range: 3.0, rate: 1.0 } },
  machete: { name: 'Machete', cat: 'weapon', stack: 1, icon: '🔪', tool: { tree: 10, ore: 2, dmg: 40, range: 2.6, rate: 1.4 } },
  // --- ranged weapons ---
  bow: { name: 'Hunting Bow', cat: 'weapon', stack: 1, icon: '🏹', gun: { dmg: 45, rate: 1.1, mag: 1, ammo: 'arrow', spread: 0.004, range: 90, reload: 0.9, recoil: 0.01, speed: 70, auto: false } },
  revolver: { name: 'Revolver', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 38, rate: 3, mag: 8, ammo: 'pistol_ammo', spread: 0.012, range: 120, reload: 2.2, recoil: 0.03, auto: false } },
  shotgun: { name: 'Pump Shotgun', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 14, pellets: 9, rate: 1.1, mag: 6, ammo: 'shells', spread: 0.06, range: 45, reload: 3.2, recoil: 0.07, auto: false } },
  smg: { name: 'Custom SMG', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 22, rate: 10, mag: 24, ammo: 'pistol_ammo', spread: 0.025, range: 110, reload: 2.8, recoil: 0.012, auto: true } },
  sword: { name: 'Salvaged Sword', cat: 'weapon', stack: 1, icon: '🗡️', tool: { tree: 6, ore: 2, dmg: 55, range: 2.8, rate: 1.2 } },
  battle_axe: { name: 'Battle Axe', cat: 'weapon', stack: 1, icon: '🪓', tool: { tree: 26, ore: 4, dmg: 65, range: 2.8, rate: 0.95 }, tint: 0x8d969e },
  pistol: { name: 'Semi-Auto Pistol', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 30, rate: 6, mag: 12, ammo: 'pistol_ammo', spread: 0.01, range: 110, reload: 1.8, recoil: 0.022, auto: false } },
  double_barrel: { name: 'Double Barrel Shotgun', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 16, pellets: 10, rate: 3, mag: 2, ammo: 'shells', spread: 0.07, range: 40, reload: 2.4, recoil: 0.09, auto: false } },
  crossbow: { name: 'Crossbow', cat: 'weapon', stack: 1, icon: '🏹', gun: { dmg: 70, rate: 0.6, mag: 1, ammo: 'arrow', spread: 0.002, range: 120, reload: 2.2, recoil: 0.015, auto: false, zoom: 0.8 } },
  bolt_rifle: { name: 'Bolt Action Rifle', cat: 'weapon', stack: 1, icon: '🔭', gun: { dmg: 85, rate: 0.7, mag: 4, ammo: 'rifle_ammo', spread: 0.003, range: 400, reload: 3.6, recoil: 0.06, auto: false, zoom: 0.3, scope: true } },
  lmg: { name: 'Light Machine Gun', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 30, rate: 9, mag: 60, ammo: 'rifle_ammo', spread: 0.022, range: 220, reload: 5.5, recoil: 0.014, auto: true } },
  rocket_launcher: { name: 'Rocket Launcher', cat: 'weapon', stack: 1, icon: '🚀', gun: { dmg: 0, rate: 0.5, mag: 1, ammo: 'rocket', spread: 0.004, range: 200, reload: 4, recoil: 0.08, auto: false, blast: { dmg: 280, radius: 3.5, playerDmg: 110 } } },
  rifle: { name: 'Assault Rifle', cat: 'weapon', stack: 1, icon: '🔫', gun: { dmg: 34, rate: 8, mag: 30, ammo: 'rifle_ammo', spread: 0.012, range: 250, reload: 3.0, recoil: 0.018, auto: true } },
  // --- ammo ---
  arrow: { name: 'Wooden Arrow', cat: 'ammo', stack: 64, icon: '➹' },
  pistol_ammo: { name: 'Pistol Bullet', cat: 'ammo', stack: 128, icon: '•' },
  rifle_ammo: { name: '5.56 Rifle Ammo', cat: 'ammo', stack: 128, icon: '⁍' },
  rocket: { name: 'Rocket', cat: 'ammo', stack: 3, icon: '🚀' },
  shells: { name: '12 Gauge Buckshot', cat: 'ammo', stack: 64, icon: '▮' },
  // --- explosives ---
  satchel: { name: 'Satchel Charge', cat: 'explosive', stack: 10, icon: '🎒', explosive: { fuse: 6, dmg: 130, radius: 3.2, playerDmg: 70 } },
  grenade: { name: 'Frag Grenade', cat: 'explosive', stack: 5, icon: '💣', explosive: { fuse: 3, dmg: 40, radius: 4, playerDmg: 95, thrown: true } },
  c4: { name: 'Timed Explosive (C4)', cat: 'explosive', stack: 10, icon: '🧨', explosive: { fuse: 10, dmg: 520, radius: 4, playerDmg: 150 } },
  // --- armor ---
  cloth_hood: { name: 'Burlap Hood', cat: 'armor', stack: 1, icon: '🧢', armor: { slot: 'head', prot: 0.1, cold: 0.15, color: 0xb9a57a } },
  cloth_shirt: { name: 'Burlap Shirt', cat: 'armor', stack: 1, icon: '👕', armor: { slot: 'chest', prot: 0.1, cold: 0.2, color: 0xb9a57a } },
  cloth_pants: { name: 'Burlap Trousers', cat: 'armor', stack: 1, icon: '👖', armor: { slot: 'legs', prot: 0.1, cold: 0.15, color: 0x9d8b63 } },
  leather_hat: { name: 'Hide Hood', cat: 'armor', stack: 1, icon: '🎩', armor: { slot: 'head', prot: 0.18, cold: 0.25, color: 0x7a5233 } },
  leather_vest: { name: 'Hide Vest', cat: 'armor', stack: 1, icon: '🦺', armor: { slot: 'chest', prot: 0.2, cold: 0.3, color: 0x7a5233 } },
  leather_pants: { name: 'Hide Pants', cat: 'armor', stack: 1, icon: '👖', armor: { slot: 'legs', prot: 0.18, cold: 0.25, color: 0x6a4428 } },
  metal_mask: { name: 'Metal Facemask', cat: 'armor', stack: 1, icon: '🪖', armor: { slot: 'head', prot: 0.45, cold: 0.05, color: 0x8b949b } },
  metal_chest: { name: 'Metal Chest Plate', cat: 'armor', stack: 1, icon: '🛡️', armor: { slot: 'chest', prot: 0.45, cold: 0.05, color: 0x8b949b } },
  metal_legs: { name: 'Roadsign Kilt', cat: 'armor', stack: 1, icon: '🛡️', armor: { slot: 'legs', prot: 0.35, cold: 0.05, color: 0x9b8b5b } },
  // --- deployables ---
  campfire: { name: 'Camp Fire', cat: 'deployable', stack: 1, icon: '🔥', deploy: { kind: 'campfire', hp: 150 } },
  furnace: { name: 'Furnace', cat: 'deployable', stack: 1, icon: '🏭', deploy: { kind: 'furnace', hp: 500 } },
  workbench1: { name: 'Workbench Level 1', cat: 'deployable', stack: 1, icon: '🛠️', deploy: { kind: 'workbench1', hp: 500 } },
  workbench2: { name: 'Workbench Level 2', cat: 'deployable', stack: 1, icon: '🛠️', deploy: { kind: 'workbench2', hp: 750 } },
  workbench3: { name: 'Workbench Level 3', cat: 'deployable', stack: 1, icon: '🛠️', deploy: { kind: 'workbench3', hp: 1000 } },
  small_box: { name: 'Wooden Box', cat: 'deployable', stack: 1, icon: '📦', deploy: { kind: 'small_box', hp: 200, slots: 12 } },
  large_box: { name: 'Large Wood Box', cat: 'deployable', stack: 1, icon: '🗃️', deploy: { kind: 'large_box', hp: 400, slots: 30 } },
  sleeping_bag: { name: 'Sleeping Bag', cat: 'deployable', stack: 1, icon: '🛏️', deploy: { kind: 'sleeping_bag', hp: 100 } },
  tool_cupboard: { name: 'Tool Cupboard', cat: 'deployable', stack: 1, icon: '🗄️', deploy: { kind: 'tool_cupboard', hp: 600 } },
  // --- furniture ---
  chair: { name: 'Wooden Chair', cat: 'deployable', stack: 4, icon: '🪑', deploy: { kind: 'chair', hp: 100, furniture: true } },
  table: { name: 'Table', cat: 'deployable', stack: 2, icon: '🟫', deploy: { kind: 'table', hp: 150, furniture: true } },
  bed: { name: 'Bed', cat: 'deployable', stack: 1, icon: '🛏️', deploy: { kind: 'bed', hp: 200, furniture: true, respawn: true } },
  sofa: { name: 'Sofa', cat: 'deployable', stack: 1, icon: '🛋️', deploy: { kind: 'sofa', hp: 150, furniture: true } },
  bookshelf: { name: 'Bookshelf', cat: 'deployable', stack: 1, icon: '📚', deploy: { kind: 'bookshelf', hp: 250, slots: 12, furniture: true } },
  wardrobe: { name: 'Wardrobe', cat: 'deployable', stack: 1, icon: '🚪', deploy: { kind: 'wardrobe', hp: 350, slots: 24, furniture: true } },
  fridge: { name: 'Fridge', cat: 'deployable', stack: 1, icon: '🧊', deploy: { kind: 'fridge', hp: 300, slots: 16, furniture: true } },
  rug: { name: 'Rug', cat: 'deployable', stack: 4, icon: '🟥', deploy: { kind: 'rug', hp: 50, furniture: true } },
  lamp: { name: 'Floor Lamp', cat: 'deployable', stack: 4, icon: '💡', deploy: { kind: 'lamp', hp: 80, furniture: true, light: true } },
  plant_pot: { name: 'Potted Plant', cat: 'deployable', stack: 4, icon: '🪴', deploy: { kind: 'plant_pot', hp: 50, furniture: true } },
  painting: { name: 'Painting', cat: 'deployable', stack: 4, icon: '🖼️', deploy: { kind: 'painting', hp: 40, furniture: true } },
  wood_door: { name: 'Wooden Door', cat: 'deployable', stack: 1, icon: '🚪', door: { hp: 200, tier: 'wood' } },
  metal_door: { name: 'Sheet Metal Door', cat: 'deployable', stack: 1, icon: '🚪', door: { hp: 400, tier: 'metal' } },
  armored_door: { name: 'Armored Door', cat: 'deployable', stack: 1, icon: '🚪', door: { hp: 900, tier: 'armored' } },
};

// Station requirement strings: null | 'wb1' | 'wb2' | 'wb3' | 'campfire' | 'furnace'
export const RECIPES = [
  // basics
  { out: 'rock', n: 1, time: 1, cost: { stone: 10 } },
  { out: 'stone_hatchet', n: 1, time: 3, cost: { wood: 200, stone: 100 } },
  { out: 'stone_pickaxe', n: 1, time: 3, cost: { wood: 200, stone: 100 } },
  { out: 'torch', n: 1, time: 2, cost: { wood: 30, cloth: 5 } },
  { out: 'building_plan', n: 1, time: 2, cost: { wood: 20 } },
  { out: 'hammer', n: 1, time: 2, cost: { wood: 100 } },
  { out: 'shovel', n: 1, time: 3, cost: { wood: 150, stone: 50 } },
  { out: 'wooden_spear', n: 1, time: 4, cost: { wood: 300 } },
  { out: 'bow', n: 1, time: 6, cost: { wood: 200, cloth: 50 } },
  { out: 'arrow', n: 4, time: 2, cost: { wood: 25, stone: 10 } },
  { out: 'bandage', n: 1, time: 2, cost: { cloth: 4 } },
  { out: 'rope', n: 1, time: 2, cost: { cloth: 15 } },
  { out: 'cloth_hood', n: 1, time: 4, cost: { cloth: 20 } },
  { out: 'cloth_shirt', n: 1, time: 4, cost: { cloth: 30 } },
  { out: 'cloth_pants', n: 1, time: 4, cost: { cloth: 25 } },
  { out: 'campfire', n: 1, time: 3, cost: { wood: 100 } },
  { out: 'furnace', n: 1, time: 6, cost: { stone: 200, wood: 100, animal_fat: 5 } },
  { out: 'small_box', n: 1, time: 4, cost: { wood: 100 } },
  { out: 'sleeping_bag', n: 1, time: 4, cost: { cloth: 30 } },
  { out: 'tool_cupboard', n: 1, time: 6, cost: { wood: 500 } },
  { out: 'wood_door', n: 1, time: 4, cost: { wood: 300 } },
  { out: 'workbench1', n: 1, time: 8, cost: { wood: 500, metal_frags: 100, scrap: 50 } },
  // campfire / furnace
  { out: 'cooked_meat', n: 1, time: 4, station: 'campfire', cost: { raw_meat: 1, wood: 10 } },
  { out: 'charcoal', n: 10, time: 2, station: 'campfire', cost: { wood: 20 } },
  { out: 'metal_frags', n: 20, time: 4, station: 'furnace', cost: { metal_ore: 20, wood: 10 } },
  { out: 'sulfur', n: 20, time: 4, station: 'furnace', cost: { sulfur_ore: 20, wood: 10 } },
  { out: 'hqm', n: 1, time: 5, station: 'furnace', cost: { metal_ore: 50, wood: 20 } },
  { out: 'fuel', n: 4, time: 3, station: 'campfire', cost: { animal_fat: 3, cloth: 1 } },
  // workbench 1
  { out: 'large_box', n: 1, time: 6, station: 'wb1', cost: { wood: 250, metal_frags: 50 } },
  { out: 'metal_hatchet', n: 1, time: 6, station: 'wb1', cost: { wood: 100, metal_frags: 75 } },
  { out: 'metal_pickaxe', n: 1, time: 6, station: 'wb1', cost: { wood: 100, metal_frags: 125 } },
  { out: 'machete', n: 1, time: 6, station: 'wb1', cost: { metal_frags: 150, wood: 50 } },
  { out: 'metal_door', n: 1, time: 6, station: 'wb1', cost: { metal_frags: 150 } },
  { out: 'leather_hat', n: 1, time: 4, station: 'wb1', cost: { leather: 20, cloth: 5 } },
  { out: 'leather_vest', n: 1, time: 4, station: 'wb1', cost: { leather: 30, cloth: 5 } },
  { out: 'leather_pants', n: 1, time: 4, station: 'wb1', cost: { leather: 25, cloth: 5 } },
  { out: 'gunpowder', n: 10, time: 2, station: 'wb1', cost: { charcoal: 30, sulfur: 20 } },
  { out: 'revolver', n: 1, time: 8, station: 'wb1', cost: { metal_frags: 125, pipe: 1, cloth: 25 } },
  { out: 'pistol_ammo', n: 4, time: 2, station: 'wb1', cost: { metal_frags: 10, gunpowder: 5 } },
  { out: 'shells', n: 2, time: 2, station: 'wb1', cost: { metal_frags: 5, gunpowder: 10 } },
  { out: 'pipe', n: 1, time: 4, station: 'wb1', cost: { metal_frags: 40, scrap: 5 } },
  { out: 'spring', n: 1, time: 4, station: 'wb1', cost: { metal_frags: 50, scrap: 10 } },
  { out: 'satchel', n: 1, time: 8, station: 'wb1', cost: { gunpowder: 60, rope: 1, cloth: 10, metal_frags: 20 } },
  { out: 'workbench2', n: 1, time: 15, station: 'wb1', cost: { metal_frags: 500, hqm: 20, scrap: 300 } },
  { out: 'medkit', n: 1, time: 4, station: 'wb1', cost: { cloth: 20, animal_fat: 5, scrap: 5 } },
  // workbench 2
  { out: 'shotgun', n: 1, time: 10, station: 'wb2', cost: { metal_frags: 150, pipe: 1, spring: 1, wood: 100 } },
  { out: 'smg', n: 1, time: 12, station: 'wb2', cost: { hqm: 8, spring: 1, pipe: 1, metal_frags: 100 } },
  { out: 'metal_mask', n: 1, time: 10, station: 'wb2', cost: { hqm: 15, metal_frags: 50, leather: 10 } },
  { out: 'metal_chest', n: 1, time: 12, station: 'wb2', cost: { hqm: 25, metal_frags: 100, leather: 10 } },
  { out: 'metal_legs', n: 1, time: 10, station: 'wb2', cost: { metal_frags: 150, leather: 10 } },
  { out: 'wheel', n: 1, time: 8, station: 'wb2', cost: { metal_frags: 100, leather: 20, scrap: 10 } },
  { out: 'engine_parts', n: 1, time: 10, station: 'wb2', cost: { metal_frags: 150, hqm: 3, gears: 1 } },
  { out: 'gears', n: 1, time: 4, station: 'wb2', cost: { metal_frags: 60, scrap: 15 } },
  { out: 'explosives', n: 1, time: 4, station: 'wb2', cost: { gunpowder: 50, fuel: 3, sulfur: 10, metal_frags: 10 } },
  { out: 'workbench3', n: 1, time: 20, station: 'wb2', cost: { metal_frags: 1000, hqm: 100, scrap: 800, tech_trash: 2 } },
  // workbench 3
  { out: 'rifle', n: 1, time: 15, station: 'wb3', cost: { hqm: 50, spring: 4, metal_frags: 200, wood: 200 } },
  { out: 'rifle_ammo', n: 4, time: 2, station: 'wb3', cost: { metal_frags: 10, gunpowder: 5 } },
  { out: 'c4', n: 1, time: 15, station: 'wb3', cost: { explosives: 20, cloth: 5, tech_trash: 2 } },
  { out: 'armored_door', n: 1, time: 15, station: 'wb3', cost: { hqm: 20, gears: 5 } },
  // --- added weapons ---
  { out: 'sword', n: 1, time: 8, station: 'wb1', cost: { metal_frags: 200, wood: 50, leather: 5 } },
  { out: 'pistol', n: 1, time: 10, station: 'wb1', cost: { metal_frags: 150, spring: 1, pipe: 1 } },
  { out: 'double_barrel', n: 1, time: 10, station: 'wb1', cost: { metal_frags: 175, pipe: 2, wood: 150 } },
  { out: 'crossbow', n: 1, time: 10, station: 'wb1', cost: { wood: 250, metal_frags: 75, rope: 2 } },
  { out: 'battle_axe', n: 1, time: 10, station: 'wb2', cost: { metal_frags: 250, hqm: 5, wood: 100 } },
  { out: 'grenade', n: 1, time: 5, station: 'wb2', cost: { gunpowder: 40, metal_frags: 30 } },
  { out: 'bolt_rifle', n: 1, time: 18, station: 'wb3', cost: { hqm: 40, spring: 3, pipe: 2, metal_frags: 200 } },
  { out: 'lmg', n: 1, time: 20, station: 'wb3', cost: { hqm: 70, spring: 5, gears: 4, metal_frags: 300 } },
  { out: 'rocket_launcher', n: 1, time: 20, station: 'wb3', cost: { hqm: 50, pipe: 4, metal_frags: 200 } },
  { out: 'rocket', n: 1, time: 8, station: 'wb3', cost: { explosives: 8, pipe: 1, gunpowder: 50 } },
  // --- furniture ---
  { out: 'chair', n: 1, time: 3, cost: { wood: 80 } },
  { out: 'rug', n: 1, time: 3, cost: { cloth: 40 } },
  { out: 'plant_pot', n: 1, time: 3, cost: { stone: 40, wood: 10 } },
  { out: 'table', n: 1, time: 5, station: 'wb1', cost: { wood: 150, metal_frags: 10 } },
  { out: 'bed', n: 1, time: 8, station: 'wb1', cost: { wood: 200, cloth: 60 } },
  { out: 'sofa', n: 1, time: 8, station: 'wb1', cost: { wood: 150, cloth: 80, leather: 10 } },
  { out: 'bookshelf', n: 1, time: 8, station: 'wb1', cost: { wood: 300 } },
  { out: 'wardrobe', n: 1, time: 10, station: 'wb1', cost: { wood: 350, metal_frags: 30 } },
  { out: 'lamp', n: 1, time: 6, station: 'wb1', cost: { metal_frags: 40, cloth: 5, fuel: 5 } },
  { out: 'painting', n: 1, time: 4, station: 'wb1', cost: { wood: 30, cloth: 20 } },
  { out: 'fridge', n: 1, time: 12, station: 'wb2', cost: { metal_frags: 200, gears: 1, tech_trash: 1 } },
];
RECIPES.push({ out: 'spray_can', n: 1, time: 3, cost: { metal_frags: 25, cloth: 5 } });
RECIPES.forEach((r, i) => (r.id = i));

export const STATION_NAMES = { wb1: 'Workbench Lv1', wb2: 'Workbench Lv2', wb3: 'Workbench Lv3', campfire: 'Camp Fire', furnace: 'Furnace' };
// Which deployable kinds satisfy which station requirement
export const STATION_PROVIDERS = {
  wb1: ['workbench1', 'workbench2', 'workbench3'],
  wb2: ['workbench2', 'workbench3'],
  wb3: ['workbench3'],
  campfire: ['campfire'],
  furnace: ['furnace'],
};
export const STATION_RANGE = 4.5;
export const STATION_KINDS = ['campfire', 'furnace', 'workbench1', 'workbench2', 'workbench3'];
export const STATION_OUTPUT_SLOTS = 12;
// Recipes a given station (deployable kind) can make. Hand recipes (no station) are made from the inventory.
export function stationRecipes(kind) { return RECIPES.filter((r) => r.station && STATION_PROVIDERS[r.station].includes(kind)); }

// Gathering: per node type
export const NODES = {
  tree_oak: { kind: 'tree', hp: 140, yield: { wood: 1.0 }, radius: 0.5, height: 8 },
  tree_pine: { kind: 'tree', hp: 130, yield: { wood: 1.0 }, radius: 0.45, height: 10 },
  tree_palm: { kind: 'tree', hp: 90, yield: { wood: 0.9 }, radius: 0.35, height: 9 },
  tree_dead: { kind: 'tree', hp: 70, yield: { wood: 1.1 }, radius: 0.35, height: 6 },
  cactus: { kind: 'tree', hp: 50, yield: { wood: 0.5, cloth: 0.15 }, radius: 0.4, height: 3 },
  rock_stone: { kind: 'ore', hp: 150, yield: { stone: 1.2 }, radius: 1.1, height: 1.6 },
  rock_metal: { kind: 'ore', hp: 150, yield: { metal_ore: 0.7, stone: 0.4 }, radius: 1.1, height: 1.6 },
  rock_sulfur: { kind: 'ore', hp: 150, yield: { sulfur_ore: 0.7, stone: 0.3 }, radius: 1.1, height: 1.6 },
  loose_rock: { kind: 'pick', yield: {}, radius: 0.35, height: 0.35, givesRock: true },
  branch: { kind: 'pick', yield: { wood: 15 }, radius: 0.6, height: 0.3 },
  hemp: { kind: 'pick', yield: { cloth: 10 }, radius: 0.4, height: 1.2 },
  berry: { kind: 'pick', yield: { berries: 3 }, radius: 0.6, height: 1 },
  barrel: { kind: 'barrel', hp: 40, radius: 0.5, height: 1.2 },
};
export const NODE_RESPAWN = 20 * 60; // seconds
// Bare hands: weak, can't gather
export const FIST = { tree: 0, ore: 0, dmg: 6, range: 1.9, rate: 1.7 };

// Terrain editing
export const DIG = { step: 0.45, min: -6, max: 4, raiseCost: { stone: 5 }, reach: 5 };

export const LOOT = {
  barrel: [['scrap', 2, 6, 1], ['metal_frags', 10, 30, 0.4], ['fuel', 2, 6, 0.3], ['rope', 1, 1, 0.15], ['pipe', 1, 1, 0.1], ['gears', 1, 1, 0.08], ['spring', 1, 1, 0.06], ['pistol_ammo', 4, 10, 0.1], ['bandage', 1, 2, 0.15], ['cloth', 5, 15, 0.2]],
  1: [['scrap', 5, 12, 1], ['metal_frags', 20, 60, 0.6], ['fuel', 5, 15, 0.5], ['rope', 1, 2, 0.3], ['pipe', 1, 2, 0.25], ['gears', 1, 1, 0.2], ['spring', 1, 1, 0.15], ['wheel', 1, 1, 0.12], ['engine_parts', 1, 1, 0.08], ['bandage', 1, 3, 0.3], ['pistol_ammo', 8, 16, 0.2], ['cloth_shirt', 1, 1, 0.05], ['metal_hatchet', 1, 1, 0.05], ['revolver', 1, 1, 0.03], ['pistol', 1, 1, 0.02], ['crossbow', 1, 1, 0.02], ['water_bottle', 1, 1, 0.2]],
  2: [['scrap', 15, 30, 1], ['metal_frags', 50, 120, 0.6], ['hqm', 2, 6, 0.4], ['fuel', 10, 25, 0.5], ['gears', 1, 2, 0.35], ['spring', 1, 2, 0.35], ['pipe', 1, 2, 0.3], ['tech_trash', 1, 1, 0.25], ['wheel', 1, 2, 0.3], ['engine_parts', 1, 1, 0.25], ['medkit', 1, 1, 0.25], ['pistol_ammo', 12, 24, 0.3], ['shells', 4, 10, 0.25], ['revolver', 1, 1, 0.1], ['shotgun', 1, 1, 0.06], ['leather_vest', 1, 1, 0.08], ['metal_mask', 1, 1, 0.03], ['satchel', 1, 1, 0.05], ['pistol', 1, 1, 0.08], ['double_barrel', 1, 1, 0.06], ['sword', 1, 1, 0.06], ['grenade', 1, 2, 0.1]],
  3: [['scrap', 30, 60, 1], ['hqm', 6, 15, 0.7], ['tech_trash', 1, 2, 0.5], ['explosives', 2, 6, 0.3], ['rifle_ammo', 20, 40, 0.5], ['engine_parts', 1, 2, 0.4], ['wheel', 1, 2, 0.3], ['medkit', 1, 2, 0.5], ['smg', 1, 1, 0.15], ['rifle', 1, 1, 0.08], ['metal_chest', 1, 1, 0.12], ['metal_mask', 1, 1, 0.12], ['metal_legs', 1, 1, 0.12], ['c4', 1, 1, 0.04], ['satchel', 1, 3, 0.2], ['bolt_rifle', 1, 1, 0.07], ['lmg', 1, 1, 0.04], ['rocket_launcher', 1, 1, 0.03], ['rocket', 1, 2, 0.06], ['grenade', 1, 3, 0.25], ['battle_axe', 1, 1, 0.08]],
};

export function rollLoot(table, rnd = Math.random) {
  const out = [];
  for (const [id, a, b, p] of LOOT[table]) if (rnd() < p) out.push({ id, n: a + Math.floor(rnd() * (b - a + 1)) });
  return out;
}

export function itemMaxStack(id) { return ITEMS[id]?.stack || 1; }

export function newStack(id, n = 1) {
  const s = { id, n };
  const g = ITEMS[id]?.gun;
  if (g) s.a = 0;
  return s;
}

// Animal definitions
export const ANIMALS = {
  deer: { name: 'Deer', hp: 40, speed: 9, aggro: false, dmg: 0, drops: { raw_meat: 4, leather: 18, animal_fat: 4, bone: 8 }, color: 0x9b6a3c, size: 1 },
  boar: { name: 'Boar', hp: 60, speed: 6.5, aggro: 'defensive', dmg: 12, drops: { raw_meat: 5, leather: 12, animal_fat: 8, bone: 10 }, color: 0x4f3a2a, size: 0.8 },
  wolf: { name: 'Wolf', hp: 35, speed: 7.2, aggro: true, dmg: 8, drops: { raw_meat: 3, leather: 15, animal_fat: 3, bone: 8 }, color: 0x6b6b70, size: 0.85 },
  bear: { name: 'Bear', hp: 160, speed: 7.5, aggro: true, dmg: 30, drops: { raw_meat: 10, leather: 40, animal_fat: 15, bone: 20 }, color: 0x3d2b1f, size: 1.5 },
};
