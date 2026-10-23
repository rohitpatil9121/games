import { dsin, dcos, datan2, hash3, smooth, clamp, TAU } from "./det.js";
import { MOVE } from "./data.js";

/**
 * SKYFARM: the floating islands, as shapes the simulation can stand on and the renderer can draw.
 *
 * An island is a few numbers (centre, top height, radius, how far its rock hangs down, a seed). Its outline is
 * the radius wobbled by three seeded sine terms around the circle, so it is round-ish and different every time
 * but has no seams. Its top is a gentle plateau (value noise hills), rounded off over the last few metres to
 * the rim, with flat pads where the hut and the plots sit. Its underside hangs below as a rough cone. The
 * simulation treats everything between underside and top as solid rock.
 *
 * Only + − × ÷, sqrt and det.js's dsin/datan2 are used, so every engine gets the same bits (the farm and the
 * player must replay identically in tests and, later, in co-op).
 *
 * Stage 1 has the two greybox islands below. Stage 3 replaces them with the 20 islands stored as data.
 * @module game/islands
 */

/** the prototype world: home and the first neighbour, a downhill glide apart */
export const PROTOTYPE = Object.freeze({
    islands: [
        {
            id: "hearth", name: "Hearth Isle", x: 0, y: 0, top: 60, radius: 30, depth: 34, seed: 11, hills: 1.6,
            flats: [{ x: -6, y: -2, r: 7 }, { x: 6, y: -1, r: 6 }, { x: 4, y: 9, r: 3.5 }],
        },
        {
            id: "daisy", name: "Daisy Step", x: 150, y: 34, top: 46, radius: 21, depth: 26, seed: 23, hills: 1.2,
            flats: [{ x: 150, y: 34, r: 6 }],
        },
    ],
    /** hut: walls as boxes with a door gap facing +x; the bed and the table are where things happen */
    hut: { x: -6, y: -2, w: 6, d: 5, h: 2.6, door: 1.6, wall: 0.3 },
    bed: { x: -8, y: -3.4 },
    shed: { x: 4, y: 9 },
    /** the soil patch beside the hut: tiles you may till, and the six already tilled */
    field: { x0: 3, y0: -5, x1: 10, y1: 2 },
    tilled: [[4, -3], [5, -3], [6, -3], [4, -2], [5, -2], [6, -2]],
    /** where you wake */
    wake: { x: -7.4, y: -1.2, yaw: 0 },
    items: [
        { kind: "seed", crop: "turnip", count: 1, x: -4.6, y: -3.4, z: 0.9 },
        { kind: "glider", x: 4, y: 9, z: 1.1 },
        { kind: "seed", crop: "ropegrass", count: 3, x: 152, y: 37, z: 0.3 },
    ],
    /** standing stones on Daisy Step (a ring around its pad; they block walking) */
    stones: { x: 150, y: 34, r: 5.2, n: 7 },
    /**
     * The air (GDD §2): a thermal off Hearth Isle's west cliff, a wind current that carries you to Daisy Step,
     * and a thermal beside Daisy Step for the way back. Format as PAPER PLANES' air sources.
     */
    air: [
        { kind: "thermal", at: [-50, 6], radius: 18, bottom: 0, top: 120, rise: 3.2, riseTop: 2.2 },
        { kind: "thermal", at: [184, 58], radius: 18, bottom: 0, top: 110, rise: 3.4, riseTop: 2.4 },
        { kind: "current", from: [24, 6, 60], to: [132, 30, 50], radius: 11, speed: 5 },
    ],
});

const EDGE = 4.5, EDGE_DROP = 1.6, RIM = 2.2;

/** Value noise in [0, 1] on a unit lattice (TIDEFALL's island noise). */
export function vnoise(x, y, salt) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
    const a = hash3(xi, yi, salt), b = hash3(xi + 1, yi, salt), c = hash3(xi, yi + 1, salt), d = hash3(xi + 1, yi + 1, salt);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fill in what an island needs that isn't data: its outline terms and its bounding radius. */
export function prepare(island) {
    const terms = [];
    for (let k = 0; k < 3; k++) {
        terms.push({ k: 3 + k * 2, a: [0.07, 0.045, 0.025][k], p: hash3(island.seed, k, 31) * TAU });
    }
    island.terms = terms;
    island.reach = island.radius * 1.15;
    island.bottomZ = island.top - island.depth - RIM;
    return island;
}

/** the outline's radius toward angle `a` */
export function rimAt(island, a) {
    let r = 1;
    for (const t of island.terms) r += t.a * dsin(t.k * a + t.p);
    return island.radius * r;
}

/** how flat the ground must be here (0 free, 1 on a pad) */
function flatness(island, x, y) {
    let f = 0;
    for (const p of island.flats) {
        const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
        const k = 1 - smooth(clamp((d - p.r) / 4, 0, 1));
        if (k > f) f = k;
    }
    return f;
}

/**
 * The top surface's height at (x, y), or -Infinity outside the outline. Also gives the distance in from the
 * rim (`inside` metres), for the renderer's colours.
 */
export function topAt(island, x, y, out) {
    const dx = x - island.x, dy = y - island.y, d2 = dx * dx + dy * dy;
    if (d2 > island.reach * island.reach) return -Infinity;
    const d = Math.sqrt(d2), rr = rimAt(island, datan2(dy, dx));
    if (d > rr) return -Infinity;
    const inside = rr - d;
    const hills = (vnoise(x * 0.06, y * 0.06, island.seed) - 0.5) * 2 * island.hills + (vnoise(x * 0.17, y * 0.17, island.seed + 7) - 0.5) * 0.5;
    const flat = flatness(island, x, y);
    // the plateau rounds over toward the rim like a loaf, not a table
    const e = 1 - clamp(inside / EDGE, 0, 1);
    const z = island.top + hills * (1 - flat) * (1 - e) - EDGE_DROP * e * e;
    if (out) out.inside = inside;
    return z;
}

/** The underside's height at (x, y) (only meaningful inside the outline). */
export function bottomAt(island, x, y) {
    const dx = x - island.x, dy = y - island.y, d = Math.sqrt(dx * dx + dy * dy);
    const rr = rimAt(island, datan2(dy, dx)), u = clamp(d / rr, 0, 1);
    // a rough hanging cone: steep at the rim, a rounded point below the middle
    const hang = 1 - u * u * (0.35 + 0.65 * u);
    const rough = 0.82 + 0.36 * vnoise(x * 0.11, y * 0.11, island.seed + 3);
    return island.top - RIM - island.depth * hang * rough;
}

/** A world: islands plus the boxes things bump into. Built once from data. */
export function makeWorld(data) {
    const islands = data.islands.map((i) => prepare({ ...i, flats: i.flats.map((f) => ({ ...f })) }));
    const boxes = [];
    const home = islands[0];
    const groundUnder = (x, y) => topAt(home, x, y);
    // the hut's walls, with a door gap in the middle of the +x wall; their floor is the pad's height
    const h = data.hut, z0 = groundUnder(h.x, h.y), x0 = h.x - h.w / 2, x1 = h.x + h.w / 2, y0 = h.y - h.d / 2, y1 = h.y + h.d / 2, t = h.wall;
    const box = (ax, ay, bx, by, top, kind) => boxes.push({ x0: ax, y0: ay, x1: bx, y1: by, z0: z0 - 1, z1: top, kind });
    box(x0, y0, x1, y0 + t, z0 + h.h, "wall");
    box(x0, y1 - t, x1, y1, z0 + h.h, "wall");
    box(x0, y0, x0 + t, y1, z0 + h.h, "wall");
    box(x1 - t, y0, x1, h.y - h.door / 2, z0 + h.h, "wall");
    box(x1 - t, h.y + h.door / 2, x1, y1, z0 + h.h, "wall");
    // the roof: you can land on it, you can't walk through it from below
    boxes.push({ x0: x0 - 0.6, y0: y0 - 0.6, x1: x1 + 0.6, y1: y1 + 0.6, z0: z0 + h.h, z1: z0 + h.h + 0.35, kind: "roof" });
    // standing stones
    const s = data.stones, daisy = islands[1];
    for (let k = 0; k < s.n; k++) {
        const a = (k / s.n) * TAU + 0.3, sx = s.x + dcos(a) * s.r, sy = s.y + dsin(a) * s.r, sz = topAt(daisy, sx, sy);
        boxes.push({ x0: sx - 0.45, y0: sy - 0.35, x1: sx + 0.45, y1: sy + 0.35, z0: sz - 1, z1: sz + 2.2 + (k % 3) * 0.5, kind: "stone" });
    }
    return { islands, boxes, data };
}

/** The highest ground under (x, y) that the feet at height z can stand on (within a step up), or -Infinity. */
export function groundBelow(world, x, y, z) {
    let best = -Infinity;
    for (const isl of world.islands) {
        const t = topAt(isl, x, y);
        if (t > best && t <= z + MOVE.step + 0.01) best = t;
    }
    for (const b of world.boxes) {
        if (b.kind !== "roof" && b.kind !== "stone") continue;
        if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && b.z1 > best && b.z1 <= z + MOVE.step + 0.01) best = b.z1;
    }
    return best;
}

/** The island whose rock contains the point, or null. */
export function solidAt(world, x, y, z) {
    for (const isl of world.islands) {
        if (z > isl.top + isl.hills + 1 || z < isl.bottomZ - isl.depth * 0.4) continue;
        const t = topAt(isl, x, y);
        if (t === -Infinity || z > t) continue;
        if (z > bottomAt(isl, x, y)) return isl;
    }
    return null;
}

/** the island whose outline is under (x, y) and whose top is nearest below z (for "which island am I on") */
export function islandUnder(world, x, y, z = Infinity) {
    let best = null, bz = -Infinity;
    for (const isl of world.islands) {
        const t = topAt(isl, x, y);
        if (t > bz && t <= z + 1) { bz = t; best = isl; }
    }
    return best;
}

/** Is the point inside any box (grown by r sideways)? Returns the box or null. */
export function boxAt(world, x, y, z, r, h = MOVE.height) {
    for (const b of world.boxes) {
        if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r && z < b.z1 - 0.01 && z + h > b.z0) return b;
    }
    return null;
}

/**
 * March a ray against the islands' rock and the boxes. Returns the distance to the first hit, or -1. Steps of
 * 0.35 m and a bisection at the end: islands are big and smooth, so this is enough for the camera arm.
 */
export function rayWorld(world, ox, oy, oz, dx, dy, dz, max) {
    const step = 0.35;
    let prev = 0;
    for (let t = step; t <= max + 1e-9; t += step) {
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        if (solidAt(world, x, y, z) || boxAt(world, x, y, z, 0.05, 0.02)) {
            let a = prev, b = t;
            for (let k = 0; k < 5; k++) {
                const m = (a + b) / 2, mx = ox + dx * m, my = oy + dy * m, mz = oz + dz * m;
                if (solidAt(world, mx, my, mz) || boxAt(world, mx, my, mz, 0.05, 0.02)) b = m; else a = m;
            }
            return a;
        }
        prev = t;
    }
    return -1;
}

/** Is the tile at grid (ix, iy) inside the home field? */
export function inField(world, ix, iy) {
    const f = world.data.field;
    return ix >= f.x0 && ix <= f.x1 && iy >= f.y0 && iy <= f.y1;
}
