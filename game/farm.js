import { DAY_TICKS, DAY, DT, CROPS, WEATHER, SPRITES, RECIPES, MEALS } from "./data.js";
import { hashSeed, hash3, dsin, dcos, TAU } from "./det.js";

/**
 * SKYFARM: the farm's rules (GDD §2, §4). Pure and deterministic, called by sim.js.
 *
 * Growth: a crop grows while its soil is wet (watered today, or rain falling on it), at its own pace (`days` of
 * growth to ripe), faster in the rain. Some need more: moon-beans grow only at night; cloud-cotton stops at two
 * thirds until rain has fallen on it once (then watering finishes it: stage 4 measured that needing rain for the
 * whole last third took about two weeks); star-lilies grow in rain or at night. At dawn a crop that grew yesterday is credited the whole day
 * (a one-day turnip planted at noon is ripe next morning), then every plot dries out.
 *
 * Weather: one kind per day, from the world seed and the day number (so it's the same for everyone and can be
 * shown in advance): clear, breezy, rain or storm (storms not before day WEATHER.stormFrom). Rain falls in a
 * seeded window of the day; it waters every plot it falls on.
 *
 * Pollinators: flowering plants in bloom (growth ≥ ½) that stand together, 3 or more of at least 2 hues within
 * SPRITES.cluster m, make a cluster. Sprites come to clusters (they fly in from off the island), hover over them
 * and wander between the flowers, and every crop within SPRITES.reach m of a hovering sprite is pollinated: its
 * next harvest yields SPRITES.boost times as much. Running through them scatters them for a moment.
 *
 * Meals: at the hut's stove the best recipe the pouch can make is cooked; it adds to today's stamina.
 * @module game/farm
 */

const WEATHER_KINDS = ["clear", "breezy", "rain", "storm"];

/** The weather of a day (1 = the first): { kind, rainFrom, rainTo } (rain window as fractions of the day) */
export function weatherOf(seed, day) {
    const r = hash3(seed, day, 4099), C = WEATHER.chance;
    let kind = r < C.clear ? "clear" : r < C.clear + C.breezy ? "breezy" : r < C.clear + C.breezy + C.rain ? "rain" : "storm";
    // the first days are always kind, and no storms before stormFrom
    if (day <= 1) kind = "clear";
    if (kind === "storm" && day < WEATHER.stormFrom) kind = "rain";
    let rainFrom = 0, rainTo = 0;
    if (kind === "rain" || kind === "storm") {
        const len = WEATHER.rainLength[0] + (WEATHER.rainLength[1] - WEATHER.rainLength[0]) * hash3(seed, day, 4111);
        rainFrom = WEATHER.rainWindow[0] + (WEATHER.rainWindow[1] - WEATHER.rainWindow[0] - len) * hash3(seed, day, 4127);
        rainTo = rainFrom + len;
    }
    return { kind, rainFrom, rainTo, day };
}
export { WEATHER_KINDS };

const isNight = (t) => t >= DAY.blue;
/** is rain falling at this tick? */
export function rainingAt(seed, tick) {
    const w = weatherOf(seed, Math.floor(tick / DAY_TICKS) + 1), t = (tick % DAY_TICKS) / DAY_TICKS;
    return w.rainTo > 0 && t >= w.rainFrom && t < w.rainTo;
}

/** Can this crop grow right now, and how fast (0 = not at all)? */
function rate(c, plot, raining, night) {
    const wet = plot.watered || raining;
    if (!wet) return 0;
    if (c.needs === "night" && !night) return 0;
    if (c.needs === "rain" && plot.growth >= 2 / 3 - 1e-9 && !plot.rained && !raining) return 0;
    if (c.needs === "rain-or-night" && !raining && !night) return 0;
    return raining ? WEATHER.rainGrowth : 1;
}

/**
 * Grow every crop over `ticks` ticks from now. Long spans (sleep) are taken in 10-second steps, so night-only and
 * rain-only crops still see the night and the rain they sleep through.
 */
export function grow(state, ticks) {
    const STEP = 600;
    for (let done = 0; done < ticks;) {
        const n = Math.min(STEP, ticks - done), at = state.tick + done + (n >> 1);
        const raining = rainingAt(state.seed, at), night = isNight((at % DAY_TICKS) / DAY_TICKS);
        for (const plot of state.plots.values()) {
            if (raining && plot.tilled) { plot.watered = true; if (plot.crop && plot.growth >= 2 / 3 - 1e-9) plot.rained = true; }
            if (!plot.crop || plot.growth >= 1) continue;
            const c = CROPS[plot.crop], k = rate(c, plot, raining, night);
            if (k <= 0) continue;
            const g0 = plot.growth;
            plot.growth = Math.min(1, g0 + (n * k) / (c.days * DAY_TICKS));
            plot.grew = true;
            if (g0 < c.stages[0] && plot.growth >= c.stages[0]) state.events.push({ type: "sprout", ix: plot.ix, iy: plot.iy, crop: plot.crop });
            if (g0 < 1 && plot.growth >= 1) state.events.push({ type: "ripe", ix: plot.ix, iy: plot.iy, crop: plot.crop });
        }
        done += n;
    }
}

/** Dawn on the farm: yesterday's growing earns its whole day; the soil dries; meals wear off. */
export function farmDawn(state) {
    for (const plot of state.plots.values()) {
        if (plot.crop && plot.grew && !CROPS[plot.crop].needs) {
            const c = CROPS[plot.crop], g0 = plot.growth;
            plot.days++;
            plot.growth = Math.min(1, Math.max(plot.growth, plot.days / c.days));
            if (g0 < c.stages[0] && plot.growth >= c.stages[0]) state.events.push({ type: "sprout", ix: plot.ix, iy: plot.iy, crop: plot.crop });
            if (g0 < 1 && plot.growth >= 1) state.events.push({ type: "ripe", ix: plot.ix, iy: plot.iy, crop: plot.crop });
        }
        plot.watered = false; plot.grew = false;
    }
    state.player.meal = 0;
    state.weather = weatherOf(state.seed, Math.floor(state.tick / DAY_TICKS) + 1);
}

/** What a harvest of this plot gives: produce (more if pollinated) and seeds back. */
export function harvestOf(plot) {
    const c = CROPS[plot.crop];
    const produce = plot.pollinated ? Math.floor(c.yield * SPRITES.boost + 0.5) : c.yield;
    // a ripe plant gives back a seed or two, so the farm can grow (trees and bushes regrow instead)
    const seeds = c.regrow ? 0 : 1 + (((plot.ix * 7 + plot.iy * 13) & 1) === 0 ? 1 : 0);
    return { produce, seeds };
}
/** After a harvest: cleared, or back to the regrow stage (bushes, fruit trees) */
export function afterHarvest(plot) {
    const c = CROPS[plot.crop];
    if (c.regrow) { plot.growth = c.regrow; plot.days = Math.floor(c.regrow * c.days); }
    else { plot.crop = ""; plot.growth = 0; plot.days = 0; }
    plot.pollinated = false; plot.watered = false; plot.rained = false;
}

/** May this crop be planted in this plot's band? */
export const growsIn = (cropId, band) => CROPS[cropId].grows.includes(band);

// ------------------------------------------------------------------ meals

/** the first recipe (best first) the pouch can make, or null */
export function cookable(pouch) {
    return RECIPES.find((r) => Object.entries(r.needs).every(([c, n]) => pouch.crops[c] >= n)) || null;
}
export function cook(state) {
    const r = cookable(state.pouch), p = state.player;
    if (!r) return null;
    for (const [c, n] of Object.entries(r.needs)) state.pouch.crops[c] -= n;
    p.meal = Math.min(MEALS.maxBonus, (p.meal || 0) + r.stamina);
    p.stamina = Math.min(p.staminaMax + p.meal, p.stamina + r.stamina);
    return r;
}

// ------------------------------------------------------------------ pollinators

const random = (state) => { state.rng = (state.rng + 0x6d2b79f5) >>> 0; return hashSeed(state.rng); };

/** flowering plants in bloom that stand together: [{ x, y, z, island, n, hues }] */
export function clusters(state) {
    const blooms = [];
    for (const plot of state.plots.values()) {
        if (!plot.crop) continue;
        const c = CROPS[plot.crop];
        if (c.flower && plot.growth >= 0.5) blooms.push({ x: plot.ix + 0.5, y: plot.iy + 0.5, z: plot.z, hue: c.flower, island: plot.island });
    }
    const out = [], used = new Set(), R = SPRITES.cluster;
    for (let i = 0; i < blooms.length; i++) {
        if (used.has(i)) continue;
        const a = blooms[i], members = [];
        for (let j = 0; j < blooms.length; j++) if (!used.has(j) && Math.hypot(blooms[j].x - a.x, blooms[j].y - a.y) <= R) members.push(j);
        const hues = new Set(members.map((j) => blooms[j].hue));
        if (members.length < SPRITES.minFlowers || hues.size < SPRITES.minHues) continue;
        let x = 0, y = 0, z = 0;
        for (const j of members) { used.add(j); x += blooms[j].x; y += blooms[j].y; z += blooms[j].z; }
        out.push({ x: x / members.length, y: y / members.length, z: z / members.length, island: a.island, n: members.length, hues: hues.size });
    }
    return out;
}

/** Sprites: come to clusters, hover, pollinate, scatter from a running player, leave when the flowers go. */
export function stepSprites(state) {
    const S = SPRITES, p = state.player;
    if (state.tick % 120 === 0) state.clusters = clusters(state);
    const cl = state.clusters || [];
    // arrivals: each cluster wants perCluster sprites; one comes in at a time, from 30 m off
    if (state.tick % 90 === 0) {
        for (const c of cl) {
            const here = state.sprites.filter((s) => Math.hypot(s.x - c.x, s.y - c.y) < S.seek).length;
            if (here < S.perCluster && state.sprites.length < S.max) {
                const a = random(state) * TAU;
                state.sprites.push({ id: state.nextSprite++, x: c.x + dcos(a) * 30, y: c.y + dsin(a) * 30, z: c.z + 8, vx: 0, vy: 0, vz: 0, mode: "seek", t: 0, phase: random(state) * TAU, scared: 0 });
                state.events.push({ type: "sprite-arrives", x: c.x, y: c.y });
            }
        }
    }
    const running = Math.hypot(p.vx, p.vy) > 5 && p.mode === "foot";
    for (let i = state.sprites.length - 1; i >= 0; i--) {
        const s = state.sprites[i];
        s.t++;
        // the nearest cluster within reach of its senses
        let target = null, bd = S.seek;
        for (const c of cl) { const d = Math.hypot(c.x - s.x, c.y - s.y); if (d < bd) { bd = d; target = c; } }
        if (!target) { s.mode = "leave"; s.gone = (s.gone || 0) + 1; }
        else s.gone = 0;
        // a running player scatters them for two seconds
        const pd = Math.hypot(p.x - s.x, p.y - s.y);
        if (running && pd < 3) { s.scared = 120; s.mode = "scared"; }
        let gx, gy, gz;
        if (s.scared > 0) {
            s.scared--;
            const k = pd > 1e-3 ? 1 / pd : 0;
            gx = s.x + (s.x - p.x) * k * 6; gy = s.y + (s.y - p.y) * k * 6; gz = (target ? target.z : s.z) + 3.5;
        } else if (target) {
            // wander between the flowers: a slow loop around the middle of the cluster
            const a = s.phase + s.t * 0.012, r = 1.6 + 0.8 * dsin(s.t * 0.007 + s.phase);
            gx = target.x + dcos(a) * r; gy = target.y + dsin(a) * r; gz = target.z + 0.9 + 0.3 * dsin(s.t * 0.05);
            s.mode = Math.hypot(gx - s.x, gy - s.y) < 2.5 ? "hover" : "seek";
        } else { gx = s.x + s.vx * 30; gy = s.y + s.vy * 30; gz = s.z + 2; }
        // steer toward the goal (arrive), capped speed
        const dx = gx - s.x, dy = gy - s.y, dz = gz - s.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const sp = Math.min(S.speed * (s.scared > 0 ? 2.5 : 1), d * 1.5);
        s.vx += ((dx / d) * sp - s.vx) * 0.08; s.vy += ((dy / d) * sp - s.vy) * 0.08; s.vz += ((dz / d) * sp - s.vz) * 0.08;
        s.x += s.vx * DT; s.y += s.vy * DT; s.z += s.vz * DT;
        // pollinate what's under a hovering sprite
        if (s.mode === "hover" && s.t % 30 === 0) {
            for (const plot of state.plots.values()) {
                if (!plot.crop || plot.pollinated) continue;
                if (Math.hypot(plot.ix + 0.5 - s.x, plot.iy + 0.5 - s.y) <= S.reach) { plot.pollinated = true; state.events.push({ type: "pollinated", ix: plot.ix, iy: plot.iy }); }
            }
        }
        if (s.gone > 600) state.sprites.splice(i, 1);
    }
}
