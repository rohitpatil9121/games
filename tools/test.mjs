/**
 * Simulation tests (the `physics-tuning` skill: verify by stress, not by hope).
 *
 *   node tools/test.mjs
 *
 * Movement: no player ever ends up inside a ruin or under the terrain, under random input at full speed;
 * swimming settles at the surface without bouncing; a heavy load sinks and the flood takes it; ledges
 * climb; coyote time and the jump buffer work; the grapple pulls to what it hit.
 * Determinism: the same match twice gives the same fingerprint.
 * Exits with 1 on any failure.
 */
import { generateIsland, groundAt } from "../game/island.js";
import { createState, addPlayer, step, stepPlayer, stuck, createPlayer, hashState, findPlayer } from "../game/sim.js";
import { quantizeYaw, quantizePitch } from "../game/det.js";
import { BTN, WATER, LOOT, MOVE, TICK_RATE } from "../game/data.js";
import { tideAt, waterAt } from "../game/tide.js";

let failed = 0, passed = 0;
function check(name, ok, detail = "") {
    if (ok) { passed++; console.log(`  ok   ${name}${detail ? "  (" + detail + ")" : ""}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? "  (" + detail + ")" : ""}`); }
}
const input = (o = {}) => ({ seq: 1, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, lag: 0, ...o });
const island = generateIsland(4242, 4);

// ------------------------------------------------------------------ random abuse
{
    let r = 7;
    const rand = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
    const state = createState(island);
    for (let i = 0; i < 8; i++) addPlayer(state, island, i + 1, "P" + i, { team: i % 4 });
    const inputs = new Map(), wants = new Map();
    let bad = 0, worst = "", ticks = 0, hooks = 0, mantles = 0;
    for (let t = 0; t < 60 * 60 * 4; t++) {
        for (const p of state.players) {
            if (t % 40 === 0 || !wants.has(p.id)) wants.set(p.id, { yaw: rand() * 65536 | 0, mx: (rand() * 255 | 0) - 127, my: (rand() * 255 | 0) - 127, pitch: (rand() * 30000 | 0) - 10000 });
            const w = wants.get(p.id);
            let b = 0;
            if (rand() < 0.08) b |= BTN.jump; if (rand() < 0.5) b |= BTN.sprint; if (rand() < 0.02) b |= BTN.grapple; if (rand() < 0.05) b |= BTN.interact; if (rand() < 0.01) b |= BTN.drop;
            if (rand() < 0.02) b |= BTN.shove;
            inputs.set(p.id, input({ seq: t + 1, ...w, buttons: b }));
        }
        step(state, island, inputs);
        ticks++;
        for (const p of state.players) {
            if (p.hookFired === 1) hooks++;
            if (p.mantled) mantles++;
            if (p.alive && stuck(island, p)) { bad++; if (!worst) worst = `player ${p.id} at ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} tick ${state.tick}`; }
        }
    }
    check("8 players, 4 minutes of random input at full speed: never inside a wall or under the ground", bad === 0, bad ? `${bad} ticks stuck, first: ${worst}` : `${ticks} ticks, ${hooks} grapples, ${mantles} ledge climbs`);
}

// ------------------------------------------------------------------ determinism
{
    const run = () => {
        const state = createState(island);
        for (let i = 0; i < 6; i++) addPlayer(state, island, i + 1, "P" + i, { team: i % 4 });
        const inputs = new Map();
        for (let t = 0; t < 60 * 90; t++) {
            for (const p of state.players) inputs.set(p.id, input({ seq: t + 1, yaw: (p.id * 9000 + t * 37) & 0xffff, my: 127, mx: (t >> 5) % 2 ? 60 : -60, buttons: (t % 47 === 0 ? BTN.jump : 0) | (t % 13 === 0 ? BTN.interact : 0) | (t % 300 === 0 ? BTN.grapple : 0) | BTN.sprint }));
            step(state, island, inputs);
        }
        return hashState(state);
    };
    const a = run(), b = run();
    check("the same match twice gives the same fingerprint", a === b, a.toString(16));
}

// ------------------------------------------------------------------ swimming
{
    const p = createPlayer(1);
    // a deep spot at high water: the wreck's ring
    const r = island.ruins.find((x) => x.kind === "wreck"), level = 1.6;
    p.x = r.x + 12; p.y = r.y; p.z = level + 2; p.vz = -6;
    const zs = [];
    for (let t = 0; t < 240; t++) { stepPlayer(island, p, input({ seq: t + 1 }), level); zs.push(p.z); }
    const settle = level - WATER.float, end = zs[zs.length - 1];
    let crossings = 0;
    for (let i = 61; i < zs.length; i++) if ((zs[i] - settle) * (zs[i - 1] - settle) < 0) crossings++;
    check("jumping into deep water: settles floating at the surface", Math.abs(end - settle) < 0.05 && p.water === 2, `feet ${end.toFixed(3)} m, settle ${settle.toFixed(3)}`);
    check("...without bobbing up and down", crossings <= 1, `${crossings} crossings after the first second`);
    // swim speed
    // swim along the ring (away from the wreck and the edge of the map)
    const x0 = p.x, y0 = p.y, along = Math.atan2(r.y, r.x) + Math.PI / 2;
    for (let t = 0; t < 120; t++) stepPlayer(island, p, input({ seq: t + 1, my: 127, buttons: BTN.sprint, yaw: quantizeYaw(along) }), level);
    const speed = Math.hypot(p.x - x0, p.y - y0) / 2;
    check("swimming is slow and sprint does nothing", speed > 2 && speed <= WATER.swim + 0.01, `${speed.toFixed(2)} m/s`);

    // heavy: sinks, breath runs out, the heavy things are let go
    const state = createState(island);
    const h = addPlayer(state, island, 1, "H", { team: 0 });
    state.loot.push({ id: 900, kind: LOOT.idol.id, x: 0, y: 0, z: 0, vz: 0, holder: 1, spot: -1, dropBy: 0 });
    h.carry = [900]; h.weight = LOOT.idol.weight;
    h.x = r.x + 12; h.y = r.y; h.z = 1.6 - 1.4;
    // run the match clock at high water (tick in the high phase of tide 1)
    state.tick = 82 * TICK_RATE; state.lastPhase = 3; state.lastTide = 0;
    let sunk = false, gasp = null;
    for (let t = 0; t < 60 * 14 && !gasp; t++) {
        step(state, island, new Map([[1, input({ seq: t + 1 })]]));
        if (h.water === 3) sunk = true;
        for (const e of state.events) if (e.type === "drop" && e.why === "gasp") gasp = (t / 60).toFixed(1);
    }
    check("carrying an idol in deep water sinks you to the floor", sunk);
    check("...and when your breath is gone the idol goes, and you float", gasp !== null && h.carry.length === 0 && h.alive, `let go after ${gasp} s`);
}

// ------------------------------------------------------------------ ledges, coyote time, jump buffer
{
    const steps = island.ruins.find((x) => x.kind === "steps");
    const lowest = steps.solids[0];
    const p = createPlayer(1), level = -20;
    // stand west of the first tier, facing east, and walk into it holding jump
    p.x = lowest.x0 - 1.2; p.y = (lowest.y0 + lowest.y1) / 2; p.z = groundAt(island, p.x, p.y); p.ground = true;
    let climbed = false;
    for (let t = 0; t < 90; t++) { stepPlayer(island, p, input({ seq: t + 1, my: 127, yaw: quantizeYaw(0), buttons: BTN.jump }), level); if (p.mantled) climbed = true; }
    check("walking into a 1 m ledge while jumping climbs onto it", climbed && p.z >= lowest.z1 - 0.01, `feet at ${p.z.toFixed(2)}, ledge ${lowest.z1.toFixed(2)}`);

    // coyote: run off the top tier's edge and press jump 5 ticks later
    const p2 = createPlayer(2), top = steps.solids[0];
    p2.x = (top.x0 + top.x1) / 2; p2.y = (top.y0 + top.y1) / 2; p2.z = top.z1; p2.ground = true;
    let t = 0, left = -1, jumped = false;
    for (; t < 200 && !jumped; t++) {
        const wasGround = p2.ground;
        stepPlayer(island, p2, input({ seq: t + 1, my: 127, yaw: quantizeYaw(Math.PI / 2), buttons: left >= 0 && t - left === 5 ? BTN.jump : 0 }), level);
        if (wasGround && !p2.ground && left < 0 && p2.vz <= 0) left = t;
        if (p2.jumped) jumped = true;
    }
    check("a jump pressed 5 ticks after walking off an edge still jumps (coyote time)", jumped);

    // buffer: press jump 5 ticks before landing
    const p3 = createPlayer(3);
    p3.x = 0; p3.y = 0; p3.z = groundAt(island, 0, 0) + 3; p3.vz = 0;
    let landedAt = -1, t3 = 0, buffered = false;
    // find when it lands with no jump, then repeat pressing 5 ticks before that
    const probe = { ...p3 };
    for (let k = 0; k < 120; k++) { stepPlayer(island, probe, input({ seq: k + 1 }), level); if (probe.ground) { landedAt = k; break; } }
    for (; t3 < landedAt + 10; t3++) { stepPlayer(island, p3, input({ seq: t3 + 1, buttons: t3 === landedAt - 5 ? BTN.jump : 0 }), level); if (p3.jumped) buffered = true; }
    check("a jump pressed 5 ticks before landing fires on landing (jump buffer)", buffered);
}

// ------------------------------------------------------------------ grapple
{
    const arch = island.ruins.find((x) => x.kind === "arch"), lintel = arch.solids[2];
    const p = createPlayer(1), level = -20;
    const tx = (lintel.x0 + lintel.x1) / 2, ty = (lintel.y0 + lintel.y1) / 2, tz = lintel.z0 + 0.1;
    // stand 12 m away, aim at the underside of the lintel
    const ang = 0.7;
    p.x = tx - Math.cos(ang) * 12; p.y = ty - Math.sin(ang) * 12; p.z = groundAt(island, p.x, p.y); p.ground = true;
    const dx = tx - p.x, dy = ty - p.y, dz = tz - (p.z + 1.5);
    const yaw = quantizeYaw(Math.atan2(dy, dx)), pitch = quantizePitch(Math.atan2(dz, Math.hypot(dx, dy)));
    let fired = 0, closest = Infinity;
    for (let t = 0; t < 120; t++) {
        stepPlayer(island, p, input({ seq: t + 1, yaw, pitch, buttons: t === 1 ? BTN.grapple : 0 }), level);
        if (p.hookFired) fired = p.hookFired;
        closest = Math.min(closest, Math.hypot(tx - p.x, ty - p.y, tz - (p.z + 1)));
    }
    check("the grapple hits what it is aimed at and pulls you to it", fired === 1 && closest < 2.2, `came within ${closest.toFixed(2)} m`);
}

// ------------------------------------------------------------------ the tide
{
    let lowest = Infinity, ok = true;
    for (let k = 0; k < 6; k++) {
        const low = tideAt(island.seed, k * 90 * TICK_RATE + 42 * TICK_RATE).level;
        if (low >= lowest) ok = false;
        lowest = Math.min(lowest, low);
    }
    check("every tide goes lower than the last", ok);
    let jump = 0;
    for (let t = 1; t < 6 * 90 * 60; t++) jump = Math.max(jump, Math.abs(waterAt(island.seed, t) - waterAt(island.seed, t - 1)));
    check("the water never jumps between ticks", jump < 0.012, `largest step ${(jump * 100).toFixed(2)} cm`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
