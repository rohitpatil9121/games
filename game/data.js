/**
 * DECOY: every number the game is tuned by. No logic here.
 *
 * Distances are metres, times are seconds unless a name says "ticks". The simulation runs at 60 Hz.
 * The world is Z-up: x and y run across the ground, z is height.
 * @module game/data
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Input button bits, as sent on the wire. */
export const BTN = Object.freeze({
    jump: 1,
    crouch: 2,
    sprint: 4,
    /** seeker: the scanner. */
    fire: 8,
    /** hider: freeze the prop's rotation, squared to the nearest quarter turn */
    lock: 16,
    /** hider: make a noise on purpose (it scores) */
    taunt: 32,
    /** seeker: throw a ping grenade. hider: drop a decoy */
    ability: 64,
});

/** Who a player is this round. */
export const ROLE = Object.freeze({ none: 0, hider: 1, seeker: 2 });

export const MOVE = Object.freeze({
    /** a seeker is an upright box this wide (half-width); a hider takes the size of its prop */
    radius: 0.35,
    height: 1.8,
    crouchHeight: 1.15,
    eye: 1.62,
    crouchEye: 0.98,
    walk: 6.2,
    sprint: 8.2,
    crouch: 3.2,
    /** hiders are a little slower than seekers: a chase is lost by running alone */
    hiderWalk: 5.3,
    hiderSprint: 7.0,
    accel: 10,
    friction: 7,
    stopSpeed: 2.5,
    airSpeed: 1.1,
    airAccel: 8,
    gravity: 20,
    jump: 6.6,
    /** tallest ledge walked up without jumping */
    step: 0.36,
    maxFall: 45,
    killZ: -30,
});

export const PLAYER = Object.freeze({
    health: 100,
    /** a dead player watches as a ghost until the round ends */
});

/** Seeker hit shape: a box for the body and a sphere for the head, from the feet (seekers can be shot only by nothing: no friendly fire). */
export const HIT = Object.freeze({
    bodyHalf: 0.32,
    bodyTop: 1.42,
    crouchBodyTop: 0.84,
    headRadius: 0.21,
    headZ: 1.6,
    crouchHeadZ: 0.98,
});

/**
 * The seeker's one weapon. A hitscan beam that drains a battery: firing costs charge, charge comes back
 * after a short rest. Hitting a hider hurts the hider. Hitting a real prop (or a decoy) hurts the
 * *seeker*: wild spraying has a price.
 */
export const SCANNER = Object.freeze({
    /** ticks between shots while the trigger is held */
    interval: 8,
    damage: 17,
    /** what a seeker loses for shooting something that isn't a player */
    penalty: 10,
    range: 60,
    spread: 0.004,
    charge: 100,
    cost: 7,
    /** charge back per second, once the trigger has been let go for `rest` seconds */
    recharge: 22,
    rest: 0.6,
});

/** Ping grenades: thrown in an arc, burst where they land; every hider inside the radius squeaks and glows, for the thrower only. */
export const PING = Object.freeze({
    perRound: 2,
    speed: 13,
    up: 4,
    radius: 6.5,
    /** ticks after landing until it bursts */
    fuse: 30,
    /** seconds the outline lasts on the thrower's screen */
    reveal: 2.2,
    life: 300,
});

/** The decoy: a copy of the hider's prop that runs a few metres and then stands there, as a prop would. */
export const DECOY = Object.freeze({
    perRound: 1,
    distance: 4.5,
    speed: 5.3,
    /** the most decoys standing in one round (each hider gets one) */
    max: 16,
});

/** A prop can be looked at and taken from this far away (measured from the hider's middle to the prop's). */
export const DISGUISE = Object.freeze({
    reach: 4.5,
    /** ticks between changes */
    cooldown: 30,
    /** what every hider starts as */
    start: "box",
});

/**
 * Taunts. Every hider must make a noise every `interval` seconds (every `lateInterval` in the last
 * minute). Taunting earlier on purpose scores, more the nearer the closest seeker is, and resets the clock.
 */
export const TAUNT = Object.freeze({
    interval: 45,
    lateInterval: 20,
    /** a voluntary taunt can't come sooner than this after the last one */
    cooldown: 5,
    points: 5,
    /** extra points at 0 m from a seeker, falling to nothing at `near` metres */
    bravery: 10,
    near: 15,
    kinds: ["squeak", "honk", "jingle", "boing", "quack"],
});

export const ROUND = Object.freeze({
    /** seconds hiders have, seekers blindfolded */
    hide: 30,
    /** seconds of seeking (the round's 4 minutes include the hiding) */
    seek: 210,
    /** the last minute: louder, quicker, flickering */
    late: 60,
    /** seconds the result stays up before roles swap */
    end: 8,
    rounds: 4,
    /** seconds the match results stay up before a new match */
    over: 14,
    maxPlayers: 10,
    minPlayers: 2,
});

/** What things are worth. */
export const SCORE = Object.freeze({
    find: 25,
    /** every surviving hider, at the end of a round */
    survive: 30,
    /** a hider, per 10 s alive while seekers are seeking */
    alive: 1,
    roundWin: 10,
});

/**
 * Lag compensation: positions (and prop shapes) are remembered for HISTORY ticks; a shot can reach back
 * at most MAX_REWIND ticks (300 ms).
 */
export const HISTORY = 64;
export const MAX_REWIND = 18;
/** values per player per history tick: x, y, z, prop yaw, prop type, crouched */
export const HIST_STRIDE = 6;

/** Team colours (linear rgb). Each pair differs in lightness as well as hue (colour-blind safe). */
export const TEAM_SCHEMES = Object.freeze({
    "orange-blue": { name: "Orange and blue", 1: [0.98, 0.5, 0.14], 2: [0.18, 0.62, 0.98] },
    "yellow-purple": { name: "Yellow and purple", 1: [0.98, 0.84, 0.2], 2: [0.56, 0.3, 0.92] },
    "white-red": { name: "White and red", 1: [0.92, 0.92, 0.95], 2: [0.9, 0.16, 0.2] },
});
export const TEAM_NAMES = ["", "Foxes", "Owls"];
export const teamColors = { scheme: "orange-blue" };
/** @param {{ id: number, team: number }} info */
export function colorOf(info) {
    const scheme = TEAM_SCHEMES[teamColors.scheme] || TEAM_SCHEMES["orange-blue"];
    return scheme[info.team] || [0.8, 0.8, 0.85];
}
export const cssColor = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
