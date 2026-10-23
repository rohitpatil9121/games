/**
 * Netcode under bad networks. Run with `npm run test:net`. Copied from TIDEFALL's net-test.mjs (itself
 * BREACH's) and adapted to planes. Tags under lag come in stage 4.
 *
 * Part 1 runs on a virtual clock, so it is exact and repeatable: a real Room, real Clients, and the
 * game's own Conditions wrapper adding latency, jitter and loss between them, all stepped tick by tick:
 *
 *   PREDICTION      how far the client's idea of its own plane is from the server's, at every snapshot,
 *                   while flying through the fan, the thermal and the gusts, flapping, and crashing
 *   INTERPOLATION   how smoothly another plane moves on the client's screen
 *   TRAFFIC         bytes per second for one client in a full room
 *
 * Part 2 starts the real server and connects to it over real WebSockets (Node's own WebSocket).
 *
 *   node tools/net-test.mjs            # everything
 *   node tools/net-test.mjs --quick    # skip the real server
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BTN, TICK_RATE } from "../game/data.js";
import { findPlayer } from "../game/sim.js";
import { Client, Loopback, Conditions, SocketTransport } from "../game/net.js";
import { PROTOCOL, WIRE } from "../game/protocol.js";
import { Room } from "../server/room.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "   " + detail : ""}`); };
const MS = 1000 / TICK_RATE;
const label = (net) => `ping ${net.latency} ms` + (net.jitter ? ` ±${net.jitter}` : "") + (net.loss ? `, ${net.loss * 100}% loss` : "");

function harness(roomOptions, links) {
    let now = 0, seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const room = new Room({ seed: 77, ...roomOptions });
    const clients = links.map((settings, i) => {
        const client = new Client(), link = new Conditions(new Loopback(room), { ...settings, now: () => now, random });
        client.attach(link);
        link.connect("P" + (i + 1), ["dart", "glider", "stunt"][i % 3]);
        client.controls = { pitch: 0, roll: 0, buttons: 0 };
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

// ------------------------------------------------------------------ prediction

console.log("prediction: a plane flies the bedroom for 20 s (turns, climbs, dives, flaps, the fan, the thermal, gusts, crashes); how far is the client from the server?");
for (const net of [{ latency: 0 }, { latency: 60, jitter: 10 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 30, loss: 0.03 }, { latency: 300, jitter: 60, loss: 0.05 }]) {
    const h = harness({}, [net]), c = h.clients[0];
    h.run(60);
    let t = 0, worst = 0, sum = 0, n = 0, replayed = 0, crumples = 0, inAir = 0;
    c.stats.corrections = 0;
    const before = c.snapshot.bind(c);
    c.snapshot = (m) => { before(m); worst = Math.max(worst, c.stats.lastError); sum += c.stats.lastError; n++; replayed = Math.max(replayed, c.stats.replayed); };
    h.run(1200, () => {
        t++;
        c.controls.roll = Math.round(Math.sin(t * 0.013) * 127);
        c.controls.pitch = Math.round(Math.sin(t * 0.021 + 1) * 90);
        c.controls.buttons = t % 150 < 2 ? BTN.flap : 0;
        if (c.me.events.includes("crumple")) crumples++;
        if (c.me.inFan > 0.1 || c.me.inLift > 0.1 || c.me.inGust > 0.1) inAir++;
    });
    // a plane whose inputs stop for over a second is brought up to the present (sim.js step); the client
    // learns of it from the next snapshot, so on the worst link one small correction is expected
    check(`${label(net)}: the client stays with the server`, net.latency >= 300 ? worst <= 1e-3 && c.stats.corrections <= 2 : worst <= 1e-6, `mean ${(sum / n).toFixed(6)} m, worst ${worst.toFixed(6)} m over ${n} snapshots (${(inAir / 60).toFixed(1)} s in a fan, thermal or gust; ${crumples} crumples); ${c.stats.corrections} corrected, up to ${replayed} inputs replayed`);
}

// ------------------------------------------------------------------ interpolation

console.log("interpolation: how smoothly does a circling plane move on someone else's screen?");
for (const net of [{ latency: 0 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 40, loss: 0.05 }]) {
    const h = harness({}, [{ latency: 0 }, net]), [flyer, watcher] = h.clients;
    h.run(30);
    // the flyer circles in the open middle of the room, hands steady
    Object.assign(h.player(flyer), { x: 0, y: -0.6, z: 1.9, yaw: 0, pitch: 0, roll: 0, speed: 0.9, crumpled: 0 });
    const s = {}, steps = [];
    let last = null, t = 0, crumpled = 0;
    h.run(300, (c) => {
        if (c === flyer) { c.controls.roll = 90; c.controls.pitch = 15; c.controls.buttons = t % 120 < 2 ? BTN.flap : 0; if (c.me.crumpled) crumpled++; return; }
        t++;
        if (!c.sample(flyer.id, s)) return;
        if (last && t > 30) steps.push(Math.hypot(s.x - last[0], s.y - last[1], s.z - last[2]));
        last = [s.x, s.y, s.z];
    });
    const fly = h.player(flyer), want = fly.speed / TICK_RATE, freezes = steps.filter((d) => d < want * 0.2).length, jumps = steps.filter((d) => d > want * 4).length;
    check(`${label(net)}: no jumps, few freezes`, crumpled === 0 && jumps === 0 && freezes <= (net.loss ? 40 : 2), `${steps.length} frames: ${freezes} frozen, ${jumps} jumped; steps ${Math.min(...steps).toFixed(4)} to ${Math.max(...steps).toFixed(4)} m (about ${want.toFixed(4)})`);
}

// ------------------------------------------------------------------ traffic

console.log("traffic: one person in a full room (8 planes), for a minute");
for (const binary of [false, true]) {
    WIRE.binary = binary;
    const h = harness({ bots: 8, skill: 2, seed: 5 }, [{ latency: 0 }]), c = h.clients[0];
    h.run(3);
    let bytesIn = 0, bytesOut = 0;
    const inner = c.transport.inner, room = h.room, send = inner.send.bind(inner);
    inner.send = (data) => { bytesOut += typeof data === "string" ? data.length : data.byteLength; send(data); };
    const client = room.clients.get(c.id), out = client.send;
    client.send = (data) => { bytesIn += typeof data === "string" ? data.length : data.byteLength; out(data); };
    const seconds = 60;
    h.run(seconds * TICK_RATE, () => { const t = h.room.state.tick; c.controls.roll = Math.round(Math.sin(t * 0.02) * 127); c.controls.buttons = t % 150 < 2 ? BTN.flap : 0; });
    const down = bytesIn / seconds / 1000, up = bytesOut / seconds / 1000;
    if (binary) check("an eight-plane room costs a client under 10 kB/s down", down < 10, `packed: ${down.toFixed(1)} kB/s down, ${up.toFixed(1)} kB/s up`);
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
            link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name, fold: "glider", ...hello });
            client.on("welcome", () => done(client));
            client.on("close", (reason) => fail(new Error(reason)));
            link.connect();
            client.controls = { pitch: 0, roll: 40, buttons: 0 };
        });
        const a = await connect("Ann", { create: { mode: "rings", bots: 0, open: false } });
        const b = await connect("Ben", { room: a.room.code });
        let worst = 0;
        const loop = setInterval(() => { for (const c of [a, b]) { c.frame(1 / 60); c.tick(c.controls); if (c.snaps.length > 5) worst = Math.max(worst, c.stats.lastError); } }, MS);
        await new Promise((r) => setTimeout(r, 4000));
        clearInterval(loop);
        const s = {};
        check("two socket clients share a room and its seed", a.room.code === b.room.code && a.room.seed === b.room.seed && a.players.size === 2 && b.players.size === 2, `room ${a.room.code}, seed ${a.room.seed}`);
        check("each receives the other's plane", a.sample(b.id, s) && b.sample(a.id, s));
        check("the server measures the ping", a.ping >= 0 && a.ping < 100, `${a.ping} ms on loopback`);
        check("prediction holds over a real socket", worst < 0.05, `worst error ${worst.toFixed(4)} m, ${a.stats.corrections} corrections in 4 s (setInterval isn't a steady 60 Hz, so the server sometimes runs a tick on no input)`);
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
