import { Entity, Mesh, InstancedMesh, Geometry, StandardMaterial, BasicMaterial, ParticleSystem, ShadowMap, primitives, mat4, quat } from "../engine/index.js";
import { surfaceMaterial, wedge } from "./gfx.js";
import { propGeometry, scannerGeometry, MUZZLE } from "./models.js";
import { FLAG } from "./protocol.js";
import { PROP_LIST, PROP_SHAPE } from "./props.js";
import { colorOf } from "./data.js";

/**
 * DECOY: the 3D scene. Presentation only: it reads the map and what the client knows of the match and
 * draws them. Nothing here changes the match.
 *
 * Draw calls are kept few: the map's boxes are one merged mesh; the map's props are one instanced mesh
 * per prop type (300 props are about 30 draw calls); each player, decoy and effect is one more.
 * Lights: the engine has 16 point lights; a map uses at most 12, the rest are a pool for flashes.
 * @module game/world
 */

/** base colour of each material tag in the map files; a fourth number above 1 glows */
export const MATERIALS = {
    floor: [0.42, 0.42, 0.45],
    wall: [0.55, 0.53, 0.5],
    deck: [0.32, 0.4, 0.52],
    ramp: [0.58, 0.5, 0.26],
    ceiling: [0.18, 0.18, 0.2],
    shelf: [0.62, 0.5, 0.36],
    lamp: [1.0, 0.86, 0.6, 2],
};

/** A pool of fading line segments in one dynamic mesh: every beam in the scene is one draw call. */
class Beams {
    constructor(scene, capacity = 96) {
        this.capacity = capacity;
        this.life = new Float32Array(capacity);
        this.max = new Float32Array(capacity);
        this.rgb = new Float32Array(capacity * 3);
        this.next = 0;
        this.geometry = new Geometry({ name: "beams", mode: "lines", dynamic: true, positions: new Float32Array(capacity * 6), colors: new Float32Array(capacity * 8) });
        this.entity = scene.add(new Entity({ name: "beams", castShadow: false, frustumCulled: false,
            mesh: new Mesh(this.geometry, new BasicMaterial({ lit: false, vertexColors: true, transparent: true, blending: "additive", cull: "none", depthWrite: false })) }));
        this.entity.interpolate = false;
    }
    add(ax, ay, az, bx, by, bz, color, life = 0.12) {
        const i = this.next;
        this.next = (i + 1) % this.capacity;
        this.geometry.positions.set([ax, ay, az, bx, by, bz], i * 6);
        this.rgb.set(color, i * 3);
        this.life[i] = this.max[i] = life;
    }
    update(dt) {
        const col = this.geometry.colors;
        for (let i = 0; i < this.capacity; i++) {
            if (this.life[i] <= 0) { col[i * 8 + 3] = col[i * 8 + 7] = 0; continue; }
            this.life[i] -= dt;
            const k = Math.max(0, this.life[i] / this.max[i]), r = this.rgb[i * 3] * k, g = this.rgb[i * 3 + 1] * k, b = this.rgb[i * 3 + 2] * k;
            col.set([r * 0.4, g * 0.4, b * 0.4, k, r, g, b, k], i * 8);
        }
        this.geometry.markDirty();
    }
}

const scratch = { m: mat4.create(), q: quat.create() };

/**
 * One prop drawn somewhere: a hider, a decoy, the local player's own prop. Its mesh is swapped when the
 * prop type changes. An outline (the same shape, a little bigger, drawn inside out) shows it to whoever
 * should see it: a pinged hider to the seeker who threw, every hider to a ghost.
 */
class PropBody {
    constructor(scene, material, outlineMaterial) {
        this.root = scene.add(new Entity({ name: "prop-body" }));
        this.root.interpolate = false;
        this.type = -1;
        this.material = material;
        this.outlineMaterial = outlineMaterial;
        this.body = null;
        this.outline = null;
        this.glow = new Float32Array(3);
    }
    setType(type) {
        if (type === this.type) return;
        this.type = type;
        if (this.body) this.root.remove(this.body);
        if (this.outline) this.root.remove(this.outline);
        if (type < 0) { this.body = this.outline = null; return; }
        const geometry = propGeometry(type), mesh = new Mesh(geometry, this.material);
        mesh.uniforms = { u_emissive: this.glow };
        this.body = this.root.add(new Entity({ name: "prop", mesh }));
        this.body.interpolate = false;
        const s = PROP_SHAPE[type], grow = 1 + 0.08 / Math.max(0.15, Math.min(s[0], s[1], s[2] / 2));
        this.outline = this.root.add(new Entity({ name: "outline", mesh: new Mesh(geometry, this.outlineMaterial), castShadow: false, visible: false }));
        this.outline.interpolate = false;
        this.outline.setScale(grow, grow, 1 + 0.08 / s[2]);
        this.outline.setPosition(0, 0, -0.04);
    }
    place(x, y, z, yaw) { this.root.setPosition(x, y, z); this.root.setYaw(yaw); }
    set visible(v) { this.root.visible = v; }
    outlined(on) { if (this.outline) this.outline.visible = on; }
    remove(scene) { scene.remove(this.root); }
}

export class World {
    /** @param {import("../engine/Game.js").Game} game */
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.mapRoot = null;
        /** id → { kind: "seeker" | "hider", body, ... } */
        this.avatars = new Map();
        /** decoy id → PropBody */
        this.decoys = new Map();
        /** grenade id → entity */
        this.grenades = new Map();
        this.beams = new Beams(this.scene);
        const particles = (options) => { const p = this.scene.add(new ParticleSystem(options)); p.castShadow = false; p.frustumCulled = false; return p; };
        this.sparks = particles({ capacity: 1200, gravity: [0, 0, -9], drag: 1.5, name: "sparks" });
        this.puffs = particles({ capacity: 600, gravity: [0, 0, 0.6], drag: 2.2, blending: "normal", name: "puffs" });
        this.glows = particles({ capacity: 600, gravity: [0, 0, 0.4], drag: 2.5, name: "glows" });
        this._sample = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, prop: -1, propYaw: 0, speed: 0 };
        this.propMaterial = new StandardMaterial({ vertexColors: true, specular: 0.3, shininess: 24 });
        this.outlineMaterial = new BasicMaterial({ lit: false, color: [1.0, 0.85, 0.2], cull: "front" });
        this.seekerMaterial = new StandardMaterial({ color: [1, 1, 1], specular: 0.4 });
        this._capsule = primitives.capsule(0.32, 1.1, 6, 14);
        this.time = 0;
        this.flashes = [];
        /** the local player's own prop, seen from behind in third person */
        this.me = new PropBody(this.scene, this.propMaterial, this.outlineMaterial);
        this.me.visible = false;
        // the scanner in the hand
        this.view = { kick: 0, bob: 0 };
        this.viewModel = this.scene.add(new Entity({ name: "scanner", castShadow: false, frustumCulled: false, visible: false, mesh: new Mesh(scannerGeometry(), new StandardMaterial({ vertexColors: true, specular: 0.6, shininess: 40 })) }));
        this.viewModel.interpolate = false;
        this.muzzle = [0, 0, 0];
        /** a marker over the prop the local hider is looking at */
        this.aimed = new PropBody(this.scene, this.propMaterial, new BasicMaterial({ lit: false, color: [0.4, 1.0, 0.6], cull: "front" }));
        this.aimed.visible = false;
        this.onStep = null;
        /** ids outlined for the local player, and until when (seconds of this.time) */
        this.revealed = new Map();
        /** 0..1: how much the late round makes moving props flicker */
        this.flicker = 0;
        this.reducedMotion = false;
    }

    /** Outline colours, for the colour-blind-safe setting. */
    setOutlineColors(reveal, aim) { this.outlineMaterial.color.set(reveal); this.aimed.outlineMaterial.color.set(aim); }

    /** Build the scene for a compiled map. */
    loadMap(map) {
        if (this.mapRoot) this.scene.remove(this.mapRoot);
        for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
        for (const d of this.decoys.values()) d.remove(this.scene);
        this.decoys.clear();
        for (const g of this.grenades.values()) this.scene.remove(g);
        this.grenades.clear();
        const root = (this.mapRoot = this.scene.add(new Entity({ name: "map" })));
        this.map = map;
        const scene = this.scene, env = map.env;
        scene.pointLights.length = 0;
        this.flashes.length = 0;
        scene.clearColor.set([0.03, 0.03, 0.04, 1]);
        scene.sunDirection.set([0.3, -0.2, 0.93]);
        scene.sunColor.set(env.sun || [0.35, 0.34, 0.33]);
        scene.skyColor.set(env.sky || [0.36, 0.37, 0.42]);
        scene.groundColor.set(env.ground || [0.2, 0.18, 0.17]);
        scene.fogColor.set(env.fog || [0.06, 0.06, 0.07]); scene.fogDensity = env.fogDensity ?? 0.01;
        scene.shadow = null;

        const parts = [];
        for (const b of map.boxes) {
            const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1], h = b.max[2] - b.min[2];
            parts.push({ geometry: primitives.box(w, d, h), matrix: mat4.fromTranslation(mat4.create(), [b.min[0] + w / 2, b.min[1] + d / 2, b.min[2] + h / 2]), color: MATERIALS[b.mat] || MATERIALS.wall });
        }
        for (const r of map.ramps) parts.push({ geometry: wedge(r, MATERIALS[r.mat] || MATERIALS.ramp) });
        for (const light of map.lights) {
            parts.push({ geometry: primitives.box(0.5, 0.5, 0.1), matrix: mat4.fromTranslation(mat4.create(), light.pos), color: [...light.color.map((c) => Math.min(1, c)), 2] });
            scene.pointLights.push({ position: [light.pos[0], light.pos[1], light.pos[2] - 0.3], color: light.color, radius: light.radius });
        }
        const shell = new Entity({ name: "shell", mesh: new Mesh(Geometry.merge(parts, { uvs: false }), surfaceMaterial()) });
        shell.frustumCulled = false;
        root.add(shell);

        // the props: one instanced mesh per type
        const byType = new Map();
        map.props.forEach((q, i) => { if (!byType.has(q.type)) byType.set(q.type, []); byType.get(q.type).push(i); });
        this.propInstances = [];
        for (const [type, list] of byType) {
            const inst = new InstancedMesh(propGeometry(type), this.propMaterial, list.length);
            list.forEach((i, k) => { const q = map.props[i]; inst.setTransform(k, q.x, q.y, q.z, 1, 1, 1, (q.yaw * Math.PI * 2) / 65536); });
            root.add(new Entity({ name: "props-" + PROP_LIST[type].id, mesh: inst, frustumCulled: false }));
            this.propInstances.push(inst);
        }
        return root;
    }

    // ------------------------------------------------------------------ players

    removeAvatar(id) {
        const a = this.avatars.get(id);
        if (!a) return;
        if (a.body) a.body.remove(this.scene);
        if (a.capsule) this.scene.remove(a.capsule);
        this.avatars.delete(id);
    }

    /**
     * Put every other player where the client says they are right now.
     * @param {import("./net.js").Client} client
     * @param {boolean} seeAll a ghost sees every hider outlined
     */
    syncPlayers(client, dt, seeAll) {
        const s = this._sample, late = client.match.late;
        for (const info of client.players.values()) {
            if (info.id === client.id) continue;
            let a = this.avatars.get(info.id);
            if (!a) { a = { body: null, capsule: null, color: null, x: 0, y: 0, stride: 0 }; this.avatars.set(info.id, a); }
            const has = client.sample(info.id, s), alive = has && (s.flags & FLAG.alive) !== 0, seeker = (s.flags & FLAG.seeker) !== 0;
            if (seeker || !alive) { if (a.body) a.body.visible = false; }
            if (!seeker || !alive) { if (a.capsule) a.capsule.visible = false; }
            if (!alive) continue;
            if (seeker) {
                if (!a.capsule) {
                    const mesh = new Mesh(this._capsule, this.seekerMaterial);
                    a.color = new Float32Array([1, 1, 1, 1]);
                    mesh.uniforms = { u_color: a.color };
                    a.capsule = this.scene.add(new Entity({ name: "seeker", mesh }));
                    a.capsule.interpolate = false;
                }
                a.color.set(colorOf(info));
                a.capsule.visible = true;
                a.capsule.setPosition(s.x, s.y, s.z + 0.88 - (s.flags & FLAG.crouched ? 0.3 : 0));
                a.capsule.setYaw(s.yaw);
            } else {
                if (!a.body) a.body = new PropBody(this.scene, this.propMaterial, this.outlineMaterial);
                a.body.setType(s.prop);
                const moving = Math.hypot(s.x - a.x, s.y - a.y) > 0.002;
                // the last minute: a moving prop flickers faintly
                a.body.visible = !(late && moving && this.flicker > 0 && Math.sin(this.time * 40 + info.id) > 0.6);
                a.body.place(s.x, s.y, s.z, s.propYaw);
                const shown = seeAll || (this.revealed.get(info.id) || 0) > this.time;
                a.body.outlined(shown);
            }
            if (a.x !== s.x || a.y !== s.y) {
                a.stride += Math.hypot(s.x - a.x, s.y - a.y);
                if (a.stride > (seeker ? 2.2 : 1.4) && (s.flags & FLAG.ground)) { a.stride = 0; if (this.onStep) this.onStep(s.x, s.y, s.z, seeker); }
            }
            a.x = s.x; a.y = s.y;
        }
        for (const id of [...this.avatars.keys()]) if (!client.players.has(id) || id === client.id) this.removeAvatar(id);
    }

    /** The local hider's own prop, drawn where the predicted player is. */
    syncMe(me, at, shown, late, moving) {
        this.me.visible = shown;
        if (!shown) return;
        this.me.setType(me.prop);
        this.me.place(at.x, at.y, at.z, (me.propYaw * Math.PI * 2) / 65536);
        // you can see your own flicker in the last minute, so you know you are giving yourself away
        if (late && moving && this.flicker > 0 && Math.sin(this.time * 40) > 0.6) this.me.visible = false;
    }

    /** Mark the prop the local hider would become (index into map.props), or none (−1). */
    aim(index) {
        if (index < 0 || !this.map) { this.aimed.visible = false; return; }
        const q = this.map.props[index];
        this.aimed.setType(q.type);
        this.aimed.place(q.x, q.y, q.z, (q.yaw * Math.PI * 2) / 65536);
        this.aimed.visible = true;
        // only the outline: the prop itself is already drawn by its instanced mesh
        this.aimed.body.visible = false;
        this.aimed.outlined(true);
    }

    /** Decoys and grenades come in every snapshot. */
    syncObjects(client) {
        const seen = new Set();
        for (const r of client.decoys) {
            seen.add(r[0]);
            let d = this.decoys.get(r[0]);
            if (!d) { d = new PropBody(this.scene, this.propMaterial, this.outlineMaterial); this.decoys.set(r[0], d); d.tx = r[3]; d.ty = r[4]; d.tz = r[5]; }
            d.setType(r[2]);
            // ease toward the newest position (decoys run, and snapshots come 20 times a second)
            d.tx += (r[3] - d.tx) * 0.3; d.ty += (r[4] - d.ty) * 0.3; d.tz += (r[5] - d.tz) * 0.3;
            d.place(d.tx, d.ty, d.tz, (r[6] * Math.PI * 2) / 65536);
        }
        for (const [id, d] of this.decoys) if (!seen.has(id)) { d.remove(this.scene); this.decoys.delete(id); }
        const live = new Set();
        for (const g of client.grenades) {
            live.add(g[0]);
            let e = this.grenades.get(g[0]);
            if (!e) {
                e = this.scene.add(new Entity({ name: "grenade", mesh: new Mesh(primitives.sphere(0.09, 10, 8), new StandardMaterial({ color: [0.3, 0.9, 1.0], emissive: [0.6, 2.2, 2.6] })), castShadow: false }));
                e.interpolate = false;
                this.grenades.set(g[0], e);
            }
            e.position[0] += (g[2] - e.position[0]) * 0.5; e.position[1] += (g[3] - e.position[1]) * 0.5; e.position[2] += (g[4] - e.position[2]) * 0.5;
            if (!e.placed) { e.setPosition(g[2], g[3], g[4]); e.placed = true; }
            if (g[5]) this.glows.emit(1, { position: [g[2], g[3], g[4] + 0.05], spread: 0.05, speed: 0.4, life: [0.2, 0.4], size: [0.25, 0], color: [0.5, 2.0, 2.4, 0.8] });
        }
        for (const [id, e] of this.grenades) if (!live.has(id)) { this.scene.remove(e); this.grenades.delete(id); }
    }

    // ------------------------------------------------------------------ the scanner in the hand

    syncView(camera, me, dt, shown) {
        const v = this.view, e = this.viewModel;
        e.visible = shown;
        if (!shown) return;
        v.kick *= Math.exp(-dt * 12);
        const speed = Math.hypot(me.vx, me.vy);
        if (me.ground) v.bob += dt * speed * 1.5;
        const amount = this.reducedMotion ? 0 : Math.min(1, speed / 8) * (me.ground ? 1 : 0.2), bx = Math.sin(v.bob) * 0.006 * amount, bz = Math.abs(Math.cos(v.bob)) * 0.005 * amount;
        const f = camera.forward, r = camera.right, u = camera.up, eye = camera.eye, S = 0.2;
        const ahead = 0.15 - v.kick * 0.03, side = 0.075 + bx, down = 0.075 + bz - v.kick * 0.006;
        for (let k = 0; k < 3; k++) e.position[k] = eye[k] + f[k] * ahead + r[k] * side - u[k] * down;
        e.setScale(S);
        const m = scratch.m;
        m[0] = f[0]; m[1] = f[1]; m[2] = f[2]; m[3] = 0;
        m[4] = -r[0]; m[5] = -r[1]; m[6] = -r[2]; m[7] = 0;
        m[8] = u[0]; m[9] = u[1]; m[10] = u[2]; m[11] = 0;
        m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
        mat4.getRotation(e.rotation, m);
        quat.setAxisAngle(scratch.q, [0, 1, 0], -v.kick * 0.15);
        quat.multiply(e.rotation, e.rotation, scratch.q);
        for (let k = 0; k < 3; k++) this.muzzle[k] = e.position[k] + (f[k] * MUZZLE[0] + u[k] * MUZZLE[2]) * S;
    }

    fireView() {
        if (!this.reducedMotion) this.view.kick = Math.min(1.2, this.view.kick + 0.4);
        this.flash(this.muzzle[0], this.muzzle[1], this.muzzle[2], [0.5, 1.6, 1.9], 5, 0.06);
    }

    // ------------------------------------------------------------------ effects

    /** A scanner beam: from where it left to where it ended, coloured by what it hit. */
    beam(from, to, what) {
        const color = what === 1 ? [2.6, 0.6, 0.4] : what === 2 || what === 3 ? [2.4, 1.6, 0.3] : [0.5, 1.8, 2.4];
        this.beams.add(from[0], from[1], from[2], to[0], to[1], to[2], color, 0.12);
        this.sparks.emit(what === 1 ? 10 : 5, { position: to, speed: 2.2, life: [0.12, 0.35], size: [0.1, 0], color: [color[0], color[1], color[2], 1], colorEnd: [0.2, 0.2, 0.2, 0] });
    }

    /** A puff of dust where a prop changes into another. */
    poof(x, y, z, size = 0.6) {
        this.puffs.emit(18, { position: [x, y, z + size * 0.5], spread: size * 0.5, speed: 1.6, life: [0.3, 0.7], size: [size * 0.8, size * 1.6], color: [0.85, 0.82, 0.78, 0.55], colorEnd: [0.7, 0.7, 0.7, 0] });
    }

    /** A ring of light where a ping grenade bursts. */
    burst(x, y, z, radius) {
        this.glows.emit(70, { position: [x, y, z + 0.1], spread: 0.1, speed: radius * 1.6, flat: true, life: [0.35, 0.6], size: [0.4, 0.1], color: [0.5, 2.0, 2.6, 1], colorEnd: [0.1, 0.4, 0.6, 0] });
        this.flash(x, y, z + 0.5, [0.6, 2.2, 2.8], radius * 1.5, 0.4);
    }

    /** Notes rising from a taunting prop. */
    taunt(x, y, z, color) {
        this.glows.emit(12, { position: [x, y, z + 0.3], spread: 0.2, speed: 1.4, life: [0.5, 1], size: [0.18, 0.05], color: [color[0] * 2, color[1] * 2, color[2] * 2, 1], colorEnd: [color[0], color[1], color[2], 0] });
    }

    /** A short-lived point light. At most four at a time. */
    flash(x, y, z, color, radius, life) {
        let f = this.flashes.find((e) => e.life <= 0);
        if (!f) {
            if (this.flashes.length >= 4) f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
            else { f = { light: { position: [0, 0, 0], color: [0, 0, 0], radius: 1, enabled: false }, base: [0, 0, 0], life: 0, max: 1 }; this.flashes.push(f); this.scene.pointLights.push(f.light); }
        }
        f.light.position[0] = x; f.light.position[1] = y; f.light.position[2] = z;
        f.base = color; f.light.radius = radius; f.life = f.max = life; f.light.enabled = true;
    }

    /** Per-frame upkeep. */
    update(client, dt, seeAll = false) {
        this.time += dt;
        this.syncPlayers(client, dt, seeAll);
        this.syncObjects(client);
        this.beams.update(dt);
        for (const f of this.flashes) {
            if (f.life <= 0) continue;
            f.life -= dt;
            const k = Math.max(0, f.life / f.max);
            f.light.color[0] = f.base[0] * k; f.light.color[1] = f.base[1] * k; f.light.color[2] = f.base[2] * k;
            if (f.life <= 0) f.light.enabled = false;
        }
    }
}
