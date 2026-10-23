import { vnoise, topAt } from "../islands.js";

/**
 * SKYFARM: the fields an island's surface is painted from (the `threejs-procedural-fields` skill: one set of
 * coherent fields drives several channels, so the ground colour, the grass and the flowers agree).
 *
 *   meadow   0..1 slow patches: which of the two greens, and how tall the grass is
 *   wear     0..1 near the paths people walk: bare earth, short sparse grass, no flowers
 *   flowers  0..1 clustered drifts of flowers away from the paths
 *   hue      0..1 which flower colour a drift is
 *   edge     0..1 the last few metres to the rim: the grass thins and the earth shows
 *
 * CPU only (they are baked into vertex colours and instance data when an island is built), deterministic
 * from the island's seed. `fieldsAt` writes into `out` to avoid allocation in the placement loops.
 * @module game/gfx/fields
 */

export function makeFields() { return { meadow: 0, wear: 0, flowers: 0, hue: 0, edge: 0, inside: 0 }; }

/** distance from a point to a polyline */
function toPath(path, x, y) {
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i], [bx, by] = path[i + 1], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (d < best) best = d;
    }
    return best;
}

const info = { inside: 0 };
/** The fields at (x, y) on an island (paths in world coordinates, from the world data). */
export function fieldsAt(isl, paths, x, y, out) {
    const s = isl.seed;
    out.meadow = vnoise(x * 0.045, y * 0.045, s + 101) * 0.65 + vnoise(x * 0.13, y * 0.13, s + 103) * 0.35;
    let wear = 0;
    for (const p of paths) {
        const d = toPath(p.points, x, y) - p.width * (0.75 + 0.5 * vnoise(x * 0.6, y * 0.6, s + 107));
        const w = 1 - Math.min(1, Math.max(0, d / 0.9));
        if (w > wear) wear = w;
    }
    out.wear = wear;
    topAt(isl, x, y, info);
    out.inside = info.inside;
    out.edge = 1 - Math.min(1, Math.max(0, (info.inside - 0.4) / 2.2));
    const drift = vnoise(x * 0.09, y * 0.09, s + 109) * 0.7 + vnoise(x * 0.35, y * 0.35, s + 113) * 0.3;
    out.flowers = Math.max(0, (drift - 0.58) / 0.42) * (1 - wear) * (1 - out.edge * 0.7);
    out.hue = vnoise(x * 0.05, y * 0.05, s + 127);
    return out;
}

const mix = (a, b, t) => a + (b - a) * t;
/** The ground's albedo from the fields (linear-ish 0..1 rgb, the palette's grass and earth) */
export function groundColor(f, out) {
    // grass #6fbf4a and #9ad55e, darkened because the blades cover most of what you see of the ground
    const g0 = [0.3, 0.52, 0.19], g1 = [0.42, 0.62, 0.24], earth = [0.5, 0.34, 0.22];
    const m = f.meadow;
    for (let i = 0; i < 3; i++) {
        let c = mix(g0[i], g1[i], m);
        c = mix(c, earth[i], Math.max(f.wear * 0.85, f.edge * 0.6));
        out[i] = c;
    }
    return out;
}
