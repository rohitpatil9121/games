/**
 * SKYFARM: an itch.io build (the `itch-publish` skill: an HTML5 zip with index.html at its root, relative paths
 * only, no build step needed). Copies only what the page loads into dist/skyfarm-web, zips it as
 * dist/skyfarm-itch.zip, and reports files and sizes. Nothing is uploaded: publishing is the author's to do.
 *
 *   node tools/build-itch.mjs
 */
import { cp, rm, mkdir, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "dist", "skyfarm-web"), ZIP = join(ROOT, "dist", "skyfarm-itch.zip");
// what the page loads (index.html, the game, the engine and its shaders, vendored code and fonts, sounds) and the licences
const PARTS = ["index.html", "style.css", "game", "engine", "shaders", "vendor", "assets", "THIRD_PARTY.md"];

await rm(OUT, { recursive: true, force: true });
await rm(ZIP, { force: true });
await mkdir(OUT, { recursive: true });
for (const p of PARTS) await cp(join(ROOT, p), join(OUT, p), { recursive: true, filter: (src) => !/[\\/]\.|\.map$|README\.md$/.test(src.slice(ROOT.length)) });

let files = 0, bytes = 0;
const walk = async (dir) => { for (const e of await readdir(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) await walk(f); else { files++; bytes += (await stat(f)).size; } } };
await walk(OUT);

// zip with what the system has: bsdtar (Windows 10+, macOS) makes a zip with -a; else PowerShell, else Info-ZIP
const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
let z = spawnSync(tar, ["-a", "-c", "-f", ZIP, "-C", OUT, "."], { stdio: "pipe" });
if (z.status !== 0 && process.platform === "win32") z = spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${join(OUT, "*")}' -DestinationPath '${ZIP}'`], { stdio: "pipe" });
if (z.status !== 0) z = spawnSync("zip", ["-r", "-q", ZIP, "."], { cwd: OUT, stdio: "pipe" });
const zipped = z.status === 0 ? (await stat(ZIP)).size : 0;
console.log(`dist/skyfarm-web: ${files} files, ${(bytes / 1024).toFixed(0)} KB`);
console.log(zipped ? `dist/skyfarm-itch.zip: ${(zipped / 1024).toFixed(0)} KB (index.html at the root; not uploaded)` : "couldn't zip: no tar or zip on this system (the folder is ready to zip by hand)");
