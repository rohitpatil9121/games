# TIDEFALL build notes

Working log: decisions, which skill was used for what, what was measured. Newest stage last.

## Skills read before starting

- `router`: routes "three.js" work to the `threejs-*` skills; Projection Lab isn't in its table, so the
  three.js skills are used for technique and translated to the engine's own API.
- `threejs-game-director`: playable loop first, then visuals, then browser evidence; keep a progress file
  (this one); scorecard from `threejs-aaa-graphics-builder`. Its asset-credential probe ran:
  `TRIPO_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` all MISSING, so every model, texture and sound
  is procedural (or a CC0 file already in BREACH's folder).

## Stage 1: prototype the tide (`prototype-fast`)

Brief, as the skill asks:

- QUESTION: is racing the flood back to camp fun, with loot that weighs you down?
- CORE VERB: run out as the water drains, grab, run back before it returns.
- THROWAWAY?: the greybox drawing (`world.js`) and the stage-1 `main.js` are throwaway. `tide.js`,
  `island.js` and `sim.js` are written as keepers, because the netcode in stage 4 needs them pure and
  deterministic from the first line, and rewriting them would only change their names.
- KEEP IF: a greedy runner both banks more and loses more to the flood than a careful one (a real choice).
- KILL IF: the timings make greed always right or always wrong.

What was built: seeded island (radial profile + noise, four camps, three rings of ruins, wreck pieces),
tide as a pure function of seed and tick, wading, swimming, sinking when heavy, breath, dropping heavy loot
when it runs out, pick-up, drop, banking, grapple, all in `sim.js`. Greybox renderer, third-person camera.

Instrumented playtest (`prototype-fast` step 5: measure the thing being judged): a scripted runner with a
greed limit (kg it fills up to before heading home) played full six-tide matches in Node.

| Greed | Seed 4242: banked | Lost to the flood | Times the flood took heavy loot |
|---|---|---|---|
| 3 kg | 520 | 0 | 0 |
| 7 kg | 480 | 0 | 0 |
| 12 kg | 640 | 290 | 5 |

The greedy runner banks the most and also drops the most into the sea: that is the choice the design
needs. On seed 999 the runner walked into a ruin wall and stayed there: straight-line steering isn't
enough, so bots (stage 6) need a path grid.

Honest verdict: the loop has the tension it should (the flood is fast at the start, so the deep ring is a
real gamble with an idol, and the shallow ring is safe and cheap). Two risks seen: swimming out during the
ebb is slow (2.5 m/s over 30+ m), which may feel like dead time; and I can't judge the feel of the
controls myself, only the numbers. Kept.

## Stage 2: seeded island (`procedural-gen`, `level-design`)

- `procedural-gen`: one seeded generator threaded through generation (`makeRandom`), value noise with two
  octaves, a weighted loot table per depth tier (`LOOT_TABLE`, `rollLoot`), and validation before a map is
  handed to players: `game/fairness.js` checks an island and `fairIsland()` skips to the next seed if one
  fails. The room will send only the seed that passed.
- `level-design`: metrics first (jump 1.31 m, mantle 1.45 m, so the stepped ruin's 1.05 m tiers are a
  climb and the arch's 5.5 m top needs the grapple); the critical path is camp, beach, ring, back; fairness
  by sectors.
- Fairness, the hard part. First run of the checker: 10 of 18 islands failed, with up to 25% difference
  between camps. Two causes: noise made one camp's slope to the sea longer, and the 8-neighbour path grid
  itself measured diagonal directions 8% long. Fixes: the noise is sampled with the angle multiplied by
  the team count (the point's direction raised to that power as a complex number, so no atan2), which
  makes the terrain repeat exactly in every sector; ruins turn to face the centre by quarter turns; the
  path grid uses 16 directions (under 3% error); rocks moved off the ruin lines. Now 56 of 60 pass as
  generated (all 2- and 4-team islands), the 4 three-team failures pass on the next seed, worst spread
  played 11.4% against a 12% tolerance. Three teams can't be exact, because a square grid and
  axis-aligned ruin boxes don't turn by 120°.
- Change from the brief: the shipwreck is broken into one piece between each pair of neighbouring camps.
  A single wreck can't be the same distance from four camps.
- `nav.js` (Dijkstra fields over the heightmap nodes, speed by water depth) started at 35 s for one check
  because a float32 distance field kept re-relaxing nodes; doubles fixed it: 4 ms per field.

## Stage 3: movement feel (`physics-tuning`, `camera-systems`, `input-systems`, `game-feel`)

- `physics-tuning`: fixed 60 Hz step with render interpolation (already the engine's Loop); no tunnelling,
  because the fastest thing (grapple pull, 19 m/s, 0.32 m a tick) is slower than the thinnest wall plus
  the body's width (1.0 m). Verified by stress rather than argument: `tools/test.mjs` drives 8 players
  with random input for 4 minutes and checks every tick that nobody is inside a ruin or under the ground.
  It found one real bug on the first run: walking down off a 0.4 m platform snapped the feet to the
  terrain *under* the platform. Fixed (box tops first, then terrain). The swimming spring bobbed
  (3 crossings of the rest height); damping raised to just over critical (6.6 against 2·√9 = 6): 0 now.
- `input-systems`: actions, not keys; per-device bindings (keyboard/mouse, gamepad, touch); edges for
  discrete actions; a radial deadzone rescaled from its edge (the engine's is per axis); input buffering:
  a jump pressed up to 7 ticks early, a pick-up up to 9 ticks early; coyote time 7 ticks. Buffering lives
  in `sim.js`, so the server and the predicting client agree on it.
- `camera-systems`: `game/camera.js`, an over-the-shoulder orbit on a spring arm (ray against terrain and
  ruins, in at once, out slowly), exponential smoothing in real time, a small lead in the direction of
  travel, kept off the water's surface, and an eased `under` value for the underwater fade.
  Aim: tools leave from the head, which is beside the camera, so on the tick a tool is used the client
  aims from the head at what is under the crosshair. The crosshair turns into a ring when the grapple
  would reach.
- `game-feel`: splashes going in and out of deep water, a glint on pick-up and banking, a small shake on a
  hard landing and when the flood takes your loot, a wider view while the grapple pulls.
- Tests: 13 pass (stress, determinism, floating, bobbing, swim speed 2.58 m/s, sinking with an idol and
  letting go after 9.2 s, ledge climb, coyote, jump buffer, grapple, tide monotonic and smooth).

## Stage 4: BREACH's net skeleton

Copied and adapted, not rewritten: `server/server.mjs` (static files + `ws` on one port, 4-letter rooms,
quick play, per-address limits, the 60 Hz clock; port 8150 so it can run beside BREACH's 8140),
`server/room.mjs` (input queue with time credit, lag compensation from the reported view tick, bot fill,
rate limits, per-client delta snapshots), `game/net.js` (Loopback, SocketTransport, Conditions, Client
with prediction, reconciliation and interpolation), `game/protocol.js` (binary `in` and `snap`, JSON for
the rest). `ws` was copied from BREACH's node_modules (8.22.0), not downloaded.

What changed for TIDEFALL:
- The tide needs no bandwidth: `welcome`/`start` carry the island seed and team count, every client
  generates the same island and computes the water from the tick.
- Prediction needs the water level, which depends on the tick an input lands on. The client counts it:
  an input acknowledged by the snapshot for tick T landed on T, so pending inputs land on T+1, T+2…
  Replays use those levels.
- Snapshots carry loot (changed items and ids gone) instead of pickups and rockets; your own player
  includes the grapple point and every cooldown, so a replay starts from exactly the server's state.
- A room makes its island with `fairIsland()`, so an unfair seed is skipped before anyone sees it.

Verified: server up, `/status` answers; tab A created room KGUC, tab B joined it by code; both had the
same island seed and were put on different teams. B walked 20 m; B's last reconciliation error was
0.0000 m; A's interpolation drew B at (-12.12, -0.39), exactly where B was. Practice runs the same Room
in the page. No console errors in either tab, none in the server log. Bug found on the way: the
transport's held messages were only pumped once an island existed, and the island arrives in a held
message; the pump now runs first.

## Stage 5: rivals

Rules (all in `sim.js`, decided by the authority; tested in `tools/test.mjs`, 26 tests now):
- Shove: 2.1 m reach, a 63° cone, 1.2 s cooldown. From in front: one item knocked loose, 0.45 s stagger.
  From behind (the target facing away from the shove): two items, 1 s stagger, 25% more knockback.
  Never your own team. Lag-compensated like BREACH's shots, capped at 12 ticks (200 ms): the test shows
  the same shove landing with the rewind and missing without it.
- Picking up something a rival dropped by being shoved counts as a steal.
- Flare: marks a spot for your team for 12 s; dazzles rivals within 9 m who are looking toward it and
  can see it (white-out for 2.4 s). Line of sight is taken from 0.5 m above where it lands (a bump in the
  sand next to a flare otherwise hid it).
- Banking only at your own camp; after six tides the richest team wins; results stay up 14 s; then a new
  island.

Presentation: `game/hud.js` (the `game-ui-ux` / `threejs-game-ui-designer` hierarchy: survival, then the
objective, then status, then feedback): tide pips and a four-colour cycle bar with a marker, seconds left,
water rising/falling, banks sorted with yours marked, what you carry with a weight bar that marks the
4 kg swimming limit, a compass arrow and distance to camp, breath, a red edge pulse when the flood comes
and you're out with loot, a feed, world markers (your camp, your team's flares, teammates, anyone
carrying an idol), the scoreboard on Tab and the results. World: flares are a light, a glowing ball and
embers; ropes for every grappling player; a puff of sand (or spray) where a shove lands.

Verified in the browser: Practice with bots: a flare and its marker; a shove from behind knocked a
bot's idol loose, feed line "Rohit-B shoved Cutter from behind"; results "Coral wins, next island in 14 s",
then a new island. Online in two tabs (room WRWP): Bravo walked across the island and shoved Alpha;
both feeds showed it, Alpha's client was moved 3.3 m by the knockback through reconciliation, Bravo's
prediction error stayed 0.000 m.

## Stage 6: bots (in progress, not finished)

`game/bots.js`: utility AI (loot / home / steal / defend / rest, response curves, hysteresis), greed per
bot, skill changes reaction time and how well it judges the flood. Movement walks a nav travel field.
`tools/bot-match.mjs` runs whole matches through the real Room. First run, 2 matches, 4 teams of 2:
bots bank 590-1720 per team, 93 shoves, 50 steals, 0.96 ms average tick (79 ms worst: travel fields).

Not done yet: the flood never caught a bot (0 lost to the sea), so greed isn't biting; greedy bots bank
*less*; camps 2 and 3 banked less in both matches (needs more matches to tell bad luck from unfairness);
the 79 ms worst tick needs fields spread over ticks. Then stages 7 (looks), 8 (audio, HUD polish),
9 (net-test at 150 ms, settings, rebinding, touch, README, THIRD_PARTY, QA report).

## Stage 6 finished, stages 7 and 8 (see NOTES.md for the skills)

Stage 6: greed range widened to 0.7–1.6 and applied on the way home too (the flood now catches bots:
7 heavy-loot losses and 2 drownings in 12 matches, from 0); a budget of one travel field per tick across
all bots; a 2.5 s guard after being shoved (bots were stripping carriers with chains of shoves: 559 shoves
and 297 steals in 12 matches). Balance runs: see the stage-9 report.

Stage 7 (looks): `tools/make-models.mjs` writes `assets/models/raider.glb` (2,908 triangles, 219 KB,
11 clips); `game/gfx.js` (terrain with ripples, wet sand, foam line, caustics; water with depth colour
from a 16-bit height texture, shore foam, fresnel, glint, an underwater ceiling; stone and planks with
tide marks, moss, weed, barnacles; a sky that turns to sunset); the sun crosses the sky over the match;
`game/models.js` (loot with three distinct silhouettes, palms, rocks, camp with tent, chest, flag, fire,
kelp, rubble, driftwood, shells, grass). Measured with `tools/inspect.mjs` (the QA skill's metrics
computed in the page; Playwright would have meant a download): see the scorecard in the stage-7 report.
Shadows were the whole frame cost (11.8 ms of a 1280x720 frame; 2.2 without them): the terrain no longer
casts (it receives), two cascades at 1536 instead of three at 2048: 1.6 ms median, GPU-synced, with 8
players in view, on this machine.

Stage 8 (audio): `game/sound.js`, buses master/music/sfx/ui/ambience plus the horn, levels in dB, the
horn ducks the rest by 9 dB, low breath by 4 dB; layered music (pad, pulse, drums, rising line) glides
by tide phase and opens a filter as the water rises; surf and wind synthesised; every action has a sound,
spatial by the camera; captions for the horn, bell, shoves, rival flares, low breath and the gasp. Engine
change (in this copy): `Audio.play` takes `opts.bus`. First-two-minutes tips: `game/tutorial.js`.
Checked in headless Chrome: the audio context runs, the horn ducks to 0.355 (-9 dB), the sequencer
advances, the caption shows. Not checked: how any of it sounds; I can't listen.

## Stage 9: lag test, settings, accessibility, QA, release kit

Netcode (`npm run test:net`, BREACH's harness adapted): the first run showed prediction drifting up to
7 cm at 150 ms (late inputs applied in a burst shared one tick's water). Fix: each player has a clock of
its own, one tick per input applied, and moves through the water of that tick; the snapshot carries it.
Now 0.0000 m error at 0, 60, 150 ms with jitter, 3% loss, and 300 ms with 5% loss. Shoves at 150 ms ±20
land 40/44 (24/46 without lag compensation). Traffic with 8 players: 3.5 kB/s down, 1.0 up (JSON: 62.4).
Real server over sockets: rooms, the shared island seed, refusing a bad hello and a wrong code: all pass.

Also: the player order inside a tick now turns (a bot-match run showed team 0 always winning same-tick
races for an item); settings screen (sensitivity, invert, FOV, quality, water, shadows, bloom, three
volumes, captions, reduce motion, colour-blind team colours, text size, an assist with 50% more breath
shown on the scoreboard), rebinding with gamepad codes, menus driven by d-pad/A/B, chat, a versioned
crash-safe save (tested: store, reload, corrupt the main copy and recover the backup, migrate a v1 save),
personal best and match count.

QA (`threejs-qa-release`):
- `npm test`: 26 simulation tests and 60 islands pass.
- `tools/playtest.mjs`: a match played through real key presses in headless Chrome: picked up at 12 s,
  banked at 17 s, went out greedy with over 4 kg, the flood took it at 83 s; tips appeared; no errors.
- Static build (`dist/tidefall-web`, served alone): Practice starts, online is greyed out with a message.
- Viewports: 1280×720, 1600×900, 844×390 (phone landscape: the first-match tip overlapped the tide clock;
  moved below it under 960 px), 390×844 title. Touch controls exist but only show on a coarse pointer; not
  tried on a phone.
- Debug hooks (`window.tidefall`, `stage()` only works in Practice, F3 panel) are left in on purpose, as in
  BREACH.

AAA scorecard (stage 7 captures and the final ones; metrics from `tools/inspect.mjs`):

| Category | Score | Evidence |
|---|---|---|
| Art direction | 2 | One palette (sand, teal, team colours) drives terrain, props, UI; the day turns to sunset over the match |
| Hero/player | 2 | Authored raider (hat in team band, satchel with coiled rope, 11 clips incl. swim, shove wind-up, stagger); no faces |
| Rivals and the flood | 2 | Team shirts and flags, idol carriers glow and get a marker, shove wind-up, horn + red edge + rising HUD for the flood |
| Rewards | 2 | Three loot silhouettes by size, shape and colour; bob and turn on land; glint, chime and notice on pick-up and bank |
| World | 2 | Ruins with rubble, kelp, shells, driftwood, palms, grass, camps; the beach is still plain in places (beach view contrast 43.6) |
| Materials | 2 | Procedural stone courses, planks, moss, tide marks, barnacles, wet sand, ripples, caustics, water depth colour |
| Lighting | 2 | Sun arc with 2 cascades, fire lights, flares, bloom, contrast/saturation grade, underwater fog and ceiling |
| VFX | 2 | Splash in/out, dust on footsteps, glints, shove puffs, flare embers, bubbles when loot sinks |
| UI/HUD | 2 | Tide clock with phase bar, compass to camp, weight bar with the 4 kg mark, feed, captions, tips |
| Performance evidence | 3 | Before/after: shadows 11.8 → 1.6 ms at 8 players on Intel UHD; budgets, draw counts, sizes |

Average 2.1: premium needs 2.3. Metrics of the active views: entropy 4.6–5.2 bits, edge density 0.07–0.21,
contrast 44–134, dominant colour 0.12–0.21. Next pass to raise it: faces and varied hats on the raiders,
denser beach dressing, breaking wave crests at the shoreline.

Balance (`npm run bots`), and three bugs it found:
- Bots robbed the same teams first (they took the last eligible rival in the list); now the nearest.
- Players in a tick always went in the same order (team 0 won same-tick races for an item); now turning.
- Bots share a budget of one path search per tick and always thought in the same order; now turning.
- A worrying "camp 1 wins 46%" turned out to be the same 24 islands replayed (matches are deterministic,
  so three runs on one seed set are one experiment). On fresh seeds (SEED=50000), with the fixes:
  wins by camp 4 / 8 / 4 / 8 of 24, average bank 602 / 728 / 604 / 661; the geometry is identical per
  camp (ring travel times agree to 0.01 s). 3% of carried loot lost to the sea, 15 heavy loads taken by
  the flood, 6 drownings, 953 shoves, 574 steals. Greed: careful 319 banked / 5 lost to the sea, middle
  343 / 11, greedy 311 / 9; the middle third won most (36%). Greed is a gamble for bots, not a winning
  strategy; whether it pays for people is for a playtest.
- Skill: easy against normal in 12 matches of 2 teams of 3: easy's team won 7. Skill levels don't
  separate; they only change reaction time and how well a bot judges the flood. Open issue.
- Server tick with 8 bots, run alone: 0.35 ms average, 14.4 ms worst, none over 16 ms. (Runs that shared
  the machine with others showed worst ticks of 0.2 to 0.9 s: that was the machine, not the game.)

## Character pass (after stage 9)

Skills: `img2threejs` (its character guides: the layer ontology, single-bone rigid parts, hair rigidly
parented and never crossing a joint, mirrored pairs, a turntable rather than one frame; not its Python
image pipeline, which needs a reference image and emits three.js TypeScript), `disney-animation-rule-skill`
(event poses, uneven phase timing, overlap, squash at contact, secondary action derived from the primary
motion), `game-ai` (a three-state machine for crabs). Not used: `scenario-blender-rigging` and
`scenario-blender-animation` (the Blender MCP did not answer: Blender isn't running), `meshy-3d-generation`
(no MESHY_API_KEY).

The raider (`tools/make-models.mjs`, `game/characters.js`):
- six-head stylised proportions; a face (eyes with pupils, brows, nose, a grin), ears, big hands and feet;
- variety by bone scale on one shared mesh: three hats (straw sun hat, bandana, captain's cap), three
  hairstyles (crop, ponytail, long) or none, a beard; six skin tones, six hair colours, hat colours;
- team readability: shirt, scarf, sack band and a pennant on a pole above the hat line, which shows from
  every side and at 30 m (before, a raider at 30 m was a pale speck);
- the loot sack on the back grows with the weight carried; carried loot rides on top of it;
- clips: idle, walk, run, carry (heavy), wade, swim, tread, jump, fall, shove, hookThrow, hook, stagger,
  drown, celebrate; one-shots on events (shove, grapple, banking, drowning);
- secondary motion: lean into acceleration, bank into turns, a squash at the feet on hard landings, the
  pennant flapping with speed, a ponytail spring.
- 7,424 triangles (was 2,908), 469 KB (was 219 KB).

Cosmetic creatures (`game/critters.js`, client only, no gameplay effect): crabs that follow the water's
edge in and out, scuttle away from players within 4 m and dig in when the sea covers them; gulls circling
high with beat-and-glide wings and an occasional call. Proposed, not added (they change what players know
or do): gulls landing on exposed loot as a tell; an old keeper at each chest who points to the nearest loot.

Measured (`tools/inspect.mjs`, camp view, 8 players, 1280×720, Intel UHD): before 0.7 ms median / 6.8 ms
worst, 84 draws, 198 k triangles; after 1.3 and 1.6 ms median / 7.4 and 8.5 worst, 88 draws, 228 to 232 k
triangles. Earlier runs of the before view measured 0.7 and 1.6 ms, so the cost is within this measure's
noise, at most about +0.9 ms. Evidence: `artifacts/before-*.jpg`, `artifacts/after-*.jpg` (front, right,
back, left, crew, 30 m), `artifacts/pose-*.jpg` (16 poses), `artifacts/crabs.jpg`. `npm test` 26/26 and
`npm run playtest` 5/5 after the change, no console errors.

Scorecard, character rows: Hero/player 2 → 3 (layered model: hats, hair, sack, pennant; expressive
one-shots and secondary motion); Rivals readable at a distance 2 → 2 (better, by the pennant, but the
coral team is close to the skin tones); VFX/motion 2 → 2. Average 2.1 → 2.2; premium needs 2.3.
Not done: facial animation (blinks, expressions), and motion has only been judged from stills.
