<div align="center">

# ⏪ REWIND HEIST

### A time-loop stealth heist game in the browser

You never have enough time. Every loop you play is replayed by a **ghost** of your past self.<br>
Put your selves to work, crack the vault, and get the **gold** out.

**[▶ Play it now](https://rohitpatil9121.github.io/rewind-heist/)**

`JavaScript` · `WebGL` · `Custom 3D engine` · `Web Audio` · `No build step`

</div>

---

## 🎮 How it plays

Each heist gives you a short loop of **12–15 seconds**, which is never enough on your own.
When a loop ends, time rewinds and your previous run becomes a **ghost** that repeats exactly what you did.
With up to 5 timelines, you coordinate your past selves: one holds a pressure plate, another breaks a laser beam,
and your live self slips into the vault and carries the gold to the exit.

## ✨ Features

| | |
|---|---|
| ⏪ **Time loops and ghosts** | Every loop is recorded tick by tick and replayed deterministically |
| 🧩 **Puzzle pieces** | Pressure plates, pushable crates, switches, keycard doors, pulsing laser gates, power terminals |
| 👮 **Stealth AI** | Sweeping security cameras and patrolling guards with vision cones, line-of-sight checks and hearing (walls muffle sound) |
| 🚨 **Alarm escalation** | A suspicion meter fills while you're seen, then a lockdown starts. Hide in a locker or break line of sight before it ends |
| 🌀 **Paradoxes** | If you block a ghost's recorded path, the timeline breaks |
| 🕹️ **Plan mode** | Pause, scrub the timeline to preview every ghost, and re-record or erase any single ghost |
| 🐢 **Slow-mo** | Hold Shift to slow time, limited by an energy bar |
| 🎥 **3D camera** | A third-person chase camera (drag to orbit, wheel to zoom) or a tactical overhead view (`V`) |
| 🗺️ **Live minimap** | Walls, doors, vision cones, lasers, ghosts, guards and loot |
| 🔊 **Synth audio** | All sound is generated with the Web Audio API, with no audio files |
| 🎬 **Heist replay** | Win, and watch all your selves pull off the job together |
| ⭐ **3-star rating** | Win, stay within par loops, collect the gem. Best scores are saved locally |
| 📱 **Touch support** | On-screen joystick and action buttons on phones and tablets |

## ⌨️ Controls

| Key | Action |
|---|---|
| `W A S D` / Arrows | Move (relative to the camera) |
| `Click` | Move to a spot |
| `Drag` / `Wheel` | Orbit / zoom the camera |
| `V` | Switch between chase and tactical camera |
| `F` | Use: hide in a locker, flip a switch, cut power |
| `G` | Grab / drop / swap items |
| `T` / `Space` | Throw the carried item |
| `Shift` | Slow-mo |
| `Tab` | Plan mode (timeline) |
| `E` | End the loop now (your ghost stays where you stand) |
| `R` | Retry the loop |
| `Z` | Erase the last ghost |
| `N` | New heist |
| `M` | Mute |
| `Esc` | Menu |

> 💡 **Laser tip:** step into a beam while it's **off** and press `E`. Your ghost stays there in every later loop and keeps the beam broken.

## 🗺️ Levels

| # | Level | Teaches | Loop | Par |
|---|---|---|---|---|
| 01 | **The Lobby** | Plates, gates, crates, camera sweeps | 14s | 3 |
| 02 | **Laser Gallery** | Laser timing, keycards, power terminals | 14s | 3 |
| 03 | **The Vault** | Guard patrols, noise, lockers, switches | 15s | 3 |

## 🛠️ Tech

No frameworks and no build step: two files, straight into the browser.

```
rewind-heist/
├── index.html   # game: simulation, AI, controller, HUD, audio, level data, scene drawing
└── space.js     # 3D engine: camera, geometry builder, WebGL shaders, post-processing
```

### The 3D engine: `space.js`

The renderer is adapted from **[projection_library](https://github.com/rohit-s-init/projection_library)** (`public/Space.js`).
It keeps that library's core ideas:

- **Orbit camera.** The camera sits on a sphere of radius `Rc` around the view point `(X0, Y0, Z0)` and is steered by `alpha` (yaw) and `beta` (pitch). The world is Z-up.
- **Camera basis.** `getXaxisUnitVector`, `getYaxisUnitVector` and `getZaxisUnitVector` build the view axes with a lambda projection of world-up onto the view plane.
- **Dot-product projection** in the vertex shader: `xProj = dot(v, xAxis)`, `yProj = dot(v, yAxis)`, `zProj = dot(v, zAxis)`.

Upgrades on top of the original:

- Perspective goes through `gl_Position.w`, so geometry behind the camera is clipped instead of mirrored, and there's no divide-by-zero.
- Screen-x orientation is corrected, and the aspect ratio comes from the canvas.
- Static level geometry is uploaded once; moving objects stream in each frame.
- Hemisphere + sun + 8 point lights, emissive materials and distance fog.
- Opaque, alpha-blended and additive passes.
- A post-processing pass: glow, VHS rewind distortion, alarm tint and vignette.

### Deterministic simulation

The game logic (`stepWorld`) is a pure, fixed-timestep (60 Hz) simulation with no rendering inside it.
Ghosts store positions and actions per tick. Because every loop replays identically,
the same code powers live play, plan-mode previews and the end-of-heist replay.

## 🚀 Run locally

Double-click `index.html`. That's it. Both scripts load as plain files, so they work from `file://`.

Or serve the folder:

```bash
npx http-server . -p 5173
```

The UI fonts come from Google Fonts and need an internet connection; the game falls back to system fonts without one.

## 🙏 Credits

- 3D projection math: [rohit-s-init/projection_library](https://github.com/rohit-s-init/projection_library)
- Fonts: [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani) via Google Fonts
