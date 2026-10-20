import { generateIsland, groundAt } from "./island.js";
import { buildNav, nodeAt, travelField, nodeX, nodeY } from "./nav.js";
import { lowOf } from "./tide.js";
import { TIDE, ISLAND } from "./data.js";
import { dcos, dsin, TAU } from "./det.js";

/**
 * TIDEFALL: is a generated island fair? (the `level-design` and `procedural-gen` skills: validate a
 * generated map before handing it to players, and reject or repair it if it fails.)
 *
 * checkIsland() measures what tools/check-island.mjs reports for many seeds:
 *   1. camps: all at the same height, well above high water, the whole pad dry;
 *   2. every ruin can be reached on foot (no swimming) from every camp by the low tide of the tide its
 *      ring is meant to open on (ring 1 by tide 1, ring 2 by tide 3, ring 3 by tide 5, the wreck by tide 6);
 *   3. fairness: for each ring, the travel time from each camp to its nearest ruins of that ring, and to
 *      the water's edge at the first low tide, differs between camps by no more than TOLERANCE;
 *   4. the rocks meant to stay dry at high water do;
 *   5. no loot spot is inside a ruin wall, and each can be reached.
 *
 * fairIsland() is what a room uses: it tries the seed it was given and the next few after it until one
 * passes, so players are never handed a lopsided island. The seed that passed is what travels to clients.
 * @module game/fairness
 */

export const TOLERANCE = 0.12;
/** which tide (0-based) each ring must be open on foot by */
const OPENS = [0, 2, 4, 5];

/** @returns {{ ok: boolean, problems: string[], spread: number }} spread: the worst relative difference between camps */
export function checkIsland(island) {
    const teams = island.teams, nav = buildNav(island);
    const problems = [];

    // 1. camps
    const heights = island.camps.map((c) => c.z);
    if (Math.max(...heights) - Math.min(...heights) > 1e-9) problems.push(`camp heights differ: ${heights.map((h) => h.toFixed(3)).join(", ")}`);
    for (const c of island.camps) {
        for (let a = 0; a < 16; a++) {
            const x = c.x + dcos(a / 16 * TAU) * ISLAND.campPad, y = c.y + dsin(a / 16 * TAU) * ISLAND.campPad;
            if (groundAt(island, x, y) < TIDE.high + 3) { problems.push(`camp ${c.team} pad edge is only ${groundAt(island, x, y).toFixed(2)} m high`); break; }
        }
    }

    // goals: the nearest open node to a point
    const goalOf = (x, y) => {
        let best = nodeAt(nav, x, y), bestD = Infinity;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
            const k = nodeAt(nav, x + di * nav.cell, y + dj * nav.cell);
            if (nav.blocked[k]) continue;
            const d = (nodeX(nav, k) - x) ** 2 + (nodeY(nav, k) - y) ** 2;
            if (d < bestD) { bestD = d; best = k; }
        }
        return best;
    };

    // 2 and 3: per ring, travel on foot at the low tide of the tide it opens on
    const spreads = [];
    for (let ring = 0; ring < ISLAND.rings.length; ring++) {
        const level = lowOf(island.seed, OPENS[ring]);
        const fields = island.camps.map((c) => travelField(nav, [goalOf(c.x, c.y)], level, { onFoot: true }));
        const ruins = island.ruins.filter((r) => r.ring === ring);
        const perCamp = fields.map((f) => ruins.map((r) => f[goalOf(r.x, r.y)]).sort((a, b) => a - b));
        for (let c = 0; c < perCamp.length; c++) {
            const bad = perCamp[c].filter((t) => !Number.isFinite(t)).length;
            if (bad) problems.push(`ring ${ring + 1}: ${bad} ruin(s) not reachable on foot from camp ${c} at tide ${OPENS[ring] + 1}`);
        }
        // fairness: mean time to the nearest few ruins of this ring (as many as one sector holds, at least 1)
        const k = Math.max(1, Math.round(ruins.length / teams));
        const means = perCamp.map((times) => times.slice(0, k).reduce((a, b) => a + b, 0) / k);
        if (means.every(Number.isFinite)) {
            const spread = Math.max(...means) / Math.min(...means) - 1;
            spreads.push(spread);
            if (spread > TOLERANCE) problems.push(`ring ${ring + 1}: camps are unequal (${means.map((m) => m.toFixed(1)).join(" / ")} s)`);
        }
    }
    // time to the low-tide waterline of the first tide
    {
        const level = lowOf(island.seed, 0), shore = [];
        for (let k = 0; k < nav.n * nav.n; k++) if (nav.z[k] < level && nav.z[k] > level - 0.6) shore.push(k);
        const times = island.camps.map((c) => {
            const f = travelField(nav, [goalOf(c.x, c.y)], level, { onFoot: true });
            let best = Infinity;
            for (const k of shore) if (f[k] < best) best = f[k];
            return best;
        });
        const spread = Math.max(...times) / Math.min(...times) - 1;
        spreads.push(spread);
        if (spread > TOLERANCE) problems.push(`time to the low-water line differs: ${times.map((t) => t.toFixed(1)).join(" / ")} s`);
    }

    // 4. rocks
    for (const r of island.rocks) if (groundAt(island, r.x, r.y) < TIDE.high + 1) problems.push(`a dry rock is at ${groundAt(island, r.x, r.y).toFixed(2)} m`);

    // 5. spots
    for (const sp of island.spots) {
        for (const b of island.solids) {
            if (sp.x > b.x0 + 0.05 && sp.x < b.x1 - 0.05 && sp.y > b.y0 + 0.05 && sp.y < b.y1 - 0.05 && sp.z + 0.05 > b.z0 && sp.z + 0.3 < b.z1) {
                problems.push(`a loot spot (${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}) is inside a ${b.mat} box`); break;
            }
        }
    }
    {
        const f = travelField(nav, [goalOf(island.camps[0].x, island.camps[0].y)], TIDE.lows[TIDE.lows.length - 1] - 1, { onFoot: false });
        const lost = island.spots.filter((sp) => !Number.isFinite(f[goalOf(sp.x, sp.y)])).length;
        if (lost) problems.push(`${lost} loot spot(s) can't be reached at all`);
    }

    return { ok: problems.length === 0, problems, spread: Math.max(...spreads) };
}

/**
 * The first island from `seed` onward that passes checkIsland (at most `tries` attempts; the last one is
 * used whatever happens). Deterministic: the same seed always gives the same island.
 * @returns {{ island: object, seed: number, tries: number, check: ReturnType<typeof checkIsland> }}
 */
export function fairIsland(seed, teams, tries = 12) {
    let island = null, check = null, s = seed >>> 0;
    for (let n = 1; n <= tries; n++, s = (s + 0x9e3779b9) >>> 0) {
        island = generateIsland(s, teams);
        check = checkIsland(island);
        if (check.ok) return { island, seed: s, tries: n, check };
    }
    return { island, seed: island.seed, tries, check };
}
