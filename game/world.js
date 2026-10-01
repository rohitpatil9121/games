import { Entity, Mesh, Geometry, BasicMaterial, GlowMaterial, ShaderMaterial, ParticleSystem, Trail, primitives, quat } from "../engine/index.js";
import * as particleShader from "../shaders/particles/particles.js";
import { BODY, bodyPosition } from "./sim.js";
import { createFabricMaterial, wellDepth, FABRIC } from "./fabric.js";

/**
 * World: everything you see in a level. Pure presentation; game/sim.js owns the physics.
 *
 * Everything rides the spacetime fabric: an object's height is the fabric depth at its position
 * (fabric.wellDepth, the CPU twin of the fabric vertex shader), so planets sit in their own wells and the
 * comet visibly rolls through them.
 * @module game/world
 */

const PREVIEW_POINTS = 420;
const C = {
    comet: [2.6, 3.2, 4.0], cometGlow: [0.5, 0.9, 1.6], trail: [0.5, 1.1, 2.2],
    portalA: [1.0, 2.6, 3.2], portalB: [2.2, 2.4, 3.2], portalCore: [0.4, 1.2, 2.0],
    gold: [3.0, 2.1, 0.7], goldGlow: [1.4, 0.9, 0.3], launcher: [2.4, 1.8, 0.8],
    invalid: [1.6, 0.25, 0.3], previewOk: [0.75, 0.95, 1.4], previewWin: [0.5, 2.2, 1.2], previewBad: [2.4, 0.4, 0.45],
};

const yUp = quat.create();

export class World {
    /** @param {import("../engine/index.js").Game} game */
    constructor(game) {
        this.game = game;
        this.root = game.scene.add(new Entity({ name: "world" }));
        this.level = null;
        /** bodies for fabric / heights: [{ px, py, mass }] */
        this.fieldBodies = [];
        this.reducedMotion = false;

        this.geo = {
            sphere: primitives.sphere(1, 36, 22),
            gem: primitives.sphere(1, 6, 4),
            ring: primitives.torus(1, 0.06, 10, 72),
            disk: primitives.torus(1, 0.34, 8, 64),
            band: primitives.torus(1, 0.13, 8, 72),
            beam: primitives.cylinder(0.02, 0.26, 1, 14, false),
            cone: primitives.cone(0.3, 0.8, 18),
        };

        // spacetime fabric
        this.fabricMat = createFabricMaterial();
        this.fabric = this.root.add(new Entity({ name: "fabric", mesh: new Mesh(primitives.plane(40, 26, 170, 110), this.fabricMat) }));

        // trajectory preview (point sprites)
        this.previewGeo = new Geometry({ name: "preview", mode: "points", dynamic: true,
            positions: new Float32Array(PREVIEW_POINTS * 3), colors: new Float32Array(PREVIEW_POINTS * 4), uvs: new Float32Array(PREVIEW_POINTS * 2) });
        this.previewGeo.drawCount = 0;
        this.preview = this.root.add(new Entity({ name: "preview", mesh: new Mesh(this.previewGeo, new ShaderMaterial({
            name: "particles", vertex: particleShader.vertex, fragment: particleShader.fragment,
            transparent: true, blending: "additive", depthWrite: false, cull: "none" })) }));

        // comet
        this.comet = this.root.add(new Entity({ name: "comet" }));
        this.comet.add(new Entity({ mesh: new Mesh(this.geo.sphere, new BasicMaterial({ lit: false, color: C.comet })) })).setScale(0.22);
        this.comet.add(new Entity({ mesh: new Mesh(this.geo.sphere, new GlowMaterial({ color: C.cometGlow, intensity: 2.2, power: 2 })) })).setScale(0.7);
        this.comet.visible = false;
        this.trail = this.root.add(new Trail({ length: 260, color: C.trail }));
        this.sparks = this.root.add(new ParticleSystem({ capacity: 4000, drag: 0.8 }));

        for (const e of [this.fabric, this.preview, this.trail, this.sparks]) e.interpolate = false;
        this.levelRoot = this.root.add(new Entity({ name: "level" }));
        this.placedRoot = this.root.add(new Entity({ name: "placed" }));
        /** @type {Array<{ node: Entity, spec: any, parts: any }>} */
        this.fixedNodes = [];
        this.placedNodes = [];
        this.dustNodes = [];
        this.hintNodes = [];
        this.portal = null;
        this.launcher = null;
        this._tmp = { x: 0, y: 0 };
    }

    // ------------------------------------------------------------------ building

    /** These nodes are positioned every rendered frame, so fixed-step interpolation must be off for them. */
    _noLerp(node) { node.interpolate = false; for (const c of node.children) this._noLerp(c); return node; }

    _clear(parent) { while (parent.children.length) parent.remove(parent.children[0]); }

    /** Build one body (planet, moon, giant, pulsar, black hole). Returns { node, parts }. */
    makeBody(type, ghost = false) {
        const def = BODY[type], r = def.radius, col = def.color;
        const node = new Entity({ name: type });
        const parts = { type, spin: 0.4 + Math.random() * 0.5 };
        const op = ghost ? 0.35 : 1;
        if (type === "blackhole") {
            node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new BasicMaterial({ lit: false, color: [0, 0, 0] })) })).setScale(r);
            node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new GlowMaterial({ color: [1.6, 0.6, 0.2], intensity: 1.8, power: 3.4 })) })).setScale(r * 2.1);
            parts.disk = node.add(new Entity({ mesh: new Mesh(this.geo.disk, new BasicMaterial({ lit: false, color: [1.5, 0.55, 0.16], transparent: true, blending: "additive", depthWrite: false, opacity: 0.6, cull: "none" })) }));
            parts.disk.setScale(r * 2.3, r * 2.3, r * 0.22);
        } else if (type === "pulsar") {
            parts.core = node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new BasicMaterial({ lit: false, color: [3.0, 1.1, 2.4], opacity: op })) }));
            parts.core.setScale(r * 0.7);
            node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new GlowMaterial({ color: [1.6, 0.4, 1.2], intensity: 2.4 * op, power: 2.2 })) })).setScale(r * 2.2);
            parts.beams = node.add(new Entity({ name: "beams" }));
            for (const dir of [1, -1]) {
                const b = parts.beams.add(new Entity({ mesh: new Mesh(this.geo.beam, new BasicMaterial({ lit: false, color: [2.2, 0.6, 1.8], transparent: true, blending: "additive", depthWrite: false, opacity: 0.4 * op, cull: "none" })) }));
                // cylinders are built along Z; lay them along ±X
                quat.setAxisAngle(b.rotation, [0, 1, 0], dir * Math.PI / 2);
                b.setScale(1, 1, 3.4).setPosition(dir * 1.9, 0, 0);
            }
        } else {
            const mat = new BasicMaterial({ color: col, rim: col.map((v) => v * 0.45 + 0.08), rimPower: 3, opacity: op, transparent: ghost });
            parts.surface = mat;
            parts.baseColor = Float32Array.from(col);
            parts.globe = node.add(new Entity({ mesh: new Mesh(this.geo.sphere, mat) }));
            parts.globe.setScale(r);
            parts.halo = new GlowMaterial({ color: col.map((v) => v * 0.8), intensity: (type === "moon" ? 0.55 : 0.8) * op, power: 3 });
            parts.haloBase = Float32Array.from(parts.halo.color);
            node.add(new Entity({ mesh: new Mesh(this.geo.sphere, parts.halo) })).setScale(r * 1.55);
            if (type === "giant") {
                const ring = node.add(new Entity({ mesh: new Mesh(this.geo.band, new BasicMaterial({ lit: false, color: [0.95, 0.66, 0.38], transparent: true, blending: "additive", depthWrite: false, opacity: 0.55 * op, cull: "none" })) }));
                ring.setScale(r * 1.8, r * 1.8, r * 0.06).setRotationEuler(0.42, 0.2, 0);
            }
        }
        return { node, parts };
    }

    /** @param {object} level from game/levels.js */
    load(level) {
        this.level = level;
        this._clear(this.levelRoot);
        this._clear(this.placedRoot);
        this.fixedNodes = []; this.placedNodes = []; this.dustNodes = []; this.hintNodes = [];
        this.sparks.clear(); this.trail.clear();
        this.comet.visible = false;

        for (const spec of level.fixed) {
            const b = this.makeBody(spec.type);
            this.levelRoot.add(b.node);
            this.fixedNodes.push({ ...b, spec });
            if (spec.orbit) this.levelRoot.add(this._orbitRing(spec.orbit));
        }

        // portal: two counter-rotating rings + a glowing core
        const P = (this.portal = { node: this.levelRoot.add(new Entity({ name: "portal" })) });
        P.ringA = P.node.add(new Entity({ mesh: new Mesh(this.geo.ring, new BasicMaterial({ lit: false, color: C.portalA, cull: "none" })) }));
        P.ringB = P.node.add(new Entity({ mesh: new Mesh(this.geo.ring, new BasicMaterial({ lit: false, color: C.portalB, cull: "none" })) }));
        P.ringA.setScale(level.portal.r * 1.05); P.ringB.setScale(level.portal.r * 0.72);
        P.core = P.node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new GlowMaterial({ color: C.portalCore, intensity: 2.4, power: 1.6, inner: true })) }));
        P.core.setScale(level.portal.r * 0.62);

        // launcher: base ring + arrow pointing along the launch direction
        const L = (this.launcher = { node: this.levelRoot.add(new Entity({ name: "launcher" })) });
        L.node.add(new Entity({ mesh: new Mesh(this.geo.ring, new BasicMaterial({ lit: false, color: C.launcher, cull: "none" })) })).setScale(0.62);
        L.arrow = L.node.add(new Entity({ mesh: new Mesh(this.geo.cone, new BasicMaterial({ lit: false, color: C.launcher })) }));
        const a = level.launch.angle;
        quat.setAxisAngle(yUp, [0, 1, 0], Math.PI / 2);            // cone points +Z -> +X
        quat.setAxisAngle(L.arrow.rotation, [0, 0, 1], a);          // then yaw to the launch angle
        quat.multiply(L.arrow.rotation, L.arrow.rotation, yUp);
        L.arrow.setPosition(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0);

        for (const d of level.dust) {
            const node = this.levelRoot.add(new Entity({ name: "dust" }));
            node.add(new Entity({ mesh: new Mesh(this.geo.gem, new BasicMaterial({ lit: false, color: C.gold })) })).setScale(0.2);
            node.add(new Entity({ mesh: new Mesh(this.geo.sphere, new GlowMaterial({ color: C.goldGlow, intensity: 1.3, power: 2.6 })) })).setScale(0.5);
            this.dustNodes.push({ node, spec: d, taken: false });
        }
        this._noLerp(this.levelRoot);
        this.setPlaced([]);
        this.setPreview(null);
    }

    _orbitRing(o) {
        const n = 96, pos = new Float32Array((n + 1) * 3);
        for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pos[i * 3] = o.cx + Math.cos(a) * o.r; pos[i * 3 + 1] = o.cy + Math.sin(a) * o.r; pos[i * 3 + 2] = 0.06; }
        return new Entity({ name: "orbit", mesh: new Mesh(new Geometry({ positions: pos, mode: "lineStrip" }),
            new BasicMaterial({ lit: false, color: [0.5, 0.7, 1.6], transparent: true, blending: "additive", depthWrite: false, opacity: 0.45, cull: "none" })) });
    }

    /**
     * Sync the player's placed bodies.
     * @param {Array<{ type: string, x: number, y: number }>} placed
     * @param {number} [invalidIndex=-1] index currently in an invalid spot (tinted red)
     */
    setPlaced(placed, invalidIndex = -1) {
        while (this.placedNodes.length > placed.length) this.placedRoot.remove(this.placedNodes.pop().node);
        placed.forEach((spec, i) => {
            let n = this.placedNodes[i];
            if (!n || n.parts.type !== spec.type) {
                if (n) this.placedRoot.remove(n.node);
                n = { ...this.makeBody(spec.type), spec };
                this._noLerp(n.node);
                this.placedRoot.add(n.node);
                this.placedNodes[i] = n;
            }
            n.spec = spec;
            const bad = i === invalidIndex;
            if (n.parts.surface) {
                n.parts.surface.color.set(bad ? C.invalid : n.parts.baseColor);
                n.parts.halo.color.set(bad ? C.invalid : n.parts.haloBase);
            }
            if (n.parts.core) n.parts.core.mesh.material.color.set(bad ? C.invalid : [3.0, 1.1, 2.4]);
        });
    }

    /** Show translucent ghosts of a solution (the hint), or clear them with []. */
    setHint(solution) {
        for (const h of this.hintNodes) this.levelRoot.remove(h.node);
        this.hintNodes = solution.map((spec) => {
            const b = this.makeBody(spec.type, true);
            this.levelRoot.add(this._noLerp(b.node));
            return { ...b, spec };
        });
    }

    // ------------------------------------------------------------------ per frame

    /**
     * @param {number} t real seconds (animation clock)
     * @param {number} simT simulation time (0 while planning; orbiting bodies move with it)
     * @param {number} dt
     * @param {boolean} [emit=true] false while the simulation is paused (nothing would age the particles)
     */
    frame(t, simT, dt, emit = true) {
        const tmp = this._tmp;
        // 1. where is every massive body right now?
        const fb = this.fieldBodies;
        fb.length = 0;
        for (const n of this.fixedNodes) {
            bodyPosition(n.spec, simT, tmp);
            n.x = tmp.x; n.y = tmp.y;
            fb.push({ px: tmp.x, py: tmp.y, mass: BODY[n.spec.type].mass });
        }
        for (const n of this.placedNodes) { n.x = n.spec.x; n.y = n.spec.y; fb.push({ px: n.x, py: n.y, mass: BODY[n.spec.type].mass }); }

        // 2. fabric uniforms
        const u = this.fabricMat.values, arr = u.u_bodies, count = Math.min(fb.length, FABRIC.MAX_BODIES);
        for (let i = 0; i < count; i++) { arr[i * 4] = fb[i].px; arr[i * 4 + 1] = fb[i].py; arr[i * 4 + 2] = fb[i].mass; }
        u.u_bodyCount = count;

        // 3. bodies sit in their wells and spin
        const place = (n) => {
            const r = BODY[n.spec.type].radius;
            n.node.setPosition(n.x, n.y, this.heightAt(n.x, n.y) + r * 0.6);
            if (n.parts.globe) n.parts.globe.setYaw(t * n.parts.spin);
            if (n.parts.disk) n.parts.disk.setYaw(t * 1.6);
            if (n.parts.beams) n.parts.beams.setYaw(t * 2.4);
        };
        this.fixedNodes.forEach(place);
        this.placedNodes.forEach(place);
        for (const h of this.hintNodes) {
            h.x = h.spec.x; h.y = h.spec.y;
            h.node.setPosition(h.x, h.y, this.heightAt(h.x, h.y) + BODY[h.spec.type].radius * 0.6 + Math.sin(t * 3) * 0.08);
        }

        // black holes shed a slow swirl of hot matter
        if (emit && !this.reducedMotion) for (const n of this.fixedNodes) {
            if (n.spec.type !== "blackhole" || Math.random() > 0.5) continue;
            const a = Math.random() * Math.PI * 2, rr = 1.2 + Math.random() * 0.5;
            const px = n.x + Math.cos(a) * rr, py = n.y + Math.sin(a) * rr;
            this.sparks.emit(1, { position: [px, py, this.heightAt(px, py) + 0.35], velocity: [-Math.sin(a) * 2.2 - Math.cos(a) * 0.6, Math.cos(a) * 2.2 - Math.sin(a) * 0.6, 0],
                life: [0.5, 1.0], size: [0.16, 0], color: [2.4, 1.0, 0.3, 0.9], colorEnd: [1.2, 0.2, 0.05, 0] });
        }

        // 4. portal, launcher, dust
        const lv = this.level;
        if (this.portal) {
            const p = lv.portal, z = this.heightAt(p.x, p.y) + 1.0;
            this.portal.node.setPosition(p.x, p.y, z);
            this.portal.ringA.setRotationEuler(t * 0.9, t * 0.6, 0);
            this.portal.ringB.setRotationEuler(-t * 1.2, 0.6, t * 0.8);
            this.portal.core.setScale(p.r * (0.6 + Math.sin(t * 3) * 0.05));
            if (emit && !this.reducedMotion && Math.random() < 0.6) {
                const a = Math.random() * Math.PI * 2, rr = 1.6 + Math.random() * 0.6;
                this.sparks.emit(1, { position: [p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, z + (Math.random() - 0.5) * 0.8],
                    velocity: [-Math.cos(a) * 1.5 - Math.sin(a) * 1.2, -Math.sin(a) * 1.5 + Math.cos(a) * 1.2, 0],
                    life: [0.6, 1.0], size: [0.14, 0.02], color: [0.6, 1.8, 2.6, 0.9] });
            }
        }
        if (this.launcher) {
            const L = lv.launch;
            this.launcher.node.setPosition(L.x, L.y, this.heightAt(L.x, L.y) + 0.3);
            this.launcher.arrow.setScale(1 + Math.sin(t * 4) * 0.08);
        }
        for (const d of this.dustNodes) {
            d.node.visible = !d.taken;
            d.node.setPosition(d.spec.x, d.spec.y, this.heightAt(d.spec.x, d.spec.y) + 0.55 + Math.sin(t * 2.2 + d.spec.x) * 0.1);
            d.node.children[0].setRotationEuler(t * 1.3, t * 0.9, 0);
        }
        void dt;
    }

    /** Fabric height at a point (uses the bodies positioned by the last frame()). */
    heightAt(x, y) { return wellDepth(x, y, this.fieldBodies); }

    // ------------------------------------------------------------------ comet + effects

    /** Place the comet; `fresh` clears the trail (start of a flight). */
    setComet(x, y, visible, fresh = false) {
        if (fresh) this.trail.clear();
        this.comet.visible = visible;
        if (!visible) return;
        const z = this.heightAt(x, y) + 0.32;
        this.comet.setPosition(x, y, z);
        if (fresh) this.comet.teleport();
        this.trail.push(x, y, z);
    }

    /** Emit the comet's tail for this step. */
    cometTail(x, y, vx, vy) {
        const z = this.heightAt(x, y) + 0.32;
        this.sparks.emit(2, { position: [x, y, z], spread: 0.08, velocity: [-vx * 0.15, -vy * 0.15, 0.2], speed: 0.5,
            life: [0.35, 0.8], size: [0.2, 0], color: [0.7, 1.4, 2.6, 0.9], colorEnd: [0.3, 0.3, 1.2, 0] });
    }

    /** Radial burst on the fabric (pickups, placements, impacts). */
    burst(x, y, rgb, count = 40, speed = 5, size = 0.26) {
        const z = this.heightAt(x, y) + 0.4;
        this.sparks.emit(this.reducedMotion ? Math.ceil(count / 4) : count, { position: [x, y, z], spread: 0.15, speed, flat: false,
            life: [0.4, 1.0], size: [size, 0], color: [rgb[0], rgb[1], rgb[2], 1] });
    }

    /** A ring of sparks expanding along the fabric. */
    ring(x, y, rgb, count = 36, speed = 6) {
        const z = this.heightAt(x, y) + 0.2;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            this.sparks.emit(1, { position: [x, y, z], velocity: [Math.cos(a) * speed, Math.sin(a) * speed, 0], life: [0.5, 0.7], size: [0.22, 0], color: [rgb[0], rgb[1], rgb[2], 1] });
        }
    }

    takeDust(index) {
        const d = this.dustNodes[index];
        if (!d || d.taken) return;
        d.taken = true;
        this.burst(d.spec.x, d.spec.y, C.gold, 34, 4.5);
    }

    resetDust() { for (const d of this.dustNodes) d.taken = false; }

    // ------------------------------------------------------------------ trajectory preview

    /**
     * @param {number[] | null} path flat [x, y, ...] one point per frame
     * @param {"won" | "crashed" | "swallowed" | "lost" | "flying"} [status]
     */
    setPreview(path, status = "flying") {
        const g = this.previewGeo;
        if (!path) { g.drawCount = 0; g.markDirty(); return; }
        const frames = path.length / 2, stride = Math.max(2, Math.ceil(frames / PREVIEW_POINTS));
        const tint = status === "won" ? C.previewWin : status === "lost" || status === "flying" ? C.previewOk : C.previewBad;
        let n = 0;
        for (let f = stride; f < frames && n < PREVIEW_POINTS; f += stride, n++) {
            const x = path[f * 2], y = path[f * 2 + 1], k = f / frames;
            g.positions[n * 3] = x; g.positions[n * 3 + 1] = y; g.positions[n * 3 + 2] = this.heightAt(x, y) + 0.3;
            // the last stretch takes the outcome colour, so you can read the result at a glance
            const end = Math.max(0, (k - 0.82) / 0.18);
            for (let j = 0; j < 3; j++) g.colors[n * 4 + j] = C.previewOk[j] + (tint[j] - C.previewOk[j]) * end;
            g.colors[n * 4 + 3] = 0.85 - k * 0.45;
            g.uvs[n * 2] = 0.13 + end * 0.08;
        }
        g.drawCount = n;
        g.markDirty();
    }
}
