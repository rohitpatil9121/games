# Neon Rush · Art Bible

> Phase B of the visual upgrade. This is the contract every visual change follows.
> Status: **approved direction: player-selectable styles**. Implementation waits for the Projection Lab
> engine systems (Palette, Sky, Fog, Material, Light, PostFX, ParticleSystem, Juice). See §9.

## 1. The big idea: many looks, one readable game

The player picks a **Style** in the menu, and the whole game changes: sky, world, materials, lighting,
particles, post-processing and UI accents. Every style must pass the same **readability contract** (§2),
so switching style never changes what is dangerous, what is collectable, or where the player is.

```
Style = palette roles + sky + fog + ground + environment dressing
      + material presets + particle presets + post-FX preset + UI accent
      (+ 5 per-level variants inside each style)
```

## 2. Readability contract (applies to every style)

| Role | Rule |
|---|---|
| **Player** | Owns a colour **no other object uses**. Brightest *non-VFX* object near the bottom of the screen. Always has a rim/outline so it survives bloom. |
| **Hazards** (walls, low bars, lasers, sliding blocks) | Drawn from the style's **danger** colour, identical in all 5 levels of a style. Never shared with rails, arches, grid or props. |
| **Pickups** (orbs) | The style's **reward** colour; round silhouette; pulse. |
| **Power-ups** | Their own fixed identity colours (§5.3), identical in every style, so the icon on the HUD always matches the pickup in the world. |
| **Environment** | Lower saturation and value than gameplay objects. It may be beautiful, but it must stay *behind*. |
| **UI** | Readable over any frame: glass panels with a minimum 4.5:1 text contrast (WCAG AA). |

### 2.1 Value structure (greyscale test)
Convert a gameplay frame to greyscale. The layers must read in this order:

| Layer | Relative luminance target |
|---|---|
| Sky / far background | 0.00 – 0.08 |
| Environment (ground, rails, arches, skyline) | 0.05 – 0.25 |
| Gameplay objects (player, hazards, pickups) | 0.35 – 0.75 |
| Highlights and VFX (hits, bursts, rim) | 0.80 – 1.00, short-lived |

Every style ships with its greyscale test screenshot. A style that fails does not ship.

### 2.2 Colour-blind safety
Hue alone never carries meaning. Danger and reward differ in **shape** and **value**, not just colour.
Hazards are angular and darker-edged; orbs are round and bright-centred. This is checked with
deuteranopia and protanopia simulations, because danger red and reward gold can look alike.

## 3. Shape language

| Object | Shape | Reads as |
|---|---|---|
| Player ship | Low, wide arrowhead; swept wings; single bright cockpit; engine glow at the back | fast, friendly, "you" |
| Wall | Tall slab, hard edges, chevron warning stripe on the face | stop, go around |
| Low bar | Wide, short, striped top edge | jump |
| Laser gate | Two posts + thin beams; posts glow before the beams light | timing |
| Sliding block | Slab with arrow markings in its direction of travel | moving threat |
| Orb | Round (sphere/icosphere), soft pulse, sparkle | take me |
| Power-up | Round base plate + unique icon shape (§5.3) | special |

## 4. Emission budget

Only gameplay-relevant things may glow. Everything else is lit, not emissive.

| Glows (emissive → bloom) | Does not glow |
|---|---|
| Player cockpit, engine, rim | Ground (except faint grid lines) |
| Hazard edges and warning stripes, laser beams when live | Towers / skyline bodies (windows may twinkle at low intensity) |
| Orbs, power-ups | Rails (a thin edge line at most, below the gameplay objects' brightness) |
| Hit / collect / death VFX (brief) | Arches (dimmed rim only) |
| Sun / moon / sky features (behind everything) | UI panels |

Bloom is **selective**: only fragments above the emissive threshold contribute.

## 5. Colour roles per style

Each style defines these roles. Hex values are the source of truth for the Palette system.

### 5.1 Styles

| Style | Mood | Background | Environment | Player | Danger | Reward | Signature effects |
|---|---|---|---|---|---|---|---|
| **Neon Night** *(default)* | Clean late-night city, precise lights on deep navy | `#070A18` | `#1B2350` `#2E3A78` | `#E8FFFF` + cyan rim `#4DF3FF` | `#FF3B5C` | `#FFD23F` | Gradient sky + stars, height fog, selective bloom, subtle grade |
| **Retro CRT** | 80s arcade cabinet, loud and chunky | `#000000` | `#0A2A33` grid `#00F0FF` | `#FFE600` | `#FF2A2A` | `#39FF14` | CRT curvature, scanlines, phosphor glow, 0.6× pixel scale, RGB split on impacts only |
| **Vaporwave** | Pastel sunset daydream | sky `#FF9EC7` → `#8E7CFF` | `#B8A1FF` `#7FE7DC` (low value) | chrome `#F4F4FF` + pink rim | `#2B1240` silhouettes with `#FF4FA3` edges | `#FFF3B0` iridescent | Soft bloom, dust bokeh, glass, warm grade |
| **Deep Space** | Racing through a nebula above a planet | `#02030A` + nebula `#3A1C71` `#0E5A8A` | `#1A2440` | `#DDF4FF` + blue rim | `#FF6A2B` (hot plasma) | `#B6FF5C` | Starfield, nebula sky, planet horizon, no ground grid (light rails only), light streaks |
| **Solar Desert** | Molten dusk over dunes, heat haze | `#1A0A06` → `#5A1E0E` | `#6B3A22` `#8C5A3A` | `#E9F9FF` + teal rim `#2EE6D6` | `#FF1F4B` | `#FFE27A` | Big low sun, heat distortion, dust, warm/teal grade |

The danger/reward pairs were chosen to differ in value, not just hue (e.g. Neon Night: danger L≈0.30,
reward L≈0.68).

### 5.2 Per-level variants (inside every style)
Levels keep one visual family and change *time, weather and accent* so each sector is recognisable:

| Level | Variant | What changes |
|---|---|---|
| 1 · Neon Boulevard | "Dusk" | Warmest sky, lowest fog, open horizon |
| 2 · Laser Alley | "Narrow" | Closer skyline, tighter fog; danger colour gets extra rim so lasers pop |
| 3 · Traffic Grid | "Rush hour" | More moving lights/props on the skyline, busiest dressing |
| 4 · Pulse Canyon | "Canyon" | Environment walls closer to the track, speed-reactive pulses |
| 5 · Overdrive | "Night peak" | Darkest sky, strongest stars/nebula, highest post-FX intensity (still within budget) |
| Endless | Cycles variants 1→5 every 1.2 km | Palette blends over ~2 s |

The variant only touches **environment and sky** roles; player / danger / reward stay fixed within the style.

### 5.3 Power-up identity (same in every style)

| Power-up | Colour | Shape | Aura while active |
|---|---|---|---|
| Shield | `#3FE8FF` | Hexagon with a ring | Fresnel bubble around the ship |
| Magnet | `#FF4F73` | U-shape | Pull-lines toward the ship |
| Double | `#5DFF7A` | Two stacked diamonds | Green sparks from the wing tips |
| Slow-mo | `#A57BFF` | Hourglass | Slight desaturation + violet edge tint |
| Boost | `#FFA51A` | Chevron arrow | Stretched trail, FOV kick, speed lines |

## 6. Lighting

- **Hemisphere ambient** from the style's sky/ground colours.
- **One key directional light** (the sun/moon direction in the sky shader).
- **Rim / fresnel** on the player, hazards and pickups, so silhouettes read against any background.
- **Point lights** (budget 8): the player engine, the nearest pickups, and active lasers.
- **Grounding:** a blob shadow under the player always; a real shadow map only at HIGH/ULTRA.

## 7. Motion language

| Tier | Events | Duration | Easing | Juice |
|---|---|---|---|---|
| T0 ambient | Pickup bob/spin, sky drift, dust | continuous | sine | none |
| T1 small | Lane change, orb collect | 80–150 ms | `easeOutCubic` | bank tilt, small burst, +score pop |
| T2 medium | Jump/land, near miss, streak level-up | 150–300 ms | `easeOutBack` | squash & stretch, ring shockwave, pitch-rising SFX |
| T3 large | Power-up pickup, shield break, smash | 300–600 ms | `easeOutExpo` | aura on, screen tint, trauma shake 0.3–0.5, short CA spike |
| T4 huge | Death, sector clear | 600–1500 ms | custom | hit-stop 80–120 ms, trauma 0.8+, white flash on the ship only, slow-mo, debris, stylish fade |

Rules: intensity scales with importance; a T1 event never uses a T3 effect. Camera shake is trauma-based
(noise, decaying), never random jitter.

## 8. Accessibility

- **Reduce motion**: no shake, no FOV kick, no parallax, calmer sky, 50% particles.
- **Reduce flashes**: no full-screen flashes; the ship-only white flash is kept at 30%; no CA spikes.
- Both apply to every style. Retro CRT additionally offers "scanlines off".

## 9. How styles map to engine systems (reusable by any game)

| Style part | Projection Lab system | Preset name example |
|---|---|---|
| Colour roles | `Palette` | `palette.set('neon-night', { variant: 2 })` |
| Sky | `Sky` shader (`gradient`, `stars`, `nebula`, `sun`, `planet`) | `sky: 'nebula+planet'` |
| Fog | `Fog` (exponential height + distance) | `fog: { density, heightFalloff, color: 'horizon' }` |
| Ground | `GroundGrid` shader | `ground: 'grid' | 'dunes' | 'none'` |
| Materials | `Material` presets (`toonRim`, `neonEdge`, `glassFresnel`, `hologram`) | `materials.hazard = 'neonEdge'` |
| Particles | `ParticleSystem` presets | `collect: 'sparkRing'`, `death: 'shatter'` |
| Game feel | `Juice` presets (T1–T4 above) | `juice.play('T3.powerup')` |
| Post | `PostFX` preset | `post: 'crt' | 'clean' | 'dreamy'` |
| UI accent | CSS variables from `Palette` | `--accent`, `--danger`, `--reward` |

A new game reuses all of it with a few lines:

```js
const style = Styles.get('neon-night');
game.applyStyle(style, { variant: level.index });
```

## 10. Style selector (UX)

- In Settings and on the level-select screen: a row of style cards with a **live preview** (the menu's
  attract-mode background switches immediately).
- The choice is saved locally. The default is **Neon Night**.
- Styles are not unlockables. All are available from the start (no fake progression).

## 11. Definition of done for a style
1. Passes the greyscale test (§2.1) and the colour-blind simulation (§2.2).
2. Stays within the emission budget (§4).
3. Has all 5 level variants.
4. Holds MEDIUM-quality performance targets.
5. Has before/after screenshots in the README.
