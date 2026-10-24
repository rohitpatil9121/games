import { dsin, dcos } from "./det.js";
import { DT } from "./data.js";

/**
 * PAPER PLANES: Ring Run. Pure: no DOM, deterministic, so the server can referee it later like the rest.
 *
 * A ring is a disc (`at`, normal from yaw/pitch, radius `r`). A plane passes it when the segment it flew this
 * tick crosses the disc's plane inside the radius (either way through). Rings must be passed in order; a run
 * starts at the first ring and its time stops at the last.
 * @module game/rings
 */

/** the ring's unit normal */
export function ringNormal(ring, out = [0, 0, 0]) {
    const cp = dcos(ring.pitch);
    out[0] = cp * dcos(ring.yaw); out[1] = cp * dsin(ring.yaw); out[2] = dsin(ring.pitch);
    return out;
}

const n = [0, 0, 0];

/**
 * Did the segment from (ax, ay, az) to (bx, by, bz) pass through the ring? The plane's own radius counts a
 * little against it: the centre has to clear the rim by half the plane's radius, so a scrape is a miss.
 */
export function crosses(ring, ax, ay, az, bx, by, bz, slack = 0.0175) {
    ringNormal(ring, n);
    const da = (ax - ring.at[0]) * n[0] + (ay - ring.at[1]) * n[1] + (az - ring.at[2]) * n[2];
    const db = (bx - ring.at[0]) * n[0] + (by - ring.at[1]) * n[1] + (bz - ring.at[2]) * n[2];
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return false;
    const t = da / (da - db);
    const x = ax + (bx - ax) * t - ring.at[0], y = ay + (by - ay) * t - ring.at[1], z = az + (bz - az) * t - ring.at[2];
    const r = ring.r - slack;
    return x * x + y * y + z * z <= r * r;
}

/** One player's run through one set. */
export class RingRun {
    /** @param {{ name: string, rings: object[] }} set */
    constructor(set) {
        this.set = set;
        /** the next ring to pass */
        this.next = 0;
        /** ticks since the first ring (0 until it's passed) */
        this.ticks = 0;
        this.done = false;
        /** split times (seconds) at each ring after the first */
        this.splits = [];
    }

    get ring() { return this.set.rings[this.next] || null; }
    get seconds() { return this.ticks * DT; }

    /**
     * Advance one tick with the segment the plane flew. Returns "ring" when it passed the next ring,
     * "done" when that was the last, otherwise null.
     */
    step(ax, ay, az, bx, by, bz) {
        if (this.done) return null;
        if (this.next > 0) this.ticks++;
        const ring = this.ring;
        if (!ring || !crosses(ring, ax, ay, az, bx, by, bz)) return null;
        if (this.next > 0) this.splits.push(this.seconds);
        this.next++;
        if (this.next >= this.set.rings.length) { this.done = true; return "done"; }
        return "ring";
    }
}
