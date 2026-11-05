# Odyssey Rush

A low-poly, first-person **multiplayer survival shooter** that runs in the browser.
You wake up on a beach of a 16 km procedural island with a rock and a torch. Gather,
craft, build a base, hide it well — because when you log off your character stays
asleep in the world and **your base can be raided while you're offline**. Find wrecked
vehicles, repair them and drive them offroad with physics that react to the terrain.

![stack](https://img.shields.io/badge/client-Three.js-black) ![stack](https://img.shields.io/badge/server-Node.js%20%2B%20WebSocket-green)

## Play online

**https://odyssey-rush.onrender.com** — everyone who opens the link plays in the same persistent world.
Bases, gathered trees, holes you dig, vehicles and sleeping players are stored in Postgres and survive
server restarts. (Free hosting: after ~15 min with nobody online the server sleeps, so the first visit can
take about a minute to load.)

Hosting is defined in [`render.yaml`](render.yaml): a Node web service plus a Postgres database
(`DATABASE_URL`). Pushing to the deployed branch redeploys automatically; players reconnect on their own.

## Quick start (local)

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
| `DATA_FILE` | `data/world.json` | Save file (used when `DATABASE_URL` is not set) |
| `DATABASE_URL` | unset | Postgres connection string — stores the world in the database instead of a file |
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
| L | Clan menu (create, invite, accept, kick) · clan chat: type `/c message` |
| M | Map with fog-of-war (reveals as you explore, remembers discovered places) |
| LMB / RMB with Shovel | Dig a hole (gives stone, sometimes ore) / pile up dirt (costs stone) |
| X | Demolish your own piece (hammer, within 10 min of placing) |
| G / H | Refuel / patch up a vehicle you're looking at |
| V | Toggle first / third person while in a vehicle |
| Enter | Chat · **Esc** pause & settings (view distance, FOV, sensitivity, shadows, volume) |

## How to play

0. **Create your survivor.** The main menu has a character creator with a live 3D preview: body type, height,
   skin tone, 8 hair styles and 11 colours, facial hair, eye colour, tops, legs and shoes. Everyone sees your look.
1. **Start with nothing.** You wake up empty-handed. Find a **loose rock** on the ground (beaches have plenty) and
   press E to pick it up — that's your first tool. Branches give wood. Bare fists can fight but can't gather.
   Hit trees for wood and rocks for stone, metal ore and sulfur ore (orange / yellow speckled rocks).
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
5. **Fight.** Melee: rock, spear, machete, salvaged sword, battle axe. Ranged: hunting bow, crossbow, revolver,
   semi-auto pistol, pump & double-barrel shotguns, custom SMG, assault rifle, scoped bolt-action rifle (RMB to
   scope), light machine gun and a rocket launcher. Throwable frag grenades. Wolves are dangerous in packs but
   go down quickly.
6. **Team up.** Press L to found a clan (name + 2-5 letter tag) and invite players. Clanmates share building rights
   at each other's tool cupboards, open each other's doors, can't hurt each other, see each other's green
   nametags from 400 m and on the map, and get a private clan chat (`/c hello`).
7. **Raid (and be raided).** Craft Satchel Charges (Lv1), Timed Explosives / C4 (Lv3) or rockets (Lv3) to blow through doors
   and walls. Logged-off players remain as sleeping bodies that can be killed and looted.
8. **Develop.** Gathering, crafting and fighting earn XP: every level adds max health and gather rate.
   Armor (burlap → hide → metal) reduces damage and keeps you warm in the tundra and at night.
9. **Explore & drive.** ~117 monuments (ruins, gas stations, farms, radio towers, military outposts, junkyards)
   hold loot crates that respawn, and **broken vehicles**: an ATV, a Rally Hatchback, an Offroad SUV or a Double-Cab Pickup. Look at one
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
