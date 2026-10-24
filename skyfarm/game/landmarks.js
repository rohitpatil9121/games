/**
 * SKYFARM: every island's landmark (GDD §5: one per island, readable as a silhouette from a kilometre), as
 * plain shape descriptors. One source of truth: the simulation takes the solid ones as collision boxes
 * (islands.js makeWorld), the renderer turns all of them into geometry (gfx/landmarks.js). Pure, no engine.
 *
 * A descriptor: { type: "box" | "cyl" | "cone" | "ball", at: [x, y, z] (the shape's middle), size,
 * rot: [x, y, z] radians, kind: surface (props.js KIND), color?, solid? }
 *   box   size [w, d, h]          cyl  size [rTop, rBottom, h]
 *   cone  size [r, h]             ball size [rx, ry, rz]
 * Solids are boxed conservatively (their bounding box after the yaw), which is enough to walk around and
 * glide into; nothing in the game needs exact collision with a cone.
 * @module game/landmarks
 */

import { dsin, dcos, datan2 } from "./det.js";

const box = (at, w, d, h, kind, extra = {}) => ({ type: "box", at, size: [w, d, h], rot: [0, 0, extra.yaw || 0], kind, ...extra });
const cyl = (at, rt, rb, h, kind, extra = {}) => ({ type: "cyl", at, size: [rt, rb, h], rot: extra.rot || [0, 0, 0], kind, ...extra });
const cone = (at, r, h, kind, extra = {}) => ({ type: "cone", at, size: [r, h], rot: extra.rot || [0, 0, 0], kind, ...extra });
const ball = (at, rx, ry, rz, kind, extra = {}) => ({ type: "ball", at, size: [rx, ry, rz], rot: extra.rot || [0, 0, 0], kind, ...extra });

/** a small seeded generator from the island's seed (no Math.random) */
function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * The landmark of an island.
 * @param {object} isl the island (data plus prepare())
 * @param {(x: number, y: number) => number} ground the island's top height
 * @returns {object[]} descriptors
 */
export function landmarkShapes(isl, ground) {
    const L = isl.landmark, x = L.x, y = L.y, z = ground(x, y), r = seeded(isl.seed * 31 + 7), out = [];
    const S = { solid: true };
    switch (L.kind) {
        case "windmill-small": break; // Hearth Isle's is part of the home props (gfx/props.js)
        case "stones": {
            for (let k = 0; k < L.n; k++) {
                const a = (k / L.n) * Math.PI * 2 + 0.3, sx = x + dcos(a) * L.r, sy = y + dsin(a) * L.r, h = 2.2 + (k % 3) * 0.5;
                out.push(box([sx, sy, ground(sx, sy) + h / 2 - 1], 0.9, 0.7, h + 2, "stone", { ...S, yaw: a }));
            }
            out.push(box([x + L.r * 0.55, y + L.r * 0.2, z + 3.4], 3.4, 0.7, 0.6, "stone", { yaw: 0.3 + 0.9 }));
            break;
        }
        case "waterfall": {
            // a rocky lip where the pond spills over the rim (the water itself is drawn by gfx/water.js)
            const a = L.angle, ex = dcos(a), ey = dsin(a);
            for (const side of [-1, 1]) {
                const px = x + ex * 4 - ey * side * 3.4, py = y + ey * 4 + ex * side * 3.4;
                out.push(ball([px, py, ground(px, py) + 0.8], 1.6, 1.3, 1.4, "stone", S));
            }
            out.push(ball([x - ex * 7 - ey * 6, y - ey * 7 + ex * 6, z + 0.5], 1.2, 1.0, 1.0, "stone", S));
            break;
        }
        case "arch": {
            // a natural stone arch: two leaning legs and a rounded span you can walk across the top of
            for (const side of [-1, 1]) {
                out.push(box([x + side * 4.2, y, z + 3.6], 2.2, 2.6, 7.4, "stone", { ...S, rot: [0, side * -0.12, 0] }));
            }
            out.push(box([x, y, z + 7.8], 11.5, 2.6, 1.8, "stone", S));
            out.push(ball([x, y, z + 8.5], 4.2, 1.5, 0.9, "stone"));
            break;
        }
        case "bell": {
            // a crag with a timber frame and a bronze bell on top
            out.push(cone([x, y, z + 3.2], 4.2, 6.4, "stone", S));
            for (const side of [-1, 1]) out.push(box([x + side * 1.1, y, z + 7.6], 0.22, 0.22, 2.6, "timber", { solid: false }));
            out.push(box([x, y, z + 8.9], 2.6, 0.26, 0.26, "timber"));
            out.push(cyl([x, y, z + 8.0], 0.35, 0.62, 1.1, "dark", { color: [0.62, 0.45, 0.22] }));
            break;
        }
        case "log": {
            // a giant hollow log lying across the island: walls and a roof you can walk under (and on)
            const yaw = r() * Math.PI, c = dcos(yaw), s = dsin(yaw);
            out.push(cyl([x, y, z + 2.4], 2.8, 2.8, 16, "timber", { rot: [Math.PI / 2, 0, yaw + Math.PI / 2], color: [0.45, 0.32, 0.22], open: true }));
            for (const side of [-1, 1]) out.push(box([x - s * side * 2.4, y + c * side * 2.4, z + 2.2], 0.6, 16, 4.4, "timber", { solid: true, yaw, invisible: true }));
            out.push(box([x, y, z + 4.9], 4.2, 16, 0.4, "timber", { solid: true, yaw, invisible: true }));
            break;
        }
        case "windmill": {
            // the Meadow gate: a tall tapering tower, a cap, four long sails (stopped until restored, stage 5)
            out.push(cyl([x, y, z + 6], 2.4, 3.6, 12, "plaster", S));
            out.push(cone([x, y, z + 13.4], 3.4, 3.2, "tile"));
            out.push(box([x, y, z + 0.4], 7.6, 7.6, 0.8, "stone", S));
            const hub = [x + 2.9, y - 2.9, z + 11.3];
            out.push(cyl(hub, 0.35, 0.35, 1.1, "timber", { rot: [Math.PI / 2, 0, -Math.PI / 4] }));
            for (let k = 0; k < 4; k++) {
                const a = k * (Math.PI / 2) + 0.4, dx = dcos(a) * 4.6, dz = dsin(a) * 4.6;
                out.push(box([hub[0] + 0.6 + dx * 0.71, hub[1] - 0.6 + dx * 0.71, hub[2] + dz], 0.2, 1.7, 9, "cloth", { rot: [-a + Math.PI / 2, 0, -Math.PI / 4 + Math.PI / 2], sail: k }));
            }
            break;
        }
        case "big-tree": break; // a big apple tree: drawn by gfx/tree.js from isl.landmark (and its trunk is a solid below)
        case "giant-tree": break;
        case "dock": {
            // a timber tower with a lantern, and a pier sticking out over the edge where the airship ties up
            out.push(box([x, y, z + 7], 3.2, 3.2, 14, "timber", S));
            out.push(box([x, y, z + 14.6], 4.4, 4.4, 1.2, "timber", S));
            out.push(cone([x, y, z + 16.6], 3.2, 2.8, "tile"));
            out.push(ball([x, y, z + 15.6], 0.5, 0.5, 0.6, "cloth", { color: [2.2, 1.7, 0.9], glow: true }));
            const a = datan2(y - isl.y, x - isl.x), ex = dcos(a), ey = dsin(a), L2 = isl.radius - Math.hypot(x - isl.x, y - isl.y) + 10;
            out.push(box([x + ex * L2 / 2, y + ey * L2 / 2, z + 0.15], L2, 3, 0.3, "timber", { ...S, yaw: a }));
            for (let k = 1; k < 5; k++) out.push(box([x + ex * L2 * k / 5, y + ey * L2 * k / 5, z - 1.2], 0.3, 0.3, 2.6, "timber", { yaw: a }));
            break;
        }
        case "kites": {
            // tall poles on the windward cliff with kites flying from them (the kites move in gfx)
            for (let k = 0; k < 4; k++) {
                const a = k * 1.3 + r(), px = x + dcos(a) * 5, py = y + dsin(a) * 5, h = 7 + r() * 3;
                out.push(cyl([px, py, ground(px, py) + h / 2], 0.12, 0.16, h, "timber", S));
                out.push(box([px + 2.5, py, ground(px, py) + h + 1.8], 1.8, 0.05, 1.8, "cloth", { color: [[0.86, 0.34, 0.26], [0.95, 0.8, 0.3], [0.35, 0.55, 0.8], [0.95, 0.95, 0.9]][k], rot: [0, 0.7, 0.785], kite: k }));
            }
            break;
        }
        case "chapel": {
            // a ruined chapel: three broken walls, a gable, an arched doorway
            out.push(box([x, y - 3.4, z + 2.5], 9, 0.7, 5, "stone", S));
            out.push(box([x - 4.4, y, z + 2], 0.7, 7.5, 4, "stone", S));
            out.push(box([x + 4.4, y + 1.5, z + 1.4], 0.7, 4.5, 2.8, "stone", S));
            out.push(box([x, y - 3.4, z + 6.4], 4, 0.7, 2.4, "stone", { yaw: 0, rot: [0, 0.785, 0] }));
            out.push(box([x, y + 3.4, z + 0.9], 3, 0.7, 1.8, "stone", S));
            break;
        }
        case "broken-arch": {
            // two pillars that once held a bridge, one with half a span still on it
            for (const side of [-1, 1]) out.push(box([x + side * 3.5, y, z + 4.5], 1.8, 1.8, 9, "stone", S));
            out.push(box([x - 1.3, y, z + 9.4], 6.5, 1.8, 1.2, "stone", { ...S, rot: [0, 0.12, 0] }));
            break;
        }
        case "hive": {
            // a tower of stacked straw skeps, fat at the bottom, with a little roof
            for (let k = 0; k < 6; k++) out.push(ball([x, y, z + 1.4 + k * 2.1], 2.6 - k * 0.25, 2.6 - k * 0.25, 1.3, "cloth", { color: [0.88, 0.72, 0.38], solid: k < 2 }));
            out.push(cone([x, y, z + 14.6], 2.2, 2.4, "tile"));
            break;
        }
        case "bell-tower": {
            // the Orchard gate: a stone tower with an open belfry and a water wheel on its side
            out.push(box([x, y, z + 7.5], 4.2, 4.2, 15, "stone", S));
            for (const [ox, oy] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) out.push(box([x + ox, y + oy, z + 16.8], 0.6, 0.6, 3.6, "stone"));
            out.push(cone([x, y, z + 20.2], 3.6, 3.4, "tile"));
            out.push(cyl([x, y, z + 16.6], 0.5, 0.85, 1.3, "dark", { color: [0.62, 0.45, 0.22] }));
            out.push(cyl([x + 2.6, y, z + 3.5], 3, 3, 0.6, "timber", { rot: [0, Math.PI / 2, 0], wheel: true }));
            break;
        }
        case "crystals": {
            for (let k = 0; k < 9; k++) {
                const a = r() * Math.PI * 2, d = r() * 5, px = x + dcos(a) * d, py = y + dsin(a) * d, h = 2 + r() * 5;
                out.push(cone([px, py, ground(px, py) + h / 2], 0.5 + r() * 0.6, h, "cloth", { color: [0.7, 0.9, 1.15], rot: [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5, r() * 6], solid: h > 4, glow: true }));
            }
            break;
        }
        case "needle": {
            // a stone needle with a big nest on top
            out.push(cyl([x, y, z + 9], 1.2, 2.6, 18, "stone", S));
            out.push(cyl([x, y, z + 18.6], 2.6, 1.5, 1.4, "timber", { color: [0.55, 0.42, 0.28] }));
            break;
        }
        case "crater": {
            // a ring of raised rocks round the lake (the lake is drawn by gfx/water.js)
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * Math.PI * 2 + r() * 0.3, d = 11 + r() * 2, px = x + dcos(a) * d, py = y + dsin(a) * d;
                out.push(ball([px, py, ground(px, py) + 0.6], 1.6 + r(), 1.4 + r(), 1.2 + r() * 0.8, "stone", S));
            }
            break;
        }
        case "spires": {
            for (let k = 0; k < 6; k++) {
                const a = r() * Math.PI * 2, d = 2 + r() * 7, px = x + dcos(a) * d, py = y + dsin(a) * d, h = 8 + r() * 12;
                out.push(cone([px, py, ground(px, py) + h / 2 - 0.5], 1.4 + r() * 1.2, h, "stone", { ...S, rot: [(r() - 0.5) * 0.25, (r() - 0.5) * 0.25, 0] }));
            }
            break;
        }
        case "dome": {
            // an old observatory: a round wall, a dome with a slit, a lantern
            out.push(cyl([x, y, z + 2.5], 5, 5, 5, "stone", S));
            out.push(ball([x, y, z + 5], 5.2, 5.2, 4.2, "tile", { color: [0.55, 0.62, 0.7] }));
            out.push(box([x + 2.2, y, z + 7.2], 2.2, 1, 3, "dark"));
            out.push(ball([x + 5.2, y, z + 3.4], 0.4, 0.4, 0.5, "cloth", { color: [2.2, 1.7, 0.9], glow: true }));
            break;
        }
    }
    // tree trunks are solid too (the trees themselves are drawn by gfx/tree.js)
    for (const t of isl.trees || []) out.push(box([t.x, t.y, ground(t.x, t.y) + 2], 0.9 * t.height / 12, 0.9 * t.height / 12, 4, "timber", { solid: true, invisible: true }));
    if (L.kind === "big-tree" || L.kind === "giant-tree") {
        const big = L.kind === "giant-tree" ? 3.6 : 1.6;
        out.push(box([x, y, z + 3], big, big, 6, "timber", { solid: true, invisible: true }));
    }
    return out;
}

/** a conservative axis-aligned box for a solid descriptor */
export function shapeBox(s) {
    let hx, hy, hz;
    if (s.type === "box") { hx = s.size[0] / 2; hy = s.size[1] / 2; hz = s.size[2] / 2; }
    else if (s.type === "cyl") { const rr = Math.max(s.size[0], s.size[1]); hx = hy = rr; hz = s.size[2] / 2; }
    else if (s.type === "cone") { hx = hy = s.size[0]; hz = s.size[1] / 2; }
    else { hx = s.size[0]; hy = s.size[1]; hz = s.size[2]; }
    // a yaw widens the box to cover the turned shape; tilts (cyl lying down) swap height into width
    const yaw = s.rot[2], c = Math.abs(dcos(yaw)), sn = Math.abs(dsin(yaw));
    let wx = hx * c + hy * sn, wy = hx * sn + hy * c;
    if (Math.abs(s.rot[0]) > 0.7 || Math.abs(s.rot[1]) > 0.7) { const m = Math.max(wx, wy, hz); wx = wy = m; hz = Math.max(hx, hy); }
    return { x0: s.at[0] - wx, y0: s.at[1] - wy, z0: s.at[2] - hz, x1: s.at[0] + wx, y1: s.at[1] + wy, z1: s.at[2] + hz };
}
