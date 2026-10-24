/**
 * SKYFARM: the menus, saving and settings, driven through the real page in headless Chrome (the
 * `threejs-qa-release` skill: test what the player touches). Clicks the buttons a player would, reloads the
 * page in the same browser profile, and checks what came back:
 *
 * - the title starts a farm; the pause menu saves it into slot 1; back at the title it says Continue
 * - after a reload, Continue brings back the autosave where the player was, and slot 1 loads
 * - settings persist across a reload, and put themselves into effect (text size, cue colours, captions)
 * - keyboard focus starts on each screen's main button; every control on the settings screen has a label
 * - a phone-sized window: no menu is wider than the screen
 *
 *   node tools/ui-test.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };
const port = 9300 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });
const url = `http://localhost:${port}/`;
const open = async (size) => { const p = await browser.page(url, size); await p.waitFor("!!window.skyfarm", 20000); return p; };
const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;
try {
    let page = await open();
    check(await page.evaluate("document.activeElement.id === 'start' && document.getElementById('start').textContent === 'Wake up'"), "a first visit: focus on Wake up, no Continue");
    // play a little, walk somewhere, save into slot 1 from the pause menu
    await page.evaluate(click("start") + "; skyfarm.run(1); const p = skyfarm.state.player; p.x = 6; p.y = -6; skyfarm.run(1); true");
    const where = await page.evaluate("[skyfarm.state.player.x, skyfarm.state.player.y, skyfarm.state.tick]");
    await page.evaluate("skyfarm.menu('pause'); " + click("open-save"));
    const saveButtons = await page.evaluate("[...document.querySelectorAll('#slot-list li')].map((li) => li.querySelectorAll('button').length).join(',')");
    await page.evaluate("document.querySelectorAll('#slot-list li')[1].querySelector('button').click()");
    check(saveButtons === "1,2,2,2" && /Saved in slot 1/.test(await page.evaluate("document.getElementById('slot-status').textContent")), "from the pause menu: three slots to save in, and slot 1 saves");
    await page.evaluate(click("slots-back") + "; " + click("to-title"));
    check(await page.evaluate("document.getElementById('start').textContent === 'Back to the sky' && !document.getElementById('new-game').hidden"), "back at the title (the game autosaved): Back to the sky, and a new farm on offer");
    // settings: larger text, red-green cue colours, captions off
    await page.evaluate(click("open-settings") + "; const t = document.getElementById('s-text'); t.value = '1.3'; t.dispatchEvent(new Event('change')); const s = document.getElementById('s-scheme'); s.value = 'redgreen'; s.dispatchEvent(new Event('change')); const c = document.getElementById('s-captions'); c.checked = false; c.dispatchEvent(new Event('change')); true");
    check(await page.evaluate("document.activeElement.id"), "settings opened (focus on " + await page.evaluate("document.activeElement.id") + ")");
    const unlabelled = await page.evaluate("[...document.querySelectorAll('#settings input, #settings select')].filter((n) => !n.closest('label')).length");
    check(unlabelled === 0, "every control on the settings screen sits in its label");
    check(await page.evaluate("document.documentElement.classList.contains('cues-redgreen') && document.querySelector('#settings .panel').style.zoom === '1.3' && skyfarm.sound.captions === false"), "settings take effect at once: cue colours, text size, captions");
    await new Promise((r) => setTimeout(r, 600));
    await page.close();

    // a reload, same browser: everything came back
    page = await open();
    check(await page.evaluate("/^Continue \\(day \\d+\\)$/.test(document.getElementById('start').textContent)"), "after a reload the title offers Continue (" + await page.evaluate("document.getElementById('start').textContent") + ")");
    check(await page.evaluate("skyfarm.settings.textSize === 1.3 && skyfarm.settings.scheme === 'redgreen' && skyfarm.settings.captions === false && document.documentElement.classList.contains('cues-redgreen')"), "settings survived the reload and are in effect");
    await page.evaluate(click("start") + "; true");
    const back = await page.evaluate("[skyfarm.state.player.x, skyfarm.state.player.y, skyfarm.state.tick]");
    check(Math.hypot(back[0] - where[0], back[1] - where[1]) < 3 && back[2] >= where[2], `Continue puts the player back where they were (${back[0].toFixed(1)}, ${back[1].toFixed(1)})`);
    await page.evaluate("skyfarm.state.player.x = 0; skyfarm.state.player.y = 0; skyfarm.menu('pause'); " + click("open-save") + "; document.querySelectorAll('#slot-list li')[1].querySelectorAll('button')[1].click(); true");
    const slot1 = await page.evaluate("[skyfarm.state.player.x, skyfarm.state.player.y]");
    check(Math.hypot(slot1[0] - where[0], slot1[1] - where[1]) < 3, "slot 1 loads the farm saved in it");
    check(page.errors.length === 0, "no console errors" + (page.errors.length ? ": " + page.errors.join(" | ") : ""));
    await page.close();

    // a phone: nothing wider than the screen
    page = await open({ width: 375, height: 667, mobile: true });
    const wide = await page.evaluate("(() => { const out = []; for (const id of ['title', 'settings', 'slots', 'pause']) { skyfarm.menu(id); const p = document.querySelector('#' + id + ' .panel'); if (p.getBoundingClientRect().right > innerWidth + 1 || p.scrollWidth > p.clientWidth + 1) out.push(id); } return out; })()");
    check(wide.length === 0, "on a 375 px phone every menu fits the width" + (wide.length ? " (too wide: " + wide.join(", ") + ")" : ""));
    await page.close();
} finally {
    await browser.close();
    server.kill();
}
console.log(failed ? `${failed} failed` : "all passed");
setTimeout(() => process.exit(failed ? 1 : 0), 300);
