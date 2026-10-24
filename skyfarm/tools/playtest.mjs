/**
 * SKYFARM: a playtest through real input (the `threejs-qa-release` skill: exercise the main input and the
 * objective, not just screenshots). Headless Chrome on the real GPU, in real time: the page is driven only by
 * pressing and releasing keys through the engine's Input and turning the view, steering from what a player can
 * see (the prompt on screen and where things are). It plays the first loop:
 *
 *   pick up the seed in the hut, plant it, water it, take the glider from the shed, run off the east cliff,
 *   open the glider in the air, steer to Daisy Step, land, pick up the rope-grass seeds
 *
 *   node tools/playtest.mjs            # about a minute
 *
 * Prints what happened, with times, and the frame rate; exits with 1 if a step never happened.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const port = 9400 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const player = `(() => {
    const S = window.skyfarm, input = S.game.input, view = S.controls.view, log = [];
    document.getElementById("start").click();
    const t0 = performance.now(), now = () => ((performance.now() - t0) / 1000).toFixed(1) + " s";
    const goals = [
        { name: "seed", at: [-5.4, -3.2], face: [-4.6, -3.4], want: "pick" },
        { name: "inside", at: [-4.2, -2] },
        { name: "door", at: [-2.2, -2] },
        { name: "field", at: [3.2, -2.5], face: [5, -2.5], want: "plant" },
        { name: "water", at: [3.2, -2.5], face: [5, -2.5], want: "water" },
        { name: "shed", at: [3, 8], face: [4, 9], want: "pick" },
        { name: "cliff", at: [40, 8], glide: [146, 33] },
        { name: "stones", at: [151.2, 36.8], face: [152, 37], want: "pick" },
    ];
    let g = 0, frames = 0, last = performance.now(), worst = 0;
    const st = { log, done: false, fps: 0, worst: 0 };
    const keys = (on) => { for (const k of ["KeyW", "KeyA", "KeyD", "KeyS", "Space", "KeyE", "ShiftLeft"]) if (!on.includes(k)) input.release(k); for (const k of on) input.press(k); };
    S.game.onRender(() => { frames++; const t = performance.now(); worst = Math.max(worst, t - last); last = t; });
    S.game.onUpdate(() => { for (const e of S.state.events) if (["pick", "plant", "water", "open", "land", "fell", "bump"].includes(e.type)) log.push(now() + " " + e.type + (e.kind ? " " + e.kind : "") + (e.crop ? " " + e.crop : "")); });
    let tick = 0;
    const timer = setInterval(() => {
        tick++;
        const p = S.state.player, goal = goals[g];
        if (!goal) { keys([]); st.done = true; clearInterval(timer); return; }
        if (goal.from === undefined) goal.from = log.length;
        const dx = goal.at[0] - p.x, dy = goal.at[1] - p.y, d = Math.hypot(dx, dy);
        if (p.mode === "glide") {
            // steer: bank toward the target, as a person would with A and D
            let err = Math.atan2(goal.glide[1] - p.y, goal.glide[0] - p.x) - p.yaw;
            err -= Math.PI * 2 * Math.round(err / (Math.PI * 2));
            keys(err > 0.08 ? ["KeyA"] : err < -0.08 ? ["KeyD"] : []);
            return;
        }
        if (goal.glide && d < 3) { log.push(now() + " missed the edge"); }
        if (goal.glide && !p.ground) { keys(["KeyW", tick % 2 ? "Space" : ""].filter(Boolean)); return; }
        if (goal.glide && p.ground && p.x > 100) { log.push(now() + " landed on Daisy Step"); g++; return; }
        if (d > (goal.want ? 0.35 : 0.6) || goal.glide) {
            view.yaw = Math.atan2(dy, dx); view.pitch = -0.25;
            keys(goal.glide ? ["KeyW", "ShiftLeft"] : ["KeyW"]);
            return;
        }
        if (!goal.want) { g++; return; }
        view.yaw = Math.atan2(goal.face[1] - p.y, goal.face[0] - p.x);
        const prompt = document.getElementById("prompt").textContent;
        const word = { pick: "Pick up", plant: "Plant", water: "Water" }[goal.want];
        if (log.slice(goal.from).some((l) => l.includes(" " + goal.want))) { keys([]); g++; }
        else keys(prompt.includes(word) && tick % 2 ? ["KeyE"] : []);
    }, 50);
    setInterval(() => { st.fps = frames; frames = 0; st.worst = worst; worst = 0; }, 1000);
    window.__play = st;
    return true;
})()`;

let failed = false;
try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await page.waitFor("!!window.skyfarm", 20000);
    await page.evaluate(player);
    const end = Date.now() + 120000;
    let st;
    while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 1000));
        st = await page.evaluate("JSON.stringify(window.__play)").then(JSON.parse);
        if (st.done) break;
    }
    for (const line of st.log.filter((l) => !l.startsWith("#"))) console.log("  " + line);
    console.log(`  frame rate in headless Chrome: ${st.fps} fps (worst frame ${st.worst.toFixed(0)} ms in the last second)`);
    const s = await page.evaluate("JSON.stringify({ seeds: skyfarm.state.pouch.seeds, glider: skyfarm.state.player.hasGlider, plots: [...skyfarm.state.plots.values()].filter((p) => p.crop).length })").then(JSON.parse);
    const ok = st.done && s.seeds.ropegrass === 3 && s.glider && s.plots === 1;
    console.log(ok ? "  ok   the first loop works through real input" : "  FAIL the first loop did not finish: " + JSON.stringify(s));
    if (page.errors.length) { console.log("console errors:\n" + page.errors.join("\n")); failed = true; }
    failed ||= !ok;
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(failed ? 1 : 0), 300);
