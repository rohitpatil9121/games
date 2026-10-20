import { Geometry, primitives, mat4, quat } from "../engine/index.js";

/**
 * TIDEFALL: props built from primitives at load (as BREACH's models.js): loot, palms, rocks, the camp,
 * sea-floor dressing. Each returns one merged Geometry with vertex colours; colour alpha tells the stone
 * shader what a part is made of where it matters (0.25 stone, 0.6 wood, 1 painted/camp).
 *
 * Silhouettes are chosen for reading at a glance (the `threejs-aaa-graphics-builder` rule, readability
 * before beauty): coins are a low gold stack, a relic is a tall teal urn with handles, an idol is a
 * squat magenta figure with a crown and glowing eyes. Different shape, size and colour each.
 * @module game/models
 */

const PI = Math.PI;
const tmp = { q: quat.create() };
/** a part: geometry, placed at `at`, turned by euler `rot` (radians), scaled, coloured */
function part(geometry, at = [0, 0, 0], color = [1, 1, 1], rot = null, scale = null) {
    const m = mat4.create();
    if (rot) quat.fromEuler(tmp.q, rot[0] * 180 / PI, rot[1] * 180 / PI, rot[2] * 180 / PI); else quat.identity(tmp.q);
    mat4.fromRotationTranslationScale(m, tmp.q, at, scale || [1, 1, 1]);
    return { geometry, matrix: m, color };
}
const merge = (parts) => Geometry.merge(parts, { uvs: false });

const GOLD = [1.0, 0.78, 0.25, 1], TEAL = [0.2, 0.72, 0.72, 1], MAGENTA = [0.92, 0.3, 0.72, 1], GLOW = [3, 2.6, 1.2, 1];

/** Loot by kind (1 coins, 2 relic, 3 idol), sized in metres, standing on z = 0. */
export function lootGeometry(kind) {
    if (kind === 1) {
        const coin = primitives.cylinder(0.11, 0.11, 0.025, 14);
        return merge([
            part(coin, [0, 0, 0.0125], GOLD), part(coin, [0.01, 0.005, 0.0375], GOLD), part(coin, [-0.005, 0.01, 0.0625], GOLD), part(coin, [0.005, -0.004, 0.0875], GOLD),
            part(coin, [0.16, 0.05, 0.0125], GOLD), part(coin, [0.165, 0.055, 0.0375], GOLD),
            part(coin, [0.05, -0.15, 0.05], GOLD, [1.2, 0, 0.3]),
        ]);
    }
    if (kind === 2) {
        // an urn: foot, belly, neck, lip, two handles
        return merge([
            part(primitives.cylinder(0.11, 0.13, 0.06, 16), [0, 0, 0.03], TEAL),
            part(primitives.sphere(0.2, 16, 12), [0, 0, 0.24], TEAL, null, [1, 1, 1.15]),
            part(primitives.cylinder(0.09, 0.08, 0.16, 16), [0, 0, 0.47], TEAL),
            part(primitives.cylinder(0.12, 0.12, 0.035, 16), [0, 0, 0.56], [0.85, 0.72, 0.35, 1]),
            part(primitives.torus(0.07, 0.018, 8, 14), [0.17, 0, 0.42], [0.85, 0.72, 0.35, 1], [PI / 2, 0, 0]),
            part(primitives.torus(0.07, 0.018, 8, 14), [-0.17, 0, 0.42], [0.85, 0.72, 0.35, 1], [PI / 2, 0, 0]),
            part(primitives.cylinder(0.205, 0.205, 0.03, 16), [0, 0, 0.26], [0.85, 0.72, 0.35, 1]),
        ]);
    }
    // the idol: a plinth, a squat body, a big head with a crown and glowing eyes
    return merge([
        part(primitives.box(0.42, 0.42, 0.1), [0, 0, 0.05], [0.45, 0.3, 0.35, 1]),
        part(primitives.cylinder(0.17, 0.22, 0.34, 10), [0, 0, 0.27], MAGENTA),
        part(primitives.sphere(0.2, 14, 10), [0, 0, 0.56], MAGENTA, null, [1.05, 0.95, 1]),
        part(primitives.cone(0.07, 0.16, 6), [0, 0, 0.78], GOLD), part(primitives.cone(0.05, 0.12, 6), [0.11, 0, 0.74], GOLD), part(primitives.cone(0.05, 0.12, 6), [-0.11, 0, 0.74], GOLD),
        part(primitives.sphere(0.035, 8, 6), [0.07, 0.175, 0.58], GLOW), part(primitives.sphere(0.035, 8, 6), [-0.07, 0.175, 0.58], GLOW),
        part(primitives.box(0.26, 0.08, 0.08), [0, 0.13, 0.28], GOLD),
    ]);
}

/** A palm: a curved, ringed trunk and a crown of drooping fronds. `seed` varies the lean and height. */
export function palmParts(x, y, z, seed) {
    const rnd = (k) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
    const parts = [], height = 5.5 + rnd(1) * 3, lean = 0.15 + rnd(2) * 0.35, dir = rnd(3) * PI * 2;
    const segs = 8, trunk = [0.45, 0.33, 0.2, 1], ring = [0.38, 0.28, 0.17, 1];
    let px = x, py = y, pz = z;
    for (let i = 0; i < segs; i++) {
        const t = i / segs, bend = lean * t * t * 2.2;
        const nx = x + Math.cos(dir) * bend * height * 0.5, ny = y + Math.sin(dir) * bend * height * 0.5, nz = z + (i + 1) * (height / segs);
        const r = 0.2 - t * 0.07;
        const cx = (px + nx) / 2, cy = (py + ny) / 2, cz = (pz + nz) / 2, len = Math.hypot(nx - px, ny - py, nz - pz);
        const tilt = Math.atan2(Math.hypot(nx - px, ny - py), nz - pz);
        parts.push(part(primitives.cylinder(r * 0.9, r, len * 1.05, 8), [cx, cy, cz], i % 2 ? trunk : ring, [Math.sin(dir) * -tilt, Math.cos(dir) * tilt, 0]));
        px = nx; py = ny; pz = nz;
    }
    // fronds: long flattened, drooping leaves
    const leaf = [0.25, 0.5, 0.18, 1], leaf2 = [0.32, 0.58, 0.2, 1];
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * PI * 2 + rnd(4 + k) * 0.4, droop = 0.45 + rnd(10 + k) * 0.35, L = 2.4 + rnd(20 + k) * 0.8;
        const ex = px + Math.cos(a) * L * 0.5 * Math.cos(droop), ey = py + Math.sin(a) * L * 0.5 * Math.cos(droop), ez = pz - Math.sin(droop) * L * 0.35;
        parts.push(part(primitives.box(L, 0.55, 0.04), [ex, ey, ez], k % 2 ? leaf : leaf2, [0, droop, a], null));
    }
    parts.push(part(primitives.sphere(0.22, 8, 6), [px, py, pz - 0.15], [0.45, 0.3, 0.12, 1]));
    return parts;
}

/** A rough rock: a squashed sphere pushed in and out by a hash, flat-ish on the bottom. */
export function rockGeometry(seed, size = 1, color = [0.52, 0.48, 0.44, 1]) {
    const g = primitives.sphere(1, 10, 7), p = g.positions;
    for (let i = 0; i < p.length; i += 3) {
        const h = Math.sin((p[i] * 3.1 + p[i + 1] * 5.7 + p[i + 2] * 2.3 + seed) * 12.9898) * 43758.5453;
        const k = 0.78 + (h - Math.floor(h)) * 0.4;
        p[i] *= k * size * 1.2; p[i + 1] *= k * size; p[i + 2] *= k * size * (p[i + 2] < 0 ? 0.35 : 0.7);
    }
    return { geometry: g, color };
}

/** The camp: a tent, a chest, a flagpole with a team flag, a fire ring, crates. Around (0, 0), facing +x (the sea). */
export function campParts(cx, cy, cz, facing, teamColor) {
    const parts = [], c = Math.cos(facing), s = Math.sin(facing);
    const at = (fx, fy, fz) => [cx + fx * c - fy * s, cy + fx * s + fy * c, cz + fz];
    const tc = [...teamColor, 1];
    // tent: a pyramid of canvas in the team colour, a dark doorway, guy ropes as thin boxes
    // (off to the side, so it is never between the camera and a player standing at the chest)
    parts.push(part(primitives.cone(1.8, 2.3, 4), at(0.4, 5.8, 1.15), tc, [0, 0, facing + PI / 4]));
    parts.push(part(primitives.box(0.8, 0.05, 1.05), at(0.4, 4.52, 0.52), [0.12, 0.09, 0.08, 1], [0, 0, facing]));
    // chest: a wooden body, a curved lid, iron bands and a gold lock
    const wood = [0.5, 0.32, 0.17, 0.6], iron = [0.25, 0.25, 0.27, 1];
    parts.push(part(primitives.box(1.5, 0.9, 0.6), at(0, 0, 0.3), wood, [0, 0, facing]));
    parts.push(part(primitives.cylinder(0.45, 0.45, 1.5, 12), at(0, 0, 0.6), wood, [0, PI / 2, facing], [1, 1, 1]));
    for (const off of [-0.55, 0.55]) parts.push(part(primitives.box(0.08, 0.95, 0.65), at(off, 0, 0.33), iron, [0, 0, facing]));
    parts.push(part(primitives.box(0.16, 0.06, 0.2), at(0.0, 0.48, 0.55), [1, 0.8, 0.3, 1], [0, 0, facing]));
    // flagpole and flag (tall: a landmark from across the island)
    parts.push(part(primitives.cylinder(0.08, 0.1, 9, 8), at(2.6, -2.2, 4.5), [0.4, 0.3, 0.2, 0.6]));
    parts.push(part(primitives.box(0.05, 2.0, 1.25), at(2.6, -1.15, 8.2), tc, [0, 0, facing]));
    parts.push(part(primitives.sphere(0.15, 8, 6), at(2.6, -2.2, 9.05), [1, 0.85, 0.35, 1]));
    // fire ring and logs
    for (let k = 0; k < 8; k++) { const a = (k / 8) * PI * 2; parts.push(part(primitives.sphere(0.16, 6, 5), at(-1.8 + Math.cos(a) * 0.6, -2.4 + Math.sin(a) * 0.6, 0.08), [0.45, 0.43, 0.42, 1])); }
    parts.push(part(primitives.cylinder(0.08, 0.08, 0.9, 6), at(-1.8, -2.4, 0.15), [0.35, 0.22, 0.12, 0.6], [PI / 2, 0, 0.5]));
    parts.push(part(primitives.cylinder(0.08, 0.08, 0.9, 6), at(-1.8, -2.4, 0.2), [0.35, 0.22, 0.12, 0.6], [PI / 2, 0, -0.7]));
    // crates and a barrel
    parts.push(part(primitives.box(0.7, 0.7, 0.7), at(-1.5, 3.2, 0.35), wood, [0, 0, facing + 0.3]));
    parts.push(part(primitives.box(0.55, 0.55, 0.55), at(-1.4, 3.3, 0.97), wood, [0, 0, facing - 0.2]));
    parts.push(part(primitives.cylinder(0.32, 0.32, 0.9, 12), at(1.6, 2.8, 0.45), [0.45, 0.3, 0.16, 0.6]));
    return { parts, fire: at(-1.8, -2.4, 0.5) };
}

/** Sea-floor dressing: a strand of kelp (a few bent blades). */
export function kelpParts(x, y, z, seed, height = 2.2) {
    const parts = [], color = [0.2, 0.38, 0.16, 1];
    for (let k = 0; k < 3; k++) {
        const a = seed * 3.1 + k * 2.1, h = height * (0.6 + 0.4 * ((seed * 7 + k) % 1));
        parts.push(part(primitives.box(0.18, 0.03, h), [x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z + h / 2], color, [0.15 * Math.cos(a), 0.15 * Math.sin(a), a]));
    }
    return parts;
}

/** Scattered rubble around a ruin: tumbled blocks, no collision. */
export function rubbleParts(x, y, z, seed, count = 6) {
    const parts = [];
    for (let k = 0; k < count; k++) {
        const h = Math.sin(seed * 91.7 + k * 13.3) * 43758.5453, r = h - Math.floor(h);
        const a = r * PI * 2 + k, d = 4.5 + r * 3, size = 0.35 + r * 0.5;
        parts.push(part(primitives.box(size * 1.3, size, size * 0.8), [x + Math.cos(a) * d, y + Math.sin(a) * d, z + size * 0.25], [0.6, 0.58, 0.52, 0.25], [r * 0.6, r * 0.4, a]));
    }
    return parts;
}

/** A tuft of beach grass: a few thin blades leaning out. */
export function tuftParts(x, y, z, seed) {
    const parts = [], color = [0.5, 0.62, 0.3, 1];
    for (let k = 0; k < 5; k++) {
        const a = seed + k * 1.26, h = 0.35 + ((seed * 13 + k * 7) % 10) / 30;
        parts.push(part(primitives.box(0.05, 0.02, h), [x + Math.cos(a) * 0.06, y + Math.sin(a) * 0.06, z + h / 2], k % 2 ? color : [0.62, 0.66, 0.36, 1], [0.35 * Math.cos(a), 0.35 * Math.sin(a), a]));
    }
    return parts;
}

/** A bleached driftwood log with a stub of a branch. */
export function driftwoodParts(x, y, z, seed) {
    const a = seed * 2.7, L = 1.4 + (seed % 1.3);
    return [
        part(primitives.cylinder(0.11, 0.14, L, 7), [x, y, z + 0.08], [0.78, 0.72, 0.62, 1], [Math.PI / 2, 0, a]),
        part(primitives.cylinder(0.04, 0.06, 0.5, 5), [x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, z + 0.22], [0.74, 0.68, 0.58, 1], [0.7, 0, a + 1.2]),
    ];
}

/** A shell or a starfish on the sea floor. */
export function shellParts(x, y, z, seed) {
    if (seed % 2 < 1) {
        // a starfish: five flattened arms
        const parts = [], c = [0.95, 0.45, 0.3, 1];
        for (let k = 0; k < 5; k++) { const a = seed + (k / 5) * Math.PI * 2; parts.push(part(primitives.box(0.22, 0.06, 0.03), [x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, z + 0.02], c, [0, 0, a])); }
        return parts;
    }
    return [part(primitives.sphere(0.09, 8, 5), [x, y, z + 0.03], [0.96, 0.88, 0.8, 1], null, [1.2, 1, 0.5])];
}

export { part, merge };
