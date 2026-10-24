import { greybox } from "./greybox.js";
import { PROP_INDEX, PROP_SHAPE } from "../props.js";
import { quantizeYaw, yawOf, dcos, dsin } from "../sim.js";

/**
 * Maps. A map is plain data (see greybox.js): boxes with material tags, ramps, a prop list, spawns,
 * lights, and a waypoint graph generated from those. compileMap() turns it into what the simulation and
 * the renderer both read, so collision on the server, collision on the client, shots, and the drawn
 * scene all come from the same numbers.
 *
 *   boxes   { min, max, mat }            walls, floors, shelves: solid, drawn as boxes
 *   ramps   { min, max, dir, mat }       walked as stairs of thin boxes, drawn as wedges
 *   props   { type, pos: [x, y, z], rot } rot in degrees. Each is solid (its box squared to the nearest
 *                                         quarter turn, or the box around it if it stands at an angle),
 *                                         is hit by shots as its exact turned box, and is a disguise
 *   spawns  { hider: [[x, y, z, yaw]], seeker: [...] }   yaw in radians
 * @module game/maps
 */

const MAP_DEFS_LIST = [greybox];
export const MAP_DEFS = Object.fromEntries(MAP_DEFS_LIST.map((m) => [m.id, m]));
export const MAP_LIST = Object.keys(MAP_DEFS);
/** maps a match can be played on (the grey box is for tests) */
export const PLAY_MAPS = MAP_LIST.filter((id) => !MAP_DEFS[id].test);

const RAMP_STEP = 0.18;
const CELL = 4;

function rampSolids(r) {
    const rise = r.max[2] - r.min[2], n = Math.max(1, Math.ceil(rise / RAMP_STEP)), out = [];
    const axis = r.dir[1] === "x" ? 0 : 1, up = r.dir[0] === "+";
    const a0 = r.min[axis], len = r.max[axis] - r.min[axis];
    for (let i = 0; i < n; i++) {
        const lo = up ? a0 + (len * i) / n : a0 + (len * (n - 1 - i)) / n, hi = lo + len / n;
        const s = { x0: r.min[0], y0: r.min[1], z0: r.min[2], x1: r.max[0], y1: r.max[1], z1: r.min[2] + (rise * (i + 0.5)) / n, mat: r.mat || "ramp" };
        if (axis === 0) { s.x0 = lo; s.x1 = hi; } else { s.y0 = lo; s.y1 = hi; }
        out.push(s);
    }
    return out;
}

const JUMP_COST = 7;
function compileNav(points, links) {
    const out = points.map(() => []);
    for (const [a, b, kind] of links) {
        const p = points[a], q = points[b];
        out[a].push({ to: b, kind, cost: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) + (kind === 1 ? JUMP_COST : 0) });
    }
    return { points, out, links };
}

/** A placed prop as the simulation reads it. */
export function placeProp(def) {
    const type = PROP_INDEX[def.type];
    if (type === undefined) throw new Error(`Unknown prop type "${def.type}"`);
    const s = PROP_SHAPE[type], yaw = quantizeYaw(((def.rot || 0) * Math.PI) / 180), a = yawOf(yaw);
    const c = Math.abs(dcos(a)), n = Math.abs(dsin(a));
    // the box around the turned footprint (for a quarter turn, exactly the footprint)
    const ex = Math.round((c * s[0] + n * s[1]) * 1e4) / 1e4, ey = Math.round((n * s[0] + c * s[1]) * 1e4) / 1e4;
    return { type, x: def.pos[0], y: def.pos[1], z: def.pos[2] || 0, yaw, ex, ey, h: s[2], r: Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2] * 0.25) };
}

const cache = new Map();

/** @param {string} id */
export function getMap(id) {
    if (!cache.has(id)) {
        if (!MAP_DEFS[id]) throw new Error(`Unknown map "${id}"`);
        cache.set(id, compileMap(MAP_DEFS[id]));
    }
    return cache.get(id);
}

export function compileMap(def) {
    const walls = [];
    for (const b of def.boxes) walls.push({ x0: b.min[0], y0: b.min[1], z0: b.min[2], x1: b.max[0], y1: b.max[1], z1: b.max[2], mat: b.mat });
    for (const r of def.ramps || []) walls.push(...rampSolids(r));
    const props = (def.props || []).map(placeProp);
    const solids = [...walls];
    props.forEach((q, i) => solids.push({ x0: q.x - q.ex, y0: q.y - q.ey, z0: q.z, x1: q.x + q.ex, y1: q.y + q.ey, z1: q.z + q.h, mat: "prop", prop: i }));

    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const s of solids) {
        x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); z0 = Math.min(z0, s.z0);
        x1 = Math.max(x1, s.x1); y1 = Math.max(y1, s.y1); z1 = Math.max(z1, s.z1);
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / CELL)), ny = Math.max(1, Math.ceil((y1 - y0) / CELL));
    const cells = Array.from({ length: nx * ny }, () => []);
    solids.forEach((s, i) => {
        s.id = i; s.stamp = 0;
        const cx0 = Math.max(0, Math.floor((s.x0 - x0) / CELL)), cx1 = Math.min(nx - 1, Math.floor((s.x1 - x0) / CELL));
        const cy0 = Math.max(0, Math.floor((s.y0 - y0) / CELL)), cy1 = Math.min(ny - 1, Math.floor((s.y1 - y0) / CELL));
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * nx + cx].push(s);
    });

    return {
        id: def.id, name: def.name, env: def.env || {}, test: !!def.test,
        boxes: def.boxes, ramps: def.ramps || [],
        walls, props, solids,
        grid: { x0, y0, nx, ny, cell: CELL, cells },
        bounds: { min: [x0, y0, z0], max: [x1, y1, z1] },
        spawns: def.spawns, lights: def.lights || [], decor: def.decor || [],
        nav: compileNav(def.nav?.points || [], def.nav?.links || []),
    };
}
