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
