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
import { onBridge, merchantAt, sell, buy, nextMerchantDay } from "../game/progression.js";
import { TALKS, STRINGS, talkTo } from "../game/dialogue.js";
import { finishTalk } from "../game/sim.js";
import { CROPS, DAY_TICKS, WEATHER } from "../game/data.js";
import { STORM, stormAt, gustAt } from "../game/weather.js";

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

// ---------------------------------------------------------------- bridges, restoration, trade, upgrades (stage 5)
{
    const s = createState(world), p = s.player, b = world.data.bridges.find((q) => q.id === "b1");
    const press = (n = 30, until = () => false) => { for (let k = 0; k < n && !until(); k++) step(s, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact }); };
    const standAt = (x, y) => { p.x = x; p.y = y; p.z = topAt(islandUnder(world, x, y), x, y); p.vx = p.vy = p.vz = 0; p.ground = true; p.mode = "foot"; };
    // not enough: the bridge end says what it needs
    standAt(b.ends[0][0], b.ends[0][1]);
    let needs = null;
    press(10, () => (needs = s.events.find((e) => e.type === "bridge-needs")));
    check(!!needs && needs.missing.rope === b.cost.rope, `the bridge to Daisy Step asks for ${b.cost.rope} rope, ${b.cost.planks} planks, ${b.cost.fittings} fittings (${b.length.toFixed(0)} m)`);
    // with them: it goes up, and both islands are restored
    s.pouch.crops.ropegrass = b.cost.rope; s.pouch.crops.skypine = b.cost.planks; s.pouch.materials.fittings = b.cost.fittings;
    press(10, () => s.progress.bridges.b1.state !== "broken");
    let built = false, restoredDaisy = false;
    for (let k = 0; k < 300 && !built; k++) { step(s, NO_INPUT); built = s.progress.bridges.b1.state === "built"; }
    restoredDaisy = s.progress.restored.has("daisy");
    check(built && restoredDaisy && s.pouch.crops.ropegrass === 0 && s.pouch.materials.fittings === 0, "paid for, it goes up in 4 s and restores Daisy Step");
    // walk across it: on the deck the feet stay on the planks; the rails keep you on
    const [a, c] = b.ends, ux = c[0] - a[0], uy = c[1] - a[1], L = Math.hypot(ux, uy);
    const mid = onBridge(b, a[0] + ux * 0.5, a[1] + uy * 0.5);
    p.x = a[0] + ux * 0.5; p.y = a[1] + uy * 0.5; p.z = mid.z; p.ground = true; p.vx = p.vy = p.vz = 0;
    for (let k = 0; k < 30; k++) step(s, NO_INPUT);
    const onDeck = Math.abs(p.z - mid.z) < 0.05 && p.ground;
    // push sideways for two seconds
    const side = (Math.atan2(uy, ux) + Math.PI / 2) / (Math.PI * 2) * 65536;
    for (let k = 0; k < 120; k++) step(s, { ...NO_INPUT, my: 127, yaw: Math.round(side) & 0xffff });
    const q = onBridge(b, p.x, p.y);
    check(onDeck && q.side < 0.9 && p.z > 20, `standing mid-span the feet stay on the deck (z ${p.z.toFixed(2)}); walking into the rail keeps you on (${q.side.toFixed(2)} m from the middle)`);
    // and walk along it to Daisy Step
    const along = Math.round((Math.atan2(uy, ux) / (Math.PI * 2)) * 65536) & 0xffff;
    for (let k = 0; k < 60 * 30 && !(islandUnder(world, p.x, p.y, p.z) === world.byId.daisy && p.ground && Math.hypot(p.x - 150, p.y - 34) < 18); k++) step(s, { ...NO_INPUT, my: 127, yaw: along });
    check(islandUnder(world, p.x, p.y, p.z) === world.byId.daisy, `walked the ${L.toFixed(0)} m bridge to Daisy Step on foot`);

    // the gate: restoring the Old Mill turns its updraft on
    const before = s.air.length;
    s.progress.restored.add("mill"); s.air = (await import("../game/progression.js")).activeAir(world, s.progress.restored);
    check(s.air.length === before + 1 && s.air.some((a) => a.gate === "mill"), "restoring the Old Mill starts its updraft (the Meadow gate)");

    // a heart: Hollow Log has no bridge; waking its heart restores it
    const h = world.data.hearts.find((q) => q.island === "hollow");
    standAt(h.x + 0.6, h.y);
    press(10, () => s.progress.restored.has("hollow"));
    check(s.progress.restored.has("hollow"), "waking Hollow Log's heart stone restores it");

    // the merchant: moored on day 2 in the morning; sells fittings for coins earned from crops
    const md = nextMerchantDay(0);
    s.tick = (md - 1) * DAY_TICKS + Math.round(0.3 * DAY_TICKS);
    s.pouch.crops.turnip = 10;
    const coins = sell(s, "turnip", 10), got = buy(s, "fittings", 3);
    check(merchantAt(s.tick).phase === "moored" && coins === 45 && got === 3 && s.progress.coins === 45 - 24, `the airship moors on day ${md}: 10 turnips sell for ${coins} coins, 3 fittings cost 24`);

    // upgrades: sky-silk at the shed's workbench gives the 11:1, 90 s glider
    s.pouch.materials.skysilk = 1;
    standAt(world.data.shed.x + 1.2, world.data.shed.y - 1.2);
    press(40, () => s.progress.tier === 1);
    check(s.progress.tier === 1 && p.glide === 11 && p.staminaMax === 90, `sky-silk at the workbench: tier ${s.progress.tier}, glide ${p.glide}:1, stamina ${p.staminaMax} s`);
}

// ---------------------------------------------------------------- people and the ending (stage 6)
{
    // the graph: every line exists; every entry's condition can come true (by what an earlier entry or the world sets)
    const missing = Object.values(TALKS).flat().flatMap((e) => e.lines).filter((id) => !STRINGS[id]);
    const setters = new Set(Object.values(TALKS).flat().flatMap((e) => e.do || []).filter((f) => f.startsWith("flag:")).map((f) => f.slice(5)));
    setters.add("pollinated");
    const unreachable = Object.entries(TALKS).flatMap(([who, es]) => es.filter((e) => (e.if || "").split(" ").filter((c) => c.startsWith("flag:")).some((c) => !setters.has(c.slice(5)))).map(() => who));
    check(!missing.length && !unreachable.length, `dialogue: ${Object.values(TALKS).flat().length} entries for ${Object.keys(TALKS).length} speakers, every line written, every entry reachable${missing.length ? " (missing " + missing.join(", ") + ")" : ""}`);

    // the story, end to end, through the same calls the UI makes
    const s = createState(world), say = (who) => finishTalk(s, who);
    say("ona");
    const sunflowers = s.pouch.seeds.sunflower;
    say("ona");
    const noSeedYet = s.pouch.materials.oldseed_meadow === 0;
    s.progress.restored.add("mill"); say("ona");
    say("mabel"); const berries = s.pouch.seeds.berry, noOrchardSeed = s.pouch.materials.oldseed_orchard === 0;
    s.flags.add("pollinated"); say("mabel");
    say("iris"); s.progress.restored.add("ogate"); say("iris");
    const three = ["oldseed_meadow", "oldseed_orchard", "oldseed_high"].every((k) => s.pouch.materials[k] === 1);
    check(sunflowers === 3 && noSeedYet && berries === 2 && noOrchardSeed && three, "Ona gives sunflowers, then the Meadow seed once the mill turns; Mabel berries, then the Orchard seed after sprites; Iris the High seed once the gate rings");
    const before = s.progress.restored.size;
    say("crown");
    check(s.ended > 0 && s.progress.restored.size === world.islands.length && s.pouch.materials.oldseed_high === 0, `the three seeds at the Crown wake the tree: the ending, and every island green (${before} → ${s.progress.restored.size} restored)`);
    const t = talkTo("crown", createState(world));
    check(t.lines[0] === STRINGS.crown_need, "without the seeds the Crown only says what it's waiting for");
}

// ---------------------------------------------------------------- storms (stage 7)
{
    const seed = world.data.seed;
    let day = WEATHER.stormFrom; while (weatherOf(seed, day).kind !== "storm") day++;
    const w = weatherOf(seed, day), T = (f) => (day - 1) * DAY_TICKS + Math.round(f * DAY_TICKS);
    // telegraphed: it builds over 2 in-game hours or more before the rain, full in the rain, nothing on calm days
    const hours = STORM.BUILD * 18;
    let calm = 0; for (let d = 1; d < day; d++) if (weatherOf(seed, d).kind !== "storm") for (let k = 0; k < 20; k++) calm = Math.max(calm, stormAt(seed, (d - 1) * DAY_TICKS + k * DAY_TICKS / 20));
    check(calm === 0 && stormAt(seed, T(w.rainFrom - STORM.BUILD * 0.9)) > 0 && stormAt(seed, T(w.rainFrom - STORM.BUILD * 1.05)) === 0 && stormAt(seed, T((w.rainFrom + w.rainTo) / 2)) === 1,
        `the day-${day} storm builds for ${hours.toFixed(1)} in-game hours before its rain, blows in it, and calm days have none`);
    // gusts: the same for a seed and a tick; a warning swell before every push
    const g = { x: 0, y: 0, z: 0, warn: 0, push: 0 }, mid = T((w.rainFrom + w.rainTo) / 2);
    let warnedFirst = true, pushes = 0, same = true;
    for (let k = 0; k < 60 * 90; k++) {
        gustAt(seed, mid + k, g); const push = g.push, warn = g.warn;
        if (push > 0 && gustAt(seed, mid + k - 1, { ...g }).push === 0) { pushes++; if (gustAt(seed, mid + k - 30, { ...g }).warn === 0) warnedFirst = false; }
        const h = gustAt(seed, mid + k, { ...g }); if (h.push !== push || h.warn !== warn) same = false;
    }
    check(same && pushes >= 8 && warnedFirst, `${pushes} gusts in 90 s of storm, each with a swell half a second before it, the same every time`);
    // a glide through the storm comes down faster than the same glide on a calm day
    const glide = (tick) => {
        const s = createState(world), p = s.player; s.tick = tick;
        p.x = 700; p.y = -700; p.z = 300; p.vx = p.vy = p.vz = 0; p.fx = 1; p.fy = 0; p.hasGlider = true; p.stamina = 60;
        p.mode = "glide"; p.ground = false; p.yaw = 0; p.speed = 14; p.pitch = -0.1; p.roll = 0; p.drift = false; p.stalled = false;
        for (let k = 0; k < 60 * 18; k++) step(s, NO_INPUT);
        return { z: p.z, off: Math.abs(p.y + 700) };
    };
    const a = glide(mid), b = glide(mid - DAY_TICKS);
    check(weatherOf(seed, day - 1).kind !== "storm" && a.z < b.z - 3, `18 s gliding in the storm ends ${(b.z - a.z).toFixed(1)} m lower and ${a.off.toFixed(1)} m off its line (calm: ${b.off.toFixed(1)} m)`);
    // storm-bloom takes only in a storm; storm-amber is there only while it blows
    const sow = (tick) => {
        const s = createState(world), p = s.player, G = world.data.gardens.find((q) => q.island === "frost"); s.tick = tick;
        const ix = G.x0 + 1, iy = G.y0 + 1;
        p.x = ix - 0.6; p.y = iy + 0.5; p.z = topAt(islandUnder(world, p.x, p.y), p.x, p.y); p.fx = 1; p.fy = 0; p.ground = true; p.mode = "foot";
        s.pouch.seeds.stormbloom = 2; s.pouch.selected = "stormbloom";
        let refused = false;
        for (let k = 0; k < 60; k++) { step(s, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact }); refused ||= s.events.some((e) => e.type === "needs-storm"); }
        return { planted: [...s.plots.values()].some((q) => q.crop === "stormbloom"), refused };
    };
    const inStorm = sow(mid), outside = sow(mid - DAY_TICKS);
    const amber = (tick) => {
        const s = createState(world), p = s.player, it = s.items.find((i) => i.material === "stormamber"); s.tick = tick;
        p.x = it.x - 0.8; p.y = it.y; p.z = topAt(islandUnder(world, p.x, p.y), p.x, p.y); p.fx = 1; p.fy = 0; p.ground = true; p.mode = "foot";
        for (let k = 0; k < 40; k++) step(s, k % 2 ? NO_INPUT : { ...NO_INPUT, buttons: BTN.interact });
        return s.pouch.materials.stormamber;
    };
    check(inStorm.planted && !outside.planted && outside.refused && amber(mid) === 1 && amber(mid - DAY_TICKS) === 0, "storm-bloom takes only when sown in a storm (and says so otherwise); storm-amber can be picked only while one blows");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
