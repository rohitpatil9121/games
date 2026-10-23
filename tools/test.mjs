/**
 * SKYFARM: simulation tests in Node (no browser). `npm test`.
 *
 * - determinism: the same inputs give the same game, bit for bit
 * - the first loop, played by the test pilot (game/pilot.js) through real inputs: pick the seed, plant, water,
 *   take the glider, glide to Daisy Step, pick the rope-grass seeds, climb the thermal, glide home, sleep,
 *   harvest. Reports the times and whether each glide landed where it aimed.
 * - stress: random input for minutes of play; the player is never inside rock or a wall
 * @module tools/test
 */
import { makeWorld, PROTOTYPE, solidAt, boxAt, islandUnder } from "../game/islands.js";
import { createState, step, hashState, dayT, NO_INPUT } from "../game/sim.js";
import { makePilot, pilotInput, firstLoopPlan } from "../game/pilot.js";
import { MOVE, TICK_RATE, BTN } from "../game/data.js";
import { makeRandom } from "../game/det.js";

let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };
const world = makeWorld(PROTOTYPE);

// ---------------------------------------------------------------- determinism
{
    const run = () => {
        const s = createState(world), r = makeRandom(7);
        let input = { ...NO_INPUT };
        for (let i = 0; i < 60 * 90; i++) {
            if (i % 20 === 0) input = { mx: Math.round(r() * 254 - 127), my: Math.round(r() * 254 - 127), yaw: (r() * 65536) | 0, buttons: (r() < 0.2 ? BTN.jump : 0) | (r() < 0.3 ? BTN.interact : 0) };
            step(s, input);
        }
        return hashState(s);
    };
    check(run() === run(), "the same inputs give the same game");
}

// ---------------------------------------------------------------- the first loop
{
    const s = createState(world), pilot = makePilot(firstLoopPlan(world));
    const marks = {};
    let flights = [], flying = null;
    for (let i = 0; i < 60 * 600 && !pilot.done; i++) {
        step(s, pilotInput(pilot, s));
        for (const e of s.events) {
            if (e.type === "open") flying = { from: [s.player.x, s.player.y, s.player.z], tick: s.tick, minStamina: 99, maxZ: s.player.z };
            if (e.type === "land" && e.glide && flying) { flights.push({ ...flying, to: [s.player.x, s.player.y, s.player.z], seconds: (s.tick - flying.tick) / TICK_RATE, island: islandUnder(world, s.player.x, s.player.y, s.player.z)?.id, hard: e.hard }); flying = null; }
            if (e.type === "fell") flights.push({ fell: true });
            if (!marks[e.type]) marks[e.type] = s.tick;
        }
        if (flying) { flying.minStamina = Math.min(flying.minStamina, s.player.stamina); flying.maxZ = Math.max(flying.maxZ, s.player.z); }
    }
    const start = Math.round(0.03 * 72000);
    const loopSeconds = (s.tick - start) / TICK_RATE;
    // a person takes longer than the pilot: stand at home until five and a half minutes have gone
    while ((s.tick - start) / TICK_RATE < 330) { step(s, NO_INPUT); for (const e of s.events) if (!marks[e.type]) marks[e.type] = s.tick; }
    const at = (t) => (marks[t] ? ((marks[t] - start) / TICK_RATE).toFixed(1) + " s" : "never");
    console.log(`  first loop (pilot, ${loopSeconds.toFixed(0)} s): seed ${at("pick")}, planted ${at("plant")}, watered ${at("water")}, first glide ${at("open")}, sprouted ${at("sprout")}`);
    for (const f of flights) {
        if (f.fell) { console.log("    a glide fell into the clouds"); continue; }
        console.log(`    glide ${f.seconds.toFixed(1)} s, ${Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]).toFixed(0)} m, from z ${f.from[2].toFixed(1)} (top ${f.maxZ.toFixed(1)}) to ${f.to[2].toFixed(1)} on ${f.island}, stamina left ${f.minStamina.toFixed(1)} s${f.hard ? ", hard landing" : ""}`);
    }
    for (const l of pilot.log) if (/gave up|short|unknown/.test(l.note)) console.log("    pilot: " + l.note);
    check(flights.length === 2 && flights[0].island === "daisy" && flights[1].island === "hearth", "the pilot glides to Daisy Step and back home");
    check(s.pouch.seeds.ropegrass === 3, "it found the rope-grass seeds");
    check(!!marks.sprout && (marks.sprout - start) / TICK_RATE < 330, "the turnip sprouts within the first five and a half minutes");
    // finish the day: sleep, harvest
    const rest = makePilot([{ walk: [-1.5, -2], r: 0.6 }, { walk: [-4, -2], r: 0.6 }, { sleep: true }, { walk: [-3.5, -2], r: 0.6 }, { walk: [3.2, -2.5], r: 0.4 }, { act: "harvest", face: [5, -2.5] }]);
    while (dayT(s) < 0.5) step(s, NO_INPUT);
    for (let i = 0; i < 60 * 120 && !rest.done; i++) step(s, pilotInput(rest, s));
    for (const l of rest.log) if (/gave up/.test(l.note)) console.log("    pilot: " + l.note);
    check(s.pouch.crops.turnip === 2, `slept and harvested two turnips (pouch: ${s.pouch.crops.turnip})`);
}

// ---------------------------------------------------------------- stress
{
    const s = createState(world), r = makeRandom(99);
    s.player.hasGlider = true;
    let input = { ...NO_INPUT }, bad = 0, falls = 0, glides = 0, first = "";
    for (let i = 0; i < 60 * 60 * 6; i++) {
        if (i % 30 === 0) input = { mx: Math.round(r() * 254 - 127), my: Math.round(r() * 200 - 60), yaw: (r() * 65536) | 0, buttons: (r() < 0.25 ? BTN.jump : 0) | (r() < 0.4 ? BTN.sprint : 0) };
        step(s, input);
        const p = s.player;
        for (const e of s.events) { if (e.type === "fell") falls++; if (e.type === "open") glides++; }
        const inRock = solidAt(world, p.x, p.y, p.z + 0.3), wall = boxAt(world, p.x, p.y, p.z + 0.3, MOVE.radius * 0.8, 1);
        if ((inRock || (wall && wall.kind === "wall")) && bad++ === 0) first = `tick ${i} at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} (${p.mode}) in ${inRock ? "rock" : "a wall"}`;
    }
    check(bad === 0, `six minutes of random input: never inside rock or a wall (${glides} glides, ${falls} falls)${bad ? ": " + bad + " ticks, first " + first : ""}`);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
