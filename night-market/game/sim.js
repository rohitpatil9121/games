import { NIGHT, STREET, ECON, WEATHER, STALLS, MEAL_TYPES, LEVELS, MAX_LEVEL, TRAITS, TRAIT_IDS, VENDOR, CUSTOMER, VENDOR_NAMES, CUSTOMER_NAMES, REGULARS, MANAGERS } from "./data.js";
import { pickEvent } from "./events.js";

/**
 * NIGHT MARKET — the whole simulation. Pure and deterministic: no rendering, no DOM, no clock, and no
 * Math.random. Every random draw goes through `rnd(state)`, whose seed lives in the state, so the same
 * state and the same player actions always produce the same night. That is what lets one piece of code
 * drive live play, fast-forward, saved campaigns and the headless balance tool (tools/balance.mjs).
 *
 * The state is plain JSON (no classes, Maps or functions), so saving is JSON.stringify.
 *
 *   const s = createCampaign(seed);
 *   buyStall(s, "dumplings", 2); hire(s, s.market[0]);
 *   startNight(s);
 *   while (stepNight(s)) { read s.events }        // 60 steps per simulated second
 *   resolveEvent(s, 0); advance(s);               // closing → next night
 * @module game/sim
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ok = { ok: true };
const fail = (error) => ({ ok: false, error });

// ------------------------------------------------------------------ random numbers (mulberry32)
/** Next random number in [0, 1). Advances the seed stored in the state. */
export function rnd(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rrange = (s, a, b) => a + rnd(s) * (b - a);
export const rint = (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1));
export const pick = (s, list) => list[Math.floor(rnd(s) * list.length)];
export const chance = (s, p) => rnd(s) < p;
function shuffle(s, list) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
}

// ------------------------------------------------------------------ geometry
export const slotX = (slot) => slot * STREET.slotW;
export const streetEnds = (s) => ({ left: -STREET.margin, right: (s.slots - 1) * STREET.slotW + STREET.margin });
/** Where the k-th person in a stall's queue stands. The line zig-zags slightly so faces stay visible. */
export function queueSpot(stall, k, out = { x: 0, y: 0 }) {
    out.x = slotX(stall.slot) + (k === 0 ? 0 : k % 2 ? 0.2 : -0.2);
    out.y = STREET.queueY0 - k * STREET.queueGap;
    return out;
}
/** Centres of the low tables in the eating area. The row grows with the street. */
export function tables(s) {
    const out = [], right = slotX(s.slots - 1) + 1;
    for (let x = STREET.tableX0, i = 0; x < right; x += STREET.tableGap, i++) out.push({ x, y: STREET.tableY + (i % 2) * 0.5 });
    return out;
}
export const seatCount = (s) => tables(s).length * STREET.seats;
/** Where stool k stands (x, y) and the table it faces (tx, ty). */
export function seatSpot(k, out = { x: 0, y: 0, tx: 0, ty: 0 }) {
    const t = Math.floor(k / STREET.seats), a = ((k % STREET.seats) / STREET.seats) * Math.PI * 2 + 0.5 + t * 0.7;
    out.tx = STREET.tableX0 + t * STREET.tableGap; out.ty = STREET.tableY + (t % 2) * 0.5;
    out.x = out.tx + Math.cos(a) * STREET.seatR; out.y = out.ty + Math.sin(a) * STREET.seatR;
    return out;
}

// ------------------------------------------------------------------ lookups
export const vendorById = (s, id) => s.vendors.find((v) => v.id === id) || null;
export const stallById = (s, id) => s.stalls.find((t) => t.id === id) || null;
export const stallAt = (s, slot) => s.stalls.find((t) => t.slot === slot) || null;
export const customerById = (s, id) => s.customers.find((c) => c.id === id) || null;
export const hiredVendors = (s) => s.vendors.filter((v) => v.hired && !v.gone);
export const has = (v, trait) => !!v && (v.traits[0] === trait || v.traits[1] === trait);
/** The vendor actually working a stall tonight (assigned, hired, not on a night off). */
export function worker(s, stall) {
    if (stall.vendorId == null) return null;
    const v = vendorById(s, stall.vendorId);
    return v && v.hired && !v.gone && !v.off ? v : null;
}
const relKey = (a, b) => (a < b ? a + "-" + b : b + "-" + a);
/** "friend" | "rival" | null. With `knownOnly`, relationships the player hasn't discovered read as null. */
export function relation(s, a, b, knownOnly = false) {
    const r = s.rel[relKey(a, b)];
    return r && (!knownOnly || r.known) ? r.t : null;
}
export function setRelation(s, a, b, type) {
    if (type) s.rel[relKey(a, b)] = { t: type, known: true };
    else delete s.rel[relKey(a, b)];
}
/** Working vendors in the stalls directly left and right of this one. */
export function neighbours(s, stall) {
    const out = [];
    for (const d of [-1, 1]) {
        const n = stallAt(s, stall.slot + d);
        const v = n && worker(s, n);
        if (v) out.push({ stall: n, vendor: v });
    }
    return out;
}

// ------------------------------------------------------------------ temporary modifiers (set by events)
/** Product of every active multiplier with this key (1 if none). */
export function mod(s, key) { let m = 1; for (const x of s.mods) if (x.k === key) m *= x.v; return m; }
/** Sum of every active additive modifier with this key. */
export function modAdd(s, key) { let m = 0; for (const x of s.mods) if (x.k === key) m += x.v; return m; }
/** Add a modifier that applies to the next `nights` nights. */
export function addMod(s, key, value, nights, label) { s.mods.push({ k: key, v: value, n: nights, fresh: true, label }); }

// ------------------------------------------------------------------ campaign
function randomLook(s) {
    return { skin: rint(s, 0, 4), shirt: rint(s, 0, 11), pants: rint(s, 0, 3), hair: rint(s, 0, 4), hairStyle: rint(s, 0, 3), h: +rrange(s, 0.92, 1.08).toFixed(3) };
}

export function createCampaign(seed = 1) {
    const s = {
        v: 2, seed, rng: Math.imul(seed | 0, 2654435761) | 0,
        night: 1, phase: "prep", endless: false, outcome: null,
        cash: ECON.startCash, rep: ECON.startRep, rent: ECON.rentBase, rentStep: ECON.rentStep, rentFreeze: 0,
        slots: STREET.startSlots, stalls: [], vendors: [], market: [], rel: {}, nextId: 1,
        mods: [], appealBonus: 0, rivalStall: false, policy: { student: null },
        managers: { night: 0, marshal: 0, buyer: 0, promoter: 0 },
        flags: { studentFed: 0, nurseServed: 0 }, eventNight: {},
        weather: "clear", forecast: null, seats: {},
        t: 0, customers: [], arrivals: [], arrivalIdx: 0, sceneT: 0, kidAt: null, events: [],
        stats: null, summary: null, event: null, history: [],
    };
    // the hiring pool: every trait appears at least once, the second trait is random
    const names = shuffle(s, VENDOR_NAMES.slice()).slice(0, VENDOR.poolSize);
    names.forEach((name, i) => {
        const a = TRAIT_IDS[i % TRAIT_IDS.length];
        let b = pick(s, TRAIT_IDS);
        while (b === a || (a === "fast" && b === "perfectionist") || (a === "perfectionist" && b === "fast")) b = pick(s, TRAIT_IDS);
        const roll = rnd(s), skill = roll < 0.36 ? 1 : roll < 0.72 ? 2 : roll < 0.93 ? 3 : 4;
        s.vendors.push({
            id: s.nextId++, name, look: randomLook(s), traits: [a, b], skill, xp: 0,
            wage: VENDOR.wageBase + VENDOR.wagePerSkill * skill, mood: 65, energy: 100,
            hired: false, gone: false, off: false, stallId: null, lastRaise: -9, nights: 0, moodDelta: 0,
        });
    });
    // who already knows whom: about a quarter of pairs have history, and half of that is on record
    for (let i = 0; i < s.vendors.length; i++) for (let j = i + 1; j < s.vendors.length; j++) {
        const r = rnd(s), known = chance(s, 0.5);
        if (r < 0.15) s.rel[relKey(s.vendors[i].id, s.vendors[j].id)] = { t: "friend", known };
        else if (r < 0.31) s.rel[relKey(s.vendors[i].id, s.vendors[j].id)] = { t: "rival", known };
    }
    s.flags.criticNight = rint(s, 3, 7);
    s.flags.inspectNight = rint(s, 5, 7);
    refreshMarket(s);
    return s;
}

/** Tonight's hiring candidates: a few random vendors who aren't working for you. */
function refreshMarket(s) {
    const free = shuffle(s, s.vendors.filter((v) => !v.hired && !v.gone).map((v) => v.id));
    s.market = free.slice(0, VENDOR.marketSize);
    // the first night always offers someone affordable
    if (s.night === 1 && !s.market.some((id) => vendorById(s, id).skill <= 2)) {
        const cheap = free.find((id) => vendorById(s, id).skill <= 2);
        if (cheap) s.market[0] = cheap;
    }
}

// ------------------------------------------------------------------ managers and offline earnings
/** The current level's effect for a manager, or null if not hired. */
export const managerLevel = (s, id) => (s.managers[id] ? MANAGERS[id].levels[s.managers[id] - 1] : null);
/** Multiplier a manager applies (1 if not hired). */
const managed = (s, id) => { const l = managerLevel(s, id); return l ? l.value : 1; };
/** Cost of hiring or promoting a manager, or Infinity at the top level. */
export const managerCost = (s, id) => { const l = MANAGERS[id].levels[s.managers[id]]; return l ? l.cost : Infinity; };

export function hireManager(s, id) {
    if (s.phase !== "prep") return fail("The market is open");
    if (!MANAGERS[id]) return fail("No such manager");
    const cost = managerCost(s, id);
    if (!isFinite(cost)) return fail("Already at the top level");
    if (s.cash < cost) return fail(`You need $${cost}`);
    s.cash -= cost; s.managers[id]++;
    return ok;
}

/**
 * What the street earned while the game was closed. Needs a night manager, and only counts between
 * nights. `seconds` is real time away; the caller supplies it, so this stays pure.
 * @returns {{ cash: number, hours: number, capped: boolean }}
 */
export function offlineEarnings(s, seconds) {
    const l = managerLevel(s, "night");
    if (!l || s.phase !== "prep" || !(seconds > 0)) return { cash: 0, hours: 0, capped: false };
    const recent = s.history.slice(-3).map((h) => Math.max(0, h.net));
    const average = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const hours = Math.min(seconds / 3600, l.hours);
    return { cash: Math.floor(average * l.rate * hours), hours, capped: seconds / 3600 >= l.hours };
}
export function collectOffline(s, seconds) {
    const r = offlineEarnings(s, seconds);
    s.cash += r.cash;
    return r;
}

/** Bring a campaign saved by an older version up to date. */
export function upgradeState(s) {
    s.managers = { night: 0, marshal: 0, buyer: 0, promoter: 0, ...(s.managers || {}) };
    if (s.v === 1) {
        // stalls had three big levels; the same strength is now levels 1, 5 and 10
        for (const stall of s.stalls) stall.level = [1, 1, 5, 10][stall.level] || 1;
        s.v = 2;
    }
    s.weather ||= "clear"; s.forecast ||= null; s.seats ||= {};
    return s;
}

// ------------------------------------------------------------------ derived numbers (also shown in the UI)
export const queueCap = (stall) => STALLS[stall.type].queue + LEVELS[stall.level].queue;
export const upgradeCost = (stall) => (stall.level >= MAX_LEVEL ? Infinity : Math.round(STALLS[stall.type].buy * LEVELS[stall.level + 1].cost));
/** Can this stall type be bought yet? */
export const unlocked = (s, type) => s.night >= (STALLS[type].unlock || 0);
/** The meals customers can crave tonight. */
export const cravings = (s) => MEAL_TYPES.filter((t) => unlocked(s, t));
/** How much each plate's satisfaction (0..1) is marked down because the street is famous. */
export const expectation = (s) => Math.max(0, s.rep - ECON.expectFrom) * ECON.expectPer;
/** Share of customers the weather lets through tonight. */
export const weatherArrivals = (s) => (s.weather === "festival" ? WEATHER.festivalArrivals : s.weather === "rain" && !s.flags.awnings ? WEATHER.rainArrivals : 1);
export function extendCost(s) {
    const i = (s.slots - STREET.startSlots) / 2;
    if (s.slots >= STREET.maxSlots) return Infinity;
    return Math.round(STREET.extendCost[i] * (s.flags.extendDiscount ? 0.5 : 1));
}
export const priceRange = (type) => ({ min: Math.max(1, Math.ceil(STALLS[type].price * 0.5)), max: STALLS[type].price * 2 });
/** Customers expected tonight. */
export function arrivalsFor(s) {
    const a = ECON.arrivals;
    return Math.round((a.base + s.rep * a.perRep + Math.min(s.night, 14) * a.perNight) * mod(s, "arrivals") * managed(s, "promoter") * weatherArrivals(s) * (s.rivalStall ? 0.86 : 1));
}
/** Hour and minute on the market clock for the current tick. */
export function nightClock(s) {
    const f = clamp((s.t * NIGHT.dt) / NIGHT.seconds, 0, 1), mins = Math.round(f * (NIGHT.closeHour - NIGHT.openHour) * 60);
    return { frac: f, hour: (NIGHT.openHour + Math.floor(mins / 60)) % 24, minute: mins % 60 };
}

/**
 * How long this stall takes to serve one customer right now, with every factor listed so the stall
 * and character cards can explain it. `parts`: [{ label, mul, tone }].
 */
export function serveInfo(s, stall) {
    const def = STALLS[stall.type], v = worker(s, stall), parts = [];
    if (!v) return { time: Infinity, parts };
    const add = (label, mul, who) => { if (Math.abs(mul - 1) > 0.004) parts.push({ label, mul, tone: mul < 1 ? "good" : "bad", who }); };
    add("Skill " + v.skill, VENDOR.skillServe(v.skill));
    if (has(v, "fast")) add(TRAITS.fast.name, TRAITS.fast.serve);
    if (has(v, "perfectionist")) add(TRAITS.perfectionist.name, TRAITS.perfectionist.serve);
    add("Level " + stall.level, LEVELS[stall.level].serve);
    if (v.energy < 50) add("Tired", 1 + ((50 - v.energy) / 50) * VENDOR.tiredSlow);
    for (const n of neighbours(s, stall)) {
        const r = relation(s, v.id, n.vendor.id);
        if (r === "friend") add("Friend next door: " + n.vendor.name, VENDOR.friendServe, n.vendor.id);
        if (r === "rival") add("Rival next door: " + n.vendor.name, VENDOR.rivalServe, n.vendor.id);
    }
    let time = def.serve;
    for (const p of parts) time *= p.mul;
    return { time, parts };
}

/** How attractive a stall is to a passing customer (before craving, price and queue length). */
export function stallAppeal(s, stall) {
    const def = STALLS[stall.type], v = worker(s, stall);
    let a = def.appeal * LEVELS[stall.level].appeal * (1 + s.appealBonus);
    if (has(v, "showman")) a *= TRAITS.showman.appeal;
    if (s.kidAt != null && Math.abs(slotX(stall.slot) - s.kidAt) < 4.6) a *= 1.5;
    return a;
}

/**
 * Plain-language lines for the character card: what each trait, relationship and condition is doing
 * right now. Nothing that changes the simulation is left out of this list.
 * @returns {Array<{ icon: string, title: string, text: string, tone: "good" | "bad" | "info" }>}
 */
export function explainVendor(s, v) {
    const out = [], stall = v.stallId != null ? stallById(s, v.stallId) : null, live = s.phase === "night";
    const frac = live ? (s.t * NIGHT.dt) / NIGHT.seconds : 0;
    for (const id of v.traits) {
        const t = TRAITS[id];
        let text = t.text, tone = "good";
        if (id === "hothead") {
            const n = stall ? stall.queue.length : 0;
            tone = live && n >= t.queue ? "bad" : "info";
            if (live && stall) text = n >= t.queue ? `${n} waiting: botching about ${Math.round(t.mistake * 100)}% of orders right now.` : `${n} waiting, calm. Starts botching orders at ${t.queue}.`;
        } else if (id === "owl" && live) text = frac > t.after ? "Second half of the night: losing no energy." : "Kicks in for the second half of the night.";
        else if (id === "perfectionist" || id === "penny") tone = "info";
        else if (id === "mentor" && stall) {
            const pupils = neighbours(s, stall).map((n) => n.vendor.name);
            text = pupils.length ? `Teaching ${pupils.join(" and ")}: they gain skill 80% faster.` : "Nobody next door to teach. Put a junior vendor beside them.";
            if (!pupils.length) tone = "info";
        }
        out.push({ icon: t.icon, title: t.name, text, tone });
    }
    if (!v.hired) return out;
    if (v.off) out.push({ icon: "🛌", title: "Night off", text: "Resting tonight. Their stall stays shut unless you assign someone else.", tone: "info" });
    else if (!stall) out.push({ icon: "🪑", title: "No stall", text: `Not assigned. Still draws $${v.wage} a night and gets restless.`, tone: "bad" });
    if (v.energy < 50 && stall) out.push({ icon: "💤", title: "Tired", text: `Energy ${Math.round(v.energy)}: serving ${Math.round(((50 - v.energy) / 50) * VENDOR.tiredSlow * 100)}% slower.`, tone: "bad" });
    const near = stall ? neighbours(s, stall) : [];
    for (const o of hiredVendors(s)) {
        if (o.id === v.id) continue;
        const r = relation(s, v.id, o.id, true);
        if (!r) continue;
        const adjacent = near.some((n) => n.vendor.id === o.id);
        if (r === "friend") out.push({ icon: "💛", title: "Friend: " + o.name, tone: adjacent ? "good" : "info",
            text: adjacent ? "Working side by side: both serve 16% faster, plates review better, and they end the night happier." : "No effect yet. Put their stalls side by side." });
        else out.push({ icon: "💢", title: "Rival: " + o.name, tone: adjacent ? "bad" : "info",
            text: adjacent ? "Working side by side: both serve 20% slower, plates review worse, and they may start a scene that costs reputation." : "Kept apart, so no harm done. Never put their stalls side by side." });
    }
    if (v.mood < VENDOR.quitMood) out.push({ icon: "🚪", title: "Unhappy", text: "Mood is very low. They are thinking about quitting.", tone: "bad" });
    return out;
}

// ------------------------------------------------------------------ player actions (before opening)
const inPrep = (s) => s.phase === "prep";

export function buyStall(s, type, slot) {
    const def = STALLS[type];
    if (!inPrep(s)) return fail("The market is open");
    if (!def) return fail("Unknown stall");
    if (!unlocked(s, type)) return fail(`${def.name} arrives on night ${def.unlock}`);
    if (slot < 0 || slot >= s.slots) return fail("Not on your street");
    if (stallAt(s, slot)) return fail("That spot is taken");
    if (s.cash < def.buy) return fail(`You need $${def.buy}`);
    s.cash -= def.buy;
    const stall = { id: s.nextId++, type, slot, level: 1, price: def.price, vendorId: null, queue: [], serving: null, serveT: 0, serveNeed: 0, pauseT: 0, mistake: false };
    s.stalls.push(stall);
    const idle = hiredVendors(s).find((v) => v.stallId == null);
    if (idle) assign(s, idle.id, stall.id);
    return { ok: true, stall };
}

export function sellStall(s, stallId) {
    const stall = stallById(s, stallId);
    if (!inPrep(s) || !stall) return fail("Can't sell that now");
    let paid = STALLS[stall.type].buy;
    for (let l = 2; l <= stall.level; l++) paid += Math.round(STALLS[stall.type].buy * LEVELS[l].cost);
    const refund = Math.round(paid * ECON.sellRefund);
    if (stall.vendorId != null) { const v = vendorById(s, stall.vendorId); if (v) v.stallId = null; }
    s.stalls.splice(s.stalls.indexOf(stall), 1);
    s.cash += refund;
    return { ok: true, refund };
}

/** Move a stall to another slot. If that slot is occupied the two stalls swap places. */
export function moveStall(s, stallId, slot) {
    const stall = stallById(s, stallId);
    if (!inPrep(s) || !stall) return fail("Can't move that now");
    if (slot < 0 || slot >= s.slots) return fail("Not on your street");
    const other = stallAt(s, slot);
    if (other === stall) return ok;
    if (other) other.slot = stall.slot;
    stall.slot = slot;
    return ok;
}

export function upgradeStall(s, stallId) {
    const stall = stallById(s, stallId);
    if (!inPrep(s) || !stall) return fail("Can't upgrade that now");
    if (stall.level >= MAX_LEVEL) return fail("Already at the top level");
    const cost = upgradeCost(stall);
    if (s.cash < cost) return fail(`You need $${cost}`);
    s.cash -= cost;
    stall.level++;
    return ok;
}

/** Prices can be changed at any time, including while the market is open. */
export function setPrice(s, stallId, price) {
    const stall = stallById(s, stallId);
    if (!stall) return fail("No such stall");
    const r = priceRange(stall.type);
    stall.price = clamp(Math.round(price), r.min, r.max);
    return ok;
}

export function hire(s, vendorId) {
    const v = vendorById(s, vendorId);
    if (!inPrep(s)) return fail("The market is open");
    if (!v || v.hired || v.gone || !s.market.includes(vendorId)) return fail("Not available");
    if (s.cash < ECON.hireFee) return fail(`Hiring costs $${ECON.hireFee}`);
    s.cash -= ECON.hireFee;
    v.hired = true; v.mood = 65; v.energy = 100;
    s.market.splice(s.market.indexOf(vendorId), 1);
    const empty = s.stalls.slice().sort((a, b) => a.slot - b.slot).find((t) => t.vendorId == null);
    if (empty) assign(s, v.id, empty.id);
    return ok;
}

export function fire(s, vendorId) {
    const v = vendorById(s, vendorId);
    if (!inPrep(s) || !v || !v.hired) return fail("Can't do that now");
    removeVendor(s, v);
    return ok;
}

/** Take a vendor off the street for good (fired, quit or poached). */
export function removeVendor(s, v) {
    if (v.stallId != null) { const st = stallById(s, v.stallId); if (st) st.vendorId = null; }
    v.stallId = null; v.hired = false; v.gone = true;
}

/** Put a vendor on a stall (or pass null to stand them down). Whoever was there becomes unassigned. */
export function assign(s, vendorId, stallId) {
    const v = vendorById(s, vendorId);
    if (!inPrep(s) || !v || !v.hired) return fail("Can't do that now");
    if (v.stallId != null) { const old = stallById(s, v.stallId); if (old) old.vendorId = null; }
    v.stallId = null;
    if (stallId == null) return ok;
    const stall = stallById(s, stallId);
    if (!stall) return fail("No such stall");
    if (stall.vendorId != null) { const prev = vendorById(s, stall.vendorId); if (prev) prev.stallId = null; }
    stall.vendorId = v.id; v.stallId = stall.id;
    return ok;
}

export function extendStreet(s) {
    if (!inPrep(s)) return fail("The market is open");
    if (s.slots >= STREET.maxSlots) return fail("The street is as long as it gets");
    const cost = extendCost(s);
    if (s.cash < cost) return fail(`You need $${cost}`);
    s.cash -= cost; s.slots += 2; s.flags.extendDiscount = false;
    return ok;
}

// ------------------------------------------------------------------ the night
const emit = (s, e) => { s.events.push(e); };
const moment = (s, good, weight, text) => { const m = s.stats.moments; if (weight > 1 || m.length < 40) m.push({ good, weight, text, t: s.t }); };
function addRep(s, d) { const st = s.stats; if (d > 0) st.repGain += d; else st.repLoss += d; }
const vendorOfStall = (s, stall) => (stall.vendorId != null ? vendorById(s, stall.vendorId) : null);

export function startNight(s) {
    if (!inPrep(s)) return fail("Already open");
    s.phase = "night"; s.t = 0; s.customers = []; s.events = []; s.sceneT = 0; s.arrivalIdx = 0; s.kidAt = null; s.summary = null; s.event = null; s.seats = {};
    const st = (s.stats = {
        served: 0, angry: 0, walked: 0, revenue: 0, tips: 0, ingredients: 0, stars: 0, reviews: 0, repGain: 0, repLoss: 0,
        mistakes: 0, scenes: [], moments: [], perStall: {}, perVendor: {}, levelUps: [], discovered: [],
        critic: null, criticVendor: null, landlord: null, studentSeen: false, nurse: false, kid: false, expected: 0, tour: null, inspector: null,
    });
    for (const stall of s.stalls) {
        stall.queue = []; stall.serving = null; stall.serveT = 0; stall.pauseT = 0; stall.mistake = false;
        st.perStall[stall.id] = { served: 0, stars: 0, revenue: 0, angry: 0 };
    }
    for (const v of hiredVendors(s)) {
        v.energy = 100; v.tiredFlag = false;
        st.perVendor[v.id] = { served: 0, stars: 0, mistakes: 0, scenes: 0, minEnergy: 100, worked: !!(v.stallId != null && !v.off) };
    }
    // working side by side for the first time brings old history out
    for (const stall of s.stalls) {
        const v = worker(s, stall), right = stallAt(s, stall.slot + 1), o = right && worker(s, right);
        if (!v || !o) continue;
        const r = s.rel[relKey(v.id, o.id)];
        if (r && !r.known) { r.known = true; st.discovered.push({ a: v.id, b: o.id, t: r.t }); emit(s, { type: "discover", a: v.id, b: o.id, rel: r.t }); }
    }
    scheduleArrivals(s);
    return ok;
}

function makeCustomerSpec(s) {
    const c = CUSTOMER;
    return {
        kind: "n", name: pick(s, CUSTOMER_NAMES), look: randomLook(s), thirsty: chance(s, c.thirsty),
        // a wet night is soup weather
        craving: s.weather === "rain" && chance(s, WEATHER.rainNoodles) ? "noodles" : pick(s, cravings(s)),
        budget: rint(s, c.budget[0], c.budget[1]), patience: rrange(s, c.patience[0], c.patience[1]), speed: rrange(s, c.speed[0], c.speed[1]),
        side: chance(s, 0.5) ? 1 : 0,
    };
}

function regularSpec(s, id, extra) {
    const r = REGULARS[id];
    return { kind: id, name: r.name, look: r.look, craving: pick(s, cravings(s)), thirsty: false, budget: 30, patience: 30, speed: 2.1, side: chance(s, 0.5) ? 1 : 0, ...extra };
}

function scheduleArrivals(s) {
    const T = NIGHT.seconds, list = [], n = arrivalsFor(s);
    s.stats.expected = n;
    for (let i = 0; i < n; i++) {
        // a busy middle of the night on top of a steady trickle
        const u = chance(s, 0.6) ? (rnd(s) + rnd(s)) / 2 : rnd(s);
        list.push({ t: T * (0.02 + 0.9 * u), spec: makeCustomerSpec(s) });
    }
    if (s.flags.lateCrowd) for (let i = 0; i < 6; i++) list.push({ t: T * rrange(s, 0.74, 0.92), spec: makeCustomerSpec(s) });
    const N = s.night, f = s.flags;
    if (N >= 2 && s.policy.student !== "away") list.push({ t: T * rrange(s, 0.15, 0.5), spec: regularSpec(s, "student", { budget: 3, patience: 40 }) });
    if (N >= 2) list.push({ t: T * rrange(s, 0.8, 0.87), spec: regularSpec(s, "nurse", { budget: 30, patience: 26 }) });
    if (N % 3 === 0) list.push({ t: T * rrange(s, 0.3, 0.6), spec: regularSpec(s, "landlord", { craving: "noodles", budget: 40, patience: 24 }) });
    if (N === f.criticNight || (N > NIGHT.campaignNights && (N - f.criticNight) % 5 === 0)) list.push({ t: T * rrange(s, 0.25, 0.7), spec: regularSpec(s, "critic", { budget: 40, patience: 26 }) });
    if (N === 4 && !f.poachDone && !s.rivalStall) list.push({ t: T * rrange(s, 0.3, 0.5), spec: regularSpec(s, "rival", { budget: 30, patience: 40 }) });
    if (N >= 2 && !f.dogShooed && (f.dogFriend || chance(s, 0.6))) list.push({ t: T * rrange(s, 0.2, 0.6), spec: regularSpec(s, "kid", { craving: "skewers", budget: 7, patience: 40, speed: 1.5 }) });
    // the tour: Mrs. Park, and her whole group a few steps behind her
    if (f.tourNightly || (N >= 6 && N % 2 === 0)) {
        const t = T * rrange(s, 0.2, 0.45), side = chance(s, 0.5) ? 1 : 0;
        list.push({ t, spec: regularSpec(s, "guide", { side, budget: 30, patience: 34, speed: 2.0 }) });
        for (let i = 0; i < CUSTOMER.tourSize; i++) list.push({ t: t + 0.7 + i * 0.45, spec: { ...makeCustomerSpec(s), side, tour: true, speed: 2.0 } });
    }
    if (N >= 5 && (N === f.inspectNight || chance(s, 0.28))) list.push({ t: T * rrange(s, 0.3, 0.55), spec: regularSpec(s, "inspector", { noEat: true, speed: 1.8 }) });
    list.sort((a, b) => a.t - b.t);
    s.arrivals = list;
}

function spawn(s, spec) {
    const ends = streetEnds(s), lane = STREET.laneY;
    const c = {
        id: s.nextId++, ...spec, patienceMax: spec.patience, x: spec.side ? ends.right : ends.left, y: rrange(s, lane[0], lane[1]),
        fx: spec.side ? -1 : 1, fy: 0, state: "walk", wp: [], then: null, plan: [], stallId: null, atSpot: false, waited: 0, sats: [], spent: 0,
        angry: false, happy: false, eatT: 0, lingerT: 0, hadDrink: false, holding: null, reviewed: false, seat: -1,
    };
    c.laneY = c.y;
    s.customers.push(c);
    emit(s, { type: "arrive", id: c.id });
    if (c.kind === "kid") {
        s.stats.kid = true;
        const stalls = s.stalls.filter((t) => worker(s, t));
        for (let i = 0; i < 2 && stalls.length; i++) c.plan.push({ x: slotX(pick(s, stalls).slot) + rrange(s, -0.8, 0.8), y: STREET.laneY[1] + 0.9, linger: 11 });
    } else if (c.kind === "guide") {
        s.stats.tour = { size: CUSTOMER.tourSize, happy: 0, angry: 0 };
    } else if (c.kind === "inspector") {
        // he stands at up to three working stalls and watches
        s.stats.inspector = { checked: 0, faults: [] };
        const stalls = shuffle(s, s.stalls.filter((t) => worker(s, t))).slice(0, 3).sort((a, b) => (c.side ? b.slot - a.slot : a.slot - b.slot));
        for (const t of stalls) c.plan.push({ x: slotX(t.slot) + 0.95, y: STREET.laneY[1] + 1.5, linger: 9, inspect: t.id });
    } else if (c.kind === "rival") {
        // he walks straight to your most skilled vendor and watches them work
        const best = s.stalls.map((t) => ({ t, v: worker(s, t) })).filter((x) => x.v).sort((a, b) => b.v.skill - a.v.skill || a.v.id - b.v.id)[0];
        if (best) { c.plan.push({ x: slotX(best.t.slot) + 0.9, y: STREET.laneY[1] + 0.7, linger: 10, scout: best.v.id }); c.craving = STALLS[best.t.type].drink ? c.craving : best.t.type; }
    }
    nextStep(s, c);
}

/** What a customer does next: the next stop on their plan, otherwise decide what to eat. */
function nextStep(s, c) {
    const p = c.plan.shift();
    if (p) { c.lingerT = p.linger; c.scout = p.scout || null; c.inspect = p.inspect ?? null; walkTo(c, [[p.x, c.laneY], [p.x, p.y]], "linger"); return; }
    if (c.noEat) return leave(s, c);
    decide(s, c);
}

function walkTo(c, points, then) { c.wp = points; c.then = then; c.state = "walk"; c.atSpot = false; }

function priceFor(s, c, stall) {
    if (c.kind === "student") return s.policy.student === "free" ? 0 : s.policy.student === "discount" ? Math.min(3, stall.price) : stall.price;
    return stall.price;
}

/** Pick the stall this customer likes best, or null if nothing is worth queueing for. */
function chooseStall(s, c, drink) {
    let best = null, bestScore = CUSTOMER.minScore;
    for (const stall of s.stalls) {
        const def = STALLS[stall.type];
        if (!!def.drink !== drink || !worker(s, stall)) continue;
        if (stall.queue.length >= queueCap(stall)) continue;
        const price = priceFor(s, c, stall);
        if (price > c.budget) continue;
        const crave = drink ? 1.3 : stall.type === c.craving ? 1.9 : 0.7;
        const ratio = stall.price / def.price;
        const priceFactor = clamp(1.7 - 0.7 * ratio, 0.2, 1.4);
        const queueFactor = 1 / (1 + 0.3 * stall.queue.length);
        const score = crave * stallAppeal(s, stall) * priceFactor * queueFactor * (0.85 + 0.3 * rnd(s));
        if (score > bestScore) { bestScore = score; best = stall; }
    }
    return best;
}

function decide(s, c) {
    const closing = s.t * NIGHT.dt >= NIGHT.seconds;
    let stall = closing ? null : chooseStall(s, c, false);
    if (!stall && !closing && c.thirsty && !c.hadDrink) { stall = chooseStall(s, c, true); if (stall) c.hadDrink = true; }
    if (stall) return joinQueue(s, c, stall);
    // nothing here for them: they walk on through
    if (c.kind === "student") s.stats.studentSeen = true;
    else if (!closing && !c.sats.length) { s.stats.walked++; addRep(s, ECON.repWalked); if (c.tour && s.stats.tour) s.stats.tour.angry++; }
    emit(s, { type: "walkby", id: c.id });
    leave(s, c);
}

function joinQueue(s, c, stall) {
    stall.queue.push(c.id);
    c.stallId = stall.id;
    const k = stall.queue.length - 1, spot = queueSpot(stall, k);
    walkTo(c, [[spot.x, c.y], [spot.x, spot.y]], "queue");
    emit(s, { type: "join", id: c.id, stallId: stall.id });
}

function leave(s, c) {
    const ends = streetEnds(s), exitX = c.side ? ends.left : ends.right;
    c.stallId = null;
    walkTo(c, [[c.x, c.laneY], [exitX, c.laneY]], "exit");
}

/** Record the customer's review of everything they ate tonight (once). */
function finalize(s, c) {
    if (c.reviewed || !c.sats.length) return;
    c.reviewed = true;
    // someone who wanted a drink and found none on the street marks the whole visit down
    const st = s.stats, sat = c.sats.reduce((a, b) => a + b, 0) / c.sats.length - (c.thirsty && !c.hadDrink ? CUSTOMER.noDrink : 0);
    const stars = clamp(Math.round(1 + sat * 4), 1, 5);
    st.stars += stars; st.reviews++;
    addRep(s, (stars - 3) * ECON.repPerStar);
    c.happy = stars >= 4;
    if (c.tour && st.tour && stars >= 4) st.tour.happy++;
    if (c.kind === "critic") st.critic = stars;
    if (c.kind === "landlord") st.landlord = { stars, wait: c.waited, angry: false };
    if (stars === 5 && c.servedBy) moment(s, true, c.kind === "n" ? 1 : 3, `${c.name} gave ${c.servedBy} five stars.`);
    emit(s, { type: "review", id: c.id, stars });
}

function leaveAngry(s, c, stall) {
    const st = s.stats, i = stall.queue.indexOf(c.id);
    if (i >= 0) stall.queue.splice(i, 1);
    c.angry = true; c.reviewed = true;
    st.angry++; st.perStall[stall.id].angry++; st.stars += 1; st.reviews++;
    addRep(s, ECON.repAngry);
    if (c.tour && st.tour) st.tour.angry++;
    if (c.kind === "critic") { st.critic = 0; st.criticVendor = stall.vendorId; }
    if (c.kind === "landlord") st.landlord = { stars: 0, wait: c.waited, angry: true };
    moment(s, false, c.kind === "n" ? 2 : 4, `${c.name} gave up on the ${STALLS[stall.type].name} queue after ${Math.round(c.waited)}s.`);
    emit(s, { type: "angry", id: c.id, stallId: stall.id });
    leave(s, c);
}

function completeServe(s, stall, c, v) {
    const st = s.stats, def = STALLS[stall.type], price = priceFor(s, c, stall);
    c.budget -= price; c.spent += price;
    s.cash += price; st.revenue += price;
    const cost = def.cost * (has(v, "penny") ? TRAITS.penny.cost : 1) * mod(s, "cost") * managed(s, "buyer");
    s.cash -= cost; st.ingredients += cost;

    // satisfaction 0..1 → 1..5 stars
    const ratio = stall.price / def.price;
    let sat = def.sat + (v.skill - 1) * 0.04 + (def.drink || stall.type === c.craving ? 0.1 : -0.22) + modAdd(s, "sat");
    if (has(v, "perfectionist")) sat += TRAITS.perfectionist.sat;
    if (has(v, "penny")) sat += TRAITS.penny.sat;
    // the mood behind the counter reaches the food: friends side by side lift it, rivals sour it
    for (const n of neighbours(s, stall)) { const r = relation(s, v.id, n.vendor.id); sat += r === "friend" ? VENDOR.friendSat : r === "rival" ? VENDOR.rivalSat : 0; }
    sat -= expectation(s);
    sat -= (c.waited / c.patienceMax) * 0.35;
    sat -= Math.max(0, ratio - 1) * 0.45;
    sat += Math.max(0, 1 - ratio) * 0.2;
    if (stall.mistake) { sat -= 0.5; st.mistakes++; st.perVendor[v.id].mistakes++; moment(s, false, 1, `${v.name} botched ${c.name}'s order with ${stall.queue.length} people waiting.`); }
    let tip = 0;
    if (c.kind === "nurse") {
        st.nurse = true;
        if (v.energy >= 35) { tip = 8; s.flags.nurseServed++; moment(s, true, 2, `${c.name} tipped ${v.name} $8 on her break.`); }
        else sat -= 0.3;
    }
    if (c.kind === "student") s.flags.studentFed++;
    if (c.kind === "critic") st.criticVendor = v.id;
    if (tip) { s.cash += tip; st.tips += tip; }
    sat = clamp(sat, 0, 1);
    c.sats.push(sat); c.servedBy = v.name; c.waited = 0; c.patience = c.patienceMax;
    const stars = clamp(Math.round(1 + sat * 4), 1, 5);
    st.served++; st.perStall[stall.id].served++; st.perStall[stall.id].stars += stars; st.perStall[stall.id].revenue += price;
    st.perVendor[v.id].served++; st.perVendor[v.id].stars += stars;
    v.xp += neighbours(s, stall).some((n) => has(n.vendor, "mentor")) ? TRAITS.mentor.xp : 1;

    stall.queue.shift(); stall.serving = null; stall.serveT = 0;
    emit(s, { type: "served", id: c.id, stallId: stall.id, vendorId: v.id, price, tip, stars, mistake: stall.mistake });
    stall.mistake = false;

    // carry it to the nearest free stool, or eat standing if the tables are full
    const ends = streetEnds(s), eat = STREET.eatY;
    let ex = clamp(c.x + rrange(s, -3.4, 3.4), ends.left + 2.5, ends.right - 2.5), ey = rrange(s, eat[0], eat[1]);
    let seat = -1, near = 7;
    for (let k = 0, n = seatCount(s); k < n; k++) {
        if (s.seats[k] != null) continue;
        const d = Math.abs(seatSpot(k, SEAT).x - c.x);
        if (d < near) { near = d; seat = k; }
    }
    if (seat >= 0) { seatSpot(seat, SEAT); ex = SEAT.x; ey = SEAT.y; s.seats[seat] = c.id; }
    c.seat = seat;
    c.holding = stall.type; c.stallId = null;
    c.eatT = def.drink ? rrange(s, CUSTOMER.drink[0], CUSTOMER.drink[1]) : rrange(s, CUSTOMER.eat[0], CUSTOMER.eat[1]);
    walkTo(c, [[c.x + (c.x < ex ? 0.7 : -0.7), STREET.laneY[1] + 0.6], [ex, ey]], "eat");
}

function afterEating(s, c) {
    c.holding = null;
    if (c.seat >= 0) { delete s.seats[c.seat]; c.seat = -1; }
    if (c.thirsty && !c.hadDrink && s.t * NIGHT.dt < NIGHT.seconds) {
        const stall = chooseStall(s, c, true);
        if (stall) { c.hadDrink = true; return joinQueue(s, c, stall); }
    }
    finalize(s, c);
    leave(s, c);
}

function move(c, tx, ty, step) {
    const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    if (d <= step) { c.x = tx; c.y = ty; return true; }
    c.x += (dx / d) * step; c.y += (dy / d) * step;
    c.fx = dx / d; c.fy = dy / d;
    return false;
}

const SPOT = { x: 0, y: 0 }, SEAT = { x: 0, y: 0, tx: 0, ty: 0 };

/** What the inspector writes down after standing at a stall. */
function inspect(s, c) {
    const stall = stallById(s, c.inspect), v = stall && worker(s, stall), ins = s.stats.inspector;
    c.inspect = null;
    if (!v || !ins) return;
    ins.checked++;
    const pv = s.stats.perVendor[v.id];
    const why = stall.pauseT > 0 || pv.scenes ? "arguing in front of customers" : pv.mistakes ? "botched orders" : v.energy < VENDOR.tiredBelow ? "too tired to work safely" : null;
    if (why) { ins.faults.push({ v: v.id, why }); moment(s, false, 3, `The inspector wrote ${v.name} up: ${why}.`); }
    emit(s, { type: "inspect", id: c.id, vendorId: v.id, fault: !!why });
}

function stepCustomers(s, dt) {
    const patienceRate = mod(s, "patience") * managed(s, "marshal");
    for (let i = s.customers.length - 1; i >= 0; i--) {
        const c = s.customers[i];
        const stall = c.stallId != null ? stallById(s, c.stallId) : null;
        if (c.state === "walk") {
            // someone heading for a queue aims at their current place in it, which moves as the line does
            if (c.then === "queue" && stall && c.wp.length === 1) { queueSpot(stall, stall.queue.indexOf(c.id), SPOT); c.wp[0][0] = SPOT.x; c.wp[0][1] = SPOT.y; }
            const w = c.wp[0];
            if (!w || move(c, w[0], w[1], c.speed * (c.angry ? 1.3 : 1) * dt)) {
                c.wp.shift();
                if (!c.wp.length) {
                    if (c.then === "queue") { c.state = "queue"; c.atSpot = true; c.fx = 0; c.fy = 1; }
                    else if (c.then === "eat") {
                        c.state = "eat";
                        // sitting down: turn to the table
                        if (c.seat >= 0) { seatSpot(c.seat, SEAT); const dx = SEAT.tx - c.x, dy = SEAT.ty - c.y, d = Math.hypot(dx, dy) || 1; c.fx = dx / d; c.fy = dy / d; }
                    }
                    else if (c.then === "linger") { c.state = "linger"; c.fx = 0; c.fy = 1; if (c.kind === "kid") s.kidAt = c.x; if (c.scout) { s.flags.scouted = c.scout; emit(s, { type: "scout", id: c.id, vendorId: c.scout }); } }
                    else { s.customers.splice(i, 1); emit(s, { type: "gone", id: c.id }); }
                }
            }
        } else if (c.state === "queue") {
            if (!stall) { leave(s, c); continue; }
            queueSpot(stall, stall.queue.indexOf(c.id), SPOT);
            c.atSpot = move(c, SPOT.x, SPOT.y, c.speed * 0.8 * dt);
            if (c.atSpot) { c.fx = 0; c.fy = 1; }
            const v = worker(s, stall);
            c.waited += dt;
            c.patience -= dt * patienceRate * (has(v, "chatty") ? TRAITS.chatty.patience : 1);
            if (c.patience <= 0) leaveAngry(s, c, stall);
        } else if (c.state === "eat") {
            c.eatT -= dt;
            if (c.eatT <= 0) afterEating(s, c);
        } else if (c.state === "linger") {
            c.lingerT -= dt;
            if (c.lingerT <= 0) { if (c.kind === "kid") s.kidAt = null; c.scout = null; if (c.inspect != null) inspect(s, c); nextStep(s, c); }
        }
        // "served": standing at the counter until the stall finishes
    }
}

function stepStalls(s, dt) {
    for (const stall of s.stalls) {
        const v = worker(s, stall);
        if (!v) continue;
        if (stall.pauseT > 0) { stall.pauseT -= dt; continue; }
        if (stall.serving == null) {
            const c = stall.queue.length ? customerById(s, stall.queue[0]) : null;
            if (c && c.state === "queue" && c.atSpot) {
                stall.serving = c.id; stall.serveT = 0; stall.serveNeed = serveInfo(s, stall).time;
                c.state = "served";
                stall.mistake = has(v, "hothead") && stall.queue.length >= TRAITS.hothead.queue && chance(s, TRAITS.hothead.mistake);
                if (stall.mistake) emit(s, { type: "mistake", stallId: stall.id, vendorId: v.id });
            }
        } else {
            stall.serveT += dt;
            if (stall.serveT >= stall.serveNeed) {
                const c = customerById(s, stall.serving);
                if (c) completeServe(s, stall, c, v); else { stall.serving = null; stall.queue.shift(); }
            }
        }
    }
}

function stepVendors(s, dt, frac) {
    for (const stall of s.stalls) {
        const v = worker(s, stall);
        if (!v) continue;
        if (!(has(v, "owl") && frac > TRAITS.owl.after)) {
            v.energy = Math.max(0, v.energy - (VENDOR.energyIdle + (stall.serving != null ? VENDOR.energyServe : 0)) * dt);
        }
        const pv = s.stats.perVendor[v.id];
        if (v.energy < pv.minEnergy) pv.minEnergy = v.energy;
        if (!v.tiredFlag && v.energy < VENDOR.tiredBelow) { v.tiredFlag = true; emit(s, { type: "tired", vendorId: v.id, stallId: stall.id }); }
    }
}

/** Rivals working side by side sometimes stop to argue, which stalls both queues. */
function stepScenes(s, dt) {
    s.sceneT += dt;
    if (s.sceneT < VENDOR.sceneEvery) return;
    s.sceneT = 0;
    for (const a of s.stalls) {
        const b = stallAt(s, a.slot + 1), va = worker(s, a), vb = b && worker(s, b);
        if (!va || !vb || relation(s, va.id, vb.id) !== "rival" || !chance(s, VENDOR.sceneChance)) continue;
        for (const stall of [a, b]) {
            stall.pauseT = VENDOR.scenePause;
            for (const id of stall.queue) { const c = customerById(s, id); if (c && c.state === "queue") c.patience -= VENDOR.scenePatience; }
        }
        va.mood = clamp(va.mood - 4, 0, 100); vb.mood = clamp(vb.mood - 4, 0, 100);
        addRep(s, VENDOR.sceneRep);
        s.stats.scenes.push({ a: va.id, b: vb.id });
        s.stats.perVendor[va.id].scenes++; s.stats.perVendor[vb.id].scenes++;
        moment(s, false, 3, `${va.name} and ${vb.name} stopped serving to argue.`);
        emit(s, { type: "scene", a: a.id, b: b.id, va: va.id, vb: vb.id });
    }
}

/**
 * Advance the night by one tick (1/60 s). Returns false once the night is over, at which point
 * `state.phase` is "closing" and `state.summary` holds the results.
 */
export function stepNight(s) {
    if (s.phase !== "night") return false;
    const dt = NIGHT.dt, T = NIGHT.seconds;
    s.events.length = 0;
    s.t++;
    const time = s.t * dt;
    while (s.arrivalIdx < s.arrivals.length && s.arrivals[s.arrivalIdx].t <= time) spawn(s, s.arrivals[s.arrivalIdx++].spec);
    stepVendors(s, dt, Math.min(1, time / T));
    stepStalls(s, dt);
    if (time < T) stepScenes(s, dt);
    stepCustomers(s, dt);
    if (time >= T && (!s.customers.length || time >= T + NIGHT.grace)) {
        for (const c of s.customers) finalize(s, c);
        s.customers = [];
        for (const stall of s.stalls) { stall.queue = []; stall.serving = null; }
        finishNight(s);
        return false;
    }
    return true;
}

// ------------------------------------------------------------------ closing
function finishNight(s) {
    const st = s.stats, hired = hiredVendors(s);
    const wages = hired.reduce((n, v) => n + v.wage, 0);
    const upkeep = s.stalls.reduce((n, t) => n + STALLS[t.type].upkeep, 0);
    const rent = s.rent;
    s.cash -= wages + upkeep + rent;
    s.kidAt = null; s.seats = {};
    const ins = st.inspector;
    if (ins && ins.checked) s.flags.inspection = { n: ins.faults.length, v: ins.faults[0]?.v ?? null, why: ins.faults[0]?.why || "", checked: ins.checked };

    // reputation: the critic's verdict doubles the swing in the direction of her review
    let gain = st.repGain, loss = st.repLoss;
    if (st.critic != null) {
        if (st.critic >= 4) gain = gain * 2 + 2;
        else if (st.critic <= 2) loss = loss * 2 - 2;
    }
    gain *= Math.max(0.12, 1 - s.rep / 105);
    const repBefore = s.rep;
    s.rep = clamp(s.rep + gain + loss - ECON.repDecay + modAdd(s, "rep"), 0, 100);

    // vendors: skill, mood
    const rows = [];
    for (const v of hired) {
        const pv = st.perVendor[v.id] || { served: 0, stars: 0, mistakes: 0, scenes: 0, minEnergy: 100, worked: false };
        const stall = v.stallId != null ? stallById(s, v.stallId) : null;
        let dm = 0, levelUp = false;
        if (pv.worked && stall) {
            v.nights++;
            while (v.skill < VENDOR.maxSkill && v.xp >= VENDOR.xpPerLevel * v.skill) { v.xp -= VENDOR.xpPerLevel * v.skill; v.skill++; levelUp = true; }
            if (levelUp) st.levelUps.push(v.id);
            const avg = pv.served ? pv.stars / pv.served : 3;
            dm += avg >= 4 ? 3 : avg < 3 ? -3 : 0;
            if (pv.minEnergy <= 3) dm -= 5;
            for (const n of neighbours(s, stall)) { const r = relation(s, v.id, n.vendor.id); dm += r === "friend" ? 3 : r === "rival" ? -4 : 0; }
        } else if (!v.off) dm -= 4;
        v.mood = clamp(v.mood + dm, 0, 100);
        v.moodDelta = dm;
        v.off = false;
        rows.push({ id: v.id, name: v.name, served: pv.served, avg: pv.served ? pv.stars / pv.served : 0, moodDelta: dm, mood: v.mood, levelUp, skill: v.skill, worked: pv.worked });
    }

    const net = st.revenue + st.tips - st.ingredients - wages - upkeep - rent;
    const sorted = (good) => st.moments.filter((m) => m.good === good).sort((a, b) => b.weight - a.weight || b.t - a.t).slice(0, 2).map((m) => m.text);
    s.summary = {
        night: s.night, revenue: st.revenue, tips: st.tips, ingredients: st.ingredients, wages, upkeep, rent, net, cash: s.cash,
        repBefore, repAfter: s.rep, served: st.served, angry: st.angry, walked: st.walked, expected: st.expected,
        avgStars: st.reviews ? st.stars / st.reviews : 0, best: sorted(true), worst: sorted(false), vendors: rows,
        discovered: st.discovered, critic: st.critic, scenes: st.scenes.length, mistakes: st.mistakes, weather: s.weather, expect: expectation(s),
    };
    s.history.push({ night: s.night, net, cash: s.cash, rep: s.rep, served: st.served });
    s.phase = "closing";
    if (s.cash < 0) { s.outcome = "lost"; s.event = null; }
    else s.event = pickEvent(s);
}

/** Leave the closing screen: either the campaign ends here or the next night's preparation begins. */
export function advance(s) {
    if (s.phase !== "closing") return fail("Not closing");
    if (s.outcome === "lost" || s.cash < 0) { s.outcome = "lost"; s.phase = "over"; return ok; }
    if (s.night >= NIGHT.campaignNights && !s.endless) { s.outcome = "won"; s.phase = "over"; return ok; }
    nextNight(s);
    return ok;
}

/** After winning the campaign, keep the same street going with rent that never stops rising. */
export function continueEndless(s) {
    if (s.phase !== "over" || s.outcome !== "won") return fail("Not available");
    s.endless = true; s.outcome = null;
    nextNight(s);
    return ok;
}

function nextNight(s) {
    s.night++;
    s.phase = "prep";
    if (s.rentFreeze > 0) s.rentFreeze--;
    else s.rent += s.rentStep + (s.endless ? (s.night - NIGHT.campaignNights) * ECON.endlessRent : 0);
    // tonight's weather: the festival comes round on its own, rain when it was forecast, otherwise the odd wet night
    const wet = s.forecast === "rain" || (s.night >= WEATHER.from && chance(s, WEATHER.chance));
    s.weather = s.night % WEATHER.festivalEvery === 0 ? "festival" : wet ? "rain" : "clear";
    s.forecast = null;
    for (const m of s.mods) { if (m.fresh) m.fresh = false; else m.n--; }
    s.mods = s.mods.filter((m) => m.n > 0);
    for (const v of s.vendors) { v.energy = 100; v.tiredFlag = false; }
    // last night's working data is no longer needed, and dropping it keeps the saved campaign small
    s.event = null; s.customers = []; s.events = []; s.arrivals = []; s.stats = null; s.t = 0;
    refreshMarket(s);
}

/** A 0–3 star score for a finished campaign. */
export function campaignStars(s) {
    if (s.outcome !== "won" && !s.endless) return 0;
    return 1 + (s.cash >= 600 ? 1 : 0) + (s.rep >= 70 ? 1 : 0);
}
