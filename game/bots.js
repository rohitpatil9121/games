import { FOLDS, BTN, TICK_RATE, FLIGHT } from "./data.js";
import { makeRandom } from "./det.js";
import { stepPlane, steerToward } from "./sim.js";
import { crosses } from "./rings.js";

/**
 * PAPER PLANES: bot brains (the `game-ai` and `ai-behavior-trees-utility-ai` skills).
 *
 * A bot is an ordinary player whose input comes from here: think() turns a view of the match into one tick
 * of input (pitch, roll, buttons), the same thing a person's controls produce, and the same `steerToward`
 * that mouse-aim uses turns an aim into that input. Bots obey the same rules and fly the same folds.
 *
 * WHAT A BOT KNOWS (fairness). What a player's HUD gives them: the planes it can see (a ray from it to the
 * plane, clear of furniture) and the plane the arrow points at (the nearest target when "it", the nearest
 * "it" when clean), which a person always has too. The air, the room and the eraser spots, like a person
 * who knows the room. Nothing else: no peeking at inputs, no speed boosts.
 *
 * DECIDING (utility AI, TIDEFALL's structure). Every `reaction` ticks the bot scores what it could do, each
 * a product of considerations through 0..1 curves, with a 15% bonus for what it is already doing
 * (hysteresis):
 *
 *   chase    ("it" or a hunter) the nearest target it knows of
 *   flee     (clean) the nearest "it", more urgent the closer and faster it closes
 *   eraser   (clean, normal and hard bots) a nearby eraser, less when "it" is near
 *   climb    low on height: go and ride the biggest thermal up
 *   roam     otherwise, glide toward a spot in the room, changing every few seconds
 *   ring     Ring Run: the next ring
 *
 * FLYING (reading the air). Decision and motion are separate (game-ai). The decision is a goal; the bot
 * then tries 15 aims (five headings either side of the goal's, three pitches) by running its own plane
 * forward in the real simulation for its look-ahead (so the fan, the thermals, gusts and turbulence are in
 * every guess, exactly as they will be), and scores each run: crashing is terrible, grazing furniture bad,
 * losing height and speed costs, and the goal's own term (closeness to the goal; for a chase, closeness to
 * where the target is heading; for a flight, distance from where "it" is heading). It flies the best aim
 * until the next decision. That is how a chaser finds the thermal that cuts the corner, or a runner the
 * fan that flings it away, without being told about either.
 *
 * SKILL changes only reaction time (27, 15, 7 ticks between decisions: 0.45, 0.25, 0.12 s), how far
 * ahead it reads the air (0.5, 0.8, 1.2 s), how precisely it judges where things are (aim noise) and
 * whether it goes for erasers. Never speed.
 * @module game/bots
 */

const REACTION = [0, 27, 15, 7];
const LOOKAHEAD = [0, 30, 48, 72];
const NOISE = [0, 0.25, 0.1, 0.03];
const YAWS = [-1.2, -0.6, 0, 0.6, 1.2];
const PITCHES = [-0.45, -0.1, 0.3];
/**
 * Plans allowed per server tick across every bot (each is 15 flights of up to 72 ticks): past it, a bot keeps
 * flying its last plan a tick longer. Spreads the cost so no tick does all the thinking (TIDEFALL's budget).
 */
const PLAN_BUDGET = 3;
const budget = { tick: -1, used: 0 };
function spend(state) { if (budget.tick !== state.tick) { budget.tick = state.tick; budget.used = 0; } if (budget.used >= PLAN_BUDGET) return false; budget.used++; return true; }

/** Response curves: a fact into 0..1. */
const curve = {
    linear: (x) => Math.max(0, Math.min(1, x)),
    /** 1 when x is small, falling to 0 at x = 1 */
    falling: (x) => { const t = Math.max(0, Math.min(1, x)); return 1 - t * t; },
};

export function createBrain(p, skill, seed) {
    const rand = makeRandom(seed >>> 0);
    return {
        id: p.id, skill: Math.max(1, Math.min(3, skill | 0)), rand, seq: 0,
        wait: Math.floor(rand() * 20),
        intent: "roam", target: 0, goal: [0, 0, 1.5], roamAt: 0,
        aimYaw: p.yaw, aimPitch: 0, flap: false,
        /** last seen positions of other planes: id → { x, y, z, vx, vy, vz, tick } */
        seen: new Map(),
        /** the decision just made, for the debug overlay and the bot-match report */
        scores: null,
    };
}

// ------------------------------------------------------------------ what a bot can see

/** a ray from a to b clear of furniture? (the walls can't be between two points in the room) */
function clear(room, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (const b of room.boxes) {
        let tin = 0, tout = 1;
        const o = [ax, ay, az], d = [dx, dy, dz];
        let hit = true;
        for (let i = 0; i < 3 && hit; i++) {
            if (Math.abs(d[i]) < 1e-9) { if (o[i] < b.min[i] || o[i] > b.max[i]) hit = false; continue; }
            let t0 = (b.min[i] - o[i]) / d[i], t1 = (b.max[i] - o[i]) / d[i];
            if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
            if (t0 > tin) tin = t0;
            if (t1 < tout) tout = t1;
            if (tin > tout) hit = false;
        }
        if (hit) return false;
    }
    return true;
}

/** update what the bot knows of the others: what it sees, plus the one its HUD arrow points at */
function look(state, bot, brain) {
    let arrow = null, ad = Infinity;
    for (const q of state.players) {
        if (q === bot) continue;
        const relevant = bot.it ? !q.it : q.it;
        const d = Math.hypot(q.x - bot.x, q.y - bot.y, q.z - bot.z);
        if (relevant && q.crumpled === 0 && d < ad) { ad = d; arrow = q; }
        if (clear(state.room, bot.x, bot.y, bot.z, q.x, q.y, q.z)) remember(brain, q, state.tick);
    }
    if (arrow) remember(brain, arrow, state.tick);
    for (const [id, s] of brain.seen) if (state.tick - s.tick > 300 || !state.players.some((q) => q.id === id)) brain.seen.delete(id);
}
function remember(brain, q, tick) {
    const s = brain.seen.get(q.id) || {};
    Object.assign(s, { x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz, tick, it: q.it, crumpled: q.crumpled > 0, guard: q.guard > 0 });
    brain.seen.set(q.id, s);
}

// ------------------------------------------------------------------ deciding

const thermalTop = (room) => {
    let best = null;
    for (const s of room.air) if (s.kind === "thermal" && (!best || s.radius > best.radius)) best = s;
    return best ? [best.at[0] + best.radius * 0.6, best.at[1], best.top - 0.2] : [0, 0, 2];
};

function decide(state, bot, brain) {
    const room = state.room, f = FOLDS[bot.fold];
    const scores = {};
    let best = { intent: "roam", score: 0.15, target: 0, goal: brain.goal };
    const consider = (intent, score, target, goal) => {
        if (brain.intent === intent && brain.target === target) score *= 1.15;
        scores[intent] = Math.max(scores[intent] || 0, score);
        if (score > best.score) best = { intent, score, target, goal };
    };
    const energy = bot.z + (bot.speed * bot.speed) / (2 * FLIGHT.gravity);

    if (bot.run) {
        const r = bot.run.ring;
        if (r) consider("ring", 1, 0, r.at.slice());
    } else if (bot.it) {
        // chase the nearest target it knows of, by where it's going
        let target = null, td = Infinity;
        for (const [id, s] of brain.seen) {
            if (s.it || s.crumpled || s.guard) continue;
            const d = Math.hypot(s.x - bot.x, s.y - bot.y, s.z - bot.z);
            if (d < td) { td = d; target = [id, s]; }
        }
        if (target) consider("chase", 0.9 * (0.5 + 0.5 * curve.falling(td / 6)), target[0], [target[1].x, target[1].y, target[1].z]);
        consider("climb", 0.6 * curve.falling(energy / 1.0), 0, thermalTop(room));
    } else {
        // clean: how near is the nearest "it", and is it closing?
        let hunter = null, hd = Infinity;
        for (const [id, s] of brain.seen) {
            if (!s.it || s.crumpled) continue;
            const d = Math.hypot(s.x - bot.x, s.y - bot.y, s.z - bot.z);
            if (d < hd) { hd = d; hunter = [id, s]; }
        }
        let threat = 0;
        if (hunter) {
            const s = hunter[1], rx = bot.x - s.x, ry = bot.y - s.y, rz = bot.z - s.z;
            const closing = hd > 0 ? (s.vx * rx + s.vy * ry + s.vz * rz) / hd : 0;
            threat = curve.falling(hd / 2.2) * (0.6 + 0.4 * curve.linear(closing / 1.2));
            consider("flee", threat, hunter[0], [s.x, s.y, s.z]);
        }
        if (brain.skill >= 2 && state.erasers) {
            for (const e of state.erasers) {
                if (state.tick < e.at || (state.mode === "spread" && bot.shield)) continue;
                const s = room.erasers[e.spot], d = Math.hypot(s[0] - bot.x, s[1] - bot.y, s[2] - bot.z);
                consider("eraser", 0.55 * curve.falling(d / 2.5) * (1 - threat), 100 + e.spot, s.slice());
            }
        }
        consider("climb", 0.5 * curve.falling(energy / 1.0) * (1 - threat * 0.7), 0, thermalTop(room));
    }
    // roam: a spot in the room, kept for a few seconds
    if (state.tick >= brain.roamAt || brain.intent !== "roam") {
        const l = room.launches[Math.floor(brain.rand() * room.launches.length)];
        brain.roamGoal = [l.at[0] * 0.8, l.at[1] * 0.8, l.at[2] - 0.2];
        brain.roamAt = state.tick + 180 + Math.floor(brain.rand() * 180);
    }
    consider("roam", 0.15, 0, brain.roamGoal || [0, 0, 1.6]);

    brain.intent = best.intent; brain.target = best.target; brain.goal = best.goal; brain.scores = scores;
}

// ------------------------------------------------------------------ flying: try aims in the real simulation

const ghost = { events: [], hit: { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 } };
const FIELDS = ["id", "fold", "x", "y", "z", "yaw", "pitch", "roll", "speed", "bump", "vx", "vy", "vz", "flapWait", "flapBuffer", "stalled", "crumpled", "guard", "held", "clock", "it", "inFan", "inLift", "inGust"];
const ghostInput = { pitch: 0, roll: 0, buttons: 0 };

/**
 * Fly a copy of the plane for `ticks`, steering at (yaw, pitch), and score how it went for the intent.
 * The target (chase) or hunter (flee) is assumed to keep its velocity: a guess, which is fair.
 */
function tryAim(state, bot, brain, yaw, pitch, ticks, flap) {
    for (const k of FIELDS) ghost[k] = bot[k];
    const g = brain.goal, intent = brain.intent, other = brain.seen.get(brain.target);
    let minGoal = Infinity, minZ = Infinity, crash = -1, glances = 0, passed = false;
    const ring = intent === "ring" && bot.run ? bot.run.ring : null;
    for (let t = 0; t < ticks; t++) {
        const s = steerToward(ghost, yaw, pitch);
        ghostInput.pitch = s.pitch; ghostInput.roll = s.roll; ghostInput.buttons = flap && t === 0 ? BTN.flap : 0;
        const ax = ghost.x, ay = ghost.y, az = ghost.z;
        stepPlane(ghost, ghostInput, state.room, state.seed, true);
        ghost.clock++;
        if (ghost.events.includes("crumple")) { crash = t; break; }
        if (ghost.events.includes("glance")) glances++;
        if (ring && !passed && crosses(ring, ax, ay, az, ghost.x, ghost.y, ghost.z)) passed = true;
        if (ghost.z < minZ) minZ = ghost.z;
        // where the goal is at this moment: a moving plane's guessed position, or a fixed point
        let gx = g[0], gy = g[1], gz = g[2];
        if (other && (intent === "chase" || intent === "flee")) { const dt = (state.tick - other.tick + t) / TICK_RATE; gx = other.x + other.vx * dt; gy = other.y + other.vy * dt; gz = other.z + other.vz * dt; }
        const d = Math.hypot(ghost.x - gx, ghost.y - gy, ghost.z - gz);
        if (intent === "flee") { if (d < minGoal) minGoal = d; } else if (d < minGoal) minGoal = d;
    }
    let score = 0;
    if (crash >= 0) score -= 100 * (1 - crash / (ticks * 2));
    score -= glances * 6;
    if (minZ < 0.3 && intent !== "eraser") score -= (0.3 - minZ) * 30;
    const energy = ghost.z + (ghost.speed * ghost.speed) / (2 * FLIGHT.gravity), e0 = bot.z + (bot.speed * bot.speed) / (2 * FLIGHT.gravity);
    score += (energy - e0) * 3;
    if (ghost.stalled) score -= 2;
    if (intent === "flee") score += Math.min(minGoal, 2.5) * 10;
    else {
        const end = Math.hypot(ghost.x - g[0], ghost.y - g[1], ghost.z - g[2]);
        score -= minGoal * (intent === "chase" ? 14 : 5) + (intent === "chase" ? 0 : end * 3);
        if (passed) score += 40;
    }
    return score;
}

/**
 * One tick of input for a bot.
 * @returns {{ seq: number, pitch: number, roll: number, buttons: number, lag: number }}
 */
export function think(state, bot, brain) {
    brain.seq++;
    if (bot.crumpled > 0) return { seq: brain.seq, pitch: 0, roll: 0, buttons: 0, lag: 0 };
    if (--brain.wait <= 0 && spend(state)) {
        brain.wait = REACTION[brain.skill];
        look(state, bot, brain);
        decide(state, bot, brain);
        // a goal judged a little wrong, by skill
        const n = NOISE[brain.skill], g = brain.goal;
        brain.goal = [g[0] + (brain.rand() * 2 - 1) * n, g[1] + (brain.rand() * 2 - 1) * n, g[2] + (brain.rand() * 2 - 1) * n * 0.5];
        // the aims to try: around the heading to the goal (away from it, fleeing)
        const g2 = brain.goal;
        let base = Math.atan2(g2[1] - bot.y, g2[0] - bot.x);
        if (brain.intent === "flee") base += Math.PI;
        const ticks = LOOKAHEAD[brain.skill], f = FOLDS[bot.fold];
        // flap when it helps: slow, or the goal is above, or closing for a tag; and only if it's ready
        const wantFlap = bot.flapWait === 0 && (bot.speed < f.stall * 1.3 || g2[2] - bot.z > 0.25 || (brain.intent === "chase" && Math.hypot(g2[0] - bot.x, g2[1] - bot.y) < 1.2));
        let bestScore = -Infinity;
        for (const dy of YAWS) for (const pitch of PITCHES) {
            const s = tryAim(state, bot, brain, base + dy, pitch, ticks, wantFlap);
            if (s > bestScore) { bestScore = s; brain.aimYaw = base + dy; brain.aimPitch = pitch; }
        }
        brain.flap = wantFlap;
    }
    const s = steerToward(bot, brain.aimYaw, brain.aimPitch);
    const buttons = brain.flap ? BTN.flap : 0;
    brain.flap = false;
    return { seq: brain.seq, pitch: s.pitch, roll: s.roll, buttons, lag: 0 };
}

/** The Room's hook (server/room.mjs): how to make a brain and how one thinks. */
export const brains = { create: createBrain, think };

