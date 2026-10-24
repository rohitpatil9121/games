# Games

Browser games built on **Projection Lab** (https://rohitpatil9121.github.io/projection_library/), my own
WebGL engine. No three.js, no bundler; plain ES modules.

**[▶ All of them on one page](https://rohitpatil9121.github.io/games/)**

| Game | Play | What it is |
|---|---|---|
| [SKYFARM](skyfarm/) | [Play](https://rohitpatil9121.github.io/games/skyfarm/) | Grow a garden on an island in the sky, glide to the next one. Solo here; co-op for up to 4 with its Node server. |
| [TIDEFALL](tidefall/) | [Practice](https://rohitpatil9121.github.io/games/tidefall/) | Raid the ruins the tide uncovers and race the flood back to camp. 2 to 4 teams, up to 8 players, bots. |
| [BREACH](breach/) | [Practice](https://rohitpatil9121.github.io/games/breach/) | Arena shooter for two to eight players, five weapons, five-minute rounds, bots. |
| [NIGHT MARKET](night-market/) | [Play](https://rohitpatil9121.github.io/games/night-market/) | Street-food tycoon where the staff and the regulars are the game. |
| [ORBITAL](orbital/) | [Play](https://rohitpatil9121.github.io/games/orbital/) | Gravity puzzle: place worlds, bend the comet's path, reach the light. |
| [REWIND HEIST](rewind-heist/) | [Play](https://rohitpatil9121.github.io/games/rewind-heist/) | Time-loop stealth heist where every loop is replayed by a ghost of your past self. |
| [NEON RUSH](neon-rush/) | [Play](https://rohitpatil9121.github.io/games/neon-rush/) | Synthwave runner on an endless neon track. |
| [DECOY](decoy/) | [Practice](https://rohitpatil9121.github.io/games/decoy/) | Prop hunt for four to ten players. Work in progress (stage 5 of 9). |
| [PAPER PLANES](paper-planes/) | [Practice](https://rohitpatil9121.github.io/games/paper-planes/) | Paper-plane tag in a giant room where the air is the terrain. Work in progress (stage 5 of 9). |

Each game lives in its own folder with its own README and licences, and keeps its full git history (each was
merged in from its own repository). GitHub Pages serves this repository from `main`, so every game's solo or
Practice mode plays from the links above; online play needs the game's Node server (see its README).

## Checking the site

`node tools/serve.mjs` serves this folder the way Pages does, at http://localhost:8140/games/.
`node tools/check.mjs` opens every game in headless Chrome, starts a round, fails on any console error or missing
file, and refreshes the card screenshots in `shots/`. It needs Node 22+ and Chrome or Edge.
