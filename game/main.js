import { Game, Camera, PostFX, Audio } from "../engine/index.js";
import { TICK_RATE, CROPS, STAMINA, GLIDE } from "./data.js";
import { quantizeYaw } from "./det.js";
import { makeWorld, WORLD, topAt } from "./islands.js";
const topAtPlot = (isl, ix, iy) => topAt(isl, ix + 0.5, iy + 0.5);
import { createState, step, dayT, dayNumber } from "./sim.js";
import { World } from "./world.js";
import { Rig } from "./camera.js";
import { Controls, defaultBindings, keyHint } from "./controls.js";
import { makePilot, pilotInput, firstLoopPlan } from "./pilot.js";
import { makeGradeLut } from "./gfx/grade.js";
import { sell, buy, materials, nextMerchantDay, merchantAt } from "./progression.js";
import { TRADE } from "./data.js";

/**
 * SKYFARM: the application. Screens, the camera, and the wiring between the parts. The game lives in sim.js,
 * the scene in world.js. Stage 1: one start screen, a pause screen, a minimal HUD.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const settings = { sensitivity: 1, invertY: false, bindings: defaultBindings(), reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, reducedFov: false };

// ------------------------------------------------------------------ engine
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false, camera: new Camera({ mode: "orbit", fov: 58, near: 0.15, far: 6500 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
// one final-image path (GDD §0): HDR scene → soft bloom → exposure → ACES → the Ghibli grade LUT → vignette
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.6, knee: 0.6, intensity: 0.32, radius: 1.2 }, exposure: 1.3, tonemap: "aces", lut: makeGradeLut(1), lutAmount: 1, vignette: 0.16, grain: 0.012, contrast: 1, saturation: 1 });

const world = makeWorld(WORLD);
// quality tier (GDD §11): low / medium / high; ?quality= picks one (the settings menu arrives in stage 8)
const quality = ["low", "medium", "high"].includes(new URLSearchParams(location.search).get("quality")) ? new URLSearchParams(location.search).get("quality") : "medium";
renderer.setQuality(quality === "low" ? "low" : quality === "high" ? "high" : "medium");
const view3d = new World(game, world, { quality });
const controls = new Controls(input, canvas, settings);
const rig = new Rig(camera);
let state = createState(world);
// build what is near the bed before the first frame (everything further streams in while you play)
view3d.stream.settle([state.player.x, state.player.y, state.player.z + 2]);
/** the player's pose last tick, for drawing between ticks */
const prev = { x: 0, y: 0, z: 0, yaw: 0 };
const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, glide: 0, fx: 1, fy: 0, speed: 0 };
let pilot = null;
/** a fixed camera for the baseline views (tools/views.mjs): { eye, target } or null */
let shot = null;

// ------------------------------------------------------------------ sound (ZzFX for now; the audio pass is stage 7)
const audio = new Audio({ volume: 0.7 });
audio.define("till", [0.6, 0.1, 160, 0.01, 0.05, 0.08, 4, 0.6, , , , , , 1.2]);
audio.define("plant", [0.5, 0.05, 420, 0.005, 0.02, 0.06, 1, 1.6]);
audio.define("water", [0.35, 0.3, 900, 0.03, 0.2, 0.25, 4, 0.2, , , , , , 3, , 0.2]);
audio.define("harvest", [0.7, 0.05, 520, 0.01, 0.08, 0.2, 1, 1.4, , , 260, 0.06]);
audio.define("pick", [0.6, 0.05, 880, 0.01, 0.05, 0.25, 1, 1.8, , , 440, 0.05]);
audio.define("sprout", [0.45, 0, 1320, 0.01, 0.1, 0.35, 1, 2]);
audio.define("open", [0.5, 0.2, 300, 0.02, 0.1, 0.2, 4, 0.4, 8]);
audio.define("land", [0.5, 0.1, 110, 0.01, 0.05, 0.12, 4, 0.5]);
audio.define("bump", [0.6, 0.1, 90, 0.01, 0.05, 0.2, 4, 1.2]);
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => audio.unlock(), { once: true });

// ------------------------------------------------------------------ screens
let screen = "title";
function show(name) {
    screen = name;
    $("title").hidden = name !== "title";
    $("pause").hidden = name !== "pause";
    $("trade").hidden = name !== "trade";
    $("hud").hidden = name === "title";
    controls.active = name === "play";
    controls.showTouch(name === "play");
    if (name !== "play") for (const code of [...input.down]) input.release(code);
}
function lockMouse() {
    if (controls.coarse) return;
    try { const a = canvas.requestPointerLock(); if (a && a.catch) a.catch(() => {}); } catch { /* not available */ }
}
function play() { show("play"); lockMouse(); canvas.focus(); }
$("start").addEventListener("click", play);
$("resume").addEventListener("click", play);
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && screen === "play" && !controls.coarse) show("pause"); });
addEventListener("keydown", (e) => { if (e.code === "Escape" && screen === "play" && controls.coarse) show("pause"); });
canvas.addEventListener("click", () => { if (screen === "play" && !document.pointerLockElement) lockMouse(); });

// ------------------------------------------------------------------ the loop
game.onUpdate(() => {
    const p = state.player;
    prev.x = p.x; prev.y = p.y; prev.z = p.z; prev.yaw = p.mode === "glide" ? p.yaw : Math.atan2(p.fy, p.fx);
    let inp;
    if (pilot) { inp = pilotInput(pilot, state); if (pilot.done) pilot = null; }
    else { inp = controls.gather(); inp.yaw = quantizeYaw(controls.view.yaw); }
    step(state, inp);
    for (const e of state.events) onEvent(e);
    view3d.events(state);
});

const NAMES = Object.fromEntries(Object.entries(CROPS).map(([id, c]) => [id, c.name]));
/** what a harvest of each crop is called in the pouch */
const PRODUCE = { ...NAMES, berry: "Berries", skypine: "Sky pine logs", apple: "Apples", ropegrass: "Rope-grass fibre", cotton: "Cloud-cotton", sunflower: "Sunflowers", moonbean: "Moon-beans", starlily: "Star-lilies", stormbloom: "Storm-blooms", turnip: "Turnips", frostmint: "Frost-mint" };
const BAND = { meadow: "the Meadow", orchard: "the Orchard Isles", high: "the High Rocks (above 400 m)" };
let toldSprites = false;
function onEvent(e) {
    const p = state.player;
    if (["till", "plant", "water", "harvest", "pick", "sprout", "open", "land", "bump"].includes(e.type)) {
        audio.play(e.type === "land" && e.hard ? "bump" : e.type, { pitch: 0.95 + Math.random() * 0.1 });
    }
    if (e.type === "pick") notice(e.kind === "glider" ? "Grandmother's glider. Jump off an edge, then jump again to open it." : `${NAMES[e.crop] || e.crop} ${e.kind === "seed" ? "seeds" : ""} ×${e.count}`);
    else if (e.type === "harvest") notice(`${PRODUCE[e.crop]} ×${e.count}${e.pollinated ? " (the sprites helped)" : ""}${e.seeds ? ", and " + (e.seeds > 1 ? e.seeds + " seeds" : "a seed") + " back" : ""}`);
    else if (e.type === "wrong-band") notice(`${NAMES[e.crop]} won't grow here. It needs a garden in ${CROPS[e.crop].grows.map((b) => BAND[b]).join(" or ")}.`);
    else if (e.type === "trade-open") openTrade();
    else if (e.type === "bridge-needs") notice(`This bridge needs ${Object.entries(e.cost).map(([k, n]) => n + " " + k).join(", ")}. Still missing: ${Object.entries(e.missing).map(([k, n]) => n + " " + k).join(", ")}.`);
    else if (e.type === "build-start") notice("The bridge is going up...");
    else if (e.type === "bridge-built") notice(`The bridge is done. ${world.byId[e.b].name} is green again.`);
    else if (e.type === "restored" && e.why === "heart") notice(`${world.byId[e.island].name} wakes up.`);
    else if (e.type === "upgraded") notice(e.kind === "tier" ? `${e.name}: the glider goes further and lasts longer.` : "Storm-amber: Shift in the air gives a gust of speed.");
    else if (e.type === "cook") notice(`${e.name}: +${e.stamina} s of gliding today`);
    else if (e.type === "cant-cook") notice("Nothing to cook yet. Two turnips make a soup.");
    else if (e.type === "pollinated" && !toldSprites) { toldSprites = true; notice("A sprite is visiting your flowers. Crops near them will give more."); }
    else if (e.type === "sprout") notice(`Your ${NAMES[e.crop].toLowerCase()} has sprouted`);
    else if (e.type === "fell" || e.type === "slept") fade(e.type === "fell" ? "You wake up at home." : `Day ${dayNumber(state)}`);
    else if (e.type === "not-tired") notice("Not tired yet. Come back after noon.");
    else if (e.type === "tired") notice("Out of breath: the glider is only a parachute now. Land and rest.");
    else if (e.type === "land" && e.hard && !settings.reducedMotion) game.juice.shake(0.25);
    if (e.type === "land" && e.glide) p.landed = true;
}

let noticeTimer = 0;
function notice(text) { $("notice").textContent = text; $("notice").classList.add("on"); noticeTimer = 3.2; }
function fade(text) { const f = $("fade"); f.textContent = text; f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }

const DOES = { till: "Till", plant: "Plant", water: "Water", harvest: "Harvest", pick: "Pick up", sleep: "Sleep", cook: "Cook", stove: "Stove",
    upgrade: "Fit to the glider", trade: "Trade with Captain Bram", wake: "Wake the heart stone", build: "Build the bridge", bridge: "Look at the broken bridge" };
game.onRender((dt, alpha) => {
    if (!window.__firstFrame) window.__firstFrame = performance.now();
    controls.look(dt);
    const p = state.player, a = alpha;
    // a jump of more than a few metres in one tick is a teleport (waking up): don't draw the path between
    const tele = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) > 5;
    pose.x = tele ? p.x : prev.x + (p.x - prev.x) * a;
    pose.y = tele ? p.y : prev.y + (p.y - prev.y) * a;
    pose.z = tele ? p.z : prev.z + (p.z - prev.z) * a;
    pose.glide = p.mode === "glide" ? 1 : 0;
    pose.yaw = p.yaw; pose.pitch = p.pitch; pose.roll = settings.reducedMotion ? p.roll * 0.3 : p.roll; pose.fx = p.fx; pose.fy = p.fy; pose.speed = p.speed;
    if (shot) {
        // a fixed view: the engine's orbit camera, solved for this eye and target
        const [ex, ey, ez] = shot.eye, [tx, ty, tz] = shot.target, dx = ex - tx, dy = ey - ty, dz = ez - tz, d = Math.hypot(dx, dy, dz);
        camera.mode = "orbit"; camera.target[0] = tx; camera.target[1] = ty; camera.target[2] = tz;
        camera.distance = d; camera.yaw = Math.atan2(dy, dx); camera.pitch = Math.asin(dz / d); camera.fov = shot.fov || 55; camera.roll = 0;
        rig.eye[0] = ex; rig.eye[1] = ey; rig.eye[2] = ez;
    } else rig.update(dt, pose, controls.view, world, settings);
    view3d.update(dt, state, pose, rig.eye);
    hud(dt);
});

// ------------------------------------------------------------------ trading with Captain Bram (progression.js sell / buy)
function openTrade() { show("trade"); if (document.pointerLockElement) document.exitPointerLock(); fillTrade(); $("trade-close").focus(); }
function fillTrade() {
    const P = state.progress, pouch = state.pouch;
    $("trade-coins").textContent = `You have ${P.coins} coins, ${pouch.materials.fittings} fittings, ${pouch.materials.planks} bought planks.`;
    const sellRows = Object.entries(pouch.crops).filter(([, n]) => n > 0).map(([c, n]) => `<li>${PRODUCE[c]} ×${n} <span class="small">${CROPS[c].value} each</span> <button data-sell="${c}" data-n="1">Sell 1</button><button data-sell="${c}" data-n="${n}">All</button></li>`);
    $("trade-sell").innerHTML = sellRows.join("") || "<li class='small'>Nothing to sell yet: bring him produce.</li>";
    $("trade-buy").innerHTML = Object.entries(TRADE).map(([w, price]) => `<li>${w === "fittings" ? "Iron fittings" : "Planks"} <span class="small">${price} coins</span> <button data-buy="${w}" data-n="1">Buy 1</button><button data-buy="${w}" data-n="5">Buy 5</button></li>`).join("");
}
$("trade").addEventListener("click", (e) => {
    const b = e.target instanceof HTMLElement && e.target.closest("button");
    if (!b) return;
    if (b.dataset.sell) sell(state, b.dataset.sell, Number(b.dataset.n));
    else if (b.dataset.buy) buy(state, b.dataset.buy, Number(b.dataset.n));
    else if (b.id === "trade-close") { play(); return; }
    audio.play("pick", { pitch: 1.2 });
    fillTrade();
});
addEventListener("keydown", (e) => { if (e.code === "Escape" && screen === "trade") play(); });

function hud(dt) {
    const p = state.player, pouch = state.pouch;
    const does = p.does, sel = pouch.selected;
    let prompt = "";
    if (does) prompt = `${keyHint(settings.bindings, "interact")}  ${DOES[does]}${does === "plant" ? " " + (NAMES[sel] || "").toLowerCase() : ""}`;
    else if (p.mode === "foot" && !p.ground && p.hasGlider && p.air > 9) prompt = `${keyHint(settings.bindings, "jump")}  Open the glider`;
    $("prompt").textContent = prompt;
    $("prompt").classList.toggle("on", !!prompt);
    const seeds = Object.entries(pouch.seeds).filter(([, n]) => n > 0).map(([c, n]) => `<span class="${c === sel ? "sel" : ""}">${NAMES[c]} seed ×${n}</span>`);
    const crops = Object.entries(pouch.crops).filter(([, n]) => n > 0).map(([c, n]) => `<span>${PRODUCE[c]} ×${n}</span>`);
    $("pouch").innerHTML = [...seeds, ...crops].join("") || "<span class='empty'>empty pouch</span>";
    const t = dayT(state), hours = (6 + t * 18) % 24;
    const w = state.weather, clock = (f) => { const h = (6 + f * 18) % 24; return String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.floor((h % 1) * 60)).padStart(2, "0"); };
    const sky = w.kind === "rain" || w.kind === "storm" ? (t < w.rainFrom ? `${w.kind} at ${clock(w.rainFrom)}` : t < w.rainTo ? (w.kind === "storm" ? "storm" : "raining") : "clearing") : w.kind;
    $("clock").textContent = `Day ${dayNumber(state)} · ${clock(t)} · ${sky}`;
    const mat = materials(state), m = merchantAt(state.tick);
    $("coins").textContent = `${state.progress.coins} coins · rope ${mat.rope} · planks ${mat.planks} · fittings ${mat.fittings} · ${m.phase === "moored" ? "the airship is in" : m.phase === "arriving" ? "the airship is coming" : "airship on day " + nextMerchantDay(state.tick)}`;
    const ring = $("stamina"), frac = p.stamina / STAMINA.max;
    ring.classList.toggle("on", p.mode === "glide" && frac < 0.999);
    ring.style.setProperty("--f", String(frac));
    ring.classList.toggle("low", frac < 0.25);
    if (noticeTimer > 0 && (noticeTimer -= dt) <= 0) $("notice").classList.remove("on");
}

// ------------------------------------------------------------------ test hook (the console, the tools)
window.skyfarm = {
    game, world, view: view3d, rig, controls, get state() { return state; },
    /** start a fresh game */
    reset() { state = createState(world); },
    /** a demonstration garden: every crop at home (or in its own band's garden) at a spread of growth, for screenshots */
    demoGarden(spread = [0.1, 0.35, 0.6, 1]) {
        const ids = Object.keys(CROPS), f = world.data.field;
        let k = 0;
        for (const id of ids) {
            const band = CROPS[id].grows[0], g = band === "meadow" ? { ...f, island: "hearth" } : world.data.gardens.find((q) => world.byId[q.island].band === band);
            for (const gr of spread) {
                const ix = g.x0 + ((band === "meadow" ? k : k % 7) % (g.x1 - g.x0 + 1)), iy = g.y0 + Math.floor((band === "meadow" ? k : k % 7) / (g.x1 - g.x0 + 1)) % (g.y1 - g.y0 + 1);
                const isl = world.byId[g.island];
                state.plots.set(ix + "," + iy, { ix, iy, island: isl.id, band: isl.band, z: topAtPlot(isl, ix, iy), tilled: true, crop: id, growth: gr, watered: gr < 1, days: 0, grew: false, pollinated: false, rained: false });
                k++;
            }
        }
        return k;
    },
    /** let the test pilot play the first loop */
    autopilot() { pilot = makePilot(firstLoopPlan(world)); return true; },
    /** Run the game by hand for some seconds (the Browser pane may throttle requestAnimationFrame). */
    run(seconds) {
        const L = game.loop, raf = L._raf; L._raf = () => 0; let t = performance.now();
        for (let i = 0; i < seconds * 60; i++) { t += 1000 / TICK_RATE; L._hiddenPause = false; L.tick(t); }
        L._raf = raf; L._last = performance.now();
    },
    /** fix the camera (eye, target, fov) for a baseline view, at a time of day (fraction, 0 sunrise); null frees it */
    shot(eye, target, t, fov) {
        shot = eye ? { eye, target, fov } : null;
        if (t !== undefined) state.tick = Math.floor(state.tick / 72000) * 72000 + Math.round(t * 72000);
        return true;
    },
    /** the post chain's settings, for tuning from the console */
    get post() { return renderer.postfx.settings; },
    /** put the camera somewhere for a screenshot */
    look(x, y, z, yaw, pitch) { const p = state.player; p.x = x; p.y = y; p.z = z; controls.view.yaw = yaw; controls.view.pitch = pitch; },
    CROPS, GLIDE,
};

show("title");
game.start();
