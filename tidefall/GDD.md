# TIDEFALL: game design document

Short and concrete. Every tuning number lives in `game/data.js`; this file says why. Updated as the design
changes.

## 1. Core concept

- **Hook:** the sea goes out on a clock and gives up its ruins; grab what you can carry and race the flood
  back to camp. Unlike extraction shooters (Hunt, Tarkov), the threat that ends the raid is the tide, which
  every player can see coming, and there are no guns. The danger is your own greed.
- **Audience and platform:** casual to mid-core, 10+, browser on a laptop first, then gamepad, then
  phone. A match is 9 minutes (6 tides × 90 s). Up to 8 players, bots fill the rest.
- **Genre and fantasy:** team raid / party game. You are a beachcomber-thief: quick, greedy, a little
  reckless, laughing when the sea takes someone's idol.
- **Version 1:** one generated island per match (2 to 4 teams), three kinds of loot, grapple, shove,
  flare, bots at three skills, online rooms and offline Practice. **Cut:** progression and unlocks,
  cosmetics, more biomes, voice chat, ranked play, a story mode.

## 2. Gameplay and mechanics

- **Core loop:** wait on high ground → the ebb opens the ruins → run out and loot → judge the flood →
  run home (or get caught) → bank at camp → the next tide goes lower.
- **Rules:** loot scores only when dropped at your own camp. Weight slows you (3.2% per kg, 14 kg
  max) and above 4 kg you sink in deep water and walk the floor while your breath (9 s) runs out; then
  the heavy loot sinks where you are. No permanent death; drowning respawns you at camp in 5 s.
- **Win:** the team with the most banked when tide 6 ends. Ties are draws.
- **Goals:** this minute: get that relic and get back. This tide: beat the flood with as much as you
  can carry. This match: out-bank the other camps, with the deep ruins of tides 5 and 6 deciding it.
- **Difficulty curve:** each tide goes lower (−2.5 m to −7.7 m), opening a deeper ring with richer loot
  (idols 0% in ring 1, 50% at the wreck) but further from camp. Tides 1–2 teach the loop on the shallow
  ring; 3–4 add the second ring and contested routes; 5–6 are the high-stakes deep runs.
- **Risk vs reward:** the idol (7 kg, 130 points) sinks you in deep water; carrying it home from the
  wreck means leaving before the horn. Greed pays most and loses most (stage 1 runs: greedy banked 640
  but lost 290 to the sea; careful banked 520 and lost nothing).
- **Agency:** which ring, how much to carry, when to turn back, whether to rob a rival or guard a
  teammate. All have real costs in time and loot.

## 3. Game feel

- Inputs are applied the tick they're pressed and predicted locally (no waiting on the server). Jump
  buffer 7 ticks, coyote time 7 ticks, pick-up buffer 9 ticks, ledge climb up to 1.45 m.
- Feedback per action (visual / motion / audio): jump (dust / — / step), grapple (rope, wider FOV /
  pull / zip), pick-up (glint / item pops on the back / chime), bank (burst at the chest / small shake /
  coins), shove (sand puff / knockback and stagger, shake / thud), flood takes loot (bubbles / shake /
  low groan), flare (light, embers / — / hiss). Shake and FOV changes switch off with "reduce motion".
- Camera: over-the-shoulder spring arm, pulls in before walls and terrain, never sits on the water's
  surface, eases the underwater fade.
- Animation beats: shove has a wind-up lean, the impact, a stagger; the grapple fires, snaps taut, pulls.

## 4. Progression and economy

- **Between matches: nothing** (deliberate: a party game where anyone can join a room and be equal).
  Locally saved: name, settings, bindings, best banked score and match count.
- **Earn vs spend:** no spending; "spend" is time and risk. Per tide a player can make about one deep run.

  | Loot | Weight | Value | Value per kg | Where |
  |---|---|---|---|---|
  | Coins | 1 | 10 | 10 | everywhere, mostly shallow |
  | Relic | 3 | 40 | 13.3 | middle rings |
  | Idol | 7 | 130 | 18.6 | deep ring and wreck |

  A full 14 kg load of idols is 260; of coins, 140. Deeper is worth more per kg and per trip.
- **Balance by script:** `tools/bot-match.mjs` runs whole bot matches on many islands and reports wins by
  camp position, greed against results, loot lost to the sea and skill.
- **Retention:** personal best and a short "how you played" line on the results screen. No dark patterns.

## 5. Level design

- Greyboxed in stage 1; generated per match from a seed. The ring layout teaches the path: the shallow
  ring is in sight from camp, the deeper rings appear one by one as the water drops.
- **Pacing per tide:** ebb (anticipation) → low (action) → flood (climax, horn) → high (rest). Across the
  match: a sawtooth that climbs, since each tide is lower and riskier.
- Mechanics are met safely first: the first ebb drains the beach in front of camp, with coins on it.
- **Landmarks:** each camp's tall team-coloured flag, the wreck masts, the dry rocks.
- **Secrets:** a cave or hall with a roof holds three spots (good loot, and a trap at flood).
- **Check tool:** `tools/check-island.mjs` (camps level and dry, every ruin reachable on foot by the tide
  its ring opens, camp travel times within 12%, rocks dry, spots reachable); rooms skip unfair seeds.

## 6. Story and world

- An island that a slow, enormous tide uncovers twice an hour. Under it, a drowned temple town and a
  ship that tried to carry its idols away. Rival crews of beachcombers camp on the high ground.
- No dialogue, no cutscenes: the ruins, the wreck and the sound of the horn tell it.
- **Tone:** sunny, playful, a bit of slapstick (shoving, the sea taking your idol); never grim.

## 7. Art and visuals

- **Style:** soft low-poly, warm sun, readable shapes. **Palette:** sand gold, sea teal, sky blue, and
  four saturated team colours; sunset oranges and violet by tide 6. Mood: holiday turning tense.
- **Readability:** coins gold discs, relics teal urns, idols magenta statues that glow (and get a world
  marker for everyone). Teams by colour and by flag; a colour-blind-safe scheme in settings.
- Lighting and post: the sun arcs across the match to sunset; bloom on idols, flares and the sunset;
  underwater fog and a blue grade; wet sand darkens where the sea just was.
- AAA scorecard at stage 7 and at the end.

## 8. Audio

- **Music:** layered (calm pad at high water, a pulse joins at low, drums and a rising line with the
  flood), crossfaded by phase, never hard cuts.
- A sound for every action and UI click (ZzFX, plus the Kenney CC0 files already in BREACH's folder).
- Spatial: shoves, flares, splashes and banks are panned and attenuated from the camera.
- **Critical cues duplicated:** the flood horn (with a notice and a red edge pulse), low breath (beeps
  plus the blinking bar), loot lost (sound plus notice).
- Buses: master / music / sfx / ui, the horn ducks everything else.

## 9. UI/UX

- HUD at the edges: tide clock top centre, banks top right, carry bottom left, breath and compass bottom
  centre, feed left. Nothing over the crosshair but the pick-up prompt.
- Menus: title, pause, settings, scores/results, all keyboard and gamepad navigable with visible focus.
- **First 2 minutes:** the first tide shows short context prompts (move, the ebb, pick up, weight, bank,
  the flood) once each, and stops once you have banked.
- **Accessibility:** rebinding, captions for important sounds, colour-blind team colours, reduce motion,
  text size, an assist option (more breath and a longer warning) and bot difficulty.
- Mobile: touch stick and buttons, compact layout, safe areas.

## 10. AI

- **States (utility-scored):** loot, carry home, steal, defend a teammate, rest at camp.
- **Variety:** each bot has its own greed (0.75 to 1.35), so some play it safe and some gamble on the
  wreck. Skill (easy/normal/hard) changes reaction time and how well a bot judges the flood, nothing else.
- **Fairness:** bots read only the server state any player could see, use the same input and rules, and
  shoves are telegraphed by a wind-up.

## 11. Technical

- 60 fps on a mid-range laptop with 8 players and the island in view; phone target 30 fps at "low".
- Fixed 60 Hz deterministic simulation (seeded RNG, integer angles, own sine), no tunnelling (stress
  tested), tide as a pure function of seed and tick.
- Save: versioned schema, migration, write-to-temp-then-swap in localStorage, falls back cleanly.
- Multiplayer: BREACH's authoritative server, prediction, reconciliation, interpolation, 200 ms lag
  compensation; tested with `net-test.mjs` under 150 ms, jitter and loss. Target under 20 kB/s down.
- Download size and load time measured and reported.

## 12. Process

Stages 1–9 from the game prompt, each run in the browser, logged in `NOTES.md` and committed. Bot
matches and `npm test` every stage. Honest notes in each report on what a human should try.

## 13. Release

- **Free.** No ads, no purchases.
- **Marketing:** 5 screenshots, a 25 s trailer script and a store blurb in `marketing/`.
- **Platform:** the web. Practice runs from any static host (GitHub Pages, itch.io); online needs the
  Node server. An itch.io zip build is prepared, not uploaded. Nothing is pushed or deployed.
- **Post-launch:** see the README's next updates and known issues.
