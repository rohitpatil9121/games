/**
 * Headless bot matches: whole matches of bots against bots, as fast as Node runs them, and what happened.
 *
 *   node tools/bot-match.mjs                    # every map, 10 bots, medium skill, 3 matches each
 *   node tools/bot-match.mjs greybox 8 3 2      # map, players, skill, matches
 *
 * For each map it reports how rounds end (props found or props surviving), how long the props last, how
 * often seekers scan a real prop by mistake, taunts, ping grenades, and bots that stopped moving where
 * they shouldn't (a sign of a waypoint graph or hiding spot that doesn't work).
 */
import { ROLE, TICK_RATE } from "../game/data.js";
import { PLAY_MAPS, MAP_LIST } from "../game/maps/index.js";
import { Room } from "../server/room.mjs";
import { hidingSpots } from "../game/bots.js";
import { getMap } from "../game/maps/index.js";

const [onlyMap, players = "10", skillArg = "2", matchesArg = "3"] = process.argv.slice(2);
const maps = onlyMap ? [onlyMap] : PLAY_MAPS.length ? PLAY_MAPS : MAP_LIST;

for (const id of maps) {
    const map = getMap(id);
    const t0 = performance.now();
    const totals = { rounds: 0, seekWins: 0, hideWins: 0, finds: 0, hiders: 0, survivors: 0, findTimes: [], penalties: 0, penaltyDeaths: 0, taunts: 0, forced: 0, pings: 0, pingHits: 0, decoys: 0, disguised: 0, why: {}, settled: 0, scans: 0, hits: 0 };
    for (let m = 0; m < +matchesArg; m++) {
        const room = new Room({ map: id, bots: +players, skill: +skillArg, seed: 1000 + m * 77 });
        let state = room.state, seekStart = 0;
        for (let t = 0; t < 60 * 60 * 25; t++) {
            room.tick();
            if (room.state !== state) break;            // the match ended and a new one began
            for (const e of state.events) {
                if (e.type === "phase" && e.phase === "seek") { seekStart = state.tick; totals.hiders += state.players.filter((p) => p.role === ROLE.hider).length;
                    totals.settled += state.players.filter((p) => p.role === ROLE.hider && p.prop !== 0).length; }
                if (e.type === "phase" && e.phase === "end") {
                    totals.rounds++;
                    if (e.winner === state.seekTeam) totals.seekWins++; else totals.hideWins++;
                    totals.survivors += state.players.filter((p) => p.alive && p.role === ROLE.hider).length;
                }
                if (e.type === "kill" && e.by) { const m = room.brains.get(e.by)?.memory.get(e.id); if (m && m.why) for (const k in m.why) totals.why[k] = (totals.why[k] || 0) + 1; totals.finds++; totals.findTimes.push((state.tick - seekStart) / TICK_RATE); }
                if (e.type === "kill" && e.how === 1) totals.penaltyDeaths++;
                if (e.type === "hurt" && e.self) totals.penalties++;
                if (e.type === "hurt" && !e.self) totals.hits++;
                if (e.type === "shot") totals.scans++;
                if (e.type === "taunt") { totals.taunts++; if (e.forced) totals.forced++; }
                if (e.type === "ping") { totals.pings++; totals.pingHits += e.ids.length; }
                if (e.type === "decoy") totals.decoys++;
                if (e.type === "disguise") totals.disguised++;
            }
        }
    }
    const T = totals, med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    console.log(`${map.name}: ${+matchesArg} matches of ${players} bots at skill ${skillArg}, ${hidingSpots(map).length} hiding spots, ${Math.round(performance.now() - t0)} ms`);
    console.log(`  rounds ${T.rounds}: seekers won ${T.seekWins}, props won ${T.hideWins}`);
    console.log(`  props ${T.hiders}: ${T.settled} disguised by the end of hiding, ${T.finds} found (median ${med(T.findTimes).toFixed(0)} s into seeking), ${T.survivors} survived`);
    console.log(`  scans ${T.scans}: ${T.hits} on props that were people, ${T.penalties} on real props or decoys (${T.penaltyDeaths} seekers scanned themselves out)`);
    console.log(`  what gave the found ones away (each counts once per find): ${JSON.stringify(T.why)}`);
    console.log(`  taunts ${T.taunts} (${T.forced} forced), ping grenades ${T.pings} finding ${T.pingHits} props, decoys ${T.decoys}`);
}
