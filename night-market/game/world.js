import { Entity, Mesh, InstancedMesh, Geometry, BasicMaterial, StandardMaterial, ShadowMap, ParticleSystem, primitives, mat4, quat } from "../engine/index.js";
import { STREET, STALLS, STALL_TYPES, LEVELS, NIGHT, MANAGERS, MANAGER_IDS } from "./data.js";
import { slotX, streetEnds, stallAt, worker, vendorById, hiredVendors, neighbours, relation, has, tables, seatCount, seatSpot } from "./sim.js";
import { createGroundMaterial, createSky, signTexture, createRain, ToonMaterial } from "./gfx.js";
import { Character, makeDog } from "./characters.js";

/**
 * NIGHT MARKET — the 3D scene. Pure presentation: it reads the simulation state and draws it, and never
 * changes it.
 *
 *   street    every stall, table, gate and building is a loaded model; they are merged into ONE mesh by
 *             rebuild(), so the whole street is one draw call (and one more in the shadow pass)
 *   people    one skinned mesh each, created the first time someone appears and removed when they leave
 *   weather   rain is one mesh animated in its vertex shader and a wet sheen on the ground; a festival night
 *             strings bunting over the walkway and sets off fireworks behind the city
 *   light     an evening sun that casts shadows and fades to moonlight as the night goes on, plus a point
 *             light per open stall; ambient occlusion and bloom come from the engine's PostFX
 * @module game/world
 */

const TAU = Math.PI * 2;
/** cheap repeatable noise for decoration (never for gameplay) */
const noise = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const lerp = (a, b, t) => a + (b - a) * t;
/** overshoots a little past 1 before settling: things pop into place */
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const PROPS = { critic: "notebook", student: "backpack", landlord: "tophat", rival: "shades", nurse: "cap", guide: "flag", inspector: "notebook" };
const ACCENTS = { student: [0.98, 0.56, 0.2], landlord: [0.85, 0.68, 0.25], nurse: [0.9, 0.18, 0.22], guide: [1.0, 0.82, 0.1] };
const FESTIVE = [[2.2, 0.45, 0.3], [2.1, 1.5, 0.3], [0.4, 1.9, 1.1], [0.5, 0.9, 2.3], [2.0, 0.5, 1.6]];
const SEAT = { x: 0, y: 0, tx: 0, ty: 0 };
const UNIT_BOX = primitives.box(1, 1, 1);

/** Lighting at sunset [0] and at night [1]; everything in between is a blend. */
const LIGHT = {
    sun: [[1.42, 1.02, 0.7], [0.22, 0.27, 0.45]],
    sky: [[0.34, 0.36, 0.52], [0.13, 0.14, 0.27]],
    ground: [[0.24, 0.19, 0.18], [0.05, 0.045, 0.08]],
    fog: [[0.66, 0.5, 0.46], [0.03, 0.026, 0.065]],
    fogDensity: [0.002, 0.006],
    lamps: [0.4, 1.2],
    shadow: [0.78, 0.5],
};

const M = mat4.create(), Q = quat.create(), T3 = new Float32Array(3), S3 = new Float32Array(3);

export class World {
    /**
     * @param {import("../engine/index.js").Game} game
     * @param {Awaited<ReturnType<import("./assets.js").loadAssets>>} assets
     */
    constructor(game, assets) {
        this.game = game;
        this.assets = assets;
        this.reducedMotion = false;
        const scene = game.scene;
        this.sky = createSky();
        scene.sky = this.sky;
        scene.sunDirection.set(normalize([-0.42, -0.52, 0.74]));
        scene.shadow = new ShadowMap({ size: 2048, depth: 90, strength: 0.7, normalBias: 0.06 });
        this.root = scene.add(new Entity({ name: "world" }));

        this.groundMaterial = createGroundMaterial();
        this.ground = this.root.add(new Entity({ name: "ground", mesh: new Mesh(primitives.plane(260, 110), this.groundMaterial) }));
        this.ground.setPosition(14, -4, 0);

        // the street: one merged mesh, replaced by rebuild()
        this.streetMaterial = new ToonMaterial({ vertexColors: true });
        this.street = this.root.add(new Entity({ name: "street" }));
        this.signs = this.root.add(new Entity({ name: "signs" }));
        this.signPlane = primitives.plane(1.96, 0.62);
        this.signMaterials = new Map();

        this.people = this.root.add(new Entity({ name: "people" }));
        /** key ("c12", "v3") → { character, kind, yaw, cheer, … } */
        this.cast = new Map();
        this.dog = null;
        this._stamp = 0;

        // what people carry away: one instanced mesh per kind of food
        this.food = {};
        const foodMaterial = new ToonMaterial({ vertexColors: true });
        for (const type of STALL_TYPES) {
            const mesh = new InstancedMesh(assets.props.geometry("food_" + type), foodMaterial, 96);
            mesh.count = 0;
            const e = this.root.add(new Entity({ name: "food-" + type, mesh }));
            e.interpolate = false;
            this.food[type] = mesh;
        }

        // slot markers: one glowing tile per possible slot, shown while placing or moving a stall
        const tile = primitives.plane(2.6, 2.5);
        this.slotTiles = [];
        for (let i = 0; i < STREET.maxSlots; i++) {
            const e = this.root.add(new Entity({ name: "slot" + i, visible: false,
                mesh: new Mesh(tile, new BasicMaterial({ lit: false, color: [0.3, 1.2, 0.7], opacity: 0.35, blending: "additive", depthWrite: false, cull: "none" })) }));
            e.setPosition(slotX(i), STREET.stallY + 0.05, 0.08);
            this.slotTiles.push(e);
        }
        this.slotMode = null;

        this.ring = this.root.add(new Entity({ name: "ring", visible: false,
            mesh: new Mesh(primitives.torus(1, 0.05, 6, 40), new BasicMaterial({ lit: false, color: [1.6, 2.4, 2.6] })) }));
        this.selected = null;

        this.steam = this.root.add(new ParticleSystem({ name: "steam", capacity: 900, gravity: [0, 0, 0.9], drag: 0.7, blending: "normal" }));
        this.sparks = this.root.add(new ParticleSystem({ name: "sparks", capacity: 1600, gravity: [0, 0, -7], drag: 0.5 }));
        this.rain = this.root.add(new Entity({ name: "rain", visible: false, mesh: createRain() }));
        /** 0 dry … 1 raining; eased, so the weather rolls in */
        this.wet = 0;
        this.fireworkClock = 1;
        for (const e of [this.ground, this.ring, this.street, this.rain, ...this.slotTiles]) e.interpolate = false;

        /** where things are, for labels and picking: key ("c12", "v3", "s7") → [x, y, z] */
        this.anchors = new Map();
        /** the scene's point lights with their base colours, so they can breathe and flicker */
        this.lamps = [];
        this.dusk = 0;
        this._dt = 0;
        this.steamClock = 0;
        this.state = null;
        this.setDusk(0);
    }

    // ------------------------------------------------------------------ light
    /** 0 = sunset (before opening), 1 = deep night (closing time). */
    setDusk(d) {
        this.dusk = d;
        const scene = this.game.scene, mix3 = (out, pair) => { for (let i = 0; i < 3; i++) out[i] = lerp(pair[0][i], pair[1][i], d); };
        mix3(scene.sunColor, LIGHT.sun); mix3(scene.skyColor, LIGHT.sky); mix3(scene.groundColor, LIGHT.ground); mix3(scene.fogColor, LIGHT.fog);
        scene.clearColor.set([scene.fogColor[0], scene.fogColor[1], scene.fogColor[2], 1]);
        scene.shadow.strength = lerp(LIGHT.shadow[0], LIGHT.shadow[1], d);
        scene.fogDensity = lerp(LIGHT.fogDensity[0], LIGHT.fogDensity[1], d);
        this.sky.uniforms.u_dusk = d;
        this.sky.uniforms.u_haze.set(scene.fogColor);
    }

    /** Sun shadows and ambient occlusion on or off (the settings screen). */
    setShadows(on) {
        this.game.scene.shadow.enabled = on;
        if (this.game.renderer.postfx) this.game.renderer.postfx.settings.ao.enabled = on;
    }

    // ------------------------------------------------------------------ static scene
    /** Rebuild the street for this state. Call after anything that changes the layout. */
    rebuild(s) {
        this.state = s;
        const A = this.assets, P = A.props, parts = [], lights = [];
        const ends = streetEnds(s), gateL = -2.5, gateR = slotX(s.slots - 1) + 2.5, span = gateR - gateL;
        this.groundMaterial.values.u_street[0] = ends.left - 30;
        this.groundMaterial.values.u_street[1] = ends.right + 30;
        // forget stalls that were sold and vendors who have left
        for (const k of [...this.anchors.keys()]) if (k[0] === "s" || (k[0] === "v" && !vendorById(s, Number(k.slice(1)))?.hired)) this.anchors.delete(k);

        /** place a loaded model (stood upright), optionally turned, scaled and tinted */
        const put = (geometry, x, y, z = 0, yaw = 0, scale = 1, color) => {
            quat.setAxisAngle(Q, [0, 0, 1], yaw);
            quat.multiply(Q, Q, A.upright);
            T3[0] = x; T3[1] = y; T3[2] = z; S3[0] = S3[1] = S3[2] = scale;
            parts.push({ geometry, matrix: new Float32Array(mat4.fromRotationTranslationScale(M, Q, T3, S3)), color });
        };
        /** a plain box, for the city in the background */
        const block = (x, y, z, w, d, h, color) => {
            parts.push({ geometry: UNIT_BOX, matrix: new Float32Array([w, 0, 0, 0, 0, d, 0, 0, 0, 0, h, 0, x, y, z, 1]), color });
        };

        // low wall behind the stalls
        block((gateL + gateR) / 2, 5.3, 0.7, span + 16, 0.25, 1.4, [0.5, 0.42, 0.4]);

        // gates at both ends, each with its own colour of neon
        for (const [gx, hue] of [[gateL, [2.4, 0.5, 1.5]], [gateR, [0.5, 1.7, 2.4]]]) {
            put(P.geometry("gate"), gx, 0);
            put(P.geometry("gate_glow"), gx, 0, 0, 0, 1, hue);
            lights.push({ x: gx, y: -3.3, z: 3.4, r: 7.5, c: [hue[0] * 0.36, hue[1] * 0.36, hue[2] * 0.36] });
        }

        // slots and stalls
        const signsWanted = [];
        for (let slot = 0; slot < s.slots; slot++) {
            const x = slotX(slot), stall = stallAt(s, slot);
            if (!stall) { put(P.geometry("plot"), x, 3.15); continue; }
            const def = STALLS[stall.type], v = stall.vendorId != null ? vendorById(s, stall.vendorId) : null, open = !!(v && v.hired && !v.off);
            const tier = LEVELS[stall.level].tier;
            this._stall(put, A.stalls[stall.type], x, tier, open);
            signsWanted.push({ type: stall.type, x, open });
            this.anchors.set("s" + stall.id, [x, 2.6, 4.35 + (tier === 3 ? 0.5 : 0)]);
            if (open) lights.push({ x, y: 1.3, z: 2.2, r: 6.4 + tier * 0.6, c: [def.color[0] * 1.2, def.color[1] * 1.2, def.color[2] * 1.2], stall: stall.id });
        }
        // the competing stall Finch opens at the end of the street
        if (s.rivalStall) {
            const x = gateR + 3.4;
            this._stall(put, A.stalls.rival, x, 1, true);
            signsWanted.push({ type: "rival", x, open: true });
            lights.push({ x, y: 1.3, z: 2.2, r: 5.5, c: [0.9, 0.12, 0.1] });
        }

        // eating area: low tables with stools (the simulation decides where they are, and who sits on which)
        for (const t of tables(s)) put(P.geometry("table"), t.x, t.y);
        for (let k = 0, n = seatCount(s); k < n; k++) { seatSpot(k, SEAT); put(P.geometry("stool"), SEAT.x, SEAT.y, 0, k); }
        // planters and barrels for company; lamps along the kerb
        for (const gx of [gateL, gateR]) {
            const out = gx === gateL ? -1 : 1;
            put(P.geometry("planter"), gx + out * 0.2, -9.3);
            put(P.geometry("planter"), gx + out * 0.2, 2.7, 0, 1.3);
            put(P.geometry("barrel"), gx - out * 1.1, 1.25, 0, 0.4);
            put(P.geometry("crate"), gx - out * 1.75, 1.35, 0, 0.3);
            put(P.geometry("crate"), gx - out * 1.7, 1.3, 0.5, 1.1, 0.8);
            put(P.geometry(gx === gateL ? "display_fruit" : "display_bread"), gx + out * 1.5, -7.6, 0, gx === gateL ? 0.5 : -0.5);
        }
        const room = Math.max(1, 16 - lights.length - 1), lamps = Math.min(room, Math.max(2, Math.round(span / 7.5)));
        for (let i = 0; i < lamps; i++) {
            const x = gateL + (span * (i + 0.5)) / lamps;
            put(P.geometry("bollard"), x, -8.3);
            if (i % 2 === 0) put(P.geometry("planter"), x + 1.6, -8.25, 0, i, 0.8);
            lights.push({ x, y: -6.9, z: 3.0, r: 9, c: [0.82, 0.6, 0.36] });
        }

        // a string of lanterns from gate to gate, sagging between the stalls
        const count = Math.round(span / 0.75);
        for (let k = 1; k < count; k++) {
            const u = k / count, sag = Math.abs(Math.sin(u * Math.PI * Math.max(1, Math.round(span / 6))));
            put(P.geometry("lantern"), gateL + u * span, 1.7, 5.05 - sag * 0.45, 0, 0.85, k % 2 ? [1.9, 1.35, 0.35] : [1.9, 0.4, 0.25]);
        }

        // festival night: two lines of bunting and coloured lanterns over the walkway
        if (s.weather === "festival") {
            for (const [y, z] of [[-7.1, 4.25], [-0.6, 4.3]]) {
                const n = Math.round(span / 0.55);
                for (let k = 1; k < n; k++) {
                    const u = k / n, sag = Math.sin(u * Math.PI * Math.max(1, Math.round(span / 7))) ** 2, c = FESTIVE[k % FESTIVE.length];
                    if (k % 3 === 0) put(P.geometry("lantern"), gateL + u * span, y, z - sag * 0.5, 0, 1.25, c);
                    else put(P.geometry("festoon"), gateL + u * span, y, z + 0.1 - sag * 0.5, 0, 1, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5]);
                }
            }
        }

        // the city behind: blocks with lit windows and a few neon signs
        let cursor = gateL - 24, i = 0;
        while (cursor < gateR + 24) {
            const w = 4.5 + noise(i) * 4, h = 7 + noise(i + 50) * 10, tone = 0.2 + noise(i + 90) * 0.1, cx = cursor + w / 2;
            block(cx, 10.5, h / 2, w - 0.3, 8, h, [tone, tone * 0.95, tone * 1.25]);
            const cols = Math.floor((w - 1) / 1.15), rows = Math.floor((h - 2.4) / 1.55);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const n = noise(i * 131 + r * 17 + c * 7.3), wx = cx - ((cols - 1) * 1.15) / 2 + c * 1.15, wz = 2.6 + r * 1.55;
                if (n > 0.42) { block(wx, 6.47, wz, 0.55, 0.06, 0.8, [0.1, 0.12, 0.2]); continue; }      // a dark window
                const tint = n < 0.14 ? [0.55, 0.85, 1.25] : n < 0.2 ? [1.25, 0.5, 0.95] : [1.3, 0.95, 0.5], k = 0.6 + noise(i + r * 3 + c) * 0.5;
                block(wx, 6.47, wz, 0.55, 0.06, 0.8, [tint[0] * k, tint[1] * k, tint[2] * k, 2]);
            }
            if (noise(i + 7) > 0.55) {
                const col = noise(i + 3) > 0.5 ? [2.4, 0.4, 1.3, 2] : [0.4, 1.9, 2.4, 2];
                block(cx - w / 2 + 0.7, 6.3, h * 0.55, 0.3, 0.12, Math.min(4, h * 0.4), col);
            }
            cursor += w; i++;
        }

        // one mesh for all of it
        const gl = this.game.renderer.gl, old = this.street.mesh;
        this.street.mesh = new Mesh(Geometry.merge(parts, { name: "street", uvs: false }), this.streetMaterial);
        if (old) { old.dispose(gl); old.geometry.dispose(gl); }

        // sign faces: a textured, self-lit quad on each stall's sign board
        while (this.signs.children.length) this.signs.remove(this.signs.children[0]);
        for (const sg of signsWanted) {
            const key = sg.type + (sg.open ? "" : "-off");
            let mat = this.signMaterials.get(key);
            if (!mat) {
                const k = sg.open ? 1.75 : 0.22;
                mat = new StandardMaterial({ map: signTexture(sg.type), lit: false, color: [k, k, k], castShadow: false });
                this.signMaterials.set(key, mat);
            }
            const e = this.signs.add(new Entity({ name: "sign", mesh: new Mesh(this.signPlane, mat) }));
            e.interpolate = false;
            e.setRotationEuler(Math.PI / 2, 0, 0);
            e.setPosition(sg.x, 2.622, 3.8);
        }

        // lights, and the area the sun's shadow map covers
        const scene = this.game.scene;
        this.lamps = lights.slice(0, 16).map((l) => ({ ...l, light: { position: [l.x, l.y, l.z], color: [0, 0, 0], radius: l.r } }));
        scene.pointLights = this.lamps.map((l) => l.light);
        scene.shadow.center.set([(gateL + gateR) / 2, -1.5, 0]);
        scene.shadow.extent.set([span / 2 + 8, 13]);
        this.rain.mesh.material.values.u_area.set([ends.left - 8, ends.right + 8, -13, 7]);
        this._writeLights(0);
        if (this.slotMode) this.showSlots(this.slotMode.kind, s, this.slotMode.except);
    }

    /** One stall: its body plus the parts its tier (1..3) adds. A stall nobody is working has its lights off. */
    _stall(put, asset, x, level, open) {
        // a tint alpha of 0.5 takes self-lit vertices (alpha 2) back down to ordinary ones (alpha 1)
        const tint = open ? undefined : [0.8, 0.8, 0.85, 0.5];
        put(asset.geometry("body"), x, 0, 0, 0, 1, tint);
        if (level >= 2) put(asset.geometry("level2"), x, 0, 0, 0, 1, tint);
        if (level >= 3) put(asset.geometry("level3"), x, 0, 0, 0, 1, tint);
    }

    _writeLights(time) {
        const k0 = lerp(LIGHT.lamps[0], LIGHT.lamps[1], this.dusk);
        this.lamps.forEach((l, i) => {
            // stall lights breathe a little; a stall in the middle of an argument flickers
            let k = k0;
            if (l.stall != null) {
                const stall = this.state && this.state.stalls.find((t) => t.id === l.stall);
                k *= 0.94 + 0.06 * Math.sin(time * 2.3 + i * 1.7);
                if (stall && stall.pauseT > 0 && !this.reducedMotion) k *= 0.55 + 0.45 * Math.sin(time * 31);
            }
            l.light.color[0] = l.c[0] * k; l.light.color[1] = l.c[1] * k; l.light.color[2] = l.c[2] * k;
        });
    }

    // ------------------------------------------------------------------ markers
    /** Highlight slots: kind "free" (empty ones, for placing) or "all" (for moving), or null to hide. */
    showSlots(kind, s, except = -1) {
        this.slotMode = kind ? { kind, except } : null;
        this.slotTiles.forEach((e, i) => {
            const taken = s && !!stallAt(s, i);
            e.visible = !!kind && s && i < s.slots && i !== except && (kind === "all" || !taken);
            e.mesh.material.color.set(taken ? [1.2, 0.8, 0.25] : [0.3, 1.2, 0.7]);
        });
    }

    /** Ring the thing with this anchor key ("c12", "v3", "s7"), or null to clear. */
    select(key) { this.selected = key; if (!key) this.ring.visible = false; }

    // ------------------------------------------------------------------ reactions to simulation events
    /** Call with state.events after each simulation step. */
    consume(s, events) {
        const few = this.reducedMotion ? 0.3 : 1;
        for (const e of events) {
            if (e.type === "served") {
                const a = this.anchors.get("s" + e.stallId);
                if (a) this.sparks.emit(Math.round((6 + e.price * 0.8 + e.tip * 2) * few), { position: [a[0], 1.6, 1.35], spread: 0.15, velocity: [0, -0.6, 3.6], speed: 1.5, life: [0.45, 0.85], size: [0.2, 0.05], color: [2.6, 1.9, 0.5, 1], colorEnd: [2.2, 1.0, 0.1, 0] });
                // the customer and the vendor both give a little hop as the plate changes hands
                const who = this.cast.get("c" + e.id), by = this.cast.get("v" + e.vendorId);
                if (who) who.hop = 0.32;
                if (by) by.hop = 0.22;
                if (e.mistake && a) this.steam.emit(Math.round(14 * few), { position: [a[0], 2.25, 1.3], spread: 0.3, velocity: [0, 0, 1.2], speed: 0.6, life: [0.7, 1.3], size: [0.5, 1.2], color: [0.15, 0.13, 0.13, 0.6], colorEnd: [0.1, 0.1, 0.1, 0] });
            } else if (e.type === "review") {
                const m = this.cast.get("c" + e.id);
                if (m && e.stars >= 4) {
                    m.cheer = 1.4;
                    const a = this.anchors.get("c" + e.id);
                    if (a) this.sparks.emit(Math.round(8 * few), { position: [a[0], a[1], a[2] + 0.2], spread: 0.2, velocity: [0, 0, 2.6], speed: 1.2, life: [0.5, 0.9], size: [0.22, 0.04], color: [2.6, 0.7, 1.3, 1] });
                }
            } else if (e.type === "angry") {
                const a = this.anchors.get("c" + e.id);
                if (a) this.sparks.emit(Math.round(12 * few), { position: [a[0], a[1], a[2] + 0.1], spread: 0.15, velocity: [0, 0, 2.2], speed: 1.6, life: [0.35, 0.7], size: [0.24, 0.04], color: [3.0, 0.3, 0.2, 1] });
            } else if (e.type === "scene") {
                const a = this.anchors.get("s" + e.a), b = this.anchors.get("s" + e.b);
                if (a && b) this.sparks.emit(Math.round(50 * few), { position: [(a[0] + b[0]) / 2, 2.6, 2.0], spread: 0.5, velocity: [0, 0, 2.5], speed: 3.2, life: [0.4, 1.0], size: [0.26, 0.04], color: [3.2, 0.5, 0.15, 1] });
                if (!this.reducedMotion) this.game.juice.shake(0.12);
            } else if (e.type === "gone") this._remove("c" + e.id);
        }
    }

    _remove(key) {
        const m = this.cast.get(key);
        if (m) { this.people.remove(m.character.root); this.cast.delete(key); }
        if (key[0] === "c") this.anchors.delete(key);
    }

    /** Forget everyone (new night, loaded save, different state). */
    reset() {
        for (const key of [...this.cast.keys()]) this._remove(key);
        for (const k of [...this.anchors.keys()]) if (k[0] !== "s") this.anchors.delete(k);
        if (this.dog) { this.people.remove(this.dog.root); this.dog = null; }
        this.steam.clear(); this.sparks.clear();
    }

    /**
     * The character for a key, created the first time they are seen. `kind` says what they are dressed as
     * (a stall type for a vendor); if that changes, they are rebuilt.
     */
    _person(key, kind, look, options, yaw) {
        let m = this.cast.get(key);
        if (m && m.kind !== kind) { this._remove(key); m = null; }
        if (!m) {
            const character = new Character(this.assets, look, options);
            this.people.add(character.root);
            m = { character, kind, yaw, cheer: 0, seed: Math.random() * 10, turn: 0, stamp: 0, age: 0, h: look.h || 1 };
            // people are not all in the same mood: most start neutral, some arrive smiling
            if (m.seed > 7) character.face.mouth = 0.9;
            this.cast.set(key, m);
            character.animator.time = Math.random() * 2;      // so a queue doesn't breathe in unison
        }
        // newcomers pop in instead of appearing
        if (m.age < 0.35) { m.age += this._dt; m.character.root.setScale(m.h * (this.reducedMotion ? 1 : easeOutBack(Math.min(1, m.age / 0.35)))); }
        return m;
    }

    /** A burst of sparkles where something good just happened (a stall bought, an upgrade). */
    celebrate(x, y, color = [2.6, 2.0, 0.7, 1]) {
        const n = this.reducedMotion ? 12 : 60;
        this.sparks.emit(n, { position: [x, y, 1.6], spread: 1.2, velocity: [0, 0, 5.5], speed: 4, life: [0.5, 1.2], size: [0.3, 0.05], color });
        if (!this.reducedMotion) this.game.juice.shake(0.1);
    }

    // ------------------------------------------------------------------ per rendered frame
    /**
     * Pose everyone. `time`: seconds, for idle motion. `dt`: frame time. `running`: the simulation is
     * advancing (when it is paused, customers hold their pose).
     */
    frame(s, time, dt, running) {
        this.state = s;
        this._dt = dt;
        const live = s.phase === "night", A = this.anchors, step = running ? dt : 0, stamp = ++this._stamp;

        // dusk follows the market clock: sunset while you prepare, night by closing time
        const target = live ? Math.min(1, 0.15 + ((s.t * NIGHT.dt) / NIGHT.seconds) * 0.95) : s.phase === "prep" ? 0 : 1;
        if (Math.abs(target - this.dusk) > 0.0005) this.setDusk(this.dusk + (target - this.dusk) * Math.min(1, dt * 1.5));

        for (const mesh of Object.values(this.food)) mesh.count = 0;

        // ---- weather
        const raining = s.weather === "rain", scene = this.game.scene;
        this.wet += ((raining ? 1 : 0) - this.wet) * Math.min(1, dt * 0.8);
        this.rain.visible = this.wet > 0.02;
        this.rain.mesh.material.values.u_rain = this.wet * (this.reducedMotion ? 0.5 : 1);
        this.groundMaterial.values.u_wet = this.wet;
        scene.fogDensity = lerp(LIGHT.fogDensity[0], LIGHT.fogDensity[1], this.dusk) * (1 + this.wet * 1.3);
        if (s.weather === "festival" && live && running && !this.reducedMotion && (this.fireworkClock -= dt) < 0) {
            // a rocket bursts above the stalls
            this.fireworkClock = 1.2 + Math.random() * 2.6;
            const c = FESTIVE[Math.floor(Math.random() * FESTIVE.length)], ends = streetEnds(s);
            this.sparks.emit(90, { position: [lerp(ends.left, ends.right, Math.random()), 6, 6.5 + Math.random() * 3], spread: 0.2, speed: 5.5, life: [0.7, 1.5], size: [0.42, 0.05],
                color: [c[0] * 1.5, c[1] * 1.5, c[2] * 1.5, 1], colorEnd: [c[0], c[1], c[2], 0] });
        }

        // ---- vendors behind their counters
        for (const stall of s.stalls) {
            const v = stall.vendorId != null ? vendorById(s, stall.vendorId) : null;
            if (!v || !v.hired || v.off) continue;
            const x = slotX(stall.slot), key = "v" + v.id;
            const m = this._person(key, stall.type, v.look, { prop: "apron", accent: STALLS[stall.type].color }, Math.PI);
            m.stamp = stamp;
            let clip = "counter", yaw = Math.PI, turn = 0, tempo = 1;
            const near = neighbours(s, stall);
            if (live && stall.pauseT > 0) {
                // mid-argument: turn on the rival next door
                const foe = near.find((n) => relation(s, v.id, n.vendor.id) === "rival");
                clip = "argue";
                if (foe) yaw = Math.atan2(-(slotX(foe.stall.slot) - x), -0.6);
            } else if (live && stall.serving != null) {
                // you can see who is quick and who is careful from their hands
                clip = "serve"; tempo = has(v, "fast") ? 1.5 : has(v, "perfectionist") ? 0.65 : 1;
            } else if (live && v.energy < 30) clip = "tired";
            else {
                // between customers the people next door get a wave or a glare
                const cycle = (time * 0.35 + m.seed) % 4;
                for (const n of near) {
                    const r = relation(s, v.id, n.vendor.id, true), side = Math.sign(slotX(n.stall.slot) - x);
                    if (r === "friend" && cycle < 0.7) { clip = "wave"; turn = side * 0.9; }
                    else if (r === "rival" && cycle > 2 && cycle < 3.2) turn = side * 1.1;
                }
                // a showman works the crowd whenever their hands are free
                if (clip === "counter" && has(v, "showman") && cycle > 1.2 && cycle < 2.1) clip = "show";
            }
            m.yaw += shortAngle(yaw - m.yaw) * Math.min(1, dt * 9);
            m.turn += (turn - m.turn) * Math.min(1, dt * 6);
            const ch = m.character;
            ch.root.setPosition(x, STREET.vendorY, this._hop(m, step, 0.1)); ch.root.setYaw(m.yaw);
            ch.setFace(clip === "argue" ? "angry" : clip === "tired" ? "tired" : v.mood < 35 ? "annoyed" : clip === "wave" || clip === "show" || v.mood > 78 ? "happy" : "neutral");
            ch.play(clip, { speed: tempo });
            ch.update(dt, m.turn);
            setAnchor(A, key, x, STREET.vendorY, 2.05 * v.look.h);
        }
        // hired but without a stall: waiting by the left gate
        let idle = 0;
        for (const v of hiredVendors(s)) {
            if (v.stallId != null && !v.off) continue;
            const x = -1.75 - (idle >> 1) * 0.8, y = 0.9 - (idle % 2) * 0.9, key = "v" + v.id;
            idle++;
            const m = this._person(key, "idle", v.look, { prop: "apron" }, -1.2);
            m.stamp = stamp;
            m.character.root.setPosition(x, y, 0); m.character.root.setYaw(-1.2);
            m.character.setFace(v.off ? "tired" : v.mood < 35 ? "annoyed" : "neutral");
            m.character.play(v.off ? "tired" : "wait");
            m.character.update(dt);
            setAnchor(A, key, x, y, 1.9 * v.look.h);
        }

        // ---- managers stand by the right-hand gate with their notebooks
        let post = 0;
        MANAGER_IDS.forEach((id, i) => {
            if (!s.managers || !s.managers[id]) return;
            const x = slotX(s.slots - 1) + 1.75 + (post >> 1) * 0.8, y = 0.9 - (post % 2) * 0.9, key = "m" + i;
            post++;
            const m = this._person(key, "manager", MANAGERS[id].look, { prop: "notebook", accent: [0.95, 0.8, 0.3] }, 1.2);
            m.stamp = stamp;
            m.character.root.setPosition(x, y, 0); m.character.root.setYaw(1.2);
            m.character.play("watch");
            m.character.update(dt);
            setAnchor(A, key, x, y, 1.9 * MANAGERS[id].look.h);
        });

        // ---- customers
        let kid = null;
        for (const c of s.customers) {
            const key = "c" + c.id, facing = Math.atan2(-c.fx, c.fy);
            const m = this._person(key, c.kind, c.look, { prop: PROPS[c.kind], accent: ACCENTS[c.kind] }, facing);
            m.stamp = stamp;
            const walking = c.state === "walk" || (c.state === "queue" && !c.atSpot);
            m.yaw += shortAngle(facing - m.yaw) * Math.min(1, dt * 10);
            if (m.cheer > 0 && running) m.cheer -= dt;
            const patience = c.patience / c.patienceMax;
            const seated = c.state === "eat" && c.seat >= 0;
            let clip = "idle", speed = 1;
            if (m.cheer > 0 && !seated) clip = "cheer";
            else if (walking) { clip = c.angry ? "storm" : "walk"; speed = c.speed / 2.15; }
            else if (c.state === "queue") clip = patience < 0.35 ? "fidget" : "wait";
            else if (c.state === "served") clip = "reach";
            else if (c.state === "eat") clip = (seated ? "sit_" : "") + (c.holding === "tea" ? "drink" : "eat");
            else if (c.state === "linger") clip = c.kind === "rival" || c.kind === "inspector" ? "watch" : "wait";
            const ch = m.character;
            ch.root.setPosition(c.x, c.y, this._hop(m, step, 0.2)); ch.root.setYaw(m.yaw);
            ch.setFace(c.angry ? "angry" : m.cheer > 0 || c.happy || c.state === "eat" ? "happy" : c.state === "queue" && patience < 0.35 ? "annoyed" : c.state === "queue" && patience < 0.6 ? "neutral" : m.seed > 7 ? "happy" : "neutral");
            ch.play(clip, { speed });
            ch.update(step);
            setAnchor(A, key, c.x, c.y, (seated ? 1.75 : 2.05) * c.look.h);
            if (c.holding && this.food[c.holding]) this._hold(this.food[c.holding], ch, c.x, c.y, m.yaw, c.look.h);
            if (c.kind === "kid") kid = { c, m, walking };
        }
        // anyone not seen this frame has left (or was let go)
        for (const [key, m] of this.cast) if (m.stamp !== stamp) { this._remove(key); if (key[0] !== "c") this.anchors.delete(key); }
        for (const mesh of Object.values(this.food)) if (mesh.count) { mesh.markDirty(0); mesh.markDirty(mesh.count - 1); }

        // ---- Biscuit trails a step behind Pip and sits when they stop
        if (kid) {
            if (!this.dog) { this.dog = makeDog(this.assets); this.people.add(this.dog.root); this.dog.x = kid.c.x; this.dog.y = kid.c.y; }
            const d = this.dog, tx = kid.c.x - kid.c.fx * 0.8 + 0.35, ty = kid.c.y - kid.c.fy * 0.8 - 0.2;
            d.x += (tx - d.x) * Math.min(1, dt * 6); d.y += (ty - d.y) * Math.min(1, dt * 6);
            d.root.setPosition(d.x, d.y, 0); d.root.setYaw(kid.m.yaw);
            d.animator.play(kid.walking ? "walk" : "sit");
            d.animator.update(running ? dt : dt * 0.3);
        } else if (this.dog) { this.people.remove(this.dog.root); this.dog = null; }

        // ---- steam over every working stall, more of it while serving
        this.steamClock += dt;
        if (this.steamClock > 0.09 && running) {
            this.steamClock = 0;
            for (const stall of s.stalls) {
                if (!worker(s, stall) || STALLS[stall.type].drink) continue;
                const busy = live && stall.serving != null;
                if (Math.random() > (busy ? 0.9 : 0.25) * (this.reducedMotion ? 0.3 : 1)) continue;
                const x = slotX(stall.slot) + (stall.type === "noodles" ? -0.7 : (Math.random() - 0.5) * 1.2);
                this.steam.emit(1, { position: [x, 2.25, 1.45], spread: 0.12, velocity: [0, 0, 0.5], speed: 0.25, life: [0.9, 1.7], size: [0.22, 0.9], color: [0.9, 0.9, 0.92, busy ? 0.3 : 0.18], colorEnd: [0.8, 0.8, 0.85, 0] });
            }
        }

        this._writeLights(time);

        // ---- markers
        if (this.slotMode) for (const e of this.slotTiles) e.mesh.material.opacity = 0.28 + 0.14 * Math.sin(time * 4);
        const a = this.selected && A.get(this.selected);
        this.ring.visible = !!a;
        if (a) {
            const isStall = this.selected[0] === "s";
            this.ring.setPosition(a[0], isStall ? STREET.stallY + 0.05 : a[1], 0.1);
            this.ring.setScale(isStall ? 1.75 : 0.5, isStall ? 1.6 : 0.5, 1);
            this.ring.setYaw(isStall ? 0 : time * 1.5);
        }
    }

    /** Height of a character's hop this frame (0 when not hopping). `m.hop` counts down the seconds left. */
    _hop(m, dt, height) {
        if (!(m.hop > 0) || this.reducedMotion) { m.hop = 0; return 0; }
        m.hop -= dt;
        return Math.sin(Math.max(0, m.hop) / 0.32 * Math.PI) * height;
    }

    /** Put one instance of a food model in a character's right hand. */
    _hold(mesh, character, x, y, yaw, h) {
        if (mesh.count >= mesh.capacity) return;
        quat.setAxisAngle(Q, [0, 0, 1], yaw);
        quat.multiply(Q, Q, this.assets.upright);
        T3[0] = x; T3[1] = y; T3[2] = 0; S3[0] = S3[1] = S3[2] = h;
        mat4.fromRotationTranslationScale(M, Q, T3, S3);
        mat4.multiply(M, M, character.animator.jointMatrix(character.handR));
        // a little below the wrist and forward, in the model's own (Y-up) space
        T3[0] = 0; T3[1] = -0.1; T3[2] = 0.07;
        mat4.translate(M, M, T3);
        mesh.setMatrix(mesh.count++, M);
    }

    // ------------------------------------------------------------------ picking
    /**
     * What is under this screen point? Characters win over stalls, stalls over empty plots.
     * @returns {{ type: "customer" | "vendor" | "manager" | "stall" | "slot", id: number } | null}
     */
    pick(px, py, width, height) {
        const cam = this.game.camera, out = { x: 0, y: 0, depth: 0, visible: false };
        let best = null, bestD = 34;
        for (const [key, a] of this.anchors) {
            if (key[0] === "s") continue;
            cam.project([a[0], a[1], a[2] * 0.55], width, height, out);
            if (!out.visible) continue;
            // a body is taller than it is wide on screen
            const d = Math.hypot(out.x - px, (out.y - py) * 0.6);
            if (d < bestD) { bestD = d; best = { type: key[0] === "c" ? "customer" : key[0] === "m" ? "manager" : "vendor", id: Number(key.slice(1)) }; }
        }
        if (best) return best;
        const g = this.groundPoint(px, py, width, height), s = this.state;
        if (!g || !s) return null;
        const slot = Math.round(g.x / STREET.slotW);
        // the stall's footprint, plus a generous band above it on screen where the roof and sign are
        if (slot < 0 || slot >= s.slots || Math.abs(g.x - slotX(slot)) > 1.45 || g.y < 1.6 || g.y > 9) return null;
        const stall = stallAt(s, slot);
        if (stall) return { type: "stall", id: stall.id };
        return g.y < 4.6 ? { type: "slot", id: slot } : null;
    }

    /** Where a screen point meets the ground plane (z = 0). */
    groundPoint(px, py, width, height) {
        const ray = this.game.camera.screenRay(px, py, width, height);
        if (ray.direction[2] >= -1e-4) return null;
        const t = -ray.origin[2] / ray.direction[2];
        return { x: ray.origin[0] + ray.direction[0] * t, y: ray.origin[1] + ray.direction[1] * t };
    }
}

function setAnchor(map, key, x, y, z) {
    const a = map.get(key);
    if (a) { a[0] = x; a[1] = y; a[2] = z; } else map.set(key, [x, y, z]);
}
function shortAngle(d) { return ((d + Math.PI * 3) % TAU + TAU) % TAU - Math.PI; }
function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
