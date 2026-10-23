# SKYFARM: game design document

Short and concrete. Every tuning number will live in `game/data.js`; this file says why. Units are metres
and seconds, **Z is up** (the engine's convention). Updated whenever the design changes.

## 0. Art direction (the look is the point)

**Target:** a Studio Ghibli afternoon. Every screenshot should read as a finished game, not a tech demo.

| Role | Colour | Notes |
|---|---|---|
| Sky | `#9fd4f2` at the horizon → `#e8f6ff` near the sun; zenith a touch deeper `#7cc0ea` | painted gradient plus sun glow, never a flat fill |
| Grass | `#6fbf4a` base, `#9ad55e` mid, yellow-green tips `#c8e27a` | colour varies by a field (wetness, sun, flower density) so no two metres match |
| Earth / tilled soil | `#8a5a3b`, wet `#5e3b26` | tilled rows darker, wet soil glossy |
| Stone / cliffs | `#b8b2a6`, shadow side `#8f8a86` with a blue lean | layered strata on island undersides |
| Cloud | white `#fbfbf7`, shadows `#c9dcef` | soft blue shadows, warm rim on the sun side |
| Sun | `#ffe2a8` | key light, bloom source |
| Accent | roofs `#d0573f`, cloth `#e9d8b4`, flowers in 4 hues | small saturated accents on a calm base |

Saturated but never neon: the final grade caps saturation and keeps whites warm.

- **Lighting:** one warm low sun (`#ffe2a8`) on an arc, cool sky fill from above (`#a8c8ea`), warm bounce
  from the ground (`#9ab060`). Long soft shadows (cascaded, PCF). Golden hour (`#ffbf7a` sun, peach haze)
  and blue hour (`#6d86c0` fill, lanterns on) are the money shots and get their own grade keys.
- **Depth:** aerial perspective. Distance fades into a blue haze that is warmer toward the sun and denser
  near the cloud sea, so far islands become soft blue-grey silhouettes. This is what sells the scale.
- **Shapes:** chunky, rounded, hand-made. Islands are fat plateaus on top and hanging, layered rock below,
  with roots and vines falling off the edges. Roofs are thick and overhanging. Nothing is a bare primitive.
- **Landmarks:** every island has exactly one, readable as a silhouette from 1 km (giant tree, windmill,
  stone arch, waterfall, airship dock, bell tower). Table in §5.
- **Motion:** everything breathes. Grass waves in wind gusts that travel across the field, clouds drift and
  slowly change shape, cloth and windmill sails turn, creatures bob, pollen floats. A still frame never looks
  frozen.
- **Final image path (one pass, in this order):** HDR scene → soft bloom (sun, fireflies, glowing flowers)
  → exposure → filmic tone map → Ghibli grade (a 3D LUT stored as a 2D strip, warm highlights, lifted
  blue-green shadows) → gentle vignette. Grade keys per time of day, blended.
- **Readability before beauty:** ripe crops sparkle and bob; seeds and lost things glint gold-white with a
  chime; pollinator sprites glow soft teal; storms are dark violet-grey and build for minutes before they
  arrive. Every key thing also has an icon or shape, so it survives the colour-blind modes.
- **Validation:** 6 fixed camera views with screenshot baselines, compared after every visual change
  (`threejs-visual-validation`): (1) home island from the hut door, (2) wide shot of home over the cloud
  sea, (3) glide view toward the next island with haze, (4) grass close-up in wind, (5) waterfall off an
  edge into the clouds, (6) the High Rocks from below at golden hour. Each captured at noon, golden hour
  and in rain. The `threejs-aaa-graphics-builder` scorecard is run at stage 2 and at the end; the target is
  premium (no category below 2, average ≥ 2.3).

**Honest risk, and what I propose instead.** True raymarched volumetric clouds are too slow for the
target laptop (Intel UHD class, WebGL, where TIDEFALL's terrain shadows alone were 85% of the frame). So:

| Tier | Cloud sea below | Cumulus around islands | Grass |
|---|---|---|---|
| Low | a displaced, flat-shaded cloud mesh with painted lighting | mesh "puff clusters", flat toon-shaded | fewer, wider blades near, coloured ground beyond |
| Medium | same mesh, plus a quarter-resolution raymarched skin (≈16 steps) over the top only | puff clusters with soft scattering in the shader (sun-side rim, blue shadow, silver lining) | ~60k instanced blades within 40 m, wind in the vertex shader |
| High | raymarched skin at half resolution, more steps | same plus soft depth-faded edges | ~120k blades, longer range |

Low has to still look Ghibli: Ghibli clouds are painted, so a well-shaded mesh is on-style, not a
compromise. I'll measure Medium in stage 2 and drop the raymarched skin if it doesn't fit the budget.

## 1. Core concept

- **Hook:** glide between floating islands to find seeds, grow them at home, and build bridges that
  visibly stitch a broken sky back together. Unlike Stardew Valley or Animal Crossing, the map *is* the
  progression: travel is a skill (thermals, wind, stamina), and every bridge changes the world you see.
- **Audience and platform:** cosy, all ages 8+, laptop browser first (keyboard and mouse, gamepad),
  phone touch second. Sessions of 20–60 minutes; one in-game day is 20 minutes.
- **Genre and fantasy:** cosy open-world farming and exploration. You are the last gardener of the sky:
  calm, curious, and slowly making things whole.
- **Version 1:** 20 islands in 3 altitude bands, 11 crops, 5 hermits, 4 creature kinds, the merchant
  airship, bridges, glider upgrades, day/night and 4 weathers, the giant-tree ending, then free play.
  **Cut:** building your own house layout, animal husbandry beyond the fluffballs, fishing as a minigame
  (fish are ambient), crafting trees, more bands, multiplayer (optional stage 9 only, and only if you say
  so).

## 2. Gameplay and mechanics

- **Core loop:** plan the day at home → glide out (ride thermals, read the wind) → find seeds, materials,
  lost things, hermits → come home (or fall and wake up home) → plant, water, harvest → sell, cook, build a
  bridge → the world restores and the next island becomes reachable.
- **Moving:** walk 4.2 m/s, run 6.5 m/s (stamina), jump 1.1 m, coyote time 0.12 s, jump buffer 0.12 s.
  Jump off an edge or press jump in the air to open the glider.
- **Glider** (Paper Planes' model scaled to person size, same lift/drag/stall/turbulence structure, gravity
  9.81): cruise 11 m/s, stall 7 m/s, max 24 m/s, glide ratio 9 (sinks 1.2 m/s at cruise), full-bank turn
  60°/s, bank costs speed. Lift comes from **thermals** (warm rock, 2.5–4 m/s up, rising pollen marks
  them, birds circle in them), **ridge lift** on the windward side of cliffs, and **wind currents**
  between islands (ribbons and pollen streaks, 5–12 m/s along a curve). Thermals are at least 18 m in
  radius: at cruise and full bank the glider turns in about 10 m, so a narrower one can't be circled in
  (stage 1 measured this).
- **Stamina:** 60 s base. It drains 1/s while gliding in still or sinking air, 0 while rising in lift, and
  a gust boost costs 8. At zero the glider folds into a slow parachute drift (2.5 m/s down), so you can
  still reach a close island but not a far one. Landing refills it in 4 s. Cooked meals add up to +60 s
  for the day.
- **Falling** into the cloud sea is never a fail: fade to white, you wake in your hut. Seeds stay in the
  pouch (it's buttoned shut). Hardy produce you were carrying washes up on the home shore next morning;
  **fragile items (ripe fruit, eggs, star-lilies) are lost**. That is the greed decision (below).
  *(Changed in stage 1: losing your only seed for a day in the first five minutes would teach the wrong
  thing.)*
- **Farming:** till (hoe) → plant (seed) → water (can, or rain) → wait for growth stages → harvest
  (hands). Plots are 1 m tiles. Crops grow per in-game day (table in §4). Unwatered crops pause, never die.
  Growth shows continuously while watered, and at dawn every crop watered the day before counts that whole
  day, so a one-day turnip planted at noon is ripe next morning. One context button does the right thing
  for the tile in front of you (till, plant, water, harvest), or picks up what you're next to.
- **Rules of place:** each crop has an altitude band it grows in and some need rain or night. You can claim
  a small garden on any bridged island, so high-band crops need a high garden.
- **Pollinator sprites** visit flower clusters: a cluster needs 3+ flowers of 2+ hues within 5 m. A sprite
  near a crop patch gives +50% yield. Rare sprites want rarer combos (blue + white near water, star-lilies
  at night). It's a light placement puzzle, not a timer.
- **Win:** reconnect all three bands and bring the three Old Seeds (one from a hermit in each band) to the
  giant tree on the Crown. Cinematic, then free play. **No lose state.** The only danger is optional:
  storms.
- **Goals:** this minute: reach that island, water that row. This day: a full harvest, a meal, a bridge,
  the merchant. This game: wake the giant tree.
- **Difficulty curve:** Meadow gaps 120–250 m, calm air, thermals everywhere; Orchard gaps 250–400 m with
  crosswinds, needs thermal chains; High Rocks 350–600 m with stronger gusts, needs meals or upgrades. The
  ramp is in distance and wind, never in reflexes.
- **Risk vs reward:** fragile goods are worth 2–4× their hardy cousins (a star-lily sells for 60, frost-mint
  for 18). Gliding them home is fast but a fall loses them; walking them home needs bridges you haven't
  built yet. Storms add a second gamble: storm-amber (a glider upgrade material) only appears on Storm
  Teeth during a storm, when the gusts are strongest.
- **Agency:** which island today, which crops on limited plots, what to sell vs cook vs build with, which
  bridge first (each bridge restores a different thing and opens a different route).

## 3. Game feel

- Input applied the same tick; jump buffer and coyote time as above; glider opens in 0.15 s with a cloth
  snap.
- Feedback per action (visual / motion / audio): till (soil chunks fly, row darkens / small dip / dull
  thud), plant (seed pops in, soil pats / squash of the hand / soft tap), water (droplet arc, soil darkens
  and glints / can tilts / pour), sprout (tiny pop, two leaves unfurl / bounce / bell note), harvest (crop
  pops up and arcs into the pouch / squash-stretch, a 40 ms hold / pluck + rising chime), glider open
  (cloth ribbons, FOV +6° / lift bump / snap + wind swell), landing (dust, grass flattens / squash / soft
  thump; hard landing a roll), thermal entry (pollen spiral speeds up / camera lifts / wind tone rises),
  bridge built (planks drop in one by one / small shake per plank / wooden clacks then a rising phrase).
- Every shake, FOV kick and roll respects **reduce motion**, plus separate **reduced roll** and **reduced
  FOV kick** for the glide camera.
- **Cameras:** ground: third person, spring arm that never clips through rock or roofs, 55° FOV. Glide:
  chase camera, leans into turns (max 10°, 3° in reduced roll), FOV 60→72° with speed. **Reveals:** the
  first time a new island or landmark comes into view, the camera eases its framing for 2 s (player keeps
  control).
- Animation in three beats: hoe raises → strike → recoil; glider: crouch → jump → canopy snaps open.

## 4. Progression and economy

- **Carries over:** everything (it's one persistent world): farm, inventory, bridges, restorations,
  upgrades, hermit stories, the map.
- **Crops** (days are in-game days; value is merchant price in coins):

  | Crop | Band | Days | Needs | Yield | Use | Value |
  |---|---|---|---|---|---|---|
  | Turnip | Meadow | 1 | – | 2 | food, sell | 6 |
  | Rope-grass | Meadow | 2 | – | 3 fibre | rope (bridges) | 4 |
  | Sunflower | Meadow | 2 | – | 1 + seeds | pollinator magnet | 8 |
  | Moon-bean | Meadow (secret) | 1 | night | 3 | glows, sell | 14 |
  | Berry bush | Orchard | 2, regrows | – | 4 | food | 5 |
  | Sky pine | Orchard | 4 | – | 6 planks | planks (bridges) | 3 |
  | Cloud-cotton | Orchard | 3 | rain to finish | 3 fibre | strong rope, sell | 12 |
  | Apple tree | Orchard | 4, fruits every 2 | – | 5 apples (fragile) | food, sell | 10 |
  | Frost-mint | High | 2 | above 400 m | 3 | best meals | 18 |
  | Star-lily | High | 3 | rain or night | 1 (fragile) | sell, rare sprite | 60 |
  | Storm-bloom | High | 1 | planted in a storm | 1 | storm-amber, sell | 40 |

- **Spend:** bridges (rope + planks + iron fittings bought from the merchant), merchant goods (bigger
  pouch, watering-can upgrade, cookware, lanterns, decorations), meals (crops). **Glider upgrades are not
  bought:** sky-silk (Kite Cliffs), frost-glass (Glass Lake), storm-amber (Storm Teeth) → glide ratio
  9 → 11 → 13, stamina 60 → 90 → 120 s, and the gust boost.
- **Earn vs spend on paper** (one 20-minute day of a steady player, checked later by script):

  | Day | Plots | Coins earned | Main spend | Bridges done |
  |---|---|---|---|---|
  | 1–2 | 6 | 20–40 | pouch (30) | 0 |
  | 3–5 | 12 | 60–90 | first Meadow bridge (≈60 + 12 rope + 10 planks) | 1–2 |
  | 6–10 | 18 + high garden | 100–160 | Orchard bridges (≈90 each) | 5–7 |
  | 11–16 | 24 | 160–250 | High bridges (≈140 each), the Crown | all 12 |

  Target: the ending at about day 14–16 (≈5 hours) for a steady player.
- **Balance by script:** `tools/economy.mjs` runs seeded farmer bots (cautious, greedy, single-crop) for 20
  days. It checks that no crop's coins per plot-day is more than 25% above the median, that the ending is
  reachable by day 18 for the cautious bot, and that the greedy bot (fragile goods by glider) earns more on
  average but has a wider spread.
- **Retention:** the world itself (restorations), a hand-drawn map that fills in, a journal of seeds,
  creatures and hermit stories. No dailies, no streaks, no dark patterns.

## 5. Level design and world

The world is generated from a fixed seed, then hand-tuned; the result is stored as data
(`game/world.json`), so it is the same for everyone and can be designed. The cloud sea is at z = 0.

| # | Island | Band (top z) | Landmark | Role |
|---|---|---|---|---|
| 1 | Hearth Isle | Meadow (60) | red-roof hut, little broken windmill | home, first plots, the glider in the shed |
| 2 | Daisy Step | Meadow (55) | ring of standing stones | first glide (140 m, downhill, in a wind current), rope-grass |
| 3 | Willow Pond | Meadow (80) | dry waterfall (flows once bridged) | sunflower, fish, first bridge target |
| 4 | Fluff Downs | Meadow (70) | stone arch | fluffball sheep pasture |
| 5 | Bell Rock | Meadow (95) | bell on a crag | hermit Ona, Meadow Old Seed |
| 6 | Hollow Log | Meadow (30, hangs low) | giant hollow log | secret, moon-bean, seen only from below |
| 7 | Old Mill | Meadow (110) | big windmill | Meadow gate: restoring it raises a permanent updraft to the Orchard |
| 8 | Apple Terraces | Orchard (220) | huge apple tree on terraces | apple, berries |
| 9 | Merchant Dock | Orchard (240) | dock tower with a lantern | the airship moors here every 2 days |
| 10 | Kite Cliffs | Orchard (270) | kites on poles, ridge lift | hermit Pell, sky-silk |
| 11 | Pear Hollow | Orchard (230) | ruined chapel | sky pine, ruins secret |
| 12 | Twin Isles | Orchard (250) | broken arch between two rocks | cloud-cotton, a bridge puzzle |
| 13 | Beehive Spire | Orchard (300) | giant hive tower | hermit Mabel, rare sprites, Orchard Old Seed |
| 14 | Orchard Gate | Orchard (320) | water-wheel bell tower | Orchard gate: updraft to the High Rocks |
| 15 | Frost Shelf | High (430) | ice-blue crystals | frost-mint, high garden spot |
| 16 | Eagle Roost | High (480) | nest on a stone needle | hermit Tor, birds in big thermals |
| 17 | Glass Lake | High (460) | clear lake in a crater | frost-glass |
| 18 | Storm Teeth | High (520) | jagged spires | storm-bloom and storm-amber, strongest gusts |
| 19 | Lantern Ruins | High (560) | old observatory dome | hermit Iris (astronomer), star-lily, High Old Seed |
| 20 | Crown | High (650) | the giant tree | the ending |

- **Scale:** each band is about 1.4 km across, 3–5 minutes of gliding. Bridges connect islands inside a
  band (12 bridges in total); the gate islands' restored updrafts connect the bands.
- **Teaching without signs:** the first glide is short, downhill and inside a visible wind current; birds
  circle every early thermal; the first thermal sits right off Hearth Isle's cliff. Each next goal is
  framed by a landmark visible from where you stand.
- **Pacing graph:** home (calm) → glide (tension) → new island (release, discovery) → home (calm). Across
  the game: Meadow calm, Orchard wind, High Rocks cold and gusty, the Crown quiet.
- **Safe introduction:** thermals and gusts appear first over Hearth Isle where falling costs nothing;
  storms never come before day 4.
- **Secrets:** Hollow Log (below the Meadow), Pear Hollow's chapel crypt, a cave behind the Willow Pond
  waterfall, a sixth sprite kind, three lost journals.
- **Streaming and LOD:** full detail within ~250 m, a low-detail mesh to ~900 m, an impostor (a
  pre-rendered card lit by the current sun) beyond, all fading into haze. Island meshes are built
  in small slices so no frame loses more than ~4 ms; hitches are measured.
- **Check tool:** `tools/check-world.mjs`: no overlapping islands; every island reachable from home by
  glider with each upgrade tier (simulating glides through the real air field); each next landmark visible
  (line of sight, ≥ 1° tall) from the island before it; bridge spans 25–140 m with valid anchors; every
  band crossable within the stamina budget it's meant for.

## 6. Story and world

- A sky of islands once tied together by bridges and a great tree whose roots held the wind. A long
  storm broke the bridges and put the tree to sleep. The islands drifted, dried out and went quiet.
  Your grandmother was the last gardener; you wake in her hut with her seed pouch and her old glider.
- Protagonist: the new gardener (no name needed, chosen in the menu). No enemies: the "opponent" is
  distance, wind and the odd storm. NPCs: 5 hermits (Ona the bell-keeper, Pell the kite maker, Mabel the
  beekeeper, Tor at the roost, Iris the astronomer) and the merchant Captain Bram on his airship.
- **Delivery:** environmental first (dry grass, a stopped windmill, broken bridge ropes hanging into the
  clouds, grandmother's notes pinned around the hut), then short dialogue (3–6 lines per visit), and one
  cinematic at the end.
- **Tone:** warm, gentle, a little wistful, with small jokes. Applied to writing, music and colour alike.

## 7. Art and visuals

See §0. Additionally: characters and creatures are chunky, rounded, built in code (`img2threejs` method
for the player, the hermits and the merchant), outlined subtly by a rim term rather than black lines.
Colour-blind modes swap the crop-ready, sprite and storm cues to safe hues and keep their icons.

## 8. Audio

- **Music:** an adaptive score of piano and strings in layers (home, gliding, discovery, night, storm),
  crossfaded by state, never cut. Rain and storm duck the melody.
- **Wind** that rises with height and airspeed (filtered noise, two layers), birdsong per band, water,
  grass rustle near the camera, rain on leaves and roofs.
- A sound for every action and UI click. **Spatial:** waterfalls, birds, sprites, the merchant's horn and
  thunder are panned and attenuated.
- **Critical cues duplicated:** stamina low (a soft breath tone and a pulsing ring), a storm building
  (distant thunder plus darkening clouds plus a caption), the airship arriving (horn plus a caption).
- Buses: master / music / sfx / ambience / ui, ducking for cues. Captions for important sounds.
- **Sources:** procedural by default (Web Audio synthesis, ZzFX), plus the Kenney CC0 files already on
  disk in the other game folders. A synthesised piano will sound thin; if you want, I can propose CC0
  piano/string samples later and ask before downloading anything. Everything listed in `THIRD_PARTY.md`.

## 9. UI/UX

- **HUD:** almost diegetic. Time of day as a sun/moon arc top-left, the seed pouch and tool in a small
  bottom-centre strip that hides while gliding, stamina as a ring around the player only while it drains.
  Nothing else on screen by default.
- **Menus:** title (watercolour-tinted, the home island behind), pause, settings, the hand-drawn map, the
  journal, 3 save slots. Keyboard and gamepad navigable with visible focus.
- **First 5 minutes** (no text walls, the world teaches it): wake in the hut (0:00) → a seed glints on the
  table, the soil patch outside is already tilled → plant and water it (1:00) → grandmother's glider hangs
  in the shed (1:30) → the wind current and the birds point to Daisy Step; jump off the cliff (2:00) →
  land, find rope-grass seeds by the stones (3:00) → ride the thermal back home (4:00) → the first
  turnip has sprouted (4:30). One-line context prompts appear once, only if the player hesitates.
- **Accessibility:** remappable controls, captions, colour-blind modes, reduce motion, reduced roll and FOV
  kick, text scaling, an assist mode (stamina doesn't run out, gentler gusts), hold-to-toggle options.
- **Mobile:** joystick, glide stick, context button, safe areas; layouts from phone to ultrawide.

## 10. AI and creatures

Utility AI, structured like TIDEFALL's bots.

| Creature | States | Reacts to the player |
|---|---|---|
| Pollinator sprite | wander, seek flower cluster, pollinate, rest in a hive, flee | scatters if you run through, follows you if you carry a flower |
| Fluffball sheep | graze, wander, follow, flee, nap, huddle (rain) | curious when you walk, flee when you run, follow if fed a turnip |
| Birds | circle thermals, flock, perch, flee | take off as you approach, fly alongside a glider |
| Fish | swim, dart, gather at the surface | scatter at your shadow, gather when you sit at the pond |
| Merchant airship | scheduled route every 2 days, moor, leave | horn when it sights you; Bram waves |

**Fairness:** nothing chases or harms the player. Storms are the only danger and are telegraphed for
2–3 in-game hours (clouds tower and darken, wind picks up, distant thunder).

## 11. Technical

- **Targets:** 60 fps on a mid-range laptop (this PC, Intel UHD class) at **Medium** with clouds, grass
  and haze on; 30 fps on a mid-range phone at **Low**. Budget at Medium: ≤ 16.6 ms GPU-synced,
  ≤ 300 draw calls, ≤ 600k triangles. Measured by GPU-synced timing per tier, not by `loop.fps`.
- **Simulation:** the engine's fixed 60 Hz loop with interpolation; a pure, seeded `game/sim.js` (farm,
  growth, weather, day, economy) with no DOM, so tools and later co-op can run it. Player collision against
  the island heightfields and prop boxes, no tunnelling (stress-tested like TIDEFALL).
- **Weather per day (seeded):** clear 45%, breezy 30%, light rain 18%, storm 7% (never before day 4).
- **Day:** 20 real minutes: dawn 1.5, day 13, golden hour 2.5, blue hour 1, night 2. Sleep skips to dawn.
- **Save:** versioned schema with migrations, autosave on sleep and every 3 minutes, 3 manual slots,
  write-to-temp-then-swap in `localStorage`, clean fallback if storage is blocked.
- **Download and load:** no downloaded art (everything procedural), target under 3 MB and under 3 s to
  the first frame; memory measured with the whole world visited.
- **Co-op:** only stage 9, only after you agree (TIDEFALL/BREACH netcode, host's save is authority).

## 12. Process

The 9 stages from the game prompt, in order. Each one runs in the browser, is compared against the
baselines (from stage 2 on), logged in `NOTES.md` (skills used, techniques ported from the three.js
skills and how) and committed on branch `build` in this folder's own repo. `npm test` (sim and world
checks) and bot runs every stage, with an honest note of what a human should try.

Stage 1 is the greybox question: *is "glide over, find a seed, come home, watch it grow" pleasant?* I'll
tell you honestly, with numbers (glide time, how often a test pilot lands where it aims).

## 13. Release

- **Free.** No ads, no purchases.
- **Marketing:** 5 screenshots (golden hour, rain, night, glide, restored world), a 25 s trailer script,
  and a store blurb in `marketing/`.
- **Platform:** web; runs from any static host (`npm start` locally). An itch.io zip is prepared, not
  uploaded. Nothing pushed or deployed unless you ask.
- **Post-launch:** co-op, more bands, seasons, house decoration; known issues in the README.
- **Engine hand-back:** a list of what should move into Projection Lab (clouds, aerial-perspective haze,
  instanced grass with wind, the grade/LUT pass, impostors).
