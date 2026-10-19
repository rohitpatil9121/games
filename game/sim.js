import { DT, TICK_RATE, BTN, ROLE, MOVE, PLAYER, HIT, SCANNER, PING, DECOY, DISGUISE, TAUNT, ROUND, SCORE, HISTORY, MAX_REWIND, HIST_STRIDE } from "./data.js";
import { PROP_SHAPE, PROP_INDEX } from "./props.js";

/**
 * DECOY: the match simulation. Pure and deterministic: no DOM, no WebGL, no clock, no Math.random.
 *
 * It began as BREACH's simulation (game/sim.js there) and keeps its rules for determinism, movement and
 * lag compensation. The same file runs on the server (the authority), in the browser (predicting the
 * local player) and in Node tools (bot matches, tests). For the three to agree:
 *   - time only moves in fixed 1/60 s ticks;
 *   - randomness comes from one seeded generator kept in the state;
 *   - angles arrive as integers and go through dsin/dcos below, never Math.sin.
 *
 * PLAYERS. Each round a player is a hider or a seeker. A seeker is an upright box (MOVE.radius wide,
 * MOVE.height tall). A hider is a prop: its collision box is the prop's footprint squared to the nearest
 * quarter turn (p.hx, p.hy, p.h), and its hit shape is the prop's box turned by its exact yaw. Everything
 * that moves (players, decoys) slides one axis at a time against axis-aligned boxes, so collision is the
 * same few lines for all of them.
 *
 * THE MAP'S PROPS are solid for movement (their squared boxes are in the map's solids, flagged `prop`),
 * and are hit by shots as turned boxes, like hiders. A shot that ends on a real prop or a decoy hurts the
 * seeker who fired it.
 *
 * WHAT A CLIENT CAN PREDICT. stepPlayer() reads only the player, its input and the map, so a client runs
 * it for itself ahead of the server: moving, taking a disguise (the input names a map prop; the rule
 * checks reach, line of sight and room to stand), locking, the scanner's trigger and charge, spending a
 * ping or a decoy. What those *do* to others (hits, grenades, decoys, taunts, scores, rounds) is decided
 * in step(), by the authority alone.
 * @module game/sim
 */

// ------------------------------------------------------------------ deterministic maths

const PI = 3.141592653589793, TAU = PI * 2, HALF_PI = PI / 2;

/** sin(x) by range reduction and a fixed polynomial: the same bits in every engine. */
export function dsin(x) {
    x -= TAU * Math.floor(x / TAU + 0.5);
    if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x;
    const s = x * x;
    return x * (1 + s * (-1 / 6 + s * (1 / 120 + s * (-1 / 5040 + s * (1 / 362880 + s * (-1 / 39916800 + s * (1 / 6227020800 - s / 1307674368000)))))));
}
export const dcos = (x) => dsin(x + HALF_PI);

/** Yaw travels as 16 bits of a full turn, pitch as a signed 16 bits of a quarter turn. */
export const quantizeYaw = (radians) => Math.round((radians / TAU) * 65536) & 0xffff;
export const yawOf = (q) => (q * TAU) / 65536;
export const quantizePitch = (radians) => Math.max(-32000, Math.min(32000, Math.round((radians / HALF_PI) * 32767)));
export const pitchOf = (q) => (q * HALF_PI) / 32767;
/** the nearest quarter turn, as a quantized yaw */
export const squareYaw = (q) => ((Math.round((q & 0xffff) / 16384) & 3) * 16384) & 0xffff;

function nextSeed(a) { return (a + 0x6d2b79f5) >>> 0; }
function hashSeed(a) {
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Next random number in [0, 1) from the match's generator. */
export function random(state) { state.rng = nextSeed(state.rng); return hashSeed(state.rng); }

// ------------------------------------------------------------------ state

/**
 * @typedef {{ seq: number, mx: number, my: number, buttons: number, yaw: number, pitch: number, prop?: number, lag?: number }} PlayerInput
 *          mx, my: strafe and forward, −127..127. yaw, pitch: quantized. prop: 1 + the index of the map
 *          prop to become, or 0. lag: ticks to rewind the others by (set by the authority).
 */
export const NO_INPUT = Object.freeze({ seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 });

/**
 * @param {object} map compiled map (game/maps)
 * @param {{ seed?: number, rounds?: number, hide?: number, seek?: number }} [options] times in seconds
 */
export function createState(map, options = {}) {
    return {
        tick: 0,
        rng: (options.seed ?? 1) >>> 0,
        mapId: map.id,
        /** "wait" (a side is empty), "hide", "seek", "end" (a round's result), "over" (the match's) */
        phase: "wait",
        timeLeft: 0,
        round: 0,
        rounds: options.rounds ?? ROUND.rounds,
        times: { hide: Math.round((options.hide ?? ROUND.hide) * TICK_RATE), seek: Math.round((options.seek ?? ROUND.seek) * TICK_RATE) },
        /** the team seeking this round (the other hides) */
        seekTeam: 2,
        /** rounds won by each team */
        teamScore: [0, 0, 0],
        /** the team that won the last round, then the match (0 = a draw) */
        winner: 0,
        late: false,
        /** @type {ReturnType<typeof createPlayer>[]} */
        players: [],
        /** ping grenades in flight or waiting to burst */
        pings: [],
        decoys: [],
        nextObject: 1,
        events: [],
    };
}

export function createPlayer(id, name = "Player") {
    return {
        id, name, team: 0,
        /** 0 = a person, 1..3 = a bot of that skill */
        bot: 0,
        role: ROLE.hider,
        alive: true,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        yaw: 0, pitch: 0,
        ground: false, crouched: false,
        /** collision box: half width along x and y, height */
        hx: MOVE.radius, hy: MOVE.radius, h: MOVE.height,
        health: PLAYER.health,
        buttons: 0,
        seq: 0,
        /** a hider's prop type (game/props.js), −1 for a seeker */
        prop: -1,
        /** the prop's yaw (quantized); while locked it stays put whatever the view does */
        propYaw: 0,
        locked: false,
        /** a seeker standing blindfolded at the start of a round */
        frozen: false,
        /** scanner: ticks until it fires again, charge left, ticks since the trigger was let go */
        cool: 0, charge: SCANNER.charge, rest: 0,
        fired: false,
        pings: 0, decoys: 0,
        /** ticks until a forced taunt; ticks until a voluntary one is allowed */
        tauntIn: 0, tauntCool: 0,
        disguiseCool: 0,
        /** set by stepPlayer for step() to act on this tick */
        wantPing: false, wantDecoy: false, wantTaunt: false, disguised: false,
        score: 0, finds: 0, deaths: 0,
        /** HIST_STRIDE numbers for each of the last HISTORY ticks (lag compensation) */
        hist: new Float64Array(HISTORY * HIST_STRIDE),
    };
}

export const findPlayer = (state, id) => { for (const p of state.players) if (p.id === id) return p; return null; };
export const isHider = (p) => p.role === ROLE.hider;
export const isSeeker = (p) => p.role === ROLE.seeker;
/** the role a team plays this round */
export const roleOf = (state, team) => (team === state.seekTeam ? ROLE.seeker : ROLE.hider);

/** Make a player a seeker (an upright box) or a hider (a prop). */
function setShape(p, role, prop) {
    p.role = role;
    p.crouched = false;
    if (role === ROLE.seeker) { p.prop = -1; p.hx = p.hy = MOVE.radius; p.h = MOVE.height; p.locked = false; return; }
    p.prop = prop;
    const s = PROP_SHAPE[prop], odd = ((squareYaw(p.propYaw) >> 14) & 1) === 1;
    p.hx = odd ? s[1] : s[0]; p.hy = odd ? s[0] : s[1]; p.h = s[2];
}

export function addPlayer(state, map, id, name, options = {}) {
    const p = createPlayer(id, name);
    p.team = options.team || 0;
    p.bot = options.bot || 0;
    state.players.push(p);
    // someone arriving while a round is being hidden joins in; later than that, they watch until the next
    if (state.phase === "hide" || state.phase === "wait") spawnPlayer(state, map, p);
    else { p.alive = false; setShape(p, roleOf(state, p.team), propStart()); placeAt(p, map.spawns.hider[0]); }
    return p;
}

export function removePlayer(state, id) {
    const i = state.players.findIndex((p) => p.id === id);
    if (i >= 0) state.players.splice(i, 1);
    for (let k = state.decoys.length - 1; k >= 0; k--) if (state.decoys[k].owner === id) state.decoys.splice(k, 1);
}

const propStart = () => PROP_INDEX[DISGUISE.start];

function placeAt(p, s) {
    p.x = s[0]; p.y = s[1]; p.z = s[2];
    p.vx = p.vy = p.vz = 0;
    p.yaw = quantizeYaw(s[3] || 0); p.pitch = 0;
    p.ground = false;
    for (let i = 0; i < HISTORY; i++) { const o = i * HIST_STRIDE; p.hist[o] = p.x; p.hist[o + 1] = p.y; p.hist[o + 2] = p.z; p.hist[o + 3] = p.propYaw; p.hist[o + 4] = p.prop; p.hist[o + 5] = 0; }
}

/** A free spawn of the right kind, picked at random among the ones nobody stands on. */
function chooseSpawn(state, list, p) {
    const free = [];
    for (let i = 0; i < list.length; i++) {
        let taken = false;
        for (const q of state.players) if (q !== p && q.alive && Math.abs(q.x - list[i][0]) < 1 && Math.abs(q.y - list[i][1]) < 1) taken = true;
        if (!taken) free.push(i);
    }
    if (!free.length) return Math.floor(random(state) * list.length);
    return free[Math.floor(random(state) * free.length)];
}

/** Put a player at the start of a round in the role their team plays. */
export function spawnPlayer(state, map, p) {
    const role = state.phase === "wait" ? ROLE.hider : roleOf(state, p.team);
    const list = role === ROLE.seeker ? map.spawns.seeker : map.spawns.hider, at = chooseSpawn(state, list, p);
    p.propYaw = quantizeYaw(list[at][3] || 0);
    setShape(p, role, propStart());
    placeAt(p, list[at]);
    p.alive = true; p.health = PLAYER.health; p.locked = false;
    p.frozen = role === ROLE.seeker && state.phase === "hide";
    p.cool = 0; p.charge = SCANNER.charge; p.rest = 0; p.fired = false;
    p.pings = role === ROLE.seeker ? PING.perRound : 0;
    p.decoys = role === ROLE.hider ? DECOY.perRound : 0;
    p.tauntIn = TAUNT.interval * TICK_RATE; p.tauntCool = 0; p.disguiseCool = 0;
    state.events.push({ type: "spawn", id: p.id, yaw: p.yaw, role });
}

// ------------------------------------------------------------------ collision

const EPS = 1e-6;
/** solids near the body this tick (filled by gather) */
const near = [];
let stamp = 0;

/** Collect the solids whose ground cell the box around (x, y) touches. */
function gather(map, x, y, reach) {
    const g = map.grid;
    near.length = 0;
    stamp++;
    const cx0 = Math.max(0, Math.floor((x - reach - g.x0) / g.cell)), cx1 = Math.min(g.nx - 1, Math.floor((x + reach - g.x0) / g.cell));
    const cy0 = Math.max(0, Math.floor((y - reach - g.y0) / g.cell)), cy1 = Math.min(g.ny - 1, Math.floor((y + reach - g.y0) / g.cell));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const list = g.cells[cy * g.nx + cx];
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (s.stamp !== stamp) { s.stamp = stamp; near.push(s); }
        }
    }
}

/** Does a body's box (hx, hy, h at x, y, z) overlap a solid? */
const touches = (s, p, h) => s.x0 < p.x + p.hx - EPS && s.x1 > p.x - p.hx + EPS && s.y0 < p.y + p.hy - EPS && s.y1 > p.y - p.hy + EPS && s.z0 < p.z + h - EPS && s.z1 > p.z + EPS;

function slideX(p, d, h) {
    let hit = false;
    p.x += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p, h)) { p.x = d > 0 ? s.x0 - p.hx : s.x1 + p.hx; hit = true; } }
    return hit;
}
function slideY(p, d, h) {
    let hit = false;
    p.y += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p, h)) { p.y = d > 0 ? s.y0 - p.hy : s.y1 + p.hy; hit = true; } }
    return hit;
}
function slideZ(p, d, h) {
    let hit = false;
    p.z += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p, h)) { p.z = d > 0 ? s.z0 - h : s.z1; hit = true; } }
    return hit;
}
function blocked(p, h) {
    for (let i = 0; i < near.length; i++) if (touches(near[i], p, h)) return true;
    return false;
}
const reachOf = (p) => Math.max(p.hx, p.hy) + 1.5;

/** Is this body inside a solid? Should never be true; the tests check. */
export function stuck(map, p) { gather(map, p.x, p.y, reachOf(p)); return blocked(p, heightOf(p)); }

/** Would a body of this size fit here? */
const trial = { x: 0, y: 0, z: 0, hx: 0, hy: 0 };
export function fits(map, x, y, z, hx, hy, h) {
    trial.x = x; trial.y = y; trial.z = z; trial.hx = hx; trial.hy = hy;
    gather(map, x, y, Math.max(hx, hy) + 1);
    return !blocked(trial, h);
}

// ------------------------------------------------------------------ rays

/** Distance along a ray to an axis-aligned box, or −1. */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let tNear = 0, tFar = Infinity, a, b;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < x0 || ox > x1) return -1; }
    else { a = (x0 - ox) / dx; b = (x1 - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < y0 || oy > y1) return -1; }
    else { a = (y0 - oy) / dy; b = (y1 - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < z0 || oz > z1) return -1; }
    else { a = (z0 - oz) / dz; b = (z1 - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    return tNear;
}

/**
 * Distance along a ray to a prop's box (half sizes hx, hy, height h) standing at (x, y, z) turned by
 * `yaw` (quantized), or −1. The ray is turned into the box's own frame and tested there.
 */
export function rayProp(ox, oy, oz, dx, dy, dz, x, y, z, yaw, hx, hy, h) {
    const a = yawOf(yaw), c = dcos(a), s = dsin(a);
    const lx = ox - x, ly = oy - y;
    // rotate by −yaw
    const px = lx * c + ly * s, py = -lx * s + ly * c, qx = dx * c + dy * s, qy = -dx * s + dy * c;
    return rayBox(px, py, oz, qx, qy, dz, -hx, -hy, z, hx, hy, z + h);
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz, b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (disc < 0 || b > 0) return -1;
    return -b - Math.sqrt(disc);
}

/** How far a ray travels before it meets the map's walls, floors and fixtures (not its props), or `max`. */
export function rayMap(map, ox, oy, oz, dx, dy, dz, max) {
    const solids = map.walls;
    let best = max;
    for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        const t = rayBox(ox, oy, oz, dx, dy, dz, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1);
        if (t >= 0 && t < best) best = t;
    }
    return best;
}

/** The first of the map's props a ray meets before `max`: sets rayHit.index (−1 for none) and returns the distance. */
export const rayHit = { index: -1 };
export function rayProps(map, ox, oy, oz, dx, dy, dz, max) {
    const props = map.props;
    let best = max;
    rayHit.index = -1;
    for (let i = 0; i < props.length; i++) {
        const q = props[i], s = PROP_SHAPE[q.type];
        // quick reject: the ray's nearest approach to the prop's middle is further than its corner
        const cx = q.x - ox, cy = q.y - oy, cz = q.z + s[2] / 2 - oz, along = cx * dx + cy * dy + cz * dz;
        if (along < -q.r || along > best + q.r) continue;
        const ex = cx - dx * along, ey = cy - dy * along, ez = cz - dz * along;
        if (ex * ex + ey * ey + ez * ez > q.r * q.r) continue;
        const t = rayProp(ox, oy, oz, dx, dy, dz, q.x, q.y, q.z, q.yaw, s[0], s[1], s[2]);
        if (t >= 0 && t < best) { best = t; rayHit.index = i; }
    }
    return best;
}

/** Can a point see another, with nothing of the map between them? `props` true: the props block the view too. */
export function clearLine(map, ax, ay, az, bx, by, bz, props = false) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return true;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    if (rayMap(map, ax, ay, az, ux, uy, uz, d) < d - 1e-6) return false;
    return !props || rayProps(map, ax, ay, az, ux, uy, uz, d - 0.05) >= d - 0.05;
}

// ------------------------------------------------------------------ movement, disguise and the trigger

export const heightOf = (p) => (p.role === ROLE.seeker ? (p.crouched ? MOVE.crouchHeight : MOVE.height) : p.h);
export const eyeHeight = (p) => (p.role === ROLE.seeker ? (p.crouched ? MOVE.crouchEye : MOVE.eye) : Math.max(0.15, p.h * 0.75));

/**
 * Take on a map prop's shape, if the rules allow: it is a real prop, near enough, in view, and there is
 * room to be that shape where the hider stands. Returns true if it happened.
 */
export function canDisguise(map, p, index) {
    const q = map.props[index];
    if (!q || p.role !== ROLE.hider || !p.alive) return false;
    const s = PROP_SHAPE[q.type];
    const cx = p.x, cy = p.y, cz = p.z + Math.min(p.h, 1.2) * 0.6, tz = q.z + s[2] * 0.5;
    const d = Math.sqrt((q.x - cx) * (q.x - cx) + (q.y - cy) * (q.y - cy) + (tz - cz) * (tz - cz));
    if (d - q.r > DISGUISE.reach) return false;
    // the hider must see the prop: nothing of the map in between (other props don't count; reaching past a stool is fine)
    if (!clearLine(map, cx, cy, cz, q.x, q.y, tz)) return false;
    const odd = ((squareYaw(p.locked ? p.propYaw : p.yaw) >> 14) & 1) === 1;
    return fits(map, p.x, p.y, p.z, odd ? s[1] : s[0], odd ? s[0] : s[1], s[2]);
}

/** Run a hider's prop: disguise, lock and turning. */
function stepProp(map, p, input, pressed) {
    if (p.disguiseCool > 0) p.disguiseCool--;
    const want = (input.prop | 0) - 1;
    if (want >= 0 && p.disguiseCool === 0 && canDisguise(map, p, want)) {
        const type = map.props[want].type;
        if (type !== p.prop) { setShape(p, ROLE.hider, type); p.disguised = true; }
        p.disguiseCool = DISGUISE.cooldown;
    }
    // lock: squared to the nearest quarter turn, like the real props. Moving (or jumping) lets go.
    if (pressed & BTN.lock) {
        p.locked = !p.locked;
        if (p.locked) p.propYaw = squareYaw(p.yaw);
    }
    if (p.locked && (input.mx !== 0 || input.my !== 0 || (input.buttons & BTN.jump))) p.locked = false;
    if (!p.locked) p.propYaw = p.yaw;
    // the collision box follows the prop round in quarter turns, if there is room for it
    const s = PROP_SHAPE[p.prop], odd = ((squareYaw(p.propYaw) >> 14) & 1) === 1, hx = odd ? s[1] : s[0], hy = odd ? s[0] : s[1];
    if ((hx !== p.hx || hy !== p.hy) && fits(map, p.x, p.y, p.z, hx, hy, s[2])) { p.hx = hx; p.hy = hy; }
}

/** Run the scanner for one tick: cooldown, charge. Sets p.fired. */
function stepTrigger(p, input) {
    p.fired = false;
    if (p.cool > 0) p.cool--;
    const held = (input.buttons & BTN.fire) !== 0;
    if (!held) {
        if (++p.rest > SCANNER.rest * TICK_RATE && p.charge < SCANNER.charge) p.charge = Math.min(SCANNER.charge, p.charge + SCANNER.recharge * DT);
        return;
    }
    p.rest = 0;
    if (p.cool > 0 || p.charge < SCANNER.cost) return;
    p.charge -= SCANNER.cost;
    p.cool = SCANNER.interval;
    p.fired = true;
}

/**
 * Advance one player by one tick. Reads only the player, its input and the map, so a client can run it
 * for its own player ahead of the server and get the same answer.
 * @param {object} map compiled map (game/maps)
 * @param {ReturnType<typeof createPlayer>} p
 * @param {PlayerInput} input
 */
export function stepPlayer(map, p, input) {
    const dt = DT, buttons = input.buttons, pressed = buttons & ~p.buttons;
    p.seq = input.seq;
    p.yaw = input.yaw & 0xffff;
    p.pitch = Math.max(-32000, Math.min(32000, input.pitch | 0));
    p.fired = false; p.wantPing = false; p.wantDecoy = false; p.wantTaunt = false; p.disguised = false;
    if (!p.alive || p.frozen) { p.buttons = buttons; return; }
    const hider = p.role === ROLE.hider;

    if (hider) stepProp(map, p, input, pressed);
    gather(map, p.x, p.y, reachOf(p));

    // crouch (seekers only): drop at once; stand again only where there is room
    if (!hider) {
        if (buttons & BTN.crouch) p.crouched = true;
        else if (p.crouched && !blocked(p, MOVE.height)) p.crouched = false;
    }
    const h = heightOf(p);

    // wished direction on the ground plane, from the view yaw
    const yaw = yawOf(p.yaw), fx = dcos(yaw), fy = dsin(yaw);
    const mx = Math.max(-127, Math.min(127, input.mx | 0)) / 127, my = Math.max(-127, Math.min(127, input.my | 0)) / 127;
    let wx = fx * my + fy * mx, wy = fy * my - fx * mx;
    let wish = Math.sqrt(wx * wx + wy * wy);
    if (wish > 1e-6) { wx /= wish; wy /= wish; if (wish > 1) wish = 1; } else { wx = wy = 0; wish = 0; }
    const sprint = (buttons & BTN.sprint) && my > 0;
    const top = hider ? (sprint ? MOVE.hiderSprint : MOVE.hiderWalk) : p.crouched ? MOVE.crouch : sprint ? MOVE.sprint : MOVE.walk;
    let wishSpeed = wish * top;

    const jumping = p.ground && (buttons & BTN.jump) !== 0;
    if (p.ground && !jumping) {
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 1e-4) {
            const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * dt, k = Math.max(0, speed - drop) / speed;
            p.vx *= k; p.vy *= k;
        } else { p.vx = 0; p.vy = 0; }
    }
    let accel = MOVE.accel;
    if (!p.ground) { accel = MOVE.airAccel; if (wishSpeed > MOVE.airSpeed) wishSpeed = MOVE.airSpeed; }
    const along = p.vx * wx + p.vy * wy, add = wishSpeed - along;
    if (add > 0) {
        const gain = Math.min(add, accel * dt * (p.ground ? wish * top : wishSpeed));
        p.vx += wx * gain; p.vy += wy * gain;
    }

    const wasGround = p.ground;
    if (jumping) { p.vz = MOVE.jump; p.ground = false; }

    const dx = p.vx * dt, dy = p.vy * dt;
    const sx = p.x, sy = p.y, sz = p.z;
    const hitX = slideX(p, dx, h), hitY = slideY(p, dy, h);
    if ((hitX || hitY) && wasGround && !jumping) {
        const ax = p.x, ay = p.y;
        p.x = sx; p.y = sy;
        slideZ(p, MOVE.step, h);
        const hx = slideX(p, dx, h), hy = slideY(p, dy, h);
        slideZ(p, sz - p.z, h);
        const plain = (ax - sx) * (ax - sx) + (ay - sy) * (ay - sy), stepped = (p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy);
        if (stepped > plain + 1e-9 && p.z > sz) { if (hx) p.vx = 0; if (hy) p.vy = 0; }
        else { p.x = ax; p.y = ay; p.z = sz; if (hitX) p.vx = 0; if (hitY) p.vy = 0; }
    } else {
        if (hitX) p.vx = 0;
        if (hitY) p.vy = 0;
    }

    p.vz -= MOVE.gravity * dt;
    if (p.vz < -MOVE.maxFall) p.vz = -MOVE.maxFall;
    const hitZ = slideZ(p, p.vz * dt, h);
    if (hitZ) { p.ground = p.vz < 0; p.vz = 0; }
    else {
        p.ground = false;
        if (wasGround && !jumping) {
            const z = p.z;
            if (slideZ(p, -MOVE.step, h)) { p.ground = true; p.vz = 0; } else p.z = z;
        }
    }

    if (hider) {
        if (pressed & BTN.ability && p.decoys > 0) { p.decoys--; p.wantDecoy = true; }
        if (pressed & BTN.taunt && p.tauntCool === 0) { p.tauntCool = TAUNT.cooldown * TICK_RATE; p.wantTaunt = true; }
    } else {
        stepTrigger(p, input);
        if (pressed & BTN.ability && p.pings > 0) { p.pings--; p.wantPing = true; }
    }
    if (p.tauntCool > 0) p.tauntCool--;
    p.buttons = buttons;
}

// ------------------------------------------------------------------ damage

function kill(state, victim, by, how) {
    victim.alive = false; victim.health = 0;
    victim.vx = victim.vy = victim.vz = 0;
    victim.fired = false; victim.locked = false;
    victim.deaths++;
    if (by && by !== victim) { by.finds++; by.score += SCORE.find; }
    state.events.push({ type: "kill", id: victim.id, by: by ? by.id : 0, how });
}

/**
 * Hurt a player. `by` may be null; `self` marks a seeker paying for a shot at something that wasn't a player.
 * @returns {number} the damage dealt
 */
export function damage(state, victim, amount, by, self = false) {
    if (!victim.alive || state.phase !== "seek") return 0;
    amount = Math.round(amount);
    if (amount <= 0) return 0;
    victim.health -= amount;
    state.events.push({ type: "hurt", id: victim.id, by: by ? by.id : 0, amount, self: self ? 1 : 0 });
    if (victim.health <= 0) kill(state, victim, self ? null : by, self ? 1 : 0);
    return amount;
}

// ------------------------------------------------------------------ shooting

/** Where a player was `ago` ticks back (a fraction is allowed), with the prop they were then. */
const past = { x: 0, y: 0, z: 0, yaw: 0, prop: 0, crouched: false };
function positionAt(state, p, ago) {
    if (!(ago > 0)) { past.x = p.x; past.y = p.y; past.z = p.z; past.yaw = p.propYaw; past.prop = p.prop; past.crouched = p.crouched; return past; }
    if (ago > MAX_REWIND) ago = MAX_REWIND;
    const whole = Math.floor(ago), f = ago - whole, S = HIST_STRIDE;
    const a = ((state.tick - whole) & (HISTORY - 1)) * S, b = ((state.tick - whole - 1) & (HISTORY - 1)) * S, h = p.hist;
    past.x = h[a] + (h[b] - h[a]) * f; past.y = h[a + 1] + (h[b + 1] - h[a + 1]) * f; past.z = h[a + 2] + (h[b + 2] - h[a + 2]) * f;
    // shape and turn are taken from the nearer tick: a prop doesn't blend into another
    const n = f < 0.5 ? a : b;
    past.yaw = h[n + 3]; past.prop = h[n + 4]; past.crouched = h[n + 5] !== 0;
    return past;
}

/** The view direction and its right and up, from a player's quantized angles. Returns a shared object. */
const aim = { fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, ux: 0, uy: 0, uz: 0 };
export function aimBasis(p) {
    const yaw = yawOf(p.yaw), pitch = pitchOf(p.pitch), cy = dcos(yaw), sy = dsin(yaw), cp = dcos(pitch), sp = dsin(pitch);
    aim.fx = cp * cy; aim.fy = cp * sy; aim.fz = sp;
    aim.rx = sy; aim.ry = -cy;
    aim.ux = -sp * cy; aim.uy = -sp * sy; aim.uz = cp;
    return aim;
}

/** Distance along a ray to a player's hit shape where they were, or −1. A hider is its prop; a seeker a body and a head. */
function rayPlayer(ox, oy, oz, dx, dy, dz, p, at) {
    if (p.role === ROLE.hider) {
        if (at.prop < 0) return -1;
        const s = PROP_SHAPE[at.prop];
        return rayProp(ox, oy, oz, dx, dy, dz, at.x, at.y, at.z, at.yaw, s[0], s[1], s[2]);
    }
    const b = HIT.bodyHalf;
    const body = rayBox(ox, oy, oz, dx, dy, dz, at.x - b, at.y - b, at.z, at.x + b, at.y + b, at.z + (at.crouched ? HIT.crouchBodyTop : HIT.bodyTop));
    const head = raySphere(ox, oy, oz, dx, dy, dz, at.x, at.y, at.z + (at.crouched ? HIT.crouchHeadZ : HIT.headZ), HIT.headRadius);
    return head >= 0 && (body < 0 || head < body) ? head : body;
}

/** What a shot hit: 0 nothing (a wall), 1 a hider, 2 a real prop, 3 a decoy. */
export const HIT_KIND = Object.freeze({ wall: 0, hider: 1, prop: 2, decoy: 3 });

/**
 * One scanner shot, against the map, its props, the decoys and every hider as the shooter saw them.
 * @param {{ p: object, ox: number, oy: number, oz: number, yaw: number, pitch: number, lag: number }} shot
 */
function fireScanner(state, map, shot) {
    const p = shot.p, b = aimBasis(shot), ox = shot.ox, oy = shot.oy, oz = shot.oz;
    const angle = random(state) * TAU, m = Math.sqrt(random(state)) * SCANNER.spread, ca = dcos(angle) * m, sa = dsin(angle) * m;
    let dx = b.fx + b.rx * ca + b.ux * sa, dy = b.fy + b.ry * ca + b.uy * sa, dz = b.fz + b.uz * sa;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l; dy /= l; dz /= l;
    let best = rayMap(map, ox, oy, oz, dx, dy, dz, SCANNER.range), kind = HIT_KIND.wall, who = null, prop = -1, decoy = null;
    const tp = rayProps(map, ox, oy, oz, dx, dy, dz, best);
    if (rayHit.index >= 0) { best = tp; kind = HIT_KIND.prop; prop = rayHit.index; }
    for (const d of state.decoys) {
        const s = PROP_SHAPE[d.type], t = rayProp(ox, oy, oz, dx, dy, dz, d.x, d.y, d.z, d.yaw, s[0], s[1], s[2]);
        if (t >= 0 && t < best) { best = t; kind = HIT_KIND.decoy; decoy = d; }
    }
    for (const q of state.players) {
        if (q === p || !q.alive || q.role !== ROLE.hider) continue;
        const t = rayPlayer(ox, oy, oz, dx, dy, dz, q, positionAt(state, q, shot.lag));
        if (t >= 0 && t < best) { best = t; kind = HIT_KIND.hider; who = q; }
    }
    state.events.push({ type: "shot", id: p.id, o: [ox, oy, oz], end: [ox + dx * best, oy + dy * best, oz + dz * best], what: kind, prop, target: who ? who.id : 0 });
    if (kind === HIT_KIND.hider) damage(state, who, SCANNER.damage, p);
    else if (kind === HIT_KIND.prop || kind === HIT_KIND.decoy) {
        if (decoy) { state.decoys.splice(state.decoys.indexOf(decoy), 1); state.events.push({ type: "pop", did: decoy.id, x: decoy.x, y: decoy.y, z: decoy.z }); }
        damage(state, p, SCANNER.penalty, p, true);
    }
}

// ------------------------------------------------------------------ ping grenades

function throwPing(state, map, p) {
    const b = aimBasis(p), ez = p.z + eyeHeight(p);
    const start = Math.min(0.5, rayMap(map, p.x, p.y, ez, b.fx, b.fy, b.fz, 0.5) - 0.05);
    state.pings.push({ id: state.nextObject++, owner: p.id, x: p.x + b.fx * start, y: p.y + b.fy * start, z: ez + b.fz * start - 0.1,
        vx: b.fx * PING.speed + p.vx * 0.5, vy: b.fy * PING.speed + p.vy * 0.5, vz: b.fz * PING.speed + PING.up, fuse: -1, life: PING.life });
    if (state.nextObject > 60000) state.nextObject = 1;
    state.events.push({ type: "throw", id: p.id });
}

function stepPings(state, map) {
    const list = state.pings;
    for (let i = list.length - 1; i >= 0; i--) {
        const g = list[i];
        if (g.fuse < 0) {
            g.vz -= MOVE.gravity * DT;
            const speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy + g.vz * g.vz), len = speed * DT;
            const dx = g.vx / speed, dy = g.vy / speed, dz = g.vz / speed;
            let best = rayMap(map, g.x, g.y, g.z, dx, dy, dz, len);
            best = Math.min(best, rayProps(map, g.x, g.y, g.z, dx, dy, dz, best));
            if (best < len || --g.life <= 0) {
                // it sticks where it lands, a hair off the surface, and the fuse starts
                const t = Math.max(0, best - 0.06);
                g.x += dx * t; g.y += dy * t; g.z += dz * t; g.vx = g.vy = g.vz = 0;
                g.fuse = PING.fuse;
                state.events.push({ type: "land", gid: g.id, x: g.x, y: g.y, z: g.z });
            } else { g.x += dx * len; g.y += dy * len; g.z += dz * len; }
        } else if (--g.fuse <= 0) {
            list.splice(i, 1);
            const ids = [];
            for (const q of state.players) {
                if (!q.alive || q.role !== ROLE.hider) continue;
                const dx = q.x - g.x, dy = q.y - g.y, dz = q.z + q.h * 0.5 - g.z;
                if (dx * dx + dy * dy + dz * dz > PING.radius * PING.radius) continue;
                ids.push(q.id);
                // everyone hears the prop squeak; only the thrower is shown where it is
                state.events.push({ type: "squeak", id: q.id, x: q.x, y: q.y, z: q.z + q.h * 0.5 });
            }
            state.events.push({ type: "burst", gid: g.id, x: g.x, y: g.y, z: g.z });
            state.events.push({ type: "ping", by: g.owner, ids, to: g.owner });
        }
    }
}

// ------------------------------------------------------------------ decoys

function dropDecoy(state, map, p) {
    if (state.decoys.length >= DECOY.max) state.decoys.shift();
    const yaw = yawOf(p.yaw), s = PROP_SHAPE[p.prop];
    const d = { id: state.nextObject++, owner: p.id, type: p.prop, yaw: p.propYaw, x: p.x, y: p.y, z: p.z, vz: 0, hx: p.hx, hy: p.hy, h: s[2],
        dx: dcos(yaw), dy: dsin(yaw), left: DECOY.distance, ground: p.ground };
    if (state.nextObject > 60000) state.nextObject = 1;
    state.decoys.push(d);
    state.events.push({ type: "decoy", id: p.id, did: d.id });
}

function stepDecoys(state, map) {
    for (const d of state.decoys) {
        if (d.left <= 0 && d.ground) continue;
        gather(map, d.x, d.y, Math.max(d.hx, d.hy) + 1);
        if (d.left > 0) {
            const step = Math.min(d.left, DECOY.speed * DT);
            const hx = slideX(d, d.dx * step, d.h), hy = slideY(d, d.dy * step, d.h);
            d.left -= step;
            if (hx || hy) d.left = 0;           // ran into something: it stops there, as a prop would
        }
        d.vz -= MOVE.gravity * DT;
        if (slideZ(d, d.vz * DT, d.h)) { d.ground = d.vz < 0; d.vz = 0; } else d.ground = false;
        if (d.z < MOVE.killZ) d.left = 0;
    }
}

// ------------------------------------------------------------------ taunts

function taunt(state, p, forced) {
    const kind = Math.floor(random(state) * TAUNT.kinds.length);
    p.tauntIn = (state.late ? TAUNT.lateInterval : TAUNT.interval) * TICK_RATE;
    let points = 0;
    if (!forced && state.phase === "seek") {
        let nearest = Infinity;
        for (const q of state.players) if (q.alive && q.role === ROLE.seeker) nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
        points = Math.round(TAUNT.points + TAUNT.bravery * Math.max(0, 1 - nearest / TAUNT.near));
        p.score += points;
    }
    state.events.push({ type: "taunt", id: p.id, kind, forced: forced ? 1 : 0, points, x: p.x, y: p.y, z: p.z + p.h * 0.5 });
}

// ------------------------------------------------------------------ rounds

const count = (state, role) => { let n = 0; for (const p of state.players) if (p.alive && p.role === role) n++; return n; };
const teamSize = (state, team) => { let n = 0; for (const p of state.players) if (p.team === team) n++; return n; };

/** Begin the next round: the teams swap sides, everyone is put back. */
export function startRound(state, map) {
    state.round++;
    state.seekTeam = state.round % 2 === 1 ? 2 : 1;
    state.phase = "hide";
    state.timeLeft = state.times.hide;
    state.late = false;
    state.pings.length = 0;
    state.decoys.length = 0;
    for (const p of state.players) spawnPlayer(state, map, p);
    state.events.push({ type: "phase", phase: "hide", round: state.round, winner: 0 });
}

function endRound(state, winner) {
    state.phase = "end";
    state.timeLeft = ROUND.end * TICK_RATE;
    state.winner = winner;
    state.teamScore[winner]++;
    for (const p of state.players) {
        if (p.team === winner) p.score += SCORE.roundWin;
        if (p.alive && p.role === ROLE.hider) p.score += SCORE.survive;
        p.frozen = false;
    }
    state.events.push({ type: "phase", phase: "end", round: state.round, winner });
}

function endMatch(state) {
    state.phase = "over";
    state.timeLeft = ROUND.over * TICK_RATE;
    const [, a, b] = state.teamScore;
    let winner = a > b ? 1 : b > a ? 2 : 0;
    if (!winner) {
        // a tie on rounds goes to the team with more points
        let pa = 0, pb = 0;
        for (const p of state.players) { if (p.team === 1) pa += p.score; else if (p.team === 2) pb += p.score; }
        winner = pa > pb ? 1 : pb > pa ? 2 : 0;
    }
    state.winner = winner;
    state.events.push({ type: "phase", phase: "over", round: state.round, winner });
}

function stepRound(state, map) {
    if (state.phase === "wait") {
        if (teamSize(state, 1) && teamSize(state, 2)) startRound(state, map);
        return;
    }
    if (state.phase === "over") { if (state.timeLeft > 0) state.timeLeft--; return; }
    if (--state.timeLeft > 0 && state.phase !== "seek") return;
    if (state.phase === "hide") {
        state.phase = "seek";
        state.timeLeft = state.times.seek;
        for (const p of state.players) { p.frozen = false; if (p.role === ROLE.hider) p.tauntIn = TAUNT.interval * TICK_RATE; }
        state.events.push({ type: "phase", phase: "seek", round: state.round, winner: 0 });
        return;
    }
    if (state.phase === "end") {
        if (state.round >= state.rounds) endMatch(state);
        else startRound(state, map);
        return;
    }
    // seeking: the last minute, the taunt clock, the survivors' trickle of points, and who has won
    if (!state.late && state.timeLeft <= ROUND.late * TICK_RATE) {
        state.late = true;
        for (const p of state.players) if (p.role === ROLE.hider) p.tauntIn = Math.min(p.tauntIn, TAUNT.lateInterval * TICK_RATE);
        state.events.push({ type: "late" });
    }
    for (const p of state.players) {
        if (!p.alive || p.role !== ROLE.hider) continue;
        if (--p.tauntIn <= 0) taunt(state, p, true);
        if (state.timeLeft % (10 * TICK_RATE) === 0) p.score += SCORE.alive;
    }
    const hiders = count(state, ROLE.hider), seekers = count(state, ROLE.seeker);
    if (!hiders) endRound(state, state.seekTeam);
    else if (!seekers || state.timeLeft <= 0) endRound(state, 3 - state.seekTeam);
}

// ------------------------------------------------------------------ the tick

/** Apply one input to one player, and note what step() must act on. */
function applyInput(state, map, p, input) {
    stepPlayer(map, p, input);
    if (!p.alive) return;
    if (p.disguised) state.events.push({ type: "disguise", id: p.id, prop: p.prop });
    if (p.fired) shots.push({ p, ox: p.x, oy: p.y, oz: p.z + eyeHeight(p), yaw: p.yaw, pitch: p.pitch, lag: input.lag || 0 });
    if (p.wantPing) throwPing(state, map, p);
    if (p.wantDecoy) dropDecoy(state, map, p);
    if (p.wantTaunt) taunt(state, p, false);
    if (p.z < MOVE.killZ) kill(state, p, null, 2);
}
const shots = [];

/**
 * Advance the whole match by one tick.
 *
 * Each player's entry in `inputs` is one input, or a list of them (a player whose inputs arrived late
 * catches up: all of them are applied this tick, in order). An empty list means nothing arrived: that
 * player's own time stands still. No entry at all means nobody is driving: the player stands idle.
 * @param {ReturnType<typeof createState>} state
 * @param {object} map
 * @param {Map<number, PlayerInput | PlayerInput[]>} inputs
 */
export function step(state, map, inputs) {
    state.events.length = 0;
    state.tick++;
    stepRound(state, map);
    if (state.phase === "over") return;

    shots.length = 0;
    for (const p of state.players) {
        const given = inputs.get(p.id);
        if (Array.isArray(given)) for (let i = 0; i < given.length; i++) applyInput(state, map, p, given[i]);
        else if (given) applyInput(state, map, p, given);
        else { idle.seq = p.seq; idle.yaw = p.yaw; idle.pitch = p.pitch; applyInput(state, map, p, idle); }
    }
    // remember where everyone is, and what shape, for shots that arrive late
    const slot = (state.tick & (HISTORY - 1)) * HIST_STRIDE;
    for (const p of state.players) { const h = p.hist; h[slot] = p.x; h[slot + 1] = p.y; h[slot + 2] = p.z; h[slot + 3] = p.propYaw; h[slot + 4] = p.prop; h[slot + 5] = p.crouched ? 1 : 0; }

    for (const shot of shots) if (shot.p.alive && state.phase === "seek") fireScanner(state, map, shot);
    stepPings(state, map);
    stepDecoys(state, map);
}
const idle = { seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 };

// ------------------------------------------------------------------ checks

/** A short fingerprint of everything that must match between two runs of the simulation. */
export function hashState(state, h = 0x811c9dc5) {
    const f = new Float64Array(1), u = new Uint32Array(f.buffer);
    const mix = (n) => { f[0] = n; h = Math.imul(h ^ u[0], 0x01000193); h = Math.imul(h ^ u[1], 0x01000193); };
    mix(state.tick); mix(state.rng); mix(state.timeLeft); mix(state.round); mix(state.teamScore[1]); mix(state.teamScore[2]);
    for (const p of state.players) {
        mix(p.id); mix(p.x); mix(p.y); mix(p.z); mix(p.vx); mix(p.vy); mix(p.vz); mix(p.yaw); mix(p.pitch);
        mix(p.ground ? 1 : 0); mix(p.crouched ? 1 : 0); mix(p.health); mix(p.alive ? 1 : 0); mix(p.role);
        mix(p.prop); mix(p.propYaw); mix(p.locked ? 1 : 0); mix(p.charge); mix(p.cool); mix(p.score); mix(p.tauntIn);
    }
    for (const g of state.pings) { mix(g.x); mix(g.y); mix(g.z); }
    for (const d of state.decoys) { mix(d.x); mix(d.y); mix(d.z); }
    return h >>> 0;
}
