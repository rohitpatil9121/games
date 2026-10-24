import { Geometry, primitives } from "../../engine/index.js";
import { part } from "./props.js";
import { onBridge } from "../progression.js";

/**
 * SKYFARM: the rope bridges (GDD §5), drawn from the same deck the simulation walks on (progression.js
 * onBridge: the straight line between the anchors with a little sag).
 *
 * A built bridge: planks across the deck every 0.55 m (each a little turned and offset, so it's hand-laid), two
 * hand ropes a metre up that sag with the deck, thin uprights tying them down every 1.6 m, and a pair of stout
 * posts at each end. Its index buffer holds the posts and ropes first, then the planks in order from the first
 * anchor, so while it's being built drawing a prefix shows the ropes strung and the planks laid one by one.
 *
 * A broken bridge (environmental storytelling: "broken bridge ropes hanging into the clouds"): the end posts and,
 * from each, a few planks and two ropes hanging straight down off the rim.
 * @module game/gfx/bridges
 */

const WOOD = [0.5, 0.36, 0.24], WOOD2 = [0.42, 0.3, 0.2], ROPE = [0.8, 0.72, 0.52];

function seeded(s) { return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** the built bridge: geometry and how many indices are posts and ropes (always drawn) */
export function bridgeGeometry(b) {
    const [a, c] = b.ends, dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, yaw = Math.atan2(uy, ux);
    const rand = seeded(b.length * 1000 | 0), frame = [], planks = [];
    const at = (t, side, up) => { const x = a[0] + dx * t - uy * side, y = a[1] + dy * t + ux * side; return [x, y, onBridge(b, a[0] + dx * t, a[1] + dy * t).z + up]; };
    // end posts
    for (const t of [0, 1]) for (const side of [-1.05, 1.05]) { const p = at(t, side, 0.6); frame.push(part(primitives.box(0.22, 0.22, 2.0), [p[0], p[1], p[2] - 0.3], "timber", [0, 0, yaw], [1, 1, 1], WOOD2)); }
    // hand ropes and uprights, segment by segment
    const N = Math.max(8, Math.round(L / 1.6));
    for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N;
        for (const side of [-0.95, 0.95]) {
            const p = at(t0, side, 1.0), q = at(t1, side, 1.0), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, mz = (p[2] + q[2]) / 2;
            const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), pitch = Math.atan2(q[2] - p[2], Math.hypot(q[0] - p[0], q[1] - p[1]));
            frame.push(part(primitives.box(len, 0.05, 0.05), [mx, my, mz], "cloth", [0, -pitch, yaw], [1, 1, 1], ROPE));
            if (k > 0) frame.push(part(primitives.box(0.03, 0.03, 1.0), [p[0], p[1], p[2] - 0.5], "cloth", [0, 0, 0], [1, 1, 1], ROPE));
        }
    }
    // planks, from the first anchor to the second
    const M = Math.round(L / 0.55);
    for (let k = 0; k < M; k++) {
        const t = (k + 0.5) / M, p = at(t, 0, -0.03), pitch = Math.atan2(at(Math.min(1, t + 0.01), 0, 0)[2] - at(Math.max(0, t - 0.01), 0, 0)[2], L * 0.02);
        planks.push(part(primitives.box(0.42, 1.8 + rand() * 0.15, 0.07), [p[0] + ux * (rand() - 0.5) * 0.05, p[1] + uy * (rand() - 0.5) * 0.05, p[2]], "timber", [0, -pitch, yaw + (rand() - 0.5) * 0.06], [1, 1, 1], rand() < 0.3 ? WOOD2 : WOOD));
    }
    const g = Geometry.merge([...frame, ...planks], { uvs: false });
    const frameIndices = frame.reduce((n, p) => n + p.geometry.indices.length, 0);
    return { geometry: g, frameIndices, total: g.indices.length, middle: at(0.5, 0, 0), radius: L / 2 + 4 };
}

/** the broken bridge: posts, and planks and ropes hanging off each rim */
export function brokenGeometry(b) {
    const [a, c] = b.ends, dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, yaw = Math.atan2(uy, ux);
    const rand = seeded(b.length * 777 | 0), parts = [];
    for (const [e, dir] of [[a, 1], [c, -1]]) {
        for (const side of [-1.05, 1.05]) parts.push(part(primitives.box(0.22, 0.22, 2.0), [e[0] - uy * side, e[1] + ux * side, e[2] + 0.3], "timber", [0, 0, yaw], [1, 1, 1], WOOD2));
        // the last planks still tied on, then the rest hanging down
        const lip = [e[0] + ux * dir * 1.4, e[1] + uy * dir * 1.4];
        for (let k = 0; k < 2; k++) parts.push(part(primitives.box(0.42, 1.8, 0.07), [e[0] + ux * dir * (0.4 + k * 0.55), e[1] + uy * dir * (0.4 + k * 0.55), e[2] - 0.03], "timber", [0, 0, yaw], [1, 1, 1], WOOD));
        for (const side of [-0.95, 0.95]) {
            const hang = 5 + rand() * 6;
            parts.push(part(primitives.box(0.05, 0.05, hang), [lip[0] - uy * side, lip[1] + ux * side, e[2] - hang / 2 + 0.6], "cloth", [0.06 * side, 0, 0], [1, 1, 1], ROPE));
        }
        for (let k = 0; k < 4; k++) {
            const z = e[2] - 1 - k * 0.65 - rand() * 0.2;
            parts.push(part(primitives.box(0.42, 1.7, 0.07), [lip[0] + (rand() - 0.5) * 0.1, lip[1] + (rand() - 0.5) * 0.1, z], "timber", [Math.PI / 2 + (rand() - 0.5) * 0.4, 0, yaw + (rand() - 0.5) * 0.3], [1, 1, 1], WOOD));
        }
    }
    return Geometry.merge(parts, { uvs: false });
}
