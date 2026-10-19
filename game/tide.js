import { TIDE, TICK_RATE } from "./data.js";
import { dsin, hash3, smooth, TAU } from "./det.js";

/**
 * TIDEFALL: the sea. Its height is a pure function of the match seed and the tick, so the server, every
 * client and the tools all compute the same water level and it costs nothing on the wire.
 *
 * One cycle is four phases (data.js TIDE.phases): the ebb drains from high water to this tide's low, low
 * water holds (with a slow swell on top), the flood comes back in faster than it went out, and high water
 * holds. Each tide's low is lower than the last, moved a little by the seed, so the deepest ruins open
 * only in tides 5 and 6.
 * @module game/tide
 */

const PHASE_TICKS = TIDE.phases.map((p) => p.seconds * TICK_RATE);
const CYCLE_TICKS = TIDE.cycle * TICK_RATE;
/** ticks into a cycle at which each phase starts */
const PHASE_START = PHASE_TICKS.reduce((acc, n, i) => { acc.push(i ? acc[i - 1] + PHASE_TICKS[i - 1] : 0); return acc; }, []);
export const MATCH_TICKS = CYCLE_TICKS * TIDE.tides;
export const PHASE = Object.freeze({ ebb: 0, low: 1, flood: 2, high: 3 });

/** How low tide `k` goes for this seed. */
export function lowOf(seed, k) {
    const i = Math.max(0, Math.min(TIDE.tides - 1, k));
    return TIDE.lows[i] + (hash3(seed, i, 77) * 2 - 1) * TIDE.jitter;
}

/**
 * The state of the sea at a tick.
 * @param {number} seed
 * @param {number} tick match ticks (0 = the first ebb begins)
 * @param {object} [out] reused if given
 * @returns {{ level: number, tide: number, phase: number, phaseTicks: number, phaseLeft: number, cycle: number, over: boolean }}
 *   tide 0..5, phase PHASE.*, phaseLeft ticks until the phase changes, cycle 0..1 through this tide
 */
export function tideAt(seed, tick, out = {}) {
    const t = tick < 0 ? 0 : tick;
    let k = Math.floor(t / CYCLE_TICKS), c = t - k * CYCLE_TICKS;
    out.over = k >= TIDE.tides;
    if (out.over) { k = TIDE.tides - 1; c = CYCLE_TICKS - 1; }
    let phase = 3;
    while (phase > 0 && c < PHASE_START[phase]) phase--;
    const into = c - PHASE_START[phase], s = into / PHASE_TICKS[phase];
    const high = TIDE.high, low = lowOf(seed, k);
    let level;
    if (phase === 0) level = high + (low - high) * smooth(s);
    else if (phase === 1) level = low + TIDE.swell * dsin((into / PHASE_TICKS[1]) * TAU);
    else if (phase === 2) { const f = 1 - (1 - s) * (1 - s); level = low + (high - low) * (0.35 * smooth(s) + 0.65 * f); }
    else level = high;
    out.level = level;
    out.tide = k;
    out.phase = phase;
    out.phaseTicks = into;
    out.phaseLeft = PHASE_TICKS[phase] - into;
    out.cycle = c / CYCLE_TICKS;
    return out;
}

/** Just the water height at a tick. */
const scratch = {};
export const waterAt = (seed, tick) => tideAt(seed, tick, scratch).level;

/** Seconds left in the whole match at a tick. */
export const matchLeft = (tick) => Math.max(0, (MATCH_TICKS - tick) / TICK_RATE);
