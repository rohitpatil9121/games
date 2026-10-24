/**
 * SKYFARM: the mix, measured (the `audio-design` skill: check loudness and headroom by number, not only by ear).
 * Starts the game's sound in headless Chrome, holds it in each situation (sound.override), lets the layers glide
 * in, then reads the master bus with an analyser: RMS and peak in dBFS. The mix should sit near -20 dB RMS in
 * play with the peaks under -3 dB (nothing clips), and the horn and thunder should stand above the bed.
 *
 *   node tools/sound-mix.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const SCENES = [
    ["title", { playing: false }],
    ["home, day", { playing: true, speed: 1, gliding: false, height: 61, near: 1, night: 0, storm: 0, raining: 0 }],
    ["gliding, 22 m/s", { playing: true, speed: 22, gliding: true, height: 120, near: 0.3, night: 0, storm: 0, raining: 0 }],
    ["gliding high, 30 m/s", { playing: true, speed: 30, gliding: true, height: 480, near: 0, night: 0, storm: 0, raining: 0 }],
    ["night", { playing: true, speed: 0, gliding: false, height: 61, near: 1, night: 1, storm: 0, raining: 0, restored: true }],
    ["rain", { playing: true, speed: 0, gliding: false, height: 61, near: 1, night: 0, storm: 0, raining: 1 }],
    ["storm", { playing: true, speed: 0, gliding: false, height: 61, near: 1, night: 0, storm: 1, raining: 1 }],
    ["storm + close thunder", { playing: true, storm: 1, raining: 1 }, "s.thunder(120)"],
    ["airship horn", { playing: true, storm: 0, raining: 0 }, "s.horn(60, -80, 90)"],
];

const port = 9100 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });
try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 640, height: 360 });
    await page.waitFor("!!window.skyfarm", 20000);
    await page.evaluate(`(async () => {
        const s = skyfarm.sound; await s.start();
        const an = s.audio.ctx.createAnalyser(); an.fftSize = 2048; s.out.connect(an);
        window.__meter = async (ms) => {
            const buf = new Float32Array(2048); let pk = 0, sum = 0, n = 0; const t0 = performance.now();
            while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) { pk = Math.max(pk, Math.abs(v)); sum += v * v; n++; } await new Promise((r) => setTimeout(r, 30)); }
            return [20 * Math.log10(Math.sqrt(sum / n) + 1e-9), 20 * Math.log10(pk + 1e-9)];
        };
        return true;
    })()`);
    console.log("scene                      RMS dB   peak dB");
    for (const [name, o, then] of SCENES) {
        const [rms, pk] = await page.evaluate(`(async () => {
            const s = skyfarm.sound; s.override = ${JSON.stringify(o)};
            await new Promise((r) => setTimeout(r, ${then ? 300 : 5000}));
            ${then || ""};
            return await __meter(${then ? 3500 : 3000});
        })()`);
        console.log(name.padEnd(26), rms.toFixed(1).padStart(6), pk.toFixed(1).padStart(9), pk > -3 ? "  CLIPPING RISK" : "");
    }
    if (page.errors.length) console.log("console errors:\n" + page.errors.join("\n"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
