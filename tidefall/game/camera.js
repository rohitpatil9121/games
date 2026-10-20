import { rayIsland } from "./sim.js";
import { TOOLS, MOVE } from "./data.js";

/**
 * TIDEFALL: the third-person camera (the `camera-systems` skill).
 *
 * An orbit rig over the right shoulder, steered by the view yaw and pitch, on a spring arm: a ray from the
 * pivot back toward where the camera wants to be finds terrain or ruin walls in the way and pulls the
 * camera in front of them at once, then lets it out again slowly (pulling in late shows the inside of a
 * wall; letting out fast makes the view pump). All smoothing is exponential in real time, so it feels the
 * same at any frame rate. The pivot leads a little in the direction of travel.
 *
 * Water: `under` eases between 0 (in air) and 1 (under the surface) so the fog and colour grade fade
 * across rather than snapping, and the camera is kept a few centimetres off the surface itself, where
 * half the view would be above and half below.
 *
 * AIM: the crosshair is the middle of the screen, but tools leave from the player's head, which is off to
 * one side of the camera. aimAt() finds what is under the crosshair and gives the angles from the head
 * to it, so the grapple lands where the crosshair is, not a shoulder's width beside it.
 * @module game/camera
 */

const SHOULDER = 0.55, HEIGHT = 1.75, DISTANCE = 5.4;

export class ThirdPerson {
    /** @param {import("../engine/Camera.js").Camera} camera */
    constructor(camera) {
        this.camera = camera;
        this.distance = DISTANCE;
        this.lead = [0, 0];
        this.under = 0;
        this.pivot = [0, 0, 0];
        /** what the crosshair is on: the point, its distance from the head, and whether the grapple reaches */
        this.target = { x: 0, y: 0, z: 0, hit: false, reach: false, yaw: 0, pitch: 0 };
    }

    /**
     * @param {number} dt seconds
     * @param {{ x: number, y: number, z: number, vx?: number, vy?: number }} at the player, drawn position
     * @param {{ yaw: number, pitch: number }} view
     * @param {object} island
     * @param {number} level water height
     * @param {{ reducedMotion?: boolean, fov?: number }} [opts]
     */
    update(dt, at, view, island, level, opts = {}) {
        const cam = this.camera, yaw = view.yaw, pitch = view.pitch;
        // lead: a little ahead of where the player is going, eased so turning doesn't whip the view
        const k = 1 - Math.exp(-dt * 2.5), lx = (at.vx || 0) * 0.12, ly = (at.vy || 0) * 0.12;
        this.lead[0] += (lx - this.lead[0]) * k; this.lead[1] += (ly - this.lead[1]) * k;
        const rx = Math.sin(yaw), ry = -Math.cos(yaw);
        const px = at.x + rx * SHOULDER + this.lead[0], py = at.y + ry * SHOULDER + this.lead[1], pz = at.z + HEIGHT;
        this.pivot[0] = px; this.pivot[1] = py; this.pivot[2] = pz;

        // the spring arm
        const cp = Math.cos(pitch), bx = -cp * Math.cos(yaw), by = -cp * Math.sin(yaw), bz = -Math.sin(pitch);
        const hit = rayIsland(island, px, py, pz, bx, by, bz, DISTANCE + 0.4);
        const want = hit < 0 ? DISTANCE : Math.max(0.6, hit - 0.4);
        if (want < this.distance) this.distance = want;
        else this.distance += (want - this.distance) * (1 - Math.exp(-dt * 3));

        let ex = px + bx * this.distance, ey = py + by * this.distance, ez = pz + bz * this.distance;
        // never sit on the water's skin
        if (Math.abs(ez - level) < 0.12) ez = ez < level ? level - 0.12 : level + 0.12;
        // the engine's orbit camera: put its target at the pivot and solve the distance for the eye we chose
        cam.mode = "orbit";
        cam.yaw = yaw + Math.PI;
        cam.pitch = -pitch;
        cam.target[0] = px; cam.target[1] = py; cam.target[2] = pz;
        cam.distance = this.distance;
        if (ez !== pz + bz * this.distance) cam.target[2] += ez - (pz + bz * this.distance);

        const underNow = ez < level ? 1 : 0;
        this.under += (underNow - this.under) * (1 - Math.exp(-dt * 10));
        if (opts.fov) cam.fov += (opts.fov - cam.fov) * (1 - Math.exp(-dt * 8));
        this._eye = [ex, ey, ez];
        this._dir = [-bx, -by, -bz];
    }

    /**
     * What the crosshair is on, and the angles from the player's head to it.
     * @param {object} island
     * @param {{ x: number, y: number, z: number }} me the player's simulated position (not the drawn one)
     */
    aimAt(island, me) {
        const t = this.target;
        if (!this._eye) return t;
        const [ex, ey, ez] = this._eye, [dx, dy, dz] = this._dir;
        const far = 80, d = rayIsland(island, ex, ey, ez, dx, dy, dz, far);
        const dist = d < 0 ? far : d;
        t.x = ex + dx * dist; t.y = ey + dy * dist; t.z = ez + dz * dist; t.hit = d >= 0;
        const hx = me.x, hy = me.y, hz = me.z + 1.5, ox = t.x - hx, oy = t.y - hy, oz = t.z - hz, len = Math.hypot(ox, oy, oz);
        t.reach = t.hit && len <= TOOLS.grapple.range && len > 1.2;
        t.yaw = Math.atan2(oy, ox);
        t.pitch = Math.atan2(oz, Math.hypot(ox, oy));
        return t;
    }
}

export { MOVE };
