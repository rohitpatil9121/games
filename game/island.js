import { ISLAND, TIDE, LOOT_TABLE } from "./data.js";
import { makeRandom, hash3, smooth, dcos, dsin, TAU } from "./det.js";

/**
 * TIDEFALL: the island, generated from a seed (the `procedural-gen` skill: seeded heightmap, placement by
 * rule, weighted loot tables).
 *
 * The same seed gives the same island on the server, every client and the tools, so an island never
 * travels on the wire: only its seed and team count do. Generation uses only arithmetic, Math.sqrt and
 * the deterministic dsin (game/det.js), so it is bit-identical everywhere.
 *
 * SHAPE. A radial profile (data.js ISLAND.profile: a central hill, a plateau ring for the camps, a beach,
 * then a sea floor shelving away in steps) plus two octaves of value noise.
 *
 * FAIRNESS (the `level-design` skill). Teams split the island into equal sectors, one camp each. Everything
 * that matters to scoring is placed per sector with the same offsets in every sector: ruins, rocks that stay
 * dry at high water, and the wreck, which lies broken into one piece between each pair of neighbouring
 * camps. Under each camp and ruin the terrain is flattened to the profile's height there, and noise fades
 * out around them, so every camp has the same height and the same distance to every ring.
 * tools/check-island.mjs measures this for many seeds.
 *
 * COLLISION. groundAt() is the heightmap, bilinear between samples; ruins and the wreck are axis-aligned
 * boxes (`solids`) in a coarse grid for quick lookup, as in BREACH.
 * @module game/island
 */

const P = ISLAND.profile;

/** Height of the radial profile at distance r from the centre. */
export function profileAt(r) {
    if (r <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
        if (r <= P[i][0]) {
            const a = P[i - 1], b = P[i], t = (r - a[0]) / (b[0] - a[0]);
            return a[1] + (b[1] - a[1]) * smooth(t);
        }
    }
    return P[P.length - 1][1];
}

/** Value noise in [-1, 1]: a lattice of hashed values, blended smoothly. */
function valueNoise(seed, x, y, scale) {
    const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = hash3(seed, ix, iy), b = hash3(seed, ix + 1, iy), c = hash3(seed, ix, iy + 1), d = hash3(seed, ix + 1, iy + 1);
    return (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * 2 - 1;
}

/**
 * Ruin layouts, in metres around the ruin's centre, z up from the floor. Each is a list of boxes
 * [x0, y0, z0, x1, y1, z1, material] and loot spots [x, y]. Some have roofs: a cave or a hall is a place
 * to be trapped when the flood comes in.
 */
const LAYOUTS = {
    shrine: {
        boxes: [[-3.2, -3.2, 0, -2.2, -2.2, 3.4, "stone"], [2.2, -3.2, 0, 3.2, -2.2, 2.1, "stone"], [-3.2, 2.2, 0, -2.2, 3.2, 1.3, "stone"], [2.2, 2.2, 0, 3.2, 3.2, 3.4, "stone"],
            [-3.2, -3.2, 3.4, 0.6, -2.2, 3.9, "stone"], [-1.6, -1.6, 0, 1.6, 1.6, 0.4, "moss"]],
        spots: [[0, 0.6], [-0.9, -0.5]],
    },
    hall: {
        boxes: [[-5, -3, 0, 5, -2.2, 2.6, "stone"], [-5, 2.2, 0, 3.2, 3, 2.6, "stone"], [-5, -3, 2.6, 1.5, 3, 3.1, "stone"], [4.2, 2.2, 0, 5, 3, 1.1, "stone"],
            [-5, -2.2, 0, -4.2, 2.2, 2.6, "stone"]],
        spots: [[-3.2, 0], [-1.2, 0.8], [1.8, -0.6]],
    },
    steps: {
        boxes: [[-4, -4, 0, 4, 4, 1.05, "stone"], [-2.8, -2.8, 1.05, 2.8, 2.8, 2.1, "stone"], [-1.6, -1.6, 2.1, 1.6, 1.6, 3.15, "moss"]],
        spots: [[0, 0, 3.15], [-3.4, 3.4, 1.05]],
    },
    cave: {
        boxes: [[-4, -3.5, 0, 4, -2.4, 3.2, "rock"], [-4, 2.4, 0, 4, 3.5, 3.2, "rock"], [2.9, -2.4, 0, 4, 2.4, 3.2, "rock"], [-4, -3.5, 3.2, 4, 3.5, 4.4, "rock"],
            [-4.6, -3.5, 0, -4, -1.6, 1.4, "rock"]],
        spots: [[2, 0], [0.4, 1.2], [-1.2, -1]],
    },
    arch: {
        boxes: [[-3.6, -0.8, 0, -2.2, 0.8, 4.6, "stone"], [2.2, -0.8, 0, 3.6, 0.8, 4.6, "stone"], [-3.6, -0.8, 4.6, 3.6, 0.8, 5.5, "stone"], [-1.2, 2, 0, 1.2, 3.2, 0.8, "moss"]],
        spots: [[0, 0], [0, 2.6, 0.8]],
    },
};
/** which layouts each ring uses, in order, per sector slot */
const RING_KINDS = [["shrine", "arch"], ["hall", "steps"], ["cave"]];
/** one piece of the wreck: a hull lying on its side, a deck and a mast to grapple to */
const WRECK = {
    boxes: [[-7, -2.4, 0, 7, -1.7, 2.4, "wood"], [-7, 1.7, 0, 5, 2.4, 1.3, "wood"], [-7, -2.4, 0, 7, 2.4, 0.5, "wood"], [6.2, -1.7, 0, 7, 2.4, 2.8, "wood"],
        [-1.5, -0.3, 0.5, -0.9, 0.3, 10.5, "wood"], [-4.5, -0.15, 7.8, 2, 0.15, 8.1, "wood"], [-6.2, -1.7, 0.5, -3.6, 1.7, 1.6, "wood"]],
    spots: [[2, 0, 0.5], [4.6, 0.6, 0.5], [-4.9, 0, 1.6], [0.6, -0.9, 0.5]],
};

/**
 * Generate the island.
 * @param {number} seed
 * @param {number} [teams] 2..4: one camp and one sector each
 */
export function generateIsland(seed, teams = 4) {
    seed = seed >>> 0;
    teams = Math.max(2, Math.min(4, teams | 0));
    const rand = makeRandom(seed ^ 0x51ed27);
    const size = ISLAND.size, cell = ISLAND.cell, n = Math.round(size / cell) + 1, half = size / 2;
    const sector = TAU / teams, a0 = rand() * TAU;
    const at = (angle, r) => [dcos(angle) * r, dsin(angle) * r];

    // ---------------------------------------------------------------- what goes where
    /** flattened pads: { x, y, z, r (flat radius), blend (falloff width) } */
    const pads = [];
    const camps = [];
    for (let i = 0; i < teams; i++) {
        const angle = a0 + i * sector, [x, y] = at(angle, ISLAND.campRadius), z = profileAt(ISLAND.campRadius);
        camps.push({ team: i, x, y, z, angle });
        pads.push({ x, y, z, r: ISLAND.campPad, blend: 9 });
    }

    const ruins = [];
    // sector-relative angles for each ring slot, the same in every sector
    ISLAND.rings.forEach((ring, ringIndex) => {
        if (ring.wreck) {
            for (let i = 0; i < teams; i++) {
                const angle = a0 + (i + 0.5) * sector, [x, y] = at(angle, ring.r), z = profileAt(ring.r);
                ruins.push({ kind: "wreck", ring: ringIndex, tier: ring.tier, x, y, z, layout: WRECK, sector: i });
                pads.push({ x, y, z, r: 9, blend: 7 });
            }
            return;
        }
        const offsets = [];
        for (let j = 0; j < ring.perSector; j++) offsets.push(((j + 0.5) / ring.perSector + (rand() - 0.5) * 0.18 / ring.perSector) * sector);
        for (let i = 0; i < teams; i++) {
            offsets.forEach((off, j) => {
                const angle = a0 + i * sector + off, [x, y] = at(angle, ring.r), z = profileAt(ring.r);
                const kind = RING_KINDS[ringIndex][j % RING_KINDS[ringIndex].length];
                ruins.push({ kind, ring: ringIndex, tier: ring.tier, x, y, z, layout: LAYOUTS[kind], sector: i });
                pads.push({ x, y, z, r: 6.5, blend: 6 });
            });
        }
    });

    // rocks that stay dry at high water: somewhere to wait out the flood, and to grapple to
    const rocks = [];
    const rockOffsets = [0.3 + rand() * 0.1, 0.62 + rand() * 0.1];
    for (let i = 0; i < teams; i++) {
        for (const off of rockOffsets) {
            const angle = a0 + (i + off) * sector, r = 70 + (off > 0.5 ? 6 : 0), [x, y] = at(angle, r);
            rocks.push({ x, y, z: TIDE.high + 1.6, r: 3.2 });
        }
    }

    // ---------------------------------------------------------------- the heightmap
    const heights = new Float64Array(n * n);
    const noiseSeed = (seed * 31 + 7) >>> 0;
    for (let j = 0; j < n; j++) {
        const y = -half + j * cell;
        for (let i = 0; i < n; i++) {
            const x = -half + i * cell, r = Math.sqrt(x * x + y * y);
            let h = profileAt(r);
            const noise = valueNoise(noiseSeed, x, y, 26) * 0.7 + valueNoise(noiseSeed + 1, x, y, 9) * 0.3;
            // the sea floor is gentler than the land; flatten noise near pads
            let calm = 1;
            for (const p of pads) {
                const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < p.r + p.blend) calm = Math.min(calm, d <= p.r ? 0 : smooth((d - p.r) / p.blend));
            }
            h += noise * ISLAND.noise * calm;
            for (const p of pads) {
                const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d >= p.r + p.blend) continue;
                const w = d <= p.r ? 1 : 1 - smooth((d - p.r) / p.blend);
                h += (p.z - h) * w;
            }
            for (const k of rocks) {
                const dx = x - k.x, dy = y - k.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d >= k.r + 3) continue;
                const w = d <= k.r ? 1 : 1 - smooth((d - k.r) / 3);
                if (k.z > h) h += (k.z - h) * w;
            }
            heights[j * n + i] = h;
        }
    }

    // ---------------------------------------------------------------- ruins as boxes, loot spots
    const solids = [], spots = [];
    for (const ruin of ruins) {
        ruin.solids = [];
        for (const b of ruin.layout.boxes) {
            const s = { x0: ruin.x + b[0], y0: ruin.y + b[1], z0: ruin.z + b[2] - (b[2] === 0 ? 0.4 : 0), x1: ruin.x + b[3], y1: ruin.y + b[4], z1: ruin.z + b[5], mat: b[6], stamp: 0 };
            solids.push(s); ruin.solids.push(s);
        }
        for (const sp of ruin.layout.spots) spots.push({ x: ruin.x + sp[0], y: ruin.y + sp[1], z: ruin.z + (sp[2] || 0), tier: ruin.tier, ruin: ruins.indexOf(ruin) });
    }
    // a few coins on the beach and the first shelf, so the first ebb has something close
    for (let i = 0; i < teams; i++) {
        for (const off of [0.18, 0.5, 0.82]) {
            const angle = a0 + (i + off) * sector, r = 64, [x, y] = at(angle, r);
            spots.push({ x, y, z: 0, tier: 0, ruin: -1, beach: true });
        }
    }

    const island = { seed, teams, size, cell, n, half, heights, camps, ruins, rocks, solids, spots, sector, a0, grid: null };
    for (const s of spots) if (s.beach) s.z = groundAt(island, s.x, s.y);
    island.grid = buildGrid(solids, -half, -half, size, 8);
    return island;
}

/** Bucket boxes into a coarse grid of ground cells, so collision only looks at the ones nearby. */
function buildGrid(solids, x0, y0, size, cellSize) {
    const nx = Math.ceil(size / cellSize), ny = nx, cells = Array.from({ length: nx * ny }, () => []);
    for (const s of solids) {
        const cx0 = Math.max(0, Math.floor((s.x0 - x0) / cellSize)), cx1 = Math.min(nx - 1, Math.floor((s.x1 - x0) / cellSize));
        const cy0 = Math.max(0, Math.floor((s.y0 - y0) / cellSize)), cy1 = Math.min(ny - 1, Math.floor((s.y1 - y0) / cellSize));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * nx + cx].push(s);
    }
    return { x0, y0, cell: cellSize, nx, ny, cells };
}

/** Terrain height at (x, y): bilinear between heightmap samples. Off the map, deep sea. */
export function groundAt(island, x, y) {
    const n = island.n, fx = (x + island.half) / island.cell, fy = (y + island.half) / island.cell;
    if (fx < 0 || fy < 0 || fx >= n - 1 || fy >= n - 1) return -14;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, h = island.heights, k = j * n + i;
    const a = h[k], b = h[k + 1], c = h[k + n], d = h[k + n + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Surface normal of the terrain at (x, y), by central differences. For presentation and bots. */
export function normalAt(island, x, y, out = [0, 0, 1]) {
    const e = island.cell * 0.5;
    const dx = groundAt(island, x + e, y) - groundAt(island, x - e, y), dy = groundAt(island, x, y + e) - groundAt(island, x, y - e);
    const l = Math.sqrt(dx * dx + dy * dy + 4 * e * e);
    out[0] = -dx / l; out[1] = -dy / l; out[2] = (2 * e) / l;
    return out;
}

/** Pick a loot kind for a depth tier from the weighted table, given a number in [0, 1). */
export function rollLoot(tier, u) {
    const row = LOOT_TABLE[Math.max(0, Math.min(LOOT_TABLE.length - 1, tier))];
    let acc = 0;
    for (let k = 0; k < row.length; k++) { acc += row[k]; if (u < acc) return k + 1; }
    return 1;
}
