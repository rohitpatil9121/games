# Third-party software and assets

Browser code is vendored with pinned versions (no CDN at runtime), and each licence file sits next to the
code. Nothing was downloaded for SKYFARM: every file below was copied from the author's other game folders
(TIDEFALL, which got them from BREACH), which got them from the sources listed.

| Name | Version | License | Source | Purpose | Location |
|---|---|---|---|---|---|
| gl-matrix | 3.4.4 | MIT | https://github.com/toji/gl-matrix | Model transforms | `vendor/gl-matrix@3.4.4/` |
| ZzFX | 1.3.2 | MIT | https://github.com/KilledByAPixel/ZzFX | Procedural sound-effect samples | `vendor/zzfx@1.3.2/` |
| Space Grotesk (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/floriankarsten/space-grotesk | Interface text | `vendor/fonts/` |
| JetBrains Mono (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/JetBrains/JetBrainsMono | Numbers | `vendor/fonts/` |

## Engine

`engine/` and `shaders/` are a copy of the Projection Lab engine (https://github.com/rohitpatil9121/projection_library),
itself built on projection_library by Rohit Sawant (https://github.com/rohit-s-init/projection_library).
Changes: `engine/Audio.js`'s `play()` takes `opts.bus` (from TIDEFALL), `Camera.roll`, `PostFX.lut` /
`lutAmount`, and an opaque draw order (`entity.drawOrder` in `Renderer`) (marked in the files).

## Art and sound

Everything visible is generated in code: islands, trees, crops, props, characters, creatures, clouds, water and
sky (`game/gfx/`, `tools/make-world.mjs`).

Eight sound effects in `assets/sounds/` are from Kenney's Interface Sounds, Impact Sounds and Digital Audio
packs (https://kenney.nl), CC0 1.0 (`assets/sounds/LICENSE-kenney.txt`), 84 KB in all:

| File | Used for |
|---|---|
| `powerUp2.ogg` | picking something up |
| `impactSoft_medium_000.ogg` | landing |
| `impactPunch_medium_000.ogg` | a hard landing |
| `impactPlate_light_000.ogg` | hammering a bridge plank |
| `confirmation_002.ogg` | coins (selling, buying) |
| `select_001.ogg` | interface clicks |
| `switch_003.ogg` | opening a chest |
| `powerUp11.ogg` | an island restored, an upgrade, a bridge done |

Each also has a synthesised ZzFX version in `game/sound.js`, used until the file decodes or if it fails to.
The score (piano and strings), wind, rain, thunder, birdsong, crickets and the airship's horn are synthesised
with Web Audio in `game/sound.js`.

## Reimplemented published techniques (no code copied)

| What | Source | Where |
|---|---|---|
| Single-scattering sky (Rayleigh, Mie, ozone) | Nishita et al. (1993); Earth coefficients as in Bruneton & Neyret (2008) | `game/gfx/atmosphere.js` |
| Utility AI with response curves | Dave Mark, "Behavioral Mathematics for Game AI" (2009) | `game/gfx/creatures.js` |
| Value noise, fractal sums | Perlin (1985) and common practice | `game/gfx/`, `game/islands.js` |
| Lookahead audio scheduling | Chris Wilson, "A Tale of Two Clocks" (2013) | `game/sound.js` |
| Trauma-based camera shake | Squirrel Eiserloh, GDC 2016 (in the engine's Juice) | `engine/Juice.js` |
