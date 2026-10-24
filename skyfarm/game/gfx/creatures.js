import { Entity, InstancedMesh, Geometry, primitives } from "../../engine/index.js";
import { part, KIND } from "./props.js";
import { topAt } from "../islands.js";
import { dayT } from "../sim.js";
import { DAY } from "../data.js";
import { rainingAt } from "../farm.js";

/**
 * SKYFARM: the creatures (GDD §10: "they react to the player and never feel like props"). Presentation-side:
 * they change nothing in the game, so they live here rather than in the simulation, seeded so a scene looks the
 * same each time. Each kind is one instanced draw.
 *
 * Decisions are utility AI (the `ai-behavior-trees-utility-ai` skill): every option scores 0..1 from a few
 * considerations through response curves, the best wins, and a small bonus for the current option stops them
 * flickering between two. Movement is steering (seek / flee / arrive / wander).
 *
 *   fluffballs  graze · wander · curious (a player walking slowly nearby: come closer) · flee (a running or
 *               low-gliding player) · follow (the player has turnips) · nap (night) · huddle (rain)
 *   birds       circle a thermal (they show where the lift is: GDD §5 "birds circle every early thermal") · fly
 *               alongside a gliding player who comes close · flap now and then, glide the rest
 *   fish        drift · dart away from a shadow at the pond's edge · gather near a player who stands still there
 * @module game/gfx/creatures
 */

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function seeded(s) { return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function fluffGeometry() {
    const W = [0.97, 0.95, 0.9], parts = [];
    // wool: a heap of balls; a dark face with white eyes; four stubby legs
    for (const [x, y, z, r] of [[0, 0, 0.45, 0.42], [0.2, 0.15, 0.55, 0.3], [-0.2, 0.15, 0.55, 0.3], [0.2, -0.15, 0.55, 0.3], [-0.2, -0.15, 0.55, 0.3], [0, 0, 0.72, 0.3], [-0.3, 0, 0.45, 0.28]]) parts.push(part(primitives.sphere(r, 10, 7), [x, y, z], "cloth", [0, 0, 0], [1, 1, 1], W));
    parts.push(part(primitives.sphere(0.17, 10, 7), [0.42, 0, 0.5], "cloth", [0, 0, 0], [1, 0.9, 1.05], [0.25, 0.2, 0.2]));
    for (const s of [1, -1]) { parts.push(part(primitives.sphere(0.045, 6, 5), [0.55, s * 0.07, 0.55], "cloth", [0, 0, 0], [1, 1, 1], [0.98, 0.97, 0.95])); parts.push(part(primitives.sphere(0.02, 5, 4), [0.585, s * 0.07, 0.55], "dark", [0, 0, 0], [1, 1, 1], [0.05, 0.05, 0.05])); }
    for (const [x, y] of [[0.2, 0.16], [0.2, -0.16], [-0.2, 0.16], [-0.2, -0.16]]) parts.push(part(primitives.cylinder(0.05, 0.05, 0.22, 6), [x, y, 0.1], "cloth", [0, 0, 0], [1, 1, 1], [0.25, 0.2, 0.2]));
    return Geometry.merge(parts, { uvs: false });
}
function birdGeometry() {
    const parts = [
        part(primitives.sphere(0.14, 8, 6), [0, 0, 0], "cloth", [0, 0, 0], [1.8, 0.8, 0.75], [0.93, 0.93, 0.9]),
        part(primitives.sphere(0.07, 6, 5), [0.24, 0, 0.04], "cloth", [0, 0, 0], [1, 1, 1], [0.93, 0.93, 0.9]),
        part(primitives.cone(0.03, 0.08, 5), [0.32, 0, 0.04], "cloth", [0, Math.PI / 2, 0], [1, 1, 1], [0.95, 0.65, 0.25]),
        part(primitives.box(0.12, 0.22, 0.02), [-0.28, 0, 0.02], "cloth", [0, 0, 0], [1, 1, 1], [0.3, 0.32, 0.36]),
    ];
    // wings: thin plates out to the sides (scaled by the flap in y)
    for (const s of [1, -1]) parts.push(part(primitives.box(0.22, 0.42, 0.02), [0.02, s * 0.27, 0.03], "cloth", [s * 0.12, 0, 0], [1, 1, 1], [0.9, 0.9, 0.88]));
    return Geometry.merge(parts, { uvs: false });
}
function fishGeometry() {
    return Geometry.merge([
        part(primitives.sphere(0.12, 8, 6), [0, 0, 0], "cloth", [0, 0, 0], [1.9, 0.6, 0.8], [0.95, 0.55, 0.28]),
        part(primitives.cone(0.08, 0.14, 5), [-0.27, 0, 0], "cloth", [0, -Math.PI / 2, 0], [1, 0.3, 1], [0.95, 0.85, 0.75]),
    ], { uvs: false });
}

export class Creatures {
    /** @param {object} world makeWorld() result @param {import("../../engine/index.js").Entity} root @param {object} material the prop material */
    constructor(world, root, material) {
        this.world = world;
        const rand = seeded(9091);
        const inst = (geo, n, shadow) => { const m = new InstancedMesh(geo, material, n); m.count = 0; const e = new Entity({ name: "creatures", mesh: m, frustumCulled: false, castShadow: shadow }); e.interpolate = false; root.add(e); return m; };
        this.fluffMesh = inst(fluffGeometry(), 16, true);
        // (birds are too high, fish are under water: neither throws a shadow worth a draw)
        this.birdMesh = inst(birdGeometry(), 40, false);
        this.fishMesh = inst(fishGeometry(), 24, false);
        // fluffballs: a flock on Fluff Downs, two at home
        this.fluff = [];
        const flock = (id, n) => { const isl = world.byId[id]; for (let k = 0; k < n; k++) { const a = rand() * 6.28, r = isl.radius * (0.2 + rand() * 0.4); this.fluff.push({ isl, x: isl.x + Math.cos(a) * r, y: isl.y + Math.sin(a) * r, yaw: rand() * 6.28, vx: 0, vy: 0, mode: "graze", t: rand() * 5, home: [isl.x, isl.y], seed: rand() * 100 }); } };
        flock("fluff", 8); flock("hearth", 2);
        // birds: three per thermal, at spread heights and phases
        this.birds = [];
        for (const s of world.data.air) if (s.kind === "thermal") for (let k = 0; k < 3; k++) this.birds.push({ th: s, a: rand() * 6.28, h: 15 + rand() * (s.top - s.bottom - 30), r: s.radius * (0.5 + rand() * 0.4), dir: rand() < 0.5 ? 1 : -1, flap: 0, x: 0, y: 0, z: 0, yaw: 0, along: 0 });
        // fish: in the ponds
        this.fish = [];
        for (const isl of world.islands) for (const p of isl.ponds || []) if (!p.stream) for (let k = 0; k < 6; k++) { const a = rand() * 6.28, r = rand() * p.r * 0.6; this.fish.push({ isl, p, x: p.x0 + Math.cos(a) * r, y: p.y0 + Math.sin(a) * r, yaw: rand() * 6.28, speed: 0.4, t: rand() * 9, dart: 0 }); }
        this.still = 0;
    }

    /**
     * @param {number} dt
     * @param {object} state the game
     * @param {number[]} eye the camera
     * @param {number} time seconds
     */
    update(dt, state, eye, time) {
        const p = state.player, pSpeed = Math.hypot(p.vx, p.vy), t = dayT(state), night = t > DAY.blue || t < 0.02, rain = rainingAt(state.seed, state.tick);
        this.still = pSpeed < 0.3 && p.mode === "foot" ? this.still + dt : 0;
        const hasTurnips = state.pouch.crops.turnip > 0;
        // ---- fluffballs
        let n = 0;
        for (const f of this.fluff) {
            if (Math.hypot(f.x - eye[0], f.y - eye[1]) > 300) continue;
            const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy), sameIsland = Math.abs(p.z - topAt(f.isl, f.x, f.y)) < 4;
            // utility: each option's score from its considerations (0..1), a little stickiness for the current one
            const near = sameIsland ? 1 - smoothstep(2, 9, d) : 0;
            const scores = {
                graze: 0.35 + 0.1 * Math.sin(time * 0.1 + f.seed),
                wander: 0.25 + 0.2 * smoothstep(0.6, 1, Math.sin(time * 0.07 + f.seed * 2)),
                curious: near * (pSpeed > 0.2 && pSpeed < 4.5 ? 0.6 : 0) * (d > 2.5 ? 1 : 0.2),
                flee: (sameIsland ? 1 - smoothstep(3, 7, d) : 0) * (pSpeed > 5 || (p.mode === "glide" && p.z - topAt(f.isl, f.x, f.y) < 6) ? 1 : 0),
                follow: hasTurnips && sameIsland && d < 12 && d > 2 ? 0.7 : 0,
                nap: night ? 0.8 : 0,
                huddle: rain ? 0.75 : 0,
            };
            scores[f.mode] = (scores[f.mode] || 0) + 0.08;
            f.mode = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
            // steering
            let gx = 0, gy = 0, sp = 0;
            const flockCx = this.fluff.filter((o) => o.isl === f.isl).reduce((s, o, _, arr) => [s[0] + o.x / arr.length, s[1] + o.y / arr.length], [0, 0]);
            if (f.mode === "wander") { f.t += dt; gx = Math.cos(f.seed + f.t * 0.2); gy = Math.sin(f.seed + f.t * 0.2); sp = 0.6; }
            else if (f.mode === "curious" || f.mode === "follow") { gx = dx / d; gy = dy / d; sp = d > 2.5 ? (f.mode === "follow" ? 2.2 : 1.0) : 0; }
            else if (f.mode === "flee") { gx = -dx / d; gy = -dy / d; sp = 4.5; }
            else if (f.mode === "huddle") { const hx = flockCx[0] - f.x, hy = flockCx[1] - f.y, hd = Math.hypot(hx, hy) || 1; gx = hx / hd; gy = hy / hd; sp = hd > 1.6 ? 1.2 : 0; }
            f.vx += (gx * sp - f.vx) * Math.min(1, dt * 3); f.vy += (gy * sp - f.vy) * Math.min(1, dt * 3);
            let nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
            // stay well inside the island (they're not daft)
            if (Math.hypot(nx - f.isl.x, ny - f.isl.y) > f.isl.radius * 0.75 || topAt(f.isl, nx, ny) === -Infinity) { nx = f.x; ny = f.y; f.vx *= -0.5; f.vy *= -0.5; }
            f.x = nx; f.y = ny;
            const v = Math.hypot(f.vx, f.vy);
            if (v > 0.1) f.yaw = Math.atan2(f.vy, f.vx);
            else if (f.mode === "curious") f.yaw = Math.atan2(dy, dx);
            const z = topAt(f.isl, f.x, f.y);
            // bounce when moving, a slow bob grazing, flat and still asleep
            const hop = v > 0.3 ? Math.abs(Math.sin(time * 9 + f.seed)) * 0.12 : 0, graze = f.mode === "graze" ? Math.sin(time * 2 + f.seed) * 0.02 : 0;
            const squash = f.mode === "nap" ? 0.8 : 1;
            this.fluffMesh.setTransform(n, f.x, f.y, z + hop + graze, 1, 1, squash * (1 + hop * 0.6), f.yaw);
            this.fluffMesh.setColor(n++, 1, 1, 1, KIND.cloth);
        }
        this.fluffMesh.count = n;
        // ---- birds
        n = 0;
        for (const b of this.birds) {
            const s = b.th, cx = s.at[0], cy = s.at[1];
            if (Math.hypot(cx - eye[0], cy - eye[1]) > 600 || !state.air.includes(s)) continue;
            const pd = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
            if (p.mode === "glide" && pd < 25) {
                // fly alongside: match the glider's heading, a few metres off its wing
                const side = b.dir * 5;
                const tx = p.x - Math.sin(p.yaw) * side + Math.cos(p.yaw) * 2, ty = p.y + Math.cos(p.yaw) * side + Math.sin(p.yaw) * 2, tz = p.z + 1.5;
                b.x += (tx - b.x) * Math.min(1, dt * 1.5); b.y += (ty - b.y) * Math.min(1, dt * 1.5); b.z += (tz - b.z) * Math.min(1, dt * 1.5);
                b.yaw = p.yaw; b.along = 1;
            } else {
                // circle the column, slowly climbing then sinking back
                b.a += dt * (9 / b.r) * b.dir;
                const z = s.bottom + b.h + Math.sin(time * 0.05 + b.r) * 10;
                const tx = cx + Math.cos(b.a) * b.r, ty = cy + Math.sin(b.a) * b.r;
                const k = b.along ? Math.min(1, dt * 0.5) : 1;
                b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z += (z - b.z) * k;
                b.yaw = b.a + (b.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
                if (k >= 1) b.along = 0;
            }
            // flap a few beats, then glide
            const beat = Math.sin(time * 1.3 + b.r) > 0.7 ? Math.abs(Math.sin(time * 14 + b.a)) : 0.15;
            this.birdMesh.setTransform(n, b.x, b.y, b.z, 1.6, 1.6 * (0.6 + 0.4 * beat), 1.6, b.yaw);
            this.birdMesh.setColor(n++, 1, 1, 1, KIND.cloth);
        }
        this.birdMesh.count = n;
        // ---- fish (only where the water runs: restored islands)
        n = 0;
        for (const f of this.fish) {
            if (!state.progress.restored.has(f.isl.id) || Math.hypot(f.x - eye[0], f.y - eye[1]) > 120) continue;
            const pd = Math.hypot(p.x - f.p.x0, p.y - f.p.y0), atEdge = pd < f.p.r + 2.5 && Math.abs(p.z - f.p.level) < 3;
            f.t += dt;
            let gx, gy;
            if (atEdge && this.still > 2) { gx = p.x - f.x; gy = p.y - f.y; f.speed = 0.5; }
            else if (atEdge && this.still < 0.5 && f.dart <= 0) { f.dart = 1.2; f.yaw += Math.PI * (0.6 + Math.random() * 0.8); }
            if (f.dart > 0) { f.dart -= dt; f.speed = 2.2; gx = Math.cos(f.yaw); gy = Math.sin(f.yaw); }
            else if (gx === undefined) { gx = Math.cos(f.yaw + Math.sin(f.t * 0.5) * 0.8); gy = Math.sin(f.yaw + Math.sin(f.t * 0.5) * 0.8); f.speed = 0.45; }
            const want = Math.atan2(gy, gx);
            let dy = want - f.yaw; dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
            f.yaw += dy * Math.min(1, dt * 2.5);
            let nx = f.x + Math.cos(f.yaw) * f.speed * dt, ny = f.y + Math.sin(f.yaw) * f.speed * dt;
            if (Math.hypot(nx - f.p.x0, ny - f.p.y0) > f.p.r * 0.75) { f.yaw += Math.PI * 0.7; nx = f.x; ny = f.y; }
            f.x = nx; f.y = ny;
            this.fishMesh.setTransform(n, f.x, f.y, f.p.level - 0.35 + Math.sin(f.t * 2) * 0.05, 1, 1, 1, f.yaw + Math.sin(f.t * 8) * 0.15);
            this.fishMesh.setColor(n++, 1, 1, 1, KIND.cloth);
        }
        this.fishMesh.count = n;
    }
}
