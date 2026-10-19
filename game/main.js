import { Game, Camera, PostFX } from "../engine/index.js";
import { ROLE, ROUND, TICK_RATE, PING, TEAM_SCHEMES, TEAM_NAMES, teamColors, colorOf } from "./data.js";
import { PROP_LIST, PROP_SHAPE } from "./props.js";
import { eyeHeight, quantizeYaw, quantizePitch, rayMap, rayProps, rayHit, canDisguise } from "./sim.js";
import { Client, Loopback, SocketTransport, Conditions } from "./net.js";
import { getMap, PLAY_MAPS, MAP_LIST } from "./maps/index.js";
import { World } from "./world.js";
import { Hud } from "./hud.js";
import { Sound, TAUNT_SOUNDS } from "./sound.js";
import { Controls, ACTIONS, defaultBindings, describe, keyName } from "./controls.js";
import { cleanText, NAME_MAX, PROTOCOL } from "./protocol.js";
import { Room } from "../server/room.mjs";

/**
 * DECOY: the application. Screens, settings, cameras, and the wiring between the parts. The match lives
 * in sim.js, the room that runs it in server/room.mjs, the network in net.js, the scene in world.js.
 * Taken from BREACH's main.js and changed for three ways of seeing: a seeker's eyes, a hider's camera
 * behind its prop, and a ghost's free flight.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ saved between visits
const SAVE_KEY = "decoy-save-v1";
/** outline colours: what a ping shows, and the prop a hider is about to become */
const OUTLINES = {
    gold: { name: "Gold and green", reveal: [1.0, 0.82, 0.15], aim: [0.35, 1.0, 0.55] },
    blue: { name: "Blue and orange (colour-blind safe)", reveal: [0.2, 0.62, 1.0], aim: [1.0, 0.55, 0.1] },
    white: { name: "White and magenta (colour-blind safe)", reveal: [1, 1, 1], aim: [0.95, 0.25, 0.85] },
};
const DEFAULTS = { sensitivity: 1, invertY: false, fov: 76, quality: "high", bloom: true, shadows: true, volume: 0.8, music: 0.5, reducedMotion: null, scheme: "orange-blue", outline: "gold", bindings: defaultBindings() };
const save = (() => {
    const base = { name: "", practice: { map: PLAY_MAPS[0] || MAP_LIST[0], bots: 8, skill: 2 }, settings: { ...DEFAULTS } };
    try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}"), st = s.settings || {};
        return { ...base, ...s, practice: { ...base.practice, ...(s.practice || {}) }, settings: { ...DEFAULTS, ...st, bindings: { ...DEFAULTS.bindings, ...(st.bindings || {}) } } };
    } catch { return base; }
})();
if (!MAP_LIST.includes(save.practice.map)) save.practice.map = PLAY_MAPS[0] || MAP_LIST[0];
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage unavailable */ } };
const settings = save.settings;
const systemReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reducedMotion = () => settings.reducedMotion ?? systemReducedMotion;

// ------------------------------------------------------------------ engine
const canvas = $("view");
const game = new Game({ canvas, quality: settings.quality, antialias: false, camera: new Camera({ mode: "orbit", fov: settings.fov, near: 0.05, far: 400 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.1, intensity: 0.5 }, vignette: 0.24, grain: 0.012 });

const world = new World(game);
const client = new Client();
const hud = new Hud(client);
const sound = new Sound({ volume: settings.volume, music: settings.music });
const controls = new Controls(input, canvas, settings);
const view = controls.view;
const narrow = matchMedia("(max-width: 700px)");
const compact = () => document.body.classList.toggle("compact", controls.coarse || narrow.matches);
narrow.addEventListener("change", compact);
compact();
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => sound.start(), { once: true });
world.onStep = (x, y, z, seeker) => sound.at(seeker ? "step" : "scuff", x, y, z, 0.9);

function applySettings() {
    renderer.setQuality(settings.quality);
    renderer.postfx.settings.bloom.enabled = settings.bloom;
    world.shadowsWanted = settings.shadows;
    sound.setVolume(settings.volume);
    sound.setMusic(settings.music);
    game.juice.reducedMotion = reducedMotion();
    world.reducedMotion = reducedMotion();
    teamColors.scheme = settings.scheme;
    const o = OUTLINES[settings.outline] || OUTLINES.gold;
    world.setOutlineColors(o.reveal, o.aim);
    controls.apply();
    persist();
}

// ------------------------------------------------------------------ screens
let screen = "title", settingsFrom = "title";
const el = { title: $("title"), pause: $("pause"), settings: $("settings"), hud: $("hud"), menu: $("menu-button") };
function show(name) {
    if (name === "settings") settingsFrom = screen === "settings" ? settingsFrom : screen;
    screen = name;
    const inMatch = name === "play" || name === "pause" || (name === "settings" && settingsFrom !== "title");
    el.title.hidden = name !== "title";
    el.pause.hidden = name !== "pause";
    el.settings.hidden = name !== "settings";
    el.hud.hidden = !inMatch;
    el.menu.hidden = name !== "play" || !controls.coarse;
    camera.mode = inMatch ? "firstPerson" : "orbit";
    controls.active = name === "play";
    if (name !== "play") for (const code of [...input.down]) input.release(code);
    if (name === "title") { camera.fov = 55; $("practice").focus(); }
    else if (name === "pause") { refreshHost(); pauseKeys(); $("resume").focus(); }
    else if (name === "settings") $("settings-back").focus();
}

function lockMouse() {
    if (controls.coarse) return;
    try { const asked = canvas.requestPointerLock(); if (asked && asked.catch) asked.catch(() => {}); } catch { /* not available */ }
}
function resume() { show("play"); lockMouse(); canvas.focus(); }

const conditions = { latency: 0, jitter: 0, loss: 0 };
/** @type {Room | null} the room this page runs itself (Practice) */
let room = null;

function startPractice() {
    leave();
    const p = save.practice;
    room = new Room({ code: "PRACTICE", map: p.map, bots: p.bots, skill: p.skill, seed: (Date.now() & 0xffff) + 1 });
    const link = new Conditions(new Loopback(room), conditions);
    link.settings = conditions;
    client.attach(link);
    link.connect(playerName());
    resume();
}

// ------------------------------------------------------------------ online
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
        if (info.game !== "decoy") throw new Error("not a DECOY server");
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
    hud.notice("Connecting…", 20);
}

function leave() {
    sound.quiet();
    client.detach();
    room = null;
    if (document.pointerLockElement) input.unlockPointer();
}

function toTitle() {
    leave();
    history.replaceState(null, "", location.pathname + location.search);
    world.loadMap(getMap(save.practice.map));
    show("title");
}

function playerName() { return cleanText($("name").value, NAME_MAX) || "Player"; }
const fill = (select, options, value) => { select.replaceChildren(...options.map(([v, text]) => new Option(text, v))); select.value = String(value); };
const MAP_OPTIONS = PLAY_MAPS.concat(MAP_LIST.filter((id) => !PLAY_MAPS.includes(id))).map((id) => [id, getMap(id).name]);

// ------------------------------------------------------------------ the title form
{
    fill($("p-map"), MAP_OPTIONS, save.practice.map);
    fill($("p-bots"), Array.from({ length: ROUND.maxPlayers - 1 }, (_, i) => [i + 2, `${i + 2} in all`]), save.practice.bots);
    $("p-skill").value = String(save.practice.skill);
    $("name").value = save.name;
    const read = () => {
        save.practice = { map: $("p-map").value, bots: +$("p-bots").value, skill: +$("p-skill").value };
        save.name = playerName();
        persist();
    };
    for (const id of ["p-map", "p-bots", "p-skill", "name"]) $(id).addEventListener("change", read);
    $("p-map").addEventListener("change", () => world.loadMap(getMap($("p-map").value)));
    $("practice").addEventListener("click", () => { read(); startPractice(); });
    $("quick").addEventListener("click", () => { read(); playOnline({}); });
    $("create").addEventListener("click", () => { read(); const p = save.practice; playOnline({ create: { map: p.map, bots: p.bots, skill: p.skill, open: true } }); });
    const code = $("code");
    code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ""); });
    $("join-form").addEventListener("submit", (e) => { e.preventDefault(); read(); if (code.value.length === 4 && online.up) playOnline({ room: code.value }); else code.focus(); });
    const invited = location.hash.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
    if (invited.length === 4) code.value = invited;
    probe();
}

// ------------------------------------------------------------------ the pause menu
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
fill($("h-map"), MAP_OPTIONS, MAP_LIST[0]);
fill($("h-bots"), Array.from({ length: ROUND.maxPlayers + 1 }, (_, i) => [i, i ? String(i) : "None"]), 0);
function refreshHost() {
    const mine = client.joined && client.hostId === client.id && client.room;
    $("host").hidden = !mine;
    if (!mine) return;
    $("h-map").value = client.room.map; $("h-bots").value = String(client.room.bots); $("h-skill").value = String(client.room.skill || 2);
}
/** The keys that matter right now, as the bindings say. */
function pauseKeys() {
    const k = (a) => keyName(settings, a), list = $("pause-keys"), rows = [];
    const seeker = client.me.role === ROLE.seeker;
    const pairs = seeker
        ? [[k("fire"), "scan (a real prop scanned costs you health)"], [k("ability"), "ping grenade"], [k("crouch"), "crouch"]]
        : [[k("disguise"), "become the prop you look at"], [k("lock"), "lock rotation"], [k("taunt"), "taunt (scores)"], [k("ability"), "drop a decoy"]];
    for (const [key, what] of [...pairs, [k("scores"), "scores"], ["F3", "numbers"], ["Esc", "this menu"]]) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = key; dd.textContent = what; rows.push(dt, dd);
    }
    list.replaceChildren(...rows);
}
$("host-apply").addEventListener("click", () => {
    client.send({ t: "setup", map: $("h-map").value, bots: +$("h-bots").value, skill: +$("h-skill").value });
    resume();
});
el.menu.addEventListener("click", () => show("pause"));
canvas.addEventListener("click", () => { if (screen === "play" && !input.pointer.locked) lockMouse(); });
let lockLost = 0;
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && screen === "play") { lockLost = performance.now(); show("pause"); } });
addEventListener("keydown", (e) => {
    if (e.code === "F3") { e.preventDefault(); $("debug").hidden = !$("debug").hidden; }
    else if (e.code === "Escape" && performance.now() - lockLost > 400) {
        if (screen === "play" && !document.pointerLockElement && chatForm.hidden) show("pause");
        else if (screen === "pause") resume();
        else if (screen === "settings" && !capturing) show(settingsFrom);
    }
});

// ------------------------------------------------------------------ the settings screen
let capturing = false;
{
    const bind = (id, key, read, write, event = "input") => {
        const node = $(id);
        write(node, settings[key]);
        node.addEventListener(event, () => { settings[key] = read(node); applySettings(); labels(); });
    };
    const number = (n) => +n.value, checked = (n) => n.checked, value = (n) => n.value;
    const setValue = (n, v) => { n.value = String(v); }, setChecked = (n, v) => { n.checked = !!v; };
    const labels = () => {
        $("s-sensitivity-out").textContent = settings.sensitivity.toFixed(2);
        $("s-fov-out").textContent = settings.fov + "°";
        $("s-volume-out").textContent = Math.round(settings.volume * 100) + "%";
        $("s-music-out").textContent = Math.round(settings.music * 100) + "%";
    };
    bind("s-sensitivity", "sensitivity", number, setValue);
    bind("s-invert", "invertY", checked, setChecked, "change");
    bind("s-fov", "fov", number, setValue);
    bind("s-quality", "quality", value, setValue, "change");
    bind("s-bloom", "bloom", checked, setChecked, "change");
    bind("s-shadows", "shadows", checked, setChecked, "change");
    bind("s-volume", "volume", number, setValue);
    bind("s-music", "music", number, setValue);
    fill($("s-scheme"), Object.entries(TEAM_SCHEMES).map(([id, s]) => [id, s.name]), settings.scheme);
    bind("s-scheme", "scheme", value, setValue, "change");
    fill($("s-outline"), Object.entries(OUTLINES).map(([id, s]) => [id, s.name]), settings.outline);
    bind("s-outline", "outline", value, setValue, "change");
    $("s-motion").value = settings.reducedMotion === null ? "system" : settings.reducedMotion ? "on" : "off";
    $("s-motion").addEventListener("change", () => { const v = $("s-motion").value; settings.reducedMotion = v === "system" ? null : v === "on"; applySettings(); });
    labels();

    const list = $("bindings");
    const rows = () => {
        list.replaceChildren(...ACTIONS.map((a) => {
            const row = document.createElement("div"), label = document.createElement("span"), button = document.createElement("button"), pad = document.createElement("span");
            const d = describe(settings.bindings[a.id] || []);
            row.className = "binding"; label.textContent = a.label; button.textContent = d.keys; pad.className = "pad"; pad.textContent = d.pad === "none" ? "" : d.pad;
            button.setAttribute("aria-label", `${a.label}: ${d.keys}. Press to change.`);
            button.addEventListener("click", async () => {
                if (capturing) return;
                capturing = true;
                button.textContent = "Press a key…"; button.classList.add("listening");
                await controls.capture(a.id);
                capturing = false;
                persist(); rows();
                [...list.querySelectorAll("button")][ACTIONS.indexOf(a)].focus();
            });
            row.append(label, button, pad);
            return row;
        }));
    };
    rows();
    $("bindings-reset").addEventListener("click", () => { settings.bindings = defaultBindings(); controls.settings = settings; applySettings(); rows(); });
    $("settings-back").addEventListener("click", () => show(settingsFrom));
    for (const id of ["open-settings", "open-settings-2"]) $(id).addEventListener("click", () => show("settings"));
}

// ------------------------------------------------------------------ what the match tells us
client.on("welcome", () => {
    world.loadMap(client.map);
    sound.ambience(client.map.env.indoor);
    const practice = client.room.code === "PRACTICE";
    if (!practice) { history.replaceState(null, "", location.pathname + location.search + "#" + client.room.code); $("code").value = client.room.code; }
    hud.notice(practice ? "Practice" : `Room ${client.room.code}`, 3);
    $("room-line").hidden = practice;
    $("room-code").textContent = client.room.code;
    $("invite").textContent = "Copy invite link";
});
client.on("start", () => { world.loadMap(client.map); sound.ambience(client.map.env.indoor); hud.notice(`${client.map.name} · a new match`); });
client.on("roster", () => { if (screen === "pause") refreshHost(); });
client.on("chat", (m) => { hud.chat(m); sound.play("chat", 0.6); });
client.on("close", (reason) => {
    const was = client.room && client.room.code !== "PRACTICE" ? client.room.code : online.last && online.last.room;
    toTitle();
    if (was) $("code").value = was;
    probe().then(() => { $("server-status").textContent = (reason || "Disconnected.") + (was && online.up ? ` Press Join to go back to room ${was}.` : ""); if (was && online.up) $("join").focus(); });
});

const chatForm = $("chat-form"), chatInput = $("chat-input");
function openChat() {
    if (screen !== "play" || !client.joined) return;
    for (const code of [...input.down]) input.release(code);
    chatForm.hidden = false;
    chatInput.value = "";
    chatInput.focus();
}
function closeChat() { chatForm.hidden = true; chatInput.blur(); canvas.focus(); }
chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = cleanText(chatInput.value, 120);
    if (text) client.send({ t: "chat", text });
    closeChat();
});
chatInput.addEventListener("keydown", (e) => { if (e.code === "Escape") closeChat(); e.stopPropagation(); });
chatInput.addEventListener("blur", () => { chatForm.hidden = true; });
addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName);
    if (screen === "play" && chatForm.hidden && !typing && (settings.bindings.chat || []).includes(e.code)) { e.preventDefault(); openChat(); }
});

/** my own scans this match: fired, hiders hit, props hit */
const tally = { shots: 0, hits: 0, misses: 0 };
client.on("shot", () => {
    world.fireView();
    sound.play("scan", 0.6, 0.97 + Math.random() * 0.06);
    tally.shots++;
});
client.on("disguised", (me) => { world.poof(me.x, me.y, me.z, Math.max(0.4, me.h)); sound.play("poof", 0.8); });

const spot = [0, 0, 0];
/** Where a player is right now, as far as this client knows. */
function whereIs(id, out) {
    if (id === client.id) { out[0] = client.me.x; out[1] = client.me.y; out[2] = client.me.z; return true; }
    const snap = client.snaps[client.snaps.length - 1], row = snap && snap.players.get(id);
    if (!row) return false;
    out[0] = row[1]; out[1] = row[2]; out[2] = row[3];
    return true;
}
const teamName = (t) => TEAM_NAMES[t] || "";
client.on("event", (e) => {
    const me = client.id;
    if (e.type === "shot") {
        world.beam(e.id === me ? world.muzzle : [e.o[0], e.o[1], e.o[2] - 0.2], e.end, e.what);
        if (e.id !== me) sound.at("scan", e.o[0], e.o[1], e.o[2], 0.8);
    } else if (e.type === "hurt") {
        if (e.self) {
            if (e.id === me) { tally.misses++; hud.hitMarker("miss", e.amount); hud.hurtFlash(e.amount); sound.play("miss", 0.9); if (!reducedMotion()) game.juice.shake(0.25); }
        } else {
            if (e.by === me) { tally.hits++; hud.hitMarker("hit", e.amount); sound.play("hit", 0.9); }
            if (e.id === me) { hud.hurtFlash(e.amount); sound.play("hurt", 0.9); if (!reducedMotion()) game.juice.shake(Math.min(0.5, e.amount / 80)); }
        }
    } else if (e.type === "kill") {
        hud.kill(e);
        if (e.by === me) { hud.hitMarker("kill"); sound.play("found"); }
        if (e.id === me) { sound.play("death"); startGhost(); }
        else if (whereIs(e.id, spot)) { sound.at("death", spot[0], spot[1], spot[2] + 0.5); world.poof(spot[0], spot[1], spot[2], 0.8); }
    } else if (e.type === "spawn") {
        if (e.id === me) { view.yaw = (e.yaw * Math.PI * 2) / 65536; view.pitch = e.role === ROLE.hider ? -0.25 : 0; ghost.on = false; }
    } else if (e.type === "disguise") {
        if (e.id !== me && whereIs(e.id, spot)) { world.poof(spot[0], spot[1], spot[2], PROP_SHAPE[e.prop][2]); sound.at("poof", spot[0], spot[1], spot[2] + 0.3); }
    } else if (e.type === "throw") { if (e.id !== me && whereIs(e.id, spot)) sound.at("throw", spot[0], spot[1], spot[2] + 1.5); else if (e.id === me) sound.play("throw"); }
    else if (e.type === "land") sound.at("land_ping", e.x, e.y, e.z);
    else if (e.type === "burst") { world.burst(e.x, e.y, e.z, PING.radius); sound.at("burst", e.x, e.y, e.z); }
    else if (e.type === "ping") {
        // what my grenade found: outlined for me alone, for a moment
        for (const id of e.ids) world.revealed.set(id, world.time + PING.reveal);
        hud.notice(e.ids.length ? `Ping: ${e.ids.length} ${e.ids.length === 1 ? "prop" : "props"} nearby` : "Ping: nothing", 2);
    } else if (e.type === "squeak") sound.at(TAUNT_SOUNDS[e.id % TAUNT_SOUNDS.length], e.x, e.y, e.z, 0.7, 1.3);
    else if (e.type === "decoy") { if (whereIs(e.id, spot)) sound.at("decoy", spot[0], spot[1], spot[2] + 0.3); }
    else if (e.type === "pop") { world.poof(e.x, e.y, e.z, 0.6); sound.at("pop", e.x, e.y, e.z); }
    else if (e.type === "taunt") {
        sound.at(TAUNT_SOUNDS[e.kind], e.x, e.y, e.z, 1);
        world.taunt(e.x, e.y, e.z, colorOf(client.players.get(e.id) || { team: 0 }));
        if (e.id === me) hud.notice(e.forced ? "You had to taunt!" : e.points ? `Taunt +${e.points}` : "Taunt", 1.5);
    } else if (e.type === "phase") phaseChanged(e);
    else if (e.type === "late") { hud.banner("Last minute", "Taunts every 20 seconds. Moving props flicker.", 3); sound.play("go", 0.8, 0.8); }
});

function phaseChanged(e) {
    const mine = client.players.get(client.id), team = mine ? mine.team : 0, seeking = team === client.match.seekTeam;
    if (e.phase === "hide") {
        if (seeking) hud.banner(`Round ${e.round}: you seek`, "Blindfolded for 30 seconds. Listen to them hide.", 3.5);
        else hud.banner(`Round ${e.round}: hide!`, `Look at a prop and press ${keyName(settings, "disguise")} to become it.`, 4);
        sound.play("go", 0.7);
    } else if (e.phase === "seek") {
        hud.banner(seeking ? "Seek!" : "Here they come", seeking ? "Scanning a real prop costs you health." : "Keep still. You must taunt now and then.", 3);
        sound.play("go", 0.9, 1.2);
    } else if (e.phase === "end") {
        hud.banner(`${teamName(e.winner)} win the round`, e.winner === client.match.seekTeam ? "Every prop was found." : "The props survived.", 5);
        sound.play(e.winner === team ? "win" : "lose");
    } else if (e.phase === "over") {
        hud.banner(e.winner ? `${teamName(e.winner)} win the match` : "A draw", "", 6);
        sound.play(e.winner === team ? "win" : "lose");
    }
}

// ------------------------------------------------------------------ ghosts
/** A dead player watches as a ghost: free flight, through walls, seeing every hider outlined. */
const ghost = { on: false, x: 0, y: 0, z: 0 };
function startGhost() {
    ghost.on = true;
    ghost.x = client.me.x; ghost.y = client.me.y; ghost.z = client.me.z + 2.2;
}
function flyGhost(c, dt) {
    const s = c.buttons & 4 ? 13 : 7, yaw = view.yaw, cp = Math.cos(view.pitch);
    const fx = Math.cos(yaw) * cp, fy = Math.sin(yaw) * cp, fz = Math.sin(view.pitch), mx = c.mx / 127, my = c.my / 127;
    ghost.x += (fx * my + Math.sin(yaw) * mx) * s * dt;
    ghost.y += (fy * my - Math.cos(yaw) * mx) * s * dt;
    ghost.z += (fz * my + c.up) * s * dt;
    const b = client.map.bounds;
    ghost.x = clamp(ghost.x, b.min[0] - 5, b.max[0] + 5); ghost.y = clamp(ghost.y, b.min[1] - 5, b.max[1] + 5); ghost.z = clamp(ghost.z, b.min[2] + 0.5, b.max[2] + 12);
}

// ------------------------------------------------------------------ what a hider is looking at
/** the map prop under the crosshair, and whether the rules would let me become it */
const aimed = { index: -1, ok: false, distance: 0 };
function lookForProp() {
    aimed.index = -1; aimed.ok = false;
    const me = client.me;
    if (!client.joined || !me.alive || me.role !== ROLE.hider || client.match.phase === "over") return;
    const e = camera.eye, f = camera.forward;
    const wall = rayMap(client.map, e[0], e[1], e[2], f[0], f[1], f[2], 30);
    const t = rayProps(client.map, e[0], e[1], e[2], f[0], f[1], f[2], wall);
    if (rayHit.index < 0) return;
    aimed.index = rayHit.index; aimed.distance = t;
    aimed.ok = canDisguise(client.map, me, rayHit.index);
}

// ------------------------------------------------------------------ loop
let wantProp = 0;
game.onUpdate(() => {
    if (input.wasPressed("pause")) { if (screen === "play") show("pause"); else if (screen === "pause") resume(); }
    if (screen === "title" || !client.transport) return;
    const me = client.me, hider = me.role === ROLE.hider;
    const c = controls.gather(hider);
    if (ghost.on && !me.alive) { flyGhost(c, 1 / TICK_RATE); c.mx = c.my = 0; c.buttons = 0; }
    if (c.disguise && aimed.index >= 0) wantProp = aimed.ok ? aimed.index + 1 : 0;
    client.tick({ mx: c.mx, my: c.my, buttons: c.buttons, prop: wantProp, yaw: quantizeYaw(view.yaw), pitch: quantizePitch(view.pitch) });
    if (wantProp && (me.prop === client.map.props[wantProp - 1].type || me.disguiseCool > 0)) wantProp = 0;
    if (c.disguise && aimed.index >= 0 && !aimed.ok) sound.play("ui", 0.4, 0.6);
    if (room) room.tick();
});

/** the sounds of my own movement */
const mine = { ground: true, stride: 0, vz: 0, locked: false };
function feet(me, dt) {
    if (!client.joined || !me.alive) { mine.ground = true; mine.stride = 0; return; }
    if (me.ground && !mine.ground) sound.play("land", Math.min(1, 0.35 + Math.abs(mine.vz) / 14));
    else if (!me.ground && mine.ground && me.vz > 2) sound.play("jump", 0.8);
    if (me.ground) { mine.stride += Math.hypot(me.vx, me.vy) * dt; if (mine.stride > (me.role === ROLE.hider ? 1.4 : 2.2)) { mine.stride = 0; sound.play(me.role === ROLE.hider ? "scuff" : "step", me.crouched ? 0.4 : 0.7, 0.9 + Math.random() * 0.2); } }
    if (me.locked !== mine.locked) { mine.locked = me.locked; sound.play(me.locked ? "lock" : "unlock", 0.7); }
    mine.ground = me.ground; mine.vz = me.vz;
}

/** the hider's camera: how far back it sits (eased, so a wall pushing it in doesn't snap it back out) */
const orbit = { distance: 3, eye: [0, 0, 0] };
const eye = { z: 0 }, at = { x: 0, y: 0, z: 0 }, last = { x: 0, y: 0 };
let since = 1;
game.onRender((frameDelta, alpha) => {
    if (!client.transport) {
        const b = world.map ? world.map.bounds : { min: [0, 0, 0], max: [0, 0, 0] };
        camera.target.set([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, 1.5]); camera.distance = Math.max(14, (b.max[0] - b.min[0]) * 0.55); camera.pitch = 0.42;
        if (!reducedMotion()) camera.yaw += frameDelta * 0.05;
        world.update(client, frameDelta);
        return;
    }
    client.frame(frameDelta);
    const me = client.me, m = client.match, hider = me.role === ROLE.hider;
    controls.look(frameDelta);
    client.myPosition(alpha, at);
    const asGhost = ghost.on && !me.alive;
    controls.pitchLimit = hider && !asGhost ? [-1.25, 0.95] : [-1.5, 1.5];
    view.pitch = clamp(view.pitch, controls.pitchLimit[0], controls.pitchLimit[1]);
    camera.yaw = view.yaw; camera.pitch = view.pitch;
    if (asGhost) {
        camera.position[0] = ghost.x; camera.position[1] = ghost.y; camera.position[2] = ghost.z;
    } else if (hider) {
        // third person: the camera sits behind the prop on a line from a point above it, and comes in
        // when a wall or a prop is in the way, so it never looks through one (camera-systems: spring arm)
        const size = Math.max(PROP_SHAPE[Math.max(0, me.prop)][0], PROP_SHAPE[Math.max(0, me.prop)][2] * 0.5);
        const tx = at.x, ty = at.y, tz = at.z + Math.max(0.5, me.h + 0.35);
        const cp = Math.cos(view.pitch), fx = Math.cos(view.yaw) * cp, fy = Math.sin(view.yaw) * cp, fz = Math.sin(view.pitch);
        const want = 2.4 + size * 2.2;
        let reach = rayMap(client.map, tx, ty, tz, -fx, -fy, -fz, want);
        reach = Math.min(reach, rayProps(client.map, tx, ty, tz, -fx, -fy, -fz, reach));
        const d = Math.max(0.3, reach - 0.25);
        orbit.distance = d < orbit.distance ? d : orbit.distance + (d - orbit.distance) * (1 - Math.exp(-frameDelta * 4));
        camera.position[0] = tx - fx * orbit.distance; camera.position[1] = ty - fy * orbit.distance; camera.position[2] = tz - fz * orbit.distance;
    } else {
        const target = at.z + eyeHeight(me);
        eye.z += (target - eye.z) * (1 - Math.exp(-frameDelta * (me.ground ? 20 : 45)));
        if (Math.abs(target - eye.z) > 1) eye.z = target;
        camera.position[0] = at.x; camera.position[1] = at.y; camera.position[2] = eye.z;
    }
    camera.fov += (settings.fov - camera.fov) * (1 - Math.exp(-frameDelta * 18));
    camera.update(0);
    const playing = client.joined && (m.phase === "hide" || m.phase === "seek" || m.phase === "wait" || m.phase === "end");
    world.syncView(camera, me, frameDelta, playing && me.alive && !hider && !me.frozen);
    const moving = Math.hypot(at.x - last.x, at.y - last.y) > 0.001;
    last.x = at.x; last.y = at.y;
    world.flicker = m.late ? 1 : 0;
    world.syncMe(me, at, client.joined && me.alive && hider, m.late, moving);
    sound.listen(camera);
    feet(me, frameDelta);
    lookForProp();
    world.aim(aimed.index >= 0 && aimed.ok ? aimed.index : -1);
    if (aimed.index >= 0) {
        const name = PROP_LIST[client.map.props[aimed.index].type].name;
        if (aimed.ok) hud.prompt(`<kbd>${keyName(settings, "disguise")}</kbd>Become ${name}`, true);
        else hud.prompt(`${name}: ${aimed.distance > 6 ? "too far" : "no room here"}`, false);
    } else hud.prompt(null);

    world.update(client, frameDelta, asGhost);

    let debug;
    if (!$("debug").hidden && (since += frameDelta) > 0.1) {
        since = 0;
        const s = renderer.stats, n = client.stats;
        debug = `pos ${me.x.toFixed(1)} ${me.y.toFixed(1)} ${me.z.toFixed(2)}   speed ${Math.hypot(me.vx, me.vy).toFixed(1)}   ${me.ground ? "ground" : "air"}   ${hider ? "hider " + (PROP_LIST[me.prop]?.id || "") : "seeker"}${me.locked ? " locked" : ""}`
            + `\n${Math.round(game.loop.fps)} fps  ${game.loop.frameMs.toFixed(1)} ms   ${s.drawCalls} draws   ${s.shadowCalls} shadow draws   ${(s.triangles / 1000).toFixed(1)}k tris`
            + `\nping ${client.ping} ms   in ${(n.bytesIn / 1000).toFixed(1)} kB/s   out ${(n.bytesOut / 1000).toFixed(1)} kB/s   ${n.snaps} snaps/s`
            + `\nreplayed ${n.replayed}   corrections ${n.corrections}   last error ${n.lastError.toFixed(3)} m`
            + `\nscans ${tally.shots}   on hiders ${tally.hits}   on props ${tally.misses}   phase ${m.phase} ${m.round}/${m.rounds}`;
    }
    if (screen === "play" && !input.pointer.locked && !controls.coarse && input.gamepadIndex < 0 && m.phase !== "over") hud.notice("Click to take the mouse", 0.3);
    controls.showTouch(screen === "play" ? (asGhost ? "ghost" : hider ? "hider" : "seeker") : null);
    hud.nameTags(camera, canvas.clientWidth, canvas.clientHeight, asGhost);
    hud.scores(controls.active && input.isDown("scores"), frameDelta);
    hud.update(frameDelta, debug);
});

applySettings();
world.loadMap(getMap(save.practice.map));
show("title");
game.start();

/** console hook, for poking at the game and for the tools */
window.decoy = { game, world, client, hud, sound, controls, view, input, save, settings, compact, startPractice, playOnline, online, conditions, applySettings, show, ghost, aimed, get room() { return room; }, get screen() { return screen; } };
