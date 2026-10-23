import { rayWorld } from "./islands.js";
import { GLIDE } from "./data.js";

/**
 * SKYFARM: the cameras (the `camera-systems` skill, after TIDEFALL's camera.js).
 *
 * On foot: an orbit rig behind the player steered by the view yaw and pitch, on a spring arm. A ray from the
 * pivot back toward where the camera wants to be finds rock, walls or roofs in the way and pulls the camera in
 * at once, then lets it out slowly (in late shows the inside of a wall; out fast makes the view pump).
 *
 * Gliding: a chase camera. The view swings in behind the glider's heading unless you've just looked around
 * with the mouse or stick, looks slightly down so the ground ahead stays in frame, sits further back, and
 * widens its field of view with speed (60° → 72°; less with "reduced FOV kick", none with "reduce motion").
 *
 * All smoothing is exponential in real time, so it feels the same at any frame rate.
 * @module game/camera
 */

const HEIGHT = 1.6, FOOT_DISTANCE = 5.2, GLIDE_DISTANCE = 7.5;

export class Rig {
    /** @param {import("../engine/Camera.js").Camera} camera */
    constructor(camera) {
        this.camera = camera;
        this.distance = FOOT_DISTANCE;
        this.eye = [0, 0, 0];
        this.baseFov = 58;
    }

    /**
     * @param {number} dt real seconds
     * @param {{ x: number, y: number, z: number, glide: number, yaw: number, pitch: number, speed: number }} pose the drawn player
     * @param {{ yaw: number, pitch: number, idle: number }} view the view direction; `idle` is seconds since the player last looked around
     * @param {object} world
     * @param {{ reducedMotion?: boolean, reducedFov?: boolean }} [opts]
     */
    update(dt, pose, view, world, opts = {}) {
        const cam = this.camera, gliding = pose.glide > 0;
        if (gliding && view.idle > 0.8) {
            // swing in behind the heading, looking a little down
            const k = 1 - Math.exp(-dt * 2.2);
            let d = pose.yaw - view.yaw;
            d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
            view.yaw += d * k;
            view.pitch += (-0.22 + pose.pitch * 0.4 - view.pitch) * k;
        }
        const yaw = view.yaw, pitch = view.pitch;
        const px = pose.x, py = pose.y, pz = pose.z + HEIGHT;
        const cp = Math.cos(pitch), bx = -cp * Math.cos(yaw), by = -cp * Math.sin(yaw), bz = -Math.sin(pitch);
        const far = gliding ? GLIDE_DISTANCE : FOOT_DISTANCE;
        const hit = rayWorld(world, px, py, pz, bx, by, bz, far + 0.4);
        const want = hit < 0 ? far : Math.max(0.7, hit - 0.4);
        if (want < this.distance) this.distance = want;
        else this.distance += (want - this.distance) * (1 - Math.exp(-dt * 2.5));

        cam.mode = "orbit";
        cam.yaw = yaw + Math.PI;
        cam.pitch = -pitch;
        cam.target[0] = px; cam.target[1] = py; cam.target[2] = pz;
        cam.distance = this.distance;
        this.eye[0] = px + bx * this.distance; this.eye[1] = py + by * this.distance; this.eye[2] = pz + bz * this.distance;

        // field of view: wider with speed while gliding
        let fov = this.baseFov;
        if (gliding && !opts.reducedMotion) {
            const kick = opts.reducedFov ? 4 : 12;
            fov += 2 + kick * Math.max(0, Math.min(1, (pose.speed - GLIDE.cruise * 0.8) / (GLIDE.max - GLIDE.cruise)));
        }
        cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));

        // lean into turns while gliding (engine Camera.roll): 10° at full bank, 3° with "reduced roll", none with "reduce motion"
        const maxLean = opts.reducedMotion ? 0 : opts.reducedRoll ? 0.05 : 0.17;
        const lean = gliding ? -(pose.roll / GLIDE.maxRoll) * maxLean : 0;
        cam.roll += (lean - cam.roll) * (1 - Math.exp(-dt * 3));
    }
}
