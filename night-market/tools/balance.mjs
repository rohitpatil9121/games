/**
 * Headless balance check: plays the 10-night campaign with scripted strategies (game/bots.js) on many
 * seeds and reports how each one does. The same simulation code runs in the browser, so what passes
 * here is what players get.
 *
 *   npm run balance            # summary table + pass/fail checks
 *   npm run balance -- --trace sensible 7     # one campaign night by night (strategy, seed)
 *
 * The checks the economy has to satisfy:
 *   1. doing nothing loses;
 *   2. a sensible mixed street wins comfortably on nearly every seed;
 *   3. no single stall type on its own does as well as the mix;
 *   4. ignoring who stands next to whom costs money (the layout matters).
 * Exits with code 1 if a check fails.
 */
import { createCampaign } from "../game/sim.js";
import { BOTS, playNight } from "../game/bots.js";
import { NIGHT } from "../game/data.js";

const SEEDS = 40;
const args = process.argv.slice(2);

function campaign(name, seed, trace = false) {
    const s = createCampaign(seed);
    while (playNight(s, BOTS[name])) { /* next night */ }
    if (trace) {
        console.log(`\n${name}, seed ${seed}: ${s.outcome} after night ${s.night}`);
        console.log("night   served  net     cash    rep");
        for (const h of s.history) console.log(String(h.night).padStart(5), String(h.served).padStart(8), String(Math.round(h.net)).padStart(6), String(Math.round(h.cash)).padStart(7), String(Math.round(h.rep)).padStart(6));
        console.log("stalls:", s.stalls.map((t) => `${t.type}${t.level}`).join(" "), "| vendors:", s.vendors.filter((v) => v.hired).map((v) => `${v.name}(${v.skill})`).join(" "));
    }
    return { won: s.outcome === "won", nights: s.history.length, cash: s.cash, rep: s.rep, served: s.history.reduce((n, h) => n + h.served, 0) };
}

if (args[0] === "--trace") {
    campaign(args[1] || "sensible", Number(args[2] || 1), true);
    process.exit(0);
}

const median = (list) => { const a = list.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const results = {};
console.log(`NIGHT MARKET balance: ${SEEDS} seeds, ${NIGHT.campaignNights} nights each\n`);
console.log("strategy        wins    median nights   median cash   median rep   served");
for (const name of Object.keys(BOTS)) {
    const runs = [];
    for (let seed = 1; seed <= SEEDS; seed++) runs.push(campaign(name, seed));
    const r = (results[name] = {
        wins: runs.filter((x) => x.won).length / SEEDS,
        nights: median(runs.map((x) => x.nights)),
        cash: median(runs.map((x) => x.cash)),
        rep: median(runs.map((x) => x.rep)),
        served: median(runs.map((x) => x.served)),
    });
    console.log(name.padEnd(14), (Math.round(r.wins * 100) + "%").padStart(5), String(r.nights).padStart(12), String(Math.round(r.cash)).padStart(15), String(Math.round(r.rep)).padStart(12), String(r.served).padStart(10));
}

const R = results, mono = ["onlySkewers", "onlyDumplings", "onlyNoodles", "onlyTea"];
const checks = [
    ["Doing nothing loses every time", R.nothing.wins === 0],
    ["A sensible mixed street wins at least 90% of seeds", R.sensible.wins >= 0.9],
    ["...and finishes with a real margin (median cash of $300 or more)", R.sensible.cash >= 300],
    ["...but not a runaway one (median cash under $3000)", R.sensible.cash < 3000],
    ["No single stall type beats the mix on cash", mono.every((m) => R[m].cash < R.sensible.cash)],
    ["No single stall type wins as often as the mix", mono.every((m) => R[m].wins <= R.sensible.wins)],
    ["Ignoring the neighbours costs money", R.careless.cash < R.sensible.cash],
    ["Buying the cheapest thing every night does worse than planning", R.cheapest.cash < R.sensible.cash],
];
console.log("");
let failed = 0;
for (const [label, pass] of checks) { console.log((pass ? "  pass  " : "  FAIL  ") + label); if (!pass) failed++; }
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
