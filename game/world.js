import { Entity, Mesh, InstancedMesh, Geometry, StandardMaterial, ShaderMaterial, ParticleSystem, ShadowMap, primitives, projectionChunk, mat4, quat } from "../engine/index.js";
import { topAt, bottomAt, rimAt } from "./islands.js";
import { CROPS, DAY, GLIDE } from "./data.js";
import { dayT } from "./sim.js";
import { sample, makeAir } from "./air.js";

/**
 * SKYFARM: the 3D scene, stage 1 greybox. Presentation only: it reads the game state and draws it.
 *
 * Islands are one mesh each (a polar grid over the top, rings down the hanging underside, vertex colours), the
 * hut and the standing stones one mesh, plots and crops instanced (one draw per kind), the player one mesh with
 * the glider canopy as a second. The air is drawn with particles: pollen spiralling up thermals and streaks
 * along the wind current, so the player can see where the lift is (GDD §5, teaching without signs).
 *
 * The sun arcs over the day with a few colour keys (dawn, noon, golden hour, blue hour, night). The look pass
 * (stage 2) replaces the materials, sky, clouds and grade; the shapes here are what it dresses.
 * @module game/world
 */

const PALETTE = {
    grass: [0.44, 0.75, 0.29], grass2: [0.6, 0.84, 0.37], earth: [0.54, 0.35, 0.23], stone: [0.72, 0.7, 0.65], stoneDark: [0.56, 0.54, 0.52],
    soil: [0.45, 0.29, 0.19], soilWet: [0.3, 0.19, 0.13], roof: [0.82, 0.34, 0.25], wall: [0.91, 0.85, 0.71], wood: [0.55, 0.38, 0.24],
    leaf: [0.38, 0.68, 0.25], turnip: [0.93, 0.9, 0.86], turnipTop: [0.66, 0.36, 0.6], rope: [0.74, 0.78, 0.38], seed: [1.6, 1.3, 0.6],
    cloth: [0.35, 0.55, 0.78], skin: [0.95, 0.78, 0.64], hair: [0.25, 0.17, 0.12], canopy: [0.95, 0.9, 0.78], canopyStripe: [0.82, 0.34, 0.25],
};

/** sky and light keys over the day (t: fraction of the day, 0 sunrise) */
const KEYS = [
    { t: 0, sun: [1.4, 0.95, 0.65], sky: [0.5, 0.6, 0.8], ground: [0.32, 0.3, 0.24], horizon: [0.98, 0.84, 0.74], zenith: [0.42, 0.64, 0.9] },
    { t: DAY.dawnEnd + 0.04, sun: [1.45, 1.32, 1.1], sky: [0.52, 0.66, 0.86], ground: [0.32, 0.36, 0.22], horizon: [0.66, 0.85, 0.95], zenith: [0.43, 0.7, 0.92] },
    { t: DAY.golden - 0.04, sun: [1.45, 1.32, 1.1], sky: [0.52, 0.66, 0.86], ground: [0.32, 0.36, 0.22], horizon: [0.66, 0.85, 0.95], zenith: [0.43, 0.7, 0.92] },
    { t: DAY.blue - 0.02, sun: [1.6, 0.95, 0.5], sky: [0.55, 0.52, 0.62], ground: [0.36, 0.3, 0.22], horizon: [1.0, 0.75, 0.52], zenith: [0.45, 0.55, 0.8] },
    { t: DAY.night, sun: [0.35, 0.4, 0.7], sky: [0.3, 0.36, 0.6], ground: [0.12, 0.14, 0.2], horizon: [0.42, 0.5, 0.75], zenith: [0.16, 0.22, 0.45] },
    { t: 1, sun: [0.25, 0.3, 0.55], sky: [0.14, 0.18, 0.34], ground: [0.06, 0.07, 0.12], horizon: [0.2, 0.24, 0.4], zenith: [0.05, 0.07, 0.18] },
];

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
uniform vec3 u_horizon;
uniform vec3 u_zenith;
varying vec3 v_dir;
void main() {
    vec3 d = normalize(v_dir);
    float h = max(d.z, 0.0);
    vec3 color = mix(u_horizon, u_zenith, pow(h, 0.6));
    float toward = max(dot(d, u_sunDirection), 0.0);
    color += u_sunColor * (pow(toward, 1200.0) * 12.0 + pow(toward, 16.0) * 0.25);
    // below the horizon: the cloud sea's far edge, pale and soft
    if (d.z < 0.0) color = mix(u_horizon, vec3(0.93, 0.95, 0.98) * (0.6 + 0.4 * u_sunColor.g), min(1.0, -d.z * 8.0));
    gl_FragColor = vec4(color, 1.0);
}
`;

const cloudVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
varying vec3 v_world;
void main() {
    vec4 w = u_model * vec4(a_position, 1.0);
    v_world = w.xyz;
    gl_Position = projectLab(w.xyz);
}
`;
const cloudFragment = /* glsl */ `
uniform vec3 u_sunColor;
uniform vec3 u_skyColor;
uniform vec3 u_camPos;
uniform vec3 u_horizon;
uniform float u_time;
varying vec3 v_world;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
    vec2 p = v_world.xy * 0.012 + vec2(u_time * 0.004, u_time * 0.002);
    float n = vnoise(p) * 0.5 + vnoise(p * 2.3 + 4.1) * 0.3 + vnoise(p * 5.1 + 9.3) * 0.2;
    // puffy tops catch the sun, the hollows between them hold a soft blue shadow
    vec3 lit = vec3(0.98, 0.98, 0.96) * (0.55 + 0.45 * u_sunColor);
    vec3 shade = vec3(0.79, 0.86, 0.94) * (0.45 + 0.55 * u_skyColor * 1.4);
    vec3 color = mix(shade, lit, smoothstep(0.35, 0.75, n));
    float far = 1.0 - exp(-length(u_camPos.xy - v_world.xy) * 0.0012);
    gl_FragColor = vec4(mix(color, u_horizon, far * 0.85), 1.0);
}
`;

const lerp3 = (a, b, t, out) => { for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };
const smooth = (t) => t * t * (3 - 2 * t);

/** a placed part for Geometry.merge */
function part(geometry, at, color, rot = [0, 0, 0], scale = [1, 1, 1]) {
    const m = mat4.create(), q = quat.create();
    quat.fromEuler(q, (rot[0] * 180) / Math.PI, (rot[1] * 180) / Math.PI, (rot[2] * 180) / Math.PI);
    mat4.fromRotationTranslationScale(m, q, at, scale);
    return { geometry, matrix: m, color: color.length === 3 ? [...color, 1] : color };
}

/** An island as one mesh: the grassy top and the hanging rock below, coloured per vertex. */
export function islandGeometry(isl) {
    const SEG = 96, RINGS = 18, DOWN = 14;
    const positions = [], normals = [], colors = [], indices = [];
    const info = { inside: 0 };
    const rings = [];
    // top: rings from the middle out to the rim
    for (let j = 0; j <= RINGS; j++) {
        const u = j / RINGS, ring = [];
        for (let i = 0; i < SEG; i++) {
            const a = (i / SEG) * Math.PI * 2, rr = rimAt(isl, a) * (j === RINGS ? 0.9995 : Math.sqrt(u) * 0.9995);
            const x = isl.x + Math.cos(a) * rr, y = isl.y + Math.sin(a) * rr;
            const z = topAt(isl, x, y, info);
            ring.push(positions.length / 3);
            positions.push(x, y, z);
            const k = Math.sin(x * 0.31 + y * 0.17) * 0.5 + 0.5;
            const c = info.inside < 0.9 ? PALETTE.earth : lerp3(PALETTE.grass, PALETTE.grass2, k * 0.6, [0, 0, 0]);
            colors.push(c[0], c[1], c[2], 1);
        }
        rings.push(ring);
    }
    // underside: from the rim down to the point, in rings
    for (let j = 1; j <= DOWN; j++) {
        const u = 1 - j / DOWN, ring = [];
        for (let i = 0; i < SEG; i++) {
            const a = (i / SEG) * Math.PI * 2, rr = rimAt(isl, a) * Math.max(0.02, u) * 0.999;
            const x = isl.x + Math.cos(a) * rr, y = isl.y + Math.sin(a) * rr;
            const z = j === 1 ? topAt(isl, isl.x + Math.cos(a) * rimAt(isl, a) * 0.999, isl.y + Math.sin(a) * rimAt(isl, a) * 0.999) - 1.4 : bottomAt(isl, x, y);
            ring.push(positions.length / 3);
            positions.push(x, y, z);
            // strata: earth just under the grass, then banded stone, darker toward the point
            const band = Math.sin(z * 0.9 + Math.sin(a * 5) * 0.8) * 0.5 + 0.5;
            const c = j <= 1 ? PALETTE.earth : lerp3(PALETTE.stone, PALETTE.stoneDark, Math.min(1, 0.25 + band * 0.4 + (1 - u) * 0.35), [0, 0, 0]);
            colors.push(c[0], c[1], c[2], 1);
        }
        rings.push(ring);
    }
    for (let j = 0; j < rings.length - 1; j++) {
        const A = rings[j], B = rings[j + 1], flip = j >= RINGS;
        for (let i = 0; i < SEG; i++) {
            const a = A[i], b = A[(i + 1) % SEG], c = B[i], d = B[(i + 1) % SEG];
            // counter-clockwise seen from outside: from above on the top, from below on the underside
            if (flip) indices.push(a, c, b, b, c, d); else indices.push(a, c, b, b, c, d);
        }
    }
    const P = new Float32Array(positions), I = new Uint32Array(indices);
    return new Geometry({ positions: P, normals: smoothNormals(P, I), colors: new Float32Array(colors), indices: I });
}

/** smooth normals from the triangles (area-weighted) */
function smoothNormals(P, I) {
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

/** The player: a rounded body, a head with hair, and the glider canopy as its own mesh. */
function playerParts() {
    const P = PALETTE;
    return Geometry.merge([
        part(primitives.capsule(0.3, 0.55, 6, 14), [0, 0, 0.62], P.cloth),
        part(primitives.sphere(0.24, 16, 12), [0, 0, 1.38], P.skin),
        part(primitives.sphere(0.26, 16, 12), [-0.04, 0, 1.47], P.hair, [0, 0, 0], [1, 1, 0.75]),
        part(primitives.box(0.16, 0.5, 0.08), [-0.27, 0, 1.0], P.wood),
        part(primitives.sphere(0.045, 8, 6), [0.23, 0.08, 1.41], [0.15, 0.1, 0.1]),
        part(primitives.sphere(0.045, 8, 6), [0.23, -0.08, 1.41], [0.15, 0.1, 0.1]),
    ]);
}
/**
 * Grandmother's glider: one broad swept wing held overhead by a bar (more Mehve than paraglider). Each half is
 * three cloth panels with a slight dihedral and sweep, red tips, a wooden spar and keel. Origin is the hands.
 */
function canopyParts() {
    const P = PALETTE, parts = [];
    for (const side of [1, -1]) {
        for (let k = 0; k < 3; k++) {
            const y = side * (0.35 + k * 0.7), chord = 1.25 - k * 0.22, sweep = -k * 0.16;
            parts.push(part(primitives.box(chord, 0.72, 0.05), [0.15 + sweep, y, 1.05 + k * 0.12], k === 2 ? P.canopyStripe : P.canopy, [side * -0.17, 0, side * 0.1 * k]));
        }
        parts.push(part(primitives.box(0.06, 2.1, 0.06), [0.55, side * 1.05, 1.2], P.wood, [side * -0.17, 0, side * -0.12]));
    }
    parts.push(part(primitives.box(1.5, 0.08, 0.08), [0.1, 0, 1.0], P.wood));
    parts.push(part(primitives.box(0.05, 0.05, 1.0), [0.2, 0.3, 0.5], P.wood));
    parts.push(part(primitives.box(0.05, 0.05, 1.0), [0.2, -0.3, 0.5], P.wood));
    parts.push(part(primitives.box(0.05, 0.75, 0.05), [0.2, 0, 0.02], P.wood));
    return Geometry.merge(parts);
}

export class World {
    /** @param {import("../engine/Game.js").Game} game @param {object} worldData makeWorld() result */
    constructor(game, world) {
        this.game = game;
        this.scene = game.scene;
        this.world = world;
        this.reducedMotion = false;
        const scene = this.scene, root = (this.root = scene.add(new Entity({ name: "world" })));
        this._c = [0, 0, 0];
        this._air = makeAir();

        this.skyMat = new ShaderMaterial({ name: "sky", vertex: skyVertex, fragment: skyFragment, uniforms: { u_horizon: new Float32Array(3), u_zenith: new Float32Array(3) }, cull: "none", depthWrite: false });
        const sky = new Entity({ name: "sky", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.sphere(3000, 32, 20), this.skyMat) });
        sky.interpolate = false;
        root.add((this.sky = sky));

        this.cloudMat = new ShaderMaterial({ name: "cloud-sea", vertex: cloudVertex, fragment: cloudFragment, uniforms: { u_horizon: this.skyMat.values.u_horizon } });
        const sea = new Entity({ name: "cloud-sea", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.plane(6000, 6000, 1, 1), this.cloudMat) });
        sea.interpolate = false;
        root.add((this.sea = sea));

        const lit = new StandardMaterial({ vertexColors: true, specular: 0.05, shininess: 12 });
        for (const isl of world.islands) root.add(new Entity({ name: isl.id, staticShadow: true, castShadow: false, mesh: new Mesh(islandGeometry(isl), lit) }));

        // the hut, the shed, the stones
        const parts = [], d = world.data;
        for (const b of world.boxes) {
            if (b.kind === "roof") continue;
            const w = b.x1 - b.x0, dd = b.y1 - b.y0, h = b.z1 - b.z0;
            parts.push(part(primitives.box(w, dd, h), [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0 + h / 2], b.kind === "stone" ? PALETTE.stone : PALETTE.wall));
        }
        const roof = world.boxes.find((b) => b.kind === "roof");
        const rw = roof.x1 - roof.x0, rd = roof.y1 - roof.y0;
        parts.push(part(primitives.box(rw, rd, 0.35), [(roof.x0 + roof.x1) / 2, (roof.y0 + roof.y1) / 2, roof.z0 + 0.17], PALETTE.roof));
        parts.push(part(primitives.cone(Math.hypot(rw, rd) / 2, 2.2, 4), [(roof.x0 + roof.x1) / 2, (roof.y0 + roof.y1) / 2, roof.z1 + 1.1], PALETTE.roof, [0, 0, Math.PI / 4], [rw / Math.hypot(rw, rd) * 1.41, rd / Math.hypot(rw, rd) * 1.41, 1]));
        const home = world.islands[0], bz = topAt(home, d.bed.x, d.bed.y);
        parts.push(part(primitives.box(1.0, 2.0, 0.45), [d.bed.x, d.bed.y, bz + 0.22], PALETTE.wood));
        parts.push(part(primitives.box(0.9, 1.8, 0.15), [d.bed.x, d.bed.y, bz + 0.5], [0.85, 0.82, 0.75]));
        const tz = topAt(home, -4.6, -3.4);
        parts.push(part(primitives.box(1.0, 0.7, 0.8), [-4.6, -3.4, tz + 0.4], PALETTE.wood));
        // the shed: a lean-to of four posts and a sloped roof
        const sz = topAt(home, d.shed.x, d.shed.y);
        for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(part(primitives.box(0.15, 0.15, 2.2), [d.shed.x + ox, d.shed.y + oy, sz + 1.1], PALETTE.wood));
        parts.push(part(primitives.box(2.6, 2.6, 0.15), [d.shed.x, d.shed.y, sz + 2.25], PALETTE.wood, [0.15, 0, 0]));
        root.add(new Entity({ name: "buildings", staticShadow: true, mesh: new Mesh(Geometry.merge(parts), lit) }));

        // plots and crops
        this.soil = new InstancedMesh(primitives.box(0.94, 0.94, 0.14), new StandardMaterial({ vertexColors: false, specular: 0.15, shininess: 30 }), 256);
        this.leaves = new InstancedMesh(primitives.cone(0.5, 1, 6), new StandardMaterial({ specular: 0.05 }), 512);
        this.bulbs = new InstancedMesh(primitives.sphere(0.5, 12, 8), new StandardMaterial({ specular: 0.3, shininess: 40 }), 256);
        this.seeds = new InstancedMesh(primitives.sphere(0.5, 10, 8), new StandardMaterial({ emissive: [0.9, 0.7, 0.3] }), 32);
        for (const m of [this.soil, this.leaves, this.bulbs, this.seeds]) {
            m.count = 0;
            const e = root.add(new Entity({ mesh: m, frustumCulled: false }));
            e.interpolate = false;
        }
        this.gliderItem = root.add(new Entity({ name: "glider-item", mesh: new Mesh(canopyParts(), lit) }));
        this.gliderItem.interpolate = false;
        this.gliderItem.setScale(0.45);

        // the target tile: a thin bright frame
        const frame = [];
        for (const [x, y, w, dd] of [[0, -0.5, 1, 0.06], [0, 0.5, 1, 0.06], [-0.5, 0, 0.06, 1], [0.5, 0, 0.06, 1]]) frame.push(part(primitives.box(w, dd, 0.04), [x, y, 0], [1.4, 1.3, 1.0]));
        this.cursor = root.add(new Entity({ name: "cursor", castShadow: false, mesh: new Mesh(Geometry.merge(frame), new StandardMaterial({ vertexColors: true, lit: false })) }));
        this.cursor.interpolate = false;

        // the player
        this.body = root.add(new Entity({ name: "player", mesh: new Mesh(playerParts(), lit) }));
        this.body.interpolate = false;
        this.canopy = root.add(new Entity({ name: "canopy", mesh: new Mesh(canopyParts(), new StandardMaterial({ vertexColors: true, cull: "none" })) }));
        this.canopy.interpolate = false;
        this.canopyOpen = 0;

        // the air, and the feedback
        const particles = (o) => { const p = scene.add(new ParticleSystem(o)); p.castShadow = false; p.frustumCulled = false; return p; };
        this.pollen = particles({ capacity: 1600, drag: 0.2, name: "pollen" });
        this.streaks = particles({ capacity: 900, drag: 0, name: "streaks" });
        this.dust = particles({ capacity: 400, gravity: [0, 0, -3], drag: 3, blending: "normal", name: "dust" });
        this.sparkle = particles({ capacity: 400, gravity: [0, 0, 1.2], drag: 2, name: "sparkle" });
        this.splash = particles({ capacity: 300, gravity: [0, 0, -9], drag: 0.5, blending: "normal", name: "water" });

        scene.shadow = new ShadowMap({ cascades: 2, distance: 90, size: 2048, strength: 0.6 });
        this.time = 0;
        this._seed = 1;
    }

    /** random 0..1 for effects only (not the simulation) */
    _r() { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; return this._seed / 4294967296; }

    /** The sun and the sky for the time of day. */
    light(t) {
        const scene = this.scene;
        let a = KEYS[0], b = KEYS[1];
        for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
        const k = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
        lerp3(a.sun, b.sun, k, scene.sunColor);
        lerp3(a.sky, b.sky, k, scene.skyColor);
        lerp3(a.ground, b.ground, k, scene.groundColor);
        lerp3(a.horizon, b.horizon, k, this.skyMat.values.u_horizon);
        lerp3(a.zenith, b.zenith, k, this.skyMat.values.u_zenith);
        // the sun rises in the east (+x), arcs south (-y), sets in the west; at night the moon takes over the light
        const day = Math.min(1, t / DAY.night), arc = day * Math.PI;
        let sx = Math.cos(arc), sz = Math.sin(arc) * 0.85 + 0.08, sy = -0.45;
        if (t > DAY.night) { const n = (t - DAY.night) / (1 - DAY.night); sx = -0.6 + n * 1.2; sz = 0.6; sy = 0.4; }
        const m = Math.hypot(sx, sy, sz);
        scene.sunDirection[0] = sx / m; scene.sunDirection[1] = sy / m; scene.sunDirection[2] = sz / m;
        const fog = this.skyMat.values.u_horizon;
        scene.fogColor[0] = fog[0]; scene.fogColor[1] = fog[1]; scene.fogColor[2] = fog[2];
        scene.fogDensity = 0.0021;
        scene.clearColor[0] = fog[0]; scene.clearColor[1] = fog[1]; scene.clearColor[2] = fog[2];
    }

    /**
     * Draw a frame.
     * @param {number} dt real seconds since the last frame
     * @param {object} state the game
     * @param {{ x: number, y: number, z: number, yaw: number, pitch: number, roll: number, glide: number, fx: number, fy: number }} pose the player, interpolated
     * @param {number[]} eye the camera's position
     */
    update(dt, state, pose, eye) {
        this.time += dt;
        this.light(dayT(state));
        this.sky.setPosition(eye[0], eye[1], eye[2]);
        this.sea.setPosition(eye[0], eye[1], 0);

        // the player and the canopy
        const want = pose.glide ? 1 : 0;
        this.canopyOpen += (want - this.canopyOpen) * Math.min(1, dt * (want ? 9 : 6));
        const qb = this.body.rotation;
        if (pose.glide) {
            quat.identity(qb);
            quat.rotateZ(qb, qb, pose.yaw);
            // hanging under the wing, nearly flat, head forward
            quat.rotateY(qb, qb, 1.15 - pose.pitch * 0.3);
            quat.rotateX(qb, qb, pose.roll);
        } else quat.setAxisAngle(qb, [0, 0, 1], Math.atan2(pose.fy, pose.fx));
        this.body.setPosition(pose.x, pose.y, pose.z + (pose.glide ? 0.25 : 0));
        const o = this.canopyOpen;
        this.canopy.visible = o > 0.03;
        if (this.canopy.visible) {
            const qc = this.canopy.rotation;
            quat.identity(qc);
            quat.rotateZ(qc, qc, pose.yaw);
            quat.rotateY(qc, qc, -pose.pitch * 0.5);
            quat.rotateX(qc, qc, pose.roll);
            // unfolds from a bundle on the back: span first, then it lifts into place
            this.canopy.setPosition(pose.x, pose.y, pose.z + 0.2 + 0.4 * o);
            this.canopy.setScale(0.4 + 0.6 * o, 0.1 + 0.9 * o, 0.4 + 0.6 * o);
        }

        this.drawFarm(state);
        this.drawItems(state);
        this.drawCursor(state);
        this.drawAir(state, eye, dt);
    }

    drawFarm(state) {
        const home = this.world.islands[0];
        let ns = 0, nl = 0, nb = 0;
        for (const plot of state.plots.values()) {
            const x = plot.ix + 0.5, y = plot.iy + 0.5, z = topAt(home, x, y);
            this.soil.setTransform(ns, x, y, z + 0.02);
            const c = plot.watered ? PALETTE.soilWet : PALETTE.soil;
            this.soil.setColor(ns++, c[0], c[1], c[2], 1);
            if (!plot.crop) continue;
            const crop = CROPS[plot.crop], g = plot.growth, ripe = g >= 1;
            const bob = ripe ? Math.sin(this.time * 3 + x) * 0.03 : 0;
            if (plot.crop === "turnip") {
                // leaves grow from a sprout to a full rosette, the root swells into a bulb in the second half
                const s = g < crop.stages[0] ? g / crop.stages[0] * 0.12 : 0.12 + 0.3 * Math.min(1, (g - crop.stages[0]) / (1 - crop.stages[0]));
                for (let k = 0; k < (g < crop.stages[0] ? 2 : 5); k++) {
                    const a = k * 2.4 + plot.ix;
                    this.leaves.setTransform(nl, x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4, z + 0.1 + s * 0.9 + bob, s * 0.7, s * 0.35, s * 2.2, a);
                    this.leaves.setColor(nl++, PALETTE.leaf[0], PALETTE.leaf[1], PALETTE.leaf[2], 1);
                }
                if (g > 0.45) {
                    const b = 0.1 + 0.26 * Math.min(1, (g - 0.45) / 0.55);
                    this.bulbs.setTransform(nb, x, y, z + 0.12 + b * 0.35 + bob, b, b, b * 0.9);
                    const tc = ripe ? PALETTE.turnipTop : PALETTE.turnip;
                    this.bulbs.setColor(nb++, tc[0], tc[1], tc[2], 1);
                }
            } else {
                // rope-grass: a tuft of tall blades
                const s = 0.15 + 0.85 * g;
                for (let k = 0; k < 6; k++) {
                    const a = k * 1.05 + plot.iy;
                    this.leaves.setTransform(nl, x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z + 0.1 + s * 0.45, 0.05 + 0.05 * s, 0.05, s * 0.9, a);
                    this.leaves.setColor(nl++, PALETTE.rope[0], PALETTE.rope[1], PALETTE.rope[2], 1);
                }
            }
            if (ripe && this._r() < 0.05) this.sparkle.emit(1, { position: [x, y, z + 0.6], spread: 0.35, speed: 0.2, life: [0.6, 1.2], size: [0.09, 0], color: [1.8, 1.5, 0.8, 1] });
        }
        this.soil.count = ns; this.leaves.count = nl; this.bulbs.count = nb;
    }

    drawItems(state) {
        let n = 0;
        this.gliderItem.visible = false;
        for (const it of state.items) {
            if (it.taken) continue;
            const bob = Math.sin(this.time * 2.2 + it.id) * 0.08;
            if (it.kind === "glider") {
                this.gliderItem.visible = true;
                this.gliderItem.setPosition(it.x, it.y, it.z - 0.6);
                this.gliderItem.setYaw(0.4);
                continue;
            }
            this.seeds.setTransform(n, it.x, it.y, it.z + bob, 0.14);
            const c = it.kind === "seed" ? PALETTE.seed : PALETTE.turnipTop;
            this.seeds.setColor(n++, c[0], c[1], c[2], 1);
            if (this._r() < 0.08) this.sparkle.emit(1, { position: [it.x, it.y, it.z + bob], spread: 0.25, speed: 0.3, life: [0.5, 1], size: [0.08, 0], color: [1.8, 1.5, 0.8, 1] });
        }
        this.seeds.count = n;
    }

    drawCursor(state) {
        const p = state.player, show = p.mode === "foot" && ["till", "plant", "water", "harvest"].includes(p.does);
        this.cursor.visible = show;
        if (show) this.cursor.setPosition(p.tx + 0.5, p.ty + 0.5, topAt(this.world.islands[0], p.tx + 0.5, p.ty + 0.5) + 0.12);
    }

    /** pollen up the thermals, streaks along the currents, emitted around the camera */
    drawAir(state, eye, dt) {
        const t = state.tick / 60;
        for (const s of this.world.data.air) {
            if (s.kind === "thermal") {
                const near = Math.hypot(s.at[0] - eye[0], s.at[1] - eye[1]);
                if (near > 400) continue;
                const n = Math.round(dt * 60 * (near < 150 ? 2 : 1));
                for (let k = 0; k < n; k++) {
                    const a = this._r() * Math.PI * 2, r = Math.sqrt(this._r()) * s.radius * 0.8, z = s.bottom + 20 + this._r() * (s.top - s.bottom - 20);
                    const x = s.at[0] + Math.cos(a) * r, y = s.at[1] + Math.sin(a) * r;
                    sample(this.world.data.air, t, x, y, z, this._air);
                    // swirl around the column as they rise
                    this.pollen.emit(1, { position: [x, y, z], velocity: [-Math.sin(a) * 1.6 + this._air.x, Math.cos(a) * 1.6 + this._air.y, this._air.z], life: [4, 7], size: [0.22, 0.12], color: [1.5, 1.35, 0.8, 0.9], colorEnd: [1.2, 1.1, 0.7, 0] });
                }
            } else if (s.kind === "current") {
                const n = Math.round(dt * 60 * 1.5);
                for (let k = 0; k < n; k++) {
                    const u = this._r(), a = this._r() * Math.PI * 2, r = Math.sqrt(this._r()) * s.radius * 0.6;
                    const x = s.from[0] + (s.to[0] - s.from[0]) * u, y = s.from[1] + (s.to[1] - s.from[1]) * u + Math.cos(a) * r, z = s.from[2] + (s.to[2] - s.from[2]) * u + Math.sin(a) * r;
                    sample(this.world.data.air, t, x, y, z, this._air);
                    this.streaks.emit(1, { position: [x, y, z], velocity: [this._air.x * 1.4, this._air.y * 1.4, this._air.z * 1.4], life: [1.5, 2.5], size: [0.16, 0.05], color: [1.6, 1.6, 1.5, 0.7], colorEnd: [1.4, 1.4, 1.4, 0] });
                }
            }
        }
    }

    /** One-shot effects for what the simulation did this tick. */
    events(state) {
        const p = state.player;
        for (const e of state.events) {
            const home = this.world.islands[0];
            const at = e.ix !== undefined ? [e.ix + 0.5, e.iy + 0.5, topAt(home, e.ix + 0.5, e.iy + 0.5) + 0.15] : [p.x, p.y, p.z + 0.1];
            if (e.type === "till") this.dust.emit(14, { position: at, spread: 0.3, velocity: [0, 0, 2.2], speed: 1.6, life: [0.4, 0.8], size: [0.12, 0.04], color: [0.5, 0.33, 0.2, 1] });
            else if (e.type === "plant") this.dust.emit(6, { position: at, spread: 0.15, velocity: [0, 0, 1.2], speed: 0.6, life: [0.3, 0.5], size: [0.08, 0.02], color: [0.45, 0.3, 0.2, 1] });
            else if (e.type === "water") this.splash.emit(22, { position: [at[0], at[1], at[2] + 0.8], spread: 0.25, velocity: [0, 0, -1], speed: 1.2, life: [0.4, 0.7], size: [0.07, 0.03], color: [0.7, 0.85, 1.0, 0.9] });
            else if (e.type === "harvest" || e.type === "pick" || e.type === "sprout") this.sparkle.emit(e.type === "sprout" ? 10 : 24, { position: e.x !== undefined ? [e.x, e.y, e.z] : [at[0], at[1], at[2] + 0.4], spread: 0.3, velocity: [0, 0, 1.2], speed: 1.4, life: [0.5, 1.1], size: [0.12, 0], color: [1.8, 1.5, 0.8, 1] });
            else if (e.type === "land") this.dust.emit(e.hard ? 30 : 12, { position: [p.x, p.y, p.z + 0.05], spread: 0.3, velocity: [0, 0, 1], speed: e.hard ? 3 : 1.6, flat: true, life: [0.4, 0.9], size: [0.18, 0.06], color: [0.82, 0.8, 0.7, 0.8] });
            else if (e.type === "open") this.streaks.emit(20, { position: [p.x, p.y, p.z + 1.6], spread: 1.2, speed: 2, life: [0.4, 0.8], size: [0.12, 0], color: [1.6, 1.6, 1.5, 0.8] });
        }
    }
}

export { GLIDE };
