import { STALLS, ECON, STREET, MAX_LEVEL } from "./data.js";
import { buyStall, hire, assign, upgradeStall, extendStreet, moveStall, startNight, stepNight, advance, continueEndless,
    vendorById, stallAt, hiredVendors, worker, relation, upgradeCost, extendCost, unlocked } from "./sim.js";
import { describeEvent, resolveEvent } from "./events.js";

/**
 * Scripted players. They use exactly the actions a human has, so they serve two jobs:
 * the balance tool (tools/balance.mjs) plays whole campaigns with them, and the title screen
 * runs one behind the menu so the street is alive before the player has done anything.
 * @module game/bots
 */

const wages = (s) => hiredVendors(s).reduce((n, v) => n + v.wage, 0);
const upkeep = (s) => s.stalls.reduce((n, t) => n + STALLS[t.type].upkeep, 0);
/** Cash that must be left over to pay tonight's bills even if nobody shows up. */
const reserve = (s) => s.rent + wages(s) + upkeep(s) + 15;
const freeSlot = (s) => { for (let i = 0; i < s.slots; i++) if (!stallAt(s, i)) return i; return -1; };

/** Hire for every unstaffed stall, best skill for the money first. */
function staff(s, floor) {
    for (const stall of s.stalls.slice().sort((a, b) => a.slot - b.slot)) {
        if (worker(s, stall)) continue;
        const idle = hiredVendors(s).find((v) => v.stallId == null && !v.off);
        if (idle) { assign(s, idle.id, stall.id); continue; }
        if (s.cash - ECON.hireFee < floor) return;
        const best = s.market.map((id) => vendorById(s, id)).sort((a, b) => (b.skill * 12 - b.wage) - (a.skill * 12 - a.wage))[0];
        if (best && hire(s, best.id).ok && best.stallId !== stall.id) assign(s, best.id, stall.id);
    }
}

/** Swap stalls around until no two known rivals are side by side (and friends are, where it's free). */
function arrange(s) {
    const score = () => {
        let n = 0;
        for (const a of s.stalls) {
            const b = stallAt(s, a.slot + 1), va = worker(s, a), vb = b && worker(s, b);
            if (!va || !vb) continue;
            const r = relation(s, va.id, vb.id, true);
            n += r === "friend" ? 1 : r === "rival" ? -2 : 0;
        }
        return n;
    };
    for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (const a of s.stalls) for (let slot = 0; slot < s.slots; slot++) {
            if (slot === a.slot) continue;
            const before = score(), from = a.slot;
            moveStall(s, a.id, slot);
            if (score() > before) improved = true; else moveStall(s, a.id, from);
        }
        if (!improved) break;
    }
}

const MIX = ["dumplings", "skewers", "tea", "noodles", "dumplings", "skewers", "takoyaki", "tea", "takoyaki", "noodles"];

function build(s, plan, { upgrades = true, tidy = true } = {}) {
    staff(s, 0);
    while (s.stalls.length < s.slots) {
        // anything not on sale yet is swapped for the all-rounder
        const want = plan[s.stalls.length % plan.length], type = unlocked(s, want) ? want : "dumplings", def = STALLS[type];
        const needHire = !hiredVendors(s).some((v) => v.stallId == null && !v.off);
        const after = s.cash - def.buy - (needHire ? ECON.hireFee : 0);
        // keep tonight's rent in hand; the night's takings cover wages and upkeep
        if (after < s.rent + 25) break;
        if (!buyStall(s, type, freeSlot(s)).ok) break;
        staff(s, 0);
    }
    if (upgrades) {
        if (s.stalls.length >= s.slots && s.slots < STREET.maxSlots && s.cash - extendCost(s) > reserve(s) + 120) extendStreet(s);
        // a few small upgrades a night, always to whichever stall is furthest behind
        for (let k = 0; k < 4; k++) {
            const lowest = s.stalls.filter((t) => t.level < MAX_LEVEL && worker(s, t)).sort((a, b) => a.level - b.level || a.slot - b.slot)[0];
            if (!lowest || s.stalls.length < Math.min(4, s.slots) || s.cash - upgradeCost(lowest) <= reserve(s) + 80 || !upgradeStall(s, lowest.id).ok) break;
        }
    }
    if (tidy) arrange(s);
}

/** name → function(state) that spends the preparation phase. */
export const BOTS = {
    nothing: () => {},
    /** every night, buy whatever is cheapest and hire whoever is cheapest, with no thought for layout */
    cheapest: (s) => {
        const slot = freeSlot(s);
        if (slot >= 0 && s.cash >= STALLS.skewers.buy + ECON.hireFee) buyStall(s, "skewers", slot);
        for (const stall of s.stalls) {
            if (worker(s, stall)) continue;
            const idle = hiredVendors(s).find((v) => v.stallId == null && !v.off);
            if (idle) { assign(s, idle.id, stall.id); continue; }
            const cheap = s.market.map((id) => vendorById(s, id)).sort((a, b) => a.wage - b.wage)[0];
            if (cheap) hire(s, cheap.id);
        }
    },
    sensible: (s) => build(s, MIX),
    /** the sensible builder, but it never looks at who is standing next to whom */
    careless: (s) => build(s, MIX, { tidy: false }),
    onlySkewers: (s) => build(s, ["skewers"]),
    onlyDumplings: (s) => build(s, ["dumplings"]),
    onlyNoodles: (s) => build(s, ["noodles"]),
    onlyTea: (s) => build(s, ["tea"]),
};

/** Bots answer closing events with the first option they can afford. */
function answerEvent(s) {
    const d = describeEvent(s);
    if (!d) return;
    const c = d.choices.find((x) => !x.disabled);
    if (c) resolveEvent(s, c.index);
}

/** Play one whole night (prepare, run, close). Returns false once the campaign is over. */
export function playNight(s, bot) {
    if (s.phase === "over") { if (s.outcome !== "won" || !continueEndless(s).ok) return false; }
    if (s.phase !== "prep") return false;
    bot(s);
    startNight(s);
    while (stepNight(s)) { /* run to closing time */ }
    answerEvent(s);
    advance(s);
    return s.phase !== "over";
}
