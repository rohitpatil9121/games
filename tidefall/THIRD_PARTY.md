# Third-party software

Browser code is vendored with pinned versions (no CDN at runtime), and each licence file sits next to the
code. The server has one dependency, installed by `npm install`. Nothing was downloaded for TIDEFALL: every
file below was copied from BREACH's folder, which got them from the sources listed.

| Name | Version | License | Source | Purpose | Location |
|---|---|---|---|---|---|
| ws | 8.22.0 | MIT | https://github.com/websockets/ws | WebSocket server | `node_modules/ws` (server only) |
| gl-matrix | 3.4.4 | MIT | https://github.com/toji/gl-matrix | Model transforms (quaternions, mat4) | `vendor/gl-matrix@3.4.4/` |
| ZzFX | 1.3.2 | MIT | https://github.com/KilledByAPixel/ZzFX | Procedural sound-effect sample generator | `vendor/zzfx@1.3.2/` |
| Space Grotesk (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/floriankarsten/space-grotesk | Interface text | `vendor/fonts/` |
| JetBrains Mono (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/JetBrains/JetBrainsMono | Numbers | `vendor/fonts/` |

## Engine

`engine/` and `shaders/` are a copy of the Projection Lab engine (https://github.com/rohitpatil9121/projection_library),
itself built on projection_library by Rohit Sawant (https://github.com/rohit-s-init/projection_library),
taken from BREACH's copy. One change: `engine/Audio.js`'s `play()` takes `opts.bus` (marked in the file).

`tools/modelkit.mjs` and `tools/chrome.mjs` come from the same author's Night Market and Projection Lab
repositories; `server/`, `game/net.js`, `game/protocol.js`, `game/controls.js` and `tools/net-test.mjs` are
adapted from BREACH.

## Art and sound

The raider (`assets/models/raider.glb`) is a model the author generated with Tripo (https://www.tripo3d.ai,
image to 3D), reduced, rigged and animated here by `tools/prepare-model.mjs` and `tools/make-raider-glb.mjs`.
Commercial use depends on the Tripo plan it was made on: the author has to check that. `npm run models`
writes the earlier fully procedural raider instead.

Everything else visible is generated: the
island by `game/island.js`, props by `game/models.js`, surfaces, water and sky by the shaders in `game/gfx.js`.

Ten sound effects in `assets/sounds/` are from Kenney's Interface Sounds, Impact Sounds and Digital Audio
packs (https://kenney.nl), CC0 1.0 (`assets/sounds/LICENSE-kenney.txt`), 109 KB in all:

| File | Used for |
|---|---|
| `powerUp2.ogg` | picking something up |
| `confirmation_002.ogg` | banking |
| `impactPunch_medium_000.ogg` | a shove landing |
| `impactSoft_medium_000.ogg` | a hard landing |
| `impactPlate_light_000.ogg` | the grapple biting |
| `select_001.ogg`, `switch_003.ogg` | interface clicks |
| `powerUp11.ogg`, `lowDown.ogg` | winning, losing |
| `impactPunch_heavy_000.ogg` | drowning |

Each also has a synthesised ZzFX version in `game/sound.js`, used until the file decodes or if it fails to.
The music, the tide horn, the surf and the wind are synthesised with Web Audio.

## Reimplemented published techniques (no code copied)

| What | Source | Where |
|---|---|---|
| Ground and air acceleration rule | id Software, Quake (1996) | `game/sim.js` |
| Prediction, reconciliation, interpolation, lag compensation | Bernier (2001); Gambetta, "Fast-Paced Multiplayer" (2014) | `game/net.js`, `server/room.mjs`, `game/sim.js` |
| Dijkstra's shortest paths | Dijkstra (1959) | `game/nav.js` |
| Utility AI with response curves | Dave Mark, "Behavioral Mathematics for Game AI" (2009) | `game/bots.js` |
| Value noise, fractal sums | Perlin (1985) and common practice | `game/island.js`, `game/gfx.js` |
| mulberry32 random number generator | Tommy Ettinger | `game/det.js` |
| Trauma-based camera shake | Squirrel Eiserloh, GDC 2016 (in the engine's Juice) | `engine/Juice.js` |
