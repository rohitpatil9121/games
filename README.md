<div align="center">

# ORBITAL

### A gravity puzzle. Place worlds, bend the path, reach the light.

**[▶ Play now](https://rohitpatil9121.github.io/orbital/)**

`JavaScript` · `WebGL2` · `GLSL` · `Projection Lab engine` · `No build step`

</div>

---

## The game

A comet launches across a sheet of spacetime. You never steer it. Instead you drag **moons, planets, giants
and pulsars** onto the grid, and their gravity bends the comet's path. A dotted line previews the whole
flight as you drag, so you can feel the path move. Thread it through the stardust and into the portal.

- **12 systems**, each proven solvable with all 3 stardust by an automatic solver
- **Sandbox** with unlimited bodies, including your own black holes
- Bodies with different pulls: moon (light), planet, giant (heavy), **pulsar (pushes away)**
- Hazards: **black holes** that swallow the comet, **orbiting moons** that keep moving, walls of giants
- Live **trajectory preview**: the end of the line turns green when it reaches the portal, red when it crashes
- **Hints**: ghost bodies show one working solution
- A star chart, stardust ratings, saved progress

## Controls

| Input | Action |
|---|---|
| Drag from the dock | Place a body on the grid |
| Drag a placed body | Move it |
| Double-click / right-click / drag back to the dock | Remove it |
| `Space` or **Launch** | Launch the comet (press again to stop) |
| `F` (hold) | Fast-forward the flight |
| `R` | Stop the flight |
| `H` | Hint |
| `Z` | Undo the last body |
| `Esc` | Pause |

Touch works the same way: drag bodies with a finger. On portrait screens the field turns upright.

## How it's built

No three.js and no bundler. Plain ES modules served as static files.

```
orbital/
├── index.html, style.css     interface: title, star chart, HUD, result, settings
├── game/
│   ├── sim.js                gravity simulation (pure, deterministic)
│   ├── levels.design.js      hand-made level designs
│   ├── levels.js             GENERATED: designs + stardust + proven solutions
│   ├── fabric.js             the spacetime grid shader
│   ├── world.js              the 3D scene for a level
│   └── main.js               screens, input, flight, progress
├── tools/solve.mjs           level solver / validator (Node)
├── engine/, shaders/         Projection Lab engine (copied from the engine repo)
└── vendor/                   pinned third-party code and fonts
```

### Physics

The comet is pulled by every body with Newtonian gravity, softened so close passes stay stable:

```
a = Σ G·mᵢ · dᵢ / (|dᵢ|² + ε²)^(3/2)
```

Integration is semi-implicit (symplectic) Euler with 6 substeps per 60 Hz frame. Because the simulation is
deterministic, the **same code** draws the preview, flies the comet and powers the solver. The preview you
see is exactly the flight you get.

### Levels that can't be broken

`npm run solve` (`tools/solve.mjs`) checks every design:

1. it rejects a level the comet can win with **no** bodies placed;
2. it searches for a winning placement (random sampling, then hill climbing);
3. among wins it prefers **robust** ones, where nearby placements also win, so humans have some slack;
4. it lays the three stardust along the winning path and writes `game/levels.js`, with the solution as the hint.

If any level has no solution, the script fails and nothing is written.

### Rendering: Projection Lab

The engine is **[Projection Lab](https://github.com/rohitpatil9121/projection_library)**: an orbit camera on
a sphere, a hand-built view basis and dot-product projection, with no matrix camera. ORBITAL drove these
engine systems, which now live in the engine for every future game:

| System | Used here for |
|---|---|
| `PostFX` | HDR bloom, ACES tone mapping, vignette, grain, edge-aware anti-aliasing |
| `Sky` | Procedural nebula and two layers of twinkling stars |
| `ParticleSystem` | Comet tail, portal swirl, black-hole matter, bursts |
| `Trail` | The comet's light streak |
| `ShaderMaterial` | The spacetime fabric |
| `GlowMaterial` | Planet atmospheres, portal core |
| `Tween`, `Juice` | Camera easing, impact shake, hit-stop |
| `Audio` | Procedural sound (ZzFX) and an ambient drone |

**The spacetime fabric** is a 170 × 110 grid displaced in the vertex shader by the same masses the physics
uses: `depth = −K · Σ mᵢ / √(rᵢ² + S²)`. The identical formula runs on the CPU so planets sit in their own
wells and the comet rides the surface.

## Accessibility

- Every control is a real button with a label; visible focus rings; touch targets of at least 44 px
- A body can be placed from the keyboard (focus a dock chip, press `Enter`)
- **Reduce motion** (also follows the system setting): no camera shake or drift, fewer particles
- Bloom can be switched off for slower devices

## Run locally

ES modules need HTTP (not `file://`):

```bash
npx http-server . -p 8080
```

Re-validate the levels after editing `game/levels.design.js`:

```bash
npm run solve
```

## Credits

- Engine: [Projection Lab](https://github.com/rohitpatil9121/projection_library), built on
  [projection_library](https://github.com/rohit-s-init/projection_library) by Rohit Sawant
- Third-party code and fonts: see [THIRD_PARTY.md](THIRD_PARTY.md)
