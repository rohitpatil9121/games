# What BREACH, DECOY and TIDEFALL share, and where it should live

All three games carry their own copy of the same multiplayer code, each edited a little. Measured by diffing
the files on 2026-10-20 (DECOY read only, not changed): `server/server.mjs` differs by 18 lines between any
two of them; `game/net.js` by 39 lines (BREACH and DECOY) and 162 (BREACH and TIDEFALL); `server/room.mjs`,
`game/protocol.js`, `game/controls.js` and `game/sound.js` by 100 to 300 lines, mostly game fields.

## A shared multiplayer module (`projection-net`, or `engine/net/`)

| Piece | Today | What would be shared | What stays in each game |
|---|---|---|---|
| Static + WebSocket server | `server/server.mjs` ×3, near-identical | The whole file, given a game id, a protocol number and a `Room` class | Nothing but those three arguments |
| Room skeleton | `server/room.mjs` ×3 | Joining and leaving, ids, host, input queue with time credit, lag (`vt` → ticks ago), rate limiting, ping, chat, bot fill by team, per-client delta of rows (`sent` maps), the 60 Hz tick shape | `startMatch` (map or island), what a snapshot contains, bot brains |
| Transports | `Loopback`, `SocketTransport`, `Conditions` in `game/net.js` ×3 | All three classes, unchanged | Nothing |
| Client | `Client` in `game/net.js` | Prediction buffer, reconciliation with easing and snap distance, interpolation buffer and `renderTick` clock, traffic stats, events | A hook for "step my player" (TIDEFALL passes the water at the player's clock), and the row layout for `sample()` |
| Byte packing | `Bytes`, `encode`/`decode`, `cleanText`, `cleanInput` frame in `game/protocol.js` | The cursor class, the JSON/binary switch (`WIRE`), the text cleaners, a declarative row/event schema | The schema itself |
| Deterministic maths | `dsin`, `quantizeYaw`, mulberry32 (`sim.js` in BREACH/DECOY, `game/det.js` here) | All of it | Nothing |
| Tests | `tools/net-test.mjs` ×3 (harness, Conditions on a virtual clock, real-server part), `tools/chrome.mjs`, `tools/look.mjs` | The harness and the real-server checks | The scenario code (strafing target, shoves, hide-and-seek) |

## Into the engine itself

- **Input**: a radial stick deadzone (TIDEFALL's `controls.js` works around the engine's per-axis one), and
  the pointer-lock mouse-button workaround all three games repeat.
- **Rebinding UI and `capture()`**: the same code in all three `controls.js`.
- **Audio buses**: TIDEFALL added `opts.bus` to `Audio.play`; ui/ambience buses, dB levels and ducking
  (`game/sound.js`) are general. `at()` (positional, by the camera) is in all three `sound.js`.
- **Third-person spring-arm camera** (`game/camera.js`): the engine has orbit and follow but no collision.
- **Save helper**: versioned, migrated, scratch-then-swap with a backup (`game/save.js`).
- **GPU-synced frame timing and in-page pixel metrics** (`tools/inspect.mjs`): a `renderer.measure()`.
- **Shadows**: TIDEFALL found the terrain casting shadows was 85% of the frame; a per-entity
  `castShadow: false` default for large ground meshes, or a note in the engine docs.

Suggested order: transports and the server first (no game code in them), then the Room skeleton with game
hooks, then the Client with a step hook. Each game would then shrink by about 1,000 lines.
