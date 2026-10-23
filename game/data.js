/**
 * SKYFARM: every number the game is tuned by. No logic here (GDD.md says why each one is what it is).
 *
 * Distances are metres, times are seconds unless a name says "ticks". Z is up. The simulation runs at 60 Hz.
 * The cloud sea's surface is z = 0.
 * @module game/data
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Input button bits. */
export const BTN = Object.freeze({
    jump: 1,
    sprint: 2,
    interact: 4,
    /** next seed in the pouch */
    cycle: 8,
});

/** On foot (adapted from TIDEFALL's MOVE). */
export const MOVE = Object.freeze({
    radius: 0.35,
    height: 1.7,
    eye: 1.5,
    walk: 4.2,
    run: 6.5,
    accel: 14,
    friction: 9,
    stopSpeed: 2,
    /** steering in the air before the glider opens */
    airSpeed: 3,
    airAccel: 5,
    gravity: 22,
    /** 7 m/s against 22 m/s² is a 1.1 m jump */
    jump: 7,
    /** tallest rise walked up without jumping */
    step: 0.45,
    maxFall: 40,
    /** ticks after leaving the ground that a jump still counts, and ticks an early jump is remembered */
    coyote: 7,
    jumpBuffer: 7,
});

/**
 * The glider: PAPER PLANES' flight model (game/sim.js stepPlane there) at person size and real gravity.
 * `glide` is distance per height lost at cruise; drag is derived from it so gliding at that angle holds cruise
 * speed exactly, as in PAPER PLANES.
 */
export const GLIDE = Object.freeze({
    gravity: 9.81,
    cruise: 11,
    stall: 7,
    max: 24,
    glide: 9,
    /** heading change at full bank and cruise speed, degrees per second */
    turn: 60,
    maxRoll: 0.7,
    /** radians per second the glider rolls toward the bank asked for */
    rollRate: 1.8,
    maxPitch: 0.9,
    pitchRate: 1.0,
    /** with no pitch input the nose eases back to the glide angle (the steering assist) */
    trimRate: 0.8,
    bankDrag: 0.35,
    stallExit: 1.15,
    stallDrop: 1.6,
    stallWobble: 0.5,
    /** never slower than this through the air (it sinks instead) */
    minSpeed: 4,
    /** how long you must have been in the air before jump opens the glider (a jump on the spot doesn't) */
    openAfter: 0.15,
    /** airspeed the canopy starts with when it opens (a little over the stall) */
    openSpeed: 9,
    /** how much of the wind carries the glider, and how much of a thermal's rise it gets */
    wind: 1,
    thermal: 1,
    /** sideways air rolls the wings this much (turbulence felt as wobble) */
    turbulence: 0.7,
    /** landing harder than this (m/s down) is a roll, not a step */
    hardLanding: 7,
    /** a bump into a cliff keeps this much airspeed */
    bumpKeep: 0.45,
});

/** Stamina while gliding (GDD §2). */
export const STAMINA = Object.freeze({
    max: 60,
    /** per second gliding in still or sinking air */
    drain: 1,
    /** rising faster than this (m/s) in lift costs nothing */
    freeRise: 0.3,
    /** seconds on the ground to refill completely */
    refill: 4,
    /** out of stamina: the canopy folds into a slow drift */
    driftSink: 2.5,
    driftSpeed: 5,
});

/** The world below. */
export const SKY = Object.freeze({
    /** the cloud sea's top */
    cloudTop: 0,
    /** this far into the clouds you've fallen: wake up at home */
    fallZ: -25,
});

/** One day (GDD §11). `t` is the fraction of the day: 0 is sunrise. */
export const DAY = Object.freeze({
    seconds: 1200,
    /** fractions of the day where each part begins */
    dawnEnd: 1.5 / 20,
    golden: 14.5 / 20,
    blue: 17 / 20,
    night: 18 / 20,
});
export const DAY_TICKS = DAY.seconds * TICK_RATE;

/** Farming. */
export const FARM = Object.freeze({
    /** plots are 1 m tiles on a grid aligned to the world axes */
    tile: 1,
    /** how far in front of the feet the tile you act on is */
    reach: 1.1,
    /** how close an item must be to pick it up */
    pickRadius: 1.6,
    /** an action pressed this many ticks early still happens (input buffering) */
    actBuffer: 9,
    /** ticks between two actions, so holding the key works through a row at a calm pace */
    actCooldown: 16,
});

/**
 * Crops (GDD §4). `days` is in-game days of watered growth to ripe; `stages` are the growth fractions where the
 * plant changes look (sprout, leafy, ripe). Unwatered crops pause, never die.
 */
export const CROPS = Object.freeze({
    turnip: Object.freeze({ name: "Turnip", days: 1, yield: 2, value: 6, stages: [0.2, 0.5, 1], fragile: false }),
    ropegrass: Object.freeze({ name: "Rope-grass", days: 2, yield: 3, value: 4, stages: [0.15, 0.5, 1], fragile: false }),
});
export const CROP_IDS = Object.freeze(Object.keys(CROPS));
