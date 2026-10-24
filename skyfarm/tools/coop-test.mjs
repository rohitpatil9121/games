/**
 * SKYFARM: co-op in real browsers through the real server (server/server.mjs on a spare port, two pages of
 * headless Chrome on the GPU). The first page hosts its farm from the title screen's Play together; the
 * second joins with the code it shows. Then, through the pages' own buttons and key presses:
 *
 * - each page draws the other gardener
 * - the guest walks (W held down) and the host's page sees them move
 * - the host's page is handed a save into its autosave
 * - the host goes home: the guest's page is told, and is back on its own farm
 *
 *   node tools/coop-test.mjs          # writes artifacts/coop-host.jpg and artifacts/coop-guest.jpg
 */
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const port = 9200 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [fileURLToPath(new URL("../server/server.mjs", import.meta.url)), String(port)], { stdio: "ignore", env: { ...process.env, QUIET: "1" } });
await new Promise((r) => setTimeout(r, 800));
const browser = await launch({ gpu: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** a background tab barely renders (headless throttles it): bring a page to the front before reading what it draws */
const front = async (page) => { await page.send("Page.bringToFront"); await wait(700); };
const key = (page, code, down) => page.evaluate(`window.dispatchEvent(new KeyboardEvent("${down ? "keydown" : "keyup"}", { code: "${code}", key: "w", bubbles: true })); true`);
try {
    const open = async () => { const p = await browser.page(`http://localhost:${port}/`, { width: 960, height: 540 }); await p.waitFor("!!window.skyfarm", 20000); await p.waitFor("!document.getElementById('open-coop').hidden", 8000).catch(() => {}); return p; };
    const host = await open(), guest = await open();
    check(await host.evaluate("!document.getElementById('open-coop').hidden"), "the title offers Play together when the page comes from the server");

    await host.evaluate("document.getElementById('open-coop').click(); document.getElementById('coop-name').value = 'Rohit'; document.getElementById('coop-host').click(); true");
    const code = await host.waitFor("skyfarm.client && skyfarm.client.joined && skyfarm.client.code", 10000);
    await guest.evaluate(`document.getElementById('open-coop').click(); document.getElementById('coop-name').value = 'Ana'; document.getElementById('coop-code').value = '${code}'; document.getElementById('coop-join').click(); true`);
    await guest.waitFor("skyfarm.client && skyfarm.client.joined", 10000);
    await wait(1500);
    await front(host); const seeHost = await host.evaluate("skyfarm.view.others.map((o) => o.name).join(',')");
    await front(guest); const seeGuest = await guest.evaluate("skyfarm.view.others.map((o) => o.name).join(',')");
    check(seeHost === "Ana" && seeGuest === "Rohit", `farm ${code}: the host's page draws Ana, the guest's draws Rohit`);

    // the guest walks out of the hut (W held for two seconds, the page focused as in play)
    await front(host); const before = await host.evaluate("JSON.stringify(skyfarm.view.others[0])").then(JSON.parse);
    await front(guest);
    await guest.evaluate("skyfarm.controls.active = true; skyfarm.controls.view.yaw = 0; true");
    await key(guest, "KeyW", true); await wait(2000); await key(guest, "KeyW", false); await wait(800);
    const mine = await guest.evaluate("JSON.stringify({ x: skyfarm.state.player.x, y: skyfarm.state.player.y })").then(JSON.parse);
    await front(host); const after = await host.evaluate("JSON.stringify(skyfarm.view.others[0])").then(JSON.parse);
    const moved = Math.hypot(after.x - before.x, after.y - before.y), agree = Math.hypot(after.x - mine.x, after.y - mine.y);
    check(moved > 1 && agree < 0.3, `Ana walks ${moved.toFixed(1)} m; the host's page has her within ${(agree * 100).toFixed(0)} cm of where her own page has her`);

    await wait(500);
    await writeFile(ROOT + "artifacts/coop-host.jpg", await host.screenshot("jpeg", 80));
    await front(guest); await writeFile(ROOT + "artifacts/coop-guest.jpg", await guest.screenshot("jpeg", 80));
    check(await host.evaluate("!!skyfarm.store.peek(0)"), "the host's page has been handed its farm to keep (the autosave)");
    const net = await guest.evaluate("JSON.stringify(skyfarm.client.stats)").then(JSON.parse);
    console.log(`  guest's link: ${(net.bytesIn / 1024).toFixed(0)} KB in, ${(net.bytesOut / 1024).toFixed(0)} KB out, ${net.worlds} worlds, ${net.corrections} corrections (largest ${(net.maxError * 100).toFixed(1)} cm)`);

    // the host goes home
    await host.evaluate("skyfarm.menu('pause'); document.getElementById('coop-leave').click(); true");
    await guest.waitFor("!skyfarm.client", 8000).catch(() => {});
    const told = await guest.evaluate("document.getElementById('pause-status').textContent");
    check(/gone home/.test(told) && (await guest.evaluate("skyfarm.state.players.length === 1 && !skyfarm.state.remote")), `the host leaves: the guest is told ("${told}") and is back on a farm of their own`);
    const errors = [...host.errors, ...guest.errors];
    check(errors.length === 0, "no console errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} finally {
    await browser.close();
    server.kill();
}
console.log(failed ? `${failed} failed` : "all passed");
setTimeout(() => process.exit(failed ? 1 : 0), 300);
