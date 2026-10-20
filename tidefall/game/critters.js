import { Entity, InstancedMesh, StandardMaterial, mat4, quat } from "../engine/index.js";
import { groundAt } from "./island.js";
import { part, merge } from "./models.js";
import { primitives } from "../engine/index.js";

/**
 * TIDEFALL: life on the island that has nothing to do with the match. Presentation only, in the client;
 * nothing here is sent, simulated on the server, or able to change what a player can do or know.
 *
 * CRABS (the `game-ai` skill: a few states with obvious transitions is a finite-state machine, not a tree):
 *   wander  sidle along the wet edge the sea has just left (they follow the tide in and out)
 *   flee    a player within 4 m: scuttle away from them, fast, for a moment
 *   hidden  the water came over them: they are under the sand, and come up again at the new edge
 * GULLS: circle high over the island on slow, wide loops, wings beating and gliding in turn, and call now
 * and then. Their loops are fixed per island, so they never point at anything.
 *
 * Both are instanced: every crab is one draw, every gull three (body and two wings).
 * @module game/critters
 */

const CRABS = 28, GULLS = 9;

function crabGeometry() {
    const shell = [0.85, 0.32, 0.2, 1], dark = [0.55, 0.18, 0.12, 1], eye = [0.08, 0.07, 0.07, 1];
    const parts = [
        part(primitives.sphere(0.16, 10, 6), [0, 0, 0.08], shell, null, [1.3, 1, 0.5]),
        part(primitives.sphere(0.05, 8, 6), [0.17, 0.12, 0.09], dark, null, [1.4, 1, 0.8]),
        part(primitives.sphere(0.05, 8, 6), [-0.17, 0.12, 0.09], dark, null, [1.4, 1, 0.8]),
        part(primitives.sphere(0.018, 6, 4), [0.05, 0.13, 0.17], eye), part(primitives.sphere(0.018, 6, 4), [-0.05, 0.13, 0.17], eye),
    ];
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) parts.push(part(primitives.box(0.14, 0.025, 0.025), [s * 0.2, -0.06 + k * 0.06, 0.04], dark, [0, s * 0.35, s * (0.2 - k * 0.2)]));
    return merge(parts);
}
function gullBody() {
    const white = [0.96, 0.96, 0.94, 1], grey = [0.6, 0.62, 0.66, 1], beak = [0.95, 0.75, 0.2, 1];
    return merge([
        part(primitives.sphere(0.14, 10, 6), [0, 0, 0], white, null, [0.8, 2.2, 0.8]),
        part(primitives.sphere(0.1, 8, 6), [0, 0.32, 0.06], white),
        part(primitives.cylinder(0.025, 0.0, 0.12, 5), [0, 0.45, 0.05], beak, [-Math.PI / 2, 0, 0]),
        part(primitives.box(0.18, 0.2, 0.03), [0, -0.38, 0.0], grey),
    ]);
}
function gullWing(side) {
    // a wing reaching out to one side from the shoulder (origin), grey with a dark tip
    return merge([
        part(primitives.box(0.55, 0.22, 0.025), [side * 0.28, 0.02, 0], [0.75, 0.77, 0.8, 1]),
        part(primitives.box(0.22, 0.16, 0.022), [side * 0.65, -0.02, 0], [0.18, 0.18, 0.2, 1]),
    ]);
}

export class Critters {
    /** @param {import("../engine/Scene.js").Scene} scene */
    constructor(scene) {
        const mat = new StandardMaterial({ vertexColors: true, specular: 0.2 });
        const add = (geometry, n) => { const m = new InstancedMesh(geometry, mat, n); m.count = 0; const e = scene.add(new Entity({ name: "critters", mesh: m, frustumCulled: false, castShadow: false })); e.interpolate = false; return m; };
        this.crabMesh = add(crabGeometry(), CRABS);
        this.gullMesh = add(gullBody(), GULLS);
        this.wingL = add(gullWing(-1), GULLS);
        this.wingR = add(gullWing(1), GULLS);
        this.crabs = []; this.gulls = [];
        this.time = 0;
        this._m = mat4.create(); this._q = quat.create();
        /** called with (x, y, z) when a gull cries */
        this.onCall = null;
    }

    /** Place the island's creatures (seeded by the island, so everyone sees the same flock). */
    setIsland(island) {
        this.island = island;
        let s = (island.seed ^ 0x51f15e) >>> 0;
        const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        this.rand = rand;
        this.crabs = Array.from({ length: CRABS }, () => ({ x: 0, y: 0, z: 0, angle: rand() * Math.PI * 2, heading: rand() * Math.PI * 2, state: "hidden", t: rand() * 3, speed: 0, scale: 1.5 + rand() * 0.7, show: 0 }));
        this.gulls = Array.from({ length: GULLS }, (_, i) => ({ cx: (rand() - 0.5) * 120, cy: (rand() - 0.5) * 120, r: 25 + rand() * 50, h: 16 + rand() * 12, w: (0.08 + rand() * 0.08) * (rand() < 0.5 ? -1 : 1), p: rand() * Math.PI * 2, flap: rand() * 10, call: 4 + rand() * 20 }));
    }

    /**
     * @param {number} dt
     * @param {number} level the water height
     * @param {Array<{ x: number, y: number }>} people where the players are
     */
    update(dt, level, people) {
        if (!this.island) return;
        this.time += dt;
        const isl = this.island, m = this.crabMesh, rand = this.rand;
        let n = 0;
        for (const c of this.crabs) {
            c.t -= dt;
            if (c.state === "hidden") {
                c.show = Math.max(0, c.show - dt * 3);
                // come up on the edge the water left: a point on its ring, just above the level
                if (c.t <= 0) {
                    const r = this.edgeRadius(c.angle, level + 0.15 + rand() * 0.6);
                    if (r > 0) { c.x = Math.cos(c.angle) * r; c.y = Math.sin(c.angle) * r; c.state = "wander"; c.t = 2 + rand() * 3; }
                    else c.t = 2;
                }
            } else {
                c.show = Math.min(1, c.show + dt * 2);
                // flee: someone close
                let near = null, nd = 16;
                for (const p of people) { const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2; if (d < nd) { nd = d; near = p; } }
                if (near) { c.state = "flee"; c.heading = Math.atan2(c.y - near.y, c.x - near.x); c.t = 1.2; }
                else if (c.state === "flee" && c.t <= 0) c.state = "wander";
                if (c.state === "wander" && c.t <= 0) { c.heading += (rand() - 0.5) * 2.5; c.t = 1 + rand() * 2.5; }
                const want = c.state === "flee" ? 3.2 : 0.5 + 0.4 * Math.sin(this.time * 1.7 + c.angle * 9);
                c.speed += (want - c.speed) * (1 - Math.exp(-dt * 6));
                // stay on the wet band: drift up or down the beach toward a little above the water
                const g = groundAt(isl, c.x, c.y), r = Math.hypot(c.x, c.y) || 1, gap = g - (level + 0.4);
                const ox = (c.x / r) * -gap * 0.4, oy = (c.y / r) * -gap * 0.4;
                c.x += (Math.cos(c.heading) * c.speed + ox) * dt; c.y += (Math.sin(c.heading) * c.speed + oy) * dt;
                c.z = groundAt(isl, c.x, c.y);
                // the sea came over: dig in
                if (c.z < level - 0.05 || c.z > level + 3) { c.state = "hidden"; c.t = 3 + rand() * 4; c.angle = Math.atan2(c.y, c.x) + (rand() - 0.5) * 0.4; }
            }
            if (c.show <= 0.01) continue;
            // crabs walk sideways: the body faces across its heading; a scuttle bob
            const bob = Math.abs(Math.sin(this.time * 18 * Math.max(0.3, c.speed) + c.angle)) * 0.02 * c.speed;
            const sc = c.scale * c.show;
            m.setTransform(n++, c.x, c.y, c.z - (1 - c.show) * 0.2 + bob, sc, sc, sc, c.heading + Math.PI / 2);
        }
        m.count = n;

        // gulls: slow loops, beating then gliding
        const q = this._q, mx = this._m;
        let k = 0;
        for (const g of this.gulls) {
            const a = g.p + this.time * g.w, x = g.cx + Math.cos(a) * g.r, y = g.cy + Math.sin(a) * g.r, z = g.h + Math.sin(this.time * 0.3 + g.p) * 2;
            const yaw = a + (g.w > 0 ? Math.PI / 2 : -Math.PI / 2) - Math.PI / 2;
            const bank = g.w > 0 ? -0.35 : 0.35;
            g.flap += dt * 9;
            const beating = Math.sin(this.time * 0.4 + g.p) > -0.2, wing = beating ? Math.sin(g.flap) * 0.6 : 0.08;
            quat.fromEuler(q, 0, bank * 57.3, yaw * 57.3);
            mat4.fromRotationTranslationScale(mx, q, [x, y, z], [1.4, 1.4, 1.4]);
            this.gullMesh.setMatrix(k, mx);
            quat.fromEuler(q, 0, (bank - wing) * 57.3, yaw * 57.3);
            mat4.fromRotationTranslationScale(mx, q, [x, y, z], [1.4, 1.4, 1.4]);
            this.wingL.setMatrix(k, mx);
            quat.fromEuler(q, 0, (bank + wing) * 57.3, yaw * 57.3);
            mat4.fromRotationTranslationScale(mx, q, [x, y, z], [1.4, 1.4, 1.4]);
            this.wingR.setMatrix(k, mx);
            k++;
            if ((g.call -= dt) <= 0) { g.call = 8 + Math.random() * 25; if (this.onCall) this.onCall(x, y, z); }
        }
        this.gullMesh.count = this.wingL.count = this.wingR.count = k;
    }

    /** How far out along a direction the ground is at a height (the ring where the sea's edge is): −1 if none. */
    edgeRadius(angle, height) {
        const c = Math.cos(angle), s = Math.sin(angle);
        for (let r = 20; r < 130; r += 1) if (groundAt(this.island, c * r, s * r) < height) return r - 1;
        return -1;
    }
}
