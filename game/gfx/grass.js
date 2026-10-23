import { Entity, Geometry, InstancedMesh, ShaderMaterial } from "../../engine/index.js";
import { topAt, inField, boxesAt } from "../islands.js";
import { header, vertexHeader, withShared, track } from "./common.js";
import { fieldsAt, makeFields } from "./fields.js";
import { makeRandom } from "../det.js";

/**
 * SKYFARM: grass and flowers (the `threejs-procedural-vegetation` skill: authored blade clusters, per-instance
 * origin and facing, rooted wind with gust fronts and tip flutter, colour clumps, macro variation, translucency,
 * distance tiers).
 *
 * A tuft is a handful of tapered, curved blades in one small mesh. Tufts are placed on a jittered grid per
 * 8 m chunk of an island, from the island's fields (fields.js): taller and greener in the meadow patches,
 * short and sparse on worn paths, none in the field, the hut or the shed. Each chunk is one instanced draw.
 *
 * Distance tiers: each chunk's instances are shuffled when built, so drawing the first N of them is an even
 * thinning. Every frame a chunk draws all of its tufts near the camera, fewer further out, none past the far
 * tier, where the ground's own baked colour (the same fields) carries the look.
 *
 * Shader: the blade bends from its root along the wind (common.js windBend, height²), the player's feet push
 * it aside, colour runs from a dark root to a yellow-green tip, light comes through it when the sun is behind
 * (translucency), and the shading normal is mostly the ground's, so a meadow lights as one soft surface
 * rather than a noise of blades (the Ghibli look). Flowers share the shader with a head colour.
 * @module game/gfx/grass
 */

export const GRASS = Object.freeze({
    chunk: 8,
    /** tufts per square metre at full meadow */
    density: { low: 2.6, medium: 4.2, high: 6.5 },
    /** distances where a chunk starts thinning, and where it stops drawing */
    near: { low: 14, medium: 20, high: 32 },
    far: { low: 32, medium: 46, high: 76 },
    blades: 7,
    segments: 3,
});

/** One tuft: blades in a small ring, leaning out, curved, tapered. uv.y = height along the blade (0 root, 1 tip). */
function tuftGeometry(seed, blades, segs) {
    const rand = makeRandom(seed), pos = [], nrm = [], uv = [], col = [], idx = [];
    for (let b = 0; b < blades; b++) {
        const a = (b / blades) * Math.PI * 2 + rand() * 0.8, off = 0.04 + rand() * 0.06;
        const ox = Math.cos(a) * off, oy = Math.sin(a) * off;
        const lean = 0.15 + rand() * 0.35, h = 0.65 + rand() * 0.45, w = 0.035 + rand() * 0.02;
        const face = a + Math.PI / 2 + (rand() - 0.5) * 0.8, fx = Math.cos(face), fy = Math.sin(face);
        const base = pos.length / 3, tint = 0.85 + rand() * 0.3;
        for (let s = 0; s <= segs; s++) {
            const t = s / segs, width = w * (1 - t * 0.92), bend = lean * t * t;
            const cx = ox + Math.cos(a) * bend, cy = oy + Math.sin(a) * bend, cz = h * t * (1 - lean * 0.25 * t);
            for (const side of [-1, 1]) {
                pos.push(cx + fx * width * side, cy + fy * width * side, cz);
                nrm.push(-fy, fx, 0.3);
                uv.push(side * 0.5 + 0.5, t);
                col.push(tint, tint, tint, rand());
            }
        }
        for (let s = 0; s < segs; s++) { const i = base + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    return new Geometry({ name: "tuft", positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), colors: new Float32Array(col), indices: new Uint16Array(idx) });
}

/** A flower: a thin stem and a five-petal head (uv.y: 0..0.8 stem, 1 head). */
function flowerGeometry() {
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const h = 0.42, w = 0.012;
    for (const [t, z] of [[0, 0], [0.8, h]]) for (const side of [-1, 1]) { pos.push(side * w, 0, z); nrm.push(0, -1, 0.3); uv.push(side * 0.5 + 0.5, t); col.push(1, 1, 1, 0); }
    idx.push(0, 1, 2, 1, 3, 2);
    const c = pos.length / 3;
    pos.push(0, 0, h + 0.01); nrm.push(0, 0, 1); uv.push(0.5, 1); col.push(1, 1, 1, 1);
    for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, r = k % 2 ? 0.035 : 0.07;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, h + (k % 2 ? 0.0 : -0.012)); nrm.push(0, 0, 1); uv.push(0.5, 1); col.push(1, 1, 1, 1);
    }
    for (let k = 0; k < 10; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 10));
    return new Geometry({ name: "flower", positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv), colors: new Float32Array(col), indices: new Uint16Array(idx) });
}

const vertex = /* glsl */ `
${vertexHeader(true)}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec4 a_color;
attribute mat4 a_instanceMatrix;
attribute vec4 a_instanceColor;
uniform mat4 u_model;
uniform float u_time;
uniform vec3 u_groundUp;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_tint;
varying vec2 v_uv;
varying float v_var;
void main() {
    mat4 m = u_model * a_instanceMatrix;
    vec3 root = m[3].xyz;
    vec3 w = (m * vec4(a_position, 1.0)).xyz;
    float h = w.z - root.z;
    w += windBend(root, h, a_color.a * 0.3, u_time + a_color.a * 0.7);
    v_world = w;
    // mostly the ground's normal (soft, unified meadow light), a little of the blade's own
    v_normal = normalize(mix(u_groundUp, normalize(mat3(m) * a_normal), 0.25));
    v_tint = a_instanceColor * vec4(a_color.rgb, 1.0);
    v_uv = a_uv;
    v_var = a_color.a;
    gl_Position = projectLab(w);
}
`;

const fragment = /* glsl */ `
${header(false)}
uniform float u_flower;       // 1 for the flower mesh
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_tint;
varying vec2 v_uv;
varying float v_var;
void main() {
    vec3 albedo;
    if (u_flower > 0.5 && v_uv.y > 0.9) albedo = v_tint.rgb;
    else {
        // a dark root (the blades shade each other), a yellow-green tip that catches the sun
        vec3 base = u_flower > 0.5 ? vec3(0.32, 0.5, 0.2) : v_tint.rgb;
        vec3 tip = mix(base * 1.2, vec3(0.7, 0.82, 0.34), 0.4 + v_var * 0.2);
        albedo = mix(base * 0.5, tip, smoothstep(0.0, 1.0, v_uv.y));
    }
    vec3 n = normalize(v_normal);
    vec3 color = paint(albedo, v_world, n, 0.5, u_flower > 0.5 ? 0.3 : 0.4 * v_uv.y);
    gl_FragColor = vec4(atmoAerial(color, v_world), 1.0);
}
`;

let shared = null;
/** one grass and one flower material for every island */
function materials() {
    if (!shared) shared = {
        material: track(new ShaderMaterial({ name: "grass", vertex, fragment, uniforms: withShared({ u_flower: 0, u_groundUp: new Float32Array([0, 0, 1]) }), cull: "none" })),
        flowerMat: track(new ShaderMaterial({ name: "flowers", vertex, fragment, uniforms: withShared({ u_flower: 1, u_groundUp: new Float32Array([0, 0, 1]) }), cull: "none" })),
    };
    return shared;
}

const FLOWER_COLORS = [[1.0, 0.97, 0.9], [1.0, 0.85, 0.3], [0.98, 0.62, 0.72], [0.55, 0.68, 1.0]];

/**
 * Build the grass and flowers of an island.
 * @param {object} isl the island
 * @param {object} world for the hut, shed, field and paths
 * @param {"low"|"medium"|"high"} quality
 * A generator (streaming, world.js): it yields after each chunk so building a big island never stalls a frame,
 * and returns the result when it's done. runSync() in world.js runs one straight through.
 * @returns {Generator<void, { entities: Entity[], update(eye): void, count: number, dispose(gl): void }>}
 */
export function* buildGrass(isl, world, quality = "medium", tint = [1, 1, 1]) {
    const d = world.data, f = makeFields(), C = GRASS.chunk, rand = makeRandom(isl.seed * 977 + 13);
    // the High Rocks are windswept: thinner grass
    const density = GRASS.density[quality] * (isl.band === "high" ? 0.55 : 1);
    const home = isl === world.islands[0];
    const { material, flowerMat } = materials();
    const tuft = tuftGeometry(isl.seed, GRASS.blades, GRASS.segments), flower = flowerGeometry();
    const blocked = (x, y) => {
        if (home && inField(world, Math.floor(x), Math.floor(y))) return true;
        const h = d.hut, s = d.shed;
        if (home) {
            if (Math.abs(x - h.x) < h.w / 2 + 0.3 && Math.abs(y - h.y) < h.d / 2 + 0.3) return true;
            if (Math.abs(x - s.x) < 1.4 && Math.abs(y - s.y) < 1.4) return true;
            if (d.tree && Math.hypot(x - d.tree.x, y - d.tree.y) < 1.6) return true;
        }
        for (const b of boxesAt(world, x, y)) if (b.kind !== "wall" && b.kind !== "roof" && x > b.x0 - 0.2 && x < b.x1 + 0.2 && y > b.y0 - 0.2 && y < b.y1 + 0.2) return true;
        // no grass in water
        if (isl.ponds) for (const p of isl.ponds) {
            const sx = p.x1 - p.x0, sy = p.y1 - p.y0, l2 = sx * sx + sy * sy, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - p.x0) * sx + (y - p.y0) * sy) / l2)) : 0;
            if (Math.hypot(x - p.x0 - sx * t, y - p.y0 - sy * t) < p.r + 0.3) return true;
        }
        return false;
    };
    const chunks = [], entities = [];
    const r = isl.reach;
    let count = 0;
    for (let cy = Math.floor((isl.y - r) / C); cy * C < isl.y + r; cy++) for (let cx = Math.floor((isl.x - r) / C); cx * C < isl.x + r; cx++) {
        const tufts = [], flowers = [];
        const step = 1 / Math.sqrt(density);
        for (let y = cy * C; y < (cy + 1) * C; y += step) for (let x = cx * C; x < (cx + 1) * C; x += step) {
            const px = x + rand() * step, py = y + rand() * step, z = topAt(isl, px, py);
            if (z === -Infinity || blocked(px, py)) continue;
            fieldsAt(isl, home ? d.paths || [] : [], px, py, f);
            if (f.inside < 0.25) continue;
            // sparse and short on paths and at the rim
            if (rand() < f.wear * 0.85 || rand() < f.edge * 0.5 || rand() < f.bare * 1.2) continue;
            const tall = (0.32 + 0.4 * f.meadow) * (1 - f.wear * 0.6) * (1 - f.edge * 0.4) * (0.8 + rand() * 0.4);
            // colour clumps: two greens from the palette, a dry-yellow streak now and then
            const g = f.meadow, dry = rand() < 0.08 ? 0.35 : 0;
            tufts.push([px, py, z - 0.02, tall, rand() * Math.PI * 2, (0.33 + 0.14 * g + dry * 0.3) * tint[0], (0.6 + 0.1 * g + dry * 0.08) * tint[1], (0.2 + 0.04 * g - dry * 0.04) * tint[2]]);
            if (f.flowers > 0 && rand() < f.flowers * 0.9) {
                const hue = FLOWER_COLORS[Math.min(3, Math.floor((f.hue + rand() * 0.25) * 4))];
                flowers.push([px + (rand() - 0.5) * step, py + (rand() - 0.5) * step, z - 0.02, 0.7 + rand() * 0.6, rand() * 6.28, ...hue]);
            }
        }
        if (!tufts.length) continue;
        // shuffle, so drawing the first N is an even thinning
        for (let i = tufts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [tufts[i], tufts[j]] = [tufts[j], tufts[i]]; }
        // instances are placed relative to the chunk's middle, which is the entity's position (the culling sphere)
        const ox = (cx + 0.5) * C, oy = (cy + 0.5) * C, oz = isl.top;
        const mesh = new InstancedMesh(tuft, material, tufts.length);
        tufts.forEach((t, i) => { mesh.setTransform(i, t[0] - ox, t[1] - oy, t[2] - oz, 1, 1, t[3], t[4]); mesh.setColor(i, t[5], t[6], t[7], 1); });
        const e = new Entity({ name: "grass", mesh, castShadow: false, frustumCulled: true });
        e.cullRadius = C * 0.8;
        e.setPosition(ox, oy, oz);
        e.interpolate = false;
        entities.push(e);
        const chunk = { x: (cx + 0.5) * C, y: (cy + 0.5) * C, z: isl.top, mesh, total: tufts.length, flowers: null };
        if (flowers.length) {
            const fm = new InstancedMesh(flower, flowerMat, flowers.length);
            flowers.forEach((t, i) => { fm.setTransform(i, t[0] - ox, t[1] - oy, t[2] - oz, t[3], t[3], t[3], t[4]); fm.setColor(i, t[5], t[6], t[7], 1); });
            const fe = new Entity({ name: "flowers", mesh: fm, castShadow: false });
            fe.cullRadius = C * 0.8;
            fe.setPosition(ox, oy, oz);
            fe.interpolate = false;
            entities.push(fe);
            chunk.flowers = fm; chunk.flowerTotal = flowers.length;
        }
        count += tufts.length;
        chunks.push(chunk);
        yield;
    }
    const near = GRASS.near[quality], far = GRASS.far[quality];
    return {
        entities, count, material, flowerMat,
        /** free the GPU buffers (the island has streamed out) */
        dispose(gl) {
            for (const e of entities) e.mesh.dispose(gl);
            tuft.dispose(gl); flower.dispose(gl);
        },
        /** distance tiers: thin chunks out with distance from the eye */
        update(eye) {
            for (const c of chunks) {
                const dist = Math.hypot(c.x - eye[0], c.y - eye[1], (c.z - eye[2]) * 0.5);
                const k = dist < near ? 1 : dist > far ? 0 : 1 - (dist - near) / (far - near);
                c.mesh.count = Math.round(c.total * k * k);
                if (c.flowers) c.flowers.count = Math.round(c.flowerTotal * Math.min(1, k * 1.5));
            }
        },
    };
}
