# Skills used, by stage

The working log with decisions and measurements is `notes/progress.md`. This file records which installed
skill was loaded for which stage, as the preamble asks.

| Stage | Skills loaded | Used for |
|---|---|---|
| Planning | `router`, `threejs-game-director` | Routing to the three.js skills (translated to Projection Lab); progress file; asset-key probe (all keys missing, so everything is procedural) |
| 1 Prototype | `prototype-fast` | The one-question brief, keep/kill criteria, an instrumented scripted playtest |
| 2 Island | `procedural-gen`, `level-design` | Seeded heightmap and noise, weighted loot tables, validation and seed repair; metrics, critical path, fairness by sectors |
| 3 Movement | `physics-tuning`, `camera-systems`, `input-systems`, `game-feel` | Fixed step, stress tests, damping; spring-arm camera; radial deadzone, buffering, coyote time; splash, glint, FOV |
| 4 Network | (BREACH's code, no new skill) | Copied and adapted netcode |
| 5 Rivals | `game-ui-ux`, `threejs-game-ui-designer`, `game-feel` | HUD hierarchy and anchoring; shove and flare feedback |
| 6 Bots | `game-ai`, `ai-behavior-trees-utility-ai` | Utility scoring with response curves and hysteresis; decision separate from motion; balance by bot matches |
| 7 Looks | `threejs-aaa-graphics-builder` (its visual-scorecard reference), `shader-programming` (read at stage 9, after the shaders were written), `performance-optimization` | Terrain, water, stone and sky shaders; sun arc and cascaded shadows; bloom, contrast and grade; GPU-synced timing found shadows were 85% of the frame |
| 8 Audio, HUD | `audio-design`, `game-ui-ux`, `threejs-game-ui-designer`, `game-feel` | Buses in dB, horn ducking, vertical music layers, synthesised ambience, captions; first-match tips |
| 9 Polish, QA | `save-systems`, `input-systems`, `threejs-qa-release` (and its canvas inspector's metric formulas), `itch-publish` (build only) | Versioned crash-safe save; rebinding and gamepad menus; real-input playtest, pixel metrics, load and size; itch zip prepared, not uploaded |
| Character pass | `img2threejs` (character guides), `disney-animation-rule-skill`, `game-ai` | Raider rebuilt with face, variants, sack, pennant; clips by event poses; crabs and gulls |

Preamble additions taken on from stage 6 onward: `GDD.md`; first-two-minutes prompts; captions, text
size and an assist option; personal best on the results screen; crash-safe versioned save; marketing
assets and an itch.io build (not published); AAA scorecard numbers at stages 7 and 9.

Honest accounting: the preamble lists `threejs-shaders`, `threejs-materials`, `threejs-lighting`,
`threejs-postprocessing`, `threejs-performance`, `threejs-debug-profiler`, `threejs-textures`,
`threejs-geometry`, `create-game-assets`, `ui-ux-pro-max`, `web-perf` and `dialogue-systems`. I did not
load those; the work they cover was done from the engine's source and the skills above. The asset
generators (`threejs-3d-generator`, `threejs-image-generator`, `threejs-audio-generator`) were skipped
because their API keys are not set (probe at planning). `fps-shooter` and the other genre templates were
not read: none fits a raid game closely.
