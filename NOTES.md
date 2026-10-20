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
| 7 Looks | (filled in at that stage) | |
| 8 Audio, HUD | (filled in at that stage) | |
| 9 Polish, QA | (filled in at that stage) | |

Preamble additions taken on from stage 6 onward: `GDD.md`; first-two-minutes prompts; captions, text
size and an assist option; personal best on the results screen; crash-safe versioned save; marketing
assets and an itch.io build (not published); AAA scorecard numbers at stages 7 and 9.
