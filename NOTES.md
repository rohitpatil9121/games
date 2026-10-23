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
