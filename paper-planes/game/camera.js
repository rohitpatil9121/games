import { Camera, rayAABB } from "../engine/index.js";

/**
 * PAPER PLANES: the chase camera (the `camera-systems` skill).
 *
 * - Sits behind the plane along the view direction (the mouse-aim direction, or the plane's own heading when
 *   steering by keys), a little above, on a spring arm: a ray from the plane back toward where the camera
 *   wants to be pulls it in front of any furniture or wall at once, and lets it out slowly.
 * - Smooths in real time (exponential), so it feels the same at any frame rate.
 * - Leans into turns: `RollCamera` rolls the engine camera's basis around its forward axis. Comfort settings
 *   scale the lean and the speed FOV kick, and horizon lock turns the lean off.
 * @module game/camera
 */

/** The engine camera plus a roll around its view axis (the engine's basis always keeps world-up up). */
export class RollCamera extends Camera {
    constructor(options) { super(options); this.roll = 0; }
    update(dt) {
        super.update(dt);
        if (this.roll) {
            const c = Math.cos(this.roll), s = Math.sin(this.roll), r = this.right, u = this.up;
            for (let i = 0; i < 3; i++) {
                const ri = r[i], ui = u[i];
                r[i] = ri * c + ui * s; u[i] = ui * c - ri * s; this.left[i] = -r[i];
            }
        }
        return this;
    }
}

const DISTANCE = 0.5, LIFT = 0.09, MARGIN = 0.04;

export class ChaseCamera {
    /** @param {RollCamera} camera @param {object} room */
    constructor(camera, room) {
        this.camera = camera;
        this.room = room;
        this.distance = DISTANCE;
        this.yaw = 0; this.pitch = 0; this.roll = 0;
        this.focus = [0, 0, 0];
        this.ready = false;
        /** comfort: 0..1 of the lean, FOV kick on/off, horizon lock */
        this.lean = 1; this.fovKick = true; this.horizonLock = false;
        this.baseFov = 70;
    }

    /**
     * @param {number} dt real seconds
     * @param {number[]} at the plane's drawn position
     * @param {number} viewYaw @param {number} viewPitch where to look from behind
     * @param {number} bank the plane's roll
     * @param {number} speed01 0 at cruise, 1 at top speed
     */
    update(dt, at, viewYaw, viewPitch, bank, speed01) {
        const k = this.ready ? 1 - Math.exp(-dt * 7) : 1, kr = this.ready ? 1 - Math.exp(-dt * 4) : 1;
        this.ready = true;
        let dy = viewYaw - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * k;
        this.pitch += (viewPitch - this.pitch) * k;
        for (let i = 0; i < 3; i++) this.focus[i] += (at[i] - this.focus[i]) * (this.ready ? 1 - Math.exp(-dt * 18) : 1);
        const wantRoll = this.horizonLock ? 0 : -bank * 0.35 * this.lean;
        this.roll += (wantRoll - this.roll) * kr;

        // where the camera wants to be: behind and a little above
        const elev = 0.2 - this.pitch * 0.85;
        const cp = Math.cos(elev), bx = -cp * Math.cos(this.yaw), by = -cp * Math.sin(this.yaw), bz = Math.sin(elev);
        const o = [this.focus[0], this.focus[1], this.focus[2] + LIFT * 0.5];
        const hit = this._ray(o, [bx, by, bz], DISTANCE + MARGIN);
        const want = hit < 0 ? DISTANCE : Math.max(0.12, hit - MARGIN);
        if (want < this.distance) this.distance = want;
        else this.distance += (want - this.distance) * (1 - Math.exp(-dt * 2.5));

        const cam = this.camera;
        cam.mode = "orbit";
        cam.target[0] = o[0]; cam.target[1] = o[1]; cam.target[2] = o[2];
        cam.yaw = Math.atan2(by, bx);
        cam.pitch = elev;
        cam.distance = this.distance;
        cam.roll = this.roll;
        const fov = this.baseFov + (this.fovKick ? 12 * Math.max(0, Math.min(1, speed01)) : 0);
        cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 5));
    }

    /** distance along a ray to the first box or wall, or -1 */
    _ray(o, d, far) {
        let best = -1;
        const consider = (t) => { if (t >= 0 && t <= far && (best < 0 || t < best)) best = t; };
        for (const b of this.room.boxes) consider(rayAABB(o, d, [b.min[0] - 0.03, b.min[1] - 0.03, b.min[2] - 0.03], [b.max[0] + 0.03, b.max[1] + 0.03, b.max[2] + 0.03]));
        const { min, max } = this.room.size;
        for (let i = 0; i < 3; i++) {
            if (d[i] > 1e-9) consider((max[i] - 0.03 - o[i]) / d[i]);
            else if (d[i] < -1e-9) consider((min[i] + 0.03 - o[i]) / d[i]);
        }
        return best;
    }
}
