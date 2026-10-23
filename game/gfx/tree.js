import { Geometry, ShaderMaterial } from "../../engine/index.js";
import { header, vertexHeader, withShared, track } from "./common.js";
import { makeRandom } from "../det.js";

/**
 * SKYFARM: procedural trees (the `threejs-procedural-vegetation` skill's growth system, kept: a per-level
 * species table; branches grown iteratively from a queue, so depth and budget are inspectable; each branch
 * emitted as oriented rings with a seam, its frame carried along by parallel transport; children at stratified
 * heights with permuted angles, so no two leave at the same point or form a helix; curvature from inherited
 * direction + noise + tropism; leaves only once the branches are fixed; foliage normals from the crown's
 * volume as well as the card; wind as separate scopes: whole-tree sway, and leaf cards that flutter about
 * their root, never their centre).
 *
 * The look is a Ghibli camphor/oak: a short thick trunk with flared roots, heavy limbs, and a crown of big
 * rounded leaf masses, deep and cool inside, bright and yellow-green where the sun hits the top. A mass is a
 * lumpy sphere (the body of the crown) with leaf cards scattered on it to break its silhouette into leaves.
 * Bark texture is measured in world units around the branch, so it doesn't stretch on thin branches.
 * @module game/gfx/tree
 */

export const OAK = Object.freeze({
    levels: [
        // length (fraction of tree height, or of the parent), base radius (m, or fraction of the parent's radius there),
        // taper, children, emergence range, angle from parent, gnarl, upward tropism, sections, radial segments
        { length: 0.42, radius: 0.85, taper: 0.55, children: 6, emerge: [0.42, 0.98], angle: 0.85, gnarl: 0.1, up: 0.04, sections: 9, radial: 14 },
        { length: 0.55, radius: 0.55, taper: 0.4, children: 4, emerge: [0.25, 1.0], angle: 0.65, gnarl: 0.2, up: 0.09, sections: 7, radial: 9 },
        { length: 0.55, radius: 0.6, taper: 0.25, children: 0, emerge: [0, 0], angle: 0.5, gnarl: 0.25, up: 0.12, sections: 4, radial: 6 },
    ],
    roots: 6,
    /** leaf masses: radius range (m), cards per mass */
    mass: [1.6, 2.6],
    cards: 46,
    bark: [0.4, 0.29, 0.21],
    leafDark: [0.18, 0.36, 0.17],
    leafLight: [0.55, 0.76, 0.3],
});

const norm = (v) => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Rotate v around unit axis k by angle a (Rodrigues). */
function rotate(v, k, a) {
    const c = Math.cos(a), s = Math.sin(a), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], x = cross(k, v);
    return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

/**
 * Grow a tree. Returns the bark geometry, the leaf geometry and the masses (for collision and debug).
 * @param {{ x: number, y: number, z: number, seed: number, height: number }} at
 */
export function growTree(at, species = OAK) {
    const rand = makeRandom(at.seed * 7919 + 1);
    const bark = { pos: [], nrm: [], uv: [], col: [], idx: [] };
    const masses = [];
    const queue = [{ level: 0, origin: [at.x, at.y, at.z - 0.3], dir: [0, 0, 1], length: at.height * species.levels[0].length, radius: species.levels[0].radius * (at.height / 15) }];
    let branches = 0;
    while (queue.length) {
        const b = queue.shift(), L = species.levels[b.level];
        branches++;
        // the branch's path: sections, each turning by noise + tropism
        const pts = [b.origin], dirs = [b.dir];
        let dir = b.dir, p = b.origin;
        const seg = b.length / L.sections;
        for (let s = 1; s <= L.sections; s++) {
            dir = norm(add(add(dir, [(rand() - 0.5) * L.gnarl * 2, (rand() - 0.5) * L.gnarl * 2, (rand() - 0.5) * L.gnarl]), [0, 0, 1], L.up));
            p = add(p, dir, seg);
            pts.push(p); dirs.push(dir);
        }
        const radiusAt = (t) => b.radius * (1 - (1 - L.taper) * t) * (b.level === 0 ? 1 + 0.6 * Math.max(0, 0.12 - t) / 0.12 : 1);
        emitTube(bark, pts, dirs, radiusAt, L.radial, b.level === 0 ? 0.6 : 0);
        // children at stratified heights, angles from a permutation
        const n = L.children;
        if (n && b.level + 1 < species.levels.length) {
            const C = species.levels[b.level + 1], perm = [...Array(n).keys()].sort(() => rand() - 0.5);
            for (let k = 0; k < n; k++) {
                const t = L.emerge[0] + (L.emerge[1] - L.emerge[0]) * ((k + 0.2 + rand() * 0.6) / n);
                const si = Math.min(L.sections - 1, Math.floor(t * L.sections)), f = t * L.sections - si;
                const o = add(pts[si], add(pts[si + 1], pts[si], -1), f), pd = dirs[si + 1];
                // out from the parent at the level's angle, around it by the permuted slot
                const side = norm(cross(pd, Math.abs(pd[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
                const around = rotate(side, pd, (perm[k] / n) * Math.PI * 2 + rand() * 0.5);
                const cd = norm(add(rotate(pd, norm(cross(pd, around)), C.angle + (rand() - 0.5) * 0.3), [0, 0, 1], 0.15));
                queue.push({ level: b.level + 1, origin: o, dir: cd, length: b.length * C.length * (1.1 - t * 0.4) * (0.85 + rand() * 0.3), radius: radiusAt(t) * C.radius });
            }
        }
        // leaf masses at the tips of the last two levels
        if (b.level >= species.levels.length - 2 && (b.level === species.levels.length - 1 || rand() < 0.4)) {
            const r = species.mass[0] + (species.mass[1] - species.mass[0]) * rand();
            masses.push({ x: p[0], y: p[1], z: p[2] + r * 0.3, r });
        }
    }
    // flared roots: short thick branches running out and down into the ground
    for (let k = 0; k < species.roots; k++) {
        const a = (k / species.roots) * Math.PI * 2 + rand() * 0.6, d0 = [Math.cos(a), Math.sin(a), -0.35];
        const pts = [], dirs = [];
        for (let s = 0; s <= 4; s++) { const t = s / 4; pts.push([at.x + d0[0] * t * 2.6, at.y + d0[1] * t * 2.6, at.z + 0.55 - t * 0.95]); dirs.push(norm([d0[0], d0[1], -0.5])); }
        emitTube(bark, pts, dirs, (t) => 0.42 * (1 - 0.75 * t) * (at.height / 15), 7, 0.4);
    }
    // the crown's middle, for the volume normals
    let cx = 0, cy = 0, cz = 0;
    for (const m of masses) { cx += m.x; cy += m.y; cz += m.z; }
    cx /= masses.length; cy /= masses.length; cz /= masses.length;
    const crownR = Math.max(...masses.map((m) => Math.hypot(m.x - cx, m.y - cy, m.z - cz) + m.r));
    const leaves = emitLeaves(masses, [cx, cy, cz], crownR, species, rand);
    const barkGeo = new Geometry({ name: "bark", positions: new Float32Array(bark.pos), normals: new Float32Array(bark.nrm), uvs: new Float32Array(bark.uv), colors: new Float32Array(bark.col), indices: new Uint32Array(bark.idx) });
    return { bark: barkGeo, leaves, masses, branches, crown: { x: cx, y: cy, z: cz, r: crownR } };
}

/** rings along a path, the frame carried by parallel transport; uv.x around in metres, uv.y along in metres */
function emitTube(out, pts, dirs, radiusAt, radial, flare) {
    let side = norm(cross(dirs[0], Math.abs(dirs[0][2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
    const base = out.pos.length / 3;
    let along = 0;
    for (let s = 0; s < pts.length; s++) {
        const t = s / (pts.length - 1), d = dirs[s];
        // parallel transport: remove the new direction's component, keep the side vector's twist steady
        const k = side[0] * d[0] + side[1] * d[1] + side[2] * d[2];
        side = norm([side[0] - d[0] * k, side[1] - d[1] * k, side[2] - d[2] * k]);
        const up = cross(d, side), r = radiusAt(t);
        if (s > 0) along += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1], pts[s][2] - pts[s - 1][2]);
        for (let i = 0; i <= radial; i++) {
            const a = (i / radial) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
            // the trunk's base bulges where roots join (lobes)
            const lobe = flare ? 1 + flare * Math.max(0, 0.25 - t) * 4 * Math.pow(Math.abs(Math.sin(a * 3)), 2) : 1;
            const n = [side[0] * c + up[0] * sn, side[1] * c + up[1] * sn, side[2] * c + up[2] * sn];
            out.pos.push(pts[s][0] + n[0] * r * lobe, pts[s][1] + n[1] * r * lobe, pts[s][2] + n[2] * r * lobe);
            out.nrm.push(n[0], n[1], n[2]);
            out.uv.push((i / radial) * Math.PI * 2 * Math.max(r, 0.15), along);
            out.col.push(1, 1, 1, 0);
        }
    }
    const w = radial + 1;
    for (let s = 0; s < pts.length - 1; s++) for (let i = 0; i < radial; i++) {
        const a = base + s * w + i, b = a + 1, c = a + w, d = c + 1;
        out.idx.push(a, b, c, b, d, c);
    }
}

/** leaf masses (lumpy spheres) and leaf cards on them; colour alpha = how deep inside the crown (0 out, 1 in) */
function emitLeaves(masses, crown, crownR, sp, rand) {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const LAT = 9, LON = 14;
    for (const m of masses) {
        // the lumpy body
        const base = pos.length / 3;
        for (let j = 0; j <= LAT; j++) for (let i = 0; i <= LON; i++) {
            const th = (j / LAT) * Math.PI, ph = (i / LON) * Math.PI * 2;
            const nx = Math.sin(th) * Math.cos(ph), ny = Math.sin(th) * Math.sin(ph), nz = Math.cos(th);
            const lump = 1 + 0.16 * Math.sin(nx * 5 + m.x) * Math.sin(ny * 5 + m.y) * Math.sin(nz * 4 + m.z);
            const flat = nz < -0.3 ? 0.75 : 1;
            const x = m.x + nx * m.r * lump, y = m.y + ny * m.r * lump, z = m.z + nz * m.r * lump * flat;
            pos.push(x, y, z);
            const v = norm([(x - crown[0]) / crownR * 0.7 + nx * 0.5, (y - crown[1]) / crownR * 0.7 + ny * 0.5, (z - crown[2]) / crownR * 0.7 + nz * 0.5]);
            nrm.push(v[0], v[1], v[2]);
            uv.push(-1, -1);
            const depth = 1 - Math.min(1, Math.hypot(x - crown[0], y - crown[1], z - crown[2]) / crownR);
            col.push(1, 1, 1, depth);
        }
        for (let j = 0; j < LAT; j++) for (let i = 0; i < LON; i++) {
            const a = base + j * (LON + 1) + i, b = a + 1, c = a + LON + 1, d = c + 1;
            idx.push(a, c, b, b, c, d);
        }
        // cards: rooted on the surface, leaning out; uv (0..1) across the card, its root at v = 0
        for (let k = 0; k < sp.cards; k++) {
            const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
            const nx = s * Math.cos(ph), ny = s * Math.sin(ph), nz = u;
            if (nz < -0.6) continue;
            const root = [m.x + nx * m.r * 0.9, m.y + ny * m.r * 0.9, m.z + nz * m.r * 0.9];
            const out = norm([nx + (rand() - 0.5) * 0.6, ny + (rand() - 0.5) * 0.6, nz + 0.3]);
            const side = norm(cross(out, [rand() - 0.5, rand() - 0.5, 1]));
            const size = 0.55 + rand() * 0.35;
            const vnrm = norm([(root[0] - crown[0]) / crownR + nx * 0.4, (root[1] - crown[1]) / crownR + ny * 0.4, (root[2] - crown[2]) / crownR + nz * 0.4]);
            const depth = 1 - Math.min(1, Math.hypot(root[0] - crown[0], root[1] - crown[1], root[2] - crown[2]) / crownR);
            const b = pos.length / 3;
            for (const [su, sv] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
                pos.push(root[0] + side[0] * su * size + out[0] * sv * size, root[1] + side[1] * su * size + out[1] * sv * size, root[2] + side[2] * su * size + out[2] * sv * size);
                nrm.push(vnrm[0], vnrm[1], vnrm[2]);
                uv.push(su + 0.5, sv);
                col.push(1, 1, 1, depth);
            }
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
    }
    return new Geometry({ name: "leaves", positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), colors: new Float32Array(col), indices: new Uint32Array(idx) });
}

const barkVertex = /* glsl */ `
${vertexHeader(true)}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform mat4 u_model;
uniform float u_time;
uniform vec4 u_tree;     // root x, y, z, height
varying vec3 v_world;
varying vec3 v_normal;
varying vec2 v_uv;
/** whole-tree sway: grows with height above the root, follows the wind's gusts slowly */
vec3 sway(vec3 p) {
    float h = max(0.0, p.z - u_tree.z) / u_tree.w;
    float w = windAt(u_tree.xy, u_time * 0.35) * 0.35;
    return vec3(u_wind.xy * w * h * h * 0.6, 0.0);
}
void main() {
    vec3 w = (u_model * vec4(a_position, 1.0)).xyz;
    w += sway(w);
    v_world = w;
    v_normal = mat3(u_model) * a_normal;
    v_uv = a_uv;
    gl_Position = projectLab(w);
}
`;
const barkFragment = /* glsl */ `
${header()}
uniform vec3 u_bark;
varying vec3 v_world;
varying vec3 v_normal;
varying vec2 v_uv;
void main() {
    // ridged bark running along the branch, in metres, so thin branches don't stretch it
    float ridge = vnoise(vec2(v_uv.x * 3.0, v_uv.y * 0.6)) * 0.6 + vnoise(vec2(v_uv.x * 9.0, v_uv.y * 1.4)) * 0.4;
    vec3 albedo = u_bark * (0.7 + 0.55 * ridge);
    // lichen and moss on the upper side
    vec3 n = normalize(v_normal);
    albedo = mix(albedo, vec3(0.42, 0.5, 0.3), smoothstep(0.4, 0.9, n.z) * smoothstep(0.5, 0.8, vnoise(v_uv * 1.7)) * 0.7);
    vec3 color = paint(albedo, v_world, n, 0.2, 0.0);
    gl_FragColor = vec4(atmoAerial(color, v_world), 1.0);
}
`;

const leafVertex = /* glsl */ `
${vertexHeader(true)}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec4 a_color;
uniform mat4 u_model;
uniform float u_time;
uniform vec4 u_tree;
varying vec3 v_world;
varying vec3 v_normal;
varying vec2 v_uv;
varying float v_depth;
void main() {
    vec3 w = (u_model * vec4(a_position, 1.0)).xyz;
    float h = max(0.0, w.z - u_tree.z) / u_tree.w;
    float gust = windAt(u_tree.xy, u_time * 0.35) * 0.35;
    w.xy += u_wind.xy * gust * h * h * 0.6;
    // cards flutter about their root (uv.y = 0 stays put)
    if (a_uv.y >= 0.0) {
        float f = windAt(w.xy * 3.0, u_time * 2.3) - 0.5;
        w += (a_normal * 0.12 + vec3(u_wind.xy, 0.0) * 0.1) * f * a_uv.y;
    }
    v_world = w;
    v_normal = mat3(u_model) * a_normal;
    v_uv = a_uv;
    v_depth = a_color.a;
    gl_Position = projectLab(w);
}
`;
const leafFragment = /* glsl */ `
${header()}
uniform vec3 u_leafDark;
uniform vec3 u_leafLight;
varying vec3 v_world;
varying vec3 v_normal;
varying vec2 v_uv;
varying float v_depth;
void main() {
    if (v_uv.y >= 0.0) {
        // a card holds a few pointed leaves: each an ellipse around its own stalk; outside them, nothing
        vec2 q = v_uv;
        float leaf = 0.0;
        for (int k = 0; k < 4; k++) {
            float fk = float(k);
            vec2 c = vec2(0.25 + 0.5 * fract(fk * 0.618 + 0.2), 0.3 + 0.18 * fk);
            vec2 d = q - c;
            float a = fk * 1.7 + 0.4;
            d = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
            leaf = max(leaf, 1.0 - length(d / vec2(0.13, 0.24)));
        }
        if (leaf <= 0.0) discard;
    }
    vec3 n = normalize(v_normal);
    float lit = clamp(dot(n, u_sunDirection) * 0.5 + 0.5, 0.0, 1.0);
    // deep inside the crown is cool and dark; the sunlit top is warm and bright
    vec3 albedo = mix(u_leafDark, u_leafLight, smoothstep(0.25, 0.95, lit) * (1.0 - v_depth * 0.55));
    albedo *= 0.92 + 0.16 * vnoise(v_world.xy * 1.3 + v_world.z);
    vec3 color = paint(albedo, v_world, n, 0.55, 0.45) * (1.0 - v_depth * 0.35);
    gl_FragColor = vec4(atmoAerial(color, v_world), 1.0);
}
`;

export function treeMaterials(at) {
    const tree = new Float32Array([at.x, at.y, at.z, at.height]);
    return {
        bark: track(new ShaderMaterial({ name: "bark", vertex: barkVertex, fragment: barkFragment, uniforms: withShared({ u_tree: tree, u_bark: Float32Array.from(OAK.bark) }) })),
        leaves: track(new ShaderMaterial({ name: "leaves", vertex: leafVertex, fragment: leafFragment, uniforms: withShared({ u_tree: tree, u_leafDark: Float32Array.from(OAK.leafDark), u_leafLight: Float32Array.from(OAK.leafLight) }), cull: "none" })),
    };
}
