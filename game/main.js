import { Game, PostFX } from "../engine/index.js";
import { FOLDS, FOLD_IDS, DT, MATCH, TAG } from "./data.js";
import { Client, Loopback, SocketTransport, Conditions } from "./net.js";
import { PROTOCOL, NAME_MAX, FLAG, cleanText } from "./protocol.js";
import { ROOMS } from "./rooms/index.js";
import { GreyboxView } from "./view.js";
import { PlaneView, INK } from "./planeview.js";
import { RollCamera, ChaseCamera } from "./camera.js";
import { Controls, defaultBindings, keyHint } from "./controls.js";
import { Room } from "../server/room.mjs";
import { brains } from "./bots.js";

/**
 * PAPER PLANES: the application. Screens, the camera, and the wiring between the parts. The match lives in
 * sim.js, the room that runs it in server/room.mjs (the same class here for Practice and on the server),
 * the network in net.js (TIDEFALL's), the room's look in view.js and each plane's in planeview.js.
 * Structure follows TIDEFALL's main.js. Modes: Ring Run, Classic Tag, Ink Spread. The settings screen,
 * saving and the notebook menus come in stage 7.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ engine
const canvas = $("view");
const camera = new RollCamera({ mode: "orbit", fov: 70, near: 0.02, far: 40 });
const game = new Game({ canvas, quality: "high", antialias: true, camera });
if (game.failed) throw new Error("WebGL unavailable");
game.renderer.postfx = new PostFX(game.renderer, { bloom: { threshold: 1.2, intensity: 0.35 }, vignette: 0.25, contrast: 1.05, saturation: 1.05, exposure: 1.0 });

const settings = { sensitivity: 1, invertPitch: false, bindings: defaultBindings(), lean: 1, fovKick: true, horizonLock: false, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches };
game.juice.reducedMotion = settings.reducedMotion;
document.body.classList.toggle("reduce-motion", settings.reducedMotion);
const client = new Client();
const controls = new Controls(game.input, canvas, settings);
/** @type {GreyboxView | null} */
let view = null, viewRoom = "";
/** @type {ChaseCamera | null} */
let chase = null;
/** my plane's look, and every other plane's: id → { view, proxy, events } */
let mine = null;
const others = new Map();
const TINTS = [[0.98, 0.9, 0.86], [0.86, 0.93, 0.98], [0.9, 0.97, 0.86], [0.98, 0.95, 0.82], [0.93, 0.88, 0.98], [0.86, 0.97, 0.95], [0.98, 0.88, 0.93], [0.92, 0.92, 0.92]];

// ------------------------------------------------------------------ screens
let screen = "title";
function show(name) {
    screen = name;
    $("title").hidden = name !== "title";
    $("pause").hidden = name !== "pause";
    $("hud").hidden = name === "title";
    controls.active = name === "play";
    if (name !== "play") for (const code of [...game.input.down]) game.input.release(code);
    if (name === "title") $("practice").focus();
    else if (name === "pause") $("resume").focus();
}
function lockMouse() {
    if (controls.coarse) return;
    try { const a = canvas.requestPointerLock(); if (a && a.catch) a.catch(() => {}); } catch { /* not available */ }
}
function resume() { show("play"); lockMouse(); canvas.focus(); }

/** latency, jitter and loss added to the link on purpose, from the pause menu */
const conditions = { latency: 0, jitter: 0, loss: 0 };
/** @type {Room | null} the room this page runs itself (Practice) */
let room = null;

function startPractice() {
    leave();
    room = new Room({ code: "PRACTICE", mode: $("p-mode").value, set: +$("p-set").value, bots: +$("p-bots").value + 1, skill: 2, seed: (Date.now() & 0xffffff) + 1, brains });
    const link = new Conditions(new Loopback(room), conditions);
    link.settings = conditions;
    client.attach(link);
    link.connect(playerName(), $("fold").value);
    resume();
}

// ------------------------------------------------------------------ online (as TIDEFALL)
function serverUrl() {
    const named = new URLSearchParams(location.search).get("server");
    if (named) return named.endsWith("/ws") ? named : named.replace(/[/]$/, "") + "/ws";
    if (!location.host) return "";
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}
const online = { url: serverUrl(), up: false, last: null };

async function probe() {
    const status = $("server-status"), buttons = [$("quick"), $("create"), $("join")];
    let info = null;
    try {
        if (!online.url) throw new Error("no server");
        const reply = await fetch(online.url.replace(/^ws/, "http").replace(/[/]ws$/, "/status"), { cache: "no-store" });
        info = await reply.json();
        if (info.game !== "paper-planes") throw new Error("not a PAPER PLANES server");
    } catch { info = null; }
    online.up = !!info;
    for (const b of buttons) b.disabled = !online.up;
    if (!info) status.textContent = "No server here. Practice works without one.";
    else if (info.protocol !== PROTOCOL) { status.textContent = "The server is a different version from this page. Reload."; for (const b of buttons) b.disabled = true; }
    else status.textContent = `Server is up: ${info.players} flying in ${info.rooms} ${info.rooms === 1 ? "room" : "rooms"}.`;
}

function playOnline(hello) {
    leave();
    online.last = hello;
    const link = new Conditions(new SocketTransport(online.url), conditions);
    link.settings = conditions;
    client.attach(link);
    link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name: playerName(), fold: $("fold").value, ...hello });
    link.connect();
    resume();
    notice("Connecting…", 20);
}

function leave() {
    client.detach(); room = null;
    for (const o of others.values()) o.view.dispose();
    others.clear();
    if (document.pointerLockElement) game.input.unlockPointer();
}
function toTitle() { leave(); history.replaceState(null, "", location.pathname + location.search); show("title"); }
function playerName() { return cleanText($("name").value, NAME_MAX) || "Player"; }

{
    $("p-bots").replaceChildren(...Array.from({ length: MATCH.maxPlayers }, (_, i) => new Option(i ? `${i + 1} (you + ${i} bots)` : "Just you", String(i))));
    $("p-set").replaceChildren(...ROOMS.bedroom.rings.map((s, i) => new Option(s.name, String(i))));
    $("fold").replaceChildren(...FOLD_IDS.map((f) => new Option(FOLDS[f].name, f)));
    $("fold").value = "glider";
    $("p-mode").addEventListener("change", () => { $("p-set").closest("label").hidden = $("p-mode").value !== "rings"; });
    $("practice").addEventListener("click", startPractice);
    $("quick").addEventListener("click", () => playOnline({}));
    $("create").addEventListener("click", () => playOnline({ create: { mode: $("p-mode").value, set: +$("p-set").value, bots: +$("p-bots").value + 1, skill: 2, open: true } }));
    const code = $("code");
    code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ""); });
    $("join-form").addEventListener("submit", (e) => { e.preventDefault(); if (code.value.length === 4 && online.up) playOnline({ room: code.value }); else code.focus(); });
    const invited = location.hash.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
    if (invited.length === 4) code.value = invited;
    probe();
}
$("resume").addEventListener("click", resume);
$("leave").addEventListener("click", () => { toTitle(); probe(); });
$("invite").addEventListener("click", async () => {
    const link = location.origin + location.pathname + location.search + "#" + client.room.code;
    try { await navigator.clipboard.writeText(link); $("invite").textContent = "Link copied"; } catch { prompt("Invite link", link); }
});
for (const [id, key, unit, scale] of [["net-latency", "latency", " ms", 1], ["net-jitter", "jitter", " ms", 1], ["net-loss", "loss", " %", 0.01]]) {
    const slider = $(id), out = $(id + "-out");
    const apply = () => { conditions[key] = +slider.value * scale; out.textContent = slider.value + unit; };
    slider.addEventListener("input", apply);
    apply();
}
canvas.addEventListener("click", () => { if (screen === "play" && !game.input.pointer.locked) lockMouse(); });
let lockLost = 0;
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && screen === "play") { lockLost = performance.now(); show("pause"); } });
addEventListener("keydown", (e) => {
    if (e.code === "F3") { e.preventDefault(); $("debug").hidden = !$("debug").hidden; }
    else if (e.code === "Escape" && performance.now() - lockLost > 400) {
        if (screen === "play" && !document.pointerLockElement) show("pause");
        else if (screen === "pause") resume();
    } else if (screen === "play" && !e.repeat && (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3")) {
        const fold = FOLD_IDS[Number(e.code.slice(5)) - 1];
        $("fold").value = fold;
        client.send({ t: "fold", fold });
    } else if (screen === "play" && e.code === "KeyF" && view) view.motes.visible = !view.motes.visible;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code) && screen === "play") e.preventDefault();
});

// ------------------------------------------------------------------ what the match tells us
let noticeUntil = 0;
function notice(text, seconds = 3) { $("notice").textContent = text; noticeUntil = performance.now() + seconds * 1000; }

/** Build the room's scene the first time it's needed (one room so far), and take the round's seed. */
function setupRoom() {
    const r = client.room;
    if (!view || viewRoom !== r.room) {
        view = new GreyboxView(game, ROOMS[r.room], r.seed);
        viewRoom = r.room;
        chase = new ChaseCamera(camera, ROOMS[r.room]);
        mine = new PlaneView(game.scene, { effects: view.effects });
    }
    view.setSeed(r.seed);
    $("results").hidden = true;
    shown = false;
    const set = r.mode === "rings" ? ROOMS[r.room].rings[r.set] : null;
    view.showRings(set);
    view.updateRings(0);
    mine.trail.clear();
    ringsShown = 0;
}
let ringsShown = 0;

client.on("welcome", () => {
    setupRoom();
    const practice = client.room.code === "PRACTICE";
    if (!practice) { history.replaceState(null, "", location.pathname + location.search + "#" + client.room.code); $("code").value = client.room.code; }
    notice(practice ? "Practice" : `Room ${client.room.code}`, 3);
    $("room-line").hidden = practice;
    $("room-code").textContent = client.room.code;
    $("invite").textContent = "Copy invite link";
    awaitingFirst = true;
});
client.on("start", () => { setupRoom(); notice(MODE_NAME[client.room.mode], 3); awaitingFirst = true; });
const MODE_NAME = { rings: "Ring Run", tag: "Classic Tag", spread: "Ink Spread" };
client.on("close", (reason) => {
    const was = client.room && client.room.code !== "PRACTICE" ? client.room.code : online.last && online.last.room;
    toTitle();
    if (was) $("code").value = was;
    probe().then(() => { $("server-status").textContent = (reason || "Disconnected.") + (was && online.up ? ` Press Join to go back to room ${was}.` : ""); });
});
client.on("roster", () => {
    for (const [id, o] of others) if (!client.players.has(id) || id === client.id) { o.view.dispose(); others.delete(id); }
});
// other planes' events go to their views; mine were already shown when predicted; the match's are for all
client.on("event", (e) => {
    if (e.type === "tag" || e.type === "it" || e.type === "eraser" || e.type === "shield" || e.type === "over") return matchEvent(e);
    if (e.id === client.id) { if (e.type === "done") notice(`Set done in ${(e.ticks * DT).toFixed(2)} s`, 4); return; }
    const o = others.get(e.id);
    if (o) o.events.push(e);
});
const nameOf = (id) => (id === client.id ? "You" : client.players.get(id)?.name || "Someone");
/** where a plane is drawn right now (mine predicted, others interpolated) */
function drawnAt(id) {
    if (id === client.id) return [at.x, at.y, at.z];
    const s = {};
    return client.sample(id, s) ? [s.x, s.y, s.z] : null;
}
function matchEvent(e) {
    const spread = client.room.mode === "spread";
    if (e.type === "it") {
        notice(e.id === client.id ? (spread ? "You're the hunter! Ink them all" : "You're it! Tag someone") : `${nameOf(e.id)} ${spread ? "is the hunter" : "is it"}`, 3);
        if (e.id === client.id) stamp(spread ? "HUNTER" : "YOU'RE IT");
    } else if (e.type === "tag") {
        const where = drawnAt(e.target);
        if (where) view.splat(where[0], where[1], where[2], INK);
        if (e.target === client.id) { stamp(spread ? "INKED" : "YOU'RE IT"); game.juice.freeze(60); game.juice.shake(0.25); }
        else if (e.id === client.id) { stamp("TAGGED!", true); game.juice.freeze(60); game.juice.shake(0.15); }
        feed(`${nameOf(e.id)} tagged ${nameOf(e.target).toLowerCase() === "you" ? "you" : nameOf(e.target)}`);
    } else if (e.type === "eraser") {
        view.sparkle(e.spot);
        if (e.id === client.id) notice(spread ? "Eraser: the next tag won't stick" : `Eraser: ${TAG.eraser.minus} s off your time`, 2.5);
    } else if (e.type === "shield") {
        feed(`${nameOf(e.target)}'s eraser blocked ${nameOf(e.id)}`);
    }
}
/** the rubber-stamp moment (GDD §3: the tag's impact) */
function stamp(text, small = false) {
    const el = $("stamp");
    el.textContent = text;
    el.classList.toggle("small", small);
    el.hidden = false;
    el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
    clearTimeout(stamp.t); stamp.t = setTimeout(() => { el.hidden = true; }, 1300);
}
const feedLines = [];
function feed(text) {
    feedLines.push({ text, until: performance.now() + 5000 });
    while (feedLines.length > 4) feedLines.shift();
}
let awaitingFirst = false;

// ------------------------------------------------------------------ the fixed step
game.onUpdate(() => {
    if (!client.joined || !view) return;
    const me = client.me;
    if (awaitingFirst && client.snaps.length) { controls.resetAim(me); awaitingFirst = false; }
    const input = controls.gather(me);
    client.tick(input);
    // my plane's own events this tick (predicted)
    for (const e of me.events) {
        if (e === "crumple") { game.juice.shake(0.3); game.juice.freeze(80); }
        else if (e === "glance") game.juice.shake(0.06);
        else if (e === "flap") game.juice.shake(0.02);
        else if (e === "ring" || e === "done") { game.juice.shake(0.05); view.updateRings(me.run ? me.run.next : 0, me.ringPassed); }
        else if (e === "refold" || e === "restart") { controls.resetAim(me); if (e === "restart") view.updateRings(0); }
    }
    mine.step(me, FOLDS[me.fold]);
    if (room) room.tick();
    view.step(me.clock * DT);
});

// ------------------------------------------------------------------ each frame
const at = { x: 0, y: 0, z: 0 }, sample = {}, labels = new Map();
game.onRender((frameDelta, alpha) => {
    client.frame(frameDelta);
    if (!client.joined || !view) return;
    const me = client.me, f = FOLDS[me.fold];
    client.myPosition(alpha, at);
    // the rings follow the server's word too (a restart, a correction)
    if (me.run && me.run.next !== ringsShown) { ringsShown = me.run.next; view.updateRings(ringsShown); }
    const viewYaw = controls.mode === "mouse" ? controls.aim.yaw : me.yaw;
    const viewPitch = (controls.mode === "mouse" ? controls.aim.pitch : me.pitch) * 0.6;
    chase.lean = settings.lean; chase.fovKick = settings.fovKick && !settings.reducedMotion; chase.horizonLock = settings.horizonLock;
    chase.update(frameDelta, [at.x, at.y, at.z], viewYaw, viewPitch, me.crumpled > 0 ? 0 : me.roll, (me.speed - f.cruise) / (f.max - f.cruise));
    // my plane is drawn where prediction put it, smoothed through corrections
    mine.root.position[0] = at.x; mine.root.position[1] = at.y; mine.root.position[2] = at.z;
    mine.root.teleport();
    mine.setInk(me.it || me.ink);
    mine.frame(frameDelta, settings);
    if (client.room.mode !== "rings") view.setErasers(client.match.erasers, performance.now() / 1000);

    // everyone else, from interpolated snapshots
    for (const [id, info] of client.players) {
        if (id === client.id) continue;
        if (!client.sample(id, sample)) continue;
        let o = others.get(id);
        if (!o) {
            o = { view: new PlaneView(game.scene, { effects: view.effects, remote: true, color: TINTS[id % TINTS.length] }), proxy: remoteProxy(), events: [] };
            others.set(id, o);
        }
        const p = o.proxy;
        p.x = sample.x; p.y = sample.y; p.z = sample.z; p.yaw = sample.yaw; p.pitch = sample.pitch; p.roll = sample.roll;
        p.vx = sample.vx; p.vy = sample.vy; p.vz = sample.vz;
        p.fold = FOLD_IDS[sample.fold] || "glider";
        p.speed = Math.hypot(sample.vx, sample.vy, sample.vz);
        p.crumpled = sample.flags & FLAG.crumpled ? 1 : 0; p.stalled = (sample.flags & FLAG.stalled) !== 0; p.guard = sample.flags & FLAG.guard ? 1 : 0;
        p.events.length = 0;
        for (const e of o.events) { p.events.push(e.type); if (e.x !== undefined) { p.hit.x = e.x; p.hit.y = e.y; p.hit.z = e.z; } }
        o.events.length = 0;
        p.it = (sample.flags & FLAG.it) !== 0; p.shield = sample.flags & FLAG.shield ? 1 : 0;
        o.view.setInk(p.it || (sample.flags & FLAG.ink) !== 0);
        o.view.step(p, FOLDS[p.fold]);
        o.view.frame(frameDelta, settings);
        label(id, (p.it ? "● " : "") + info.name, p);
    }
    for (const [id, el] of labels) if (!others.has(id)) { el.remove(); labels.delete(id); }
    view.frame((me.clock - 1 + alpha) * DT);
    pointer(me);
    drawHud();
});

function remoteProxy() {
    return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, speed: 0, crumpled: 0, stalled: false, guard: 0, inFan: 0, inGust: 0, fold: "glider", events: [], hit: { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1 } };
}

/** a name above another plane */
function label(id, name, p) {
    let el = labels.get(id);
    if (!el) { el = document.createElement("div"); el.className = "label"; $("labels").append(el); labels.set(id, el); }
    const s = camera.project([p.x, p.y, p.z + 0.06], canvas.clientWidth, canvas.clientHeight);
    el.hidden = !s.visible;
    if (s.visible) { el.textContent = name; el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`; }
}

/**
 * The arrow (GDD §9): when you're "it", to the nearest plane you can tag; when you're clean, to the nearest
 * "it". On screen it sits over the plane; off screen it rides the screen's edge, pointing the way.
 */
const ps = {};
function pointer(me) {
    const el = $("arrow");
    if (!client.room || client.room.mode === "rings" || client.match.phase !== "play" || me.crumpled > 0) { el.hidden = true; return; }
    let best = null, bd = Infinity;
    for (const id of client.players.keys()) {
        if (id === client.id || !client.sample(id, ps)) continue;
        const theyIt = (ps.flags & FLAG.it) !== 0;
        if (me.it ? theyIt : !theyIt) continue;
        const d = Math.hypot(ps.x - at.x, ps.y - at.y, ps.z - at.z);
        if (d < bd) { bd = d; best = [ps.x, ps.y, ps.z]; }
    }
    if (!best) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle("hunt", !!me.it);
    const w = canvas.clientWidth, h = canvas.clientHeight, s = camera.project(best, w, h);
    const inside = s.visible && s.x > 40 && s.x < w - 40 && s.y > 40 && s.y < h - 40;
    let x, y, ang;
    if (inside) { x = s.x; y = s.y - 26; ang = Math.PI / 2; }
    else {
        // direction on screen: project onto the camera's right and up, flipped if behind
        const vx = best[0] - camera.eye[0], vy = best[1] - camera.eye[1], vz = best[2] - camera.eye[2];
        const rx = vx * camera.right[0] + vy * camera.right[1] + vz * camera.right[2], uy = vx * camera.up[0] + vy * camera.up[1] + vz * camera.up[2];
        ang = Math.atan2(-uy, rx);
        const cx = w / 2, cy = h / 2, k = Math.min((w / 2 - 34) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - 34) / Math.abs(Math.sin(ang) || 1e-6));
        x = cx + Math.cos(ang) * k; y = cy + Math.sin(ang) * k;
    }
    el.style.transform = `translate(${x}px, ${y}px) rotate(${ang}rad)`;
    el.querySelector("span").textContent = `${bd.toFixed(1)} m`;
    el.querySelector("span").style.transform = `rotate(${-ang}rad)`;
}

const TIPS = { thermal: "Circle in the warm air to climb", fan: "Ride the fan's stream", stall: "Climb to the high ring. Stalled? Dive to pick up speed" };
let hudAt = 0;
function drawHud() {
    const now = performance.now();
    if (now - hudAt < 66) return;
    hudAt = now;
    const me = client.me, f = FOLDS[me.fold], run = me.run;
    $("notice").hidden = now > noticeUntil;
    $("flap").style.setProperty("--charge", String(me.flapWait <= 0 ? 1 : 1 - (me.flapWait * DT) / f.flap));
    $("flap").classList.toggle("ready", me.flapWait <= 0);
    const mode = client.room.mode, mt = client.match;
    const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    if (mode !== "rings") {
        const its = [...client.players.values()].filter((p) => (p.id === client.id ? me.it : (p.flags & FLAG.it) !== 0));
        const who = mode === "spread" ? `${its.length} hunter${its.length === 1 ? "" : "s"}, ${client.players.size - its.length} clean` : its.length ? `● ${its[0].id === client.id ? "You're it" : its[0].name + " is it"}` : "";
        $("ring").textContent = mt.phase === "over" ? "Round over" : client.players.size < 2 ? "Waiting for another plane…" : mt.grace > 0 ? `${MODE_NAME[mode]}: picking ${mode === "spread" ? "the hunter" : "who's it"} in ${Math.ceil(mt.grace / 60)}` : `${MODE_NAME[mode]}  ${clock(mt.clock * DT)}   ${who}`;
    } else $("ring").textContent = !run ? "" : run.done ? `${run.set.name}: done in ${run.seconds.toFixed(2)} s  (${keyHint(settings.bindings, "restart")} to fly it again)` : `${run.set.name}  ring ${run.next + 1} of ${run.set.rings.length}  ${run.next > 0 ? run.seconds.toFixed(1) + " s" : ""}`;
    const aimEl = $("aim");
    aimEl.hidden = controls.mode !== "mouse" || me.crumpled > 0;
    if (!aimEl.hidden) {
        const d = 3, a = controls.aim;
        const s = camera.project([at.x + Math.cos(a.pitch) * Math.cos(a.yaw) * d, at.y + Math.cos(a.pitch) * Math.sin(a.yaw) * d, at.z + Math.sin(a.pitch) * d], canvas.clientWidth, canvas.clientHeight);
        aimEl.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    const tipEl = $("tip"), ring = run && !run.done ? run.ring : null;
    let tip = "", where = null;
    if (me.stalled && me.crumpled === 0) tip = "Stalled! Dive to pick up speed";
    else if (me.crumpled > 0) tip = "Crumpled. Refolding…";
    else if (ring && ring.tip && client.room.set === 0) { tip = TIPS[ring.tip]; where = camera.project(ring.at, canvas.clientWidth, canvas.clientHeight); }
    tipEl.textContent = tip;
    tipEl.hidden = !tip;
    if (where && where.visible) { tipEl.style.left = `${Math.max(120, Math.min(canvas.clientWidth - 120, where.x))}px`; tipEl.style.top = `${Math.max(60, Math.min(canvas.clientHeight - 90, where.y - 50))}px`; }
    else { tipEl.style.left = "50%"; tipEl.style.top = "22%"; }
    const until = view.gustIn((me.clock || 0) * DT);
    $("caption").textContent = until > 0 && until < 1.5 ? "The curtains stir: a gust is coming" : until <= 0 ? "Gust from the window" : "";
    // who is here and how they're doing: rings passed, or time as "it", or tags made
    const score = (p) => (mode === "rings" ? `${p.next}/${run ? run.set.rings.length : 0}${p.best ? ` · ${(p.best * DT).toFixed(1)} s` : ""}`
        : mode === "tag" ? `${(p.ticks * DT).toFixed(0)} s it` : plural(p.tags, "tag"));
    const isIt = (p) => (p.id === client.id ? me.it : (p.flags & FLAG.it) !== 0);
    const rows = [...client.players.values()].map((p) => `<li class="${p.id === client.id ? "me" : ""}${isIt(p) ? " it" : ""}"><span></span> ${score(p)}</li>`);
    const list = $("players");
    if (list.childElementCount !== rows.length || list.dataset.v !== rows.join("")) {
        list.innerHTML = rows.join(""); list.dataset.v = rows.join("");
        [...list.querySelectorAll("li span")].forEach((el, i) => { const p = [...client.players.values()][i]; el.textContent = `${p.name}${p.bot ? " (bot)" : ""} · ${FOLDS[p.fold] ? FOLDS[p.fold].name : ""}`; });
    }
    const fe = $("feed"), live = feedLines.filter((l) => l.until > now);
    if (fe.dataset.n !== String(live.length) + (live[0] ? live[0].until : "")) { fe.replaceChildren(...live.map((l) => { const li = document.createElement("li"); li.textContent = l.text; return li; })); fe.dataset.n = String(live.length) + (live[0] ? live[0].until : ""); }
    if (mt.phase === "over" && mode !== "rings" && !shown) results();
    if (mt.phase === "over") $("results-next").textContent = `Next round in ${Math.ceil(mt.overTicks * DT)} s`;
    if (!$("debug").hidden) {
        const st = client.stats;
        $("debug").textContent =
            `${f.name}  airspeed ${me.speed.toFixed(2)} m/s  height ${me.z.toFixed(2)} m  ${controls.mode}\n` +
            `ping ${client.ping} ms  in ${(st.bytesIn / 1024).toFixed(1)} kB/s  out ${(st.bytesOut / 1024).toFixed(1)} kB/s  snaps ${st.snaps}/s\n` +
            `prediction error ${st.lastError.toFixed(4)} m  corrections ${st.corrections}  replayed ${st.replayed}  ${(game.loop.fps || 0).toFixed(0)} fps`;
    }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** the results card: Classic by least time as "it", Ink Spread by who stayed clean, then tags */
let shown = false;
function results() {
    shown = true;
    const mode = client.room.mode, win = new Set(client.match.winners);
    const list = [...client.players.values()].sort((a, b) => (win.has(b.id) - win.has(a.id)) || (mode === "tag" ? a.ticks - b.ticks : b.tags - a.tags));
    $("results-title").textContent = win.has(client.id) ? (win.size > 1 ? "You share the win" : "You win!") : win.size ? `${[...win].map(nameOf).join(" and ")} ${win.size > 1 ? "win" : "wins"}` : "The hunters win";
    $("results-body").replaceChildren(...list.map((p) => {
        const tr = document.createElement("tr");
        const cells = [p.name + (p.id === client.id ? " (you)" : ""), mode === "tag" ? `${(p.ticks * DT).toFixed(1)} s it` : win.has(p.id) ? "clean" : "inked", plural(p.tags, "tag"), plural(p.erasers, "eraser")];
        for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.append(td); }
        if (win.has(p.id)) tr.className = "win";
        return tr;
    }));
    $("results").hidden = false;
}

window.planes = { game, client, controls, settings, get view() { return view; }, get room() { return room; }, others, startPractice, playOnline, show };
show("title");
game.start();
