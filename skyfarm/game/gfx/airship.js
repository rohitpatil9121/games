import { Geometry, primitives } from "../../engine/index.js";
import { part } from "./props.js";

/**
 * SKYFARM: Captain Bram's airship (GDD §6: "its arrival is a moment to see from afar"). Built in code like the hut:
 * a big cream envelope with red bands, a wooden gondola hung under it with a cabin, a bowsprit and a lantern, two
 * propellers on outriggers, tail fins. About 30 m long, so it reads as a landmark from a kilometre. Its origin is
 * the gondola's deck; it faces +x.
 * @module game/gfx/airship
 */
const CREAM = [0.95, 0.9, 0.78], RED = [0.82, 0.34, 0.25], WOOD = [0.5, 0.35, 0.23], DARK = [0.3, 0.22, 0.16];

export function airshipGeometry() {
    const p = [];
    // the envelope: one long ellipsoid, red bands round it, and fins at the tail
    p.push(part(primitives.sphere(0.5, 28, 18), [0, 0, 9], "cloth", [0, 0, 0], [30, 11, 10], CREAM));
    for (const x of [-8, 0, 8]) p.push(part(primitives.torus(1, 0.05, 6, 40), [x, 0, 9], "cloth", [0, Math.PI / 2, 0], [5.2 * Math.sqrt(1 - (x / 15) ** 2), 5.6 * Math.sqrt(1 - (x / 15) ** 2), 1], RED));
    for (const [rx, sy, sz] of [[0, 0, 1], [Math.PI / 2, 1, 0]]) p.push(part(primitives.box(4.5, 0.25, 4.5), [-14, 0, 9], "cloth", [rx, 0, 0], [1, 1, 1], RED));
    // ropes from the envelope to the gondola
    for (const [x, y] of [[-5, -1.5], [-5, 1.5], [5, -1.5], [5, 1.5]]) p.push(part(primitives.box(0.06, 0.06, 5), [x, y, 2.8], "cloth", [y > 0 ? 0.2 : -0.2, 0, 0], [1, 1, 1], [0.8, 0.72, 0.52]));
    // the gondola: a boat-shaped hull (a squashed half sphere), a deck, a cabin with a red roof, a bowsprit
    p.push(part(primitives.sphere(0.5, 18, 10), [0, 0, -0.4], "timber", [0, 0, 0], [13, 4.2, 2.6], WOOD));
    p.push(part(primitives.box(12, 3.8, 0.2), [0, 0, 0.05], "timber", [0, 0, 0], [1, 1, 1], [0.58, 0.42, 0.28]));
    p.push(part(primitives.box(4, 3, 2.2), [-2.5, 0, 1.2], "plaster", [0, 0, 0], [1, 1, 1], [0.92, 0.86, 0.72]));
    p.push(part(primitives.box(4.6, 3.6, 0.3), [-2.5, 0, 2.45], "tile", [0, 0, 0], [1, 1, 1], RED));
    for (const y of [-1.51, 1.51]) p.push(part(primitives.box(1, 0.04, 0.8), [-2.5, y, 1.4], "dark", [0, 0, 0], [1, 1, 1], [0.15, 0.15, 0.18]));
    p.push(part(primitives.cylinder(0.08, 0.12, 4, 6), [7.5, 0, 0.8], "timber", [0, Math.PI / 2 - 0.25, 0], [1, 1, 1], DARK));
    p.push(part(primitives.sphere(0.5, 8, 6), [9.3, 0, 1.3], "glow", [0, 0, 0], [0.5, 0.5, 0.6], [2.2, 1.6, 0.8]));
    // railings
    for (const y of [-1.9, 1.9]) p.push(part(primitives.box(11, 0.06, 0.06), [0.5, y, 0.95], "timber", [0, 0, 0], [1, 1, 1], DARK));
    // outriggers and propellers
    for (const y of [-1, 1]) {
        p.push(part(primitives.box(0.15, 4.5, 0.15), [-4.5, y * 3.8, 1.2], "timber", [0, 0, 0], [1, 1, 1], DARK));
        p.push(part(primitives.cylinder(0.25, 0.25, 0.8, 8), [-4.5, y * 6, 1.2], "dark", [0, Math.PI / 2, 0], [1, 1, 1], [0.35, 0.33, 0.32]));
        for (const a of [0, Math.PI / 2]) p.push(part(primitives.box(0.08, 0.3, 2.6), [-5.0, y * 6, 1.2], "timber", [a, 0, 0], [1, 1, 1], WOOD));
    }
    return Geometry.merge(p, { uvs: false });
}

/** Captain Bram: a round man in a blue coat and a captain's cap, with a beard */
export function bramGeometry() {
    return Geometry.merge([
        part(primitives.capsule(0.36, 0.6, 6, 14), [0, 0, 0.7], "cloth", [0, 0, 0], [1, 1, 1], [0.2, 0.3, 0.5]),
        part(primitives.sphere(0.26, 14, 10), [0, 0, 1.5], "cloth", [0, 0, 0], [1, 1, 1], [0.96, 0.78, 0.64]),
        part(primitives.sphere(0.24, 12, 8), [0.12, 0, 1.38], "cloth", [0, 0, 0], [1, 1, 0.8], [0.85, 0.85, 0.82]),
        part(primitives.cylinder(0.24, 0.27, 0.16, 14), [0, 0, 1.75], "cloth", [0, 0, 0], [1, 1, 1], [0.15, 0.18, 0.3]),
        part(primitives.box(0.3, 0.5, 0.05), [0.18, 0, 1.68], "cloth", [0, 0, 0], [1, 1, 1], [0.12, 0.12, 0.15]),
    ], { uvs: false });
}
