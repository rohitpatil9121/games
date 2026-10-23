/**
 * SKYFARM: make the world (GDD §5): 20 islands in three altitude bands, generated from a fixed seed and then
 * hand-tuned, written out as data (game/world-data.js) so the world is the same for everyone and can be designed.
 *
 *   node tools/make-world.mjs          # writes game/world-data.js; run tools/check-world.mjs after
 *
 * Three layers, in order:
 *   SKELETON   the design: each island's band, rough place, size, landmark and role (the GDD §5 table)
 *   generate   seeded detail from WORLD_SEED: small offsets so nothing sits on a grid, island seeds, hills,
 *              depth of the hanging rock, a thermal off each island's sunny (south) rim, small trees
 *   OVERRIDES  hand-tuning applied last (Hearth Isle and Daisy Step stay exactly as stage 1 measured them;
 *              gate updrafts; the wind currents along the routes)
 * The procedural-gen rule (`procedural-gen` skill): one seeded generator threaded through, no Math.random.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeRandom } from "../game/det.js";

const WORLD_SEED = 20261023;

/** the design: [id, name, band, x, y, top, radius, landmark, role] */
const SKELETON = [
    ["hearth", "Hearth Isle", "meadow", 0, 0, 60, 30, "windmill-small", "home"],
    ["daisy", "Daisy Step", "meadow", 150, 34, 46, 21, "stones", "first glide, rope-grass"],
    ["willow", "Willow Pond", "meadow", 175, -190, 80, 34, "waterfall", "sunflower, fish, first bridge"],
    ["fluff", "Fluff Downs", "meadow", -40, 235, 70, 38, "arch", "fluffball pasture"],
    ["bell", "Bell Rock", "meadow", 335, 105, 95, 17, "bell", "hermit Ona, Meadow Old Seed"],
    ["hollow", "Hollow Log", "meadow", -195, -175, 30, 22, "log", "secret, moon-bean"],
    ["mill", "Old Mill", "meadow", 405, -110, 110, 32, "windmill", "Meadow gate"],
    ["apple", "Apple Terraces", "orchard", 610, 60, 220, 42, "big-tree", "apple, berries"],
    ["dock", "Merchant Dock", "orchard", 650, -210, 240, 30, "dock", "the airship moors here"],
    ["kite", "Kite Cliffs", "orchard", 800, 190, 270, 28, "kites", "hermit Pell, sky-silk"],
    ["pear", "Pear Hollow", "orchard", 850, -60, 230, 34, "chapel", "sky pine, ruins secret"],
    ["twin", "Twin Isles", "orchard", 1000, 130, 250, 24, "broken-arch", "cloud-cotton"],
    ["hive", "Beehive Spire", "orchard", 920, -270, 300, 26, "hive", "hermit Mabel, Orchard Old Seed"],
    ["ogate", "Orchard Gate", "orchard", 1110, -110, 320, 30, "bell-tower", "Orchard gate"],
    ["frost", "Frost Shelf", "high", 1270, 10, 430, 30, "crystals", "frost-mint, high garden"],
    ["eagle", "Eagle Roost", "high", 1370, -200, 480, 18, "needle", "hermit Tor"],
    ["glass", "Glass Lake", "high", 1440, 150, 460, 36, "crater", "frost-glass"],
    ["storm", "Storm Teeth", "high", 1580, -120, 520, 26, "spires", "storm-bloom, storm-amber"],
    ["lantern", "Lantern Ruins", "high", 1670, 130, 560, 28, "dome", "hermit Iris, High Old Seed"],
    ["crown", "Crown", "high", 1830, 10, 650, 42, "giant-tree", "the ending"],
];

/** hand-tuning, applied after generation */
const OVERRIDES = {
    hearth: { x: 0, y: 0, top: 60, radius: 30, depth: 34, seed: 11, hills: 1.6 },
    daisy: { x: 150, y: 34, top: 46, radius: 21, depth: 26, seed: 23, hills: 1.2, landmark: { kind: "stones", x: 150, y: 34, r: 5.2, n: 7 } },
};
/** the band climates: grass tint, rock tint, tree kind, hill height */
export const BANDS = {
    meadow: { grass: [1, 1, 1], rock: [1, 1, 1], trees: "oak", treeCount: [1, 3], hills: 1.6 },
    orchard: { grass: [1.08, 1.02, 0.85], rock: [1.04, 0.98, 0.9], trees: "apple", treeCount: [3, 6], hills: 2.0 },
    high: { grass: [0.82, 0.92, 1.05], rock: [0.9, 0.95, 1.05], trees: "pine", treeCount: [0, 3], hills: 2.6 },
};

/** the wind currents along the routes the level design wants (GDD §5): from, to, by island id; speed */
const ROUTES = [["hearth", "daisy", 5], ["daisy", "bell", 6], ["willow", "mill", 6], ["fluff", "hearth", 5], ["bell", "mill", 6],
    ["apple", "kite", 8], ["dock", "pear", 8], ["pear", "twin", 9], ["hive", "ogate", 9],
    ["frost", "glass", 10], ["eagle", "storm", 11], ["glass", "lantern", 11], ["lantern", "crown", 12]];
/** gates: a strong updraft beside the island that reaches the next band (stage 5 makes it wait for restoration) */
/** how far above its island a thermal reaches, per band: enough to reach the band's highest island from its lowest */
const THERMAL_CLIMB = { meadow: 70, orchard: 120, high: 130 };
const GATES = { mill: { to: 290, rise: 5.5 }, ogate: { to: 500, rise: 6 } };

/** seeds lying on each island (GDD §4: found, not bought; each band has its own); [crop, count] */
const SEEDS = {
    willow: [["sunflower", 2]], fluff: [["turnip", 2], ["skypine", 1]], bell: [["ropegrass", 2], ["sunflower", 1]], hollow: [["moonbean", 2]], mill: [["ropegrass", 2], ["skypine", 1]],
    apple: [["apple", 1], ["berry", 1]], dock: [["berry", 2]], kite: [["cotton", 1]], pear: [["skypine", 2]], twin: [["cotton", 2]], hive: [["sunflower", 2]], ogate: [["berry", 1], ["skypine", 1]],
    frost: [["frostmint", 3]], eagle: [["frostmint", 1]], glass: [["starlily", 1]], storm: [["stormbloom", 1]], lantern: [["starlily", 1]], crown: [["frostmint", 2]],
};
/** gardens you can till away from home (stage 5 asks for the island to be bridged first): 7 x 5 m each */
const GARDENS = ["willow", "apple", "frost"];

/**
 * The bridges (GDD §5, 12 of them, inside each band; none climbs more than 50 m). Building one restores both ends.
 * Islands no bridge reaches (Hollow Log, Kite Cliffs, the Crown) are restored by waking the heart at their landmark.
 */
const BRIDGES = [["hearth", "daisy"], ["hearth", "willow"], ["hearth", "fluff"], ["willow", "mill"], ["mill", "bell"],
    ["apple", "pear"], ["dock", "pear"], ["pear", "twin"], ["hive", "ogate"],
    ["frost", "glass"], ["eagle", "storm"], ["storm", "lantern"]];
/** the rare materials that upgrade the glider (GDD §4), lying near these islands' landmarks */
const MATERIALS = { kite: "skysilk", glass: "frostglass", storm: "stormamber" };
/** where the merchant's airship moors (off Hearth Isle's east rim) and where Captain Bram stands to trade */
const MERCHANT = { moor: [38, -25, 63], gangway: [22, -17.5] };

const rand = makeRandom(WORLD_SEED);
const islands = SKELETON.map(([id, name, band, x, y, top, radius, landmark, role]) => {
    const B = BANDS[band];
    const isl = {
        id, name, band, role,
        x: Math.round(x + (rand() - 0.5) * 24), y: Math.round(y + (rand() - 0.5) * 24), top,
        radius: Math.round(radius * (0.92 + rand() * 0.16)), seed: 100 + Math.floor(rand() * 9000),
        hills: +(B.hills * (0.7 + rand() * 0.6)).toFixed(2), landmark: { kind: landmark },
    };
    isl.depth = Math.round(isl.radius * (0.95 + rand() * 0.4) + (band === "high" ? 12 : 0));
    Object.assign(isl, structuredClone(OVERRIDES[id] || {}));
    // the landmark stands a little off-centre, on a flat pad; trees go elsewhere
    const la = rand() * Math.PI * 2, lr = id === "hearth" ? 0 : isl.radius * (landmark === "waterfall" ? 0.62 : 0.2 + rand() * 0.15);
    isl.landmark.x = +(isl.x + Math.cos(la) * lr).toFixed(1); isl.landmark.y = +(isl.y + Math.sin(la) * lr).toFixed(1);
    if (landmark === "waterfall") isl.landmark.angle = +la.toFixed(3);
    // Daisy Step keeps stage 1's stone ring where the first-loop tests and the pilot expect it
    if (id === "daisy") isl.landmark = structuredClone(OVERRIDES.daisy.landmark);
    isl.flats = id === "hearth" ? [{ x: -6, y: -2, r: 7 }, { x: 6, y: -1, r: 6 }, { x: 4, y: 9, r: 3.5 }] : [{ x: isl.landmark.x, y: isl.landmark.y, r: Math.min(8, isl.radius * 0.3) }];
    // water: Willow Pond's pond runs out in a stream to the rim, where it falls (GDD §5); Glass Lake fills its crater
    // (a capsule: from x0,y0 to x1,y1, radius r, depth below the water's edge; level is filled in by prepare())
    if (landmark === "waterfall") {
        const a = isl.landmark.angle, rim = isl.radius * 1.1;
        isl.ponds = [{ x0: isl.landmark.x, y0: isl.landmark.y, x1: isl.landmark.x, y1: isl.landmark.y, r: 6.5, depth: 1.3 },
            { x0: +(isl.landmark.x + Math.cos(a) * 5.5).toFixed(1), y0: +(isl.landmark.y + Math.sin(a) * 5.5).toFixed(1), x1: +(isl.x + Math.cos(a) * rim).toFixed(1), y1: +(isl.y + Math.sin(a) * rim).toFixed(1), r: 1.6, depth: 0.7, stream: true }];
    } else if (landmark === "crater") isl.ponds = [{ x0: isl.landmark.x, y0: isl.landmark.y, x1: isl.landmark.x, y1: isl.landmark.y, r: 9.5, depth: 2.2 }];
    const [t0, t1] = B.treeCount, trees = [];
    const nt = id === "hearth" ? 0 : t0 + Math.floor(rand() * (t1 - t0 + 1));
    for (let k = 0, tries = 0; k < nt && tries < 60; tries++) {
        const a = rand() * Math.PI * 2, r = isl.radius * (0.3 + rand() * 0.45), tx = isl.x + Math.cos(a) * r, ty = isl.y + Math.sin(a) * r;
        if (Math.hypot(tx - isl.landmark.x, ty - isl.landmark.y) < 10 || trees.some((t) => Math.hypot(t.x - tx, t.y - ty) < 9)) continue;
        trees.push({ x: +tx.toFixed(1), y: +ty.toFixed(1), seed: Math.floor(rand() * 9999), height: +(B.trees === "pine" ? 7 + rand() * 4 : B.trees === "apple" ? 7 + rand() * 3 : 9 + rand() * 5).toFixed(1), kind: B.trees });
        k++;
    }
    isl.trees = trees;
    return isl;
});
const by = Object.fromEntries(islands.map((i) => [i.id, i]));

// the air: a thermal off each island's sunny (south) rim, a little upwind; gates reach the next band
const air = [];
for (const isl of islands) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 0.9, d = isl.radius + 16 + rand() * 8;
    const gate = GATES[isl.id];
    air.push({ kind: "thermal", island: isl.id, at: [Math.round(isl.x + Math.cos(a) * d), Math.round(isl.y + Math.sin(a) * d)], radius: gate ? 24 : 18 + Math.round(rand() * 5),
        bottom: 0, top: gate ? gate.to : isl.top + THERMAL_CLIMB[isl.band] + Math.round(rand() * 25), rise: gate ? gate.rise : +(2.8 + rand() * 0.9).toFixed(2), riseTop: gate ? gate.rise - 1 : +(2 + rand() * 0.6).toFixed(2), ...(gate ? { gate: isl.id } : {}) });
}
for (const [a, b, speed] of ROUTES) {
    const A = by[a], B = by[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    // from just off A's rim to just short of B's, sloping down from A's top to B's (a glide path with a tailwind)
    air.push({ kind: "current", from: [Math.round(A.x + ux * (A.radius - 6)), Math.round(A.y + uy * (A.radius - 6)), A.top], to: [Math.round(B.x - ux * (B.radius - 18)), Math.round(B.y - uy * (B.radius - 18)), Math.max(B.top + 4, A.top - (d / 14))], radius: 12, speed, route: [a, b] });
}
// Hearth's own thermal and current exactly as stage 1 tuned them
const hearthAir = [
    { kind: "thermal", island: "hearth", at: [-50, 6], radius: 18, bottom: 0, top: 120, rise: 3.2, riseTop: 2.2 },
    { kind: "thermal", island: "daisy", at: [184, 58], radius: 18, bottom: 0, top: 110, rise: 3.4, riseTop: 2.4 },
    { kind: "current", from: [24, 6, 60], to: [132, 30, 50], radius: 11, speed: 5, route: ["hearth", "daisy"] },
];
const finalAir = [...hearthAir, ...air.filter((s) => !(s.island === "hearth" || s.island === "daisy" || (s.route && s.route[0] === "hearth" && s.route[1] === "daisy")))];

// seed caches and gardens need the islands' real shapes (and their landmarks' solids) to stay clear of them
const { prepare, topAt } = await import("../game/islands.js");
const { landmarkShapes, shapeBox } = await import("../game/landmarks.js");
const items = [], gardens = [];
for (const raw of islands) {
    const I = prepare(structuredClone(raw)), solids = landmarkShapes(I, (x, y) => topAt(I, x, y)).filter((s) => s.solid).map(shapeBox);
    const clear = (x, y, pad) => topAt(I, x, y) > -Infinity && Math.hypot(x - I.x, y - I.y) < I.radius - 4
        && !solids.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad)
        && !(I.ponds || []).some((p) => Math.hypot(x - p.x0, y - p.y0) < p.r + pad + 2 || Math.hypot(x - p.x1, y - p.y1) < p.r + pad + 2)
        && !(I.trees || []).some((t) => Math.hypot(x - t.x, y - t.y) < pad + 2);
    if (GARDENS.includes(I.id)) {
        for (let k = 0; k < 40; k++) {
            const a = Math.atan2(I.y - I.landmark.y, I.x - I.landmark.x) + (k % 2 ? 1 : -1) * k * 0.15, r = I.radius * 0.3;
            const cx = Math.round(I.x + Math.cos(a) * r), cy = Math.round(I.y + Math.sin(a) * r);
            const g = { island: I.id, x0: cx - 3, y0: cy - 2, x1: cx + 3, y1: cy + 2 };
            let ok = true;
            for (let y = g.y0; y <= g.y1 + 1 && ok; y++) for (let x = g.x0; x <= g.x1 + 1 && ok; x++) ok = clear(x, y, 0.6);
            if (ok) { gardens.push(g); break; }
        }
    }
    for (const [cropId, count] of SEEDS[I.id] || []) {
        for (let k = 0; k < 80; k++) {
            const a = rand() * Math.PI * 2, r = I.radius * (0.15 + rand() * 0.55), x = +(I.x + Math.cos(a) * r).toFixed(1), y = +(I.y + Math.sin(a) * r).toFixed(1);
            const inGarden = gardens.some((g) => g.island === I.id && x > g.x0 - 1 && x < g.x1 + 2 && y > g.y0 - 1 && y < g.y1 + 2);
            if (!clear(x, y, 1.2) || inGarden || items.some((it) => Math.hypot(it.x - x, it.y - y) < 4)) continue;
            items.push({ kind: "seed", crop: cropId, count, x, y, z: 0.3, island: I.id });
            break;
        }
    }
}

// bridges: an anchor just inside each island's rim, on the line between them (stage 1's flats don't matter: the
// deck starts at the ground there); the cost grows with the span
const bridges = BRIDGES.map(([a, b], i) => {
    const A = prepare(structuredClone(by[a])), B = prepare(structuredClone(by[b]));
    const end = (P, Q) => {
        const ang = Math.atan2(Q.y - P.y, Q.x - P.x);
        let r = P.radius;
        for (; r > 2; r -= 0.5) { const x = P.x + Math.cos(ang) * r, y = P.y + Math.sin(ang) * r; if (topAt(P, x, y) > -Infinity && Math.hypot(x - P.x, y - P.y) < P.radius * 0.97) break; }
        r -= 1.5;
        const x = P.x + Math.cos(ang) * r, y = P.y + Math.sin(ang) * r;
        return [+x.toFixed(2), +y.toFixed(2), +topAt(P, x, y).toFixed(2)];
    };
    const ea = end(A, B), eb = end(B, A), len = Math.hypot(eb[0] - ea[0], eb[1] - ea[1], eb[2] - ea[2]);
    return { id: "b" + (i + 1), a, b, ends: [ea, eb], length: +len.toFixed(1), cost: { rope: Math.ceil(len / 10), planks: Math.ceil(len / 10), fittings: Math.ceil(len / 30) } };
});
// hearts: a small glowing stone beside each landmark (what you touch to wake an island no bridge reaches)
const hearts = islands.map((i) => {
    const I = prepare(structuredClone(i)), a = Math.atan2(i.y - i.landmark.y, i.x - i.landmark.x) || 0.5;
    const x = +(i.landmark.x + Math.cos(a) * 6).toFixed(1), y = +(i.landmark.y + Math.sin(a) * 6).toFixed(1);
    return { island: i.id, x, y, z: +topAt(I, x, y).toFixed(2), bridged: BRIDGES.some(([p, q]) => p === i.id || q === i.id) };
});
for (const [island, material] of Object.entries(MATERIALS)) {
    const h = hearts.find((q) => q.island === island);
    items.push({ kind: "material", material, count: 1, x: +(h.x + 1.5).toFixed(1), y: +(h.y + 1).toFixed(1), z: 0.5, island });
}

const out = `/**
 * SKYFARM: the world as data. GENERATED by tools/make-world.mjs (seed ${WORLD_SEED}); don't edit by hand,
 * change the skeleton or the overrides there and run it again (then tools/check-world.mjs).
 * @module game/world-data
 */
export const BANDS = ${JSON.stringify(BANDS)};
export const ISLANDS = ${JSON.stringify(islands, null, 0).replace(/\},\{"id"/g, '},\n    {"id"')};
export const AIR = ${JSON.stringify(finalAir).replace(/\},\{"kind"/g, '},\n    {"kind"')};
export const ITEMS = ${JSON.stringify(items)};
export const GARDENS = ${JSON.stringify(gardens)};
export const BRIDGES = ${JSON.stringify(bridges)};
export const HEARTS = ${JSON.stringify(hearts)};
export const MERCHANT = ${JSON.stringify(MERCHANT)};
`;
const file = fileURLToPath(new URL("../game/world-data.js", import.meta.url));
writeFileSync(file, out);
console.log(`wrote ${file}: ${islands.length} islands, ${items.length} seed caches, ${gardens.length} gardens, ${finalAir.filter((s) => s.kind === "thermal").length} thermals, ${finalAir.filter((s) => s.kind === "current").length} currents, ${islands.reduce((n, i) => n + i.trees.length, 0)} trees`);
