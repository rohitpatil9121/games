/**
 * SKYFARM: open the game in headless Chrome for a few seconds and print any console errors (for when the page
 * fails before the console hook exists, so tools/look.mjs can only time out).
 *
 *   node tools/errors.mjs [seconds] [folder]    # folder: serve another copy, e.g. dist/skyfarm-web (the itch build)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch } from "./chrome.mjs";

const wait = Number(process.argv[2] || 6);
const port = 9600 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port), ...(process.argv[3] ? [process.argv[3]] : [])], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await launch({ gpu: true });
try {
    const page = await browser.page(`http://localhost:${port}/`, { width: 1280, height: 720 });
    await new Promise((r) => setTimeout(r, wait * 1000));
    console.log(page.errors.length ? page.errors.join("\n") : "no console errors");
    console.log("hook:", await page.evaluate("!!window.skyfarm"));
} finally {
    await browser.close();
    server.kill();
}
setTimeout(() => process.exit(0), 300);
