# SKYFARM build notes

Working log: the skills used for each stage, the three.js techniques ported to Projection Lab and how, and
what was measured. Newest stage last.

## Before starting

- `threejs-game-director`: playable loop first, then the looks, then browser evidence; the premium bar is
  the `threejs-aaa-graphics-builder` scorecard (no category below 2, average ≥ 2.3). Its credential probe:
  `TRIPO_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` all **MISSING**, so every model, texture and
  sound is procedural.
- `threejs-gameplay-systems` (design brief, core loop contract), `threejs-aaa-graphics-builder` (the
  scorecard's categories, read for the art direction in GDD §0).
- Engine: copied from TIDEFALL's folder (`engine/`, `shaders/`, `vendor/`), which is `projection_library-v2`
  plus TIDEFALL's `Audio.js` that can also load recorded files. Z is up; GLSL ES 1.00; no gamma pipeline.

## Stage 1: prototype (`prototype-fast`)

Brief, as the skill asks:

- QUESTION: is "glide over to the next island, find a seed, come home and watch it grow" pleasant?
- CORE VERB: glide (with walking, planting and watering as the rest of the loop).
- THROWAWAY?: the greybox drawing (`world.js`), the stage-1 HUD in `main.js` and `index.html`. Kept and
  written to grow: `sim.js`, `islands.js` (the queries; the two islands become data in stage 3), `air.js`,
  `data.js`, `pilot.js`, `det.js`. They are pure and deterministic from the first line because tests, tools
  and later co-op need them that way.
- KEEP IF: the first loop fits in the first five minutes with no text, the glide to the next island lands
  where it aims with hands off the stick, and the way back needs one thermal (a small skill, not a wall).
- KILL IF: the glide is either trivial (no air to read) or a wall (needs precision to land).

What was built:

- `islands.js`: an island is a few numbers. The outline is the radius wobbled by three seeded sine terms
  around the circle; the top a value-noise plateau rounded over at the rim, with flat pads for the hut and
  the field; the underside a rough hanging cone. Rock is everything between, so the same function answers
  "where is the ground", "am I in rock" and the camera's ray.
- `air.js`: PAPER PLANES' thermal and turbulence lattice at world scale, plus a new wind current (a tube of
  moving air between two points). Pure function of position and time.
- `sim.js`: TIDEFALL's ground movement; PAPER PLANES' flight model at person scale (heading, path angle,
  bank, airspeed; drag chosen so the glide angle holds cruise; bank costs energy; stall drops the nose; the
  air carries the glider); stamina; landing and bumping off cliffs; falling into the clouds wakes you at
  home; 1 m plots with one context action; growth by watered time and by dawns; sleep.
- `pilot.js`: a test pilot that plays through the same inputs as a person, for the tools and screenshots.
- `world.js`: greybox scene (islands, hut, shed, stones, plots and crops instanced, the player and the
  glider wing, pollen up the thermals and streaks along the current, a simple sky and cloud sea).

Measured (`npm test`, the pilot playing the first loop with real inputs in Node):

| Step | Time |
|---|---|
| seed picked up | 0.8 s |
| planted, watered | 3.4 s, 3.7 s |
| first glide starts | 13.2 s |
| glide 1: Hearth Isle → Daisy Step | 8.9 s, 121 m, z 58.7 → 46.0, hands off (current carries it), lands on the island |
| glide 2: Daisy Step → thermal → home | 75.8 s, 177 m, climbs 44.7 → 99.0 in the thermal, lands at home with 29 s of stamina left |
| whole loop (pilot) | 104 s; a person will take 3–5 minutes |
| turnip sprouts | 243.7 s (inside the five-minute target), ripe the next morning |

Other checks: the same inputs give the same game (hash); six minutes of random input never leave the
player inside rock or a wall.

Bugs found by the tools and fixed:

- the pilot couldn't circle in a 10 m thermal: at cruise and full bank the turn radius is about 10.5 m.
  Thermals are now 18 m (GDD §2 updated). The climb went from 213 s to 18 s.
- a one-day turnip planted after sunrise was only 97% grown at dawn and then stopped (unwatered). Dawn
  now counts the whole watered day (GDD §2 updated).
- the island's top faced down (wound clockwise seen from above), so it was culled and the cloud sea showed
  through it.
- the HUD read the seed after the last one was planted (aim now runs again after an action).

Changed from the GDD: seeds stay in the pouch when you fall (losing your only seed for a day in the first
five minutes would teach the wrong thing).

Through real input (`npm run playtest`: headless Chrome on the GPU, in real time, keys pressed through the
engine's Input, steering from what's on screen): seed 0.8 s, planted 3.1 s, watered 3.3 s, glider 6.0 s,
glider opened 9.9 s, landed on Daisy Step 18.9 s, rope-grass seeds 20.4 s. No console errors.

Frame (`npm run inspect`, 1280×720, Intel UHD, greybox): 12 draw calls, 10–12 shadow draws, about 9,300
triangles; GPU-synced median 0.1–0.9 ms, worst 1.9–3.7 ms. These timings are not trustworthy on this
machine (gl.finish() on ANGLE/D3D11, see the engine's ARCHITECTURE §9.2); the counts are.

Honest verdict: **keep.** The loop fits the first five minutes with no text, the first glide lands with hands
off (the current carries it), and the way back needs one thermal climb, which is a small skill rather than a
wall. What I can't judge is the feel, only the numbers; a person should try it. Risks seen:

- the first glide is short (9 s): pleasant as a first taste, but the next ones must be longer and need the
  air read, or gliding will feel like a bridge with extra steps;
- the hut is cramped for the camera (6 × 5 m); it grows in stage 2;
- the engine's camera has no roll, so the glide camera can't lean into turns yet. Proposal for stage 2: add
  an optional roll to `Camera` (rotate right and up around forward), which every game would get;
- golden hour mixes a blue and an orange horizon into grey: the stage-2 sky must take its colours from the
  sun's height, not from a lerp between keys.

## Stage 2: look target (one island to final quality)

Skills read and used: `threejs-skill-router` (route by visual system; a no-post baseline that still reads;
deterministic inputs), `threejs-atmosphere-aerial-perspective`, `threejs-volumetric-clouds`,
`threejs-procedural-vegetation`, `threejs-exposure-color-grading`, `threejs-visual-validation`,
`threejs-procedural-fields`, `threejs-procedural-geometry` / `-architecture` (by their rules), and the
`threejs-aaa-graphics-builder` scorecard. All of them target three.js (most WebGPU/TSL); each technique below
was rewritten as GLSL ES 1.00 for Projection Lab's `ShaderMaterial` and `PostFX`. No three.js anywhere.

What was ported, and how (`game/gfx/`):

| Technique (skill) | In SKYFARM |
|---|---|
| Sky and aerial perspective share one scattering model (atmosphere) | `atmosphere.js`: Rayleigh + Mie + ozone with Earth's coefficients, analytic optical depth through exponential density (no LUTs: the "small scene" tier). One explicit scale (atmosphere m = world m × 8). The same maths in JS gives the sun's colour, the sky light and the bounce, so lighting and haze can't disagree. Tuned in Node with `tools/atmo-tune.mjs` against the palette (noon horizon #e4ebf1 vs the target #e8f6ff). |
| Cloud density organised by layer, per-layer wind, lit by the same sun (volumetric clouds) | `clouds.js`: **not raymarched** (see below). Cloud sea: a camera-following polar grid displaced by billow noise in world space, soft wrap light, blue hollows, silver rims, island shadows cast analytically along the sun. Cumulus: sphere clusters with flat bases and "volume normals". |
| Rooted wind with gust fronts, blade clusters, clumps, distance tiers (vegetation) | `grass.js`: 7-blade tufts per 8 m chunk from the fields; gust fronts that travel along the wind; the player's feet push grass aside; colour root → tip; translucency; mostly the ground's normal (a meadow lights as one surface); instance counts thinned by distance. Flowers share the shader. |
| Growth hierarchy, queue, stratified children, parallel-transport rings, crown-volume foliage normals, rooted card wind (vegetation) | `tree.js`: a 3-level oak species table, flared roots, lumpy leaf masses plus alpha-tested leaf cards that flutter about their root, whole-tree sway as a separate scope; bark measured in metres. |
| One field drives several channels (fields) | `fields.js`: meadow, wear (paths), flowers, hue, edge; they bake the ground colour and decide where grass and flowers grow and how tall. |
| Exposure → one tone map → LUT grade (grading) | Engine `PostFX.lut` (new, a 32-cube LUT as a 1024×32 strip after ACES); `grade.js` builds it from named moves (cool lift, warm highlights, mid-saturation "vivid" that never goes neon, a soft S). Exposure key from the light model, eased (faster up than down). |
| Fixed views, no-post baseline, numeric comparison (validation) | `tools/views.mjs`: 6 views × noon/golden, contact sheets, canvas metrics, a 640×360 baseline diff. Re-running gives a mean difference of 0.5–0.6 / 255 and under 0.1% changed pixels, so a real change will show. |

Engine changes (in this game's copy, to hand back to Projection Lab): `Camera.roll` (the glide camera leans
10° at full bank, 3° with reduced roll, none with reduce motion) and `PostFX.lut` / `lutAmount`.

Measured (`npm run perf`, this laptop's Intel UHD, headless Chrome, 1280×720, GPU-synced by readPixels after
40 frames):

| Tier | Hut door | Grass close-up | Home wide (golden) |
|---|---|---|---|
| Low (960×540) | 11.5 ms | 11.2 ms | 11.4 ms |
| Medium | 14.2 ms | 14.5 ms | 11.4 ms |
| High | 12.9 ms | 12.9 ms | 10.3 ms |

Medium is inside the 16.6 ms budget with clouds, grass, haze and shadows on: 48 draws + 18 shadow draws,
up to 500k triangles. The numbers move by about ±1.5 ms from run to run (High measuring under Medium is that
noise). The CPU side of a frame is 0.09 ms. Ablation (`npm run perf -- --ablate`): no single system dominates;
shadows ~0.5–3.3 ms, post ~0.6–2.3 ms, grass ~0.5–1.7 ms, the rest under 1 ms each.

Honest notes:

- **Volumetric clouds are not raymarched.** The skill's path (weather field, bounded march, temporal
  reconstruction) would cost several milliseconds here even at quarter resolution, and the whole frame is
  already 10–14 ms. The mesh clouds read as painted Ghibli clouds; the GDD's optional Medium raymarched skin
  is dropped unless you want it measured.
- **Low is not cheaper yet.** It renders at 0.75 resolution with one smaller shadow cascade and less grass,
  and still costs ~11 ms, so the floor isn't fill rate. Tiers get their real tuning in stage 8 (also on a phone).
- **Not the money shots yet:** the player is still a capsule with a scarf (the img2threejs character comes
  with the hermits in stage 6); the HUD is stage 1's; no waterfall, water or rain.
- Views 5 and 6 are stand-ins until stage 3 (GDD §0).

Scorecard (`threejs-aaa-graphics-builder`, genre equivalents: Hero = the gardener and the glider; Obstacles = the
air and the cliffs; Interactables = seeds, crops, plots; scored from the stage-2 sheets, the canvas metrics
above and the renderer counts):

| Category | Score | Why |
|---|---|---|
| Art direction | 2.5 | one palette and mood through sky, clouds, grass, roofs, rock and grade; golden hour and noon both on-model |
| Hero / player | 1 | the glider wing is authored; the gardener is a primitive capsule (an automatic failure until stage 6) |
| Obstacles (air, cliffs) | 1.5 | thermals and the current are visible as pollen and streaks; no storm or gust telegraphs yet |
| Rewards / interactables | 1.5 | seeds glint, crops show stages, the tile cursor; crops are still simple shapes |
| World / environment | 2.5 | foreground grass and flowers, a hut, fence, windmill, tree and rocks, the next island and cumulus behind, the cloud sea to the horizon |
| Materials / textures | 2 | a shared material language (plaster, timber grain, tiles, stone courses, strata, bark, moss) |
| Lighting / render | 2.5 | one atmosphere for sky and haze, shadows, a graded and exposed final image, a no-post baseline that reads |
| VFX / motion | 2 | gusts across the meadow, breathing clouds, chimney smoke, motes, pollen, the tree swaying |
| UI / HUD | 1 | stage 1's minimal HUD (stage 8) |
| Performance evidence | 2 | per-tier GPU-synced timings, ablation, counts, budget notes |

Average 1.85: not premium yet (needs 2.3, nothing below 2). The environment and light are at the bar; the
hero, the interactables and the HUD are what hold it down, and they are later stages' work.

## Stage 3: world and streaming

Skills used: `procedural-gen` (one seeded generator, validation before use), `level-design` (routes, sightlines,
landmarks), `threejs-procedural-fields` (bare-rock field for the High Rocks), `threejs-procedural-vegetation` (apple
and pine species; growth split into steps), `threejs-water-optics` (analytic ripples, Fresnel sky reflection, bank
foam; a falling ribbon for the waterfall), `threejs-performance` / `performance-optimization` (tiers, budgets,
measuring), `threejs-visual-validation` (views 5 and 6 re-pointed and every baseline re-locked).

What was built:

- `tools/make-world.mjs` → `game/world-data.js`: the 20 islands of GDD §5 from a skeleton (band, place, size,
  landmark), seeded detail (offsets, seeds, hills, depth, trees, a thermal off each island's south rim) and
  hand-tuned overrides (Hearth Isle and Daisy Step exactly as stage 1; two gate updrafts; 13 wind currents along
  the routes). 20 thermals, 13 currents, 52 trees.
- `game/landmarks.js`: every landmark as shape descriptors, one source of truth: the simulation boxes the solid
  ones (collision, in a 32 m grid), the renderer draws them all (`gfx/landmarks.js`).
- Ponds and streams are dug into `topAt` (capsules), so walking, grass and water agree.
- `gfx/stream.js`: three tiers per island (far: always built, a 22% mesh and a coarse landmark; mid within
  560 m: half mesh, landmark, trees, water, Hearth's buildings; near within 230 m: full mesh, grass, flowers),
  hysteresis on drop (760 m / 320 m), jobs as generators under a 3 ms/frame budget, GPU buffers freed on drop,
  shadows only within 160 m.
- `tools/check-world.mjs` (in `npm test`): overlaps, reachability by the real glide sim per glider tier, and
  landmark sightlines along the routes.

Measured:

- `npm run perf` (Intel UHD, 1280×720): Low 12.4–13.1 ms, Medium 14.5–16.3 ms, High 15.0–17.2 ms. Medium is inside
  16.6 ms, with little margin (stage 2 was 10–14 ms; the rest of the world is now in view: 96 draws + 22 shadow
  draws, up to 540k triangles at the hut door, of which ~460k is grass). The fixes that got it there: mid tier
  1100 → 560 m, shadows only near (106 → 22 shadow draws), cumulus balls 16×11 → 10×7, grass tiers 28/62 →
  20/46 m on Medium, leaf masses 9×14 → 7×11, the rock bump only within 90 m.
- `tools/stream-test.mjs` (a 5.4 km flight over every band at 45 m/s, four times glide speed, real
  requestAnimationFrame): the first run, before the budget fixes above, gave load to first frame 756 ms, 78 files,
  767 KB; median frame 13.9 ms, 99th percentile 23.8 ms, worst 62.5 ms, 4 of 9,217 frames over 33 ms; islands'
  geometry 19–34 MB as tiers come and go, JS heap 46–91 MB with no growth over the flight. Later runs on the same
  machine were much noisier (load 4–7 s, medians 15–21 ms) while the scene was at its heaviest; the run after the
  last fixes was not done, so that's the number still to confirm.
- The longest single build step found was the Crown's 42 m tree (24.6 ms in one step). Tree growth now yields
  every 6 branches and every 4 leaf masses. A near terrain mesh (~6,000 vertices, fields per vertex) is still one
  step and can take tens of milliseconds on a busy machine: the next thing to split if hitches show in play.
- `npm test`: everything passes; the first-loop pilot, the stress run and the real-input playtest are unchanged.

Findings to act on (honest):

- **The glider tiers don't gate anything yet.** Every tier reaches all 20 islands, because climbing in a
  thermal costs no stamina and the thermals reach high enough to cross each band. Progression must come from the
  gates (the Meadow and Orchard gate updrafts only rise once their island is restored, stage 5) and from making
  long climbs cost something (a slow stamina drain even in lift, or stronger sink between islands). Stage 5 will
  re-run the checker with that rule and tune it until the tiers separate.
- Islands still read alike in shape (all round loaves over cones); their landmarks and band colours tell them
  apart. More shape variety (twin rocks, terraces, long ridges) would help the far silhouettes.
- The Crown's giant tree is one big round crown: it needs its own species before the ending (stage 6).
- Windmill sails, kites and the bell-tower wheel don't move yet (restoration, stage 5).

Views: 5 is now the Willow Pond waterfall, 6 the High Rocks from below; all twelve baselines re-locked (views 1–4
changed by 6–26% because the rest of the world now shows behind them). `artifacts/stage3-sheet.jpg` (the six
views), `artifacts/stage3-tour.jpg` (every island's landmark).

## Stage 4: the farming loop

Skills used: `survival-crafting` and `rpg` read for the crafting/economy shape (a few recipes with a clear
payoff; balance by spreadsheet then by script), `game-ai` / `ai-behavior-trees-utility-ai` (the sprites'
states: seek, hover, scattered, leave; steering by arrive), `procedural-gen` (seed caches and gardens placed
from the world seed, validated against the islands' solids, ponds and trees), `threejs-procedural-vegetation`
(crop stages as rooted parts), `save-systems` not yet (stage 8).

What was built:

- `game/data.js`: all 11 crops (GDD §4 table, as tuned), sprites, meals, weather.
- `game/farm.js` (pure, used by the sim): growth while the soil is wet, faster in rain; night-only and
  rain-dependent crops; the dawn credit for crops without special needs; regrowing bushes and fruit trees; the
  seeded weather of every day (clear 46% / breezy 30% / rain 17% / storm 7% over 2000 days, no storm before day 4)
  with a rain window that waters the plots; flower clusters (3+ blooms, 2+ hues, within 5 m), sprites that come to
  them, hover, wander, scatter from a running player and pollinate (×1.5 at the next harvest); cooking.
- `tools/make-world.mjs` now also places 22 seed caches (each band's own seeds) and 3 gardens (Willow Pond,
  Apple Terraces, Frost Shelf), clear of solids, water, trees and each other.
- The sim: plots know their island and band (a frost-mint at home is refused with a reason), the stove in the
  hut cooks the best recipe the pouch can make, a meal adds to today's stamina.
- `gfx/crops.js`: growth stages for every crop from four shared instanced meshes, night flowers and sprites that
  glow (a new surface kind in the prop material), sparkles on ripe and pollinated crops. Rain falls round the
  camera and the light dims under it (the full weather pass is stage 7).
- HUD: every crop's name, the day's weather in the clock line ("rain at 11:00"), notices for the wrong band,
  meals, the first sprite.

Tests (`npm test`, all pass): weather frequencies; frost-mint and cloud-cotton refused at home; moon-bean 0% by
day and growing at night; cloud-cotton stops at 67% through three dry days and is ripe two days after the rain;
sprites arrive at a sunflower and berry garden and a pollinated turnip gives 3 instead of 2; a berry bush regrows
to 35%; two turnips at the stove make soup (+15 s).

Balance (`npm run economy`, new): single-crop farms of 6 plots for 20 days through the real rules. The first
numbers failed the GDD's rule badly (median 9 coins/plot-day; berries +300%, frost-mint +260%, apples +206%,
turnips +73%; moon-beans far too slow because the night is only 15% of a day). After tuning: 9.6–12.6 for every
field crop, nothing more than 25% above the median, safe glide or greedy (fragile goods counted at 75%).
Pollination raises any crop by 50–100%; storm-bloom (a storm-only rare find) is left out of the median.

Changed from the GDD: cloud-cotton needs rain once in its last third rather than for the whole of it (measured: the
strict rule took about two weeks per crop); the crop numbers above.

Measured: CPU per frame about 0.9 ms rendering and 0.9 ms simulation (the scene graph's update over the streamed
islands' entities is most of the latter). `npm run perf` Medium: 14.2–17.7 ms (hut door 17.7, up from 16.3 in
stage 3 and over the 16.6 ms budget there; the run-to-run noise is about ±1.5 ms, but Medium is at its edge and
the real tuning is stage 8's). The real-input playtest still passes; it reported 43 fps at the moment of landing
on Daisy Step (92 in stage 3), during streaming builds; not investigated further yet.

Not done here (later stages): selling (the merchant, stage 5), bridges needing the gardens' islands to be
bridged first (stage 5), storm planting and the rain's look on soil and stone (stage 7), saving the farm (stage 8).

## Stage 5: bridges, restoration, upgrades, the merchant

Skills used: `level-design` (gating by gates and tiers, checked rather than assumed), `game-feel` (the bridge
going up plank by plank, restoration easing in), `threejs-procedural-architecture` / `-geometry` (rope bridges,
the airship, Captain Bram), `game-ui-ux` (the trade panel), `procedural-gen` (anchors, hearts and material caches
placed by the generator).

What was built:

- `game/progression.js` (pure): 12 bridges with costs from their span (rope from rope-grass and cloud-cotton,
  planks from sky pine or bought, iron fittings bought), built at either broken end once paid, going up over 4 s;
  walkable decks with sag and rails; restoration (by bridge, or by waking a heart stone where no bridge goes);
  gates (the Old Mill's and the Orchard Gate's updrafts blow only once restored); the airship's schedule (every
  second day from day 2, moored off Hearth Isle 08:30–16:30); selling at each crop's value, buying fittings (8)
  and planks (5); the workbench upgrades (sky-silk → 11:1 / 90 s, frost-glass → 13:1 / 120 s, storm-amber → the
  gust boost, Shift in the air).
- World data: bridge anchors on the islands' rims, heart stones, the three rare materials, the mooring.
- Visuals: rope bridges (broken stubs hanging into the clouds; built ones drawn as a prefix while the planks go
  down), parched islands that green over four seconds when restored (terrain and grass, per island), the Old
  Mill's sails turning, Willow Pond's waterfall and pond only when restored, glowing heart stones, the airship
  flying in and out and Captain Bram at the gangway.
- HUD: coins, rope, planks, fittings and when the airship comes; prompts for every new action; the trade panel.

The design problem from stage 3, fixed and measured (`tools/check-world.mjs`): climbing in lift was free, so the
first glider reached all twenty islands. A sweep of the lift drain (0.3 / 0.6 / 1.0 per s) and a cold factor
above 400 m (1.5 / 1.8): at 0.6 and 1.8 every rule holds: the first glider reaches the Meadow and none of the
Orchard; the Meadow gate opens the Orchard as far as Kite Cliffs (sky-silk) but not all of it; sky-silk reaches
all the Orchard and Glass Lake but only 2 of the 6 High Rocks; frost-glass reaches everything. The lift drain
made the first loop's way home end on 0 s of stamina, so climbing stays free below 150 m (the Meadow): back to
23 s to spare.

Balance (`npm run economy`): the road to the ending. Bridges first cost one rope and one plank per 8 m and a
fitting per 25 m (281 / 281 / 94); with the farm growing as GDD §4 plans, the gates came on day 20 and all twelve
bridges on day 26. Two fixes: costs per 10 m and 30 m (227 / 227 / 80), and the model plans for all remaining
bridges rather than one at a time (it had idled plots). Now: both gate bridges by day 14 and all twelve by day 18
without pollinators, 12 and 14 with them, against the GDD's 14–16.

Tests (`npm test`, all pass): the bridge asks for what it's missing; paid for, it goes up and restores Daisy
Step; mid-span the feet stay on the deck and walking into the rail keeps you on; the 109 m bridge walked end to
end; the Old Mill's restoration turns its updraft on; Hollow Log's heart; the airship's mooring, selling and
buying; sky-silk at the workbench.

Not done or not checked:

- Storm-amber lies on Storm Teeth all the time; it should only appear during storms (stage 7).
- The airship never moors at the Merchant Dock; the dock is scenery for now.
- Bram has no dialogue yet (stage 6); the trade panel is the whole conversation.
- A person hasn't tried building a bridge, the trade panel or the gust boost; the playtest only covers the first
  loop. Frame time was not re-measured this stage (12 bridge meshes and the airship add up to 14 draws).
