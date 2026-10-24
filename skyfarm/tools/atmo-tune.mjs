/**
 * SKYFARM: print the sky's colours from the atmosphere model (game/gfx/atmosphere.js) after the same exposure
 * and ACES curve the composite uses, against the palette in GDD §0. For tuning the coefficients in Node.
 *
 *   node tools/atmo-tune.mjs [exposure]
 */
import { skyAt, sunLight } from "../game/gfx/atmosphere.js";

const exposure = Number(process.argv[2] || 1);
const aces = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const hex = (c) => "#" + c.map((v) => Math.round(aces(v * exposure) * 255).toString(16).padStart(2, "0")).join("");
const norm = (v) => { const m = Math.hypot(...v); return v.map((x) => x / m); };

for (const [name, sz] of [["noon", 0.8], ["afternoon", 0.45], ["golden", 0.12], ["sunset", 0.02]]) {
    const s = norm([Math.sqrt(1 - sz * sz), -0.2, sz]);
    const row = [];
    for (const el of [0.0, 0.05, 0.15, 0.35, 0.7, 1.0]) {
        // looking away from the sun (the side the art direction's gradient describes) and toward it
        const away = norm([-s[0], -s[1] * 0, el]), toward = norm([s[0], s[1], el]);
        row.push(`${el.toFixed(2)}: ${hex(skyAt(60, away, s))} / ${hex(skyAt(60, toward, s))}`);
    }
    const E = sunLight(60, sz);
    console.log(`${name.padEnd(9)} sun ${E.map((v) => v.toFixed(2)).join(",")}  ` + row.join("  "));
}
console.log("target: horizon #e8f6ff, high sky #9fd4f2");
