import { ShaderMaterial, projectionChunk } from "../engine/index.js";

/**
 * Spacetime fabric: a dense grid whose height is the gravitational potential of every body, so wells
 * form under planets and bumps under pulsars. The same formula runs on the CPU (wellDepth) so objects
 * can sit exactly on the surface.
 *
 *     depth(x, y) = −K · Σ m_i / √(r_i² + S²)      clamped to −MAX_DEPTH
 * @module game/fabric
 */
export const FABRIC = Object.freeze({ K: 0.034, S: 1.25, MAX_DEPTH: 3.2, MAX_BODIES: 12 });

/** CPU twin of the vertex shader. `bodies`: [{ px, py, mass }] */
export function wellDepth(x, y, bodies) {
    let d = 0;
    for (const b of bodies) {
        const dx = x - b.px, dy = y - b.py;
        d -= (FABRIC.K * b.mass) / Math.sqrt(dx * dx + dy * dy + FABRIC.S * FABRIC.S);
    }
    return Math.max(-FABRIC.MAX_DEPTH, d);
}

const vertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
uniform vec4 u_bodies[${FABRIC.MAX_BODIES}];   // x, y, mass, unused
uniform float u_bodyCount;
varying vec3 v_world;
varying float v_depth;
varying float v_edge;
void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    float d = 0.0;
    for (int i = 0; i < ${FABRIC.MAX_BODIES}; i++) {
        if (float(i) >= u_bodyCount) break;
        vec2 delta = world.xy - u_bodies[i].xy;
        d -= ${FABRIC.K.toFixed(4)} * u_bodies[i].z / sqrt(dot(delta, delta) + ${(FABRIC.S * FABRIC.S).toFixed(4)});
    }
    d = max(d, -${FABRIC.MAX_DEPTH.toFixed(2)});
    world.z += d;
    v_world = world.xyz;
    v_depth = d;
    // fade out toward the rim of the sheet so it melts into space
    vec2 q = abs(a_position.xy) / vec2(${(20).toFixed(1)}, ${(13).toFixed(1)});
    v_edge = 1.0 - smoothstep(0.62, 1.0, max(q.x, q.y));
    gl_Position = projectLab(world.xyz);
}
`;

const fragment = /* glsl */ `
uniform vec3 u_camPos;
uniform vec3 u_lineA;      // colour of flat space
uniform vec3 u_lineB;      // colour deep in a well
uniform vec3 u_bump;       // colour on pulsar bumps
uniform float u_time;
uniform float u_intensity;
varying vec3 v_world;
varying float v_depth;
varying float v_edge;

float gridLine(float coord, float spacing, float width) {
    float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(0.0, width, d);
}

void main() {
    // lines thicken slightly with distance so far lines don't shimmer
    float dist = length(u_camPos - v_world);
    float w = 0.018 + dist * 0.0009;
    float major = max(gridLine(v_world.x, 2.0, w), gridLine(v_world.y, 2.0, w));
    float minor = max(gridLine(v_world.x, 0.5, w * 0.7), gridLine(v_world.y, 0.5, w * 0.7)) * 0.28;
    float line = max(major, minor);
    float well = clamp(-v_depth / 2.2, 0.0, 1.0);
    float bump = clamp(v_depth * 2.0, 0.0, 1.0);
    vec3 col = mix(u_lineA, u_lineB, well);
    col = mix(col, u_bump, bump);
    // a slow ripple travelling outward from the centre of each well
    float ripple = 0.5 + 0.5 * sin(v_depth * 9.0 - u_time * 1.6);
    float glow = line * (0.62 + well * 1.5 + bump * 1.2) * (0.8 + 0.2 * ripple);
    float alpha = glow * v_edge * u_intensity;
    gl_FragColor = vec4(col * alpha, alpha);
}
`;

export function createFabricMaterial() {
    return new ShaderMaterial({
        name: "orbital-fabric", vertex, fragment,
        transparent: true, blending: "additive", depthWrite: false, cull: "none",
        uniforms: {
            u_bodies: new Float32Array(FABRIC.MAX_BODIES * 4),
            u_bodyCount: 0,
            u_lineA: new Float32Array([0.2, 0.42, 0.95]),
            u_lineB: new Float32Array([0.62, 0.42, 1.6]),
            u_bump: new Float32Array([1.4, 0.45, 0.9]),
            u_intensity: 1,
        },
    });
}
