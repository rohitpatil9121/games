import { Geometry, ShaderMaterial, primitives } from "../../engine/index.js";
import { header, vertexHeader, withShared, track } from "./common.js";
import { makeRandom } from "../det.js";

/**
 * SKYFARM: the cloud sea below and the cumulus around the islands.
 *
 * Why not raymarched volumes: the `threejs-volumetric-clouds` skill's path (weather field, bounded march,
 * light cone, temporal reconstruction) costs several milliseconds a frame even at quarter resolution, and the
 * target laptop's GPU is an Intel UHD on WebGL (GDD §0). Ghibli clouds are painted, solid-looking masses with
 * soft blue shadows and bright rims, which a well-lit mesh gets right. What is kept from the skill: density
 * organised by layer (a sea with a flat-ish top, cumulus with flat bases and heaped tops), separate wind per
 * layer, and lighting from the same sun and atmosphere as everything else.
 *
 * Cloud sea: a polar grid that follows the camera (rings spread out with distance, so detail is where you
 * look), displaced in the vertex shader by billowy noise in world space (so it doesn't swim as you move),
 * flattening out toward the horizon. Lit with a very soft wrap, blue in the hollows, a silver rim against the
 * sun, the shadows of the islands above it (an analytic test against each island's disc along the sun), and
 * the atmosphere's haze, which turns it into the sky at the horizon.
 *
 * Cumulus: clusters of spheres, the lower ones clipped flat at the cloud's base, merged into one mesh. Each
 * vertex carries a "volume normal" (the sphere's own normal bent toward the outward direction of the whole
 * cloud), which gives the soft, rounded light of a cloud rather than the hard creases between balls. A
 * slow vertex wobble keeps them breathing.
 * @module game/gfx/clouds
 */

export const CLOUD_SEA = Object.freeze({ rings: 90, segments: 160, inner: 3, growth: 1.075, amplitude: 28, scale: 0.0062 });

/** a flat polar grid (the shader moves it to the camera and displaces it) */
export function seaGeometry() {
    const { rings, segments, inner, growth } = CLOUD_SEA, positions = [], indices = [];
    positions.push(0, 0, 0);
    let r = inner;
    for (let j = 0; j < rings; j++) {
        for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; positions.push(Math.cos(a) * r, Math.sin(a) * r, 0); }
        r *= growth;
    }
    for (let i = 0; i < segments; i++) indices.push(0, 1 + i, 1 + ((i + 1) % segments));
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segments; i++) {
        const a = 1 + j * segments + i, b = 1 + j * segments + ((i + 1) % segments), c = a + segments, d = b + segments;
        indices.push(a, c, b, b, c, d);
    }
    return new Geometry({ name: "cloud-sea", positions: new Float32Array(positions), indices: new Uint32Array(indices) });
}

const seaVertex = /* glsl */ `
${vertexHeader()}
${"" /* noise is needed in the vertex shader for the displacement */}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
attribute vec3 a_position;
// u_camPos comes from the projection chunk
uniform float u_time;
uniform vec4 u_sea;          // amplitude, scale, drift x, drift y (m/s)
varying vec3 v_world;
varying vec3 v_normal;
varying float v_puff;
/** billows: rounded heaps (1 - |2n - 1| turned upside down reads as cauliflower tops) */
float billow(vec2 p) { float n = vnoise(p); return 1.0 - abs(2.0 * n - 1.0); }
float seaHeight(vec2 p, float flatK) {
    vec2 q = p * u_sea.y + u_time * u_sea.zw * u_sea.y;
    float h = billow(q) * 0.5 + billow(q * 2.3 + 5.1) * 0.3 + billow(q * 5.7 + 2.3) * 0.2 * (1.0 - flatK);
    float big = vnoise(q * 0.31 + 9.0);
    return (h * (0.55 + 0.9 * big) - 0.62) * u_sea.x * (1.0 - flatK * 0.75);
}
void main() {
    vec2 p = a_position.xy + floor(u_camPos.xy / 8.0) * 8.0;
    float r = length(a_position.xy);
    float flatK = smoothstep(900.0, 3500.0, r);
    float h = seaHeight(p, flatK);
    float e = max(1.5, r * 0.02);
    float hx = seaHeight(p + vec2(e, 0.0), flatK), hy = seaHeight(p + vec2(0.0, e), flatK);
    v_normal = normalize(vec3(h - hx, h - hy, e));
    v_world = vec3(p, h);
    v_puff = h / u_sea.x;
    gl_Position = projectLab(v_world);
}
`;

const seaFragment = /* glsl */ `
${header()}
uniform vec4 u_islands[8];   // x, y, radius, top (radius 0 = unused)
varying vec3 v_world;
varying vec3 v_normal;
varying float v_puff;
void main() {
    vec3 w = v_world;
    vec3 n = normalize(v_normal + (vec3(vnoise(w.xy * 0.08), vnoise(w.yx * 0.08 + 3.0), 0.0) - 0.5) * 0.25);
    vec3 view = normalize(u_camPos - w);
    float sunDot = dot(n, u_sunDirection);
    float lit = clamp((sunDot + 0.35) / 1.35, 0.0, 1.0);
    // the islands' shadows: walk from the point toward the sun up to each island's top, inside its disc?
    float shade = 1.0;
    for (int i = 0; i < 8; i++) {
        vec4 isl = u_islands[i];
        if (isl.z <= 0.0) continue;
        float t = (isl.w - 6.0 - w.z) / max(u_sunDirection.z, 0.05);
        vec2 at = w.xy + u_sunDirection.xy * t;
        float d = length(at - isl.xy) / isl.z;
        shade *= mix(0.45, 1.0, smoothstep(0.75, 1.05, d));
    }
    vec3 white = vec3(0.985, 0.985, 0.97), blue = vec3(0.79, 0.86, 0.94);
    // hollows hold the blue, heaps catch the light
    float heap = smoothstep(-0.6, 0.5, v_puff);
    vec3 albedo = mix(blue * 0.88, white, heap);
    vec3 direct = u_sunColor * lit * shade * (0.75 + 0.35 * heap);
    vec3 ambient = mix(u_groundColor * 0.6 + u_skyColor * 0.4, u_skyColor, n.z * 0.5 + 0.5) * (0.85 + 0.35 * heap);
    vec3 color = albedo * (direct + ambient);
    // silver lining: thin rims light up when the sun is behind them
    float rim = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 4.0);
    float behind = pow(clamp(dot(-view, u_sunDirection), 0.0, 1.0), 6.0);
    color += u_sunColor * rim * (0.25 + 1.6 * behind) * shade;
    gl_FragColor = vec4(atmoAerial(color, w), 1.0);
}
`;

export function seaMaterial() {
    const m = new ShaderMaterial({ name: "cloud-sea", vertex: seaVertex, fragment: seaFragment, uniforms: withShared({ u_sea: new Float32Array([CLOUD_SEA.amplitude, CLOUD_SEA.scale, 1.6, 0.7]), u_islands: new Float32Array(32) }) });
    return track(m);
}

/**
 * Cumulus clouds as one mesh. Each: a cluster of spheres heaped up from a flat base.
 * @param {number} seed
 * @param {{ x: number, y: number, z: number, size: number }[]} places
 */
export function cumulusGeometry(seed, places) {
    const rand = makeRandom(seed), parts = [];
    const ball = primitives.sphere(1, 16, 11);
    let total = 0;
    const clouds = places.map((pl) => {
        const n = 10 + Math.floor(rand() * 9), balls = [];
        const long = 1.4 + rand() * 0.8, ang = rand() * Math.PI;
        for (let k = 0; k < n; k++) {
            // along a long axis, bigger and higher in the middle (a heap)
            const u = (k / (n - 1)) * 2 - 1, mid = 1 - u * u;
            const r = pl.size * (0.26 + 0.34 * mid) * (0.75 + rand() * 0.5);
            const ax = u * pl.size * long, side = (rand() - 0.5) * pl.size * 0.7;
            const bx = pl.x + Math.cos(ang) * ax - Math.sin(ang) * side, by = pl.y + Math.sin(ang) * ax + Math.cos(ang) * side;
            balls.push([bx, by, pl.z + r * (0.35 + 0.6 * mid) + rand() * pl.size * 0.15, r]);
        }
        // a few smaller heaps on top
        for (let k = 0; k < 7; k++) { const b = balls[1 + Math.floor(rand() * (n - 2))]; balls.push([b[0] + (rand() - 0.5) * b[3] * 1.2, b[1] + (rand() - 0.5) * b[3] * 1.2, b[2] + b[3] * (0.45 + rand() * 0.35), b[3] * (0.35 + rand() * 0.25)]); }
        total += balls.length * ball.vertexCount;
        return { ...pl, balls };
    });
    const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3), colors = new Float32Array(total * 4), indices = [];
    let v = 0;
    for (const c of clouds) {
        // the cloud's middle, for the volume normal
        let cx = 0, cy = 0, cz = 0;
        for (const b of c.balls) { cx += b[0]; cy += b[1]; cz += b[2]; }
        cx /= c.balls.length; cy /= c.balls.length; cz /= c.balls.length;
        for (const b of c.balls) {
            const P = ball.positions, N = ball.normals, base = v;
            for (let i = 0; i < ball.vertexCount; i++) {
                // a little lumpiness on each ball, so no surface is a perfect sphere
                const lump = 1 + 0.12 * Math.sin(P[i * 3] * 4.1 + b[0]) * Math.sin(P[i * 3 + 1] * 3.7 + b[1]) * Math.sin(P[i * 3 + 2] * 4.3 + b[2]);
                let x = b[0] + P[i * 3] * b[3] * lump, y = b[1] + P[i * 3 + 1] * b[3] * lump, z = b[2] + P[i * 3 + 2] * b[3] * lump;
                const flat = z < c.z;
                if (flat) z = c.z;
                const o = (v + i) * 3;
                positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
                // volume normal: the ball's own, bent toward "out of the whole cloud"; flat bases face down
                let nx = N[i * 3] * 0.6 + (x - cx) / c.size * 0.5, ny = N[i * 3 + 1] * 0.6 + (y - cy) / c.size * 0.5, nz = N[i * 3 + 2] * 0.6 + (z - cz) / c.size * 0.5;
                if (flat) { nx *= 0.3; ny *= 0.3; nz = -1; }
                const m = Math.hypot(nx, ny, nz) || 1;
                normals[o] = nx / m; normals[o + 1] = ny / m; normals[o + 2] = nz / m;
                // alpha: height in the cloud (0 base .. 1 top), for darker bases
                colors.set([1, 1, 1, Math.min(1, (z - c.z) / (c.size * 1.6))], (v + i) * 4);
            }
            for (let k = 0; k < ball.indices.length; k++) indices.push(base + ball.indices[k]);
            v += ball.vertexCount;
        }
    }
    return new Geometry({ name: "cumulus", positions, normals, colors, indices: new Uint32Array(indices) });
}

const cumulusVertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_color;
uniform mat4 u_model;
uniform float u_time;
varying vec3 v_world;
varying vec3 v_normal;
varying float v_height;
void main() {
    vec3 p = a_position;
    // breathe: a slow swell along the normal, different at every place
    float s = sin(p.x * 0.05 + u_time * 0.21) * sin(p.y * 0.06 - u_time * 0.17) * sin(p.z * 0.04 + u_time * 0.13);
    p += a_normal * s * 1.2 * step(0.02, a_color.a);
    vec4 w = u_model * vec4(p, 1.0);
    v_world = w.xyz;
    v_normal = a_normal;
    v_height = a_color.a;
    gl_Position = projectLab(w.xyz);
}
`;

const cumulusFragment = /* glsl */ `
${header()}
varying vec3 v_world;
varying vec3 v_normal;
varying float v_height;
void main() {
    vec3 w = v_world, n = normalize(v_normal);
    vec3 view = normalize(u_camPos - w);
    float lit = clamp((dot(n, u_sunDirection) + 0.5) / 1.5, 0.0, 1.0);
    vec3 white = vec3(0.985, 0.985, 0.97), shadow = vec3(0.72, 0.8, 0.92);
    vec3 albedo = mix(shadow, white, smoothstep(0.0, 0.55, v_height) * 0.6 + lit * 0.4);
    vec3 ambient = mix(u_groundColor * 0.7 + u_skyColor * 0.3, u_skyColor, n.z * 0.5 + 0.5) * 1.1;
    vec3 color = albedo * (u_sunColor * lit + ambient);
    float rim = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.0);
    float behind = pow(clamp(dot(-view, u_sunDirection), 0.0, 1.0), 5.0);
    color += u_sunColor * rim * (0.2 + 1.8 * behind);
    gl_FragColor = vec4(atmoAerial(color, w), 1.0);
}
`;

export function cumulusMaterial() {
    return track(new ShaderMaterial({ name: "cumulus", vertex: cumulusVertex, fragment: cumulusFragment, uniforms: withShared() }));
}
