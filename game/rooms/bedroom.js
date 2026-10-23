/**
 * PAPER PLANES: the Kid's Bedroom (afternoon). A room is data only: the shell, furniture as boxes with a
 * material tag, air sources, launch spots. Origin is the middle of the floor; X east, Y north, Z up.
 *
 * Stage 1 greybox: the shell, a desk with the desk fan, the radiator under the window (the thermal), a bunk
 * bed to dive under and a toy shelf to weave between.
 * @module game/rooms/bedroom
 */

/** a box from its min and max corners */
const B = (x0, y0, z0, x1, y1, z1, tag = "wood") => Object.freeze({ min: [x0, y0, z0], max: [x1, y1, z1], tag });
/** four legs or posts under a top, `s` thick, from the floor to z */
const posts = (x0, y0, x1, y1, z, s, tag) => [
    B(x0, y0, 0, x0 + s, y0 + s, z, tag), B(x1 - s, y0, 0, x1, y0 + s, z, tag),
    B(x0, y1 - s, 0, x0 + s, y1, z, tag), B(x1 - s, y1 - s, 0, x1, y1, z, tag),
];

export const bedroom = Object.freeze({
    id: "bedroom",
    name: "Kid's Bedroom",
    /** the inside of the walls */
    size: Object.freeze({ min: [-2.5, -2.1, 0], max: [2.5, 2.1, 2.7] }),
    boxes: Object.freeze([
        // the radiator under the window (north wall)
        B(-0.6, 1.94, 0.12, 0.6, 2.08, 0.72, "metal"),
        // the desk by the east wall, and the desk fan on it
        B(1.85, -0.7, 0.72, 2.45, 0.7, 0.76),
        ...posts(1.85, -0.7, 2.45, 0.7, 0.72, 0.05),
        B(2.16, -0.09, 0.76, 2.32, 0.09, 0.8, "plastic"),
        B(2.21, -0.02, 0.8, 2.27, 0.02, 0.98, "plastic"),
        B(2.06, -0.15, 0.98, 2.26, 0.15, 1.24, "plastic"),
        // the bunk bed along the west wall: a gap under the lower bunk, a cave between the bunks
        B(-2.45, -2.05, 0.25, -1.55, 0.05, 0.45, "fabric"),
        B(-2.45, -2.05, 1.35, -1.55, 0.05, 1.55, "fabric"),
        ...posts(-2.45, -2.05, -1.55, 0.05, 1.85, 0.07),
        // the toy shelf on the south wall: sides and four boards
        B(-0.52, -2.1, 0, -0.5, -1.82, 1.62), B(0.5, -2.1, 0, 0.52, -1.82, 1.62),
        B(-0.5, -2.1, 0.4, 0.5, -1.82, 0.42), B(-0.5, -2.1, 0.8, 0.5, -1.82, 0.82),
        B(-0.5, -2.1, 1.2, 0.5, -1.82, 1.22), B(-0.5, -2.1, 1.6, 0.5, -1.82, 1.62),
    ]),
    air: Object.freeze([
        // the desk fan, blowing west across the room, sweeping ±40° every 8 s
        Object.freeze({ kind: "fan", at: [2.05, 0, 1.11], yaw: Math.PI, pitch: 0, half: 0.49, reach: 3.0, speed: 1.3, sweep: 0.7, period: 8 }),
        // warm air off the radiator, leaning out into the room under the window
        Object.freeze({ kind: "thermal", at: [0, 1.3], radius: 0.6, bottom: 0.72, top: 2.4, rise: 0.52, riseTop: 0.28 }),
    ]),
    /** where planes launch and refold: position and the heading they face */
    launches: Object.freeze([
        Object.freeze({ at: [-0.9, 1.2, 1.9], yaw: -0.6 }),
        Object.freeze({ at: [1.2, 1.3, 2.0], yaw: -2.3 }),
        Object.freeze({ at: [1.3, -1.3, 1.9], yaw: 2.4 }),
        Object.freeze({ at: [-1.1, -1.0, 2.1], yaw: 0.7 }),
    ]),
});
