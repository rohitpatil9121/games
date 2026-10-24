import { Geometry, primitives, mat4 } from "../engine/index.js";
import { PROP_LIST } from "./props.js";

/**
 * DECOY: geometry for props and the scanner.
 *
 * Every prop is drawn from one Geometry per type, with its base at the origin and its own +X forward,
 * exactly PROP_LIST's size. Until the generated models are loaded (setPropModels) a prop is a box in
 * its own colour, which is what the grey-box stages are drawn with.
 * @module game/models
 */

/** a colour per prop type for the grey-box look: derived from the name, so it is the same everywhere */
function tint(id) {
    let h = 7;
    for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    const r = 0.35 + ((h & 255) / 255) * 0.5, g = 0.35 + (((h >> 8) & 255) / 255) * 0.5, b = 0.35 + (((h >> 16) & 255) / 255) * 0.5;
    return [r, g, b];
}

const boxes = new Map();
let models = null;

/** Use generated models (type id → Geometry) instead of boxes. */
export function setPropModels(map) { models = map; }

/** The geometry a prop type is drawn with: its base on z = 0, centred on x and y. */
export function propGeometry(type) {
    const def = PROP_LIST[type];
    if (models && models.has(def.id)) return models.get(def.id);
    if (!boxes.has(type)) {
        const [w, d, h] = def.size, c = tint(def.id);
        boxes.set(type, Geometry.merge([
            { geometry: primitives.box(w, d, h), matrix: mat4.fromTranslation(mat4.create(), [0, 0, h / 2]), color: c },
            // a darker band round the middle, so a turned box shows which way it faces
            { geometry: primitives.box(w * 0.3, d + 0.004, h * 0.2), matrix: mat4.fromTranslation(mat4.create(), [w * 0.3, 0, h * 0.6]), color: c.map((v) => v * 0.5) },
        ], { uvs: false }));
    }
    return boxes.get(type);
}

/** The scanner, seen in the hand: +X forward, +Z up. A grip, a body, an emitter ring that glows. */
let scanner = null;
export function scannerGeometry() {
    if (scanner) return scanner;
    const at = (x, y, z) => mat4.fromTranslation(mat4.create(), [x, y, z]);
    const turned = (x, y, z) => { const m = mat4.fromTranslation(mat4.create(), [x, y, z]); mat4.rotateY(m, m, Math.PI / 2); return m; };
    scanner = Geometry.merge([
        { geometry: primitives.box(0.42, 0.12, 0.13), matrix: at(0.12, 0, 0.06), color: [0.2, 0.22, 0.26] },
        { geometry: primitives.box(0.1, 0.09, 0.2), matrix: at(-0.02, 0, -0.08), color: [0.12, 0.12, 0.14] },
        { geometry: primitives.cylinder(0.055, 0.07, 0.18, 16), matrix: turned(0.38, 0, 0.065), color: [0.3, 0.33, 0.4] },
        { geometry: primitives.torus(0.06, 0.014, 8, 18), matrix: turned(0.47, 0, 0.065), color: [0.4, 1.4, 1.6, 2] },
        { geometry: primitives.box(0.2, 0.125, 0.025), matrix: at(0.08, 0, 0.135), color: [0.3, 1.2, 1.4, 2] },
    ], { uvs: false });
    return scanner;
}
/** where the beam leaves the scanner, in its own space */
export const MUZZLE = [0.5, 0, 0.065];
