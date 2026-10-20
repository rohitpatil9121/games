/**
 * Netcode under bad networks. Run with `npm run test:net`. Copied from BREACH's net-test.mjs and adapted.
 *
 * Part 1 runs on a virtual clock, so it is exact and repeatable: a real Room, real Clients, and the
 * game's own Conditions wrapper adding latency, jitter and loss between them, all stepped tick by tick:
 *
 *   PREDICTION      how far the client's idea of its own position is from the server's, at every snapshot,
 *                   while running down the beach into the sea and out again (so the water level matters)
 *   INTERPOLATION   how smoothly another player moves on the client's screen
 *   SHOVES          a shover closes on a strafing target and shoves when it *sees* it in reach; with lag
 *                   compensation those should land; without, many miss
 *   TRAFFIC         bytes per second for one client in a full room
 *
 * Part 2 starts the real server and connects to it over real WebSockets.
 *
 *   node tools/net-test.mjs            # everything
 *   node tools/net-test.mjs --quick    # skip the real server
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BTN, MOVE, MAX_REWIND, TICK_RATE, TOOLS, HISTORY } from "../game/data.js";
import { findPlayer } from "../game/sim.js";
import { quantizeYaw } from "../game/det.js";
import { groundAt } from "../game/island.js";
import { Client, Loopback, Conditions, SocketTransport } from "../game/net.js";
import { INTERP_TICKS, SNAP_EVERY, PROTOCOL, WIRE } from "../game/protocol.js";
import { Room } from "../server/room.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "   " + detail : ""}`); };
const MS = 1000 / TICK_RATE;
const label = (net) => `ping ${net.latency} ms` + (net.jitter ? ` ±${net.jitter}` : "") + (net.loss ? `, ${net.loss * 100}% loss` : "");

function harness(roomOptions, links) {
    let now = 0, seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const room = new Room({ teams: 2, seed: 77, ...roomOptions });
    const clients = links.map((settings, i) => {
        const client = new Client(), link = new Conditions(new Loopback(room), { ...settings, now: () => now, random });
        client.attach(link);
        link.connect("P" + (i + 1));
        client.controls = { mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0 };
        return client;
    });
    const step = (each) => {
        now += MS;
        for (const c of clients) { c.frame(1 / TICK_RATE); if (each) each(c); c.tick(c.controls); }
        room.tick();
    };
    const run = (ticks, each) => { for (let i = 0; i < ticks; i++) step(each); };
    return { room, clients, step, run, player: (c) => findPlayer(room.state, c.id) };
}

function place(room, p, x, y) {
    const z = groundAt(room.island, x, y);
    Object.assign(p, { x, y, z, vx: 0, vy: 0, vz: 0, ground: true, stun: 0, guard: 0 });
    for (let i = 0; i < HISTORY; i++) { p.hist[i * 3] = x; p.hist[i * 3 + 1] = y; p.hist[i * 3 + 2] = z; }
}

// ------------------------------------------------------------------ prediction

console.log("prediction: a player runs down the beach into the sea and back, jumping and turning; how far is the client from the server?");
for (const net of [{ latency: 0 }, { latency: 60, jitter: 10 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 30, loss: 0.03 }, { latency: 300, jitter: 60, loss: 0.05 }]) {
    const h = harness({}, [net]), c = h.clients[0];
    h.run(60);
    const camp = h.room.island.camps[h.player(c).team];
    place(h.room, h.player(c), camp.x * 1.4, camp.y * 1.4);
    h.run(60);
    let t = 0, worst = 0, sum = 0, n = 0, replayed = 0, wet = 0;
    c.stats.corrections = 0;
    const before = c.snapshot.bind(c);
    c.snapshot = (m) => { before(m); worst = Math.max(worst, c.stats.lastError); sum += c.stats.lastError; n++; replayed = Math.max(replayed, c.stats.replayed); };
    h.run(1200, () => {
        t++;
        // out to sea for ten seconds, back for ten
        c.controls.my = 127; c.controls.mx = Math.round(Math.sin(t * 0.05) * 60);
        c.controls.yaw = quantizeYaw(camp.angle + (t % 1200 < 600 ? 0 : Math.PI) + Math.sin(t * 0.02) * 0.3);
        c.controls.buttons = BTN.sprint | (t % 70 < 2 ? BTN.jump : 0);
        if (c.me.water >= 2) wet++;
    });
    const limit = 1e-6;
    check(`${label(net)}: the client stays with the server`, worst <= limit, `mean ${(sum / n).toFixed(4)} m, worst ${worst.toFixed(4)} m over ${n} snapshots (${(wet / 60).toFixed(1)} s of it swimming); ${c.stats.corrections} corrected, up to ${replayed} inputs replayed`);
}

// ------------------------------------------------------------------ interpolation

console.log("interpolation: how smoothly does a running player move on someone else's screen?");
for (const net of [{ latency: 0 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 40, loss: 0.05 }]) {
    const h = harness({}, [{ latency: 0 }, net]), [runner, watcher] = h.clients;
    h.run(60);
    place(h.room, h.player(runner), 0, -10); place(h.room, h.player(watcher), 10, 0);
    h.run(60);
    const s = {}, steps = [];
    let last = null, t = 0;
    h.run(240, (c) => {
        if (c === runner) { c.controls.my = 127; c.controls.yaw = quantizeYaw(Math.PI / 2); return; }
        t++;
        if (!c.sample(runner.id, s)) return;
        if (last && t > 30) steps.push(Math.hypot(s.x - last[0], s.y - last[1]));
        last = [s.x, s.y];
    });
    const want = MOVE.run / TICK_RATE, freezes = steps.filter((d) => d < want * 0.2).length, jumps = steps.filter((d) => d > want * 3).length;
    check(`${label(net)}: no jumps, few freezes`, jumps === 0 && freezes <= (net.loss ? 40 : 2), `${steps.length} frames: ${freezes} frozen, ${jumps} jumped; steps ${Math.min(...steps).toFixed(3)} to ${Math.max(...steps).toFixed(3)} m (${want.toFixed(3)} exact)`);
}

// ------------------------------------------------------------------ shoves

/** A shover walks up to a target that strafes back and forth, and shoves when it sees the target in reach. */
function shoveTest(net, rewind) {
    const h = harness({ rewind }, [net, { latency: 40, jitter: 8 }]), [a, b] = h.clients;
    h.run(60);
    const pa = h.player(a), pb = h.player(b);
    const cx = (h.room.island.camps[0].x + h.room.island.camps[1].x) * 0.25, cy = (h.room.island.camps[0].y + h.room.island.camps[1].y) * 0.25;
    place(h.room, pa, cx - 1.6, cy); place(h.room, pb, cx, cy);
    h.run(90);
    let shoves = 0, hits = 0, t = 0, wait = 0;
    a.on("event", (e) => { if (e.type === "shove" && e.id === a.id) { shoves++; if (e.target === b.id) hits++; } });
    const s = {};
    h.run(60 * 70, (c) => {
        if (c === b) {
            t++;
            // strafe north and south across the shover's front, turning at the ends of a 3 m beat
            c.controls.yaw = quantizeYaw(Math.PI);
            if (c.me.y > cy + 1.5) c.controls.mx = -127; else if (c.me.y < cy - 1.5) c.controls.mx = 127; else if (!c.controls.mx) c.controls.mx = 127;
            return;
        }
        pb.guard = 0; pb.stun = 0;
        c.controls.buttons = 0;
        if (!c.sample(b.id, s)) return;
        const me = c.me, dx = s.x - me.x, dy = s.y - me.y, d = Math.hypot(dx, dy);
        c.controls.yaw = quantizeYaw(Math.atan2(dy, dx));
        // stay at arm's length; shove every 1.5 s when what I see is within reach
        c.controls.my = d > 1.5 ? 90 : d < 1.0 ? -90 : 0;
        if (--wait <= 0 && d < TOOLS.shove.range * 0.85 && me.shoveCool === 0) { c.controls.buttons = BTN.shove; wait = 90; }
    });
    return { shoves, hits };
}
console.log(`shoves: aimed at where a strafing target is seen (rewind cap ${MAX_REWIND} ticks = ${Math.round(MAX_REWIND * MS)} ms, of which ${INTERP_TICKS} + up to ${SNAP_EVERY} are interpolation)`);
for (const net of [{ latency: 0 }, { latency: 50, jitter: 10 }, { latency: 100, jitter: 20 }, { latency: 150, jitter: 20 }, { latency: 150, jitter: 30, loss: 0.02 }]) {
    const on = shoveTest(net, true), off = shoveTest(net, false);
    check(`${label(net)}: a shove that looks in reach lands`, on.shoves >= 20 && on.hits >= on.shoves * (net.loss ? 0.75 : net.latency >= 150 ? 0.85 : 0.95), `${on.hits} of ${on.shoves} land with lag compensation; ${off.hits} of ${off.shoves} without`);
}

// ------------------------------------------------------------------ traffic

console.log("traffic: one person in a full room of bots (8 players, 4 teams), for a minute of a match");
for (const binary of [false, true]) {
    WIRE.binary = binary;
    const h = harness({ teams: 4, bots: 8, skill: 2, seed: 5 }, [{ latency: 0 }]), c = h.clients[0];
    h.run(3);
    let bytesIn = 0, bytesOut = 0;
    const inner = c.transport.inner, room = h.room, send = inner.send.bind(inner);
    inner.send = (data) => { bytesOut += typeof data === "string" ? data.length : data.byteLength; send(data); };
    const client = room.clients.get(c.id), out = client.send;
    client.send = (data) => { bytesIn += typeof data === "string" ? data.length : data.byteLength; out(data); };
    const seconds = 60;
    // the busiest minute: the first low tide, everyone out among the loot
    h.run(seconds * TICK_RATE, () => { c.controls.my = 127; c.controls.yaw = quantizeYaw(h.room.state.tick * 0.02); c.controls.buttons = BTN.sprint | (h.room.state.tick % 40 === 0 ? BTN.interact : 0); });
    const down = bytesIn / seconds / 1000, up = bytesOut / seconds / 1000;
    if (binary) check("an eight-player match costs a client under 20 kB/s down", down < 20, `packed: ${down.toFixed(1)} kB/s down, ${up.toFixed(1)} kB/s up`);
    else console.log(`  info  as JSON text: ${down.toFixed(1)} kB/s down, ${up.toFixed(1)} kB/s up`);
}
WIRE.binary = true;

// ------------------------------------------------------------------ the real server

if (!process.argv.includes("--quick")) {
    console.log("the real server, over real WebSockets, for four seconds");
    const port = 8300 + Math.floor(Math.random() * 500);
    const server = spawn(process.execPath, [fileURLToPath(new URL("../server/server.mjs", import.meta.url)), String(port)], { stdio: "ignore", env: { ...process.env, QUIET: "1" } });
    await new Promise((r) => setTimeout(r, 900));
    try {
        const connect = (name, hello) => new Promise((done, fail) => {
            const client = new Client(), link = new SocketTransport(`ws://localhost:${port}/ws`);
            client.attach(link);
            link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name, ...hello });
            client.on("welcome", () => done(client));
            client.on("close", (reason) => fail(new Error(reason)));
            link.connect();
            client.controls = { mx: 0, my: 127, buttons: 0, yaw: 0, pitch: 0 };
        });
        const a = await connect("Ann", { create: { teams: 2, bots: 0, open: false } });
        const b = await connect("Ben", { room: a.room.code });
        const loop = setInterval(() => { for (const c of [a, b]) { c.frame(1 / 60); c.controls.yaw = (c.controls.yaw + 300) & 0xffff; c.tick(c.controls); } }, MS);
        await new Promise((r) => setTimeout(r, 4000));
        clearInterval(loop);
        const s = {};
        check("two socket clients share a room and an island", a.room.code === b.room.code && a.island.seed === b.island.seed && a.players.size === 2 && b.players.size === 2, `room ${a.room.code}, island ${a.island.seed}`);
        check("each receives the other's position", a.sample(b.id, s) && b.sample(a.id, s));
        check("the server measures the ping", a.ping >= 0 && a.ping < 100, `${a.ping} ms on loopback`);
        check("prediction holds over a real socket", a.stats.lastError < 0.5, `last error ${a.stats.lastError.toFixed(4)} m, ${a.stats.corrections} corrections in 4 s`);
        const bad = await new Promise((done) => { const ws = new WebSocket(`ws://localhost:${port}/ws`); ws.onopen = () => ws.send("not a hello"); ws.onmessage = (e) => done(String(e.data)); ws.onclose = () => done("closed"); });
        check("a socket that doesn't say hello is refused", bad.includes("error") || bad === "closed", bad.slice(0, 60));
        const none = await connect("Cy", { room: "QQQQ" }).then(() => "joined", (e) => e.message);
        check("a wrong room code is refused with a reason", /no room/i.test(none), none);
        a.detach(); b.detach();
    } catch (e) { check("the real server answers", false, e.message); }
    server.kill();
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
setTimeout(() => process.exit(failed ? 1 : 0), 200);
