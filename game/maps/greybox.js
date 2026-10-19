/**
 * GREY BOX: a plain test room, 32 × 24 m. Used by the tests and by the first stages of building the game.
 * A raised deck along the north wall with a ramp up, a few walls to break the view, props in rows.
 * @module game/maps/greybox
 */

import { nav } from "./greybox.nav.js";

const boxes = [], ramps = [], props = [];
const box = (x0, y0, z0, x1, y1, z1, mat) => boxes.push({ min: [x0, y0, z0], max: [x1, y1, z1], mat });
const prop = (type, x, y, rot = 0, z = 0) => props.push({ type, pos: [x, y, z], rot });

const W = 16, D = 12, H = 5;
box(-W - 1, -D - 1, -1, W + 1, D + 1, 0, "floor");
box(-W - 1, -D - 1, 0, -W, D + 1, H, "wall");
box(W, -D - 1, 0, W + 1, D + 1, H, "wall");
box(-W, -D - 1, 0, W, -D, H, "wall");
box(-W, D, 0, W, D + 1, H, "wall");

// the deck and its ramp
box(-W, 7, 0, 2, D, 1.6, "deck");
ramps.push({ min: [2, 7, 0], max: [6, 10, 1.6], dir: "-x", mat: "ramp" });

// walls to hide behind
box(-6, -3, 0, -5.6, 4, 2.6, "wall");
box(4, -8, 0, 4.4, -1, 2.6, "wall");
box(9, 1, 0, 14, 1.4, 2.6, "wall");

// the seekers' room in the south-west corner, with a door
box(-W, -6, 0, -10, -5.6, H, "wall");
box(-10.4, -D, 0, -10, -9, H, "wall");
box(-10.4, -7.5, 0, -10, -5.6, H, "wall");

// props in rows, as a store would keep them
for (let i = 0; i < 5; i++) prop("crate", -3 + i * 0.7, -10.8);
for (let i = 0; i < 4; i++) prop("barrel", 7 + i * 0.75, -10.9);
for (let i = 0; i < 6; i++) prop("box", 10 + (i % 3) * 0.6, 3 + Math.floor(i / 3) * 0.6, 90);
prop("table", 0, 2); prop("stool", -1, 2); prop("stool", 1, 2); prop("stool", 0, 3.1);
prop("table", 6, 4, 45); prop("stool", 5, 4); prop("stool", 7, 4);
prop("bucket", -8, 0); prop("bucket", -8.5, 0.6); prop("trashcan", -4.8, 5.5);
prop("planter", 14.5, -6); prop("planter", 14.5, -3); prop("bollard", 12, -9); prop("bollard", 13, -9);
for (let i = 0; i < 4; i++) prop("crate", -14 + i * 0.7, 8.5, 0, 1.6);
prop("barrel", -6, 9); prop("mug", 0.2, 2.1, 0, 0.82); prop("kettle", -0.3, 1.8, 30, 0.82);

export const greybox = {
    id: "greybox",
    name: "Grey Box",
    test: true,
    env: { indoor: true },
    boxes, ramps, props, nav,
    spawns: {
        hider: [[0, 0, 0, 0], [3, -4, 0, 1.6], [-3, 6, 0, -1.6], [8, 6, 0, 3.1], [12, -5, 0, 1.6], [-8, 4, 0, 0], [-12, 2, 0, 0], [2, -9, 0, 1.6], [-10, 9.5, 1.6, 0], [10, 9, 0, 3.1]],
        seeker: [[-14.5, -10.5, 0, 0], [-13, -10.5, 0, 0], [-11.5, -10.5, 0, 0], [-14.5, -8, 0, 0], [-13, -8, 0, 0], [-11.5, -8, 0, 0], [-14.5, -9.2, 0, 0], [-12.2, -9.2, 0, 0]],
    },
    lights: [
        { pos: [-8, 0, 4.6], color: [1.6, 1.4, 1.1], radius: 14 },
        { pos: [8, 0, 4.6], color: [1.6, 1.4, 1.1], radius: 14 },
        { pos: [0, -8, 4.6], color: [1.4, 1.3, 1.1], radius: 12 },
        { pos: [-12, -9, 4.6], color: [1.0, 0.6, 0.4], radius: 8 },
    ],
};
