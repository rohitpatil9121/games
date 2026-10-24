import { Geometry, ShaderMaterial } from "../../engine/index.js";
import { topAt, bottomAt, rimAt } from "../islands.js";
import { header, vertexHeader, withShared, track } from "./common.js";
import { fieldsAt, makeFields, groundColor } from "./fields.js";

/**
 * SKYFARM: an island's mesh and its material.
 *
 * Mesh: a polar grid over the top (rings closer together toward the rim, where the shape changes) and rings
 * down the hanging underside, one mesh per island. The top's colour comes from the fields (fields.js), baked
 * into the vertices; alpha says which material a vertex is (1 grass top, 0.5 the earth lip under the rim,
 * 0 rock).
 *
 * Material (one shader for both): the top adds fine colour noise and uses the painterly light with a soft
 * wrap; the rock is layered strata in world height (warm earth under the grass, banded stone below, a
 * darker cooler point), streaked downward, with moss on the ledges that face up, and a bumped normal from
 * the same strata field. Everything goes through the shared atmosphere, so the island fades into the same
 * sky that's behind it.
 * @module game/gfx/terrain
 */

/**
 * @param {object} isl
 * @param {object[]} paths worn paths (home only)
 * @param {number} [detail] 1 near, 0.5 mid, 0.2 far: rings and segments scale with it
 * @param {number[]} [tint] the band's grass tint (world-data BANDS)
 */
export function islandGeometry(isl, paths, detail = 1, tint = [1, 1, 1]) {
    const SEG = Math.max(20, Math.round(128 * detail)), TOP_RINGS = Math.max(5, Math.round(26 * detail)), DOWN_RINGS = Math.max(5, Math.round(22 * detail));
    const positions = [], colors = [], indices = [], rings = [];
    const f = makeFields(), c = [0, 0, 0];
    for (let j = 0; j <= TOP_RINGS; j++) {
        // rings bunch toward the rim (u^0.6), where the loaf rounds over
        const u = Math.pow(j / TOP_RINGS, 0.6), ring = [];
        for (let i = 0; i < SEG; i++) {
            const a = (i / SEG) * Math.PI * 2, rr = rimAt(isl, a) * u * 0.9995;
            const x = isl.x + Math.cos(a) * rr, y = isl.y + Math.sin(a) * rr;
            ring.push(positions.length / 3);
            positions.push(x, y, topAt(isl, x, y));
            fieldsAt(isl, paths, x, y, f);
            groundColor(f, c);
            colors.push(c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], 1);
        }
        rings.push(ring);
    }
    for (let j = 1; j <= DOWN_RINGS; j++) {
        const u = 1 - j / DOWN_RINGS, ring = [];
        for (let i = 0; i < SEG; i++) {
            const a = (i / SEG) * Math.PI * 2, rim = rimAt(isl, a);
            // the first ring tucks under the lip; then the rock bulges out a little before it narrows
            const bulge = j <= 3 ? 1 + 0.04 * Math.sin((j / 3) * Math.PI) : 1;
            const rr = rim * Math.max(0.015, Math.pow(u, 0.85)) * 0.999 * bulge;
            const x = isl.x + Math.cos(a) * rr, y = isl.y + Math.sin(a) * rr;
            const z = j === 1 ? topAt(isl, isl.x + Math.cos(a) * rim * 0.999, isl.y + Math.sin(a) * rim * 0.999) - 0.9 : bottomAt(isl, x, y);
            ring.push(positions.length / 3);
            positions.push(x, y, z);
            colors.push(0.5, 0.34, 0.22, j === 1 ? 0.5 : 0);
        }
        rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const A = rings[j], B = rings[j + 1];
        for (let i = 0; i < SEG; i++) {
            const a = A[i], b = A[(i + 1) % SEG], cc = B[i], d = B[(i + 1) % SEG];
            indices.push(a, cc, b, b, cc, d);
        }
    }
    const P = new Float32Array(positions), I = new Uint32Array(indices);
    return new Geometry({ positions: P, normals: smoothNormals(P, I), colors: new Float32Array(colors), indices: I });
}

/** smooth normals from the triangles (area-weighted) */
export function smoothNormals(P, I) {
    const N = new Float32Array(P.length);
    for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
    }
    for (let k = 0; k < N.length; k += 3) { const m = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= m; N[k + 1] /= m; N[k + 2] /= m; }
    return N;
}

const vertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_color;
uniform mat4 u_model;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;
void main() {
    vec4 w = u_model * vec4(a_position, 1.0);
    v_world = w.xyz;
    v_normal = mat3(u_model) * a_normal;
    v_color = a_color;
    gl_Position = projectLab(w.xyz);
}
`;

const fragment = /* glsl */ `
${header()}
uniform float u_top;        // the island's top height (strata are measured down from it)
uniform vec3 u_rockTint;    // the band's rock colour (warmer in the Orchard, cooler in the High Rocks)
uniform float u_dry;        // 1 = parched (not yet restored), 0 = green again
uniform float u_time;       // the puddles' ripples
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;

vec3 rockColor(vec3 w, float below, out float moss) {
    // strata: bands in height that wobble sideways; warm ochre and grey layers; streaked downward by water
    float wob = fbm(w.xy * 0.06) * 2.5;
    float zz = w.z + wob;
    float band = fract(zz * 0.33 + fbm(w.xy * 0.02) * 0.6);
    float layer = smoothstep(0.0, 0.08, band) * (1.0 - smoothstep(0.55, 0.62, band));
    float streak = vnoise(vec2((w.x + w.y) * 0.45, w.z * 0.05));
    vec3 earth = vec3(0.55, 0.35, 0.21), ochre = vec3(0.74, 0.62, 0.45), stone = vec3(0.72, 0.7, 0.64), stone2 = vec3(0.56, 0.54, 0.52), deep = vec3(0.44, 0.45, 0.52);
    vec3 c = mix(stone2, stone, layer);
    c = mix(c, ochre, smoothstep(0.6, 0.85, fbm(vec2(zz * 0.18, 3.0))) * 0.6);
    c = mix(c, deep, smoothstep(8.0, 30.0, below) * 0.7);
    c = mix(c, earth, 1.0 - smoothstep(0.6, 2.6, below + wob * 0.25));
    c *= (0.8 + 0.28 * streak) * (0.9 + 0.15 * smoothstep(0.3, 0.7, band));
    moss = 0.0;
    return c;
}

void main() {
    vec3 w = v_world;
    vec3 n = normalize(v_normal);
    vec3 albedo;
    float wrap = 0.35;
    if (v_color.a > 0.75) {
        // the grassy top: baked field colour, a little fine variation (clumps, tiny bare spots)
        float fine = fbm(w.xy * 0.9), clump = vnoise(w.xy * 3.1);
        albedo = v_color.rgb * (0.9 + 0.18 * fine) * (0.94 + 0.1 * clump);
        // parched: straw and dust, patchy, until a bridge or the heart brings the island back
        vec3 straw = mix(vec3(0.62, 0.54, 0.34), vec3(0.55, 0.45, 0.3), fine);
        albedo = mix(albedo, straw * (0.9 + 0.2 * clump), u_dry * (0.75 + 0.25 * smoothstep(0.3, 0.7, fbm(w.xy * 0.12))));
        wrap = 0.45;
        // puddles: in the low, flat, worn places a slow noise picks, filling as the rain goes on; rings ripple in them
        float pool = smoothstep(0.86, 0.9, 1.0 - fbm(w.xy * 0.16) + (1.0 - v_color.g) * 0.2) * smoothstep(0.96, 0.995, n.z) * smoothstep(0.25, 0.85, u_wet);
        if (pool > 0.01) {
            vec2 cell = floor(w.xy * 1.3), f = fract(w.xy * 1.3) - 0.5;
            float ph = fract(u_time * 0.9 + hash12(cell)), ring = sin((length(f) - ph * 0.5) * 40.0) * (1.0 - ph) * step(length(f), ph * 0.5 + 0.05);
            n = normalize(n + vec3(f * ring * 0.6, 0.0));
            vec3 view = normalize(u_camPos - w);
            vec3 r = reflect(-view, n);
            r.z = abs(r.z);
            vec3 sky = atmoSky(w.z, r);
            gl_FragColor = vec4(atmoAerial(mix(paint(albedo * 0.5, w, n, wrap, 0.0), sky * 0.6, pool * 0.7), w), 1.0);
            return;
        }
    } else {
        float below = u_top - w.z, moss;
        albedo = rockColor(w, below, moss) * u_rockTint;
        // a bumped normal from a rock field, only where it can be seen (it fades out by 90 m; beyond that the
        // strata colours carry the surface, and four 3D noises a pixel would be wasted)
        float near = 1.0 - smoothstep(40.0, 90.0, length(u_camPos - w));
        if (near > 0.0) {
            vec2 e = vec2(0.35, 0.0);
            float h0 = vnoise3(w * 0.3) + vnoise3(w * 0.7) * 0.4;
            float hx = vnoise3((w + e.xyy) * 0.3) + vnoise3((w + e.xyy) * 0.7) * 0.4;
            float hy = vnoise3((w + e.yxy) * 0.3) + vnoise3((w + e.yxy) * 0.7) * 0.4;
            float hz = vnoise3((w + e.yyx) * 0.3) + vnoise3((w + e.yyx) * 0.7) * 0.4;
            n = normalize(n - vec3(hx - h0, hy - h0, hz - h0) * 1.6 * near);
        }
        // moss and grass tufts on ledges that face up
        float ledge = smoothstep(0.35, 0.75, n.z) * (0.6 + 0.4 * vnoise(w.xy * 0.5));
        albedo = mix(albedo, vec3(0.34, 0.5, 0.22), ledge * 0.8);
        if (v_color.a > 0.25) albedo = mix(vec3(0.42, 0.29, 0.19), vec3(0.36, 0.52, 0.22), smoothstep(0.2, 0.9, n.z));
    }
    vec3 color = paint(albedo, w, n, wrap, 0.0);
    gl_FragColor = vec4(atmoAerial(color, w), 1.0);
}
`;

export function terrainMaterial(isl, rockTint = [1, 1, 1]) {
    return track(new ShaderMaterial({ name: "island", vertex, fragment, uniforms: withShared({ u_top: isl.top, u_rockTint: Float32Array.from(rockTint), u_dry: 0 }) }));
}
