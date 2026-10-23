import { CROPS } from "../data.js";
import { KIND } from "./props.js";

/**
 * SKYFARM: how each crop looks as it grows (GDD §2: visible growth stages), drawn with four instanced meshes
 * shared by every plot in the world: leaves (cones), balls (spheres: bulbs, heads, fruit, blossoms, berries),
 * stems (cylinders) and the soil tiles. Everything is placed from the plot's growth (0..1) and the crop's stages,
 * so a turnip reads as sprout → rosette → bulb, a sunflower as seedling → stalk → head, a berry bush as a
 * cushion of leaves that flowers pink and then fruits, an apple tree as sapling → small tree → blossom → fruit.
 * Night flowers (moon-bean, star-lily) and the sprites glow (surface kind "glow", which the prop material lights
 * from within), so a garden at night is lit by its own crops.
 * @module game/gfx/crops
 */

const C = {
    leaf: [0.36, 0.62, 0.24], leafPale: [0.52, 0.74, 0.62], dark: [0.25, 0.45, 0.18], stem: [0.42, 0.55, 0.26], bark: [0.45, 0.32, 0.22],
    turnip: [0.95, 0.92, 0.86], turnipTop: [0.7, 0.38, 0.62], rope: [0.72, 0.76, 0.36], petal: [1.0, 0.82, 0.22], seedhead: [0.4, 0.26, 0.14],
    moon: [0.45, 0.62, 1.6], pink: [1.0, 0.6, 0.72], berry: [0.55, 0.16, 0.36], white: [1, 1, 0.97], cotton: [1.08, 1.08, 1.05],
    apple: [0.88, 0.2, 0.16], frost: [0.62, 0.84, 0.86], lily: [1.4, 1.4, 1.3], storm: [0.66, 0.36, 1.2],
};
const G = KIND.glow, P = KIND.cloth;
const smooth = (t) => t * t * (3 - 2 * t);
const span = (g, a, b) => Math.max(0, Math.min(1, (g - a) / (b - a)));

/**
 * Write every plot's soil and plant into the instanced meshes.
 * @param {{ soil, leaves, balls, stems }} m the four instanced meshes
 * @param {object} state
 * @param {number} time seconds (for the ripe bob and the glow pulse)
 * @param {boolean} night
 */
export function drawCrops(m, state, time, night, sparkle) {
    let ns = 0, nl = 0, nb = 0, nt = 0;
    const leaf = (x, y, z, w, d, h, yaw, c, k = P) => { if (nl < m.leaves.capacity) { m.leaves.setTransform(nl, x, y, z, w, d, h, yaw); m.leaves.setColor(nl++, c[0], c[1], c[2], k); } };
    const ball = (x, y, z, sx, sy, sz, c, k = P) => { if (nb < m.balls.capacity) { m.balls.setTransform(nb, x, y, z, sx, sy, sz); m.balls.setColor(nb++, c[0], c[1], c[2], k); } };
    const stem = (x, y, z, r, h, c, yaw = 0) => { if (nt < m.stems.capacity) { m.stems.setTransform(nt, x, y, z + h / 2, r * 2, r * 2, h, yaw); m.stems.setColor(nt++, c[0], c[1], c[2], KIND.timber); } };
    const glow = night ? 1.6 : 1;
    for (const plot of state.plots.values()) {
        const x = plot.ix + 0.5, y = plot.iy + 0.5, z = plot.z;
        m.soil.setTransform(ns, x, y, z + 0.02);
        const sc = plot.watered ? [0.28, 0.18, 0.12] : [0.45, 0.29, 0.19];
        m.soil.setColor(ns++, sc[0], sc[1], sc[2], KIND.soil);
        if (!plot.crop) continue;
        const crop = CROPS[plot.crop], g = plot.growth, ripe = g >= 1, s0 = crop.stages[0];
        const bob = ripe ? Math.sin(time * 3 + x) * 0.03 : 0, seed = plot.ix * 3 + plot.iy * 7;
        const z0 = z + 0.1 + bob;
        switch (plot.crop) {
            case "turnip": {
                const s = g < s0 ? (g / s0) * 0.12 : 0.12 + 0.3 * span(g, s0, 1);
                for (let k = 0; k < (g < s0 ? 2 : 5); k++) { const a = k * 2.4 + seed; leaf(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4, z0 + s * 0.9, s * 0.7, s * 0.35, s * 2.2, a, C.leaf); }
                if (g > 0.45) { const b = 0.1 + 0.26 * span(g, 0.45, 1); ball(x, y, z0 + 0.02 + b * 0.35, b, b, b * 0.9, ripe ? C.turnipTop : C.turnip); }
                break;
            }
            case "ropegrass": {
                const s = 0.15 + 0.85 * g;
                for (let k = 0; k < 7; k++) { const a = k * 0.9 + seed; leaf(x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z0 + s * 0.45, 0.05 + 0.05 * s, 0.05, s * 0.95, a, ripe ? [0.8, 0.76, 0.42] : C.rope); }
                break;
            }
            case "sunflower": {
                const h = 0.2 + 1.5 * smooth(span(g, 0, 0.7));
                stem(x, y, z + 0.05, 0.03, h, C.stem);
                for (let k = 0; k < 4; k++) { const a = k * 1.7 + seed, lz = z + 0.15 + h * (0.25 + k * 0.15); leaf(x + Math.cos(a) * 0.14, y + Math.sin(a) * 0.14, lz, 0.18, 0.08, 0.32, a, C.leaf); }
                if (g > 0.5) {
                    const r = 0.1 + 0.22 * span(g, 0.5, 1), hz = z + 0.05 + h + 0.05;
                    // the head stands up and faces east (the morning sun), petals round a dark seed disc
                    ball(x + 0.05, y, hz, r * 0.35, r * 1.6, r * 1.6, C.petal);
                    ball(x + 0.1, y, hz, r * 0.4, r, r, C.seedhead);
                }
                break;
            }
            case "moonbean": {
                const s = 0.15 + 0.35 * g;
                for (let k = 0; k < 6; k++) { const a = k * 1.05 + seed; leaf(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, z0 + s * 0.3, s * 0.5, s * 0.3, s * 0.9, a, C.dark); }
                if (g > 0.5) for (let k = 0; k < (ripe ? 5 : 2); k++) { const a = k * 1.3 + seed; ball(x + Math.cos(a) * 0.22, y + Math.sin(a) * 0.22, z0 + 0.25, 0.07, 0.07, 0.1, [C.moon[0] * glow, C.moon[1] * glow, C.moon[2] * glow], G); }
                break;
            }
            case "berry": {
                const s = 0.2 + 0.5 * smooth(span(g, 0, 0.5));
                for (let k = 0; k < 3; k++) { const a = k * 2.1 + seed; ball(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3, z + 0.05 + s * 0.6, s * 0.7, s * 0.7, s * 0.6, k % 2 ? C.leaf : C.dark); }
                // blossoms while it's growing toward ripe, berries when ripe
                if (g >= 0.5) for (let k = 0; k < 8; k++) { const a = k * 2.39 + seed, r = s * 0.55; ball(x + Math.cos(a) * r, y + Math.sin(a) * r, z + 0.1 + s * (0.7 + 0.3 * Math.sin(k * 1.7)), 0.06, 0.06, 0.06, ripe ? C.berry : C.pink); }
                break;
            }
            case "skypine": {
                const h = 0.25 + 2.2 * smooth(g);
                stem(x, y, z, 0.03 + 0.06 * g, h * 0.4, C.bark);
                for (let k = 0; k < 3; k++) { const t = k / 3, r = h * (0.32 - t * 0.08); leaf(x, y, z + h * (0.3 + t * 0.28) + r * 0.5, r * 1.5, r * 1.5, r * 1.6, seed + k, C.dark); }
                break;
            }
            case "cotton": {
                const h = 0.2 + 0.7 * smooth(span(g, 0, 0.7));
                stem(x, y, z + 0.05, 0.025, h, C.stem);
                for (let k = 0; k < 3; k++) { const a = k * 2.1 + seed; leaf(x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, z + 0.15 + h * 0.4, 0.14, 0.06, 0.25, a, C.leaf); }
                if (g > 0.6) for (let k = 0; k < 4; k++) { const a = k * 1.6 + seed, open = span(g, 0.6, 1); ball(x + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, z + 0.05 + h * (0.75 + 0.1 * k), 0.05 + 0.1 * open, 0.05 + 0.1 * open, 0.05 + 0.09 * open, open > 0.9 ? C.cotton : [0.6, 0.7, 0.45]); }
                break;
            }
            case "apple": {
                const h = 0.3 + 2.4 * smooth(span(g, 0, 0.5));
                stem(x, y, z, 0.03 + 0.08 * g, h * 0.55, C.bark);
                const cr = 0.15 + 0.6 * smooth(span(g, 0, 0.5));
                for (let k = 0; k < 3; k++) { const a = k * 2.1 + seed; ball(x + Math.cos(a) * cr * 0.4, y + Math.sin(a) * cr * 0.4, z + h * 0.6 + cr * 0.4 + (k === 1 ? cr * 0.3 : 0), cr, cr, cr * 0.85, k === 1 ? C.leaf : C.dark); }
                if (g >= 0.5) for (let k = 0; k < 7; k++) { const a = k * 2.39 + seed; ball(x + Math.cos(a) * cr * 0.8, y + Math.sin(a) * cr * 0.8, z + h * 0.6 + cr * (0.3 + 0.4 * Math.sin(k)), ripe ? 0.09 : 0.05, ripe ? 0.09 : 0.05, ripe ? 0.09 : 0.05, ripe ? C.apple : C.white); }
                break;
            }
            case "frostmint": {
                const s = 0.12 + 0.3 * g;
                for (let k = 0; k < 8; k++) { const a = k * 0.8 + seed; leaf(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4, z0 + s * 0.4, s * 0.45, s * 0.25, s * 1.1, a, C.frost); }
                if (ripe && Math.random() < 0.02) sparkle(x, y, z + 0.4);
                break;
            }
            case "starlily": {
                const h = 0.15 + 0.6 * smooth(span(g, 0, 0.6));
                stem(x, y, z + 0.05, 0.02, h, C.stem);
                for (let k = 0; k < 3; k++) { const a = k * 2.1 + seed; leaf(x + Math.cos(a) * 0.08, y + Math.sin(a) * 0.08, z + 0.12, 0.12, 0.05, 0.3, a, C.leaf); }
                if (g > 0.5) { const o = 0.06 + 0.12 * span(g, 0.5, 1); for (let k = 0; k < 5; k++) { const a = k * 1.256 + seed; leaf(x + Math.cos(a) * o * 0.7, y + Math.sin(a) * o * 0.7, z + 0.05 + h + o * 0.4, o * 0.6, o * 0.25, o * 1.5, a, [C.lily[0] * glow, C.lily[1] * glow, C.lily[2] * glow], G); } }
                break;
            }
            case "stormbloom": {
                const h = 0.2 + 0.5 * g;
                stem(x, y, z + 0.05, 0.025, h, C.stem);
                if (g > 0.4) for (let k = 0; k < 6; k++) { const a = k * 1.05 + seed; leaf(x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, z + h + 0.1, 0.06, 0.04, 0.3, a, C.storm, G); }
                break;
            }
        }
        if (ripe && Math.random() < 0.04) sparkle(x, y, z + 0.7);
        if (plot.pollinated && Math.random() < 0.01) sparkle(x, y, z + 0.4, true);
    }
    m.soil.count = ns; m.leaves.count = nl; m.balls.count = nb; m.stems.count = nt;
}

/** The sprites: a glowing teal body and two fluttering wings each (instanced balls). */
export function drawSprites(m, state, time, alpha) {
    let n = 0;
    for (const s of state.sprites) {
        if (n + 3 > m.capacity) break;
        const x = s.x + s.vx * alpha / 60, y = s.y + s.vy * alpha / 60, z = s.z + Math.sin(time * 4 + s.id) * 0.08;
        m.setTransform(n, x, y, z, 0.11, 0.11, 0.13); m.setColor(n++, 0.6, 1.8, 1.6, KIND.glow);
        const flap = Math.abs(Math.sin(time * 22 + s.id)) * 0.9 + 0.1, a = Math.atan2(s.vy, s.vx);
        for (const side of [-1, 1]) {
            const wx = x - Math.sin(a) * side * 0.12, wy = y + Math.cos(a) * side * 0.12;
            m.setTransform(n, wx, wy, z + 0.06, 0.05, 0.12 * flap, 0.02, a); m.setColor(n++, 1.2, 1.6, 1.7, KIND.glow);
        }
    }
    m.count = n;
}
