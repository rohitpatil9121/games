/**
 * Character evidence (img2threejs: a turntable, not one frame; readability from far away): captures the
 * player's raider from the front, right, back and left, a mid shot of a camp with its crew, and a far
 * shot at 30 m, from a Practice match with seven bots, in headless Chrome on the real GPU.
 *
 *   node tools/turntable.mjs <prefix>        # writes artifacts/<prefix>-front.jpg … -far.jpg
 *   node tools/turntable.mjs after "<script>"  # run a script first (e.g. play a clip)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const [prefix = "turntable", extra = ""] = process.argv.slice(2);
const OUT = fileURLToPath(new URL("../artifacts/", import.meta.url));
await mkdir(OUT, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const VIEWS = [
    ["front", "tidefall.portrait(undefined, 0, 3.0, 1.0, 0.1)"],
    ["right", "tidefall.portrait(undefined, -Math.PI / 2, 3.0, 1.0, 0.1)"],
    ["back", "tidefall.portrait(undefined, Math.PI, 3.0, 1.0, 0.1)"],
    ["left", "tidefall.portrait(undefined, Math.PI / 2, 3.0, 1.0, 0.1)"],
    ["crew", "tidefall.portrait(undefined, 0.5, 9, 0.9, 0.22)"],
    ["far", "tidefall.portrait(undefined, 0.3, 30, 1.0, 0.18)"],
];

try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await page.waitFor("!!window.tidefall", 15000);
    await page.evaluate(`(async () => {
        tidefall.save.practice = { teams: 4, bots: 7, skill: 2 };
        tidefall.save.tutorial.done = true;
        tidefall.startPractice();
        await new Promise((r) => setTimeout(r, 1200));
        document.getElementById("hud").style.visibility = "hidden";
        ${extra}
    })()`);
    for (const [name, script] of VIEWS) {
        await page.evaluate(script);
        await new Promise((r) => setTimeout(r, 900));
        await writeFile(OUT + `${prefix}-${name}.jpg`, await page.screenshot("jpeg", 88));
    }
    console.log(`${prefix}: ${VIEWS.map((v) => v[0]).join(", ")}`, page.errors.length ? "errors: " + page.errors.join(" | ") : "(no console errors)");
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
