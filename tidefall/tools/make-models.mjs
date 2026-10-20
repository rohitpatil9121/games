/**
 * Builds TIDEFALL's skinned character and writes it to assets/models/raider.glb.
 *
 *   npm run models
 *
 * Generated from code with tools/modelkit.mjs: no downloaded art, no reference image. Authored Z-up with +Y
 * forward, 1 unit = 1 metre, 1.8 m tall to match the player's collision box; the character's left is −X.
 *
 * CONSTRUCTION (the `img2threejs` skill's character guides, without its image pipeline: there is no
 * reference to measure, so proportions come from a stylised canon of about six heads, chosen so a raider
 * reads at the distances this game is played at):
 *   - head height 0.31 m (big head, big eyes, big hands and feet: readable and appealing at 30 m);
 *   - every part sits in one layer of the skill's ontology. The core (shirt, shorts, limbs) is skinned
 *     across joints with banded weights; everything that doesn't cross a joint (eyes, brows, nose, hats,
 *     hair, beard, buckles, the sack, the pennant) is a single-bone part, weight 1 on its bone, so it moves
 *     rigidly and never stretches. Hair is rigidly parented to the head, never skinned across the neck;
 *   - left and right are mirrors (x → −x), never rotations.
 *
 * TEAM READABILITY. From far away a raider is a silhouette and a colour, so the team colour (palette slot 0)
 * is on the largest areas that face every way: the shirt, the scarf, a band round the loot sack and a pennant
 * on a pole above the sack, which stands above the hat line and shows from the back, the front and the side.
 *
 * VARIETY without extra meshes. Hats, hairstyles and the beard each hang from a bone of their own
 * (hatA/B/C, hairA/B/C, beard). The game picks one of each per player and scales the others to zero
 * (game/characters.js), so everyone shares one mesh and one material, and differs in a palette and a few
 * bone scales. The sack hangs from `pack`, which the game scales with what the player carries.
 *
 * FACE. Lids (closed by scale for a blink), brows (lifted), pupils (shrink when scared) and three mouths
 * (a grin, an open smile, an O) are on bones of their own; the game sets the expression (game/characters.js).
 *
 * Palette slots: 0 team · 1 skin · 2 hair · 3 canvas (shorts, sack) · 4 hat · 5 leather and wood
 *   6 eye white · 7 ink (pupils, brows, mouth, the hook's iron)
 *
 * CLIPS (the `disney-animation-rule-skill`): each is a pure function of time, blocked by event poses, with
 * uneven phase timing and overlap rather than one sine for everything:
 *   idle      breathing, a weight shift, the head looking round (secondary, slow)
 *   walk, run contact / down / passing / up; the hips drop just after contact (squash) and rise at passing;
 *             the chest twists against the hips; arms lag the legs a little (overlap); the head counter-bobs
 *   carry     the heavy run: hunched, shorter strides, a longer dwell in the down pose (weight), hands on
 *             the straps
 *   wade      high knees, arms out for balance
 *   swim      a breaststroke with a fast power phase (40%) and a slow glide (60%); the kick lags the arms
 *   tread     still in water, sculling
 *   jump/fall the stretch of take-off and the arms-up reach of a fall
 *   shove     wind-up (lean back, hands to the chest, 35%), the push (fast, 15%, a step in), recovery (50%)
 *   hookThrow wind-up behind the head, a whip forward-up with overshoot, then hold
 *   hook      hanging on the rope, legs trailing
 *   stagger   off balance: arms windmilling out of phase, the head lagging the body
 *   drown     arms reaching up and slowing, sinking
 *   celebrate banking: a crouch (anticipation), a hop with a fist up, a hold at the top, a squash on landing,
 *             a settle
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { Builder, loft, sphere, box, roundedBox, cylinder, torus, pal, skeleton, clip, writeGLB } from "./modelkit.mjs";

const OUT = fileURLToPath(new URL("../assets/models/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const sin = Math.sin, cos = Math.cos, PI = Math.PI, TAU = PI * 2;
const TEAM = 0, SKIN = 1, HAIR = 2, CANVAS = 3, HAT = 4, LEATHER = 5, WHITE = 6, INK = 7;

export const J = skeleton([
    { name: "hips", parent: null, at: [0, 0, 0.9] },
    { name: "spine", parent: "hips", at: [0, 0, 1.03] },
    { name: "chest", parent: "spine", at: [0, 0, 1.2] },
    { name: "head", parent: "chest", at: [0, 0, 1.44] },
    { name: "armL", parent: "chest", at: [-0.2, 0, 1.36] },
    { name: "foreL", parent: "armL", at: [-0.23, 0, 1.11] },
    { name: "handL", parent: "foreL", at: [-0.25, 0, 0.88] },
    { name: "armR", parent: "chest", at: [0.2, 0, 1.36] },
    { name: "foreR", parent: "armR", at: [0.23, 0, 1.11] },
    { name: "handR", parent: "foreR", at: [0.25, 0, 0.88] },
    { name: "thighL", parent: "hips", at: [-0.1, 0, 0.86] },
    { name: "shinL", parent: "thighL", at: [-0.1, 0, 0.47] },
    { name: "footL", parent: "shinL", at: [-0.1, 0, 0.09] },
    { name: "thighR", parent: "hips", at: [0.1, 0, 0.86] },
    { name: "shinR", parent: "thighR", at: [0.1, 0, 0.47] },
    { name: "footR", parent: "shinR", at: [0.1, 0, 0.09] },
    // the loot sack on the back, and the pennant above it
    { name: "pack", parent: "chest", at: [0, -0.17, 1.12] },
    { name: "flag", parent: "chest", at: [0.13, -0.26, 1.36] },
    // variants, each shown or hidden by scale; the ponytail swings from its own root
    { name: "hatA", parent: "head", at: [0, 0, 1.7] },
    { name: "hatB", parent: "head", at: [0, 0, 1.7] },
    { name: "hatC", parent: "head", at: [0, 0, 1.7] },
    { name: "hairA", parent: "head", at: [0, 0, 1.6] },
    { name: "hairB", parent: "head", at: [0, -0.12, 1.66] },
    { name: "hairC", parent: "head", at: [0, 0, 1.6] },
    { name: "beard", parent: "head", at: [0, 0.08, 1.5] },
    // the face: lids that close for a blink, brows that lift, pupils that shrink, and three mouths of which one shows
    { name: "lids", parent: "head", at: [0, 0.13, 1.66] },
    { name: "brows", parent: "head", at: [0, 0.14, 1.69] },
    { name: "pupils", parent: "head", at: [0, 0.146, 1.632] },
    { name: "mouth", parent: "head", at: [0, 0.152, 1.535] },
    { name: "smile", parent: "head", at: [0, 0.152, 1.535] },
    { name: "gasp", parent: "head", at: [0, 0.152, 1.53] },
]);
const j = (name) => J.index(name);
const band = (a, b, z0, half) => (p) => { const t = Math.max(0, Math.min(1, (z0 + half - p[2]) / (2 * half))); return [[a, 1 - t], [b, t]]; };

/** head geometry: centre and half-sizes of the skull (head height 0.31 m) */
const HEAD = { z: 1.6, rx: 0.135, ry: 0.145, rz: 0.158 };

function raider() {
    const body = new Builder("body");
    const torsoSkin = (p) => (p[2] < 0.98 ? band(j("spine"), j("hips"), 0.96, 0.06)(p) : p[2] < 1.14 ? [[j("spine"), 1]] : band(j("chest"), j("spine"), 1.18, 0.05)(p));
    const H = j("head");

    // ---------------- L0 core: shirt, shorts, limbs
    const shirt = [[0.165, 0.12, 0.84], [0.18, 0.13, 0.9], [0.175, 0.125, 1.0], [0.185, 0.13, 1.14], [0.205, 0.14, 1.3], [0.17, 0.12, 1.39], [0.085, 0.075, 1.44], [0, 0, 1.45]];
    body.add(loft(shirt.map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(TEAM), skin: torsoSkin });
    // a pale stripe across the chest and a dark collar: trim that breaks up the big team-coloured mass
    body.add(loft([[0.208, 0.142, 1.2], [0.212, 0.145, 1.24]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(CANVAS), skin: j("chest") });
    body.add(box(0.03, 0.02, 0.42), { at: [0, 0.135, 1.1], color: pal(CANVAS), skin: torsoSkin });
    body.add(loft([[0.17, 0.125, 0.83], [0.175, 0.13, 0.88]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(LEATHER), skin: j("hips") });
    body.add(roundedBox(0.07, 0.03, 0.05, 0.01), { at: [0, 0.13, 0.855], color: pal(HAT), skin: j("hips") });
    body.add(loft([[0.165, 0.12, 0.6], [0.175, 0.125, 0.7], [0.17, 0.125, 0.84]].map(([rx, ry, z]) => ({ c: [0, 0, z], rx, ry })), 16), { color: pal(CANVAS), skin: j("hips") });
    // scarf in the team colour, its knot at the side
    body.add(torus(0.095, 0.04, 14, 6), { at: [0, 0.01, 1.455], color: pal(TEAM), skin: j("chest") });
    body.add(sphere(1, 8, 6), { at: [0.07, 0.07, 1.42], scale: [0.045, 0.035, 0.04], color: pal(TEAM), skin: j("chest") });

    for (const side of ["L", "R"]) {
        const s = side === "L" ? -1 : 1, arm = j("arm" + side), fore = j("fore" + side), hand = j("hand" + side);
        body.add(loft([[0.075, 1.15], [0.078, 1.27], [0.07, 1.37], [0, 1.41]].map(([r, z]) => ({ c: [s * (0.205 + (1.38 - z) * 0.07), 0, z], rx: r })), 10), { color: pal(TEAM), skin: arm });
        body.add(loft([[0, 0.83], [0.045, 0.85], [0.05, 0.91], [0.055, 1.07], [0.058, 1.16]].map(([r, z]) => ({ c: [s * (0.23 + (1.11 - z) * 0.04), 0, z], rx: r })), 10), {
            color: pal(SKIN), skin: (p) => (p[2] > 1.11 ? band(arm, fore, 1.12, 0.04)(p) : band(fore, hand, 0.89, 0.03)(p)),
        });
        // big hands: a palm and a thumb (readable gestures at a distance)
        body.add(roundedBox(0.075, 0.1, 0.11, 0.035), { at: [s * 0.255, 0.01, 0.81], color: pal(SKIN), skin: hand });
        body.add(roundedBox(0.03, 0.04, 0.06, 0.012), { at: [s * 0.225, 0.06, 0.83], rot: [0, s * 0.4, 0], color: pal(SKIN), skin: hand });
        // a leather bracer on the right, the hand that throws the hook
        if (s > 0) body.add(cylinder(0.062, 0.058, 0.09, 10), { at: [0.24, 0, 0.97], color: pal(LEATHER), skin: fore });

        const thigh = j("thigh" + side), shin = j("shin" + side), foot = j("foot" + side), lx = s * 0.1;
        body.add(loft([[0.095, 0.48], [0.1, 0.6], [0.102, 0.74]].map(([r, z]) => ({ c: [lx, 0, z], rx: r })), 12), { color: pal(CANVAS), skin: thigh });
        // the hem rolled up: a thicker ring
        body.add(torus(0.1, 0.018, 12, 5), { at: [lx, 0, 0.49], color: pal(CANVAS), skin: thigh });
        body.add(loft([[0, 0.07], [0.047, 0.09], [0.052, 0.2], [0.062, 0.34], [0.066, 0.46], [0.07, 0.51]].map(([r, z]) => ({ c: [lx, 0, z], rx: r })), 10), {
            color: pal(SKIN), skin: (p) => (p[2] > 0.47 ? band(thigh, shin, 0.49, 0.04)(p) : [[shin, 1]]),
        });
        // big feet in sandals
        body.add(roundedBox(0.11, 0.27, 0.035, 0.012), { at: [lx, 0.055, 0.018], color: pal(LEATHER), skin: foot });
        body.add(roundedBox(0.09, 0.2, 0.055, 0.025), { at: [lx, 0.055, 0.055], color: pal(SKIN), skin: foot });
        body.add(box(0.115, 0.022, 0.028), { at: [lx, 0.1, 0.07], color: pal(LEATHER), skin: foot });
        body.add(box(0.115, 0.022, 0.028), { at: [lx, 0.0, 0.07], color: pal(LEATHER), skin: foot });
    }

    // ---------------- the head (single bone): skull, jaw, ears, nose, and the face that carries appeal
    body.add(cylinder(0.055, 0.06, 0.08, 10), { at: [0, 0, 1.47], color: pal(SKIN), skin: band(H, j("chest"), 1.47, 0.03) });
    body.add(sphere(1, 18, 14), { at: [0, 0.005, HEAD.z], scale: [HEAD.rx, HEAD.ry, HEAD.rz], color: pal(SKIN), skin: H });
    body.add(roundedBox(0.2, 0.18, 0.1, 0.05), { at: [0, 0.03, 1.52], color: pal(SKIN), skin: H });
    for (const s of [-1, 1]) body.add(sphere(1, 8, 6), { at: [s * 0.132, -0.005, 1.6], scale: [0.025, 0.035, 0.045], color: pal(SKIN), skin: H });
    body.add(roundedBox(0.045, 0.05, 0.06, 0.02), { at: [0, 0.155, 1.58], color: pal(SKIN), skin: H });
    // eyes: big whites and dark pupils looking a touch inward, brows that can carry a mood
    for (const s of [-1, 1]) {
        body.add(sphere(1, 12, 8), { at: [s * 0.05, 0.128, 1.635], scale: [0.032, 0.02, 0.036], color: pal(WHITE), skin: H });
        body.add(sphere(1, 10, 6), { at: [s * 0.046, 0.146, 1.632], scale: [0.017, 0.008, 0.02], color: pal(INK), skin: j("pupils") });
        body.add(roundedBox(0.06, 0.02, 0.018, 0.008), { at: [s * 0.052, 0.14, 1.69], rot: [0, s * -0.18, 0], color: pal(HAIR), skin: j("brows") });
        // the lid: a skin-coloured cap over the eye, hung from the brow line, which the game lowers to blink
        body.add(sphere(1, 12, 6), { at: [s * 0.05, 0.13, 1.66 - 0.024], scale: [0.036, 0.024, 0.026], color: pal(SKIN), skin: j("lids") });
    }
    // mouths: a lopsided grin (rest), a wide open smile with teeth (glad), an O (scared)
    body.add(roundedBox(0.075, 0.02, 0.016, 0.007), { at: [0.006, 0.152, 1.535], rot: [0, 0.08, 0], color: pal(INK), skin: j("mouth") });
    body.add(roundedBox(0.1, 0.02, 0.045, 0.02), { at: [0, 0.15, 1.532], color: pal(INK), skin: j("smile") });
    body.add(roundedBox(0.085, 0.022, 0.016, 0.006), { at: [0, 0.157, 1.546], color: pal(WHITE), skin: j("smile") });
    for (const s of [-1, 1]) body.add(roundedBox(0.03, 0.02, 0.02, 0.008), { at: [s * 0.055, 0.148, 1.552], rot: [0, -s * 0.5, 0], color: pal(INK), skin: j("smile") });
    body.add(sphere(1, 12, 8), { at: [0, 0.15, 1.53], scale: [0.022, 0.012, 0.03], color: pal(INK), skin: j("gasp") });

    // ---------------- variants on their own bones (the game hides all but one of each)
    // hat A: the wide straw sun hat with a team band
    body.add(cylinder(0.27, 0.25, 0.025, 22), { at: [0, 0, 1.72], color: pal(HAT), skin: j("hatA") });
    body.add(cylinder(0.125, 0.11, 0.11, 18), { at: [0, 0, 1.79], color: pal(HAT), skin: j("hatA") });
    body.add(cylinder(0.128, 0.126, 0.032, 18), { at: [0, 0, 1.75], color: pal(TEAM), skin: j("hatA") });
    // hat B: a bandana tied tight, its knot and tails at the back
    body.add(sphere(1, 16, 10), { at: [0, -0.005, 1.66], scale: [0.142, 0.152, 0.13], color: pal(HAT), skin: j("hatB") });
    body.add(sphere(1, 8, 6), { at: [0, -0.15, 1.64], scale: [0.04, 0.035, 0.035], color: pal(HAT), skin: j("hatB") });
    for (const s of [-1, 1]) body.add(box(0.035, 0.012, 0.13), { at: [s * 0.03, -0.16, 1.57], rot: [0.35, 0, s * 0.25], color: pal(HAT), skin: j("hatB") });
    // hat C: a captain's cap with a peak and a team badge
    body.add(cylinder(0.15, 0.142, 0.1, 18), { at: [0, -0.01, 1.76], color: pal(HAT), skin: j("hatC") });
    body.add(cylinder(0.155, 0.155, 0.02, 18), { at: [0, -0.01, 1.815], color: pal(HAT), skin: j("hatC") });
    body.add(roundedBox(0.22, 0.12, 0.02, 0.01), { at: [0, 0.15, 1.715], rot: [-0.25, 0, 0], color: pal(INK), skin: j("hatC") });
    body.add(sphere(1, 8, 6), { at: [0, 0.14, 1.77], scale: [0.025, 0.012, 0.025], color: pal(TEAM), skin: j("hatC") });
    // hair A: a short crop, showing below the hat at the sides and back
    body.add(sphere(1, 16, 10), { at: [0, -0.02, 1.625], scale: [0.143, 0.15, 0.15], color: pal(HAIR), skin: j("hairA") });
    // hair B: a ponytail, three tapering beads from its own root, which the game swings
    body.add(sphere(1, 14, 10), { at: [0, -0.015, 1.63], scale: [0.14, 0.15, 0.145], color: pal(HAIR), skin: j("hairA") });
    for (let k = 0; k < 3; k++) body.add(sphere(1, 8, 6), { at: [0, -0.15 - k * 0.02, 1.62 - k * 0.07], scale: [0.045 - k * 0.008, 0.045 - k * 0.008, 0.05], color: pal(HAIR), skin: j("hairB") });
    // hair C: long hair down to the nape (it stops at the neck: hair never crosses a joint)
    body.add(sphere(1, 16, 12), { at: [0, -0.04, 1.6], scale: [0.152, 0.15, 0.17], color: pal(HAIR), skin: j("hairC") });
    body.add(roundedBox(0.25, 0.08, 0.2, 0.04), { at: [0, -0.1, 1.5], color: pal(HAIR), skin: j("hairC") });
    // a beard
    body.add(roundedBox(0.18, 0.09, 0.09, 0.04), { at: [0, 0.1, 1.5], color: pal(HAIR), skin: j("beard") });

    // ---------------- the loot sack on the back, straps, the pennant, the grapple
    body.add(sphere(1, 16, 12), { at: [0, -0.27, 1.08], scale: [0.17, 0.12, 0.2], color: pal(CANVAS), skin: j("pack") });
    body.add(cylinder(0.11, 0.07, 0.07, 12), { at: [0, -0.27, 1.29], color: pal(CANVAS), skin: j("pack") });
    body.add(torus(0.075, 0.02, 12, 5), { at: [0, -0.27, 1.26], color: pal(LEATHER), skin: j("pack") });
    body.add(loft([[0.172, 0.122, 1.02], [0.174, 0.124, 1.07]].map(([rx, ry, z]) => ({ c: [0, -0.27, z], rx, ry })), 14), { color: pal(TEAM), skin: j("pack") });
    for (const s of [-1, 1]) body.add(box(0.035, 0.02, 0.4), { at: [s * 0.09, 0.0, 1.22], rot: [0, 0, 0], color: pal(LEATHER), skin: torsoSkin });
    for (const s of [-1, 1]) body.add(box(0.035, 0.24, 0.025), { at: [s * 0.09, -0.11, 1.4], color: pal(LEATHER), skin: j("chest") });
    // the pennant: a pole up from the sack and a triangle of team colour, the flag a crew is seen by
    body.add(cylinder(0.012, 0.012, 0.9, 6), { at: [0.13, -0.26, 1.65], color: pal(LEATHER), skin: j("flag") });
    body.add(box(0.02, 0.3, 0.2), { at: [0.13, -0.41, 1.98], color: pal(TEAM), skin: j("flag") });
    body.add(cylinder(0.1, 0.002, 0.18, 4), { at: [0.13, -0.6, 1.98], rot: [PI / 2, 0, 0], scale: [0.2, 1, 1], color: pal(TEAM), skin: j("flag") });
    body.add(sphere(1, 6, 5), { at: [0.13, -0.26, 2.11], scale: [0.025, 0.025, 0.025], color: pal(HAT), skin: j("flag") });
    // the grapple: a coil of rope on the left hip and the iron hook
    body.add(torus(0.08, 0.024, 14, 6), { at: [-0.21, -0.02, 0.86], rot: [0, PI / 2, 0], color: pal(CANVAS), skin: j("hips") });
    body.add(torus(0.035, 0.01, 10, 5), { at: [-0.23, 0.06, 0.78], rot: [PI / 2, 0, 0], color: pal(INK), skin: j("hips") });
    return { meshes: [body], skeleton: J, clips: clips() };
}

// ------------------------------------------------------------------ motion

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** 0 → 1 over [a, b] of u, eased */
const span = (u, a, b) => smooth((u - a) / (b - a));
/** a value that goes from 0 up to 1 over [a, b] and back to 0 over [b, c] (an accent) */
const bump = (u, a, b, c) => (u < b ? span(u, a, b) : 1 - span(u, b, c));

export function clips() {
    // limbs hang down: +rx swings them forward. Spine, chest, head point up: −rx leans them forward.
    // arms: +rz on the right arm lifts it out to the side; on the left arm the same lift is −rz (mirror).
    const arms = (swing, out = 0.1, bend = 0.3) => ({ armL: [-swing, 0, -out], armR: [swing, 0, out], foreL: [Math.max(0, swing) * 0.7 + bend, 0, 0], foreR: [Math.max(0, -swing) * 0.7 + bend, 0, 0] });

    /** a stride: contact at u = 0 and 0.5; the hips drop just after contact and rise at passing */
    const stride = (amp, lean, armAmp, bob, dwell = 0) => (u) => {
        const a = u * TAU, s = sin(a);
        // the vertical: a sharp low just after each contact, a soft high at passing (weight lands, then lifts)
        const ph = (u * 2) % 1, low = Math.pow(1 - Math.abs(ph - (0.12 + dwell * 0.1)) * 2, 3);
        const lift = -bob * Math.max(0, low) + bob * 0.4 * Math.pow(sin(ph * PI), 2);
        // arms lag the legs by a twentieth of a cycle (overlap); the head counters the bob
        const la = sin(a - 0.3);
        return {
            thighL: [s * amp, 0, 0], thighR: [-s * amp, 0, 0],
            shinL: [-Math.max(0, cos(a - 0.6)) * amp * 1.8, 0, 0], shinR: [-Math.max(0, -cos(a - 0.6)) * amp * 1.8, 0, 0],
            footL: [Math.max(0, cos(a - 0.6)) * 0.35, 0, 0], footR: [Math.max(0, -cos(a - 0.6)) * 0.35, 0, 0],
            hips: [0, 0, -s * 0.1], spine: [lean, 0, s * 0.08], chest: [lean * 0.35, 0, s * 0.07], head: [-lean * 0.8 + lift * 1.5, 0, -s * 0.06],
            ...arms(la * armAmp),
            move: { hips: [0, 0, lift] },
        };
    };

    return [
        clip("idle", 4, (u) => {
            const b = sin(u * TAU * 2);                       // two breaths
            const shift = smooth(bump(u, 0.25, 0.4, 0.75));    // weight onto the right leg and back
            const look = bump(u, 0.45, 0.6, 0.85) * 0.5;       // a look to the side, later than the shift
            return { ...arms(b * 0.02, 0.12, 0.25), spine: [-0.03 + b * 0.015, 0, 0], chest: [b * 0.02, 0, 0], head: [0, 0, look],
                hips: [0, shift * 0.06, 0], thighL: [0.04, 0.05 + shift * 0.05, 0], thighR: [-0.04, -0.05 + shift * 0.03, 0], shinL: [-shift * 0.12, 0, 0],
                move: { hips: [shift * 0.02, 0, -shift * 0.015 + b * 0.004] } };
        }),
        clip("walk", 0.9, stride(0.45, -0.06, 0.35, 0.025)),
        clip("run", 0.6, stride(0.85, -0.22, 0.95, 0.05)),
        // the heavy carry: hunched, short steps, a long dwell in the low pose, hands on the straps
        clip("carry", 0.85, (u) => {
            const p = stride(0.5, -0.38, 0, 0.07, 1)(u);
            p.armL = [0.5, 0, -0.25]; p.armR = [0.5, 0, 0.25]; p.foreL = [1.7, 0, 0]; p.foreR = [1.7, 0, 0];
            p.head[0] += 0.25;
            return p;
        }),
        clip("wade", 1.1, (u) => { const p = stride(0.55, -0.12, 0.15, 0.03)(u); p.armL = [0.25, 0, -0.75]; p.armR = [0.25, 0, 0.75]; p.thighL[0] += 0.15; p.thighR[0] += 0.15; return p; }),
        // breaststroke: power (0 to 0.4, fast) sweeps the arms out and back; glide (0.4 to 1, slow) reaches forward
        clip("swim", 1.2, (u) => {
            const power = span(u, 0, 0.4), glide = span(u, 0.4, 1), sweep = power * (1 - glide);
            const kick = bump(u, 0.15, 0.45, 0.8);              // the kick follows the arms (overlap)
            return {
                hips: [-1.25, 0, 0], spine: [-0.08, 0, 0], head: [1.15 - sweep * 0.2, 0, 0],
                armL: [2.8 - sweep * 1.4, 0, -0.3 - sweep * 0.9], armR: [2.8 - sweep * 1.4, 0, 0.3 + sweep * 0.9],
                foreL: [0.2 + sweep * 0.9, 0, 0], foreR: [0.2 + sweep * 0.9, 0, 0],
                thighL: [0.2 + kick * 0.5, 0.15 + kick * 0.35, 0], thighR: [0.2 + kick * 0.5, -0.15 - kick * 0.35, 0],
                shinL: [-0.3 - kick * 1.2, 0, 0], shinR: [-0.3 - kick * 1.2, 0, 0],
                move: { hips: [0, 0, 0.55 + sweep * 0.04] },
            };
        }),
        clip("tread", 1.6, (u) => {
            const s = sin(u * TAU), s2 = sin(u * TAU + 1.2);
            return { armL: [0.4, 0, -1.0 + s * 0.35], armR: [0.4, 0, 1.0 - s2 * 0.35], foreL: [0.6, 0, 0], foreR: [0.6, 0, 0],
                thighL: [0.35 + s * 0.35, 0, 0], thighR: [0.35 - s * 0.35, 0, 0], shinL: [-0.7, 0, 0], shinR: [-0.7, 0, 0], head: [0.12, 0, 0], move: { hips: [0, 0, s * 0.02] } };
        }),
        // take-off stretch: arms swung up, one knee driven up
        clip("jump", 1, () => ({ armL: [1.6, 0, -0.35], armR: [1.6, 0, 0.35], foreL: [0.3, 0, 0], foreR: [0.3, 0, 0], thighL: [1.0, 0.06, 0], thighR: [0.1, -0.06, 0], shinL: [-1.4, 0, 0], shinR: [-0.3, 0, 0], spine: [0.05, 0, 0], head: [0.1, 0, 0] })),
        clip("fall", 0.6, (u) => { const s = sin(u * TAU); return { armL: [0.6, 0, -1.3 + s * 0.15], armR: [0.6, 0, 1.3 - s * 0.15], foreL: [0.4, 0, 0], foreR: [0.4, 0, 0], thighL: [0.5, 0, 0], thighR: [0.15, 0, 0], shinL: [-0.8, 0, 0], shinR: [-0.4, 0, 0], head: [-0.1, 0, 0] }; }),
        // shove: wind-up 35% (lean back, hands to chest), push 15% (fast, a step in), recover 50%
        clip("shove", 0.55, (u) => {
            const wind = span(u, 0, 0.35) * (1 - span(u, 0.35, 0.45)), push = span(u, 0.35, 0.5) * (1 - span(u, 0.55, 1));
            return {
                spine: [0.2 * wind - 0.4 * push, 0, 0.15 * wind], chest: [0.1 * wind - 0.2 * push, 0, 0], head: [-0.1 * wind + 0.25 * push, 0, 0],
                armL: [0.5 * wind + 1.55 * push, 0, -0.15], armR: [0.5 * wind + 1.55 * push, 0, 0.15], foreL: [1.9 * wind + 0.05, 0, 0], foreR: [1.9 * wind + 0.05, 0, 0],
                thighL: [-0.2 * wind + 0.6 * push, 0, 0], thighR: [0.15 * wind - 0.35 * push, 0, 0], shinL: [-0.2 * wind - 0.3 * push, 0, 0],
                move: { hips: [0, -0.05 * wind + 0.12 * push, -0.04 * wind] },
            };
        }, 30, false),
        // the throw: wind-up behind the head (40%), a whip forward and up with an overshoot (20%), then the hold
        clip("hookThrow", 0.4, (u) => {
            const wind = span(u, 0, 0.4) * (1 - span(u, 0.4, 0.55)), whip = span(u, 0.4, 0.6), over = bump(u, 0.5, 0.62, 1) * 0.25;
            return {
                armR: [3.0 * wind + (2.5 + over) * whip, 0, 0.3 * wind + 0.1], foreR: [1.6 * wind + 0.1 * whip, 0, 0],
                spine: [0.15 * wind - 0.2 * whip, 0, -0.35 * wind + 0.2 * whip], chest: [0, 0, -0.2 * wind + 0.15 * whip],
                armL: [0.6, 0, -0.5 - 0.3 * wind], foreL: [0.8, 0, 0], head: [-0.1 * whip, 0, 0],
            };
        }, 30, false),
        clip("hook", 1.2, (u) => { const s = sin(u * TAU); return { armR: [2.7, 0, 0.1], foreR: [0.1, 0, 0], armL: [2.4, 0, -0.15], foreL: [0.3, 0, 0], thighL: [0.35 + s * 0.08, 0, 0], thighR: [0.1 - s * 0.08, 0, 0], shinL: [-0.6, 0, 0], shinR: [-0.4, 0, 0], spine: [-0.1, 0, 0], head: [0.25, 0, 0] }; }),
        // off balance: arms windmilling out of phase, the head lagging
        clip("stagger", 0.6, (u) => { const a = u * TAU, s = sin(a), s2 = sin(a + 1.6); return { spine: [0.35, 0, s * 0.12], chest: [0.1, 0, s * 0.08], head: [0.3, 0, sin(a - 0.8) * 0.2], armL: [1.0 + s * 0.9, 0, -1.0], armR: [1.0 + s2 * 0.9, 0, 1.0], foreL: [0.4, 0, 0], foreR: [0.4, 0, 0], thighL: [0.45, 0, 0], shinL: [-0.6, 0, 0], thighR: [-0.25, 0, 0], move: { hips: [0, -0.03, -0.04] } }; }),
        // drowning: reaching up, the reaches slowing as it sinks
        clip("drown", 1.8, (u) => {
            const tire = 1 - span(u, 0.3, 1), a = u * TAU * 3, s = sin(a) * tire, sink = span(u, 0.2, 1);
            return { armL: [2.6 + s * 0.4, 0, -0.4 - s * 0.3], armR: [2.6 - s * 0.4, 0, 0.4 - s * 0.3], foreL: [0.3 + tire * 0.4, 0, 0], foreR: [0.3 + tire * 0.4, 0, 0], head: [-0.5 * sink, 0, 0], spine: [0.15, 0, 0], thighL: [0.4 + s * 0.3, 0, 0], thighR: [0.4 - s * 0.3, 0, 0], shinL: [-0.8, 0, 0], shinR: [-0.8, 0, 0], move: { hips: [0, 0, -0.7 * sink] } };
        }, 20, false),
        // banking: crouch (anticipation), hop with a fist up, a hold at the apex, squash on landing, settle
        clip("celebrate", 1.3, (u) => {
            const crouch = span(u, 0, 0.18) * (1 - span(u, 0.18, 0.3)), up = span(u, 0.2, 0.34) * (1 - span(u, 0.52, 0.64));
            const land = bump(u, 0.6, 0.68, 0.9), pump = up * (0.5 + 0.5 * sin(u * TAU * 5));
            return {
                hips: [0, 0, 0], spine: [0.15 * crouch - 0.1 * up, 0, 0], head: [-0.2 * up + 0.1 * crouch, 0, 0],
                armR: [-0.5 * crouch + 3.0 * up, 0, 0.2], foreR: [0.4 + 0.5 * pump, 0, 0], armL: [-0.4 * crouch + 0.6 * up, 0, -0.35 - 0.4 * up], foreL: [0.6, 0, 0],
                thighL: [0.9 * crouch + 0.3 * up + 0.6 * land, 0.05, 0], thighR: [0.9 * crouch + 0.6 * land, -0.05, 0],
                shinL: [-1.6 * crouch - 0.6 * up - 1.0 * land, 0, 0], shinR: [-1.6 * crouch - 1.0 * land, 0, 0], footL: [0.7 * crouch + 0.4 * land, 0, 0], footR: [0.7 * crouch + 0.4 * land, 0, 0],
                move: { hips: [0, 0, -0.16 * crouch + 0.32 * up - 0.1 * land] },
            };
        }, 30, false),
    ];
}

// run as a script: write the model. (tools/make-raider-glb.mjs imports the skeleton and clips from here.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = writeGLB(OUT + "raider.glb", raider());
    console.log(`${r.path.split(/[\\/]/).pop()}: ${r.meshes} mesh, ${r.triangles} triangles, ${(r.bytes / 1024).toFixed(0)} KB`);
}
