import { TICK_RATE, WATER, ISLAND } from "./data.js";
import { PHASE } from "./tide.js";

/**
 * TIDEFALL: the first two minutes (the preamble's onboarding rule, and `level-design`'s "teach in a safe
 * space, then test"). No manual and no tutorial level: short tips that appear once each, at the moment
 * they matter, during a player's first match, and stop for good once they have banked something.
 *
 *   start       how to move, and what the bell means
 *   shore       the water has gone back far enough to walk out
 *   near loot   how to pick up, and what weight does
 *   carrying    where to take it (the arrow), and that it only counts at the chest
 *   heavy+deep  a heavy load in deep water sinks you
 *   flood       the horn: get back up
 *   banked      done; the deeper tides and the shove, then no more tips
 *
 * Which tips have been seen is kept in the save, so a returning player isn't told again.
 * @module game/tutorial
 */

export class Tutorial {
    /** @param {{ seen: string[], done: boolean }} memory saved between visits; mutated */
    constructor(memory, show) {
        this.memory = memory;
        this.show = show;
        this.cooldown = 3;
    }

    tip(id, text, seconds = 6) {
        if (this.memory.done || this.memory.seen.includes(id) || this.cooldown > 0) return false;
        this.memory.seen.push(id);
        this.show(text, seconds);
        this.cooldown = seconds + 1.5;
        return true;
    }

    /**
     * @param {number} dt
     * @param {{ me: object, island: object, tide: object, near: object | null, banked: number, keys: (id: string) => string }} c
     * @returns {boolean} true when the save changed
     */
    update(dt, c) {
        if (this.memory.done) return false;
        if (this.cooldown > 0) this.cooldown -= dt;
        const { me, island, tide, near, keys } = c, before = this.memory.seen.length;
        if (!me.alive) return false;
        const camp = island.camps[me.team], away = Math.hypot(camp.x - me.x, camp.y - me.y);
        this.tip("start", `${keys("move")} to move, mouse to look. The sea is going out: wait for the beach to dry, then raid the ruins.`, 7);
        if (tide.phase <= PHASE.low && tide.level < -0.5 && away < 30) this.tip("shore", "The ruins are coming up. Head down the beach and look for glinting loot.", 6);
        if (near) this.tip("pick", `${keys("interact")} picks it up. Coins are light; relics and idols are worth more but slow you down.`, 7);
        if (me.carry.length && away > ISLAND.campPad + 6) this.tip("carry", "Loot only counts once it's in your camp's chest. Follow the arrow at the bottom of the screen.", 7);
        if (me.weight > WATER.swimCapacity && tide.level - me.z > 0.8) this.tip("heavy", "Over 4 kg you sink in deep water. Watch your breath, or the heavy loot sinks too.", 7);
        if (tide.phase === PHASE.flood && away > ISLAND.campPad) this.tip("flood", "That horn means the flood: the water comes back fast. Get to high ground!", 6);
        if (c.banked > 0) {
            this.cooldown = 0;
            if (this.tip("banked", `Banked! Each tide goes lower: deeper ruins, richer loot. ${keys("shove")} shoves a rival so they drop what they carry. ${keys("grapple")} fires the grapple.`, 9)) this.memory.done = true;
        }
        return this.memory.seen.length !== before;
    }
}
