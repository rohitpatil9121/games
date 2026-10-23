/**
 * PAPER PLANES: every number the game is tuned by. No logic here.
 *
 * Distances are metres, times are seconds unless a name says "ticks". Z is up. The simulation runs at 60 Hz.
 * Rooms are real size (a bedroom is 5 m across) and the plane is small (10 cm, a palm-sized dart). Speeds are
 * much slower than a real paper plane's, which crosses a bedroom in a second and can't turn inside it; gravity
 * is scaled down with them, which is the same as flying a real plane in slow motion (NOTES.md, stage 1).
 * @module game/data
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Input button bits, as sent on the wire. */
export const BTN = Object.freeze({
    flap: 1,
    /** Ring Run: start the set again from the launch spot */
    restart: 2,
});

/** Things every fold shares. */
export const FLIGHT = Object.freeze({
    /** the slowed-down gravity: 0.95 m/s², so a dive builds speed over about a second, not a fifth of one */
    gravity: 0.95,
    /** bank limit, and how fast the plane rolls toward the bank it is asked for (radians, radians/s) */
    maxRoll: 1.05,
    /** pitch (flight path angle) limits and rate */
    maxPitch: 1.2,
    pitchRate: 1.9,
    /** with no pitch input the nose eases back to the glide angle at this rate (the steering assist) */
    trimRate: 1.4,
    /** extra drag at full bank, as a fraction: turning costs energy */
    bankDrag: 0.45,
    /** flap boost: forward speed and an upward bump that fades */
    flapSpeed: 0.45,
    flapLift: 0.28,
    flapLiftFade: 3.5,
    /** a flap pressed this many ticks before it's ready still fires when it is */
    flapBuffer: 8,
    /** stall: once in, the plane stays stalled until it is this much over its stall speed */
    stallExit: 1.18,
    /** how hard the nose drops in a stall (radians/s at zero speed) and the wobble it brings */
    stallDrop: 4.2,
    stallWobble: 0.9,
    /** the plane is a sphere this big for collisions (wings flex, so it's a little smaller than the span) */
    radius: 0.035,
    /** hitting a surface faster than this along its normal, steeper than crumpleAngle, crumples the plane */
    crumpleSpeed: 0.62,
    crumpleAngle: 0.61,
    /** a glancing hit keeps this much speed and slides; the normal part bounces back by `bounce` */
    glanceKeep: 0.7,
    bounce: 0.25,
    /** slower than this into a surface only scrapes along it, keeping `scrapeKeep` of the speed per tick */
    scrapeSpeed: 0.15,
    scrapeKeep: 0.985,
    /** crumpled: flutter down this fast, refold after this long at the nearest launch spot */
    crumpleFall: 0.3,
    refoldTime: 2.0,
    /** after refolding, can't be tagged for this long (GDD §2b) */
    refoldGuard: 1.5,
    /** a plane is never slower than this through the air (it falls instead) */
    minSpeed: 0.18,
});

/**
 * The three folds (GDD §2a). Speeds are airspeed, m/s. `glide` is distance per height lost at cruise; drag is
 * derived from it so that gliding at that angle holds cruise speed exactly. `turn` is the turn rate at full
 * bank and cruise speed, degrees per second. `wind`, `thermal` and `turbulence` scale how the air moves it.
 */
export const FOLDS = Object.freeze({
    dart: Object.freeze({ name: "Dart", cruise: 1.2, max: 2.3, glide: 4, stall: 0.675, turn: 150, flap: 3.2, wind: 0.6, thermal: 0.8, turbulence: 0.7, roll: 4.5 }),
    glider: Object.freeze({ name: "Glider", cruise: 0.8, max: 1.7, glide: 9, stall: 0.4, turn: 130, flap: 3.6, wind: 1.3, thermal: 1.4, turbulence: 1.0, roll: 3.2 }),
    stunt: Object.freeze({ name: "Stunt", cruise: 1, max: 1.95, glide: 6, stall: 0.525, turn: 220, flap: 2.4, wind: 1.0, thermal: 1.0, turbulence: 1.6, roll: 6.0 }),
});
export const FOLD_IDS = Object.freeze(["dart", "glider", "stunt"]);

/** The air everywhere (sources carry their own numbers in the room files). */
export const AIR = Object.freeze({
    /** gentle turbulence: amplitude (m/s), lattice size (m), how fast it drifts (m/s) */
    turbulence: 0.11,
    turbulenceScale: 0.5,
    turbulenceDrift: 0.18,
    /** behind a fan the air churns this many times harder */
    fanChurn: 3,
});

/** A room: who fits, and the modes it can run. */
export const MATCH = Object.freeze({
    maxPlayers: 8,
    modes: Object.freeze(["rings", "tag", "spread"]),
    /** results stay up this long before the next round */
    intermission: 12,
});

/**
 * Tag (GDD §2 and §2b). `reach` is how close (centre to centre) "it" must get; "it" recharges its flap faster
 * (`itFlap` of the time). The first "it" is picked after `grace` seconds of flying; nobody can tag back the
 * plane that just tagged them for `noTagBack` seconds. Classic rounds are `classic` seconds, Ink Spread
 * `spread`. Erasers: `slots` out at once on the room's eraser spots, picked up within `radius`, back
 * `respawn` seconds after; one takes `minus` seconds off your time as "it" (Classic) or blocks one tag
 * (Ink Spread).
 */
export const TAG = Object.freeze({
    reach: 0.15,
    itFlap: 0.75,
    grace: 3,
    noTagBack: 3,
    classic: 240,
    spread: 180,
    /** a tag knocks the two planes apart a little */
    knock: 0.35,
    eraser: Object.freeze({ slots: 3, radius: 0.09, respawn: 20, minus: 4 }),
});

/**
 * Lag compensation for tags: positions remembered for HISTORY ticks, a tag reaches back at most MAX_REWIND.
 * 20 ticks is 200 ms of ping on top of the interpolation delay (5 to 8 ticks). The brief said 200 ms in
 * all, as BREACH; with a 15 cm reach that let only 68% of the tags a 150 ms player saw count (NOTES.md,
 * stage 4), against 86% with this.
 */
export const HISTORY = 32;
export const MAX_REWIND = 20;
