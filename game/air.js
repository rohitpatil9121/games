import { AIR } from "./data.js";
import { dsin, dcos, hash3, smooth, clamp, TAU } from "./det.js";

/**
 * PAPER PLANES: the air field. The wind at any point is a pure function of the room, the seed and the time,
 * so the server, every client and the tools agree on it without sending a byte (as TIDEFALL's tide).
 *
 * Only + − × ÷, sqrt and det.js's dsin are used, so every engine gets the same bits.
 *
 * Sources (room.air):
 *   fan      a cone from `at` along yaw/pitch, `half` half-angle, `reach` long, `speed` on the axis at the
 *            grille; falls off with distance and toward the cone's edge; `sweep` radians each way over
 *            `period` seconds. Behind the grille the air churns (more turbulence).
 *   thermal  a rising column at `at` (x, y), `radius` wide, from `bottom` to `top`; `rise` at the bottom
 *            easing to `riseTop` at the top, fading out over the last 0.3 m.
 *   vent     a falling column: `at` (x, y), `radius`, from `top` down to `bottom`, `speed` downward.
 *   gust     a box (`min`, `max`) the window blows into, along `dir` (unit, horizontal) at `speed`; one gust
 *            per `slot` seconds, starting at a seeded moment in its first `jitter` s, lasting `length`.
 *
 * `sample()` writes into `out` (no allocation) and also reports how strong the strongest source is there, so
 * the HUD and the effects can tell "in the fan" from "in a thermal".
 * @module game/air
 */

/**
 * wind out: x, y, z (m/s) from the sources, tx, ty, tz the turbulence on top (kept apart so a fold's thermal
 * factor doesn't turn random gusts into lift); `churn` multiplies the turbulence; `fan`, `lift`, `gust` are
 * the strongest of each kind (0..1)
 */
export function makeAir() { return { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, churn: 1, fan: 0, lift: 0, gust: 0 }; }

/** The fan's axis at time t: unit vector, written into `axis`. */
export function fanAxis(src, t, axis) {
    const yaw = src.yaw + (src.sweep ? src.sweep * dsin((TAU * t) / src.period) : 0);
    const cp = dcos(src.pitch);
    axis[0] = cp * dcos(yaw); axis[1] = cp * dsin(yaw); axis[2] = dsin(src.pitch);
    return axis;
}

/**
 * When the gust in a given slot starts (seconds), from the seed: somewhere in the first `jitter` seconds of
 * its slot, so gusts are `slot - jitter` to `slot + jitter` seconds apart.
 * @param {object} src a gust source
 * @param {number} seed
 * @param {number} slot index
 */
export function gustStart(src, seed, slot) {
    return slot * src.slot + hash3(seed, slot, 7919) * src.jitter;
}

/** 0..1: how strong a gust source blows at time t (eased in and out over half a second). */
export function gustPower(src, seed, t) {
    const slot = Math.floor(t / src.slot), s = gustStart(src, seed, slot), u = t - s;
    if (u < 0 || u > src.length) return 0;
    return smooth(clamp(u / 0.5, 0, 1)) * smooth(clamp((src.length - u) / 0.5, 0, 1));
}
/** seconds until the next gust starts (negative while one blows), for the curtain telegraph */
export function gustIn(src, seed, t) {
    const slot = Math.floor(t / src.slot);
    let s = gustStart(src, seed, slot);
    if (t > s + src.length) s = gustStart(src, seed, slot + 1);
    return s - t;
}

/** 3D value noise in [-1, 1] on a unit lattice (8 hashes, smooth weights). */
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

const _axis = [0, 0, 0];

/**
 * The wind at (x, y, z) at time t.
 * @param {object} room
 * @param {number} seed
 * @param {number} t seconds since the round began
 * @param {ReturnType<typeof makeAir>} out
 */
export function sample(room, seed, t, x, y, z, out) {
    let wx = 0, wy = 0, wz = 0, churn = 1, fan = 0, lift = 0, gust = 0;
    const srcs = room.air;
    for (let i = 0; i < srcs.length; i++) {
        const s = srcs[i];
        if (s.kind === "fan") {
            const a = fanAxis(s, t, _axis);
            const dx = x - s.at[0], dy = y - s.at[1], dz = z - s.at[2];
            const along = dx * a[0] + dy * a[1] + dz * a[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (along < 0) {
                // behind the fan: it pulls air in gently and churns it
                if (d2 < 0.36) { const k = 1 - Math.sqrt(d2) / 0.6; wx += a[0] * 0.4 * k; wy += a[1] * 0.4 * k; wz += a[2] * 0.4 * k; churn += AIR.fanChurn * k; }
                continue;
            }
            if (along > s.reach) continue;
            const side = Math.sqrt(Math.max(0, d2 - along * along));
            // the cone widens with distance; the grille is 0.12 m across, so it starts that wide
            const width = 0.12 + along * s.half;
            if (side > width * 1.35) continue;
            const edge = 1 - smooth(clamp((side - width * 0.55) / (width * 0.8), 0, 1));
            const fall = 1 - smooth(along / s.reach);
            // fans throw the air in a jet: strongest a little in front of the grille
            const ramp = clamp(along / 0.15, 0.4, 1);
            const v = s.speed * edge * fall * ramp;
            if (v <= 0) continue;
            // the jet spreads a little away from its axis as it goes
            const sx = side > 1e-6 ? (dx - a[0] * along) / side : 0, sy = side > 1e-6 ? (dy - a[1] * along) / side : 0, sz = side > 1e-6 ? (dz - a[2] * along) / side : 0;
            wx += (a[0] + sx * 0.15) * v; wy += (a[1] + sy * 0.15) * v; wz += (a[2] + sz * 0.15) * v;
            churn += 1.2 * edge * fall * (1 - edge);
            if (v / s.speed > fan) fan = v / s.speed;
        } else if (s.kind === "thermal") {
            if (z < s.bottom - 0.15 || z > s.top) continue;
            const dx = x - s.at[0], dy = y - s.at[1], r = Math.sqrt(dx * dx + dy * dy);
            if (r > s.radius * 1.4) continue;
            const core = 1 - smooth(clamp((r - s.radius * 0.5) / (s.radius * 0.9), 0, 1));
            const h = clamp((z - s.bottom) / (s.top - s.bottom), 0, 1);
            const base = smooth(clamp((z - s.bottom + 0.15) / 0.3, 0, 1));
            const cap = smooth(clamp((s.top - z) / 0.3, 0, 1));
            const v = (s.rise + (s.riseTop - s.rise) * h) * core * base * cap;
            wz += v;
            // warm air draws in at the bottom and spills out at the top
            if (r > 1e-6) { const inward = (h < 0.3 ? -0.18 : h > 0.8 ? 0.15 : 0) * core; wx += (dx / r) * inward; wy += (dy / r) * inward; }
            if (v / s.rise > lift) lift = v / s.rise;
        } else if (s.kind === "vent") {
            if (z < s.bottom || z > s.top) continue;
            const dx = x - s.at[0], dy = y - s.at[1], r = Math.sqrt(dx * dx + dy * dy);
            if (r > s.radius * 1.4) continue;
            const core = 1 - smooth(clamp((r - s.radius * 0.5) / (s.radius * 0.9), 0, 1));
            const v = s.speed * core * smooth(clamp((z - s.bottom) / 0.5, 0, 1));
            wz -= v;
            // the column spreads out as it nears the floor
            if (r > 1e-6 && z < s.bottom + 0.6) { wx += (dx / r) * v * 0.4; wy += (dy / r) * v * 0.4; }
        } else if (s.kind === "gust") {
            const p = gustPower(s, seed, t);
            if (p <= 0) continue;
            if (x < s.min[0] || y < s.min[1] || z < s.min[2] || x > s.max[0] || y > s.max[1] || z > s.max[2]) continue;
            // fade toward the far end and the sides of the box
            const k = p * s.speed * soft(x, s.min[0], s.max[0]) * soft(y, s.min[1], s.max[1]) * soft(z, s.min[2], s.max[2]);
            wx += s.dir[0] * k; wy += s.dir[1] * k; wz += (s.dir[2] || 0) * k;
            churn += p;
            if (p > gust) gust = p;
        }
    }
    // turbulence everywhere, drifting slowly so the same spot changes
    const sc = 1 / AIR.turbulenceScale, drift = t * AIR.turbulenceDrift * sc, amp = AIR.turbulence * churn;
    const nx = x * sc + drift, ny = y * sc, nz = z * sc;
    out.tx = noise(nx, ny, nz, 0) * amp;
    out.ty = noise(nx, ny, nz, 1013) * amp;
    out.tz = noise(nx, ny, nz, 2029) * amp * 0.6;
    out.x = wx; out.y = wy; out.z = wz; out.churn = churn; out.fan = fan; out.lift = lift; out.gust = gust;
    return out;
}

/** 1 inside a range, easing to 0 over its outer 20% */
function soft(v, a, b) {
    const m = (b - a) * 0.2;
    return smooth(clamp((v - a) / m, 0, 1)) * smooth(clamp((b - v) / m, 0, 1));
}
