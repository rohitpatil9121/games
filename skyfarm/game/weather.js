import { DAY_TICKS, DT } from "./data.js";
import { weatherOf } from "./farm.js";
import { hash3, dsin, dcos, smooth, clamp } from "./det.js";

/**
 * SKYFARM: storms (GDD §2: "dangerous to glide in, telegraphed by clouds building up"; GDD §10: "telegraphed for
 * 2–3 in-game hours"). Pure and deterministic, from the world seed and the tick, so the simulation, the
 * effects and the sound all agree on when a storm builds and when a gust hits.
 *
 * A storm day's strength (0..1) rises over BUILD of a day before its rain window (about 2.2 in-game hours: clouds
 * tower and darken, the wind picks up, distant thunder), is full while the rain falls, and fades over FADE after.
 * While it blows, gusts come in slots of SLOT seconds: each slot a gust of seeded strength and direction, with a
 * one-second swell before it (the warning you can hear and see in the streaks), three seconds of push and a
 * downdraft that steals height, then calm. A gust can stall a glider or push it off its line; on foot it does
 * nothing (it's a cosy game).
 * @module game/weather
 */

export const STORM = Object.freeze({ BUILD: 0.12, FADE: 0.05, SLOT: 9, WARN: 1, PUSH: 3, speed: [6, 13], down: 3.2 });

/** how stormy it is at a tick (0..1) */
export function stormAt(seed, tick) {
    const day = Math.floor(tick / DAY_TICKS) + 1, t = (tick % DAY_TICKS) / DAY_TICKS, w = weatherOf(seed, day);
    if (w.kind !== "storm") return 0;
    if (t < w.rainFrom) return smooth(clamp(1 - (w.rainFrom - t) / STORM.BUILD, 0, 1));
    if (t < w.rainTo) return 1;
    return smooth(clamp(1 - (t - w.rainTo) / STORM.FADE, 0, 1));
}

/**
 * The storm's gust at this tick, written into out: { x, y, z } wind (m/s), `warn` 0..1 (the swell before a
 * gust), `push` 0..1 (the gust itself). Zero when there's no storm.
 */
export function gustAt(seed, tick, out) {
    const s = stormAt(seed, tick);
    out.x = out.y = out.z = 0; out.warn = 0; out.push = 0;
    if (s <= 0) return out;
    const sec = tick * DT, slot = Math.floor(sec / STORM.SLOT), u = sec - slot * STORM.SLOT;
    const strength = STORM.speed[0] + (STORM.speed[1] - STORM.speed[0]) * hash3(seed, slot, 7717);
    const dir = hash3(seed, slot, 7723) * 6.2831853;
    // the swell before, the push, the easing out
    const start = 2 + hash3(seed, slot, 7727) * (STORM.SLOT - STORM.PUSH - STORM.WARN - 2);
    if (u >= start - STORM.WARN && u < start) out.warn = (u - (start - STORM.WARN)) / STORM.WARN;
    if (u >= start && u < start + STORM.PUSH) {
        const k = u - start, env = smooth(clamp(k / 0.4, 0, 1)) * smooth(clamp((STORM.PUSH - k) / 0.6, 0, 1));
        out.push = env;
        const v = strength * env * s;
        out.x = dcos(dir) * v; out.y = dsin(dir) * v; out.z = -STORM.down * env * s;
    }
    return out;
}
