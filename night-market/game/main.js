import { Game, PostFX, Audio } from "../engine/index.js";
import { NIGHT, STALLS, STALL_TYPES, LEVELS, MAX_LEVEL, TRAITS, REGULARS, HINTS, ECON, STREET, VENDOR, MANAGERS, MANAGER_IDS } from "./data.js";
import * as sim from "./sim.js";
import { describeEvent, resolveEvent } from "./events.js";
import { BOTS, playNight } from "./bots.js";
import { World } from "./world.js";
import { loadAssets } from "./assets.js";
import { SKIN, SHIRT, HAIR, css } from "./characters.js";
import { icon } from "./icons.js";
import { loadSignIcons } from "./gfx.js";

/**
 * NIGHT MARKET — application: screens, input, camera, labels, saving.
 * The rules live in sim.js, the 3D scene in world.js, rendering in the Projection Lab engine.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const signed = (n) => (n >= 0 ? "+" : "−") + Math.abs(Math.round(n));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad2 = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ save data
const SAVE_KEY = "night-market-save-v1";
const save = (() => {
    const base = { campaign: null, best: null, settings: { sfx: 0.8, music: 0.5, bloom: true, shadows: true, reducedMotion: null } };
    try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
        return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
    } catch (e) { return base; }
})();
if (save.campaign && save.campaign.v !== 1 && save.campaign.v !== 2) save.campaign = null;
// the tutorial runs once, on a first street; anyone who has already played has no use for it
if (!save.tutorial) save.tutorial = { done: !!(save.best || (save.campaign && save.campaign.night > 1)), ack: {} };
if (save.campaign) sim.upgradeState(save.campaign);
/** when the game was last open, for the night manager's earnings while away */
let lastSeen = save.lastSeen || 0;
function persist() {
    if (app.S) save.campaign = app.S;
    save.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
}
const systemPrefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reducedMotion = () => save.settings.reducedMotion ?? systemPrefersReducedMotion;

// ------------------------------------------------------------------ engine setup
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, scene, camera, input } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.05, knee: 0.6, intensity: 0.8, radius: 1.3 }, ao: { enabled: true, radius: 0.65, intensity: 0.9 }, exposure: 1.08, vignette: 0.34, grain: 0.02 });
// a long lens: with a wide one, people near the edges of the screen appear to lean outwards
camera.fov = 24;
camera.far = 320;

// the models are fetched before anything is shown; the page stays veiled until they are in
const [assets] = await Promise.all([loadAssets(), loadSignIcons()]);
const world = new World(game, assets);
const audio = new Audio({ volume: 0.9, sfx: save.settings.sfx, music: save.settings.music });
// ZzFX parameter arrays: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
// deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay
audio.define("ui", [0.35, 0, 700, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02])
    .define("place", [0.7, 0, 220, 0.01, 0.05, 0.25, 1, 1.4, 0, 0, 110, 0.06, 0, 0, 0, 0, 0.04, 0.7, 0.08])
    .define("invalid", [0.5, 0, 150, 0.01, 0.05, 0.14, 2, 1.2, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.05])
    .define("coin", [0.45, 0, 1175, 0.003, 0.03, 0.16, 0, 1.6, 0, 0, 590, 0.04, 0, 0, 0, 0, 0, 0.7, 0.03])
    .define("tip", [0.6, 0, 880, 0.005, 0.08, 0.3, 0, 1.8, 0, 0, 440, 0.06, 0.06, 0, 0, 0, 0.05, 0.75, 0.06])
    .define("star", [0.4, 0, 1320, 0.005, 0.03, 0.2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0.04, 0.7, 0.05])
    .define("angry", [0.5, 0, 190, 0.01, 0.06, 0.22, 3, 1.4, -4, 0, 0, 0, 0, 0.4, 0, 0.1, 0, 0.6, 0.05])
    .define("scene", [0.8, 0.05, 110, 0.01, 0.14, 0.5, 4, 1.3, -1, 0, 0, 0, 0, 1.4, 0, 0.2, 0, 0.5, 0.15])
    .define("hire", [0.6, 0, 392, 0.01, 0.1, 0.3, 0, 1.6, 0, 0, 196, 0.08, 0, 0, 0, 0, 0.06, 0.7, 0.1])
    .define("open", [0.9, 0, 196, 0.03, 0.4, 1.1, 0, 1.4, 0, 0, 98, 0.12, 0.12, 0, 0, 0, 0.14, 0.7, 0.25])
    .define("close", [0.8, 0, 294, 0.04, 0.3, 1.0, 0, 1.2, -1, 0, -98, 0.2, 0, 0, 0, 0, 0.12, 0.6, 0.25])
    .define("event", [0.6, 0, 523, 0.02, 0.12, 0.5, 0, 1.8, 0, 0, 262, 0.1, 0, 0, 0, 0, 0.1, 0.65, 0.15])
    .define("win", [0.9, 0, 440, 0.03, 0.4, 0.9, 0, 1.5, 0, 0, 220, 0.11, 0.11, 0, 0, 0, 0.12, 0.7, 0.2])
    .define("lose", [0.8, 0, 220, 0.05, 0.3, 1.1, 0, 1, -6, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.3]);

let audioStarted = false;
async function wakeAudio() {
    if (audioStarted) return;
    audioStarted = true;
    await audio.unlock();
    audio.drone({ root: 65.4, chord: [1, 1.5, 2, 2.5, 3], level: 0.09 });
}
addEventListener("pointerdown", wakeAudio, { once: true });
addEventListener("keydown", wakeAudio, { once: true });
let lastCoin = 0;
function sfx(name, opts) {
    if (name === "coin") { const now = performance.now(); if (now - lastCoin < 70) return; lastCoin = now; }
    audio.play(name, opts);
}
/** stereo position for something happening at world x */
const panOf = (x) => clamp((x - view.x) / 14, -1, 1);

function applySettings() {
    const s = save.settings, rm = reducedMotion();
    audio.setVolume("sfx", s.sfx);
    audio.setVolume("music", s.music);
    renderer.postfx.settings.bloom.enabled = s.bloom;
    renderer.postfx.settings.grain = s.bloom ? 0.02 : 0;
    world.setShadows(s.shadows);
    game.juice.reducedMotion = rm;
    world.reducedMotion = rm;
}

// ------------------------------------------------------------------ app state
const app = {
    mode: "title",              // title | prep | night | closing | event | over
    S: null,                    // the player's campaign (plain JSON, see sim.js)
    demo: null,                 // the campaign a bot plays behind the title screen
    speed: 1, lastSpeed: 1,
    menu: false,
    tab: "stalls",
    placing: null,              // { kind: "buy", type } | { kind: "move", stallId }
    slotFirst: null,            // an empty spot the player clicked before choosing what to put there
    sel: null,                  // { type: "stall" | "vendor" | "customer", id }
    snapshot: null,             // the campaign as it was when tonight opened (for "restart this night")
    titleT: 0,
    openArmed: 0,
};
const cur = () => (app.mode === "title" ? app.demo : app.S);

// ------------------------------------------------------------------ the bot behind the title screen
function makeDemo() {
    for (let tries = 0; tries < 6; tries++) {
        const d = sim.createCampaign(1 + Math.floor(Math.random() * 1e6));
        for (let i = 0; i < 5; i++) playNight(d, BOTS.sensible);
        if (d.phase !== "prep") continue;
        BOTS.sensible(d);
        sim.startNight(d);
        return d;
    }
    return sim.createCampaign(1);
}
function stepDemo() {
    const d = app.demo;
    if (sim.stepNight(d)) { world.consume(d, d.events); return; }
    const ev = describeEvent(d), first = ev && ev.choices.find((c) => !c.disabled);
    if (first) resolveEvent(d, first.index);
    sim.advance(d);
    if (d.phase !== "prep") app.demo = makeDemo();
    else { BOTS.sensible(d); sim.startNight(d); }
    world.reset();
    world.rebuild(app.demo);
}

// ------------------------------------------------------------------ camera
const view = { x: 7.5, dist: 46, rot: 0, pitch: 0.8, ty: -0.9 };
const goal = { x: 7.5, dist: 34, rot: 0, pitch: 0.8, ty: -0.9 };
const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
/** true until the player zooms by hand; while it holds, the camera re-fits the street when the window changes */
let autoFit = true;
const fitDistance = (S) => clamp(((sim.slotX(S.slots - 1) / 2 + 4.6) * camera.focal) / aspect(), 28, 60);
function homeView(S) {
    goal.x = sim.slotX(S.slots - 1) / 2; goal.rot = 0; goal.pitch = 0.8; goal.ty = -0.9;
    goal.dist = fitDistance(S);
    autoFit = true;
}
addEventListener("resize", () => { if (autoFit && app.S && app.mode !== "title") goal.dist = fitDistance(app.S); });
function updateCamera(dt) {
    const S = cur();
    if (app.mode === "title") {
        const span = sim.slotX(S.slots - 1), t = reducedMotion() ? 0 : app.titleT;
        const portrait = aspect() < 0.9;
        goal.x = span / 2 + Math.sin(t * 0.07) * span * 0.28 + (portrait ? 0 : -3);
        goal.rot = portrait ? 0.2 : 0.42; goal.pitch = 0.3; goal.dist = portrait ? 34 : 24; goal.ty = -1.2;
    } else {
        goal.x = clamp(goal.x, -3, sim.slotX(S.slots - 1) + 3);
        goal.dist = clamp(goal.dist, 12, 66);
        goal.rot = clamp(goal.rot, -0.75, 0.75);
    }
    const k = 1 - Math.exp(-dt * (app.mode === "title" ? 1.6 : 9));
    for (const key of ["x", "dist", "rot", "pitch", "ty"]) view[key] += (goal[key] - view[key]) * k;
    camera.yaw = -Math.PI / 2 + view.rot; camera.pitch = view.pitch; camera.distance = view.dist;
    camera.target[0] = view.x; camera.target[1] = view.ty; camera.target[2] = 0.9;
}

// ------------------------------------------------------------------ small UI helpers
const screens = ["title", "hud", "closing", "event", "over", "pause", "settings"];
function show(id, on) { $(id).classList.toggle("hidden", !on); }
const textCache = new WeakMap();
function setText(el, text) { if (textCache.get(el) !== text) { textCache.set(el, text); el.textContent = text; } }
let toastTimer = 0;
function toast(text, kind = "") {
    const el = $("toast");
    el.textContent = text;
    el.className = "toast glass on " + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}
function fade(fn) {
    const el = $("fade");
    el.classList.add("on");
    // a timer, not requestAnimationFrame (which stalls in hidden tabs), so the veil can never stick
    setTimeout(() => { try { fn(); } finally { setTimeout(() => el.classList.remove("on"), 40); } }, reducedMotion() ? 0 : 300);
}
function feed(text, kind = "") {
    const list = $("feed"), li = document.createElement("li");
    li.textContent = text; li.className = kind;
    list.appendChild(li);
    while (list.children.length > 4) list.firstChild.remove();
    setTimeout(() => li.classList.add("old"), 6500);
    setTimeout(() => li.remove(), 7200);
}
const avatar = (look, big = false) => `<span class="avatar${big ? " big" : ""}" style="--skin:${css(SKIN[look.skin])};--hair:${css(HAIR[look.hair])};--shirt:${css(SHIRT[look.shirt])}"></span>`;
const pips = (n, max = VENDOR.maxSkill) => `<span class="pips" aria-label="Skill ${n} of ${max}">${"●".repeat(n)}<i>${"●".repeat(max - n)}</i></span>`;
const traitLine = (v) => v.traits.map((t) => `${TRAITS[t].icon} ${TRAITS[t].name}`).join(" · ");
const stallLabel = (stall) => `${icon(stall.type, 15)} ${STALLS[stall.type].name}, spot ${stall.slot + 1}`;
const starText = (n) => (n ? n.toFixed(1) + "★" : "–");

// ------------------------------------------------------------------ labels over the 3D scene
const labelLayer = $("labels");
const P = { x: 0, y: 0, depth: 0, visible: false };
const stallTags = new Map(), vendorMarks = new Map();
/** floating one-off labels: { el, key, pos, age, life } */
const pops = [];
const nameTag = document.createElement("div");
nameTag.className = "nameTag hidden";
labelLayer.appendChild(nameTag);

function place(el, pos, lift = 0) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.project(pos, w, h, P);
    if (!P.visible || P.x < -60 || P.x > w + 60 || P.y < -40 || P.y > h + 60) { el.style.visibility = "hidden"; return false; }
    el.style.visibility = "visible";
    el.style.transform = `translate(${P.x.toFixed(1)}px,${(P.y - lift).toFixed(1)}px) translate(-50%,-100%)`;
    return true;
}
/** A label that rises from a character or stall and fades. `text` may be an icon (markup from icons.js). */
function pop(key, text, cls, life = 1.5) {
    const a = world.anchors.get(key);
    if (!a || pops.length > 36) return;
    const el = document.createElement("div");
    el.className = "pop " + cls;
    if (text.startsWith("<svg")) el.innerHTML = text; else el.textContent = text;
    labelLayer.appendChild(el);
    pops.push({ el, key, pos: [a[0], a[1], a[2]], age: 0, life });
}
function clearLabels() {
    for (const p of pops) p.el.remove();
    pops.length = 0;
    for (const m of [stallTags, vendorMarks]) { for (const el of m.values()) el.remove(); m.clear(); }
    nameTag.classList.add("hidden");
}

/** What a vendor is showing above their head: the things the player should notice without clicking. */
function vendorMark(S, v) {
    const stall = v.stallId != null ? sim.stallById(S, v.stallId) : null;
    if (v.off) return "🛌";
    if (!stall) return "🪑";
    let out = "";
    for (const n of sim.neighbours(S, stall)) {
        const r = sim.relation(S, v.id, n.vendor.id, true);
        if (r === "friend" && !out.includes("💛")) out += "💛";
        if (r === "rival" && !out.includes("💢")) out += "💢";
    }
    if (sim.has(v, "mentor") && sim.neighbours(S, stall).length) out += "🎓";
    if (S.phase === "night") {
        if (v.energy < VENDOR.tiredBelow) out += "💤";
        if (sim.has(v, "hothead") && stall.queue.length >= TRAITS.hothead.queue) out += "🔥";
        if (sim.has(v, "chatty") && stall.queue.length >= 2) out += "💬";
        if (sim.has(v, "owl") && sim.nightClock(S).frac > TRAITS.owl.after) out += "🦉";
    }
    return out;
}

let labelClock = 0;
function updateLabels(dt) {
    const S = cur(), inGame = app.mode !== "title";
    labelClock += dt;
    const refresh = labelClock > 0.2;
    if (refresh) labelClock = 0;

    // stall tags: icon, price, queue
    const seen = new Set();
    if (inGame) for (const stall of S.stalls) {
        seen.add(stall.id);
        let el = stallTags.get(stall.id);
        if (!el) { el = document.createElement("div"); el.className = "tag"; labelLayer.appendChild(el); stallTags.set(stall.id, el); el._html = ""; }
        if (refresh || !el._html) {
            const open = !!sim.worker(S, stall), cap = sim.queueCap(stall), q = stall.queue.length;
            const html = `<span class="ico">${icon(stall.type, 20)}</span>` + (open
                ? `<b>$${stall.price}</b>${S.phase === "night" ? `<span class="q${q >= cap ? " full" : ""}">${q}/${cap}</span>` : ""}`
                : `<b>No vendor</b>`);
            if (html !== el._html) { el._html = html; el.innerHTML = html; el.classList.toggle("shut", !open); }
        }
        const a = world.anchors.get("s" + stall.id);
        if (a) place(el, a);
    }
    for (const [id, el] of stallTags) if (!seen.has(id)) { el.remove(); stallTags.delete(id); }

    // vendor marks
    const seenV = new Set();
    if (inGame) for (const v of sim.hiredVendors(S)) {
        const a = world.anchors.get("v" + v.id);
        if (!a) continue;
        let el = vendorMarks.get(v.id);
        if (!el) { el = document.createElement("div"); el.className = "mark"; labelLayer.appendChild(el); vendorMarks.set(v.id, el); }
        if (refresh || el._t === undefined) { const t = vendorMark(S, v); if (t !== el._t) { el._t = t; el.textContent = t; } }
        if (!el._t) { el.style.visibility = "hidden"; continue; }
        seenV.add(v.id);
        place(el, a, 4);
    }
    for (const [id, el] of vendorMarks) if (!seenV.has(id) && !sim.vendorById(S, id)?.hired) { el.remove(); vendorMarks.delete(id); }

    // floating pops rise and fade
    for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.age += dt;
        const a = world.anchors.get(p.key);
        if (a) { p.pos[0] = a[0]; p.pos[1] = a[1]; p.pos[2] = a[2]; }
        const u = p.age / p.life;
        if (u >= 1) { p.el.remove(); pops.splice(i, 1); continue; }
        if (place(p.el, p.pos, 10 + u * 34)) p.el.style.opacity = String(u < 0.7 ? 1 : (1 - u) / 0.3);
    }

    // the name of whoever is selected
    const a = app.sel && app.sel.type !== "stall" ? world.anchors.get(anchorKey(app.sel)) : null;
    nameTag.classList.toggle("hidden", !a || !inGame);
    if (a && inGame) place(nameTag, a, 26);
}

// ------------------------------------------------------------------ HUD
let hudClock = 0, lastCash = null, shownCash = null;
const anchorKey = (sel) => ({ stall: "s", vendor: "v", customer: "c", manager: "m" })[sel.type] + sel.id;
function bump(el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
function updateHud(dt, force = false) {
    hudClock += dt;
    if (!force && hudClock < 0.1) return;
    hudClock = 0;
    const S = app.S;
    if (!S || app.mode === "title") return;
    setText($("hudNight"), String(S.night));
    setText($("hudOf"), S.endless ? " ∞" : "/" + NIGHT.campaignNights);
    const c = sim.nightClock(S), live = S.phase === "night";
    setText($("hudClock"), live ? `${pad2(c.hour)}:${pad2(c.minute)}` : S.phase === "prep" ? "Before opening" : "Closed");
    $("clockFill").style.width = (live ? c.frac * 100 : S.phase === "prep" ? 0 : 100) + "%";
    const cash = Math.round(S.cash);
    // the counter rolls toward the real figure rather than jumping to it
    if (shownCash === null || reducedMotion() || Math.abs(cash - shownCash) < 1) shownCash = cash;
    else shownCash += (cash - shownCash) * 0.35;
    setText($("hudCash"), money(shownCash));
    if (lastCash !== null && cash > lastCash && !coinsFlying) bump($("hudCash").parentElement);
    lastCash = cash;
    $("hudCash").parentElement.classList.toggle("low", cash < S.rent);
    setText($("hudRep"), String(Math.round(S.rep)));
    setText($("hudRent"), money(S.rent));
    const wx = $("hudWeather");
    if (wx._w !== S.weather) {
        wx._w = S.weather;
        wx.innerHTML = S.weather === "rain" ? icon("rain", 20) : S.weather === "festival" ? icon("festival", 20) : "";
        wx.title = S.weather === "rain" ? "Rain tonight" : S.weather === "festival" ? "Lantern festival tonight" : "";
        wx.classList.toggle("hidden", S.weather === "clear" || !S.weather);
    }
    if (live) {
        const st = S.stats;
        setText($("nbServed"), String(st.served));
        setText($("nbAngry"), String(st.angry));
        setText($("nbCash"), money(st.revenue + st.tips));
        setText($("nbStars"), starText(st.reviews ? st.stars / st.reviews : 0));
        // regulars you can click on (the critic is never announced)
        const here = S.customers.filter((x) => x.kind !== "n" && x.kind !== "critic");
        const key = here.map((x) => x.id).join(",");
        const who = $("nbWho");
        if (who._key !== key) {
            who._key = key;
            who.innerHTML = here.length ? here.map((x) => `<button data-cust="${x.id}">${esc(x.name)}</button>`).join("") : "<span>No regulars right now</span>";
        }
    }
    for (const fn of cardLive) fn();
}

function hintText(S) {
    if (app.placing) return app.placing.kind === "buy" ? `Choose a spot for the ${STALLS[app.placing.type].name} stall.` : "Choose where to move it. Picking an occupied spot swaps the two stalls.";
    if (app.slotFirst != null) return `Spot ${app.slotFirst + 1} selected. Choose a stall to put there.`;
    const hired = sim.hiredVendors(S);
    if (!S.stalls.length) return HINTS.noStall;
    if (!hired.length) return HINTS.noVendor;
    if (S.stalls.some((t) => !sim.worker(S, t))) return HINTS.unstaffed;
    const notes = [];
    if (S.night === STALLS.takoyaki.unlock && !S.stalls.some((t) => t.type === "takoyaki")) notes.push("Takoyaki is the new craze: from tonight some customers crave it, and the stall is on sale.");
    if (S.weather === "rain") notes.push(S.flags.awnings ? "Rain tonight. Your awnings keep the crowd coming, and wet people want noodles." : "Rain tonight: a quarter fewer customers, and the ones who come want noodles.");
    if (S.weather === "festival") notes.push("The lantern festival is tonight. Expect a crowd.");
    if (S.flags.tourNightly || (S.night >= 6 && S.night % 2 === 0)) notes.push("Mrs. Park's tour comes through tonight: seven people at once. Leave room in the queues.");
    if (S.night % 3 === 0) notes.push("The landlord visits tonight. Don't keep him waiting.");
    if ((S.night + 1) % 10 === 0) notes.push("Tomorrow night is the lantern festival.");
    for (const m of S.mods) if (m.label) notes.push(`${m.label}: ${m.n} night${m.n === 1 ? "" : "s"} left.`);
    for (const a of S.stalls) {
        const b = sim.stallAt(S, a.slot + 1), va = sim.worker(S, a), vb = b && sim.worker(S, b);
        if (va && vb && sim.relation(S, va.id, vb.id, true) === "rival") notes.unshift(`${va.name} and ${vb.name} are rivals and side by side. Move one of them.`);
    }
    return notes[0] || (S.night === 1 ? HINTS.ready : "");
}

// ------------------------------------------------------------------ dock panels (before opening)
function renderPanel() {
    const S = app.S, panel = $("panel");
    document.querySelectorAll("#dock [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === app.tab)));
    panel.setAttribute("aria-labelledby", "tab-" + app.tab);
    let html = "";
    if (app.placing) {
        const moving = app.placing.kind === "move", own = moving ? sim.stallById(S, app.placing.stallId) : null;
        const title = moving ? `Move the ${STALLS[own.type].name} stall to…` : `Where does the ${icon(app.placing.type, 18)} ${STALLS[app.placing.type].name} stall go?`;
        html = `<div class="slotPick"><b>${title}</b><div class="slots">`;
        for (let i = 0; i < S.slots; i++) {
            const taken = sim.stallAt(S, i), off = moving ? taken === own : !!taken;
            html += `<button data-slot="${i}" class="${taken ? "taken" : ""}" ${off ? "disabled" : ""} aria-label="Spot ${i + 1}${taken ? ", " + STALLS[taken.type].name : ", empty"}">${taken ? icon(taken.type, 22) : i + 1}</button>`;
        }
        html += `</div><div><button class="btn small ghost" data-act="cancelPlace">Cancel</button></div></div>`;
    } else if (app.tab === "stalls") {
        const full = S.stalls.length >= S.slots;
        html += `<div class="group"><small>${app.slotFirst != null ? "PUT IN SPOT " + (app.slotFirst + 1) : "BUY A STALL"}</small><div class="rowed">`;
        for (const type of STALL_TYPES) {
            const d = STALLS[type], locked = !sim.unlocked(S, type), cant = S.cash < d.buy || full || locked;
            html += `<button class="tile${cant ? " cant" : ""}" data-buy="${type}" aria-label="${locked ? `${d.name} stall, on sale from night ${d.unlock}` : `Buy ${d.name} stall for $${d.buy}`}. ${d.blurb}">
                <span class="head"><span><span class="ico">${icon(type, 26)}</span> ${d.name}</span><span class="price">${locked ? icon("lock", 15) : icon("coin", 14) + d.buy}</span></span>
                <p>${d.blurb}</p><span class="nums">${locked ? "on sale from night " + d.unlock : `$${d.price} a plate · ${d.serve.toFixed(1)}s · queue ${d.queue}`}</span></button>`;
        }
        html += `</div></div>`;
        if (S.stalls.length) {
            html += `<div class="sep"></div><div class="group"><small>YOUR STALLS</small><div class="rowed">`;
            for (const stall of S.stalls.slice().sort((a, b) => a.slot - b.slot)) {
                const v = sim.worker(S, stall), d = STALLS[stall.type], sel = app.sel?.type === "stall" && app.sel.id === stall.id;
                html += `<button class="tile${sel ? " sel" : ""}" style="width:132px" data-stall="${stall.id}">
                    <span class="head"><span><span class="ico">${icon(stall.type, 26)}</span> Spot ${stall.slot + 1}</span></span>
                    <p>${d.name} · level ${stall.level}</p><p>${v ? esc(v.name) : "<b style='color:var(--danger)'>No vendor</b>"}</p>
                    <span class="nums">$${stall.price} a plate</span></button>`;
            }
            html += `</div></div>`;
        }
    } else if (app.tab === "staff") {
        const team = sim.hiredVendors(S);
        const person = (v, hired) => {
            const stall = v.stallId != null ? sim.stallById(S, v.stallId) : null, sel = app.sel?.type === "vendor" && app.sel.id === v.id;
            return `<button class="person${sel ? " sel" : ""}" data-vendor="${v.id}">${avatar(v.look)}<b>${esc(v.name)}</b>
                <span class="sub">${hired ? (v.off ? "Night off" : stall ? stallLabel(stall) : "No stall") : "Looking for work"}</span>
                <span class="traits">${traitLine(v)}</span>
                <span class="foot2">${pips(v.skill)}<span>$${v.wage}/night${hired ? "" : " · hire $" + ECON.hireFee}</span></span></button>`;
        };
        html += `<div class="group"><small>YOUR TEAM</small><div class="rowed">${team.length ? team.map((v) => person(v, true)).join("") : `<div class="info">Nobody yet. Hire someone from the right.</div>`}</div></div>`;
        html += `<div class="sep"></div><div class="group"><small>LOOKING FOR WORK TONIGHT</small><div class="rowed">${S.market.length ? S.market.map((id) => person(sim.vendorById(S, id), false)).join("") : `<div class="info">Nobody is looking for work tonight.</div>`}</div></div>`;
    } else if (app.tab === "managers") {
        html += `<div class="group"><small>MANAGERS · HIRED ONCE, KEPT FOR GOOD</small><div class="rowed">`;
        for (const id of MANAGER_IDS) {
            const def = MANAGERS[id], level = S.managers[id], cost = sim.managerCost(S, id), next = def.levels[level], cant = !next || S.cash < cost;
            html += `<button class="tile manager${cant ? " cant" : ""}${level ? " has" : ""}" data-manager="${id}" ${next ? "" : "disabled"} aria-label="${def.name}, ${level ? "level " + level : "not hired"}. ${next ? (level ? "Promote" : "Hire") + " for $" + cost : "Top level"}">
                <span class="head"><span>${avatar(def.look)} ${def.name}</span></span>
                <p>${esc(def.text(next || def.levels[level - 1]))}</p>
                <span class="nums">${pips(level, 3)} ${next ? `${level ? "promote" : "hire " + esc(def.person)} · ${icon("coin", 13)}${cost}` : esc(def.person) + " · top level"}</span></button>`;
        }
        html += `</div></div>`;
    } else {
        const cost = sim.extendCost(S), canExtend = S.slots < STREET.maxSlots;
        const known = [];
        const team = sim.hiredVendors(S);
        for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
            const r = sim.relation(S, team[i].id, team[j].id, true);
            if (r) known.push(`${r === "friend" ? "💛" : "💢"} ${esc(team[i].name)} & ${esc(team[j].name)}`);
        }
        html += `<button class="tile${!canExtend || S.cash < cost ? " cant" : ""}" data-act="extend" ${canExtend ? "" : "disabled"}>
            <span class="head"><span><span class="ico">🚧</span> Longer street</span><span class="price">${canExtend ? "$" + cost : "max"}</span></span>
            <p>${canExtend ? "Two more spots for stalls." + (S.flags.extendDiscount ? " Half price, courtesy of the landlord." : "") : "The street is as long as it gets."}</p><span class="nums">${S.slots} of ${STREET.maxSlots} spots</span></button>`;
        const expect = sim.expectation(S) * 4;
        html += `<div class="info"><div><b>About ${sim.arrivalsFor(S)} customers</b> expected tonight.</div><div>Reputation <b>${Math.round(S.rep)}</b> of 100. Good reviews raise it.</div>
            ${expect >= 0.05 ? `<div class="mod">A famous street is held to a higher standard: every plate is marked <b>${expect.toFixed(1)}★</b> harder.</div>` : ""}
            <div>Rent tonight <b>${money(S.rent)}</b>${S.rentFreeze > 0 ? ", frozen" : `, then +$${S.rentStep + (S.endless ? (S.night + 1 - NIGHT.campaignNights) * ECON.endlessRent : 0)} tomorrow`}.</div>${S.rivalStall ? `<div class="mod">Finch's stall is taking 14% of your customers.</div>` : ""}
            <div>${S.weather === "rain" ? icon("rain", 15) + " Rain tonight" + (S.flags.awnings ? ", but you have awnings." : ": 25% fewer customers.") : S.weather === "festival" ? icon("festival", 15) + " Lantern festival tonight." : "A clear night."}</div></div>`;
        html += `<div class="info"><div><b>In effect</b></div>${S.mods.filter((m) => m.label).map((m) => `<div class="mod">${esc(m.label)} · ${m.n} night${m.n === 1 ? "" : "s"}</div>`).join("") || "<div>Nothing unusual.</div>"}
            ${S.policy.student ? `<div>Bao: ${S.policy.student === "free" ? "eats free" : S.policy.student === "discount" ? "$3 special" : "turned away"}</div>` : ""}</div>`;
        html += `<div class="info"><div><b>Who knows whom</b></div>${known.map((k) => `<div>${k}</div>`).join("") || "<div>No known history in your team yet.</div>"}</div>`;
    }
    panel.innerHTML = html;
    const ready = S.stalls.some((t) => sim.worker(S, t));
    $("openBtn").classList.toggle("notReady", !ready);
    const hint = $("hint"), text = hintText(S);
    hint.textContent = text;
    hint.classList.toggle("warn", /rivals|nobody|No /.test(text));
    canvas.classList.toggle("placing", !!app.placing);
}

/** After anything that changes the campaign: redraw the street, the panel and the open card, then save. */
function refresh() {
    world.rebuild(app.S);
    if (app.mode === "prep") renderPanel();
    renderCard();
    updateHud(0, true);
    persist();
    updateCoach();
}

function act(result, sound = "place", message) {
    if (!result.ok) { toast(result.error, "bad"); sfx("invalid"); return false; }
    sfx(sound);
    if (message) toast(message, "good");
    refresh();
    return true;
}

function setPlacing(p) {
    app.placing = p; app.slotFirst = null;
    if (p) world.showSlots(p.kind === "move" ? "all" : "free", app.S, p.kind === "move" ? sim.stallById(app.S, p.stallId).slot : -1);
    else world.showSlots(null, app.S);
    renderPanel();
}
function chooseSlot(slot) {
    const S = app.S, p = app.placing;
    if (!p) return;
    if (p.kind === "buy") {
        const r = sim.buyStall(S, p.type, slot);
        setPlacing(null);
        if (act(r)) {
            world.celebrate(sim.slotX(slot), 3, STALLS[p.type].color.map((c) => c * 2.6).concat(1));
            select({ type: "stall", id: r.stall.id });
            if (!sim.worker(S, r.stall)) { app.tab = "staff"; renderPanel(); }
        }
    } else {
        const r = sim.moveStall(S, p.stallId, slot);
        setPlacing(null);
        act(r);
    }
}

$("dock").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || app.mode !== "prep") return;
    const S = app.S;
    if (b.dataset.tab) { sfx("ui"); app.tab = b.dataset.tab; if (app.placing) setPlacing(null); else renderPanel(); }
    else if (b.dataset.buy) {
        const type = b.dataset.buy;
        if (S.cash < STALLS[type].buy) { toast(`You need $${STALLS[type].buy}`, "bad"); sfx("invalid"); return; }
        if (S.stalls.length >= S.slots) { toast("No empty spots. Extend the street or sell a stall.", "bad"); sfx("invalid"); return; }
        if (app.slotFirst != null) { const slot = app.slotFirst; app.placing = { kind: "buy", type }; chooseSlot(slot); return; }
        sfx("ui");
        setPlacing({ kind: "buy", type });
    }
    else if (b.dataset.slot) chooseSlot(Number(b.dataset.slot));
    else if (b.dataset.stall) { sfx("ui"); select({ type: "stall", id: Number(b.dataset.stall) }); }
    else if (b.dataset.vendor) { sfx("ui"); select({ type: "vendor", id: Number(b.dataset.vendor) }); }
    else if (b.dataset.manager) {
        const id = b.dataset.manager, was = S.managers[id];
        if (act(sim.hireManager(S, id), "hire", was ? `${MANAGERS[id].person} promoted` : `${MANAGERS[id].person} joins as ${MANAGERS[id].name.toLowerCase()}`)) world.celebrate(sim.slotX(S.slots - 1) + 2, 0.5);
    }
    else if (b.dataset.act === "cancelPlace") { sfx("ui"); setPlacing(null); }
    else if (b.dataset.act === "extend") { if (act(sim.extendStreet(S), "place", "Two more spots opened up")) homeView(S); }
});

// ------------------------------------------------------------------ the detail card
/** functions that refresh the changing parts of the open card (bars, queue, what someone is doing) */
let cardLive = [];
function select(sel) {
    app.sel = sel;
    world.select(sel ? anchorKey(sel) : null);
    renderCard();
    if (app.mode === "prep") renderPanel();
}

function customerDoing(S, c) {
    const stall = c.stallId != null ? sim.stallById(S, c.stallId) : null, name = stall ? STALLS[stall.type].name : "";
    if (c.state === "queue") return `Queueing for ${name}, place ${stall.queue.indexOf(c.id) + 1} of ${stall.queue.length}`;
    if (c.state === "served") return `Being served by ${sim.worker(S, stall)?.name || "the vendor"}`;
    if (c.state === "eat") return (c.holding === "tea" ? "Drinking bubble tea" : "Eating") + (c.seat >= 0 ? " at a table" : ", standing: the tables are full");
    if (c.state === "linger") return c.kind === "inspector" ? "Watching a stall, clipboard out" : c.kind === "rival" ? `Watching ${sim.vendorById(S, c.scout)?.name || "your vendor"} work` : c.kind === "kid" ? "Stopped so Biscuit can sniff around" : "Looking around";
    if (c.then === "queue") return `Heading for the ${name} queue`;
    if (c.then === "eat") return "Looking for somewhere to eat";
    if (c.then === "linger") return "Having a look around";
    if (c.angry) return "Storming off";
    return c.sats.length ? "Heading home" : "Found nothing they wanted. Walking on";
}

function renderCard() {
    const card = $("card"), S = app.S, sel = app.sel;
    cardLive = [];
    nameTag.textContent = "";
    document.body.classList.toggle("hasCard", !!sel && !!S && app.mode !== "title");
    if (!sel || !S || app.mode === "title") { card.classList.add("hidden"); return; }
    const prep = app.mode === "prep", closeBtn = `<button class="iconBtn x" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    let html = "";

    if (sel.type === "stall") {
        const stall = sim.stallById(S, sel.id);
        if (!stall) return select(null);
        const d = STALLS[stall.type], v = stall.vendorId != null ? sim.vendorById(S, stall.vendorId) : null, range = sim.priceRange(stall.type);
        html += `<div class="cardHead"><span class="bigIco">${icon(stall.type, 44)}</span><div><h3>${d.name}</h3><p class="sub">Spot ${stall.slot + 1} · ${LEVELS[stall.level].label}</p></div>${closeBtn}</div>
            <div class="levelBar" role="img" aria-label="Level ${stall.level} of ${MAX_LEVEL}"><span>LEVEL ${stall.level}</span><div>${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < stall.level ? "on" : ""}${i === 3 || i === 7 ? " step" : ""}"></i>`).join("")}</div></div>`;
        if (prep) {
            html += `<label class="fieldLabel" for="pickVendor">WORKED BY</label><select id="pickVendor" class="pick" data-act="staff"><option value="">Nobody</option>`;
            for (const o of sim.hiredVendors(S)) {
                const at = o.stallId != null && o.stallId !== stall.id ? sim.stallById(S, o.stallId) : null;
                html += `<option value="${o.id}" ${o.id === stall.vendorId ? "selected" : ""}>${esc(o.name)} · skill ${o.skill}${o.off ? " · night off" : at ? " · now at spot " + (at.slot + 1) : ""}</option>`;
            }
            html += `</select>`;
        }
        html += `<span class="fieldLabel">PRICE PER PLATE</span><div class="stepper"><button data-act="price" data-d="-1" aria-label="Lower the price">−</button><b id="cPrice">$${stall.price}</b><button data-act="price" data-d="1" aria-label="Raise the price">+</button><small id="cPriceNote"></small></div>`;
        html += `<div style="margin-top:12px">`;
        if (!prep) html += `<div class="kv"><span>Worked by</span><b>${v ? `<button class="btn small ghost" style="padding:2px 8px" data-go-vendor="${v.id}">${esc(v.name)} →</button>` : "nobody"}</b></div>`;
        html += `<div class="kv"><span>One customer every</span><b id="cServe"></b></div><div class="parts" id="cParts"></div>
            <div class="kv"><span>Queue</span><b id="cQueue"></b></div>
            <div class="kv"><span>Tonight</span><b id="cTonight"></b></div>
            <div class="kv"><span>Ingredients · upkeep</span><b>$${d.cost.toFixed(2)} a plate · $${d.upkeep} a night</b></div></div>`;
        if (prep) {
            const up = sim.upgradeCost(stall), now = LEVELS[stall.level], nx = LEVELS[stall.level + 1];
            if (nx) {
                const gains = [`${Math.round((1 - nx.serve / now.serve) * 100)}% faster`, `+${Math.round((nx.appeal / now.appeal - 1) * 100)}% appeal`];
                if (nx.queue > now.queue) gains.push("+1 queue place");
                if (nx.tier > now.tier) gains.push("a new look");
                html += `<button class="upgrade" data-act="upgrade" ${S.cash < up ? "disabled" : ""}><span class="ico">${icon("upgrade", 22)}</span>
                    <span><b>Upgrade to level ${stall.level + 1}</b><small>${gains.join(" · ")}</small></span><span class="price">${icon("coin", 14)}${up}</span></button>`;
            } else html += `<p class="blurb">Top level. This stall is as good as it gets.</p>`;
            html += `<div class="cardActions"><button class="btn small" data-act="move">Move</button><button class="btn small danger" data-act="sell">Sell</button></div>`;
        }
        cardLive.push(() => {
            const info = sim.serveInfo(S, stall), ratio = stall.price / d.price;
            setText($("cPrice"), "$" + stall.price);
            setText($("cPriceNote"), ratio > 1.3 ? "Pricey. Fewer people queue and reviews suffer." : ratio > 1.05 ? "A little above the going rate." : ratio < 0.8 ? "Cheap. Pulls a crowd, earns less a plate." : ratio < 0.97 ? "A little below the going rate." : `The going rate. Range $${range.min} to $${range.max}.`);
            setText($("cServe"), isFinite(info.time) ? info.time.toFixed(1) + "s" : "nobody working");
            const parts = info.parts.map((p) => `<i class="${p.tone}">${esc(p.label)} ${p.mul < 1 ? "−" : "+"}${Math.round(Math.abs(1 - p.mul) * 100)}%</i>`).join("");
            const el = $("cParts"); if (el._h !== parts) { el._h = parts; el.innerHTML = parts; }
            setText($("cQueue"), S.phase === "night" ? `${stall.queue.length} of ${sim.queueCap(stall)}` : `room for ${sim.queueCap(stall)}`);
            const ps = S.stats && S.stats.perStall[stall.id];
            setText($("cTonight"), S.phase === "night" && ps ? `${ps.served} served · ${starText(ps.served ? ps.stars / ps.served : 0)} · ${money(ps.revenue)}` : "not open yet");
        });
    } else if (sel.type === "vendor") {
        const v = sim.vendorById(S, sel.id);
        if (!v || v.gone) return select(null);
        nameTag.textContent = v.name;
        html += `<div class="cardHead">${avatar(v.look, true)}<div><h3>${esc(v.name)}</h3><p class="sub">${pips(v.skill)} skill ${v.skill} · $${v.wage} a night</p></div>${closeBtn}</div>`;
        if (v.hired) html += `<div class="bars"><span>Energy</span><div class="bar" id="cEnergy"><i></i></div><em id="cEnergyN"></em><span>Mood</span><div class="bar" id="cMood"><i></i></div><em id="cMoodN"></em></div>`;
        html += `<div class="lines" id="cLines"></div>`;
        if (v.hired && prep) {
            html += `<label class="fieldLabel" for="pickStall">WORKS AT</label><select id="pickStall" class="pick" data-act="post"><option value="">No stall</option>`;
            for (const t of S.stalls.slice().sort((a, b) => a.slot - b.slot)) {
                const o = t.vendorId != null && t.vendorId !== v.id ? sim.vendorById(S, t.vendorId) : null;
                html += `<option value="${t.id}" ${t.id === v.stallId ? "selected" : ""}>${STALLS[t.type].icon} ${STALLS[t.type].name}, spot ${t.slot + 1}${o ? " · replaces " + esc(o.name) : ""}</option>`;
            }
            html += `</select><div class="cardActions"><button class="btn small danger" data-act="fire">Let go</button></div>`;
        } else if (!v.hired && prep) {
            html += `<div class="cardActions"><button class="btn primary small" data-act="hire" ${S.cash < ECON.hireFee ? "disabled" : ""}>Hire for $${ECON.hireFee}</button></div>`;
        }
        const bar = (id, value) => { const el = $(id); if (!el) return; el.firstChild.style.width = value + "%"; el.className = "bar" + (value < 30 ? " low" : value < 55 ? " mid" : ""); setText($(id + "N"), String(Math.round(value))); };
        cardLive.push(() => {
            bar("cEnergy", v.energy); bar("cMood", v.mood);
            const lines = sim.explainVendor(S, v).map((l) => `<div class="line ${l.tone}"><span class="i">${l.icon}</span><b>${esc(l.title)}</b><span>${esc(l.text)}</span></div>`).join("");
            const el = $("cLines"); if (el && el._h !== lines) { el._h = lines; el.innerHTML = lines; }
        });
    } else if (sel.type === "manager") {
        const id = MANAGER_IDS[sel.id], def = MANAGERS[id], level = S.managers[id];
        if (!level) return select(null);
        nameTag.textContent = def.person;
        html += `<div class="cardHead">${avatar(def.look, true)}<div><h3>${esc(def.person)}</h3><p class="sub">${def.name} · ${pips(level, 3)} level ${level}</p></div>${closeBtn}</div>
            <div class="lines"><div class="line good"><span class="i">${def.icon}</span><b>${def.name}</b><span>${esc(def.text(def.levels[level - 1]))}</span></div></div>
            <p class="blurb">${def.levels[level] ? `Promote from the Managers tab for ${def.levels[level].cost}: ${esc(def.text(def.levels[level]))}` : "As good as this job gets."}</p>`;
    } else {
        const c = sim.customerById(S, sel.id);
        if (!c) return select(null);
        const reg = REGULARS[c.kind], known = reg && c.kind !== "critic";
        nameTag.textContent = c.name;
        html += `<div class="cardHead">${avatar(c.look, true)}<div><h3>${esc(c.name)}</h3><p class="sub">${reg ? reg.title : "Customer"}</p></div>${closeBtn}</div>
            <div class="bars"><span>Patience</span><div class="bar" id="cPatience"><i></i></div><em id="cPatienceN"></em></div>
            ${c.noEat ? "" : `<div class="kv"><span>Craving</span><b>${icon(c.craving, 16)} ${STALLS[c.craving].name}${c.thirsty ? " · thirsty " + icon("tea", 16) : ""}</b></div>
            <div class="kv"><span>Money left</span><b id="cBudget"></b></div>`}${c.tour ? `<div class="kv"><span>Here with</span><b>Mrs. Park's tour</b></div>` : ""}
            <div class="kv"><span>Right now</span><b id="cDoing" style="font-family:var(--display);font-size:13.5px"></b></div>
            ${reg ? `<p class="blurb">${reg.blurb}</p>` : ""}`;
        void known;
        cardLive.push(() => {
            if (!sim.customerById(S, c.id)) return select(null);
            const el = $("cPatience"), value = clamp((c.patience / c.patienceMax) * 100, 0, 100);
            el.firstChild.style.width = value + "%"; el.className = "bar" + (value < 35 ? " low" : value < 60 ? " mid" : "");
            setText($("cPatienceN"), String(Math.round(value)));
            if (!c.noEat) setText($("cBudget"), "$" + Math.round(c.budget));
            setText($("cDoing"), customerDoing(S, c));
        });
    }
    card.innerHTML = html;
    card.classList.remove("hidden");
    for (const fn of cardLive) fn();
}

$("card").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const S = app.S, sel = app.sel;
    if (b.dataset.goVendor) { sfx("ui"); return select({ type: "vendor", id: Number(b.dataset.goVendor) }); }
    const a = b.dataset.act;
    if (a === "close") { sfx("ui"); select(null); }
    else if (a === "price") { const stall = sim.stallById(S, sel.id); sim.setPrice(S, stall.id, stall.price + Number(b.dataset.d)); sfx("ui"); for (const fn of cardLive) fn(); if (app.mode === "prep") renderPanel(); persist(); }
    else if (a === "upgrade") {
        const stall = sim.stallById(S, sel.id), tier = LEVELS[stall.level].tier;
        if (act(sim.upgradeStall(S, sel.id), "hire")) {
            // a new tier changes how the stall looks, and gets the big celebration
            if (LEVELS[stall.level].tier > tier) { world.celebrate(sim.slotX(stall.slot), 3); toast(`${STALLS[stall.type].name}: ${LEVELS[stall.level].label.toLowerCase()}`, "good"); }
            $("card").querySelector("[data-act=upgrade]")?.focus({ preventScroll: true });
        }
    }
    else if (a === "move") { sfx("ui"); app.tab = "stalls"; setPlacing({ kind: "move", stallId: sel.id }); }
    else if (a === "sell") {
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Really sell?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Sell"; }, 2500); return; }
        const r = sim.sellStall(S, sel.id);
        app.sel = null; world.select(null);
        act(r, "place", r.ok ? `Sold for $${r.refund}` : "");
    }
    else if (a === "hire") { if (act(sim.hire(S, sel.id), "hire")) { const v = sim.vendorById(S, sel.id); toast(v.stallId != null ? `${v.name} hired and put to work` : `${v.name} hired. Buy a stall for them.`, "good"); } }
    else if (a === "fire") {
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Really let go?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Let go"; }, 2500); return; }
        const r = sim.fire(S, sel.id);
        app.sel = null; world.select(null);
        act(r);
    }
});
$("card").addEventListener("change", (e) => {
    const el = e.target, S = app.S, sel = app.sel;
    if (el.dataset.act === "staff") {
        // choosing "Nobody" stands the current vendor down
        const stall = sim.stallById(S, sel.id);
        act(el.value ? sim.assign(S, Number(el.value), stall.id) : stall.vendorId != null ? sim.assign(S, stall.vendorId, null) : { ok: true });
    } else if (el.dataset.act === "post") act(sim.assign(S, sel.id, el.value ? Number(el.value) : null));
});
$("nbWho").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { sfx("ui"); select({ type: "customer", id: Number(b.dataset.cust) }); } });

// ------------------------------------------------------------------ pointer: click to pick, drag to move along the street
let press = null;
const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
canvas.addEventListener("pointerdown", (e) => { press = { x: e.clientX, y: e.clientY, moved: false }; });
canvas.addEventListener("pointermove", (e) => {
    if (press) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 7) press.moved = true; return; }
    if (e.pointerType !== "mouse" || app.mode === "title" || app.placing) return;
    const p = local(e);
    canvas.classList.toggle("picking", !!world.pick(p.x, p.y, p.w, p.h));
});
canvas.addEventListener("pointerup", (e) => {
    const was = press;
    press = null;
    if (!was || was.moved || app.mode === "title" || app.menu) return;
    const p = local(e), hit = world.pick(p.x, p.y, p.w, p.h), S = app.S;
    if (app.placing) {
        if (hit && hit.type === "slot") chooseSlot(hit.id);
        else if (hit && hit.type === "stall" && app.placing.kind === "move") chooseSlot(sim.stallById(S, hit.id).slot);
        return;
    }
    if (!hit) { if (app.sel || app.slotFirst != null) { app.slotFirst = null; select(null); } return; }
    sfx("ui");
    if (hit.type === "slot") {
        if (app.mode !== "prep") return;
        app.slotFirst = hit.id; app.tab = "stalls"; app.sel = null; world.select(null);
        world.showSlots(null, S);
        renderCard(); renderPanel();
    } else { app.slotFirst = null; select(hit); }
});
canvas.addEventListener("pointercancel", () => { press = null; });

// ------------------------------------------------------------------ flow: title → prep → night → closing → event → …
function showOnly(...ids) { for (const s of screens) show(s, ids.includes(s)); }

function goTitle() {
    app.mode = "title"; app.menu = false; game.resume();
    app.sel = null; app.placing = null; app.slotFirst = null;
    document.body.classList.remove("night");
    world.select(null); world.showSlots(null, null);
    clearLabels();
    if (!app.demo) app.demo = makeDemo();
    world.reset(); world.rebuild(app.demo);
    showOnly("title");
    const c = save.campaign, live = c && c.phase !== "over";
    show("continueBtn", !!live);
    $("continueBtn").textContent = live ? `Continue · night ${c.night}` : "Continue";
    $("newBtn").className = live ? "btn" : "btn primary";
    $("newBtn").dataset.armed = "";
    $("newBtn").textContent = "New street";
    $("bestLine").textContent = save.best ? `Best street so far: ${money(save.best.cash)}, reputation ${save.best.rep}, ${"★".repeat(save.best.stars)}` : "";
    (live ? $("continueBtn") : $("newBtn")).focus({ preventScroll: true });
}

function startCampaign(state, fromSave = false) {
    app.S = sim.upgradeState(state);
    lastCash = null; shownCash = null;
    clearLabels();
    world.reset();
    homeView(app.S);
    const S = app.S;
    if (S.phase === "night") enterNight(true);
    else if (S.phase === "closing") { toPrepScreens(); showClosing(); }
    else if (S.phase === "over") { toPrepScreens(); showOver(); }
    else { toPrep(); if (fromSave) welcomeBack(); }
}

/** The night manager kept the street open while the game was closed: show what it earned. */
function welcomeBack() {
    const S = app.S, away = lastSeen ? (Date.now() - lastSeen) / 1000 : 0;
    lastSeen = 0;      // once per visit
    const r = sim.offlineEarnings(S, away);
    if (away < 60 || r.cash <= 0) return;
    const h = Math.floor(r.hours), m = Math.round((r.hours - h) * 60);
    $("offlineText").textContent = `${MANAGERS.night.person} kept the street open for ${h ? h + " h " : ""}${m} min while you were away${r.capped ? " (as long as a night manager at this level can cover)" : ""}.`;
    $("offlineCash").textContent = "+" + money(r.cash);
    $("offlineBtn").onclick = () => {
        sim.collectOffline(S, away);
        show("offline", false);
        sfx("tip");
        flyCoins($("offlineCash").getBoundingClientRect(), 14);
        updateHud(0, true); persist();
    };
    show("offline", true);
    $("offlineBtn").focus({ preventScroll: true });
}

function toPrepScreens() {
    showOnly("hud");
    show("dock", true); show("nightBar", false); show("speedCtl", false);
    document.body.classList.remove("night");
    world.rebuild(app.S);
    updateHud(0, true);
}

function toPrep() {
    const S = app.S;
    app.mode = "prep"; app.menu = false; game.resume();
    app.placing = null; app.slotFirst = null; app.openArmed = 0;
    world.showSlots(null, S);
    world.reset();
    toPrepScreens();
    $("feed").innerHTML = "";
    if (app.sel && app.sel.type === "customer") app.sel = null;
    world.select(app.sel ? anchorKey(app.sel) : null);
    if (!S.stalls.length) app.tab = "stalls";
    renderPanel(); renderCard();
    persist();
}

function openNight() {
    const S = app.S;
    if (app.mode !== "prep") return;
    if (!S.stalls.some((t) => sim.worker(S, t)) && performance.now() - app.openArmed > 3000) {
        app.openArmed = performance.now();
        toast("Nobody is working a stall. Press again to open anyway.", "bad"); sfx("invalid");
        return;
    }
    app.snapshot = JSON.stringify(S);
    sim.startNight(S);
    sfx("open");
    enterNight(false);
    for (const d of S.stats.discovered) {
        const a = sim.vendorById(S, d.a), b = sim.vendorById(S, d.b);
        feed(d.t === "friend" ? `${a.name} and ${b.name} turn out to be old friends.` : `${a.name} and ${b.name} have history. Bad history.`, d.t === "friend" ? "good" : "bad");
    }
    const n = S.stats.expected;
    feed(`Night ${S.night} is open. About ${n} customers on their way.`);
    if (S.weather === "rain") feed(S.flags.awnings ? "It's raining, but the awnings are keeping people dry." : "It's raining. Fewer people are out tonight.", S.flags.awnings ? "" : "bad");
    if (S.weather === "festival") feed("The lantern festival has begun.", "good");
    updateCoach();
}

function enterNight(resumed) {
    const S = app.S;
    app.mode = "night"; app.menu = false; game.resume();
    app.placing = null; app.slotFirst = null;
    world.showSlots(null, S);
    showOnly("hud");
    show("dock", false); show("nightBar", true); show("speedCtl", true);
    document.body.classList.add("night");
    $("hint").textContent = "";
    $("nbWho")._key = null;
    world.rebuild(S);
    setSpeed(resumed ? 0 : 1);
    if (resumed) feed("Paused where you left off. Press play to carry on.");
    renderCard();
    updateHud(0, true);
}

// ------------------------------------------------------------------ juice
let coinsFlying = 0;
/**
 * Coins arc from a point on screen to the cash counter, which bumps as each one lands.
 * @param {{ left: number, top: number, width: number, height: number }} from a rectangle in CSS pixels
 */
function flyCoins(from, count = 1) {
    if (reducedMotion() || document.hidden) return;
    const target = $("hudCash").parentElement.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2, x1 = target.left + 22, y1 = target.top + target.height / 2;
    for (let i = 0; i < count && coinsFlying < 26; i++) {
        const el = document.createElement("div");
        el.className = "coinFly";
        el.innerHTML = icon("coin", 22);
        document.body.appendChild(el);
        coinsFlying++;
        // a little scatter at the start, then up and over to the counter
        const sx = x0 + (Math.random() - 0.5) * 36, sy = y0 + (Math.random() - 0.5) * 20, lift = 50 + Math.random() * 50;
        const anim = el.animate([
            { transform: `translate(${sx}px, ${sy}px) scale(0.4)`, opacity: 0 },
            { transform: `translate(${sx}px, ${sy - 14}px) scale(1.15)`, opacity: 1, offset: 0.15 },
            { transform: `translate(${(sx + x1) / 2}px, ${Math.min(sy, y1) - lift}px) scale(1)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${x1}px, ${y1}px) scale(0.55)`, opacity: 0.9 },
        ], { duration: 620 + Math.random() * 180, delay: i * 70, easing: "cubic-bezier(0.3, 0, 0.5, 1)", fill: "both" });
        anim.onfinish = anim.oncancel = () => { el.remove(); coinsFlying--; bump($("hudCash").parentElement); };
    }
}
/** Screen rectangle of a stall's tag (where its coins come from), or null if it is off screen. */
function tagRect(stallId) {
    const el = stallTags.get(stallId);
    if (!el || el.style.visibility === "hidden") return null;
    el.classList.remove("sold"); void el.offsetWidth; el.classList.add("sold");
    return el.getBoundingClientRect();
}

function setSpeed(n) {
    app.speed = n;
    if (n > 0) app.lastSpeed = n;
    document.querySelectorAll("#speedCtl button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === n)));
}
$("speedCtl").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { sfx("ui"); setSpeed(Number(b.dataset.speed)); } });

/** Sounds, floating labels and feed lines for what just happened in the simulation. */
function react(S, events) {
    for (const e of events) {
        if (e.type === "served") {
            const stall = sim.stallById(S, e.stallId), x = stall ? sim.slotX(stall.slot) : 0;
            pop("s" + e.stallId, e.price ? "+$" + e.price : "free", "money");
            const from = tagRect(e.stallId);
            if (from && e.price) flyCoins(from, app.speed > 2 ? 1 : e.price >= 10 ? 3 : 2);
            sfx("coin", { pan: panOf(x), pitch: 0.9 + Math.random() * 0.25, volume: 0.6 });
            if (e.tip) { pop("c" + e.id, "tip +$" + e.tip, "good", 1.8); sfx("tip", { pan: panOf(x) }); }
            if (e.mistake) pop("v" + e.vendorId, "🔥", "emoji", 1.6);
        } else if (e.type === "review") {
            pop("c" + e.id, "★".repeat(e.stars), e.stars >= 4 ? "good" : e.stars <= 2 ? "bad" : "money", 1.6);
            if (e.stars >= 5) sfx("star", { volume: 0.5 });
        } else if (e.type === "angry") {
            const c = sim.customerById(S, e.id), stall = sim.stallById(S, e.stallId);
            pop("c" + e.id, "💢", "emoji", 1.8);
            sfx("angry", { pan: panOf(c ? c.x : 0), volume: 0.7 });
            if (c && c.kind !== "n") feed(`${c.name} walked out of the ${STALLS[stall.type].name} queue.`, "bad");
        } else if (e.type === "walkby") {
            const c = sim.customerById(S, e.id);
            pop("c" + e.id, c && c.kind === "student" ? "💸" : "…", "emoji", 1.6);
        } else if (e.type === "arrive") {
            const c = sim.customerById(S, e.id);
            if (!c) continue;
            pop("c" + e.id, icon(c.craving, 22), "emoji", 2.2);
            if (c.kind === "landlord") feed("Mr. Okafor, your landlord, has arrived. Serve him quickly.", "bad");
            else if (c.kind === "kid") feed("Pip and Biscuit are on the street. Stalls near them get busier.", "good");
            else if (c.kind === "nurse") feed("Imani is on her break. She tips if her vendor still has energy.");
            else if (c.kind === "student") feed(S.policy.student ? "Bao is here for his dinner." : "A student is walking the street, counting coins.");
            else if (c.kind === "guide") feed("Mrs. Park's tour group is here: seven hungry people at once.", "good");
            else if (c.kind === "inspector") feed("The health inspector is on the street. Tired hands and botched orders get written down.", "bad");
        } else if (e.type === "inspect") {
            pop("c" + e.id, e.fault ? "✍️" : "✔️", "emoji", 2.2);
            if (e.fault) { pop("v" + e.vendorId, "📋", "emoji", 2.2); feed(`The inspector is writing something down about ${sim.vendorById(S, e.vendorId).name}.`, "bad"); }
        } else if (e.type === "scene") {
            const a = sim.vendorById(S, e.va), b = sim.vendorById(S, e.vb);
            pop("v" + e.va, "💢", "emoji", 2.4); pop("v" + e.vb, "💢", "emoji", 2.4);
            feed(`${a.name} and ${b.name} have stopped serving to argue. Both queues are waiting.`, "bad");
            sfx("scene");
        } else if (e.type === "mistake") {
            const v = sim.vendorById(S, e.vendorId);
            if (Math.random() < 0.5) feed(`${v.name} is flustered by the queue and botching orders.`, "bad");
        } else if (e.type === "tired") {
            const v = sim.vendorById(S, e.vendorId);
            pop("v" + e.vendorId, "💤", "emoji", 2.2);
            feed(`${v.name} is getting tired and slowing down.`);
        } else if (e.type === "scout") {
            const v = sim.vendorById(S, e.vendorId);
            pop("c" + e.id, "👀", "emoji", 2.6);
            feed(`A man in sunglasses is watching ${v.name} very closely.`);
        }
    }
}

function nightOver() {
    const S = app.S;
    app.mode = "closing";
    sfx("close");
    persist();
    setTimeout(() => { if (app.mode === "closing" && app.S === S) showClosing(); }, reducedMotion() ? 200 : 900);
}

function showClosing() {
    const S = app.S, m = S.summary;
    app.mode = "closing";
    select(null);
    world.reset(); world.rebuild(S);
    show("speedCtl", false); show("nightBar", false);
    document.body.classList.remove("night");
    $("closingTitle").textContent = `Night ${m.night} is over`;
    $("closingEyebrow").textContent = `${m.served} SERVED · ${m.angry} WALKED OUT · ${m.walked} FOUND NOTHING`;
    const row = (label, value, cls = "") => `<div class="${cls}"><span>${label}</span><b>${value}</b></div>`;
    $("ledger").innerHTML = row("Takings", money(m.revenue)) + (m.tips ? row("Tips", money(m.tips)) : "") + row("Ingredients", money(-m.ingredients), "neg")
        + row("Wages", money(-m.wages), "neg") + row("Stall upkeep", money(-m.upkeep), "neg") + row("Rent", money(-m.rent), "neg")
        + row("Tonight", (m.net >= 0 ? "+" : "") + money(m.net), "total " + (m.net >= 0 ? "up" : "down")) + row("Cash in hand", money(m.cash), m.cash < 0 ? "neg" : "");
    // the night's total rolls up from zero once the rows above it have appeared
    const totalEl = $("ledger").querySelector(".total b");
    if (totalEl && !reducedMotion()) {
        const t0 = performance.now() + 650, roll = () => {
            const u = Math.min(1, Math.max(0, (performance.now() - t0) / 700)), v = m.net * (1 - Math.pow(1 - u, 3));
            totalEl.textContent = (m.net >= 0 ? "+" : "") + money(v);
            if (u < 1 && app.mode === "closing") setTimeout(roll, 30);
        };
        roll();
    }
    const dRep = m.repAfter - m.repBefore;
    $("repRow").innerHTML = `<span class="chip">Reviews <b>${starText(m.avgStars)}</b></span>
        <span class="chip ${dRep >= 0 ? "up" : "down"}">Reputation <b>${Math.round(m.repAfter)} (${signed(dRep)})</b></span>
        ${m.critic != null ? `<span class="chip ${m.critic >= 4 ? "up" : m.critic <= 2 ? "down" : ""}">The critic was here: <b>${m.critic ? m.critic + "★" : "walked out"}</b></span>` : ""}`;
    $("moments").innerHTML = m.best.map((t) => `<p>${esc(t)}</p>`).join("") + m.worst.map((t) => `<p class="bad">${esc(t)}</p>`).join("");
    $("staffRows").innerHTML = m.vendors.map((v) => `<div><b>${esc(v.name)}${v.levelUp ? ` <span class="up">▲ skill ${v.skill}</span>` : ""}</b>
        <span>${v.worked ? v.served + " served" : "didn't work"}</span><span>${v.served ? starText(v.avg) : ""}</span>
        <span class="${v.moodDelta > 0 ? "up" : v.moodDelta < 0 ? "down" : ""}">mood ${Math.round(v.mood)}${v.moodDelta ? " (" + signed(v.moodDelta) + ")" : ""}</span></div>`).join("");
    $("closingNext").textContent = S.outcome === "lost" ? "The landlord wants a word" : S.event && !S.event.done ? "One more thing…" : "Continue";
    show("event", false); show("over", false);
    show("closing", true);
    $("closingNext").focus({ preventScroll: true });
    updateCoach();
}

function showEvent() {
    const S = app.S, d = describeEvent(S);
    if (!d) return nextNight();
    app.mode = "event";
    show("closing", false);
    $("eventTitle").textContent = d.title;
    $("eventText").textContent = d.text;
    $("eventWho").innerHTML = d.who ? avatar((d.who.vendor || d.who.regular).look, true) : `<span class="bigIco" style="font-size:44px">🏮</span>`;
    const box = $("eventChoices");
    box.innerHTML = d.choices.map((c) => `<button class="choice${S.event.choice === c.index ? " picked" : ""}" data-i="${c.index}" ${c.disabled || d.done ? "disabled" : ""}><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></button>`).join("");
    $("eventResult").textContent = d.result;
    show("eventResult", d.done); show("eventNext", d.done);
    show("event", true);
    if (!d.done) sfx("event");
    (d.done ? $("eventNext") : box.querySelector("button:not([disabled])"))?.focus({ preventScroll: true });
}
$("eventChoices").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || app.mode !== "event") return;
    const r = resolveEvent(app.S, Number(b.dataset.i));
    if (!r.ok) { toast(r.error, "bad"); sfx("invalid"); return; }
    sfx("place");
    world.rebuild(app.S);
    updateHud(0, true);
    persist();
    showEvent();
});

function nextNight() {
    const S = app.S;
    show("closing", false); show("event", false);
    sim.advance(S);
    if (S.phase === "over") return showOver();
    fade(() => { homeView(S); toPrep(); });
}

function showOver() {
    const S = app.S, won = S.outcome === "won";
    app.mode = "over";
    show("closing", false); show("event", false);
    const stars = sim.campaignStars(S);
    $("overEyebrow").textContent = won ? "TEN NIGHTS" : `NIGHT ${S.night}`;
    $("overTitle").textContent = won ? "The street is yours" : "The shutters come down";
    $("overText").textContent = won
        ? (stars === 3 ? "Rent paid, queues down the block, and money in the bank. Nobody on this street will forget your name." : "You made the rent ten nights running. " + (S.cash < 600 ? "Finish with $600 or more for another star. " : "") + (S.rep < 70 ? "Reach a reputation of 70 for another star." : ""))
        : `You couldn't cover the bills: ${money(S.cash)} after rent and wages. Mr. Okafor has changed the locks.`;
    show("overStars", won);
    [...$("overStars").children].forEach((el, k) => { el.classList.remove("on"); void el.offsetWidth; el.classList.toggle("on", won && k < stars); });
    $("overNights").textContent = String(S.history.length);
    $("overCash").textContent = money(S.cash);
    $("overRep").textContent = String(Math.round(S.rep));
    show("endlessBtn", won); show("retryBtn", !won && !!app.snapshot);
    show("over", true);
    sfx(won ? "win" : "lose");
    if (won) {
        const b = save.best;
        if (!b || stars > b.stars || (stars === b.stars && S.cash > b.cash)) save.best = { cash: Math.round(S.cash), rep: Math.round(S.rep), stars };
    }
    persist();
    (won ? $("endlessBtn") : app.snapshot ? $("retryBtn") : $("overNew")).focus({ preventScroll: true });
}

function restartNight() {
    if (!app.snapshot) return;
    const state = JSON.parse(app.snapshot);
    fade(() => { showOnly("hud"); startCampaign(state); toast("Back to before opening. Change something.", "good"); });
}

// ------------------------------------------------------------------ pause + settings
function setMenu(on) {
    if (app.mode === "title" || app.mode === "over") return;
    app.menu = on;
    if (on) game.pause(); else game.resume();
    show("pause", on);
    show("restartNightBtn", app.mode === "night" && !!app.snapshot);
    if (on) $("resumeBtn").focus();
}
let settingsReturn = null;
function openSettings() {
    settingsReturn = document.activeElement;
    $("setSfx").value = save.settings.sfx; $("setMusic").value = save.settings.music;
    $("setBloom").checked = save.settings.bloom; $("setShadows").checked = save.settings.shadows; $("setMotion").checked = reducedMotion();
    show("settings", true);
    $("settings").querySelector("[data-close]").focus();
}
function closeSettings() { show("settings", false); settingsReturn?.focus?.(); }

// ------------------------------------------------------------------ buttons
const click = (id, fn) => $(id).addEventListener("click", () => { sfx("ui"); fn(); });
const newCampaign = () => fade(() => { app.snapshot = null; startCampaign(sim.createCampaign(1 + Math.floor(Math.random() * 2147483000))); });
click("continueBtn", () => { if (save.campaign) fade(() => startCampaign(JSON.parse(JSON.stringify(save.campaign)), true)); });
$("newBtn").addEventListener("click", (e) => {
    const b = e.currentTarget, live = save.campaign && save.campaign.phase !== "over";
    sfx("ui");
    if (live && b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Replace your saved street?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "New street"; }, 3000); return; }
    newCampaign();
});
$("openBtn").addEventListener("click", openNight);
click("menuBtn", () => setMenu(true));
click("resumeBtn", () => setMenu(false));
click("restartNightBtn", () => { setMenu(false); restartNight(); });
click("pauseTitleBtn", () => { setMenu(false); persist(); fade(goTitle); });
click("closingNext", () => { const S = app.S; if (S.outcome === "lost") { show("closing", false); sim.advance(S); showOver(); } else if (S.event && !S.event.done) showEvent(); else nextNight(); });
click("eventNext", nextNight);
click("endlessBtn", () => { show("over", false); sim.continueEndless(app.S); fade(() => { homeView(app.S); toPrep(); }); });
click("retryBtn", () => { show("over", false); restartNight(); });
click("overNew", () => { show("over", false); newCampaign(); });
click("overTitleBtn", () => { show("over", false); fade(goTitle); });
document.querySelectorAll("[data-open='settings']").forEach((b) => b.addEventListener("click", () => { sfx("ui"); openSettings(); }));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { sfx("ui"); closeSettings(); }));
$("setSfx").addEventListener("input", (e) => { save.settings.sfx = +e.target.value; applySettings(); persist(); sfx("ui"); });
$("setMusic").addEventListener("input", (e) => { save.settings.music = +e.target.value; applySettings(); persist(); });
$("setBloom").addEventListener("change", (e) => { save.settings.bloom = e.target.checked; applySettings(); persist(); });
$("setShadows").addEventListener("change", (e) => { save.settings.shadows = e.target.checked; applySettings(); persist(); });
$("setMotion").addEventListener("change", (e) => { save.settings.reducedMotion = e.target.checked; applySettings(); persist(); });
click("replayTutorial", () => {
    save.tutorial = { done: false, ack: {}, replay: true };
    persist();
    closeSettings();
    toast("The tutorial will show on a new street.", "good");
});
$("resetProgress").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Press again"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Erase"; }, 2500); return; }
    save.campaign = null; save.best = null; save.tutorial = { done: false, ack: {} }; b.dataset.armed = ""; b.textContent = "Erased";
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* storage unavailable */ }
    if (app.mode !== "title") { app.S = null; closeSettings(); setMenu(false); show("pause", false); }
    app.S = null;
    fade(goTitle);
});

// ------------------------------------------------------------------ keyboard (engine action mapping)
input.bindAxis("pan", { negative: ["KeyA", "ArrowLeft"], positive: ["KeyD", "ArrowRight"] })
    .bindAxis("turn", { negative: ["KeyQ"], positive: ["KeyE"] })
    .bindAxis("zoom", { negative: ["KeyZ", "Equal"], positive: ["KeyX", "Minus"] })
    .bind("pause", ["Space"]).bind("speed1", ["Digit1"]).bind("speed2", ["Digit2"]).bind("speed3", ["Digit3"]);
// Escape has to work while the loop is paused too, so it is handled directly
addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || e.repeat) return;
    if (!$("settings").classList.contains("hidden")) return closeSettings();
    if (app.mode === "title" || app.mode === "closing" || app.mode === "event" || app.mode === "over") return;
    if (app.menu) return setMenu(false);
    if (app.placing) return setPlacing(null);
    if (app.slotFirst != null) { app.slotFirst = null; return renderPanel(); }
    if (app.sel) return select(null);
    setMenu(true);
});
// the campaign survives a closed tab, even in the middle of a night
addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });

// ------------------------------------------------------------------ simulation step (60 Hz)
game.onUpdate((dt) => {
    if (app.mode === "title") { app.titleT += dt; stepDemo(); return; }
    // camera: drag, wheel, pinch, keys
    const p = input.pointer;
    if (p.dragging && p.dx) { const perPixel = (2 * view.dist) / (camera.focal * Math.max(1, canvas.clientHeight)); goal.x -= p.dx * perPixel; view.x = goal.x; }
    if (p.wheel || p.pinch !== 1 || input.axis("zoom")) autoFit = false;
    if (p.wheel) goal.dist *= Math.exp(clamp(p.wheel, -300, 300) * 0.0012);
    if (p.pinch !== 1) goal.dist /= p.pinch;
    goal.x += input.axis("pan") * dt * 14;
    goal.rot += input.axis("turn") * dt * 0.9;
    goal.dist *= Math.exp(input.axis("zoom") * dt * 1.3);

    if (app.mode !== "night") return;
    if (input.wasPressed("pause")) setSpeed(app.speed ? 0 : app.lastSpeed);
    if (input.wasPressed("speed1")) setSpeed(1);
    if (input.wasPressed("speed2")) setSpeed(2);
    if (input.wasPressed("speed3")) setSpeed(4);
    const S = app.S;
    for (let k = 0; k < app.speed; k++) {
        const alive = sim.stepNight(S);
        world.consume(S, S.events);
        react(S, S.events);
        if (!alive) { nightOver(); break; }
    }
});

// ------------------------------------------------------------------ tutorial
/**
 * A coach that walks a first-time player through the first night. Each step is worked out from the
 * state of the game, so doing things in another order (or without being told) just skips ahead.
 * A step either waits for the player to do something (it points at `target`), or is a note they
 * dismiss (`next`).
 * @returns {{ id: string, text: string, target?: string, next?: boolean, last?: boolean } | null}
 */
function coachStep() {
    const S = app.S, t = save.tutorial;
    if (!S || t.done || app.mode === "title" || app.menu || S.endless) return null;
    if (S.night > 2 || (S.night === 2 && app.mode !== "prep")) { t.done = true; return null; }
    const ack = t.ack;
    if (S.night === 1 && app.mode === "prep") {
        if (!ack.welcome) return { id: "welcome", next: true, text: "This is your street. You have $400 and ten nights, and rent is due every night. Let's get a stall open." };
        if (!S.stalls.length) {
            if (app.placing) return { id: "place", target: ".slotPick .slots", text: "Now pick a spot: tap a glowing tile on the street, or one of these numbers." };
            if (app.tab !== "stalls") return { id: "tabStalls", target: "#tab-stalls", text: "Stalls are bought here." };
            return { id: "buy", target: '[data-buy="dumplings"]', text: "Start with a stall. Dumplings are a safe first choice: tap it." };
        }
        if (!sim.hiredVendors(S).length) {
            const v = app.sel?.type === "vendor" ? sim.vendorById(S, app.sel.id) : null;
            if (v && !v.hired) return { id: "hire", target: '#card [data-act="hire"]', beside: "#card", text: `This is ${v.name}. Traits change how someone works, so read them. Then hire.` };
            if (app.tab !== "staff") return { id: "tabStaff", target: "#tab-staff", text: "A stall needs someone to run it. Open Staff." };
            return { id: "pick", target: `.person[data-vendor="${S.market[0]}"]`, text: "These people are looking for work tonight. Tap one to see who they are." };
        }
        if (!ack.tips) return { id: "tips", next: true, text: "Tap a stall to change its price or upgrade it. If you can afford a second stall of a different kind, it catches more of the crowd." };
        return { id: "open", target: "#openBtn", text: "When you're ready, open for the night." };
    }
    if (S.night === 1 && app.mode === "night") {
        if (!ack.watch) return { id: "watch", next: true, text: "Everyone arrives craving one kind of food. Tap anyone, customer or vendor, to see what they want and how they feel." };
        if (!ack.speed) return { id: "speed", next: true, target: "#speedCtl", text: "In a hurry? Run the night at 2× or 4×, or pause it." };
    }
    if (S.night === 1 && app.mode === "closing" && !ack.ledger) return { id: "ledger", next: true, target: "#ledger", text: "Takings, minus ingredients, wages, upkeep and rent. If cash in hand ever drops below zero, the street closes." };
    if (S.night === 2 && app.mode === "prep" && !ack.people) return { id: "people", next: true, last: true, text: "From here on it is a people puzzle. Friends side by side serve faster; rivals side by side argue. The Street tab lists who knows whom. Good luck." };
    return null;
}

let coachId = null;
function updateCoach() {
    const el = $("coach"), step = coachStep();
    const target = step && step.target ? document.querySelector(step.target) : null;
    for (const old of document.querySelectorAll(".coachTarget")) if (old !== target) old.classList.remove("coachTarget");
    el.classList.toggle("hidden", !step);
    if (!step) { coachId = null; return; }
    if (target) target.classList.add("coachTarget");
    if (coachId !== step.id) {
        coachId = step.id;
        $("coachText").textContent = step.text;
        show("coachNext", !!step.next);
        $("coachNext").textContent = step.last ? "Let's go" : "Got it";
        el.classList.remove("fresh"); void el.offsetWidth; el.classList.add("fresh");
    }
    // sit next to what it points at, wherever on screen there is room; otherwise under the top bar
    const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight, r = target && target.getBoundingClientRect();
    let x = (vw - w) / 2, y = 84;
    if (r && r.width) {
        x = clamp(r.left + r.width / 2 - w / 2, 10, vw - w - 10);
        y = r.top - h - 14;
        if (y < 70) y = Math.min(vh - h - 10, r.bottom + 14);
        el.style.setProperty("--arrow", clamp(r.left + r.width / 2 - x, 18, w - 18) + "px");
    }
    // a step about something inside a panel stands beside the panel, so it never covers what it talks about
    const box = step.beside && document.querySelector(step.beside)?.getBoundingClientRect();
    const beside = !!box && box.left - w - 14 > 10;
    if (beside) { x = box.left - w - 14; y = clamp(r ? r.top + r.height / 2 - h / 2 : box.top, 70, vh - h - 10); }
    else if (box) y = Math.max(70, box.top - h - 14);
    el.classList.toggle("below", !!r && !box && y > r.top);
    el.classList.toggle("free", !r || !r.width || !!box);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
$("coachNext").addEventListener("click", () => {
    const step = coachStep();
    sfx("ui");
    if (step) { save.tutorial.ack[step.id] = true; if (step.last) save.tutorial.done = true; }
    persist();
    updateCoach();
});
$("coachSkip").addEventListener("click", () => { sfx("ui"); save.tutorial.done = true; persist(); updateCoach(); });
// the screen changes for many reasons (panels re-render, the window resizes), so the coach just re-checks
setInterval(updateCoach, 300);
addEventListener("resize", updateCoach);

// ------------------------------------------------------------------ keeping the frame rate up
/**
 * If the GPU can't keep up, give up the most expensive effects one at a time, cheapest loss first.
 * Nothing is written to the saved settings: a slow moment shouldn't change them for good.
 *
 * The time between frames is no guide (a browser throttles a window in the background without marking
 * it hidden), so every few seconds one frame is drawn a second time with the GPU made to finish, and
 * that is what gets timed.
 */
const quality = { frames: 0, slow: 0, step: 0, last: 0, steps: [
    () => { renderer.postfx.settings.ao.enabled = false; },
    () => { renderer.resolutionScale = 0.8; renderer.resize(); },
    () => { scene.shadow.enabled = false; },
    () => { renderer.resolutionScale = 0.65; renderer.resize(); },
] };
function watchFrameRate() {
    if (document.hidden || app.menu || quality.step >= quality.steps.length || ++quality.frames % 150) return;
    const gl = renderer.gl;
    gl.finish();
    const t0 = performance.now();
    renderer.render(scene, camera, 1);
    gl.finish();
    quality.last = performance.now() - t0;
    // 24 ms of GPU work leaves no room for 60 frames a second, and little for 30 once the page's own work is added
    quality.slow = quality.last > 24 ? quality.slow + 1 : 0;
    if (quality.slow < 3) return;
    quality.slow = 0;
    quality.steps[quality.step++]();
    if (quality.step === 1) toast("Graphics lowered a little to keep things smooth");
}

// ------------------------------------------------------------------ per rendered frame
game.onRender((frameDelta) => {
    const S = cur();
    if (!S) return;
    watchFrameRate();
    updateCamera(frameDelta);
    const running = !app.menu && (app.mode === "title" || (app.mode === "night" && app.speed > 0));
    world.frame(S, game.loop.realTime, frameDelta, running);
    updateLabels(frameDelta);
    updateHud(frameDelta);
});

// ------------------------------------------------------------------ boot
document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18); });
applySettings();
goTitle();
game.start();
$("fade").classList.remove("on");

// testing / console hook
window.market = { app, game, world, sim, save, view, goal, quality, updateCoach, BOTS, playNight, startCampaign, openNight, setSpeed, select, goTitle };
