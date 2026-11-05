# Odyssey Rush

A low-poly, first-person **multiplayer survival shooter** that runs in the browser.
You wake up on a beach of a 16 km procedural island with a rock and a torch. Gather,
craft, build a base, hide it well — because when you log off your character stays
asleep in the world and **your base can be raided while you're offline**. Find wrecked
vehicles, repair them and drive them offroad with physics that react to the terrain.

![stack](https://img.shields.io/badge/client-Three.js-black) ![stack](https://img.shields.io/badge/server-Node.js%20%2B%20WebSocket-green)

## Quick start

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:3000>, type a name and press **Wake Up**. Other players on your
network can join at `http://<your-ip>:3000`. The world is saved to `data/world.json`
every minute and when the server stops.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `SEED` | `1337` | World seed (a new seed = a new island and a fresh save) |
| `DATA_FILE` | `data/world.json` | Save file |
| `DEV` | unset | `DEV=1` enables admin chat commands (`/tp x z`, `/tppoi [type]`, `/give id n`, `/kit`, `/day 0-1`, `/heal`) |

Deploys to any host that runs Node 18+ and allows WebSockets (Render, Railway, Fly.io, a VPS…).

## Controls

| Key | Action |
|---|---|
| WASD / Shift / Ctrl or C / Space | Move / sprint / crouch / jump (swim up in water) |
| Mouse | Look · **LMB** use / attack / place · **RMB** aim, build menu, repair |
| 1–6, wheel | Belt slots |
| E | Interact: pick up, loot, open doors/boxes, authorize at a tool cupboard, enter / repair vehicles |
| Tab or Q | Inventory & crafting (drag items, Shift-click quick move, right-click use/equip, drag out to drop) |
| R | Reload · rotate building piece · flip a vehicle back on its wheels |
| F | Drink (standing in a river or lake — the ocean is salty) |
| M | Map with fog-of-war (reveals as you explore, remembers discovered places) |
| X | Demolish your own piece (hammer, within 10 min of placing) |
| G / H | Refuel / patch up a vehicle you're looking at |
| V | Toggle first / third person while in a vehicle |
| Enter | Chat · **Esc** pause & settings (view distance, FOV, sensitivity, shadows, volume) |

## How to play

1. **Gather.** Hit trees for wood and rocks for stone, metal ore and sulfur ore (orange / yellow speckled rocks).
   Press E on hemp for cloth and on bushes for berries. Smash blue barrels for scrap and parts.
2. **Craft.** Stone hatchet & pickaxe first, then a building plan, hammer, camp fire, furnace, sleeping bag and boxes.
   Stand near stations to unlock recipes: **Camp Fire** (cooking, charcoal, fuel), **Furnace** (smelting),
   **Workbench Lv1 → Lv2 → Lv3** (better tools, guns, armor, vehicle parts, explosives).
3. **Build.** Equip the building plan: foundations, walls, doorways, windows, low walls, floors and stairs snap to
   a 3 m grid. Everything starts as Twig; use the hammer to upgrade to **Wood → Stone → Sheet Metal → Armored**.
   Put a door in the doorway and a **Tool Cupboard** inside: it locks your doors to authorized players and stops
   anyone else building within 30 m. Pieces need support — blow out a wall and the floor above can collapse.
4. **Hide.** Bases are only streamed to players within ~300 m, and the map shows no other players. The island is
   huge — a remote valley is a safer home than the beach next to a monument. You can't build inside monuments.
5. **Raid (and be raided).** Craft Satchel Charges (Lv1) or Timed Explosives / C4 (Lv3) and stick them on doors
   and walls. Logged-off players remain as sleeping bodies that can be killed and looted.
6. **Develop.** Gathering, crafting and fighting earn XP: every level adds max health and gather rate.
   Armor (burlap → hide → metal) reduces damage and keeps you warm in the tundra and at night.
7. **Explore & drive.** ~117 monuments (ruins, gas stations, farms, radio towers, military outposts, junkyards)
   hold loot crates that respawn, and **broken vehicles**: a Quad Bike, Dune Buggy or Offroad Pickup. Look at one
   and press E to install the parts it needs (wheels, engine parts, scrap, metal), add Low Grade Fuel, and drive.

### Vehicle physics

Each vehicle is a rigid body with four raycast spring-damper suspensions, tyre friction circles and an engine
torque curve. Grip and rolling resistance depend on the surface under each wheel (grass, dirt, sand, mud, snow,
rock, building floors). Water adds buoyancy, drag and can flood the engine. The chassis collides with terrain,
trees, rocks, buildings and other vehicles; hard impacts damage the vehicle and its passengers, and you can run
over animals and players. Wheels kick up dust, mud, snow or spray depending on the ground.

### Survival

Hunger and thirst drain over time; cook meat at a camp fire, eat berries, drink fresh water. Deer flee, boars
fight back, wolves and bears hunt you (more aggressively at night). Animal corpses can be looted for meat,
leather, fat and bone.

## Project layout

```
shared/     Code used by both server and client
  noise.js      seeded simplex noise & hashing
  worldgen.js   island terrain, biomes, rivers/lakes, POIs and their layouts, resource nodes
  items.js      items, recipes, loot tables, gathering yields, animals
  building.js   building grid, piece colliders, placement & support rules
  vehicles.js   vehicle definitions
server/     Authoritative game server (inventory, crafting, building, combat, raiding, animals, vehicles, saving)
public/     Browser client
  js/terrain.js   chunked terrain with LOD, instanced resource nodes, monuments
  js/physics.js   collision world, character movement, raycasts
  js/vehicles.js  vehicle simulation & rendering
  js/main.js      game loop, networking glue, interaction
  …             models, UI, sky/water, effects, audio (all procedural — no asset files)
```
