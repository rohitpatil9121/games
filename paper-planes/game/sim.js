import { FLIGHT, FOLDS, DT, TICK_RATE, BTN, HISTORY, MAX_REWIND, TAG, MATCH } from "./data.js";
import { RingRun } from "./rings.js";
import { dsin, dcos, datan2, clamp, hash3, PI, TAU } from "./det.js";
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
const GLIDE = {};
export const glideAngle = (fold) => GLIDE[fold] ?? (GLIDE[fold] = datan2(1, FOLDS[fold].glide));

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
        /** tag: "it" (Classic) or a hunter (Ink Spread); ink is the hunters' mark in Ink Spread */
        it: false, ink: false,
        /** ticks as "it", tags made, erasers picked up, a shield from an eraser (Ink Spread) */
        itTicks: 0, tags: 0, erasers: 0, shield: 0,
        /** can't tag `noBackId` back for `noBack` more ticks */
        noBack: 0, noBackId: 0,
        /** ticks survived clean (Ink Spread) */
        clean: 0,
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
 * @param {boolean} [calm] fly through the air without its turbulence (bots' look-ahead only)
 */
export function stepPlane(p, input, room, seed, calm = false) {
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
            p.flapWait = Math.round(f.flap * TICK_RATE * (p.it ? TAG.itFlap : 1)); p.flapBuffer = 0;
            p.events.push("flap");
        } else p.flapBuffer--;
    }
    p.speed = clamp(p.speed, FLIGHT.minSpeed, f.max);
    p.bump -= p.bump * FLIGHT.flapLiftFade * DT;

    // ---- the air
    sample(room, seed, t, p.x, p.y, p.z, air, calm);
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
    const bn = b.min, bx = b.max;
    const x0 = bn[0] - r, x1 = bx[0] + r, y0 = bn[1] - r, y1 = bx[1] + r, z0 = bn[2] - r, z1 = bx[2] + r;
    // broad phase: the segment's own box misses the grown box (most boxes, most ticks)
    if ((x < x0 && x + dx < x0) || (x > x1 && x + dx > x1) || (y < y0 && y + dy < y0) || (y > y1 && y + dy > y1) || (z < z0 && z + dz < z0) || (z > z1 && z + dz > z1)) return false;
    slab.tin = -Infinity; slab.tout = Infinity; slab.axis = -1; slab.sign = 0;
    if (!axisSlab(x, dx, x0, x1, 0) || !axisSlab(y, dy, y0, y1, 1) || !axisSlab(z, dz, z0, z1, 2)) return false;
    const tin = slab.tin;
    if (tin < 0 || tin > out.t || slab.axis < 0) return false;
    const axis = slab.axis, sign = slab.sign;
    out.t = tin; out.nx = axis === 0 ? sign : 0; out.ny = axis === 1 ? sign : 0; out.nz = axis === 2 ? sign : 0;
    return true;
}
const slab = { tin: 0, tout: 0, axis: -1, sign: 0 };
/** one axis of the slab test: narrows [tin, tout]; false when the segment can't be inside on this axis */
function axisSlab(o, d, lo, hi, i) {
    if (d === 0) return o > lo && o < hi;
    let t0 = (lo - o) / d, t1 = (hi - o) / d, s = -1;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > slab.tin) { slab.tin = t0; slab.axis = i; slab.sign = s; }
    if (t1 < slab.tout) slab.tout = t1;
    return slab.tin <= slab.tout;
}

/** the same for leaving the inside of the room's walls */
function segShell(x, y, z, dx, dy, dz, s, r, out) {
    let found = false;
    for (let i = 0; i < 3; i++) {
        const o = i === 0 ? x : i === 1 ? y : z, d = i === 0 ? dx : i === 1 ? dy : dz;
        if (d > 0) {
            const t = (s.max[i] - r - o) / d;
            if (t >= 0 && t < out.t) { out.t = t; out.nx = i === 0 ? -1 : 0; out.ny = i === 1 ? -1 : 0; out.nz = i === 2 ? -1 : 0; found = true; }
        } else if (d < 0) {
            const t = (s.min[i] + r - o) / d;
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

/**
 * The input that steers a plane toward a direction: bank toward the heading, pitch toward the angle. Used by
 * mouse-aim and by bots, so both fly through exactly the same controls as keys do.
 * @param {{ yaw: number, pitch: number }} p the plane
 * @param {number} yaw @param {number} pitch the wanted direction
 * @returns {{ pitch: number, roll: number }} −127..127
 */
export function steerToward(p, yaw, pitch) {
    let ey = yaw - p.yaw;
    while (ey > PI) ey -= TAU;
    while (ey < -PI) ey += TAU;
    const roll = clamp(-ey * 2.4, -1, 1), up = clamp((pitch - p.pitch) * 3.2, -1, 1);
    return { pitch: Math.round(up * 127), roll: Math.round(roll * 127) };
}

// ------------------------------------------------------------------ the match: every plane in a room

/**
 * A match: the room it's in, the seed (gust timing), the server tick, every player's plane, and this
 * tick's events. The Room (server/room.mjs) owns one and steps it; Practice runs the same Room in the page.
 * @param {object} room a room file (game/rooms)
 * @param {number} seed
 * @param {{ mode?: string, set?: number }} [options] mode "rings" (Ring Run, set `set`), "tag" (Classic Tag) or
 *        "spread" (Ink Spread)
 */
export function createState(room, seed, options = {}) {
    const mode = options.mode || "rings", tag = mode === "tag" || mode === "spread";
    return {
        room, seed: seed >>> 0, tick: 0, mode, set: options.set || 0, phase: "play", overTicks: 0, players: [], events: [],
        /** tag modes: ticks left in the round, ticks of grace before the first "it" is picked */
        clock: tag ? Math.round((mode === "tag" ? TAG.classic : TAG.spread) * TICK_RATE) : 0,
        grace: tag ? Math.round(TAG.grace * TICK_RATE) : 0,
        /** erasers: each slot is a spot (index into room.erasers) and the tick it's back */
        erasers: tag && room.erasers ? Array.from({ length: Math.min(TAG.eraser.slots, room.erasers.length) }, (_, i) => ({ spot: i, at: 0 })) : [],
        /** when the round is over: who won */
        winners: [],
    };
}

/**
 * Add a player's plane at a launch spot (spread out: the spot the fewest planes are near).
 * @param {{ fold?: string, bot?: number }} [options]
 */
export function addPlayer(state, id, name, options = {}) {
    const fold = FOLDS[options.fold] ? options.fold : "glider";
    const p = createPlane(id, fold, freeLaunch(state));
    p.name = name; p.bot = options.bot || 0; p.seq = 0;
    p.clock = state.tick;
    /** where this plane was, for each of the last HISTORY ticks (lag-compensated tags) */
    p.hist = new Float64Array(HISTORY * 3);
    p.run = state.mode === "rings" ? new RingRun(state.room.rings[state.set]) : null;
    /** best Ring Run time this visit, in ticks (0 = none) */
    p.best = 0;
    // a late arrival in Ink Spread joins the hunters: there's nothing fair about arriving clean at the end
    if (state.mode === "spread" && state.grace === 0 && state.players.some((q) => q.it)) { p.it = true; p.ink = true; }
    for (let i = 0; i < HISTORY; i++) { p.hist[i * 3] = p.x; p.hist[i * 3 + 1] = p.y; p.hist[i * 3 + 2] = p.z; }
    state.players.push(p);
    return p;
}

export function removePlayer(state, id) {
    const i = state.players.findIndex((p) => p.id === id);
    if (i >= 0) state.players.splice(i, 1);
}

export function findPlayer(state, id) {
    for (const p of state.players) if (p.id === id) return p;
    return null;
}

/** the launch spot with the most room: farthest from its nearest plane */
function freeLaunch(state) {
    let best = state.room.launches[0], score = -1;
    for (const l of state.room.launches) {
        let near = Infinity;
        for (const p of state.players) near = Math.min(near, (p.x - l.at[0]) ** 2 + (p.y - l.at[1]) ** 2 + (p.z - l.at[2]) ** 2);
        if (near > score) { score = near; best = l; }
    }
    return best;
}

/** Change a player's fold: it refolds at a launch spot (folding takes a moment, so it can't be a dodge). */
export function setFold(state, p, fold) {
    if (!FOLDS[fold] || fold === p.fold) return;
    p.fold = fold;
    placeAt(p, nearestLaunch(state.room, p.x, p.y, p.z));
    p.crumpled = 0; p.guard = Math.round(FLIGHT.refoldGuard * TICK_RATE);
    if (p.run) p.run = new RingRun(p.run.set);
    state.events.push({ type: "refold", id: p.id });
}

const idleInput = { seq: 0, pitch: 0, roll: 0, buttons: 0, lag: 0 };

/**
 * One server tick. `inputs` maps a player id to the inputs that arrived for it (an array, possibly empty
 * after a stall, possibly several after one): each is applied in order, one tick of that plane's own clock
 * each. A plane with no entry at all (a bot without a brain) flies on hands-off.
 * @param {Map<number, object | object[]>} inputs
 */
export function step(state, inputs) {
    state.events.length = 0;
    state.tick++;
    if (state.phase === "over") { if (state.overTicks > 0) state.overTicks--; return; }
    const n = state.players.length, first = n ? state.tick % n : 0;
    for (let k = 0; k < n; k++) {
        const p = state.players[(first + k) % n];
        const given = inputs.get(p.id);
        // a plane whose clock fell far behind (a long stall) is brought up to the present
        if (p.clock < state.tick - 60) p.clock = state.tick - 60;
        // an empty list means its inputs are late: the plane waits for them (its clock with it), and catches
        // up when they come, so the client's prediction is exactly what happens
        if (Array.isArray(given)) for (let i = 0; i < given.length; i++) applyInput(state, p, given[i]);
        else if (given) applyInput(state, p, given);
        else { idleInput.seq = p.seq; p.clock = state.tick - 1; applyInput(state, p, idleInput); }
    }
    const slot = (state.tick & (HISTORY - 1)) * 3;
    for (const p of state.players) { p.hist[slot] = p.x; p.hist[slot + 1] = p.y; p.hist[slot + 2] = p.z; }
    if (state.mode === "tag" || state.mode === "spread") tagRules(state);
}

/**
 * One input for one plane: the flight step, then the mode's rules. The client runs this same function to
 * predict its own plane, so everything it reads must be in the snapshot of that plane.
 */
export function applyInput(state, p, input) {
    p.seq = input.seq;
    const ax = p.x, ay = p.y, az = p.z;
    if (p.run && (input.buttons & BTN.restart) && !(p.held & BTN.restart)) {
        placeAt(p, state.room.launches[0]);
        p.crumpled = 0; p.guard = 0;
        p.run = new RingRun(p.run.set);
        p.held = input.buttons;
        p.clock++;
        p.events.length = 0; p.events.push("restart");
        pushEvents(state, p);
        return;
    }
    stepPlane(p, input, state.room, state.seed);
    // tags and erasers are the server's to decide (the client's prediction has no other planes)
    if (state.players && state.grace === 0 && state.phase === "play" && (state.mode === "tag" || state.mode === "spread")) {
        if (p.it && p.crumpled === 0) tryTag(state, p, input.lag || 0);
        if (p.crumpled === 0) pickEraser(state, p);
    }
    if (p.run && p.crumpled === 0 && !p.events.includes("refold")) {
        const before = p.run.next, r = p.run.step(ax, ay, az, p.x, p.y, p.z);
        if (r) {
            p.events.push(r === "done" ? "done" : "ring");
            p.ringPassed = before;
            if (r === "done" && (!p.best || p.run.ticks < p.best)) p.best = p.run.ticks;
        }
    }
    pushEvents(state, p);
}

/** a plane's events, as match events (for the snapshot: effects and sounds for everyone) */
function pushEvents(state, p) {
    for (const e of p.events) {
        if (e === "crumple" || e === "glance") state.events.push({ type: e, id: p.id, x: p.hit.x, y: p.hit.y, z: p.hit.z });
        else if (e === "ring" || e === "done") state.events.push({ type: e, id: p.id, ring: p.ringPassed, ticks: p.run.ticks });
        else if (e === "flap" || e === "refold" || e === "stall" || e === "restart") state.events.push({ type: e, id: p.id });
    }
}

// ------------------------------------------------------------------ tag

/** Where a plane was `ago` ticks back, out of its history (TIDEFALL's positionAt, after BREACH). */
const past = { x: 0, y: 0, z: 0 };
export function positionAt(state, p, ago) {
    if (!(ago > 0)) { past.x = p.x; past.y = p.y; past.z = p.z; return past; }
    if (ago > MAX_REWIND) ago = MAX_REWIND;
    const whole = Math.floor(ago), f = ago - whole;
    const a = ((state.tick - whole) & (HISTORY - 1)) * 3, b = ((state.tick - whole - 1) & (HISTORY - 1)) * 3, h = p.hist;
    past.x = h[a] + (h[b] - h[a]) * f; past.y = h[a + 1] + (h[b + 1] - h[a + 1]) * f; past.z = h[a + 2] + (h[b + 2] - h[a + 2]) * f;
    return past;
}

/**
 * Can this "it" (or hunter) tag anyone? Each target is tested where the tagger saw it: `lag` ticks back,
 * capped at 200 ms (lag compensation, as BREACH's shots and TIDEFALL's shoves). The tagger itself is where
 * its own input just put it, which is where its own screen showed it.
 */
function tryTag(state, p, lag) {
    const r2 = TAG.reach * TAG.reach;
    for (const q of state.players) {
        if (q === p || q.it || q.crumpled > 0 || q.guard > 0) continue;
        if (p.noBack > 0 && q.id === p.noBackId) continue;
        const at = positionAt(state, q, lag), dx = at.x - p.x, dy = at.y - p.y, dz = at.z - p.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (state.mode === "spread" && q.shield > 0) {
            q.shield = 0; q.guard = Math.round(TICK_RATE);
            state.events.push({ type: "shield", id: p.id, target: q.id });
            return;
        }
        tag(state, p, q, lag);
        return;
    }
}

function tag(state, p, q, lag) {
    q.it = true;
    if (state.mode === "spread") { q.ink = true; q.clean = q.clean || 0; }
    else { p.it = false; q.noBack = Math.round(TAG.noTagBack * TICK_RATE); q.noBackId = p.id; }
    p.tags++;
    // knocked apart: the tagged plane bounces up and wobbles, the tagger veers off
    q.bump += TAG.knock * 0.6; q.roll += 0.5; p.roll -= 0.4;
    q.flapWait = 0;
    state.events.push({ type: "tag", id: p.id, target: q.id, lag: Math.round(Math.min(lag, MAX_REWIND)) });
}

/** a plane picks up an eraser it flies through */
function pickEraser(state, p) {
    if (state.mode === "spread" && (p.it || p.shield > 0)) return;
    const r2 = TAG.eraser.radius * TAG.eraser.radius;
    for (const e of state.erasers) {
        if (state.tick < e.at) continue;
        const s = state.room.erasers[e.spot], dx = s[0] - p.x, dy = s[1] - p.y, dz = s[2] - p.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        p.erasers++;
        if (state.mode === "spread") p.shield = 1;
        else p.itTicks = Math.max(0, p.itTicks - Math.round(TAG.eraser.minus * TICK_RATE));
        state.events.push({ type: "eraser", id: p.id, spot: e.spot });
        // back after a while, at a spot no other slot uses (seeded, so every run of a seed agrees)
        e.at = state.tick + Math.round(TAG.eraser.respawn * TICK_RATE);
        const free = state.room.erasers.map((_, i) => i).filter((i) => !state.erasers.some((o) => o.spot === i));
        if (free.length) e.spot = free[Math.floor(hash3(state.seed, state.tick, e.spot) * free.length)];
        return;
    }
}

/** the round: grace, picking the first "it", the clock, scoring, the end */
function tagRules(state) {
    if (state.phase !== "play") return;
    const planes = state.players;
    if (planes.length < 2) { state.grace = Math.round(TAG.grace * TICK_RATE); return; }
    if (state.grace > 0) {
        if (--state.grace === 0) pickIt(state);
        return;
    }
    // nobody is "it" (they left): pick again
    if (!planes.some((p) => p.it)) pickIt(state);
    for (const p of planes) {
        if (p.noBack > 0) p.noBack--;
        if (p.it) p.itTicks++; else p.clean++;
    }
    state.clock--;
    const clean = planes.filter((p) => !p.it);
    if (state.clock <= 0 || (state.mode === "spread" && clean.length <= 1)) endRound(state);
}

function pickIt(state) {
    const planes = state.players, p = planes[Math.floor(hash3(state.seed, state.tick, 31) * planes.length)];
    p.it = true;
    if (state.mode === "spread") p.ink = true;
    state.events.push({ type: "it", id: p.id });
}

/** Classic: least time as "it" wins (ties share it). Ink Spread: whoever is still clean. */
function endRound(state) {
    const planes = state.players;
    if (state.mode === "tag") {
        let least = Infinity;
        for (const p of planes) least = Math.min(least, p.itTicks);
        state.winners = planes.filter((p) => p.itTicks === least).map((p) => p.id);
    } else state.winners = planes.filter((p) => !p.it).map((p) => p.id);
    state.phase = "over";
    state.overTicks = Math.round(MATCH.intermission * TICK_RATE);
    state.events.push({ type: "over" });
}
