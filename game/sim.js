import { DT, TICK_RATE, BTN, MOVE, WATER, LOOT, LOOT_KINDS, CARRY, TOOLS, MATCH, ISLAND, HISTORY, MAX_REWIND } from "./data.js";
import { dsin, dcos, yawOf, pitchOf, quantizeYaw, nextSeed, hashSeed } from "./det.js";
import { groundAt, rollLoot } from "./island.js";
import { tideAt, PHASE } from "./tide.js";

/**
 * TIDEFALL: the match simulation. Pure and deterministic: no DOM, no WebGL, no clock, no Math.random.
 *
 * Like BREACH's sim.js, the same file runs on the server (the authority), in the browser (predicting the
 * local player between snapshots) and in Node tools (bot matches, island checks, tests). Time moves in
 * fixed 1/60 s ticks, randomness comes from one seeded generator kept in the state, and angles go through
 * dsin/dcos (game/det.js), so all three get the same bits.
 *
 * THE SEA is not state: it is tideAt(seed, tick) (game/tide.js). stepPlayer takes the water level as an
 * argument, so a client predicting its own player passes the level at the tick it expects the server to
 * apply that input (see net.js).
 *
 * MOVEMENT (the `physics-tuning` skill). A player is an upright box with its origin at the feet. On land:
 * friction, then Quake-style acceleration toward the wished direction, then the move, one axis at a time,
 * pushing out of ruin boxes and stepping up low ones; the heightmap is the floor. Jumping has coyote time
 * and a jump buffer; jumping into a ledge up to MOVE.mantle high climbs it. In water deeper than
 * WATER.swimDepth the player floats on a damped spring to the surface and swims, slowly, never sprinting.
 * Carrying more than WATER.swimCapacity kilograms there sinks you to the floor, where you walk slowly
 * while your breath runs out; when it does, you let go of everything heavy and it sinks where you are.
 *
 * TOOLS. stepPlayer runs the grapple (a ray against terrain and ruins, then a pull, all predictable) and
 * the cooldowns. It only *flags* a shove, a flare, a pickup or a drop; step() resolves those, because they
 * touch other players and the loot, which only the authority decides. A shove is tested against where
 * the others were when the shover saw them (lag compensation, as BREACH does for shots), at most 200 ms back.
 * @module game/sim
 */

// ------------------------------------------------------------------ random

/** Next random number in [0, 1) from the match's generator. */
export function random(state) { state.rng = nextSeed(state.rng); return hashSeed(state.rng); }

// ------------------------------------------------------------------ state

/**
 * @typedef {{ seq: number, mx: number, my: number, buttons: number, yaw: number, pitch: number, lag?: number }} PlayerInput
 *   mx, my: strafe and forward relative to the view, −127..127. yaw, pitch: quantized view angles.
 */
export const NO_INPUT = Object.freeze({ seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, lag: 0 });

/**
 * @param {ReturnType<typeof import("./island.js").generateIsland>} island
 * @param {{ seed?: number, length?: number }} [options] length: tides to play (default all of them)
 */
export function createState(island, options = {}) {
    return {
        tick: 0,
        seed: island.seed,
        rng: ((options.seed ?? island.seed) ^ 0x9e3779b9) >>> 0,
        teams: island.teams,
        /** "play", then "over" while the results are up */
        phase: "play",
        overTicks: 0,
        /** the winning team, or −1 for a draw */
        winner: -1,
        /** points banked per team */
        bank: [0, 0, 0, 0],
        /** @type {ReturnType<typeof createPlayer>[]} */
        players: [],
        /** @type {{ id: number, kind: number, x: number, y: number, z: number, vz: number, holder: number, spot: number }[]} */
        loot: [],
        nextLoot: 1,
        /** flares burning: { team, owner, x, y, z, ticks } */
        flares: [],
        /** the tide phase last tick, to notice when an ebb begins */
        lastPhase: -1,
        lastTide: -1,
        /** things that happened this tick, for whoever draws or announces the match; cleared every step */
        events: [],
        tideInfo: {},
    };
}

export function createPlayer(id, name = "Player") {
    return {
        id, name, team: 0,
        /** 0 = a person, 1..3 = a bot of that skill */
        bot: 0,
        alive: true,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        yaw: 0, pitch: 0,
        /** facing on the ground (unit vector): where the body points, which is where it last moved */
        fx: 1, fy: 0,
        ground: false,
        /** 0 dry, 1 wading, 2 swimming, 3 sunk (heavy, walking the sea floor) */
        water: 0,
        /** ticks of breath left */
        breath: WATER.breath * TICK_RATE,
        buttons: 0,
        seq: 0,
        /** ticks since last on the ground (coyote time) and ticks since jump was last pressed (buffer) */
        air: 0, jumpAge: 99, pickAge: 99,
        /** loot ids carried, oldest first, and their total weight */
        carry: [], weight: 0,
        /** grapple: 1 while pulling toward (hx, hy, hz) */
        hook: 0, hx: 0, hy: 0, hz: 0, hookT: 0, hookCool: 0,
        shoveCool: 0, flareCool: 0,
        /** ticks of being knocked off balance (no control) and of being dazzled by a flare */
        stun: 0, blind: 0,
        respawn: 0,
        /** set by stepPlayer for step() to resolve this tick */
        shoved: false, flared: false, wantPick: false, wantDrop: false, gasp: false, mantled: false, hookFired: 0, jumped: false,
        /** match statistics */
        banked: 0, lost: 0, steals: 0, shoves: 0, drowned: 0,
        /** x, y, z for each of the last HISTORY ticks (lag compensation) */
        hist: new Float64Array(HISTORY * 3),
    };
}

export function addPlayer(state, island, id, name, options = {}) {
    const p = createPlayer(id, name);
    p.team = Math.max(0, Math.min(island.teams - 1, options.team | 0));
    p.bot = options.bot || 0;
    state.players.push(p);
    spawnPlayer(state, island, p);
    return p;
}

export function removePlayer(state, id) {
    const i = state.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = state.players[i];
    dropAll(state, null, p, false);
    state.players.splice(i, 1);
}

export const findPlayer = (state, id) => { for (const p of state.players) if (p.id === id) return p; return null; };
const findLoot = (state, id) => { for (const l of state.loot) if (l.id === id) return l; return null; };

/** Put a player at their camp, empty-handed. */
export function spawnPlayer(state, island, p) {
    const camp = island.camps[p.team];
    let slot = 0;
    for (const q of state.players) if (q !== p && q.team === p.team) slot++;
    // face out to sea, standing in a little arc behind the chest
    const out = camp.angle, a = out + Math.PI + (slot - 1) * 0.6;
    p.x = camp.x + dcos(a) * 2.6; p.y = camp.y + dsin(a) * 2.6; p.z = camp.z + 0.05;
    p.vx = p.vy = p.vz = 0;
    p.yaw = quantizeYaw(out); p.pitch = 0;
    p.fx = dcos(out); p.fy = dsin(out);
    p.ground = false; p.water = 0; p.alive = true;
    p.breath = WATER.breath * TICK_RATE;
    p.carry = []; p.weight = 0;
    p.hook = 0; p.hookCool = 0; p.stun = 0; p.blind = 0; p.respawn = 0;
    p.air = 0; p.jumpAge = 99; p.pickAge = 99;
    for (let i = 0; i < HISTORY; i++) { p.hist[i * 3] = p.x; p.hist[i * 3 + 1] = p.y; p.hist[i * 3 + 2] = p.z; }
    state.events.push({ type: "spawn", id: p.id });
}

// ------------------------------------------------------------------ collision against ruins (boxes)

const EPS = 1e-6;
const near = [];
let stamp = 0;

/** Collect the boxes whose grid cell the area around (x, y) touches. */
function gather(island, x, y, reach) {
    const g = island.grid;
    near.length = 0;
    stamp++;
    const cx0 = Math.max(0, Math.floor((x - reach - g.x0) / g.cell)), cx1 = Math.min(g.nx - 1, Math.floor((x + reach - g.x0) / g.cell));
    const cy0 = Math.max(0, Math.floor((y - reach - g.y0) / g.cell)), cy1 = Math.min(g.ny - 1, Math.floor((y + reach - g.y0) / g.cell));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const list = g.cells[cy * g.nx + cx];
        for (let i = 0; i < list.length; i++) { const s = list[i]; if (s.stamp !== stamp) { s.stamp = stamp; near.push(s); } }
    }
}

const R = MOVE.radius, H = MOVE.height;
const touches = (s, p) => s.x0 < p.x + R - EPS && s.x1 > p.x - R + EPS && s.y0 < p.y + R - EPS && s.y1 > p.y - R + EPS && s.z0 < p.z + H - EPS && s.z1 > p.z + EPS;
let lastHit = null;
function slideX(p, d) {
    let hit = false;
    p.x += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p)) { p.x = d > 0 ? s.x0 - R : s.x1 + R; hit = true; lastHit = s; } }
    return hit;
}
function slideY(p, d) {
    let hit = false;
    p.y += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p)) { p.y = d > 0 ? s.y0 - R : s.y1 + R; hit = true; lastHit = s; } }
    return hit;
}
function slideZ(p, d) {
    let hit = false;
    p.z += d;
    for (let i = 0; i < near.length; i++) { const s = near[i]; if (touches(s, p)) { p.z = d > 0 ? s.z0 - H : s.z1; hit = true; } }
    return hit;
}
function blocked(p) { for (let i = 0; i < near.length; i++) if (touches(near[i], p)) return true; return false; }

/** Is this player inside a ruin box or under the terrain? Should never be true; the tests check. */
export function stuck(island, p) { gather(island, p.x, p.y, R + 0.5); return blocked(p) || p.z < groundAt(island, p.x, p.y) - 0.05; }

/** The highest floor under a point: terrain, or the top of a box below `z`. */
export function floorBelow(island, x, y, z) {
    let f = groundAt(island, x, y);
    gather(island, x, y, 0.5);
    for (const s of near) if (x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1 && s.z1 <= z + 0.05 && s.z1 > f) f = s.z1;
    return f;
}

// ------------------------------------------------------------------ rays

function rayBox(ox, oy, oz, dx, dy, dz, s) {
    let tNear = 0, tFar = Infinity, a, b;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < s.x0 || ox > s.x1) return -1; }
    else { a = (s.x0 - ox) / dx; b = (s.x1 - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < s.y0 || oy > s.y1) return -1; }
    else { a = (s.y0 - oy) / dy; b = (s.y1 - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < s.z0 || oz > s.z1) return -1; }
    else { a = (s.z0 - oz) / dz; b = (s.z1 - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > tNear) tNear = a; if (b < tFar) tFar = b; if (tNear > tFar) return -1; }
    return tNear;
}

/**
 * Distance along a normalized ray to the first thing it meets (terrain or a ruin box), or −1 within `max`.
 * Terrain is marched in half-metre steps and the crossing refined by halving, so the answer is exact to a
 * few millimetres and the same everywhere.
 */
export function rayIsland(island, ox, oy, oz, dx, dy, dz, max) {
    let best = max;
    for (const s of island.solids) { const t = rayBox(ox, oy, oz, dx, dy, dz, s); if (t >= 0 && t < best) best = t; }
    let prev = 0;
    for (let t = 0.5; ; t += 0.5) {
        const tt = t > best ? best : t;
        if (oz + dz * tt < groundAt(island, ox + dx * tt, oy + dy * tt)) {
            let a = prev, b = tt;
            for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (oz + dz * m < groundAt(island, ox + dx * m, oy + dy * m)) b = m; else a = m; }
            return a;
        }
        prev = tt;
        if (tt >= best) break;
    }
    return best < max ? best : -1;
}

/** Can a point see another, with neither terrain nor ruin between? */
export function clearLine(island, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return true;
    const t = rayIsland(island, ax, ay, az, dx / d, dy / d, dz / d, d);
    return t < 0 || t >= d - 0.05;
}

/** The view direction from a player's quantized angles. Returns a shared object. */
const aim = { x: 0, y: 0, z: 0 };
export function aimOf(p) {
    const yaw = yawOf(p.yaw), pitch = pitchOf(p.pitch), cp = dcos(pitch);
    aim.x = cp * dcos(yaw); aim.y = cp * dsin(yaw); aim.z = dsin(pitch);
    return aim;
}

// ------------------------------------------------------------------ movement

export const slowOf = (p) => Math.max(0.45, 1 - p.weight * CARRY.slowPerKg);
export const headOf = (p) => p.z + MOVE.eye;

/**
 * Advance one player by one tick. Reads only the player, the island and the water level, so a client can
 * run it for its own player ahead of the server and get the same answer.
 * @param {object} island
 * @param {ReturnType<typeof createPlayer>} p
 * @param {PlayerInput} input
 * @param {number} level the water height this tick
 */
export function stepPlayer(island, p, input, level) {
    const dt = DT;
    p.seq = input.seq;
    p.yaw = input.yaw & 0xffff;
    p.pitch = Math.max(-32000, Math.min(32000, input.pitch | 0));
    p.shoved = p.flared = p.wantPick = p.wantDrop = p.gasp = p.mantled = p.jumped = false;
    p.hookFired = 0;
    if (!p.alive) { p.buttons = input.buttons; return; }

    let buttons = input.buttons, mxi = input.mx, myi = input.my;
    if (p.stun > 0) { p.stun--; buttons = 0; mxi = 0; myi = 0; }
    const pressed = buttons & ~p.buttons;
    if (p.hookCool > 0) p.hookCool--;
    if (p.shoveCool > 0) p.shoveCool--;
    if (p.flareCool > 0) p.flareCool--;
    if (p.blind > 0) p.blind--;
    if (pressed & BTN.jump) p.jumpAge = 0; else if (p.jumpAge < 99) p.jumpAge++;

    gather(island, p.x, p.y, R + 2);

    // wished direction on the ground, from the view yaw
    const yaw = yawOf(p.yaw), fx = dcos(yaw), fy = dsin(yaw);
    const mx = Math.max(-127, Math.min(127, mxi | 0)) / 127, my = Math.max(-127, Math.min(127, myi | 0)) / 127;
    let wx = fx * my + fy * mx, wy = fy * my - fx * mx;
    let wish = Math.sqrt(wx * wx + wy * wy);
    if (wish > 1e-6) { wx /= wish; wy /= wish; if (wish > 1) wish = 1; } else { wx = wy = 0; wish = 0; }
    if (wish > 0.2) { p.fx = wx; p.fy = wy; }

    const slow = slowOf(p);
    const depth = level - p.z;
    const heavy = p.weight > WATER.swimCapacity;
    // which medium: swimming floats, sunk walks the floor
    const deep = depth > WATER.swimDepth;
    p.water = !deep ? (depth > WATER.wadeDepth ? 1 : 0) : heavy ? 3 : 2;

    // ---- tools that the player alone decides (predicted)
    if (pressed & BTN.grapple) {
        if (p.hookCool === 0 && !p.hook) {
            const a = aimOf(p), oz = p.z + 1.5;
            const t = rayIsland(island, p.x, p.y, oz, a.x, a.y, a.z, TOOLS.grapple.range);
            if (t > 1.2) {
                p.hook = 1; p.hx = p.x + a.x * t; p.hy = p.y + a.y * t; p.hz = oz + a.z * t; p.hookT = 0;
                p.hookCool = Math.round(TOOLS.grapple.cooldown * TICK_RATE);
                p.hookFired = 1;
            } else { p.hookCool = 20; p.hookFired = 2; }
        }
    }
    if ((pressed & BTN.shove) && p.shoveCool === 0) { p.shoved = true; p.shoveCool = Math.round(TOOLS.shove.cooldown * TICK_RATE); }
    if ((pressed & BTN.flare) && p.flareCool === 0) { p.flared = true; p.flareCool = Math.round(TOOLS.flare.cooldown * TICK_RATE); }
    // a pick-up pressed a moment before the item is in reach still counts (input buffering)
    if (pressed & BTN.interact) p.pickAge = 0; else if (p.pickAge < 99) p.pickAge++;
    p.wantPick = p.pickAge <= 9;
    if (pressed & BTN.drop) p.wantDrop = true;

    const wasGround = p.ground;
    let jumping = false;

    if (p.hook) {
        // ---- the grapple pulls: straight at the hook, no gravity, until close, timed out, or let go
        p.hookT++;
        const dx = p.hx - p.x, dy = p.hy - p.y, dz = p.hz - (p.z + 1.0), d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < TOOLS.grapple.release || p.hookT > TOOLS.grapple.maxTicks || (p.jumpAge === 0 && p.hookT > 6)) {
            p.hook = 0;
            p.vz = Math.max(p.vz, 4.2);
            p.jumpAge = 99;
        } else {
            const speed = TOOLS.grapple.speed * (0.55 + 0.45 * slow), k = 0.22;
            p.vx += ((dx / d) * speed - p.vx) * k; p.vy += ((dy / d) * speed - p.vy) * k; p.vz += ((dz / d) * speed - p.vz) * k;
        }
        p.ground = false;
    } else if (p.water === 2) {
        // ---- swimming: a damped spring to the surface, slow strokes
        const top = WATER.swim * (0.75 + 0.25 * slow), target = level - WATER.float;
        p.vz += (WATER.buoyancy * (target - p.z) - WATER.bobDamping * p.vz) * dt;
        // water drags hardest on a swimmer who has stopped stroking
        const drag = Math.max(0, 1 - (wish > 0.1 ? WATER.swimDrag * 0.3 : WATER.swimDrag) * dt);
        p.vx *= drag; p.vy *= drag;
        const along = p.vx * wx + p.vy * wy, add = wish * top - along;
        if (add > 0) { const gain = Math.min(add, WATER.swimAccel * dt); p.vx += wx * gain; p.vy += wy * gain; }
        // a stroke up: out onto a ledge or a beach
        if (p.jumpAge === 0 && p.z > target - 0.35) { p.vz = WATER.stroke; p.jumpAge = 99; jumping = true; }
        p.ground = false;
    } else {
        // ---- on foot (dry, wading, or sunk and walking the sea floor)
        let top = p.water === 3 ? WATER.seabedWalk : (buttons & BTN.sprint) && my > 0 && p.water === 0 ? MOVE.sprint : MOVE.run;
        if (p.water === 1) top *= WATER.wade;
        top *= slow;
        let wishSpeed = wish * top;
        const canJump = (p.ground || p.air <= MOVE.coyote) && p.jumpAge <= MOVE.jumpBuffer && p.vz <= 0.5;
        jumping = canJump;
        if (p.ground && !jumping) {
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > 1e-4) {
                const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * (p.water === 3 ? 1.6 : 1) * dt, k = Math.max(0, speed - drop) / speed;
                p.vx *= k; p.vy *= k;
            } else { p.vx = 0; p.vy = 0; }
        }
        let accel = MOVE.accel;
        if (!p.ground) { accel = MOVE.airAccel; if (wishSpeed > MOVE.airSpeed * slow + 0.6) wishSpeed = Math.max(MOVE.airSpeed * slow, Math.min(wishSpeed, Math.sqrt(p.vx * p.vx + p.vy * p.vy))); }
        const along = p.vx * wx + p.vy * wy, add = wishSpeed - along;
        if (add > 0) { const gain = Math.min(add, accel * dt * (p.ground ? Math.max(wish * top, 2) : Math.max(wishSpeed, 2))); p.vx += wx * gain; p.vy += wy * gain; }
        if (jumping) {
            const jump = MOVE.jump * Math.max(0.55, 1 - p.weight * CARRY.jumpPerKg) * (p.water === 3 ? 0.45 : p.water === 1 ? 0.8 : 1);
            p.vz = jump; p.ground = false; p.air = MOVE.coyote + 1; p.jumpAge = 99; p.jumped = true;
        }
    }

    // ---- across: boxes push back and step up; a terrain wall stops the move
    const dx = p.vx * dt, dy = p.vy * dt, sx = p.x, sy = p.y, sz = p.z;
    lastHit = null;
    const hitX = slideX(p, dx), hitY = slideY(p, dy);
    if ((hitX || hitY) && lastHit) {
        const rise = lastHit.z1 - p.z;
        if (wasGround && !jumping && rise > 0 && rise <= MOVE.step) {
            // a low step: stand on it
            const ax = p.x, ay = p.y;
            p.x = sx; p.y = sy;
            slideZ(p, rise + 0.01);
            const hx = slideX(p, dx), hy = slideY(p, dy);
            if (blocked(p) || (hx && hy)) { p.x = ax; p.y = ay; p.z = sz; if (hitX) p.vx = 0; if (hitY) p.vy = 0; }
        } else if (rise > MOVE.step && rise <= MOVE.mantle && (p.jumpAge <= MOVE.jumpBuffer || !wasGround || (buttons & BTN.jump)) && wish > 0.3 && !p.hook) {
            // a ledge: climb onto it, if there is room on top
            const z = p.z;
            p.z = lastHit.z1 + 0.01;
            const ox = p.x, oy = p.y;
            p.x += wx * 0.32; p.y += wy * 0.32;
            if (blocked(p)) { p.x = ox; p.y = oy; p.z = z; if (hitX) p.vx = 0; if (hitY) p.vy = 0; }
            else { p.vz = 0; p.ground = true; p.mantled = true; p.vx *= 0.5; p.vy *= 0.5; }
        } else { if (hitX) p.vx = 0; if (hitY) p.vy = 0; }
    }
    {
        // the edge of the world: open sea that goes nowhere
        const edge = island.half - 6;
        if (p.x > edge) { p.x = edge; p.vx = 0; } else if (p.x < -edge) { p.x = -edge; p.vx = 0; }
        if (p.y > edge) { p.y = edge; p.vy = 0; } else if (p.y < -edge) { p.y = -edge; p.vy = 0; }
        // terrain too steep to walk up acts as a wall (this tick's rise over this tick's run)
        const g = groundAt(island, p.x, p.y), run = Math.sqrt((p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy));
        if (!p.hook && g > p.z + MOVE.step && run > 1e-6 && (g - p.z) / run > MOVE.maxSlope) {
            p.x = sx; p.y = sy; p.vx *= 0.2; p.vy *= 0.2;
        }
    }

    // ---- down (or up)
    if (!p.hook && p.water !== 2) {
        const g = p.water === 3 ? MOVE.gravity * 0.35 : MOVE.gravity;
        p.vz -= g * dt;
        const limit = p.water === 3 ? -WATER.sinkSpeed : -MOVE.maxFall;
        if (p.vz < limit) p.vz = limit;
    }
    const hitZ = slideZ(p, p.vz * dt);
    let onGround = false;
    if (hitZ) { if (p.vz < 0) onGround = true; p.vz = 0; }
    const g = groundAt(island, p.x, p.y);
    if (p.z <= g) { p.z = g; if (p.vz < 0) p.vz = 0; onGround = true; }
    else if (!onGround && wasGround && !jumping && !p.hook && p.vz <= 0 && p.water !== 2) {
        // walking off a step or downhill: stay on the ground instead of taking flight. A box top within a
        // step below comes first (snapping to the terrain under a platform would put the feet inside it).
        const z = p.z;
        if (slideZ(p, -MOVE.step) && p.z >= g) { onGround = true; p.vz = 0; }
        else { p.z = z; if (z - g <= MOVE.step) { p.z = g; p.vz = 0; onGround = true; if (blocked(p)) { p.z = z; onGround = false; } } }
    }
    if (p.water === 2 && p.z <= g + 0.02) onGround = true;
    p.ground = onGround;
    if (p.ground) p.air = 0; else if (p.air < 99) p.air++;
    if (p.hook && hitZ && p.hz < p.z) p.hook = 0;

    // ---- breath: the head under water uses it up; above, it comes back quickly
    if (level > p.z + MOVE.eye + 0.05) {
        if (p.breath > 0) p.breath--;
        if (p.breath === 0) p.gasp = true;
    } else if (p.breath < WATER.breath * TICK_RATE) p.breath = Math.min(WATER.breath * TICK_RATE, p.breath + 3);

    p.buttons = buttons;
}

// ------------------------------------------------------------------ loot

function weightOf(kind) { return LOOT[LOOT_KINDS[kind]].weight; }
function valueOf(kind) { return LOOT[LOOT_KINDS[kind]].value; }

/** Let go of one carried item (the last picked up). `why`: "drop", "shove", "gasp", "drown". */
function dropItem(state, p, index, why) {
    const id = p.carry[index], item = findLoot(state, id);
    p.carry.splice(index, 1);
    if (!item) return;
    item.holder = 0;
    // a little scatter, so a pile of dropped things can be told apart
    const a = random(state) * 6.283185307179586, r = 0.3 + random(state) * 0.5;
    item.x = p.x + dcos(a) * r; item.y = p.y + dsin(a) * r; item.z = p.z + 0.9; item.vz = why === "shove" ? 3 : 0;
    p.weight -= weightOf(item.kind);
    if (p.weight < 0.001) p.weight = 0;
    state.events.push({ type: "drop", id: p.id, loot: id, why });
}

function dropAll(state, island, p, heavyOnly) {
    for (let i = p.carry.length - 1; i >= 0; i--) {
        const item = findLoot(state, p.carry[i]);
        if (heavyOnly && item && weightOf(item.kind) < 3) continue;
        if (item && heavyOnly) p.lost += valueOf(item.kind);
        dropItem(state, p, i, heavyOnly ? "gasp" : "drown");
    }
}

/** The nearest item lying within reach that the player has room for. */
function reachable(state, p) {
    let best = null, bestD = Infinity;
    for (const item of state.loot) {
        if (item.holder) continue;
        const dx = item.x - p.x, dy = item.y - p.y, dz = item.z - p.z;
        if (dz < -CARRY.reachDown || dz > 2.2) continue;
        const d = dx * dx + dy * dy;
        if (d > CARRY.reach * CARRY.reach || d >= bestD) continue;
        if (p.carry.length >= CARRY.maxItems || p.weight + weightOf(item.kind) > CARRY.maxWeight + 1e-9) continue;
        best = item; bestD = d;
    }
    return best;
}
export { reachable as reachableLoot };

function pickUp(state, p) {
    const item = reachable(state, p);
    if (!item) { if (p.pickAge === 0) state.events.push({ type: "nopick", id: p.id }); return; }
    p.pickAge = 99;
    item.holder = p.id;
    p.carry.push(item.id);
    p.weight += weightOf(item.kind);
    if (item.dropBy && item.dropBy !== p.team + 1) p.steals++;
    state.events.push({ type: "pick", id: p.id, loot: item.id, kind: item.kind });
}

/** At the start of every ebb, empty loot spots fill again from the weighted table. */
function refill(state, island) {
    for (let s = 0; s < island.spots.length; s++) {
        if (state.loot.length >= MATCH.maxLoot) break;
        const spot = island.spots[s];
        let taken = false;
        for (const item of state.loot) if (!item.holder && (item.x - spot.x) * (item.x - spot.x) + (item.y - spot.y) * (item.y - spot.y) < 4) { taken = true; break; }
        if (taken) continue;
        const kind = rollLoot(spot.tier, random(state));
        state.loot.push({ id: state.nextLoot, kind, x: spot.x, y: spot.y, z: spot.z + 0.02, vz: 0, holder: 0, spot: s, dropBy: 0 });
        state.nextLoot = state.nextLoot >= 65000 ? 1 : state.nextLoot + 1;
    }
    state.events.push({ type: "refill" });
}

/** Unheld items fall to the floor, slowly through water. */
function settleLoot(state, island, level) {
    for (const item of state.loot) {
        if (item.holder) continue;
        const floor = floorBelow(island, item.x, item.y, item.z);
        if (item.z <= floor + 1e-4 && item.vz <= 0) { item.z = floor; item.vz = 0; continue; }
        const wet = item.z < level;
        item.vz -= (wet ? 3 : 20) * DT;
        if (wet && item.vz < -1.4) item.vz = -1.4;
        item.z += item.vz * DT;
        if (item.z < floor) { item.z = floor; item.vz = 0; }
    }
}

function bankAt(state, island, p) {
    if (!p.carry.length) return;
    const camp = island.camps[p.team], dx = p.x - camp.x, dy = p.y - camp.y;
    if (dx * dx + dy * dy > ISLAND.bankRadius * ISLAND.bankRadius || Math.abs(p.z - camp.z) > 2.5) return;
    let value = 0, n = 0;
    for (const id of p.carry) {
        const i = state.loot.findIndex((l) => l.id === id);
        if (i < 0) continue;
        value += valueOf(state.loot[i].kind); n++;
        state.loot.splice(i, 1);
    }
    p.carry = []; p.weight = 0;
    state.bank[p.team] += value;
    p.banked += value;
    state.events.push({ type: "bank", id: p.id, team: p.team, value, n });
}

// ------------------------------------------------------------------ shove and flare

/** Where a player was `ago` ticks back, out of their history. */
const past = { x: 0, y: 0, z: 0 };
function positionAt(state, p, ago) {
    if (!(ago > 0)) { past.x = p.x; past.y = p.y; past.z = p.z; return past; }
    if (ago > MAX_REWIND) ago = MAX_REWIND;
    const whole = Math.floor(ago), f = ago - whole;
    const a = ((state.tick - whole) & (HISTORY - 1)) * 3, b = ((state.tick - whole - 1) & (HISTORY - 1)) * 3, h = p.hist;
    past.x = h[a] + (h[b] - h[a]) * f; past.y = h[a + 1] + (h[b + 1] - h[a + 1]) * f; past.z = h[a + 2] + (h[b + 2] - h[a + 2]) * f;
    return past;
}

function shove(state, island, p, lag) {
    const T = TOOLS.shove, yaw = yawOf(p.yaw), dx = dcos(yaw), dy = dsin(yaw);
    let target = null, best = Infinity;
    for (const q of state.players) {
        if (q === p || !q.alive || q.team === p.team) continue;
        const at = positionAt(state, q, lag), ox = at.x - p.x, oy = at.y - p.y, oz = at.z - p.z, d = Math.sqrt(ox * ox + oy * oy);
        if (d > T.range || Math.abs(oz) > 1.6) continue;
        if (d > 0.3 && (ox * dx + oy * dy) / d < T.cone) continue;
        if (d < best) { best = d; target = q; }
    }
    state.events.push({ type: "shove", id: p.id, target: target ? target.id : 0, behind: 0 });
    if (!target) return;
    const e = state.events[state.events.length - 1];
    const behind = target.fx * dx + target.fy * dy > T.behindDot;
    e.behind = behind ? 1 : 0;
    target.vx = dx * T.knock * (behind ? 1.25 : 1); target.vy = dy * T.knock * (behind ? 1.25 : 1); target.vz = Math.max(target.vz, T.lift);
    target.ground = false; target.hook = 0;
    target.stun = Math.round((behind ? T.behindStun : T.stun) * TICK_RATE);
    p.shoves++;
    for (let n = behind ? 2 : 1; n > 0 && target.carry.length; n--) {
        const id = target.carry[target.carry.length - 1], item = findLoot(state, id);
        if (item) item.dropBy = target.team + 1;
        dropItem(state, target, target.carry.length - 1, "shove");
    }
}

function flare(state, island, p) {
    const T = TOOLS.flare, a = aimOf(p), oz = p.z + 1.5;
    const t = rayIsland(island, p.x, p.y, oz, a.x, a.y, a.z, T.range), d = t < 0 ? T.range : Math.max(0, t - 0.2);
    const fx = p.x + a.x * d, fy = p.y + a.y * d, fz = oz + a.z * d;
    state.flares.push({ team: p.team, owner: p.id, x: fx, y: fy, z: fz, ticks: Math.round(T.mark * TICK_RATE) });
    if (state.flares.length > 16) state.flares.shift();
    state.events.push({ type: "flare", id: p.id, team: p.team, x: fx, y: fy, z: fz });
    for (const q of state.players) {
        if (!q.alive || q.team === p.team) continue;
        const hx = q.x, hy = q.y, hz = q.z + MOVE.eye, ox = fx - hx, oy = fy - hy, oz2 = fz - hz, dd = Math.sqrt(ox * ox + oy * oy + oz2 * oz2);
        if (dd > T.blindRadius) continue;
        const v = aimOf(q);
        if (dd > 0.5 && (v.x * ox + v.y * oy + v.z * oz2) / dd < 0.25) continue;
        // a flare burns a little above where it lands, so a bump in the sand beside it doesn't hide it
        if (!clearLine(island, fx, fy, fz + 0.5, hx, hy, hz)) continue;
        q.blind = Math.round(T.blind * TICK_RATE);
        state.events.push({ type: "blind", id: q.id, by: p.id });
    }
}

// ------------------------------------------------------------------ the tick

function drown(state, island, p) {
    p.alive = false; p.vx = p.vy = p.vz = 0; p.hook = 0;
    for (const id of p.carry) { const item = findLoot(state, id); if (item) p.lost += valueOf(item.kind); }
    dropAll(state, island, p, false);
    p.respawn = Math.round(MATCH.respawn * TICK_RATE);
    p.drowned++;
    state.events.push({ type: "drown", id: p.id });
}

function applyInput(state, island, p, input, level) {
    stepPlayer(island, p, input, level);
    if (!p.alive) return;
    if (p.jumped) state.events.push({ type: "jump", id: p.id });
    if (p.hookFired) state.events.push({ type: "hook", id: p.id, hit: p.hookFired === 1 ? 1 : 0, x: p.hx, y: p.hy, z: p.hz });
    if (p.wantDrop && p.carry.length) dropItem(state, p, p.carry.length - 1, "drop");
    if (p.wantPick) pickUp(state, p);
    if (p.shoved) shoves.push(p, input.lag || 0);
    if (p.flared) flare(state, island, p);
    if (p.gasp) {
        let heavy = false;
        for (const id of p.carry) { const it = findLoot(state, id); if (it && weightOf(it.kind) >= 3) heavy = true; }
        if (heavy) { dropAll(state, island, p, true); p.breath = Math.round(WATER.breath * 0.35 * TICK_RATE); }
        else drown(state, island, p);
    }
    if (p.z < MOVE.killZ) drown(state, island, p);
}
const shoves = [];

/**
 * Advance the whole match by one tick.
 *
 * Each player's entry in `inputs` is one input or a list of them (late inputs catching up), as in BREACH:
 * an empty list means nothing arrived and that player's own time stands still; no entry means idle.
 * @param {ReturnType<typeof createState>} state
 * @param {object} island
 * @param {Map<number, PlayerInput | PlayerInput[]>} inputs
 */
export function step(state, island, inputs) {
    state.events.length = 0;
    state.tick++;
    if (state.phase === "over") { if (state.overTicks > 0) state.overTicks--; return; }
    const tide = tideAt(state.seed, state.tick, state.tideInfo), level = tide.level;

    // a new tide: the ebb refills the ruins; a new phase is announced
    if (tide.phase !== state.lastPhase || tide.tide !== state.lastTide) {
        if (tide.phase === PHASE.ebb) refill(state, island);
        state.events.push({ type: "phase", phase: tide.phase, tide: tide.tide });
        state.lastPhase = tide.phase; state.lastTide = tide.tide;
    }

    shoves.length = 0;
    for (const p of state.players) {
        const given = inputs.get(p.id);
        if (Array.isArray(given)) for (let i = 0; i < given.length; i++) applyInput(state, island, p, given[i], level);
        else if (given) applyInput(state, island, p, given, level);
        else { idle.seq = p.seq; idle.yaw = p.yaw; idle.pitch = p.pitch; applyInput(state, island, p, idle, level); }
        if (p.alive) bankAt(state, island, p);
    }
    // remember where everyone is, for shoves that arrive late
    const slot = (state.tick & (HISTORY - 1)) * 3;
    for (const p of state.players) { p.hist[slot] = p.x; p.hist[slot + 1] = p.y; p.hist[slot + 2] = p.z; }
    for (let i = 0; i < shoves.length; i += 2) if (shoves[i].alive) shove(state, island, shoves[i], shoves[i + 1]);

    settleLoot(state, island, level);
    for (let i = state.flares.length - 1; i >= 0; i--) if (--state.flares[i].ticks <= 0) state.flares.splice(i, 1);
    for (const p of state.players) if (!p.alive && --p.respawn <= 0) spawnPlayer(state, island, p);

    if (tide.over) endMatch(state);
}
const idle = { seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, lag: 0 };

function endMatch(state) {
    if (state.phase !== "play") return;
    state.phase = "over";
    state.overTicks = Math.round(MATCH.intermission * TICK_RATE);
    let best = -1, top = -1, tie = false;
    for (let t = 0; t < state.teams; t++) {
        if (state.bank[t] > top) { top = state.bank[t]; best = t; tie = false; }
        else if (state.bank[t] === top) tie = true;
    }
    state.winner = tie ? -1 : best;
    state.events.push({ type: "over", winner: state.winner });
}

/** Where a carried item hangs, for drawing (and for the snapshot of the loot). */
export function carriedPosition(p, index, out) {
    out[0] = p.x - p.fx * 0.35; out[1] = p.y - p.fy * 0.35; out[2] = p.z + 1.0 + index * 0.18;
    return out;
}

// ------------------------------------------------------------------ checks

/** A short fingerprint of everything that must match between two runs of the simulation. */
export function hashState(state, h = 0x811c9dc5) {
    const f = new Float64Array(1), u = new Uint32Array(f.buffer);
    const mix = (n) => { f[0] = n; h = Math.imul(h ^ u[0], 0x01000193); h = Math.imul(h ^ u[1], 0x01000193); };
    mix(state.tick); mix(state.rng);
    for (const b of state.bank) mix(b);
    for (const p of state.players) {
        mix(p.id); mix(p.x); mix(p.y); mix(p.z); mix(p.vx); mix(p.vy); mix(p.vz); mix(p.yaw); mix(p.pitch);
        mix(p.ground ? 1 : 0); mix(p.water); mix(p.breath); mix(p.weight); mix(p.alive ? 1 : 0); mix(p.hook); mix(p.stun); mix(p.carry.length);
    }
    for (const l of state.loot) { mix(l.id); mix(l.kind); mix(l.x); mix(l.y); mix(l.z); mix(l.holder); }
    return h >>> 0;
}
