<div align="center">

# SKYFARM

### Grow a garden on an island in the sky. Glide to the next one.

`JavaScript` · `WebGL` · `GLSL` · `Projection Lab engine` · `No build step` · `No three.js`

</div>

---

## The game

You wake up in your grandmother's hut on Hearth Isle, one of twenty islands that float above a sea of
cloud. A storm long ago broke the bridges between them and put the great tree on the Crown to sleep; the
islands drifted apart, dried out and went quiet. You have a seed pouch, a hoe, a watering can, and her old
glider.

- **Farm at home.** Till, plant, water, harvest. Eleven crops, each from its own band of the sky (Meadow,
  Orchard Isles, High Rocks), with their own rules: moon-beans grow only at night, cloud-cotton needs a
  rain, storm-bloom takes only if sown in a storm. Pollinator sprites visit flower clusters and make
  nearby crops give more.
- **Glide between islands.** Jump off an edge and open the glider. Bank, dive for speed, pull up. Stamina
  drains in still air; rising pollen marks thermals that lift you, streaks mark currents that carry you.
  Better gliders (sky-silk, frost-glass) go further; storm-amber gives a gust of speed. Fall into the clouds
  and you wake up at home, your pouch safe.
- **Stitch the sky back together.** Rope from rope-grass, planks from sky pines, fittings from Captain Bram's
  airship (it moors every two days and buys your produce). Each bridge you build greens the island it
  reaches. Wake the heart stones; restore the gates whose updrafts open the higher bands.
- **People and creatures.** Five hermits (Ona the bell-keeper, Pell the kite maker, Mabel the beekeeper, Tor at the roost,
  Iris the astronomer) with small stories and the three Old Seeds; fluffballs that graze and follow you if
  you carry turnips; birds on the thermals; fish in the ponds.
- **The ending.** The three Old Seeds at the Crown wake the great tree. Every island turns green. Then you
  keep playing as long as you like.

No combat, no time pressure. Storms are the only danger, telegraphed hours ahead: clouds build and darken,
the wind rises, thunder rolls far off, and a notice and a caption tell you.

Free, no ads, no purchases.

## Controls

| | Keyboard and mouse | Gamepad | Touch |
|---|---|---|---|
| Look | mouse | right stick | drag the view |
| Walk / steer the glider | W A S D (W dives, S pulls up) | left stick | left stick |
| Jump; in the air, open or close the glider | Space | A | Jump |
| Use (till, plant, water, harvest, pick up, talk, sleep, cook) | E or left click | X | Use |
| Next seed | Q | Y | Seed |
| Run | Shift | left stick press | |
| Pause | Esc | Start | |

Every action can be rebound (Settings → Keys and buttons). Menus work with the keyboard (Tab, Enter) and
with a gamepad (d-pad or stick to move, A to press, B to go back).

**Comfort and accessibility:** captions for every sound that matters (storm building, gusts, thunder, the
airship, sprites, breathing hard); cue colours safe for red-green or blue-yellow colour vision (every cue also
has a shape or motion); reduce motion (system setting or your own); less camera lean and less zoom while
gliding; three text sizes; look sensitivity, invert, field of view; "gentle skies" (stamina lasts longer,
gusts push half as hard); separate volume for music, effects and the wind and weather.

## Saving

The game saves itself every time you sleep, every three minutes of play, and when you leave the page. Three
more slots are yours (Pause → Save or load). Saves live in the browser (localStorage), versioned, and
written so that a crash mid-write leaves the previous save intact. Private windows may not keep them.

## How to run it

```bash
npm start
```

Then open http://localhost:8160. Any static file server works (the page is plain ES modules, no build).
`?quality=low|medium|high` overrides the quality setting.

An itch.io build: `node tools/build-itch.mjs` writes `dist/skyfarm-web/` and `dist/skyfarm-itch.zip`
(index.html at the root). Nothing is uploaded.

## How it's built

The author's own WebGL engine, Projection Lab (`engine/`, `shaders/`): Z-up, GLSL ES 1.00, entities, instanced
meshes, cascaded shadow maps, a post chain (bloom, exposure, ACES, a LUT grade). No three.js and no bundler;
the same modules run in the browser and in Node.

- **The simulation** (`game/sim.js`, `farm.js`, `progression.js`, `weather.js`, `dialogue.js`) is pure and
  deterministic: a fixed 60 Hz step, a seeded random generator, deterministic trigonometry (`det.js`). The same
  inputs give the same game bit for bit; tests and the test pilot run it in Node.
- **The world** is generated as data by `tools/make-world.mjs` into `game/world-data.js` (20 islands, the air,
  gardens, bridges, people) and checked by `tools/check-world.mjs` (every island reachable at the right
  glider tier, every bridge in range, every landmark visible from its neighbours).
- **The look** (`game/gfx/`): one analytic atmosphere (Rayleigh, Mie, ozone) for the sky, the aerial haze and
  the light; a painterly light model shared by every surface; a mesh cloud sea and cumulus (not raymarched);
  wind-swept instanced grass with travelling gusts; procedural trees, crops, props, characters and creatures;
  rain streaks, wet surfaces and puddles; a Ghibli LUT grade.
- **Streaming** (`game/gfx/stream.js`): each island has far, mid and near tiers, built as generator jobs
  under a 3 ms budget per frame and freed as you leave.
- **Sound** (`game/sound.js`): Web Audio buses with ducking and a limiter; synthesised wind, rain, thunder,
  birds, the airship's horn, an adaptive piano and strings score; ZzFX effects and eight Kenney CC0 files.
- **Saving** (`game/save.js`), **menus** (`game/menus.js`), **the first five minutes** (`game/tutorial.js`).

`GDD.md` is the design (with the art direction), `NOTES.md` the log of each stage (skills used, which three.js
techniques were ported and how, what was measured), `QA.md` the release checklist and test report,
`THIRD_PARTY.md` every outside file and technique.

## Measured

See `QA.md` for how each number was taken.

On this machine's integrated laptop GPU (the target in GDD §11), headless Chrome:

| What | Number |
|---|---|
| Frame time, GPU-synced, 1280 × 720, median of 5 runs | Low 8.7–11.3 ms · Medium 12.2–16.0 ms · High 12.0–16.7 ms |
| Real frame rate with "keep 60 fps" | 60 fps at 1920 × 1080 on Medium (it settles at 0.64 resolution scale; 32 fps without it) |
| Load | first frame in 1.2–2.0 s on localhost; 93 files, 961 KB; the itch zip 429 KB |
| Streaming, a fast flight over all 20 islands | median frame 12.6 ms, worst 44.3 ms, 16 of 9,322 frames over 33 ms |
| Memory, whole world visited | islands' geometry 7–29 MB, JS heap 46–96 MB, no growth |
| Draw calls / triangles on Medium | 90–118 / up to 584k |
| A save | about 6 KB |

## Tools

| Command | What it does |
|---|---|
| `npm test` | simulation tests in Node (determinism, the first loop by the test pilot, stress, farm, bridges, dialogue, storms, saving, the tutorial), the world check, the economy |
| `node tools/ui-test.mjs` | menus, saving and settings through the real page in headless Chrome, including a reload and a phone-sized window |
| `npm run playtest` | the first loop through real key presses in headless Chrome |
| `npm run views` / `views:lock` | the 6 baseline views at noon, golden hour and in rain, compared with the locked baselines |
| `npm run perf` (`-- --runs=5`, `-- --ablate`) | GPU-synced frame time per quality tier; the median over fresh pages; what each system costs |
| `npm run stream` | a fast flight over the whole world: load time, frame times while streaming, memory |
| `node tools/sound-mix.mjs` | the mix per situation, RMS and peak in dBFS |
| `node tools/shots.mjs` | the marketing screenshots |
| `node tools/build-itch.mjs` | the itch.io folder and zip |

## Known issues and next updates

Known issues (details in `QA.md`): not yet played by a person for long; the audio has been measured but not
listened to, and the synthesised piano is thin; no phone frame-rate number; Medium has no headroom at
1280 × 720 on this GPU (the adaptive resolution covers it); the Crown's great tree is too small for the
ending; the High Rocks' tops read patchy.

Next updates: a hand-drawn map and the journal; co-op for up to four players (stage 9, the TIDEFALL/BREACH
netcode, the host's save as the authority); CC0 piano and string samples for the score (a download, so
only if wanted); seasons; decorating the hut; more bands of sky.

Rendering that should move into Projection Lab, so the next game gets it for free:

| Feature | Where it is now | What to move |
|---|---|---|
| Analytic atmosphere (Rayleigh, Mie, ozone) for sky, aerial haze and the sun's light | `game/gfx/atmosphere.js`, `sky.js` | the GLSL chunk and its JS twin (`sunLight`, `skyAt`), the exposure key predicted from it |
| Mesh cloud sea and cumulus with painted lighting | `game/gfx/clouds.js` | the displaced sea mesh, puff clusters, the storm uniforms |
| Instanced grass with travelling gusts and player push | `game/gfx/grass.js`, the wind chunk in `common.js` | the tuft geometry, wind field, distance tiers |
| LUT colour grade | engine copy's `PostFX.lut` / `lutAmount`, `game/gfx/grade.js` | already in this copy's engine; hand back with the LUT builder |
| Camera roll | engine copy's `Camera.roll` | already in this copy; hand back |
| Draw order for opaque entities | engine copy's `Renderer` (`entity.drawOrder`) | hand back |
| Audio buses | engine copy's `Audio.play(opts.bus)` (from TIDEFALL), `game/sound.js` | the bus/duck/limiter mixer |
| Adaptive resolution | `game/main.js` (`keepFrameRate`) | a Renderer option driven by frame time |
| Shader pre-compile | `game/world.js` (`renderer.programFor` at load) | a `renderer.precompile(materials)` helper |
| Rain streak box, wet surfaces, puddles | `game/gfx/rain.js`, `common.js`, `terrain.js` | the streak box and the shared weather uniforms |
| Streaming with a per-frame build budget | `game/gfx/stream.js` | the generator-job scheduler |

## Credits

Design, code and the engine by Rohit Patil, built with Claude. Projection Lab builds on projection_library
by Rohit Sawant. Sound effects by Kenney (CC0). Fonts: Space Grotesk and JetBrains Mono (SIL OFL). Full list in
`THIRD_PARTY.md`.
