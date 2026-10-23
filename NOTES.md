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
