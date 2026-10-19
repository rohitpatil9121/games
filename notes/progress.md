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
