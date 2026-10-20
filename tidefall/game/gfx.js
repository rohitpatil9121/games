import { ShaderMaterial, Texture, projectionChunk, lightingChunk } from "../engine/index.js";
import { TIDE } from "./data.js";

/**
 * TIDEFALL: the island's materials (the `shader-programming`, `threejs-shaders`, `threejs-materials` and
 * `threejs-lighting` skills, translated to Projection Lab's ShaderMaterial and its lighting chunk).
 *
 * terrainMaterial  sand, grass and rock by height and slope, detail noise from the world position, and the
 *                  sea's marks on it: sand darkens and shines where the water was a moment ago and dries
 *                  as the line moves (u_wet is the highest the water has been lately, falling slowly);
 *                  a band of foam at the waterline; under water, light caustics that fade with depth and
 *                  a blue-green absorption.
 * waterMaterial    a grid that moves with the camera. Small waves in the vertex shader; in the fragment,
 *                  the depth to the sea floor read from a height texture (16 bits in two bytes, bilinear by
 *                  hand) gives the colour (turquoise shallows, deep blue), the opacity (clear in the
 *                  shallows, so caustics show through) and the shore foam. Fresnel against the sky, a sun
 *                  glint. Seen from below it is a bright rippled ceiling.
 * stoneMaterial    ruins and the wreck: block courses or planks from the world position (no UVs), moss on
 *                  top faces, the tide marks (wet and darker below high water, a green band of weed, a
 *                  crust of barnacles near the bottom), and the same caustics under water.
 * skyMaterial      a dome: horizon to zenith gradient that warms to sunset over the match, and the sun.
 * @module game/gfx
 */

const noise = /* glsl */ `
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 13.1) * 0.3 + vnoise(p * 4.3 + 7.7) * 0.15; }
// light focused by the waves onto the floor: two layers of warped, sharpened sine nets, drifting
float caustics(vec2 p, float t) {
    vec2 q = p * 0.55;
    float a = sin(q.x * 2.1 + sin(q.y * 1.7 + t * 0.9) + t * 0.6) * sin(q.y * 2.3 + sin(q.x * 1.3 - t * 0.7) - t * 0.5);
    float b = sin(q.x * 3.7 - t * 0.8 + sin(q.y * 2.9)) * sin(q.y * 3.1 + t * 0.9 + sin(q.x * 2.2));
    return pow(abs(a), 6.0) * 0.9 + pow(abs(b), 8.0) * 0.6;
}
`;

const worldVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_color;
uniform mat4 u_model;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_tint;
void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    v_world = world.xyz;
    v_normal = mat3(u_model) * a_normal;
    v_tint = a_color;
    gl_Position = projectLab(world.xyz);
}
`;

/** what the sea does to anything lit: shared by terrain and stone */
const seaLight = /* glsl */ `
uniform float u_level;
uniform float u_wet;
uniform float u_time;         // set by the engine
uniform float u_under;       // 1 when the camera is under water
vec3 seaShade(vec3 albedo, vec3 world, vec3 n, inout vec3 light) {
    float depth = u_level - world.z;
    if (depth > 0.0) {
        // light reaching the floor through the water: absorbed, red first, then focused into caustics
        float k = exp(-depth * 0.22);
        light *= mix(vec3(0.25, 0.55, 0.62), vec3(1.0), k);
        light += u_sunColor * caustics(world.xy, u_time) * 1.3 * exp(-depth * 0.32) * max(n.z, 0.0);
    }
    return albedo;
}
`;

const terrainFragment = /* glsl */ `
${lightingChunk}
${noise}
${seaLight}
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_tint;
void main() {
    vec3 w = v_world;
    float grain = fbm(w.xy * 0.35), fine = vnoise(w.xy * 3.1);
    float r = length(w.xy);
    // bumps: wind ripples in the sand, a coarser roll on the floor, by the gradient of a height pattern
    float ripple = sin(w.x * 1.9 + sin(w.y * 0.6) * 2.2 + fine * 1.5);
    vec2 bump = vec2(cos(w.x * 1.9 + sin(w.y * 0.6) * 2.2 + fine * 1.5) * 1.9, cos(w.x * 1.9 + sin(w.y * 0.6) * 2.2) * 1.32 * cos(w.y * 0.6)) * 0.07;
    bump += (vec2(vnoise(w.xy * 1.3 + 0.1), vnoise(w.yx * 1.3 + 3.3)) - 0.5) * 0.18;
    vec3 n = normalize(normalize(v_normal) + vec3(-bump, 0.0) * smoothstep(0.75, 0.95, v_normal.z));
    // sand: pale and warm above the sea, darker and cooler on the floor
    vec3 sand = mix(vec3(0.88, 0.75, 0.52), vec3(0.74, 0.61, 0.42), grain);
    vec3 floorSand = mix(vec3(0.74, 0.69, 0.55), vec3(0.62, 0.64, 0.53), grain);
    vec3 grass = mix(vec3(0.34, 0.55, 0.22), vec3(0.47, 0.62, 0.27), fbm(w.xy * 0.12 + 4.0));
    vec3 rock = mix(vec3(0.46, 0.42, 0.38), vec3(0.58, 0.54, 0.48), fine);
    float grassy = smoothstep(2.6, 3.8, w.z + grain * 1.2) * (1.0 - smoothstep(50.0, 56.0, r));
    vec3 albedo = mix(floorSand, sand, smoothstep(-2.0, 0.5, w.z + grain));
    albedo = mix(albedo, grass, grassy);
    // dry rocks that stand above high water, and anything steep, are bare rock
    float steep = 1.0 - smoothstep(0.62, 0.8, n.z);
    // the rocks out in the sea (anything standing above the beach beyond the plateau) are bare stone
    albedo = mix(albedo, rock * (0.85 + grain * 0.3), max(steep, smoothstep(${(TIDE.high - 0.6).toFixed(2)}, ${(TIDE.high + 0.4).toFixed(2)}, w.z) * smoothstep(54.0, 58.0, r)));
    albedo *= 0.94 + fine * 0.12;
    // ripples in the sand: their crests catch the light
    albedo *= 1.0 - 0.07 * smoothstep(0.2, 1.0, ripple) * (1.0 - grassy);

    // the sea's marks: wet where the water has just been, a foam line at its edge
    float wet = (1.0 - smoothstep(u_wet - 0.05, u_wet + 0.25, w.z)) * step(u_level - 0.02, w.z);
    albedo *= 1.0 - 0.38 * wet;
    vec3 light = labLight(w, n);
    vec3 view = normalize(u_camPos - w);
    light += u_sunColor * pow(max(dot(n, normalize(view + u_sunDirection)), 0.0), 60.0) * 0.22 * wet * labShadow(w, n);
    albedo = seaShade(albedo, w, n, light);
    vec3 color = albedo * light;
    float edge = abs(w.z - u_level);
    float foam = (1.0 - smoothstep(0.01, 0.08 + 0.05 * sin(u_time * 1.5 + w.x * 0.4), edge)) * smoothstep(0.35, 0.7, vnoise(w.xy * 2.5 + u_time * 0.4));
    color = mix(color, vec3(1.0, 1.0, 0.98) * (0.7 + 0.5 * max(dot(n, u_sunDirection), 0.0)), foam * 0.85 * (1.0 - u_under));
    gl_FragColor = vec4(labFog(color, w), 1.0);
}
`;

const stoneFragment = /* glsl */ `
${lightingChunk}
${noise}
${seaLight}
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_tint;
float seam(float c, float spacing, float width) { float d = abs(fract(c / spacing + 0.5) - 0.5) * spacing; return 1.0 - smoothstep(width * 0.5, width, d); }
void main() {
    vec3 n = normalize(v_normal), a = abs(n), w = v_world;
    // the two world axes this face lies in
    vec2 uv = a.z > 0.5 ? w.xy : (a.x > a.y ? w.yz : w.xz);
    float wood = step(0.5, v_tint.a) * step(v_tint.a, 0.75);
    float camp = step(0.75, v_tint.a);
    vec3 albedo = v_tint.rgb;
    float lines;
    if (wood > 0.5) {
        // planks along the hull, with grain
        lines = seam(uv.y, 0.32, 0.03);
        albedo *= 0.85 + 0.25 * vnoise(vec2(uv.x * 0.6, floor(uv.y / 0.32) * 7.0)) + 0.06 * sin(uv.x * 30.0 + vnoise(uv * 3.0) * 6.0);
    } else {
        // stone courses, each block a little different, with chipped corners
        float row = floor(uv.y / 0.55);
        float shift = mod(row, 2.0) * 0.6;
        lines = max(seam(uv.y, 0.55, 0.05), seam(uv.x + shift, 1.2, 0.05) * step(a.z, 0.5));
        albedo *= 0.9 + 0.22 * hash2(vec2(floor((uv.x + shift) / 1.2), row)) + 0.06 * vnoise(uv * 4.0);
    }
    albedo *= 1.0 - lines * 0.25 * (1.0 - camp);
    // moss on top faces, more of it near the high-water mark
    float moss = smoothstep(0.7, 0.95, n.z) * smoothstep(0.35, 0.65, fbm(w.xy * 0.7)) * (1.0 - camp);
    albedo = mix(albedo, vec3(0.3, 0.45, 0.2), moss * 0.8);
    // tide marks: below high water it is wet and dark; a green weed band; barnacles low down
    float below = 1.0 - smoothstep(${(TIDE.high - 0.1).toFixed(2)}, ${(TIDE.high + 0.15).toFixed(2)}, w.z);
    albedo *= 1.0 - 0.14 * below * (1.0 - camp);
    float weed = smoothstep(0.0, 0.8, ${TIDE.high.toFixed(2)} - w.z) * (1.0 - smoothstep(0.8, 2.2, ${TIDE.high.toFixed(2)} - w.z));
    albedo = mix(albedo, vec3(0.22, 0.36, 0.2), weed * 0.45 * (0.5 + 0.5 * vnoise(w.xy * 1.5 + w.z)) * (1.0 - camp));
    // barnacles: small pale dots low on stone (not on the wreck's planks)
    float barnacle = smoothstep(0.72, 0.82, vnoise(uv * 14.0)) * (1.0 - smoothstep(-3.0, -1.0, w.z)) * (1.0 - camp) * (1.0 - wood);
    albedo = mix(albedo, vec3(0.74, 0.72, 0.66), barnacle * 0.35);
    float wet = (1.0 - smoothstep(u_wet - 0.05, u_wet + 0.2, w.z)) * step(u_level - 0.02, w.z);
    albedo *= 1.0 - 0.18 * wet;
    vec3 light = labLight(w, n);
    vec3 view = normalize(u_camPos - w);
    light += u_sunColor * pow(max(dot(n, normalize(view + u_sunDirection)), 0.0), 30.0) * (0.15 + 0.5 * wet) * labShadow(w, n);
    albedo = seaShade(albedo, w, n, light);
    gl_FragColor = vec4(labFog(albedo * light, w), 1.0);
}
`;

/**
 * Breakers: bands that roll toward the shore over the shallows. Depth stands in for distance from the
 * beach, so the phase runs on depth; a band only exists between 0.15 and 2.4 m of water and is strongest
 * just before it reaches the sand, where it rises, then spills (a sharp front, a long soft back).
 */
const breakers = /* glsl */ `
float breakPhase(vec2 p, float depth, float t) {
    float wobble = sin(p.x * 0.09 + p.y * 0.05) * 0.7 + sin(p.y * 0.13 - p.x * 0.04) * 0.5;
    return depth * 1.25 + t * 0.55 + wobble;
}
float breaker(vec2 p, float depth, float t) {
    float f = fract(breakPhase(p, depth, t));
    float shape = smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.07, 0.42, f));
    float zone = smoothstep(0.12, 0.45, depth) * (1.0 - smoothstep(1.2, 2.4, depth));
    return shape * zone;
}
float breakerTrail(vec2 p, float depth, float t) {
    float f = fract(breakPhase(p, depth, t));
    float zone = smoothstep(0.05, 0.3, depth) * (1.0 - smoothstep(1.0, 2.2, depth));
    return (1.0 - smoothstep(0.07, 0.9, f)) * step(0.07, f) * zone;
}
`;

const waterVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
uniform float u_level;
uniform float u_time;
uniform float u_waves;
uniform sampler2D u_height;
uniform vec4 u_heightMap;
varying vec3 v_world;
varying vec2 v_slope;
varying float v_crest;
float floorAtV(vec2 xy) {
    float n = u_heightMap.w;
    vec2 f = clamp((xy - u_heightMap.xy) / u_heightMap.z, vec2(0.0), vec2(n - 1.0));
    vec4 t = texture2D(u_height, (floor(f) + 0.5) / n);
    return (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * 32.0 - 16.0;
}
${breakers}
// a few travelling waves; returns the height and its slope
vec3 waves(vec2 p, float t) {
    vec3 r = vec3(0.0);
    vec4 dirs[4];
    dirs[0] = vec4(0.8, 0.6, 0.18, 1.1); dirs[1] = vec4(-0.4, 0.92, 0.27, 0.9); dirs[2] = vec4(0.95, -0.3, 0.4, 1.4); dirs[3] = vec4(-0.7, -0.7, 0.75, 1.9);
    for (int i = 0; i < 4; i++) {
        vec2 d = dirs[i].xy; float k = dirs[i].z, sp = dirs[i].w, amp = 0.07 / (1.0 + float(i) * 0.6);
        float ph = dot(d, p) * k + t * sp;
        r.x += sin(ph) * amp;
        r.yz += d * cos(ph) * amp * k;
    }
    return r;
}
void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    vec3 w = waves(world.xy, u_time) * u_waves;
    float depth = u_level - floorAtV(world.xy);
    float crest = breaker(world.xy, depth, u_time);
    v_crest = crest;
    world.z = u_level + w.x + crest * 0.22 * u_waves;
    v_slope = w.yz;
    v_world = world.xyz;
    gl_Position = projectLab(world.xyz);
}
`;

const waterFragment = /* glsl */ `
${lightingChunk}
${noise}
uniform sampler2D u_height;
uniform vec4 u_heightMap;     // x0, y0, cell, samples per side
uniform float u_level;
uniform float u_time;
uniform float u_under;
uniform float u_quality;      // 0 low (no foam noise, no glint), 1 high
varying vec3 v_world;
varying vec2 v_slope;
varying float v_crest;
${breakers}
float decode(vec2 p) {
    vec4 t = texture2D(u_height, p);
    return (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * 32.0 - 16.0;
}
// the sea floor's height under a point, bilinear between texels by hand (each texel is 16 bits in two bytes)
float floorAt(vec2 xy) {
    float n = u_heightMap.w;
    vec2 f = (xy - u_heightMap.xy) / u_heightMap.z;
    if (f.x < 0.0 || f.y < 0.0 || f.x > n - 1.0 || f.y > n - 1.0) return -14.0;
    vec2 i = floor(f), t = f - i;
    vec2 px = 1.0 / vec2(n);
    vec2 c = (i + 0.5) * px;
    float a = decode(c), b = decode(c + vec2(px.x, 0.0)), d = decode(c + vec2(0.0, px.y)), e = decode(c + px);
    return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}
void main() {
    vec3 w = v_world;
    float depth = u_level - floorAt(w.xy);
    if (depth < -0.05) discard;
    vec3 n = normalize(vec3(-v_slope.x, -v_slope.y, 1.0) + vec3((vnoise(w.xy * 1.7 + u_time * 0.6) - 0.5) * 0.12 * u_quality, (vnoise(w.yx * 1.9 - u_time * 0.5) - 0.5) * 0.12 * u_quality, 0.0));
    vec3 view = normalize(u_camPos - w);
    vec3 shallow = vec3(0.16, 0.66, 0.66), deep = vec3(0.03, 0.2, 0.36);
    float d = 1.0 - exp(-max(depth, 0.0) * 0.28);
    vec3 body = mix(shallow, deep, d) * (0.45 + 0.55 * max(u_sunDirection.z, 0.15)) * (u_sunColor * 0.45 + u_skyColor * 0.7);
    if (u_under > 0.5) {
        // from below: the surface is a bright, rippled ceiling
        float glow = 0.7 + 0.5 * caustics(w.xy * 1.3, u_time);
        vec3 ceiling = mix(vec3(0.12, 0.5, 0.52), u_sunColor * vec3(0.6, 0.9, 0.9), 0.25) * glow;
        gl_FragColor = vec4(labFog(ceiling, w), 0.9);
        return;
    }
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
    vec3 sky = mix(u_skyColor * 1.25, u_fog.rgb, 0.4);
    vec3 color = mix(body, sky, fres * 0.85);
    float sun = pow(max(dot(reflect(-u_sunDirection, n), view), 0.0), 220.0) * 6.0 * u_quality + pow(max(dot(reflect(-u_sunDirection, n), view), 0.0), 18.0) * 0.18;
    color += u_sunColor * sun * labShadow(w, vec3(0.0, 0.0, 1.0));
    // breakers rolling in over the shallows: a white crest with a ragged front and churned water behind it
    float crest = max(v_crest, breaker(w.xy, depth, u_time));
    float churn = breakerTrail(w.xy, depth, u_time) * u_quality;
    float rag = smoothstep(0.3, 0.75, vnoise(w.xy * vec2(2.4, 1.1) + u_time * 0.5));
    color = mix(color, vec3(0.97, 0.99, 1.0) * (0.75 + 0.35 * max(u_sunDirection.z, 0.0)), clamp(crest * (0.55 + 0.45 * rag) + churn * 0.35 * rag, 0.0, 0.92));
    // foam where the water is thin: at the shore and around anything standing in it
    float edge = 1.0 - smoothstep(0.0, 0.35 + 0.15 * sin(u_time * 1.3 + w.x * 0.3 + w.y * 0.2), depth);
    float foam = edge * mix(1.0, smoothstep(0.35, 0.65, vnoise(w.xy * 3.0 + vec2(u_time * 0.3, -u_time * 0.2))), u_quality);
    color = mix(color, vec3(0.95, 0.98, 1.0) * (0.6 + 0.4 * max(u_sunDirection.z, 0.0)), foam * 0.8);
    // clear in the shallows (the floor and its caustics show through), opaque in the deep
    float alpha = clamp(0.32 + d * 0.75 + fres * 0.3 + foam * 0.6 + crest * 0.5, 0.0, 0.96);
    gl_FragColor = vec4(labFog(color, w), alpha);
}
`;

const skyVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
varying vec3 v_dir;
void main() {
    v_dir = a_position;
    gl_Position = projectLab((u_model * vec4(a_position, 1.0)).xyz);
}
`;
const skyFragment = /* glsl */ `
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform float u_sunset;     // 0 midday .. 1 sunset
uniform float u_under;
varying vec3 v_dir;
void main() {
    vec3 d = normalize(v_dir);
    float h = max(d.z, 0.0);
    vec3 zenith = mix(vec3(0.22, 0.45, 0.78), vec3(0.18, 0.2, 0.42), u_sunset);
    vec3 horizon = mix(vec3(0.72, 0.85, 0.94), vec3(1.0, 0.58, 0.32), u_sunset);
    vec3 color = mix(horizon, zenith, pow(h, 0.55));
    float toward = max(dot(d, u_sunDirection), 0.0);
    color += u_sunColor * (pow(toward, 900.0) * 18.0 + pow(toward, 12.0) * 0.35 * (0.4 + u_sunset));
    // below the horizon: the far sea
    if (d.z < 0.0) color = mix(horizon * vec3(0.55, 0.75, 0.85), vec3(0.04, 0.22, 0.34), min(1.0, -d.z * 6.0));
    gl_FragColor = vec4(color, 1.0);
}
`;

/** every material that shows the sea; setSea() writes the same values into each */
const seaMaterials = new Set();
/** The sea's state this frame: water level, the wet line, whether the camera is under. */
export function setSea(level, wet, under) {
    for (const m of seaMaterials) { m.values.u_level = level; m.values.u_wet = wet; m.values.u_under = under; }
}
const seaValues = (extra = {}) => ({ u_level: 0, u_wet: 0, u_under: 0, ...extra });

export function terrainMaterial() {
    const m = new ShaderMaterial({ name: "tide-terrain", vertex: worldVertex, fragment: terrainFragment, uniforms: seaValues() });
    seaMaterials.add(m);
    return m;
}
export function stoneMaterial() {
    const m = new ShaderMaterial({ name: "tide-stone", vertex: worldVertex, fragment: stoneFragment, uniforms: seaValues() });
    seaMaterials.add(m);
    return m;
}

/** The island's heights as a texture: 16 bits per sample in red and green. */
export function heightTexture(island) {
    const n = island.n, data = new Uint8Array(n * n * 4);
    for (let k = 0; k < n * n; k++) {
        const v = Math.max(0, Math.min(65535, Math.round(((island.heights[k] + 16) / 32) * 65535)));
        data[k * 4] = v >> 8; data[k * 4 + 1] = v & 255; data[k * 4 + 3] = 255;
    }
    return new Texture({ data, width: n, height: n, wrap: "clamp", filter: "nearest", mipmaps: false, name: "heights" });
}

export function waterMaterial(island) {
    const values = seaValues({ u_height: heightTexture(island), u_heightMap: new Float32Array([-island.half, -island.half, island.cell, island.n]), u_waves: 1, u_quality: 1 });
    const m = new ShaderMaterial({ name: "tide-water", vertex: waterVertex, fragment: waterFragment, uniforms: values, transparent: true, depthWrite: false, cull: "none" });
    seaMaterials.add(m);
    return m;
}
/** Forget the materials of an island that is gone. */
export function dropSeaMaterials() { seaMaterials.clear(); }

export function skyMaterial() {
    return new ShaderMaterial({ name: "tide-sky", vertex: skyVertex, fragment: skyFragment, uniforms: { u_sunset: 0, u_under: 0 }, cull: "none", depthWrite: false });
}
