/**
 * SKYFARM: the marketing screenshots (the preamble: five screenshots), captured from the real game in headless
 * Chrome on the GPU at 1600 × 900, HUD off, High quality. Each shot sets up a moment through the console hook
 * (time of day, weather, how far the world is restored) and a camera, settles the streaming around it, then
 * captures. Writes marketing/shot-N-name.jpg.
 *
 *   node tools/shots.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";
import { ISLANDS } from "../game/world-data.js";

const OUT = fileURLToPath(new URL("../marketing/", import.meta.url));
await mkdir(OUT, { recursive: true });
const by = Object.fromEntries(ISLANDS.map((i) => [i.id, i]));
const crown = by.crown;

/** name, setup script (S = skyfarm), and a fixed camera or null to let the game's own camera frame it */
const SHOTS = [
    ["home-golden-hour", `S.weather("dry"); S.state.tick = 0.735 * 72000; S.demoGarden([0.3, 0.6, 1, 1]);`, { eye: [52, -58, 72], target: [2, 0, 60], fov: 42 }],
    ["first-glide", `S.weather("dry"); S.state.tick = 0.6 * 72000; const p = S.state.player; p.hasGlider = true; p.x = 46; p.y = 14; p.z = 64; p.mode = "glide"; p.ground = false; p.yaw = Math.atan2(34 - 14, 150 - 46); p.speed = 13; p.pitch = -0.08; p.stamina = 60; S.controls.view.yaw = p.yaw; S.controls.view.pitch = -0.2; S.run(1.2);`, null],
    ["garden-in-bloom", `S.weather("dry"); S.state.tick = 0.68 * 72000; S.demoGarden([0.45, 0.8, 1, 1]); S.run(2);`, { eye: [1.2, -9.5, 61.9], target: [7, -1.5, 60.4], fov: 52 }],
    ["night-at-home", `S.weather("dry"); S.state.tick = 0.93 * 72000; S.demoGarden([0.4, 1]);`, { eye: [-9, -16, 63.5], target: [2, 2, 61.5], fov: 55 }],
    ["storm-at-the-mill", `S.weather("storm");`, { eye: [8.5, -14.5, 61.6], target: [30, -5, 62], fov: 60 }],
    ["the-great-tree", `S.weather("dry"); S.state.tick = 0.7 * 72000; for (const i of S.world.islands) S.state.progress.restored.add(i.id); S.view.stream.trees.elder.leaves.values.u_bloom = 1;`, { eye: [crown.landmark.x + 30, crown.landmark.y - 34, crown.top + 6], target: [crown.landmark.x, crown.landmark.y, crown.top + 20], fov: 58 }],
];

const port = 9500 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });
try {
    const page = await browser.page(`http://localhost:${port}/?quality=high`, { width: 1600, height: 900 });
    await page.waitFor("!!window.skyfarm", 20000);
    await page.evaluate("document.getElementById('start').click(); document.getElementById('hud').style.display = 'none'; skyfarm.run(0.3); true");
    let n = 0;
    for (const [name, setup, cam] of SHOTS) {
        await page.evaluate(`(() => { const S = skyfarm; S.reset(); ${setup}
            const eye = ${cam ? JSON.stringify(cam.eye) : "S.rig.eye.slice()"};
            ${cam ? `S.shot(${JSON.stringify(cam.eye)}, ${JSON.stringify(cam.target)}, undefined, ${cam.fov});` : "S.shot(null);"}
            S.view.snapExposure = true;
            const tick = S.state.tick; S.view.stream.settle(eye); S.run(0.5); ${cam ? "S.state.tick = tick;" : ""}
            return true; })()`);
        await new Promise((r) => setTimeout(r, 400));
        const file = `shot-${++n}-${name}.jpg`;
        await writeFile(OUT + file, await page.screenshot("jpeg", 90));
        console.log("marketing/" + file);
    }
    if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
