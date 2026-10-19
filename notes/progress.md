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
