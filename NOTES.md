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
