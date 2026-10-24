/**
 * SKYFARM: the first five minutes (the game prompt: wake up, plant your first seed, get the glider, glide to the
 * neighbouring island, find a new seed, come home, see the first crop sprout; "no text walls, the world
 * teaches it"; after TIDEFALL's tutorial.js). One quiet line under the clock says what to do next, in a few
 * words, with the key to press; it moves on when the game's own events show the step is done, never on a
 * timer. Nothing stops play, and a player who does things out of order just skips ahead.
 *
 * Steps (each done by an event the simulation already sends):
 *   seeds   pick up the turnip seeds by the door          pick (seed)
 *   plant   plant them in the tilled soil                  plant
 *   water   water them                                      water
 *   glider  take grandmother's glider by the shed          pick (glider)
 *   glide   jump off, open it, glide to Daisy Step         land (glide) on another island
 *   find    find the rope-grass seeds there                pick (seed) away from home
 *   home    climb in the pollen, glide home                land on Hearth Isle
 *   sleep   sleep, and the turnips sprout                  sprout or slept
 *
 * Where it got to is kept in the profile (save.js), so it isn't told twice, and it can be switched off by
 * finishing it or by loading a farm that is past it.
 * @module game/tutorial
 */

export const STEPS = ["seeds", "plant", "water", "glider", "glide", "find", "home", "sleep"];

export class Tutorial {
    /**
     * @param {{ seen: string[], done: boolean }} memory saved in the profile; mutated
     * @param {(text: string) => void} goal shows the goal line ("" hides it)
     */
    constructor(memory, goal) {
        this.memory = memory;
        this.goal = goal;
        this.shown = null;
    }

    /** the step it's on: the first not seen */
    get step() { return this.memory.done ? null : STEPS.find((s) => !this.memory.seen.includes(s)) || null; }

    done(id) {
        if (this.memory.seen.includes(id)) return false;
        // doing a later step counts the earlier ones (a returning player, or one who explores first)
        for (const s of STEPS.slice(0, STEPS.indexOf(id) + 1)) if (!this.memory.seen.includes(s)) this.memory.seen.push(s);
        if (STEPS.every((s) => this.memory.seen.includes(s))) this.memory.done = true;
        return true;
    }

    /** A loaded farm far enough on needs no tutorial. */
    skipFor(state) {
        if (state.player.hasGlider && state.progress.restored.size > 1) { this.memory.done = true; return true; }
        return false;
    }

    /**
     * Read this tick's events. Returns true when the profile changed (to be saved).
     * @param {object[]} events
     * @param {(x: number, y: number, z: number) => string} islandAt the island id under a point
     * @param {object} p the player
     */
    events(events, islandAt, p) {
        if (this.memory.done) return false;
        let changed = false;
        for (const e of events) {
            const at = islandAt(p.x, p.y, p.z);
            if (e.type === "pick" && e.kind === "seed") changed = this.done(at === "hearth" ? "seeds" : "find") || changed;
            else if (e.type === "plant") changed = this.done("plant") || changed;
            else if (e.type === "water") changed = this.done("water") || changed;
            else if (e.type === "pick" && e.kind === "glider") changed = this.done("glider") || changed;
            else if (e.type === "land" && e.glide && at && at !== "hearth") changed = this.done("glide") || changed;
            else if (e.type === "land" && e.glide && at === "hearth" && this.memory.seen.includes("glide")) changed = this.done("home") || changed;
            else if ((e.type === "sprout" || e.type === "slept") && this.memory.seen.includes("home")) changed = this.done("sleep") || changed;
        }
        return changed;
    }

    /** Put the current step's line on screen. keys(id) names the bound key ("E"). */
    show(keys, p) {
        const s = this.step;
        let text = "";
        if (s === "seeds") text = `Turnip seeds by the door: ${keys("interact")} to pick them up`;
        else if (s === "plant") text = `Plant them in the dark tilled soil by the hut (${keys("interact")})`;
        else if (s === "water") text = `Water them: ${keys("interact")} again`;
        else if (s === "glider") text = "Grandmother's glider is leaning on the shed";
        else if (s === "glide") text = p.mode === "glide" ? `Steer with ${keys("steer") || keys("left") + keys("right") + ", " + keys("forward") + " to dive"}. Land on the island with the standing stones` : `Run off the edge toward the standing stones, then ${keys("jump")} in the air to open the glider`;
        else if (s === "find") text = "Look for seeds that glint in the grass";
        else if (s === "home") text = "Circle in the rising pollen to climb, then glide home";
        else if (s === "sleep") text = "Sleep in your bed: crops grow overnight";
        if (text !== this.shown) { this.shown = text; this.goal(text); }
    }
}
