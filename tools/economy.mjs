/**
 * SKYFARM: the farm's economy on paper, checked by script (GDD §4, the preamble's "balance is checked by a
 * script"). Stage 4: crops only (the merchant, bridges and the ending's costs come in stage 5).
 *
 *   node tools/economy.mjs [days]          # default 20
 *
 * For each crop, a single-crop farm of 6 plots in a garden where it grows, run through the real farm rules
 * (game/farm.js: growth, the seeded weather, rain, night, regrowth, dawn credit) with a farmer who waters every
 * morning and harvests and replants the moment anything is ripe. Two runs per crop: without pollinators, and
 * with every plot pollinated (the best a flower garden can do). Prints coins per plot-day at the merchant's
 * prices and checks that no crop beats the median by more than 25% (the GDD's rule), counting the fragile ones
 * twice: once as if the glide home is safe, once with the expected loss of a greedy glider (FALL_RISK).
 */
import { makeWorld, WORLD } from "../game/islands.js";
import { createState } from "../game/sim.js";
import { grow, farmDawn, harvestOf, afterHarvest } from "../game/farm.js";
import { CROPS, CROP_IDS, DAY_TICKS } from "../game/data.js";

const DAYS = Number(process.argv[2] || 20), PLOTS = 6, FALL_RISK = 0.25;
const world = makeWorld(WORLD);
const gardenFor = (c) => (CROPS[c].grows.includes("meadow") ? "hearth" : CROPS[c].grows.includes("orchard") ? "apple" : "frost");

function run(cropId, pollinated) {
    const s = createState(world), isl = gardenFor(cropId), g = isl === "hearth" ? { ...world.data.field, island: "hearth" } : world.data.gardens.find((q) => q.island === isl);
    s.plots.clear();
    const band = world.byId[isl].band;
    for (let k = 0; k < PLOTS; k++) {
        const ix = g.x0 + (k % 3), iy = g.y0 + Math.floor(k / 3);
        s.plots.set(ix + "," + iy, { ix, iy, island: isl, band, z: 0, tilled: true, crop: cropId, growth: 0, watered: false, days: 0, grew: false, pollinated: false, rained: false });
    }
    s.tick = 0;
    let produce = 0, harvests = 0;
    for (let day = 0; day < DAYS; day++) {
        // morning: water everything; then walk the day in 10-minute steps, harvesting and replanting what's ripe
        for (const p of s.plots.values()) p.watered = true;
        for (let t = 0; t < DAY_TICKS; t += 600) {
            grow(s, 600);
            s.tick += 600;
            for (const p of s.plots.values()) {
                if (p.growth < 1) continue;
                if (pollinated) p.pollinated = true;
                produce += harvestOf(p).produce; harvests++;
                const regrow = CROPS[cropId].regrow;
                afterHarvest(p);
                if (!regrow) { p.crop = cropId; p.growth = 0; p.days = 0; }
                p.watered = true;
            }
        }
        s.events.length = 0;
        farmDawn(s);
    }
    return { produce, harvests };
}

const rows = [];
for (const c of CROP_IDS) {
    const plain = run(c, false), pol = run(c, true), C = CROPS[c];
    const perPlotDay = (n) => (n * C.value) / (PLOTS * DAYS);
    const risk = C.fragile ? 1 - FALL_RISK : 1;
    rows.push({ c, garden: gardenFor(c), harvests: plain.harvests, coins: perPlotDay(plain.produce), pol: perPlotDay(pol.produce), risky: perPlotDay(plain.produce) * risk });
}
// storm-bloom only grows from seed planted in a storm (stage 7); it is a rare find, not a field crop
const field = rows.filter((r) => r.c !== "stormbloom");
const sorted = field.map((r) => r.coins).sort((a, b) => a - b), median = sorted[sorted.length >> 1];
console.log(`${DAYS} days, ${PLOTS} plots, watered every morning, replanted at once (coins per plot-day at merchant prices):`);
console.log("  crop          garden   harvests  coins/plot-day  pollinated  greedy-glide (fragile x0.75)");
for (const r of rows) console.log(`  ${r.c.padEnd(12)}  ${r.garden.padEnd(7)}  ${String(r.harvests).padStart(8)}  ${r.coins.toFixed(2).padStart(14)}  ${r.pol.toFixed(2).padStart(10)}  ${r.risky.toFixed(2).padStart(10)}${r.c === "stormbloom" ? "   (rare find, not counted)" : ""}`);
console.log(`  median ${median.toFixed(2)}; the rule: none more than 25% above it (${(median * 1.25).toFixed(2)})`);
const over = field.filter((r) => r.coins > median * 1.25);
const overRisky = field.filter((r) => r.risky > median * 1.25);
console.log(over.length ? `  OVER (safe glide): ${over.map((r) => r.c + " " + ((r.coins / median - 1) * 100).toFixed(0) + "%").join(", ")}` : "  ok   no crop dominates (safe glide)");
console.log(overRisky.length ? `  OVER (greedy glide): ${overRisky.map((r) => r.c + " " + ((r.risky / median - 1) * 100).toFixed(0) + "%").join(", ")}` : "  ok   no crop dominates once a greedy glide's losses are counted");
process.exit(over.length && overRisky.length ? 1 : 0);
