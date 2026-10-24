import { DAY_TICKS, CROPS, TRADE, ROPE, BUILD, UPGRADES, BOOST, MERCHANT_TIMES } from "./data.js";

/**
 * SKYFARM: bridges, restoration, gates, trade and glider upgrades (GDD §4, §5). Pure, used by sim.js.
 *
 * Bridges: each joins two islands of one band (world data). A broken one is two stubs of rope hanging into the
 * clouds. Standing at either stub with the rope, planks and fittings it costs, you build it; it goes up plank by
 * plank over BUILD.ticks, and when it's done both islands are restored. Its deck is walkable: a straight line
 * between the anchors with a little sag, 1.8 m wide, with rails that keep you on it.
 *
 * Restoration: Hearth Isle starts restored; any other island is restored when a bridge to it is built, or (for the
 * three no bridge reaches) when you wake the heart stone at its landmark. A restored island turns green again,
 * its landmark works (the Old Mill's sails turn, Willow Pond's waterfall runs), and a gate island's updraft rises:
 * the Old Mill's carries you to the Orchard Isles, the Orchard Gate's to the High Rocks.
 *
 * Trade: Captain Bram's airship moors off Hearth Isle every MERCHANT_TIMES.every days; he buys produce at its
 * value and sells fittings and planks. Upgrades: a rare material taken to the shed's workbench upgrades the glider
 * (sky-silk, then frost-glass); storm-amber unlocks the gust boost.
 * @module game/progression
 */

/** the bridges' and islands' starting state */
export function makeProgress(world) {
    return {
        bridges: Object.fromEntries((world.data.bridges || []).map((b) => [b.id, { state: "broken", progress: 0 }])),
        restored: new Set([world.islands[0].id]),
        coins: 0,
        tier: 0,
        boost: false,
    };
}

/** the air that is blowing: gates only once their island is restored */
export function activeAir(world, restored) {
    return world.data.air.filter((s) => !s.gate || restored.has(s.gate));
}

/** Restore an island (idempotent). */
export function restore(state, id, why) {
    const P = state.progress;
    if (P.restored.has(id)) return false;
    P.restored.add(id);
    state.air = activeAir(state.world, P.restored);
    state.events.push({ type: "restored", island: id, why });
    return true;
}

// ------------------------------------------------------------------ bridges

const deckHalf = 0.9, SAG = 0.025;
/** where a point is along a bridge: t (0..1 along), side distance, and the deck's height there */
export function onBridge(b, x, y) {
    const [a, c] = b.ends, sx = c[0] - a[0], sy = c[1] - a[1], l2 = sx * sx + sy * sy;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * sx + (y - a[1]) * sy) / l2));
    const px = a[0] + sx * t, py = a[1] + sy * t, side = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
    const z = a[2] + (c[2] - a[2]) * t - b.length * SAG * 4 * t * (1 - t);
    return { t, side, z };
}
/** the deck under (x, y) on any built bridge, near height z, or -Infinity */
export function deckBelow(state, x, y, z, step) {
    let best = -Infinity;
    for (const b of state.world.data.bridges || []) {
        if (state.progress.bridges[b.id].state !== "built") continue;
        const q = onBridge(b, x, y);
        if (q.side <= deckHalf && q.z <= z + step + 0.01 && q.z > best) best = q.z;
    }
    return best;
}
/** would stepping from (ox, oy) to (x, y) at height z go over a bridge's rail? */
export function overRail(state, ox, oy, x, y, z) {
    for (const b of state.world.data.bridges || []) {
        if (state.progress.bridges[b.id].state !== "built") continue;
        const from = onBridge(b, ox, oy);
        if (from.side > deckHalf || Math.abs(from.z - z) > 0.6 || from.t < 0.02 || from.t > 0.98) continue;
        const to = onBridge(b, x, y);
        if (to.side > deckHalf * 0.85 && to.t > 0.02 && to.t < 0.98) return true;
    }
    return false;
}

/** the broken bridge whose end the player stands at, or null */
export function bridgeEndNear(state, x, y, z) {
    for (const b of state.world.data.bridges || []) {
        const s = state.progress.bridges[b.id];
        if (s.state === "built") continue;
        for (const e of b.ends) if (Math.hypot(e[0] - x, e[1] - y) < BUILD.reach && Math.abs(e[2] - z) < 2) return b;
    }
    return null;
}

/** what the pouch has toward a bridge */
export function materials(state) {
    const c = state.pouch.crops, m = state.pouch.materials;
    return { rope: c.ropegrass * ROPE.ropegrass + c.cotton * ROPE.cotton, planks: c.skypine + m.planks, fittings: m.fittings };
}
export function missingFor(state, b) {
    const have = materials(state), miss = {};
    for (const k of ["rope", "planks", "fittings"]) if (have[k] < b.cost[k]) miss[k] = b.cost[k] - have[k];
    return miss;
}

/** pay for a bridge and start building it (rope from rope-grass first, then cotton; planks grown before bought) */
export function startBridge(state, b) {
    if (Object.keys(missingFor(state, b)).length) return false;
    const c = state.pouch.crops, m = state.pouch.materials;
    let rope = b.cost.rope;
    const fromGrass = Math.min(c.ropegrass, rope); c.ropegrass -= fromGrass; rope -= fromGrass;
    if (rope > 0) c.cotton -= Math.ceil(rope / ROPE.cotton);
    let planks = b.cost.planks;
    const grown = Math.min(c.skypine, planks); c.skypine -= grown; planks -= grown;
    m.planks -= planks;
    m.fittings -= b.cost.fittings;
    state.progress.bridges[b.id].state = "building";
    state.events.push({ type: "build-start", bridge: b.id });
    return true;
}

/** bridges going up; finished ones restore their islands */
export function stepBridges(state) {
    for (const b of state.world.data.bridges || []) {
        const s = state.progress.bridges[b.id];
        if (s.state !== "building") continue;
        const k0 = Math.floor(s.progress * 24);
        s.progress = Math.min(1, s.progress + 1 / BUILD.ticks);
        if (Math.floor(s.progress * 24) > k0) state.events.push({ type: "plank", bridge: b.id, t: s.progress });
        if (s.progress >= 1) {
            s.state = "built";
            state.events.push({ type: "bridge-built", bridge: b.id, a: b.a, b: b.b });
            restore(state, b.a, "bridge"); restore(state, b.b, "bridge");
        }
    }
}

/** the heart stone the player is next to, on an island that waking restores (no bridge reaches it) */
export function heartNear(state, x, y) {
    // (the Crown's heart is the great tree's: it wakes only with the three Old Seeds, through talk "crown")
    for (const h of state.world.data.hearts || []) if (!h.bridged && h.island !== "crown" && !state.progress.restored.has(h.island) && Math.hypot(h.x - x, h.y - y) < 1.6) return h;
    return null;
}

// ------------------------------------------------------------------ the merchant

/**
 * Where the airship is at a tick: phase "away" | "arriving" | "moored" | "leaving", u (0..1 through the
 * arriving or leaving leg), and on which day.
 */
export function merchantAt(tick) {
    const M = MERCHANT_TIMES, day = Math.floor(tick / DAY_TICKS) + 1, t = (tick % DAY_TICKS) / DAY_TICKS;
    if (day < M.first || (day - M.first) % M.every !== 0) return { phase: "away", u: 0, day };
    if (t < M.arrive || t >= M.gone) return { phase: "away", u: 0, day };
    if (t < M.moor) return { phase: "arriving", u: (t - M.arrive) / (M.moor - M.arrive), day };
    if (t < M.leave) return { phase: "moored", u: 0, day };
    return { phase: "leaving", u: (t - M.leave) / (M.gone - M.leave), day };
}
/** the next day the airship comes */
export function nextMerchantDay(tick) {
    const M = MERCHANT_TIMES, day = Math.floor(tick / DAY_TICKS) + 1, t = (tick % DAY_TICKS) / DAY_TICKS;
    let d = Math.max(M.first, day);
    while ((d - M.first) % M.every !== 0 || (d === day && t >= M.leave)) d++;
    return d;
}

/** Sell produce to Bram (while moored). Returns coins earned. */
export function sell(state, crop, n) {
    if (merchantAt(state.tick).phase !== "moored") return 0;
    n = Math.min(n, state.pouch.crops[crop] || 0);
    if (n <= 0) return 0;
    state.pouch.crops[crop] -= n;
    const coins = Math.round(n * CROPS[crop].value);
    state.progress.coins += coins;
    state.events.push({ type: "sold", crop, n, coins });
    return coins;
}
/** Buy fittings or planks from Bram. Returns how many were bought. */
export function buy(state, what, n) {
    if (merchantAt(state.tick).phase !== "moored" || !(what in TRADE)) return 0;
    n = Math.min(n, Math.floor(state.progress.coins / TRADE[what]));
    if (n <= 0) return 0;
    state.progress.coins -= n * TRADE[what];
    state.pouch.materials[what] += n;
    state.events.push({ type: "bought", what, n });
    return n;
}

// ------------------------------------------------------------------ the glider

/** what the shed's workbench can do with the pouch: the next tier, or the boost, or nothing */
export function upgradeAvailable(state) {
    const P = state.progress, m = state.pouch.materials, next = UPGRADES[P.tier + 1];
    if (next && m[next.needs] > 0) return { kind: "tier", ...next };
    if (!P.boost && m[BOOST.needs] > 0) return { kind: "boost", name: "Storm-amber gust boost" };
    return null;
}
export function applyUpgrade(state) {
    const u = upgradeAvailable(state), p = state.player, P = state.progress;
    if (!u) return null;
    // the farm's glider design: everyone's glider gets it
    if (u.kind === "tier") { state.pouch.materials[u.needs]--; P.tier = u.tier; for (const q of state.players || [p]) { q.glide = u.glide; q.staminaMax = u.stamina; } p.stamina = u.stamina; }
    else { state.pouch.materials[BOOST.needs]--; P.boost = true; }
    state.events.push({ type: "upgraded", kind: u.kind, name: u.name, tier: P.tier });
    return u;
}
