import { MOVE, WATER } from "./data.js";

/**
 * TIDEFALL: getting around the island, for bots (game/bots.js) and for tools/check-island.mjs.
 *
 * The heightmap's own samples are the nodes (one every ISLAND.cell metres), eight neighbours each. A node
 * is blocked where a ruin wall stands on it. What a step costs is seconds of travel, and that depends on
 * the water: dry ground at running speed, shallows at wading speed, deep water at swimming speed (or not
 * at all, for a path that must stay on foot). So the same island has a different map every tick, and a
 * path is always asked for at a water level.
 *
 * Dijkstra over ~19,000 nodes with a binary heap takes a few milliseconds. Bots ask for a field from
 * their goal and walk downhill on it (game/bots.js), rather than an A* per bot per tick.
 * @module game/nav
 */

/** Build the node grid for an island: ground heights and which nodes are blocked by ruins. */
export function buildNav(island) {
    const n = island.n, cell = island.cell, half = island.half, z = island.heights;
    const blocked = new Uint8Array(n * n);
    for (const s of island.solids) {
        const i0 = Math.max(0, Math.ceil((s.x0 - MOVE.radius + half) / cell)), i1 = Math.min(n - 1, Math.floor((s.x1 + MOVE.radius + half) / cell));
        const j0 = Math.max(0, Math.ceil((s.y0 - MOVE.radius + half) / cell)), j1 = Math.min(n - 1, Math.floor((s.y1 + MOVE.radius + half) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const g = z[j * n + i];
            // a box that is in the way of a standing body (a low platform can be stepped or climbed onto)
            if (s.z0 < g + MOVE.height - 0.1 && s.z1 > g + MOVE.mantle) blocked[j * n + i] = 1;
        }
    }
    return { n, cell, half, z, blocked };
}

export const nodeAt = (nav, x, y) => {
    const i = Math.max(0, Math.min(nav.n - 1, Math.round((x + nav.half) / nav.cell))), j = Math.max(0, Math.min(nav.n - 1, Math.round((y + nav.half) / nav.cell)));
    return j * nav.n + i;
};
export const nodeX = (nav, k) => (k % nav.n) * nav.cell - nav.half;
export const nodeY = (nav, k) => Math.floor(k / nav.n) * nav.cell - nav.half;

/** Speed (m/s) on a node at this water level; 0 = not passable. */
export function speedAt(nav, k, level, onFoot, slow = 1) {
    if (nav.blocked[k]) return 0;
    const depth = level - nav.z[k];
    if (depth > WATER.swimDepth) return onFoot ? 0 : WATER.swim * (0.75 + 0.25 * slow);
    if (depth > WATER.wadeDepth) return MOVE.run * WATER.wade * slow;
    return MOVE.run * slow;
}

const DIAG = Math.SQRT2;
const KNIGHT = Math.sqrt(5);
/** sixteen directions: the knight's moves keep straight-line travel within 3% of its true length at any angle */
const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
    [2, 1, KNIGHT], [2, -1, KNIGHT], [-2, 1, KNIGHT], [-2, -1, KNIGHT], [1, 2, KNIGHT], [1, -2, KNIGHT], [-1, 2, KNIGHT], [-1, -2, KNIGHT]];

/**
 * Seconds of travel from every node to the nearest of `goals` (node indices), at a water level.
 * @param {{ onFoot?: boolean, slow?: number, out?: Float32Array }} [opts]
 * @returns {Float64Array} Infinity where there is no way (doubles: a float32 field rounds and relaxes nodes again and again)
 */
export function travelField(nav, goals, level, opts = {}) {
    const n = nav.n, total = n * n, dist = opts.out || new Float64Array(total), onFoot = !!opts.onFoot, slow = opts.slow ?? 1;
    // speeds at this level, once per field
    const speed = nav._speed || (nav._speed = new Float32Array(total));
    for (let k = 0; k < total; k++) speed[k] = speedAt(nav, k, level, onFoot, slow);
    dist.fill(Infinity);
    const heap = nav._heap || (nav._heap = new Heap(total));
    heap.size = 0;
    for (const g of goals) { dist[g] = 0; heap.push(g, 0); }
    const cell = nav.cell, z = nav.z, blocked = nav.blocked, maxRise = MOVE.maxSlope * 0.9;
    while (heap.size) {
        const k = heap.pop(), d = dist[k];
        if (heap.lastKey > d) continue;
        const vk = speed[k];
        const i = k % n, j = (k - i) / n;
        for (let e = 0; e < 16; e++) {
            const di = NI[e], dj = NJ[e], ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            const m = jj * n + ii, vm = speed[m];
            if (!vm) continue;
            // a knight's move passes between two nodes; both must be open
            if (e >= 8 && (blocked[j * n + i + (di > 1 || di < -1 ? di / 2 : 0) + (dj > 1 || dj < -1 ? (dj / 2) * n : 0)] || blocked[(j + Math.sign(dj)) * n + i + Math.sign(di)])) continue;
            // the field is built from the goal outward, so the step walked is m -> k
            const run = NL[e] * cell;
            if ((z[k] - z[m]) / run > maxRise) continue;
            const nd = d + (run * 2) / (vm + vk);
            if (nd < dist[m]) { dist[m] = nd; heap.push(m, nd); }
        }
    }
    return dist;
}
const NI = new Int8Array(NEIGHBOURS.map((v) => v[0])), NJ = new Int8Array(NEIGHBOURS.map((v) => v[1])), NL = new Float64Array(NEIGHBOURS.map((v) => v[2]));

/** A small binary min-heap of node indices keyed by distance (duplicates allowed; stale entries skipped). */
class Heap {
    constructor(capacity) { this.keys = new Float64Array(capacity * 4); this.items = new Int32Array(capacity * 4); this.size = 0; this.lastKey = 0; }
    push(item, key) {
        if (this.size >= this.items.length) { const k = new Float64Array(this.size * 2), it = new Int32Array(this.size * 2); k.set(this.keys); it.set(this.items); this.keys = k; this.items = it; }
        let i = this.size++;
        while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= key) break; this.keys[i] = this.keys[p]; this.items[i] = this.items[p]; i = p; }
        this.keys[i] = key; this.items[i] = item;
    }
    pop() {
        const top = this.items[0]; this.lastKey = this.keys[0];
        const key = this.keys[--this.size], item = this.items[this.size];
        let i = 0;
        for (;;) {
            let c = 2 * i + 1;
            if (c >= this.size) break;
            if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
            if (this.keys[c] >= key) break;
            this.keys[i] = this.keys[c]; this.items[i] = this.items[c]; i = c;
        }
        this.keys[i] = key; this.items[i] = item;
        return top;
    }
}

/** The neighbour of node k with the lowest field value: one step down the hill toward the goal. */
export function downhill(nav, field, k) {
    const n = nav.n, i = k % n, j = (k - i) / n;
    let best = k, bestD = field[k];
    for (const [di, dj] of NEIGHBOURS) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const m = jj * n + ii;
        if (field[m] < bestD) { bestD = field[m]; best = m; }
    }
    return best;
}
