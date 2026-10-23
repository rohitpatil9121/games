import { Entity, Mesh, Geometry, StandardMaterial, Trail, primitives, quat } from "../engine/index.js";

/**
 * PAPER PLANES: how a plane looks and moves on screen (the `game-feel` and `disney-animation-rule-skill`
 * skills). Presentation only: it reads the simulated plane and its events and never changes them.
 *
 * The plane is five points (nose, two wing tips, the wing root at the tail, the keel) rebuilt each frame,
 * so the paper can flex:
 * - dihedral: the tips lift a little with speed (the wings take the load) and drop back when slow;
 * - flap: impact first (the sim applies the boost on the press, so there is no time for anticipation):
 *   the tips snap down in 70 ms, overshoot up at 180 ms, settle by 350 ms;
 * - flutter: in a stall or rough air the tips shiver (secondary motion, after the primary wobble the sim
 *   already gives the whole plane), scaled by the fold's turbulence factor;
 * - crumple: the plane crushes into a paper ball in 120 ms (squash), the ball tumbles as it falls;
 * - refold: the ball shrinks and the plane unfolds with an overshoot (ease-out back) over 300 ms, then
 *   blinks while it can't be tagged.
 * Everything is a function of time since an event plus the plane's state, so it is deterministic and
 * frame-rate independent.
 * @module game/planeview
 */

const L = 0.1, S = 0.04, K = 0.013;
const TRIS = [[0, 1, 3], [0, 3, 2], [0, 3, 4], [0, 4, 3]];

/** a folded dart as five control points; the geometry is rebuilt from them */
function makeGeometry() {
    const n = TRIS.length * 3;
    return new Geometry({ name: "plane", positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), dynamic: true });
}

function writeGeometry(g, tipL, tipR) {
    // nose, left tip, right tip, wing root at the tail, keel
    const P = [[L * 0.55, 0, 0], [-L * 0.45, S, tipL], [-L * 0.45, -S, tipR], [-L * 0.45, 0, 0], [-L * 0.4, 0, -K]];
    const pos = g.positions, nrm = g.normals;
    let o = 0;
    for (const [ia, ib, ic] of TRIS) {
        const a = P[ia], b = P[ib], c = P[ic];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
        for (const p of [a, b, c]) { pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2]; nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz; o += 3; }
    }
    g.markDirty();
}

/** a crumpled paper ball: a coarse sphere with every vertex pushed in or out by a fixed amount */
function ballGeometry() {
    const g = primitives.sphere(0.024, 9, 7);
    const p = g.positions;
    for (let i = 0; i < p.length; i += 3) {
        const k = 0.7 + 0.6 * (((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1);
        p[i] *= k; p[i + 1] *= k; p[i + 2] *= k;
    }
    g.markDirty();
    return g;
}

/** orientation from yaw, pitch and roll (right bank = right wing down) */
export function planeRotation(out, yaw, pitch, roll) {
    const qy = quat.setAxisAngle(quat.create(), [0, 0, 1], yaw);
    const qp = quat.setAxisAngle(quat.create(), [0, 1, 0], -pitch);
    const qr = quat.setAxisAngle(quat.create(), [1, 0, 0], roll);
    quat.multiply(out, qy, qp);
    return quat.multiply(out, out, qr);
}

const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class PlaneView {
    /**
     * @param {import("../engine/Scene.js").Scene} scene
     * @param {{ color?: number[], effects: import("../engine/ParticleSystem.js").ParticleSystem, remote?: boolean }} opts
     *        remote: another player's plane, placed every frame from interpolated snapshots (not every tick)
     */
    constructor(scene, opts) {
        this.scene = scene;
        this.fx = opts.effects;
        this.geometry = makeGeometry();
        writeGeometry(this.geometry, 0.006, 0.006);
        this.material = new StandardMaterial({ color: opts.color || [0.97, 0.96, 0.92], cull: "none", rim: [0.25, 0.25, 0.25] });
        this.root = scene.add(new Entity({ name: "plane" }));
        this.root.interpolate = !opts.remote;
        this.body = new Entity({ mesh: new Mesh(this.geometry, this.material) });
        this.ball = new Entity({ mesh: new Mesh(ballGeometry(), this.material), visible: false });
        this.root.add(this.body); this.root.add(this.ball);
        this.trail = scene.add(new Trail({ length: 45, color: [0.32, 0.3, 0.27] }));
        /** real-time clock and when each event last happened */
        this.time = 0;
        this.flapAt = -9; this.crumpleAt = -9; this.refoldAt = -9;
        this.fold = "dart";
        this._q = quat.create();
    }

    /**
     * Each fixed step, after the simulation: the pose and the one-off effects of this tick's events.
     * @param {object} p the simulated plane
     * @param {object} fold its fold's numbers (FOLDS[p.fold])
     */
    step(p, fold) {
        this.root.setPosition(p.x, p.y, p.z);
        if (p.crumpled > 0) {
            // the ball tumbles as it falls: spin from the time since the crumple, not from frame to frame
            const a = (this.time - this.crumpleAt) * 7;
            quat.setAxisAngle(this.root.rotation, [Math.sin(a * 0.7), Math.cos(a * 0.5), 0.4], a);
        } else planeRotation(this.root.rotation, p.yaw, p.pitch, p.roll);
        const back = [-Math.cos(p.yaw) * 0.05, -Math.sin(p.yaw) * 0.05];
        for (const e of p.events) {
            if (e === "flap") {
                this.flapAt = this.time;
                // two puffs of air thrown back and down off the wings
                for (const side of [-1, 1]) {
                    const sx = -Math.sin(p.yaw) * side * 0.035, sy = Math.cos(p.yaw) * side * 0.035;
                    this.fx.emit(3, { position: [p.x + back[0] + sx, p.y + back[1] + sy, p.z - 0.01], spread: 0.01, velocity: [-p.vx * 0.3, -p.vy * 0.3, -0.12], speed: 0.06, life: [0.3, 0.5], size: [0.018, 0.045], color: [1, 1, 1, 0.55], colorEnd: [1, 1, 1, 0] });
                }
            } else if (e === "crumple") {
                this.crumpleAt = this.time;
                this.trail.clear();
                // paper bits
                this.fx.emit(10, { position: [p.hit.x, p.hit.y, p.hit.z], spread: 0.02, velocity: [p.hit.nx * 0.25, p.hit.ny * 0.25, p.hit.nz * 0.25 + 0.1], speed: 0.35, life: [0.5, 0.9], size: [0.012, 0.006], color: [0.95, 0.94, 0.9, 1], colorEnd: [0.95, 0.94, 0.9, 0] });
            } else if (e === "glance") {
                this.fx.emit(4, { position: [p.hit.x, p.hit.y, p.hit.z], velocity: [p.hit.nx * 0.2, p.hit.ny * 0.2, p.hit.nz * 0.2], speed: 0.2, life: [0.2, 0.35], size: [0.01, 0], color: [1, 0.98, 0.9, 0.9] });
            } else if (e === "refold") {
                this.refoldAt = this.time;
                this.root.teleport();
                this.trail.clear();
            }
        }
        if (p.crumpled === 0) this.trail.push(p.x - back[0] * 0.8, p.y - back[1] * 0.8, p.z);
        this.state = p; this.foldInfo = fold;
    }

    /** Take the plane out of the scene. */
    dispose() {
        this.scene.remove(this.root);
        this.scene.remove(this.trail);
    }

    /**
     * Each rendered frame: flex, flutter, crumple and refold.
     * @param {number} dt real seconds
     * @param {{ reducedMotion?: boolean }} [opts]
     */
    frame(dt, opts = {}) {
        this.time += dt;
        const p = this.state, f = this.foldInfo;
        if (!p) return;
        const t = this.time;

        // crumple and refold: two shapes, scaled against each other
        const sinceCrumple = t - this.crumpleAt, sinceRefold = t - this.refoldAt;
        let plane = 1, ball = 0;
        if (p.crumpled > 0) {
            const k = clamp01(sinceCrumple / 0.12);
            plane = 1 - k * k; ball = easeOutBack(clamp01(sinceCrumple / 0.18));
        } else if (sinceRefold < 0.35) {
            const k = clamp01(sinceRefold / 0.3);
            plane = easeOutBack(k); ball = 1 - clamp01(sinceRefold / 0.1);
        }
        this.body.setScale(Math.max(plane, 0.001));
        this.ball.setScale(Math.max(ball, 0.001));
        this.body.visible = plane > 0.01;
        this.ball.visible = ball > 0.01;
        // can't be tagged yet: blink, or with reduced motion a steady glow instead
        const guarded = p.guard > 0 && p.crumpled === 0;
        if (guarded && !opts.reducedMotion) this.body.visible = ((t * 10) | 0) % 3 !== 0;
        this.material.emissive.fill(guarded && opts.reducedMotion ? 0.3 : 0);

        // flex: dihedral with speed, the flap's snap, flutter in a stall or rough air
        const speed01 = clamp01((p.speed - f.stall) / (f.max - f.stall));
        let tip = 0.004 + speed01 * 0.006;
        const sf = t - this.flapAt;
        if (sf < 0.07) tip -= 0.014 * (sf / 0.07);
        else if (sf < 0.18) tip += -0.014 + 0.02 * ((sf - 0.07) / 0.11);
        else if (sf < 0.35) tip += 0.006 * (1 - (sf - 0.18) / 0.17);
        const rough = p.stalled ? 1 : Math.min(1, (p.inFan + p.inGust) * 0.8);
        const shiver = rough * 0.004 * f.turbulence;
        const tl = tip + Math.sin(t * 41) * shiver, tr = tip + Math.sin(t * 37 + 1.3) * shiver;
        writeGeometry(this.geometry, tl, tr);
    }
}
