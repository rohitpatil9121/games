/**
 * SKYFARM: streaming under load (GDD §5 and §11: load and unload with no hitches, measure it; memory as the
 * world grows; loading time).
 *
 *   node tools/stream-test.mjs [speed m/s]     # default 45 m/s, about four times a glider's cruise
 *
 * Headless Chrome on the real GPU, in real time (requestAnimationFrame, not ticked by hand). The camera flies a
 * route over the whole world (Hearth Isle → the Meadow → the Orchard Isles → the High Rocks → the Crown →
 * back over the Meadow), faster than a glider, so islands stream in and out much more often than in play.
 * Reports: load time to the first frame, frame times (median, 99th percentile, worst, frames over 33 ms), the
 * longest a frame spent building island tiers, tiers built and freed, and memory at points along the way
 * (the islands' geometry, and the JS heap).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";
import { ISLANDS } from "../game/world-data.js";

const speed = Number(process.argv[2] || 45);
const by = Object.fromEntries(ISLANDS.map((i) => [i.id, i]));
const ROUTE = ["hearth", "daisy", "bell", "mill", "apple", "kite", "twin", "ogate", "frost", "glass", "lantern", "crown", "storm", "eagle", "hive", "dock", "willow", "hollow", "fluff", "hearth"]
    .map((id) => [by[id].x, by[id].y, by[id].top + 35]);

const port = 9100 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const fly = `(() => {
    const S = skyfarm, route = ${JSON.stringify(ROUTE)}, speed = ${speed};
    document.getElementById("start").click(); document.getElementById("hud").style.display = "none";
    // the route as a polyline with distances
    const seg = []; let total = 0;
    for (let i = 0; i < route.length - 1; i++) { const a = route[i], b = route[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); seg.push({ a, b, l, at: total }); total += l; }
    const at = (d) => { const s = seg.find((q) => d <= q.at + q.l) || seg[seg.length - 1], t = Math.min(1, (d - s.at) / s.l); return s.a.map((v, k) => v + (s.b[k] - v) * t); };
    const st = { frames: [], marks: [], done: false, total };
    const t0 = performance.now();
    let last = t0;
    S.view.stream.stats.worstMs = 0;
    function frame(now) {
        st.frames.push(now - last); last = now;
        const d = ((now - t0) / 1000) * speed;
        const eye = at(d), ahead = at(d + 120);
        S.shot(eye, [ahead[0], ahead[1], ahead[2] - 25], 0.5, 60);
        if (st.frames.length % 120 === 0) {
            const m = S.view.stream.memory();
            st.marks.push({ km: +(d / 1000).toFixed(2), geometryMB: m.mb, mid: m.mid, near: m.near, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null });
        }
        if (d < total) requestAnimationFrame(frame); else st.done = true;
    }
    requestAnimationFrame(frame);
    window.__fly = st;
    return true;
})()`;

try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await page.waitFor("!!window.skyfarm && !!window.__firstFrame", 30000);
    const load = await page.evaluate("({ firstFrame: Math.round(window.__firstFrame), domContentLoaded: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd), transferKB: Math.round(performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) / 1024), files: performance.getEntriesByType('resource').length })");
    console.log(`load: first frame at ${load.firstFrame} ms (DOM ready ${load.domContentLoaded} ms), ${load.files} files, ${load.transferKB} KB transferred`);
    await page.evaluate(fly);
    let st;
    for (;;) { await new Promise((r) => setTimeout(r, 2000)); st = await page.evaluate("JSON.stringify({ done: window.__fly.done })").then(JSON.parse); if (st.done) break; }
    const r = await page.evaluate(`(() => { const f = window.__fly.frames.slice(5).sort((a, b) => a - b), n = f.length, s = skyfarm.view.stream.stats;
        return { n, median: f[n >> 1], p99: f[Math.floor(n * 0.99)], worst: f[n - 1], over33: f.filter((x) => x > 33.4).length, buildWorst: s.worstMs, worstStep: s.worstStep, built: s.built, freed: s.freed, marks: window.__fly.marks, km: window.__fly.total / 1000 }; })()`);
    console.log(`flew ${r.km.toFixed(1)} km at ${speed} m/s: ${r.n} frames, median ${r.median.toFixed(1)} ms, 99th percentile ${r.p99.toFixed(1)} ms, worst ${r.worst.toFixed(1)} ms, ${r.over33} frames over 33 ms`);
    console.log(`streaming: longest build step in a frame ${r.buildWorst.toFixed(1)} ms (${JSON.stringify(r.worstStep)}); built mid ${r.built.mid}, near ${r.built.near}; freed mid ${r.freed.mid}, near ${r.freed.near}`);
    console.log("memory along the way (km: islands' geometry MB / mid tiers / near tiers / JS heap MB):");
    console.log("  " + r.marks.map((m) => `${m.km}: ${m.geometryMB}/${m.mid}/${m.near}/${m.heapMB}`).join("  "));
    if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
