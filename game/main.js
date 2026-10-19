import { Game, Camera, PostFX } from "../engine/index.js";
import { TIDE, LOOT, LOOT_KINDS, WATER, TICK_RATE, MOVE } from "./data.js";
import { quantizeYaw, quantizePitch } from "./det.js";
import { groundAt } from "./island.js";
import { fairIsland } from "./fairness.js";
import { createState, addPlayer, step, reachableLoot } from "./sim.js";
import { tideAt, matchLeft } from "./tide.js";
import { World } from "./world.js";
import { Controls, defaultBindings } from "./controls.js";
import { ThirdPerson } from "./camera.js";
import { BTN } from "./data.js";

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
const rig = new ThirdPerson(camera);

let island = null, state = null, me = null, screen = "title";
const prev = { x: 0, y: 0, z: 0 };
const inputs = new Map();
let seq = 0, lastButtons = 0;

const query = new URLSearchParams(location.search);
function newMatch(seed) {
    island = fairIsland(seed, Number(query.get("teams")) || 4).island;
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
    // on the tick a tool is used, aim from the head at what the crosshair is on (see camera.js aimAt)
    let yaw = view.yaw, pitch = view.pitch;
    const pressed = c.buttons & ~lastButtons;
    lastButtons = c.buttons;
    if (pressed & (BTN.grapple | BTN.flare)) { const t = rig.aimAt(island, me); yaw = t.yaw; pitch = t.pitch; }
    inputs.set(me.id, { seq: ++seq, mx: c.mx, my: c.my, buttons: c.buttons, yaw: quantizeYaw(yaw), pitch: quantizePitch(pitch), lag: 0 });
    step(state, island, inputs);
    for (const e of state.events) onEvent(e);
    if (state.phase === "over" && state.overTicks <= 0) newMatch((island.seed * 1664525 + 1013904223) >>> 0);
});

// ------------------------------------------------------------------ the camera and the HUD
const at = { x: 0, y: 0, z: 0 };
const tide = {};
let hudNote = "", since = 1;
const carriers = new Map();

let overview = false;
const fx = { fov: 0, wasWater: 0, landVz: 0 };
function thirdPerson(alpha, dt) {
    if (overview) { camera.mode = "orbit"; camera.target.set([0, 0, 0]); camera.distance = 230; camera.pitch = 1.0; camera.yaw = -Math.PI / 2; return; }
    at.x = prev.x + (me.x - prev.x) * alpha; at.y = prev.y + (me.y - prev.y) * alpha; at.z = prev.z + (me.z - prev.z) * alpha;
    at.vx = me.vx; at.vy = me.vy;
    // a wider view while the grapple pulls: speed you can see (game-feel)
    fx.fov += ((me.hook ? 9 : 0) - fx.fov) * (1 - Math.exp(-dt * 6));
    rig.update(dt, at, view, island, tide.level, { fov: settings.fov + fx.fov });
}

/** What happened this tick, shown and (later) heard. */
function onEvent(e) {
    if (e.type === "over") hudNote = `Match over: ${state.bank[0]} banked`;
    else if (e.type === "pick" && e.id === me.id) world.glint(me.x, me.y, me.z + 1, [1, 0.85, 0.4]);
    else if (e.type === "bank") { world.glint(island.camps[e.team].x, island.camps[e.team].y, island.camps[e.team].z + 1, [1, 0.9, 0.5], 60); game.juice.shake(0.12); }
    else if (e.type === "drop" && e.why === "gasp") game.juice.shake(0.25);
}

/** Effects that follow the player's own movement: splashes, landings. */
function movementFx(dt) {
    const wet = me.water >= 2 ? 1 : 0;
    if (wet && !fx.wasWater) world.splash(me.x, me.y, tide.level, Math.min(1.5, 0.4 + Math.abs(me.vz) / 6));
    if (!wet && fx.wasWater && me.alive) world.splash(me.x, me.y, tide.level, 0.4);
    fx.wasWater = wet;
    if (me.ground && fx.landVz < -9) game.juice.shake(Math.min(0.35, (-fx.landVz - 9) / 25));
    fx.landVz = me.ground ? 0 : me.vz;
}

game.onRender((frameDelta, alpha) => {
    if (!state) return;
    controls.look(frameDelta);
    tideAt(state.seed, state.tick, tide);
    thirdPerson(alpha, frameDelta);
    movementFx(frameDelta);
    world.rope(!!me.hook && me.alive, at.x, at.y, at.z + 1.3, me.hx, me.hy, me.hz);
    world.setWater(tide.level);
    world.update(frameDelta);
    world.placePlayer(me.id, me.team, at.x, at.y, at.z, Math.atan2(me.fy, me.fx), me.alive);
    carriers.clear();
    const index = new Map();
    me.carry.forEach((id, i) => index.set(id, i));
    carriers.set(me.id, { x: at.x, y: at.y, z: at.z, fx: me.fx, fy: me.fy, face: Math.atan2(me.fy, me.fx), index });
    world.drawLoot(state.loot, carriers);

    // underwater: a blue murk, faded in and out (camera.js eases rig.under)
    const s = game.scene, u = overview ? 0 : rig.under;
    s.fogColor.set([0.6 + (0.05 - 0.6) * u, 0.74 + (0.25 - 0.74) * u, 0.86 + (0.32 - 0.86) * u]);
    s.fogDensity = (overview ? 0.0007 : 0.004) + 0.085 * u;
    // the crosshair says when the grapple would reach
    if (!overview && me.alive) { const t = rig.aimAt(island, me); $("crosshair").classList.toggle("reach", t.reach && me.hookCool === 0); }

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

newMatch(Number(query.get("seed")) || (Date.now() & 0xffffff) + 1);
game.start();

/** console hook */
window.tidefall = { game, world, controls, view, get state() { return state; }, get island() { return island; }, get me() { return me; }, newMatch, play,
    debug: () => { play(); return "ok"; },
    /** look down on the whole island from above, at a tick (for checking the generator by eye) */
    overview(tick = 0) { state.tick = tick; overview = true; $("title").hidden = true; return island.seed; } };
