/**
 * Serve this repository the way GitHub Pages does: under /games/, with no server behind it (no WebSocket, no /status).
 * Paths are case-sensitive and a folder without its trailing slash redirects, as on Pages.
 *
 *   node tools/serve.mjs          # http://localhost:8140/games/
 *   node tools/serve.mjs 9000     # another port
 */
import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8140);
const BASE = "/games/";
const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff",
    ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
    ".glsl": "text/plain; charset=utf-8", ".frag": "text/plain; charset=utf-8", ".vert": "text/plain; charset=utf-8",
};

// Windows file names ignore case, Pages does not: check every part of the path against the real directory listing
async function exactCase(file) {
    for (let f = file; f !== ROOT; f = dirname(f)) if (!(await readdir(dirname(f))).includes(basename(f))) return false;
    return true;
}

createServer(async (req, res) => {
    const notFound = () => res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/" || url.pathname === "/games") { res.writeHead(301, { Location: BASE }).end(); return; }
        if (!url.pathname.startsWith(BASE)) return notFound();
        let path = decodeURIComponent(url.pathname.slice(BASE.length - 1));
        let file = normalize(join(ROOT, path));
        if (file !== ROOT && !file.startsWith(ROOT + sep)) return notFound();
        if (/[\\/]\.git([\\/]|$)/.test(file)) return notFound();
        let info = await stat(file);
        if (info.isDirectory()) {
            if (!path.endsWith("/")) { res.writeHead(301, { Location: url.pathname + "/" + url.search }).end(); return; }
            file = join(file, "index.html");
            info = await stat(file);
        }
        if (!info.isFile() || !(await exactCase(file))) return notFound();
        res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(await readFile(file));
    } catch {
        notFound();
    }
}).listen(PORT, () => console.log(`Games running at http://localhost:${PORT}${BASE}`));
