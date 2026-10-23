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
import { makeWorld, WORLD, solidAt, boxAt, islandUnder, topAt } from "../game/islands.js";
import { createState, step, hashState, dayT, NO_INPUT } from "../game/sim.js";
import { makePilot, pilotInput, firstLoopPlan } from "../game/pilot.js";
import { MOVE, TICK_RATE, BTN } from "../game/data.js";
import { makeRandom } from "../game/det.js";
import { weatherOf, rainingAt } from "../game/farm.js";
import { CROPS, DAY_TICKS, WEATHER } from "../game/data.js";

let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };
const world = makeWorld(WORLD);

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

// ---------------------------------------------------------------- the farm (stage 4)
{
    // weather: the same for a seed, about the chances asked for, no storm before day 4
    const counts = { clear: 0, breezy: 0, rain: 0, storm: 0 };
    let early = 0;
    for (let day = 1; day <= 2000; day++) { const w = weatherOf(world.data.seed, day); counts[w.kind]++; if (w.kind === "storm" && day < WEATHER.stormFrom) early++; }
    const share = (k) => counts[k] / 2000;
    check(early === 0 && Math.abs(share("rain") - 0.18) < 0.04 && Math.abs(share("clear") - 0.45) < 0.05, `weather over 2000 days: clear ${(share("clear") * 100).toFixed(0)}%, breezy ${(share("breezy") * 100).toFixed(0)}%, rain ${(share("rain") * 100).toFixed(0)}%, storm ${(share("storm") * 100).toFixed(0)}%, no early storms`);

    // a garden of one of each crop at home, planted by hand, then days pass
    const at = (s, ix, iy) => s.plots.get(ix + "," + iy);
    const plant = (s, ix, iy, crop) => { const p = s.player; p.x = ix - 0.6; p.y = iy + 0.5; p.z = topAt(islandUnder(world, p.x, p.y), p.x, p.y); p.fx = 1; p.fy = 0; p.ground = true; s.pouch.seeds[crop] = 9; s.pouch.selected = crop; for (let k = 0; k < 40 && !(at(s, ix, iy) && at(s, ix, iy).crop); k++) step(s, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact }); return s.events; };
    const s = createState(world);
    let wrong = false;
    for (let i = 0; i < 4; i++) { plant(s, 4 + i, -1, ["moonbean", "turnip", "cotton", "frostmint"][i]); }
    // the frost-mint can't go in at home: it needs the High Rocks
    wrong = !at(s, 7, -1) || !at(s, 7, -1).crop;
    check(wrong, "frost-mint won't grow at home (it needs a garden above 400 m)");
    // the moon-bean grows only at night: water it at noon, and by blue hour it hasn't moved
    const mb = at(s, 4, -1), tp = at(s, 5, -1);
    mb.watered = true; tp.watered = true;
    while ((s.tick % DAY_TICKS) / DAY_TICKS < 0.84) step(s, NO_INPUT);
    const dayGrowth = mb.growth;
    // and through the night it does
    while ((s.tick % DAY_TICKS) / DAY_TICKS > 0.5) step(s, NO_INPUT);
    check(dayGrowth === 0 && mb.growth > 0, `moon-bean: 0 growth by day, ${(mb.growth * 100).toFixed(0)}% overnight`);

    // rain waters and speeds things up: find a rainy day and compare a watered turnip's day there with a dry one
    let rainDay = 2; while (weatherOf(world.data.seed, rainDay).kind !== "rain") rainDay++;
    const w = weatherOf(world.data.seed, rainDay);
    check(rainingAt(world.data.seed, (rainDay - 1) * DAY_TICKS + Math.round((w.rainFrom + w.rainTo) / 2 * DAY_TICKS)) && !rainingAt(world.data.seed, (rainDay - 1) * DAY_TICKS + Math.round(0.01 * DAY_TICKS)), `day ${rainDay} rains from ${(w.rainFrom * 100).toFixed(0)}% to ${(w.rainTo * 100).toFixed(0)}% of the way through the day`);
    check(!at(s, 6, -1) || !at(s, 6, -1).crop, "cloud-cotton won't grow at home either (it's an Orchard crop)");

    // cloud-cotton in the Apple Terraces garden: watered every day of a dry spell, it stops at two-thirds; a rainy day finishes it
    const o = createState(world), og = o.world.data.gardens.find((q) => q.island === "apple");
    plant(o, og.x0 + 1, og.y0 + 1, "cotton");
    const ct = at(o, og.x0 + 1, og.y0 + 1);
    let dry = 1; while (weatherOf(world.data.seed, dry).rainTo > 0 || weatherOf(world.data.seed, dry + 1).rainTo > 0 || weatherOf(world.data.seed, dry + 2).rainTo > 0) dry++;
    o.tick = (dry - 1) * DAY_TICKS + 10; ct.growth = 0;
    for (let d = 0; d < 3; d++) { ct.watered = true; const next = (dry + d) * DAY_TICKS; while (o.tick < next) { step(o, NO_INPUT); ct.watered = true; } }
    const dryGrowth = ct.growth;
    let wet = dry + 3; while (weatherOf(world.data.seed, wet).rainTo === 0) wet++;
    o.tick = (wet - 1) * DAY_TICKS + 10;
    for (let d = 0; d < 3 && ct.growth < 1; d++) { const next = (wet + d) * DAY_TICKS; while (o.tick < next) { step(o, NO_INPUT); ct.watered = true; } }
    check(Math.abs(dryGrowth - 2 / 3) < 1e-6 && ct.growth >= 1, `cloud-cotton: ${(dryGrowth * 100).toFixed(0)}% after three dry days (it waits for rain), ripe ${Math.ceil(o.tick / DAY_TICKS) - wet + 1} day(s) after the rain on day ${wet}`);

    // pollination: three sunflowers and two berry bushes in bloom bring sprites; a pollinated turnip yields 3, not 2
    const g = createState(world);
    const spots = [[4, -4, "sunflower"], [5, -4, "sunflower"], [6, -4, "sunflower"], [4, -5, "berry"], [5, -5, "berry"], [7, -4, "turnip"]];
    for (const [ix, iy, c] of spots) plant(g, ix, iy, c);
    for (const [ix, iy] of spots) { const p = at(g, ix, iy); p.growth = p.crop === "turnip" ? 0.95 : 0.6; }
    g.player.x = -6; g.player.y = -2;
    let arrived = 0;
    for (let i = 0; i < 60 * 90; i++) { step(g, NO_INPUT); if (g.events.some((e) => e.type === "sprite-arrives")) arrived++; }
    const tn = at(g, 7, -4);
    tn.growth = 1;
    g.player.x = 6.2; g.player.y = -3.5; g.player.fx = 1; g.player.fy = 0;
    const before = g.pouch.crops.turnip;
    for (let k = 0; k < 40 && g.pouch.crops.turnip === before; k++) step(g, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact });
    check(arrived > 0 && tn.pollinated === false && g.pouch.crops.turnip - before === 3, `sprites came (${arrived} arrivals, ${g.sprites.length} there now); the pollinated turnip gave ${g.pouch.crops.turnip - before}`);

    // a berry bush regrows after picking
    const bb = at(g, 4, -5);
    bb.growth = 1; g.player.x = 3.4; g.player.y = -4.5;
    const b0 = g.pouch.crops.berry;
    for (let k = 0; k < 40 && g.pouch.crops.berry === b0; k++) step(g, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact });
    check(bb.crop === "berry" && Math.abs(bb.growth - CROPS.berry.regrow) < 1e-9, `the berry bush gave ${g.pouch.crops.berry - b0} berries and went back to ${(bb.growth * 100).toFixed(0)}%`);

    // cooking: two turnips at the stove make soup: 15 s more stamina today
    const c = createState(world), cp = c.player;
    c.pouch.crops.turnip = 2;
    cp.x = c.world.data.stove.x + 0.5; cp.y = c.world.data.stove.y;
    for (let k = 0; k < 20 && !cp.meal; k++) step(c, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact });
    check(cp.meal === 15 && c.pouch.crops.turnip === 0, `turnip soup: meal +${cp.meal} s, turnips left ${c.pouch.crops.turnip}`);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
