# PAPER PLANES: game design document

Short and concrete. Every tuning number will live in `game/data.js`; this file says why. Numbers below are
first guesses to be tuned in stages 1, 2 and 5, and this file is updated when they change.

Units: metres, seconds, Z up (Projection Lab's convention). The simulation runs at a fixed 60 Hz.

## 1. Core concept

- **Hook:** you are a paper plane in a giant room, and the air is the terrain: ride a radiator's thermal,
  slingshot through a fan's blast, dodge a window gust, and tag (or flee) the plane covered in ink.
  Unlike other flying tag games (*Flock!*, aerial modes in *Fortnite*, *Pilotwings*), nothing has an
  engine: you only go where the air lets you, and every room is a readable weather map.
- **Audience and platform:** casual, 8+, party play. Browser on a laptop first (mouse), then gamepad,
  then phone (touch and tilt). A round is 4 minutes; a session is 3 to 6 rounds.
- **Genre and fantasy:** arcade flying tag / party game. You feel weightless and clever: a tiny thing
  riding big invisible currents, then laughing when someone is blown into the curtains.
- **Version 1:** two rooms (Kid's Bedroom, Classroom), three folds, Classic Tag, Ink Spread, Ring Run,
  2 to 8 players online with bot fill, full offline vs bots, saved cosmetic paper patterns.
  **Cut:** more rooms, teams, ranked play, voice chat, custom room editor, plane customisation beyond
  pattern, replays.

## 2. Gameplay and mechanics

- **Core loop (one round):** pick a fold → launch → read the air → chase or flee using air sources →
  tag / get tagged / crumple and refold → round ends → results, scraps earned → pick a fold again
  (maybe a different one for this room).
- **Flight model** (per fold numbers in §2a):
  - Always moving forward. The player steers pitch and roll; banking turns the plane (turn rate grows
    with bank angle and airspeed, like a real glider).
  - Energy: diving converts height to speed, climbing converts speed to height, drag bleeds a little.
    Speed is airspeed relative to the local air, so a headwind slows you over the ground and a tailwind
    flings you.
  - **Flap:** one boost of +0.45 m/s forward and +0.28 m/s up, then recharges (2.4 to 3.6 s by fold).
    Buffered: pressing it up to 8 ticks before it's ready fires it when ready.
  - **Stall:** below the fold's stall speed the nose drops and the plane wobbles (roll noise) for at
    least 0.5 s; diving recovers. Never fatal on its own.
  - **Crumple:** hitting a surface with closing speed above 0.62 m/s and an angle steeper than 35°
    crumples the plane: it flutters to the floor (1.2 s), then refolds at the nearest launch spot
    (2.0 s total). Shallower or slower hits bounce off with a wobble and lose 30% speed. Crumpled planes
    can't tag or be tagged. Slower than 0.15 m/s into a surface only scrapes along it.
  - Collisions are swept (a sphere along the tick's segment against boxes, sliding up to three times a
    tick), so nothing passes through a 2 cm shelf at any speed.
- **Air field** (pure function of room data + seed + tick; costs no bandwidth):

  | Source | Shape | Numbers |
  |---|---|---|
  | Fan | cone, 28° half-angle, 3.0 m reach | 1.3 m/s on axis near the grille, falls off with distance and angle; can oscillate ±40° over 8 s |
  | Radiator / lamp thermal | vertical column, radius 0.6 m, leaning out from the wall | rises 0.52 m/s near the bottom, 0.28 m/s at the top, ends 0.3 m below the ceiling |
  | Window gust | box volume from the window into the room | seeded every 12–28 s; curtains move 1.5 s before; about 1.5 m/s inward for 3 s |
  | AC vent | downward column, radius 0.5 m | 0.6 m/s down |
  | Turbulence | 3D value noise, 0.5 m scale | 0.11 m/s everywhere, ×4 just behind fans |

- **Classic Tag:** one random player starts as "it" (inked). Touching a clean plane (centres within
  0.15 m) passes "it" on. The new "it" can't tag back the one who tagged them for 3 s. Round 4:00.
  Score = total seconds spent as "it"; least wins. Ties share the win.
- **Ink Spread:** one hunter at the start; every tagged plane becomes a hunter. The last clean plane
  wins; if the clock (3:00) runs out, every clean plane wins. A hunter's score is tags made.
- **Ring Run:** fly through paper rings in order against the clock, alone or with others (not a race
  between players, just best times). The first run is the tutorial (§9).
- **Lag compensation:** BREACH's rewind. The server tests a tag against where the target was on the
  tagger's screen (its view tick), capped at 12 ticks (200 ms).
- **Goals:** this minute: catch the nearest plane, or shake the hunter off. This round: be "it" the
  least, or be the last clean plane. Over many rounds: master both rooms with each fold, beat your Ring
  Run times, unlock patterns.
- **Difficulty curve:** within a round, the room is the same but players learn it: the first minute is
  open chasing, later rounds of the same room reward knowing the fan's sweep and the gust timer. Across
  rooms: the Bedroom is small (5.0 × 4.2 × 2.7 m) with three air sources and wide gaps; the Classroom is
  big (9 × 7 × 3.2 m) with six sources, desk rows to weave through, and gusts that cross the whole room.
  Ring Run has three sets per room, easy to hard. Bots ramp by skill (§10).
- **Risk vs reward:** **ink erasers**, small paper pickups that float in risky air (the edge of a fan
  cone, in the window gust's path, under the bunk where crumpling is easy). Classic Tag: an eraser
  takes 4 s off your "it" time. Ink Spread: it shields you from one tag. Three at a time per room,
  respawning 20 s after pickup. Going for one costs time and can crumple you in front of the hunter.
  The fan itself is the other gamble: fastest route across the room, but a wrong angle smashes you
  into the wall.
- **Agency:** the fold (each is right in some rooms and wrong in others), the route (thermal climb,
  fan sling, or hide under furniture), whether to grab an eraser, when to spend the flap.

### 2a. Folds

Tuned in stage 1 (the first guesses were for a 20 cm plane and made the room too small; see NOTES.md).
The plane is 10 cm, gravity is slowed to 0.95 m/s².

| | Dart | Glider | Stunt |
|---|---|---|---|
| Cruise / max speed (m/s) | 1.2 / 2.3 | 0.8 / 1.7 | 1.0 / 1.95 |
| Glide ratio (distance per height lost) | 4:1 | 9:1 | 6:1 |
| Stall below (m/s) | 0.68 | 0.4 | 0.53 |
| Turn rate at full bank (°/s), turn radius | 150, 0.46 m | 130, 0.40 m | 220, 0.28 m |
| Flap recharge (s) | 3.2 | 3.6 | 2.4 |
| How much wind pushes it | ×0.6 | ×1.3 | ×1.0 |
| Thermal lift | ×0.8 | ×1.4 | ×1.0 |
| Turbulence wobble | ×0.7 | ×1.0 | ×1.6 |

Expected: Dart wins the fan-heavy Classroom, Glider wins the thermal-rich Bedroom, Stunt wins tight
chases around furniture. Checked by `bot-match.mjs` (§4): no fold's win rate more than 10 points above
another's averaged over both rooms.

### 2b. Proposed changes to the brief (please confirm)

1. **"It" catch-up.** With equal speeds a runner can circle forever. Proposal: "it" recharges the flap
   25% faster and its tag reach is 0.15 m against 0.10 m for a clean–clean bump. No speed boost.
2. **Refold protection.** Refolding at the nearest launch spot invites spawn-camping. Proposal: 1.5 s
   of "can't be tagged" after a refold (the plane blinks), and a crumpled "it" stays "it".
3. **Erasers** (above) are my addition for the preamble's risk-vs-reward rule; the brief has none.

## 3. Game feel

- Input applied the tick it's read and predicted locally; flap buffered 8 ticks. Steering is filtered
  so the plane rolls in 0.15 s (anticipation), not instantly.
- Feedback (visual / motion / audio):
  - flap: wings flex down then snap, a puff of air lines / small camera push / paper "fwip"
  - thermal entry: dust motes swirl up around you / gentle camera lift / soft warm whoosh
  - fan blast: streak lines along the flow / shake scaled by wind / fan roar rises
  - stall: wings flutter, nose drops / wobble / rattling paper
  - glancing hit: crease flash / small knock / tap
  - crumple: plane balls up, paper bits / hit-stop 80 ms, shake / crunch, then a refold "unfold" sound
  - tag: ink splat stamped on the target, a ring of ink drops / hit-stop 60 ms, both planes knocked
    apart / a rubber-stamp "thunk" plus a chime for the tagger
  - eraser pickup: sparkle and the ink wiping / — / squeaky rub
- Speed: FOV widens from 70° to 82° at max speed; wind lines in view.
- **Camera** (`camera-systems`): chase cam 0.5 m behind and a little above, spring-smoothed, leans into
  turns (up to 18° roll), a small look-ahead along velocity, pulled in by rays so it never sits inside
  furniture or walls.
- **Reduce motion / comfort:** roll lean 0–100%, FOV kick on/off, shake off, and a horizon-lock mode
  (camera never rolls).
- Animation beats: flap (wings lift, snap, settle), tag (lunge, stamp, recoil), crumple (crush, fall,
  unfold), stall (flutter, drop, catch the air). Wings flex with airspeed and wobble in turbulence
  (`disney-animation-rule-skill`: follow-through and secondary motion).

## 4. Progression and economy

- **Between rounds:** nothing that changes flight. All folds open from the start. Saved: cosmetic
  paper patterns, name, settings, bindings, Ring Run best times, rounds played.
- **Scraps** (the only currency, earned only, never bought):

  | Earn | Scraps |
  |---|---|
  | Round played to the end | 10 |
  | Win | +15 |
  | Tag made (Ink Spread) / tag passed on (Classic) | +2 each, max 10 |
  | Eraser picked up | +2 |
  | Ring Run set finished / new best time | +5 / +5 |

  An average round pays about 20–25. Patterns cost 0 (plain), 40, 80, 120, 180, 250, 350, 480
  (newspaper, graph paper, ruled notebook, origami crane print, comic page, map, sheet music,
  gold foil). All eight take about 1,500 scraps, so about 60–70 rounds (4–5 hours), the first after
  2 rounds.
- **Balance by script:** `tools/bot-match.mjs` plays many seeded bot matches through the real Room,
  every fold in every room, and reports win rate by fold, by room and by launch spot, time-as-"it",
  tags, crumples and erasers. Fixed seeds; fresh seed sets for each real check.
- **Retention:** Ring Run best times per set, pattern unlocks, a "how you flew" line on the results
  (longest thermal ride, closest escape). No dark patterns, no daily login pressure.

## 5. Level design

- A room is a data file (`game/rooms/bedroom.js`, `classroom.js`): furniture as boxes and capsules with
  material tags, air sources with parameters, launch spots, eraser spots, ring routes, landmarks.
- Greybox first (stage 1–2): grey boxes, coloured air sources, rings.
- **Kid's Bedroom (5.0 × 4.2 × 2.7 m, afternoon):** radiator under the window (the main thermal "lift"),
  desk fan on the desk (oscillating sweep across the middle), the window (gusts), a bunk bed to dive
  under, toy shelves to weave between, a lamp on the desk (small thermal). Landmark: the sunbeam.
- **Classroom (9 × 7 × 3.2 m, rainy evening):** ceiling fan (a downdraft ring with a dead calm under
  its hub), two radiators along the windows, rain-streaked windows with gusts, an AC vent over the
  door, desk rows (a low "canyon" to fly between), teacher's lamp thermal. Landmark: the chalkboard.
- **Air highways:** each room has a loop you can ride without flapping (thermal up → glide → fan
  across → thermal up), so a skilled player always has a fast route and the hunter can predict it.
- **Pacing (per round):** launch (calm) → first chase (tension) → tag passed, the old "it" escapes
  (release) → gust or fan sweep scatters everyone (tension spike) → last 30 s (music up, scores close).
- **Teaching:** Ring Run's first set puts ring 1 above the radiator (you can only reach it by circling
  the thermal), ring 2 in the fan's stream, ring 3 just past a high shelf where you must climb to
  stall and dive out. Safe: crumpling there costs nothing.
- **Secrets:** a gap behind the bookshelf, the space under the bunk, the top of the wardrobe (Bedroom);
  the coat hooks shelf and inside the teacher's desk kneehole (Classroom). Hiding spots that "it" can
  still reach.
- **Check tool:** `tools/check-rooms.mjs`: every launch spot can reach every region (simulated
  flights from each spot with a sweep of inputs), no air source traps a plane (a plane released
  anywhere leaves any source within 10 s with some input), every hiding spot is reachable by every
  fold, launch spots are spread fairly (distance to the room centre within 15%), rings are reachable
  in order.

## 6. Story and world

- A kid's house and a school after hours. Somebody folded a stack of planes and left the fan on.
  The planes have the run of the place until the lights go out.
- No dialogue, no cutscenes. The rooms tell it: drawings pinned up, homework on the desk, a half-built
  model, the chalkboard's last lesson (about air, as a nod).
- **Tone:** cosy and funny. Soft light, warm sounds, slapstick crumples. Never mean.

## 7. Art and visuals

- **Style:** "toy scale" diorama: soft, slightly stylised real furniture, warm light, shallow depth of
  field so the room feels huge. Planes are folded paper with visible creases and fibre, glowing when
  light comes through them.
- **Palette:** off-white paper, honey sunlight, soft teal shadows (Bedroom); deep blue dusk, amber lamps,
  chalk green (Classroom). Player planes get pastel tints; **"it" is ink: near-black indigo with an ink
  trail and drips**, the strongest contrast in the scene. Mood: a lazy afternoon / a rainy evening.
- **Readability:** "it" plane: dark ink + trail + a soft screen-edge indicator when off screen, plus a
  different silhouette cue (ink drips). Air: dust motes and faint streaks along the flow, thermals
  shimmer, fans have visible streamers. Colour-blind modes change player tints and the ink colour,
  and "it" also has a pattern (spots), not just a colour.
- **Lighting and post:** sun or lamp key light with shadows, a sunbeam with dust, bloom on light through
  paper, a warm or cool grade per room, depth of field on the far room.
- **Hero props** built in code (`img2threejs` approach, Night Market's `modelkit.mjs`): desk fan, lamp,
  radiator, toy shelf, bunk bed, ceiling fan, desks, chalkboard.
- AAA scorecard at stage 6 and at the end. All assets procedural: `TRIPO_API_KEY`, `GEMINI_API_KEY` and
  `ELEVENLABS_API_KEY` are not set.

## 8. Audio

- **Music:** layered: a calm piano/pizzicato bed always; a pulse joins when "it" is within 2.5 m (or
  when you are "it" and a target is close); a quicker layer in the last 30 s. Crossfades, no cuts.
- A sound for every action (flap, stall, bounce, crumple, refold, tag, eraser, ring) and every UI
  click. Paper flutter loop whose pitch and level follow airspeed.
- **Spatial:** fan hum, radiator tick, rain on the window, other planes' flutter and tags are
  positional from the camera.
- **Critical cues duplicated:** "you're it" (stamp sound + screen ink edge + caption), "it" closing in
  (music layer + edge indicator + caption), gust coming (curtain rustle + curtains move + caption).
- Buses master / music / sfx / ui / ambience, tag and "you're it" duck the rest. All synthesised
  (ZzFX-style and Web Audio), so no downloads; if I want a CC0 file I'll ask first.

## 9. UI/UX

- **HUD:** top centre: round clock and mode; top right: who is "it" (name + ink dot) and your score;
  bottom centre: flap charge; an arrow at the screen edge to the nearest target (or to "it" when you
  are clean). Nothing in the centre of the screen.
- **Menus** styled like notebook paper (ruled lines, pencil marks): title, play (Practice / online /
  room code), fold and pattern pick, pause, settings, results. Keyboard, gamepad, touch; visible focus.
- **First 60 seconds:** the first launch goes straight into Ring Run set 1 (three rings that teach the
  thermal, the fan and stall recovery). Each ring has a single short prompt that appears near it
  (a curling arrow over the radiator, "circle to climb"), no text wall. Then "Play Tag?".
- **Controls:**
  - mouse-aim (default): move the mouse to place a target circle; the plane banks and pitches toward
    it. Left click or Space: flap.
  - keyboard: W/S pitch, A/D roll, Space flap.
  - gamepad: left stick pitch/roll, A flap.
  - touch: one-thumb stick + flap button, or tilt steering (asks for motion permission; if refused or
    unavailable, falls back to the stick). One-thumb mode: tap anywhere to flap, drag to steer.
- **Accessibility:** remapping, invert pitch, steering assist (auto-level when you let go, and an
  optional auto-avoid that steers off walls), captions, colour-blind modes, reduce motion and comfort
  options (§3), text size, bot difficulty.
- Responsive from phone portrait/landscape to ultrawide, safe areas respected.

## 10. AI (bots)

- Bots are players whose input comes from code (same flight model, same rules, same sim).
- **Utility AI** with hysteresis, adapted from TIDEFALL's `bots.js`. Actions: chase target, flee "it",
  ride a thermal (regain height), cross with a fan, hide (under furniture), grab an eraser, recover from
  a stall.
- Chasers plan short routes through the air field (they sample it ahead, like a player reading dust):
  they climb in thermals and use the fan's stream to cut corners. Runners break line of sight and lead
  the hunter through turbulence and past hard corners.
- **Fairness:** a bot knows what a player could see: the "it" plane (always marked for everyone) and
  planes within its line of sight; otherwise last-seen positions plus the same edge-arrow hint the HUD
  gives a player. No speed boosts.
- **Skill** (easy / normal / hard) changes only reaction time (0.45 / 0.25 / 0.12 s), aim noise, how
  far ahead it reads the air (0.3 / 0.7 / 1.2 s), and whether it uses erasers and fans deliberately.

## 11. Technical

- **Engine:** Projection Lab (`projection_library-v2`, copied into the game folder as TIDEFALL did:
  `engine/`, `shaders/`, `vendor/`), plain ES modules, no bundler, no three.js.
- **Simulation:** pure deterministic `game/sim.js` (seeded RNG, own sine, quantised angles), air field
  in `game/air.js`, rooms in `game/rooms/`. Swept collisions; a stress test flies 8 random-input planes
  for 4 minutes and checks no plane is ever inside furniture or outside the room.
- **Performance targets:** 60 fps (≤ 16.7 ms frame, GPU-synced measurement) on this laptop (Intel UHD)
  with 8 planes, dust motes and air visualisation on; phone target 30 fps at "low" quality. Measured,
  not guessed.
- **Save:** TIDEFALL's `save.js`: versioned schema, migration, scratch-then-swap with a backup.
- **Multiplayer:** TIDEFALL's server, rooms with 4-letter codes, prediction, reconciliation,
  interpolation, condition simulator, Practice running the Room in-page. Input per tick: pitch and roll
  (int8 each), aim point for mouse-aim resolved client-side into pitch/roll, button bits (flap). Each
  player has its own clock, as TIDEFALL does, so the air a predicted plane flies through matches the
  server's exactly. Target under 10 kB/s down per client with 8 players. Tested at 150 ms with jitter
  and loss in `tools/net-test.mjs`.
- Download size and load time measured and reported. Port 8160 (BREACH 8140, TIDEFALL 8150).

## 12. Process

The 8 stages from the game prompt, each run in the browser, logged in `NOTES.md` (with the skills used)
and committed on branch `build` in this folder's own repo. `npm test` and bot runs every stage from
stage 2 on. Honest notes in each report on what a human should try, since I can't feel the controls or
hear the sound.

## 13. Release

- **Free.** No ads, no purchases.
- **Marketing:** 5 screenshots, a 25 s trailer script and a store blurb in `marketing/`.
- **Platform:** the web. Practice runs from any static host; online needs the Node server. An itch.io
  zip prepared, not uploaded. Nothing pushed or deployed unless you ask.
- **Post-launch:** listed in the README (more rooms, teams mode, a room editor), with known issues.
