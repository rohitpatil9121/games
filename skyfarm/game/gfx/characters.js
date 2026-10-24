import { Entity, Mesh, Geometry, primitives, quat } from "../../engine/index.js";
import { part } from "./props.js";

/**
 * SKYFARM: people, built in code (the `img2threejs` skill's staged method without a reference photo, which it
 * can't have here: blockout → structure → form → material, with a written spec per character; and the
 * `disney-animation-rule-skill` for the motion: overlap, follow-through, secondary action).
 *
 * The proportions are Ghibli-chunky, not chibi: about 1.6–1.8 m, a head a little large for the body, hands and
 * boots a little large too, clothes in thick simple layers (a flared tunic or skirt over the legs, a belt, a scarf
 * or shawl), faces with white eyes and dark pupils, brows, a nose and pink cheeks, so they read at a distance and
 * up close.
 *
 * Each character is a root entity with five jointed children: the body and head, two arms (pivot at the
 * shoulder) and two legs (pivot at the hip). Animation sets the joints each frame:
 *   idle    breathing, a slow weight shift, the head turning toward the player when they're near
 *   walk    legs and arms swing in opposition, the body bobs twice a stride and leans into the speed
 *   glide   legs trail back, arms up on the bar, a little sway
 *   talk    the head nods with the words, one hand gestures
 * Arms swing a beat behind the legs (overlap), the head settles after the body (follow-through).
 * @module game/gfx/characters
 */

const SKIN = [0.96, 0.79, 0.65], EYE = [0.98, 0.97, 0.95], PUPIL = [0.14, 0.1, 0.1], CHEEK = [0.98, 0.6, 0.55];

/** the cast (spec per character: colours, build, what they wear) */
export const CAST = {
    gardener: { height: 1.0, width: 1.0, tunic: [0.34, 0.55, 0.78], trousers: [0.42, 0.33, 0.25], boots: [0.36, 0.24, 0.16], hair: [0.32, 0.21, 0.14], scarf: [0.84, 0.35, 0.27], hat: "straw", satchel: true },
    ona: { height: 0.9, width: 1.05, tunic: [0.55, 0.24, 0.28], skirt: true, trousers: [0.4, 0.3, 0.35], boots: [0.3, 0.22, 0.18], hair: [0.86, 0.86, 0.84], bun: true, shawl: [0.85, 0.75, 0.55], old: true },
    pell: { height: 1.08, width: 0.88, tunic: [0.78, 0.6, 0.32], trousers: [0.3, 0.32, 0.36], boots: [0.3, 0.22, 0.16], hair: [0.75, 0.42, 0.2], scarf: [0.86, 0.22, 0.2], longScarf: true, goggles: true },
    mabel: { height: 0.95, width: 1.22, tunic: [0.45, 0.58, 0.4], skirt: true, trousers: [0.5, 0.45, 0.38], boots: [0.36, 0.26, 0.18], hair: [0.55, 0.3, 0.18], hat: "bee", apron: [0.98, 0.86, 0.45] },
    tor: { height: 1.1, width: 1.2, tunic: [0.42, 0.32, 0.24], trousers: [0.3, 0.26, 0.22], boots: [0.24, 0.18, 0.14], hair: [0.75, 0.74, 0.72], beard: [0.82, 0.82, 0.8], hat: "fur", cane: true, old: true },
    iris: { height: 1.0, width: 0.92, tunic: [0.2, 0.25, 0.45], skirt: true, trousers: [0.2, 0.22, 0.35], boots: [0.2, 0.18, 0.22], hair: [0.14, 0.12, 0.16], longHair: true, glasses: true, stars: true, lantern: true },
    // co-op guests: the gardener's build in their own colours, so each friend reads at a glance
    guest1: { height: 1.0, width: 1.0, tunic: [0.4, 0.62, 0.3], trousers: [0.36, 0.3, 0.24], boots: [0.32, 0.22, 0.15], hair: [0.12, 0.1, 0.09], scarf: [0.95, 0.78, 0.25], hat: "straw", satchel: true },
    guest2: { height: 0.96, width: 1.0, tunic: [0.55, 0.36, 0.66], trousers: [0.3, 0.28, 0.34], boots: [0.28, 0.2, 0.16], hair: [0.75, 0.45, 0.2], scarf: [0.3, 0.75, 0.72], longHair: true, satchel: true },
    guest3: { height: 1.04, width: 1.0, tunic: [0.86, 0.52, 0.26], trousers: [0.3, 0.32, 0.4], boots: [0.3, 0.22, 0.16], hair: [0.86, 0.8, 0.6], scarf: [0.25, 0.42, 0.8], hat: "straw", satchel: true },
    bram: { height: 1.0, width: 1.3, tunic: [0.18, 0.27, 0.48], trousers: [0.28, 0.26, 0.3], boots: [0.2, 0.15, 0.12], hair: [0.85, 0.84, 0.8], beard: [0.9, 0.9, 0.88], hat: "captain", buttons: true },
};

const P = (g, at, kind, color, rot = [0, 0, 0], scale = [1, 1, 1]) => part(g, at, kind, rot, scale, color);
const ball = (r, d = 14) => primitives.sphere(r, d, Math.max(6, Math.round(d * 0.7)));

/** the five jointed parts of a character, as geometries in their joint's frame (z up, facing +x) */
function build(spec) {
    const h = spec.height, w = spec.width, hip = 0.76 * h, shoulder = 1.22 * h, neck = 1.3 * h;
    const body = [], head = [], armL = [], armR = [], legL = [], legR = [];
    // legs (pivot at the hip): trousers, a big rounded boot
    for (const [leg, side] of [[legL, 1], [legR, -1]]) {
        leg.push(P(primitives.capsule(0.085 * w, 0.42 * h, 5, 10), [0, 0, -0.32 * h], "cloth", spec.trousers));
        leg.push(P(ball(0.1), [0.05, 0, -0.68 * h], "cloth", spec.boots, [0, 0, 0], [1.6, 1.05, 0.75]));
        void side;
    }
    // body (heights relative to the hip joint at 0.76 h; the shoulders are at 0.46 h above it): a flared tunic or a
    // long skirt over the legs, the chest above it, rounded shoulders, a belt
    const skirtLen = spec.skirt ? 0.52 : 0.3;
    body.push(P(primitives.cylinder(0.2 * w, (spec.skirt ? 0.33 : 0.26) * w, skirtLen * h, 14, true), [0, 0, (0.16 - skirtLen / 2) * h], "cloth", spec.tunic));
    body.push(P(primitives.cylinder(0.19 * w, 0.205 * w, 0.3 * h, 14, true), [0, 0, 0.29 * h], "cloth", spec.tunic));
    body.push(P(ball(0.2 * w), [0, 0, 0.42 * h], "cloth", spec.tunic, [0, 0, 0], [1, 1.25, 0.45]));
    body.push(P(primitives.torus(0.205 * w, 0.03, 6, 20), [0, 0, 0.15 * h], "timber", [0.35, 0.24, 0.16]));
    if (spec.apron) body.push(P(primitives.box(0.04, 0.32 * w, 0.55 * h), [0.23 * w, 0, -0.02 * h], "cloth", spec.apron));
    if (spec.buttons) for (let k = 0; k < 3; k++) body.push(P(ball(0.025, 6), [0.2 * w, 0, 0.2 * h + k * 0.08 * h], "dark", [0.95, 0.78, 0.3]));
    if (spec.stars) for (let k = 0; k < 9; k++) { const a = k * 2.4, z = -0.3 * h + (k % 5) * 0.13 * h; body.push(P(ball(0.018, 5), [Math.cos(a) * 0.25 * w, Math.sin(a) * 0.25 * w, z], "glow", [1.6, 1.5, 0.9])); }
    if (spec.satchel) { body.push(P(primitives.box(0.1, 0.18, 0.16), [-0.05, -0.23 * w, 0.0], "timber", [0.55, 0.38, 0.22])); body.push(P(primitives.box(0.03, 0.03, 0.5 * h), [0.02, -0.05, 0.22 * h], "timber", [0.45, 0.3, 0.18], [0.5, 0, 0])); }
    if (spec.shawl) body.push(P(ball(0.23 * w), [0, 0, 0.38 * h], "cloth", spec.shawl, [0, 0, 0], [1.05, 1.3, 0.55]));
    // scarf at the neck (and a long end that trails)
    if (spec.scarf) {
        body.push(P(primitives.torus(0.12, 0.05, 8, 18), [0, 0, 0.5 * h], "cloth", spec.scarf));
        body.push(P(primitives.box(0.05, 0.09, spec.longScarf ? 0.55 : 0.3), [-0.12, -0.08, (spec.longScarf ? 0.26 : 0.36) * h], "cloth", spec.scarf, [0, 0.3, 0.2]));
    }
    // head (pivot at the neck): face, eyes, brows, nose, cheeks, hair, hats
    const hr = 0.22 * (0.92 + 0.08 * w);
    head.push(P(ball(hr, 18), [0.02, 0, hr * 0.95], "cloth", SKIN));
    for (const side of [1, -1]) {
        head.push(P(ball(0.045, 10), [hr * 0.86, side * hr * 0.36, hr * 1.02], "cloth", EYE, [0, 0, 0], [0.5, 1, 1.25]));
        head.push(P(ball(0.026, 8), [hr * 0.93, side * hr * 0.36, hr * 1.0], "dark", PUPIL));
        head.push(P(primitives.box(0.02, 0.07, 0.016), [hr * 0.86, side * hr * 0.37, hr * 1.27], "cloth", spec.hair, [side * 0.15, 0, 0]));
        head.push(P(ball(0.035, 8), [hr * 0.78, side * hr * 0.6, hr * 0.78], "cloth", CHEEK, [0, 0, 0], [0.4, 1, 0.7]));
        if (spec.glasses) head.push(P(primitives.torus(0.045, 0.008, 4, 14), [hr * 0.98, side * hr * 0.36, hr * 1.02], "dark", [0.3, 0.25, 0.2], [0, Math.PI / 2, 0]));
    }
    head.push(P(ball(0.035, 8), [hr * 1.02, 0, hr * 0.86], "cloth", [SKIN[0] * 0.97, SKIN[1] * 0.85, SKIN[2] * 0.8]));
    if (spec.old) for (const side of [1, -1]) head.push(P(primitives.box(0.01, 0.05, 0.008), [hr * 0.92, side * hr * 0.36, hr * 0.86], "dark", [0.6, 0.45, 0.38]));
    // hair: a cap over the back and top of the head, a fringe; a bun or long hair
    // hair: a cap over the crown and the back (clear of the face), a short fringe
    head.push(P(ball(hr * 1.04, 16), [-hr * 0.28, 0, hr * 1.2], "cloth", spec.hair, [0, 0, 0], [0.9, 1.02, 0.8]));
    head.push(P(ball(hr * 0.45, 10), [hr * 0.55, 0, hr * 1.62], "cloth", spec.hair, [0, 0.5, 0], [0.55, 1.5, 0.32]));
    if (spec.bun) head.push(P(ball(hr * 0.42, 10), [-hr * 0.7, 0, hr * 1.55], "cloth", spec.hair));
    if (spec.longHair) head.push(P(primitives.box(0.08, hr * 1.7, 0.5), [-hr * 0.75, 0, hr * 0.5], "cloth", spec.hair));
    if (spec.beard) head.push(P(ball(hr * 0.7, 12), [hr * 0.5, 0, hr * 0.42], "cloth", spec.beard, [0, 0, 0], [0.9, 1.15, 1.1]));
    if (spec.goggles) { head.push(P(primitives.torus(hr * 1.02, 0.02, 4, 20), [0, 0, hr * 1.35], "timber", [0.35, 0.25, 0.18], [0, 0.25, 0])); for (const side of [1, -1]) head.push(P(primitives.cylinder(0.05, 0.05, 0.05, 10), [hr * 0.85, side * 0.07, hr * 1.55], "dark", [0.5, 0.7, 0.8], [0, Math.PI / 2 - 0.3, 0])); }
    if (spec.hat === "straw") { head.push(P(primitives.cylinder(hr * 1.45, hr * 1.5, 0.03, 20), [0, 0, hr * 1.75], "cloth", [0.92, 0.8, 0.5])); head.push(P(primitives.cylinder(hr * 0.85, hr * 1.0, hr * 0.55, 16), [0, 0, hr * 1.98], "cloth", [0.9, 0.78, 0.48])); head.push(P(primitives.torus(hr * 0.95, 0.018, 4, 18), [0, 0, hr * 1.82], "cloth", [0.84, 0.35, 0.27])); }
    if (spec.hat === "bee") { head.push(P(primitives.cylinder(hr * 1.7, hr * 1.7, 0.025, 20), [0, 0, hr * 1.7], "cloth", [0.9, 0.84, 0.62])); head.push(P(primitives.cone(hr * 1.0, hr * 0.9, 16), [0, 0, hr * 2.15], "cloth", [0.9, 0.82, 0.6])); }
    if (spec.hat === "fur") head.push(P(primitives.cylinder(hr * 1.08, hr * 1.12, hr * 0.7, 16), [-hr * 0.05, 0, hr * 1.75], "cloth", [0.55, 0.45, 0.35]));
    if (spec.hat === "captain") { head.push(P(primitives.cylinder(hr * 1.05, hr * 1.0, hr * 0.45, 16), [0, 0, hr * 1.85], "cloth", [0.14, 0.18, 0.32])); head.push(P(primitives.box(hr * 0.9, hr * 1.4, 0.03), [hr * 0.75, 0, hr * 1.62], "dark", [0.1, 0.1, 0.12], [0, 0.2, 0])); head.push(P(ball(0.03, 6), [hr * 1.03, 0, hr * 1.95], "glow", [1.6, 1.3, 0.5])); }
    // arms (pivot at the shoulder): sleeve, hand; props in the right hand
    for (const [arm, side] of [[armL, 1], [armR, -1]]) {
        arm.push(P(primitives.capsule(0.07 * w, 0.32 * h, 5, 10), [0, 0, -0.24 * h], "cloth", spec.tunic));
        arm.push(P(ball(0.065), [0.02, 0, -0.5 * h], "cloth", SKIN));
        if (side < 0 && spec.cane) arm.push(P(primitives.cylinder(0.022, 0.022, 1.0 * h, 6), [0.08, 0, -0.95 * h], "timber", [0.45, 0.3, 0.2]));
        if (side < 0 && spec.lantern) { arm.push(P(primitives.box(0.12, 0.12, 0.16), [0.06, 0, -0.68 * h], "glow", [2.0, 1.5, 0.7])); arm.push(P(primitives.box(0.15, 0.15, 0.03), [0.06, 0, -0.59 * h], "dark", [0.25, 0.22, 0.2])); }
    }
    const merge = (list) => Geometry.merge(list, { uvs: false });
    return { body: merge(body), head: merge(head), armL: merge(armL), armR: merge(armR), legL: merge(legL), legR: merge(legR), hip, shoulder, neck, w };
}

const _q = quat.create();
/** set a joint's rotation from small euler angles (x roll, y pitch, z yaw; applied z, y, x) */
function joint(e, x, y, z) {
    const q = e.rotation;
    quat.identity(q);
    if (z) quat.rotateZ(q, q, z);
    if (y) quat.rotateY(q, q, y);
    if (x) quat.rotateX(q, q, x);
}

export class Character {
    /**
     * @param {string} who a CAST key
     * @param {import("../../engine/index.js").Material} material the prop material
     */
    constructor(who, material) {
        const g = build(CAST[who]);
        this.who = who;
        this.root = new Entity({ name: "char-" + who });
        const mk = (name, geo, at) => { const e = new Entity({ name, mesh: new Mesh(geo, material) }); e.setPosition(at[0], at[1], at[2]); e.interpolate = false; this.root.add(e); return e; };
        this.body = mk("body", g.body, [0, 0, g.hip]);
        this.headE = mk("head", g.head, [0, 0, g.neck]);
        this.armL = mk("arm", g.armL, [0, 0.24 * g.w, g.shoulder]);
        this.armR = mk("arm", g.armR, [0, -0.24 * g.w, g.shoulder]);
        this.legL = mk("leg", g.legL, [0, 0.1 * g.w, g.hip]);
        this.legR = mk("leg", g.legR, [0, -0.1 * g.w, g.hip]);
        this.root.interpolate = false;
        this.hip = g.hip; this.neck = g.neck; this.shoulder = g.shoulder;
        this.phase = Math.random() * 6; this.t = 0; this.look = 0; this.lean = 0; this.talkT = 0;
    }

    /**
     * Pose for this frame.
     * @param {number} dt
     * @param {"idle" | "walk" | "glide" | "talk"} mode
     * @param {number} speed ground speed, m/s (walk)
     * @param {number} lookYaw head turn wanted, radians relative to the body (idle, talk)
     */
    animate(dt, mode, speed = 0, lookYaw = 0) {
        this.t += dt;
        const t = this.t;
        if (mode === "walk") {
            // a stride a metre and a bit long: the phase advances with distance, not time
            this.phase += dt * speed * 2.6;
            const s = Math.sin(this.phase), c = Math.cos(this.phase), amp = Math.min(1, speed / 4);
            joint(this.legL, 0, s * 0.62 * amp, 0); joint(this.legR, 0, -s * 0.62 * amp, 0);
            // arms opposite, a beat behind (overlap)
            const sa = Math.sin(this.phase - 0.35);
            joint(this.armL, 0.08, -sa * 0.5 * amp, 0); joint(this.armR, -0.08, sa * 0.5 * amp, 0);
            // bob twice a stride, lean into speed
            this.lean += (0.06 * amp - this.lean) * Math.min(1, dt * 6);
            this.body.position[2] = this.hip + Math.abs(c) * 0.035 * amp;
            joint(this.body, 0, this.lean, 0);
            this.look += (0 - this.look) * Math.min(1, dt * 5);
            joint(this.headE, 0, -this.lean * 0.6 + Math.abs(c) * 0.02, this.look);
        } else if (mode === "glide") {
            joint(this.legL, 0.06, -0.35, 0); joint(this.legR, -0.06, -0.28, 0);
            joint(this.armL, -0.35, -2.75, 0); joint(this.armR, 0.35, -2.75, 0);
            joint(this.body, Math.sin(t * 1.3) * 0.04, 0, 0);
            this.body.position[2] = this.hip;
            joint(this.headE, 0, -0.5, 0);
        } else {
            // idle and talk: breathe, shift weight, look toward what's interesting
            const breathe = Math.sin(t * 1.6 + this.phase) * 0.012, sway = Math.sin(t * 0.45 + this.phase) * 0.03;
            joint(this.legL, 0, 0, 0); joint(this.legR, 0, 0, 0);
            this.body.position[2] = this.hip + breathe;
            joint(this.body, sway * 0.5, 0, 0);
            this.look += (Math.max(-1.1, Math.min(1.1, lookYaw)) - this.look) * Math.min(1, dt * 3);
            let nod = 0;
            if (mode === "talk") { this.talkT += dt; nod = Math.sin(this.talkT * 5.5) * 0.06 * (0.5 + 0.5 * Math.sin(this.talkT * 1.3)); }
            joint(this.headE, sway * 0.3, nod, this.look);
            joint(this.armL, 0.12 + breathe, 0.05, 0);
            joint(this.armR, mode === "talk" ? -0.3 : -0.12 - breathe, mode === "talk" ? -0.7 - Math.sin(this.talkT * 2.2) * 0.25 : 0.05, 0);
        }
    }
}
