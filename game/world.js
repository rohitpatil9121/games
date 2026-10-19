import { Entity, Mesh, InstancedMesh, Geometry, StandardMaterial, BasicMaterial, ParticleSystem, primitives, mat4 } from "../engine/index.js";
import { groundAt, normalAt } from "./island.js";
import { teamColor, LOOT_KINDS, ISLAND } from "./data.js";

/**
 * TIDEFALL: the 3D scene. Presentation only: it reads the island and what the client knows of the match
 * and draws them. Nothing here changes the match.
 *
 * Stage 1 greybox: the terrain is a few chunked meshes coloured by height, the sea is one flat plane at the
 * water level, ruins are merged boxes, loot is one instanced mesh of cubes, players are capsules.
 * @module game/world
 */

const CHUNK = 34;          // metres per terrain chunk side
const LOOT_COLORS = [[1, 1, 1], [1.0, 0.82, 0.25], [0.35, 0.85, 0.95], [1.0, 0.45, 0.85]];
const LOOT_SIZE = [0, 0.32, 0.5, 0.7];
const BOX_COLORS = { stone: [0.62, 0.6, 0.55], moss: [0.42, 0.5, 0.36], rock: [0.45, 0.42, 0.4], wood: [0.45, 0.32, 0.2] };

/** Terrain colour by height: deep floor, sand, grass, rock. */
function terrainColor(z, nz, out) {
    const sand = [0.86, 0.78, 0.58], grass = [0.42, 0.6, 0.3], rock = [0.5, 0.47, 0.44], deep = [0.55, 0.5, 0.42];
    let c = z < -1 ? deep : z < 3 ? sand : grass;
    if (z >= 1.5 && z < 3) { const t = (z - 1.5) / 1.5; c = sand.map((v, i) => v + (grass[i] - v) * t); }
    if (nz < 0.8) c = c.map((v, i) => v + (rock[i] - v) * Math.min(1, (0.8 - nz) * 4));
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
}

export class World {
    /** @param {import("../engine/Game.js").Game} game */
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.root = null;
        this.players = new Map();
        this.time = 0;
        this.lootMesh = new InstancedMesh(primitives.box(1, 1, 1), new StandardMaterial({ specular: 0.5, shininess: 30 }), 200);
        this.lootMesh.count = 0;
        const loot = this.scene.add(new Entity({ name: "loot", mesh: this.lootMesh, frustumCulled: false }));
        loot.interpolate = false;
        this._bodyGeometry = primitives.capsule(0.35, 1.1, 6, 12);
        // the grapple's rope: one line, rewritten each frame
        this.ropeGeometry = new Geometry({ name: "rope", mode: "lines", dynamic: true, positions: new Float32Array(6), colors: new Float32Array([0.9, 0.85, 0.7, 1, 0.9, 0.85, 0.7, 1]) });
        this.ropeEntity = this.scene.add(new Entity({ name: "rope", castShadow: false, frustumCulled: false, visible: false,
            mesh: new Mesh(this.ropeGeometry, new BasicMaterial({ lit: false, vertexColors: true })) }));
        this.ropeEntity.interpolate = false;
        const particles = (options) => { const p = this.scene.add(new ParticleSystem(options)); p.castShadow = false; p.frustumCulled = false; return p; };
        this.spray = particles({ capacity: 900, gravity: [0, 0, -9], drag: 1.2, blending: "normal", name: "spray" });
        this.sparkle = particles({ capacity: 400, gravity: [0, 0, 1.5], drag: 2, name: "sparkle" });
        this._noseGeometry = primitives.box(0.18, 0.5, 0.18);
    }

    /** Build the scene for an island. */
    loadIsland(island) {
        if (this.root) this.scene.remove(this.root);
        for (const id of [...this.players.keys()]) this.removePlayer(id);
        this.island = island;
        const root = (this.root = this.scene.add(new Entity({ name: "island" })));
        const scene = this.scene;
        scene.clearColor.set([0.55, 0.72, 0.86, 1]);
        const sun = [0.45, -0.35, 0.82], l = Math.hypot(...sun);
        scene.sunDirection.set(sun.map((v) => v / l));
        scene.sunColor.set([1.2, 1.1, 0.95]);
        scene.skyColor.set([0.45, 0.55, 0.7]);
        scene.groundColor.set([0.3, 0.27, 0.22]);
        scene.fogColor.set([0.6, 0.74, 0.86]); scene.fogDensity = 0.004;

        // terrain chunks
        const terrainMaterial = new StandardMaterial({ vertexColors: true });
        const half = island.half, chunks = Math.ceil(island.size / CHUNK), step = island.cell;
        const nrm = [0, 0, 1], col = [0, 0, 0];
        for (let cy = 0; cy < chunks; cy++) for (let cx = 0; cx < chunks; cx++) {
            const x0 = -half + cx * CHUNK, y0 = -half + cy * CHUNK, seg = Math.round(CHUNK / step), w = seg + 1;
            const positions = new Float32Array(w * w * 3), normals = new Float32Array(w * w * 3), colors = new Float32Array(w * w * 4);
            for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
                const x = Math.min(half, x0 + i * step), y = Math.min(half, y0 + j * step), z = groundAt(island, x, y), k = j * w + i;
                normalAt(island, x, y, nrm);
                terrainColor(z, nrm[2], col);
                positions.set([x, y, z], k * 3); normals.set(nrm, k * 3); colors.set([col[0], col[1], col[2], 1], k * 4);
            }
            const indices = new Uint32Array(seg * seg * 6);
            let n = 0;
            for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
                const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
                indices.set([a, b, d, a, d, c], n); n += 6;
            }
            const e = new Entity({ name: "terrain", mesh: new Mesh(new Geometry({ positions, normals, colors, indices }), terrainMaterial) });
            root.add(e);
        }

        // ruins: one merged mesh
        const parts = [];
        for (const s of island.solids) {
            const w = s.x1 - s.x0, d = s.y1 - s.y0, h = s.z1 - s.z0;
            parts.push({ geometry: primitives.box(w, d, h), matrix: mat4.fromTranslation(mat4.create(), [s.x0 + w / 2, s.y0 + d / 2, s.z0 + h / 2]), color: BOX_COLORS[s.mat] || BOX_COLORS.stone });
        }
        // camps: a chest and a tall pole with a team-coloured flag
        for (const camp of island.camps) {
            const c = teamColor(camp.team);
            parts.push({ geometry: primitives.box(1.6, 1.0, 0.9), matrix: mat4.fromTranslation(mat4.create(), [camp.x, camp.y, camp.z + 0.45]), color: [0.5, 0.33, 0.16] });
            parts.push({ geometry: primitives.box(0.15, 0.15, 6), matrix: mat4.fromTranslation(mat4.create(), [camp.x + 2.4, camp.y, camp.z + 3]), color: [0.3, 0.25, 0.2] });
            parts.push({ geometry: primitives.box(0.06, 1.6, 1.0), matrix: mat4.fromTranslation(mat4.create(), [camp.x + 2.4, camp.y + 0.85, camp.z + 5.4]), color: c });
            // the banking ring, drawn flat on the pad
            parts.push({ geometry: primitives.torus(ISLAND.bankRadius, 0.06, 6, 48), matrix: mat4.fromTranslation(mat4.create(), [camp.x, camp.y, camp.z + 0.04]), color: c });
        }
        if (parts.length) root.add(new Entity({ name: "ruins", mesh: new Mesh(Geometry.merge(parts, { uvs: false }), new StandardMaterial({ vertexColors: true })) }));

        // the sea: one big plane moved to the water level each frame
        this.sea = new Entity({ name: "sea", castShadow: false, frustumCulled: false,
            mesh: new Mesh(primitives.plane(900, 900), new StandardMaterial({ color: [0.1, 0.42, 0.55], opacity: 0.72, specular: 0.8, shininess: 60, depthWrite: false })) });
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
        if (p && p.team === team) return p;
        if (p) this.removePlayer(id);
        const c = teamColor(team);
        const root = this.scene.add(new Entity({ name: "player" }));
        root.interpolate = false;
        const body = new Entity({ name: "body", mesh: new Mesh(this._bodyGeometry, new StandardMaterial({ color: c, specular: 0.3 })) });
        body.setPosition(0, 0, 0.9);
        const nose = new Entity({ name: "nose", mesh: new Mesh(this._noseGeometry, new StandardMaterial({ color: [0.15, 0.15, 0.18] })) });
        nose.setPosition(0.35, 0, 1.45);
        nose.setYaw(Math.PI / 2);
        root.add(body); root.add(nose);
        p = { root, team };
        this.players.set(id, p);
        return p;
    }

    /** Place a player: position, facing (radians) and visibility. */
    placePlayer(id, team, x, y, z, face, alive) {
        const p = this.playerEntity(id, team);
        p.root.visible = alive;
        p.root.setPosition(x, y, z);
        p.root.setYaw(face);
        p.root.teleport();
    }

    /** Draw the loot: everything lying about, and what each player carries on their back. */
    drawLoot(loot, carriers) {
        const m = this.lootMesh;
        let n = 0;
        const t = this.time;
        for (const item of loot) {
            if (n >= m.capacity) break;
            const s = LOOT_SIZE[item.kind], c = LOOT_COLORS[item.kind];
            let x = item.x, y = item.y, z = item.z + s / 2, spin = t * 0.8 + item.id;
            if (item.holder) {
                const at = carriers.get(item.holder);
                if (!at) continue;
                const k = at.index.get(item.id) || 0;
                x = at.x - at.fx * 0.4; y = at.y - at.fy * 0.4; z = at.z + 1.1 + k * 0.3; spin = at.face;
            } else z += 0.1 + Math.sin(t * 2 + item.id) * 0.06;
            m.setTransform(n, x, y, z, s, s, s, spin);
            m.setColor(n, c[0], c[1], c[2], 1);
            n++;
        }
        m.count = n;
    }

    /** Show the grapple's rope from a hand to the hook, or hide it. */
    rope(on, ax, ay, az, bx, by, bz) {
        this.ropeEntity.visible = on;
        if (!on) return;
        this.ropeGeometry.positions.set([ax, ay, az, bx, by, bz]);
        this.ropeGeometry.markDirty();
    }

    /** Water thrown up where something hits the surface. */
    splash(x, y, z, strength = 1) {
        this.spray.emit(Math.round(14 + 26 * strength), { position: [x, y, z + 0.05], spread: 0.4, velocity: [0, 0, 2.5 * strength], speed: 2.2 * strength, life: [0.4, 0.9], size: [0.16, 0.04], color: [0.85, 0.95, 1, 0.9], colorEnd: [0.7, 0.9, 1, 0] });
    }

    /** A glint: picking something up, banking it. */
    glint(x, y, z, color, n = 24) {
        this.sparkle.emit(n, { position: [x, y, z], spread: 0.3, speed: 2.4, life: [0.3, 0.8], size: [0.18, 0], color: [color[0] * 2.5, color[1] * 2.5, color[2] * 2.5, 1] });
    }

    /** Move the sea to the water level. */
    setWater(level) { if (this.sea) { this.sea.setPosition(0, 0, level); this.sea.teleport(); } }

    update(dt) { this.time += dt; }
}

export { LOOT_KINDS };
