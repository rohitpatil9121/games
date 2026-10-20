/**
 * Check generated islands for fairness and reachability, for many seeds (see game/fairness.js for what
 * is checked). Plain seeds are checked as generated; the line "after repair" is what a room actually
 * plays, since a room skips to the next seed when one fails.
 *
 *   node tools/check-island.mjs              # 20 seeds x 2, 3 and 4 teams
 *   node tools/check-island.mjs 50 4         # 50 seeds, 4 teams only
 *
 * Exits with 1 if any island a room would play fails.
 */
import { generateIsland } from "../game/island.js";
import { checkIsland, fairIsland, TOLERANCE } from "../game/fairness.js";

const SEEDS = Number(process.argv[2] || 20), ONLY = Number(process.argv[3] || 0);
let raw = 0, failures = 0, islands = 0, repaired = 0;
const worst = { spread: 0 };
for (const teams of ONLY ? [ONLY] : [2, 3, 4]) {
    for (let s = 1; s <= SEEDS; s++) {
        const seed = (Math.imul(s, 2654435761) >>> 0) || 1;
        islands++;
        const t0 = performance.now();
        const island = generateIsland(seed, teams), check = checkIsland(island);
        const ms = performance.now() - t0;
        if (check.ok) raw++;
        let final = check, note = "";
        if (!check.ok) {
            const fair = fairIsland(seed, teams);
            final = fair.check;
            if (final.ok) { repaired++; note = `  -> repaired: seed ${fair.seed} after ${fair.tries} tries`; }
        }
        if (!final.ok) failures++;
        if (final.spread > worst.spread) Object.assign(worst, { spread: final.spread, seed, teams });
        console.log(`${check.ok ? "ok  " : final.ok ? "fix " : "FAIL"} teams ${teams} seed ${String(seed).padStart(10)}  ruins ${island.ruins.length}  spots ${island.spots.length}  camp spread ${(check.spread * 100).toFixed(1)}%  (${ms.toFixed(0)} ms)${note}`);
        if (!check.ok) for (const p of check.problems) console.log("       " + p);
    }
}
console.log(`
${raw} of ${islands} islands pass as generated; ${repaired} more after skipping to the next seed; ${failures} fail.`);
console.log(`Worst camp spread in what is played: ${(worst.spread * 100).toFixed(1)}% (teams ${worst.teams}, seed ${worst.seed}); tolerance ${TOLERANCE * 100}%.`);
process.exit(failures ? 1 : 0);
