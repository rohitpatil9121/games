# PAPER PLANES build notes

Working log: decisions, which skill was used for what, what was measured. Newest stage last.

## Before starting

- `router`: Projection Lab isn't in its engine table, so (as in TIDEFALL) the `threejs-*` skills are read
  for technique and translated to the engine's own API.
- `threejs-game-director`: playable loop first, then looks, then browser evidence. Its asset-credential
  probe ran: `TRIPO_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` all MISSING, so every model, texture
  and sound will be procedural.
- `GDD.md` written first and approved by Rohit with the three proposed changes (2026-10-23).
- Engine: `engine/`, `shaders/`, `vendor/` copied from TIDEFALL's folder (its copy has `Audio.play`'s
  `opts.bus`). `game/det.js` copied from TIDEFALL; `datan2` added (atan2 from + − × ÷ only).

## Stage 1: prototype the glide (`prototype-fast`, `physics-tuning`)

Brief, as `prototype-fast` asks:

- QUESTION: is riding the air (a fan and a thermal) with one plane in a greybox room fun?
- CORE VERB: glide, bank into the air you can see, ride it.
- THROWAWAY?: `game/view.js` (greybox drawing) and the stage-1 `game/main.js` are throwaway.
  `data.js`, `air.js`, `sim.js` and `rooms/bedroom.js` are keepers: the netcode in stage 3 needs them pure
  and deterministic from the first line (TIDEFALL's lesson), and rewriting them would only rename them.
- KEEP IF: a hands-off plane can be steered into the thermal and carried up, the fan visibly pushes, and
  a plane can stay up a long time without flapping by reading the air.
- KILL IF: the room is too small to do anything but crash, or the air makes no difference to the line.

What was built:
- `game/air.js`: the air field as a pure function of room, seed and time: fans (cone, falloff, sweep,
  churn behind the grille), thermals (column, rise easing with height, draw-in at the bottom, spill at the
  top), vents, window gusts on seeded slots, and value-noise turbulence kept apart from the sources.
- `game/sim.js`: the flight model (heading, path angle, bank, airspeed; gravity along the path, k·v² drag
  with k set so each fold's glide angle holds its cruise speed; bank drag; buffered flap; stall with nose
  drop and wobble; wind scaled by fold; sideways air rolls the plane). Collisions: a sphere swept along the
  tick's segment against the room's boxes and walls (slab test), up to three slide passes a tick; a steep
  fast hit crumples (2 s, then refold at the nearest launch spot with 1.5 s of protection), a hard glance
  bounces and loses 30%, a light touch only scrapes.
- `game/camera.js`: chase camera on a spring arm against furniture and walls, real-time smoothing, lean
  into turns (`RollCamera` rolls the engine camera's basis; horizon lock turns it off), speed FOV kick.
- Mouse-aim steering: the mouse places an aim direction, the plane banks and pitches toward it. Tested by
  setting the aim 90° to the right: the plane rolled to 60°, turned, and settled within 1 s, no overshoot.
- `game/view.js`: greybox bedroom, see-through fan cone (turns with the sweep) and thermal column, 420
  dust motes that ride the real air field, a folded-paper dart, a trail. Debug HUD with the judged numbers.

Measured (`node tools/test.mjs`, all 16 pass):

| Fold | Glide speed / ratio / sink | Turn radius, full bank | Circling the thermal (10 s) | One pass through it | Fan head-on from 0.6 m |
|---|---|---|---|---|---|
| Dart | 1.20 m/s, 4.0:1, 0.29 m/s | 0.46 m | −0.23 m (can't fit inside) | +0.19 m | pushes through 0.44 m closer |
| Glider | 0.80 m/s, 9.0:1, 0.08 m/s | 0.40 m | +5.0 m | +0.16 m | pushed back 0.52 m |
| Stunt | 1.00 m/s, 5.5:1, 0.18 m/s | 0.28 m | +3.3 m | +0.19 m | pushed back 0.19 m |

- Dive and climb: a 1.5 s dive takes a dart from 1.2 to 1.84 m/s; pulling up stalls it after 1.8 s;
  hands off, it recovers 1.7 s later.
- Stress: 8 planes on random input for 4 minutes in the bedroom: 0 ticks inside furniture or outside the
  walls (297 crumples, 126 hard glances). Deterministic: the same inputs give the same bits.
- Hands-off from each launch spot, time to first contact: dart 3.9–4.1 s, glider 4.9–5.9 s, stunt 4.5–4.7 s.
- In the browser (scripted mouse-aim, after the change below): a glider steered into the thermal climbed
  to the cap under the ceiling and rode 16.6 s without a flap and without a crash (the script stopped
  it); flying straight at the fan at desk height, the dart got within 0.68 m of it, the stunt 0.82 m,
  the glider 0.89 m, none crumpled. No console errors, no server errors.

Two things the prototype showed, and what changed:
1. **The room was too small at the GDD's speeds.** With a 20 cm plane at 2.4–3.6 m/s, a plane crossed the
   bedroom in under 2 s and couldn't turn inside it (dart turn radius 2.2 m in a 4.2 m room). In the
   browser it hit a wall every 2–3 s. First fix: slow-motion gravity (1.9 m/s²) and faster turns; still
   cramped. Second fix, kept: a 10 cm plane with every speed and gravity halved (0.95 m/s²). Times are the
   same as before; distances halve, so the room is effectively twice as big. GDD §2a updated.
2. **The thermal hugged the wall.** Circling it meant grinding along the window wall, and a plane pressed
   into a wall froze (the swept move stopped at the surface and threw the rest of the tick away). Fixes:
   the thermal leans out into the room (centre 1.3 m from the middle, 0.8 m off the wall), the move slides
   along surfaces for the rest of the tick, and a light touch scrapes instead of glancing.
   Also: turbulence was being multiplied by the glider's thermal factor (1.4 up, 1.3 down), which turned
   noise into free lift (glide ratio 13.9 against 9); turbulence is now kept apart and scaled evenly.

Honest verdict: **keep**, with a caveat. By the numbers the verb works: the air changes the line a lot
(the glider gains 5 m circling the thermal, the fan pushes a glider backwards but a dart through), the
folds behave differently in the same air, and a hands-off plane has 4–6 s before it meets a wall, which is
time to make a choice. What I can't judge is the feel: whether mouse-aim feels like flying or like
steering a cursor, whether 0.8 m/s for the glider feels calm or sluggish, whether the lean is pleasant.
Please fly it: `npm run static`, open http://localhost:8160, click, steer with the mouse, Space to flap,
1/2/3 to change fold, R to restart, F hides the dust, H locks the horizon. Things to try: circle the
orange column with the glider, fly into the blue fan cone with the dart and then the glider.

Risks seen for later stages:
- The dart can't circle inside the thermal (turn radius 0.54 m at 85% bank against a 0.6 m column). That
  matches "weak in thermals", but bots and players must use passes, not circles.
- A plane sliding along the floor slows to a stop and needs a flap to leave. Fine for now; may need a
  "hop" when the flap is pressed on the floor.
- Glancing hits at a wall's corner with speed between scrape and crumple can look like a sudden turn.

## Stage 2: air field and flight feel (`input-systems`, `camera-systems`, `game-feel`, `disney-animation-rule-skill`)

- Air: the window gust is in the bedroom (a box from the window across the room, 1.1 m/s for 3 s, one
  per 20 s slot starting in its first 8 s, so 12–28 s apart, from the seed); the desk lamp is a second,
  small thermal; vents are written and tested, placed in the classroom later. Curtains hang beside the
  window and stir for the 1.5 s before a gust (the telegraph: their flutter speeds up and they lift),
  then billow while it blows; a caption says the same thing.
- `game/rings.js`: Ring Run, pure. A pass is the tick's segment crossing the ring's disc inside its
  radius (the centre must clear the rim by half the plane's radius). In order; timed from the first ring.
  Bedroom sets: "First flight" (the tutorial: a high ring on the thermal's edge, a ring in the fan's
  stream, a high ring to zoom up to with the stall prompt), "Bunk run", "Shelf weave". The page opens
  straight into set 1. The next ring is bright, the one after dim, the rest faint; a pass bursts.
- `game/controls.js` (`input-systems`, adapted from TIDEFALL's): actions, not keys (nose up/down, bank
  left/right, flap, restart); keyboard, mouse, gamepad; radial stick deadzone; rebinding with
  `capture()`; mouse-aim or direct steering, switching on whichever was used last; invert pitch.
  `steerToward()` is in `sim.js` so bots will steer through the same input as mouse-aim. Flap is
  buffered 8 ticks in the simulation.
- `game/planeview.js` (`game-feel`, `disney-animation-rule-skill`): the plane is five points rebuilt each
  frame. Dihedral with speed; the flap is impact first (no time for anticipation: the boost is applied
  on the press), tips snap down in 70 ms, overshoot up at 180 ms, settle by 350 ms; tips shiver in a
  stall or rough air (secondary, after the sim's own wobble), scaled by the fold; crumple squashes into
  a lumpy paper ball in 120 ms that tumbles as it falls; refold unfolds with an ease-out-back overshoot
  in 300 ms, then blinks while it can't be tagged (a steady glow with reduce motion). Puffs off the wings
  on a flap, paper bits on a crumple, a few flecks on a hard glance. Shake and hit-stop scaled by
  importance: crumple 0.3 + 80 ms, glance 0.06, ring 0.05, flap 0.02; all off with reduce motion.
- Camera (`camera-systems`): unchanged from stage 1 apart from comfort settings read live (lean, FOV
  kick, horizon lock).

Measured:
- `node tools/test.mjs`: 19 pass (new: gusts 13.9–25.5 s apart on 40 seeded slots, the telegraph
  counts down exactly, 1 s in a gust moves a glider 1.58 m; a vent drops a circling glider 0.38 m in
  0.5 s; rings count in order, either way through, not past the rim, timed from the first).
- In the browser, a crude mouse-aim autopilot (climb in the thermal when too low for the next ring, else
  aim at it) finished "First flight" with every fold: glider 10.1 s (3 crumples), stunt 9.0 s (5),
  dart 9.6 s (7, flapping while it climbs). So the tutorial can be done by each fold; the crumples are
  the autopilot's, which aims straight at rings through furniture.
- Screens checked: the ring and its tip, the flap puffs and wing flex, a crumple (the paper ball and
  bits), the curtains; no console errors.

Not done or not checked:
- "Bunk run" and "Shelf weave" have not been flown to the end by anything: the crude autopilot can't
  thread the bunk cave. `tools/check-rooms.mjs` (stage 6, with the rooms built properly) will check every
  ring is reachable in order.
- Ring Run best times are kept only for the page's life; saving comes with the settings (stage 7).
- Touch and tilt are stage 8. The gamepad path is written but untested (no pad here).
- Feel is still for a human to judge: the flap snap, the lean, the gust's strength.

## Stage 3: TIDEFALL's net skeleton

Copied and adapted, not rewritten: `server/server.mjs` (static files + `ws` on one port, 4-letter rooms,
quick play, per-address limits, the 60 Hz clock; port 8160 beside BREACH's 8140 and TIDEFALL's 8150),
`server/room.mjs` (input queue with time credit, lag in ticks from the reported view tick, bot fill,
rate limits, per-client delta snapshots), `game/net.js` (Loopback, SocketTransport, Conditions, Client
with prediction, reconciliation and interpolation), `game/protocol.js` (binary `in` and `snap`, JSON for
the rest), `tools/net-test.mjs`. `ws` 8.22.0 was copied from TIDEFALL's node_modules, not downloaded.

What changed for planes:
- `sim.js` grew the match: `createState`, `addPlayer` (at the launch spot farthest from other planes),
  `step`, `applyInput` (the flight step, then the mode: Ring Run per player, with a restart button), and
  `setFold` (changing fold refolds you at a launch spot, so it can't be used as a dodge).
- The air needs no bandwidth (as TIDEFALL's tide): `welcome`/`start` carry the room id and seed; every
  plane has its own clock, one tick per input applied, and flies through the air of that tick.
- Snapshots carry your own plane in full (doubles for everything prediction reads) and each other plane
  as 15 bytes: millimetres, heading in 16 bits, pitch, bank, flags (crumpled, stalled, guarded; it and ink
  for stage 4), fold. Score rows carry Ring Run progress and best times. Events: flap, stall, glance and
  crumple (with where), refold, ring, done, restart.
- Remote planes are drawn by the same `PlaneView` as yours, placed every frame from interpolated
  snapshots, their effects driven by the snapshot's events; a refold doesn't draw the plane flying across
  the room. Names float over them; a list of planes and their ring progress sits top right.
- A bug found on the way: my `step` flew a plane hands-off on any tick with no input, including ticks
  where its inputs were merely late. The client never predicts those ticks, so prediction drifted up to
  2 m at 60 ms of ping. TIDEFALL's rule, restored: late means the plane waits for its inputs (its clock
  with it); only a plane with no input stream at all (a bot without a brain) flies hands-off.
- Another: the bot fill counted a joining player twice, so a room asked for 3 planes held 2.

Measured (`npm run test:net`, all pass):

| Link | Prediction, worst over 20 s of flying (fan, thermal, gusts, 3–4 crumples) | Interpolated steps of a circling plane |
|---|---|---|
| 0 ms | 0.000000 m | 0 frozen, 0 jumps in 270 frames |
| 60 ms ±10 | 0.000000 m (up to 5 inputs replayed) | |
| 150 ms ±30 | 0.000000 m (13 replayed) | 0 frozen, 0 jumps |
| 150 ms ±30, 3% loss | 0.000000 m (30 replayed) | 11 frozen, 0 jumps (5% loss) |
| 300 ms ±60, 5% loss | 0.0003 m, one correction | |

The one correction on the worst link happens near the start; I think it is the rule that brings a plane
whose inputs stopped for over a second up to the present, but I haven't proved it. Traffic for one person
in a room of 8 planes: 4.1 kB/s down, 0.7 kB/s up (15.2 kB/s down as JSON). The real server over Node's
own WebSocket: two clients share a room and seed, see each other's planes, ping measured, a bad hello and
a wrong code are refused with a reason.

In the browser: the server runs from the `paper-planes` launch entry (`npm start`). Tab A created room
TABH, tab B joined it by code; both lists show Alpha (dart) and Bravo (glider), and Bravo's screen draws
Alpha's plane with its name and trail where the server has it. A static server (`npm run static`) answers
404 on /status, so the page offers Practice only. No console or server errors.
Not verified in the browser: smooth real-time motion with two tabs. The Browser pane is throttled to about
7 fps here, so frame-driven checks can't run in real time; the netcode numbers above come from the
virtual-clock harness and the real-socket test instead.

## Stage 4: tag (Classic Tag, Ink Spread, erasers)

Rules (all in `sim.js`, decided by the server; `tools/test.mjs` has 22 tests now):
- Classic Tag: after 3 s of grace a seeded pick makes one plane "it". "It" tags a clean plane by getting
  within 15 cm (centre to centre); "it" passes on and the new "it" can't tag the old one back for 3 s.
  Nobody can be tagged while crumpled or in the 1.5 s after a refold; a crumpled "it" stays "it" (GDD
  §2b). "It" recharges its flap 25% faster (§2b). A tag knocks the tagged plane up and wobbles both. 4:00
  rounds; least time as "it" wins, ties share it. If "it" leaves, a new one is picked.
- Ink Spread: one hunter; every tagged plane becomes a hunter; the last clean plane wins, or every clean
  plane when the 3:00 clock runs out. A late arrival joins the hunters.
- Erasers (my addition, approved): three out at a time on five risky spots per room (the fan's edge, the
  gust's path, under the bunk, between shelf boards, over the lamp); 9 cm to pick up; back 20 s later at a
  free spot chosen from the seed. Classic: 4 s off your time as "it". Ink Spread: blocks one tag.
- Results stay up 12 s, then a new round (TIDEFALL's intermission).

Lag compensation (BREACH's rewind, TIDEFALL's `positionAt`): each "it" checks its targets, input by input,
where it saw them: the input's view tick turned into ticks ago. Tags aren't predicted by the client (its
prediction has no other planes); they arrive as events and the "it" flag comes back in your own plane's
snapshot (it feeds the flap recharge, so prediction stays exact).

**A change to the brief, and why.** The brief said the rewind is capped at 200 ms, as in BREACH. Measured
with `npm run test:net` (a dart chasing a weaving glider by what it sees, 4 minutes per link; a "contact"
is a moment the chaser's screen shows the two within reach):

| Link | Cap 12 ticks (200 ms in all) | Cap 20 ticks (200 ms of ping on top of interpolation) | No rewind |
|---|---|---|---|
| 0 ms | 33 of 36 | 33 of 36 | 33 of 55 (60%) |
| 50 ms ±10 | 79 of 80 | 79 of 80 | 17 of 34 (50%) |
| 100 ms ±20 | 38 of 45 (84%) | 55 of 55 | 10 of 36 (28%) |
| 150 ms ±20 | 36 of 53 (68%) | 50 of 58 (86%) | 6 of 38 (16%) |
| 150 ms ±30, 2% loss | 28 of 46 (61%) | 62 of 70 (89%) | 5 of 27 (19%) |

At 150 ms of ping what the chaser sees is about 15 ticks old (5 to 8 of interpolation, then the snapshot's
trip and the input's trip). BREACH's 200 ms cap was for shots and TIDEFALL's for 2 m shoves; with a 15 cm
reach the last 3–4 ticks matter. So the cap is now 20 ticks (`MAX_REWIND` in data.js, GDD §2 updated).
The cost: a runner on a fast link can be tagged up to a third of a second "behind" where their own screen
had them, which in a room this size is under 30 cm. Tags nobody saw coming: 0 to 2 per 4 minutes.
Without the sound and the HUD's arrow this is all numbers; a human should judge whether tags feel fair.

Presentation:
- "It" and hunters are inked: near-black indigo paper, a dark trail, and ink dripping as they fly (a
  dotted line that hangs a moment). Their name label gets a ● too, so it doesn't rest on colour alone.
  An eraser's shield glows.
- The tag moment: an ink splat thrown off the tagged plane, a rubber-stamp "YOU'RE IT" / "TAGGED!" /
  "INKED" that slams in (overshoot ease; still with reduce motion), 60 ms hit-stop and a shake for the two
  involved, a line in the feed.
- HUD: the mode, the clock, who is "it" (or hunters vs clean), the waiting and grace countdowns; scores
  per plane (time as "it", or tags); an arrow to the nearest target when you're "it" (red) or to the
  nearest "it" when you're clean (ink), over the plane when it's on screen and on the screen's edge when
  it isn't, with the distance.
- Erasers: small pink erasers with a blue sleeve, bobbing and turning; a sparkle when taken.
- Results: winners starred, time as "it" or clean/inked, tags, erasers, the next round's countdown.

Checked in the browser (Practice, 4 planes, the bots still without brains): the first "it" is picked
after 3 s; chasing a bot with mouse-aim tagged it at 12 s ("You tagged Dart" in the feed, Dart marked
"it" in the HUD and the list, the arrow pointing at Dart 3.1 m away); a shortened clock ended the round
and showed "Crane and Fold win" (both 0.0 s as it) with the table and "Next round in 12 s"; Ink Spread
with two hunters drew both inked with drip trails and ● labels and the arrow on the nearest. No console
or server errors. Traffic with tag fields: 4.3 kB/s down for one client in a room of 8.

Not done yet: bots that play (stage 5: until then Practice "it" chases planes that fly hands-off and
crash); sounds for the stamp, the eraser and "it is near" (stage 7); colour-blind ink colours (stage 8).
