/**
 * Headless bot matches: the balance report (the `game-ai` skill: verify by observation, in numbers).
 *
 *   node tools/bot-match.mjs                 # 12 matches, 4 teams of 2, normal bots
 *   node tools/bot-match.mjs 30 2 3          # 30 matches, 2 teams of 3... (matches, teams, players per team)
 *   node tools/bot-match.mjs 12 4 2 mixed    # each team a different skill (1, 2, 3, 2)
 *
 * Runs whole six-tide matches through the real Room (the same class the server and Practice use), with
 * bots in every place, on a different island each time, and reports:
 *   - score by camp position: does any camp win more than its share? (fairness, in play rather than on paper)
 *   - loot lost to the flood, and how often the flood took a bot's heavy loot
 *   - greed against results: do greedy bots bank more, lose more, win more?
 *   - skill against results, with "mixed"
 *   - how long a tick takes with eight bots thinking
 */
import { Room } from "../server/room.mjs";
import { TICK_RATE } from "../game/data.js";

const MATCHES = Number(process.argv[2] || 12), TEAMS = Number(process.argv[3] || 4), PER = Number(process.argv[4] || 2), MIXED = process.argv[5] === "mixed";
const SKILLS = [1, 2, 3, 2];

const byCamp = Array.from({ length: TEAMS }, () => ({ wins: 0, bank: 0 }));
const bySkill = new Map();
const bots = [];
let lost = 0, gasps = 0, drowns = 0, banked = 0, draws = 0, ticks = 0, tickMs = 0, worstTick = 0, steals = 0, shoves = 0;

for (let m = 0; m < MATCHES; m++) {
    const room = new Room({ code: "BOTS", teams: TEAMS, bots: TEAMS * PER, skill: 2, seed: 1000 + m * 7919 });
    if (MIXED) for (const [id, brain] of room.brains) { const p = room.state.players.find((q) => q.id === id); brain.skill = SKILLS[p.team]; }
    const state0 = room.state;
    let gaspN = 0, drownN = 0;
    while (room.state === state0 && state0.phase === "play") {
        const t0 = performance.now();
        room.tick();
        const ms = performance.now() - t0;
        tickMs += ms; ticks++; if (ms > worstTick) worstTick = ms;
        for (const e of state0.events) { if (e.type === "drop" && e.why === "gasp") gaspN++; if (e.type === "drown") drownN++; }
    }
    const s = state0;
    gasps += gaspN; drowns += drownN;
    for (let t = 0; t < TEAMS; t++) byCamp[t].bank += s.bank[t];
    if (s.winner < 0) draws++; else byCamp[s.winner].wins++;
    for (const p of s.players) {
        const brain = room.brains.get(p.id) || { greed: 1, skill: 2 };
        lost += p.lost; banked += p.banked; steals += p.steals; shoves += p.shoves;
        bots.push({ greed: brain.greed, skill: brain.skill, banked: p.banked, lost: p.lost, won: s.winner === p.team, drowned: p.drowned });
        const k = bySkill.get(brain.skill) || { banked: 0, lost: 0, n: 0, wins: 0 };
        k.banked += p.banked; k.lost += p.lost; k.n++; if (s.winner === p.team) k.wins++;
        bySkill.set(brain.skill, k);
    }
    console.log(`match ${String(m + 1).padStart(2)}  island ${String(s.seed).padStart(10)}  banks ${s.bank.slice(0, TEAMS).map((b) => String(b).padStart(4)).join(" ")}  winner ${s.winner < 0 ? "draw" : "camp " + s.winner}  flood took heavy loot ${gaspN}x, drowned ${drownN}x`);
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + "%" : "-");
console.log(`\n== ${MATCHES} matches, ${TEAMS} teams of ${PER}${MIXED ? ", skills by team " + SKILLS.slice(0, TEAMS).join("/") : ""}`);
console.log(`\nBy camp position (a fair island gives each ${pct(1, TEAMS)} of the wins):`);
for (let t = 0; t < TEAMS; t++) console.log(`  camp ${t}: ${byCamp[t].wins} wins (${pct(byCamp[t].wins, MATCHES - draws)}), average bank ${(byCamp[t].bank / MATCHES).toFixed(0)}`);
if (draws) console.log(`  draws: ${draws}`);
console.log(`\nThe flood: ${lost} points of loot lost to the sea (${pct(lost, lost + banked)} of everything carried home or lost); heavy loot let go ${gasps} times; ${drowns} drownings.`);
console.log(`Rivalry: ${shoves} shoves, ${steals} steals.`);

// greed: split bots into thirds by greed
bots.sort((a, b) => a.greed - b.greed);
const third = Math.floor(bots.length / 3);
console.log(`\nGreed (bots split into thirds, careful to greedy):`);
for (const [name, list] of [["careful", bots.slice(0, third)], ["middle", bots.slice(third, 2 * third)], ["greedy", bots.slice(2 * third)]]) {
    const n = list.length, avg = (f) => (list.reduce((a, b) => a + f(b), 0) / n);
    console.log(`  ${name.padEnd(8)} greed ${avg((b) => b.greed).toFixed(2)}  banked ${avg((b) => b.banked).toFixed(0).padStart(4)}  lost to the sea ${avg((b) => b.lost).toFixed(0).padStart(4)}  on the winning team ${pct(list.filter((b) => b.won).length, n)}`);
}
console.log(`\nSkill:`);
for (const [skill, k] of [...bySkill].sort((a, b) => a[0] - b[0])) console.log(`  ${["", "easy", "normal", "hard"][skill].padEnd(7)} banked ${(k.banked / k.n).toFixed(0).padStart(4)}  lost ${(k.lost / k.n).toFixed(0).padStart(4)}  on the winning team ${pct(k.wins, k.n)}`);
console.log(`\nTick time with ${TEAMS * PER} bots: ${(tickMs / ticks).toFixed(3)} ms average, ${worstTick.toFixed(1)} ms worst (${ticks} ticks, ${((ticks / TICK_RATE) / 60).toFixed(0)} minutes of play).`);
