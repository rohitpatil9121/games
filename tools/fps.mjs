/**
 * SKYFARM: frame rate as a player gets it (real requestAnimationFrame in headless Chrome on the GPU, the game's
 * own camera, "keep 60 fps" on or off), at a window size and quality, every 5 s: frames per second, the slowest
 * frame, and the resolution scale it settled on. tools/perf.mjs times the GPU at a fixed size; this is the
 * check that the adaptive resolution holds 60 fps where the fixed size wouldn't.
 *
 *   node tools/fps.mjs [width] [height] [quality] [seconds] [--fixed]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const args = process.argv.slice(2), fixed = args.includes("--fixed");
const [width = "1920", height = "1080", quality = "medium", seconds = "30"] = args.filter((a) => !a.startsWith("--"));
const port = 9800 + Math.floor(Math.random() * 150);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });
try {
    const page = await browser.page(`http://localhost:${port}/?quality=${quality}`, { width: +width, height: +height });
    await page.waitFor("!!window.skyfarm", 20000);
    // out on the farm by the field, looking over it (the heaviest kind of view); the player stands still
    await page.evaluate(`(() => { const S = skyfarm; S.settings.dynamicResolution = ${!fixed}; document.getElementById('start').click();
        const p = S.state.player; p.x = -1.2; p.y = -2.4; S.controls.view.yaw = 0.3; S.controls.view.pitch = -0.15;
        window.__frames = []; let last = performance.now();
        const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return true; })()`);
    for (let t = 5; t <= +seconds; t += 5) {
        await new Promise((r) => setTimeout(r, 5000));
        const r = await page.evaluate(`(() => { const f = window.__frames.splice(0); f.sort((a, b) => a - b); const d = skyfarm.dyn;
            return { fps: f.length / 5, p95: f[Math.floor(f.length * 0.95)] || 0, worst: f[f.length - 1] || 0, scale: d.scale, canvas: d.canvas }; })()`);
        console.log(`${String(t).padStart(3)} s  ${r.fps.toFixed(0).padStart(3)} fps  95% of frames under ${r.p95.toFixed(1)} ms, worst ${r.worst.toFixed(1)} ms  scale ${r.scale.toFixed(2)}  drawing ${r.canvas.join(" x ")}`);
    }
    if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
