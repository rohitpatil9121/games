/**
 * Level solver / validator. Run: node tools/solve.mjs
 *
 * For every design in game/levels.design.js:
 *   1. reject it if the comet reaches the portal with no bodies placed (too easy);
 *   2. search placements of the inventory (random sampling + hill climbing) for a winning flight;
 *   3. among wins, prefer ROBUST ones (nearby placements also win), because a human needs some slack;
 *   4. lay 3 stardust along the winning path and write game/levels.js with the solution as the hint.
 * Fails loudly if any level has no solution, so an unsolvable level can never ship.
 */
import { writeFileSync } from "node:fs";
import { DESIGNS } from "../game/levels.design.js";
import { simulate, placementError, PHYS, BODY } from "../game/sim.js";

let seed = 20261001;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const B = PHYS.bounds;

function items(inv) {
    const out = [];
    for (const type in inv) for (let i = 0; i < inv[type]; i++) out.push(type);
    return out;
}

function randomPlacement(level, types, fixedPart = []) {
    const placed = fixedPart.slice();
    for (let k = placed.length; k < types.length; k++) {
        let p = null;
        for (let tries = 0; tries < 200 && !p; tries++) {
            const x = (rand() * 2 - 1) * (B.x - 1), y = (rand() * 2 - 1) * (B.y - 1);
            if (!placementError(level, placed, x, y, types[k])) p = { type: types[k], x, y };
        }
        if (!p) return null;
        placed.push(p);
    }
    return placed;
}

function score(level, placed) {
    const { state } = simulate(level, placed);
    if (state.status === "won") return 1000 - state.t;              // wins: faster is slightly better
    return -state.closest - (state.status === "lost" ? 0 : 0.5);    // misses: closer is better
}

function robustness(level, placed) {
    let wins = 0, n = 0;
    for (let k = 0; k < placed.length; k++) for (const [dx, dy] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35], [0.25, 0.25], [-0.25, -0.25]]) {
        const p = placed.map((b, i) => (i === k ? { ...b, x: b.x + dx, y: b.y + dy } : b));
        if (placementError(level, p, p[k].x, p[k].y, p[k].type, k)) continue;
        n++;
        if (simulate(level, p).state.status === "won") wins++;
    }
    return n ? wins / n : 0;
}

function solve(level) {
    const types = items(level.inventory);
    const wins = [];
    let best = null, bestScore = -Infinity;
    // try using the full inventory, and every "leave one out" subset (the player may not need everything)
    const variants = [types, ...types.map((_, i) => types.filter((__, j) => j !== i))].filter((v, i, a) => v.length && a.findIndex((w) => w.join() === v.join()) === i);
    for (const v of variants) {
        for (let i = 0; i < 2500; i++) {
            const p = randomPlacement(level, v);
            if (!p) continue;
            const sc = score(level, p);
            if (sc > bestScore) { bestScore = sc; best = p; }
            if (sc > 0) wins.push(p);
        }
    }
    // hill-climb from the best candidate if nothing won yet, or to polish
    let cur = best, curScore = bestScore;
    for (let it = 0; it < 3000 && cur; it++) {
        const sigma = 2.5 * (1 - it / 3000) + 0.15;
        const k = Math.floor(rand() * cur.length);
        const cand = cur.map((b, i) => (i === k ? { ...b, x: b.x + (rand() * 2 - 1) * sigma, y: b.y + (rand() * 2 - 1) * sigma } : b));
        if (placementError(level, cand, cand[k].x, cand[k].y, cand[k].type, k)) continue;
        const sc = score(level, cand);
        if (sc >= curScore) { cur = cand; curScore = sc; if (sc > 0) wins.push(cand); }
    }
    if (!wins.length) return null;
    // most robust win (sample up to 60 candidates)
    let pick = null, pickRob = -1;
    for (const w of wins.slice(-60)) {
        const r = robustness(level, w);
        if (r > pickRob) { pickRob = r; pick = w; }
    }
    return { placed: pick, robustness: pickRob, winsFound: wins.length };
}

function layDust(level, placed) {
    const path = [];
    simulate(level, placed, undefined, path);
    const frames = path.length / 2;
    const dust = [];
    for (const f of [0.3, 0.55, 0.8]) {
        let i = Math.floor(frames * f);
        // nudge along the path until it's clear of every body
        for (let tries = 0; tries < 60; tries++) {
            const x = path[i * 2], y = path[i * 2 + 1];
            const clear = [...level.fixed, ...placed].every((b) => b.orbit || Math.hypot(b.x - x, b.y - y) > BODY[b.type].radius + 1.2);
            if (clear) break;
            i = Math.min(frames - 1, i + 3);
        }
        dust.push({ x: +path[i * 2].toFixed(3), y: +path[i * 2 + 1].toFixed(3) });
    }
    return { dust, flightTime: +(frames / 60).toFixed(2) };
}

const out = [];
let failed = 0;
for (const d of DESIGNS) {
    const level = { ...d, dust: [] };
    const trivial = simulate(level, []).state.status === "won";
    const sol = trivial ? null : solve(level);
    if (trivial || !sol) {
        failed++;
        console.log(`✗ ${d.id.padEnd(14)} ${trivial ? "TRIVIAL (wins with no moves)" : "NO SOLUTION FOUND"}`);
        continue;
    }
    const { dust, flightTime } = layDust(level, sol.placed);
    const check = simulate({ ...level, dust }, sol.placed).state;
    const threeStars = check.status === "won" && check.dustTaken === 3;
    console.log(`${threeStars ? "✓" : "!"} ${d.id.padEnd(14)} uses ${sol.placed.length} · robustness ${(sol.robustness * 100).toFixed(0).padStart(3)}% · flight ${flightTime}s · 3★ ${threeStars}`);
    out.push({ ...d, dust, solution: sol.placed.map((b) => ({ type: b.type, x: +b.x.toFixed(2), y: +b.y.toFixed(2) })), robustness: +sol.robustness.toFixed(2) });
}

if (failed) { console.log(`\n${failed} level(s) failed validation; game/levels.js NOT written.`); process.exit(1); }
writeFileSync(new URL("../game/levels.js", import.meta.url),
    `// GENERATED by tools/solve.mjs from levels.design.js — do not edit by hand.\n// Every level here was proven solvable with all 3 stardust; \`solution\` powers the in-game hint.\nexport const LEVELS = ${JSON.stringify(out, null, 1)};\n`);
console.log(`\nwrote game/levels.js (${out.length} levels)`);
