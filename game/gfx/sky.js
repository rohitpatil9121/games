import { ShaderMaterial } from "../../engine/index.js";
import { atmosphereChunk } from "./atmosphere.js";
import { noiseChunk, withShared, track } from "./common.js";
import { projectionChunk } from "../../engine/index.js";

/**
 * SKYFARM: the sky dome. Its colour is the atmosphere's (atmosphere.js) looking out from the camera, so the
 * haze on far islands fades into exactly this. On top of it, painted only where it can't disagree with the
 * physics: the sun's disc with a soft limb, a few thin high streaks of cirrus that catch sunset colour, and
 * stars that come out as the sky darkens.
 * @module game/gfx/sky
 */

const vertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
varying vec3 v_dir;
void main() {
    v_dir = a_position;
    gl_Position = projectLab((u_model * vec4(a_position, 1.0)).xyz);
}
`;

const fragment = /* glsl */ `
uniform vec3 u_camPos;
uniform vec3 u_sunDirection;
uniform vec3 u_sunColor;
uniform float u_time;
${atmosphereChunk}
${noiseChunk}
varying vec3 v_dir;
void main() {
    vec3 d = normalize(v_dir);
    vec3 col = atmoSky(u_camPos.z, d);
    float c = dot(d, u_sunDirection);
    // the sun: a disc with a soft limb, and a bright core bloom can catch
    float disc = smoothstep(0.99955, 0.99975, c);
    col += u_atmoSun * disc * 14.0;
    // high cirrus: long thin streaks, lit by the same sun (warm at sunset), only above the horizon
    float h = d.z;
    if (h > 0.02) {
        // broad soft brush strokes stretched across the wind, not fine threads
        vec2 p = d.xy / (h + 0.3) * 1.2 + vec2(u_time * 0.003, 0.0);
        vec2 q = vec2(p.x * 0.35 + p.y * 0.2, p.y * 1.6 - p.x * 0.3);
        float streak = fbm(q + vec2(fbm(p * 0.7) * 0.8, 0.0));
        float cirrus = smoothstep(0.58, 0.85, streak) * smoothstep(0.04, 0.3, h) * 0.4;
        vec3 lit = u_atmoSun * (0.55 + 0.45 * pow(max(c, 0.0), 6.0)) + vec3(0.1, 0.12, 0.16);
        col = mix(col, lit * 0.9, cirrus);
    }
    // stars, when the sky is dark enough to show them
    float dark = u_atmoNight;
    if (dark > 0.01 && h > 0.0) {
        vec3 q = d * 420.0;
        float s = hash13(floor(q));
        float star = step(0.9965, s) * smoothstep(0.0, 0.25, h) * (0.6 + 0.4 * sin(u_time * 2.0 + s * 90.0));
        col += vec3(0.9, 0.92, 1.0) * star * dark * 1.6;
    }
    gl_FragColor = vec4(col, 1.0);
}
`;

export function skyMaterial() {
    return track(new ShaderMaterial({ name: "sky", vertex, fragment, uniforms: withShared(), cull: "none", depthWrite: false }));
}
