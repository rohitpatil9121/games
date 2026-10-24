import { Geometry, ShaderMaterial } from "../../engine/index.js";
import { header, vertexHeader, withShared, track } from "./common.js";

/**
 * SKYFARM: rain streaks (the `threejs-precipitation-surfaces` skill: a camera-relative box of drops that wraps,
 * so a few thousand streaks stand for all the rain in the sky). Each streak is one thin quad. Its seed places it
 * in the box; the vertex shader moves it down with the wind, wraps it round the camera, stretches it along
 * its fall and turns it to face the camera. `u_rain` (0..1) is how many of the streaks fall: a shower uses
 * half, a storm all of them, slanted harder by the wind. Lit by the sky, so they're pale by day and dark
 * at night, and they fade out near the camera and toward the box's edge, so the wrap never shows.
 * @module game/gfx/rain
 */

export const RAIN = Object.freeze({ COUNT: 5000, BOX: [40, 40, 26], LEN: 0.75, WIDTH: 0.012, FALL: 11 });

/** the streaks: four corners each; position is the seed (0..1 in the box), uv the corner, colour.r the density id */
export function rainGeometry() {
    const n = RAIN.COUNT, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 16), idx = new Uint16Array(n * 6);
    let s = 9301;
    const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) {
        const x = r(), y = r(), z = r(), id = r();
        for (let c = 0; c < 4; c++) {
            const v = i * 4 + c;
            pos.set([x, y, z], v * 3);
            uv.set([c & 1 ? 1 : -1, c >> 1], v * 2);
            col.set([id, 0, 0, 1], v * 4);
        }
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    return new Geometry({ name: "rain", positions: pos, uvs: uv, colors: col, indices: idx });
}

const vertex = /* glsl */ `
${vertexHeader()}
attribute vec3 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;
uniform float u_time;
uniform float u_rain;
uniform vec3 u_drift;
varying float v_alpha;
const vec3 BOX = vec3(${RAIN.BOX.map((v) => v.toFixed(1)).join(", ")});
void main() {
    vec3 vel = vec3(u_drift.xy, -${RAIN.FALL.toFixed(1)} * (1.0 + 0.3 * u_drift.z));
    // where it is now: fallen from its seed, wrapped into the box round the camera
    vec3 lo = u_camPos - BOX * vec3(0.5, 0.5, 0.35);
    vec3 p = mod(a_position * BOX + vel * u_time - lo, BOX) + lo;
    vec3 dir = normalize(vel);
    vec3 toCam = u_camPos - p;
    float d = length(toCam);
    vec3 side = normalize(cross(dir, toCam / max(d, 0.001)));
    // a streak a little wider far off, so it doesn't shimmer away to nothing
    p += -dir * ${RAIN.LEN.toFixed(2)} * a_uv.y + side * ${RAIN.WIDTH.toFixed(3)} * (1.0 + d * 0.04) * a_uv.x;
    // how many fall: the rest collapse to nothing
    float on = step(a_color.r, u_rain);
    vec3 edge = abs(p - (lo + BOX * 0.5)) / (BOX * 0.5);
    v_alpha = on * smoothstep(0.8, 2.5, d) * (1.0 - smoothstep(0.75, 1.0, max(edge.x, max(edge.y, edge.z)))) * (1.0 - a_uv.y * 0.6);
    gl_Position = on > 0.5 ? projectLab(p) : vec4(0.0, 0.0, -2.0, 1.0);
}
`;

const fragment = /* glsl */ `
${header()}
varying float v_alpha;
void main() {
    // pale streaks lit by the sky (and the lightning)
    vec3 c = (u_skyColor * 0.9 + u_sunColor * 0.15 + vec3(0.75, 0.8, 1.0) * u_flash) * 1.1 + 0.05;
    gl_FragColor = vec4(c, v_alpha * 0.35);
}
`;

export function rainMaterial() {
    return track(new ShaderMaterial({ name: "rain", vertex, fragment, uniforms: withShared({ u_time: 0, u_rain: 0, u_drift: new Float32Array([0, 0, 0]) }), transparent: true, depthWrite: false, cull: "none" }));
}
