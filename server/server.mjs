/**
 * SKYFARM server: the game's files and its co-op farms, one process, one port (after TIDEFALL's server.mjs).
 *
 *   npm start                          # http://localhost:8160
 *   PORT=9000 node server/server.mjs   # another port (hosts such as Render set PORT themselves)
 *
 * It serves the game folder as static files (so the page and the socket share an origin), accepts WebSockets
 * on /ws (a hello either hosts a farm, carrying the host's save, or joins one by its four-letter code), and
 * ticks every room 60 times a second. GET /status says whether there is a server (the page hides co-op if
 * not). Messages are compressed (per-message deflate): a farm's JSON shrinks to a fraction.
 *
 * Nothing a client sends is trusted (room.mjs, game/protocol.js); oversized frames are dropped by `ws`, a
 * socket must say hello within a few seconds, one address can hold only so many connections.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Room } from "./room.mjs";
import { decode, encode, cleanText, PROTOCOL, NAME_MAX, MAX_PLAYERS } from "../game/protocol.js";
import { TICK_RATE } from "../game/data.js";
import { makeWorld, WORLD } from "../game/islands.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8160);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 40);
const MAX_PER_ADDRESS = Number(process.env.MAX_PER_ADDRESS || 8);
const HELLO_TIMEOUT = 8000;
const QUIET = process.env.QUIET === "1";
const log = (line) => { if (!QUIET) console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`); };

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};
/** never served, whatever is asked for */
const PRIVATE = /(^|[\\/])(\.|node_modules([\\/]|$)|package-lock\.json$|server([\\/]|$))/;

const http = createServer(async (req, res) => {
    try {
        let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        if (path === "/status") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
            res.end(JSON.stringify(status()));
            return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
        if (path.endsWith("/")) path += "index.html";
        const file = normalize(join(ROOT, path));
        if ((file !== ROOT && !file.startsWith(ROOT + sep)) || PRIVATE.test(file.slice(ROOT.length))) { res.writeHead(404).end("Not found"); return; }
        if (!(await stat(file)).isFile()) throw new Error("not a file");
        res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
});

// ------------------------------------------------------------------ rooms

const world = makeWorld(WORLD);
/** @type {Map<string, Room>} */
const rooms = new Map();
function status() {
    let players = 0;
    for (const r of rooms.values()) players += r.humans;
    return { game: "skyfarm", protocol: PROTOCOL, rooms: rooms.size, players, maxPlayers: MAX_PLAYERS };
}
function newCode() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (;;) {
        let code = "";
        for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
        if (!rooms.has(code)) return code;
    }
}

// ------------------------------------------------------------------ sockets

// (a hello may carry a whole farm: about 6 KB of JSON, a long-played one more; inputs are tiny)
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 512 * 1024, perMessageDeflate: { threshold: 256 } });
const perAddress = new Map();

wss.on("connection", (ws, req) => {
    const address = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").toString().split(",")[0].trim();
    const count = (perAddress.get(address) || 0) + 1;
    perAddress.set(address, count);
    /** @type {Room | null} */
    let room = null, id = 0;
    const refuse = (text) => { try { ws.send(encode({ t: "error", text })); } catch { /* gone */ } ws.close(); };
    if (count > MAX_PER_ADDRESS) refuse("Too many connections from this address.");
    const timer = setTimeout(() => { if (!room) refuse("No hello."); }, HELLO_TIMEOUT);

    ws.on("message", (data, isBinary) => {
        const text = isBinary ? "" : data.toString();
        if (room) { room.receive(id, text); return; }
        const m = decode(text);
        if (!m || m.t !== "hello") { refuse("Expected a hello."); return; }
        if (m.v !== PROTOCOL) { refuse("This page is a different version from the server. Reload it."); return; }
        let target;
        if (m.create) {
            if (rooms.size >= MAX_ROOMS) { refuse("The server has no space for another farm."); return; }
            const game = m.create.game && typeof m.create.game === "object" ? m.create.game : null;
            try { target = new Room({ world, code: newCode(), game, log }); } catch { refuse("That farm couldn't be opened."); return; }
            rooms.set(target.code, target);
            log(`${target.code}: opened`);
        } else {
            const want = typeof m.room === "string" ? m.room.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) : "";
            target = rooms.get(want);
            if (!target) { refuse(want ? `There is no farm with the code ${want}.` : "Which farm? Type its code."); return; }
            if (target.full) { refuse(`That farm is full (${MAX_PLAYERS} gardeners).`); return; }
        }
        clearTimeout(timer);
        room = target;
        id = room.join((out) => { if (ws.readyState === 1) ws.send(out); }, cleanText(m.name, NAME_MAX));
        if (!id) { room = null; refuse("Couldn't join that farm."); }
    });

    ws.on("close", () => {
        clearTimeout(timer);
        const n = (perAddress.get(address) || 1) - 1;
        if (n > 0) perAddress.set(address, n); else perAddress.delete(address);
        if (!room) return;
        if (room.leave(id) || room.humans === 0) { rooms.delete(room.code); log(`${room.code}: closed`); }
        room = null;
    });
    ws.on("error", () => ws.close());
});

// ------------------------------------------------------------------ the clock

// Timers aren't exact: each pass runs the ticks that are due, and gives up on a backlog rather than racing.
const STEP = 1000 / TICK_RATE;
let due = performance.now();
setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (now >= due && n < 6) {
        for (const room of rooms.values()) {
            try { room.tick(); } catch (e) { console.error(`${room.code}: tick failed`, e); room.broadcast({ t: "closed", why: "The farm stopped working on the server." }); rooms.delete(room.code); }
        }
        due += STEP; n++;
    }
    if (now - due > 250) due = now;
}, 4);

http.listen(PORT, () => log(`SKYFARM is up at http://localhost:${PORT}  (co-op WebSocket on /ws)`));
