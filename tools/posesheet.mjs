/**
 * A pose sheet of the raider's clips (the `disney-animation-rule-skill` review: read the action from a few
 * still frames). Plays each clip on the player's own raider in a Practice match and captures it from a
 * three-quarter view at the moments named below. Writes artifacts/pose-<clip>-<t>.jpg (640 × 640).
 *
 *   node tools/posesheet.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const OUT = fileURLToPath(new URL("../artifacts/", import.meta.url));
await mkdir(OUT, { recursive: true });
const port = 9600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

/** [clip, seconds into it] */
const SHOTS = [["idle", 1.0], ["run", 0.08], ["run", 0.22], ["carry", 0.1], ["wade", 0.2], ["swim", 0.3], ["swim", 0.9], ["shove", 0.17], ["shove", 0.26], ["hookThrow", 0.14], ["hookThrow", 0.3], ["stagger", 0.2], ["drown", 0.6], ["celebrate", 0.18], ["celebrate", 0.5], ["celebrate", 0.85]];

try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 640, height: 640 });
    await page.waitFor("!!window.tidefall", 15000);
    await page.evaluate(`(async () => {
        tidefall.save.practice = { teams: 2, bots: 0, skill: 2 };
        tidefall.save.tutorial.done = true;
        tidefall.startPractice();
        await new Promise((r) => setTimeout(r, 1200));
        document.getElementById("hud").style.visibility = "hidden";
        tidefall.portrait(undefined, 0.7, 3.4, 0.95, 0.08);
    })()`);
    for (const [clip, t] of SHOTS) {
        // hold the clip on the player's raider: a long one-shot, sampled from its start
        await page.evaluate(`(() => {
            const e = tidefall.world.players.get(tidefall.client.id), r = e.raider;
            r.play(${JSON.stringify(clip)}); r.oneShotLeft = 999;
            r.animator.play(${JSON.stringify(clip)}, { fade: 0, loop: false });
            r.freezeAt = ${t};
        })()`);
        await new Promise((r) => setTimeout(r, 600));
        await writeFile(OUT + `pose-${clip}-${String(t).replace(".", "")}.jpg`, await page.screenshot("jpeg", 85));
    }
    console.log(SHOTS.length + " poses", page.errors.length ? "errors: " + page.errors.join(" | ") : "(no console errors)");
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
