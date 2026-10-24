# Third-party software

All third-party code is vendored with pinned versions (no CDN at runtime), and each license file sits next
to the code.

| Name | Version | License | Source | Purpose | Location |
|---|---|---|---|---|---|
| gl-matrix | 3.4.4 | MIT | https://github.com/toji/gl-matrix | Model transforms (quaternions, mat4) | `vendor/gl-matrix@3.4.4/` |
| ZzFX | 1.3.2 | MIT | https://github.com/KilledByAPixel/ZzFX | Procedural sound-effect sample generator | `vendor/zzfx@1.3.2/` |
| Space Grotesk (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/floriankarsten/space-grotesk | Interface text | `vendor/fonts/` |
| JetBrains Mono (font) | variable, latin subset | SIL OFL 1.1 | https://github.com/JetBrains/JetBrainsMono | Numbers and labels | `vendor/fonts/` |

## Engine

`engine/` and `shaders/` are an unmodified copy of the Projection Lab engine
(https://github.com/rohitpatil9121/projection_library), itself built on projection_library by Rohit Sawant
(https://github.com/rohit-s-init/projection_library).

## Reimplemented published techniques (no code copied)

| What | Source | Where |
|---|---|---|
| ACES filmic tone-mapping curve | Krzysztof Narkowicz, 2016 | `shaders/postprocessing/post.js` |
| Easing equations | Robert Penner | `engine/Tween.js` |
| Trauma-based camera shake | Squirrel Eiserloh, GDC 2016 | `engine/Juice.js` |
| mulberry32 random number generator | Tommy Ettinger (public domain) | `game/sim.js` |

## Art

The people, the dog, the stall structures and the street furniture are generated from code by
`tools/make-models.mjs`, and every interface icon is an SVG drawn for this game in `game/icons.js`.

The food, cookware, shelf jars and two market displays come from asset packs by Kenney (www.kenney.nl),
released under Creative Commons Zero (CC0). `tools/kenney.mjs` reads them at build time and bakes them
into the files in `assets/models/`; the game does not load the packs when it runs.

| Pack | Version | License | Source | Location |
|---|---|---|---|---|
| Food Kit | 2.0 | CC0 1.0 | https://kenney.nl/assets/food-kit | `assets/packs/food-kit/` |
| Mini Market | 1.0 | CC0 1.0 | https://kenney.nl/assets/mini-market | `assets/packs/mini-market/` |

The food and trait symbols that remain as text are system emoji.
