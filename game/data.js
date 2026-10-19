/**
 * TIDEFALL: every number the game is tuned by. No logic here.
 *
 * Distances are metres, times are seconds unless a name says "ticks". Z is up. The simulation runs at 60 Hz.
 * @module game/data
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Input button bits, as sent on the wire. */
export const BTN = Object.freeze({
    jump: 1,
    sprint: 2,
    interact: 4,
    drop: 8,
    grapple: 16,
    shove: 32,
    flare: 64,
});

/**
 * The tide. A match is `tides` cycles of `cycle` seconds. Each cycle is four phases; the water level is a
 * pure function of the seed and the tick (game/tide.js), so it never travels on the wire.
 * `lows` is how far each tide drains (metres, sea level 0); each goes lower than the last, so the deep
 * ruins open late. `jitter` is the most the seed moves a low tide up or down.
 */
export const TIDE = Object.freeze({
    tides: 6,
    phases: Object.freeze([
        { id: "ebb", name: "Ebb", seconds: 30 },
        { id: "low", name: "Low tide", seconds: 25 },
        { id: "flood", name: "Flood", seconds: 25 },
        { id: "high", name: "High tide", seconds: 10 },
    ]),
    cycle: 90,
    high: 1.6,
    lows: Object.freeze([-2.5, -3.1, -4.2, -4.8, -6.0, -7.7]),
    jitter: 0.2,
    /** the low-tide swell: a slow rise and fall on top of the level, so still water still moves */
    swell: 0.08,
});

/**
 * The island. A square heightmap `size` metres across, sampled every `cell` metres, centred on the origin.
 * `profile` is the height (metres) at a distance from the centre, before noise; camps sit on the plateau
 * edge, ruins on rings at falling depth. Noise is attenuated near camps and ruins so they stay fair and flat.
 */
export const ISLAND = Object.freeze({
    size: 272,
    cell: 2,
    profile: Object.freeze([[0, 10], [18, 9], [30, 7.4], [38, 6.6], [48, 3.6], [58, 1.0], [68, -0.9], [80, -1.9], [92, -3.6], [104, -5.3], [116, -7.0], [124, -8.2], [136, -11]]),
    noise: 1.3,
    campRadius: 34,
    /** flat camp pad radius, and the radius inside which loot is banked */
    campPad: 7,
    bankRadius: 4.2,
    /** ring radius and target depth of each ring of ruins, shallow to deep; the last ring holds the wreck */
    rings: Object.freeze([
        { r: 79, perSector: 2, tier: 0 },
        { r: 92, perSector: 2, tier: 1 },
        { r: 104, perSector: 1, tier: 2 },
        { r: 116, perSector: 0, tier: 3, wreck: true },
    ]),
});

export const MOVE = Object.freeze({
    /** the player is an upright box this wide (half-width) */
    radius: 0.35,
    height: 1.8,
    eye: 1.55,
    run: 6.4,
    sprint: 8.6,
    accel: 12,
    friction: 8,
    stopSpeed: 2,
    airSpeed: 1.6,
    airAccel: 6,
    gravity: 22,
    jump: 7.6,
    /** tallest ledge walked up without jumping */
    step: 0.45,
    /** a ledge up to this high above the feet is climbed by jumping into it */
    mantle: 1.45,
    /** terrain steeper than this (rise over run in one tick's move) is a wall */
    maxSlope: 1.6,
    maxFall: 40,
    /** ticks after leaving the ground that a jump still counts, and ticks a jump pressed early is remembered */
    coyote: 7,
    jumpBuffer: 7,
    killZ: -40,
});

export const WATER = Object.freeze({
    /** deeper than this over the feet, the player swims instead of wading */
    swimDepth: 1.2,
    /** wading in water this deep and more is slow */
    wadeDepth: 0.45,
    wade: 0.72,
    swim: 3.0,
    swimAccel: 6,
    swimDrag: 2.4,
    /** a floating player's feet sit this far under the surface */
    float: 1.25,
    buoyancy: 9,
    /** kilograms a swimmer can hold up; above this they sink and walk the sea floor */
    swimCapacity: 4,
    seabedWalk: 2.4,
    sinkSpeed: 2.2,
    /** seconds of breath with the head under water */
    breath: 9,
    /** a stroke upward when jump is pressed while swimming */
    stroke: 3.2,
});

/** What can be picked up. Weight in kilograms, value in points. */
export const LOOT = Object.freeze({
    coin: { id: 1, name: "Coins", weight: 1, value: 10 },
    relic: { id: 2, name: "Relic", weight: 3, value: 40 },
    idol: { id: 3, name: "Idol", weight: 7, value: 130 },
});
export const LOOT_KINDS = Object.freeze(["", "coin", "relic", "idol"]);
/**
 * Weighted loot table per depth tier (shallow to deep): chances of coin, relic, idol.
 * Deeper ruins hold better loot.
 */
export const LOOT_TABLE = Object.freeze([
    [0.8, 0.2, 0],
    [0.55, 0.38, 0.07],
    [0.3, 0.45, 0.25],
    [0.12, 0.38, 0.5],
]);

export const CARRY = Object.freeze({
    maxWeight: 14,
    maxItems: 6,
    /** share of speed and jump lost per kilogram carried */
    slowPerKg: 0.032,
    jumpPerKg: 0.022,
    /** within this reach (metres, horizontally) an item can be picked up */
    reach: 1.7,
    reachDown: 2.8,
});

export const TOOLS = Object.freeze({
    grapple: { range: 30, speed: 19, cooldown: 3.5, maxTicks: 95, release: 1.4 },
    shove: { range: 2.1, cone: 0.45, cooldown: 1.2, knock: 7, lift: 3.2, stun: 0.45, behindStun: 1.0, behindDot: 0.35 },
    flare: { range: 40, cooldown: 9, blindRadius: 9, blind: 2.4, mark: 12 },
});

export const MATCH = Object.freeze({
    maxPlayers: 8,
    maxTeams: 4,
    /** seconds dead before respawning at camp */
    respawn: 5,
    /** seconds the results stay up before the next match */
    intermission: 14,
    maxLoot: 140,
});

/** Lag compensation for shoves: positions remembered for HISTORY ticks, a shove reaches back at most MAX_REWIND (200 ms). */
export const HISTORY = 32;
export const MAX_REWIND = 12;

/**
 * Team colours (linear rgb). Each scheme's four colours differ in lightness as well as hue, so they hold up
 * for the common kinds of colour blindness.
 */
export const TEAM_SCHEMES = Object.freeze({
    standard: { name: "Coral, teal, gold, violet", colors: [[0.98, 0.36, 0.26], [0.12, 0.72, 0.68], [0.98, 0.78, 0.18], [0.55, 0.36, 0.92]] },
    safe: { name: "Colour-blind safe", colors: [[0.9, 0.6, 0.0], [0.34, 0.71, 0.91], [0.94, 0.89, 0.26], [0.8, 0.47, 0.65]] },
});
export const TEAM_NAMES = ["Coral", "Teal", "Gold", "Violet"];
export const teamColors = { scheme: "standard" };
export function teamColor(team) {
    const s = TEAM_SCHEMES[teamColors.scheme] || TEAM_SCHEMES.standard;
    return s.colors[((team | 0) + 4) % 4];
}
export const cssColor = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
