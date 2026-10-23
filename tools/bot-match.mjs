/**
 * PAPER PLANES: balance by bot matches. Whole rounds through the real Room, bots only, no rendering.
 *
 *   node tools/bot-match.mjs                 # 12 Classic + 12 Ink Spread rounds per room, normal bots
 *   ROUNDS=4 SEED=5000 node tools/bot-match.mjs
 *
 * Each round has 6 bots: two of each fold, so a fold's numbers are always against the same mix. The seed
 * set is fixed (SEED); rounds are deterministic, so running the same seed set again is the same experiment,
 * and a real check needs a fresh SEED.
 *
 * Reports, per room and mode: wins by fold, time as "it" by fold (Classic), time clean by fold (Ink Spread),
 * tags and crumples per minute by fold, erasers, and the cost of a server tick. Then a skill check: rooms
 * of three easy and three hard bots (two folds each), who wins.
 * The GDD's bar: no fold's win rate more than 10 points above another's, over both rooms.
 */
import { Room } from "../server/room.mjs";
import { brains } from "../game/bots.js";
import { ROOM_IDS } from "../game/rooms/index.js";
import { TICK_RATE, FOLD_IDS } from "../game/data.js";

const ROUNDS = Number(process.env.ROUNDS || 12), SEED = Number(process.env.SEED || 1000);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + "%";

/** One round of 6 bots; returns per-plane results. `skills` overrides each bot's skill. */
function playRound(roomId, mode, seed, skills = null) {
    const room = new Room({ room: roomId, mode, bots: 6, skill: 2, seed, brains });
    const planes = room.state.players;
    // two of each fold, in a turning order so no fold always gets the same launch spot
    planes.forEach((p, i) => { p.fold = FOLD_IDS[(i + seed) % 3]; });
    if (skills) [...room.brains.values()].forEach((b, i) => { b.skill = skills[i]; });
    const out = new Map(planes.map((p) => [p.id, { fold: p.fold, skill: skills ? skills[planes.indexOf(p)] : 2, crumples: 0, tags: 0, erasers: 0 }]));
    let ticks = 0, costs = [];
    while (room.state.phase === "play" && ticks < 60 * 300) {
        const t0 = performance.now();
        room.tick();
        if (ticks > 60) costs.push(performance.now() - t0);
        ticks++;
        for (const e of room.events) {
            const r = out.get(e.id);
            if (!r) continue;
            if (e.type === "crumple") r.crumples++;
            else if (e.type === "tag") r.tags++;
            else if (e.type === "eraser") r.erasers++;
        }
        room.events.length = 0;
    }
    const s = room.state, win = new Set(s.winners);
    // rank 1 (best) to 6: Classic by least time as "it", Ink Spread by most time clean; ties share the average
    const key = (p) => (mode === "tag" ? p.itTicks : -p.clean);
    for (const p of s.players) {
        const below = s.players.filter((q) => key(q) < key(p)).length, same = s.players.filter((q) => key(q) === key(p)).length;
        Object.assign(out.get(p.id), { win: win.has(p.id), share: win.has(p.id) ? 1 / win.size : 0, it: p.itTicks / TICK_RATE, clean: p.clean / TICK_RATE, rank: below + (same + 1) / 2 });
    }
    return { planes: [...out.values()], minutes: ticks / TICK_RATE / 60, costs, winners: win.size };
}

const t0 = performance.now();
const allCosts = [];
const overall = Object.fromEntries(FOLD_IDS.map((f) => [f, { wins: 0, n: 0, rank: 0 }]));
for (const roomId of ROOM_IDS) {
    for (const mode of ["tag", "spread"]) {
        const by = Object.fromEntries(FOLD_IDS.map((f) => [f, { wins: 0, n: 0, it: 0, clean: 0, tags: 0, crumples: 0, erasers: 0, minutes: 0, rank: 0 }]));
        let minutes = 0, noWinner = 0;
        for (let r = 0; r < ROUNDS; r++) {
            const res = playRound(roomId, mode, SEED + r * 7919 + (mode === "spread" ? 1 : 0));
            minutes += res.minutes; allCosts.push(...res.costs);
            if (!res.winners) noWinner++;
            for (const p of res.planes) {
                const b = by[p.fold];
                b.n++; b.wins += p.share; b.rank += p.rank; b.it += p.it; b.clean += p.clean; b.tags += p.tags; b.crumples += p.crumples; b.erasers += p.erasers; b.minutes += res.minutes;
                overall[p.fold].n++; overall[p.fold].wins += p.share; overall[p.fold].rank += p.rank;
            }
        }
        console.log(`\n${roomId}, ${mode === "tag" ? "Classic Tag" : "Ink Spread"}: ${ROUNDS} rounds, ${minutes.toFixed(1)} minutes${mode === "spread" ? `, ${noWinner} won by the hunters` : ""}`);
        console.log("  fold     wins   average rank (1-6)   " + (mode === "tag" ? "time as it" : "time clean") + "   tags/min   crumples/min   erasers");
        for (const f of FOLD_IDS) {
            const b = by[f];
            const time = mode === "tag" ? b.it / b.n : b.clean / b.n;
            console.log(`  ${f.padEnd(7)}  ${b.wins.toFixed(1).padStart(5)}   ${(b.rank / b.n).toFixed(2).padStart(5)}               ${time.toFixed(1).padStart(6)} s     ${(b.tags / b.minutes).toFixed(2).padStart(5)}      ${(b.crumples / b.minutes).toFixed(2).padStart(5)}        ${b.erasers}`);
        }
    }
}
// win rate as a share of the rounds: each round has 2 planes of each fold, so a fold wins a fair third
console.log("\nwins over every room and mode (a fold's share of all wins; fair is 33%):");
const total = FOLD_IDS.reduce((a, f) => a + overall[f].wins, 0);
const shares = FOLD_IDS.map((f) => overall[f].wins / total);
for (const [i, f] of FOLD_IDS.entries()) console.log(`  ${f.padEnd(7)} ${Math.round(shares[i] * 100)}%`);
const spread = Math.round((Math.max(...shares) - Math.min(...shares)) * 100);
console.log(`  the most and least winning folds differ by ${spread} points (the GDD's bar: 10)`);
console.log(`  average rank (1 best, 6 worst; fair 3.5): ${FOLD_IDS.map((f) => `${f} ${(overall[f].rank / overall[f].n).toFixed(2)}`).join(", ")}`);

// skill: 3 easy and 3 hard in one room
let easy = 0, hard = 0, easyIt = 0, hardIt = 0, easyRank = 0, hardRank = 0, n = 0;
for (let r = 0; r < Math.max(4, ROUNDS / 2); r++) {
    const res = playRound(ROOM_IDS[0], "tag", SEED + 50000 + r * 31, [1, 3, 1, 3, 1, 3]);
    for (const p of res.planes) { if (p.skill === 1) { easy += p.share; easyIt += p.it; easyRank += p.rank; n++; } else { hard += p.share; hardIt += p.it; hardRank += p.rank; } }
}
console.log(`\nskill (Classic, 3 easy and 3 hard bots per room): easy won ${easy.toFixed(1)}, hard ${hard.toFixed(1)}; time as it ${easyIt.toFixed(0)} s against ${hardIt.toFixed(0)} s; average rank ${(easyRank / n).toFixed(2)} against ${(hardRank / n).toFixed(2)}`);

allCosts.sort((a, b) => a - b);
const mean = allCosts.reduce((a, b) => a + b, 0) / allCosts.length;
console.log(`\nserver tick with 6 normal bots: ${mean.toFixed(2)} ms average, ${allCosts[Math.floor(allCosts.length * 0.99)].toFixed(2)} ms at the 99th percentile, ${allCosts[allCosts.length - 1].toFixed(1)} ms worst`);
console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
