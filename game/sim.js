import { TICK_RATE, DT, BTN, MOVE, GLIDE, STAMINA, SKY, DAY_TICKS, FARM, CROPS, CROP_IDS } from "./data.js";
import { grow, farmDawn, weatherOf, harvestOf, afterHarvest, growsIn, cook, cookable, stepSprites } from "./farm.js";
import { makeProgress, activeAir, restore, deckBelow, overRail, bridgeEndNear, missingFor, startBridge, stepBridges, heartNear, merchantAt, upgradeAvailable, applyUpgrade } from "./progression.js";
import { BOOST } from "./data.js";
import { dsin, dcos, datan2, clamp, PI, TAU, yawOf } from "./det.js";
import { sample, makeAir } from "./air.js";
import { topAt, groundBelow, solidAt, boxAt, islandUnder, gardenAt } from "./islands.js";

/**
 * SKYFARM: the simulation. Pure and deterministic: no DOM, no Math.sin, no clock (TIDEFALL's rule), so the
 * Node tools, the tests and later co-op all run the same code and get the same farm.
 *
 * The player is on foot or gliding.
 * - On foot: TIDEFALL's ground movement (acceleration and friction toward a wished velocity from the view yaw),
 *   a jump with coyote time and an input buffer, a step-up, and walking off an edge.
 * - Gliding: PAPER PLANES' flight model (sim.js stepPlane there) at person scale: heading, flight-path angle,
 *   bank and airspeed; gravity along the path trades height for speed; drag k·v² with k chosen so the glide
 *   angle holds cruise speed; bank turns and costs energy; a stall drops the nose. The air carries the glider
 *   (ground velocity = airspeed along the nose + the wind), so thermals lift it and currents carry it.
 * - Stamina drains while gliding in air that isn't lifting you; at zero the canopy folds into a slow drift.
 * - Falling into the cloud sea is never a fail: you wake up at home. Seeds stay in the pouch; carried produce
 *   washes up on the shore next morning, and fragile things are lost.
 *
 * The farm: 1 m plots; one context action does the right thing for the tile in front of you (till, plant,
 * water, harvest), or picks up what you're next to, or sleeps if you're at the bed. Watered crops grow by
 * in-game days; at dawn every plot dries out again.
 * @module game/sim
 */

/** @typedef {{ mx: number, my: number, yaw: number, buttons: number }} PlayerInput (mx/my −127..127, yaw 16 bits) */
export const NO_INPUT = Object.freeze({ mx: 0, my: 0, yaw: 0, buttons: 0 });

/** the flight-path angle the glider holds: tan = 1 / glide ratio */
/** the glide angle and drag constant for a glide ratio (upgrades raise the ratio, GDD §4) */
const glideAngle = (ratio) => datan2(1, ratio);
const dragK = (ratio) => (GLIDE.gravity * (1 / Math.sqrt(1 + ratio * ratio))) / (GLIDE.cruise * GLIDE.cruise);
const OPEN_TICKS = Math.round(GLIDE.openAfter * TICK_RATE);
const wrap = (a) => (a > PI ? a - TAU : a < -PI ? a + TAU : a);
const air = makeAir();

/**
 * A new game in a world (islands.js makeWorld).
 * @param {ReturnType<import("./islands.js").makeWorld>} world
 * @param {{ startT?: number }} [options] startT: fraction of the first day already gone (0 is sunrise)
 */
export function createState(world, options = {}) {
    const d = world.data;
    const state = {
        world,
        /** the world's seed: the weather of every day comes from it */
        seed: options.seed ?? d.seed ?? 1,
        rng: (options.seed ?? d.seed ?? 1) >>> 0,
        tick: Math.round((options.startT ?? 0.03) * DAY_TICKS),
        /** pollinator sprites, and the flower clusters they look for (farm.js) */
        sprites: [], nextSprite: 1, clusters: [],
        player: createPlayer(),
        /** plots by "ix,iy" */
        plots: new Map(),
        items: d.items.map((it, i) => {
            const isl = islandUnder(world, it.x, it.y) || world.islands[0];
            return { id: i + 1, ...it, z: topAt(isl, it.x, it.y) + it.z, taken: false };
        }),
        pouch: { seeds: Object.fromEntries(CROP_IDS.map((c) => [c, 0])), crops: Object.fromEntries(CROP_IDS.map((c) => [c, 0])), selected: "",
            /** bought and found things that aren't crops: bridge parts and the glider's rare materials */
            materials: { planks: 0, fittings: 0, skysilk: 0, frostglass: 0, stormamber: 0 } },
        /** bridges, restored islands, coins, the glider's tier (progression.js) */
        progress: makeProgress(world),
        /** produce lost in the clouds, waiting to wash up at dawn */
        washed: [],
        /** what happened this tick: { type, ... } */
        events: [],
        nextItem: d.items.length + 1,
    };
    for (const [ix, iy] of d.tilled) state.plots.set(ix + "," + iy, makePlot(world, ix, iy));
    state.weather = weatherOf(state.seed, dayNumber(state));
    /** the air that blows: the gates' updrafts only once their islands are restored */
    state.air = activeAir(world, state.progress.restored);
    wake(state);
    return state;
}

/**
 * growth 0..1; days: days of growth credited at dawn; grew: it grew at all today; pollinated: its next harvest
 * is bigger; island and band: where it is (what may grow in it); z: the ground's height there
 */
function makePlot(world, ix, iy) {
    const g = gardenAt(world, ix, iy), isl = world.byId[g ? g.island : world.islands[0].id];
    return { ix, iy, island: isl.id, band: isl.band, z: topAt(isl, ix + 0.5, iy + 0.5), tilled: true, crop: "", growth: 0, watered: false, days: 0, grew: false, pollinated: false };
}

export function createPlayer() {
    return {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        /** "foot" | "glide"; drift is gliding with no stamina left */
        mode: "foot", drift: false,
        ground: true,
        /** ticks since the feet left the ground */
        air: 0,
        /** ticks since jump / the action were pressed (99 = not recently) */
        jumpAge: 99, actAge: 99, actCool: 0,
        held: 0,
        /** facing on the ground (unit vector) */
        fx: 1, fy: 0,
        /** the glider: heading, flight-path angle, bank, airspeed */
        yaw: 0, pitch: 0, roll: 0, speed: 0, stalled: false,
        hasGlider: false,
        stamina: STAMINA.max,
        /** the glider as upgraded: glide ratio and stamina (GDD §4: 9 → 11 → 13, 60 → 90 → 120 s) */
        glide: GLIDE.glide, staminaMax: STAMINA.max,
        /** strongest lift and current felt this tick (0..1), for effects */
        inLift: 0, inCurrent: 0,
        /** the tile the context action would act on, and what it would do */
        tx: 0, ty: 0, does: "",
    };
}

/** time of day as a fraction (0 sunrise) and the day number (1 = the first) */
export const dayT = (state) => (state.tick % DAY_TICKS) / DAY_TICKS;
export const dayNumber = (state) => Math.floor(state.tick / DAY_TICKS) + 1;

/** Put the player in bed. */
function wake(state) {
    const p = state.player, w = state.world.data.wake, home = state.world.islands[0];
    p.x = w.x; p.y = w.y; p.z = topAt(home, w.x, w.y);
    p.vx = p.vy = p.vz = 0; p.mode = "foot"; p.drift = false; p.ground = true; p.air = 0;
    p.fx = dcos(w.yaw); p.fy = dsin(w.yaw); p.stamina = staminaCap(p);
}

/** Advance the whole game one tick. */
export function step(state, input = NO_INPUT) {
    state.events.length = 0;
    const before = Math.floor(state.tick / DAY_TICKS);
    state.tick++;
    if (Math.floor(state.tick / DAY_TICKS) !== before) newDay(state);
    grow(state, 1);
    stepPlayer(state, state.player, input);
    stepSprites(state);
    stepBridges(state);
    return state;
}

/** the stamina the glider has today: the glider's own, plus today's meal */
export const staminaCap = (p) => p.staminaMax + (p.meal || 0);

/** Dawn: the farm's day turns over (farm.js), and whatever the clouds took washes up on the home shore. */
function newDay(state) {
    farmDawn(state);
    const home = state.world.islands[0];
    let k = 0;
    for (const w of state.washed) {
        // along the east shore, a little in from the rim
        const a = -0.5 + k * 0.22, r = home.radius * 0.78, x = home.x + dcos(a) * r, y = home.y + dsin(a) * r;
        state.items.push({ id: state.nextItem++, kind: "crop", crop: w.crop, count: w.count, x, y, z: topAt(home, x, y) + 0.3, taken: false, washed: true });
        k++;
    }
    state.washed.length = 0;
    state.events.push({ type: "dawn", day: dayNumber(state) });
}

/** Sleep: skip to the next dawn, the crops growing as if the time had passed. */
export function sleep(state) {
    const left = DAY_TICKS - (state.tick % DAY_TICKS);
    grow(state, left);
    state.tick += left;
    newDay(state);
    wake(state);
    state.events.push({ type: "slept" });
}

// ------------------------------------------------------------------ the player

function stepPlayer(state, p, input) {
    const pressed = input.buttons & ~p.held;
    p.held = input.buttons;
    if (pressed & BTN.jump) p.jumpAge = 0; else if (p.jumpAge < 99) p.jumpAge++;
    if (pressed & BTN.interact) p.actAge = 0; else if (p.actAge < 99) p.actAge++;
    if (p.actCool > 0) p.actCool--;
    // holding the action works through a row at a calm pace
    if ((input.buttons & BTN.interact) && p.actCool === 0 && p.actAge > FARM.actBuffer) p.actAge = 0;
    if (pressed & BTN.cycle) cycleSeed(state);

    if (p.mode === "glide") stepGlide(state, p, input, pressed);
    else stepFoot(state, p, input, pressed);

    if (p.z < SKY.fallZ) fell(state, p);
    if (p.mode === "foot") aim(state, p);
    else p.does = "";
    // after acting, aim again: what the next press would do has changed
    if (p.mode === "foot" && p.actAge <= FARM.actBuffer && p.actCool === 0) { act(state, p); if (p.mode === "foot") aim(state, p); }
}

function stepFoot(state, p, input, pressed) {
    const world = state.world;
    const yaw = yawOf(input.yaw & 0xffff), fx = dcos(yaw), fy = dsin(yaw);
    const mx = clamp(input.mx | 0, -127, 127) / 127, my = clamp(input.my | 0, -127, 127) / 127;
    let wx = fx * my + fy * mx, wy = fy * my - fx * mx;
    let wish = Math.sqrt(wx * wx + wy * wy);
    if (wish > 1e-6) { wx /= wish; wy /= wish; if (wish > 1) wish = 1; } else { wx = wy = 0; wish = 0; }
    if (wish > 0.2) { p.fx = wx; p.fy = wy; }

    const top = (input.buttons & BTN.sprint) ? MOVE.run : MOVE.walk;
    let wishSpeed = wish * top;
    const canJump = (p.ground || p.air <= MOVE.coyote) && p.jumpAge <= MOVE.jumpBuffer && p.vz <= 0.5;
    if (p.ground && !canJump) {
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 1e-4) {
            const k = Math.max(0, speed - Math.max(speed, MOVE.stopSpeed) * MOVE.friction * DT) / speed;
            p.vx *= k; p.vy *= k;
        } else { p.vx = 0; p.vy = 0; }
    }
    let accel = MOVE.accel;
    if (!p.ground) { accel = MOVE.airAccel; if (wishSpeed > MOVE.airSpeed) wishSpeed = Math.max(MOVE.airSpeed, Math.min(wishSpeed, Math.sqrt(p.vx * p.vx + p.vy * p.vy))); }
    const along = p.vx * wx + p.vy * wy, add = wishSpeed - along;
    if (add > 0) { const gain = Math.min(add, accel * DT * Math.max(wishSpeed, 2)); p.vx += wx * gain; p.vy += wy * gain; }
    if (canJump) {
        p.vz = MOVE.jump; p.ground = false; p.air = MOVE.coyote + 1; p.jumpAge = 99;
        state.events.push({ type: "jump" });
    } else if (!p.ground && p.hasGlider && (pressed & BTN.jump) && p.air >= OPEN_TICKS) {
        openGlider(state, p);
        return;
    }

    // across: boxes and rock walls stop each axis on its own, so you slide along them
    const nx = p.x + p.vx * DT;
    if (blockedAt(world, nx, p.y, p.z) || overRail(state, p.x, p.y, nx, p.y, p.z)) p.vx = 0; else p.x = nx;
    const ny = p.y + p.vy * DT;
    if (blockedAt(world, p.x, ny, p.z) || overRail(state, p.x, p.y, p.x, ny, p.z)) p.vy = 0; else p.y = ny;

    // up and down
    if (!p.ground) p.vz = Math.max(-MOVE.maxFall, p.vz - MOVE.gravity * DT);
    const wasGround = p.ground, fallSpeed = -p.vz;
    let z = p.z + p.vz * DT;
    if (p.vz > 0) {
        const roof = boxAt(world, p.x, p.y, z, MOVE.radius * 0.7);
        if (roof) { z = p.z; p.vz = 0; }
    }
    // the ground, or a bridge's deck
    const g = Math.max(groundBelow(world, p.x, p.y, Math.max(z, p.z)), deckBelow(state, p.x, p.y, Math.max(z, p.z), MOVE.step));
    if (z <= g) {
        z = g; p.vz = 0; p.ground = true;
        if (!wasGround) state.events.push({ type: "land", hard: fallSpeed > GLIDE.hardLanding, speed: fallSpeed });
    } else if (wasGround && p.vz <= 0 && p.z - g <= MOVE.step + 0.05) {
        // walking downhill: keep the feet on the ground
        z = g; p.vz = 0;
    } else p.ground = false;
    p.z = z;
    p.air = p.ground ? 0 : Math.min(9999, p.air + 1);
    if (p.ground) p.stamina = Math.min(staminaCap(p), p.stamina + (staminaCap(p) / STAMINA.refill) * DT);
}

/** a wall box, or rock above the step height, in the way of a body standing at (x, y, z) */
function blockedAt(world, x, y, z) {
    const b = boxAt(world, x, y, z, MOVE.radius);
    if (b && b.z1 > z + MOVE.step) return true;
    return !!solidAt(world, x, y, z + MOVE.step + 0.05) || !!solidAt(world, x, y, z + MOVE.height * 0.9);
}

function openGlider(state, p) {
    const hs = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    p.mode = "glide"; p.drift = p.stamina <= 0; p.ground = false;
    // the heading is where you were moving, or where you face
    p.yaw = hs > 0.5 ? datan2(p.vy, p.vx) : datan2(p.fy, p.fx);
    p.speed = Math.max(GLIDE.openSpeed, hs);
    p.pitch = -glideAngle(p.glide) * 2; p.roll = 0; p.stalled = false;
    state.events.push({ type: "open" });
}

function closeGlider(state, p, why) {
    p.mode = "foot"; p.drift = false; p.air = MOVE.coyote + 1;
    state.events.push({ type: "close", why });
}

function stepGlide(state, p, input, pressed) {
    const world = state.world;
    if (pressed & BTN.jump) {
        // let go: fall with the glider's velocity
        closeGlider(state, p, "let go");
        return;
    }
    // the gust boost (storm-amber): run is "boost" in the air
    if ((pressed & BTN.sprint) && state.progress.boost && !p.drift && p.stamina >= BOOST.stamina) {
        p.speed = Math.min(GLIDE.max, p.speed + BOOST.speed); p.stamina -= BOOST.stamina;
        state.events.push({ type: "boost" });
    }
    // ---- steering: stick right banks right, stick forward dives
    const wantRoll = (clamp(input.mx | 0, -127, 127) / 127) * GLIDE.maxRoll;
    const dr = wantRoll - p.roll, maxDr = GLIDE.rollRate * DT;
    p.roll += dr > maxDr ? maxDr : dr < -maxDr ? -maxDr : dr;
    const ip = -clamp(input.my | 0, -127, 127) / 127, trim = -glideAngle(p.glide);
    if (p.drift) {
        // no stamina: the canopy is a parachute, steering only
        p.pitch = trim;
        p.speed += (STAMINA.driftSpeed - p.speed) * 2 * DT;
    } else {
        if (ip > 0.04 || ip < -0.04) {
            const authority = ip > 0 ? clamp(p.speed / GLIDE.cruise, 0.25, 1) : 1;
            p.pitch += ip * GLIDE.pitchRate * authority * DT;
        } else {
            const d = trim - p.pitch, m = GLIDE.trimRate * DT;
            p.pitch += d > m ? m : d < -m ? -m : d;
        }
        if (!p.stalled && p.speed < GLIDE.stall) { p.stalled = true; state.events.push({ type: "stall" }); }
        else if (p.stalled && p.speed > GLIDE.stall * GLIDE.stallExit) p.stalled = false;
        if (p.stalled) {
            const depth = clamp(1 - p.speed / (GLIDE.stall * GLIDE.stallExit), 0.3, 1);
            p.pitch -= GLIDE.stallDrop * depth * DT;
            p.roll += GLIDE.stallWobble * depth * dsin(state.tick * 0.3) * DT * 6;
        }
        p.pitch = clamp(p.pitch, -GLIDE.maxPitch, GLIDE.maxPitch);
    }
    p.roll = clamp(p.roll, -GLIDE.maxRoll * 1.3, GLIDE.maxRoll * 1.3);

    // ---- turning: right bank (roll > 0) turns right (yaw is counter-clockwise from +X)
    p.yaw = wrap(p.yaw - ((GLIDE.turn * PI) / 180) * (p.roll / GLIDE.maxRoll) * clamp(p.speed / GLIDE.cruise, 0.6, 1.3) * DT);

    // ---- energy
    const sp = dsin(p.pitch), cp = dcos(p.pitch), bank = p.roll < 0 ? -p.roll : p.roll;
    if (!p.drift) {
        const drag = dragK(p.glide) * p.speed * p.speed * (1 + GLIDE.bankDrag * (bank / GLIDE.maxRoll));
        p.speed = clamp(p.speed + (-GLIDE.gravity * sp - drag) * DT, GLIDE.minSpeed, GLIDE.max);
    }

    // ---- the air
    sample(state.air, state.tick * DT, p.x, p.y, p.z, air);
    p.inLift = air.lift; p.inCurrent = air.current;
    const cy = dcos(p.yaw), sy = dsin(p.yaw);
    const ax = air.x + air.tx, ay = air.y + air.ty;
    const wz = air.z > 0 ? air.z * GLIDE.thermal : air.z * GLIDE.wind;
    const vx = p.speed * cp * cy + ax * GLIDE.wind;
    const vy = p.speed * cp * sy + ay * GLIDE.wind;
    const vz = p.drift ? -STAMINA.driftSink + air.z * 0.6 : p.speed * sp + wz + air.tz * GLIDE.wind;
    p.roll -= (-ax * sy + ay * cy) * 0.05 * GLIDE.turbulence * DT * 6;

    // ---- stamina
    if (!p.drift) {
        const lift = air.z > STAMINA.freeRise;
        p.stamina -= (lift ? (p.z < STAMINA.freeClimbBelow ? 0 : STAMINA.liftDrain) : STAMINA.drain) * (p.z > STAMINA.coldAbove ? STAMINA.cold : 1) * DT;
        if (p.stamina <= 0) { p.stamina = 0; p.drift = true; state.events.push({ type: "tired" }); }
    }

    // ---- move, against rock and boxes
    const ox = p.x, oy = p.y, oz = p.z;
    const x = ox + vx * DT, y = oy + vy * DT, z = oz + vz * DT;
    p.vx = vx; p.vy = vy; p.vz = vz;
    const box = boxAt(world, x, y, z, MOVE.radius, 0.6);
    if (box) {
        if (oz >= box.z1 - 0.25 && box.kind !== "wall") return land(state, p, x, y, box.z1);
        return bump(state, p, ox, oy, oz, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    }
    // touching down on a bridge's deck, or an island's top
    const deck = deckBelow(state, x, y, oz, 0);
    if (deck > -Infinity && z <= deck && oz >= deck - 0.8) return land(state, p, x, y, deck);
    for (const isl of world.islands) {
        const t = topAt(isl, x, y);
        if (t !== -Infinity && z <= t && oz >= t - 0.8) return land(state, p, x, y, t);
    }
    const rock = solidAt(world, x, y, z) || solidAt(world, x, y, z + 0.6);
    if (rock) return bump(state, p, ox, oy, oz, rock.x, rock.y);
    p.x = x; p.y = y; p.z = z;
}

function land(state, p, x, y, z) {
    const down = -p.vz;
    p.x = x; p.y = y; p.z = z;
    // keep some of the glide as a run-out
    p.vx *= 0.45; p.vy *= 0.45; p.vz = 0;
    p.mode = "foot"; p.drift = false; p.ground = true; p.air = 0;
    const hs = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (hs > 0.3) { p.fx = p.vx / hs; p.fy = p.vy / hs; }
    state.events.push({ type: "land", hard: down > GLIDE.hardLanding, speed: down, glide: true });
}

/** a cliff or a wall: stay where you were, turn away from it, lose speed */
function bump(state, p, ox, oy, oz, cx, cy) {
    p.x = ox; p.y = oy; p.z = oz;
    let nx = ox - cx, ny = oy - cy;
    const n = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= n; ny /= n;
    // reflect the heading off the surface (its normal points away from the island's middle)
    const hx = dcos(p.yaw), hy = dsin(p.yaw), dot = hx * nx + hy * ny;
    if (dot < 0) p.yaw = datan2(hy - 2 * dot * ny, hx - 2 * dot * nx);
    p.speed = Math.max(GLIDE.minSpeed, p.speed * GLIDE.bumpKeep);
    p.roll = 0;
    p.x += nx * 0.3; p.y += ny * 0.3;
    state.events.push({ type: "bump" });
}

/** Into the cloud sea: wake at home. Seeds stay in the pouch; produce washes up tomorrow unless it's fragile. */
function fell(state, p) {
    const lost = [], washed = [];
    for (const c of CROP_IDS) {
        const n = state.pouch.crops[c];
        if (!n) continue;
        (CROPS[c].fragile ? lost : washed).push({ crop: c, count: n });
        state.pouch.crops[c] = 0;
    }
    state.washed.push(...washed);
    wake(state);
    state.events.push({ type: "fell", washed, lost });
}

// ------------------------------------------------------------------ the farm

function cycleSeed(state) {
    const pouch = state.pouch, have = CROP_IDS.filter((c) => pouch.seeds[c] > 0);
    if (!have.length) return;
    pouch.selected = have[(have.indexOf(pouch.selected) + 1) % have.length];
    state.events.push({ type: "cycle", crop: pouch.selected });
}

const key = (ix, iy) => ix + "," + iy;

/** What the context action would do now, and to which tile. Sets p.tx, p.ty, p.does. */
function aim(state, p) {
    p.does = "";
    const item = nearItem(state, p);
    if (item) { p.does = "pick"; p.item = item.id; return; }
    p.item = 0;
    const d = state.world.data, bed = d.bed;
    if (Math.hypot(p.x - bed.x, p.y - bed.y) < 1.4) { p.does = "sleep"; return; }
    if (Math.hypot(p.x - d.stove.x, p.y - d.stove.y) < 1.3) { p.does = cookable(state.pouch) ? "cook" : "stove"; return; }
    // the shed's workbench: upgrade the glider with a rare material
    if (Math.hypot(p.x - d.shed.x, p.y - d.shed.y) < 2.2 && upgradeAvailable(state)) { p.does = "upgrade"; return; }
    // Captain Bram, while the airship is moored
    if (d.merchant && merchantAt(state.tick).phase === "moored" && Math.hypot(p.x - d.merchant.gangway[0], p.y - d.merchant.gangway[1]) < 2.5) { p.does = "trade"; return; }
    // a heart stone to wake, or a broken bridge's end
    if (heartNear(state, p.x, p.y)) { p.does = "wake"; return; }
    const br = bridgeEndNear(state, p.x, p.y, p.z);
    if (br && state.progress.bridges[br.id].state === "broken") { p.does = Object.keys(missingFor(state, br)).length ? "bridge" : "build"; p.bridge = br.id; return; }
    const ix = Math.floor(p.x + p.fx * FARM.reach), iy = Math.floor(p.y + p.fy * FARM.reach);
    p.tx = ix; p.ty = iy;
    if (!p.ground || !gardenAt(state.world, ix, iy)) return;
    const plot = state.plots.get(key(ix, iy));
    if (plot && plot.crop && plot.growth >= 1) p.does = "harvest";
    else if (plot && plot.crop && !plot.watered) p.does = "water";
    else if (plot && plot.tilled && !plot.crop && state.pouch.seeds[state.pouch.selected] > 0) p.does = "plant";
    else if (!plot) p.does = "till";
}

function nearItem(state, p) {
    let best = null, bd = FARM.pickRadius;
    for (const it of state.items) {
        if (it.taken) continue;
        const dz = it.z - (p.z + 0.6);
        if (dz > 1.8 || dz < -1.8) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bd) { bd = d; best = it; }
    }
    return best;
}

function act(state, p) {
    const does = p.does;
    p.actAge = 99;
    if (!does) return;
    p.actCool = FARM.actCooldown;
    const pouch = state.pouch, ix = p.tx, iy = p.ty;
    if (does === "pick") {
        const it = state.items.find((i) => i.id === p.item);
        it.taken = true;
        if (it.kind === "seed") { pouch.seeds[it.crop] += it.count; if (!pouch.seeds[pouch.selected]) pouch.selected = it.crop; }
        else if (it.kind === "crop") pouch.crops[it.crop] += it.count;
        else if (it.kind === "material") pouch.materials[it.material] += it.count;
        else if (it.kind === "glider") p.hasGlider = true;
        state.events.push({ type: "pick", kind: it.kind, crop: it.crop || "", count: it.count || 1, x: it.x, y: it.y, z: it.z });
        return;
    }
    if (does === "sleep") {
        if (dayT(state) < 0.5) { state.events.push({ type: "not-tired" }); return; }
        sleep(state);
        return;
    }
    if (does === "upgrade") { applyUpgrade(state); return; }
    if (does === "trade") { state.events.push({ type: "trade-open" }); return; }
    if (does === "wake") { const h = heartNear(state, p.x, p.y); restore(state, h.island, "heart"); return; }
    if (does === "build" || does === "bridge") {
        const b = state.world.data.bridges.find((q) => q.id === p.bridge);
        if (does === "build") startBridge(state, b); else state.events.push({ type: "bridge-needs", bridge: b.id, missing: missingFor(state, b), cost: b.cost });
        return;
    }
    if (does === "cook") { const r = cook(state); state.events.push({ type: "cook", recipe: r.id, name: r.name, stamina: r.stamina }); return; }
    if (does === "stove") { state.events.push({ type: "cant-cook" }); return; }
    let plot = state.plots.get(key(ix, iy));
    if (does === "till") {
        plot = makePlot(state.world, ix, iy);
        state.plots.set(key(ix, iy), plot);
    } else if (does === "plant") {
        // high crops need the cold up high; some won't grow down low (GDD §2)
        if (!growsIn(pouch.selected, plot.band)) { state.events.push({ type: "wrong-band", crop: pouch.selected, band: plot.band, ix, iy }); return; }
        plot.crop = pouch.selected; plot.growth = 0; plot.watered = false; plot.days = 0; plot.grew = false; plot.pollinated = false; plot.rained = false;
        pouch.seeds[pouch.selected]--;
        if (!pouch.seeds[pouch.selected]) { const next = CROP_IDS.find((c) => pouch.seeds[c] > 0); pouch.selected = next || ""; }
    } else if (does === "water") {
        plot.watered = true;
    } else if (does === "harvest") {
        const h = harvestOf(plot), crop = plot.crop;
        pouch.crops[crop] += h.produce;
        pouch.seeds[crop] += h.seeds;
        if (!pouch.selected && h.seeds) pouch.selected = crop;
        state.events.push({ type: "harvest", crop, count: h.produce, seeds: h.seeds, pollinated: plot.pollinated, ix, iy });
        afterHarvest(plot);
        return;
    }
    state.events.push({ type: does, ix, iy, crop: plot.crop });
}

/** FNV-1a over everything that matters, for determinism tests. */
export function hashState(state) {
    let h = 0x811c9dc5;
    const mix = (v) => { const s = String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    const p = state.player;
    for (const v of [state.tick, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.mode, p.yaw, p.pitch, p.roll, p.speed, p.stamina]) mix(v);
    for (const plot of state.plots.values()) mix(plot.ix + plot.iy * 1000 + plot.crop + plot.growth + plot.watered);
    for (const c of CROP_IDS) mix(state.pouch.seeds[c] + "/" + state.pouch.crops[c]);
    for (const s of state.sprites) mix(s.x + "," + s.y);
    mix(state.progress.coins + "/" + state.progress.tier + "/" + [...state.progress.restored].join(","));
    return h >>> 0;
}
