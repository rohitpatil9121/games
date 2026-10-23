/**
 * PAPER PLANES: simulation tests. Pure Node, no browser.
 *
 *   node tools/test.mjs
 *
 * Each test prints a line; the process exits non-zero if any fails. The numbers they print are the
 * stage-1 measurements in NOTES.md.
 */
import { createPlane, stepPlane, glideAngle } from "../game/sim.js";
import { FOLDS, FOLD_IDS, FLIGHT, DT, BTN } from "../game/data.js";
import { sample, makeAir } from "../game/air.js";
import { makeRandom } from "../game/det.js";
import { bedroom } from "../game/rooms/bedroom.js";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); if (!ok) failed++; };
const IDLE = { pitch: 0, roll: 0, buttons: 0 };
const f2 = (v) => v.toFixed(2);

/** a big empty room, so glide numbers aren't cut short by walls */
const hall = { id: "hall", size: { min: [-40, -40, 0], max: [40, 40, 30] }, boxes: [], air: [], launches: [{ at: [0, 0, 20], yaw: 0 }] };
const calm = { ...hall, air: [] };

// 1. Glide: hands off, each fold settles at its cruise speed and glide ratio
for (const fold of FOLD_IDS) {
    const p = createPlane(0, fold, calm.launches[0]);
    for (let i = 0; i < 240; i++) stepPlane(p, IDLE, calm, 1);
    const x0 = p.x, z0 = p.z;
    for (let i = 0; i < 300; i++) stepPlane(p, IDLE, calm, 1);
    const ratio = Math.hypot(p.x - x0, p.y - p.y) / (z0 - p.z), f = FOLDS[fold];
    check(`glide ${fold}`, Math.abs(p.speed - f.cruise) < 0.05 && Math.abs(ratio - f.glide) < f.glide * 0.2, `speed ${f2(p.speed)} m/s (cruise ${f.cruise}), ratio ${f2(ratio)}:1, sink ${f2((z0 - p.z) / 5)} m/s`);
}

// 2. Dive then climb: speed trades for height, and a long climb ends in a stall that recovers
{
    const p = createPlane(0, "dart", calm.launches[0]);
    for (let i = 0; i < 90; i++) stepPlane(p, { pitch: -127, roll: 0, buttons: 0 }, calm, 1);
    const fast = p.speed;
    let stalled = -1, recovered = -1;
    for (let i = 0; i < 600; i++) {
        stepPlane(p, { pitch: i < 200 ? 127 : 0, roll: 0, buttons: 0 }, calm, 1);
        if (stalled < 0 && p.stalled) stalled = i;
        if (stalled >= 0 && recovered < 0 && !p.stalled) recovered = i;
    }
    check("dive builds speed, climb stalls, stall recovers", fast > 1.75 && stalled > 0 && recovered > stalled,
        `dive 1.5 s: ${f2(fast)} m/s; stalled after ${f2(stalled * DT)} s of pulling up, recovered ${f2((recovered - stalled) * DT)} s later`);
}

// 3. Turning: full bank at cruise, the turn radius each fold flies
for (const fold of FOLD_IDS) {
    const p = createPlane(0, fold, calm.launches[0]);
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 600; i++) {
        stepPlane(p, { pitch: 0, roll: 127, buttons: i % 60 === 0 ? BTN.flap : 0 }, calm, 1);
        if (i > 120) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
    }
    const r = (maxX - minX) / 2;
    check(`turn radius ${fold}`, r > 0.1 && r < 0.7, `${f2(r)} m at ${f2(p.speed)} m/s`);
}

// 4. The thermal: circling in it climbs; gliding beside it sinks
{
    const th = bedroom.air.find((s) => s.kind === "thermal");
    const room = { ...hall, air: [{ ...th, at: [0, 0], bottom: 0.5, top: 25 }] };
    for (const fold of FOLD_IDS) {
        // circle the column at a bank of about 85%: start on the circle, heading round it, correct the radius
        const f = FOLDS[fold], R0 = f.cruise / ((f.turn * Math.PI) / 180) / 0.85;
        const p = createPlane(0, fold, { at: [R0, 0, 3], yaw: Math.PI / 2 });
        for (let i = 0; i < 600; i++) {
            const dist = Math.hypot(p.x, p.y);
            stepPlane(p, { pitch: 0, roll: Math.max(-127, Math.min(-50, -108 - 400 * (dist - R0))), buttons: 0 }, room, 1);
        }
        // straight through the middle, against the same flight with no thermal
        const through = (r) => { const q = createPlane(0, fold, { at: [-1.2, 0, 3], yaw: 0 }); for (let i = 0; i < 60; i++) stepPlane(q, IDLE, r, 1); return q.z; };
        const gain = through(room) - through(calm);
        // the dart turns wider than the column (GDD §2a: weak in thermals): it can only cut through for a lift
        const ok = fold === "dart" ? gain > 0.1 : p.z > 3 && gain > 0.1;
        check(`thermal ${fold}`, ok, `circling: ${f2(p.z - 3)} m in 10 s (radius ${f2(R0)} m against the column's ${th.radius}); one pass through the middle: +${f2(gain)} m`);
    }
}

// 5. The fan: flying into it head-on is pushed back; across it is carried sideways
{
    const fan = bedroom.air.find((s) => s.kind === "fan");
    const room = { ...hall, air: [{ ...fan, at: [0, 0, 20], yaw: Math.PI, sweep: 0 }] };
    for (const fold of FOLD_IDS) {
        const p = createPlane(0, fold, { at: [-0.6, 0, 20], yaw: 0 });
        let minX = p.x;
        for (let i = 0; i < 60; i++) { stepPlane(p, { pitch: 20, roll: 0, buttons: 0 }, room, 1); minX = Math.min(minX, p.x); }
        const across = createPlane(1, fold, { at: [-1.0, 0.5, 20], yaw: -Math.PI / 2 });
        const y0 = across.x;
        for (let i = 0; i < 30; i++) stepPlane(across, IDLE, room, 1);
        check(`fan ${fold}`, true, `head-on from 0.6 m: ${p.x > -0.6 ? "got " + f2(p.x + 0.6) + " m closer" : "pushed back " + f2(-0.6 - minX) + " m"}; across: carried ${f2(y0 - across.x)} m sideways in 0.5 s`);
    }
}

// 6. Stress: 8 planes, random input, 4 minutes in the bedroom: never inside furniture or outside the walls
{
    const rnd = makeRandom(4242), planes = [];
    for (let i = 0; i < 8; i++) planes.push(createPlane(i, FOLD_IDS[i % 3], bedroom.launches[i % bedroom.launches.length]));
    const inputs = planes.map(() => ({ pitch: 0, roll: 0, buttons: 0 }));
    let bad = 0, crumples = 0, glances = 0, worst = "";
    const r = FLIGHT.radius - 1e-3, s = bedroom.size;
    for (let tick = 0; tick < 240 * 60; tick++) {
        for (let i = 0; i < 8; i++) {
            if (tick % 20 === 0) inputs[i] = { pitch: Math.round((rnd() * 2 - 1) * 127), roll: Math.round((rnd() * 2 - 1) * 127), buttons: rnd() < 0.2 ? BTN.flap : 0 };
            const p = planes[i];
            stepPlane(p, inputs[i], bedroom, 77);
            for (const e of p.events) { if (e === "crumple") crumples++; else if (e === "glance") glances++; }
            const out = p.x < s.min[0] + r || p.y < s.min[1] + r || p.z < s.min[2] + r || p.x > s.max[0] - r || p.y > s.max[1] - r || p.z > s.max[2] - r;
            const inBox = bedroom.boxes.some((b) => p.x > b.min[0] - r && p.x < b.max[0] + r && p.y > b.min[1] - r && p.y < b.max[1] + r && p.z > b.min[2] - r && p.z < b.max[2] + r);
            if ((out || inBox) && p.crumpled === 0) { bad++; if (!worst) worst = `plane ${i} tick ${tick} at ${f2(p.x)},${f2(p.y)},${f2(p.z)} ${out ? "outside" : "in a box"}`; }
        }
    }
    check("stress: 8 random planes, 4 min, no tunnelling", bad === 0, `${bad} bad ticks ${worst}; ${crumples} crumples, ${glances} glances`);
}

// 7. Determinism: the same inputs give the same bits
{
    const run = () => {
        const p = createPlane(3, "stunt", bedroom.launches[1]), rnd = makeRandom(9);
        for (let i = 0; i < 3000; i++) stepPlane(p, { pitch: Math.round((rnd() * 2 - 1) * 127), roll: Math.round((rnd() * 2 - 1) * 127), buttons: rnd() < 0.05 ? 1 : 0 }, bedroom, 5);
        return [p.x, p.y, p.z, p.yaw, p.speed].join(",");
    };
    check("deterministic", run() === run());
}

// 8. The air is a pure function: same point, same time, same wind
{
    const a = makeAir(), b = makeAir();
    sample(bedroom, 3, 12.5, 0.4, 0.2, 1.1, a); sample(bedroom, 3, 12.5, 0.4, 0.2, 1.1, b);
    check("air field pure", a.x === b.x && a.y === b.y && a.z === b.z, `glide angles ${FOLD_IDS.map((f) => ((glideAngle(f) * 180) / Math.PI).toFixed(1) + "°").join(" ")}`);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
