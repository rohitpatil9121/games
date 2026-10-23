import { Entity, Mesh, Geometry, StandardMaterial, BasicMaterial, ParticleSystem, primitives, quat } from "../engine/index.js";
import { sample, makeAir, fanAxis, gustIn, gustPower } from "./air.js";
import { ringNormal } from "./rings.js";

/**
 * PAPER PLANES: the greybox room (stages 1 and 2). Grey boxes for furniture, see-through shapes for the
 * fan's cone and the thermals, curtains that move before a gust, Ring Run rings, and dust motes that ride
 * the real air field so the air can be read. Stage 6 replaces the boxes and shapes with the real room;
 * the motes, curtains and rings carry over.
 * @module game/view
 */

const TAG_COLOR = { wood: [0.62, 0.55, 0.47], metal: [0.75, 0.74, 0.72], plastic: [0.55, 0.62, 0.7], fabric: [0.5, 0.58, 0.72] };
const MOTES = 420;

export class GreyboxView {
    /** @param {import("../engine/Game.js").Game} game @param {object} room @param {number} seed */
    constructor(game, room, seed) {
        this.game = game;
        this.room = room;
        this.seed = seed;
        const scene = game.scene;
        scene.clearColor.set([0.9, 0.86, 0.8, 1]);
        scene.sunDirection.set(normalize([0.25, -0.6, -0.75]));
        scene.sunColor.set([1.15, 1.0, 0.85]);
        scene.skyColor.set([0.55, 0.58, 0.65]);
        scene.groundColor.set([0.42, 0.36, 0.3]);
        scene.fogDensity = 0;

        const { min, max } = room.size, W = 0.1;
        const shell = new StandardMaterial({ color: [0.86, 0.84, 0.8] });
        const floor = new StandardMaterial({ color: [0.66, 0.56, 0.45] });
        const box = (x0, y0, z0, x1, y1, z1, mat) => {
            const e = new Entity({ mesh: new Mesh(primitives.box(x1 - x0, y1 - y0, z1 - z0), mat) });
            e.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
            return scene.add(e);
        };
        box(min[0] - W, min[1] - W, min[2] - W, max[0] + W, max[1] + W, min[2], floor);
        box(min[0] - W, min[1] - W, max[2], max[0] + W, max[1] + W, max[2] + W, shell);
        box(min[0] - W, min[1], min[2], min[0], max[1], max[2], shell);
        box(max[0], min[1], min[2], max[0] + W, max[1], max[2], shell);
        box(min[0], min[1] - W, min[2], max[0], min[1], max[2], shell);
        box(min[0], max[1], min[2], max[0], max[1] + W, max[2], shell);
        for (const b of room.boxes) box(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], new StandardMaterial({ color: TAG_COLOR[b.tag] || TAG_COLOR.wood }));

        // the window pane and its curtains (a left and a right panel, hinged along the top)
        this.curtains = [];
        this.gust = room.air.find((s) => s.kind === "gust") || null;
        if (room.window) {
            const w = room.window;
            box(w.min[0], w.max[1] - 0.005, w.min[2], w.max[0], w.max[1], w.max[2], new BasicMaterial({ color: [1.6, 1.55, 1.4], lit: false }));
            const mat = new StandardMaterial({ color: [0.85, 0.55, 0.45], cull: "none" });
            const h = w.max[2] - w.min[2] + 0.2, cw = 0.42;
            for (const side of [-1, 1]) {
                const hinge = new Entity({ name: "curtain" });
                hinge.setPosition(side < 0 ? w.min[0] + cw / 2 - 0.12 : w.max[0] - cw / 2 + 0.12, w.max[1] - 0.06, w.max[2] + 0.12);
                const panel = new Entity({ mesh: new Mesh(primitives.box(cw, 0.015, h), mat) });
                panel.setPosition(0, 0, -h / 2);
                hinge.add(panel);
                scene.add(hinge);
                this.curtains.push({ hinge, side });
            }
        }

        // the air sources, drawn see-through so the greybox shows where they are
        this.fans = [];
        for (const s of room.air) {
            if (s.kind === "thermal") {
                const e = new Entity({ mesh: new Mesh(primitives.cylinder(s.radius, s.radius, s.top - s.bottom, 32, false), new BasicMaterial({ color: [1, 0.55, 0.2], opacity: 0.08, lit: false, depthWrite: false, cull: "none" })) });
                e.setPosition(s.at[0], s.at[1], (s.top + s.bottom) / 2);
                scene.add(e);
            } else if (s.kind === "vent") {
                const e = new Entity({ mesh: new Mesh(primitives.cylinder(s.radius, s.radius, s.top - s.bottom, 32, false), new BasicMaterial({ color: [0.4, 0.6, 1], opacity: 0.08, lit: false, depthWrite: false, cull: "none" })) });
                e.setPosition(s.at[0], s.at[1], (s.top + s.bottom) / 2);
                scene.add(e);
            } else if (s.kind === "fan") {
                const len = s.reach, r = 0.12 + len * s.half;
                const e = new Entity({ mesh: new Mesh(coneAlongX(r, len), new BasicMaterial({ color: [0.4, 0.75, 1], opacity: 0.06, lit: false, depthWrite: false, cull: "none" })) });
                e.setPosition(s.at[0], s.at[1], s.at[2]);
                scene.add(e);
                this.fans.push({ src: s, entity: e });
            }
        }

        // dust motes that ride the air: how a player reads it
        this.motes = scene.add(new ParticleSystem({ capacity: MOTES, blending: "normal" }));
        this._air = makeAir();
        this._axis = [0, 0, 0];
        for (let i = 0; i < MOTES; i++) this._spawnMote(true);
        /** one-off effects (puffs, paper bits, ring bursts), shared by every plane */
        this.effects = scene.add(new ParticleSystem({ capacity: 600, blending: "normal", gravity: [0, 0, -0.35], drag: 1.5 }));

        // Ring Run rings: the next one bright, the one after dim, the rest faint
        this.rings = [];
        this._ringMat = [
            new BasicMaterial({ color: [1.5, 1.15, 0.35], lit: false }),
            new BasicMaterial({ color: [0.85, 0.75, 0.55], lit: false, opacity: 0.7 }),
            new BasicMaterial({ color: [0.8, 0.75, 0.68], lit: false, opacity: 0.3, depthWrite: false }),
        ];
    }

    _spawnMote(anywhere) {
        const { min, max } = this.room.size, m = this.motes;
        const p = [min[0] + Math.random() * (max[0] - min[0]), min[1] + Math.random() * (max[1] - min[1]), min[2] + 0.05 + Math.random() * (max[2] - min[2] - 0.1)];
        const life = anywhere ? 2 + Math.random() * 8 : 6 + Math.random() * 6;
        m.emit(1, { position: p, life: [life, life], size: [0.03, 0.03], color: [1.25, 1.1, 0.85, 0.9], colorEnd: [1.25, 1.1, 0.85, 0.0] });
    }

    /** Show a set of rings (null to hide them). */
    showRings(set) {
        for (const r of this.rings) this.game.scene.remove(r.entity);
        this.rings = [];
        if (!set) return;
        for (const ring of set.rings) {
            const e = new Entity({ mesh: new Mesh(primitives.torus(ring.r, 0.012, 10, 40), this._ringMat[2]) });
            e.setPosition(ring.at[0], ring.at[1], ring.at[2]);
            // the engine's torus lies in the XY plane (its axis is Z); turn Z onto the ring's normal
            quat.rotationTo(e.rotation, [0, 0, 1], ringNormal(ring));
            e.teleport();
            this.game.scene.add(e);
            this.rings.push({ ring, entity: e, popAt: -9 });
        }
    }

    /** Colour the rings by what's next, and burst the one just passed. */
    updateRings(next, passed) {
        this.rings.forEach((r, i) => {
            r.entity.visible = i >= next;
            r.entity.mesh.material = this._ringMat[i === next ? 0 : i === next + 1 ? 1 : 2];
        });
        if (passed !== undefined && this.rings[passed]) {
            const ring = this.rings[passed].ring, n = ringNormal(ring);
            this.effects.emit(26, { position: ring.at, spread: ring.r, velocity: [n[0] * 0.15, n[1] * 0.15, n[2] * 0.15], speed: 0.25, life: [0.5, 0.9], size: [0.02, 0.0], color: [1.4, 1.1, 0.4, 1], colorEnd: [1.2, 0.9, 0.3, 0] });
        }
    }

    /**
     * Each fixed step: motes take the air's velocity, dead ones respawn somewhere random; the fans turn.
     * @param {number} t air time (seconds)
     */
    step(t) {
        const m = this.motes, a = this._air;
        for (let i = 0; i < m.alive; i++) {
            sample(this.room, this.seed, t, m.px[i], m.py[i], m.pz[i], a);
            // motes are light: they follow the air closely, with a hint of settling
            m.vx[i] = a.x + a.tx; m.vy[i] = a.y + a.ty; m.vz[i] = a.z + a.tz - 0.01;
        }
        while (m.alive < m.capacity) this._spawnMote(false);
        for (const f of this.fans) f.entity.rotation.set(quat.rotationTo(quat.create(), [1, 0, 0], fanAxis(f.src, t, this._axis)));
        this.airTime = t;
    }

    /**
     * Each frame: the curtains. They stir before a gust (the telegraph: 1.5 s ahead, growing), billow while
     * it blows, and sway a little the rest of the time.
     * @param {number} t air time, interpolated
     * @param {boolean} reducedMotion
     */
    frame(t) {
        if (!this.gust) return;
        const until = gustIn(this.gust, this.seed, t), power = gustPower(this.gust, this.seed, t);
        const warn = until > 0 && until < 1.5 ? 1 - until / 1.5 : 0;
        for (const c of this.curtains) {
            const flutter = Math.sin(t * (6 + warn * 10) + c.side) * (0.03 + warn * 0.12 + power * 0.08);
            const billow = power * 0.85 + warn * 0.18;
            quat.setAxisAngle(c.hinge.rotation, [1, 0, 0], -(billow + flutter)); // negative: the hem swings into the room (-Y)
        }
    }

    /** seconds until the next gust (negative while one blows), for captions and tips */
    gustIn(t) { return this.gust ? gustIn(this.gust, this.seed, t) : Infinity; }
}

/** a cone with its tip at the origin opening along +X */
function coneAlongX(r, len, seg = 32) {
    const pos = [];
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        pos.push(0, 0, 0, len, Math.cos(a0) * r, Math.sin(a0) * r, len, Math.cos(a1) * r, Math.sin(a1) * r);
    }
    return new Geometry({ name: "cone", positions: new Float32Array(pos), normals: new Float32Array(pos.length).fill(0) });
}

function normalize(v) { const m = Math.hypot(...v); return v.map((x) => x / m); }
