import { BTN, GLIDE } from "./data.js";
import { quantizeYaw, datan2, clamp, PI, TAU } from "./det.js";

/**
 * SKYFARM: a test pilot. It plays the game through the same input a person gives (stick, view yaw, buttons),
 * one plan step at a time, so the tools can measure the first loop (how long the glide takes, whether it lands
 * where it aims) and the browser can show it for screenshots. Pure: no DOM, deterministic.
 *
 * Plan steps:
 *   { walk: [x, y], r? }                walk until within r (0.5 m) of the point
 *   { act: "pick" | "plant" | ..., face?: [x, y], hold? }   face a point, press the action when it would do that
 *   { glide: [x, y], climb?: { at: [x, y], to: z } }     walk toward it, jump off the edge, open the glider, fly
 *                                        to it (first circling in the thermal at `at` up to height `to`), land
 *   { wait: ticks }
 *   { sleep: true }                       walk to the bed and sleep
 * @module game/pilot
 */

const wrap = (a) => (a > PI ? a - TAU : a < -PI ? a + TAU : a);

export function makePilot(plan) {
    return { plan, i: 0, t: 0, phase: "", log: [], done: false, stuckFor: 0, lastX: 0, lastY: 0, tick: 0 };
}

/**
 * The input for this tick.
 * @param {ReturnType<typeof makePilot>} pilot
 * @param {object} state the game (sim.js)
 */
export function pilotInput(pilot, state) {
    const p = state.player, out = { mx: 0, my: 0, yaw: 0, buttons: 0 };
    pilot.tick++;
    if (pilot.i >= pilot.plan.length) { pilot.done = true; return out; }
    const s = pilot.plan[pilot.i];
    pilot.t++;
    const next = (note) => { pilot.log.push({ step: pilot.i, tick: state.tick, note: note || Object.keys(s)[0], at: [p.x, p.y, p.z] }); pilot.i++; pilot.t = 0; pilot.phase = ""; };
    const toward = (x, y) => quantizeYaw(datan2(y - p.y, x - p.x));

    if (s.walk) {
        const [x, y] = s.walk, d = Math.hypot(x - p.x, y - p.y);
        if (d < (s.r || 0.5) && p.ground) return (next(), out);
        out.yaw = toward(x, y); out.my = d < 1.5 ? 70 : 127;
        if (s.run) out.buttons |= BTN.sprint;
        return out;
    }
    if (s.act) {
        if (s.face && pilot.t < 4) { out.yaw = toward(s.face[0], s.face[1]); out.my = 30; return out; }
        // last tick's events: did it happen?
        if (state.events.some((e) => e.type === s.act || (s.act === "sleep" && e.type === "slept"))) return (next(), out);
        // a step-in: nudge toward the face point until the action is the one wanted
        if (p.does === s.act) {
            if (pilot.t % 2 === 0) out.buttons |= BTN.interact;
            return out;
        }
        if (s.face) { out.yaw = toward(s.face[0], s.face[1]); out.my = pilot.t % 20 < 3 ? 40 : 0; }
        if (pilot.t > 600) next("gave up: " + s.act + " (does " + (p.does || "nothing") + ")");
        return out;
    }
    if (s.wait) { if (pilot.t >= s.wait) next(); return out; }
    if (s.glide) {
        const [x, y] = s.glide;
        if (p.mode === "foot" && p.ground) {
            if (pilot.phase === "flying") return (next(Math.hypot(x - p.x, y - p.y) < 25 ? "landed" : "landed short"), out);
            // run at the edge and jump off it (toward the thermal first, if there is one to climb)
            const run = s.climb && !pilot.climbed ? s.climb.at : s.glide;
            out.yaw = toward(run[0], run[1]); out.my = 127; out.buttons |= BTN.sprint;
            return out;
        }
        if (p.mode === "foot") {
            // in the air: open the canopy as soon as it can
            out.yaw = toward(x, y); out.my = 127;
            if (pilot.t % 2 === 0) out.buttons |= BTN.jump;
            pilot.phase = "flying";
            return out;
        }
        pilot.phase = "flying";
        let aim = datan2(y - p.y, x - p.x);
        const c = s.climb;
        if (c && !pilot.climbed) {
            const dx = c.at[0] - p.x, dy = c.at[1] - p.y, d = Math.hypot(dx, dy);
            if (p.z >= c.to) pilot.climbed = true;
            // fly to the thermal, then circle in it: aim a little to the side of its middle
            else aim = d > 8 ? datan2(dy, dx) : datan2(dy, dx) - 1.2;
        }
        const err = wrap(aim - p.yaw);
        // bank right (mx > 0) turns right (yaw decreasing): the error's sign is the other way round
        out.mx = Math.round(clamp(-err * 2.2, -1, 1) * 127);
        out.yaw = quantizeYaw(p.yaw);
        // too high to land from here: circle down over the target instead of diving at it
        const d = Math.hypot(x - p.x, y - p.y), above = p.z - (s.land ?? 60);
        if ((!c || pilot.climbed) && d < 60 && above > d / 7 + 4) {
            const e2 = wrap(datan2(y - p.y, x - p.x) - 1.3 - p.yaw);
            out.mx = Math.round(clamp(-e2 * 2.2, -1, 1) * 127);
        }
        return out;
    }
    if (s.sleep) {
        const bed = state.world.data.bed, d = Math.hypot(bed.x - p.x, bed.y - p.y);
        if (state.events.some((e) => e.type === "slept")) return (next(), out);
        if (d > 1.0) { out.yaw = toward(bed.x, bed.y); out.my = 90; return out; }
        if (pilot.t % 2 === 0) out.buttons |= BTN.interact;
        if (pilot.t > 300) next("gave up: sleep");
        return out;
    }
    next("unknown step");
    return out;
}

/** The first loop of the game, as a plan (GDD §9, first 5 minutes). */
export function firstLoopPlan(world) {
    const d = world.data, seed = d.items[0], glider = d.items[1], rope = d.items[2], th = d.air[1];
    return [
        { walk: [seed.x - 0.8, seed.y + 0.2] },
        { act: "pick", face: [seed.x, seed.y] },
        { walk: [-3.5, -2], r: 0.6 },
        { walk: [3.2, -2.5], r: 0.4 },
        { act: "plant", face: [5, -2.5] },
        { act: "water", face: [5, -2.5] },
        { walk: [glider.x - 1, glider.y - 1], r: 0.6 },
        { act: "pick", face: [glider.x, glider.y] },
        { walk: [20, 5], r: 1 },
        { glide: [rope.x - 6, rope.y - 3], land: world.islands[1].top },
        { walk: [rope.x - 0.8, rope.y], r: 0.4 },
        { act: "pick", face: [rope.x, rope.y] },
        { walk: [168, 44], r: 1 },
        { glide: [6, 2], climb: { at: th.at, to: 96 }, land: world.islands[0].top },
    ];
}
