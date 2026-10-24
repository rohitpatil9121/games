/**
 * ORBITAL level designs. The playfield is x ∈ [-16, 16], y ∈ [-9, 9].
 *
 * Each design has: launch (position, angle, speed), portal, fixed bodies (some orbit), and the inventory the
 * player may place. Stardust and hints are NOT hand-placed: tools/solve.mjs searches for a real solution,
 * rejects levels that are unsolvable or solvable with zero moves, lays the three stardust along the found
 * path, and writes game/levels.js. So every level is provably solvable with all 3 stars.
 * @module game/levels.design
 */
export const DESIGNS = [
    {
        id: "first-light", name: "First Light",
        intro: "Drag a planet near the comet's path. Gravity bends it toward the portal.",
        launch: { x: -13, y: -4, angle: 0, speed: 6 }, portal: { x: 13, y: 3.5, r: 0.95 },
        fixed: [], inventory: { planet: 1 },
    },
    {
        id: "detour", name: "Detour",
        intro: "A giant blocks the way. Pull the comet around it.",
        launch: { x: -13, y: 0, angle: 0, speed: 6.5 }, portal: { x: 13, y: 0, r: 0.95 },
        fixed: [{ type: "giant", x: 0, y: 0 }], inventory: { planet: 1, moon: 1 },
    },
    {
        id: "slingshot", name: "Slingshot",
        intro: "The portal is behind you. Whip the comet around a giant.",
        launch: { x: -11, y: -4.5, angle: 0, speed: 4.6 }, portal: { x: -10, y: 4.5, r: 0.95 },
        fixed: [], inventory: { giant: 1, planet: 1 },
    },
    {
        id: "event-horizon", name: "Event Horizon",
        intro: "Black holes don't let go. Counter their pull.",
        launch: { x: -13, y: 2.5, angle: 0, speed: 6.5 }, portal: { x: 13, y: 2.5, r: 0.95 },
        fixed: [{ type: "blackhole", x: 0, y: -2.5 }], inventory: { planet: 1, moon: 1 },
    },
    {
        id: "gate", name: "Narrow Gate",
        intro: "Thread the gap between two worlds.",
        launch: { x: -13, y: 6, angle: -0.15, speed: 6 }, portal: { x: 13, y: -5.5, r: 0.95 },
        fixed: [{ type: "planet", x: 2, y: 2.6 }, { type: "planet", x: 2, y: -2.6 }], inventory: { moon: 2 },
    },
    {
        id: "pulsar", name: "Repulsion",
        intro: "Pulsars push instead of pull. Use one to bounce the comet up.",
        launch: { x: -13, y: -5, angle: 0, speed: 6 }, portal: { x: 4, y: 6, r: 0.95 },
        fixed: [], inventory: { pulsar: 1, moon: 1 },
    },
    {
        id: "clockwork", name: "Clockwork",
        intro: "The moon keeps moving. Timing is everything.",
        launch: { x: -13, y: -5, angle: 0.15, speed: 6 }, portal: { x: 13, y: 5, r: 0.95 },
        fixed: [{ type: "giant", x: 0, y: 0 }, { type: "moon", x: 0, y: 3.4, orbit: { cx: 0, cy: 0, r: 3.4, speed: 0.9, phase: 1.2 } }],
        inventory: { planet: 1 },
    },
    {
        id: "binary", name: "Binary",
        intro: "Two black holes. Only one safe corridor.",
        launch: { x: -13, y: 6.5, angle: -0.1, speed: 6.5 }, portal: { x: 13, y: -6, r: 0.95 },
        fixed: [{ type: "blackhole", x: -2.5, y: 1.5 }, { type: "blackhole", x: 5, y: -2.5 }], inventory: { planet: 1, pulsar: 1 },
    },
    {
        id: "wall", name: "The Long Way",
        intro: "A wall of giants. Go around the whole thing.",
        launch: { x: -13, y: 0, angle: 0, speed: 6.5 }, portal: { x: 13, y: 0, r: 0.95 },
        fixed: [{ type: "giant", x: 4, y: -5 }, { type: "giant", x: 4, y: 0 }, { type: "giant", x: 4, y: 5 }],
        inventory: { planet: 2 },
    },
    {
        id: "orrery", name: "Orrery",
        intro: "Two moons circle a giant in opposite directions.",
        launch: { x: -13, y: 5.5, angle: -0.2, speed: 6.5 }, portal: { x: 13, y: -5.5, r: 0.95 },
        fixed: [
            { type: "giant", x: 1, y: 0 },
            { type: "moon", x: 1, y: 3, orbit: { cx: 1, cy: 0, r: 3, speed: 1.0, phase: 0 } },
            { type: "moon", x: 1, y: -4.5, orbit: { cx: 1, cy: 0, r: 4.6, speed: -0.7, phase: 2.2 } },
        ],
        inventory: { moon: 1, pulsar: 1 },
    },
    {
        id: "lens", name: "Gravity Lens",
        intro: "Bend the comet twice to reach the far corner.",
        launch: { x: -13, y: -7, angle: 0.05, speed: 6 }, portal: { x: 12.5, y: 7, r: 0.95 },
        fixed: [{ type: "blackhole", x: 3, y: 1.5 }, { type: "planet", x: -4, y: 4 }], inventory: { planet: 1, moon: 1, pulsar: 1 },
    },
    {
        id: "singularity", name: "Singularity",
        intro: "Everything falls toward the centre. Almost everything.",
        launch: { x: -13, y: -6.5, angle: 0.25, speed: 7 }, portal: { x: 12, y: 6.5, r: 0.95 },
        fixed: [{ type: "blackhole", x: 0, y: 0 }, { type: "moon", x: 0, y: 3.8, orbit: { cx: 0, cy: 0, r: 3.8, speed: 0.8, phase: 0 } }],
        inventory: { giant: 1, planet: 1, pulsar: 1 },
    },
];
