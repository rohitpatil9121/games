import { FLIGHT, FOLDS, DT, TICK_RATE, BTN } from "./data.js";
import { dsin, dcos, datan2, clamp, PI, TAU } from "./det.js";
import { sample, makeAir } from "./air.js";

/**
 * PAPER PLANES: the flight simulation. Pure and deterministic: no DOM, no Math.sin, no clock. The server,
 * the predicting client, Practice and the Node tools all run this same code (TIDEFALL's rule).
 *
 * The flight model (the `physics-tuning` skill: fixed 60 Hz step, swept collisions, every number in data.js):
 * - A plane has a heading (yaw), a flight-path angle (pitch), a bank (roll) and an airspeed.
 * - Energy: gravity along the path speeds a dive and slows a climb; drag is k·v², with k chosen so that the
 *   fold's glide angle holds its cruise speed exactly. Banking adds drag, so turning costs energy.
 * - Turning: bank turns the heading, at the fold's turn rate times the bank fraction.
 * - Stall: under the stall speed the nose drops and the wings wobble until the plane is back over it.
 * - The air: the plane flies through the air, and the air carries it. Ground velocity is airspeed along the
 *   nose plus the wind (scaled by the fold: darts cut through it, gliders get carried), so a fan blowing
 *   head-on can push a plane backwards. Sideways wind rolls the plane, which is what turbulence feels like.
 * - Collisions are a sphere swept along the tick's segment against the room's boxes and walls, so nothing
 *   can pass through a 2 cm shelf at any speed. A steep fast hit crumples the plane; anything else glances.
 * @module game/sim
 */

const MAX_PITCH = FLIGHT.maxPitch;

/** the flight-path angle a fold glides at: tan = 1 / glide ratio */
export const glideAngle = (fold) => datan2(1, FOLDS[fold].glide);

/** drag constant so that gliding at the fold's glide angle holds cruise speed */
function dragK(f) {
    const sinG = 1 / Math.sqrt(1 + f.glide * f.glide);
    return (FLIGHT.gravity * sinG) / (f.cruise * f.cruise);
}

/**
 * A new plane at a launch spot.
 * @param {number} id
 * @param {"dart" | "glider" | "stunt"} fold
 * @param {{ at: number[], yaw: number }} launch
 */
export function createPlane(id, fold, launch) {
    const p = {
        id, fold,
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, bump: 0,
        /** ground velocity this tick (for the camera, sound, effects and interpolation) */
        vx: 0, vy: 0, vz: 0,
        /** ticks until the flap is ready; ticks a pressed flap waits in the buffer */
        flapWait: 0, flapBuffer: 0,
        stalled: false,
        /** ticks left crumpled (0 = flying), and ticks of refold protection */
        crumpled: 0, guard: 0,
        /** buttons held last tick (for press edges) */
        held: 0,
        /** the plane's own clock: ticks of input applied (TIDEFALL's rule: the air it flies through is at this time) */
        clock: 0,
        /** what happened this tick: "flap", "stall", "glance", "crumple", "refold", "floor" */
        events: [],
        /** strongest air sources felt this tick (0..1), for effects and the HUD */
        inFan: 0, inLift: 0, inGust: 0,
        /** where the last glance or crumple happened, and its normal */
        hit: { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 },
    };
    placeAt(p, launch);
    return p;
}

function placeAt(p, launch) {
    const f = FOLDS[p.fold];
    p.x = launch.at[0]; p.y = launch.at[1]; p.z = launch.at[2];
    p.yaw = launch.yaw; p.pitch = -glideAngle(p.fold); p.roll = 0;
    p.speed = f.cruise; p.bump = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.stalled = false;
}

/** the nearest launch spot to a point */
export function nearestLaunch(room, x, y, z) {
    let best = room.launches[0], bd = Infinity;
    for (const l of room.launches) {
        const d = (l.at[0] - x) ** 2 + (l.at[1] - y) ** 2 + (l.at[2] - z) ** 2;
        if (d < bd) { bd = d; best = l; }
    }
    return best;
}

const air = makeAir();
const wrap = (a) => (a > PI ? a - TAU : a < -PI ? a + TAU : a);

/**
 * Advance one plane by one tick.
 * @param {ReturnType<typeof createPlane>} p
 * @param {{ pitch: number, roll: number, buttons: number }} input pitch and roll in −127..127 (up and right
 *        positive), buttons as BTN bits
 * @param {object} room
 * @param {number} seed the round's seed (gust timing)
 */
export function stepPlane(p, input, room, seed) {
    p.events.length = 0;
    const t = p.clock * DT;
    p.clock++;
    const f = FOLDS[p.fold];
    const pressed = input.buttons & ~p.held;
    p.held = input.buttons;
    if (p.guard > 0) p.guard--;
    if (p.flapWait > 0) p.flapWait--;

    if (p.crumpled > 0) { stepCrumpled(p, room); return p; }

    // ---- steering
    const wantRoll = clamp(input.roll / 127, -1, 1) * FLIGHT.maxRoll;
    const dr = wantRoll - p.roll, maxDr = f.roll * DT;
    p.roll += dr > maxDr ? maxDr : dr < -maxDr ? -maxDr : dr;

    const ip = clamp(input.pitch / 127, -1, 1), trim = -glideAngle(p.fold);
    if (ip > 0.04 || ip < -0.04) {
        // pulling up has less authority as the plane slows: it can't climb on nothing
        const authority = ip > 0 ? clamp(p.speed / f.cruise, 0.25, 1) : 1;
        p.pitch += ip * FLIGHT.pitchRate * authority * DT;
    } else {
        const d = trim - p.pitch, m = FLIGHT.trimRate * DT;
        p.pitch += d > m ? m : d < -m ? -m : d;
    }

    // ---- stall
    if (!p.stalled && p.speed < f.stall) { p.stalled = true; p.events.push("stall"); }
    else if (p.stalled && p.speed > f.stall * FLIGHT.stallExit) p.stalled = false;
    if (p.stalled) {
        const depth = clamp(1 - p.speed / (f.stall * FLIGHT.stallExit), 0.3, 1);
        p.pitch -= FLIGHT.stallDrop * depth * DT;
        p.roll += FLIGHT.stallWobble * depth * dsin(p.clock * 0.42 + p.id * 1.3) * DT * 6;
    }
    p.pitch = clamp(p.pitch, -MAX_PITCH, MAX_PITCH);
    p.roll = clamp(p.roll, -FLIGHT.maxRoll * 1.3, FLIGHT.maxRoll * 1.3);

    // ---- turning: right bank (roll > 0) turns right (yaw decreases, yaw is counter-clockwise from +X)
    const turn = (f.turn * PI) / 180;
    p.yaw = wrap(p.yaw - turn * (p.roll / FLIGHT.maxRoll) * clamp(p.speed / f.cruise, 0.6, 1.3) * DT);

    // ---- energy
    const sp = dsin(p.pitch), cp = dcos(p.pitch);
    const bank = p.roll < 0 ? -p.roll : p.roll;
    const drag = dragK(f) * p.speed * p.speed * (1 + FLIGHT.bankDrag * (bank / FLIGHT.maxRoll));
    p.speed += (-FLIGHT.gravity * sp - drag) * DT;

    // ---- flap (buffered)
    if (pressed & BTN.flap) p.flapBuffer = FLIGHT.flapBuffer;
    if (p.flapBuffer > 0) {
        if (p.flapWait <= 0) {
            p.speed += FLIGHT.flapSpeed; p.bump += FLIGHT.flapLift;
            p.flapWait = Math.round(f.flap * TICK_RATE); p.flapBuffer = 0;
            p.events.push("flap");
        } else p.flapBuffer--;
    }
    p.speed = clamp(p.speed, FLIGHT.minSpeed, f.max);
    p.bump -= p.bump * FLIGHT.flapLiftFade * DT;

    // ---- the air
    sample(room, seed, t, p.x, p.y, p.z, air);
    p.inFan = air.fan; p.inLift = air.lift; p.inGust = air.gust;
    const cy = dcos(p.yaw), sy = dsin(p.yaw);
    const wz = air.z > 0 ? air.z * f.thermal : air.z * f.wind;
    const ax = air.x + air.tx, ay = air.y + air.ty;
    let vx = p.speed * cp * cy + ax * f.wind;
    let vy = p.speed * cp * sy + ay * f.wind;
    let vz = p.speed * sp + p.bump + wz + air.tz * f.wind;
    // sideways air across the wings rolls the plane (turbulence felt as wobble), scaled by the fold
    const side = -ax * sy + ay * cy;
    p.roll -= side * 1.8 * f.turbulence * DT;

    // ---- move, swept against the room
    p.vx = vx; p.vy = vy; p.vz = vz;
    move(p, room, f);
    return p;
}

function stepCrumpled(p, room) {
    p.crumpled--;
    const r = FLIGHT.radius, floor = room.size.min[2] + r;
    if (p.z > floor) {
        // flutter down in a lazy spiral
        const ph = p.crumpled * 0.21 + p.id;
        p.vx = dcos(ph) * 0.25; p.vy = dsin(ph) * 0.25; p.vz = -FLIGHT.crumpleFall;
        p.x = clamp(p.x + p.vx * DT, room.size.min[0] + r, room.size.max[0] - r);
        p.y = clamp(p.y + p.vy * DT, room.size.min[1] + r, room.size.max[1] - r);
        p.z = Math.max(floor, p.z + p.vz * DT);
        // land on furniture rather than through it
        for (const b of room.boxes) if (inside(p.x, p.y, p.z, b, r)) { p.z = b.max[2] + r; p.vz = 0; }
    } else { p.vx = 0; p.vy = 0; p.vz = 0; }
    if (p.crumpled === 0) {
        placeAt(p, nearestLaunch(room, p.x, p.y, p.z));
        p.guard = Math.round(FLIGHT.refoldGuard * TICK_RATE);
        p.flapWait = 0;
        p.events.push("refold");
    }
}

const inside = (x, y, z, b, r) => x > b.min[0] - r && x < b.max[0] + r && y > b.min[1] - r && y < b.max[1] + r && z > b.min[2] - r && z < b.max[2] + r;

const hit = { t: 1, nx: 0, ny: 0, nz: 0 };

/**
 * Earliest time in [0, 1] the segment from (x, y, z) along (dx, dy, dz) enters a box grown by r (slab test).
 * Writes the face normal. Returns false if it doesn't, or starts inside.
 */
function segBox(x, y, z, dx, dy, dz, b, r, out) {
    let tin = -Infinity, tout = Infinity, axis = -1, sign = 0;
    const o = [x, y, z], d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
        const lo = b.min[i] - r, hi = b.max[i] + r;
        if (d[i] === 0) { if (o[i] <= lo || o[i] >= hi) return false; continue; }
        let t0 = (lo - o[i]) / d[i], t1 = (hi - o[i]) / d[i], s = -1;
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
        if (t0 > tin) { tin = t0; axis = i; sign = s; }
        if (t1 < tout) tout = t1;
        if (tin > tout) return false;
    }
    if (tin < 0 || tin > out.t || axis < 0) return false;
    out.t = tin; out.nx = axis === 0 ? sign : 0; out.ny = axis === 1 ? sign : 0; out.nz = axis === 2 ? sign : 0;
    return true;
}

/** the same for leaving the inside of the room's walls */
function segShell(x, y, z, dx, dy, dz, s, r, out) {
    const o = [x, y, z], d = [dx, dy, dz];
    let found = false;
    for (let i = 0; i < 3; i++) {
        if (d[i] > 0) {
            const t = (s.max[i] - r - o[i]) / d[i];
            if (t >= 0 && t < out.t) { out.t = t; out.nx = i === 0 ? -1 : 0; out.ny = i === 1 ? -1 : 0; out.nz = i === 2 ? -1 : 0; found = true; }
        } else if (d[i] < 0) {
            const t = (s.min[i] + r - o[i]) / d[i];
            if (t >= 0 && t < out.t) { out.t = t; out.nx = i === 0 ? 1 : 0; out.ny = i === 1 ? 1 : 0; out.nz = i === 2 ? 1 : 0; found = true; }
        }
    }
    return found;
}

function move(p, room, f) {
    const r = FLIGHT.radius;
    // up to three passes: hit, slide along the surface for the rest of the tick, maybe hit again (a corner)
    let left = 1;
    for (let pass = 0; pass < 3 && left > 1e-6; pass++) {
        const dx = p.vx * DT * left, dy = p.vy * DT * left, dz = p.vz * DT * left;
        hit.t = 1;
        let any = segShell(p.x, p.y, p.z, dx, dy, dz, room.size, r, hit);
        for (const b of room.boxes) if (segBox(p.x, p.y, p.z, dx, dy, dz, b, r, hit)) any = true;
        if (!any) { p.x += dx; p.y += dy; p.z += dz; return; }
        // stop just short of the surface
        const t = Math.max(0, hit.t - 1e-4);
        p.x += dx * t; p.y += dy * t; p.z += dz * t;
        left *= 1 - t;
        if (!collide(p, f, r)) return;
    }
}

/** respond to the surface in `hit`; false when the plane crumpled (stop moving) */
function collide(p, f, r) {
    const nx = hit.nx, ny = hit.ny, nz = hit.nz;
    const gs = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 1e-9;
    const closing = -(p.vx * nx + p.vy * ny + p.vz * nz);
    const h = p.hit;
    h.x = p.x - nx * r; h.y = p.y - ny * r; h.z = p.z - nz * r; h.nx = nx; h.ny = ny; h.nz = nz; h.speed = closing;

    if (closing > FLIGHT.crumpleSpeed && closing / gs > dsin(FLIGHT.crumpleAngle)) {
        p.crumpled = Math.round(FLIGHT.refoldTime * TICK_RATE);
        p.stalled = false; p.bump = 0; p.speed = 0;
        p.events.push("crumple");
        return false;
    }
    // glance: lose the part into the surface (with a little bounce), keep most of the rest. A light touch
    // (the wind leaning the plane on a wall) only scrapes, so riding along a wall doesn't kill the speed.
    const hard = closing > FLIGHT.scrapeSpeed;
    const k = closing * (1 + (hard ? FLIGHT.bounce : 0));
    const keep = hard ? FLIGHT.glanceKeep : FLIGHT.scrapeKeep;
    let vx = (p.vx + nx * k) * keep, vy = (p.vy + ny * k) * keep, vz = (p.vz + nz * k) * keep;
    p.vx = vx; p.vy = vy; p.vz = vz;
    // the nose follows the new direction
    const hs = Math.sqrt(vx * vx + vy * vy);
    if (hs > 0.05) p.yaw = datan2(vy, vx);
    p.pitch = clamp(datan2(vz, hs), -MAX_PITCH, MAX_PITCH);
    if (nz > 0.5 && p.pitch < 0) p.pitch = 0;
    p.speed = clamp(Math.sqrt(vx * vx + vy * vy + vz * vz), FLIGHT.minSpeed, f.max);
    if (hard) {
        p.bump = 0;
        p.roll += 0.35 * (((p.clock + p.id) & 1) ? 1 : -1);
        p.events.push(nz > 0.5 ? "floor" : "glance");
    }
    return true;
}
