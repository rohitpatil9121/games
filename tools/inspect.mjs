/**
 * Measured evidence for the visual scorecard (the `threejs-qa-release` canvas inspector's metrics, computed
 * in the page so no Playwright download is needed) and frame timing.
 *
 *   node tools/inspect.mjs <name> "<script run after Practice starts>" [wait seconds] [width] [height]
 *
 * Opens the game in headless Chrome on the real GPU, starts Practice, runs the script (it may return a
 * promise), waits, then renders one frame and reads the pixels straight back from the canvas. Writes
 * artifacts/<name>.jpg and artifacts/<name>.json with:
 *   metrics       colour entropy, edge density, luminance contrast, dominant colour share (same formulas,
 *                 same 160x90 grid as inspect-threejs-canvas.mjs)
 *   renderBudget  draw calls, shadow draws, triangles, from the engine's renderer stats
 *   frame         the median of 30 frames rendered back to back with gl.finish() around each: GPU-synced
 *                 milliseconds per frame, which is what a mid-range machine pays
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const [name = "capture", script = "", wait = "2", width = "1280", height = "720"] = process.argv.slice(2);
const OUT = fileURLToPath(new URL("../artifacts/", import.meta.url));
await mkdir(OUT, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const measure = `(() => {
    const g = tidefall.game, canvas = g.renderer.canvas || document.getElementById("view"), gl = g.renderer.gl;
    const L = g.loop;
    const times = [];
    // a whole frame: everything onRender does (camera, players, HUD, the scene, post), GPU-synced
    for (let i = 0; i < 30; i++) { gl.finish(); const t0 = performance.now(); g._render(1, 1 / 60); gl.finish(); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    L.tick(performance.now());
    const c2 = document.createElement("canvas"); c2.width = canvas.width; c2.height = canvas.height;
    const x = c2.getContext("2d"); x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c2.width, c2.height).data, W = c2.width, H = c2.height;
    const stepX = Math.max(1, Math.floor(W / 160)), stepY = Math.max(1, Math.floor(H / 90)), cols = Math.floor(W / stepX), rows = Math.floor(H / stepY);
    const lum = new Float64Array(cols * rows), buckets = new Map(); let n = 0;
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        const o = ((gy * stepY) * W + gx * stepX) * 4, r = d[o], gg = d[o + 1], b = d[o + 2];
        lum[gy * cols + gx] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const k = (r >> 4) + "," + (gg >> 4) + "," + (b >> 4); buckets.set(k, (buckets.get(k) || 0) + 1); n++;
    }
    const s = Array.from(lum).sort((a, b) => a - b), p5 = s[Math.floor(s.length * 0.05)], p95 = s[Math.floor(s.length * 0.95)];
    let ent = 0, dom = 0; for (const c of buckets.values()) { const p = c / n; ent -= p * Math.log2(p); dom = Math.max(dom, c); }
    let edges = 0, checked = 0;
    for (let gy = 0; gy < rows - 1; gy++) for (let gx = 0; gx < cols - 1; gx++) { const i = gy * cols + gx; if (Math.max(Math.abs(lum[i] - lum[i + 1]), Math.abs(lum[i] - lum[i + cols])) > 12) edges++; checked++; }
    const st = g.renderer.stats, r2 = (v, k) => Number(v.toFixed(k));
    return { metrics: { colorBuckets: buckets.size, colorEntropyBits: r2(ent, 2), edgeDensity: r2(edges / checked, 3), luminance: { p5: r2(p5, 1), p95: r2(p95, 1), contrast: r2(p95 - p5, 1) }, dominantColorShare: r2(dom / n, 3) },
        renderBudget: { drawCalls: st.drawCalls, shadowCalls: st.shadowCalls, triangles: st.triangles },
        frame: { medianMs: r2(times[15], 2), worstMs: r2(times[29], 2), size: [W, H] }, players: tidefall.client.players.size };
})()`;

try {
    const page = await browser.page(`http://localhost:${port}/`, { width: +width, height: +height });
    await page.waitFor("!!window.tidefall", 15000);
    await page.evaluate("tidefall.debug()");
    await new Promise((r) => setTimeout(r, 1500));
    if (script) console.log("script:", JSON.stringify(await page.evaluate(script)));
    await new Promise((r) => setTimeout(r, +wait * 1000));
    const result = await page.evaluate(measure);
    await writeFile(OUT + name + ".jpg", await page.screenshot("jpeg", 85));
    await writeFile(OUT + name + ".json", JSON.stringify(result, null, 2));
    console.log(name, JSON.stringify(result));
    if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
