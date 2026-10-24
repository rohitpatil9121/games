# SKYFARM: QA and release report (stage 8)

The `threejs-qa-release` pass, run on 2026-10-24 on this machine (Windows 11, the integrated laptop GPU that
GDD §11 names as the target, headless Chrome on that GPU). Every number below can be taken again with the
command next to it.

## Result

Ready for an itch.io upload as a free web game, with the known issues at the end. Nothing was uploaded.

**Unresolved defects:** none that break play. The weak points are listed under Known issues; the largest
are that nobody has played it by hand for long, nobody has listened to the audio, and there is no phone
frame-rate number (no phone here).

## Automated tests

| Command | What it covers | Result |
|---|---|---|
| `npm test` | 48 checks in Node: determinism; the first loop played by the test pilot through real inputs; random-input stress (never inside rock); the farm (weather, every crop, bands, pollinators, cooking); bridges, restoration, trade, upgrades; dialogue (every line written, every entry reachable, the story end to end, the ending); storms (telegraph length, gusts, a storm glide, storm-only items); the first-five-minutes goal line; saving (round trip and 20 s of identical play after, a torn write, full storage, an old profile, no storage); then the world check (reachability per glider tier, bridges, sightlines) and the economy (crops within 25% per plot-day; every bridge by day 18) | all pass |
| `node tools/ui-test.mjs` | the real page: title focus, saving into slot 1 from the pause menu, the autosave on going back to the title, settings taking effect, every settings control labelled, a reload in the same browser (Continue, settings kept and in effect, the player where they were), loading slot 1, no console errors, every menu fitting a 375 px phone with the largest text | all pass |
| `npm run playtest` | the first loop through real key presses: seed 0.8 s, plant 3.1 s, water 3.4 s, glider 6.0 s, open 10.0 s, land on Daisy Step 19.1 s, rope-grass seed 21.5 s | passes, 59 fps |
| `npm run views` | the 6 baseline views at noon, golden hour and in rain (18 captures) against the locked baselines | every one within 1.1% of pixels changed (most 0.0%) after this stage's changes |
| `node tools/errors.mjs 6 dist/skyfarm-web` | the itch build, served on its own | no console errors |
| `npm run test:net` (stage 9) | co-op in Node through a simulated link: 150 ms ± 30, 3% late (and 300 ms ± 80, 8%): three join; a guest walking 12.7 m is predicted exactly (0.0 cm off at every snapshot, exactly on the room when stopped); a turnip one guest plants shows on every copy with the same seeds left; crops grow alike on every copy (6.9e-5 apart); two in bed don't end the day, the third does; a talk far from the hermit gives nothing, beside Ona it gives the shared pouch 3 seeds and only the talker is shown it; the host gets saves that load as a one-player farm; the host leaving closes the room and both guests are told | all pass |
| `npm run coop` (stage 9) | two real pages through the real server: Play together shows; host, join by code; each draws the other; the guest walks 2.9 m and the host's page has her within 0 cm once she stops; the host's autosave is written; the host leaves and the guest is back on a farm of their own | all pass |

**Harness decision:** yes, a visual harness (the 18 fixed views with baselines, plus the canvas metrics in
`tools/views.mjs`); it caught a real regression this stage (weather left over between captures).

## Exercised by hand in headless Chrome (screenshots in the stage 8 notes)

Title, pause, settings, saved farms; play on desktop (1280 × 720) and on a phone (390 × 844, touch emulated:
the stick and buttons, prompts that name the touch button, the pause button); larger text on the phone;
colour schemes; captions on and off; the inside of the hut (the camera now looks over the shoulder in tight
spots); rain, storm, night. Audio: unlocks on the first click or key; levels per situation measured by
`tools/sound-mix.mjs` (stage 7 numbers); volume 0 mutes (gain 0); music ducks 6 dB in a conversation.

## Measured

| What | How | Number |
|---|---|---|
| Frame time per tier at 1280 × 720 (Low renders at 960 × 540), GPU-synced, median of 5 fresh pages | `npm run perf -- --runs=5` | Low 8.7–11.3 ms; Medium 12.2–16.0 ms (hut door 16.0, grass 15.1, wide 12.2, storm 15.3); High 12.0–16.7 ms. Run to run the spread is about ±1 ms with five runs. |
| What a frame costs, by system (Medium, hut door, one run) | `npm run perf -- --ablate` | island rock 4.3 ms, shadows 2.8, post 2.5, props 1.4, grass 1.2, trees 1.1, landmarks 0.8, cumulus 0.6, water 0.6 |
| Real frame rate with "keep 60 fps" (adaptive resolution) | `node tools/fps.mjs W H quality` | 1920 × 1080 Medium: 32 fps at full resolution, 60 fps once it settles at 0.64 scale (10 s); 1280 × 720 Medium: 58–61 fps at 0.93; 1920 × 1080 Low: 60 fps at 0.93. 95% of frames under 25–28 ms (headless has no vsync, so frames alternate). |
| Load | `npm run stream` | first frame 1.2–2.0 s after opening on localhost (the two pre-compiled shaders added ~0.5 s); 93 files, 961 KB transferred; the itch zip 429 KB |
| Streaming, a 5.4 km flight over the whole world at 45 m/s (four times a glider) | `npm run stream` | median frame 12.6 ms, 99th percentile 27.8 ms, worst 44.3 ms, 16 of 9,322 frames over 33 ms; longest single build step 29–53 ms (a tree's growth on a busy run); before this stage's fix the worst was 366 ms, from the water shader compiling the first time a pond came into view |
| Memory with the whole world visited | `npm run stream` | islands' geometry 7–29 MB as tiers come and go (8–14 mid tiers, 2–6 near); JS heap 46–96 MB, saw-toothing with no growth over the flight |
| A save | `npm test` | about 6 KB of JSON |
| Co-op bandwidth, per client, three players (stage 9) | `npm run test:net` | down 13–14 KB/s as JSON, about 7 KB/s deflated message by message (ws keeps its dictionary across messages, so less on the wire); up 3.4 KB/s |
| The mix | `node tools/sound-mix.mjs` | home -28 dB RMS, gliding -24 to -21, night -33, rain -22, storm -20; peaks -6 dB or lower |

Budgets (GDD §11): Medium ≤ 16.6 ms is met at 1280 × 720 with no margin (16.0 ms at the hut door), and held
at 60 fps at any window size by the adaptive resolution; draw calls 90–118 (budget 300); triangles up to
584k on Medium (budget 600k), 713k on High.

## Release pass

- No build step: plain ES modules served as files. `node tools/build-itch.mjs` copies what the page loads into
  `dist/skyfarm-web/` (index.html at the root, relative paths only) and zips it.
- Debug and test helpers: `window.skyfarm` (the console hook every tool drives) stays in the build. It can
  only change the player's own local game, and the tools need it; documented here instead of gated.
- Host assumptions: any static host; localStorage for saves (private windows may refuse: the game says so and
  plays on). WebGL required (WebGL 1 works; the engine prefers 2).
- Deploy: upload the zip to itch.io as an HTML5 game, "This file will be played in the browser",
  1280 × 720 viewport with fullscreen allowed. Not done: the author publishes.

## Known issues

- **Co-op has only been tested by tools** (Node with a simulated link, and two headless pages on one machine), never by people on different machines or over the internet. A background tab stops sending input, so its gardener stands still for the others. The host's last 30 s are lost if the tab is closed between saves.

- **Not played by a person for long.** The tests, the pilot and the playtest show the systems work; whether
  the first hour feels good, whether the goal line is enough, whether storms are fair, needs someone playing.
- **Audio has been measured, not listened to.** The synthesised piano is thin.
- **No phone number.** Low on a phone starts at the screen's CSS pixels and lowers itself if it can't keep up;
  the phone frame rate is unmeasured.
- **Medium has no headroom at 1280 × 720 on this GPU** (16.0 ms); the adaptive resolution covers it.
- The Crown's great tree is too small for the ending's money shot, and the High Rocks' tops read patchy grey.
- Not built from the GDD: the map, the journal, hold-to-toggle options, the time-of-day arc on the HUD,
  a discovery music layer, waterfall and grass sounds.
- The first glide's camera looks down on the glider from behind; it frames the next island well but the
  wing hides part of it.
