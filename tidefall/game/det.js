/**
 * TIDEFALL: deterministic maths, shared by the simulation, the tide, the island generator and the tools.
 *
 * The server, every browser and Node must get the same bits from the same inputs, or prediction drifts
 * and two clients disagree about where the shore is. + − × ÷ and Math.sqrt are exact everywhere;
 * Math.sin, Math.exp and Math.pow are not (engines may round them differently), so nothing that feeds
 * the simulation uses them. dsin is a fixed polynomial instead.
 * Copied from BREACH's sim.js.
 * @module game/det
 */

export const PI = 3.141592653589793, TAU = PI * 2, HALF_PI = PI / 2;

/** sin(x) by range reduction and a fixed polynomial: the same bits in every engine (error under 1e-9). */
export function dsin(x) {
    x -= TAU * Math.floor(x / TAU + 0.5);
    if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x;
    const s = x * x;
    return x * (1 + s * (-1 / 6 + s * (1 / 120 + s * (-1 / 5040 + s * (1 / 362880 + s * (-1 / 39916800 + s * (1 / 6227020800 - s / 1307674368000)))))));
}
export const dcos = (x) => dsin(x + HALF_PI);

/** Yaw travels as 16 bits of a full turn, pitch as a signed 16 bits of a quarter turn. */
export const quantizeYaw = (radians) => Math.round((radians / TAU) * 65536) & 0xffff;
export const yawOf = (q) => (q * TAU) / 65536;
export const quantizePitch = (radians) => Math.max(-32000, Math.min(32000, Math.round((radians / HALF_PI) * 32767)));
export const pitchOf = (q) => (q * HALF_PI) / 32767;

/** mulberry32 finaliser: a 32-bit state to [0, 1). */
export function hashSeed(a) {
    let t = a >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const nextSeed = (a) => (a + 0x6d2b79f5) >>> 0;

/** A small seeded generator for one-off use (island generation). */
export function makeRandom(seed) {
    let s = seed >>> 0;
    return () => { s = nextSeed(s); return hashSeed(s); };
}

/** A hash of integers to [0, 1), for noise lattices. */
export function hash3(a, b, c) {
    return hashSeed(Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1));
}

export const smooth = (t) => t * t * (3 - 2 * t);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
