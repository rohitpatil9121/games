import { Texture } from "../../engine/index.js";

/**
 * SKYFARM: the Ghibli grade (the `threejs-exposure-color-grading` skill: exposure → one tone map → creative
 * grade as a 32-cube LUT → output). The LUT is display-referred in and out (it runs after the ACES curve in the
 * composite, engine PostFX `lut`), generated here from a few named moves so it can be read and tuned rather
 * than painted:
 *
 *   lift      shadows lean cool blue-green, never black (painted shadows are coloured)
 *   warm      highlights lean warm yellow (afternoon sun on paper)
 *   vivid     mid-saturation colours gain saturation, already-saturated ones gain almost none ("saturated
 *             but never neon", GDD §0)
 *   curve     a soft S around mid grey
 *
 * `strength` scales all four; 0 is the identity. Diagnostics: `gradeColor()` runs the same function on one
 * colour, so tools can print what the grade does to the palette.
 * @module game/gfx/grade
 */

export const GRADE = Object.freeze({
    lift: [0.035, 0.055, 0.075],
    warm: [0.04, 0.02, -0.035],
    vivid: 0.32,
    curve: 0.12,
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** the grade on one display-referred colour (0..1 rgb) */
export function gradeColor(r, g, b, strength = 1, out = [0, 0, 0]) {
    const G = GRADE, k = strength;
    // lift and warm
    const sh = (1 - Math.max(r, g, b)) ** 3, hi = ((r + g + b) / 3) ** 4;
    r += (G.lift[0] * sh + G.warm[0] * hi) * k;
    g += (G.lift[1] * sh + G.warm[1] * hi) * k;
    b += (G.lift[2] * sh + G.warm[2] * hi) * k;
    // vivid: saturation by distance from the luma, boosted most in the middle of the range
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 1e-5 ? (mx - mn) / mx : 0;
    const boost = 1 + G.vivid * k * (1 - sat) * 1.6 * Math.min(1, sat * 3);
    r = l + (r - l) * boost; g = l + (g - l) * boost; b = l + (b - l) * boost;
    // soft S around mid grey
    const s = (v) => { v = clamp01(v); const c = v - 0.5; return clamp01(v + G.curve * k * c * (1 - 4 * c * c) * 2); };
    out[0] = s(r); out[1] = s(g); out[2] = s(b);
    return out;
}

/** The 32-cube LUT as a 1024 × 32 RGBA texture (32 slices along x, blue picks the slice). */
export function makeGradeLut(strength = 1) {
    const N = 32, data = new Uint8Array(N * N * N * 4), c = [0, 0, 0];
    for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
        gradeColor(ri / (N - 1), gi / (N - 1), bi / (N - 1), strength, c);
        const o = (gi * N * N + bi * N + ri) * 4;
        data[o] = Math.round(c[0] * 255); data[o + 1] = Math.round(c[1] * 255); data[o + 2] = Math.round(c[2] * 255); data[o + 3] = 255;
    }
    return new Texture({ data, width: N * N, height: N, wrap: "clamp", filter: "linear", mipmaps: false, name: "ghibli-grade" });
}
