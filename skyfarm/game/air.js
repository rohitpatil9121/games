import { hash3, smooth, clamp } from "./det.js";

/**
 * SKYFARM: the air field. Adapted from PAPER PLANES' game/air.js (its thermal and its turbulence lattice are
 * the same code at world scale); the fan, vent and window gust are gone and a wind current is new.
 *
 * The wind at any point is a pure function of the world and the time, so the simulation, the effects and the
 * tools agree on it. Only + − × ÷ and sqrt.
 *
 * Sources (world.data.air):
 *   thermal  a rising column at `at` (x, y), `radius` wide, from `bottom` to `top`; `rise` m/s at the bottom
 *            easing to `riseTop` at the top, fading over the last 8 m. Warm air draws in low and spills high.
 *   current  a tube of moving air from `from` to `to` (x, y, z), `radius` thick, `speed` m/s along it at the
 *            core, fading over the outer half and the last 15% of each end. It carries a glider along.
 *
 * `sample()` writes into `out` (no allocation) and says how strong the strongest lift and current are there,
 * so the effects can show where you are.
 * @module game/air
 */

/** wind: x, y, z from the sources, tx, ty, tz the turbulence; `lift`, `current` 0..1 */
export function makeAir() { return { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, lift: 0, current: 0 }; }

/** gentle turbulence everywhere: amplitude (m/s), lattice size (m), drift (m/s) */
const TURB = { amp: 0.35, scale: 9, drift: 1.2 };

function noise(x, y, z, salt) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = smooth(x - xi), fy = smooth(y - yi), fz = smooth(z - zi);
    const h = (a, b, c) => hash3(a + salt, b, c);
    const x00 = h(xi, yi, zi) + (h(xi + 1, yi, zi) - h(xi, yi, zi)) * fx;
    const x10 = h(xi, yi + 1, zi) + (h(xi + 1, yi + 1, zi) - h(xi, yi + 1, zi)) * fx;
    const x01 = h(xi, yi, zi + 1) + (h(xi + 1, yi, zi + 1) - h(xi, yi, zi + 1)) * fx;
    const x11 = h(xi, yi + 1, zi + 1) + (h(xi + 1, yi + 1, zi + 1) - h(xi, yi + 1, zi + 1)) * fx;
    const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
    return (y0 + (y1 - y0) * fz) * 2 - 1;
}

/**
 * The wind at (x, y, z) at time t (seconds).
 * @param {object[]} sources
 * @param {number} t
 * @param {ReturnType<typeof makeAir>} out
 */
export function sample(sources, t, x, y, z, out) {
    let wx = 0, wy = 0, wz = 0, lift = 0, current = 0;
    for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (s.kind === "thermal") {
            if (z < s.bottom - 4 || z > s.top) continue;
            const dx = x - s.at[0], dy = y - s.at[1], r = Math.sqrt(dx * dx + dy * dy);
            if (r > s.radius * 1.4) continue;
            const core = 1 - smooth(clamp((r - s.radius * 0.5) / (s.radius * 0.9), 0, 1));
            const h = clamp((z - s.bottom) / (s.top - s.bottom), 0, 1);
            const base = smooth(clamp((z - s.bottom + 4) / 8, 0, 1));
            const cap = smooth(clamp((s.top - z) / 8, 0, 1));
            const v = (s.rise + (s.riseTop - s.rise) * h) * core * base * cap;
            wz += v;
            if (r > 1e-6) { const inward = (h < 0.3 ? -0.5 : h > 0.8 ? 0.4 : 0) * core; wx += (dx / r) * inward; wy += (dy / r) * inward; }
            if (v / s.rise > lift) lift = v / s.rise;
        } else if (s.kind === "current") {
            const ax = s.to[0] - s.from[0], ay = s.to[1] - s.from[1], az = s.to[2] - s.from[2];
            const len2 = ax * ax + ay * ay + az * az, len = Math.sqrt(len2);
            const px = x - s.from[0], py = y - s.from[1], pz = z - s.from[2];
            const u = (px * ax + py * ay + pz * az) / len2;
            if (u < 0 || u > 1) continue;
            const cx = px - ax * u, cy = py - ay * u, cz = pz - az * u, side = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (side > s.radius) continue;
            const edge = 1 - smooth(clamp((side - s.radius * 0.5) / (s.radius * 0.5), 0, 1));
            const ends = smooth(clamp(u / 0.15, 0, 1)) * smooth(clamp((1 - u) / 0.15, 0, 1));
            const v = s.speed * edge * ends;
            wx += (ax / len) * v; wy += (ay / len) * v; wz += (az / len) * v;
            if (v / s.speed > current) current = v / s.speed;
        }
    }
    const sc = 1 / TURB.scale, drift = t * TURB.drift * sc;
    const nx = x * sc + drift, ny = y * sc, nz = z * sc;
    out.tx = noise(nx, ny, nz, 0) * TURB.amp;
    out.ty = noise(nx, ny, nz, 1013) * TURB.amp;
    out.tz = noise(nx, ny, nz, 2029) * TURB.amp * 0.6;
    out.x = wx; out.y = wy; out.z = wz; out.lift = lift; out.current = current;
    return out;
}
