import { Entity, Mesh, InstancedMesh, Geometry, ParticleSystem, ShadowMap, primitives, quat } from "../engine/index.js";
import { topAt } from "./islands.js";
import { CROPS, DAY } from "./data.js";
import { dayT } from "./sim.js";
import { sample, makeAir } from "./air.js";
import { shared, syncShared } from "./gfx/common.js";
import { sunLight, skyAt } from "./gfx/atmosphere.js";
import { skyMaterial } from "./gfx/sky.js";
import { seaGeometry, seaMaterial, cumulusGeometry, cumulusMaterial } from "./gfx/clouds.js";
import { islandGeometry, terrainMaterial } from "./gfx/terrain.js";
import { buildGrass } from "./gfx/grass.js";
import { growTree, treeMaterials } from "./gfx/tree.js";
import { hearthProps, propMaterial, part, KIND } from "./gfx/props.js";
import { makeRandom } from "./det.js";

/**
 * SKYFARM: the 3D scene. Presentation only: it reads the game state and draws it.
 *
 * Stage 2 ("look target"): every surface goes through the shared look in game/gfx (one atmosphere for the sky
 * and the haze, one wind, the painterly light, the Ghibli grade in the composite). Draw calls stay few: each
 * island is one mesh, its props one more, the roof one, grass one instanced draw per 8 m chunk (thinned with
 * distance), the tree two (bark, leaves), all cumulus one, the cloud sea one, plots and crops instanced.
 *
 * Light over the day: the sun's direction follows an arc (east to west across the south); its colour, the sky
 * light and the ground bounce all come from the atmosphere model (sunLight, skyAt), so golden hour turns warm
 * and blue hour cool on their own, without colour keys to lerp between (stage 1's grey golden hour).
 * @module game/world
 */

const PAL = {
    soil: [0.45, 0.29, 0.19], soilWet: [0.28, 0.18, 0.12], leaf: [0.36, 0.62, 0.24], turnip: [0.95, 0.92, 0.86], turnipTop: [0.7, 0.38, 0.62],
    rope: [0.72, 0.76, 0.36], seed: [1.6, 1.3, 0.6], cloth: [0.35, 0.55, 0.78], skin: [0.96, 0.8, 0.66], hair: [0.3, 0.2, 0.14],
    canopy: [0.95, 0.9, 0.78], stripe: [0.82, 0.34, 0.25], wood: [0.5, 0.35, 0.23], dark: [0.12, 0.1, 0.1],
};

/** The player: a rounded body, a head with hair, a scarf; the glider canopy as its own mesh. */
function playerGeometry() {
    return Geometry.merge([
        part(primitives.capsule(0.3, 0.55, 6, 14), [0, 0, 0.62], "cloth", [0, 0, 0], [1, 1, 1], PAL.cloth),
        part(primitives.torus(0.24, 0.07, 6, 16), [0, 0, 1.12], "cloth", [0, 0, 0], [1, 1, 1], [0.86, 0.36, 0.28]),
        part(primitives.sphere(0.24, 16, 12), [0, 0, 1.38], "cloth", [0, 0, 0], [1, 1, 1], PAL.skin),
        part(primitives.sphere(0.26, 16, 12), [-0.04, 0, 1.47], "cloth", [0, 0, 0], [1, 1, 0.75], PAL.hair),
        part(primitives.box(0.16, 0.5, 0.5), [-0.3, 0, 0.85], "timber", [0, 0, 0], [1, 1, 1], PAL.wood),
        part(primitives.sphere(0.045, 8, 6), [0.23, 0.08, 1.41], "dark", [0, 0, 0], [1, 1, 1], PAL.dark),
        part(primitives.sphere(0.045, 8, 6), [0.23, -0.08, 1.41], "dark", [0, 0, 0], [1, 1, 1], PAL.dark),
    ], { uvs: false });
}
/**
 * Grandmother's glider: one broad swept wing held overhead by a bar (more Mehve than paraglider). Each half is
 * three cloth panels with a slight dihedral and sweep, red tips, a wooden spar and keel. Origin is the hands.
 */
function canopyGeometry() {
    const parts = [];
    for (const side of [1, -1]) {
        for (let k = 0; k < 3; k++) {
            const y = side * (0.35 + k * 0.7), chord = 1.25 - k * 0.22, sweep = -k * 0.16;
            parts.push(part(primitives.box(chord, 0.72, 0.05), [0.15 + sweep, y, 1.05 + k * 0.12], "cloth", [side * -0.17, 0, side * 0.1 * k], [1, 1, 1], k === 2 ? PAL.stripe : PAL.canopy));
        }
        parts.push(part(primitives.box(0.06, 2.1, 0.06), [0.55, side * 1.05, 1.2], "timber", [side * -0.17, 0, side * -0.12], [1, 1, 1], PAL.wood));
    }
    parts.push(part(primitives.box(1.5, 0.08, 0.08), [0.1, 0, 1.0], "timber", [0, 0, 0], [1, 1, 1], PAL.wood));
    parts.push(part(primitives.box(0.05, 0.05, 1.0), [0.2, 0.3, 0.5], "timber", [0, 0, 0], [1, 1, 1], PAL.wood));
    parts.push(part(primitives.box(0.05, 0.05, 1.0), [0.2, -0.3, 0.5], "timber", [0, 0, 0], [1, 1, 1], PAL.wood));
    parts.push(part(primitives.box(0.05, 0.75, 0.05), [0.2, 0, 0.02], "timber", [0, 0, 0], [1, 1, 1], PAL.wood));
    return Geometry.merge(parts, { uvs: false });
}

export class World {
    /**
     * @param {import("../engine/Game.js").Game} game
     * @param {object} world makeWorld() result
     * @param {{ quality?: "low" | "medium" | "high" }} [options]
     */
    constructor(game, world, options = {}) {
        this.game = game;
        this.scene = game.scene;
        this.world = world;
        this.quality = options.quality || "medium";
        this.reducedMotion = false;
        const scene = this.scene, root = (this.root = scene.add(new Entity({ name: "world" })));
        this._air = makeAir();
        this._c = [0, 0, 0];
        const add = (e) => { e.interpolate = false; root.add(e); return e; };

        // sky and clouds
        this.sky = add(new Entity({ name: "sky", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.sphere(5000, 40, 24), skyMaterial()) }));
        this.seaMat = seaMaterial();
        this.sea = add(new Entity({ name: "cloud-sea", castShadow: false, frustumCulled: false, mesh: new Mesh(seaGeometry(), this.seaMat) }));
        const rand = makeRandom(5150), places = [];
        for (let k = 0; k < 34; k++) {
            const a = rand() * Math.PI * 2, r = 110 + rand() * rand() * 1500, low = rand() < 0.45;
            places.push({ x: 75 + Math.cos(a) * r, y: 15 + Math.sin(a) * r, z: low ? -6 + rand() * 10 : 25 + rand() * 120, size: low ? 18 + rand() * 30 : 10 + rand() * 22 });
        }
        add(new Entity({ name: "cumulus", castShadow: false, frustumCulled: false, mesh: new Mesh(cumulusGeometry(5151, places), cumulusMaterial()) }));

        // islands
        const paths = world.data.paths || [];
        for (const isl of world.islands) add(new Entity({ name: isl.id, castShadow: false, mesh: new Mesh(islandGeometry(isl, isl === world.islands[0] ? paths : []), terrainMaterial(isl)) }));

        // Hearth Isle's props, the roof, the tree
        const props = hearthProps(world), pm = propMaterial(false);
        add(new Entity({ name: "props", mesh: new Mesh(props.mesh, pm) }));
        for (const g of props.roofs) add(new Entity({ name: "roof", mesh: new Mesh(g, propMaterial(true)) }));
        this.windmill = props.windmill;
        const t = world.data.tree;
        if (t) {
            const at = { x: t.x, y: t.y, z: topAt(world.islands[0], t.x, t.y), seed: t.seed, height: t.height };
            const tree = growTree(at), mats = treeMaterials(at);
            add(new Entity({ name: "bark", mesh: new Mesh(tree.bark, mats.bark) }));
            add(new Entity({ name: "leaves", mesh: new Mesh(tree.leaves, mats.leaves) }));
            this.tree = tree;
        }
        // standing stones on Daisy Step
        const stones = [];
        for (const b of world.boxes) if (b.kind === "stone") stones.push(part(primitives.box(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2], "stone"));
        if (stones.length) add(new Entity({ name: "stones", mesh: new Mesh(Geometry.merge(stones, { uvs: false }), pm) }));

        // grass and flowers
        this.grass = world.islands.map((isl) => buildGrass(isl, world, this.quality));
        for (const g of this.grass) for (const e of g.entities) add(e);

        // plots and crops: instanced, painted by the prop material (colour alpha = surface kind)
        const ipm = propMaterial(false);
        const inst = (geo, n) => { const m = new InstancedMesh(geo, ipm, n); m.count = 0; add(new Entity({ mesh: m, frustumCulled: false })); return m; };
        this.soil = inst(primitives.box(0.94, 0.94, 0.16), 256);
        this.leaves = inst(primitives.cone(0.5, 1, 6), 512);
        this.bulbs = inst(primitives.sphere(0.5, 12, 8), 256);
        this.seeds = inst(primitives.sphere(0.5, 10, 8), 32);
        this.gliderItem = add(new Entity({ name: "glider-item", mesh: new Mesh(canopyGeometry(), pm) }));
        this.gliderItem.setScale(0.45);

        // the target tile: a thin bright frame
        const frame = [];
        for (const [x, y, w, d] of [[0, -0.5, 1, 0.06], [0, 0.5, 1, 0.06], [-0.5, 0, 0.06, 1], [0.5, 0, 0.06, 1]]) frame.push(part(primitives.box(w, d, 0.04), [x, y, 0], "cloth", [0, 0, 0], [1, 1, 1], [1.6, 1.5, 1.2]));
        this.cursor = add(new Entity({ name: "cursor", castShadow: false, mesh: new Mesh(Geometry.merge(frame, { uvs: false }), pm) }));

        // the player
        this.body = add(new Entity({ name: "player", mesh: new Mesh(playerGeometry(), pm) }));
        this.canopy = add(new Entity({ name: "canopy", mesh: new Mesh(canopyGeometry(), propMaterial(false)) }));
        this.canopyOpen = 0;

        // the air, and the feedback
        const particles = (o) => { const p = scene.add(new ParticleSystem(o)); p.castShadow = false; p.frustumCulled = false; return p; };
        this.pollen = particles({ capacity: 1600, drag: 0.2, name: "pollen" });
        this.streaks = particles({ capacity: 900, drag: 0, name: "streaks" });
        this.dust = particles({ capacity: 400, gravity: [0, 0, -3], drag: 3, blending: "normal", name: "dust" });
        this.sparkle = particles({ capacity: 400, gravity: [0, 0, 1.2], drag: 2, name: "sparkle" });
        this.splash = particles({ capacity: 300, gravity: [0, 0, -9], drag: 0.5, blending: "normal", name: "water" });
        this.smoke = particles({ capacity: 160, gravity: [0, 0, 0.5], drag: 0.6, blending: "normal", name: "smoke" });
        this.motes = particles({ capacity: 500, gravity: [0, 0, 0.05], drag: 0.8, name: "motes" });
        const h = world.data.hut;
        this.chimney = [h.x - h.w / 2 + 1.35, h.y + h.d / 2 - 1.05, topAt(world.islands[0], h.x, h.y) + h.h + 2.9];

        // island shadows on the cloud sea
        const u = this.seaMat.values.u_islands;
        world.islands.slice(0, 8).forEach((isl, i) => u.set([isl.x, isl.y, isl.radius * 0.95, isl.top], i * 4));

        this.setShadows(true);
        this.time = 0;
        this._seed = 1;
    }

    /** sun shadows: two cascades over 70 m; Low has one smaller map over 45 m */
    setShadows(on) {
        const low = this.quality === "low";
        this.scene.shadow = on ? new ShadowMap({ cascades: low ? 1 : 2, distance: low ? 45 : 70, size: low ? 1024 : this.quality === "high" ? 3072 : 2048, strength: 0.7 }) : null;
    }

    /** random 0..1 for effects only (not the simulation) */
    _r() { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; return this._seed / 4294967296; }

    /** The sun (or moon) and the sky's light for the time of day, from the atmosphere. */
    light(t, eye) {
        const scene = this.scene;
        // the sun rises in the east (+x), arcs across the south (-y), sets in the west at the start of blue hour.
        // Elevation goes as sin², so it lingers low after sunrise and before sunset: golden hour is ~10° up.
        const arc = Math.min(1, t / DAY.blue) * Math.PI, se = Math.sin(arc);
        let sx = Math.cos(arc), sy = -0.42, sz = 0.82 * se * se - 0.015;
        let m = Math.hypot(sx, sy, sz);
        sx /= m; sy /= m; sz /= m;
        const E = sunLight(eye[2], sz, this._c);
        shared.u_atmoSun.set(E);
        // night: the moon lights the scene dimly from the other side
        const night = 1 - Math.min(1, Math.max(0, (sz + 0.04) / 0.14));
        shared.u_atmoNight = night;
        if (night > 0.5) {
            const n = Math.min(1, (t - DAY.night) / (1 - DAY.night) + 0.0);
            sx = -0.5 + n; sy = 0.35; sz = 0.6; m = Math.hypot(sx, sy, sz); sx /= m; sy /= m; sz /= m;
        }
        scene.sunDirection[0] = sx; scene.sunDirection[1] = sy; scene.sunDirection[2] = sz;
        const k = 0.5;
        for (let i = 0; i < 3; i++) scene.sunColor[i] = E[i] * k + night * [0.1, 0.13, 0.24][i];
        // sky light: the sky's radiance overhead and toward the horizon, averaged
        const up = skyAt(eye[2], [0, 0, 1], scene.sunDirection, [0, 0, 0]), side = skyAt(eye[2], [0.7, 0, 0.3], scene.sunDirection, [0, 0, 0]);
        // (a little less saturated than the sky itself: the light that reaches a shaded wall is a mix of everything)
        const sl = (up[0] + up[1] + up[2] + side[0] + side[1] + side[2]) / 6;
        for (let i = 0; i < 3; i++) scene.skyColor[i] = (sl * 0.3 + (up[i] * 0.4 + side[i] * 0.6) * 0.7) * 0.9 + night * [0.05, 0.07, 0.13][i];
        // light from below: the cloud sea under everything is a huge bright reflector, so the islands' undersides
        // get a soft blue-white fill instead of going dark (a meadow-facing surface gets a little green with it)
        const g = [0.92, 0.91, 0.9];
        for (let i = 0; i < 3; i++) scene.groundColor[i] = g[i] * (E[i] * 0.2 + scene.skyColor[i] * 0.45) + night * 0.02;
        scene.fogDensity = 0;
        // exposure key: predicted from the light model (no GPU readback), so noon isn't washed out and golden hour
        // isn't murky; eased like an eye adapting, faster toward light than toward dark
        const key = 0.3 * (scene.sunColor[0] + scene.skyColor[0]) + 0.59 * (scene.sunColor[1] + scene.skyColor[1]) + 0.11 * (scene.sunColor[2] + scene.skyColor[2]);
        this.exposureTarget = Math.min(2.4, Math.max(0.9, 1.75 / Math.pow(Math.max(0.05, key), 0.75)));
        scene.clearColor.set([side[0], side[1], side[2], 1]);
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
        this.light(dayT(state), eye);
        const post = this.game.renderer.postfx;
        if (post) {
            if (this.exposure === undefined || this.snapExposure) { this.exposure = this.exposureTarget; this.snapExposure = false; }
            const up = this.exposureTarget > this.exposure;
            this.exposure += (this.exposureTarget - this.exposure) * (1 - Math.exp(-dt * (up ? 1.5 : 0.6)));
            post.settings.exposure = this.exposure;
        }
        shared.u_player.set([pose.x, pose.y, pose.z, pose.glide ? 0 : 1]);
        syncShared();
        this.sky.setPosition(eye[0], eye[1], eye[2]);
        for (const g of this.grass) g.update(eye);

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
        this.drawAmbient(dt, eye);
    }

    drawFarm(state) {
        const home = this.world.islands[0];
        let ns = 0, nl = 0, nb = 0;
        const S = KIND.soil, C = KIND.cloth;
        for (const plot of state.plots.values()) {
            const x = plot.ix + 0.5, y = plot.iy + 0.5, z = topAt(home, x, y);
            this.soil.setTransform(ns, x, y, z + 0.02);
            const c = plot.watered ? PAL.soilWet : PAL.soil;
            this.soil.setColor(ns++, c[0], c[1], c[2], S);
            if (!plot.crop) continue;
            const crop = CROPS[plot.crop], g = plot.growth, ripe = g >= 1;
            const bob = ripe ? Math.sin(this.time * 3 + x) * 0.03 : 0;
            if (plot.crop === "turnip") {
                // leaves grow from a sprout to a full rosette, the root swells into a bulb in the second half
                const s = g < crop.stages[0] ? (g / crop.stages[0]) * 0.12 : 0.12 + 0.3 * Math.min(1, (g - crop.stages[0]) / (1 - crop.stages[0]));
                for (let k = 0; k < (g < crop.stages[0] ? 2 : 5); k++) {
                    const a = k * 2.4 + plot.ix;
                    this.leaves.setTransform(nl, x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4, z + 0.1 + s * 0.9 + bob, s * 0.7, s * 0.35, s * 2.2, a);
                    this.leaves.setColor(nl++, PAL.leaf[0], PAL.leaf[1], PAL.leaf[2], C);
                }
                if (g > 0.45) {
                    const b = 0.1 + 0.26 * Math.min(1, (g - 0.45) / 0.55);
                    this.bulbs.setTransform(nb, x, y, z + 0.12 + b * 0.35 + bob, b, b, b * 0.9);
                    const tc = ripe ? PAL.turnipTop : PAL.turnip;
                    this.bulbs.setColor(nb++, tc[0], tc[1], tc[2], C);
                }
            } else {
                // rope-grass: a tuft of tall blades
                const s = 0.15 + 0.85 * g;
                for (let k = 0; k < 6; k++) {
                    const a = k * 1.05 + plot.iy;
                    this.leaves.setTransform(nl, x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, z + 0.1 + s * 0.45, 0.05 + 0.05 * s, 0.05, s * 0.9, a);
                    this.leaves.setColor(nl++, PAL.rope[0], PAL.rope[1], PAL.rope[2], C);
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
            const c = it.kind === "seed" ? PAL.seed : PAL.turnipTop;
            this.seeds.setColor(n++, c[0], c[1], c[2], KIND.cloth);
            if (this._r() < 0.08) this.sparkle.emit(1, { position: [it.x, it.y, it.z + bob], spread: 0.25, speed: 0.3, life: [0.5, 1], size: [0.08, 0], color: [1.8, 1.5, 0.8, 1] });
        }
        this.seeds.count = n;
    }

    drawCursor(state) {
        const p = state.player, show = p.mode === "foot" && ["till", "plant", "water", "harvest"].includes(p.does);
        this.cursor.visible = show;
        if (show) this.cursor.setPosition(p.tx + 0.5, p.ty + 0.5, topAt(this.world.islands[0], p.tx + 0.5, p.ty + 0.5) + 0.12);
    }

    /** chimney smoke and the motes of pollen that drift in the afternoon light */
    drawAmbient(dt, eye) {
        if (this._r() < dt * 3) this.smoke.emit(1, { position: this.chimney, spread: 0.15, velocity: [shared.u_wind[0] * 0.8, shared.u_wind[1] * 0.8, 0.9], speed: 0.15, life: [4, 7], size: [0.35, 1.6], color: [0.92, 0.92, 0.9, 0.4], colorEnd: [0.9, 0.92, 0.95, 0] });
        const n = Math.round(dt * 40);
        for (let k = 0; k < n; k++) {
            const a = this._r() * Math.PI * 2, r = 2 + this._r() * 16;
            this.motes.emit(1, { position: [eye[0] + Math.cos(a) * r, eye[1] + Math.sin(a) * r, eye[2] - 1 + this._r() * 4], velocity: [shared.u_wind[0] * 0.6, shared.u_wind[1] * 0.6, 0.05], speed: 0.1, life: [3, 6], size: [0.05, 0.03], color: [1.4, 1.3, 0.9, 0.7], colorEnd: [1.2, 1.1, 0.8, 0] });
        }
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
