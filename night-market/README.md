<div align="center">

# NIGHT MARKET

### A street-food tycoon where the staff and the regulars are the game

**[▶ Play now](https://rohitpatil9121.github.io/night-market/)**

`JavaScript` · `WebGL2` · `GLSL` · `Projection Lab engine` · `No build step`

</div>

---

## The game

You run a food street for ten nights. You place stalls, hire vendors, set prices, and open up. Customers walk in
hungry, pick a stall, queue, eat, and leave a review. Rent is due every night and it keeps rising.

The money side is a familiar tycoon loop. What makes it different is that **everyone on the street is a
person**. Each vendor has a name, a skill level, an energy bar, a mood and two traits, and they have history
with each other. Two friends working side by side serve faster and cook better. Two rivals side by side slow each
other down, and now and then stop serving to argue in front of both queues. So the layout is a people puzzle:
who you hire, and who you put next to whom, matters as much as what you sell.

- **5 stall types**: skewers (fast, cheap), dumplings (steady, long queue), noodles (slow, the best reviews),
  takoyaki (arrives on night 5, and from then on some customers want nothing else) and bubble tea (a drink,
  bought on top of a meal).
- **10 upgrade levels** per stall: small steps that each cost a little more than the last. A stall gains parts
  you can see at levels 4 and 8.
- **8 vendor traits**: Fast Hands, Perfectionist, Chatty, Hothead, Night Owl, Penny Pincher, Showman, Mentor.
- **Friends and rivals**: some are on record when you hire, some only come out when two people first work side by side.
- **8 regulars** with their own rules and stories: a food critic who never says when she's coming, a broke
  student, your landlord, a rival owner scouting your best vendor, a night-shift nurse, a kid with a dog, a
  tour guide who brings seven hungry people at once, and a health inspector who writes down tired hands,
  botched orders and arguments.
- **21 closing events**: after every night, one decision drawn from what actually happened.
- **Weather**: on a wet night fewer people come out (unless you bought awnings) and the ones who do want
  noodles. Every tenth night is the lantern festival, with a crowd, bunting and fireworks.
- **Somewhere to sit**: customers carry their food to the nearest free stool, and eat standing when the
  tables are full.
- **Fame has a price**: above a reputation of 50, customers expect more and mark every plate harder, so a
  street that was easy at night 4 has to keep improving.
- **4 managers** you hire once and can promote twice: a queue marshal, a buyer, a promoter, and a night manager
  who keeps the street earning **while the game is closed**.
- **Click anyone** to see who they are and, in plain words, what each of their traits and relationships is doing right now.
- A 10-night campaign with a 3-star rating, then **endless mode**, where the rent rises faster every night.
  The campaign saves itself, even mid-night.
- A short **tutorial** walks a first-time player through the first night. It can be skipped, and replayed
  from Settings.

### One night

1. **Before opening**, at sunset. Place or move stalls, hire and assign vendors, set prices. No timer.
2. **The night runs** for about three minutes at normal speed, and the light goes from sunset to night as it
   does. Pause, or run at 2× or 4×. You can change prices while it runs.
3. **Closing.** Takings, costs, reviews, the best and worst moments, and one event that asks you to choose.
4. **Spend** on new stalls, upgrades, managers or a longer street, and go again.

## Controls

| Input | Action |
|---|---|
| Click / tap a person or a stall | See who they are and what they're doing |
| Click an empty spot, then a stall type | Buy a stall there (or the other way round) |
| Drag | Move along the street |
| Wheel / pinch | Zoom |
| `A` `D` / `←` `→` | Move along the street |
| `Q` `E` | Turn the camera |
| `Z` `X` | Zoom in / out |
| `Space` | Pause / resume the night |
| `1` `2` `3` | Speed 1× / 2× / 4× |
| `Esc` | Cancel, close the card, or open the menu |

Building and staffing also work with `Tab` and `Enter`: stalls, staff and managers are listed in the panels, and
regulars on the street appear as buttons in the bar at the bottom.

## How it's built

No three.js and no bundler. Plain ES modules served as static files.

```
night-market/
├── index.html, style.css     interface: title, HUD, build panels, cards, closing, event, settings
├── models.html               model viewer: every model, with the animation clips on buttons
├── game/
│   ├── data.js               every number and name: stalls, traits, regulars, managers, economy
│   ├── sim.js                the whole simulation (pure, deterministic, no DOM)
│   ├── events.js             the 21 closing events and their consequences
│   ├── bots.js               scripted players (the balance tool and the title screen use them)
│   ├── assets.js             loads the models
│   ├── characters.js         a person: skinned mesh, animator, colour palette
│   ├── gfx.js                the street surface shader, the sky, the rain, the stall signs
│   ├── world.js              the 3D scene: street, stalls, people, lights, particles, picking
│   ├── icons.js              interface icons as inline SVG
│   └── main.js               screens, input, camera, labels, tutorial, saving
├── assets/models/*.glb       GENERATED by tools/make-models.mjs
├── assets/packs/             Kenney's Food Kit and Mini Market (CC0): build-time sources only
├── tools/
│   ├── modelkit.mjs          tiny procedural modelling library that writes glTF binary
│   ├── make-models.mjs       every model in the game, as code
│   ├── kenney.mjs            reads asset-pack models into the builder as vertex-coloured shapes
│   ├── balance.mjs           headless balance check
│   └── serve.mjs             static server for local play
├── engine/, shaders/         Projection Lab engine (copied from the engine repo)
└── vendor/                   pinned third-party code and fonts
```

### A simulation with no rendering in it

`game/sim.js` takes a state and steps it at a fixed 60 Hz. It never touches the DOM, the clock or
`Math.random`: every random draw goes through a seeded generator whose seed is stored in the state. The state
is plain JSON. One piece of code therefore drives live play, 4× fast-forward, saving and resuming mid-night,
the bot behind the title screen, and the balance tool. `game/world.js` only reads the state and draws it.
Even offline earnings are a pure function: the page tells it how many seconds have passed.

### Balance is checked, not guessed

`npm run balance` plays the campaign headless on 40 seeds with scripted strategies and fails if any of these stop being true:

1. doing nothing loses;
2. a sensible mixed street wins at least 90% of the time, with a real but not runaway margin;
3. no single stall type on its own does as well as the mix;
4. ignoring who stands next to whom costs money;
5. buying the cheapest thing every night does worse than planning.

`npm run balance -- --trace sensible 7` prints one campaign night by night. The scripted players don't hire
managers, so these checks describe the game without that help.

### The models are (mostly) code

The people, the dog, the stalls and the street furniture are not downloaded art. `tools/modelkit.mjs` is a small modelling library (lathes, lofts, rounded
boxes, smooth normals, skin weights, baked animation clips) that writes standard `.glb` files, and
`tools/make-models.mjs` uses it to build everything: the people and their eighteen animation clips, the dog,
six stalls with their upgrade parts, and the street furniture. Change a shape and run:

```bash
npm run models
```

Open `models.html` to look at the results.

What sits on the counters and in people's hands (skewers, steamers, bowls, drinks, sauce bottles, jars) comes
from two CC0 packs by [Kenney](https://kenney.nl). `tools/kenney.mjs` reads a pack model, applies its node
transforms, looks up the palette swatch under each vertex and turns it into a vertex colour, so pack models
merge into the same single street mesh as everything else and the game still loads no textures for them.

A **person** is one skinned mesh on a 20-joint skeleton. Everyone shares the skeleton, the clips and one
material; an individual is a colour palette (skin, shirt, trousers, hair, accent) set per mesh, a hair style
and accessory merged into their geometry, and a height. The clips are functions of time baked to keyframes
(walk, queue, fidget, reach, eat, drink, sit and eat, cheer, storm off, serve, lean on the counter, slump,
argue, wave…), and the Animator cross-fades between them.

Four of the joints are the **face**: the eyes, each eyebrow and the mouth. No clip touches them. The game
poses them after the clip is sampled, so any expression goes with any animation, and it costs no extra draw
call. The mouth is half a ring: as modelled it is a smile, turned over it is a frown, squashed flat it is a
straight line. People in a queue look more annoyed as their patience runs out, a vendor in an argue scene
scowls, a tired one droops, and everybody blinks.

### Rendering: Projection Lab

The engine is **[Projection Lab](https://github.com/rohitpatil9121/projection_library)**: an orbit camera on a
sphere, a hand-built view basis and dot-product projection, with no matrix camera. This game drove a set of
engine systems that now live in the engine for every future game:

| Engine system | Used here for |
|---|---|
| `StandardMaterial`, lighting chunk | Every surface: sun, shadows, up to 16 point lights, fog |
| `ShadowMap` | Shadows from the evening sun (and later the moon) |
| `PostFX` ambient occlusion | The soft darkening under stalls, tables and feet |
| `loadGLTF`, `Geometry.merge` | Loading the models; merging the whole street into one mesh |
| `Skeleton`, `Animator`, `SkinnedMesh` | The people and the dog |
| `Texture` | Stall signs, painted on a 2D canvas from the game's own SVG icons |
| `ShaderMaterial`, `Geometry` (lines) | Rain: 2,600 streaks in one draw call, moved entirely by the vertex shader |
| `PostFX` bloom, `Sky`, `ParticleSystem` | Glowing signs and lanterns, the sunset-to-night sky, steam and sparks |
| `Camera` | The tycoon view, plus `project()` for labels and `screenRay()` for picking |
| `Game`, `Loop`, `Input`, `Juice`, `Audio` | Fixed 60 Hz steps, input, camera shake, synthesised sound |

**Draw calls.** The street (stalls, tables, gates, lanterns, the city behind) is merged into a single mesh
whenever the layout changes, so it is one draw call however long the street gets. Each person is one more. A
full endless-mode street measured 67 draw calls and 56 more in the shadow pass, for about 175,000 triangles.

**Light.** One sun that casts shadows, a point light for each open stall, lamp and gate, and ambient
occlusion. The sun's colour and strength, the ambient light, the fog and the sky all follow the market clock,
so you set up in warm evening light and close under the lanterns. A stall with nobody working it has its
lights off.

**Text and icons.** Stall tags, names, prices and the icons over vendors' heads are DOM elements placed each
frame with `camera.project()`. Interface icons are inline SVG, and the same drawings are painted onto the
stall signs.

**Measured, not assumed.** The street is one big mesh that never moves, so caching its shadow looked like an
easy win. It was built into the engine (`ShadowMap` with `cache: true`), timed on an Intel UHD, and turned
out slower than just drawing it: 0.5 ms to draw the street's depth, 0.9 ms to copy a kept one. The game
leaves it off. A full frame of a busy eight-stall street took about 8 ms of GPU time at 1280×960 there.

## Accessibility and performance

- Every control is a real button or select with a label; visible focus rings; touch targets of at least 44 px
- Stalls, staff, managers and regulars can all be reached from the panels without the mouse; ordinary
  customers can only be picked by clicking them
- **Reduce motion** (also follows the system setting): no camera shake, title drift, pop-in or flying coins, fewer particles
- **Bloom** and **shadows and soft shading** can each be switched off for slower devices
- The tutorial never blocks the game: every step can be ignored, and one link skips the lot
- If the GPU can't keep up the game lowers its own quality (ambient occlusion first, then resolution, then
  shadows) and says so. It times real GPU work to decide, not the gap between frames
- On phones the build panel, the cards and the speed buttons sit at the bottom of the screen

## Run locally

ES modules need HTTP (not `file://`):

```bash
npm start
```

Then open http://localhost:8137. Any static server works too:

```bash
npx http-server . -p 8080
```

Re-check the economy after editing `game/data.js`:

```bash
npm run balance
```

## Credits

- Engine: [Projection Lab](https://github.com/rohitpatil9121/projection_library), built on
  [projection_library](https://github.com/rohit-s-init/projection_library) by Rohit Sawant
- Third-party code and fonts: see [THIRD_PARTY.md](THIRD_PARTY.md)

## The cartoon look

`ToonMaterial` (in `game/gfx.js`) keeps the engine's StandardMaterial vertex shader, so skinning, instancing
and palettes still work, and swaps the fragment shader: sunlight falls in two tones, colours are pushed a
little richer, and surfaces darken where they turn away from the camera, which reads as an outline without
drawing anything twice. The models carry painted-in shading (each shape darker toward its foot and near the
ground), baked into vertex colours by `tools/modelkit.mjs`. People get their big heads and chunky hands by
scaling joints after each animation sample.
