import { Game, PostFX } from "../engine/index.js";
import { FOLDS, FOLD_IDS, DT } from "./data.js";
import { createPlane, stepPlane } from "./sim.js";
import { RingRun } from "./rings.js";
import { bedroom } from "./rooms/bedroom.js";
import { GreyboxView } from "./view.js";
import { PlaneView } from "./planeview.js";
import { RollCamera, ChaseCamera } from "./camera.js";
import { Controls, defaultBindings, keyHint } from "./controls.js";

/**
 * PAPER PLANES, stage 2: flight feel and Ring Run in the greybox bedroom.
 *
 * The page opens straight into Ring Run's first set (the tutorial: thermal, fan, stall). This file is still
 * the stage-2 shell: stage 3 replaces it with the real application around the Room and the Client, and
 * keeps the controls, camera, plane view and rings.
 * @module game/main
 */

const $ = (id) => document.getElementById(id);
const canvas = $("view");
const camera = new RollCamera({ mode: "orbit", fov: 70, near: 0.02, far: 40 });
const game = new Game({ canvas, quality: "high", antialias: true, camera });
if (game.failed) throw new Error("WebGL unavailable");
game.renderer.postfx = new PostFX(game.renderer, { bloom: { threshold: 1.2, intensity: 0.35 }, vignette: 0.25, contrast: 1.05, saturation: 1.05, exposure: 1.0 });

const settings = { sensitivity: 1, invertPitch: false, bindings: defaultBindings(), lean: 1, fovKick: true, horizonLock: false, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches };
const room = bedroom;
const seed = 1234;
const view = new GreyboxView(game, room, seed);
const chase = new ChaseCamera(camera, room);
const controls = new Controls(game.input, canvas, settings);
controls.active = true;
const planeView = new PlaneView(game.scene, { effects: view.effects });
game.juice.reducedMotion = settings.reducedMotion;

let fold = "glider", setIndex = 0;
let plane, run, tick = 0, best = {};
const stats = { crumples: 0, flaps: 0, stalls: 0, stallTips: 0 };

function restart() {
    const set = room.rings[setIndex];
    // launch from the spot nearest the first ring, facing it
    plane = createPlane(0, fold, room.launches[0]);
    run = new RingRun(set);
    view.showRings(set);
    view.updateRings(0);
    controls.resetAim(plane);
    planeView.trail.clear();
    planeView.fold = fold;
    tick = 0;
    Object.assign(stats, { crumples: 0, flaps: 0, stalls: 0 });
    $("result").hidden = true;
}

addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") { fold = FOLD_IDS[Number(e.code.slice(5)) - 1]; restart(); }
    if (e.code === "KeyN") { setIndex = (setIndex + 1) % room.rings.length; restart(); }
    if (e.code === "KeyF") view.motes.visible = !view.motes.visible;
    if (e.code === "KeyH") settings.horizonLock = !settings.horizonLock;
    if (e.code === "F3") { e.preventDefault(); $("debug").hidden = !$("debug").hidden; }
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
});
canvas.addEventListener("click", () => { if (document.pointerLockElement !== canvas) game.input.lockPointer(); });

// ------------------------------------------------------------------ the fixed step
const prev = [0, 0, 0], cur = [0, 0, 0];
let passedFlash = -1;
game.onUpdate(() => {
    if (game.input.wasPressed("restart")) restart();
    const input = controls.gather(plane);
    prev[0] = plane.x; prev[1] = plane.y; prev[2] = plane.z;
    stepPlane(plane, input, room, seed);
    tick++;
    cur[0] = plane.x; cur[1] = plane.y; cur[2] = plane.z;
    if (plane.crumpled === 0 && !plane.events.includes("refold")) {
        const before = run.next, r = run.step(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
        if (r) {
            view.updateRings(run.next, before);
            game.juice.shake(0.05);
            if (r === "done") finish();
        }
    }
    for (const e of plane.events) {
        if (e === "crumple") { stats.crumples++; game.juice.shake(0.3); game.juice.freeze(80); }
        else if (e === "flap") { stats.flaps++; game.juice.shake(0.02); }
        else if (e === "stall") stats.stalls++;
        else if (e === "glance") game.juice.shake(0.06);
        else if (e === "refold") controls.resetAim(plane);
    }
    view.step(plane.clock * DT);
    planeView.step(plane, FOLDS[plane.fold]);
});

function finish() {
    const s = run.seconds, key = `${room.id}/${setIndex}/${fold}`, was = best[key];
    if (!was || s < was) best[key] = s;
    $("result").hidden = false;
    $("result").innerHTML = `<b>${run.set.name}</b> in ${s.toFixed(2)} s with the ${FOLDS[fold].name}${was && s < was ? " (new best)" : was ? ` (best ${was.toFixed(2)} s)` : ""}<br>` +
        `<span class="small">${keyHint(settings.bindings, "restart")} to fly it again, N for the next set, 1 2 3 to change fold</span>`;
}

// ------------------------------------------------------------------ each frame
const at = [0, 0, 0];
game.onRender((frameDelta, alpha) => {
    for (let i = 0; i < 3; i++) at[i] = prev[i] + (cur[i] - prev[i]) * alpha;
    const f = FOLDS[plane.fold];
    const viewYaw = controls.mode === "mouse" ? controls.aim.yaw : plane.yaw;
    const viewPitch = (controls.mode === "mouse" ? controls.aim.pitch : plane.pitch) * 0.6;
    chase.lean = settings.lean; chase.fovKick = settings.fovKick && !settings.reducedMotion; chase.horizonLock = settings.horizonLock;
    chase.update(frameDelta, at, viewYaw, viewPitch, plane.crumpled > 0 ? 0 : plane.roll, (plane.speed - f.cruise) / (f.max - f.cruise));
    planeView.frame(frameDelta, settings);
    view.frame((plane.clock - 1 + alpha) * DT);
    drawHud();
});

/** the short prompt that belongs to the next ring, or to a stall */
const TIPS = {
    thermal: "Circle in the warm air to climb",
    fan: "Ride the fan's stream",
    stall: "Climb to the high ring. Stalled? Dive to pick up speed",
};
let hudAt = 0;
function drawHud() {
    const now = performance.now();
    if (now - hudAt < 66) return;
    hudAt = now;
    const f = FOLDS[plane.fold], p = plane;
    $("flap").style.setProperty("--charge", String(p.flapWait <= 0 ? 1 : 1 - (p.flapWait * DT) / f.flap));
    $("flap").classList.toggle("ready", p.flapWait <= 0);
    // ring and time
    $("ring").textContent = run.done ? `${run.set.name}: done` : `${run.set.name}  ring ${run.next + 1} of ${run.set.rings.length}  ${run.next > 0 ? run.seconds.toFixed(1) + " s" : ""}`;
    // the aim circle
    const aimEl = $("aim");
    aimEl.hidden = controls.mode !== "mouse" || p.crumpled > 0;
    if (!aimEl.hidden) {
        const d = 3, a = controls.aim;
        const s = camera.project([at[0] + Math.cos(a.pitch) * Math.cos(a.yaw) * d, at[1] + Math.cos(a.pitch) * Math.sin(a.yaw) * d, at[2] + Math.sin(a.pitch) * d], canvas.clientWidth, canvas.clientHeight);
        aimEl.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    // a tip: stalled beats the ring's own tip; the ring's tip floats by the ring
    const tipEl = $("tip"), ring = run.ring;
    let tip = "", where = null;
    if (p.stalled && p.crumpled === 0) tip = "Stalled! Dive to pick up speed";
    else if (p.crumpled > 0) tip = "Crumpled. Refolding…";
    else if (ring && ring.tip && setIndex === 0) { tip = TIPS[ring.tip]; where = camera.project(ring.at, canvas.clientWidth, canvas.clientHeight); }
    tipEl.textContent = tip;
    tipEl.hidden = !tip;
    if (where && where.visible) { tipEl.style.left = `${Math.max(120, Math.min(canvas.clientWidth - 120, where.x))}px`; tipEl.style.top = `${Math.max(60, Math.min(canvas.clientHeight - 90, where.y - 50))}px`; }
    else { tipEl.style.left = "50%"; tipEl.style.top = "22%"; }
    // the gust telegraph also as a caption
    const until = view.gustIn(view.airTime || 0);
    $("caption").textContent = until > 0 && until < 1.5 ? "The curtains stir: a gust is coming" : until <= 0 ? "Gust from the window" : "";
    if (!$("debug").hidden) {
        $("debug").textContent =
            `${f.name}  airspeed ${p.speed.toFixed(2)} m/s (stall ${f.stall})  height ${p.z.toFixed(2)} m  climb ${p.vz >= 0 ? "+" : ""}${p.vz.toFixed(2)}\n` +
            `fan ${(p.inFan * 100) | 0}%  lift ${(p.inLift * 100) | 0}%  gust ${(p.inGust * 100) | 0}%  bank ${((p.roll * 180) / Math.PI).toFixed(0)}°  ${controls.mode}\n` +
            `crumples ${stats.crumples}  flaps ${stats.flaps}  stalls ${stats.stalls}  ${(game.loop.fps || 0).toFixed(0)} fps`;
    }
}

restart();
window.planes = { game, view, planeView, controls, settings, get plane() { return plane; }, get run() { return run; }, stats, restart, setSet(i) { setIndex = i; restart(); }, setFold(f) { fold = f; restart(); } };
game.start();
