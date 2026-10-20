import { Game, Camera, PostFX } from "../engine/index.js";
import { LOOT, LOOT_KINDS, TICK_RATE, BTN, MATCH, TOOLS, WATER, TEAM_NAMES, TEAM_SCHEMES, teamColors, teamColor } from "./data.js";
import { quantizeYaw, quantizePitch } from "./det.js";
import { reachableLoot } from "./sim.js";
import { tideAt, matchLeft, waterAt } from "./tide.js";
import { generateIsland, groundAt } from "./island.js";
import { Client, Loopback, SocketTransport, Conditions } from "./net.js";
import { PROTOCOL, NAME_MAX, cleanText } from "./protocol.js";
import { World } from "./world.js";
import { loadCharacters } from "./characters.js";
import { Sound } from "./sound.js";
import { Tutorial } from "./tutorial.js";
import { load as loadSave, store as storeSave } from "./save.js";
import { Controls, defaultBindings, keyHint, ACTIONS, describe } from "./controls.js";
import { ThirdPerson } from "./camera.js";
import { Hud } from "./hud.js";
import { FLAG } from "./protocol.js";
import { Room } from "../server/room.mjs";

/**
 * TIDEFALL: the application. Screens, the camera, and the wiring between the parts. The match lives in
 * sim.js, the room that runs it in server/room.mjs (the same class here for Practice and on the server),
 * the network in net.js, the scene in world.js. Structure follows BREACH's main.js.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ saved between visits (game/save.js)
const save = loadSave();
const persist = () => storeSave(save);
const settings = save.settings;
const systemReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** null in the settings means "do as the system says" */
const reducedMotion = () => settings.reducedMotion ?? systemReducedMotion;

// ------------------------------------------------------------------ engine
const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false, camera: new Camera({ mode: "orbit", fov: settings.fov, near: 0.1, far: 900 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.15, intensity: 0.4 }, vignette: 0.22, grain: 0.01, contrast: 1.1, saturation: 1.12, exposure: 0.97 });

const world = new World(game);
const client = new Client();
const controls = new Controls(input, canvas, settings);
const view = controls.view;
const rig = new ThirdPerson(camera);
const hud = new Hud(client);
const tutorial = new Tutorial(save.tutorial, (text, seconds) => hud.tip(text, seconds));
const keyName = (id) => (id === "move" ? ["forward", "left", "back", "right"].map((a) => keyHint(settings.bindings, a)).join("") : keyHint(settings.bindings, id)) || id;
const sound = new Sound({ volume: settings.volume });
sound.onCaption = (text, seconds) => hud.caption(text, seconds);
// browsers allow sound only after a click or a key press
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => sound.start(), { once: true });
// every button clicks
document.addEventListener("click", (e) => { if (e.target instanceof HTMLElement && e.target.closest("button")) sound.click(e.target.closest("button").id === "leave"); });

/** Put the settings into effect. Called at start and whenever one changes. */
function applySettings() {
    renderer.setQuality(settings.quality);
    world.setQuality(settings.water);
    world.setShadows(settings.shadows);
    renderer.postfx.settings.bloom.enabled = settings.bloom;
    camera.fov = settings.fov;
    const db = (v) => (v <= 0.001 ? -60 : 20 * Math.log10(v));
    sound.levels.music = -8 + db(settings.music); sound.levels.sfx = db(settings.sfx);
    sound.setVolume(settings.volume);
    sound.captions = settings.captions;
    game.juice.reducedMotion = reducedMotion();
    world.reducedMotion = reducedMotion();
    document.body.classList.toggle("reduce-motion", reducedMotion());
    if (teamColors.scheme !== settings.scheme) { teamColors.scheme = settings.scheme; world.recolor(); if (client.island) world.loadIsland(client.island); }
    for (const id of ["hud", "title", "pause", "settings"]) $(id).style.zoom = String(settings.textSize);
    controls.apply();
    persist();
}

// ------------------------------------------------------------------ screens
let screen = "title", settingsFrom = "title";
function show(name) {
    if (name === "settings") settingsFrom = screen === "settings" ? settingsFrom : screen;
    screen = name;
    const inMatch = name === "play" || name === "pause" || (name === "settings" && settingsFrom !== "title");
    $("title").hidden = name !== "title";
    $("pause").hidden = name !== "pause";
    $("settings").hidden = name !== "settings";
    $("hud").hidden = !inMatch;
    controls.active = name === "play";
    controls.showTouch(name === "play");
    if (name !== "play") for (const code of [...input.down]) input.release(code);
    if (name === "title") $("practice").focus();
    else if (name === "pause") $("resume").focus();
    else if (name === "settings") { $("settings-back").focus({ preventScroll: true }); $("settings").querySelector(".panel").scrollTop = 0; }
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
    room.assist = settings.assist;
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
    link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name: playerName(), assist: !!settings.assist, ...hello });
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
    else if (e.code === "Tab" && screen === "play") e.preventDefault();
    else if (e.code === "Escape" && performance.now() - lockLost > 400) {
        if (screen === "play" && !document.pointerLockElement) show("pause");
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
    const pct = (v) => Math.round(v * 100) + "%";
    const labels = () => {
        $("s-sensitivity-out").textContent = settings.sensitivity.toFixed(2);
        $("s-fov-out").textContent = settings.fov + "°";
        $("s-volume-out").textContent = pct(settings.volume); $("s-music-out").textContent = pct(settings.music); $("s-sfx-out").textContent = pct(settings.sfx);
    };
    bind("s-sensitivity", "sensitivity", number, setValue);
    bind("s-invert", "invertY", checked, setChecked, "change");
    bind("s-fov", "fov", number, setValue);
    bind("s-quality", "quality", value, setValue, "change");
    bind("s-water", "water", value, setValue, "change");
    bind("s-shadows", "shadows", checked, setChecked, "change");
    bind("s-bloom", "bloom", checked, setChecked, "change");
    bind("s-volume", "volume", number, setValue);
    bind("s-music", "music", number, setValue);
    bind("s-sfx", "sfx", number, setValue);
    bind("s-captions", "captions", checked, setChecked, "change");
    bind("s-text", "textSize", number, setValue, "change");
    bind("s-assist", "assist", checked, setChecked, "change");
    $("s-scheme").replaceChildren(...Object.entries(TEAM_SCHEMES).map(([id, sc]) => new Option(sc.name, id)));
    bind("s-scheme", "scheme", value, setValue, "change");
    $("s-motion").value = settings.reducedMotion === null ? "system" : settings.reducedMotion ? "on" : "off";
    $("s-motion").addEventListener("change", () => { const v = $("s-motion").value; settings.reducedMotion = v === "system" ? null : v === "on"; applySettings(); });
    labels();

    // bindings: one row per action; press the button, then the key, mouse button or gamepad button
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

// ------------------------------------------------------------------ menus by gamepad: the d-pad or stick moves focus, A presses, B goes back
{
    let held = 0, was = { a: false, b: false };
    setInterval(() => {
        if (screen === "play") return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [], pad = [...pads].find((p) => p && p.connected);
        if (!pad) return;
        const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.6, down = pad.buttons[13]?.pressed || pad.axes[1] > 0.6;
        const a = !!pad.buttons[0]?.pressed, b = !!pad.buttons[1]?.pressed;
        const panel = $(screen);
        if ((up || down) && held <= 0 && panel) {
            const items = [...panel.querySelectorAll("button, input, select, summary")].filter((n) => n.offsetParent !== null && !n.disabled);
            const i = items.indexOf(document.activeElement);
            const next = items[(i + (down ? 1 : -1) + items.length) % items.length];
            if (next) next.focus();
            held = 8;
        } else if (!up && !down) held = 0; else held--;
        if (a && !was.a && document.activeElement instanceof HTMLElement) document.activeElement.click();
        if (b && !was.b) { if (screen === "settings") show(settingsFrom); else if (screen === "pause") resume(); }
        was = { a, b };
    }, 50);
}

// ------------------------------------------------------------------ what the match tells us
function notice(text, seconds = 3) { hud.notice(text, seconds); }

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
client.on("start", () => { world.loadIsland(client.island); flares.length = 0; notice("A new island", 3); });
client.on("close", (reason) => {
    const was = client.room && client.room.code !== "PRACTICE" ? client.room.code : online.last && online.last.room;
    toTitle();
    if (was) $("code").value = was;
    probe().then(() => { $("server-status").textContent = (reason || "Disconnected.") + (was && online.up ? ` Press Join to go back to room ${was}.` : ""); });
});
client.on("event", onEvent);
// my own jump and grapple sound the moment they happen, not when the server agrees
client.on("predicted", (e) => {
    if (e.type === "jump") sound.play("jump", 0.6);
    else if (e.type === "hook") { sound.play(e.hit ? "hook" : "miss", 0.8); if (e.hit) setTimeout(() => sound.at("clank", e.x, e.y, e.z, 0.8), 120); }
});

/** flares burning, as this client was told: { id, team, x, y, z, until } */
const flares = [];
let flareIds = 0;
const spot = { x: 0, y: 0, z: 0 };
/** Where a player is right now, as far as this client knows. */
function whereIs(id, out) {
    if (id === client.id) { out.x = client.me.x; out.y = client.me.y; out.z = client.me.z; return true; }
    const snap = client.snaps[client.snaps.length - 1], row = snap && snap.players.get(id);
    if (!row) return false;
    out.x = row[1]; out.y = row[2]; out.z = row[3];
    return true;
}
const kindName = (k) => LOOT[LOOT_KINDS[k]] ? LOOT[LOOT_KINDS[k]].name.toLowerCase() : "loot";

function onEvent(e) {
    const me = client.me, island = client.island, mine = e.id === me.id;
    const team = (id) => client.players.get(id)?.team ?? -1;
    switch (e.type) {
        case "over":
            notice(e.winner < 0 ? "A draw" : e.winner === me.team ? "Your team wins" : `${TEAM_NAMES[e.winner]} wins`, 6);
            sound.play(e.winner === me.team ? "win" : "lose", 0.9);
            {
                const mine = client.players.get(client.id)?.banked || 0;
                save.stats.matches++; save.stats.banked += mine;
                if (mine > save.stats.best) { save.stats.best = mine; hud.feed(`New personal best: <b>${mine}</b> banked`); }
                persist();
            }
            break;
        case "phase":
            if (e.phase === 0) { notice(`Tide ${e.tide + 1} of 6: the sea goes out`, 3); sound.play("chime", 0.6); sound.caption("[Bell: the sea goes out]", 2); }
            else if (e.phase === 1) { notice("Low tide: everything is open", 2.5); sound.play("chime", 0.5, 1.5); }
            else if (e.phase === 2) { notice("The flood is coming", 3); sound.hornBlast(true); }
            else if (e.phase === 3) { notice("High tide", 2); sound.hornBlast(false); }
            break;
        case "pick":
            if (mine) { world.glint(me.x, me.y, me.z + 1, [1, 0.85, 0.4]); sound.play(e.kind === 1 ? "coins" : "pick", 0.8, e.kind === 3 ? 0.8 : 1); }
            else if (whereIs(e.id, spot)) sound.at(e.kind === 1 ? "coins" : "pick", spot.x, spot.y, spot.z + 1, 0.6);
            break;
        case "nopick":
            if (mine) sound.play("miss", 0.5);
            break;
        case "bank": {
            const c = island.camps[e.team];
            world.glint(c.x, c.y, c.z + 1, teamColor(e.team), 60);
            hud.feed(`${hud.who(e.id)} banked <b>${e.value}</b>`, e.team);
            if (mine) { game.juice.shake(0.12); notice(`Banked ${e.value}`, 2); sound.play("bank", 0.9); sound.play("coins", 0.6, 0.9); }
            else sound.at("bank", c.x, c.y, c.z + 1, 0.8);
            break;
        }
        case "drop":
            if (e.why === "gasp" && whereIs(e.id, spot)) { world.sink(spot.x, spot.y, spot.z); sound.at("sink", spot.x, spot.y, spot.z, 0.8); }
            if (e.why === "drop" && whereIs(e.id, spot)) sound.at("drop", spot.x, spot.y, spot.z, 0.7);
            if (e.why === "gasp" && mine) { sound.play("gasp", 0.9); sound.caption("[Gasp: the heavy loot sinks]", 2.5); }
            if (e.why === "gasp") { if (mine) { game.juice.shake(0.25); notice("Out of breath: the heavy loot sinks", 3); } else hud.feed(`${hud.who(e.id)} lost loot to the sea`, team(e.id)); }
            break;
        case "drown":
            if (mine) { notice("Drowned. Back to camp", 3); sound.play("drown", 0.8); } else hud.feed(`${hud.who(e.id)} drowned`, team(e.id));
            break;
        case "shove":
            if (e.id !== me.id) { world.shove(e.id); if (whereIs(e.id, spot)) sound.at("whoosh", spot.x, spot.y, spot.z + 1, 0.7); }
            if (!e.target) break;
            if (whereIs(e.target, spot)) sound.at("shove", spot.x, spot.y, spot.z + 1, e.behind ? 1.2 : 0.9);
            if (e.target === me.id) sound.caption(e.behind ? "[Thud: shoved from behind]" : "[Thud: shoved]", 1.5);
            if (whereIs(e.target, spot)) world.puff(spot.x, spot.y, spot.z, client.level(client.clock) > spot.z + 0.8);
            if (e.target === me.id) { game.juice.shake(e.behind ? 0.55 : 0.35); notice(e.behind ? "Shoved from behind!" : "Shoved!", 1.5); }
            if (mine) game.juice.shake(0.15);
            hud.feed(`${hud.who(e.id)} shoved ${hud.who(e.target)}${e.behind ? " from behind" : ""}`, team(e.id));
            break;
        case "flare":
            world.flare(e.x, e.y, e.z, teamColor(e.team), TOOLS.flare.mark);
            sound.at("flare", e.x, e.y, e.z, 1);
            if (e.team !== me.team) sound.caption("[Hiss: a rival flare]", 1.5);
            flares.push({ id: ++flareIds, team: e.team, x: e.x, y: e.y, z: e.z, until: performance.now() + TOOLS.flare.mark * 1000 });
            break;
        case "blind":
            if (e.id === me.id) { game.juice.shake(0.2); sound.play("blind", 0.7); }
            break;
        case "hook":
            if (!mine && whereIs(e.id, spot)) { sound.at("hook", spot.x, spot.y, spot.z + 1.5, 0.7); if (e.hit) sound.at("clank", e.x, e.y, e.z, 0.7); }
            break;
        case "jump":
            if (!mine && whereIs(e.id, spot)) sound.at("jump", spot.x, spot.y, spot.z, 0.6);
            break;
        default: break;
    }
}

// ------------------------------------------------------------------ chat (as BREACH): its key opens the box, Enter sends, Escape closes
const chatForm = $("chat-form"), chatInput = $("chat-input");
function openChat() {
    if (screen !== "play" || !client.joined) return;
    for (const code of [...input.down]) input.release(code);
    chatForm.hidden = false; chatInput.value = ""; chatInput.focus();
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
client.on("chat", (m) => {
    const info = client.players.get(m.id), b = document.createElement("b"), t = document.createElement("span");
    b.textContent = m.name + ": "; t.textContent = m.text;
    hud.feed(b.outerHTML + t.outerHTML, info ? info.team : -1);
    sound.click();
});

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
    if (client.me.shoved) world.shove(client.id);
    if (room) room.tick();
});

// ------------------------------------------------------------------ drawing
const at = { x: 0, y: 0, z: 0, vx: 0, vy: 0 }, tide = {}, fx = { fov: 0, wasWater: 0, breathBeep: 0, wasGround: true, vz: 0 };
let since = 1;

game.onRender((dt, alpha) => {
    // first, so held messages (the welcome among them) are let through even before there is an island
    if (client.transport) client.frame(dt);
    if (!client.transport || !client.island) {
        // behind the menu: a slow turn high over the sea
        camera.mode = "orbit"; camera.target.set([0, 0, 2]); camera.distance = 120; camera.pitch = 0.32; camera.yaw += dt * 0.03;
        camera.update(0);
        if (world.island) world.setWater(waterAt(world.island.seed, 42 * 60), 42 * 60, 0, camera.eye);
        sound.update({ phase: 3, level: 0, shore: 30, height: 20, under: 0, playing: false });
        world.update(dt);
        return;
    }
    const me = client.me, island = client.island;
    controls.look(dt);
    tideAt(island.seed, Math.max(0, client.clock), tide);
    world.level = tide.level;
    client.myPosition(alpha, at);
    at.vx = me.vx; at.vy = me.vy;
    fx.fov += ((me.hook ? 9 : 0) - fx.fov) * (1 - Math.exp(-dt * 6));
    rig.update(dt, at, view, island, tide.level, { fov: settings.fov + fx.fov });
    camera.update(0);
    world.setWater(tide.level, client.clock, rig.under, camera.eye);

    // splashes for my own player
    const wet = me.water >= 2 ? 1 : 0;
    if (wet !== fx.wasWater && me.alive) { world.splash(me.x, me.y, tide.level, wet ? Math.min(1.5, 0.4 + Math.abs(me.vz) / 6) : 0.4); sound.play("splash", wet ? 0.8 : 0.4); }
    // low breath: a beep each second, the rest of the mix dipped under it, and a caption
    const full = WATER.breath * TICK_RATE * (me.assist ? 1.5 : 1);
    if (me.alive && me.breath < full * 0.35 && (fx.breathBeep -= dt) <= 0) { fx.breathBeep = 1; sound.play("breath", 0.7, 1 + (1 - me.breath / (full * 0.35)) * 0.5); sound.dip(-4, 0.5); sound.caption("[Beeping: out of breath]", 1); }
    if (!fx.wasGround && me.ground && me.alive && fx.vz < -9) sound.play("land", Math.min(1, (-fx.vz - 6) / 12));
    fx.wasGround = me.ground; fx.vz = me.vz;
    sound.listen(camera);
    sound.update({ phase: tide.phase, level: tide.level, shore: Math.abs(groundAt(island, camera.eye[0], camera.eye[1]) - tide.level) * 9, height: camera.eye[2], under: rig.under > 0.5 ? 1 : 0, playing: true, over: client.match.phase === "over" });
    fx.wasWater = wet;

    const steps = world.drawPlayers(client, at, dt);
    // footfalls kick up sand on dry ground
    for (const id of steps) {
        const c = world.carriers.get(id);
        if (!c) continue;
        if (c.z > tide.level) { world.kick(c.x, c.y, c.z, 4); sound.at("step", c.x, c.y, c.z, id === client.id ? 0.7 : 0.5); }
        else sound.at("stroke", c.x, c.y, tide.level, 0.6);
    }
    // ropes: mine from prediction, the others' from their snapshot rows
    world.beginRopes();
    if (me.hook && me.alive) world.rope(at.x, at.y, at.z + 1.3, me.hx, me.hy, me.hz);
    for (const [id, c] of world.carriers) {
        if (id === client.id) continue;
        const s = sample;
        if (client.sample(id, s) && (s.flags & FLAG.hook)) world.rope(c.x, c.y, c.z + 1.3, s.hx, s.hy, s.hz);
    }
    world.endRopes();
    world.drawLoot(client);
    world.update(dt);

    const aim = me.alive ? rig.aimAt(island, me) : null;
    $("crosshair").classList.toggle("reach", !!aim && aim.reach && me.hookCool === 0);

    const now = performance.now();
    for (let i = flares.length - 1; i >= 0; i--) if (flares[i].until < now) flares.splice(i, 1);
    const near = nearestLoot(me);
    const prompt = !me.alive ? `Drowned. Back at camp in ${Math.ceil(me.respawn / TICK_RATE)} s`
        : me.stun > 0 ? "" : near ? `${keyOf("interact")}: pick up ${LOOT[LOOT_KINDS[near.kind]].name} (${LOOT[LOOT_KINDS[near.kind]].weight} kg)` : "";
    if ($("prompt").textContent !== prompt) $("prompt").textContent = prompt;
    let debug;
    if (!$("debug").hidden && (since += dt) > 0.1) {
        since = 0;
        const st = renderer.stats, n = client.stats;
        debug = `pos ${me.x.toFixed(1)} ${me.y.toFixed(1)} ${me.z.toFixed(2)}  speed ${Math.hypot(me.vx, me.vy).toFixed(1)}  ${["dry", "wading", "swimming", "sunk"][me.water]}`
            + `\n${Math.round(game.loop.fps)} fps  ${game.loop.frameMs.toFixed(1)} ms  ${st.drawCalls} draws  ${(st.triangles / 1000).toFixed(0)}k tris`
            + `\nping ${client.ping} ms  in ${(n.bytesIn / 1000).toFixed(1)} kB/s  out ${(n.bytesOut / 1000).toFixed(1)} kB/s  ${n.snaps} snaps/s`
            + `\nreplayed ${n.replayed}  corrections ${n.corrections}  last error ${n.lastError.toFixed(3)} m   match left ${Math.ceil(matchLeft(client.clock))} s`;
    }
    if (tutorial.update(dt, { me, island, tide, near, banked: client.players.get(client.id)?.banked || 0, keys: keyName })) persist();
    hud.update(dt, { camera, width: canvas.clientWidth, height: canvas.clientHeight, viewYaw: view.yaw, scores: controls.active && input.isDown("scores"), flares, debug });
});
const sample = {};
const keyOf = (id) => (settings.bindings[id] || [])[0]?.replace(/^Key/, "") || id;

/** The item the server would let me pick up, as far as this client knows. */
const lootView = { loot: [] };
function nearestLoot(me) {
    lootView.loot.length = 0;
    for (const l of client.loot.values()) lootView.loot.push(l);
    return reachableLoot(lootView, me);
}

applySettings();
show("title");
// the island behind the title screen: any seed will do
world.loadIsland(generateIsland(20261020, 4));
await loadCharacters().catch((e) => console.warn("characters", e));
game.start();

/** console hook, for poking at the game and for the tools */
window.tidefall = { game, world, client, sound, controls, view, rig, input, save, settings, conditions, startPractice, playOnline, online, show, resume,
    get room() { return room; }, get screen() { return screen; }, debug() { startPractice(); return "ok"; },
    /** Practice only: jump the match to a tick and put me somewhere, looking somewhere (for screenshots and checks) */
    stage(tick, x, y, yaw = view.yaw, pitch = view.pitch) {
        if (!room) return "no practice room";
        room.state.tick = tick;
        const p = room.state.players.find((q) => q.id === client.id);
        if (x !== undefined) { p.x = x; p.y = y; p.z = groundAt(room.island, x, y) + 0.05; p.vx = p.vy = p.vz = 0; }
        view.yaw = yaw; view.pitch = pitch;
        return room.state.tick;
    } };
