import { Geometry, primitives } from "../../engine/index.js";
import { part } from "./props.js";

/**
 * SKYFARM: the landmarks' geometry, from the shape descriptors in game/landmarks.js (the same list the
 * simulation took its collision boxes from, so what you see is what you bump into). One merged mesh per island,
 * painted by the prop material (surface kind in the colour's alpha).
 *
 * `detail` picks the tessellation: 1 near, 0.5 mid, 0.25 far (a far landmark is a silhouette in the haze).
 * @module game/gfx/landmarks
 */

const cache = new Map();
/** a primitive at a tessellation, shared between islands */
function prim(type, size, detail, open) {
    const seg = Math.max(5, Math.round(18 * detail)), key = type + ":" + seg + (open ? "o" : "");
    if (!cache.has(key)) {
        cache.set(key, type === "box" ? primitives.box(1, 1, 1)
            : type === "cyl" ? primitives.cylinder(0.5, 0.5, 1, seg, !open)
            : type === "cone" ? primitives.cone(0.5, 1, seg)
            : primitives.sphere(0.5, seg, Math.max(4, Math.round(seg * 0.65))));
    }
    return cache.get(key);
}

/**
 * @param {object[]} shapes from landmarkShapes()
 * @param {number} detail
 * @returns {Geometry | null}
 */
export function landmarkGeometry(shapes, detail = 1) {
    const parts = [];
    for (const s of shapes) {
        if (s.invisible) continue;
        let g, scale;
        if (s.type === "box") { g = prim("box", 0, detail); scale = s.size; }
        else if (s.type === "cyl") {
            // a tapering cylinder: the primitive is a unit cylinder, so taper is drawn as a cone frustum built here
            g = s.size[0] === s.size[1] ? prim("cyl", 0, detail, s.open) : frustum(s.size[0] / s.size[1], Math.max(5, Math.round(18 * detail)));
            scale = [s.size[1] * 2, s.size[1] * 2, s.size[2]];
            if (s.size[0] === s.size[1]) scale = [s.size[0] * 2, s.size[0] * 2, s.size[2]];
        } else if (s.type === "cone") { g = prim("cone", 0, detail); scale = [s.size[0] * 2, s.size[0] * 2, s.size[1]]; }
        else { g = prim("ball", 0, detail); scale = [s.size[0] * 2, s.size[1] * 2, s.size[2] * 2]; }
        parts.push(part(g, s.at, s.kind, s.rot, scale, s.color));
    }
    return parts.length ? Geometry.merge(parts, { uvs: false }) : null;
}

const frusta = new Map();
/** a unit-height frustum, bottom radius 0.5, top radius 0.5·k (so it scales like the unit cylinder) */
function frustum(k, seg) {
    const key = k.toFixed(3) + ":" + seg;
    if (!frusta.has(key)) frusta.set(key, primitives.cylinder(0.5 * k, 0.5, 1, seg, true));
    return frusta.get(key);
}
