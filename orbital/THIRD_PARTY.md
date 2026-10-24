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

`engine/` and `shaders/` are a copy of the Projection Lab engine
(https://github.com/rohitpatil9121/projection_library), itself built on projection_library by Rohit Sawant
(https://github.com/rohit-s-init/projection_library).

## Reimplemented published techniques (no code copied)

| What | Source | Where |
|---|---|---|
| ACES filmic tone-mapping curve | Krzysztof Narkowicz, 2016 | `shaders/postprocessing/post.js` |
| Easing equations | Robert Penner | `engine/Tween.js` |
| Trauma-based camera shake | Squirrel Eiserloh, GDC 2016 | `engine/Juice.js` |
