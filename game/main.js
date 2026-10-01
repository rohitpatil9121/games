import { Game, PostFX, Sky, Audio } from "../engine/index.js";
import { LEVELS } from "./levels.js";
import { PHYS, BODY, createState, step, simulate, placementError } from "./sim.js";
import { FABRIC } from "./fabric.js";
import { World } from "./world.js";

/**
 * ORBITAL — application: screens, input, flight, progress.
 * Physics lives in sim.js, the 3D scene in world.js, rendering in the Projection Lab engine.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ save data
const SAVE_KEY = "orbital-save-v1";
const save = (() => {
    const base = { unlocked: 1, stars: {}, settings: { sfx: 0.8, music: 0.6, bloom: true, reducedMotion: null } };
    try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
        return { ...base, ...s, stars: { ...(s.stars || {}) }, settings: { ...base.settings, ...(s.settings || {}) } };
    } catch (e) { return base; }
})();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } };
const systemPrefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reducedMotion = () => save.settings.reducedMotion ?? systemPrefersReducedMotion;

// ------------------------------------------------------------------ engine setup
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, scene, camera } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 0.82, knee: 0.5, intensity: 1.05, radius: 1.35 }, exposure: 1.12, vignette: 0.36, grain: 0.028 });
scene.sky = new Sky({ uniforms: { u_nebula: 0.6 } });
scene.clearColor.set([0, 0, 0, 1]);
scene.skyColor.set([0.3, 0.36, 0.6]);
scene.groundColor.set([0.05, 0.04, 0.1]);
scene.sunDirection.set([-0.45, -0.35, 0.82]);
camera.fov = 38;
camera.far = 400;

const world = new World(game);
const audio = new Audio({ volume: 0.9, sfx: save.settings.sfx, music: save.settings.music });
// ZzFX parameter arrays: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
// deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay
audio.define("pick", [0.5, 0, 520, 0.005, 0.02, 0.09, 0, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.03])
    .define("place", [0.7, 0, 330, 0.01, 0.05, 0.28, 0, 1.6, 0, 0, 165, 0.06, 0, 0, 0, 0, 0.04, 0.7, 0.08])
    .define("invalid", [0.5, 0, 150, 0.01, 0.05, 0.14, 2, 1.2, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.05])
    .define("launch", [0.8, 0, 190, 0.03, 0.18, 0.55, 0, 1.3, 9, 0.4, 0, 0, 0, 0.2, 0, 0, 0.06, 0.6, 0.12])
    .define("dust", [0.7, 0, 990, 0.005, 0.05, 0.4, 0, 1.8, 0, 0, 495, 0.05, 0, 0, 0, 0, 0.08, 0.75, 0.1])
    .define("win", [0.9, 0, 440, 0.03, 0.4, 0.9, 0, 1.5, 0, 0, 220, 0.11, 0.11, 0, 0, 0, 0.12, 0.7, 0.2])
    .define("crash", [1, 0.05, 80, 0.01, 0.12, 0.7, 4, 1.2, -1.5, 0, 0, 0, 0, 1.6, 0, 0.25, 0, 0.5, 0.2])
    .define("swallow", [0.9, 0, 260, 0.05, 0.3, 1.1, 0, 1.2, -14, -0.3, 0, 0, 0, 0, 6, 0, 0.1, 0.6, 0.3])
    .define("lost", [0.6, 0, 300, 0.05, 0.2, 0.9, 0, 1, -8, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.3])
    .define("ui", [0.35, 0, 740, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02])
    .define("hint", [0.5, 0, 620, 0.01, 0.1, 0.5, 0, 2, 0, 0, 310, 0.1, 0, 0, 0, 0, 0.1, 0.6, 0.15]);

let audioStarted = false;
async function wakeAudio() {
    if (audioStarted) return;
    audioStarted = true;
    await audio.unlock();
    audio.drone({ root: 55, level: 0.11 });
}
addEventListener("pointerdown", wakeAudio, { once: true });
addEventListener("keydown", wakeAudio, { once: true });

function applySettings() {
    const s = save.settings, rm = reducedMotion();
    audio.setVolume("sfx", s.sfx);
    audio.setVolume("music", s.music);
    renderer.postfx.settings.bloom.enabled = s.bloom;
    renderer.postfx.settings.grain = s.bloom ? 0.028 : 0;
    game.juice.reducedMotion = rm;
    world.reducedMotion = rm;
}

// ------------------------------------------------------------------ special levels
const TITLE_LEVEL = {
    id: "title", name: "", intro: "", launch: { x: -60, y: -60, angle: 0, speed: 1 }, portal: { x: 60, y: 60, r: 1 }, dust: [], inventory: {},
    fixed: [
        { type: "giant", x: 0, y: 0 },
        { type: "moon", x: 0, y: 0, orbit: { cx: 0, cy: 0, r: 3.6, speed: 0.6, phase: 0.4 } },
        { type: "planet", x: 0, y: 0, orbit: { cx: 0, cy: 0, r: 7.4, speed: -0.26, phase: 2.2 } },
        { type: "pulsar", x: -10.5, y: 5.5 },
        { type: "blackhole", x: 11.5, y: -5 },
    ],
};
const SANDBOX_LEVEL = {
    id: "sandbox", name: "Sandbox", intro: "Free play. Build any system you like and see where the comet goes.",
    launch: { x: -13, y: -2, angle: 0.12, speed: 6 }, portal: { x: 13, y: 3, r: 0.95 }, fixed: [], dust: [], solution: [],
    inventory: { moon: 99, planet: 99, giant: 99, pulsar: 99, blackhole: 99 },
};
const MAX_PLACED = 9;

// ------------------------------------------------------------------ app state
const app = {
    mode: "title",          // title | chart | plan | fly | ended | result
    paused: false,
    levelIndex: 0,
    level: TITLE_LEVEL,
    sandbox: false,
    placed: [],
    sim: null,
    simT: 0,
    titleT: 0,
    previewDirty: true,
    path: [],
    token: 0,               // invalidates delayed callbacks when the screen changes
    hintUntil: 0,
    selected: 0,            // star chart selection
};
/** @type {null | { index: number, fromDock: boolean, origin: {x:number,y:number} | null, error: string | null, moved: boolean }} */
let drag = null;
let lastTap = { index: -1, time: 0 };
const pointer = { nx: 0, ny: 0 };

// ------------------------------------------------------------------ camera
/** Camera framing that fits the 32 × 18 playfield; portrait screens turn the field upright. */
function homeView() {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), f = camera.focal, pitch = 0.98;
    const portrait = aspect < 0.9;
    const halfW = portrait ? 10.6 : 17.6, halfH = (portrait ? 17.6 : 10.4) * Math.sin(pitch) + 1.6;
    return {
        yaw: portrait ? Math.PI : -Math.PI / 2, pitch,
        distance: Math.max(halfH * f, (halfW * f) / aspect) * 1.03,
        tx: portrait ? -1.6 : 0, ty: portrait ? 0 : -1.5, tz: -0.5,
    };
}
function titleView(t) {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const drift = reducedMotion() ? 0 : t * 0.045;
    return { yaw: -Math.PI / 2 + 0.5 + drift, pitch: 0.46, distance: aspect < 0.9 ? 34 : 24, tx: aspect < 0.9 ? 0 : -6, ty: 0, tz: 0.4 };
}
const view = titleView(0);
function updateCamera(dt) {
    const goal = app.mode === "title" || app.mode === "chart" ? titleView(app.titleT) : homeView();
    const par = reducedMotion() || drag || (app.mode !== "plan" && app.mode !== "fly" && app.mode !== "ended") ? 0 : 1;
    const k = 1 - Math.exp(-dt * 3.2);
    // take the short way round for yaw
    const dy = ((goal.yaw + pointer.nx * 0.045 * par - view.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    view.yaw += dy * k;
    view.pitch += (goal.pitch - pointer.ny * 0.03 * par - view.pitch) * k;
    view.distance += (goal.distance - view.distance) * k;
    view.tx += (goal.tx - view.tx) * k; view.ty += (goal.ty - view.ty) * k; view.tz += (goal.tz - view.tz) * k;
    camera.yaw = view.yaw; camera.pitch = view.pitch; camera.distance = view.distance;
    camera.target[0] = view.tx; camera.target[1] = view.ty; camera.target[2] = view.tz;
}

// ------------------------------------------------------------------ UI helpers
const screens = ["title", "chart", "hud", "result", "pause", "settings"];
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function setStatus(text, warn = false) { const el = $("statusLine"); el.textContent = text; el.classList.toggle("warn", warn); }
let toastTimer = 0;
function toast(text, kind = "") {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast glass on " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}
function fade(fn) {
    const el = $("fade");
    el.classList.add("on");
    // try/finally + a timer (not requestAnimationFrame, which stalls in hidden tabs): the veil can never stick
    setTimeout(() => { try { fn(); } finally { setTimeout(() => el.classList.remove("on"), 40); } }, reducedMotion() ? 0 : 320);
}
const sfx = (name, opts) => audio.play(name, opts);
const totalStars = () => LEVELS.reduce((n, l) => n + (save.stars[l.id] || 0), 0);
const isDone = (l) => save.stars[l.id] !== undefined;

// ------------------------------------------------------------------ title + chart
function goTitle() {
    drag = null;
    app.token++;
    app.mode = "title"; app.paused = false; game.resume();
    app.level = TITLE_LEVEL; app.placed = []; app.sim = null;
    world.load(TITLE_LEVEL);
    world.portal.node.visible = false; world.launcher.node.visible = false;
    world.setPreview(null);
    for (const s of screens) show(s, s === "title");
    $("playLabel").textContent = Object.keys(save.stars).length ? "Continue" : "Begin";
}

// constellation layout, in % of the chart area
const CHART = [[7, 64], [16, 36], [26, 60], [35, 28], [44, 54], [53, 22], [61, 50], [69, 74], [77, 44], [84, 20], [90, 52], [94, 80]];
function goChart() {
    drag = null;
    app.token++;
    if (app.mode !== "title" && app.mode !== "chart") { world.load(TITLE_LEVEL); world.portal.node.visible = false; world.launcher.node.visible = false; }
    app.mode = "chart"; app.paused = false; game.resume();
    app.level = TITLE_LEVEL; app.placed = []; app.sim = null;
    for (const s of screens) show(s, s === "chart");
    const lines = $("chartLines"), nodes = $("chartNodes");
    lines.setAttribute("viewBox", "0 0 100 100"); lines.setAttribute("preserveAspectRatio", "none");
    lines.innerHTML = CHART.slice(1).map((p, i) => `<line x1="${CHART[i][0]}" y1="${CHART[i][1]}" x2="${p[0]}" y2="${p[1]}" vector-effect="non-scaling-stroke" class="${isDone(LEVELS[i]) ? "done" : ""}"/>`).join("");
    nodes.innerHTML = "";
    const firstOpen = LEVELS.findIndex((l, i) => i < save.unlocked && !isDone(l));
    LEVELS.forEach((l, i) => {
        const locked = i >= save.unlocked, stars = save.stars[l.id] || 0;
        const b = document.createElement("button");
        b.className = "node" + (isDone(l) ? " done" : "") + (locked ? " locked" : "") + (i === firstOpen ? " next" : "");
        b.style.left = CHART[i][0] + "%"; b.style.top = CHART[i][1] + "%"; b.style.animationDelay = i * 35 + "ms";
        b.setAttribute("aria-label", `System ${i + 1}: ${l.name}${locked ? ", locked" : `, ${stars} of 3 stardust`}`);
        b.innerHTML = `${pad2(i + 1)}${isDone(l) ? `<span class="pips">${"★".repeat(stars)}<span class="star">${"★".repeat(3 - stars)}</span></span>` : ""}`;
        b.addEventListener("click", () => { sfx("ui"); if (app.selected === i && !locked) startLevel(i); else selectChart(i); });
        b.addEventListener("focus", () => selectChart(i));
        nodes.appendChild(b);
    });
    $("starTotal").textContent = totalStars();
    selectChart(firstOpen >= 0 ? firstOpen : Math.min(save.unlocked, LEVELS.length) - 1);
}
function selectChart(i) {
    app.selected = i;
    const l = LEVELS[i], locked = i >= save.unlocked, stars = save.stars[l.id] || 0;
    document.querySelectorAll("#chartNodes .node").forEach((n, k) => n.classList.toggle("sel", k === i));
    $("infoNum").textContent = "SYSTEM " + pad2(i + 1);
    $("infoName").textContent = l.name;
    $("infoText").textContent = locked ? `Locked. Complete system ${pad2(i)} to chart a course here.` : l.intro;
    $("infoStars").innerHTML = [0, 1, 2].map((k) => `<span class="star ${k < stars ? "on" : ""}">★</span>`).join("");
    $("infoPlay").disabled = locked;
    $("infoPlay").style.visibility = locked ? "hidden" : "visible";
}

// ------------------------------------------------------------------ level
function startLevel(i, sandbox = false) {
    fade(() => {
        app.token++;
        app.sandbox = sandbox;
        app.levelIndex = i;
        app.level = sandbox ? SANDBOX_LEVEL : LEVELS[i];
        app.placed = []; app.sim = null; app.simT = 0; app.paused = false; game.resume();
        world.load(app.level);
        for (const s of screens) show(s, s === "hud");
        $("hudNum").textContent = sandbox ? "∞" : pad2(i + 1);
        $("hudName").textContent = app.level.name;
        $("dustPips").classList.toggle("hidden", sandbox);
        $("hintBtn").classList.toggle("hidden", sandbox);
        toPlan();
    });
}

function toPlan() {
    drag = null;
    app.mode = "plan";
    app.sim = null; app.simT = 0;
    world.setComet(0, 0, false);
    world.resetDust();
    world.setHint([]); app.hintUntil = 0;
    app.previewDirty = true;
    setPips(0);
    $("launchBtn").classList.remove("flying");
    $("launchLabel").textContent = "Launch";
    refreshDock();
    setStatus(app.level.intro);
}

function left(type) { return (app.level.inventory[type] || 0) - app.placed.filter((b) => b.type === type).length; }

function refreshDock() {
    const inv = $("inventory");
    inv.innerHTML = "";
    for (const type of Object.keys(app.level.inventory)) {
        const def = BODY[type], n = left(type), c = def.color.map((v) => Math.round(clamp(v, 0, 1) * 255));
        const chip = document.createElement("button");
        chip.className = "chip" + (n <= 0 ? " empty" : "");
        chip.dataset.type = type;
        chip.style.setProperty("--c", `rgb(${c[0]},${c[1]},${c[2]})`);
        chip.setAttribute("aria-label", `${def.label}, ${app.sandbox ? "unlimited" : n + " left"}. Drag onto the grid.`);
        chip.innerHTML = `<span class="orb"></span><small>${def.label}</small>${app.sandbox ? "" : `<span class="count">${Math.max(n, 0)}</span>`}`;
        chip.addEventListener("pointerdown", (e) => beginDockDrag(e, type));
        // keyboard: Enter/Space drops the body at the first free spot near the centre of the field
        chip.addEventListener("keydown", (e) => { if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); keyboardPlace(type); } });
        inv.appendChild(chip);
    }
    $("undoBtn").disabled = app.placed.length === 0;
}

function setPips(n) { [...$("dustPips").children].forEach((el, i) => el.classList.toggle("on", i < n)); }

// ------------------------------------------------------------------ placing bodies
const PLANE_Z = -0.4;
function pointerWorld(e) {
    const r = canvas.getBoundingClientRect();
    const ray = camera.screenRay(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (ray.direction[2] >= -1e-4) return null;
    const t = (PLANE_Z - ray.origin[2]) / ray.direction[2];
    return { x: ray.origin[0] + ray.direction[0] * t, y: ray.origin[1] + ray.direction[1] * t };
}
function findPlaced(p) {
    let best = -1, bd = Infinity;
    app.placed.forEach((b, i) => { const d = Math.hypot(b.x - p.x, b.y - p.y) - BODY[b.type].radius; if (d < 0.75 && d < bd) { bd = d; best = i; } });
    return best;
}
function canPlaceMore() { return app.placed.length < Math.min(MAX_PLACED, FABRIC.MAX_BODIES - app.level.fixed.length); }

function beginDockDrag(e, type) {
    if (app.mode !== "plan" || left(type) <= 0) return;
    if (!canPlaceMore()) { toast("The system is full", "bad"); sfx("invalid"); return; }
    e.preventDefault();
    const p = pointerWorld(e) || { x: 0, y: 0 };
    app.placed.push({ type, x: p.x, y: p.y });
    drag = { index: app.placed.length - 1, fromDock: true, origin: null, error: "start", moved: false };
    sfx("pick");
    moveDrag(e);
}
function keyboardPlace(type) {
    if (app.mode !== "plan" || left(type) <= 0 || !canPlaceMore()) return;
    // first free spot on a small spiral around the centre
    for (let k = 0; k < 60; k++) {
        const a = k * 2.4, r = 1 + k * 0.35, x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (!placementError(app.level, app.placed, x, y, type)) { app.placed.push({ type, x, y }); commitPlacement(app.placed.length - 1); return; }
    }
}

canvas.addEventListener("pointerdown", (e) => {
    if (app.mode !== "plan" || app.paused) return;
    const p = pointerWorld(e);
    if (!p) return;
    const i = findPlaced(p);
    if (i < 0) return;
    const now = performance.now();
    if (lastTap.index === i && now - lastTap.time < 380) { removePlaced(i); lastTap.index = -1; return; } // double-click removes
    lastTap = { index: i, time: now };
    drag = { index: i, fromDock: false, origin: { x: app.placed[i].x, y: app.placed[i].y }, error: null, moved: false };
    sfx("pick");
});
canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (app.mode !== "plan") return;
    const p = pointerWorld(e), i = p ? findPlaced(p) : -1;
    if (i >= 0) removePlaced(i);
});

function moveDrag(e) {
    if (!drag) return;
    if (app.mode !== "plan" || !app.placed[drag.index]) { drag = null; return; } // the board changed under the drag
    const p = pointerWorld(e);
    if (!p) return;
    const b = app.placed[drag.index];
    b.x = clamp(p.x, -PHYS.bounds.x - 4, PHYS.bounds.x + 4);
    b.y = clamp(p.y, -PHYS.bounds.y - 6, PHYS.bounds.y + 6);
    drag.moved = true;
    drag.error = placementError(app.level, app.placed, b.x, b.y, b.type, drag.index);
    world.setPlaced(app.placed, drag.error ? drag.index : -1);
    setStatus(drag.error || "Release to place", !!drag.error);
    app.previewDirty = true;
}
addEventListener("pointermove", (e) => {
    pointer.nx = (e.clientX / innerWidth) * 2 - 1; pointer.ny = (e.clientY / innerHeight) * 2 - 1;
    moveDrag(e);
});
addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (app.mode !== "plan" || !app.placed[d.index]) return;
    const overDock = !!document.elementFromPoint(e.clientX, e.clientY)?.closest(".dock");
    if (overDock && (d.fromDock ? d.moved : true)) {
        if (!d.fromDock) sfx("pick");
        app.placed.splice(d.index, 1);                         // dropped back on the dock
    } else if (d.error) {
        sfx("invalid");
        if (d.fromDock) { app.placed.splice(d.index, 1); toast(d.error === "start" ? "Drag it onto the grid" : d.error, "bad"); }
        else { Object.assign(app.placed[d.index], d.origin); toast(d.error, "bad"); }
    } else if (d.moved) {
        commitPlacement(d.index);
        return;
    }
    world.setPlaced(app.placed);
    app.previewDirty = true;
    refreshDock();
    setStatus(app.level.intro);
});
addEventListener("pointercancel", () => {
    if (!drag) return;
    if (!app.placed[drag.index]) { drag = null; return; }
    if (drag.fromDock) app.placed.splice(drag.index, 1); else Object.assign(app.placed[drag.index], drag.origin);
    drag = null; world.setPlaced(app.placed); app.previewDirty = true; refreshDock();
});

function commitPlacement(i) {
    const b = app.placed[i];
    world.setPlaced(app.placed);
    world.ring(b.x, b.y, BODY[b.type].color.map((v) => v * 1.6), 28, 4.5);
    sfx("place", { pitch: b.type === "giant" ? 0.75 : b.type === "moon" ? 1.3 : b.type === "pulsar" ? 1.6 : 1, pan: b.x / 16 });
    app.previewDirty = true;
    if (app.hintUntil) { world.setHint([]); app.hintUntil = 0; }
    refreshDock();
    setStatus(app.level.intro);
}
function removePlaced(i) {
    const b = app.placed[i];
    if (!b) return;
    world.burst(b.x, b.y, [0.8, 0.9, 1.4], 16, 3);
    app.placed.splice(i, 1);
    world.setPlaced(app.placed);
    app.previewDirty = true;
    sfx("pick", { pitch: 0.8 });
    refreshDock();
}
function undo() { if (app.mode === "plan" && app.placed.length) removePlaced(app.placed.length - 1); }

function showHint() {
    if (app.mode !== "plan" || app.sandbox) return;
    world.setHint(app.level.solution);
    app.hintUntil = performance.now() + 6000;
    sfx("hint");
    setStatus("Ghost bodies show one way through. Yours can differ.");
}

// ------------------------------------------------------------------ flight
function launch() {
    if (app.paused) return;
    if (app.mode === "fly") return stopFlight();
    if (app.mode !== "plan" || drag) return;
    app.mode = "fly";
    app.sim = createState(app.level, app.placed);
    app.simT = 0;
    world.setHint([]); app.hintUntil = 0;
    world.setPreview(null);
    world.resetDust();
    setPips(0);
    const L = app.level.launch;
    world.setComet(L.x, L.y, true, true);
    world.ring(L.x, L.y, [2.4, 1.8, 0.8], 24, 5);
    sfx("launch");
    $("launchBtn").classList.add("flying");
    $("launchLabel").textContent = "Stop";
    setStatus("In flight. Hold F to fast-forward, R to stop.");
}
function stopFlight() {
    if (app.mode !== "fly") return;
    app.token++;
    sfx("pick", { pitch: 0.7 });
    toPlan();
}

const REASONS = {
    crashed: (s) => `Crashed into a ${BODY[s.hit.type].label.toLowerCase()}`,
    swallowed: () => "Swallowed by the black hole",
    lost: (s) => (s.t > PHYS.maxTime ? "Still orbiting… the comet never arrived" : "Lost to the void"),
};

function endFlight() {
    // "ended" stops the update loop from calling this again while the result / reset timer runs
    app.mode = "ended";
    const s = app.sim, c = s.comet, token = ++app.token;
    world.comet.visible = false;
    if (s.status === "won") {
        const p = app.level.portal;
        world.ring(p.x, p.y, [0.8, 2.4, 3.2], 48, 8);
        world.burst(p.x, p.y, [1.6, 2.6, 3.2], 80, 7, 0.3);
        game.juice.shake(0.28);
        sfx("win");
        if (game.tweens) { const b = renderer.postfx.settings.bloom; b.intensity = 2.4; game.tweens.to(b, { intensity: 1.05 }, { duration: 1.2 }); }
        if (app.sandbox) { toast("Portal reached", "good"); setTimeout(() => token === app.token && toPlan(), 1100); return; }
        const id = app.level.id, stars = s.dustTaken;
        save.stars[id] = Math.max(save.stars[id] ?? 0, stars);
        save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, app.levelIndex + 2));
        persist();
        setTimeout(() => token === app.token && showResult(stars, s.t), reducedMotion() ? 300 : 1000);
    } else {
        const swallowed = s.status === "swallowed";
        if (s.status !== "lost") {
            world.burst(c.x, c.y, swallowed ? [2.6, 1.0, 0.3] : [2.6, 0.5, 0.6], swallowed ? 50 : 70, swallowed ? 3 : 8);
            game.juice.shake(swallowed ? 0.5 : 0.42);
            game.juice.freeze(70);
        }
        sfx(swallowed ? "swallow" : s.status === "lost" ? "lost" : "crash", { pan: clamp(c.x / 16, -1, 1) });
        toast(REASONS[s.status](s), "bad");
        setTimeout(() => token === app.token && toPlan(), 1100);
    }
}

function showResult(stars, time) {
    app.mode = "result";
    const i = app.levelIndex, last = i >= LEVELS.length - 1;
    $("resultNum").textContent = "SYSTEM " + pad2(i + 1) + " · " + app.level.name.toUpperCase();
    [...$("resultStars").children].forEach((el, k) => { el.classList.remove("on"); void el.offsetWidth; el.classList.toggle("on", k < stars); });
    $("resultText").textContent = stars === 3 ? "Every grain of stardust collected." : stars === 0 ? "You made it. Now try catching the stardust on the way." : `${3 - stars} stardust still drifting. There's a cleaner line.`;
    $("factTime").textContent = time.toFixed(1) + "s";
    $("factBodies").textContent = app.placed.length;
    $("factDust").textContent = stars + "/3";
    $("nextBtn").textContent = last ? "Star chart" : "Next system →";
    show("result", true);
    $("nextBtn").focus();
}

// ------------------------------------------------------------------ pause + settings
function setPaused(on) {
    if (app.mode !== "plan" && app.mode !== "fly") return;
    app.paused = on;
    if (on) game.pause(); else game.resume();
    show("pause", on);
    if (on) $("resumeBtn").focus();
}
let settingsReturn = null;
function openSettings() {
    settingsReturn = document.activeElement;
    $("setSfx").value = save.settings.sfx; $("setMusic").value = save.settings.music;
    $("setBloom").checked = save.settings.bloom; $("setMotion").checked = reducedMotion();
    show("settings", true);
    $("settings").querySelector("[data-close]").focus();
}
function closeSettings() { show("settings", false); settingsReturn?.focus?.(); }

// ------------------------------------------------------------------ buttons
const firstOpenLevel = () => { const i = LEVELS.findIndex((l, k) => k < save.unlocked && !isDone(l)); return i >= 0 ? i : Math.min(save.unlocked, LEVELS.length) - 1; };
const click = (id, fn) => $(id).addEventListener("click", () => { sfx("ui"); fn(); });
click("playBtn", () => startLevel(firstOpenLevel()));
click("chartBtn", () => fade(goChart));
click("sandboxBtn", () => startLevel(0, true));
click("chartBack", () => fade(goTitle));
click("infoPlay", () => startLevel(app.selected));
click("launchBtn", launch);
click("hintBtn", showHint);
click("undoBtn", undo);
click("pauseBtn", () => setPaused(true));
click("resumeBtn", () => setPaused(false));
click("restartBtn", () => { setPaused(false); app.placed = []; world.setPlaced([]); app.token++; toPlan(); });
click("pauseChart", () => { setPaused(false); fade(goChart); });
click("pauseTitleBtn", () => { setPaused(false); fade(goTitle); });
click("nextBtn", () => { show("result", false); if (app.levelIndex >= LEVELS.length - 1) fade(goChart); else startLevel(app.levelIndex + 1); });
click("replayBtn", () => { show("result", false); toPlan(); });
click("resultChart", () => { show("result", false); fade(goChart); });
document.querySelectorAll("[data-open='settings']").forEach((b) => b.addEventListener("click", () => { sfx("ui"); openSettings(); }));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { sfx("ui"); closeSettings(); }));
$("setSfx").addEventListener("input", (e) => { save.settings.sfx = +e.target.value; applySettings(); persist(); sfx("ui"); });
$("setMusic").addEventListener("input", (e) => { save.settings.music = +e.target.value; applySettings(); persist(); });
$("setBloom").addEventListener("change", (e) => { save.settings.bloom = e.target.checked; applySettings(); persist(); });
$("setMotion").addEventListener("change", (e) => { save.settings.reducedMotion = e.target.checked; applySettings(); persist(); });
$("resetProgress").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Press again"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Reset"; }, 2500); return; }
    save.unlocked = 1; save.stars = {}; persist(); b.dataset.armed = ""; b.textContent = "Erased";
    if (app.mode === "chart") goChart();
});

// ------------------------------------------------------------------ keyboard (engine action mapping)
const input = game.input;
input.bind("launch", ["Space", "Enter"]).bind("stop", ["KeyR"]).bind("hint", ["KeyH"]).bind("undo", ["KeyZ", "Backspace"])
    .bind("pause", ["Escape", "KeyP"]).bind("fast", ["KeyF"]);
// Escape must work while the loop is paused too, so it is handled directly
addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || e.repeat) return;
    if (!$("settings").classList.contains("hidden")) return closeSettings();
    if (!$("result").classList.contains("hidden")) return;
    if (app.mode === "chart") return fade(goTitle);
    if (app.mode === "plan" || app.mode === "fly") setPaused(!app.paused);
});

// ------------------------------------------------------------------ simulation step (60 Hz)
game.onUpdate((dt) => {
    if (app.mode === "title" || app.mode === "chart") {
        app.titleT += dt;
        // a comet on a long ellipse around the giant
        const a = app.titleT * 0.55, x = Math.cos(a) * 5.4, y = Math.sin(a) * 4.6;
        world.setComet(x, y, true);
        if (!reducedMotion()) world.cometTail(x, y, -Math.sin(a) * 3, Math.cos(a) * 2.6);
        return;
    }
    if (app.mode === "plan") {
        if (input.wasPressed("launch")) launch();
        if (input.wasPressed("hint")) showHint();
        if (input.wasPressed("undo")) undo();
        return;
    }
    if (app.mode === "fly" && app.sim) {
        if (input.wasPressed("stop") || input.wasPressed("launch")) return stopFlight();
        const s = app.sim, steps = input.isDown("fast") ? 3 : 1;
        for (let k = 0; k < steps && s.status === "flying"; k++) {
            step(s);
            for (const ev of s.events) {
                if (ev.type === "dust") {
                    world.takeDust(ev.index);
                    setPips(s.dustTaken);
                    sfx("dust", { pitch: 0.9 + s.dustTaken * 0.18, pan: clamp(s.comet.x / 16, -1, 1) });
                }
            }
            if (s.status === "flying") world.cometTail(s.comet.x, s.comet.y, s.comet.vx, s.comet.vy);
        }
        app.simT = s.t;
        if (s.status === "flying") world.setComet(s.comet.x, s.comet.y, true);
        else endFlight();
    }
});

// ------------------------------------------------------------------ per rendered frame
game.onRender((frameDelta) => {
    const now = performance.now();
    if (app.hintUntil && now > app.hintUntil) { world.setHint([]); app.hintUntil = 0; if (app.mode === "plan") setStatus(app.level.intro); }
    updateCamera(frameDelta);
    const simT = app.mode === "fly" || app.mode === "ended" ? app.simT : app.mode === "title" || app.mode === "chart" ? app.titleT : 0;
    world.frame(game.loop.realTime, simT, frameDelta, !app.paused && !game.juice.frozen);
    if (app.mode === "plan" && app.previewDirty) {
        app.previewDirty = false;
        const { state } = simulate(app.level, app.placed, undefined, app.path);
        world.setPreview(app.path, state.status);
        $("launchBtn").dataset.outcome = state.status;
    }
});

// ------------------------------------------------------------------ boot
applySettings();
goTitle();
view.distance *= 1.5; // start a little far and ease in
game.start();

// testing / console hook
window.orbital = { app, game, world, LEVELS, startLevel, launch, goChart, goTitle, simulate, save };
