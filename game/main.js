import { Game, Camera, PostFX } from "../engine/index.js";
import { TIDE, LOOT, LOOT_KINDS, WATER, TICK_RATE, BTN, MATCH, TEAM_NAMES, teamColor, cssColor } from "./data.js";
import { quantizeYaw, quantizePitch } from "./det.js";
import { reachableLoot } from "./sim.js";
import { tideAt, matchLeft } from "./tide.js";
import { Client, Loopback, SocketTransport, Conditions } from "./net.js";
import { PROTOCOL, NAME_MAX, cleanText } from "./protocol.js";
import { World } from "./world.js";
import { Controls, defaultBindings } from "./controls.js";
import { ThirdPerson } from "./camera.js";
import { Room } from "../server/room.mjs";

/**
 * TIDEFALL: the application. Screens, the camera, and the wiring between the parts. The match lives in
 * sim.js, the room that runs it in server/room.mjs (the same class here for Practice and on the server),
 * the network in net.js, the scene in world.js. Structure follows BREACH's main.js.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ saved between visits
const SAVE_KEY = "tidefall-save-v1";
const save = (() => {
    const base = { name: "", practice: { teams: 2, bots: 4, skill: 2 }, settings: { sensitivity: 1, invertY: false, fov: 70, bindings: defaultBindings() } };
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}"); return { ...base, ...s, practice: { ...base.practice, ...(s.practice || {}) }, settings: { ...base.settings, ...(s.settings || {}) } }; }
    catch { return base; }
})();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage unavailable */ } };
const settings = save.settings;

// ------------------------------------------------------------------ engine
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false, camera: new Camera({ mode: "orbit", fov: settings.fov, near: 0.1, far: 900 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.2, intensity: 0.35 }, vignette: 0.2, grain: 0.01 });

const world = new World(game);
const client = new Client();
const controls = new Controls(input, canvas, settings);
const view = controls.view;
const rig = new ThirdPerson(camera);

// ------------------------------------------------------------------ screens
let screen = "title";
function show(name) {
    screen = name;
    const inMatch = name === "play" || name === "pause";
    $("title").hidden = name !== "title";
    $("pause").hidden = name !== "pause";
    $("hud").hidden = !inMatch;
    controls.active = name === "play";
    controls.showTouch(name === "play");
    if (name !== "play") for (const code of [...input.down]) input.release(code);
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
    const p = save.practice;
    room = new Room({ code: "PRACTICE", teams: p.teams, bots: p.bots + 1, skill: p.skill, seed: (Date.now() & 0xffffff) + 1 });
    const link = new Conditions(new Loopback(room), conditions);
    link.settings = conditions;
    client.attach(link);
    link.connect(playerName());
    resume();
}

// ------------------------------------------------------------------ online (as BREACH)
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
        if (info.game !== "tidefall") throw new Error("not a TIDEFALL server");
    } catch { info = null; }
    online.up = !!info;
    for (const b of buttons) b.disabled = !online.up;
    if (!info) status.textContent = "No server reachable. Practice works without one.";
    else if (info.protocol !== PROTOCOL) { status.textContent = "The server is a different version from this page. Reload."; for (const b of buttons) b.disabled = true; }
    else status.textContent = `Server is up: ${info.players} playing in ${info.rooms} ${info.rooms === 1 ? "room" : "rooms"}.`;
}

function playOnline(hello) {
    leave();
    online.last = hello;
    const link = new Conditions(new SocketTransport(online.url), conditions);
    link.settings = conditions;
    client.attach(link);
    link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name: playerName(), ...hello });
    link.connect();
    resume();
    notice("Connecting…", 20);
}

function leave() { client.detach(); room = null; if (document.pointerLockElement) input.unlockPointer(); }
function toTitle() { leave(); history.replaceState(null, "", location.pathname + location.search); show("title"); }
function playerName() { return cleanText($("name").value, NAME_MAX) || "Player"; }

{
    const bots = $("p-bots");
    bots.replaceChildren(...Array.from({ length: MATCH.maxPlayers }, (_, i) => new Option(i ? `${i + 1} (you + ${i} bots)` : "Just you", String(i + 1))));
    $("p-teams").value = String(save.practice.teams); bots.value = String(save.practice.bots + 1); $("p-skill").value = String(save.practice.skill);
    $("name").value = save.name;
    const read = () => { save.practice = { teams: +$("p-teams").value, bots: +bots.value - 1, skill: +$("p-skill").value }; save.name = playerName(); persist(); };
    for (const id of ["p-teams", "p-bots", "p-skill", "name"]) $(id).addEventListener("change", read);
    $("practice").addEventListener("click", () => { read(); startPractice(); });
    $("quick").addEventListener("click", () => { read(); playOnline({}); });
    $("create").addEventListener("click", () => { read(); const p = save.practice; playOnline({ create: { teams: p.teams, bots: p.bots + 1, skill: p.skill, open: true } }); });
    const code = $("code");
    code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ""); });
    $("join-form").addEventListener("submit", (e) => { e.preventDefault(); read(); if (code.value.length === 4 && online.up) playOnline({ room: code.value }); else code.focus(); });
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
canvas.addEventListener("click", () => { if (screen === "play" && !input.pointer.locked) lockMouse(); });
let lockLost = 0;
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && screen === "play") { lockLost = performance.now(); show("pause"); } });
addEventListener("keydown", (e) => {
    if (e.code === "F3") { e.preventDefault(); $("debug").hidden = !$("debug").hidden; }
    else if (e.code === "Escape" && performance.now() - lockLost > 400) {
        if (screen === "play" && !document.pointerLockElement) show("pause");
        else if (screen === "pause") resume();
    }
});

// ------------------------------------------------------------------ what the match tells us
let noticeText = "", noticeLeft = 0;
function notice(text, seconds = 3) { noticeText = text; noticeLeft = seconds; }

client.on("welcome", () => {
    world.loadIsland(client.island);
    const practice = client.room.code === "PRACTICE";
    if (!practice) { history.replaceState(null, "", location.pathname + location.search + "#" + client.room.code); $("code").value = client.room.code; }
    notice(practice ? "Practice" : `Room ${client.room.code}`, 3);
    $("room-line").hidden = practice;
    $("room-code").textContent = client.room.code;
    $("invite").textContent = "Copy invite link";
    const camp = client.island.camps[client.me.team] || client.island.camps[0];
    view.yaw = camp.angle; view.pitch = -0.2;
});
client.on("start", () => { world.loadIsland(client.island); notice("A new island", 3); });
client.on("close", (reason) => {
    const was = client.room && client.room.code !== "PRACTICE" ? client.room.code : online.last && online.last.room;
    toTitle();
    if (was) $("code").value = was;
    probe().then(() => { $("server-status").textContent = (reason || "Disconnected.") + (was && online.up ? ` Press Join to go back to room ${was}.` : ""); });
});
client.on("event", onEvent);
client.on("predicted", () => { /* sounds for my own jump and grapple, at once (stage 8) */ });

function onEvent(e) {
    const me = client.me;
    if (e.type === "over") notice(e.winner < 0 ? "A draw" : `${TEAM_NAMES[e.winner]} wins`, 8);
    else if (e.type === "phase") { if (e.phase === 2) notice("The flood is coming", 3); else if (e.phase === 0) notice(`Tide ${e.tide + 1}: the sea goes out`, 3); }
    else if (e.type === "pick" && e.id === me.id) world.glint(me.x, me.y, me.z + 1, [1, 0.85, 0.4]);
    else if (e.type === "bank") { const c = client.island.camps[e.team]; world.glint(c.x, c.y, c.z + 1, [1, 0.9, 0.5], 60); if (e.id === me.id) { game.juice.shake(0.12); notice(`Banked ${e.value}`, 2); } }
    else if (e.type === "drop" && e.why === "gasp" && e.id === me.id) { game.juice.shake(0.25); notice("Out of breath: you let go of the heavy loot", 3); }
    else if (e.type === "drown" && e.id === me.id) notice("Drowned", 3);
}

// ------------------------------------------------------------------ the fixed step
let lastButtons = 0;
game.onUpdate(() => {
    if (input.wasPressed("pause")) { if (screen === "play") show("pause"); else if (screen === "pause") resume(); }
    if (screen === "title" || !client.transport) return;
    const c = controls.gather();
    let yaw = view.yaw, pitch = view.pitch;
    const pressed = c.buttons & ~lastButtons;
    lastButtons = c.buttons;
    // on the tick a tool is used, aim from the head at what the crosshair is on (camera.js aimAt)
    if ((pressed & (BTN.grapple | BTN.flare)) && client.island) { const t = rig.aimAt(client.island, client.me); yaw = t.yaw; pitch = t.pitch; }
    client.tick({ mx: c.mx, my: c.my, buttons: c.buttons, yaw: quantizeYaw(yaw), pitch: quantizePitch(pitch) });
    if (room) room.tick();
});

// ------------------------------------------------------------------ drawing
const at = { x: 0, y: 0, z: 0, vx: 0, vy: 0 }, tide = {}, fx = { fov: 0, wasWater: 0 };
let since = 1;

game.onRender((dt, alpha) => {
    if (noticeLeft > 0) noticeLeft -= dt;
    $("notice").textContent = noticeLeft > 0 ? noticeText : "";
    // first, so held messages (the welcome among them) are let through even before there is an island
    if (client.transport) client.frame(dt);
    if (!client.transport || !client.island) {
        // behind the menu: a slow turn high over the sea
        camera.mode = "orbit"; camera.target.set([0, 0, 0]); camera.distance = 150; camera.pitch = 0.45; camera.yaw += dt * 0.03;
        world.update(dt);
        return;
    }
    const me = client.me, island = client.island;
    controls.look(dt);
    tideAt(island.seed, Math.max(0, client.clock), tide);
    world.setWater(tide.level);
    client.myPosition(alpha, at);
    at.vx = me.vx; at.vy = me.vy;
    fx.fov += ((me.hook ? 9 : 0) - fx.fov) * (1 - Math.exp(-dt * 6));
    rig.update(dt, at, view, island, tide.level, { fov: settings.fov + fx.fov });

    // splashes for my own player
    const wet = me.water >= 2 ? 1 : 0;
    if (wet !== fx.wasWater && me.alive) world.splash(me.x, me.y, tide.level, wet ? Math.min(1.5, 0.4 + Math.abs(me.vz) / 6) : 0.4);
    fx.wasWater = wet;

    world.drawPlayers(client, at);
    world.rope(!!me.hook && me.alive, at.x, at.y, at.z + 1.3, me.hx, me.hy, me.hz);
    world.drawLoot(client, at);
    world.update(dt);

    const s = game.scene, u = rig.under;
    s.fogColor.set([0.6 + (0.05 - 0.6) * u, 0.74 + (0.25 - 0.74) * u, 0.86 + (0.32 - 0.86) * u]);
    s.fogDensity = 0.004 + 0.085 * u;
    if (me.alive) { const t = rig.aimAt(island, me); $("crosshair").classList.toggle("reach", t.reach && me.hookCool === 0); }

    // HUD (plain text until stage 8)
    const phase = TIDE.phases[tide.phase];
    $("tide-clock").textContent = client.match.phase === "over" ? "Match over" : `Tide ${tide.tide + 1} of ${TIDE.tides} · ${phase.name} ${Math.ceil(tide.phaseLeft / TICK_RATE)} s`;
    const items = me.carry.map((id) => { const l = client.loot.get(id); return l ? LOOT[LOOT_KINDS[l.kind]].name : "?"; });
    $("carry").textContent = `Carrying ${me.weight} kg${items.length ? ": " + items.join(", ") : ""}`;
    $("bank").textContent = Array.from({ length: island.teams }, (_, t) => `${TEAM_NAMES[t]} ${client.match.bank[t]}${t === me.team ? "  ◀" : ""}`).join("\n");
    $("bank").style.color = cssColor(teamColor(me.team));
    $("breath").style.opacity = me.breath < WATER.breath * TICK_RATE ? 1 : 0;
    $("breath").firstElementChild.style.width = (100 * me.breath) / (WATER.breath * TICK_RATE) + "%";
    const near = nearestLoot(me);
    $("prompt").textContent = !me.alive ? `Drowned. Back at camp in ${Math.ceil(me.respawn / TICK_RATE)} s` : near ? `E: pick up ${LOOT[LOOT_KINDS[near.kind]].name} (${LOOT[LOOT_KINDS[near.kind]].weight} kg)` : "";
    if (!$("debug").hidden && (since += dt) > 0.1) {
        since = 0;
        const st = renderer.stats, n = client.stats;
        $("debug").textContent = `pos ${me.x.toFixed(1)} ${me.y.toFixed(1)} ${me.z.toFixed(2)}  speed ${Math.hypot(me.vx, me.vy).toFixed(1)}  ${["dry", "wading", "swimming", "sunk"][me.water]}`
            + `\n${Math.round(game.loop.fps)} fps  ${game.loop.frameMs.toFixed(1)} ms  ${st.drawCalls} draws  ${(st.triangles / 1000).toFixed(0)}k tris`
            + `\nping ${client.ping} ms  in ${(n.bytesIn / 1000).toFixed(1)} kB/s  out ${(n.bytesOut / 1000).toFixed(1)} kB/s  ${n.snaps} snaps/s`
            + `\nreplayed ${n.replayed}  corrections ${n.corrections}  last error ${n.lastError.toFixed(3)} m   match left ${Math.ceil(matchLeft(client.clock))} s`;
    }
});

/** The item the server would let me pick up, as far as this client knows. */
const lootView = { loot: [] };
function nearestLoot(me) {
    lootView.loot.length = 0;
    for (const l of client.loot.values()) lootView.loot.push(l);
    return reachableLoot(lootView, me);
}

show("title");
game.start();

/** console hook, for poking at the game and for the tools */
window.tidefall = { game, world, client, controls, view, rig, input, save, settings, conditions, startPractice, playOnline, online, show, resume,
    get room() { return room; }, get screen() { return screen; }, debug() { startPractice(); return "ok"; } };
