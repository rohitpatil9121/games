/**
 * DECOY: every kind of prop. A prop is three things at once, all from the numbers here:
 *
 *   - what is drawn: a model in assets/models/props.glb, built by tools/make-models.mjs to exactly this size;
 *   - its hit shape: a box of this size turned by the prop's yaw (shots test the turned box exactly);
 *   - its collision: the same box squared to the nearest quarter turn (players slide along axis-aligned boxes).
 *
 * size is [width along the prop's own x, depth along its own y, height], in metres. A hider who takes a
 * prop takes all three, which is why a prop's size is bounded: nothing smaller than a mug, nothing bigger
 * than a small car (checked by tools/check-maps.mjs).
 *
 * `sound` is what the prop sounds like when a hider in it taunts or is pinged.
 * @module game/props
 */

/** smallest and largest prop a hider may become: [width, depth, height] of a mug and of a small car */
export const SMALLEST = [0.1, 0.1, 0.1];
export const LARGEST = [3.7, 1.7, 1.6];

export const PROP_LIST = [
    // --- anywhere
    { id: "box", name: "Cardboard box", size: [0.5, 0.4, 0.38] },
    { id: "mug", name: "Mug", size: [0.12, 0.1, 0.12] },
    { id: "bucket", name: "Bucket", size: [0.34, 0.34, 0.36] },
    { id: "trashcan", name: "Bin", size: [0.5, 0.5, 0.9] },
    // --- the night market
    { id: "crate", name: "Crate", size: [0.64, 0.64, 0.5] },
    { id: "barrel", name: "Barrel", size: [0.62, 0.62, 0.8] },
    { id: "stool", name: "Stool", size: [0.38, 0.38, 0.35] },
    { id: "table", name: "Table", size: [1.12, 1.12, 0.82] },
    { id: "planter", name: "Planter", size: [0.72, 0.72, 1.12] },
    { id: "bollard", name: "Bollard", size: [0.26, 0.26, 0.99] },
    { id: "lamp", name: "Lantern stand", size: [0.4, 0.4, 1.7] },
    { id: "sack", name: "Rice sack", size: [0.5, 0.34, 0.6] },
    { id: "cooler", name: "Cooler", size: [0.72, 0.44, 0.46] },
    { id: "gas", name: "Gas bottle", size: [0.32, 0.32, 0.72] },
    { id: "cart", name: "Food cart", size: [1.7, 0.9, 1.5] },
    { id: "scooter", name: "Scooter", size: [1.7, 0.62, 1.1] },
    { id: "fruit", name: "Fruit stand", size: [1.2, 0.8, 1.1] },
    { id: "kettle", name: "Kettle", size: [0.24, 0.2, 0.22] },
    { id: "car", name: "Little van", size: [3.4, 1.6, 1.6] },
    // --- the toy store
    { id: "block", name: "Toy block", size: [0.4, 0.4, 0.4] },
    { id: "bear", name: "Teddy bear", size: [0.5, 0.42, 0.62] },
    { id: "bunny", name: "Plush bunny", size: [0.36, 0.32, 0.7] },
    { id: "bigbear", name: "Giant bear", size: [1.0, 0.85, 1.35] },
    { id: "engine", name: "Train engine", size: [0.95, 0.44, 0.56] },
    { id: "wagon", name: "Train wagon", size: [0.8, 0.44, 0.42] },
    { id: "horse", name: "Rocking horse", size: [1.05, 0.36, 0.86] },
    { id: "ball", name: "Ball", size: [0.46, 0.46, 0.46] },
    { id: "pedalcar", name: "Pedal car", size: [1.1, 0.6, 0.62] },
    { id: "gift", name: "Gift box", size: [0.5, 0.5, 0.44] },
    { id: "robot", name: "Toy robot", size: [0.5, 0.4, 0.95] },
    { id: "drum", name: "Drum", size: [0.5, 0.5, 0.42] },
    { id: "duck", name: "Rubber duck", size: [0.3, 0.22, 0.26] },
    { id: "basket", name: "Basket", size: [0.55, 0.38, 0.3] },
    { id: "trolley", name: "Shopping trolley", size: [1.0, 0.6, 1.05] },
];

export const PROP_INDEX = Object.freeze(Object.fromEntries(PROP_LIST.map((p, i) => [p.id, i])));
/** hit-box half sizes per type: [half width, half depth, height] */
export const PROP_SHAPE = PROP_LIST.map((p) => [p.size[0] / 2, p.size[1] / 2, p.size[2]]);
export const propType = (id) => PROP_INDEX[id] ?? -1;

/**
 * The size rule: a prop's box, longest side first, must be no smaller than a mug's and no bigger than a
 * small car's on each side (so a tall thin lantern stand passes: it would fit inside the car lying down).
 */
export function sizeAllowed(size) {
    const s = [...size].sort((a, b) => b - a), lo = [...SMALLEST].sort((a, b) => b - a), hi = [...LARGEST].sort((a, b) => b - a);
    return s.every((v, i) => v >= lo[i] - 1e-9 && v <= hi[i] + 1e-9);
}
