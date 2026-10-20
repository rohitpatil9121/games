<div align="center">

# TIDEFALL

### The sea goes out. The ruins come up. Get back before it returns.

`JavaScript` · `WebGL2` · `GLSL` · `Projection Lab engine` · `Node + ws` · `No build step`

</div>

---

## The game

Two to four crews of beachcombers (up to eight players, bots in empty places) camp on the high ground of an
island where the sea rises and falls on a clock. When it goes out, a drowned town comes up out of the sand.
You run down, grab what you can carry, and race the flood back to your camp's chest. Nothing counts until
it's banked.

- **Six tides of 90 seconds**: ebb (30 s, the water drains ring by ring), low (25 s), flood (25 s, a horn,
  the outer ring goes first), high (10 s). Each tide goes lower than the last, so the deepest ruins and the
  wreck only open in tides 5 and 6, at sunset.
- **Loot has weight**: coins (1 kg, 10), relics (3 kg, 40), idols (7 kg, 130, they glow, everyone sees who
  has one). Weight slows you and lowers your jump. Over 4 kg you sink in deep water and walk the sea floor
  while your breath runs out; then the heavy loot sinks where you are.
- **Tools, no guns**: a grapple to pull yourself to ruins and rocks; a shove that knocks loot out of a
  rival's hands (two items from behind); a flare that marks a spot for your team and dazzles rivals looking
  at it.
- **A new island every match**, generated from a seed and checked for fairness before anyone plays it.
- **Bots** that weigh greed against the tide clock. Some get caught by the flood. That's meant.
- **Rooms** by four-letter code, quick play, invite links, chat, a scoreboard; **Practice** offline.

## Controls

Every control can be changed in Settings. These are the defaults.

| Input | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `Space` | Jump, swim up, climb a ledge |
| `Shift` | Sprint (not in water) |
| `E` | Pick up |
| `Q` | Drop the last item |
| Right mouse or `F` | Grapple |
| Left mouse | Shove |
| `R` | Flare |
| `Tab` | Scores |
| `Enter` | Chat |
| `Esc` | Pause menu (the tide doesn't wait) |
| `F3` | Numbers: frame time, ping, traffic, prediction |

**Gamepad**: left stick moves (pushed all the way it sprints), right stick looks, A jumps, X picks up, B drops,
LT grapples, RT shoves, Y flares, Back shows scores, Start pauses; menus by d-pad, A and B.
**Touch**: a stick on the left, buttons on the right, drag anywhere else to look.

## How to run it

```bash
npm install     # one dependency: ws
npm start       # http://localhost:8150: the game and its server on one port
```

Open it in two tabs (or on two machines) and press **Create a room** in one and **Join** in the other.
**Practice only, no server**: any static file server (`npm run static`, GitHub Pages, itch.io); the page
notices there is no server and offers Practice alone. **Page and server apart**: `?server=wss://your-host`.

The server is `node server/server.mjs`: files and WebSocket (`/ws`) on one port from `PORT`, health check
`GET /status`, `MAX_ROOMS` and `MAX_PER_ADDRESS` limits. An itch.io build is a zip of the static files
(see `dist/` after building; not uploaded).

## How it's built

No three.js, no physics library, no bundler. Plain ES modules, the same files in the browser and in Node.

```
tidefall/
├── index.html, style.css      title, HUD, pause, settings, scores
├── game/
│   ├── sim.js                 the match: movement, swimming, tide, loot, carrying, banking, shove, grapple, flare, scoring. Pure, seeded
│   ├── tide.js                the water height as a pure function of seed and tick
│   ├── island.js              the seeded heightmap, camps, ruins, wreck, loot spots
│   ├── fairness.js            is an island fair? and the first fair one from a seed
│   ├── nav.js                 travel-time fields over the island at a water level (bots, checks)
│   ├── det.js, data.js        deterministic maths; every tuning number
│   ├── bots.js                utility-AI bot brains
│   ├── protocol.js, net.js    the wire format; prediction, reconciliation, interpolation, bad-network simulator
│   ├── world.js, gfx.js       the scene; terrain, water, stone and sky shaders
│   ├── models.js, characters.js  props and loot from primitives; the skinned raider
│   ├── camera.js, controls.js third-person spring-arm camera; keyboard, mouse, gamepad, touch, rebinding
│   ├── hud.js, sound.js       the display; the mixer, music, ambience, captions
│   ├── tutorial.js, save.js   first-match tips; the versioned, crash-safe save
│   └── main.js                screens, settings, wiring
├── server/server.mjs, room.mjs   static files + rooms + the 60 Hz clock; one match (also run in-page for Practice)
├── tools/                     tests, island checks, bot matches, net test, playtest, models, screenshots
├── engine/, shaders/, vendor/ Projection Lab, gl-matrix, ZzFX, fonts
└── GDD.md, NOTES.md, notes/progress.md, marketing/
```

**The sea costs nothing.** The water level is `tideAt(seed, tick)`: every client and the server compute the
same level, so no snapshot carries it. Each player has a clock of their own (one tick per input applied) and
moves through the water of that tick, so a client predicting itself knows the water exactly even when its
inputs arrive late and are applied in a burst.

**A fair island, or the next one.** Teams split the island into equal sectors; noise is sampled with the
angle multiplied by the team count (so the terrain repeats exactly per sector), ruins are placed per sector
and turned to face the centre, the wreck lies broken into one piece between each pair of camps.
`fairness.js` checks camp height, that every ruin can be reached on foot by the tide its ring opens, and
that travel times from each camp agree within 12%; a room skips any seed that fails.

**One simulation, three users** (as BREACH): the server, the predicting client and the Node tools run the
same `sim.js` in fixed 1/60 s ticks with a seeded generator and integer angles through their own sine.

## How the netcode works

BREACH's model, copied and adapted: authoritative server at 60 Hz; clients send inputs (move axes, buttons,
view angles), never positions; prediction with the same `stepPlayer()`, reconciliation by replaying unacknowledged
inputs; other players drawn 5 ticks in the past; 20 binary snapshots a second with only what changed;
shoves lag-compensated against where the shover saw the target, at most 200 ms back. The server decides
every pickup (reach, room in the pack), every bank (your own camp), every grapple (a ray from the player's
own position, at most 30 m) and every weight; messages are rate-limited and inputs clamped.

### Measured

| | |
|---|---|
| Prediction error, 0 to 300 ms ping with jitter and 5% loss, running into the sea and back | **0.0000 m**, no corrections (`npm run test:net`) |
| Shoves aimed at where a strafing target is seen, 0–150 ms | 42/42, 41/41, 42/42, 40/44 land (without lag compensation: 42, 2, 41, 24) |
| The same at 150 ms ±30 with 2% loss | 34/44 (retransmitted inputs arrive past the 200 ms cap) |
| Traffic per client, 8 players, a minute of low tide | **3.5 kB/s down**, 1.0 kB/s up (62.4 down as JSON text) |
| Frame, 8 players and the island in view, 1280 × 720, Intel UHD integrated graphics | **1.6 ms** median GPU-synced, 12.8 ms worst of 30 (`tools/inspect.mjs`) |
| Draw calls / shadow draws / triangles in that view | 84 / 27 / 179 k |
| Download and load | 1.34 MB of files, 77 requests, 1.0 MB transferred uncompressed; playable 0.9–1.0 s after opening on localhost (no network delay counted); itch zip 419 KB |
| Server tick, 8 bots thinking | 0.35 ms average, 14.4 ms worst, none over 16 ms in 216 minutes of bot play |
| Bot balance, 24 matches of 4 teams of 2 (fresh seeds) | wins by camp 4 / 8 / 4 / 8, average bank 602 to 728; 3% of carried loot lost to the sea, 15 heavy loads taken by the flood, 6 drownings |

See `notes/progress.md` for the balance report and how each number was taken.

## Tools

```bash
npm test               # simulation tests (26) and island checks (60 islands)
npm run test:net       # netcode under ping, jitter and loss; then the real server
npm run playtest       # a match played through real key presses in headless Chrome
npm run bots           # headless bot matches: wins by camp, the flood's take, greed, skill
npm run check          # island fairness for many seeds
npm run models         # rebuild the raider
npm run shots          # the marketing screenshots
node tools/inspect.mjs <name> "<script>"   # pixel metrics and frame time for a view
```

## Known issues and next updates

- Bots: greed doesn't pay for them (careful bots bank a little more), and the three skill levels play
  about the same; skill only changes reaction time and how well they judge the flood. Next: let skill
  change choices (who to rob, when to grapple, guarding).
- Camp balance in bot play is within the noise of 24 matches (wins 4 / 8 / 4 / 8), and the camp that
  led changed between seed sets; the island geometry itself is identical for every camp (travel times to
  each ring agree to two decimals). A run of a few hundred matches would settle it.
- Not tried by a person: how it feels to play, how it sounds, a real gamepad, a real phone (touch is built
  and laid out, never touched), and anything over a real network beyond localhost.
- Next: cosmetic hats per player, a tide-6 "golden idol" event, a map overview at high tide, spectating
  after drowning.

## Credits

Built on **Projection Lab** (https://rohitpatil9121.github.io/projection_library/), which grew out of
projection_library by Rohit Sawant. Netcode adapted from BREACH. Third-party code, fonts and the ten CC0
sound effects are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
