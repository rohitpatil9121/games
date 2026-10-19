import { Game, Camera, PostFX } from "../engine/index.js";
import { TIDE, LOOT, LOOT_KINDS, WATER, TICK_RATE, MOVE } from "./data.js";
import { quantizeYaw, quantizePitch } from "./det.js";
import { generateIsland, groundAt } from "./island.js";
import { createState, addPlayer, step, reachableLoot } from "./sim.js";
import { tideAt, matchLeft } from "./tide.js";
import { World } from "./world.js";
import { Controls, defaultBindings } from "./controls.js";

/**
 * TIDEFALL, stage 1 prototype (the `prototype-fast` skill). One question: is racing the flood fun?
 * One player, the island, the tide, loot and a camp to bank it at. The simulation runs here in the page,
 * straight from the controls; the network comes in stage 4.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const settings = { sensitivity: 1, invertY: false, fov: 70, bindings: defaultBindings() };

const canvas = $("view");
const game = new Game({ canvas, quality: "high", antialias: false, camera: new Camera({ mode: "orbit", fov: settings.fov, near: 0.1, far: 900 }) });
if (game.failed) throw new Error("WebGL unavailable");
const { renderer, camera, input } = game;
renderer.postfx = new PostFX(renderer, { bloom: { threshold: 1.2, intensity: 0.35 }, vignette: 0.2, grain: 0.01 });

const world = new World(game);
const controls = new Controls(input, canvas, settings);
const view = controls.view;

let island = null, state = null, me = null, screen = "title";
const prev = { x: 0, y: 0, z: 0 };
const inputs = new Map();
let seq = 0;

function newMatch(seed) {
    island = generateIsland(seed, 4);
    state = createState(island);
    me = addPlayer(state, island, 1, "You", { team: 0 });
    world.loadIsland(island);
    view.yaw = island.camps[0].angle; view.pitch = -0.25;
    prev.x = me.x; prev.y = me.y; prev.z = me.z;
}

function lockMouse() { try { const a = canvas.requestPointerLock(); if (a && a.catch) a.catch(() => {}); } catch { /* not available */ } }
function play() {
    screen = "play";
    $("title").hidden = true; $("hud").hidden = false;
    controls.active = true;
    lockMouse(); canvas.focus();
}
$("play").addEventListener("click", play);
canvas.addEventListener("click", () => { if (screen === "play" && !input.pointer.locked) lockMouse(); });

// ------------------------------------------------------------------ the fixed step
game.onUpdate(() => {
    if (!state) return;
    prev.x = me.x; prev.y = me.y; prev.z = me.z;
    const c = controls.gather();
    inputs.set(me.id, { seq: ++seq, mx: c.mx, my: c.my, buttons: c.buttons, yaw: quantizeYaw(view.yaw), pitch: quantizePitch(view.pitch), lag: 0 });
    step(state, island, inputs);
    for (const e of state.events) if (e.type === "over") hudNote = `Match over: ${state.bank[0]} banked`;
    if (state.phase === "over" && state.overTicks <= 0) newMatch((island.seed * 1664525 + 1013904223) >>> 0);
});

// ------------------------------------------------------------------ the camera and the HUD
const at = { x: 0, y: 0, z: 0 };
const tide = {};
let hudNote = "", since = 1;
const carriers = new Map();

function thirdPerson(alpha, dt) {
    at.x = prev.x + (me.x - prev.x) * alpha; at.y = prev.y + (me.y - prev.y) * alpha; at.z = prev.z + (me.z - prev.z) * alpha;
    const yaw = view.yaw, pitch = view.pitch;
    // over the right shoulder: the target sits a little to the right of the head
    const rx = Math.sin(yaw), ry = -Math.cos(yaw);
    const tx = at.x + rx * 0.55, ty = at.y + ry * 0.55, tz = at.z + 1.75;
    camera.mode = "orbit";
    camera.yaw = yaw + Math.PI;
    camera.pitch = -pitch;
    // pull in where the terrain is between the head and the camera
    let dist = 5.6;
    const bx = -Math.cos(pitch) * Math.cos(yaw), by = -Math.cos(pitch) * Math.sin(yaw), bz = -Math.sin(pitch);
    for (let t = 0.4; t <= dist; t += 0.2) {
        if (tz + bz * t < groundAt(island, tx + bx * t, ty + by * t) + 0.35) { dist = Math.max(0.8, t - 0.3); break; }
    }
    camera.distance += (dist - camera.distance) * (dist < camera.distance ? 1 : 1 - Math.exp(-dt * 4));
    camera.target.set([tx, ty, tz]);
}

game.onRender((frameDelta, alpha) => {
    if (!state) return;
    controls.look(frameDelta);
    thirdPerson(alpha, frameDelta);
    tideAt(state.seed, state.tick, tide);
    world.setWater(tide.level);
    world.update(frameDelta);
    world.placePlayer(me.id, me.team, at.x, at.y, at.z, Math.atan2(me.fy, me.fx), me.alive);
    carriers.clear();
    const index = new Map();
    me.carry.forEach((id, i) => index.set(id, i));
    carriers.set(me.id, { x: at.x, y: at.y, z: at.z, fx: me.fx, fy: me.fy, face: Math.atan2(me.fy, me.fx), index });
    world.drawLoot(state.loot, carriers);

    // underwater: a blue murk
    camera.update(0);
    const under = camera.eye[2] < tide.level;
    const s = game.scene;
    if (under) { s.fogColor.set([0.05, 0.25, 0.32]); s.fogDensity = 0.09; }
    else { s.fogColor.set([0.6, 0.74, 0.86]); s.fogDensity = 0.004; }

    // HUD
    const phase = TIDE.phases[tide.phase];
    $("tide-clock").textContent = `Tide ${tide.tide + 1} of ${TIDE.tides} · ${phase.name} ${Math.ceil(tide.phaseLeft / TICK_RATE)} s\nwater ${tide.level.toFixed(2)} m`;
    const items = me.carry.map((id) => { const l = state.loot.find((x) => x.id === id); return l ? LOOT[LOOT_KINDS[l.kind]].name : "?"; });
    $("carry").textContent = `Carrying ${me.weight} kg${items.length ? ": " + items.join(", ") : ""}`;
    $("bank").textContent = `Banked ${state.bank[0]}\n${hudNote}`;
    $("breath").style.opacity = me.breath < WATER.breath * TICK_RATE ? 1 : 0;
    $("breath").firstElementChild.style.width = (100 * me.breath) / (WATER.breath * TICK_RATE) + "%";
    const near = reachableLoot(state, me);
    $("prompt").textContent = !me.alive ? `Drowned. Back at camp in ${Math.ceil(me.respawn / TICK_RATE)} s` : near ? `E: pick up ${LOOT[LOOT_KINDS[near.kind]].name} (${LOOT[LOOT_KINDS[near.kind]].weight} kg)` : "";
    if ((since += frameDelta) > 0.1) {
        since = 0;
        const st = renderer.stats;
        $("debug").textContent = `pos ${me.x.toFixed(1)} ${me.y.toFixed(1)} ${me.z.toFixed(2)}  speed ${Math.hypot(me.vx, me.vy).toFixed(1)}  ${["dry", "wading", "swimming", "sunk"][me.water]}${me.ground ? " ground" : ""}`
            + `\n${Math.round(game.loop.fps)} fps  ${st.drawCalls} draws  ${(st.triangles / 1000).toFixed(0)}k tris   match left ${Math.ceil(matchLeft(state.tick))} s`;
    }
});

newMatch((Date.now() & 0xffffff) + 1);
game.start();

/** console hook */
window.tidefall = { game, world, controls, view, get state() { return state; }, get island() { return island; }, get me() { return me; }, newMatch, play,
    debug: () => { play(); return "ok"; } };
