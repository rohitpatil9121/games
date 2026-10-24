# SKYFARM: marketing kit

Nothing here is published. The screenshots are captured from the real game by `node tools/shots.mjs`
(1600 × 900, High quality, HUD off, headless Chrome on the real GPU). The five for a store page are 1 to 5;
6 is a working shot (the great tree is too small to carry the ending yet).

| File | What it shows |
|---|---|
| `shot-1-home-golden-hour.jpg` | Hearth Isle at golden hour: the hut, the windmill, the field, Daisy Step across the gap, the cloud sea |
| `shot-2-first-glide.jpg` | The first glide: the gardener under grandmother's glider, Daisy Step ahead, islands up the sky |
| `shot-3-garden-in-bloom.jpg` | The home field in the afternoon: sunflowers, apple and sky-pine saplings, a fluffball, tall grass |
| `shot-4-night-at-home.jpg` | Night: lit windows, chimney smoke, stars, the field behind the fence |
| `shot-5-storm-at-the-mill.jpg` | A storm: slanting rain, dark towering clouds, the wet mill |
| `shot-6-the-great-tree.jpg` | The Crown's tree in blossom after the ending (working shot) |

## Store blurb

**SKYFARM**: *Grow a garden on an island in the sky. Glide to the next one.*

You wake in your grandmother's hut on a small island above a sea of cloud. A storm long ago broke the
bridges between the twenty islands and put the great tree to sleep. With her seed pouch and her old glider,
you plant what you find, glide out on the warm air to find more, and weave rope and saw planks to stitch the
bridges back. Each one you build turns an island green again.

Eleven crops from three bands of sky, each with its own rules. Thermals marked by rising pollen, currents
that carry you, storms you can see coming hours away. Five hermits with small stories, fluffballs that follow
anyone carrying turnips, and an airship captain who buys your harvest every other day. No combat and no
timers: just you, the wind and a garden.

Free, no ads, no purchases. Runs in the browser. Keyboard and mouse, gamepad, or touch. Captions, colour-safe
cues, reduce motion and comfort options for gliding.

## Trailer (25 seconds)

| Time | Picture | Sound |
|---|---|---|
| 0–3 s | White, like a cloud. It clears on the hut's ceiling; the gardener sits up. Title card over the open door. | Birdsong, a soft piano note |
| 3–7 s | Out of the door at golden hour: till, plant, water. The first sprout pops with a sparkle. | Piano figure starts, the till and the water |
| 7–12 s | Run off the island's edge; the glider opens; the cloud sea drops away; bank toward Daisy Step. | Wind rises with speed; strings swell in |
| 12–15 s | Circle in a thermal's rising pollen, climbing; birds circle alongside. | Wind whistles, strings |
| 15–18 s | A storm building: clouds tower and darken; a caption "[Wind rising: a storm is building]"; land just in time as the rain starts. | Far thunder, the music turns minor, rain |
| 18–22 s | Montage: a bridge going up plank by plank; a parched island turning green; the airship mooring with its horn. | Hammering, the horn ducks everything |
| 22–25 s | The Crown at dusk, the great tree bursting into blossom, petals on the wind. "SKYFARM: free in your browser." | Everything resolves into the home theme |

Capture plan: a save a few days in with Daisy Step restored for the farm beats (`skyfarm.demoGarden()` for
the field), the day-9 storm for the weather beat (`skyfarm.weather("storm")`), and the ending from a save with
the three Old Seeds. Record at 1920 × 1080 on High with "keep 60 fps" off, HUD on for the gameplay beats and
off (`#hud { display: none }`) for the opening and the ending.
