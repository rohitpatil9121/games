import { Game, Camera, PostFX } from "../engine/index.js";
import { TICK_RATE, CROPS, STAMINA, GLIDE } from "./data.js";
import { quantizeYaw } from "./det.js";
import { makeWorld, WORLD, topAt } from "./islands.js";
const topAtPlot = (isl, ix, iy) => topAt(isl, ix + 0.5, iy + 0.5);
import { createState, step, dayT, dayNumber } from "./sim.js";
import { World } from "./world.js";
import { Rig } from "./camera.js";
import { Controls, defaultBindings, keyHint, ACTIONS } from "./controls.js";
import { SaveStore } from "./save.js";
import { Tutorial } from "./tutorial.js";
import { settingsScreen, slotsScreen, gamepadMenus } from "./menus.js";
import { setCueScheme } from "./gfx/cues.js";
import { makePilot, pilotInput, firstLoopPlan } from "./pilot.js";
import { makeGradeLut } from "./gfx/grade.js";
import { sell, buy, materials, nextMerchantDay, merchantAt } from "./progression.js";
import { talkTo } from "./dialogue.js";
import { weatherOf } from "./farm.js";
import { shared } from "./gfx/common.js";
import { Sound } from "./sound.js";
import { islandUnder } from "./islands.js";
import { finishTalk } from "./sim.js";
import { TRADE } from "./data.js";

/**
 * SKYFARM: the application. Screens, the camera, and the wiring between the parts. The game lives in sim.js,
 * the scene in world.js, saving in save.js, the menus in menus.js, the first five minutes in tutorial.js.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
// the profile (settings, bindings, tips) and the saved farms (save.js)
const store = new SaveStore();
const profile = store.profile();
const settings = profile.settings;
{
    // bindings: keep the player's, add any action that is new since they saved
    const d = defaultBindings();
    settings.bindings = { ...d, ...(settings.bindings || {}) };
    for (const a of ACTIONS) if (!Array.isArray(settings.bindings[a.id])) settings.bindings[a.id] = d[a.id];
}
const systemReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** what the camera and the effects read: the settings with "as the system says" worked out (applySettings) */
const comfort = { reducedMotion: false, reducedRoll: false, reducedFov: false };

// ------------------------------------------------------------------ engine
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false, camera: new Camera({ mode: "orbit", fov: 58, near: 0.15, far: 6500 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
// one final-image path (GDD §0): HDR scene → soft bloom → exposure → ACES → the Ghibli grade LUT → vignette
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.6, knee: 0.6, intensity: 0.32, radius: 1.2 }, exposure: 1.3, tonemap: "aces", lut: makeGradeLut(1), lutAmount: 1, vignette: 0.16, grain: 0.012, contrast: 1, saturation: 1 });

const world = makeWorld(WORLD);
// quality tier (GDD §11): low / medium / high from the settings; "auto" is Low on a phone or tablet, Medium
// otherwise; ?quality= overrides (the tools)
const asked = new URLSearchParams(location.search).get("quality");
const quality = ["low", "medium", "high"].includes(asked) ? asked : settings.quality !== "auto" ? settings.quality : matchMedia("(pointer: coarse)").matches ? "low" : "medium";
renderer.setQuality(quality === "low" ? "low" : quality === "high" ? "high" : "medium");
const view3d = new World(game, world, { quality });
const controls = new Controls(input, canvas, settings);
const rig = new Rig(camera);
let state = createState(world, { assist: settings.assist });
// build what is near the bed before the first frame (everything further streams in while you play)
view3d.stream.settle([state.player.x, state.player.y, state.player.z + 2]);
/** the player's pose last tick, for drawing between ticks */
const prev = { x: 0, y: 0, z: 0, yaw: 0 };
const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, glide: 0, fx: 1, fy: 0, speed: 0 };
let pilot = null;
/** a fixed camera for the baseline views (tools/views.mjs): { eye, target } or null */
let shot = null;

// ------------------------------------------------------------------ sound (sound.js): effects, wind, rain, birds, the score, captions
const sound = new Sound({ volume: settings.volume });
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => sound.start(), { once: true });
let captionTimer = 0;
sound.onCaption = (text, seconds) => { $("caption").textContent = text; $("caption").classList.add("on"); captionTimer = seconds; };

// ------------------------------------------------------------------ screens
let screen = "title", backTo = "title";
/** a game has started this visit (so there is something to save) */
let started = false;
function show(name) {
    if (name === "settings" || name === "slots") backTo = screen === "settings" || screen === "slots" ? backTo : screen;
    screen = name;
    $("title").hidden = name !== "title";
    $("pause").hidden = name !== "pause";
    $("settings").hidden = name !== "settings";
    $("slots").hidden = name !== "slots";
    $("trade").hidden = name !== "trade";
    $("talk").hidden = name !== "talk";
    $("ending").hidden = name !== "ending";
    $("hud").hidden = name === "title" || ((name === "settings" || name === "slots") && backTo === "title");
    controls.active = name === "play";
    controls.showTouch(name === "play");
    if (name !== "play") for (const code of [...input.down]) input.release(code);
    // focus where a keyboard or gamepad player expects it
    const first = { title: "start", pause: "resume", settings: "settings-back", slots: "slots-back", trade: "trade-close", ending: "ending-close" }[name];
    if (first) $(first).focus({ preventScroll: true });
    if (name === "settings") $("settings").querySelector(".panel").scrollTop = 0;
    if (name === "title") titleButtons();
}
function lockMouse() {
    if (controls.coarse) return;
    try { const a = canvas.requestPointerLock(); if (a && a.catch) a.catch(() => {}); } catch { /* not available */ }
}
function play() { started = true; show("play"); lockMouse(); canvas.focus(); }

// ------------------------------------------------------------------ saving: the autosave on sleep, every few minutes and on leaving
let sinceSave = 0;
function autosave() {
    if (!started) return true;
    sinceSave = 0;
    const ok = store.save(0, state);
    if (!ok) notice("Couldn't save: the browser's storage is full or blocked.");
    return ok;
}
let profileTimer = 0;
/** the profile is written a moment after the last change (a slider sends many) */
function persist() { clearTimeout(profileTimer); profileTimer = setTimeout(() => store.storeProfile(profile), 300); }
addEventListener("visibilitychange", () => { if (document.hidden) { autosave(); store.storeProfile(profile); } });
addEventListener("pagehide", () => { autosave(); store.storeProfile(profile); });

/** Put a loaded game in place: the camera jumps, the world around it is built, the sim carries on. */
function begin(next) {
    state = next;
    state.assist = settings.assist;
    const p = state.player;
    prev.x = p.x; prev.y = p.y; prev.z = p.z;
    view3d.stream.settle([p.x, p.y, p.z + 2]);
    tutorial.skipFor(state);
    persist();
}
function loadSlot(n) {
    const g = store.load(n, world);
    if (!g) return false;
    begin(g);
    play();
    return true;
}
// the title: Continue if there's an autosave, else a new farm
let confirmNew = false;
function titleButtons() {
    const auto = store.peek(0);
    $("start").textContent = started ? "Back to the sky" : auto ? `Continue (day ${auto.day})` : "Wake up";
    $("new-game").hidden = !auto && !started;
    $("open-load").disabled = ![0, 1, 2, 3].some((n) => store.peek(n));
    $("new-confirm").hidden = true; confirmNew = false;
    const k = hint;
    $("title-keys").textContent = controls.coarse ? "Drag to look · the stick to walk and to steer the glider · Jump, and again in the air to glide · Use · Seed for the next seed" : `Mouse to look · ${k("forward")}${k("left")}${k("back")}${k("right")} to walk and to steer the glider · ${k("jump")} to jump, and again in the air to glide · ${k("interact")} to use · ${k("cycle")} for the next seed`;
}
$("start").addEventListener("click", () => { if (!started && store.peek(0) && loadSlot(0)) return; play(); });
$("new-game").addEventListener("click", () => {
    if (!confirmNew) { confirmNew = true; $("new-confirm").hidden = false; return; }
    begin(createState(world, { assist: settings.assist }));
    play();
    autosave();
});
$("resume").addEventListener("click", play);
$("touch-pause").addEventListener("click", () => { if (screen === "play") show("pause"); });
$("to-title").addEventListener("click", () => { autosave(); show("title"); });
const slots = slotsScreen({ store, canSave: () => started && backTo === "pause", save: (n) => store.save(n, state), load: loadSlot, back: () => show(backTo) });
$("open-load").addEventListener("click", () => { show("slots"); slots.open(); });
$("open-save").addEventListener("click", () => { show("slots"); slots.open(); });
for (const id of ["open-settings", "open-settings-2"]) $(id).addEventListener("click", () => show("settings"));
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && screen === "play" && !controls.coarse) show("pause"); });
addEventListener("keydown", (e) => {
    if (e.code === "Escape" && screen === "play" && controls.coarse) show("pause");
    else if (e.code === "Escape" && (screen === "settings" || screen === "slots") && !menus.capturing) show(backTo);
});
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
    if (tutorial.events(state.events, (x, y, z) => islandUnder(world, x, y, z)?.id || "", state.player)) persist();
    if (input.wasPressed("pause") && screen === "play") show("pause");
    if (screen === "play" && (sinceSave += 1 / TICK_RATE) > 180) autosave();
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
        sound.play(e.type === "land" && e.hard ? "bump" : e.type);
    }
    if (e.type === "jump" || e.type === "boost") sound.play(e.type, 0.8);
    else if (e.type === "sold" || e.type === "bought") sound.play("coins");
    else if (e.type === "upgraded" || e.type === "restored" || e.type === "bridge-built") sound.play("win", 0.6);
    else if (e.type === "plank") { const b = world.data.bridges.find((q) => q.id === e.bridge); if (b) { const [A, B] = b.ends; sound.at("hammer", A[0] + (B[0] - A[0]) * e.t, A[1] + (B[1] - A[1]) * e.t, A[2] + (B[2] - A[2]) * e.t, 0.7); } }
    else if (e.type === "sprite-arrives") { sound.at("sprite", e.x, e.y, p.z + 1); sound.caption("[A sprite chimes]"); }
    else if (e.type === "gust") sound.caption("[A gust hits]", 1.5);
    if (e.type === "needs-storm") notice("Storm-bloom only takes if it's sown while a storm blows.");
    if (e.type === "pick") notice(e.kind === "glider" ? "Grandmother's glider. Jump off an edge, then jump again to open it." : `${NAMES[e.crop] || e.crop} ${e.kind === "seed" ? "seeds" : ""} ×${e.count}`);
    else if (e.type === "harvest") notice(`${PRODUCE[e.crop]} ×${e.count}${e.pollinated ? " (the sprites helped)" : ""}${e.seeds ? ", and " + (e.seeds > 1 ? e.seeds + " seeds" : "a seed") + " back" : ""}`);
    else if (e.type === "wrong-band") notice(`${NAMES[e.crop]} won't grow here. It needs a garden in ${CROPS[e.crop].grows.map((b) => BAND[b]).join(" or ")}.`);
    else if (e.type === "trade-open") openTalk("bram", true);
    else if (e.type === "talk-open") openTalk(e.who);
    else if (e.type === "gift") gift(e);
    else if (e.type === "ending") startEnding();
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
    if (e.type === "slept") autosave();
    else if (e.type === "not-tired") notice("Not tired yet. Come back after noon.");
    else if (e.type === "tired") notice("Out of breath: the glider is only a parachute now. Land and rest.");
    else if (e.type === "land" && e.hard && !comfort.reducedMotion) game.juice.shake(0.25);
    if (e.type === "land" && e.glide) p.landed = true;
}

let noticeTimer = 0;
function notice(text) { $("notice").textContent = text; $("notice").classList.add("on"); noticeTimer = 3.2; }
function fade(text) { const f = $("fade"); f.textContent = text; f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }

const DOES = { till: "Till", plant: "Plant", water: "Water", harvest: "Harvest", pick: "Pick up", sleep: "Sleep", cook: "Cook", stove: "Stove",
    upgrade: "Fit to the glider", trade: "Trade with Captain Bram", talk: "Talk", wake: "Wake the heart stone", build: "Build the bridge", bridge: "Look at the broken bridge" };
// ------------------------------------------------------------------ keeping 60 fps (the settings' "keep 60 fps")
// The tiers are measured at 1280 x 720 (QA.md); a bigger window or a high-DPI screen multiplies the pixels, and
// pixels are most of the cost. So the drawing buffer's scale follows the frame time: if most of the last second
// was slower than 55 fps it steps down (to 0.55 at least), and after 6 s of comfortable frames it steps back up,
// but not above where it last had to come down from for half a minute, so it doesn't hunt.
// (on a phone Low starts at the screen's CSS pixels, not three quarters of them: 0.75 of a phone is blurry,
// and the scale comes down anyway if the phone can't keep up)
const dynMax = controls.coarse && quality === "low" ? 1 / 0.75 : 1;
const dyn = { frames: [], scale: dynMax, ceiling: dynMax, ceilingFor: 0, calm: 0 };
renderer.resolutionScale = dynMax; renderer.resize();
/** the control for an action as this player knows it: a key ("E"), or the touch button ("Use") */
const TOUCH = { interact: "Use", jump: "Jump", cycle: "Seed", steer: "the stick (push it up to dive)" };
function hint(id) { return controls.coarse ? TOUCH[id] ?? "" : keyHint(settings.bindings, id); }
document.documentElement.classList.toggle("touch", controls.coarse);
function keepFrameRate(dt) {
    if (!settings.dynamicResolution || shot || document.hidden) { if (renderer.resolutionScale !== dynMax && !settings.dynamicResolution) { renderer.resolutionScale = dynMax; dyn.scale = dynMax; renderer.resize(); } return; }
    if (dt > 0.25) return; // a stall (a tab switch, a load), not the frame rate
    const f = dyn.frames; f.push(dt);
    if (f.length < 60) return;
    const sorted = f.slice().sort((a, b) => a - b), median = sorted[30], p90 = sorted[54];
    f.length = 0;
    dyn.ceilingFor = Math.max(0, dyn.ceilingFor - 1);
    if (dyn.ceilingFor === 0) dyn.ceiling = dynMax;
    if (median > 1 / 55 && dyn.scale > 0.55) {
        dyn.ceiling = dyn.scale; dyn.ceilingFor = 30;
        dyn.scale = Math.max(0.55, dyn.scale - (median > 1 / 40 ? 0.15 : 0.07));
        dyn.calm = 0;
    } else if (p90 < 1 / 58) {
        if (++dyn.calm >= 6 && dyn.scale < dyn.ceiling) { dyn.scale = Math.min(dyn.ceiling, dyn.scale + 0.05); dyn.calm = 0; }
    } else dyn.calm = 0;
    if (renderer.resolutionScale !== dyn.scale) { renderer.resolutionScale = dyn.scale; renderer.resize(); }
}

game.onRender((dt, alpha) => {
    if (!window.__firstFrame) window.__firstFrame = performance.now();
    keepFrameRate(dt);
    controls.look(dt);
    const p = state.player, a = alpha;
    // a jump of more than a few metres in one tick is a teleport (waking up): don't draw the path between
    const tele = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) > 5;
    pose.x = tele ? p.x : prev.x + (p.x - prev.x) * a;
    pose.y = tele ? p.y : prev.y + (p.y - prev.y) * a;
    pose.z = tele ? p.z : prev.z + (p.z - prev.z) * a;
    pose.glide = p.mode === "glide" ? 1 : 0;
    pose.yaw = p.yaw; pose.pitch = p.pitch; pose.roll = comfort.reducedMotion ? p.roll * 0.3 : p.roll; pose.fx = p.fx; pose.fy = p.fy; pose.speed = p.speed;
    endingCamera(dt);
    if (shot) {
        // a fixed view: the engine's orbit camera, solved for this eye and target
        const [ex, ey, ez] = shot.eye, [tx, ty, tz] = shot.target, dx = ex - tx, dy = ey - ty, dz = ez - tz, d = Math.hypot(dx, dy, dz);
        camera.mode = "orbit"; camera.target[0] = tx; camera.target[1] = ty; camera.target[2] = tz;
        camera.distance = d; camera.yaw = Math.atan2(dy, dx); camera.pitch = Math.asin(dz / d); camera.fov = shot.fov || 55; camera.roll = 0;
        rig.eye[0] = ex; rig.eye[1] = ey; rig.eye[2] = ez;
    } else rig.update(dt, pose, controls.view, world, comfort);
    view3d.update(dt, state, pose, rig.eye);
    listen(dt);
    hud(dt);
});

// ------------------------------------------------------------------ conversations (dialogue.js; sim.js finishTalk applies what they give)
let talk = null;
function openTalk(who, thenTrade = false) {
    const t = talkTo(who, state);
    if (!t) { if (thenTrade) openTrade(); return; }
    talk = { ...t, i: 0, thenTrade };
    view3d.talking = who;
    show("talk");
    if (document.pointerLockElement) document.exitPointerLock();
    showLine();
}
function showLine() {
    $("talk-name").textContent = talk.speaker;
    $("talk-line").textContent = talk.lines[talk.i];
    $("talk-hint").textContent = talk.i < talk.lines.length - 1 ? "E / Space: next" : "E / Space: done";
    sound.play("pick", 0.6, 0.7 + Math.random() * 0.15);
}
function nextLine() {
    if (!talk) return;
    if (++talk.i < talk.lines.length) { showLine(); return; }
    const t = talk;
    talk = null; view3d.talking = "";
    finishTalk(state, t.who);
    for (const e of state.events) onEvent(e);
    state.events.length = 0;
    if (screen === "talk") { if (t.thenTrade) openTrade(); else play(); }
}
addEventListener("keydown", (e) => { if (screen === "talk" && ["KeyE", "Space", "Enter"].includes(e.code)) { e.preventDefault(); nextLine(); } else if (screen === "talk" && e.code === "Escape") { talk = null; view3d.talking = ""; play(); } });
$("talk").addEventListener("click", nextLine);
function gift(e) {
    const what = e.what === "seeds" ? `${NAMES[e.id]} seeds ×${e.n}` : e.what === "material" ? ({ oldseed_meadow: "The Meadow's Old Seed", oldseed_orchard: "The Orchard's Old Seed", oldseed_high: "The High Rocks' Old Seed" })[e.id] || e.id : "";
    if (what) notice(`Received: ${what}`);
}

// ------------------------------------------------------------------ the ending (GDD §4): the camera circles the Crown while it blooms, then a card, then free play
let ending = null;
function startEnding() {
    const c = world.byId.crown;
    ending = { t: 0, x: c.landmark.x, y: c.landmark.y, z: c.top };
    show("play");
    controls.active = false;
}
function endingCamera(dt) {
    if (!ending) return false;
    ending.t += dt;
    const k = Math.min(1, ending.t / 14), a = 0.6 + k * 2.4, r = 70 - 25 * k;
    shot = { eye: [ending.x + Math.cos(a) * r, ending.y + Math.sin(a) * r, ending.z + 20 + 18 * (1 - k)], target: [ending.x, ending.y, ending.z + 22], fov: 55 };
    // the tree blossoms over the first half of the shot
    view3d.stream.trees.elder.leaves.values.u_bloom = Math.min(1, ending.t / 7);
    // petals on the wind from the waking tree
    if (Math.random() < dt * 40) view3d.sparkle.emit(3, { position: [ending.x, ending.y, ending.z + 22 + Math.random() * 15], spread: 14, velocity: [2, 1, -0.6], speed: 1.5, life: [3, 6], size: [0.25, 0.1], color: [1.9, 1.3, 1.5, 1], colorEnd: [1.6, 1.1, 1.3, 0] });
    if (ending.t > 14 && screen !== "ending") { show("ending"); $("ending-close").focus(); }
    return true;
}
$("ending-close").addEventListener("click", () => { ending = null; shot = null; play(); });

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
    sound.play("coins");
    fillTrade();
});
addEventListener("keydown", (e) => { if (e.code === "Escape" && screen === "trade") play(); });

// the weather, the airship and the place, told to the sound; the storm's telegraph (GDD §2: clouds building, then
// the wind, a notice and a caption well before the rain)
let wasStorm = 0, wasRain = false, wasMerchant = "away", wasWarn = 0, breathIn = 0;
view3d.onThunder = (d) => sound.thunder(d);
function listen(dt) {
    const p = state.player, eye = rig.eye, isl = islandUnder(world, eye[0], eye[1], eye[2]);
    sound.listen(eye, camera.right);
    sound.update(dt, {
        speed: p.mode === "glide" ? p.speed : Math.hypot(p.vx || 0, p.vy || 0), height: eye[2], gliding: p.mode === "glide",
        raining: view3d.raining ? 1 : 0, storm: view3d.storm || 0, night: shared.u_atmoNight,
        band: isl ? isl.band : "meadow", near: isl ? Math.max(0, 1 - (eye[2] - isl.top) / 60) : 0, restored: !!isl && state.progress.restored.has(isl.id),
        talking: screen === "talk", ending: !!ending, playing: screen === "play", gustWarn: p.gustWarn || 0, gust: p.gust || 0,
    });
    const st = view3d.storm || 0;
    if (st > 0.02 && wasStorm <= 0.02 && !view3d.raining) { notice("The clouds are building. A storm is coming: better to be on the ground."); sound.caption("[Wind rising: a storm is building]", 4); }
    if (view3d.raining && !wasRain) sound.caption(st > 0.5 ? "[Heavy rain, a storm]" : "[Rain starts]", 3);
    if (p.mode === "glide" && (p.gustWarn || 0) > 0 && wasWarn === 0) sound.caption("[A gust is coming]", 1.2);
    wasStorm = st; wasRain = view3d.raining; wasWarn = p.gustWarn || 0;
    // stamina low: a soft breath every two seconds under a quarter (the ring pulses with it, style.css)
    if (p.mode === "glide" && p.stamina / STAMINA.max < 0.25 && p.stamina > 0) {
        if ((breathIn -= dt) <= 0) { if (breathIn < -1) sound.caption("[Breathing hard: land soon]", 2); breathIn = 2; sound.play("breath", 0.7); }
    } else breathIn = -2;
    const m = merchantAt(state.tick).phase;
    if (m === "arriving" && wasMerchant === "away") { const M = world.data.merchant.moor; sound.horn(M[0] + 700, M[1] - 900, M[2] + 120); }
    wasMerchant = m;
    if (captionTimer > 0 && (captionTimer -= dt) <= 0) $("caption").classList.remove("on");
}

function hud(dt) {
    const p = state.player, pouch = state.pouch;
    const does = p.does, sel = pouch.selected;
    let prompt = "";
    if (does) prompt = `${hint("interact")}  ${DOES[does]}${does === "plant" ? " " + (NAMES[sel] || "").toLowerCase() : ""}`;
    else if (p.mode === "foot" && !p.ground && p.hasGlider && p.air > 9) prompt = `${hint("jump")}  Open the glider`;
    $("prompt").textContent = prompt;
    $("prompt").classList.toggle("on", !!prompt);
    const seeds = Object.entries(pouch.seeds).filter(([, n]) => n > 0).map(([c, n]) => `<span class="${c === sel ? "sel" : ""}">${NAMES[c]} seed ×${n}</span>`);
    const crops = Object.entries(pouch.crops).filter(([, n]) => n > 0).map(([c, n]) => `<span>${PRODUCE[c]} ×${n}</span>`);
    $("pouch").innerHTML = [...seeds, ...crops].join("") || "<span class='empty'>empty pouch</span>";
    // the pouch steps aside while you glide (GDD §9)
    $("pouch").classList.toggle("away", p.mode === "glide");
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
    tutorial.show(hint, p);
}

// ------------------------------------------------------------------ test hook (the console, the tools)
window.skyfarm = {
    game, world, view: view3d, rig, controls, sound, get state() { return state; },
    store, settings, profile,
    /** open a screen as the game would ("pause", "settings", ...): for tools/ui-test.mjs */
    menu(name) { show(name); return screen; },
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
    /**
     * Jump to the middle of the next day with this weather ("rain" or "storm"), as wet as it gets, for screenshots;
     * "dry" clears what an earlier one left.
     * Returns the day.
     */
    weather(kind) {
        // "dry": no wet surfaces, no cloud left over from an earlier capture
        if (kind === "dry") { shared.u_wet = 0; view3d.overcast = 0; view3d.rainAmount = 0; return 0; }
        let day = dayNumber(state);
        while (weatherOf(state.seed, day).kind !== kind) day++;
        const w = weatherOf(state.seed, day);
        state.tick = (day - 1) * 72000 + Math.round((w.rainFrom + w.rainTo) / 2 * 72000);
        state.weather = w;
        shared.u_wet = 1; view3d.overcast = kind === "storm" ? 1.3 : 1; view3d.rainAmount = kind === "storm" ? 1 : 0.55;
        return day;
    },
    /** open a conversation (for screenshots and tests) */
    talk(who) { openTalk(who); return talk && talk.lines; },
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
    /** the resolution scale keeping 60 fps (keepFrameRate) */
    get dyn() { return { ...dyn, frames: undefined, canvas: [renderer.canvas.width, renderer.canvas.height] }; },
    /** put the camera somewhere for a screenshot */
    look(x, y, z, yaw, pitch) { const p = state.player; p.x = x; p.y = y; p.z = z; controls.view.yaw = yaw; controls.view.pitch = pitch; },
    CROPS, GLIDE,
};

// ------------------------------------------------------------------ settings into effect
const tutorial = new Tutorial(profile.tips, (text) => { $("goal").textContent = text; });
const db = (v) => (v <= 0.001 ? -80 : 20 * Math.log10(v));
/** Put the settings into effect and save the profile. Called at start and whenever one changes. */
function applySettings(changed) {
    comfort.reducedMotion = settings.reducedMotion ?? systemReducedMotion;
    comfort.reducedRoll = settings.reducedRoll; comfort.reducedFov = settings.reducedFov;
    document.documentElement.classList.toggle("reduce-motion", comfort.reducedMotion);
    rig.baseFov = settings.fov;
    view3d.setShadows(settings.shadows);
    renderer.postfx.settings.bloom.enabled = settings.bloom;
    if (!settings.dynamicResolution) { renderer.resolutionScale = dynMax; dyn.scale = dynMax; renderer.resize(); }
    sound.levels.music = db(settings.music); sound.levels.sfx = -2 + db(settings.sfx); sound.levels.ambience = -3 + db(settings.ambience);
    sound.setVolume(settings.volume);
    sound.captions = settings.captions;
    setCueScheme(settings.scheme);
    document.documentElement.classList.remove("cues-redgreen", "cues-blueyellow");
    if (settings.scheme !== "standard") document.documentElement.classList.add("cues-" + settings.scheme);
    // (the menus zoom their panel, not the whole screen, so the panel can still fit it: style.css)
    for (const id of ["hud", "talk"]) $(id).style.zoom = String(settings.textSize);
    for (const id of ["title", "pause", "settings", "slots", "trade", "ending"]) $(id).querySelector(".panel").style.zoom = String(settings.textSize);
    document.documentElement.style.setProperty("--zoom", String(settings.textSize));
    state.assist = settings.assist;
    controls.apply();
    persist();
    // a new quality tier rebuilds the world: save, then reload into it
    if (changed === "quality" && !asked) { autosave(); store.storeProfile(profile); location.reload(); }
}
const menus = settingsScreen({ settings, controls, apply: applySettings, back: () => show(backTo) });
gamepadMenus({ screen: () => screen, capturing: () => menus.capturing, back: (s) => { if (s === "settings" || s === "slots") show(backTo); else if (s === "pause") play(); } });
applySettings();

show("title");
game.start();
