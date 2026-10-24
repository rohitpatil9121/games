import { projectionChunk, lightingChunk } from "../../engine/index.js";
import { atmosphereChunk, makeAtmoUniforms } from "./atmosphere.js";

/**
 * SKYFARM: what every material in the look shares.
 *
 *   noise       value noise and fbm in 2D and 3D (GLSL; the same lattice idea as islands.js on the CPU)
 *   wind        one wind field for grass, flowers, leaves, vines and cloth: a steady lean plus gust fronts
 *               that travel across the island along the wind direction (the `threejs-procedural-vegetation`
 *               skill's gust fronts), so a field ripples in bands instead of every blade swaying in place
 *   paint       the painterly light: sun with a wrapped falloff and coloured (never black) shadows, sky light
 *               from above and warm bounce from below, then the atmosphere's haze. Ghibli light is soft-edged
 *               and colourful in shadow, so the wrap and the shadow tint matter more than specular
 *
 * One uniform block (`shared`) holds the atmosphere and the wind for every material, so they can't disagree.
 * @module game/gfx/common
 */

export const shared = {
    ...makeAtmoUniforms(),
    /** wind: xy direction (unit), strength 0..1, gust speed m/s */
    u_wind: new Float32Array([0.8, 0.6, 0.5, 6]),
    /** the player's feet (grass bends away), and how hard (0 when gliding high) */
    u_player: new Float32Array([0, 0, -1000, 1]),
    /** cool tint for shadowed sides (GDD §0: blue-leaning shadows) */
    u_shadowTint: new Float32Array([0.92, 0.94, 1.02]),
    /** quality: 0 low, 1 medium, 2 high */
    u_quality: 1,
    /** weather (the `threejs-precipitation-surfaces` skill's shared weather envelope): how wet every surface is
     *  (rises while it rains, dries after), how stormy the sky is, a lightning flash */
    u_wet: 0,
    u_storm: 0,
    u_flash: 0,
};

const users = new Set();
/**
 * A material's uniform values with the shared block in them. Arrays are shared by reference; numbers are
 * copied into every user by syncShared() once a frame.
 */
export function withShared(values = {}, material) {
    const v = Object.assign({}, shared, values);
    if (material) users.add(material);
    return v;
}
/** Register a ShaderMaterial built with withShared() so its number uniforms follow `shared`. */
export function track(material) { users.add(material); return material; }
/** Copy the shared number uniforms (night, quality) into every material. Call once a frame. */
export function syncShared() {
    for (const m of users) for (const k in shared) if (typeof shared[k] === "number") m.values[k] = shared[k];
}

export const noiseChunk = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
    float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
    return mix(a, b, u.z);
}
float fbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03 + 17.1) * 0.3 + vnoise(p * 4.1 + 7.7) * 0.2; }
float fbm3(vec3 p) { return vnoise3(p) * 0.55 + vnoise3(p * 2.1 + 11.3) * 0.3 + vnoise3(p * 4.3 + 5.1) * 0.15; }
`;

export const windChunk = /* glsl */ `
uniform vec4 u_wind;     // dir.xy, strength, gust speed
uniform vec4 u_player;   // feet xyz, push strength
/** how hard the wind leans things at this point now: 0..~1.6, with gust fronts running along the wind */
float windAt(vec2 p, float t) {
    float along = dot(p, u_wind.xy);
    float front = sin(along * 0.11 - t * u_wind.w * 0.11) * 0.5 + 0.5;
    float gust = pow(front, 3.0) * (0.6 + 0.8 * vnoise(p * 0.035 + vec2(t * 0.05, 0.0)));
    float flutter = vnoise(p * 0.9 + vec2(t * 1.7, t * 1.1)) - 0.5;
    return u_wind.z * (0.35 + gust * 1.1) + flutter * 0.25 * u_wind.z;
}
/** bend a point of a rooted plant: h = height above its root (m), stiff = 0..1. Returns the offset. */
vec3 windBend(vec3 root, float h, float stiff, float t) {
    float w = windAt(root.xy, t) * (1.0 - stiff);
    vec2 d = u_wind.xy * w;
    // the player's feet push nearby grass aside
    vec2 away = root.xy - u_player.xy;
    float pd = length(away);
    float push = u_player.w * (1.0 - smoothstep(0.3, 1.2, pd)) * step(abs(root.z - u_player.z), 1.5);
    d += (pd > 1e-3 ? away / pd : vec2(0.0)) * push * 1.4;
    float k = h * h;
    // keep the length: bending over sinks the tip
    return vec3(d * k, -dot(d, d) * k * h * 0.35);
}
`;

export const paintChunk = /* glsl */ `
uniform vec3 u_shadowTint;
uniform float u_wet;
uniform float u_flash;
/**
 * Painterly light. n: shading normal; wrap: 0 = Lambert, 0.5 = very soft; sss: light through thin things
 * from behind (grass, leaves, cloth). Returns the lit colour before haze.
 */
vec3 paint(vec3 albedo, vec3 world, vec3 n, float wrap, float sss) {
    float nl = dot(n, u_sunDirection);
    float sun = clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0);
    float sh = labShadow(world, n);
    vec3 view = normalize(u_camPos - world);
    float back = pow(clamp(dot(-view, u_sunDirection), 0.0, 1.0), 3.0) * sss;
    vec3 direct = u_sunColor * (sun * sh + back * (0.35 + 0.65 * sh));
    float up = n.z * 0.5 + 0.5;
    vec3 ambient = mix(u_groundColor, u_skyColor, up);
    // shadowed sides lean cool, lit sides keep the sun's warmth
    vec3 tint = mix(u_shadowTint, vec3(1.0), sun * sh);
    // wet: everything darkens a little, and what faces the sky gets a sheen of the sky and the sun
    vec3 a = albedo * (1.0 - 0.28 * u_wet);
    vec3 color = a * (direct + ambient + vec3(0.75, 0.8, 1.0) * u_flash * 2.0) * tint;
    if (u_wet > 0.0) {
        vec3 r = reflect(-view, n);
        float up = smoothstep(0.3, 0.9, n.z);
        color += (u_skyColor * 0.12 + u_sunColor * pow(max(dot(r, u_sunDirection), 0.0), 60.0) * 0.8 * sh) * u_wet * up;
    }
    return color;
}
`;

/** the standard header for a world-space material: projection, lighting, atmosphere, noise, paint */
export const header = (withWind = false) => `${lightingChunk}\n${atmosphereChunk}\n${noiseChunk}\n${withWind ? windChunk : ""}\n${paintChunk}\n`;
export const vertexHeader = (withWind = false) => `${projectionChunk}\n${withWind ? noiseChunk + windChunk : ""}\n`;
