import { Entity, Mesh, InstancedMesh, Geometry, StandardMaterial, BasicMaterial, ParticleSystem, ShadowMap, primitives, mat4 } from "../engine/index.js";
import { groundAt, normalAt } from "./island.js";
import { teamColor, ISLAND, TIDE, WATER } from "./data.js";
import { MATCH_TICKS } from "./tide.js";
import { terrainMaterial, stoneMaterial, waterMaterial, skyMaterial, setSea, dropSeaMaterials } from "./gfx.js";
import { lootGeometry, palmParts, rockGeometry, campParts, kelpParts, rubbleParts, tuftParts, driftwoodParts, shellParts, part, merge } from "./models.js";
import { Raider, charactersReady } from "./characters.js";
import { FLAG } from "./protocol.js";

/**
 * TIDEFALL: the 3D scene. Presentation only: it reads the island and what the client knows of the match
 * and draws them. Nothing here changes the match.
 *
 * Draw calls stay few: terrain in 64 chunks (culled by the engine), every ruin and the wreck in one mesh,
 * all palms and rocks in one, each camp in one, the sea one grid that follows the camera, loot three
 * instanced meshes (one per kind), particles one draw per system. A player is one skinned mesh.
 *
 * The sun crosses the sky over the match: high and white at the first tide, low and orange at the last,
 * so tide 6 is played at sunset. The sea's marks (wet sand, foam, caustics) are in game/gfx.js.
 * @module game/world
 */

const CHUNK = 34;
const LOOT_MAX = 160;
const STONE = { stone: [0.66, 0.62, 0.55, 0.25], moss: [0.5, 0.56, 0.42, 0.25], rock: [0.5, 0.47, 0.43, 0.25], wood: [0.5, 0.34, 0.2, 0.6] };

/** colours over the match, at progress 0 (midday) and 1 (sunset) */
const DAY = { sun: [1.45, 1.3, 1.1], sky: [0.34, 0.44, 0.6], ground: [0.26, 0.22, 0.18], fog: [0.66, 0.79, 0.9], clear: [0.62, 0.78, 0.92] };
const DUSK = { sun: [1.6, 0.72, 0.36], sky: [0.42, 0.36, 0.52], ground: [0.3, 0.2, 0.18], fog: [0.86, 0.58, 0.46], clear: [0.9, 0.55, 0.4] };
const UNDER = { fog: [0.04, 0.26, 0.32] };
const mix3 = (a, b, t, out) => { for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };

export class World {
    /** @param {import("../engine/Game.js").Game} game */
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.root = null;
        /** id → { root, raider?, team } */
        this.players = new Map();
        /** where each drawn player is this frame: id → { x, y, z, fx, fy, face, swim } */
        this.carriers = new Map();
        this.time = 0;
        this.quality = "high";
        this.reducedMotion = false;
        this.wetLine = TIDE.high;
        this.progress = 0;

        // loot: one instanced mesh per kind; the idol's material glows a little on its own
        this.loot = [null, 1, 2, 3].map((kind) => {
            if (!kind) return null;
            const material = new StandardMaterial({ vertexColors: true, specular: kind === 1 ? 0.9 : 0.5, shininess: kind === 1 ? 60 : 30, emissive: kind === 3 ? [0.35, 0.08, 0.25] : [0, 0, 0] });
            const mesh = new InstancedMesh(lootGeometry(kind), material, LOOT_MAX);
            mesh.count = 0;
            const e = this.scene.add(new Entity({ name: "loot" + kind, mesh, frustumCulled: false }));
            e.interpolate = false;
            return mesh;
        });

        // grapple ropes: one line mesh for all of them, rewritten each frame
        this.ropeGeometry = new Geometry({ name: "ropes", mode: "lines", dynamic: true, positions: new Float32Array(8 * 6), colors: new Float32Array(8 * 8).fill(1) });
        for (let i = 0; i < 16; i++) this.ropeGeometry.colors.set([0.92, 0.86, 0.7, 1], i * 4);
        this.ropeGeometry.drawCount = 0;
        this.ropeEntity = this.scene.add(new Entity({ name: "ropes", castShadow: false, frustumCulled: false, mesh: new Mesh(this.ropeGeometry, new BasicMaterial({ lit: false, vertexColors: true })) }));
        this.ropeEntity.interpolate = false;
        this.ropeCount = 0;
        this.flares = [];
        this._flareGeometry = primitives.sphere(0.22, 12, 8);
        this._capsule = primitives.capsule(0.35, 1.1, 6, 12);

        const particles = (options) => { const p = this.scene.add(new ParticleSystem(options)); p.castShadow = false; p.frustumCulled = false; return p; };
        this.spray = particles({ capacity: 900, gravity: [0, 0, -9], drag: 1.2, blending: "normal", name: "spray" });
        this.sparkle = particles({ capacity: 500, gravity: [0, 0, 1.5], drag: 2, name: "sparkle" });
        this.dust = particles({ capacity: 400, gravity: [0, 0, 0.6], drag: 3, blending: "normal", name: "dust" });
        this.embers = particles({ capacity: 600, gravity: [0, 0, 2.5], drag: 1.5, name: "embers" });
        this.bubbles = particles({ capacity: 300, gravity: [0, 0, 2.2], drag: 1.5, blending: "normal", name: "bubbles" });
        this.fires = [];
        this._c = [0, 0, 0];
    }

    /** Shadows on or off; quality changes the sea's detail. */
    setShadows(on) { this.shadowsWanted = on; this.scene.shadow = on ? new ShadowMap({ cascades: 2, distance: 70, size: 1536, strength: 0.75 }) : null; }
    setQuality(q) { this.quality = q; if (this.waterMat) this.waterMat.values.u_quality = q === "low" ? 0 : 1; }

    /** Build the scene for an island. */
    loadIsland(island) {
        if (this.root) this.scene.remove(this.root);
        for (const id of [...this.players.keys()]) this.removePlayer(id);
        dropSeaMaterials();
        this.island = island;
        const root = (this.root = this.scene.add(new Entity({ name: "island" })));
        const scene = this.scene;
        scene.pointLights.length = 0;
        this.flares.length = 0;
        this.fires.length = 0;
        this.wetLine = TIDE.high;
        if (this.shadowsWanted !== false && !scene.shadow) this.setShadows(true);

        // sky
        const sky = new Entity({ name: "sky", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.sphere(800, 28, 18), (this.skyMat = skyMaterial())) });
        sky.interpolate = false;
        root.add(sky);
        this.sky = sky;

        // terrain chunks
        const tm = terrainMaterial(), half = island.half, chunks = Math.ceil(island.size / CHUNK), step = island.cell, nrm = [0, 0, 1];
        for (let cy = 0; cy < chunks; cy++) for (let cx = 0; cx < chunks; cx++) {
            const x0 = -half + cx * CHUNK, y0 = -half + cy * CHUNK, seg = Math.round(CHUNK / step), w = seg + 1;
            const positions = new Float32Array(w * w * 3), normals = new Float32Array(w * w * 3), colors = new Float32Array(w * w * 4).fill(1);
            for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
                const x = Math.min(half, x0 + i * step), y = Math.min(half, y0 + j * step), k = j * w + i;
                normalAt(island, x, y, nrm);
                positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = groundAt(island, x, y);
                normals.set(nrm, k * 3);
            }
            const indices = new Uint32Array(seg * seg * 6);
            let n = 0;
            for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices[n++] = a; indices[n++] = b; indices[n++] = d; indices[n++] = a; indices[n++] = d; indices[n++] = c; }
            // terrain receives shadows but casts none: its own hills barely shade it, and 64 chunks in three cascades cost more than everything else in the frame
            root.add(new Entity({ name: "terrain", castShadow: false, mesh: new Mesh(new Geometry({ positions, normals, colors, indices }), tm) }));
        }
        // the sea floor beyond the map, so the deep never shows the void
        const skirt = new Entity({ name: "far-floor", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.plane(1600, 1600), tm) });
        skirt.setPosition(0, 0, -14.2);
        root.add(skirt);

        // ruins and the wreck: one mesh, stone or wood by colour alpha (gfx.js stoneMaterial); rubble and kelp around them
        const sm = stoneMaterial(), parts = [];
        for (const s of island.solids) {
            const w = s.x1 - s.x0, d = s.y1 - s.y0, h = s.z1 - s.z0;
            parts.push({ geometry: primitives.box(w, d, h), matrix: mat4.fromTranslation(mat4.create(), [s.x0 + w / 2, s.y0 + d / 2, s.z0 + h / 2]), color: STONE[s.mat] || STONE.stone });
        }
        let seed = 1;
        for (const r of island.ruins) {
            if (r.kind !== "wreck") parts.push(...rubbleParts(r.x, r.y, r.z, seed++, 7));
            // kelp only where the sea floor is deep enough to keep it under most of the time
            if (r.z < -3) for (let k = 0; k < 4; k++) {
                const a = seed * 2.3 + k * 1.7, d = 7 + (k % 2) * 3, kx = r.x + Math.cos(a) * d, ky = r.y + Math.sin(a) * d;
                parts.push(...kelpParts(kx, ky, groundAt(island, kx, ky), seed + k, r.z < -5 ? 2.6 : 1.5));
            }
        }
        root.add(new Entity({ name: "ruins", staticShadow: true, mesh: new Mesh(merge(parts), sm) }));

        // camps: tent, chest, flag, fire; a light and embers at each fire
        for (const camp of island.camps) {
            const c = campParts(camp.x, camp.y, camp.z, camp.angle, teamColor(camp.team));
            c.parts.push(part(primitives.torus(ISLAND.bankRadius, 0.07, 6, 48), [camp.x, camp.y, camp.z + 0.04], [...teamColor(camp.team), 1]));
            root.add(new Entity({ name: "camp", staticShadow: true, mesh: new Mesh(merge(c.parts), sm) }));
            const light = { position: [c.fire[0], c.fire[1], c.fire[2] + 0.6], color: [1.6, 0.8, 0.3], radius: 9 };
            scene.pointLights.push(light);
            this.fires.push({ at: c.fire, light });
        }

        // palms and rocks: one mesh. Palms on the green, rocks on the beach and the floor
        const deco = [];
        const rand = (() => { let s = (island.seed ^ 0x2545f491) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();
        const near = (x, y, r) => island.solids.some((s) => x > s.x0 - r && x < s.x1 + r && y > s.y0 - r && y < s.y1 + r) || island.camps.some((c) => Math.hypot(c.x - x, c.y - y) < ISLAND.campPad + r);
        for (let n = 0, tries = 0; n < 46 && tries < 600; tries++) {
            const a = rand() * Math.PI * 2, r = 8 + rand() * 46, x = Math.cos(a) * r, y = Math.sin(a) * r, z = groundAt(island, x, y);
            // palms stay clear of the camps (they would stand between the camera and the player there)
            if (z < 2.8 || near(x, y, 3) || island.camps.some((c) => Math.hypot(c.x - x, c.y - y) < ISLAND.campPad + 9)) continue;
            deco.push(...palmParts(x, y, z - 0.1, rand() * 1000)); n++;
        }
        for (let n = 0, tries = 0; n < 90 && tries < 900; tries++) {
            const a = rand() * Math.PI * 2, r = 40 + rand() * 90, x = Math.cos(a) * r, y = Math.sin(a) * r;
            if (near(x, y, 2)) continue;
            const z = groundAt(island, x, y), size = 0.4 + rand() * rand() * 1.8;
            const rock = rockGeometry(rand() * 100, size, z < 0 ? [0.42, 0.44, 0.4, 1] : [0.58, 0.54, 0.49, 1]);
            deco.push(part(rock.geometry, [x, y, z], rock.color, [0, 0, rand() * 6.28]));
            n++;
        }
        // beach grass on the dunes, driftwood on the sand, shells and starfish on the sea floor
        for (let n = 0, tries = 0; n < 320 && tries < 3000; tries++) {
            const a = rand() * Math.PI * 2, r = 20 + rand() * 120, x = Math.cos(a) * r, y = Math.sin(a) * r, z = groundAt(island, x, y);
            if (near(x, y, 1)) continue;
            if (z > 1.5 && z < 6.5) deco.push(...tuftParts(x, y, z, rand() * 100));
            else if (z > -0.5 && z <= 1.5) deco.push(...(rand() < 0.4 ? driftwoodParts(x, y, z, rand() * 10) : shellParts(x, y, z, rand() * 10)));
            else if (z < -0.5) deco.push(...shellParts(x, y, z, rand() * 10));
            else continue;
            n++;
        }
        // the dry rocks: a heap of boulders on each
        for (const k of island.rocks) for (let b = 0; b < 4; b++) {
            const a = b * 1.7 + k.x, rock = rockGeometry(k.x + b, 1.1 + (b % 2) * 0.5, [0.55, 0.51, 0.46, 1]);
            deco.push(part(rock.geometry, [k.x + Math.cos(a) * 1.5, k.y + Math.sin(a) * 1.5, groundAt(island, k.x, k.y) - 0.2], rock.color, [0, 0, a]));
        }
        root.add(new Entity({ name: "deco", staticShadow: true, mesh: new Mesh(merge(deco), new StandardMaterial({ vertexColors: true, specular: 0.1 })) }));

        // the sea: a grid that follows the camera
        this.waterMat = waterMaterial(island);
        this.setQuality(this.quality);
        this.sea = new Entity({ name: "sea", castShadow: false, frustumCulled: false, mesh: new Mesh(primitives.plane(560, 560, 140, 140), this.waterMat) });
        this.sea.interpolate = false;
        root.add(this.sea);
        return root;
    }

    // ------------------------------------------------------------------ players

    removePlayer(id) {
        const p = this.players.get(id);
        if (!p) return;
        this.scene.remove(p.root);
        this.players.delete(id);
    }

    playerEntity(id, team) {
        let p = this.players.get(id);
        if (p && p.team === team && (p.raider || !charactersReady())) return p;
        if (p) this.removePlayer(id);
        if (charactersReady()) {
            const raider = new Raider(teamColor(team), id);
            this.scene.add(raider.root);
            p = { root: raider.root, raider, team };
        } else {
            const root = this.scene.add(new Entity({ name: "player" }));
            root.interpolate = false;
            const body = new Entity({ name: "body", mesh: new Mesh(this._capsule, new StandardMaterial({ color: teamColor(team) })) });
            body.setPosition(0, 0, 0.9);
            root.add(body);
            p = { root, team };
        }
        this.players.set(id, p);
        return p;
    }

    /** Recolour everyone (the colour-blind setting changed). */
    recolor() { for (const p of this.players.values()) if (p.raider) p.raider.setColor(teamColor(p.team)); }

    /** A player's body begins a shove (my own at once, others when the event arrives). */
    shove(id) { const p = this.players.get(id); if (p && p.raider) p.raider.shove(); }

    /**
     * Draw every player: my own where prediction puts it, the others where interpolation says they were.
     * @returns {number[]} ids whose foot came down this frame (for footstep sounds)
     */
    drawPlayers(client, me, dt) {
        const seen = this._seen || (this._seen = new Set()), s = this._sample || (this._sample = {}), steps = this._steps || (this._steps = []);
        seen.clear(); steps.length = 0;
        this.carriers.clear();
        const level = this.level ?? 0;
        for (const [id, info] of client.players) {
            if (id === client.id) {
                const p = client.me;
                s.x = me.x; s.y = me.y; s.z = me.z; s.face = Math.atan2(p.fy, p.fx);
                s.flags = (p.alive ? FLAG.alive : 0) | (p.ground ? FLAG.ground : 0) | (p.water === 2 ? FLAG.swim : 0) | (p.water === 3 ? FLAG.sunk : 0) | (p.hook ? FLAG.hook : 0) | (p.stun > 0 ? FLAG.stun : 0) | (p.weight >= 7 ? FLAG.idol : 0);
                s.speed = Math.hypot(p.vx, p.vy); s.vz = p.vz;
            } else if (!client.sample(id, s)) continue;
            seen.add(id);
            const e = this.playerEntity(id, info.team);
            s.wade = level - s.z > WATER.wadeDepth;
            if (e.raider) { if (e.raider.update(dt, s)) steps.push(id); }
            else { e.root.visible = (s.flags & FLAG.alive) !== 0; e.root.setPosition(s.x, s.y, s.z); e.root.setYaw(s.face); }
            // under water, a swimmer's breath rises now and then
            if ((s.flags & FLAG.alive) && level > s.z + 1.6 && Math.random() < dt * 3) this.bubbles.emit(2, { position: [s.x, s.y, s.z + 1.6], spread: 0.15, speed: 0.3, life: [0.6, 1.4], size: [0.09, 0.05], color: [0.85, 0.95, 1, 0.8] });
            this.carriers.set(id, { x: s.x, y: s.y, z: s.z, fx: Math.cos(s.face), fy: Math.sin(s.face), face: s.face, swim: (s.flags & FLAG.swim) !== 0 });
        }
        for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);
        return steps;
    }

    /** Draw the loot: everything lying about, and what each player carries on their back. */
    drawLoot(client) {
        const t = this.time, stack = this._stack || (this._stack = new Map()), count = [0, 0, 0, 0];
        stack.clear();
        for (const item of client.loot.values()) {
            const m = this.loot[item.kind];
            if (!m || count[item.kind] >= LOOT_MAX) continue;
            let x = item.x, y = item.y, z = item.z, spin = item.id * 1.3, scale = 1;
            if (item.holder) {
                const at = this.carriers.get(item.holder);
                if (!at) continue;
                const k = stack.get(item.holder) || 0;
                stack.set(item.holder, k + 1);
                // a pack on the back, stacked up; swimming, it rides on the back flat
                x = at.x - at.fx * 0.32; y = at.y - at.fy * 0.32; z = at.z + (at.swim ? 0.55 : 1.05) + k * 0.24; spin = at.face; scale = 0.8;
            } else {
                // lying loot bobs a little and turns, so it reads as something to take; under water it rests
                const dry = z > (this.level ?? -99);
                if (dry && !this.reducedMotion) { z += 0.06 + Math.sin(t * 2 + item.id) * 0.05; spin += t * 0.6; }
            }
            m.setTransform(count[item.kind]++, x, y, z, scale, scale, scale, spin);
        }
        for (let k = 1; k <= 3; k++) this.loot[k].count = count[k];
    }

    // ------------------------------------------------------------------ effects

    beginRopes() { this.ropeCount = 0; }
    rope(ax, ay, az, bx, by, bz) {
        if (this.ropeCount >= 8) return;
        this.ropeGeometry.positions.set([ax, ay, az, bx, by, bz], this.ropeCount * 6);
        this.ropeCount++;
    }
    endRopes() { this.ropeGeometry.drawCount = this.ropeCount * 2; this.ropeGeometry.markDirty(); }

    flare(x, y, z, color, seconds) {
        const c = color.map((v) => v * 4);
        const entity = this.root.add(new Entity({ name: "flare", castShadow: false, mesh: new Mesh(this._flareGeometry, new StandardMaterial({ color, emissive: c })) }));
        entity.setPosition(x, y, z + 0.5);
        const light = { position: [x, y, z + 1.2], color: color.map((v) => v * 3.5), radius: 16 };
        this.scene.pointLights.push(light);
        this.flares.push({ entity, light, ttl: seconds, color, x, y, z: z + 0.5 });
        this.sparkle.emit(60, { position: [x, y, z + 0.5], speed: 6, life: [0.3, 0.9], size: [0.25, 0], color: [c[0], c[1], c[2], 1] });
    }
    puff(x, y, z, wet) {
        if (wet) { this.splash(x, y, z, 0.8); return; }
        this.dust.emit(26, { position: [x, y, z + 0.9], spread: 0.3, speed: 2.6, life: [0.3, 0.7], size: [0.35, 0.1], color: [0.85, 0.78, 0.6, 0.7], colorEnd: [0.85, 0.78, 0.6, 0] });
    }
    /** Kicked-up sand from a landing or a sprint step. */
    kick(x, y, z, n = 6) { this.dust.emit(n, { position: [x, y, z + 0.1], spread: 0.2, speed: 1.0, life: [0.2, 0.4], size: [0.14, 0.04], color: [0.9, 0.82, 0.62, 0.3], colorEnd: [0.9, 0.82, 0.62, 0] }); }
    splash(x, y, z, strength = 1) {
        this.spray.emit(Math.round(14 + 26 * strength), { position: [x, y, z + 0.05], spread: 0.4, velocity: [0, 0, 2.5 * strength], speed: 2.2 * strength, life: [0.4, 0.9], size: [0.16, 0.04], color: [0.85, 0.95, 1, 0.9], colorEnd: [0.7, 0.9, 1, 0] });
    }
    glint(x, y, z, color, n = 24) {
        this.sparkle.emit(n, { position: [x, y, z], spread: 0.3, speed: 2.4, life: [0.3, 0.8], size: [0.18, 0], color: [color[0] * 2.5, color[1] * 2.5, color[2] * 2.5, 1] });
    }
    /** Loot sinking: a stream of bubbles where it went. */
    sink(x, y, z) { this.bubbles.emit(30, { position: [x, y, z + 0.5], spread: 0.4, speed: 0.8, life: [0.6, 1.6], size: [0.14, 0.05], color: [0.85, 0.95, 1, 0.9] }); }

    /**
     * The sea, the sun and the time of day.
     * @param {number} level water height @param {number} tick the match tick being drawn
     * @param {number} under 0..1, the camera under water @param {ArrayLike<number>} eye camera position
     */
    setWater(level, tick, under, eye) {
        this.level = level;
        if (!this.island) return;
        // the wet line follows the water up at once and lags behind it going down, drying at 9 cm a second
        const dt = this._dt || 0;
        this.wetLine = Math.max(level, this.wetLine - dt * 0.09);
        setSea(level, this.wetLine, under > 0.5 ? 1 : 0);
        // the sea grid snaps to 4 m under the camera, so its waves don't swim as it moves
        if (this.sea) this.sea.setPosition(Math.round(eye[0] / 4) * 4, Math.round(eye[1] / 4) * 4, 0);
        if (this.sky) this.sky.setPosition(eye[0], eye[1], eye[2]);

        // the sun: from high in the east at the first ebb to low in the west at the last flood
        const t = Math.max(0, Math.min(1, tick / MATCH_TICKS));
        this.progress = t;
        const az = -0.6 + t * 2.4, el = 1.05 - Math.pow(t, 1.25) * 0.96;
        const sd = this.scene.sunDirection, ce = Math.cos(el);
        sd[0] = Math.cos(az) * ce; sd[1] = Math.sin(az) * ce; sd[2] = Math.sin(el);
        const dusk = Math.max(0, Math.min(1, (t - 0.45) / 0.55)), d = dusk * dusk * (3 - 2 * dusk), c = this._c, sc = this.scene;
        sc.sunColor.set(mix3(DAY.sun, DUSK.sun, d, c));
        sc.skyColor.set(mix3(DAY.sky, DUSK.sky, d, c));
        sc.groundColor.set(mix3(DAY.ground, DUSK.ground, d, c));
        mix3(DAY.fog, DUSK.fog, d, c);
        mix3(c, UNDER.fog, under, c);
        sc.fogColor.set(c);
        sc.fogDensity = 0.0028 + 0.085 * under;
        mix3(DAY.clear, DUSK.clear, d, c);
        sc.clearColor.set([c[0], c[1], c[2], 1]);
        if (this.skyMat) { this.skyMat.values.u_sunset = d; this.skyMat.values.u_under = under; }
    }

    update(dt) {
        this.time += dt;
        this._dt = dt;
        for (const f of this.fires) {
            const k = 0.8 + 0.2 * Math.sin(this.time * 13 + f.at[0]) * Math.sin(this.time * 7.3);
            f.light.color[0] = 1.7 * k; f.light.color[1] = 0.8 * k; f.light.color[2] = 0.3 * k;
            if (Math.random() < dt * 12) this.embers.emit(1, { position: f.at, spread: 0.2, velocity: [0, 0, 1.5], speed: 0.5, life: [0.6, 1.3], size: [0.1, 0], color: [3, 1.4, 0.4, 1] });
            if (Math.random() < dt * 25) this.sparkle.emit(1, { position: [f.at[0], f.at[1], f.at[2] - 0.2], spread: 0.15, velocity: [0, 0, 0.8], speed: 0.2, life: [0.2, 0.4], size: [0.35, 0.1], color: [2.6, 1.0, 0.25, 1] });
        }
        for (let i = this.flares.length - 1; i >= 0; i--) {
            const f = this.flares[i];
            f.ttl -= dt;
            const k = Math.max(0, Math.min(1, f.ttl)) * (0.85 + 0.15 * Math.sin(this.time * 31 + i));
            for (let j = 0; j < 3; j++) f.light.color[j] = f.color[j] * 3.5 * k;
            if (Math.random() < dt * 30) this.embers.emit(1, { position: [f.x, f.y, f.z], spread: 0.1, velocity: [0, 0, 1.2], speed: 0.6, life: [0.5, 1.1], size: [0.12, 0], color: [f.color[0] * 3, f.color[1] * 3, f.color[2] * 3, 1] });
            if (f.ttl <= 0) {
                this.root.remove(f.entity);
                const at = this.scene.pointLights.indexOf(f.light);
                if (at >= 0) this.scene.pointLights.splice(at, 1);
                this.flares.splice(i, 1);
            }
        }
    }
}
