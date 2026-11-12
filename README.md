# SPACE FARMER

*Mine rocks. Bolt on guns. Eventually, delete a planet.*

A browser game with two ships. You fly a modular **freighter** with real 2D rigid-body physics to
explore and mine asteroids, while your **fighter**, a stationary defense platform, works combat
contracts on its own, tower-defense style. Upgrade both, and eventually build a weapon that destroys
planets.
HTML5 canvas + vanilla ES modules. No build step, no dependencies, no external assets: all art is
drawn procedurally and all audio is synthesized with WebAudio.

![Shipyard](docs/screens/shipyard-1280x720.png)

## Defaults I picked (instead of asking)

- **How to run:** ES modules are blocked on `file://` by Chromium-based browsers, so the game ships
  with a zero-dependency static server: `node tools/serve.mjs` → <http://localhost:8000>. Any static
  server works (`python3 -m http.server`). If you double-click `index.html` in Chrome you get a short
  explanation instead of a black screen. Firefox may run it directly from disk.
- **Frames grow to 31×31.** Frame Extension has 12 levels (+2 cells each). The later ones are deliberately
  expensive and meant as a long-term money sink after your first planet.
- **Parts cost credits when placed and refund when removed**, scaled by the part's condition (so
  removing and re-adding a damaged part is never a free repair). Undo/redo in the Shipyard restores
  both the design *and* the credits.
- **Flight assist is on by default.** It drives gyros to hold or reach the requested spin and fires
  thrusters to cancel drift. It uses the ship's real thrusters and gyros, so a lopsided ship still spins
  when its gyros can't keep up. Press **T** for pure Newtonian flight.
- **Thrusters burn fuel; everything else burns power.** Fuel refills automatically (for a small fee)
  when you dock. Out of fuel you still have weak fuel-free core RCS jets, and you can always hold **R** to
  recall to the outpost.
- **Ship forward is "up" in the builder.** Thrusters push the way they point and need one empty cell
  behind them to vent. Lasers, railguns and the Planet Cracker need a clear cell in front.
- **Death** loses your cargo; insurance rebuilds the Command Core for free and everything else stays
  in the condition it was in (repair at the Market).
- **Two ships, running at the same time.** The **freighter** has no weapons; it explores, mines and
  hauls, and its space is peaceful. The **fighter** is a stationary platform at a defense post in a
  sector you choose. It works that sector's board of paid **combat contracts** (6 waves then the boss;
  8 waves in Gorvox) on its own while you mine, the hangar is open, or the game is closed.
- **Watch any time:** the status chip at the top of the freighter screen (or **V**, or the ⚔ Fighter
  tab) shows the fighter's fight. **Take control** to aim and fire yourself, then hand it back. While
  you watch, the freighter waits.
- **The fighter retreats instead of dying.** Below a hull threshold you set (default 30%) it jumps
  out, pays for repairs at 40% of the normal price, and redeploys 15 s later. **The contract isn't
  lost.** If it retreats from the same contract twice, it patrols the last cleared wave at 60% pay until
  you upgrade it. AFK bosses are allowed and pay big.
- **Upgrades apply where they make sense.** Research is tagged *Freighter*, *Fighter* or *Both*
  (cargo and mining for the freighter; weapons, shields and Fortification for the fighter). Each ship
  has its own parts and design. Existing saves had their freighter guns sold back automatically.
- **Offline:** while the game is closed, the fighter's contracts are resolved with the same ratings the
  board shows, paid at 50% and capped at 4 h.
- **Sectors** are separate jump destinations, each with its own outpost; harder rocks hold richer ore.
- **Autosave** to `localStorage` every 15 s, on dock, on purchase, and when the tab is hidden.
- **Target pacing** (economy bot, optimal play): first boss ≈14 min, a new sector every 10–15 min,
  planet destroyed ≈1h10m, with income split about 55% mining / 45% fighter. Expect 1.5–2.5 h for a
  human.
- Desktop first. Gamepad is supported in flight (standard mapping). The builder is mouse-driven.

## Controls

| Flight | | Shipyard | |
|---|---|---|---|
| W / S | thrust forward / reverse | Left click / drag | place part (drag paints) |
| A / D | rotate | Right click / drag | remove part |
| Q / E | strafe | R or mouse wheel | rotate part |
| X (hold) | brake: all thrusters against your drift, kills spin | | |
| V | watch your fighter (and back) | | |
| Space | fire mining lasers and railguns (turrets aim and fire themselves) | M | mirror mode |
| F | dock (near the outpost, moving slowly) | Middle click | pick up a placed part's type |
| R (hold) | recall to the outpost | Ctrl+Z / Ctrl+Y | undo / redo |
| C (hold) | charge the Planet Cracker | | |
| T | toggle flight assist | **Hangar** | |
| Wheel | zoom | Enter | launch (from any tab but Shipyard) |
| M | mute | Ctrl/⌘ + wheel, − / + | zoom |
| | | Arrow keys | pan |
| | | F / Fit | fit the whole frame |
| F3 | physics telemetry | | |
| Esc | pause | | |

**Gamepad:** left stick thrust, right stick turn, RT or A fire, LT brake, LB/RB strafe, Y charge the cracker, B dock.

**Watching the fighter:** Take control, then A/D turn the platform (to aim railguns or the Cracker),
Space fires, and hold C to charge the Cracker (it swings toward the planet for you).

## The loop

1. **Fly and mine.** Lasers cut rocks; ore chunks fly into your cargo pods. Full pods are heavy pods, and
   your center of mass shifts as cargo and fuel change.
2. **Dock and sell** at the Franchise Outpost (Market tab). Repairs and refueling happen there too.
3. **Build** in the Shipyard. Live stats show mass, thrust-to-weight, 90° turn time, off-center torque
   vs gyro authority, power balance, fuel endurance, mining rate and DPS, with diagnostics that warn
   about blocked exhausts, detached parts, power deficits, and ships that *will* spin.
4. **Build your fighter** in the Shipyard (switch to ⚔ Fighter): turrets, armor, shields, power, and
   gyros to swing railguns. It earns contract fees and bounties around the clock.
5. **Research** better prices, mining, health, weapons, part unlocks, bigger frames, and jump licenses.
   Each sector unlocks when your fighter beats the previous sector's boss.
6. **Put a Planet Cracker on the fighter**, post it in Gorvox, watch, aim at the planet and hold **C**.

The **Road to Doomsday** card in the Market always shows the next step.

## Playing on iPhone / iPad

The game runs in mobile Safari with touch controls (landscape only; portrait asks you to rotate).

1. On your Mac, start the server: `node tools/serve.mjs`. It prints an address like
   `On your phone (same Wi-Fi): http://192.168.1.23:8000`.
2. On the iPhone (same Wi-Fi network), open that address in Safari.
3. Optional: **Share → Add to Home Screen** to launch it fullscreen like an app.

If the phone can't connect, macOS may be blocking incoming connections: allow `node` when the
firewall asks, or check System Settings → Network → Firewall. To play away from home, host the
folder on any static host (GitHub Pages, Netlify, Vercel); no build step is needed.

**Touch controls**

| Flight | |
|---|---|
| Left thumb, drag anywhere on the left half | point-to-fly: the ship turns toward the stick and thrusts when facing it |
| FIRE (hold) | mining lasers and railguns |
| ⇠ ⇢ SLIDE | strafe sideways without turning |
| BRAKE (hold) | fire every thruster against your drift and stop spinning |
| DOCK | appears near the outpost |
| ⟲ (hold) | recall to the outpost |
| ❚❚ / A | pause / flight assist on-off |
| Fighter chip (top of screen) | watch your fighter; *Take control* lets the stick turn it and FIRE fire |
| CRACK (hold) | appears while controlling a fighter that has a Planet Cracker |

**Shipyard:** pick a tool (✚ Place, ✖ Erase or ✋ Pan) and tap or drag on the grid. Use two fingers to
pinch-zoom and pan. Tapping a part in the palette selects it and shows its stats.

## Dev sandbox

**DEV SANDBOX** on the title screen opens a separate save slot (`spacefarmer.sandbox.v1`) that never
touches your real progress. It starts with every research maxed (including a 31×31 frame), every boss
beaten and ¢1B. The hangar gets a **⚙ Dev** tab with:

- cheats: infinite credits, god mode, infinite fuel or power
- set credits, and raise or lower any research level (Max all / Reset all)
- toggle boss kills, set each sector's contract board position and planets destroyed
- jump to any sector, and reset the sandbox

While watching the fighter, a **dev bar** along the bottom spawns any enemy (+1/+5) or any boss, kills
everything, toggles god mode, repairs the platform, skips to the next wave and sets game speed (×0.25 to ×4).
**Save & quit to title** returns you to your real save.

## Content at a glance

- **17 parts**, each tagged freighter, fighter or both. Freighter: Thruster, Torch Drive (1×2), Fuel
  Tank, Cargo Pod, Tractor Coil, Mining Laser. Fighter: Autocannon, Railgun (1×2, real recoil), Shield
  Emitter, Planet Cracker (3×3). Both: Command Core, Hull Plate, Armor Block, Gyroscope, Reactor,
  Fusion Reactor (2×2), Battery. Reactors explode when destroyed, and parts cut off from the core detach.
- **6 enemies** with distinct AI: Scrap Gnat (orbit and strafe), Repo Lancer (wind-up ram), Toll
  Collector (standoff bursts), Ore Leech (swarms in close), Litterbug (mines), Complaints Dept. (homing
  missiles that turrets can shoot down).
- **4 bosses**, each with multiple phases built from spread, ring, spawn, charge, sweeping-beam and
  missile attacks.
- **5 sectors**, a **22-node research tree**, **9 presets** (freighters Pebble, Prospector, Excavator,
  Leviathan and *Lopsided Larry*, a demonstration of what off-center thrust does; fighters Bastion,
  Bulwark, Citadel and Doomsday Bastion), and blueprint save/load/export/import as share codes (`SFBP1:…`).

## Adding content

**Every number lives in [`js/data.js`](js/data.js)**: parts, enemies, bosses, sectors, research, presets,
economy and physics constants.

**A new part:** add an entry to `PARTS`. Behavior comes from its fields, so most parts need no code:

```js
bigCargo: {
  name: 'Cargo Barn', cat: 'utility', w: 2, h: 2, mass: 3, cost: 400, hp: 160,
  desc: 'Holds a frankly irresponsible amount of ore.',
  cargo: 100, unlock: 'refinery',          // research id that unlocks it, or null
},
```

Recognized fields: `thrust`/`fuelUse`/`exhaust`, `torque`/`powerUse`, `gen`, `battery`, `fuel`, `cargo`,
`armor`, `magnet`, `mining`/`laserRange`/`enemyDps`, `weapon {damage, rate, range, speed, energy,
recoil, pierce}` (with `directional: true` for fixed forward guns), `shield`/`shieldRegen`,
`explode {damage, radius}`, `cracker {...}`, `muzzle`, `directional`, `unique`. The category picks the
colour. To give the part its own icon, add a `case` to `drawPart()` in [`js/render.js`](js/render.js); without
one it draws as a coloured plate.

**A new enemy:** add an entry to `ENEMIES` with an `ai` key (`orbit`, `ram`, `standoff`, `leech`,
`mines`, `missiles`), a wave `cost` and a `threat` (estimated damage/s, used for difficulty ratings), then
list it in a sector's `enemies`. A new behavior is one more `case` in `EnemySystem.ai()` in [`js/enemies.js`](js/enemies.js).

**A new boss:** add an entry to `BOSSES` with `phases` (each a list of attacks:
`spread | ring | spawn | charge | beam | missiles`) and set it as a sector's `boss`.

**A new research node:** add an entry to `UPGRADES`. Effects are summed by `upgradeEffects()` in
[`js/economy.js`](js/economy.js); parts reference node ids through `unlock`.

## Tools (self-check)

```bash
node tools/serve.mjs              # play at http://localhost:8000
node tools/bot.mjs                # headless economy bot: timeline of one full playthrough
node tools/bot.mjs --runs 20      # pacing spread across 20 seeded runs
node tools/check-presets.mjs      # validates every preset (connectivity, exhaust, warnings)
node tools/playtest.mjs 300       # real game in headless Chromium, autopilot mines/docks/sells
node tools/playtest.mjs 300 excavator
node tools/screenshots.mjs        # key screens at 1280×720, 1920×1080, 1024×768 → docs/screens
node tools/arena.mjs 10           # REAL fighter sim: each fighter preset vs every sector's board
node tools/arena-detail.mjs citadel 2 1   # per-contract real results vs the rating model
node tools/fighter-ratings.mjs    # rating model only: every preset vs every wave and boss
```

`playtest.mjs` and `screenshots.mjs` need Playwright with Chromium installed. The autopilot
([`tools/autopilot.js`](tools/autopilot.js)) flies the real ship through the real physics and
fast-forwards game time. Its measured trip times calibrate the economy bot's model, and the arena
tools calibrate the fighter side.

## Code map

| File | What it does |
|---|---|
| `js/data.js` | all tunable numbers and content tables |
| `js/shipdesign.js` | blueprint grid, placement rules, connectivity, mass/COM/inertia, builder analysis |
| `js/ship.js` | runtime rigid body: thruster allocation, gyro flight assist, power, weapons, damage, detachment |
| `js/world.js` | sector: asteroids, ore pickups, projectiles, collisions (spatial hash), outpost |
| `js/fighter.js` | the fighter: its own arena world, auto contracts, AI aim, retreat and repair, offline resolution |
| `js/enemies.js` | contract waves, AI behaviors, bosses, mines, missiles, beams |
| `js/contracts.js` | contract wave lists, payouts and difficulty ratings (shared with the bot) |
| `js/planet.js` | the planet, cracker charge, destruction cinematic and reward |
| `js/economy.js` | pure rules shared with the bot: prices, research effects, rewards |
| `js/render.js` | procedural part icons, ship sprites, asteroids, starfield |
| `js/particles.js` | pooled struct-of-arrays particles and floating numbers |
| `js/audio.js` | WebAudio synth effects, engine/laser loops, generative music |
| `js/game.js` | state machine, loop, save glue, HUD prompts |
| `js/ui/*` | hangar, builder, research/star map/goals, tutorial, HUD, DOM helpers |
