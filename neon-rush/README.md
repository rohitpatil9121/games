<div align="center">

# 🌆 NEON RUSH

### A synthwave runner in the browser, built on a from-scratch WebGL engine

**[▶ Play now](https://rohitpatil9121.github.io/neon-rush/)**

`JavaScript` · `WebGL` · `GLSL` · `GSAP` · `Web Audio` · `No build step`

</div>

---

## 🎮 The game

Race down a neon highway, switch lanes, jump and chain orbs for a multiplier. Five themed sectors each add a new
hazard, and **Endless** mode keeps speeding up until you crash.

### Levels

| # | Level | New challenge | Length |
|---|---|---|---|
| 01 | **Neon Boulevard** | Walls: learn the lanes | 1.2 km |
| 02 | **Laser Alley** | Pulsing laser gates and low bars | 1.7 km |
| 03 | **Traffic Grid** | Blocks sliding across the lanes | 2.2 km |
| 04 | **Pulse Canyon** | Every hazard, faster | 2.8 km |
| 05 | **Overdrive** | Top-speed finale | 3.6 km |
| ∞ | **Endless** | A new zone and color theme every 1.2 km | — |

Collect orbs to earn up to ★★★ per level. Clearing a level unlocks the next one. Progress is saved in your browser.

### Power-ups

| | Power-up | Effect |
|---|---|---|
| 🛡️ | **Shield** | Absorbs one crash |
| 🧲 | **Magnet** | Pulls in nearby orbs (8 s) |
| ✖2 | **Double** | Double score (10 s) |
| ⏳ | **Slow-mo** | Slows time (5 s) |
| 🚀 | **Boost** | Extra speed, and you smash through walls (4 s) |

### More to play with
- **Double jump**: jump again mid-air
- **Near misses**: bonus points for passing right beside a wall or sliding block
- **Streaks**: every 8 orbs in a row raises the multiplier, up to ×5
- **Floating popups** for points, smashes and power-ups; warning banners when new hazards appear

## ⌨️ Controls

| Key | Action |
|---|---|
| `A` `D` / `←` `→` | Change lane |
| `W` / `Space` / `↑` | Jump (press again for a double jump) |
| `S` / `↓` | Drop fast |
| `P` / `Esc` | Pause |
| `R` | Restart |
| `M` | Mute |
| 📱 Touch | Swipe to steer, tap or swipe up to jump, swipe down to drop |

## 🛠️ How it's built

No three.js, no bundler. Plain ES modules served as static files.

```
neon-rush/
├── index.html            # UI: menu, level select, HUD, pause, settings, end screens (GSAP-animated)
├── runner/
│   ├── game.js           # gameplay: levels, hazards, power-ups, scoring, audio, camera
│   └── RunnerSpace.js    # game shaders on top of Space
├── Space.js              # 3D engine from projection_library
├── Point.js, Shapes/     # engine helpers
```

### Engine: `Space.js`
Rendering is done by **[projection_library](https://github.com/rohit-s-init/projection_library)**'s `Space`:
- an orbit camera: a view point `(X0, Y0, Z0)`, distance `Rc`, and angles `alpha` (yaw) and `beta` (pitch)
- a hand-built camera basis, `getX/Y/ZaxisUnitVector`
- dot-product projection in the vertex shader
- vertex upload that sends only newly added geometry to the GPU

The track streams in 48-unit chunks through `addElements`. World coordinates are periodically shifted back
near zero, so float precision holds even after many kilometers.

### Shaders: `RunnerSpace.js`
`RunnerSpace` extends `Space` with its own GLSL:
- a **procedural neon floor grid** (lane lines plus cross lines that keep scrolling seamlessly)
- a **synthwave sun** with a gradient and animated cut-out bands
- **distance fog** and per-level color themes that blend smoothly
- a **post-processing pass**: bloom driven by a glow value stored in alpha, chromatic aberration, speed streaks,
  vignette, scanlines, film grain, hit flashes and power-up color grading

### Interface
[GSAP](https://gsap.com/) animates the menus, banners, star reveals and score count-ups. The game still works
if GSAP fails to load. Sound is synthesized live with the Web Audio API, so there are no audio files.

## 🚀 Run locally

ES modules need to be served over HTTP (not opened from `file://`):

```bash
npx http-server . -p 8080
```

Then open http://localhost:8080.

## 🙏 Credits
- 3D engine: [projection_library](https://github.com/rohit-s-init/projection_library) by Rohit Sawant
- Fonts: Orbitron and Rajdhani (Google Fonts) · Animation: GSAP
