/**
 * Build each map's waypoint graph and write it next to the map as <map>.nav.js.
 *
 *   node tools/make-waypoints.mjs            # every map
 *   node tools/make-waypoints.mjs foundry    # one
 *
 * Nothing here is drawn by hand. Points are laid across the top of every floor-like solid (not the props:
 * nobody should plan a route over a crate), about 1.5 m apart, wherever a player can stand, plus one on
 * every spawn. Then, for every pair of nearby points, a player is actually walked
 * from one toward the other with the game's own controller (game/sim.js). If it arrives, that is a link.
 * If it only arrives when it jumps, the link is marked as a jump. Because links are one-way, a drop off a walkway is a link down with no link back up.
 * Last, points that can't be reached from a spawn, or can't get back to one, are thrown away.
 *
 * Run it again whenever a map's geometry changes; tools/check-maps.mjs complains if it is stale.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BTN, MOVE } from "../game/data.js";
import { createPlayer, stepPlayer, stuck, quantizeYaw } from "../game/sim.js";
import { MAP_DEFS, compileMap } from "../game/maps/index.js";

/** points are at most SPACING apart on any surface, never closer than CLOSE, and linked if within REACH */
const SPACING = 1.5, CLOSE = 1.0, INSET = 0.4, REACH = 2.5;
/** routes are walked by a seeker-sized body (an upright box), the biggest thing that usually walks them */
const body = () => { const p = createPlayer(1); p.prop = -1; return p; };

/** Walk a player from a toward b. Returns true if it gets there. */
function walk(map, a, b, jump, toPad = false) {
    const p = body();
    p.x = a[0]; p.y = a[1]; p.z = a[2]; p.ground = true;
    const far = Math.hypot(b[0] - a[0], b[1] - a[1]), limit = Math.ceil((far / MOVE.walk) * 60 * 1.6) + 45;
    const input = { seq: 0, mx: 0, my: 127, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 };
    for (let t = 0; t < limit; t++) {
        const dx = b[0] - p.x, dy = b[1] - p.y, d = Math.hypot(dx, dy);
        if (d < 0.3 && p.ground && Math.abs(p.z - b[2]) < 0.3) return true;
        input.seq++;
        input.yaw = quantizeYaw(Math.atan2(dy, dx));
        input.my = d < 0.6 ? 70 : 127;                              // ease off, so it stops on the point
        input.buttons = jump && p.ground && t > 2 && d > 0.6 ? BTN.jump : 0;
        stepPlayer(map, p, input);
        if (p.z < map.bounds.min[2] - 2) return false;
    }
    return false;
}

function build(def) {
    const map = compileMap({ ...def, waypoints: [], links: [] });
    const points = [], key = (x, y, z) => `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}`, seen = new Set();
    const idle = { seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 };
    const add = (x, y, z0, exact = false) => {
        // let a player settle there: on a staircase it comes to rest on the highest stair under its feet
        const p = body();
        p.x = x; p.y = y; p.z = z0 + 0.4;
        if (stuck(map, p)) return -1;
        for (let t = 0; t < 40 && !p.ground; t++) stepPlayer(map, p, idle);
        if (!p.ground || p.z < z0 - 0.01) return -1;
        const z = p.z, k = key(x, y, z);
        if (seen.has(k)) return -1;
        // never two points on top of each other
        for (let i = 0; i < points.length; i++) if (Math.hypot(points[i][0] - x, points[i][1] - y) < (exact ? 0.3 : CLOSE) && Math.abs(points[i][2] - z) < 0.5) return i;
        seen.add(k);
        points.push([x, y, z]);
        return points.length - 1;
    };
    // the places that matter get a point of their own
    const spawns = [...map.spawns.hider, ...map.spawns.seeker];
    for (const s of spawns) add(s[0], s[1], s[2], true);
    // everywhere else: a row of points across the top of every solid, edge to edge, so narrow things
    // (a bridge, a stair, a crate) get theirs and neighbouring surfaces always have points near their seam
    const row = (lo, hi) => {
        if (hi - lo < INSET * 2) return [(lo + hi) / 2];
        const n = Math.max(1, Math.ceil((hi - lo - INSET * 2) / SPACING)), out = [];
        for (let i = 0; i <= n; i++) out.push(lo + INSET + ((hi - lo - INSET * 2) * i) / n);
        return out;
    };
    for (const s of map.walls) if (s.mat !== "wall" || s.z1 < 2) for (const x of row(s.x0, s.x1)) for (const y of row(s.y0, s.y1)) add(x, y, s.z1);

    const links = [];
    for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const a = points[i], c = points[j], d = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (d > REACH || c[2] - a[2] > 1.4) continue;
        if (walk(map, a, c, false)) links.push([i, j, 0]);
        else if (walk(map, a, c, true)) links.push([i, j, 1]);
    }

    // keep what can be reached from the first spawn and can get back to it
    const reach = (edges) => {
        const out = points.map(() => []), mark = new Uint8Array(points.length), stack = [0];
        for (const [a, c] of edges) out[a].push(c);
        mark[0] = 1;
        while (stack.length) for (const n of out[stack.pop()]) if (!mark[n]) { mark[n] = 1; stack.push(n); }
        return mark;
    };
    const forward = reach(links), back = reach(links.map(([a, c]) => [c, a]));
    const renumber = new Map();
    const kept = points.filter((p, i) => { if (forward[i] && back[i]) { renumber.set(i, renumber.size); return true; } return false; });
    const keptLinks = links.filter(([a, c]) => renumber.has(a) && renumber.has(c)).map(([a, c, f]) => [renumber.get(a), renumber.get(c), f]);
    const lost = spawns.filter((s, i) => !renumber.has(i)).length;
    return { points: kept, links: keptLinks, dropped: points.length - kept.length, lostSpawns: lost };
}

const only = process.argv[2];
for (const [id, def] of Object.entries(MAP_DEFS)) {
    if (only && only !== id) continue;
    const t = performance.now(), nav = build(def);
    const r = (v) => Math.round(v * 100) / 100;
    const text = `/**
 * Waypoint graph for ${def.name}. Generated by tools/make-waypoints.mjs: don't edit, run the tool.
 * points: where a player can stand. links: [from, to, kind], one-way; kind 0 = walk, 1 = jump.
 */
export const nav = {
    points: [${nav.points.map((p) => `[${r(p[0])},${r(p[1])},${r(p[2])}]`).join(",")}],
    links: [${nav.links.map((l) => `[${l.join(",")}]`).join(",")}],
};
`;
    await writeFile(fileURLToPath(new URL(`../game/maps/${id}.nav.js`, import.meta.url)), text);
    console.log(`${id}: ${nav.points.length} points, ${nav.links.length} links (${nav.links.filter((l) => l[2] === 1).length} jumps), ${nav.dropped} unreachable points dropped${nav.lostSpawns ? `, ${nav.lostSpawns} SPAWNS UNREACHABLE` : ""}  ${Math.round(performance.now() - t)} ms`);
}
