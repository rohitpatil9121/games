/**
 * SKYFARM: check the world (GDD §5, the preamble's check-levels tool). Run after tools/make-world.mjs.
 *
 *   node tools/check-world.mjs
 *
 * 1. Layout: no two islands overlap (side by side they keep a 20 m gap; stacked, the upper one's rock clears
 *    the lower one's top by 15 m).
 * 2. Progression by glider, through the real simulation and the real air (the gates' updrafts blow only when
 *    their islands are restored, and climbing costs stamina): for each island and each neighbour within 700 m,
 *    the test pilot stands at the rim, climbs the island's own thermal if it has one, glides to the neighbour
 *    and must land on it. A breadth-first search from Hearth Isle over those glides gives what each step of the
 *    game can reach. The design (GDD §4, §5) wants:
 *      first glider, no gates      the Meadow and none of the Orchard
 *      first glider, Meadow gate   the Orchard's Kite Cliffs (sky-silk), but not all of the Orchard
 *      sky-silk, both gates        all the Orchard, and Glass Lake (frost-glass), but not all the High Rocks
 *      frost-glass, both gates     everything, the Crown included
 * 3. Sightlines: along every designed route (the wind currents) and from every island to its nearest
 *    neighbour, the next island's landmark stands at least 1° tall from the first, and no other island's rock
 *    is in the way.
 * 4. Bridges: both anchors stand on their islands, the deck climbs no more than 50 m and 15° end to end, and no
 *    other island's rock or landmark is in its way.
 * Prints a report and exits with 1 if a rule fails.
 */
import { makeWorld, WORLD, topAt, solidAt, islandUnder } from "../game/islands.js";
import { createState, step } from "../game/sim.js";
import { makePilot, pilotInput } from "../game/pilot.js";
import { TICK_RATE } from "../game/data.js";
import { activeAir } from "../game/progression.js";

const world = makeWorld(WORLD);
const isl = world.islands;
let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };

// ---------------------------------------------------------------- 1. layout
{
    const bad = [];
    for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) {
        const a = isl[i], b = isl[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        const side = d - a.reach - b.reach;
        const [lo, hi] = a.top < b.top ? [a, b] : [b, a];
        const stacked = hi.bottomZ - hi.depth * 0.4 - lo.top;
        if (side < 20 && stacked < 15) bad.push(`${a.id}/${b.id} (gap ${side.toFixed(0)} m, stacked ${stacked.toFixed(0)} m)`);
    }
    check(bad.length === 0, `no islands overlap${bad.length ? ": " + bad.join(", ") : ""}`);
}

// ---------------------------------------------------------------- 2. reachability
const STEPS = [
    { name: "first glider", glide: 9, stamina: 60, gates: [] },
    { name: "+ Meadow gate", glide: 9, stamina: 60, gates: ["mill"] },
    { name: "sky-silk", glide: 11, stamina: 90, gates: ["mill", "ogate"] },
    { name: "frost-glass", glide: 13, stamina: 120, gates: ["mill", "ogate"] },
];
const thermalOf = (a, tier) => activeAir(world, new Set(["hearth", ...tier.gates])).filter((s) => s.kind === "thermal" && Math.hypot(s.at[0] - a.x, s.at[1] - a.y) < a.radius + 60).sort((p, q) => q.top - p.top)[0];

/** can the pilot glide from a to b with this glider? returns seconds or -1 */
function glide(a, b, tier) {
    const s = createState(world), p = s.player;
    for (const g of tier.gates) s.progress.restored.add(g);
    s.air = activeAir(world, s.progress.restored);
    p.hasGlider = true; p.glide = tier.glide; p.staminaMax = tier.stamina; p.stamina = tier.stamina;
    const th = thermalOf(a, tier);
    // stand just inside a's rim, on the side facing the thermal (or b)
    const tx = th ? th.at[0] : b.x, ty = th ? th.at[1] : b.y, ang = Math.atan2(ty - a.y, tx - a.x);
    let r = a.radius * 0.8, x, y, z;
    for (; r > 2; r -= 1) { x = a.x + Math.cos(ang) * r; y = a.y + Math.sin(ang) * r; z = topAt(a, x, y); if (z > -Infinity && !solidAt(world, x, y, z + 0.6)) break; }
    p.x = x; p.y = y; p.z = z; p.mode = "foot"; p.ground = true;
    // climb only as high as the glide needs: the height lost over the distance at this glide ratio, plus a margin
    const need = b.top + (Math.hypot(b.x - a.x, b.y - a.y) - b.radius * 0.5) / tier.glide * 1.25 + 8;
    const climb = th && need > a.top - 2 ? { at: th.at, to: Math.min(th.top - 6, need) } : null;
    // land a little past the middle so the approach is over the island, not its rim
    const pilot = makePilot([{ glide: [b.x, b.y], climb, land: b.top }]);
    const start = s.tick;
    for (let i = 0; i < TICK_RATE * 240 && !pilot.done; i++) {
        step(s, pilotInput(pilot, s));
        if (s.events.some((e) => e.type === "fell")) return -1;
        if (s.events.some((e) => e.type === "land") && p.mode === "foot" && pilot.phase === "flying") {
            const on = islandUnder(world, p.x, p.y, p.z + 0.5);
            return on === b ? (s.tick - start) / TICK_RATE : -1;
        }
    }
    return -1;
}

const reachBy = [];
for (const tier of STEPS) {
    const seen = new Set(["hearth"]), queue = ["hearth"], edges = [];
    while (queue.length) {
        const a = world.byId[queue.shift()];
        for (const b of isl) {
            if (seen.has(b.id) || b === a) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 700) continue;
            const t = glide(a, b, tier);
            if (t > 0) { seen.add(b.id); queue.push(b.id); edges.push(`${a.id}→${b.id} ${t.toFixed(0)}s`); }
        }
    }
    reachBy.push(seen);
    const by = (band) => isl.filter((i) => i.band === band && seen.has(i.id)).length + "/" + isl.filter((i) => i.band === band).length;
    console.log(`  ${tier.name.padEnd(13)} reaches meadow ${by("meadow")}, orchard ${by("orchard")}, high ${by("high")}`);
    console.log(`                 ${edges.join(", ")}`);
}
const band = (b) => isl.filter((i) => i.band === b).map((i) => i.id);
check(band("meadow").every((id) => reachBy[0].has(id)) && !band("orchard").some((id) => reachBy[0].has(id)), "the first glider reaches all of the Meadow and none of the Orchard");
check(reachBy[1].has("kite") && !band("orchard").every((id) => reachBy[1].has(id)), "the Meadow gate opens the way to Kite Cliffs (sky-silk), not to all the Orchard");
check(band("orchard").every((id) => reachBy[2].has(id)) && reachBy[2].has("glass") && !band("high").every((id) => reachBy[2].has(id)), "sky-silk reaches all the Orchard and Glass Lake (frost-glass), not all the High Rocks");
check(isl.every((i) => reachBy[3].has(i.id)), "frost-glass reaches everything, the Crown included");

// ---------------------------------------------------------------- 3. sightlines
{
    const bad = [];
    const pairs = new Set();
    for (const s of world.data.air) if (s.route) pairs.add(s.route.join(">"));
    for (const a of isl) { const n = isl.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0]; pairs.add(a.id + ">" + n.id); }
    for (const key of pairs) {
        const [a, b] = key.split(">").map((id) => world.byId[id]);
        const shapes = world.shapes.get(b.id), gz = topAt(b, b.landmark.x, b.landmark.y);
        const tall = Math.max(4, ...shapes.map((s) => s.at[2] + (s.type === "box" ? s.size[2] / 2 : s.type === "cone" ? s.size[1] / 2 : s.type === "cyl" ? s.size[2] / 2 : s.size[2]) - gz));
        // trees are landmarks too: the Crown's giant, Apple Terraces' big tree, Hearth Isle's oak
        const extra = b.landmark.kind === "giant-tree" ? 42 : b.landmark.kind === "big-tree" ? 20 : b.id === "hearth" ? world.data.tree.height : 0;
        const h = Math.max(tall, extra), eye = [a.x, a.y, a.top + 1.6], top = [b.landmark.x, b.landmark.y, gz + h];
        const d = Math.hypot(top[0] - eye[0], top[1] - eye[1], top[2] - eye[2]), deg = (h / d) * 57.3;
        let blocked = null;
        for (let t = 0.04; t < 0.96 && !blocked; t += 0.01) {
            const x = eye[0] + (top[0] - eye[0]) * t, y = eye[1] + (top[1] - eye[1]) * t, z = eye[2] + (top[2] - eye[2]) * t;
            const s = solidAt(world, x, y, z);
            if (s && s !== a && s !== b) blocked = s.id;
        }
        if (deg < 1 || blocked) bad.push(`${a.id}→${b.id} ${deg.toFixed(1)}°${blocked ? " behind " + blocked : ""}`);
    }
    check(bad.length === 0, `every neighbour's landmark is ≥ 1° tall and in sight${bad.length ? " (not: " + bad.join(", ") + ")" : ""}`);
}

// ---------------------------------------------------------------- 4. bridges
{
    const { onBridge } = await import("../game/progression.js");
    const { boxAt } = await import("../game/islands.js");
    const bad = [];
    for (const b of world.data.bridges) {
        const [p, q] = b.ends, A = world.byId[b.a], B = world.byId[b.b];
        const onA = Math.abs(topAt(A, p[0], p[1]) - p[2]) < 0.05, onB = Math.abs(topAt(B, q[0], q[1]) - q[2]) < 0.05;
        const rise = Math.abs(q[2] - p[2]), deg = Math.atan2(rise, Math.hypot(q[0] - p[0], q[1] - p[1])) * 57.3;
        let hit = null;
        for (let t = 0.03; t < 0.97 && !hit; t += 0.005) {
            const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = onBridge(b, x, y).z + 0.5;
            const rock = solidAt(world, x, y, z), box = boxAt(world, x, y, z, 0.4, 1.6);
            if ((rock && rock !== A && rock !== B) || box) hit = rock ? rock.id : "a landmark";
            if (rock && (rock === A || rock === B) && t > 0.1 && t < 0.9) hit = rock.id + " (its own rock, mid-span)";
        }
        if (!onA || !onB || rise > 50 || deg > 15 || hit) bad.push(`${b.id} ${b.a}-${b.b}${!onA || !onB ? " anchor off the ground" : ""}${rise > 50 || deg > 15 ? ` climbs ${rise.toFixed(0)} m (${deg.toFixed(0)}°)` : ""}${hit ? " through " + hit : ""}`);
    }
    const spans = world.data.bridges.map((b) => b.length);
    check(bad.length === 0, `12 bridges, ${Math.min(...spans).toFixed(0)}–${Math.max(...spans).toFixed(0)} m, anchored, none steeper than 15° or through rock${bad.length ? ": " + bad.join("; ") : ""}`);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
