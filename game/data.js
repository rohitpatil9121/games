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
    /**
     * per second while rising in lift (stage 5: climbing used to be free, which let the first glider reach
     * every island; now a long climb costs something and the glider tiers matter, tools/check-world.mjs)
     */
    liftDrain: 0.6,
    /** the High Rocks are cold: above this height (m) stamina drains this many times faster */
    coldAbove: 400, cold: 1.8,
    /** below this height (the warm, low Meadow) climbing in lift is still free: the first glides stay gentle */
    freeClimbBelow: 150,
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
 *   band      where its seeds are found;  grows: the bands whose gardens it grows in (high crops need the cold)
 *   needs     "night": grows only at night · "rain": its last third grows only in rain · "rain-or-night"
 *   regrow    after a harvest the plant goes back to this growth instead of being cleared (bushes, fruit trees)
 *   flower    a flowering plant of this hue: what pollinator sprites look for (GDD §2)
 *   fragile   lost, not washed up, if you fall into the clouds carrying it
 *   yield/value per harvest and per unit (merchant coins, stage 5)
 */
const crop = (o) => Object.freeze({ stages: [0.2, 0.5, 1], needs: "", regrow: 0, flower: "", fragile: false, ...o });
export const CROPS = Object.freeze({
    // tuned by tools/economy.mjs (stage 4) to about 12 coins per plot-day each; fragile goods are worth more per
    // unit (the greed of gliding them home), not more per plot
    turnip: crop({ name: "Turnip", band: "meadow", grows: ["meadow", "orchard"], days: 1, yield: 2, value: 4.5 }),
    ropegrass: crop({ name: "Rope-grass", band: "meadow", grows: ["meadow", "orchard", "high"], days: 2, yield: 3, value: 6, stages: [0.15, 0.5, 1] }),
    sunflower: crop({ name: "Sunflower", band: "meadow", grows: ["meadow", "orchard"], days: 2, yield: 2, value: 8, flower: "yellow" }),
    moonbean: crop({ name: "Moon-bean", band: "meadow", grows: ["meadow"], days: 0.3, yield: 3, value: 8, needs: "night", flower: "blue" }),
    berry: crop({ name: "Berry bush", band: "orchard", grows: ["meadow", "orchard"], days: 2.5, yield: 2, value: 8, regrow: 0.35, flower: "pink" }),
    skypine: crop({ name: "Sky pine", band: "orchard", grows: ["meadow", "orchard", "high"], days: 4, yield: 6, value: 6, stages: [0.12, 0.45, 1] }),
    cotton: crop({ name: "Cloud-cotton", band: "orchard", grows: ["orchard"], days: 3, yield: 3, value: 16, needs: "rain", flower: "white" }),
    apple: crop({ name: "Apple tree", band: "orchard", grows: ["meadow", "orchard"], days: 4, yield: 5, value: 4.5, regrow: 0.5, fragile: true, stages: [0.12, 0.45, 1], flower: "white" }),
    frostmint: crop({ name: "Frost-mint", band: "high", grows: ["high"], days: 2, yield: 3, value: 7 }),
    starlily: crop({ name: "Star-lily", band: "high", grows: ["high"], days: 1.5, yield: 1, value: 60, needs: "rain-or-night", fragile: true, flower: "white" }),
    stormbloom: crop({ name: "Storm-bloom", band: "high", grows: ["high"], days: 1, yield: 1, value: 40, flower: "violet" }),
});
export const CROP_IDS = Object.freeze(Object.keys(CROPS));

/**
 * Pollinator sprites (GDD §2): a garden's flowering plants form a cluster when 3 or more of at least 2 hues
 * stand within `cluster` m of each other. Sprites seek clusters within `seek` m, hover there, and every crop
 * within `reach` m of a hovering sprite is pollinated for the day: its next harvest yields `boost` times as much.
 */
export const SPRITES = Object.freeze({ cluster: 5, minFlowers: 3, minHues: 2, seek: 45, reach: 6, boost: 1.5, speed: 2.2, perCluster: 2, max: 12 });

/** Meals (GDD §2): cooked at the hut's stove from the pouch; each adds to today's stamina (up to `maxBonus` s). */
export const RECIPES = Object.freeze([
    Object.freeze({ id: "mint-tea", name: "Frost-mint tea", needs: { frostmint: 2 }, stamina: 40 }),
    Object.freeze({ id: "berry-tart", name: "Berry tart", needs: { berry: 3, apple: 1 }, stamina: 30 }),
    Object.freeze({ id: "turnip-soup", name: "Turnip soup", needs: { turnip: 2 }, stamina: 15 }),
]);
export const MEALS = Object.freeze({ maxBonus: 60 });

/**
 * Progression (GDD §4): what bridges, trade and upgrades cost and give.
 *   prices     what Captain Bram pays (each crop's `value`) and asks: fittings and planks
 *   rope       a bridge's rope comes from rope-grass (1 each) and cloud-cotton (2 each, strong rope)
 *   build      ticks a bridge takes to go up once paid for (planks laid one by one)
 *   upgrades   the glider tiers, in order, and the material each needs (at the shed's workbench)
 */
export const TRADE = Object.freeze({ fittings: 8, planks: 5 });
export const ROPE = Object.freeze({ ropegrass: 1, cotton: 2 });
export const BUILD = Object.freeze({ ticks: 240, reach: 2.4 });
export const UPGRADES = Object.freeze([
    Object.freeze({ tier: 0, glide: 9, stamina: 60 }),
    Object.freeze({ tier: 1, glide: 11, stamina: 90, needs: "skysilk", name: "Sky-silk canopy" }),
    Object.freeze({ tier: 2, glide: 13, stamina: 120, needs: "frostglass", name: "Frost-glass spars" }),
]);
/** the gust boost (storm-amber): a push of airspeed for some stamina */
export const BOOST = Object.freeze({ speed: 6, stamina: 8, needs: "stormamber" });
/** the merchant's airship: every `every` days from day `first`, it arrives, moors and leaves at these fractions of the day */
export const MERCHANT_TIMES = Object.freeze({ every: 2, first: 2, arrive: 0.12, moor: 0.18, leave: 0.58, gone: 0.66 });

/** Weather per day (GDD §11), seeded: chances, and when in the day the rain falls */
export const WEATHER = Object.freeze({
    chance: { clear: 0.45, breezy: 0.3, rain: 0.18, storm: 0.07 },
    /** no storms before this day */
    stormFrom: 4,
    /** rain falls between these fractions of the day (a seeded window inside them) */
    rainWindow: [0.15, 0.85], rainLength: [0.25, 0.45],
    /** crops grow this much faster while it rains (and rain waters them) */
    rainGrowth: 1.5,
});
