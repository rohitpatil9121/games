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

// ------------------------------------------------------------------ rivals: shove, flare, banking, scoring
{
    const setup = () => {
        const state = createState(island);
        const a = addPlayer(state, island, 1, "A", { team: 0 }), b = addPlayer(state, island, 2, "B", { team: 1 });
        // somewhere flat and dry at high water: the plateau between two camps
        const cx = (island.camps[0].x + island.camps[1].x) * 0.25, cy = (island.camps[0].y + island.camps[1].y) * 0.25;
        for (const p of [a, b]) { p.x = cx; p.y = cy; p.z = groundAt(island, cx, cy); p.ground = true; }
        const give = (p, kind, id) => { state.loot.push({ id, kind, x: p.x, y: p.y, z: p.z, vz: 0, holder: p.id, spot: -1, dropBy: 0 }); p.carry.push(id); p.weight += LOOT[["", "coin", "relic", "idol"][kind]].weight; };
        state.lastPhase = 0; state.lastTide = 0;
        return { state, a, b, give };
    };
    const run = (state, inputs, n) => { for (let t = 0; t < n; t++) step(state, island, new Map(inputs.map(([id, inp]) => [id, typeof inp === "function" ? inp(t) : inp]))); };

    // a shove from in front: one item, a short stagger
    {
        const { state, a, b, give } = setup();
        give(b, 2, 501); give(b, 1, 502);
        b.x = a.x + 1.2; b.fx = -1; b.fy = 0;
        step(state, island, new Map([[1, input({ seq: 1, yaw: quantizeYaw(0), buttons: BTN.shove })], [2, input({ seq: 1, yaw: quantizeYaw(Math.PI) })]]));
        const e = state.events.find((x) => x.type === "shove");
        check("a shove from in front knocks one item loose", e && e.target === 2 && !e.behind && b.carry.length === 1 && b.stun > 0, `carry ${b.carry.length}, stun ${b.stun} ticks`);
    }
    // from behind: two items, a longer stagger
    {
        const { state, a, b, give } = setup();
        give(b, 2, 601); give(b, 1, 602); give(b, 1, 603);
        b.x = a.x + 1.2; b.fx = 1; b.fy = 0;
        step(state, island, new Map([[1, input({ seq: 1, yaw: quantizeYaw(0), buttons: BTN.shove })], [2, input({ seq: 1, yaw: quantizeYaw(0) })]]));
        const e = state.events.find((x) => x.type === "shove");
        check("a shove from behind knocks two items loose and staggers longer", e && e.behind === 1 && b.carry.length === 1 && b.stun >= 50, `carry ${b.carry.length}, stun ${b.stun} ticks`);
        const loose = state.loot.find((l) => l.id === 603);
        run(state, [[2, input({ seq: 2 })]], 60);
        a.x = loose.x; a.y = loose.y; a.z = loose.z; a.vx = a.vy = 0;
        run(state, [[1, (t) => input({ seq: 2 + t, buttons: t === 2 ? BTN.interact : 0 })], [2, input({ seq: 2 })]], 6);
        check("...and picking up what a rival dropped counts as a steal", a.steals === 1 && a.carry.length === 1, `steals ${a.steals}`);
    }
    // no friendly shoves, no shoves out of reach
    {
        const { state, a, b, give } = setup();
        b.team = 0; give(b, 1, 701); b.x = a.x + 1;
        step(state, island, new Map([[1, input({ seq: 1, yaw: quantizeYaw(0), buttons: BTN.shove })]]));
        check("you can't shove your own team", b.carry.length === 1);
        b.team = 1; b.x = a.x + 3.5; a.shoveCool = 0;
        step(state, island, new Map([[1, input({ seq: 2, yaw: quantizeYaw(0), buttons: BTN.shove })]]));
        check("a shove doesn't reach 3.5 m", b.carry.length === 1);
    }
    // lag compensation: a shove aimed at where the target was a moment ago (as the shover saw it) lands
    {
        const { state, a, b, give } = setup();
        give(b, 1, 801);
        b.x = a.x + 1.0; b.y = a.y;
        run(state, [[2, (t) => input({ seq: t + 1, mx: 127, yaw: quantizeYaw(0) })], [1, input({ seq: 1, yaw: quantizeYaw(0) })]], 30);
        const gone = Math.hypot(b.x - a.x, b.y - a.y);
        // the most recent moment, within the 200 ms cap, at which b was still within reach
        let lag = 0, then = null;
        for (let k = 1; k <= 12 && !then; k++) { const i = ((state.tick - k) & 31) * 3, d = Math.hypot(b.hist[i] - a.x, b.hist[i + 1] - a.y); if (d <= 1.9) { lag = k; then = { x: b.hist[i], y: b.hist[i + 1], d }; } }
        const yaw = then ? quantizeYaw(Math.atan2(then.y - a.y, then.x - a.x)) : 0;
        step(state, island, new Map([[1, { ...input({ seq: 2, yaw, buttons: BTN.shove }), lag }], [2, input({ seq: 31, yaw: quantizeYaw(0) })]]));
        const hit = state.events.find((x) => x.type === "shove");
        check("a lag-compensated shove lands on where the target was when the shover saw it", gone > 2.1 && then && hit && hit.target === 2, `target now ${gone.toFixed(2)} m away; ${lag} ticks (${Math.round(lag * 1000 / 60)} ms) ago it was ${then ? then.d.toFixed(2) : "?"} m`);
        // and with the rewind off (lag 0) the same shove misses
        const s2 = setup(); s2.give(s2.b, 1, 802); s2.b.x = s2.a.x + 1.0; s2.b.y = s2.a.y;
        run(s2.state, [[2, (t) => input({ seq: t + 1, mx: 127, yaw: quantizeYaw(0) })], [1, input({ seq: 1, yaw: quantizeYaw(0) })]], 30);
        step(s2.state, island, new Map([[1, { ...input({ seq: 2, yaw, buttons: BTN.shove }), lag: 0 }], [2, input({ seq: 31, yaw: quantizeYaw(0) })]]));
        const miss = s2.state.events.find((x) => x.type === "shove");
        check("...and the same shove without the rewind misses", miss && miss.target === 0);
    }
    // flare: a rival looking at it is dazzled; one looking away is not; teammates never
    {
        const { state, a, b } = setup();
        b.x = a.x + 6; b.y = a.y;
        const c = addPlayer(state, island, 3, "C", { team: 1 }); c.x = a.x + 6; c.y = a.y + 1; c.z = b.z;
        const d = addPlayer(state, island, 4, "D", { team: 0 }); d.x = a.x + 6; d.y = a.y - 1; d.z = b.z;
        const pitch = quantizePitch(Math.atan2(-1.45, 3));
        // everyone turns first (b and d to look at a, c away), then a fires
        step(state, island, new Map([[1, input({ seq: 1, yaw: quantizeYaw(0), pitch })], [2, input({ seq: 1, yaw: quantizeYaw(Math.PI) })], [3, input({ seq: 1, yaw: quantizeYaw(0) })], [4, input({ seq: 1, yaw: quantizeYaw(Math.PI) })]]));
        step(state, island, new Map([[1, input({ seq: 1, yaw: quantizeYaw(0), pitch, buttons: BTN.flare })], [2, input({ seq: 1, yaw: quantizeYaw(Math.PI) })], [3, input({ seq: 1, yaw: quantizeYaw(0) })], [4, input({ seq: 1, yaw: quantizeYaw(Math.PI) })]]));
        check("a flare dazzles a rival who is looking at it", b.blind > 0, `${b.blind} ticks`);
        check("...but not one looking away, nor a teammate", c.blind === 0 && d.blind === 0);
        check("...and marks the spot for the team", state.flares.length === 1 && state.flares[0].team === 0);
    }
    // banking: only at your own camp; the match ends after six tides with the richest team winning
    {
        const { state, a, give } = setup();
        give(a, 3, 901);
        const other = island.camps[1];
        a.x = other.x; a.y = other.y; a.z = other.z;
        step(state, island, new Map([[1, input({ seq: 1 })]]));
        check("loot isn't banked at a rival's camp", a.carry.length === 1 && state.bank[1] === 0);
        const mine = island.camps[0];
        a.x = mine.x + 1; a.y = mine.y; a.z = mine.z;
        step(state, island, new Map([[1, input({ seq: 2 })]]));
        check("it is banked at your own", a.carry.length === 0 && state.bank[0] === LOOT.idol.value, `team 0 bank ${state.bank[0]}`);
        state.tick = 6 * 90 * TICK_RATE - 2;
        let over = null;
        for (let t = 0; t < 4; t++) { step(state, island, new Map()); for (const e of state.events) if (e.type === "over") over = e; }
        check("after six tides the match ends and the richest team wins", over && over.winner === 0 && state.phase === "over");
    }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
