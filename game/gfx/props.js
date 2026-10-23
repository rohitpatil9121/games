import { Geometry, ShaderMaterial, primitives, mat4, quat } from "../../engine/index.js";
import { header, vertexHeader, withShared, track } from "./common.js";
import { topAt } from "../islands.js";
import { makeRandom } from "../det.js";

/**
 * SKYFARM: the hand-made props of an island (the `threejs-procedural-geometry` and
 * `threejs-procedural-architecture` skills: chunky, rounded, readable silhouettes built in code from placed
 * parts, merged into one mesh per island, each part carrying its surface kind so one material can paint them all).
 *
 * Surface kinds (vertex colour alpha): plaster, timber, roof tiles, stone, cloth, dark (glass, openings),
 * soil. The material adds what makes each one read (plaster mottling, wood grain in world units, rows of
 * rounded tiles with a lighter top edge, mortar lines and mossy tops on stone), then the painterly light and
 * the atmosphere.
 *
 * Built here: the hut (stone footing, plastered walls in a timber frame, windows with frames, an open door,
 * a deep overhanging hipped roof of red tiles with a ridge, a stone chimney), the lean-to shed and its glider
 * rack, the fence round the field, a water barrel, the little broken windmill (Hearth Isle's landmark until it
 * is restored), rocks, and a bed and table inside.
 * @module game/gfx/props
 */

export const KIND = Object.freeze({ plaster: 0.05, timber: 0.15, tile: 0.25, stone: 0.35, cloth: 0.45, dark: 0.55, soil: 0.65, ridge: 0.75, glow: 0.85 });
const COLOR = {
    plaster: [0.93, 0.88, 0.76], timber: [0.47, 0.32, 0.21], tile: [0.82, 0.34, 0.25], stone: [0.7, 0.67, 0.6], cloth: [0.92, 0.86, 0.72],
    dark: [0.12, 0.13, 0.16], soil: [0.42, 0.28, 0.18], ridge: [0.64, 0.27, 0.2],
};

/** a placed part: geometry, position, rotation (radians, xyz), scale, surface kind */
export function part(geometry, at, kind, rot = [0, 0, 0], scale = [1, 1, 1], color) {
    const m = mat4.create(), q = quat.create();
    quat.fromEuler(q, (rot[0] * 180) / Math.PI, (rot[1] * 180) / Math.PI, (rot[2] * 180) / Math.PI);
    mat4.fromRotationTranslationScale(m, q, at, scale);
    const c = color || COLOR[kind];
    return { geometry, matrix: m, color: [c[0], c[1], c[2], KIND[kind]] };
}

/** a part placed with its own axes (x, y, z unit vectors) */
function basisPart(geometry, at, x, y, z, kind, color) {
    const m = mat4.fromValues(x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, at[0], at[1], at[2], 1);
    const c = color || COLOR[kind];
    return { geometry, matrix: m, color: [c[0], c[1], c[2], KIND[kind]] };
}

/** a box from corner to corner */
const slab = (x0, y0, z0, x1, y1, z1, kind, color) => part(primitives.box(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], kind, [0, 0, 0], [1, 1, 1], color);

/**
 * A hipped roof: a ridge along the longer side, four slopes, a thick eave and a dark underside.
 * Built as triangles directly (each slope gets its own flat normal and tile uvs in metres).
 */
function hipRoof(cx, cy, z, w, d, rise, eave, thick) {
    const hw = w / 2 + eave, hd = d / 2 + eave, ridge = Math.max(0, hw - hd);
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    const c = COLOR.tile;
    const face = (pts, under) => {
        const b = pos.length / 3;
        const [a, bb, cc] = pts;
        const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
        // tile coordinates: along the eave (horizontal) and up the slope, in metres
        const hx = -ny, hy = nx, hl = Math.hypot(hx, hy) || 1;
        for (const p of pts) {
            pos.push(p[0], p[1], p[2]); nrm.push(nx, ny, nz);
            col.push(under ? COLOR.timber[0] * 0.7 : c[0], under ? COLOR.timber[1] * 0.7 : c[1], under ? COLOR.timber[2] * 0.7 : c[2], under ? KIND.timber : KIND.tile);
            uv.push((p[0] * hx + p[1] * hy) / hl, Math.hypot(p[0] - cx, p[1] - cy) * 0 + (p[2] - z) / Math.max(0.2, nz < 1 ? Math.sqrt(1 - nz * nz) * 0 + rise / Math.hypot(rise, hd) : 1));
        }
        for (let i = 1; i < pts.length - 1; i++) idx.push(b, b + i, b + i + 1);
    };
    const top = z + thick, peak = z + thick + rise;
    const A = [cx - hw, cy - hd, top], B = [cx + hw, cy - hd, top], C = [cx + hw, cy + hd, top], D = [cx - hw, cy + hd, top];
    const R0 = [cx - ridge, cy, peak], R1 = [cx + ridge, cy, peak];
    face([A, B, R1, R0]); face([C, D, R0, R1]); face([B, C, R1]); face([D, A, R0]);
    // the eave's thickness all round, and the underside
    const a = [cx - hw, cy - hd, z], b = [cx + hw, cy - hd, z], cc = [cx + hw, cy + hd, z], dd = [cx - hw, cy + hd, z];
    face([a, b, B, A]); face([b, cc, C, B]); face([cc, dd, D, C]); face([dd, a, A, D]);
    face([b, a, dd, cc], true);
    return new Geometry({ name: "roof", positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx) });
}

/** a lumpy rock */
function rock(rand, size) {
    const g = primitives.sphere(1, 12, 8), P = g.positions;
    const seed = rand() * 100;
    for (let i = 0; i < g.vertexCount; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const k = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.3) + 0.12 * Math.sin(z * 4.3 + seed * 0.7);
        P[i * 3] = x * k * size; P[i * 3 + 1] = y * k * size * (0.8 + rand() * 0.4); P[i * 3 + 2] = Math.max(-0.3, z) * k * size * 0.7;
    }
    return g;
}

/**
 * Everything built on Hearth Isle.
 * @param {object} world makeWorld() result
 */
export function hearthProps(world) {
    const d = world.data, home = world.islands[0], h = d.hut, parts = [];
    const gz = (x, y) => topAt(home, x, y);
    const z0 = gz(h.x, h.y), x0 = h.x - h.w / 2, x1 = h.x + h.w / 2, y0 = h.y - h.d / 2, y1 = h.y + h.d / 2, t = h.wall, top = z0 + h.h;
    // stone footing, a step at the door
    parts.push(slab(x0 - 0.15, y0 - 0.15, z0 - 0.6, x1 + 0.15, y1 + 0.15, z0 + 0.25, "stone"));
    parts.push(slab(x1 + 0.1, h.y - h.door / 2, z0 - 0.4, x1 + 0.75, h.y + h.door / 2, z0 + 0.12, "stone"));
    // plastered walls (the collision boxes), the door gap in the east wall
    for (const b of world.boxes) if (b.kind === "wall") parts.push(slab(b.x0, b.y0, z0 + 0.2, b.x1, b.y1, b.z1, "plaster"));
    // the timber frame: corner and middle posts, a sill and a beam under the eaves
    const post = (x, y) => parts.push(slab(x - 0.14, y - 0.14, z0 + 0.2, x + 0.14, y + 0.14, top + 0.05, "timber"));
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [h.x, y0], [h.x, y1], [x0, h.y], [x1, h.y - h.door / 2 - 0.14], [x1, h.y + h.door / 2 + 0.14]]) post(x, y);
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y0, x0, y1], [x1, y0, x1, y1]]) {
        parts.push(slab(Math.min(ax, bx) - 0.12, Math.min(ay, by) - 0.12, top - 0.28, Math.max(ax, bx) + 0.12, Math.max(ay, by) + 0.12, top, "timber"));
    }
    // windows: a dark opening, a frame, a cross bar, a sill box with flowers on the south side
    const win = (x, y, nx, ny) => {
        const along = ny !== 0, wz = z0 + 1.25;
        const W = 0.9, H = 0.8, o = 0.16;
        const at = (dx, dz) => [x + (along ? dx : 0) + nx * o, y + (along ? 0 : dx) + ny * o, wz + dz];
        parts.push(part(primitives.box(along ? W : 0.06, along ? 0.06 : W, H), at(0, 0), "dark"));
        for (const [dx, dz, w, hh] of [[0, H / 2, W + 0.2, 0.1], [0, -H / 2, W + 0.3, 0.12], [-W / 2, 0, 0.1, H], [W / 2, 0, 0.1, H], [0, 0, W, 0.05], [0, 0, 0.05, H]]) {
            parts.push(part(primitives.box(along ? w : 0.1, along ? 0.1 : w, hh), at(dx, dz), "timber"));
        }
        parts.push(part(primitives.box(along ? W : 0.3, along ? 0.3 : W, 0.22), [x + nx * 0.32, y + ny * 0.32, wz - H / 2 - 0.15], "timber"));
        for (let k = -2; k <= 2; k++) parts.push(part(primitives.sphere(0.09, 8, 6), [x + nx * 0.34 + (along ? k * 0.17 : 0), y + ny * 0.34 + (along ? 0 : k * 0.17), wz - H / 2 + 0.02], "cloth", [0, 0, 0], [1, 1, 1], [[1, 0.85, 0.3], [0.98, 0.55, 0.62], [1, 0.97, 0.9]][(k + 3) % 3]));
    };
    win(h.x - 1.4, y0, 0, -1); win(h.x + 1.3, y0, 0, -1); win(h.x, y1, 0, 1); win(x0, h.y, -1, 0);
    // the door, standing open against the inside of the wall
    parts.push(part(primitives.box(0.08, h.door - 0.1, 2.0), [x1 - 0.35, h.y + h.door / 2 - 0.02, z0 + 1.2], "timber", [0, 0, -1.35]));
    // the roof, and a chimney through it
    parts.push({ geometry: hipRoof(h.x, h.y, top - 0.05, h.w, h.d, 2.3, 0.85, 0.32), matrix: null, color: null });
    parts.push(slab(x0 + 1.0, y1 - 1.4, top - 0.3, x0 + 1.7, y1 - 0.7, top + 2.7, "stone"));
    parts.push(slab(x0 + 0.9, y1 - 1.5, top + 2.6, x0 + 1.8, y1 - 0.6, top + 2.85, "stone"));
    // inside: the stove (stone, with an iron top and a pot), against the north wall under the chimney
    const sv = d.stove, svz = gz(sv.x, sv.y);
    parts.push(slab(sv.x - 0.5, sv.y - 0.35, svz, sv.x + 0.5, sv.y + 0.35, svz + 0.85, "stone"));
    parts.push(slab(sv.x - 0.52, sv.y - 0.37, svz + 0.85, sv.x + 0.52, sv.y + 0.37, svz + 0.92, "dark", [0.2, 0.2, 0.22]));
    parts.push(part(primitives.cylinder(0.2, 0.17, 0.25, 12), [sv.x + 0.15, sv.y, svz + 1.05], "dark", [0, 0, 0], [1, 1, 1], [0.28, 0.27, 0.27]));
    parts.push(part(primitives.box(0.26, 0.16, 0.12), [sv.x - 0.2, sv.y - 0.36, svz + 0.3], "glow", [0, 0, 0], [1, 1, 1], [1.6, 0.7, 0.25]));
    // inside: the bed and the table
    const bz = gz(d.bed.x, d.bed.y);
    parts.push(slab(d.bed.x - 0.55, d.bed.y - 1.05, bz + 0.2, d.bed.x + 0.55, d.bed.y + 1.05, bz + 0.55, "timber"));
    parts.push(slab(d.bed.x - 0.5, d.bed.y - 1.0, bz + 0.55, d.bed.x + 0.5, d.bed.y + 0.95, bz + 0.72, "cloth"));
    parts.push(slab(d.bed.x - 0.42, d.bed.y + 0.55, bz + 0.72, d.bed.x + 0.42, d.bed.y + 0.95, bz + 0.85, "cloth", [0.95, 0.95, 0.92]));
    const tz = gz(-4.6, -3.4);
    parts.push(slab(-5.1, -3.75, tz + 0.82, -4.1, -3.05, tz + 0.9, "timber"));
    for (const [ox, oy] of [[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]]) parts.push(slab(-4.6 + ox - 0.04, -3.4 + oy - 0.04, tz + 0.2, -4.6 + ox + 0.04, -3.4 + oy + 0.04, tz + 0.82, "timber"));
    parts.push(slab(x0 + t, y0 + t, z0 + 0.2, x1 - t, y1 - t, z0 + 0.26, "timber", [0.58, 0.42, 0.29]));

    // the shed: four posts, a lean-to roof of tiles, a rack the glider hangs on
    const s = d.shed, sz = gz(s.x, s.y);
    for (const [ox, oy, hh] of [[-1.1, -1.1, 2.5], [1.1, -1.1, 2.5], [-1.1, 1.1, 2.1], [1.1, 1.1, 2.1]]) parts.push(slab(s.x + ox - 0.1, s.y + oy - 0.1, sz - 0.2, s.x + ox + 0.1, s.y + oy + 0.1, sz + hh, "timber"));
    parts.push(part(primitives.box(3.0, 3.0, 0.16), [s.x, s.y, sz + 2.38], "tile", [-0.16, 0, 0]));
    parts.push(slab(s.x - 1.1, s.y + 0.95, sz + 1.5, s.x + 1.1, s.y + 1.05, sz + 1.6, "timber"));
    parts.push(slab(s.x - 1.2, s.y - 1.2, sz - 0.1, s.x + 1.2, s.y + 1.2, sz + 0.06, "timber", [0.56, 0.4, 0.27]));

    // the fence round the field: posts and two rails, open where the paths come in
    const f = d.field, fx0 = f.x0 - 0.4, fx1 = f.x1 + 1.4, fy0 = f.y0 - 0.4, fy1 = f.y1 + 1.4;
    const gaps = [[fx0, -1.2, 1.4], [3.6, fy1, 1.4]];
    const rail = (ax, ay, bx, by) => {
        const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / 1.6));
        for (let k = 0; k <= n; k++) {
            const px = ax + ((bx - ax) * k) / n, py = ay + ((by - ay) * k) / n;
            if (gaps.some(([gx, gy, gw]) => Math.hypot(px - gx, py - gy) < gw * 0.5)) continue;
            const pz = gz(px, py);
            parts.push(part(primitives.cylinder(0.07, 0.08, 1.1, 6), [px, py, pz + 0.45], "timber", [0, 0, k * 0.7]));
            if (k < n) {
                const qx = ax + ((bx - ax) * (k + 1)) / n, qy = ay + ((by - ay) * (k + 1)) / n;
                if (gaps.some(([gx, gy, gw]) => Math.hypot((px + qx) / 2 - gx, (py + qy) / 2 - gy) < gw * 0.6)) continue;
                const mx = (px + qx) / 2, my = (py + qy) / 2, mz = (pz + gz(qx, qy)) / 2, a = Math.atan2(qy - py, qx - px), l = Math.hypot(qx - px, qy - py);
                for (const hz of [0.35, 0.78]) parts.push(part(primitives.box(l + 0.1, 0.06, 0.07), [mx, my, mz + hz], "timber", [0, 0, a]));
            }
        }
    };
    rail(fx0, fy0, fx1, fy0); rail(fx1, fy0, fx1, fy1); rail(fx1, fy1, fx0, fy1); rail(fx0, fy1, fx0, fy0);
    // a water barrel by the field
    const bx = 2.4, by = -4.2, bbz = gz(bx, by);
    parts.push(part(primitives.cylinder(0.42, 0.38, 0.95, 14), [bx, by, bbz + 0.45], "timber", [0, 0, 0], [1, 1, 1], [0.52, 0.36, 0.24]));
    for (const hz of [0.15, 0.75]) parts.push(part(primitives.cylinder(0.44, 0.44, 0.06, 14), [bx, by, bbz + hz], "dark", [0, 0, 0], [1, 1, 1], [0.3, 0.3, 0.32]));
    parts.push(part(primitives.cylinder(0.37, 0.37, 0.02, 14), [bx, by, bbz + 0.88], "dark", [0, 0, 0], [1, 1, 1], [0.25, 0.4, 0.5]));

    // the little windmill near the south-east rim: a stone tower, a cap, three sails (the fourth is broken off)
    const wm = { x: 15.5, y: -13.5 }, wz = gz(wm.x, wm.y);
    parts.push(part(primitives.cylinder(1.1, 1.7, 6.2, 14), [wm.x, wm.y, wz + 2.9], "stone"));
    parts.push(part(primitives.cone(1.65, 1.6, 14), [wm.x, wm.y, wz + 6.75], "tile"));
    parts.push(part(primitives.box(0.7, 0.15, 1.3), [wm.x + 1.6 * 0.71 - 0.02, wm.y + 1.6 * -0.71, wz + 1.0], "timber", [0, 0, -Math.PI / 4]));
    const hub = [wm.x + 1.25 * 0.71, wm.y - 1.25 * 0.71, wz + 5.6];
    parts.push(part(primitives.cylinder(0.22, 0.22, 0.6, 10), hub, "timber", [Math.PI / 2, 0, -Math.PI / 4]));
    // the sails turn in the plane across the hub's axis (which points out to the south-east)
    const fwd = [0.71, -0.71, 0], across = [0.71, 0.71, 0];
    for (let k = 0; k < 4; k++) {
        if (k === 3) continue; // broken off: its stub only
        const a = k * (Math.PI / 2) + 0.35, len = k === 2 ? 2.0 : 4.4;
        const dir = [across[0] * Math.cos(a), across[1] * Math.cos(a), Math.sin(a)];
        const side = [fwd[1] * dir[2] - fwd[2] * dir[1], fwd[2] * dir[0] - fwd[0] * dir[2], fwd[0] * dir[1] - fwd[1] * dir[0]];
        const at = (o, s) => [hub[0] + fwd[0] * 0.35 + dir[0] * o + side[0] * s, hub[1] + fwd[1] * 0.35 + dir[1] * o + side[1] * s, hub[2] + dir[2] * o + side[2] * s];
        parts.push(basisPart(primitives.box(0.12, 0.12, len), at(len / 2, 0), fwd, side, dir, "timber"));
        if (len > 3) parts.push(basisPart(primitives.box(0.04, 0.8, len * 0.72), at(len * 0.58, 0.42), fwd, side, dir, "cloth"));
    }

    // rocks: a few big ones near the rim and in the grass
    const rand = makeRandom(41);
    for (let k = 0; k < 14; k++) {
        const a = rand() * Math.PI * 2, r = 12 + rand() * 15, x = home.x + Math.cos(a) * r, y = home.y + Math.sin(a) * r, z = gz(x, y);
        if (z === -Infinity || (x > 1 && x < 12 && y > -6 && y < 4) || Math.hypot(x - d.tree.x, y - d.tree.y) < 4 || Math.hypot(x - wm.x, y - wm.y) < 3) continue;
        parts.push({ geometry: rock(rand, 0.4 + rand() * rand() * 1.4), matrix: mat4.fromTranslation(mat4.create(), [x, y, z - 0.1]), color: [...COLOR.stone, KIND.stone] });
    }

    // a stack of sacks and a crate by the hut, a bench under the south windows
    parts.push(slab(x1 + 0.4, y1 - 0.2, z0, x1 + 1.2, y1 + 0.6, z0 + 0.7, "timber", [0.6, 0.45, 0.3]));
    parts.push(part(primitives.sphere(0.4, 10, 8), [x1 + 0.6, y0 + 0.3, z0 + 0.3], "cloth", [0, 0, 0.3], [1, 0.8, 0.75]));
    parts.push(part(primitives.sphere(0.36, 10, 8), [x1 + 0.7, y0 + 0.95, z0 + 0.28], "cloth", [0, 0, -0.4], [1, 0.8, 0.75]));
    parts.push(slab(h.x - 2.2, y0 - 0.75, z0 + 0.42, h.x + 0.2, y0 - 0.35, z0 + 0.5, "timber"));
    for (const ox of [-2.0, 0.0]) parts.push(slab(h.x + ox - 0.05, y0 - 0.7, z0 + 0.0, h.x + ox + 0.05, y0 - 0.4, z0 + 0.42, "timber"));

    // the roof has its own tile uvs, so it stays a mesh of its own; everything else merges into one
    const roofs = parts.filter((p) => !p.matrix).map((p) => p.geometry);
    const merged = Geometry.merge(parts.filter((p) => p.matrix), { uvs: false });
    return { mesh: merged, roofs, windmill: { ...wm, z: wz, hub } };
}

const vertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_color;
attribute vec2 a_uv;
#ifdef INSTANCED
attribute mat4 a_instanceMatrix;
attribute vec4 a_instanceColor;
#endif
uniform mat4 u_model;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
#ifdef INSTANCED
    // instanced props (plots, crops) carry their colour and surface kind per instance
    mat4 model = u_model * a_instanceMatrix;
    v_color = a_instanceColor;
#else
    mat4 model = u_model;
    v_color = a_color;
#endif
    vec4 w = model * vec4(a_position, 1.0);
    v_world = w.xyz;
    v_normal = mat3(model) * a_normal;
    v_uv = a_uv;
    gl_Position = projectLab(w.xyz);
}
`;

const fragment = /* glsl */ `
${header()}
uniform float u_hasUv;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
    vec3 w = v_world, n = normalize(v_normal), albedo = v_color.rgb;
    float kind = v_color.a, wrap = 0.3;
    vec2 p = abs(n.z) > 0.7 ? w.xy : (abs(n.x) > abs(n.y) ? w.yz : w.xz);
    if (kind < 0.1) {
        // plaster: soft mottling, a little dirt toward the ground
        albedo *= 0.93 + 0.1 * fbm(p * 1.3);
    } else if (kind < 0.2) {
        // timber: grain along the longest axis of the part, in world units
        float g = vnoise(vec2(p.x * 0.8, p.y * 7.0)) * 0.6 + vnoise(vec2(p.x * 3.0, p.y * 18.0)) * 0.4;
        albedo *= 0.78 + 0.35 * g;
    } else if (kind < 0.3) {
        // roof tiles: courses up the slope, each tile rounded, its lower edge shadowed, a lighter wash on top
        vec2 q = u_hasUv > 0.5 ? v_uv : p;
        float row = q.y * 3.2;
        float col = q.x * 3.4 + floor(row) * 0.5;
        float fy = fract(row), fx = fract(col);
        float round = sin(fx * 3.14159);
        albedo *= (0.72 + 0.3 * round) * (0.8 + 0.25 * smoothstep(0.0, 0.85, fy)) * (0.88 + 0.2 * hash12(floor(vec2(col, row))));
        albedo = mix(albedo, vec3(0.56, 0.6, 0.38), smoothstep(0.6, 0.9, vnoise(q * 0.7)) * 0.35);
        wrap = 0.35;
    } else if (kind < 0.4) {
        // stone: courses of blocks, mortar lines, moss on top faces
        vec2 q = p * vec2(1.6, 2.6);
        q.x += floor(q.y) * 0.5;
        vec2 f = fract(q);
        float mortar = smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.x) * smoothstep(1.0, 0.94, f.y);
        albedo *= (0.78 + 0.2 * hash12(floor(q))) * mix(0.72, 1.0, mortar) * (0.9 + 0.15 * fbm(p * 2.0));
        albedo = mix(albedo, vec3(0.35, 0.5, 0.24), smoothstep(0.55, 0.9, n.z) * smoothstep(0.4, 0.7, vnoise(p * 1.1)) * 0.8);
    } else if (kind < 0.5) {
        albedo *= 0.92 + 0.1 * vnoise(p * 4.0);
        wrap = 0.5;
    } else if (kind < 0.6) {
        // openings and glass: dark, with a faint sky reflection
        albedo = albedo + u_skyColor * 0.12 * (1.0 - abs(n.z));
    }
    vec3 color = paint(albedo, w, n, wrap, kind > 0.4 && kind < 0.5 ? 0.3 : 0.0);
    // glow: lit from within (night flowers, sprites, lanterns), so bloom picks it up in the dark
    if (kind > 0.8) color += albedo * 0.9;
    gl_FragColor = vec4(atmoAerial(color, w), 1.0);
}
`;

export function propMaterial(hasUv = false) {
    return track(new ShaderMaterial({ name: hasUv ? "props-uv" : "props", vertex, fragment, uniforms: withShared({ u_hasUv: hasUv ? 1 : 0 }) }));
}
