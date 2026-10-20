/**
 * A playtest through real input (the `threejs-qa-release` skill: exercise the main input, the objective,
 * failure and retry, not just screenshots). Headless Chrome on the real GPU, real time, no shortcuts:
 * the page is driven only by pressing and releasing keys through the engine's Input and turning the view,
 * from what the client knows (what a player can see). It plays one Practice match on two teams:
 *
 *   1. walk down to the nearest loot as the sea goes out, pick it up (E), carry it home, bank it
 *   2. go out again, grab the heaviest thing in reach, and stay out in the flood with it on purpose:
 *      the sea should take it (or drown the player), who then comes back at camp
 *
 *   node tools/playtest.mjs            # about three minutes
 *
 * Prints what happened, with times, and the final checks; exits with 1 if a step never happened.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const port = 9100 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });

const pilot = `(() => {
    const T = window.tidefall, c = T.client, input = T.input, log = [];
    const t0 = performance.now(), now = () => ((performance.now() - t0) / 1000).toFixed(1) + " s";
    T.save.practice = { teams: 2, bots: 1, skill: 1 };
    T.save.tutorial = { seen: [], done: false };
    T.startPractice();
    c.on("event", (e) => { if (e.id === c.id && ["pick", "bank", "drop", "drown", "spawn", "nopick"].includes(e.type)) log.push(now() + " " + e.type + (e.why ? " (" + e.why + ")" : "") + (e.value ? " " + e.value : "")); });
    const st = { phase: "out", greedy: false, done: false, tips: [] };
    const tipEl = document.getElementById("tip");
    new MutationObserver(() => { if (tipEl.textContent && !st.tips.includes(tipEl.textContent.slice(0, 28))) st.tips.push(tipEl.textContent.slice(0, 28)); }).observe(tipEl, { childList: true, characterData: true, subtree: true });
    let press = 0;
    const timer = setInterval(() => {
        if (!c.island || !c.joined) return;
        const me = c.me, camp = c.island.camps[me.team];
        let tx = camp.x, ty = camp.y;
        const banked = c.players.get(c.id)?.banked || 0;
        if (st.phase === "out" && me.carry.length && (!st.greedy || me.weight > 4)) st.phase = st.greedy ? "wait" : "home";
        if (st.phase === "home" && banked > 0) { st.phase = "out"; st.greedy = true; log.push(now() + " going out again, greedy this time"); }
        if (st.phase === "out") {
            let best = null, bd = 1e9;
            for (const l of c.loot.values()) {
                if (l.holder) continue;
                const d = Math.hypot(l.x - me.x, l.y - me.y), score = st.greedy ? d - l.kind * 25 : d;
                if (score < bd && (st.greedy || l.z > c.level(c.clock) - 1.5)) { bd = score; best = l; }
            }
            if (best) { tx = best.x; ty = best.y; }
        }
        // in "wait" the greedy player walks out to deep water and stands its ground there until something happens
        if (st.phase === "wait") { const out = Math.atan2(me.y - camp.y, me.x - camp.x); tx = me.x + Math.cos(out) * 10; ty = me.y + Math.sin(out) * 10; }
        const deep = c.island && (function () { let h = 0; const i = c.island, n = i.n, fx = (me.x + i.half) / i.cell, fy = (me.y + i.half) / i.cell, k = Math.floor(fy) * n + Math.floor(fx); return i.heights[k]; })();
        const d = Math.hypot(tx - me.x, ty - me.y), go = st.phase === "wait" ? deep > -3.5 : d > 0.8;
        T.view.yaw = Math.atan2(ty - me.y, tx - me.x);
        T.view.pitch = -0.25;
        if (go) input.press("KeyW"); else input.release("KeyW");
        if (me.water === 0 && go) input.press("ShiftLeft"); else input.release("ShiftLeft");
        // E when the prompt offers something; space now and then (ledges, swimming)
        const prompt = document.getElementById("prompt").textContent;
        if (/pick up/.test(prompt) && st.phase === "out" && press++ % 2 === 0) { input.press("KeyE"); setTimeout(() => input.release("KeyE"), 60); }
        if (go && me.water === 2 && press % 7 === 0) { input.press("Space"); setTimeout(() => input.release("Space"), 60); }
        if (st.phase === "wait" && (!me.carry.length || !me.alive)) { st.done = true; input.release("KeyW"); }
    }, 100);
    window.__pilot = { log, st, stop: () => clearInterval(timer) };
    return "flying";
})()`;

let failed = 0;
try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await page.waitFor("!!window.tidefall", 15000);
    console.log(await page.evaluate(pilot));
    const start = Date.now();
    let state = null;
    while (Date.now() - start < 200000) {
        await new Promise((r) => setTimeout(r, 5000));
        state = await page.evaluate("({ log: __pilot.log, phase: __pilot.st.phase, done: __pilot.st.done, tips: __pilot.st.tips, tide: tidefall.client.clock, banked: tidefall.client.players.get(tidefall.client.id)?.banked || 0, alive: tidefall.client.me.alive })");
        if (state.done) break;
    }
    await page.evaluate("__pilot.stop()");
    await new Promise((r) => setTimeout(r, 6500));
    const end = await page.evaluate("({ log: __pilot.log, alive: tidefall.client.me.alive, x: tidefall.client.me.x, y: tidefall.client.me.y, camp: tidefall.client.island.camps[tidefall.client.me.team] })");
    console.log(end.log.join("\n"));
    console.log("tips shown: " + state.tips.join(" | "));
    const has = (re) => end.log.some((l) => re.test(l));
    const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`); };
    check("picked something up with the key", has(/ pick/));
    check("banked it at camp", has(/ bank/));
    check("the flood took the heavy loot, or drowned the player", has(/drop \(gasp\)|drown/));
    check("back at camp afterwards", Math.hypot(end.x - end.camp.x, end.y - end.camp.y) < 8 || has(/spawn/) || end.alive);
    check("first-match tips appeared", state.tips.length >= 2);
    if (page.errors.length) { failed++; console.log("console errors:\n" + page.errors.join("\n")); }
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(failed ? 1 : 0), 300);
