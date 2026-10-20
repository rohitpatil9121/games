/**
 * Builds TIDEFALL's skinned character and writes it to assets/models/raider.glb.
 *
 *   npm run models
 *
 * Generated from code with tools/modelkit.mjs (copied from Night Market and BREACH): no downloaded art.
 * Authored Z-up with +Y forward, 1 unit = 1 metre, 1.8 m tall to match the player's collision box.
 * The pattern (skeleton, palette slots, clips as functions of time) follows BREACH's trooper.
 *
 * The raider is a beachcomber: a short-sleeved shirt in the team's colour, rolled shorts, bare arms and
 * shins, sandals, a wide sun hat, a scarf, and a satchel on the hip with the grapple coiled on it.
 * Palette slots (one mesh and one material shared by everyone; the game sets each player's colours):
 *   0 shirt and hat band (team colour)   1 skin   2 shorts   3 hat straw   4 leather (satchel, sandals, belt)
 *   5 rope
 *
 * Clips: idle, run, walk, swim, tread (still in water), jump, fall, shove, hook, stagger, wade.
 */
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { Builder, loft, sphere, box, roundedBox, cylinder, torus, pal, skeleton, clip, writeGLB } from "./modelkit.mjs";

const OUT = fileURLToPath(new URL("../assets/models/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const sin = Math.sin, cos = Math.cos, PI = Math.PI, TAU = PI * 2;
const SHIRT = 0, SKIN = 1, SHORTS = 2, STRAW = 3, LEATHER = 4, ROPE = 5;

const J = skeleton([
    { name: "hips", parent: null, at: [0, 0, 0.9] },
    { name: "spine", parent: "hips", at: [0, 0, 1.04] },
    { name: "chest", parent: "spine", at: [0, 0, 1.22] },
    { name: "head", parent: "chest", at: [0, 0, 1.47] },
    { name: "armL", parent: "chest", at: [-0.22, 0, 1.4] },
    { name: "foreL", parent: "armL", at: [-0.24, 0, 1.13] },
    { name: "handL", parent: "foreL", at: [-0.25, 0, 0.89] },
    { name: "armR", parent: "chest", at: [0.22, 0, 1.4] },
    { name: "foreR", parent: "armR", at: [0.24, 0, 1.13] },
    { name: "handR", parent: "foreR", at: [0.25, 0, 0.89] },
    { name: "thighL", parent: "hips", at: [-0.1, 0, 0.88] },
    { name: "shinL", parent: "thighL", at: [-0.1, 0, 0.48] },
    { name: "footL", parent: "shinL", at: [-0.1, 0, 0.09] },
    { name: "thighR", parent: "hips", at: [0.1, 0, 0.88] },
    { name: "shinR", parent: "thighR", at: [0.1, 0, 0.48] },
    { name: "footR", parent: "shinR", at: [0.1, 0, 0.09] },
]);
const j = (name) => J.index(name);
const band = (a, b, z0, half) => (p) => { const t = Math.max(0, Math.min(1, (z0 + half - p[2]) / (2 * half))); return [[a, 1 - t], [b, t]]; };

function raider() {
    const body = new Builder("body");
    const torsoSkin = (p) => (p[2] < 1.0 ? band(j("spine"), j("hips"), 0.97, 0.07)(p) : p[2] < 1.16 ? [[j("spine"), 1]] : band(j("chest"), j("spine"), 1.2, 0.06)(p));

    // shirt from the waist to the collar, loose at the hem
    const shirt = [[0.17, 0.12, 0.86], [0.185, 0.13, 0.92], [0.18, 0.125, 1.02], [0.19, 0.13, 1.16], [0.215, 0.14, 1.33], [0.18, 0.12, 1.42], [0.09, 0.075, 1.47], [0, 0, 1.48]];
    body.add(loft(shirt.map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(SHIRT), skin: torsoSkin });
    // a placket of buttons and a pocket: trim that reads at a distance
    body.add(box(0.03, 0.02, 0.5), { at: [0, 0.13, 1.15], color: pal(STRAW), skin: torsoSkin });
    body.add(roundedBox(0.09, 0.02, 0.09, 0.015), { at: [0.09, 0.135, 1.3], color: pal(SHORTS), skin: j("chest") });
    // belt and shorts
    body.add(loft([[0.175, 0.125, 0.84], [0.18, 0.13, 0.88]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(LEATHER), skin: j("hips") });
    body.add(loft([[0.17, 0.12, 0.62], [0.18, 0.125, 0.72], [0.175, 0.125, 0.84]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(SHORTS), skin: j("hips") });
    // scarf
    body.add(torus(0.1, 0.035, 14, 6), { at: [0, 0.01, 1.47], color: pal(SHIRT), skin: j("chest") });
    // the satchel on the right hip, strap across the chest, the grapple's rope coiled on it
    body.add(roundedBox(0.09, 0.22, 0.2, 0.03), { at: [0.22, -0.02, 0.86], color: pal(LEATHER), skin: j("hips") });
    body.add(box(0.03, 0.03, 0.62), { at: [0.02, 0.12, 1.15], rot: [0, 0.62, 0], color: pal(LEATHER), skin: torsoSkin });
    body.add(box(0.03, 0.03, 0.62), { at: [0.02, -0.12, 1.15], rot: [0, 0.62, 0], color: pal(LEATHER), skin: torsoSkin });
    body.add(torus(0.075, 0.022, 14, 6), { at: [0.27, -0.02, 0.88], rot: [0, PI / 2, 0], color: pal(ROPE), skin: j("hips") });
    body.add(cylinder(0.02, 0.03, 0.1, 6), { at: [0.27, 0.08, 0.98], color: pal(LEATHER), skin: j("hips") });

    // head: neck, face, nose, ears, then the hat
    body.add(cylinder(0.055, 0.06, 0.08, 10), { at: [0, 0, 1.49], color: pal(SKIN), skin: band(j("head"), j("chest"), 1.49, 0.03) });
    body.add(sphere(1, 16, 12), { at: [0, 0.01, 1.62], scale: [0.105, 0.115, 0.13], color: pal(SKIN), skin: j("head") });
    body.add(roundedBox(0.03, 0.04, 0.05, 0.012), { at: [0, 0.125, 1.61], color: pal(SKIN), skin: j("head") });
    for (const s of [-1, 1]) body.add(sphere(1, 6, 5), { at: [s * 0.105, 0, 1.62], scale: [0.02, 0.03, 0.035], color: pal(SKIN), skin: j("head") });
    // the hat: a wide straw brim, a crown and a band in the team colour (the silhouette is the team's flag too)
    body.add(cylinder(0.26, 0.24, 0.025, 20), { at: [0, 0, 1.71], color: pal(STRAW), skin: j("head") });
    body.add(cylinder(0.12, 0.1, 0.11, 16), { at: [0, 0, 1.78], color: pal(STRAW), skin: j("head") });
    body.add(cylinder(0.123, 0.121, 0.03, 16), { at: [0, 0, 1.74], color: pal(SHIRT), skin: j("head") });

    for (const side of ["L", "R"]) {
        const s = side === "L" ? -1 : 1, arm = j("arm" + side), fore = j("fore" + side), hand = j("hand" + side);
        // short sleeve, bare forearm, hand
        body.add(loft([[0.075, 1.16], [0.078, 1.28], [0.07, 1.38], [0, 1.42]].map(([r, z]) => ({ c: [s * (0.22 + (1.4 - z) * 0.07), 0, z], rx: r })), 10), { color: pal(SHIRT), skin: arm });
        body.add(loft([[0, 0.84], [0.04, 0.86], [0.045, 0.92], [0.05, 1.08], [0.055, 1.18]].map(([r, z]) => ({ c: [s * (0.24 + (1.13 - z) * 0.04), 0, z], rx: r })), 10), {
            color: pal(SKIN), skin: (p) => (p[2] > 1.13 ? band(arm, fore, 1.14, 0.04)(p) : band(fore, hand, 0.9, 0.03)(p)),
        });
        body.add(roundedBox(0.07, 0.09, 0.1, 0.03), { at: [s * 0.25, 0.005, 0.83], color: pal(SKIN), skin: hand });
        // legs: shorts leg, bare knee and shin, sandal
        const thigh = j("thigh" + side), shin = j("shin" + side), foot = j("foot" + side), lx = s * 0.1;
        body.add(loft([[0.095, 0.5], [0.098, 0.62], [0.1, 0.75]].map(([r, z]) => ({ c: [lx, 0, z], rx: r })), 12), { color: pal(SHORTS), skin: thigh });
        body.add(loft([[0, 0.07], [0.045, 0.09], [0.05, 0.2], [0.06, 0.36], [0.065, 0.48], [0.07, 0.52]].map(([r, z]) => ({ c: [lx, 0, z], rx: r })), 10), {
            color: pal(SKIN), skin: (p) => (p[2] > 0.48 ? band(thigh, shin, 0.5, 0.04)(p) : [[shin, 1]]),
        });
        body.add(roundedBox(0.1, 0.24, 0.035, 0.012), { at: [lx, 0.05, 0.02], color: pal(LEATHER), skin: foot });
        body.add(roundedBox(0.08, 0.17, 0.05, 0.02), { at: [lx, 0.05, 0.055], color: pal(SKIN), skin: foot });
        body.add(box(0.105, 0.02, 0.025), { at: [lx, 0.09, 0.07], color: pal(LEATHER), skin: foot });
    }
    return { meshes: [body], skeleton: J, clips: clips() };
}

function clips() {
    // limbs hang down: +rx swings them forward; spine/chest/head point up: −rx leans them forward
    const arms = (swing) => ({ armL: [-swing, 0, -0.12], armR: [swing, 0, 0.12], foreL: [Math.max(0, swing) * 0.6 + 0.25, 0, 0], foreR: [Math.max(0, -swing) * 0.6 + 0.25, 0, 0] });
    const legs = (amp, lean, armAmp) => (u) => {
        const a = u * TAU, s = sin(a);
        return {
            thighL: [s * amp, 0, 0], thighR: [-s * amp, 0, 0],
            shinL: [-Math.max(0, cos(a - 0.6)) * amp * 1.7, 0, 0], shinR: [-Math.max(0, -cos(a - 0.6)) * amp * 1.7, 0, 0],
            footL: [Math.max(0, cos(a - 0.6)) * 0.3, 0, 0], footR: [Math.max(0, -cos(a - 0.6)) * 0.3, 0, 0],
            hips: [0, 0, -s * 0.08], spine: [lean, 0, s * 0.07], chest: [lean * 0.4, 0, s * 0.05], head: [-lean * 0.8, 0, -s * 0.04],
            ...arms(s * armAmp),
            move: { hips: [0, 0, Math.abs(cos(a)) * 0.045 - 0.025] },
        };
    };
    return [
        clip("idle", 3.2, (u) => { const s = sin(u * TAU); return { ...arms(s * 0.03), spine: [-0.03 + s * 0.015, 0, 0], head: [0, 0, sin(u * TAU * 0.5) * 0.15], thighL: [0.04, 0.05, 0], thighR: [-0.04, -0.05, 0] }; }),
        clip("walk", 0.9, legs(0.45, -0.05, 0.35)),
        clip("run", 0.58, legs(0.8, -0.2, 0.9)),
        // waist-deep: short, high steps, arms out for balance
        clip("wade", 1.1, (u) => { const p = legs(0.5, -0.12, 0.2)(u); p.armL = [0.2, 0, -0.7]; p.armR = [0.2, 0, 0.7]; return p; }),
        // swimming: the body tips forward flat, a breaststroke, a frog kick
        clip("swim", 1.1, (u) => {
            const a = u * TAU, s = sin(a), c = cos(a);
            return {
                hips: [-1.25, 0, 0], spine: [-0.1, 0, 0], head: [1.2, 0, 0],
                armL: [2.6 + c * 0.35, 0, -0.5 - s * 0.6], armR: [2.6 + c * 0.35, 0, 0.5 + s * 0.6], foreL: [0.4 - s * 0.4, 0, 0], foreR: [0.4 - s * 0.4, 0, 0],
                thighL: [0.3 + s * 0.3, 0.25 + c * 0.2, 0], thighR: [0.3 + s * 0.3, -0.25 - c * 0.2, 0], shinL: [-0.8 - s * 0.6, 0, 0], shinR: [-0.8 - s * 0.6, 0, 0],
                move: { hips: [0, 0, 0.55] },
            };
        }),
        clip("tread", 1.6, (u) => {
            const s = sin(u * TAU);
            return { armL: [0.4, 0, -1.1 + s * 0.3], armR: [0.4, 0, 1.1 - s * 0.3], foreL: [0.6, 0, 0], foreR: [0.6, 0, 0], thighL: [0.3 + s * 0.3, 0, 0], thighR: [0.3 - s * 0.3, 0, 0], shinL: [-0.6, 0, 0], shinR: [-0.6, 0, 0], head: [0.15, 0, 0] };
        }),
        clip("jump", 1, () => ({ armL: [0.9, 0, -0.5], armR: [0.9, 0, 0.5], foreL: [0.5, 0, 0], foreR: [0.5, 0, 0], thighL: [0.8, 0.06, 0], thighR: [0.2, -0.06, 0], shinL: [-1.3, 0, 0], shinR: [-0.6, 0, 0], spine: [-0.1, 0, 0] })),
        clip("fall", 0.6, (u) => { const s = sin(u * TAU); return { armL: [0.4, 0, -1.4 + s * 0.2], armR: [0.4, 0, 1.4 - s * 0.2], thighL: [0.4, 0, 0], thighR: [0.1, 0, 0], shinL: [-0.7, 0, 0], shinR: [-0.4, 0, 0], head: [0.2, 0, 0] }; }),
        // the shove: wind-up (lean back, hands to the chest), the push (both arms straight out), recovery
        clip("shove", 0.45, (u) => {
            const wind = Math.max(0, 1 - u / 0.3), push = u < 0.3 ? 0 : Math.max(0, 1 - Math.abs(u - 0.45) / 0.25), hold = 1 - wind;
            return {
                spine: [0.15 * wind - 0.35 * push, 0, 0], chest: [-0.15 * push, 0, 0],
                armL: [0.6 * wind + 1.5 * push * hold, 0, -0.1], armR: [0.6 * wind + 1.5 * push * hold, 0, 0.1], foreL: [1.6 * wind + 0.1, 0, 0], foreR: [1.6 * wind + 0.1, 0, 0],
                thighL: [0.5 * push, 0, 0], thighR: [-0.35 * push, 0, 0], shinL: [-0.3 * push, 0, 0],
            };
        }, 30, false),
        // the grapple: right arm thrown up and forward, held while the rope pulls
        clip("hook", 1, () => ({ armR: [2.5, 0, 0.1], foreR: [0.1, 0, 0], armL: [0.6, 0, -0.6], foreL: [0.9, 0, 0], thighL: [0.5, 0, 0], thighR: [0.1, 0, 0], shinL: [-0.9, 0, 0], shinR: [-0.3, 0, 0], spine: [-0.15, 0, 0] })),
        // knocked off balance: arms windmilling, leaning back
        clip("stagger", 0.5, (u) => { const s = sin(u * TAU * 2); return { spine: [0.35, 0, s * 0.1], head: [0.3, 0, 0], armL: [1.2 + s * 0.8, 0, -0.9], armR: [1.2 - s * 0.8, 0, 0.9], thighL: [0.4, 0, 0], shinL: [-0.5, 0, 0], thighR: [-0.2, 0, 0] }; }),
    ];
}

const r = writeGLB(OUT + "raider.glb", raider());
console.log(`${r.path.split(/[\\/]/).pop()}: ${r.meshes} mesh, ${r.triangles} triangles, ${(r.bytes / 1024).toFixed(0)} KB`);
