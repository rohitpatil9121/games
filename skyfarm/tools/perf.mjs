/**
 * SKYFARM: frame time per quality tier on this machine's GPU (the `performance-optimization` and
 * `threejs-debug-profiler` skills: measure, don't guess; time the GPU, not the CPU).
 *
 *   node tools/perf.mjs              # every tier, at the heaviest views, 1280 x 720
 *   node tools/perf.mjs 1600 900     # another size
 *   node tools/perf.mjs --ablate     # Medium, with one system switched off at a time: what each one costs
 *   node tools/perf.mjs --runs=5     # each tier in 5 fresh pages; the median and range across them (run-to-run
 *                                    # noise on this machine is a few ms, so one run can't settle a budget)
 *
 * Timing: gl.finish() returns early on ANGLE/D3D11 (the engine's ARCHITECTURE §9.2), so each sample renders
 * 40 frames back to back and then reads one pixel back with readPixels, which can't return until the GPU has
 * finished all of them. Milliseconds per frame = total / 40; the median of 5 samples is reported. It includes the
 * CPU side of a frame (culling, uniforms, the per-frame grass and particle updates) because a player pays both.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const args = process.argv.slice(2), ablate = args.includes("--ablate");
const [width = "1280", height = "720"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/** what to switch off for each ablation row: entity names, or "post" / "shadow" */
const OFF = { none: [], cumulus: ["cumulus"], "cloud sea": ["cloud-sea"], sky: ["sky"], grass: ["grass", "flowers"], trees: ["bark", "leaves", "fruit"], "island rock": ["@islands"], landmarks: ["*-landmark"], water: ["water", "waterfall"], props: ["props", "roof"], post: ["post"], shadows: ["shadow"] };
const VIEWS = {
    "hut door": [[-1.2, -2.4, 61.75], [8, 0.5, 60.6], 0.35, 60],
    "grass close": [[8.5, -14.5, 61.3], [14, -11, 60.2], 0.35, 55],
    "home wide": [[70, -78, 82], [0, 0, 52], 0.735, 45],
    // the heaviest weather: every rain streak, splashes, wet surfaces and puddles
    "grass close, storm": [[8.5, -14.5, 61.3], [14, -11, 60.2], "storm", 55],
};
const port = 9900 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const measure = (v) => `(() => {
    const S = skyfarm, g = S.game, gl = g.renderer.gl;
    S.weather(${JSON.stringify(typeof v[2] === "string" ? v[2] : "dry")});
    S.shot(${JSON.stringify(v[0])}, ${JSON.stringify(v[1])}, ${typeof v[2] === "string" ? "undefined" : v[2]}, ${v[3]});
    S.view.snapExposure = true;
    S.run(0.3);
    const px = new Uint8Array(4), samples = [];
    for (let s = 0; s < 6; s++) {
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) g._render(1, 1 / 60);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (s) samples.push((performance.now() - t0) / 40);
    }
    samples.sort((a, b) => a - b);
    const st = g.renderer.stats;
    return { ms: +samples[2].toFixed(2), worst: +samples[4].toFixed(2), draws: st.drawCalls, shadow: st.shadowCalls, tris: st.triangles, canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
})()`;

const toggle = (names, on) => `(() => { const S = skyfarm, sc = S.game.scene; const names = ${JSON.stringify(names)};
    if (names.includes("post")) S.post.enabled = ${on};
    if (names.includes("shadow")) S.view.setShadows(${on});
    const ids = new Set(S.world.islands.map((i) => i.id));
    const hit = (n) => names.includes(n) || (names.includes("@islands") && ids.has(n)) || (names.includes("*-landmark") && n && n.endsWith("-landmark"));
    // the streamer sets visibility every frame, so hide by emptying the mesh's draw instead
    sc.traverse((e) => { if (hit(e.name)) { if (!${on}) { e._mesh = e._mesh || e.mesh; e.mesh = null; } else if (e._mesh) { e.mesh = e._mesh; e._mesh = null; } } }); return true; })()`;

try {
    if (ablate) {
        const page = await browser.page(`http://localhost:${port}/?quality=medium`, { width: +width, height: +height });
        await page.waitFor("!!window.skyfarm", 20000);
        await page.evaluate("document.getElementById('start').click(); document.getElementById('hud').style.display = 'none'; skyfarm.run(0.2); true");
        for (const view of ["hut door", "home wide"]) {
            let base = 0;
            for (const [label, names] of Object.entries(OFF)) {
                await page.evaluate(toggle(names, false));
                const r = await page.evaluate(measure(VIEWS[view]));
                await page.evaluate(toggle(names, true));
                if (label === "none") base = r.ms;
                console.log(`${view.padEnd(10)} without ${label.padEnd(10)} ${String(r.ms).padStart(6)} ms  (${label === "none" ? "everything on" : "saves " + (base - r.ms).toFixed(2) + " ms"})`);
            }
        }
        await page.close();
    }
    const runs = +((args.find((a) => a.startsWith("--runs=")) || "").slice(7) || 1), all = {};
    for (let run = 0; run < runs; run++) for (const q of ablate ? [] : ["low", "medium", "high"]) {
        const page = await browser.page(`http://localhost:${port}/?quality=${q}`, { width: +width, height: +height });
        await page.waitFor("!!window.skyfarm", 20000);
        await page.evaluate("document.getElementById('start').click(); document.getElementById('hud').style.display = 'none'; skyfarm.run(0.2); true");
        for (const [name, v] of Object.entries(VIEWS)) {
            const r = await page.evaluate(measure(v));
            (all[q + " " + name] ||= []).push(r.ms);
            if (runs === 1) console.log(`${q.padEnd(7)} ${name.padEnd(12)} ${String(r.ms).padStart(6)} ms/frame (worst sample ${r.worst})  draws ${r.draws} + ${r.shadow} shadow, ${r.tris} triangles, ${r.canvas.join("x")}`);
        }
        if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
        await page.close();
    }
    if (runs > 1) for (const [k, v] of Object.entries(all)) {
        v.sort((a, b) => a - b);
        console.log(`${k.padEnd(28)} median ${v[v.length >> 1].toFixed(2).padStart(6)} ms  (${v[0].toFixed(2)}–${v[v.length - 1].toFixed(2)} over ${v.length} runs)${v[v.length >> 1] > 16.6 ? "  over 60 fps budget" : ""}`);
    }
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
