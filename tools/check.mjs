/**
 * Open every game the way GitHub Pages serves it (tools/serve.mjs), start a round, and report console errors and
 * failed requests. Saves shots/<game>.jpg for the landing page's card, from the title screen or from play, whichever
 * shows the game better. Exits 1 if any game logged an error or a file it asked for was missing.
 *
 *   node tools/check.mjs                 # every game, and the landing page
 *   node tools/check.mjs orbital breach  # just these
 *   SITE=https://rohitpatil9121.github.io node tools/check.mjs   # the live site instead of a local server (no shots)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

// how to start a round from the title screen (a button to click), how long to let it play, and which screen the card shows
const GAMES = {
    "rewind-heist": { start: "[data-lvl]", play: 6, card: "play" },
    "neon-rush": { start: "#endlessCard", play: 6, card: "play" },
    "orbital": { start: "#playBtn", play: 6, card: "play" },
    "night-market": { start: "#newBtn", play: 6, card: "play" },
    "breach": { start: "#practice", play: 6, card: "title" },
    "tidefall": { start: "#practice", play: 6, card: "play" },
    "skyfarm": { start: "#start", play: 6, card: "play" },
    "decoy": { start: "#practice", play: 6, card: "title" },
    "paper-planes": { start: "#practice", play: 1.5, card: "play" },
};
// requests that are expected to fail on static hosting: the games ask whether their Node server is there
const EXPECTED = [/\/status$/, /\/ws$/, /\/favicon\.ico$/];

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(GAMES);
const port = 8400 + Math.floor(Math.random() * 400);
const SITE = process.env.SITE || `http://localhost:${port}`;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const server = process.env.SITE ? null : spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
await mkdir(new URL("../shots/", import.meta.url), { recursive: true });
const browser = await launch({ gpu: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

async function open(path) {
    const page = await browser.page(`${SITE}/games/tools/blank.html`);
    const missing = [];
    page.on("Network.responseReceived", (p) => { if (p.response.status >= 400 && !EXPECTED.some((re) => re.test(p.response.url))) missing.push(`${p.response.status} ${p.response.url}`); });
    page.on("Network.loadingFailed", (p) => { if (!p.canceled && !/ERR_ABORTED/.test(p.errorText)) missing.push(`${p.errorText} ${p.requestId}`); });
    await page.send("Network.enable");
    const loaded = new Promise((r) => page.on("Page.loadEventFired", r));
    await page.send("Page.navigate", { url: `${SITE}/games/${path}` });
    await Promise.race([loaded, sleep(30000)]);
    return { page, missing };
}

const report = (name, page, missing, note) => {
    const problems = [...page.errors.map((e) => "error: " + e.split("\n")[0]), ...missing.map((m) => "missing: " + m)];
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name.padEnd(13)} ${note}`);
    for (const p of problems) console.log("       " + p);
    if (problems.length) failed++;
};

try {
    for (const name of names) {
        const { page, missing } = await open(name + "/");
        await sleep(4000);
        if (GAMES[name].card === "title") if (!process.env.SITE) await writeFile(`${ROOT}shots/${name}.jpg`, await page.screenshot("jpeg", 75));
        const clicked = await page.evaluate(`(() => { for (const s of ${JSON.stringify(GAMES[name].start)}.split(",")) { const b = [...document.querySelectorAll(s.trim())].find((e) => e.offsetParent !== null); if (b) { b.click(); return s.trim(); } } return ""; })()`);
        await sleep(GAMES[name].play * 1000);
        if (GAMES[name].card === "play") if (!process.env.SITE) await writeFile(`${ROOT}shots/${name}.jpg`, await page.screenshot("jpeg", 75));
        await sleep(Math.max(0, 6 - GAMES[name].play) * 1000);
        const canvas = await page.evaluate(`(() => { const c = document.querySelector("canvas"); return c ? c.width + "x" + c.height : "no canvas"; })()`);
        report(name, page, missing, `started with ${clicked || "(nothing clicked)"}, canvas ${canvas}`);
        await page.close();
    }
    if (!only.length) {
        const { page, missing } = await open("");
        await sleep(1500);
        const cards = await page.evaluate(`[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))`);
        const broken = names.filter((n) => !cards.includes(n + "/"));
        if (broken.length) page.errors.push("landing page has no link to " + broken.join(", "));
        if (!process.env.SITE) await writeFile(`${ROOT}shots/landing.jpg`, await page.screenshot("jpeg", 85));
        report("landing page", page, missing, `${cards.length} links`);
        await page.close();
    }
} finally {
    await browser.close();
    server?.kill();
}
console.log(failed ? `${failed} with problems` : "all clean");
setTimeout(() => process.exit(failed ? 1 : 0), 300);
