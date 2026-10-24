/**
 * Builds every 3D model in the game and writes them to assets/models/*.glb.
 *
 *   npm run models
 *
 * The structures and the people are generated from code (tools/modelkit.mjs). The food, the cookware and a
 * few props come from two CC0 asset packs by Kenney (assets/packs, read by tools/kenney.mjs) and are baked
 * into the same files, so the game still loads nothing but what this script writes.
 * Authoring space: Z-up, +Y forward, 1 unit ≈ 1 metre. Stalls face −Y (toward the customers).
 *
 * Colours: characters use palette indices (the game gives each person their own skin, shirt, hair…);
 * everything else uses plain RGB. An alpha above 1 marks a vertex as self-lit (lantern, sign, coals):
 * 2 is fully self-lit. The game dims those on a stall that nobody is working.
 */
import { fileURLToPath } from "node:url";
import { Builder, lathe, loft, sphere, cylinder, box, roundedBox, torus, keep, pal, skeleton, clip, writeGLB } from "./modelkit.mjs";
import { packShape } from "./kenney.mjs";

/** Put a model from an asset pack into a builder. `at` is where its base centre goes. */
const kit = (b, name, at, scale = 1, rot = [0, 0, 0], pack = "food-kit") => { const s = packShape(pack, name); b.add(s, { at, scale, rot, color: s.color }); return b; };

const OUT = fileURLToPath(new URL("../assets/models/", import.meta.url));
const report = [];
const save = (name, model) => report.push(writeGLB(OUT + name + ".glb", model));
const sin = Math.sin, cos = Math.cos, PI = Math.PI, TAU = PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const glow = (c, k = 1) => [c[0] * k, c[1] * k, c[2] * k, 2];

// ====================================================================== people
// palette slots (see game/characters.js): 0 skin, 1 shirt, 2 trousers, 3 hair, 4 dark, 5 shoes, 6 accent, 7 white
const SKIN = 0, SHIRT = 1, PANTS = 2, HAIR = 3, DARK = 4, SHOES = 5, ACCENT = 6, WHITE = 7;

const J = skeleton([
    { name: "hips", parent: null, at: [0, 0, 0.74] },
    { name: "spine", parent: "hips", at: [0, 0, 0.9] },
    { name: "chest", parent: "spine", at: [0, 0, 1.08] },
    { name: "head", parent: "chest", at: [0, 0, 1.31] },
    { name: "armL", parent: "chest", at: [-0.255, 0, 1.25] },
    { name: "foreL", parent: "armL", at: [-0.275, 0, 1.01] },
    { name: "handL", parent: "foreL", at: [-0.285, 0, 0.8] },
    { name: "armR", parent: "chest", at: [0.255, 0, 1.25] },
    { name: "foreR", parent: "armR", at: [0.275, 0, 1.01] },
    { name: "handR", parent: "foreR", at: [0.285, 0, 0.8] },
    { name: "thighL", parent: "hips", at: [-0.105, 0, 0.73] },
    { name: "shinL", parent: "thighL", at: [-0.105, 0, 0.41] },
    { name: "footL", parent: "shinL", at: [-0.105, 0, 0.1] },
    { name: "thighR", parent: "hips", at: [0.105, 0, 0.73] },
    { name: "shinR", parent: "thighR", at: [0.105, 0, 0.41] },
    { name: "footR", parent: "shinR", at: [0.105, 0, 0.1] },
    // the face: no clip moves these; the game poses them to give each person an expression
    { name: "eyes", parent: "head", at: [0, 0.205, 1.545] },
    { name: "browL", parent: "head", at: [-0.085, 0.207, 1.61] },
    { name: "browR", parent: "head", at: [0.085, 0.207, 1.61] },
    { name: "mouth", parent: "head", at: [0, 0.222, 1.4625] },
]);
const j = (name) => J.index(name);
/** blend between two joints across a band of height around z0 */
const band = (a, b, z0, half) => (p) => { const t = Math.max(0, Math.min(1, (z0 + half - p[2]) / (2 * half))); return [[a, 1 - t], [b, t]]; };

function person() {
    const body = new Builder("body");

    // torso: one tube from hips to shoulders, trousers below the belt line and shirt above
    const torso = [[0.05, 0.04, 0.6], [0.15, 0.115, 0.645], [0.185, 0.135, 0.74], [0.18, 0.13, 0.82], [0.18, 0.13, 0.82], [0.176, 0.126, 0.92], [0.2, 0.136, 1.08], [0.205, 0.136, 1.21], [0.16, 0.115, 1.285], [0.08, 0.07, 1.33], [0, 0, 1.34]];
    body.add(loft(torso.map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 14), {
        // vertices come ring by ring after the bottom point; the belt line is the doubled ring at z = 0.82
        color: (p, i) => pal(i < 1 + 3 * 14 ? PANTS : SHIRT),
        skin: (p) => (p[2] < 0.86 ? band(j("spine"), j("hips"), 0.82, 0.07)(p) : p[2] < 1.02 ? [[j("spine"), 1]] : band(j("chest"), j("spine"), 1.06, 0.06)(p)),
    });
    // neck and head
    body.add(loft([{ c: [0, 0, 1.28], rx: 0.07 }, { c: [0, 0, 1.38], rx: 0.065 }], 10), { color: pal(SKIN), skin: band(j("head"), j("chest"), 1.31, 0.03) });
    body.add(sphere(1, 16, 12), { at: [0, 0.005, 1.535], scale: [0.235, 0.225, 0.235], color: pal(SKIN), skin: j("head") });
    for (const x of [-0.085, 0.085]) body.add(sphere(1, 8, 6), { at: [x, 0.205, 1.545], scale: [0.03, 0.02, 0.043], color: pal(DARK), skin: j("eyes") });
    for (const side of ["L", "R"]) body.add(roundedBox(0.075, 0.02, 0.017, 0.006), { at: [side === "L" ? -0.085 : 0.085, 0.207, 1.61], color: pal(HAIR), skin: j("brow" + side) });
    // the mouth is the lower half of a ring: a smile. Turned over it is a frown, squashed flat it is a straight line
    body.add(keep(torus(0.045, 0.009, 14, 5), (x, y) => y < 0.004), { at: [0, 0.222, 1.485], rot: [PI / 2, 0, 0], color: pal(DARK), skin: j("mouth") });
    for (const x of [-0.232, 0.232]) body.add(sphere(1, 8, 6), { at: [x, 0, 1.53], scale: [0.03, 0.045, 0.055], color: pal(SKIN), skin: j("head") });      // ears

    // arms: sleeve to just above the elbow, then skin; the elbow and wrist bands follow two joints each
    for (const side of ["L", "R"]) {
        const s = side === "L" ? -1 : 1, arm = j("arm" + side), fore = j("fore" + side), hand = j("hand" + side);
        const x = (z) => s * mix(0.285, 0.255, Math.max(0, Math.min(1, (z - 0.8) / 0.45)));
        const rings = [[0, 1.32], [0.062, 1.3], [0.078, 1.24], [0.07, 1.1], [0.07, 1.1], [0.06, 1.01], [0.052, 0.86], [0.046, 0.82], [0, 0.8]];
        body.add(loft(rings.slice().reverse().map(([r, z]) => ({ c: [x(z), 0, z], rx: r })), 10), {
            color: (p, i) => pal(i < 1 + 4 * 10 ? SKIN : SHIRT),       // the sleeve ends at the doubled ring
            skin: (p) => (p[2] > 1.08 ? [[arm, 1]] : p[2] > 0.9 ? band(arm, fore, 1.01, 0.06)(p) : band(fore, hand, 0.82, 0.03)(p)),
        });
        body.add(sphere(0.064, 10, 7), { at: [s * 0.285, 0.005, 0.775], scale: [0.95, 1, 1.1], color: pal(SKIN), skin: hand });
        // legs and shoes
        const thigh = j("thigh" + side), shin = j("shin" + side), foot = j("foot" + side), lx = s * 0.105;
        body.add(loft([[0, 0.07], [0.062, 0.09], [0.07, 0.14], [0.08, 0.41], [0.098, 0.68], [0.06, 0.76]].map(([r, z]) => ({ c: [lx, 0, z], rx: r })), 10), {
            color: pal(PANTS), skin: (p) => (p[2] > 0.5 ? [[thigh, 1]] : p[2] > 0.3 ? band(thigh, shin, 0.41, 0.07)(p) : [[shin, 1]]),
        });
        body.add(roundedBox(0.15, 0.27, 0.115, 0.05), { at: [lx, 0.045, 0.058], color: pal(SHOES), skin: foot });
    }

    // hair: shells a little larger than the head, with the hairline high at the front and low at the back
    const head = [0, 0.005, 1.535], shell = (test) => keep(sphere(1, 16, 12), test);
    const hairAt = { at: head, scale: [0.252, 0.243, 0.25], color: pal(HAIR), skin: j("head") };
    const cap = (x, y, z) => z > 0.28 - Math.max(0, -y) * 0.75;
    const hair0 = new Builder("hair0").add(shell(cap), hairAt);
    const hair1 = new Builder("hair1").add(shell(cap), hairAt)
        .add(sphere(1, 10, 6), { at: [0, 0.165, 1.685], scale: [0.2, 0.09, 0.075], color: pal(HAIR), skin: j("head") });
    const hair2 = new Builder("hair2").add(shell((x, y, z) => z > 0.3 - Math.max(0, -y + 0.1) * 1.6), hairAt)
        .add(loft([{ c: [0, -0.13, 1.2], rx: 0.14, ry: 0.07 }, { c: [0, -0.15, 1.4], rx: 0.2, ry: 0.1 }, { c: [0, -0.12, 1.55], rx: 0.21, ry: 0.12 }], 10), { color: pal(HAIR), skin: band(j("head"), j("chest"), 1.3, 0.06) });
    const hair3 = new Builder("hair3").add(shell(cap), hairAt)
        .add(sphere(0.095, 10, 7), { at: [0, -0.06, 1.815], color: pal(HAIR), skin: j("head") });

    // props: each is a separate mesh on the same skeleton; the game merges the ones a character wears
    const apron = new Builder("apron");
    apron.add(keep(loft([[0.19, 0.14, 0.7], [0.19, 0.14, 0.9], [0.212, 0.146, 1.08], [0.212, 0.146, 1.2]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), (x, y) => y > 0.035), {
        color: pal(WHITE), skin: (p) => (p[2] < 0.86 ? band(j("spine"), j("hips"), 0.82, 0.07)(p) : p[2] < 1.02 ? [[j("spine"), 1]] : band(j("chest"), j("spine"), 1.06, 0.06)(p)),
    });
    apron.add(loft([{ c: [0, 0.005, 1.6], rx: 0.243, ry: 0.233 }, { c: [0, 0.005, 1.665], rx: 0.228, ry: 0.218 }], 16), { color: pal(ACCENT), skin: j("head") });   // headband
    const backpack = new Builder("backpack").add(roundedBox(0.32, 0.17, 0.4, 0.06), { at: [0, -0.2, 1.08], color: pal(ACCENT), skin: j("chest") })
        .add(roundedBox(0.2, 0.05, 0.14, 0.02), { at: [0, -0.29, 1.0], color: pal(DARK), skin: j("chest") });
    const tophat = new Builder("tophat").add(cylinder(0.3, 0.3, 0.035, 16), { at: [0, 0, 1.7], color: pal(DARK), skin: j("head") })
        .add(cylinder(0.175, 0.19, 0.28, 16), { at: [0, 0, 1.72], color: pal(DARK), skin: j("head") })
        .add(cylinder(0.182, 0.184, 0.06, 16), { at: [0, 0, 1.735], color: pal(ACCENT), skin: j("head") });
    const shades = new Builder("shades").add(roundedBox(0.37, 0.045, 0.085, 0.02), { at: [0, 0.2, 1.545], color: pal(DARK), skin: j("head") });
    const nursecap = new Builder("cap").add(cylinder(0.2, 0.17, 0.1, 14), { at: [0, 0, 1.69], color: pal(WHITE), skin: j("head") })
        .add(box(0.1, 0.02, 0.03), { at: [0, 0.19, 1.74], color: pal(ACCENT), skin: j("head") })
        .add(box(0.03, 0.02, 0.085), { at: [0, 0.19, 1.74], color: pal(ACCENT), skin: j("head") });
    const notebook = new Builder("notebook").add(roundedBox(0.17, 0.035, 0.23, 0.012), { at: [0.285, 0.085, 0.76], rot: [0.2, 0, 0], color: pal(WHITE), skin: j("handR") });

    // a tour guide's pennant on a pole behind the shoulder, so the group can follow it
    const flag = new Builder("flag").add(cylinder(0.011, 0.011, 1.15, 6), { at: [0.13, -0.17, 1.0], color: pal(WHITE), skin: j("chest") })
        .add(box(0.36, 0.012, 0.21), { at: [0.32, -0.17, 2.03], color: pal(ACCENT), skin: j("chest") })
        .add(sphere(0.022, 6, 5), { at: [0.13, -0.17, 2.16], color: pal(WHITE), skin: j("chest") });

    return { meshes: [body, hair0, hair1, hair2, hair3, apron, backpack, tophat, shades, nursecap, notebook, flag], skeleton: J, clips: personClips() };
}

function personClips() {
    // angles in radians. Limbs hang down, so +rx swings them forward. Spine, chest and head point up,
    // so −rx leans them forward. +ry lifts the left arm sideways, −ry the right.
    const walk = (amp, lean, armAmp) => (u) => {
        const a = u * TAU, s = sin(a);
        return {
            thighL: [s * amp, 0, 0], thighR: [-s * amp, 0, 0],
            shinL: [-Math.max(0, cos(a - 0.6)) * amp * 1.5, 0, 0], shinR: [-Math.max(0, -cos(a - 0.6)) * amp * 1.5, 0, 0],
            footL: [Math.max(0, cos(a - 0.6)) * 0.3, 0, 0], footR: [Math.max(0, -cos(a - 0.6)) * 0.3, 0, 0],
            armL: [-s * armAmp, 0.06, 0], armR: [s * armAmp, -0.06, 0],
            foreL: [0.25 + Math.max(0, -s) * 0.35, 0, 0], foreR: [0.25 + Math.max(0, s) * 0.35, 0, 0],
            hips: [0, 0, -s * 0.06], spine: [lean, 0, s * 0.05], chest: [lean * 0.5, 0, s * 0.07], head: [-lean * 0.6, 0, -s * 0.05],
            move: { hips: [0, 0, Math.abs(cos(a)) * 0.03 - 0.015] },
        };
    };
    const counter = { armL: [0.5, 0.1, 0], foreL: [0.75, 0, 0], armR: [0.5, -0.1, 0], foreR: [0.75, 0, 0] };
    const eat = (u) => { const s = sin(u * TAU); return { armR: [0.95, -0.25, 0], foreR: [1.75 + s * 0.4, 0, 0.3], armL: [0.45, 0.1, 0], foreL: [1.1, 0, 0], head: [-0.14 - s * 0.07, 0, 0], chest: [-0.05, 0, 0] }; };
    const drink = (u) => { const s = sin(u * TAU); return { armR: [1.05, -0.2, 0], foreR: [2.0 + s * 0.15, 0, 0.3], armL: [0.05, 0.07, 0], foreL: [0.2, 0, 0], head: [0.12 + s * 0.08, 0, 0] }; };
    // on a stool: hips down, thighs level, shins hanging
    const seated = (pose) => (u) => ({ ...pose(u), thighL: [1.5, 0.08, 0], thighR: [1.5, -0.08, 0], shinL: [-1.5, 0, 0], shinR: [-1.5, 0, 0], spine: [-0.08, 0, 0], move: { hips: [0, 0, -0.3] } });
    return [
        clip("sit_eat", 1, seated(eat)),
        clip("sit_drink", 2.4, seated(drink)),
        clip("idle", 3, (u) => { const s = sin(u * TAU); return { chest: [s * 0.025, 0, 0], armL: [0.03, 0.07 + s * 0.02, 0], armR: [0.03, -0.07 - s * 0.02, 0], foreL: [0.12, 0, 0], foreR: [0.12, 0, 0], head: [0, 0, s * 0.06] }; }),
        clip("walk", 0.9, walk(0.52, -0.04, 0.42)),
        clip("storm", 0.62, (u) => { const p = walk(0.62, -0.22, 0.75)(u); p.foreL = [0.05, 0, 0]; p.foreR = [0.05, 0, 0]; p.head = [-0.05, 0, sin(u * TAU * 2) * 0.16]; return p; }),
        clip("wait", 4, (u) => { const s = sin(u * TAU), q = sin(u * TAU * 2); return { head: [0, 0, s * 0.5], chest: [0, 0, s * 0.08], hips: [0, q * 0.02, 0], armL: [0.04, 0.07, 0], armR: [0.04, -0.07, 0], foreL: [0.15, 0, 0], foreR: [0.15, 0, 0], thighL: [0, -0.03, 0], thighR: [0, 0.03, 0] }; }),
        clip("fidget", 1.2, (u) => { const tap = Math.max(0, sin(u * TAU * 3)); return { head: [0, 0, sin(u * TAU) * 0.65], armL: [0.1, 0.55, 0], foreL: [0.3, -1.35, 0], armR: [0.1, -0.55, 0], foreR: [0.3, 1.35, 0], footR: [tap * 0.45, 0, 0], shinR: [-tap * 0.12, 0, 0], chest: [0.04, 0, 0], move: { hips: [0, 0, tap * 0.006] } }; }),
        clip("reach", 1.5, (u) => { const s = sin(u * TAU); return { spine: [-0.1, 0, 0], armR: [1.25 + s * 0.08, -0.1, 0], foreR: [0.25, 0, 0], armL: [0.1, 0.06, 0], foreL: [0.3, 0, 0], head: [-0.08, 0, 0] }; }),
        clip("eat", 1, eat),
        clip("drink", 2.4, drink),
        clip("cheer", 0.7, (u) => { const b = Math.abs(sin(u * TAU)); return { armL: [2.85, 0.3, 0], armR: [2.85, -0.3, 0], foreL: [0.25 + b * 0.2, 0, 0], foreR: [0.25 + b * 0.2, 0, 0], thighL: [-b * 0.25, 0, 0], thighR: [-b * 0.25, 0, 0], shinL: [-b * 0.5, 0, 0], shinR: [-b * 0.5, 0, 0], head: [0.1, 0, 0], move: { hips: [0, 0, b * 0.14] } }; }),
        clip("serve", 0.55, (u) => { const s = sin(u * TAU); return { spine: [-0.2, 0, 0], chest: [-0.1, 0, s * 0.05], head: [-0.22, 0, 0], armL: [0.85 + s * 0.28, 0.12, 0], foreL: [1.0 + s * 0.35, 0, 0], armR: [0.85 - s * 0.28, -0.12, 0], foreR: [1.0 - s * 0.35, 0, 0] }; }),
        clip("counter", 5, (u) => { const s = sin(u * TAU); return { ...counter, spine: [-0.06, 0, 0], head: [-0.04, 0, s * 0.55], chest: [0, 0, s * 0.1] }; }),
        clip("tired", 3.5, (u) => { const s = sin(u * TAU); return { spine: [-0.3 + s * 0.02, 0, 0], chest: [-0.16, 0, 0], head: [-0.38, 0, s * 0.05], armL: [0.12, 0.04, 0], armR: [0.12, -0.04, 0], foreL: [0.08, 0, 0], foreR: [0.08, 0, 0], move: { hips: [0, 0, -0.03 + s * 0.008] } }; }),
        clip("argue", 0.6, (u) => { const s = sin(u * TAU); return { spine: [-0.16, 0, 0], chest: [-0.06, 0, s * 0.08], head: [-0.05, 0, sin(u * TAU * 2) * 0.14], armR: [2.15 + s * 0.35, -0.2, 0], foreR: [0.7 + s * 0.3, 0, 0], armL: [0.1, 0.55, 0], foreL: [0.3, -1.35, 0] }; }),
        clip("wave", 0.9, (u) => { const s = sin(u * TAU); return { armR: [0.2, -2.55, 0], foreR: [0.2, s * 0.55, 0], armL: [0.04, 0.07, 0], foreL: [0.15, 0, 0], head: [0, 0.06, 0], chest: [0, 0.04, 0] }; }),
        clip("show", 1.1, (u) => { const s = sin(u * TAU), b = Math.abs(s); return { armL: [0.3, 2.0 + s * 0.2, 0], armR: [0.3, -2.0 - s * 0.2, 0], foreL: [0.5, 0, 0], foreR: [0.5, 0, 0], head: [0.08, 0, s * 0.2], chest: [0.06, 0, 0], move: { hips: [0, 0, b * 0.05] } }; }),
        clip("watch", 4, (u) => { const s = sin(u * TAU); return { armR: [1.1, -0.15, 0], foreR: [2.15, 0, 0.35], armL: [0.55, 0.1, 0], foreL: [1.25, -0.5, 0], head: [-0.06, 0, s * 0.2], spine: [-0.05, 0, 0] }; }),
    ];
}

// ====================================================================== Biscuit
const D = skeleton([
    { name: "body", parent: null, at: [0, 0, 0.3] },
    { name: "head", parent: "body", at: [0, 0.27, 0.4] },
    { name: "tail", parent: "body", at: [0, -0.27, 0.4] },
    { name: "legFL", parent: "body", at: [-0.085, 0.19, 0.24] },
    { name: "legFR", parent: "body", at: [0.085, 0.19, 0.24] },
    { name: "legBL", parent: "body", at: [-0.085, -0.19, 0.24] },
    { name: "legBR", parent: "body", at: [0.085, -0.19, 0.24] },
]);
function dog() {
    const d = (name) => D.index(name), fur = [0.86, 0.63, 0.33], dark = [0.5, 0.33, 0.17], b = new Builder("dog");
    b.add(sphere(1, 12, 8), { at: [0, 0, 0.33], scale: [0.13, 0.3, 0.13], color: fur, skin: d("body") });
    b.add(sphere(1, 12, 8), { at: [0, 0.36, 0.47], scale: [0.115, 0.125, 0.11], color: fur, skin: d("head") });
    b.add(sphere(1, 10, 6), { at: [0, 0.47, 0.44], scale: [0.065, 0.085, 0.055], color: [0.95, 0.85, 0.7], skin: d("head") });
    b.add(sphere(0.026, 8, 6), { at: [0, 0.55, 0.455], color: [0.1, 0.08, 0.08], skin: d("head") });
    for (const x of [-0.05, 0.05]) b.add(sphere(0.018, 6, 5), { at: [x, 0.455, 0.505], color: [0.1, 0.08, 0.08], skin: d("head") });
    for (const x of [-0.09, 0.09]) b.add(sphere(1, 8, 6), { at: [x, 0.33, 0.55], scale: [0.04, 0.05, 0.075], rot: [0, x > 0 ? 0.4 : -0.4, 0], color: dark, skin: d("head") });
    b.add(loft([{ c: [0, -0.29, 0.37], rx: 0.035 }, { c: [0, -0.33, 0.48], rx: 0.028 }, { c: [0, -0.34, 0.57], rx: 0 }], 8), { color: dark, skin: d("tail") });
    for (const leg of ["legFL", "legFR", "legBL", "legBR"]) {
        const at = D.joints[d(leg)].at;
        b.add(loft([{ c: [at[0], at[1], 0], rx: 0 }, { c: [at[0], at[1], 0.02], rx: 0.04 }, { c: [at[0], at[1], 0.26], rx: 0.045 }], 8), { color: dark, skin: d(leg) });
    }
    const clips = [
        clip("idle", 1, (u) => ({ tail: [0, sin(u * TAU * 2) * 0.5, 0], head: [sin(u * TAU) * 0.06, 0, 0] })),
        clip("walk", 0.5, (u) => { const s = sin(u * TAU); return { legFL: [s * 0.6, 0, 0], legBR: [s * 0.6, 0, 0], legFR: [-s * 0.6, 0, 0], legBL: [-s * 0.6, 0, 0], tail: [0, sin(u * TAU * 2) * 0.35, 0], head: [s * 0.05, 0, 0], move: { body: [0, 0, Math.abs(s) * 0.015] } }; }),
        clip("sit", 0.8, (u) => ({ body: [0.55, 0, 0], legBL: [-1.25, 0, 0], legBR: [-1.25, 0, 0], legFL: [-0.5, 0, 0], legFR: [-0.5, 0, 0], head: [-0.45, 0, 0], tail: [0.4, sin(u * TAU * 2) * 0.7, 0], move: { body: [0, 0, -0.06] } })),
    ];
    return { meshes: [b], skeleton: D, clips };
}

// ====================================================================== street furniture
const WOOD = [0.72, 0.5, 0.3], WOOD_DARK = [0.45, 0.29, 0.18], WOOD_LIGHT = [0.9, 0.74, 0.5], METAL = [0.3, 0.32, 0.38], CLOTH = [0.96, 0.94, 0.88];
const WARM = [2.4, 1.7, 0.8];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** What sits on each counter. */
const COUNTER = {
    skewers(b) {
        b.add(roundedBox(1.5, 0.52, 0.16, 0.04), { at: [0, 2.25, 1.11], color: [0.16, 0.16, 0.18] });
        b.add(box(1.34, 0.36, 0.03), { at: [0, 2.25, 1.195], color: glow([2.6, 0.75, 0.12]) });
        for (let k = 0; k < 6; k++) kit(b, k % 2 ? "skewer-vegetables" : "skewer", [-0.55 + k * 0.22, 2.25, 1.19], 0.95, [0, 0, PI / 2]);
        kit(b, "plate", [0.98, 2.25, 1.03], 0.8);
        kit(b, "skewer", [0.98, 2.25, 1.05], 0.7, [0, 0, 0.5]);
    },
    dumplings(b) {
        kit(b, "steamer", [-0.68, 2.25, 1.03], 0.95);
        kit(b, "steamer", [0.02, 2.25, 1.03], 0.75, [0, 0, 0.4]);
        kit(b, "dim-sum", [0.72, 2.25, 1.03], 1.7);
    },
    noodles(b) {
        kit(b, "pot-stew", [-0.7, 2.28, 1.03], 1.05);
        for (const [k, x] of [0.12, 0.56, 1.0].entries()) kit(b, k === 1 ? "bowl-soup" : "bowl-broth", [x, 2.2, 1.03], 0.55, [0, 0, k * 2.1]);
    },
    takoyaki(b) {
        // a cast-iron pan of dumpling balls over a strip of flame, and a stack of paper boats
        b.add(roundedBox(1.5, 0.56, 0.12, 0.04), { at: [-0.3, 2.25, 1.09], color: [0.15, 0.15, 0.17] });
        b.add(box(1.4, 0.02, 0.05), { at: [-0.3, 1.965, 1.06], color: glow([2.6, 0.9, 0.2]) });
        for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++)
            b.add(sphere(0.07, 8, 6), { at: [-0.9 + k * 0.2, 2.09 + r * 0.16, 1.165], color: (k + r) % 4 === 0 ? [0.9, 0.72, 0.4] : [0.78, 0.5, 0.22] });
        kit(b, "styrofoam", [0.88, 2.2, 1.03], 0.62, [0, 0, PI / 2]);
        kit(b, "bottle-ketchup", [0.5, 2.44, 1.03], 0.95);
        kit(b, "bottle-musterd", [0.66, 2.44, 1.03], 0.95);
    },
    tea(b) {
        b.add(roundedBox(0.52, 0.44, 0.64, 0.06), { at: [-0.78, 2.3, 1.35], color: [0.92, 0.93, 0.96] });
        b.add(box(0.36, 0.02, 0.3), { at: [-0.78, 2.075, 1.42], color: glow([0.6, 1.5, 2.4]) });
        ["frappe", "soda-glass", "frappe", "cocktail"].forEach((name, k) => kit(b, name, [-0.12 + k * 0.33, 2.2, 1.03], 0.95, [0, 0, k]));
    },
    rival(b) {
        b.add(roundedBox(0.6, 0.45, 0.4, 0.04), { at: [-0.5, 2.25, 1.23], color: [0.3, 0.08, 0.08] });
        b.add(roundedBox(0.5, 0.4, 0.3, 0.04), { at: [0.45, 2.25, 1.18], color: [0.2, 0.2, 0.22] });
        kit(b, "burger", [-0.05, 2.2, 1.03], 0.9);
        kit(b, "fries", [0.95, 2.2, 1.03], 0.9);
    },
};

function stall(type, c) {
    const b = new Builder("body"), dim = shade(c, 0.55);
    b.add(roundedBox(2.8, 2.7, 0.06, 0.03), { at: [0, 3.15, 0.03], color: [mix(0.3, c[0], 0.3), mix(0.3, c[1], 0.3), mix(0.32, c[2], 0.3)] });      // mat
    b.add(roundedBox(2.5, 0.68, 0.96, 0.07), { at: [0, 2.25, 0.48], color: WOOD });                                                               // counter
    b.add(roundedBox(2.68, 0.84, 0.08, 0.035), { at: [0, 2.25, 0.99], color: WOOD_LIGHT });
    b.add(roundedBox(2.2, 0.04, 0.5, 0.02), { at: [0, 1.895, 0.5], color: c });                                                                   // painted front
    for (const x of [-0.8, 0, 0.8]) b.add(roundedBox(0.04, 0.05, 0.46, 0.015), { at: [x, 1.875, 0.5], color: dim });
    for (const x of [-1.29, 1.29]) for (const y of [2.35, 4.3]) b.add(cylinder(0.055, 0.05, 3.0, 10), { at: [x, y, 0], color: WOOD_DARK });         // posts
    b.add(roundedBox(2.64, 0.1, 1.25, 0.03), { at: [0, 4.38, 0.63], color: WOOD });                                                                // back wall, lower
    b.add(roundedBox(2.64, 0.08, 1.7, 0.03), { at: [0, 4.39, 2.1], color: shade(c, 0.34) });                                                       // back wall, upper
    b.add(roundedBox(2.4, 0.3, 0.06, 0.02), { at: [0, 4.2, 1.5], color: WOOD_LIGHT });                                                             // shelf
    ["honey", "bottle-oil", "peanut-butter", "soy", "can"].forEach((name, k) => kit(b, name, [-0.95 + k * 0.47, 4.2, 1.53], 0.95));
    // awning: striped cloth sloping down toward the front, with a scalloped edge
    const slope = 0.16;
    for (let k = 0; k < 7; k++) {
        const x = -1.26 + k * 0.42, col = k % 2 === 0 ? c : CLOTH;
        b.add(roundedBox(0.42, 2.5, 0.07, 0.025), { at: [x, 3.3, 3.2], rot: [slope, 0, 0], color: col });
        b.add(lathe([[0, -0.2], [0.14, -0.16], [0.2, -0.05], [0.21, 0], [0, 0]], 10), { at: [x, 2.05, 2.98], scale: [1, 0.16, 1], color: col });
    }
    b.add(roundedBox(3.0, 0.1, 0.09, 0.03), { at: [0, 2.05, 3.01], color: WOOD_DARK });                                                             // front rail
    // sign board; the game puts the lit face on it
    b.add(roundedBox(2.24, 0.14, 0.88, 0.05), { at: [0, 2.7, 3.8], color: WOOD_DARK });
    for (const x of [-0.95, 0.95]) b.add(cylinder(0.035, 0.035, 0.5, 8), { at: [x, 2.7, 3.1], color: WOOD_DARK });
    // paper lanterns under the front corners
    for (const x of [-1.05, 1.05]) {
        b.add(cylinder(0.008, 0.008, 0.25, 5), { at: [x, 2.08, 2.72], color: METAL });
        b.add(lathe([[0, 0], [0.05, 0], [0.12, 0.07], [0.14, 0.16], [0.12, 0.25], [0.05, 0.32], [0, 0.32]], 12), { at: [x, 2.08, 2.42], color: glow(WARM) });
    }
    COUNTER[type](b);

    const l2 = new Builder("level2");
    for (let k = 0; k < 11; k++) l2.add(sphere(0.05, 8, 5), { at: [-1.3 + k * 0.26, 1.98, 2.78 - sin((k / 10) * PI) * 0.08], color: glow(k % 2 ? WARM : c, k % 2 ? 1 : 2.2) });
    l2.add(roundedBox(2.2, 0.26, 0.05, 0.02), { at: [0, 4.2, 2.0], color: WOOD_LIGHT });
    for (let k = 0; k < 4; k++) l2.add(roundedBox(0.3, 0.2, 0.22, 0.03), { at: [-0.8 + k * 0.53, 4.2, 2.14], color: [[0.9, 0.85, 0.7], shade(c, 0.9), [0.8, 0.7, 0.5], shade(c, 0.7)][k] });
    for (const x of [-1.42, 1.42]) l2.add(lathe([[0, 0], [0.06, 0], [0.15, 0.08], [0.18, 0.2], [0.15, 0.32], [0.06, 0.4], [0, 0.4]], 12), { at: [x, 2.2, 2.4], color: glow(c, 2.2) });

    const l3 = new Builder("level3");
    l3.add(roundedBox(1.36, 0.12, 0.42, 0.05), { at: [0, 2.7, 4.46], color: WOOD_DARK });
    l3.add(box(1.2, 0.02, 0.28), { at: [0, 2.625, 4.46], color: glow([2.4, 2.2, 1.7]) });
    for (const x of [-0.42, 0, 0.42]) l3.add(sphere(1, 5, 4), { at: [x, 2.6, 4.46], scale: [0.09, 0.03, 0.09], color: glow(c, 2.4) });
    for (const x of [-1.2, 1.2]) {
        l3.add(cylinder(0.02, 0.02, 0.9, 6), { at: [x, 2.7, 3.78], color: WOOD_DARK });
        l3.add(roundedBox(0.4, 0.03, 0.26, 0.01), { at: [x + (x > 0 ? 0.2 : -0.2), 2.7, 4.53], color: c });
    }
    return { meshes: [b, l2, l3] };
}

function props() {
    const table = new Builder("table");     // low enough to sit at
    table.add(lathe([[0, 0], [0.28, 0], [0.26, 0.04], [0.06, 0.07], [0.055, 0.6], [0.12, 0.62], [0, 0.62]], 14), { color: METAL });
    table.add(cylinder(0.56, 0.56, 0.06, 22), { at: [0, 0, 0.62], color: WOOD_LIGHT });
    table.add(torus(0.56, 0.03, 22, 6), { at: [0, 0, 0.65], color: WOOD_DARK });
    table.add(lathe([[0, 0], [0.05, 0], [0.045, 0.1], [0, 0.1]], 8), { at: [0, 0, 0.68], color: [0.9, 0.3, 0.25] });
    table.add(sphere(0.03, 6, 4), { at: [0, 0, 0.81], scale: [1, 1, 1.5], color: glow([2.4, 1.6, 0.5]) });

    const stool = new Builder("stool");
    stool.add(lathe([[0, 0.28], [0.17, 0.28], [0.19, 0.31], [0.18, 0.34], [0, 0.345]], 14), { color: [0.86, 0.3, 0.26] });
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; stool.add(cylinder(0.02, 0.016, 0.3, 6), { at: [cos(a) * 0.12, sin(a) * 0.12, 0], color: METAL }); }
    stool.add(torus(0.125, 0.01, 12, 5), { at: [0, 0, 0.12], color: METAL });

    const bollard = new Builder("bollard");
    bollard.add(lathe([[0, 0], [0.13, 0], [0.11, 0.06], [0.08, 0.1], [0.08, 0.74], [0.1, 0.78]], 12), { color: METAL });
    bollard.add(lathe([[0.1, 0.78], [0.11, 0.9], [0.06, 0.98], [0, 0.99]], 12), { color: glow(WARM) });

    const gate = new Builder("gate");       // spans y from −8.35 to 1.75; the opening is along X
    for (const y of [-8.35, 1.75]) {
        gate.add(lathe([[0, 0], [0.26, 0], [0.24, 0.2], [0.16, 0.26], [0.14, 4.2], [0.19, 4.26]], 14), { at: [0, y, 0], color: [0.78, 0.2, 0.18] });
        gate.add(roundedBox(0.5, 0.5, 0.14, 0.04), { at: [0, y, 0.07], color: [0.25, 0.22, 0.24] });
    }
    gate.add(roundedBox(0.3, 10.7, 0.3, 0.06), { at: [0, -3.3, 4.2], color: [0.78, 0.2, 0.18] });
    gate.add(roundedBox(0.46, 11.6, 0.2, 0.07), { at: [0, -3.3, 4.62], color: [0.25, 0.2, 0.24] });
    for (const y of [-8.9, 2.3]) gate.add(roundedBox(0.5, 0.5, 0.26, 0.07), { at: [0, y, 4.7], rot: [y > 0 ? -0.3 : 0.3, 0, 0], color: [0.25, 0.2, 0.24] });
    gate.add(roundedBox(0.18, 2.6, 0.7, 0.05), { at: [0, -3.3, 3.75], color: [0.25, 0.2, 0.24] });
    const gateGlow = new Builder("gate_glow");
    gateGlow.add(box(0.2, 2.3, 0.44), { at: [0, -3.3, 3.75], color: [1, 1, 1, 2] });
    for (let k = 0; k < 6; k++) {
        const y = -7.2 + k * 1.56;
        if (Math.abs(y + 3.3) < 1.5) continue;
        gateGlow.add(cylinder(0.008, 0.008, 0.25, 5), { at: [0, y, 3.8], color: [0.3, 0.3, 0.35, 1] });
        gateGlow.add(lathe([[0, 0], [0.06, 0], [0.15, 0.08], [0.17, 0.19], [0.15, 0.3], [0.06, 0.38], [0, 0.38]], 12), { at: [0, y, 3.42], color: k % 2 ? [1.0, 0.62, 0.3, 2] : [1, 1, 1, 2] });
    }

    const lantern = new Builder("lantern");
    lantern.add(lathe([[0, 0], [0.04, 0], [0.1, 0.06], [0.115, 0.14], [0.1, 0.22], [0.04, 0.28], [0, 0.28]], 10), { at: [0, 0, -0.14], color: [1, 1, 1, 2] });

    const planter = new Builder("planter");
    planter.add(lathe([[0, 0], [0.26, 0], [0.34, 0.42], [0.36, 0.46], [0.3, 0.46], [0.29, 0.4], [0, 0.4]], 14), { color: [0.74, 0.42, 0.3] });
    for (const [x, y, z, r] of [[0, 0, 0.74, 0.3], [0.2, 0.08, 0.6, 0.2], [-0.18, -0.1, 0.62, 0.21], [0.05, -0.18, 0.92, 0.18], [-0.08, 0.16, 0.95, 0.17]])
        planter.add(sphere(r, 9, 6), { at: [x, y, z], color: [0.25 + r * 0.3, 0.62 + r * 0.2, 0.3] });

    const crate = new Builder("crate");
    crate.add(roundedBox(0.6, 0.6, 0.5, 0.03), { at: [0, 0, 0.25], color: WOOD });
    for (const z of [0.1, 0.4]) crate.add(roundedBox(0.64, 0.64, 0.07, 0.02), { at: [0, 0, z], color: WOOD_DARK });

    const barrel = new Builder("barrel");
    barrel.add(lathe([[0, 0], [0.24, 0], [0.3, 0.2], [0.31, 0.4], [0.3, 0.6], [0.24, 0.8], [0, 0.8]], 14), { color: WOOD });
    for (const z of [0.16, 0.64]) barrel.add(torus(0.292, 0.018, 14, 6), { at: [0, 0, z], color: METAL });

    const plot = new Builder("plot");      // corner marks of an empty spot (centred on the stall mat)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        plot.add(roundedBox(0.55, 0.08, 0.03, 0.012), { at: [sx * 1.0, sy * 1.2, 0.02], color: [0.95, 0.9, 0.75] });
        plot.add(roundedBox(0.08, 0.55, 0.03, 0.012), { at: [sx * 1.235, sy * 0.965, 0.02], color: [0.95, 0.9, 0.75] });
    }

    // what a customer carries away
    const skewer = kit(new Builder("food_skewers"), "skewer", [0, 0, 0.08], 0.62, [0, PI / 2, 0]);
    const dumpling = kit(new Builder("food_dumplings"), "dim-sum", [0, 0, -0.03], 0.8);
    const bowl = kit(new Builder("food_noodles"), "bowl-broth", [0, 0, -0.05], 0.4);
    const cup = kit(new Builder("food_tea"), "frappe", [0, 0, -0.1], 0.75);
    const boat = new Builder("food_takoyaki");
    boat.add(roundedBox(0.22, 0.1, 0.03, 0.01), { at: [0, 0, 0], color: [0.93, 0.87, 0.74] });
    for (const x of [-0.065, 0, 0.065]) boat.add(sphere(0.036, 7, 5), { at: [x, 0, 0.04], color: [0.78, 0.5, 0.22] });

    // market displays that stand by the gates
    const fruit = kit(new Builder("display_fruit"), "display-fruit", [0, 0, 0], 1.5, [0, 0, 0], "mini-market");
    const bread = kit(new Builder("display_bread"), "display-bread", [0, 0, 0], 1.5, [0, 0, 0], "mini-market");
    const festoon = new Builder("festoon");     // a paper flag for festival bunting
    festoon.add(box(0.26, 0.012, 0.3), { at: [0, 0, -0.15], color: [1, 1, 1, 1.5] });

    return { meshes: [table, stool, bollard, gate, gateGlow, lantern, planter, crate, barrel, plot, skewer, dumpling, bowl, cup, boat, festoon, fruit, bread] };
}

// ====================================================================== write
save("person", person());
save("dog", dog());
save("stall_skewers", stall("skewers", [1.0, 0.46, 0.16]));
save("stall_dumplings", stall("dumplings", [0.3, 0.82, 0.5]));
save("stall_noodles", stall("noodles", [1.0, 0.28, 0.52]));
save("stall_tea", stall("tea", [0.3, 0.72, 1.0]));
save("stall_takoyaki", stall("takoyaki", [0.68, 0.44, 1.0]));
save("stall_rival", stall("rival", [0.75, 0.1, 0.1]));
save("props", props());

let total = 0;
for (const r of report) { total += r.bytes; console.log(r.path.split(/[\\/]/).pop().padEnd(22), String(r.meshes).padStart(3), "meshes", String(r.triangles).padStart(7), "triangles", (r.bytes / 1024).toFixed(0).padStart(6), "KB"); }
console.log("total".padEnd(22), (total / 1024).toFixed(0).padStart(31), "KB");
