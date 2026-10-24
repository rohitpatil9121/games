import { Geometry, ShaderMaterial } from "../../engine/index.js";
import { topAt, rimAt } from "../islands.js";
import { header, vertexHeader, withShared, track } from "./common.js";

/**
 * SKYFARM: ponds, streams and the waterfalls that pour off an island's edge into the clouds (the
 * `threejs-water-optics` skill's "authored analytic waves, shared normals, fallback absorption, crest foam" path:
 * small closed water bodies don't need an FFT ocean).
 *
 * Still and running water: a mesh at the water's level (a disc for a pond, a ribbon down a stream's groove),
 * each vertex carrying how close it is to the bank. The shader sums a few analytic ripples for the normal
 * (running water's ripples move downstream), mixes a deep teal and the sky's reflection by Fresnel (the sky from
 * the same atmosphere, so a pond at golden hour is golden), adds a sun glint and a foam line at the bank.
 *
 * A waterfall: a ribbon that leaves the rim, curves out a little and falls to the cloud sea, widening as it
 * goes. Its shader scrolls streaks of foam downward, thins at the edges and breaks up toward the bottom, where
 * it turns to mist (particles in world.js).
 * @module game/gfx/water
 */

/** The water an island has, as geometry: ponds, streams, and its waterfall (if a stream reaches the rim). */
export function waterGeometry(isl) {
    const out = { still: null, falls: [] };
    if (!isl.ponds) return out;
    const pos = [], col = [], uv = [], idx = [];
    for (const p of isl.ponds) {
        if (!p.stream) {
            // a disc a little bigger than the bowl, at the water's level (the bank hides its edge)
            const base = pos.length / 3, R = p.r + 0.6, RINGS = 8, SEG = 40;
            pos.push(p.x0, p.y0, p.level); col.push(1, 1, 1, 0); uv.push(0, 0);
            for (let j = 1; j <= RINGS; j++) for (let i = 0; i < SEG; i++) {
                const a = (i / SEG) * Math.PI * 2, r = (j / RINGS) * R;
                pos.push(p.x0 + Math.cos(a) * r, p.y0 + Math.sin(a) * r, p.level);
                col.push(1, 1, 1, Math.max(0, 1 - Math.abs(r - p.r * 0.92) / 1.2)); uv.push(0, 0);
            }
            for (let i = 0; i < SEG; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % SEG));
            for (let j = 0; j < RINGS - 1; j++) for (let i = 0; i < SEG; i++) {
                const a = base + 1 + j * SEG + i, b = base + 1 + j * SEG + ((i + 1) % SEG), c = a + SEG, d = b + SEG;
                idx.push(a, c, b, b, c, d);
            }
        } else {
            // a ribbon down the groove, 0.35 m above its floor, flowing from x0,y0 to x1,y1
            const base = pos.length / 3, sx = p.x1 - p.x0, sy = p.y1 - p.y0, L = Math.hypot(sx, sy), ux = sx / L, uy = sy / L, N = Math.ceil(L / 1.2);
            for (let k = 0; k <= N; k++) {
                const t = k / N, cx = p.x0 + sx * t, cy = p.y0 + sy * t;
                for (const side of [-1, 1]) {
                    const x = cx - uy * side * p.r * 0.95, y = cy + ux * side * p.r * 0.95;
                    const floor = Math.min(topAt(isl, cx, cy), topAt(isl, x, y));
                    const z = (Number.isFinite(floor) ? topAt(isl, cx, cy) : topAt(isl, p.x0, p.y0)) + 0.4;
                    pos.push(x, y, z); col.push(ux, uy, 1, 0.7); uv.push(t * L, side);
                }
                if (k < N) { const a = base + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
            }
            // where the stream leaves the rim, it falls
            const a = Math.atan2(uy, ux), rim = rimAt(isl, Math.atan2(p.y1 - isl.y, p.x1 - isl.x));
            const lx = isl.x + Math.cos(Math.atan2(p.y1 - isl.y, p.x1 - isl.x)) * rim * 0.985, ly = isl.y + Math.sin(Math.atan2(p.y1 - isl.y, p.x1 - isl.x)) * rim * 0.985;
            out.falls.push(fallGeometry(lx, ly, topAt(isl, lx, ly) + 0.1, Math.cos(a), Math.sin(a), p.r * 3.2));
        }
    }
    const P = new Float32Array(pos), N = new Float32Array(pos.length);
    for (let i = 0; i < N.length; i += 3) N[i + 2] = 1;
    out.still = new Geometry({ name: "water", positions: P, normals: N, colors: new Float32Array(col), uvs: new Float32Array(uv), indices: new Uint32Array(idx) });
    return out;
}

/** a falling ribbon from (x, y, z) heading out along (ux, uy), width w at the top */
function fallGeometry(x, y, z, ux, uy, w) {
    const pos = [], uv = [], idx = [], N = 48;
    for (let k = 0; k <= N; k++) {
        // it pours over the lip and then hangs close to the cliff, spreading as it falls
        const t = k / N, drop = z * Math.pow(t, 1.1) + 6 * t, out = 0.6 + 2.6 * Math.sqrt(t) + 1.5 * t, width = w * (1 + 1.8 * Math.sqrt(t));
        const cx = x + ux * out, cy = y + uy * out, cz = z - drop;
        for (const side of [-1, 1]) { pos.push(cx - uy * side * width / 2, cy + ux * side * width / 2, cz); uv.push(side * 0.5 + 0.5, t); }
        if (k < N) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const P = new Float32Array(pos), Nn = new Float32Array(pos.length);
    for (let i = 0; i < Nn.length; i += 3) { Nn[i] = ux; Nn[i + 1] = uy; }
    return { geometry: new Geometry({ name: "waterfall", positions: P, normals: Nn, uvs: new Float32Array(uv), indices: new Uint32Array(idx) }), base: [x + ux * 9, y + uy * 9, 2], top: [x, y, z], dir: [ux, uy] };
}

const stillVertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec4 a_color;
attribute vec2 a_uv;
uniform mat4 u_model;
varying vec3 v_world;
varying vec4 v_flow;
varying vec2 v_uv;
void main() {
    vec4 w = u_model * vec4(a_position, 1.0);
    v_world = w.xyz;
    v_flow = a_color;
    v_uv = a_uv;
    gl_Position = projectLab(w.xyz);
}
`;
const stillFragment = /* glsl */ `
${header()}
uniform float u_time;
varying vec3 v_world;
varying vec4 v_flow;     // xy: flow direction (streams), z: 1 = stream, w: closeness to the bank
varying vec2 v_uv;
void main() {
    vec3 w = v_world;
    // analytic ripples; running water's move downstream
    vec2 flow = v_flow.z > 0.5 ? v_flow.xy * 1.6 : vec2(0.0);
    vec2 p = w.xy - flow * u_time;
    vec2 g = vec2(0.0);
    g += vec2(cos(p.x * 1.7 + u_time * 1.3), cos(p.y * 1.9 - u_time * 1.1)) * 0.05;
    g += vec2(cos((p.x + p.y) * 3.1 + u_time * 2.1), cos((p.x - p.y) * 2.7 - u_time * 1.7)) * 0.03;
    g += (vec2(vnoise(p * 2.3 + u_time * 0.4), vnoise(p.yx * 2.3 - u_time * 0.4)) - 0.5) * 0.12;
    vec3 n = normalize(vec3(-g, 1.0));
    vec3 view = normalize(u_camPos - w);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
    vec3 r = reflect(-view, n);
    r.z = abs(r.z);
    vec3 sky = atmoSky(w.z, r);
    vec3 deep = vec3(0.07, 0.24, 0.27) * (u_skyColor * 0.8 + u_sunColor * 0.3);
    vec3 color = mix(deep, sky, fres);
    color += u_sunColor * pow(max(dot(r, u_sunDirection), 0.0), 220.0) * 3.0 * labShadow(w, vec3(0.0, 0.0, 1.0));
    // foam along the bank (and churned white in a stream)
    float foam = smoothstep(0.55, 1.0, v_flow.w) * smoothstep(0.35, 0.7, vnoise(p * 3.0 + u_time * 0.6));
    foam = max(foam, v_flow.z > 0.5 ? smoothstep(0.62, 0.85, vnoise(p * 1.4)) * 0.6 : 0.0);
    color = mix(color, (u_sunColor + u_skyColor) * 0.85, foam);
    float alpha = mix(0.82, 0.98, fres) * (1.0 - smoothstep(0.9, 1.0, v_flow.w) * 0.6);
    gl_FragColor = vec4(atmoAerial(color, w), alpha);
}
`;

const fallVertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform mat4 u_model;
uniform float u_time;
varying vec3 v_world;
varying vec2 v_uv;
varying vec3 v_normal;
void main() {
    vec3 p = a_position;
    // the sheet sways a little in the wind as it falls
    p.xy += vec2(sin(u_time * 0.7 + a_uv.y * 6.0), cos(u_time * 0.6 + a_uv.y * 5.0)) * a_uv.y * 1.4;
    vec4 w = u_model * vec4(p, 1.0);
    v_world = w.xyz;
    v_uv = a_uv;
    v_normal = a_normal;
    gl_Position = projectLab(w.xyz);
}
`;
const fallFragment = /* glsl */ `
${header()}
uniform float u_time;
varying vec3 v_world;
varying vec2 v_uv;
varying vec3 v_normal;
void main() {
    float u = v_uv.x, v = v_uv.y;
    // streaks of foam running down, faster lower down, breaking into blobs toward the bottom
    float s = fbm(vec2(u * 12.0, v * 26.0 - u_time * (3.0 + v * 4.0)));
    float s2 = vnoise(vec2(u * 30.0, v * 55.0 - u_time * 7.0));
    float edge = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u);
    float body = edge * smoothstep(0.25, 0.75, s * 0.75 + s2 * 0.35) * (1.0 - smoothstep(0.5, 1.0, v) * (0.5 + 0.5 * s2));
    if (body < 0.04) discard;
    vec3 albedo = mix(vec3(0.62, 0.8, 0.88), vec3(0.97, 0.98, 1.0), smoothstep(0.35, 0.75, s + s2 * 0.3));
    vec3 color = paint(albedo, v_world, normalize(v_normal + vec3(0.0, 0.0, 0.3)), 0.6, 0.5);
    gl_FragColor = vec4(atmoAerial(color, v_world), clamp(body * 1.25, 0.0, 0.92));
}
`;

export function waterMaterials() {
    return {
        still: track(new ShaderMaterial({ name: "water", vertex: stillVertex, fragment: stillFragment, uniforms: withShared(), transparent: true, depthWrite: false, cull: "none" })),
        fall: track(new ShaderMaterial({ name: "waterfall", vertex: fallVertex, fragment: fallFragment, uniforms: withShared(), transparent: true, depthWrite: false, cull: "none" })),
    };
}
