/**
 * SKYFARM: the fixed-view visual baselines (the `threejs-visual-validation` skill: frozen inputs, fixed
 * cameras, the same captures after every visual change, compared by number rather than by eye alone).
 *
 *   node tools/views.mjs                 # capture every view at every time; compare with the locked baselines
 *   node tools/views.mjs --lock          # capture and make these the baselines
 *   node tools/views.mjs --nopost        # the same views with the post chain off (the no-post baseline)
 *   node tools/views.mjs --only=grass    # views whose name contains "grass"
 *   node tools/views.mjs --tour          # one look at every island's landmark (afternoon), no baselines
 *
 * Baselines are kept at 640 x 360 (small enough for git) and compared at that size.
 * Writes artifacts/views/<view>-<time>.png, a contact sheet artifacts/views/sheet.jpg (one image with all of
 * them, labelled), and prints per view: the canvas metrics (entropy, edges, contrast, dominant colour) and,
 * against artifacts/baselines/, the mean colour difference and the share of pixels that changed visibly.
 * The game's clock is frozen per capture (the same tick), so wind and clouds are where they were last time.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const args = process.argv.slice(2), lock = args.includes("--lock"), nopost = args.includes("--nopost");
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = ROOT + "artifacts/views/", BASE = ROOT + "artifacts/baselines/";
await mkdir(OUT, { recursive: true }); await mkdir(BASE, { recursive: true });

/** The six views of GDD §0. Heights are relative to Hearth Isle's top (60). */
export const VIEWS = [
    { name: "1-hut-door", eye: [-1.2, -2.4, 61.75], target: [8, 0.5, 60.6], fov: 60 },
    { name: "2-home-wide", eye: [70, -78, 82], target: [0, 0, 52], fov: 45 },
    { name: "3-glide-toward", eye: [34, 6, 64], target: [150, 34, 46], fov: 62 },
    { name: "4-grass-close", eye: [8.5, -14.5, 61.3], target: [14, -11, 60.2], fov: 55 },
    { name: "5-waterfall", eye: [112, -246, 86], target: [157.6, -200.3, 56], fov: 55 },
    { name: "6-high-rocks-below", eye: [1450, -270, 420], target: [1560, -110, 515], fov: 55 },
];
const tour = args.includes("--tour");
// rain: the middle of the first rainy day's rain, as wet as it gets (GDD §0: each view at noon, golden hour, in rain)
const TIMES = tour ? [["afternoon", 0.55]] : [["noon", 0.35], ["golden", 0.735], ["rain", "rain"]];
if (tour) {
    const { ISLANDS } = await import("../game/world-data.js");
    VIEWS.length = 0;
    for (const i of ISLANDS) {
        const L = i.landmark, r = i.radius;
        VIEWS.push({ name: "tour-" + i.id, eye: [L.x + r * 0.9, L.y - r * 1.1, i.top + r * 0.45 + 4], target: [L.x, L.y, i.top + 4], fov: 55 });
    }
}

const port = 9700 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const capture = (v, t) => `(async () => {
    const S = skyfarm, g = S.game;
    if (${JSON.stringify(t)} === "rain") { S.weather("rain"); S.shot(${JSON.stringify(v.eye)}, ${JSON.stringify(v.target)}, undefined, ${v.fov}); }
    else { S.weather("dry"); S.state.tick = ${JSON.stringify(t)} * 72000; S.shot(${JSON.stringify(v.eye)}, ${JSON.stringify(v.target)}, ${JSON.stringify(t)}, ${v.fov}); }
    S.state.player.x = 6; S.state.player.y = 9.5; S.state.player.z = 60; // out of the way, by the shed
    S.post.enabled = ${!nopost}; S.view.snapExposure = true;
    const tick = S.state.tick;
    S.view.stream.settle(${JSON.stringify(v.eye)});
    S.run(0.4);
    S.state.tick = tick;
    const L = g.loop; L._raf = () => 0;
    g._render(1, 1 / 60);
    const canvas = document.getElementById("view");
    const url = canvas.toDataURL("image/png");
    // metrics on a 160 x 90 grid, the same as tools/inspect.mjs
    const c2 = document.createElement("canvas"); c2.width = canvas.width; c2.height = canvas.height;
    const x = c2.getContext("2d"); x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c2.width, c2.height).data, W = c2.width, H = c2.height;
    const sx = Math.floor(W / 160), sy = Math.floor(H / 90), lum = [], buckets = new Map(); let n = 0;
    for (let gy = 0; gy < 90; gy++) for (let gx = 0; gx < 160; gx++) {
        const o = ((gy * sy) * W + gx * sx) * 4, r = d[o], gg = d[o + 1], b = d[o + 2];
        lum.push(0.2126 * r + 0.7152 * gg + 0.0722 * b);
        const k = (r >> 4) + "," + (gg >> 4) + "," + (b >> 4); buckets.set(k, (buckets.get(k) || 0) + 1); n++;
    }
    const s = lum.slice().sort((a, b) => a - b);
    let ent = 0, dom = 0; for (const c of buckets.values()) { const p = c / n; ent -= p * Math.log2(p); dom = Math.max(dom, c); }
    let edges = 0; for (let gy = 0; gy < 89; gy++) for (let gx = 0; gx < 159; gx++) { const i = gy * 160 + gx; if (Math.max(Math.abs(lum[i] - lum[i + 1]), Math.abs(lum[i] - lum[i + 160])) > 12) edges++; }
    // the small copy: what a baseline is, and what it is compared at
    const small = document.createElement("canvas"); small.width = 640; small.height = 360;
    const sx2 = small.getContext("2d"); sx2.drawImage(canvas, 0, 0, 640, 360);
    const smallUrl = small.toDataURL("image/png"), ds = sx2.getImageData(0, 0, 640, 360).data;
    // against the baseline, if there is one
    let diff = null;
    try {
        const img = new Image(); img.src = "/artifacts/baselines/${v.name}-" + ${JSON.stringify(t)}.toString().replace(".", "_") + ".png?" + Math.random();
        await img.decode();
        const c3 = document.createElement("canvas"); c3.width = 640; c3.height = 360;
        const y = c3.getContext("2d"); y.drawImage(img, 0, 0, 640, 360);
        const e = y.getImageData(0, 0, 640, 360).data;
        let sum = 0, changed = 0, m = 0;
        for (let i = 0; i < ds.length; i += 4) { const dd = (Math.abs(ds[i] - e[i]) + Math.abs(ds[i + 1] - e[i + 1]) + Math.abs(ds[i + 2] - e[i + 2])) / 3; sum += dd; if (dd > 24) changed++; m++; }
        diff = { mean: +(sum / m).toFixed(2), changed: +(changed / m).toFixed(4) };
    } catch { diff = null; }
    const st = g.renderer.stats;
    return { url, smallUrl, metrics: { entropy: +ent.toFixed(2), edges: +(edges / (89 * 159)).toFixed(3), contrast: +(s[Math.floor(n * 0.95)] - s[Math.floor(n * 0.05)]).toFixed(1), dominant: +(dom / n).toFixed(3) }, diff, draws: st.drawCalls, tris: st.triangles };
})()`;

const results = [];
try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await page.waitFor("!!window.skyfarm", 20000);
    await page.evaluate("document.getElementById('start').click(); document.getElementById('hud').style.display = 'none'; skyfarm.run(0.2); true");
    for (const v of VIEWS) {
        if (only && !v.name.includes(only)) continue;
        for (const [label, t] of TIMES) {
            const r = await page.evaluate(capture(v, t));
            const file = `${v.name}-${label}${nopost ? "-nopost" : ""}.png`;
            const png = Buffer.from(r.url.split(",")[1], "base64");
            await writeFile(OUT + file, png);
            if (lock && !nopost && !tour) await writeFile(BASE + `${v.name}-${String(t).replace(".", "_")}.png`, Buffer.from(r.smallUrl.split(",")[1], "base64"));
            results.push({ file, ...r, url: undefined, smallUrl: undefined });
            console.log(`${file.padEnd(28)} entropy ${r.metrics.entropy} edges ${r.metrics.edges} contrast ${r.metrics.contrast} dominant ${r.metrics.dominant} draws ${r.draws} tris ${r.tris}` + (r.diff ? `  vs baseline: mean ${r.diff.mean}, changed ${(r.diff.changed * 100).toFixed(1)}%` : "  (no baseline)"));
        }
    }
    // a contact sheet: everything in one labelled image
    const sheet = await page.evaluate(`(async () => {
        const files = ${JSON.stringify(results.map((r) => r.file))};
        const cols = files.length > 12 ? 5 : 3, w = files.length > 12 ? 384 : 480, h = files.length > 12 ? 216 : 270, rows = Math.ceil(files.length / cols);
        const c = document.createElement("canvas"); c.width = cols * w; c.height = rows * h;
        const x = c.getContext("2d"); x.font = "bold 16px sans-serif";
        for (let i = 0; i < files.length; i++) {
            const img = new Image(); img.src = "/artifacts/views/" + files[i] + "?" + Math.random(); await img.decode();
            const px = (i % cols) * w, py = Math.floor(i / cols) * h;
            x.drawImage(img, px, py, w, h);
            x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(px, py, w, 24); x.fillStyle = "#fff"; x.fillText(files[i].replace(".png", ""), px + 8, py + 17);
        }
        return c.toDataURL("image/jpeg", 0.85);
    })()`);
    await writeFile(OUT + (nopost ? "sheet-nopost.jpg" : "sheet.jpg"), Buffer.from(sheet.split(",")[1], "base64"));
    await writeFile(OUT + "views.json", JSON.stringify(results, null, 2));
    console.log("sheet: artifacts/views/" + (nopost ? "sheet-nopost.jpg" : "sheet.jpg") + (page.errors.length ? "\nconsole errors:\n" + page.errors.join("\n") : ""));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
