import { BTN, ROLE, TICK_RATE, DT, MOVE, PING, SCANNER } from "./data.js";
import { PROP_SHAPE, PROP_LIST } from "./props.js";
import { clearLine, eyeHeight, quantizeYaw, quantizePitch, yawOf, squareYaw, fits, canDisguise } from "./sim.js";

/**
 * DECOY: bot brains. A bot is an ordinary player whose input comes from here instead of a keyboard.
 * think() looks at the match and returns one tick of input, exactly what a client would send, so a bot
 * can do nothing a person couldn't. Each is a small state machine (game-ai: FSM for a handful of clear
 * states), finding its way on the map's waypoint graph with A* (taken from BREACH's bots).
 *
 * HIDERS go to a hiding spot: a place right beside a real prop, in line with it, where there is room to
 * stand as that prop. They take the prop's shape, face the way it faces, lock, and keep still. They move
 * only when a seeker is close and looking the other way (or when they are hit), to a spot further off.
 * Now and then, when no seeker is near, they taunt for the points.
 *
 * SEEKERS walk the map, preferring places with many props, and go to where they hear a taunt or a squeak.
 * They remember every prop-shaped thing they have seen and grow suspicious of it: it moved since they last
 * saw it, it is moving now, it is near a noise, it has no twin nearby, it stands crooked. Past a threshold
 * they scan it. They sometimes guess wrong and scan the real prop next to it instead, which costs them.
 * They throw ping grenades where they last heard something.
 *
 * WHAT KEEPS THEM HONEST: they only see things they have a clear line to (walls block), inside a field
 * of view; they need a reaction time; their aim turns at a limited rate and wanders. They know where the
 * real props are only as anyone who has played the map would. Skill changes reaction time, aim and how
 * quickly suspicion builds, never damage or health.
 * @module game/bots
 */

/** per skill: ticks before firing, turn rate (rad/s), aim error (rad), half field of view (rad), sight (m),
 *  how fast suspicion builds, chance of scanning the wrong prop, how far off a heard noise is placed (m),
 *  chance per check of taunting when safe, of slipping away from a seeker who turned their back */
const SKILL = [null,
    { react: 46, turn: 3.2, error: 0.07, fov: 0.95, sight: 20, notice: 0.55, wrong: 0.3, hearing: 6, brave: 0.004, slip: 0.08 },
    { react: 28, turn: 5, error: 0.045, fov: 1.15, sight: 26, notice: 0.85, wrong: 0.15, hearing: 3.5, brave: 0.008, slip: 0.15 },
    { react: 15, turn: 8, error: 0.025, fov: 1.35, sight: 32, notice: 1.25, wrong: 0.06, hearing: 2, brave: 0.012, slip: 0.25 },
];
/** suspicion past which a seeker scans something */
const THRESHOLD = 1;
const PI = Math.PI, TAU = PI * 2;
const wrap = (a) => { a %= TAU; return a > PI ? a - TAU : a < -PI ? a + TAU : a; };

export function createBrain(id, skill = 2, seed = 1) {
    return {
        skill: SKILL[Math.max(1, Math.min(3, skill))], level: Math.max(1, Math.min(3, skill)), rng: (seed ^ (id * 0x9e3779b1)) >>> 0,
        seq: 0, round: -1, role: 0, yaw: 0, pitch: 0, wasAlive: false,
        path: [], cursor: 0, from: -1, goal: -1, progressAt: 0,
        stuckAt: 0, sx: 0, sy: 0, stuck: 0,
        // hider
        mode: "", spot: null, holdAt: 0, checkAt: 0, pressLock: false,
        // seeker
        memory: new Map(), real: new Set(), target: null, seen: 0, heard: null, lookUntil: 0, lastPing: -99999, nextGoalAt: 0,
        err: { x: 0, y: 0, tx: 0, ty: 0, until: 0 }, trigger: 0,
        input: { seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 },
    };
}

function rand(B) {
    B.rng = (B.rng + 0x6d2b79f5) >>> 0;
    let t = B.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ finding the way (BREACH's)

export function nearestPoint(nav, x, y, z) {
    let best = -1, bestD = Infinity;
    const P = nav.points;
    for (let i = 0; i < P.length; i++) {
        const dz = Math.abs(P[i][2] - z), dx = P[i][0] - x, dy = P[i][1] - y, d = dx * dx + dy * dy + dz * dz * 9;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Shortest route between two waypoints (A*). Returns the points after the start, or [] if there is none. */
export function findPath(nav, start, goal) {
    const n = nav.points.length;
    if (start < 0 || goal < 0 || start === goal) return [];
    const cost = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const P = nav.points, g = P[goal], heap = [], rank = [];
    const push = (node, r) => {
        let i = heap.length;
        heap.push(node); rank.push(r);
        while (i > 0) { const up = (i - 1) >> 1; if (rank[up] <= r) break; heap[i] = heap[up]; rank[i] = rank[up]; i = up; }
        heap[i] = node; rank[i] = r;
    };
    const pop = () => {
        const top = heap[0], node = heap.pop(), r = rank.pop(), m = heap.length;
        if (m) {
            let i = 0;
            for (;;) {
                let c = i * 2 + 1;
                if (c >= m) break;
                if (c + 1 < m && rank[c + 1] < rank[c]) c++;
                if (rank[c] >= r) break;
                heap[i] = heap[c]; rank[i] = rank[c]; i = c;
            }
            heap[i] = node; rank[i] = r;
        }
        return top;
    };
    cost[start] = 0;
    push(start, 0);
    while (heap.length) {
        const a = pop();
        if (a === goal) break;
        if (done[a]) continue;
        done[a] = 1;
        for (const link of nav.out[a]) {
            const c = cost[a] + link.cost;
            if (c >= cost[link.to]) continue;
            cost[link.to] = c; prev[link.to] = a;
            const p = P[link.to];
            push(link.to, c + Math.hypot(p[0] - g[0], p[1] - g[1], p[2] - g[2]));
        }
    }
    if (prev[goal] < 0) return [];
    const path = [];
    for (let a = goal; a !== start; a = prev[a]) path.push(a);
    return path.reverse();
}

function goTo(B, nav, bot, goal) {
    const start = nearestPoint(nav, bot.x, bot.y, bot.z);
    B.path = findPath(nav, start, goal);
    B.cursor = 0; B.from = start; B.goal = goal; B.progressAt = -1;
}

/**
 * Walk the path, then straight to (fx, fy). Returns the wished direction and how far the end is.
 * Arrival slows the last half metre, so a hider stops on its spot instead of sliding past.
 */
const wish = { x: 0, y: 0, d: 0, jump: false, lookX: 0, lookY: 0 };
function follow(B, map, bot, tick, fx, fy) {
    const nav = map.nav;
    wish.x = wish.y = 0; wish.jump = false;
    if (B.cursor < B.path.length) {
        let next = nav.points[B.path[B.cursor]];
        let dx = next[0] - bot.x, dy = next[1] - bot.y, d = Math.hypot(dx, dy);
        if (B.progressAt < 0) B.progressAt = tick;
        if (d < 0.6 && Math.abs(next[2] - bot.z) < 1.2) {
            B.from = B.path[B.cursor++];
            B.progressAt = tick;
            if (B.cursor < B.path.length) { next = nav.points[B.path[B.cursor]]; dx = next[0] - bot.x; dy = next[1] - bot.y; d = Math.hypot(dx, dy); }
        }
        if (B.cursor < B.path.length) {
            if (d > 7 || tick - B.progressAt > 150) { B.path.length = 0; B.cursor = 0; }
            else {
                wish.x = dx / (d || 1); wish.y = dy / (d || 1);
                const link = B.from >= 0 ? nav.out[B.from].find((l) => l.to === B.path[B.cursor]) : null;
                if (link && link.kind === 1 && bot.ground) wish.jump = true;
                const ahead = nav.points[B.path[Math.min(B.path.length - 1, B.cursor + 1)]];
                wish.lookX = ahead[0]; wish.lookY = ahead[1];
                wish.d = Math.hypot(fx - bot.x, fy - bot.y);
                return wish;
            }
        }
    }
    const dx = fx - bot.x, dy = fy - bot.y, d = Math.hypot(dx, dy);
    wish.d = d;
    if (d > 0.02) { const k = Math.min(1, d / 0.6); wish.x = (dx / d) * k; wish.y = (dy / d) * k; }
    wish.lookX = fx; wish.lookY = fy;
    return wish;
}

// ------------------------------------------------------------------ hiding spots

const spotCache = new WeakMap();
/**
 * Every place a hider could stand beside a real prop as a copy of it: next to it on each of its four
 * sides, squared with it, with room to stand, something underneath, and a waypoint close by at the same
 * height (so a bot can walk there). Worked out once per map.
 */
export function hidingSpots(map) {
    if (spotCache.has(map)) return spotCache.get(map);
    const spots = [], nav = map.nav;
    const seekerSpawns = map.spawns.seeker;
    map.props.forEach((q, index) => {
        const s = PROP_SHAPE[q.type], a = yawOf(q.yaw), c = Math.cos(a), n = Math.sin(a);
        const odd = ((squareYaw(q.yaw) >> 14) & 1) === 1, hx = odd ? s[1] : s[0], hy = odd ? s[0] : s[1];
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const gap = 0.06;
            const lx = ox * (2 * s[0] + gap), ly = oy * (2 * s[1] + gap);
            const x = q.x + c * lx - n * ly, y = q.y + n * lx + c * ly, z = q.z;
            if (!fits(map, x, y, z + 0.005, hx, hy, s[2])) continue;
            // something to stand on
            if (fits(map, x, y, z - 0.06, hx * 0.5, hy * 0.5, 0.05)) continue;
            if (seekerSpawns.some((sp) => Math.hypot(sp[0] - x, sp[1] - y) < 5)) continue;
            const w = nearestPoint(nav, x, y, z);
            if (w < 0) continue;
            const p = nav.points[w];
            if (Math.hypot(p[0] - x, p[1] - y) > 2.6 || Math.abs(p[2] - z) > 0.4) continue;
            // how many props of the same kind stand near: a copy among many is hard to pick out
            let twins = 0;
            for (const r of map.props) if (r.type === q.type && Math.hypot(r.x - x, r.y - y) < 3) twins++;
            spots.push({ x, y, z, type: q.type, yaw: q.yaw, prop: index, waypoint: w, twins, square: q.yaw % 16384 === 0 });
        }
    });
    spotCache.set(map, spots);
    return spots;
}

/** spots already chosen by a hider this round: state → Map(spot → player id) */
const claims = new WeakMap();
function claimed(state) { if (!claims.has(state)) claims.set(state, new Map()); return claims.get(state); }

/** Pick a hiding spot: one with twins about, not taken, reachable, and (if `away` is given) far from it. */
function chooseSpot(state, map, bot, B, away) {
    const spots = hidingSpots(map), taken = claimed(state), nav = map.nav;
    const here = nearestPoint(nav, bot.x, bot.y, bot.z);
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
        const s = spots[Math.floor(rand(B) * spots.length)];
        if (!s) break;
        const owner = taken.get(s);
        if (owner && owner !== bot.id) continue;
        const d = Math.hypot(s.x - bot.x, s.y - bot.y);
        let score = Math.min(s.twins, 5) * (1 + B.level * 0.6) + rand(B) * 4 - d * (state.phase === "hide" ? 0.12 : 0.05);
        if (away) {
            // slipping away: somewhere near, out of every seeker's sight, and not toward the danger
            const f = Math.hypot(s.x - away[0], s.y - away[1]);
            if (f < 5 || d > 14) continue;
            score += Math.min(f, 12) * 0.4;
            for (const q of state.players) if (q.alive && q.role === ROLE.seeker && clearLine(map, q.x, q.y, q.z + MOVE.eye, s.x, s.y, s.z + 0.3, true)) score -= 15;
        }
        for (const q of state.players) if (q.alive && q.role === ROLE.seeker && Math.hypot(q.x - s.x, q.y - s.y) < 6) score -= 10;
        // spread out: one ping grenade shouldn't find the whole team
        for (const [o, id] of taken) if (id !== bot.id && Math.hypot(o.x - s.x, o.y - s.y) < 6) score -= 6;
        if (score > bestScore && (s.waypoint === here || findPath(nav, here, s.waypoint).length)) { bestScore = score; best = s; }
    }
    for (const [s, id] of taken) if (id === bot.id) taken.delete(s);
    if (best) taken.set(best, bot.id);
    B.spot = best;
    B.mode = best ? "go" : "hold";
    if (best) goTo(B, nav, bot, best.waypoint);
}

function thinkHider(state, map, bot, B, input) {
    const sk = B.skill, tick = state.tick;
    let wx = 0, wy = 0, sprint = false, jump = false;
    // hit: run, leaving a decoy behind where it stood
    for (const e of state.events) if ((e.type === "squeak" || (e.type === "taunt" && e.forced)) && e.id === bot.id) B.exposed = tick;
    for (const e of state.events) if (e.type === "hurt" && e.id === bot.id) {
        const by = state.players.find((p) => p.id === e.by);
        if (bot.decoys > 0) input.buttons |= BTN.ability;
        chooseSpot(state, map, bot, B, by ? [by.x, by.y] : null);
        B.panic = tick + 3 * TICK_RATE;
    }
    if (!B.spot && B.mode !== "hold") chooseSpot(state, map, bot, B, null);
    const spot = B.spot;
    if (B.mode === "go" && spot) {
        const w = follow(B, map, bot, tick, spot.x, spot.y);
        wx = w.x; wy = w.y; jump = w.jump;
        sprint = state.phase === "hide" || tick < (B.panic || 0);
        B.yaw = Math.atan2(w.lookY - bot.y, w.lookX - bot.x) || B.yaw;
        if (w.d < 0.12 && B.cursor >= B.path.length) { B.mode = "settle"; B.holdAt = tick; wx = wy = 0; }
        if (tick - (B.progressAt < 0 ? tick : B.progressAt) > 240) { B.spot = null; B.mode = ""; }
    } else if (B.mode === "settle" && spot) {
        // face the way the real one faces, take its shape, lock
        B.yaw = yawOf(spot.yaw);
        if (Math.hypot(spot.x - bot.x, spot.y - bot.y) > 0.3) B.mode = "go";
        else if (bot.prop !== spot.type) { if (bot.disguiseCool === 0 && bot.yaw === spot.yaw) { if (canDisguise(map, bot, spot.prop)) input.prop = spot.prop + 1; else { B.spot = null; B.mode = ""; } } }
        else if (spot.square && !bot.locked) { if (!B.pressLock) { input.buttons |= BTN.lock; B.pressLock = true; } else B.pressLock = false; }
        else { B.mode = "hold"; B.checkAt = tick + 20; }
        if (tick - B.holdAt > 4 * TICK_RATE) { B.spot = null; B.mode = ""; }
    } else if (B.mode === "hold") {
        if (spot && !spot.square) B.yaw = yawOf(spot.yaw);
        if (tick >= B.checkAt) {
            B.checkAt = tick + 30;
            // a seeker close by with its back turned is the moment to go; but not if another seeker in view is
            // looking this way (a hider sees the seekers it has a line to, and which way they face)
            let near = Infinity, threat = null, watched = false;
            for (const q of state.players) {
                if (!q.alive || q.role !== ROLE.seeker) continue;
                const d = Math.hypot(q.x - bot.x, q.y - bot.y);
                if (d < near) near = d;
                if (d > 30 || !clearLine(map, bot.x, bot.y, bot.z + bot.h * 0.6, q.x, q.y, q.z + MOVE.eye)) continue;
                const facing = Math.cos(yawOf(q.yaw) - Math.atan2(bot.y - q.y, bot.x - q.x));
                if (facing > 0.5) watched = true;
                else if (d < 4.5 && facing < -0.3) threat = q;
            }
            if (watched) threat = null;
            if (threat && rand(B) < sk.slip) chooseSpot(state, map, bot, B, [threat.x, threat.y]);
            // found out by a ping grenade, or just taunted: slip away while nobody is looking, if clever enough
            else if (!watched && B.exposed > tick - 8 * TICK_RATE && near > 5 && rand(B) < sk.slip * 0.5) { chooseSpot(state, map, bot, B, [bot.x, bot.y]); B.exposed = 0; }
            // taunt for the points, but only when the seekers are well away and the clock has run a while
            else if (near > 18 && state.phase === "seek" && state.timeLeft < state.times.seek - 40 * TICK_RATE && bot.tauntCool === 0 && rand(B) < sk.brave * 30) { input.buttons |= BTN.taunt; B.exposed = tick; }
        }
    }
    return { wx, wy, sprint, jump };
}

// ------------------------------------------------------------------ seeking

/** Things a seeker can see that might be a hider: hiders and decoys (both look like props), with their key. */
function* lookables(state) {
    for (const p of state.players) if (p.alive && p.role === ROLE.hider) yield { key: p.id, kind: "player", x: p.x, y: p.y, z: p.z, h: p.h, type: p.prop, yaw: p.propYaw, speed: Math.hypot(p.vx, p.vy), id: p.id };
    for (const d of state.decoys) yield { key: 10000 + d.id, kind: "decoy", x: d.x, y: d.y, z: d.z, h: d.h, type: d.type, yaw: d.yaw, speed: d.left > 0 ? 5 : 0, id: d.id };
}

/** what made a seeker suspicious, counted for tools/bot-match.mjs (only when it asks: globalThis.DECOY_WHY) */
function why(m, reason) { m.why = m.why || {}; m.why[reason] = (m.why[reason] || 0) + 1; }

/** Is there a real prop of this type near this place? A copy standing alone is odd. */
function twinNear(map, type, x, y) {
    for (const q of map.props) if (q.type === type && Math.hypot(q.x - x, q.y - y) < 3 && Math.hypot(q.x - x, q.y - y) > 0.05) return true;
    return false;
}

function look(state, map, bot, B) {
    const sk = B.skill, tick = state.tick, ex = bot.x, ey = bot.y, ez = bot.z + eyeHeight(bot);
    const heard = B.heard && tick - B.heard.tick < 15 * TICK_RATE ? B.heard : null;
    for (const o of lookables(state)) {
        const cx = o.x, cy = o.y, cz = o.z + o.h * 0.5, d = Math.hypot(cx - ex, cy - ey);
        if (d > sk.sight) continue;
        if (d > 2.5 && Math.abs(wrap(Math.atan2(cy - ey, cx - ex) - B.yaw)) > sk.fov) continue;
        if (!clearLine(map, ex, ey, ez, cx, cy, cz) && !clearLine(map, ex, ey, ez, cx, cy, o.z + o.h - 0.03)) continue;
        let m = B.memory.get(o.key);
        if (!m) {
            m = { x: o.x, y: o.y, sus: 0, noise: 0, seen: tick, kind: o.kind, id: o.id };
            B.memory.set(o.key, m);
            if (!twinNear(map, o.type, o.x, o.y)) { m.sus += 0.35 * sk.notice; why(m, "alone"); }
        }
        const k = sk.notice * (state.late ? 1.4 : 1);
        if (Math.hypot(o.x - m.x, o.y - m.y) > 0.25 && tick - m.seen < 20 * TICK_RATE) { m.sus += 1.1 * k; why(m, "moved"); }     // it moved since I last saw it
        if (o.speed > 0.4) { m.sus += 0.55 * k; why(m, "moving"); }                                                               // it is moving now
        if (o.yaw % 8192 !== 0) { m.sus += 0.05 * k; why(m, "crooked"); }                                                          // standing crooked
        // right where that noise came from: worth a closer look, but a noise alone never makes a scan (a person
        // hearing a squeak among ten crates can't tell which one either)
        if (heard && Math.hypot(o.x - heard.x, o.y - heard.y) < 3.5 && m.noise < 0.6) { m.noise += 0.08 * k; m.sus += 0.08 * k; why(m, "noise"); }
        m.x = o.x; m.y = o.y; m.seen = tick; m.visible = tick;
    }
    for (const [key, m] of B.memory) { m.sus *= 0.997; if (tick - m.seen > 60 * TICK_RATE) B.memory.delete(key); }
}

/** Where a ping grenade thrown at this pitch lands, horizontally, from standing still. */
function throwRange(pitch, dz) {
    let x = 0, z = 0, vx = Math.cos(pitch) * PING.speed, vz = Math.sin(pitch) * PING.speed + PING.up;
    for (let i = 0; i < 400; i++) { vz -= MOVE.gravity * DT; x += vx * DT; z += vz * DT; if (vz < 0 && z <= dz) return x; }
    return x;
}

function thinkSeeker(state, map, bot, B, input) {
    const sk = B.skill, tick = state.tick, nav = map.nav;
    let wx = 0, wy = 0, sprint = false, jump = false;
    // listen: taunts and squeaks carry, a little off where they really were
    for (const e of state.events) {
        if ((e.type === "taunt" || e.type === "squeak") && Math.hypot(e.x - bot.x, e.y - bot.y) < 45) {
            const a = rand(B) * TAU, r = rand(B) * sk.hearing;
            B.heard = { x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, z: e.z, tick };
            B.path.length = 0; B.cursor = 0;
        }
        if (e.type === "hurt" && e.by === bot.id && !e.self) { const m = B.memory.get(e.id); if (m) m.sus = 10; }
        // my own ping grenade: the props it outlined are people, as it shows a person
        if (e.type === "ping" && e.by === bot.id) for (const id of e.ids) { const p = state.players.find((q) => q.id === id); if (p) { B.memory.set(id, { x: p.x, y: p.y, sus: 6, noise: 0, seen: tick, kind: "player", id }); why(B.memory.get(id), "ping"); } }
        // a scan that cost me: whatever I was aiming at, I missed it; steady the aim before the next
        if (e.type === "hurt" && e.id === bot.id && e.self) B.trigger = 25;
        if (e.type === "hurt" && e.id === bot.id && e.self && B.target && B.target.kind === "prop") { B.real.add(B.target.index); B.target = null; }
        if (e.type === "burst") B.burst = { x: e.x, y: e.y, tick };
        if (e.type === "pop" && B.target && B.target.kind === "decoy" && B.target.id === e.did) B.target = null;
    }
    if ((tick + bot.id * 3) % 4 === 0) look(state, map, bot, B);

    // pick what to scan: the most suspicious thing seen just now
    if (!B.target || tick % 20 === 0) {
        // low on health, a seeker scans only what it is sure of
        let best = null, bestSus = THRESHOLD * (bot.health <= 30 ? 4 : 1);
        for (const [key, m] of B.memory) if (m.visible > tick - 30 && m.sus > bestSus) { best = { key, kind: m.kind, id: m.id }; bestSus = m.sus; }
        if (best && (!B.target || B.target.key !== best.key)) {
            B.seen = 0;
            const m = B.memory.get(best.key);
            // a guess: sometimes the real prop beside it gets the blame instead
            if (m.sus < THRESHOLD * 2.5 && bot.health > 25 && rand(B) < sk.wrong) {
                let pick = -1, pd = 3;
                map.props.forEach((q, i) => { const d = Math.hypot(q.x - m.x, q.y - m.y); if (d < pd && !B.real.has(i)) { pd = d; pick = i; } });
                if (pick >= 0) best = { key: "prop" + pick, kind: "prop", index: pick };
            }
            B.target = best;
        }
    }
    // where is the target now?
    let tx = 0, ty = 0, tz = 0, have = false;
    const t = B.target;
    if (t) {
        if (t.kind === "player") { const p = state.players.find((q) => q.id === t.id); if (p && p.alive) { tx = p.x; ty = p.y; tz = p.z + p.h * 0.45; have = true; } }
        else if (t.kind === "decoy") { const d = state.decoys.find((q) => q.id === t.id); if (d) { tx = d.x; ty = d.y; tz = d.z + d.h * 0.45; have = true; } }
        else { const q = map.props[t.index]; tx = q.x; ty = q.y; tz = q.z + PROP_SHAPE[q.type][2] * 0.45; have = true; }
        const ez = bot.z + eyeHeight(bot);
        if (have && !clearLine(map, bot.x, bot.y, ez, tx, ty, tz)) have = false;
        if (!have) B.target = null;
    }

    let wantYaw = B.yaw, wantPitch = 0, onTarget = false;
    if (have) {
        const ez = bot.z + eyeHeight(bot), dx = tx - bot.x, dy = ty - bot.y, flat = Math.hypot(dx, dy);
        const exactYaw = Math.atan2(dy, dx), exactPitch = Math.atan2(tz - ez, flat);
        const e = B.err;
        if (tick >= e.until) { e.tx = (rand(B) + rand(B) - 1) * sk.error; e.ty = (rand(B) + rand(B) - 1) * sk.error * 0.6; e.until = tick + 12 + Math.floor(rand(B) * 24); }
        e.x += (e.tx - e.x) * 0.12; e.y += (e.ty - e.y) * 0.12;
        wantYaw = exactYaw + e.x; wantPitch = exactPitch + e.y;
        const size = Math.atan2(0.18, Math.max(1, flat));
        onTarget = Math.abs(wrap(B.yaw - exactYaw)) < size + sk.error * 0.5 && Math.abs(B.pitch - exactPitch) < size + sk.error * 0.5;
        B.seen++;
        if (flat > 11) { goTo(B, nav, bot, nearestPoint(nav, tx, ty, tz)); const w = follow(B, map, bot, tick, tx, ty); wx = w.x; wy = w.y; }
        else B.path.length = 0;
    } else {
        // nothing to scan: go where the noise was, or somewhere with props to look at
        const heard = B.heard && tick - B.heard.tick < 15 * TICK_RATE ? B.heard : null;
        if (heard && Math.hypot(heard.x - bot.x, heard.y - bot.y) > 2.5) {
            if (!B.path.length || B.goalFor !== heard.tick) { goTo(B, nav, bot, nearestPoint(nav, heard.x, heard.y, heard.z)); B.goalFor = heard.tick; }
            const w = follow(B, map, bot, tick, heard.x, heard.y); wx = w.x; wy = w.y; jump = w.jump;
            wantYaw = Math.atan2(w.lookY - bot.y, w.lookX - bot.x);
            // a ping grenade where the noise was, when near enough to throw one there
            const d = Math.hypot(heard.x - bot.x, heard.y - bot.y);
            const pinged = B.burst && tick - B.burst.tick < 12 * TICK_RATE && Math.hypot(B.burst.x - heard.x, B.burst.y - heard.y) < 8;
            if (bot.pings > 0 && !pinged && d < 16 && tick - B.lastPing > 12 * TICK_RATE && clearLine(map, bot.x, bot.y, bot.z + 1.6, heard.x, heard.y, heard.z + 0.5)) {
                let bestP = 0, bestE = Infinity;
                for (let p = -0.7; p <= 0.6; p += 0.05) { const err = Math.abs(throwRange(p, heard.z - (bot.z + MOVE.eye)) - d); if (err < bestE) { bestE = err; bestP = p; } }
                wantYaw = Math.atan2(heard.y - bot.y, heard.x - bot.x); wantPitch = bestP;
                if (Math.abs(wrap(B.yaw - wantYaw)) < 0.08 && Math.abs(B.pitch - bestP) < 0.06) { input.buttons |= BTN.ability; B.lastPing = tick; }
            }
        } else {
            if (heard) { B.lookUntil = tick + 3 * TICK_RATE; B.heard = null; }
            if (tick < B.lookUntil) wantYaw = B.yaw + 0.04;                                    // look round where it was
            else {
                if (B.cursor >= B.path.length || tick >= B.nextGoalAt) {
                    // somewhere with props, and away from the other seekers
                    let goal = -1, best = -Infinity;
                    for (let k = 0; k < 10; k++) {
                        const i = Math.floor(rand(B) * nav.points.length), p = nav.points[i];
                        let props = 0;
                        for (const q of map.props) if (Math.abs(q.x - p[0]) < 4 && Math.abs(q.y - p[1]) < 4) props++;
                        let score = Math.min(props, 8) + rand(B) * 4 - Math.hypot(p[0] - bot.x, p[1] - bot.y) * 0.05;
                        for (const q of state.players) if (q !== bot && q.alive && q.role === ROLE.seeker && Math.hypot(q.x - p[0], q.y - p[1]) < 8) score -= 4;
                        if (score > best) { best = score; goal = i; }
                    }
                    goTo(B, nav, bot, goal);
                    B.nextGoalAt = tick + 12 * TICK_RATE;
                }
                const end = nav.points[B.goal] || [bot.x, bot.y];
                const w = follow(B, map, bot, tick, end[0], end[1]); wx = w.x; wy = w.y; jump = w.jump;
                // look along the way, and off to the sides now and then
                wantYaw = Math.atan2(w.lookY - bot.y, w.lookX - bot.x) + Math.sin(tick * 0.02 + bot.id) * 0.6;
                wantPitch = -0.12;
            }
        }
    }
    const turn = sk.turn * DT;
    B.yaw = wrap(B.yaw + Math.max(-turn, Math.min(turn, wrap(wantYaw - B.yaw))));
    B.pitch += Math.max(-turn, Math.min(turn, wantPitch - B.pitch));
    if (B.trigger > 0) B.trigger--;
    if (onTarget && B.seen >= sk.react && B.trigger <= 0 && bot.charge >= SCANNER.cost) input.buttons |= BTN.fire;
    void PROP_LIST;
    return { wx, wy, sprint, jump };
}

// ------------------------------------------------------------------ one tick

/**
 * @param {object} state the match (read only)
 * @param {object} map
 * @param {object} bot the bot's player
 * @param {ReturnType<typeof createBrain>} B its memory
 * @returns {import("./sim.js").PlayerInput}
 */
export function think(state, map, bot, B) {
    const input = B.input, tick = state.tick;
    input.seq = ++B.seq; input.mx = 0; input.my = 0; input.buttons = 0; input.prop = 0;
    const playing = state.phase === "hide" || state.phase === "seek";
    if (B.round !== state.round || B.role !== bot.role || (bot.alive && !B.wasAlive)) {
        // a new round (or a new life): forget everything
        B.round = state.round; B.role = bot.role; B.yaw = yawOf(bot.yaw); B.pitch = 0;
        B.path.length = 0; B.cursor = 0; B.spot = null; B.mode = ""; B.memory.clear(); B.real.clear(); B.target = null; B.heard = null; B.panic = 0;
        B.sx = bot.x; B.sy = bot.y; B.stuckAt = tick + 40; B.stuck = 0; B.nextGoalAt = 0;
    }
    B.wasAlive = bot.alive;
    if (!bot.alive || !playing || bot.frozen) { input.yaw = quantizeYaw(B.yaw); input.pitch = quantizePitch(B.pitch); return input; }

    const move = bot.role === ROLE.hider ? thinkHider(state, map, bot, B, input) : thinkSeeker(state, map, bot, B, input);
    let { wx, wy } = move;

    // stuck? jump; still stuck? plan again
    if (tick >= B.stuckAt) {
        const moved = Math.hypot(bot.x - B.sx, bot.y - B.sy);
        if ((wx || wy) && Math.hypot(wx, wy) > 0.5 && moved < 0.4) { B.stuck++; if (B.stuck >= 2) { B.path.length = 0; B.cursor = 0; B.stuck = 0; if (bot.role === ROLE.hider) { B.spot = null; B.mode = ""; } } }
        else B.stuck = 0;
        B.sx = bot.x; B.sy = bot.y; B.stuckAt = tick + 30;
    }
    if ((B.stuck || move.jump) && bot.ground) input.buttons |= BTN.jump;

    const l = Math.hypot(wx, wy);
    if (l > 1e-3) {
        const k = Math.min(1, l);
        wx /= l; wy /= l;
        const cy = Math.cos(B.yaw), sy = Math.sin(B.yaw);
        input.my = Math.round((wx * cy + wy * sy) * 127 * k);
        input.mx = Math.round((wx * sy - wy * cy) * 127 * k);
        if (move.sprint && input.my > 100) input.buttons |= BTN.sprint;
    }
    input.yaw = quantizeYaw(B.yaw);
    input.pitch = quantizePitch(B.pitch);
    // a hider settling on its spot must face exactly the way the spot does
    if (bot.role === ROLE.hider && B.spot && (B.mode === "settle" || B.mode === "hold")) input.yaw = B.spot.yaw;
    return input;
}
