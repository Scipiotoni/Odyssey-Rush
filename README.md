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

### Servers: public, private and your own rules

The home screen has a **server browser**:

- **Browse**: the official world and every public server, with player counts and rule tags (PvP, difficulty, creative, day length…).
- **Join with code**: private servers aren't listed. Type the 6-letter **invite code** (plus the password, if the owner set one).
- **Create**: make your own server (up to 3 per device). Pick a name, public or private, an optional password, a world seed
  (or a random island), max players, **difficulty** (🕊️ Peaceful: animals and sharks don't hurt you and you can't starve ·
  ⚔️ Normal · 💀 Hardcore: dying wipes your level, kills and respawn points), day and season length, gather rate, hunger and
  thirst rate, PvP, animals and sharks on or off, and **Creative** (free building and crafting, the item spawner for everyone,
  and the owner flies with **Z**).
- **My servers**: change any setting later and it applies live for everyone online. You can also roll a new invite code,
  generate a brand-new island, or delete the server. The owner has admin commands on their own server.

Each server is its own saved world. Idle ones are saved and unloaded after 10 minutes and come back when someone joins.

Hosting is defined in [`render.yaml`](render.yaml): a Node web service plus a Postgres database
(`DATABASE_URL`). Pushing to the deployed branch redeploys automatically; players reconnect on their own.

## Quick start (local)

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:3000>, type a name (and optionally a password) and press **Wake Up**. Other players on your
network can join at `http://<your-ip>:3000`. The world is saved to `data/world.json`
every minute and when the server stops.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket port |
| `SEED` | `1337` | World seed (a new seed = a new island and a fresh save) |
| `DATA_FILE` | `data/world.json` | Save file (used when `DATABASE_URL` is not set) |
| `DATABASE_URL` | unset | Postgres connection string — stores the world in the database instead of a file |
| `ADMIN_PASSWORD` | unset | Lets players type `/admin <password>` in chat to unlock the admin commands below |
| `DEV` | unset | `DEV=1` makes everyone an admin (local testing) and removes the vehicle spawn limits |

Deploys to any host that runs Node 18+ and allows WebSockets (Render, Railway, Fly.io, a VPS…).

## Controls

Every key can be changed: **Esc → ⌨️ Controls**, click a key and press the new one (clashes show in red, *Reset to
defaults* puts everything back). The on-screen hints follow your keys. The table lists the defaults.

| Key | Action |
|---|---|
| WASD / Shift / Ctrl or C / Space | Move / sprint / crouch / jump · **crouch while sprinting to slide** (jump out of a slide to keep the speed) |
| In water | Swim where you look (look down + W to dive) · **Space** up · **Ctrl/C** down · **Shift** swim fast · swim into a ledge or ice edge to climb out |
| Mouse | Look · **LMB** use / attack / place · **RMB** aim, build menu, repair |
| 1–6, wheel | Belt slots |
| E | Interact: pick up, loot, open doors/boxes/machines, authorize at a tool cupboard, enter / repair vehicles |
| G | Put out / light a camp fire or furnace · switch a base machine on/off |
| Tab or Q | Inventory & crafting (drag items, Shift-click quick move, right-click use/equip, drag out to drop) |
| R | Reload · rotate building piece · flip a vehicle back on its wheels |
| F | Drink (standing in a river or lake — the ocean is salty) |
| L | Clan menu (create, invite, accept, kick) · clan chat: type `/c message` |
| M | Map with fog-of-war (reveals as you explore, remembers discovered places) |
| LMB / RMB with Shovel or Drill | Dig anywhere — the ground scoops away smoothly, deeper layers are harder (stone, ores and buried finds) / fill a hole back in (3 stone) |
| Z | Fly (server owner, Creative servers) |
| X | Demolish your own piece (hammer, within 10 min of placing) |
| E on a fuel cap / battery hatch | Open the vehicle's fuel tank or battery compartment |
| H | Patch up a vehicle you're looking at |
| V | Toggle first / third person while in a vehicle |
| RMB with a rock | Throw it (hurts players & animals, pick it up again with E) |
| T or Enter | Chat (`/help` lists commands). While it's open, scroll back through the last 200 messages with the mouse wheel or PgUp / PgDn · **Esc** pause & settings (view distance, FOV, sensitivity, shadows, volume, controls) |

## How to play

0. **Sign in.** Type a name and press Wake Up to play on this device. Add a **password** to turn the name into an
   account: sign in with the same name and password on any other device (phone, laptop, a friend's PC) and you continue
   with the same survivor, inventory and bases. Change it later with `/password new`.
0b. **Create your survivor.** The main menu has a character creator with a live 3D preview: body type, height,
   skin tone, 8 hair styles and 11 colours, facial hair, eye colour, tops, legs and shoes. Everyone sees your look.
1. **Start with nothing.** You wake up empty-handed. Find a **loose rock** on the ground (beaches have plenty) and
   press E to pick it up — that's your first tool. Branches give wood. Bare fists can fight but can't gather.
   Hit trees for wood and rocks for stone, metal ore and sulfur ore (orange / yellow speckled rocks).
   Press E on hemp for cloth and on bushes for berries. Smash blue barrels for scrap and parts.
1b. **Pack smart.** The inventory is a Tetris-style grid: resources and small things take one cell, tools with long
   handles 1×2, rifles, shotguns, armour plates, furnaces and workbenches 2×2. Drag items into place (green = fits,
   red = doesn't; dropping on a single item swaps them). You start with only **2 rows** plus 6 quick slots — wear a bag
   on your back for more: **Small Bag** +1 row (hand-craft: 40 cloth + rope), **Backpack** +2 (Workbench 1),
   **Expedition Pack** +4 (Workbench 2). Boxes and lockers are grids too. Anything that doesn't fit drops at your feet.
2. **Craft.** Stone hatchet & pickaxe first, then a building plan, hammer, camp fire, furnace, sleeping bag and boxes.
   Basic items are crafted by hand (Tab). Everything else is made **at the station**: walk up to a **Camp Fire**
   (cooking, charcoal, fuel), **Furnace** (smelting) or **Workbench Lv1 → Lv2 → Lv3** and press E. Each station
   only makes its own items, keeps working while you're away, and finished items wait in its output slots.
3. **Build.** Equip the building plan and right-click for the **build menu** (No Man's Sky style): a tab for each
   material (Twig, Wood, Stone, Sheet Metal, Armored, Watertight Steel) with its pieces (foundations, walls, doorways,
   windows, low walls, floors, roofs, stairs), plus **Furniture**, **Base Items** and **Large Electronics** tabs.
   Each card shows what it costs (red where you're short) or how many you own; **Q / E** switch tabs.
   Pieces snap to a 3 m grid. With the **hammer**: LMB upgrades the material, **R reinforces** (Braced, then Plated —
   each +50% max HP), RMB repairs. You can also use the hammer to upgrade to **Wood → Stone → Sheet Metal → Armored**.
   Furnish it: chairs, tables, rugs, plants, paintings, lamps (real light), a sofa, bookshelf / wardrobe / fridge
   storage and a bed you can respawn in (workbench 1-2, placed from the menu's Furniture tab).
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
   hold loot crates that respawn, and **broken vehicles**: an ATV, the **Scout 4x4** jeep (short, long-wheelbase and pickup
   versions; every one you find is different: open roll cage, soft or hard top, snorkel, winch, roof rack, light bar, paint)
   and the huge futuristic six-wheel **Atlas Hauler**. Look at one and press E to install the parts it needs (wheels, engine
   parts, scrap, metal), add Low Grade Fuel, and drive.
9b. **Customize your guns.** Guns come bare (iron sights, plain barrel). Build a **Gunsmith Bench** (Workbench 2),
   craft attachments there — red dot, holo, 4x and 8x scopes, suppressor, muzzle brake, compensator, long or heavy fluted
   barrel, vertical/angled grip, laser, weapon light, bipod, extended / drum / quick-pull magazines, tactical stock — and
   press **🔧 Customize weapons** to fit them with a live 3D preview and stat bars. Every part changes the real stats
   (suppressed shots are quiet with no muzzle flash, scopes zoom, lights light up caves) and shows on the gun. Pick one of
   9 finishes (black, desert, olive, arctic, crimson, cobalt, chrome, gold).
9c. **The underground.** The whole island is solid ground you can walk into and dig through, all the way down:
   - **Cave mouths** open in some hillsides and lead into winding **tunnels** at every depth. **Ravines** cut deep cracks into
     the land, **caverns** open up from about 40 m down, and the deepest caverns, ~200 m below, floor out in **lava** (it burns).
     Some caves hold **underground lakes**.
   - **Dig anywhere** with a shovel: every scoop carves a smooth hole, and you can tunnel straight down, sideways or stairs.
     The deeper you go, the harder the ground: **Topsoil → Clay (5 m) → Stone (18 m) → Deepstone (60 m)**. Better tools scoop
     more (Shovel → **Steel Shovel** at Workbench 1 → **Power Drill** at Workbench 2, made with titanium and batteries).
     The dirt turns up **finds** that get better with depth: bones, cloth and scrap near the top, gears, pipes and ore lower
     down, HQM, tech trash and pearls deep down, and now and then a **buried chest**. Below 8 m you hit ore veins, below 12 m
     the cave minerals, below 20 m crystals. **RMB fills** a hole back in (3 stone). You can't dig under buildings or monuments.
   - It's **dark** a few metres in. Craft **Wall Torches** and stick them on any wall (only the nearest 8 give off light, so place
     as many as you like), and **Ladders** to climb back out of a shaft you dug.
   - **Bats** flutter about the caves, and **cave spiders** crawl the floors and bite (not on Peaceful servers).
   - The **Mines** (timber entrances) still drop you into the deep cavern band. Cavern crates hold good loot, and you can hide
     stashes and sleeping bags underground.
9d. **New places.** Lighthouses, crashed cargo planes, ranger cabins, mines, bunker complexes, abandoned villages,
   observatories and beached shipwrecks join the older monuments.
10. **Paint.** Craft a **Spray Can** (25 metal fragments, 5 cloth). Equip it and press **R** for the palette: 16 colours,
   16 decals (skull, flames, lightning, racing stripes, hazard, crown, graffiti tag…) and 3 sizes. **LMB** paints the vehicle,
   wall, door or furniture you aim at, **RMB** sprays the decal exactly where you aim (tinted in your colour), **X** cleans it.
   Paint jobs are saved and everyone sees them. Buildings need building privilege; haulers only their owner and clan.
11. **Mobile base.** The Atlas Hauler's flatbed is a ready-made 3×1 foundation: equip the Building Plan, aim at the deck and
   build walls, doorways, windows, floors, a second storey and stairs, then put in doors, boxes, a workbench or a bed. The first
   player to build on it claims it (owner + clan can build and open its doors). Everything moves with the truck, and you can
   walk around inside while a friend drives.

### Chat commands

| Command | What it does |
|---|---|
| `/spawn` | Opens the vehicle picker (also in the pause menu: **🚙 Spawn a vehicle / submarine**) |
| `/spawn atv\|jeep\|jeep4\|pickup\|hauler\|rowboat\|motorboat\|minisub\|pacific` | Spawns a working vehicle. Land vehicles go on a clear, flat spot in front of you (half a tank), never inside trees, rocks, buildings or other cars. Boats go on the nearest open water. **Submarines** (fully charged) go in the nearest water deep enough, up to ~450 m away and marked on your map, or **right beside you if you're diving**. 30 s cooldown (none on Creative servers), max 2 per player |
| `/unstuck` | Puts the vehicle you're in (or the nearest one) back on its wheels in a clear spot nearby |
| `/c message` | Clan chat |
| `/admin password` | Unlocks the admin commands (needs `ADMIN_PASSWORD` on the server) |
| `/password new` | Protect your name with a password / change it (sign in on other devices) |
| `/help` | Lists the commands |

**Admin commands** (after `/admin`):

| Command | What it does |
|---|---|
| `/items [search]` | Opens the item spawner: every item in the game with its icon, searchable — click to get a full stack (or 1 / 10 / 100 / 1000) |
| `/give <item> [amount]` | Gives any item by id or name, e.g. `/give assault rifle`, `/give c4 10`, `/give spray can` |
| `/tpdeath` | Teleports you to where you last died (to get your loot back) |
| `/resetserver` | Wipes the whole world for everyone (optionally a brand-new island). Asks you to type RESET and a one-time code, then confirm once more. Sign-in accounts are kept |
| `/cave` | Drop into the caves right below you |
| `/season spring\|summer\|autumn\|winter [late]` | Jump to a season |
| `/weather clear\|overcast\|rain\|storm [now]` | Change the weather (rolls in, or instantly with `now`) |
| `/time 14:30` · `/time 7am` · `/time dawn\|noon\|dusk\|night\|midnight` | Set the time of day for everyone (admins and the server's owner) |
| `/tp x z [y]` · `/tppoi [type]` · `/kit` · `/heal` · `/day 0-1` | Teleport, monument teleport, starter kit, full heal, time of day |

### Vehicle physics

Each vehicle is a rigid body with raycast spring-damper suspension on every wheel (four, or six on the hauler), tyre friction circles and an engine
torque curve. Grip and rolling resistance depend on the surface under each wheel (grass, dirt, sand, mud, snow,
rock, building floors); the jeeps' long-travel suspension, all-wheel drive and offroad tyres grip extra well off the road. Water adds buoyancy, drag and can flood the engine. The chassis collides with terrain,
trees, rocks, buildings and other vehicles; hard impacts damage the vehicle and its passengers, and you can run
over animals and players. Wheels kick up dust, mud, snow or spray depending on the ground.

### A living world

Wind moves through dense grass, flowers, ferns, reeds and the trees; birds and gulls circle overhead by day and bats
at night, butterflies drift over meadows, rabbits bolt when you get close, leaves fall in forests and fireflies come
out after dark — with birdsong, crickets, owls and waves to match. Deer graze, wolves sniff the ground, bears waddle.

### Seasons

The year turns for everyone: **spring → summer → autumn → winter**, each lasting two in-game days (~80 minutes).
In **autumn** the oaks, grass and ferns turn gold, orange and red and leaves blow about. Late autumn brings frost, and in
**winter** snow settles over the whole island (all but the hot desert): on the ground, rocks, monuments, roofs and the tops
of tree crowns. Pines sag under it, grass is pressed flat and frozen, flowers die back and everything gets a cold
glaze of hoarfrost with glinting ice crystals. Rain falls as **snow**, storms become **blizzards** (whiteout, no lightning)
and it's cold everywhere — wear warm clothes or stay near a fire. **Footprints and tyre tracks** stay in the snow for
everyone to see and slowly fill back in over an hour. In **spring** the snow melts and the flowers come back.
The tundra in the north stays snowy all year. Admins: `/season spring|summer|autumn|winter [late]`.

### Swimming, diving and frozen lakes

Deep water is for swimming: you tread water at the surface, swim where you look, and dive by looking down. Underwater
the light turns murky green-blue and darker with depth, sound is muffled, bubbles rise and you see the surface from
below. You can hold your breath for **30 seconds** (the 🫧 bar); after that you start **drowning**. Swim into a jetty, a
steep bank or the edge of the ice to climb out. Inland lakes and rivers are calm; the open sea has waves.

In **winter every inland lake and river freezes over** (from early winter until early spring). You can walk and drive on the
ice, but it's slippery for feet and tyres. A **pickaxe breaks a hole** through it in three blows (six from below), and so
does an explosion. Fall through and you're in freezing water; swim away from the hole and the ice is a ceiling above you.
Holes **freeze over again after 20 minutes**, and anyone still swimming under them is then **trapped under the ice**, unless
they have a pickaxe and enough breath to hack their way out.

### The sea: diving, sea life, wrecks, fishing, boats and underwater bases

- **Deeper oceans**: past the coastal shelf the sea floor drops away to ~100 m, with trenches, canyons and seamounts
  whose tops form reefs. The shallows have pale sand and sea-grass meadows; the deep is dark silt and rock.
- **Breath goes faster the deeper you are** (×2 at 35 m, ×4 at 100 m). **Diving Tanks** (Workbench 1) and **Twin Diving
  Tanks** (Workbench 2) go in the back slot instead of a bag and give 90 s / 210 s of air at the surface rate. They're
  used before your own breath, show on a 🤿 gauge with your depth, and refill when you're back in the air.
- **Sea life**: kelp forests that sway up toward the light, sea grass, coral reefs (branching, fans, brain coral,
  sponges), schools of fish that scatter when you swim at them, glowing jellyfish in the deep, and now and then a whale
  passing below with its song. **Sharks** patrol the open sea, circle swimmers and attack. They leave big fish, fat and bone.
- **Sunken sites** to explore, marked on the map: galleon wrecks, drowned temples, a submarine and a ditched cargo plane,
  with supply and elite crates (diving tanks and pearls among the loot).
- **Fishing Rod** (no workbench): aim at open water and cast, wait for the float to be pulled under, then click to
  strike. Different fish live in lakes, rivers and the sea, and big ones are more common in deep water. In winter, fish
  through a hole in the ice, where they bite faster. Cook fish at a camp fire. Sometimes you reel in an old boot, or an
  oyster with a pearl.
- **Boats**: wooden **rowboats** (oars, no fuel) on lakes and **skiff motorboats** (fuel) on the coast are moored along the
  shores, or use `/spawn rowboat|motorboat` beside water. They ride the waves, bank into turns and run aground on
  beaches. In winter a boat on a lake is **frozen into the ice** until you break the ice around it.
- **Underwater bases**: the new **Watertight Steel** building tier can be built in water of any depth. A room whose
  floor, ceiling and walls are all Watertight Steel holds **air**: you walk, breathe and stay dry inside, even on the
  sea floor. Walls get portholes, and doorways need a **Watertight Hatch** (Workbench 2). See *Base flooding* below for what happens under pressure.

### Submarines, cave minerals and the flooded caves

- **New cave minerals** (mine them with a pickaxe in the caves; each has its own colour in the rock): green **copper**,
  pink **lithium**, silvery **titanium**, white **quartz**, and blue **kyanite**, which is found only in the flooded caves
  under the sea. Lithium is richer down there too. The furnace turns them into Copper Wire, Lithium, Titanium Ingots and
  Toughened Glass.
- **Power**: Batteries (lithium + copper, Workbench 1) and Power Cells (2 batteries + titanium + glass, Workbench 2).
  Submarines run on charge. Like in Subnautica, you put the batteries in yourself: on the Mini Sub, look at the
  **battery hatch** on top at the back and press **E**. On the Pacific, use the **power cell rack** in the engine room.
  Drop Batteries (25) or Power Cells (120) into the slots; when the one in use runs flat the next one is used.
- **Fuel**: cars, the Atlas Hauler and the motorboat have a **fuel cap** (yellow ring: the left side of the jeeps, on
  top of the ATV's tank, on the boat's motor). Look at it, press **E** and put Low Grade Fuel in the tank.
- **Mini Sub** (kit at Workbench 2): a one-seat bubble-canopy sub with twin ducted thrusters. Hold the kit and click to launch it into deep enough
  water. **W/S** thrust, **A/D** turn, **Space** rise, **Ctrl** dive. It noses down to dive and banks into turns.
- **Pacific** (kit at Workbench 3, or `/spawn pacific`): a 37 m walk-in submarine, 8 m wide and 4 m tall inside, with
  a glass bow dome, a dorsal sail, lit portholes, sponsons and twin ducted screws. Swim underneath and climb in through
  the **floor hatch** with **E**. Inside it's dry and breathable, with no sea water in the hull even far below the surface.
  - **Bridge** (bow): the helm and captain's chair under a big glass dome, with side stations and a sonar screen.
  - **It comes empty.** Fit it out yourself: hold the Building Plan, pick deployables in the build menu and place
    lockers, boxes, workbenches, a fabricator, beds, furniture anywhere on the floor (wall items like torches and
    lights go on the walls). Walls, floors and stairs go on the deck marked in yellow amidships.
  - **Vehicle bay** (port side, amidships): a glass-walled bay with a bay door in its floor. The Pacific doesn't come with
    a Mini Sub; bring your own and drive it up under the bay door (under the hull) to dock it *inside*. You climb out
    into the Pacific and the Mini Sub recharges from its power. At the bay console press **E** to climb in and drop out
    through the bay door.
  - **Engine room** (stern): the drive, the **upgrade console** (**E**, modules) and the **power cell rack** (**E**).
  - **Flooding**: below its crush depth the Pacific springs **leaks** that fill it with water. Seal them with a Repair
    Tool and the water drains away. A wrecked Pacific floods completely.
- **Crush depth**: every sub has one, shown on the HUD with your depth. Below it the hull groans, shakes and takes damage.
  Open the **module bay** with **U** and fit **Depth Modules**: Mini Sub 60 → 130 → 220 → 320 m, Pacific 120 → 200 →
  290 → 400 m (MK3 needs kyanite). Also **Thruster Upgrades**, **Hull Reinforcement** and **Engine Efficiency**
  modules. Mini Sub has 2 slots, Pacific 4.
- **Base flooding**: underwater bases have a **hull integrity**, shown on your HUD inside. It starts at 10.
  Foundations (+1.2) and **Hull Reinforcement Frames** (+6 each, Workbench 2) add strength. Walls, floors and roofs take
  some away, doorways more, and portholes the most (−1.5). Those losses grow with depth. Below 0 the hull
  **springs leaks** at random spots, sooner the weaker it is. Each leak sprays water in and the room's water **rises**
  until it's full, and you have to swim to keep breathing. Weld leaks shut with the **Repair Tool** (hold LMB, Workbench 1).
  Once a room has no leaks the water slowly drains. Watertight Hatches keep the sea out open or shut. A missing or
  non-watertight piece leaves the room open to the sea.
- **Blue holes**: black sinkholes ringed by boulders on the sea floor. Swim or steer a sub down into one to drop into
  the **flooded cave systems** below the sea, ~170–240 m deep. You need at least an MK2 module for a sub down there.
  The caves are full of glowing anemones, with dark blue water lit by your lamp. Swim back up the shaft to return.
  Breathing down there is hard work: air goes four times as fast.

### Weather

The whole server shares one sky: clear spells cloud over, rain sets in and sometimes builds into a thunderstorm. Rain
streaks slant in the wind, splashes on the ground, darkens the land and pulls the fog in; trees and grass thrash in the
gusts. Lightning forks down with real flashes of light, and its thunder arrives later (count the seconds — sound travels
~343 m/s): a sharp crack when it's close, a long rolling rumble when it's far. A strike right on top of you hurts.
The rain sound is synthesised from thousands of individual drops (including the "plink" of drops on water), a pink-noise
wash and gusting wind; under a roof it turns into a muffled patter on the roof, and underground it's almost silent.
Admins can force it with `/weather clear|overcast|rain|storm [now]`.

### Flashlight, refiners and base power

- **Flashlight** (Workbench 1): a bright beam. **LMB** switches it on and off, **R** puts in a Battery (+50%) or a Power
  Cell (+100%). A full charge lasts 15 minutes; the charge shows on its slot. A **Charging Station** recharges it too.
  Other players see your flashlight beam (and a torch you carry) light up the night.
- **Bottles and salt**: hold an **Empty Bottle** and LMB in water. The sea gives **Salt Water**, lakes and rivers fresh
  water. Drinking a Water Bottle gives the empty bottle back. Refining Salt Water gives a **Water Bottle and Salt**. Salt
  cures meat into **Salted Jerky** at a camp fire.
- **Portable Refiner** (Workbench 1): place it anywhere. Put fuel (Low Grade Fuel, a Battery or a Power Cell) and
  something to refine in its storage: Salt Water, metal / sulfur / copper / lithium ore, quartz → glass, wood → charcoal,
  animal fat + cloth → fuel. Finished goods appear in the same storage.
- **Large electronics** (⚡ tab of the build menu, mostly Workbench 2). These need a base:
  - **Refinery**: mounts on a wall. It refines twice as fast, also does titanium ore and scrap. Uses 60 W.
  - **Salt Water Refiner**: mounts on a wall. In a base by (or under) the sea it **pumps sea water** on its own and fills
    its storage with Water Bottles and Salt (fresh water only, by a lake). It also takes Salt Water bottles. Uses 40 W.
  - **Charging Station** (25 W) and **Electric Wall Lights** (5 W) mount on walls.
  - **Power**: every machine in the same building shares one grid. **Solar Panels** make up to 50 W in daylight,
    **Fuel Generators** burn Low Grade Fuel for 150 W when the sun can't keep up, and wall-mounted **Battery Banks**
    store the surplus for the night. When power is short, the smallest loads (lights, chargers) keep running and the
    big machines wait. Open a machine (E) to see what it's doing and the base's power; **G** switches it off and on.
- **Camp fires and furnaces** can be put out with **G** and lit again. A cold fire doesn't cook, smelt or warm you.

### Armour and fighting

Armour is a trade-off, and fights stay quick: no combination stops more than **60%** of a hit, and the heaviest kit
slows you by at most 8%. Hover a piece in your inventory to see its numbers.

| Armour | Slot | What it's for |
|---|---|---|
| Burlap / Hide | head, chest, legs | cheap, warm-ish |
| Metal Facemask, Chest Plate, Roadsign Kilt | head, chest, legs | strong against everything, a little heavy |
| **Bulletproof Vest** (WB2) | chest | 50% vs bullets, weak vs melee |
| **Riot Helmet** (WB2) | head | 45% vs melee, 38% vs bullets, tinted visor |
| **Combat Trousers** (WB1) | legs | light all-rounders with knee pads |
| **Ghillie Suit & Hood** (WB1) | chest, head | barely any protection, but you look like a bush and your name tag can't be seen beyond 8 m |
| **Diving Wetsuit** (WB1) | chest | swim 40% faster and stay warm in cold water |
| **Arctic Parka** (WB1) | chest | very warm for winter and the snow |

Movement: sprint, **slide** (crouch while sprinting), slide-jump, and armour that never bogs you down.

### Survival

Hunger and thirst drain only while you're actually playing (not while logged off, or with the game tab closed or hidden); cook meat at a camp fire, eat berries, drink fresh water. Deer flee, boars
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
