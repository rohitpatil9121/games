/**
 * The marketing screenshots: five moments of a Practice match with seven bots, captured in headless
 * Chrome on the real GPU. Writes marketing/shot-1-*.jpg … shot-5-*.jpg (1600 × 900).
 *
 *   node tools/shots.mjs
 *
 * Each shot fast-forwards the match by running the room (the bots play), then places the camera.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const OUT = fileURLToPath(new URL("../marketing/", import.meta.url));
await mkdir(OUT, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

/** run the match to a tick (bots playing), then stand me somewhere looking somewhere */
const setup = (tick, where) => `(async () => {
    tidefall.save.practice = { teams: 4, bots: 7, skill: 2 };
    tidefall.save.tutorial.done = true;
    tidefall.startPractice();
    await new Promise((r) => setTimeout(r, 800));
    const room = tidefall.room;
    while (room.state.tick < ${tick}) { room.tick(); if (room.state.tick % 600 === 0) await new Promise((r) => setTimeout(r, 0)); }
    const i = tidefall.client.island, c = i.camps[0], me = room.state.players.find((p) => p.id === tidefall.client.id);
    ${where}
    return room.state.tick;
})()`;

const SHOTS = [
    ["1-camp", 60 * 6, `tidefall.stage(${60 * 6}, c.x - Math.cos(c.angle) * 2, c.y - Math.sin(c.angle) * 2, c.angle + 0.15, -0.18);`],
    // the rest follow whichever rival carries the most, from a few metres behind it
    ["2-low-tide-raid", 1 * 5400 + 60 * 47, `const q = room.state.players.filter((p) => p !== me && p.alive).sort((a, b) => b.weight - a.weight || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]; const a = Math.atan2(q.fy, q.fx); tidefall.stage(TICK, q.x - Math.cos(a) * 7 + Math.sin(a) * 2, q.y - Math.sin(a) * 7 - Math.cos(a) * 2, Math.atan2(q.y - (q.y - Math.sin(a) * 7), q.x - (q.x - Math.cos(a) * 7)), -0.15);`.replace("TICK", String(1 * 5400 + 60 * 47))],
    ["3-flood", 2 * 5400 + 60 * 60, `const q = room.state.players.filter((p) => p !== me && p.alive).sort((a, b) => b.weight - a.weight || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]; const a = Math.atan2(q.fy, q.fx); tidefall.stage(TICK, q.x - Math.cos(a) * 7 + Math.sin(a) * 2, q.y - Math.sin(a) * 7 - Math.cos(a) * 2, Math.atan2(q.y - (q.y - Math.sin(a) * 7), q.x - (q.x - Math.cos(a) * 7)), -0.15);`.replace("TICK", String(2 * 5400 + 60 * 60))],
    ["4-deep-wreck", 5 * 5400 + 60 * 44, `const q = room.state.players.filter((p) => p !== me && p.alive).sort((a, b) => b.weight - a.weight || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]; const a = Math.atan2(q.fy, q.fx); tidefall.stage(TICK, q.x - Math.cos(a) * 7 + Math.sin(a) * 2, q.y - Math.sin(a) * 7 - Math.cos(a) * 2, Math.atan2(q.y - (q.y - Math.sin(a) * 7), q.x - (q.x - Math.cos(a) * 7)), -0.15);`.replace("TICK", String(5 * 5400 + 60 * 44))],
    ["5-sunset-race-home", 5 * 5400 + 60 * 58, `tidefall.stage(${5 * 5400 + 60 * 58}, c.x * 1.8, c.y * 1.8, c.angle + Math.PI, -0.05);`],
];

try {
    const only = process.argv[2];
    for (const [name, tick, where] of SHOTS) {
        if (only && !name.startsWith(only)) continue;
        const page = await browser.page(`http://localhost:${port}/`, { width: 1600, height: 900 });
        await page.waitFor("!!window.tidefall", 15000);
        const result = await page.evaluate(setup(tick, where));
        await new Promise((r) => setTimeout(r, 2500));
        await writeFile(OUT + `shot-${name}.jpg`, await page.screenshot("jpeg", 88));
        console.log(name, result, page.errors.length ? "errors: " + page.errors.join(" | ") : "");
        await page.close?.();
    }
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
