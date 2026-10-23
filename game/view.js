import { Entity, Mesh, Geometry, StandardMaterial, BasicMaterial, ParticleSystem, Trail, primitives, quat } from "../engine/index.js";
import { sample, makeAir, fanAxis } from "./air.js";

/**
 * PAPER PLANES: the stage-1 greybox scene. Throwaway by design (the `prototype-fast` brief): grey boxes for
 * furniture, a see-through cone for the fan and a column for the thermal, dust motes that ride the real air
 * field so the air can be read, and a folded-paper dart for the plane. Stage 6 replaces all of it.
 * @module game/view
 */

const TAG_COLOR = { wood: [0.62, 0.55, 0.47], metal: [0.75, 0.74, 0.72], plastic: [0.55, 0.62, 0.7], fabric: [0.5, 0.58, 0.72] };

/** A folded dart: nose along +X, wings along ±Y, a keel below. Unit = metres (0.1 m long, 0.08 m span). */
export function planeGeometry() {
    const L = 0.1, S = 0.04, K = 0.013;
    const nose = [L * 0.55, 0, 0], tailL = [-L * 0.45, S, 0.006], tailR = [-L * 0.45, -S, 0.006];
    const rootT = [-L * 0.45, 0, 0], keel = [-L * 0.4, 0, -K];
    const tris = [
        [nose, tailL, rootT], [nose, rootT, tailR], // the wings
        [nose, rootT, keel], [nose, keel, rootT], // the keel, both faces
    ];
    const pos = [], nrm = [];
    for (const [a, b, c] of tris) {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const m = Math.hypot(...n) || 1;
        for (const p of [a, b, c]) { pos.push(...p); nrm.push(n[0] / m, n[1] / m, n[2] / m); }
    }
    return new Geometry({ name: "plane", positions: new Float32Array(pos), normals: new Float32Array(nrm) });
}

/** orientation of a plane from its yaw, pitch and roll (right bank = right wing down) */
export function planeRotation(out, yaw, pitch, roll) {
    const qy = quat.setAxisAngle(quat.create(), [0, 0, 1], yaw);
    const qp = quat.setAxisAngle(quat.create(), [0, 1, 0], -pitch);
    const qr = quat.setAxisAngle(quat.create(), [1, 0, 0], roll);
    quat.multiply(out, qy, qp);
    return quat.multiply(out, out, qr);
}

export class GreyboxView {
    /** @param {import("../engine/Game.js").Game} game @param {object} room */
    constructor(game, room) {
        this.game = game;
        this.room = room;
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
        // the window above the radiator: a bright pane (not solid yet: gusts come in stage 2)
        box(-0.75, max[1] - 0.005, 0.95, 0.75, max[1], 2.15, new BasicMaterial({ color: [1.6, 1.55, 1.4], lit: false }));
        for (const b of room.boxes) box(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], new StandardMaterial({ color: TAG_COLOR[b.tag] || TAG_COLOR.wood }));

        // the air sources, drawn see-through so the prototype shows where they are
        this.fans = [];
        for (const s of room.air) {
            if (s.kind === "thermal") {
                const e = new Entity({ mesh: new Mesh(primitives.cylinder(s.radius, s.radius, s.top - s.bottom, 32, false), new BasicMaterial({ color: [1, 0.55, 0.2], opacity: 0.1, lit: false, depthWrite: false, cull: "none" })) });
                e.setPosition(s.at[0], s.at[1], (s.top + s.bottom) / 2);
                // the engine's cylinder stands along Z already
                scene.add(e);
            } else if (s.kind === "fan") {
                const len = s.reach, r = 0.12 + len * s.half;
                const e = new Entity({ mesh: new Mesh(coneAlongX(r, len), new BasicMaterial({ color: [0.4, 0.75, 1], opacity: 0.08, lit: false, depthWrite: false, cull: "none" })) });
                e.setPosition(s.at[0], s.at[1], s.at[2]);
                scene.add(e);
                this.fans.push({ src: s, entity: e });
            }
        }

        // dust motes that ride the air: how a player reads it
        this.motes = scene.add(new ParticleSystem({ capacity: 420, blending: "normal" }));
        this._air = makeAir();
        this._axis = [0, 0, 0];
        for (let i = 0; i < 420; i++) this._spawnMote(true);

        // the plane and its trail
        this.plane = scene.add(new Entity({ mesh: new Mesh(planeGeometry(), new StandardMaterial({ color: [0.97, 0.96, 0.92], cull: "none", rim: [0.3, 0.3, 0.3] })) }));
        this.trail = scene.add(new Trail({ length: 50, color: [0.35, 0.33, 0.3] }));
    }

    _spawnMote(anywhere) {
        const { min, max } = this.room.size, m = this.motes;
        const p = [min[0] + Math.random() * (max[0] - min[0]), min[1] + Math.random() * (max[1] - min[1]), min[2] + 0.05 + Math.random() * (max[2] - min[2] - 0.1)];
        const life = anywhere ? 2 + Math.random() * 8 : 6 + Math.random() * 6;
        m.emit(1, { position: p, life: [life, life], size: [0.03, 0.03], color: [1.25, 1.1, 0.85, 0.9], colorEnd: [1.25, 1.1, 0.85, 0.0] });
    }

    /**
     * Each fixed step: the motes take the air's velocity; dead ones respawn somewhere random.
     * @param {number} t air time (seconds)
     * @param {number} seed
     */
    step(t, seed) {
        const m = this.motes, a = this._air;
        for (let i = 0; i < m.alive; i++) {
            sample(this.room, seed, t, m.px[i], m.py[i], m.pz[i], a);
            // motes are light: they follow the air closely, with a hint of settling
            m.vx[i] = a.x + a.tx; m.vy[i] = a.y + a.ty; m.vz[i] = a.z + a.tz - 0.01;
        }
        while (m.alive < m.capacity) this._spawnMote(false);
        for (const f of this.fans) {
            const ax = fanAxis(f.src, t, this._axis);
            f.entity.rotation.set(quatFromX(ax));
        }
    }

    /** @param {object} p the simulated plane */
    setPlane(p) {
        this.plane.setPosition(p.x, p.y, p.z);
        planeRotation(this.plane.rotation, p.yaw, p.pitch, p.roll);
        this.plane.visible = true;
        if (p.crumpled > 0) this.plane.setScale(0.45, 0.45, 0.45); else this.plane.setScale(1, 1, 1);
        this.trail.push(p.x, p.y, p.z);
    }
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

/** the rotation taking +X to a unit vector */
function quatFromX(d) {
    const q = quat.create();
    return quat.rotationTo(q, [1, 0, 0], d);
}

function normalize(v) { const m = Math.hypot(...v); return v.map((x) => x / m); }
