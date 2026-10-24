import { Entity, Mesh, Geometry, primitives, mat4 } from "../../engine/index.js";
import { topAt } from "../islands.js";
import { islandGeometry, terrainMaterial } from "./terrain.js";
import { buildGrass } from "./grass.js";
import { growTreeSteps, growPine, treeMaterials, OAK, APPLE, ELDER } from "./tree.js";
import { hearthProps, propMaterial, part } from "./props.js";
import { landmarkGeometry } from "./landmarks.js";
import { waterGeometry, waterMaterials } from "./water.js";

/**
 * SKYFARM: streaming the islands in and out (GDD §5: only nearby islands get full detail; far ones are low-detail
 * meshes inside the haze; load and unload with no hitches, and measure it).
 *
 * Every island has three tiers:
 *   far   a 20%-detail mesh and its landmark as a coarse silhouette. Built for every island at load; always kept.
 *   mid   a half-detail mesh, the landmark, its trees, its water (and Hearth Isle's buildings). Built within
 *         MID metres, freed beyond MID_DROP. Only islands within SHADOW metres cast sun shadows (the cascades
 *         reach 70 m; a caster further off can't land a shadow anywhere you're looking, but still costs a draw).
 *   near  the full mesh and its grass and flowers. Built within NEAR, freed beyond NEAR_DROP.
 * What's drawn is the best tier that is built and wanted: an island you're flying toward shows its far mesh
 * until its mid tier is ready, never a hole. The gaps between want and drop (hysteresis) stop an island at the
 * boundary from being built and freed over and over.
 *
 * Building runs as generator jobs, a step at a time, under BUDGET milliseconds a frame (the grass yields after
 * every chunk); `stats` records the longest a frame spent building, so the tools can report hitches. Freed tiers
 * give their GPU buffers back.
 * @module game/gfx/stream
 */

export const STREAM = Object.freeze({ NEAR: 230, NEAR_DROP: 320, MID: 560, MID_DROP: 760, BUDGET: 3, SHADOW: 160 });

/** run a job straight through (for building at load) */
export function runSync(gen) { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; }

export class Streamer {
    /**
     * @param {import("../world.js").World} view
     * @param {object} world makeWorld() result
     */
    constructor(view, world) {
        this.view = view;
        this.world = world;
        this.gl = view.game.renderer.gl;
        this.quality = view.quality;
        this.pm = propMaterial(false);
        this.pmUv = propMaterial(true);
        this.trees = { oak: treeMaterials(OAK), apple: treeMaterials(APPLE), elder: treeMaterials(ELDER), pine: treeMaterials({ ...OAK, leafDark: [0.13, 0.27, 0.2], leafLight: [0.4, 0.6, 0.38], bark: [0.36, 0.27, 0.22] }) };
        this.water = waterMaterials();
        this.jobs = [];
        this.stats = { built: { mid: 0, near: 0 }, freed: { mid: 0, near: 0 }, worstMs: 0, lastMs: 0, frames: 0 };
        /** waterfall bases, for the mist (world.js) */
        this.falls = [];
        this.records = world.islands.map((isl) => {
            const band = world.data.bands[isl.band] || { grass: [1, 1, 1], rock: [1, 1, 1] };
            const rec = { isl, band, material: terrainMaterial(isl, band.rock), far: null, mid: null, near: null, want: "far", pending: new Set(), dist: Infinity,
                /** 1 parched .. 0 green: eased toward the island's restored state; shared by its grass meshes */
                dry: { u_dry: isl.id === world.islands[0].id ? 0 : 1 }, sailAngle: 0 };
            rec.far = this.buildFar(rec);
            return rec;
        });
    }

    add(entities) { for (const e of entities) { e.interpolate = false; this.view.root.add(e); } return entities; }

    buildFar(rec) {
        const isl = rec.isl, out = [];
        out.push(new Entity({ name: isl.id, castShadow: false, mesh: new Mesh(islandGeometry(isl, [], 0.22, rec.band.grass), rec.material) }));
        out[out.length - 1].drawOrder = 1;
        const lm = landmarkGeometry(this.world.shapes.get(isl.id), 0.25);
        if (lm) out.push(new Entity({ name: isl.id + "-landmark", castShadow: false, mesh: new Mesh(lm, this.pm) }));
        // big trees are part of a far silhouette too (Apple Terraces, the Crown)
        return { entities: this.add(out) };
    }

    *buildMid(rec) {
        const isl = rec.isl, out = [], d = this.world.data, home = isl === this.world.islands[0];
        // the terrain draws after the props, grass and trees on it (engine drawOrder): most of it under them is never shaded
        out.push(new Entity({ name: isl.id, castShadow: false, mesh: new Mesh(islandGeometry(isl, home ? d.paths : [], 0.5, rec.band.grass), rec.material) }));
        out[out.length - 1].drawOrder = 1;
        yield;
        const lm = landmarkGeometry(this.world.shapes.get(isl.id), 0.6);
        if (lm) out.push(new Entity({ name: isl.id + "-landmark", mesh: new Mesh(lm, this.pm) }));
        const sails = landmarkGeometry(this.world.shapes.get(isl.id), 0.6, "sails");
        let sailEntity = null;
        if (sails) {
            // turn about the hub: the geometry is moved so the hub is its origin
            const hub = this.world.shapes.get(isl.id).find((s) => s.type === "cyl" && s.kind === "timber" && s.rot[0] === Math.PI / 2);
            const P = sails.positions;
            for (let i = 0; i < P.length; i += 3) { P[i] -= hub.at[0]; P[i + 1] -= hub.at[1]; P[i + 2] -= hub.at[2]; }
            sailEntity = new Entity({ name: isl.id + "-sails", mesh: new Mesh(sails, this.pm) });
            sailEntity.setPosition(hub.at[0], hub.at[1], hub.at[2]);
            sailEntity.cullRadius = 6;
            out.push(sailEntity);
        }
        // trees: one bark mesh and one leaf mesh per kind on this island
        const kinds = new Map(), fruit = [];
        const trees = [...(isl.trees || [])];
        if (home && d.tree) trees.push({ ...d.tree, kind: "oak" });
        if (isl.landmark.kind === "big-tree") trees.push({ x: isl.landmark.x, y: isl.landmark.y, seed: isl.seed, height: 22, kind: "apple" });
        if (isl.landmark.kind === "giant-tree") trees.push({ x: isl.landmark.x, y: isl.landmark.y, seed: isl.seed, height: 34, kind: "elder" });
        for (const t of trees) {
            const at = { x: t.x, y: t.y, z: topAt(isl, t.x, t.y), seed: t.seed, height: t.height };
            const g = t.kind === "pine" ? growPine(at) : yield* growTreeSteps(at, t.kind === "apple" ? APPLE : t.kind === "elder" ? ELDER : OAK);
            if (!kinds.has(t.kind)) kinds.set(t.kind, { bark: [], leaves: [] });
            kinds.get(t.kind).bark.push({ geometry: g.bark }); kinds.get(t.kind).leaves.push({ geometry: g.leaves });
            fruit.push(...g.fruit);
            yield;
        }
        for (const [kind, k] of kinds) {
            const m = this.trees[kind];
            out.push(new Entity({ name: "bark", mesh: new Mesh(Geometry.merge(k.bark), m.bark) }));
            out.push(new Entity({ name: "leaves", mesh: new Mesh(Geometry.merge(k.leaves), m.leaves) }));
        }
        if (fruit.length) {
            const ball = primitives.sphere(0.13, 8, 6);
            out.push(new Entity({ name: "fruit", mesh: new Mesh(Geometry.merge(fruit.map((f) => part(ball, f, "cloth", [0, 0, 0], [1, 1, 1], [0.9, 0.22, 0.16])), { uvs: false }), this.pm) }));
        }
        // water
        const water = waterGeometry(isl), falls = [];
        if (water.still) out.push(new Entity({ name: "water", castShadow: false, mesh: new Mesh(water.still, this.water.still) }));
        for (const f of water.falls) { out.push(new Entity({ name: "waterfall", castShadow: false, frustumCulled: false, mesh: new Mesh(f.geometry, this.water.fall) })); falls.push(f); }
        // Hearth Isle's buildings
        if (home) {
            const props = hearthProps(this.world);
            out.push(new Entity({ name: "props", mesh: new Mesh(props.mesh, this.pm) }));
            for (const g of props.roofs) out.push(new Entity({ name: "roof", mesh: new Mesh(g, this.pmUv) }));
            this.view.chimneyReady = true;
        }
        yield;
        return { entities: this.add(out), falls, sails: sailEntity };
    }

    *buildNear(rec) {
        const isl = rec.isl, d = this.world.data, home = isl === this.world.islands[0];
        const terrain = new Entity({ name: isl.id, castShadow: false, mesh: new Mesh(islandGeometry(isl, home ? d.paths : [], 1, rec.band.grass), rec.material) });
        yield;
        const grass = yield* buildGrass(isl, this.world, this.quality, rec.band.grass);
        for (const e of grass.entities) e.mesh.uniforms = rec.dry;
        return { entities: this.add([terrain, ...grass.entities]), terrain, grass };
    }

    free(rec, tier) {
        const t = rec[tier];
        if (!t) return;
        for (const e of t.entities) {
            this.view.root.remove(e);
            // landmark/terrain geometries are per tier; shared primitives (fruit balls) are cheap to rebuild
            if (e.mesh) { e.mesh.geometry.dispose(this.gl); e.mesh.dispose(this.gl); }
        }
        if (t.grass) t.grass.dispose(this.gl);
        rec[tier] = null;
        this.stats.freed[tier]++;
    }

    /**
     * Distances, wants, jobs and what's shown. Call once a frame with the camera's position.
     * @param {number[]} eye
     * @param {Set<string>} [restored] the restored islands (dryness, sails, water follow it)
     * @param {number} [dt]
     */
    update(eye, restored, dt = 1 / 60) {
        const S = STREAM;
        for (const rec of this.records) {
            const green = !restored || restored.has(rec.isl.id);
            // restoring: the island greens over about four seconds
            rec.dry.u_dry += ((green ? 0 : 1) - rec.dry.u_dry) * Math.min(1, dt * 0.7);
            rec.material.values.u_dry = rec.dry.u_dry;
            const isl = rec.isl, dx = isl.x - eye[0], dy = isl.y - eye[1], dz = (isl.top - eye[2]) * 0.5;
            const d = Math.max(0, Math.hypot(dx, dy, dz) - isl.radius);
            rec.dist = d;
            const wantNear = d < S.NEAR, wantMid = d < S.MID;
            if (wantMid && !rec.mid && !rec.pending.has("mid")) this.queue(rec, "mid", this.buildMid(rec));
            if (wantNear && !rec.near && !rec.pending.has("near")) this.queue(rec, "near", this.buildNear(rec));
            if (rec.near && d > S.NEAR_DROP) this.free(rec, "near");
            if (rec.mid && d > S.MID_DROP) this.free(rec, "mid");
            // show the best tier that is built
            const showNear = !!rec.near && d < S.NEAR_DROP, showMid = !!rec.mid && !showNear;
            const showFar = !showNear && !showMid;
            for (const e of rec.far.entities) e.visible = showFar;
            if (rec.mid && rec.mid.sails && green) {
                // a restored mill turns, slowly, in whatever wind there is
                rec.sailAngle += dt * 0.6;
                const q = rec.mid.sails.rotation, h = Math.sin(rec.sailAngle / 2);
                q[0] = 0.71 * h; q[1] = -0.71 * h; q[2] = 0; q[3] = Math.cos(rec.sailAngle / 2);
            }
            if (rec.mid) for (const e of rec.mid.entities) {
                // when near, the near terrain replaces the mid one; the landmark, trees and water stay
                e.visible = showMid || (showNear && e.name !== isl.id);
                // a parched island's water doesn't run
                if (e.name === "water" || e.name === "waterfall") e.visible = e.visible && green;
                e.castShadow = d < S.SHADOW && e.name !== "water" && e.name !== "waterfall";
            }
            if (rec.near) { for (const e of rec.near.entities) e.visible = showNear; if (showNear) rec.near.grass.update(eye); }
        }
        this.falls = this.records.filter((r) => !restored || restored.has(r.isl.id)).flatMap((r) => (r.mid && r.mid.falls) || []);
        this.run();
    }

    queue(rec, tier, gen) {
        rec.pending.add(tier);
        // nearer islands first; near tiers before mid ones at the same distance
        this.jobs.push({ rec, tier, gen, order: rec.dist - (tier === "near" ? 1000 : 0) });
        this.jobs.sort((a, b) => a.order - b.order);
    }

    /** work through the jobs until this frame's budget is spent */
    run() {
        const t0 = performance.now();
        while (this.jobs.length && performance.now() - t0 < STREAM.BUDGET) {
            const job = this.jobs[0], s0 = performance.now(), r = job.gen.next(), sm = performance.now() - s0;
            // the longest single step, and whose it was (a step can't be split, so this is the hitch floor)
            if (sm > (this.stats.worstStep?.ms || 0)) this.stats.worstStep = { ms: +sm.toFixed(1), island: job.rec.isl.id, tier: job.tier, step: job.steps || 0 };
            job.steps = (job.steps || 0) + 1;
            if (r.done) {
                this.jobs.shift();
                job.rec.pending.delete(job.tier);
                job.rec[job.tier] = r.value;
                this.stats.built[job.tier]++;
            }
        }
        const ms = performance.now() - t0;
        this.stats.lastMs = ms;
        if (ms > this.stats.worstMs) this.stats.worstMs = ms;
        this.stats.frames++;
    }

    /** build everything wanted right now, straight through (at load, so the first frame is complete) */
    settle(eye) {
        for (let k = 0; k < 3; k++) {
            this.update(eye);
            while (this.jobs.length) { const job = this.jobs.shift(); job.rec[job.tier] = runSync(job.gen); job.rec.pending.delete(job.tier); this.stats.built[job.tier]++; }
        }
        this.update(eye);
        this.stats.worstMs = 0;
        this.stats.worstStep = null;
    }

    /** GPU memory the islands' geometry holds now (vertex and index bytes), and how many tiers are built */
    memory() {
        let bytes = 0, mid = 0, near = 0;
        const geo = (g) => { for (const k of ["positions", "normals", "colors", "uvs", "indices"]) if (g[k]) bytes += g[k].byteLength; };
        for (const r of this.records) for (const tier of ["far", "mid", "near"]) {
            const t = r[tier];
            if (!t) continue;
            if (tier === "mid") mid++; if (tier === "near") near++;
            for (const e of t.entities) if (e.mesh) { geo(e.mesh.geometry); if (e.mesh.matrices) bytes += e.mesh.matrices.byteLength + e.mesh.colors.byteLength; }
        }
        return { mb: +(bytes / 1048576).toFixed(1), mid, near };
    }
}

export { mat4 };
