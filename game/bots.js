import { BTN, LOOT, LOOT_KINDS, WATER, CARRY, ISLAND, TOOLS, TICK_RATE, MOVE } from "./data.js";
import { quantizeYaw, quantizePitch, makeRandom } from "./det.js";
import { buildNav, nodeAt, nodeX, nodeY, travelField, downhill } from "./nav.js";
import { tideAt, waterAt, PHASE } from "./tide.js";
import { groundAt } from "./island.js";
import { slowOf, aimOf } from "./sim.js";

/**
 * TIDEFALL: bot brains (the `game-ai` and `ai-behavior-trees-utility-ai` skills).
 *
 * A bot is an ordinary player whose input comes from here: think() turns a view of the match into one
 * tick of input, the same thing a person's controls produce. Bots see only the state the server has
 * (they don't read other bots' minds) and they obey the same rules.
 *
 * DECIDING: utility AI. Every so often (the reaction time, which is what skill changes) the bot scores
 * each thing it could do, each score a product of considerations mapped through 0..1 response curves:
 *
 *   loot    an item's value, how far it is, and whether there is time to fetch it and still beat the
 *           flood home (the tide is a pure function of the tick, so the bot can work out exactly when
 *           the water will be over a spot: it just doesn't always trust its own sums, see greed below)
 *   home    what it carries, how heavy it is, and how little time is left
 *   steal   a rival carrying loot nearby, worth more the more they carry and the less I do
 *   defend  a teammate carrying something valuable with rivals close to them: go and stand guard
 *   rest    stay at camp through high water
 *
 * and does the best, with a little hysteresis so it doesn't flip between two equal choices.
 *
 * GREED. Each bot has a greed: how much of the time it thinks it has it is willing to spend. Skill
 * changes how well it judges that time (an easy bot misjudges the flood by up to 35%, a hard one by 5%),
 * not how fast it runs or how hard it shoves. A greedy bot sometimes gets caught by the flood and has to
 * let its idol go. That is meant.
 *
 * MOVING. Decision and motion are separate (game-ai): the decision is a goal; a travel field from the
 * goal (game/nav.js, seconds of travel at the current water level) is walked downhill, a few nodes
 * ahead, so the bot goes round ruins and prefers dry ground to water. The field is redone when the goal
 * changes and every couple of seconds as the water moves. Close to the goal it steers straight, and it
 * jumps at ledges and when it stops making progress.
 * @module game/bots
 */

const REACTION = [0, 36, 21, 12];               // ticks between decisions, by skill
const JUDGEMENT = [0, 0.35, 0.15, 0.05];         // how far wrong its sense of the flood can be
const SHOVE_DELAY = [0, 24, 12, 5];              // ticks it takes to notice someone in reach
const FIELD_EVERY = 120;                          // ticks between refreshing a travel field

/** Response curves: map a fact into 0..1. */
const curve = {
    linear: (x) => Math.max(0, Math.min(1, x)),
    smooth: (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); },
    /** 1 when x is small, falling to 0 at x = 1 */
    falling: (x) => { const t = Math.max(0, Math.min(1, x)); return 1 - t * t; },
};

export function createBrain(p, skill, seed) {
    const rand = makeRandom(seed >>> 0);
    return {
        id: p.id, skill: Math.max(1, Math.min(3, skill | 0)), rand,
        /** a personality: 0.75 careful .. 1.35 greedy */
        greed: 0.75 + rand() * 0.6,
        seq: 0, wait: Math.floor(rand() * 20),
        intent: "rest", target: null, goal: null,
        field: null, fieldGoal: -1, fieldAt: -9999,
        stuck: 0, lastX: p.x, lastY: p.y, jumpHold: 0, pickToggle: false, shoveSeen: 0, lastScores: null,
    };
}

function navOf(island) { return island._nav || (island._nav = buildNav(island)); }

const weightOf = (kind) => LOOT[LOOT_KINDS[kind]].weight;
const valueOf = (kind) => LOOT[LOOT_KINDS[kind]].value;

/**
 * Seconds from `tick` until the water at a point is too deep to wade (over the shoulders), or Infinity if
 * it won't be this tide. Exact: the tide is a function of the tick.
 */
function secondsUntilDeep(seed, tick, z) {
    for (let s = 0; s <= 60; s += 0.5) if (waterAt(seed, tick + s * TICK_RATE) > z + WATER.swimDepth) return s;
    return Infinity;
}

/** A travel field toward a goal node, kept while the goal stays and the water hasn't moved much. */
function fieldTo(brain, nav, goal, state) {
    if (brain.field && brain.fieldGoal === goal && state.tick - brain.fieldAt < FIELD_EVERY) return brain.field;
    const level = waterAt(state.seed, state.tick + 120);       // where the water will be in two seconds
    brain.field = travelField(nav, [goal], level, { out: brain.field || undefined });
    brain.fieldGoal = goal; brain.fieldAt = state.tick;
    return brain.field;
}
/** The team's field home, shared by its bots, refreshed every couple of seconds. */
function homeField(state, island, team) {
    const cache = island._home || (island._home = []);
    const c = cache[team];
    if (c && state.tick - c.at < FIELD_EVERY) return c.field;
    const nav = navOf(island), camp = island.camps[team];
    const level = waterAt(state.seed, state.tick + 300);
    const field = travelField(nav, [nodeAt(nav, camp.x, camp.y)], level, { out: c ? c.field : undefined });
    cache[team] = { field, at: state.tick };
    return field;
}

/** Choose what to do now. */
function decide(state, island, bot, brain) {
    const nav = navOf(island), tide = tideAt(state.seed, state.tick, {}), home = homeField(state, island, bot.team);
    const camp = island.camps[bot.team];
    const myNode = nodeAt(nav, bot.x, bot.y);
    const slow = slowOf(bot);
    const homeSecs = Number.isFinite(home[myNode]) ? home[myNode] / slow : Math.hypot(camp.x - bot.x, camp.y - bot.y) / (3 * slow);
    // how wrong this bot is about the flood today: fixed per decision, within its skill's error
    const misjudge = 1 + (brain.rand() * 2 - 1) * JUDGEMENT[brain.skill];
    const carried = bot.carry.reduce((v, id) => { const it = state.loot.find((l) => l.id === id); return v + (it ? valueOf(it.kind) : 0); }, 0);
    const scores = {};
    let best = { intent: "rest", score: 0.05, target: null };
    const consider = (intent, score, target) => {
        if (brain.intent === intent && (!target || target === brain.target)) score *= 1.15;       // hysteresis
        scores[intent] = Math.max(scores[intent] || 0, score);
        if (score > best.score) best = { intent, score, target };
    };

    // ---- rest: high water, or nothing worth doing; stronger the closer to high tide
    if (tide.phase === PHASE.high || (tide.phase === PHASE.flood && homeSecs > 2)) consider("rest", 0.3, null);

    // ---- home: weight, value carried, and the flood
    if (bot.carry.length) {
        const fill = bot.weight / CARRY.maxWeight;
        const deepIn = secondsUntilDeep(state.seed, state.tick, bot.z) * misjudge;
        const urgency = curve.smooth(1 - (deepIn - homeSecs) / 25);
        const enough = curve.smooth(fill / (0.35 + 0.45 * brain.greed));
        consider("home", 0.15 + 0.85 * Math.max(enough, urgency, tide.phase >= PHASE.flood ? 1 : 0) * (0.5 + 0.5 * curve.linear(carried / 150)), camp);
    }

    // ---- loot: value, distance, and whether there's time to get it and get back
    if (tide.phase <= PHASE.flood && bot.weight < CARRY.maxWeight - 0.5) {
        let checked = 0;
        const items = state.loot.filter((l) => !l.holder && bot.weight + weightOf(l.kind) <= CARRY.maxWeight)
            .map((l) => ({ l, d: Math.hypot(l.x - bot.x, l.y - bot.y) })).sort((a, b) => a.d - b.d).slice(0, 14);
        for (const { l, d } of items) {
            checked++;
            const itemNode = nodeAt(nav, l.x, l.y);
            const back = Number.isFinite(home[itemNode]) ? home[itemNode] : d / 3;
            const there = d / (MOVE.run * slow * 0.8);
            const heavier = Math.max(0.45, 1 - (bot.weight + weightOf(l.kind)) * CARRY.slowPerKg) / slow;
            const need = there + back * heavier + 2;
            // how long until the water is too deep where the item is, and on the way back (at the item's depth: the deepest point)
            const deepIn = secondsUntilDeep(state.seed, state.tick, l.z) * misjudge;
            const margin = deepIn * brain.greed - need;
            if (margin < -6) continue;
            const value = curve.linear(valueOf(l.kind) / 130);
            const near = curve.falling(d / 90);
            const safe = curve.smooth((margin + 6) / 18);
            // something underwater now is harder to get (and heavy things sink you)
            const depth = waterAt(state.seed, state.tick) - l.z;
            const reach = depth > 2.4 ? 0.1 : depth > WATER.swimDepth && weightOf(l.kind) > WATER.swimCapacity - bot.weight ? 0.4 : 1;
            consider("loot", (0.25 + 0.75 * value) * (0.3 + 0.7 * near) * safe * reach, l);
        }
        if (!checked && tide.phase === PHASE.ebb) consider("rest", 0.12, null);
    }

    // ---- steal: a rival with loot, close, while my own hands are not full
    for (const q of state.players) {
        if (q.team === bot.team || !q.alive || !q.carry.length) continue;
        const d = Math.hypot(q.x - bot.x, q.y - bot.y);
        if (d > 30) continue;
        const worth = q.carry.reduce((v, id) => { const it = state.loot.find((l) => l.id === id); return v + (it ? valueOf(it.kind) : 0); }, 0);
        consider("steal", 0.7 * curve.linear(worth / 150) * curve.falling(d / 30) * (1 - bot.weight / CARRY.maxWeight), q);
    }

    // ---- defend: a teammate with something valuable and a rival near them
    for (const mate of state.players) {
        if (mate === bot || mate.team !== bot.team || !mate.alive || mate.weight < 3) continue;
        let threat = Infinity;
        for (const q of state.players) if (q.team !== bot.team && q.alive) threat = Math.min(threat, Math.hypot(q.x - mate.x, q.y - mate.y));
        if (threat > 14) continue;
        const d = Math.hypot(mate.x - bot.x, mate.y - bot.y);
        consider("defend", 0.45 * curve.linear(mate.weight / 7) * curve.falling(threat / 14) * curve.falling(d / 40) * (bot.carry.length ? 0.3 : 1), mate);
    }

    brain.intent = best.intent;
    brain.target = best.target;
    brain.lastScores = scores;
}

/** Steer toward a point along the travel field, returning the yaw to face. */
function steer(state, island, bot, brain, gx, gy) {
    const nav = navOf(island), goal = nodeAt(nav, gx, gy);
    const d = Math.hypot(gx - bot.x, gy - bot.y);
    let tx = gx, ty = gy;
    if (d > 3.5) {
        const field = fieldTo(brain, nav, goal, state);
        let k = nodeAt(nav, bot.x, bot.y);
        if (Number.isFinite(field[k])) {
            for (let i = 0; i < 3; i++) { const n = downhill(nav, field, k); if (n === k) break; k = n; }
            tx = nodeX(nav, k); ty = nodeY(nav, k);
        }
    }
    return Math.atan2(ty - bot.y, tx - bot.x);
}

/**
 * One tick of input for a bot, or null if it is not alive.
 * @returns {{ seq: number, mx: number, my: number, buttons: number, yaw: number, pitch: number, lag: number } | null}
 */
export function think(state, island, bot, brain) {
    if (!bot.alive) return { seq: ++brain.seq, mx: 0, my: 0, buttons: 0, yaw: bot.yaw, pitch: 0, lag: 0 };
    if (state.phase !== "play") return null;
    if (--brain.wait <= 0) { brain.wait = REACTION[brain.skill]; decide(state, island, bot, brain); }

    // targets go stale: picked up by someone else, banked, gone
    let t = brain.target;
    if (brain.intent === "loot" && (!t || t.holder || !state.loot.includes(t))) { brain.wait = 0; t = null; }
    if ((brain.intent === "steal" || brain.intent === "defend") && (!t || !t.alive)) { brain.wait = 0; t = null; }

    let gx = bot.x, gy = bot.y, buttons = 0, move = 0;
    const camp = island.camps[bot.team];
    if (brain.intent === "loot" && t) { gx = t.x; gy = t.y; move = 1; }
    else if (brain.intent === "steal" && t) { gx = t.x; gy = t.y; move = 1; }
    else if (brain.intent === "defend" && t) { gx = t.x - t.fx * 2; gy = t.y - t.fy * 2; move = Math.hypot(gx - bot.x, gy - bot.y) > 2 ? 1 : 0; }
    else if (brain.intent === "home" || brain.intent === "rest") { gx = camp.x; gy = camp.y; move = Math.hypot(gx - bot.x, gy - bot.y) > (brain.intent === "home" ? 1.5 : 3.5) ? 1 : 0; }

    let yaw = move ? steer(state, island, bot, brain, gx, gy) : (bot.yaw * Math.PI * 2) / 65536;
    const dist = Math.hypot(gx - bot.x, gy - bot.y);

    // pick up what we came for (pressing on alternate ticks, so each press is an edge)
    if (brain.intent === "loot" && t && dist < CARRY.reach && Math.abs(t.z - bot.z) < CARRY.reachDown) {
        brain.pickToggle = !brain.pickToggle;
        if (brain.pickToggle) buttons |= BTN.interact;
        move = dist > 0.6 ? 1 : 0;
    }

    // shove: a rival with loot in reach in front of me (or anyone in my way when I'm stealing)
    let shoveTarget = null;
    for (const q of state.players) {
        if (q.team === bot.team || !q.alive) continue;
        const d = Math.hypot(q.x - bot.x, q.y - bot.y);
        if (d > TOOLS.shove.range * 0.9 || Math.abs(q.z - bot.z) > 1.4) continue;
        if (!q.carry.length && brain.intent !== "defend") continue;
        shoveTarget = q;
    }
    if (shoveTarget) {
        if (++brain.shoveSeen > SHOVE_DELAY[brain.skill] && bot.shoveCool === 0) {
            yaw = Math.atan2(shoveTarget.y - bot.y, shoveTarget.x - bot.x);
            buttons |= BTN.shove;
            brain.shoveSeen = 0;
        }
    } else brain.shoveSeen = 0;

    // a flare at a rival carrier closing in on our camp's route (hard and normal bots, now and then)
    if (brain.skill >= 2 && bot.flareCool === 0 && brain.intent === "steal" && t && dist < 10 && dist > 4 && brain.rand() < 0.02) buttons |= BTN.flare;

    // getting unstuck: jump at ledges, then try the grapple at something higher ahead
    const moved = Math.hypot(bot.x - brain.lastX, bot.y - brain.lastY);
    brain.lastX = bot.x; brain.lastY = bot.y;
    if (move && moved < 0.03 && !bot.hook) brain.stuck++; else if (brain.stuck > 0) brain.stuck--;
    let pitch = 0;
    if (brain.stuck > 20) buttons |= BTN.jump;
    if (brain.stuck > 70) {
        // sidestep for a moment, alternating sides
        yaw += (state.tick >> 5) & 1 ? 1.2 : -1.2;
        if (brain.stuck > 140 && bot.hookCool === 0) { pitch = 0.5; buttons |= BTN.grapple; brain.stuck = 0; }
    }
    // swimming: stroke up at edges
    if (bot.water === 2 && move && (state.tick & 15) === 0) buttons |= BTN.jump;
    // a near-ledge climb toward a target on a platform
    if (move && dist < 4 && t && t.z !== undefined && t.z > bot.z + MOVE.step) buttons |= BTN.jump;

    if (move && bot.water === 0) buttons |= BTN.sprint;
    if (brain.intent === "home" && t === camp && bot.carry.length === 0) brain.wait = 0;

    return { seq: ++brain.seq, mx: 0, my: move ? 127 : 0, buttons, yaw: quantizeYaw(yaw), pitch: quantizePitch(pitch), lag: 0 };
}

export { navOf };
