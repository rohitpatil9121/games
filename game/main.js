import { Game, PostFX } from "../engine/index.js";
import { FOLDS, FOLD_IDS, BTN, DT, FLIGHT } from "./data.js";
import { createPlane, stepPlane } from "./sim.js";
import { bedroom } from "./rooms/bedroom.js";
import { GreyboxView } from "./view.js";
import { RollCamera, ChaseCamera } from "./camera.js";

/**
 * PAPER PLANES, stage 1: the glide prototype (the `prototype-fast` brief in NOTES.md).
 *
 * One plane in the greybox bedroom with the desk fan and the radiator thermal, flown by mouse-aim or keys,
 * with the numbers being judged on screen. This file is throwaway: stage 3 replaces it with the real
 * application around the Room and the Client.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const canvas = $("view");
const camera = new RollCamera({ mode: "orbit", fov: 70, near: 0.02, far: 40 });
const game = new Game({ canvas, quality: "high", antialias: true, camera });
if (game.failed) throw new Error("WebGL unavailable");
game.renderer.postfx = new PostFX(game.renderer, { bloom: { threshold: 1.2, intensity: 0.35 }, vignette: 0.25, contrast: 1.05, saturation: 1.05, exposure: 1.0 });

const room = bedroom;
const seed = 1234;
const view = new GreyboxView(game, room);
const chase = new ChaseCamera(camera, room);

let fold = "glider";
let plane = createPlane(0, fold, room.launches[0]);
let tick = 0;
const stats = { crumples: 0, flaps: 0, stalls: 0, best: 0, rideStart: -1, longestRide: 0 };

// ------------------------------------------------------------------ input: mouse-aim by default, keys override
const aim = { yaw: plane.yaw, pitch: plane.pitch, mode: "mouse" };
const keys = new Set();
let clickFlap = false;
addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "KeyR") restart();
    if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") { fold = FOLD_IDS[Number(e.code.slice(5)) - 1]; restart(); }
    if (e.code === "KeyF") view.motes.visible = !view.motes.visible;
    if (e.code === "KeyH") chase.horizonLock = !chase.horizonLock;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* none */ } }
    else if (e.button === 0) clickFlap = true;
});
document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    aim.mode = "mouse";
    aim.yaw -= e.movementX * 0.0026;
    aim.pitch = Math.max(-1.1, Math.min(1.1, aim.pitch - e.movementY * 0.0026));
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** turn the keys or the aim point into this tick's input */
function readInput() {
    const k = (c) => keys.has(c);
    const kp = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    const kr = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
    let pitch = 0, roll = 0;
    if (kp || kr) {
        aim.mode = "keys";
        pitch = kp * 127; roll = kr * 127;
    } else if (aim.mode === "mouse") {
        // steer toward the aim direction: bank toward it, pitch toward it (the plane does the flying)
        const ey = wrap(aim.yaw - plane.yaw), ep = aim.pitch - plane.pitch;
        roll = clamp(-ey * 2.4, -1, 1) * 127;
        pitch = clamp(ep * 3.2, -1, 1) * 127;
    }
    if (aim.mode === "keys") { aim.yaw = plane.yaw; aim.pitch = plane.pitch; }
    const buttons = keys.has("Space") || clickFlap ? BTN.flap : 0;
    clickFlap = false;
    return { pitch: Math.round(pitch), roll: Math.round(roll), buttons };
}

function restart() {
    plane = createPlane(0, fold, room.launches[0]);
    aim.yaw = plane.yaw; aim.pitch = plane.pitch;
    view.trail.clear();
    tick = 0;
    Object.assign(stats, { crumples: 0, flaps: 0, stalls: 0, best: 0, rideStart: -1, longestRide: 0 });
}

// ------------------------------------------------------------------ the fixed step
const prev = [0, 0, 0], cur = [0, 0, 0];
game.onUpdate(() => {
    prev[0] = plane.x; prev[1] = plane.y; prev[2] = plane.z;
    const input = readInput();
    stepPlane(plane, input, room, seed);
    tick++;
    cur[0] = plane.x; cur[1] = plane.y; cur[2] = plane.z;
    for (const e of plane.events) {
        if (e === "crumple") { stats.crumples++; game.juice.shake(0.35); game.juice.freeze(80); }
        else if (e === "flap") stats.flaps++;
        else if (e === "stall") stats.stalls++;
        else if (e === "glance") game.juice.shake(0.08);
        else if (e === "refold") { aim.yaw = plane.yaw; aim.pitch = plane.pitch; view.trail.clear(); }
    }
    // the longest stretch flown without a flap or a crash: "did the air carry me?"
    if (plane.crumpled > 0 || plane.events.includes("flap")) stats.rideStart = tick;
    if (stats.rideStart < 0) stats.rideStart = tick;
    stats.longestRide = Math.max(stats.longestRide, (tick - stats.rideStart) * DT);
    stats.best = Math.max(stats.best, plane.z);
    view.step(plane.clock * DT, seed);
    view.setPlane(plane);
});

// ------------------------------------------------------------------ each frame
const at = [0, 0, 0];
game.onRender((frameDelta, alpha) => {
    for (let i = 0; i < 3; i++) at[i] = prev[i] + (cur[i] - prev[i]) * alpha;
    const f = FOLDS[plane.fold];
    const viewYaw = aim.mode === "mouse" ? aim.yaw : plane.yaw;
    const viewPitch = (aim.mode === "mouse" ? aim.pitch : plane.pitch) * 0.6;
    chase.update(frameDelta, at, viewYaw, viewPitch, plane.roll, (plane.speed - f.cruise) / (f.max - f.cruise));
    drawHud();
});

let hudAt = 0;
function drawHud() {
    const now = performance.now();
    if (now - hudAt < 100) return;
    hudAt = now;
    const f = FOLDS[plane.fold], p = plane;
    const flap = p.flapWait <= 0 ? "ready" : `${(p.flapWait * DT).toFixed(1)} s`;
    const state = p.crumpled > 0 ? "CRUMPLED" : p.stalled ? "STALL" : p.inFan > 0.15 ? `in the fan ${(p.inFan * 100) | 0}%` : p.inLift > 0.15 ? `in the thermal ${(p.inLift * 100) | 0}%` : "gliding";
    $("debug").textContent =
        `${f.name}  (1 dart, 2 glider, 3 stunt; R restart; F dust; H horizon lock)\n` +
        `airspeed ${p.speed.toFixed(2)} m/s   stall ${f.stall}   max ${f.max}\n` +
        `height ${p.z.toFixed(2)} m   climb ${p.vz >= 0 ? "+" : ""}${p.vz.toFixed(2)} m/s   ground ${Math.hypot(p.vx, p.vy).toFixed(2)} m/s\n` +
        `${state}   flap ${flap}   bank ${((p.roll * 180) / Math.PI).toFixed(0)}°\n` +
        `crumples ${stats.crumples}   flaps ${stats.flaps}   stalls ${stats.stalls}   longest ride without flapping ${stats.longestRide.toFixed(1)} s\n` +
        `${aim.mode === "mouse" ? "mouse-aim" : "keys"}   ${(game.loop.fps || 0).toFixed(0)} fps`;
    $("flap").style.setProperty("--charge", String(p.flapWait <= 0 ? 1 : 1 - (p.flapWait * DT) / f.flap));
    $("aim").hidden = aim.mode !== "mouse";
    if (aim.mode === "mouse") {
        // the aim circle: where the plane is being steered
        const d = 3, ax = at[0] + Math.cos(aim.pitch) * Math.cos(aim.yaw) * d, ay = at[1] + Math.cos(aim.pitch) * Math.sin(aim.yaw) * d, az = at[2] + Math.sin(aim.pitch) * d;
        const s = camera.project([ax, ay, az], canvas.clientWidth, canvas.clientHeight);
        $("aim").style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
}

window.planes = { game, view, get plane() { return plane; }, stats, aim, restart, FLIGHT };
game.start();
