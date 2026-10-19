/**
 * Netcode under bad networks. Run with `npm run test:net`. Taken from BREACH's and changed for DECOY.
 *
 * Part 1 runs on a virtual clock, so it is exact and repeatable: a real Room, real Clients, and the
 * game's own Conditions wrapper adding latency, jitter and loss between them, all stepped tick by tick.
 *
 *   PREDICTION        how far a client's idea of its own position is from the server's, while it runs,
 *                     jumps, turns, takes a disguise and locks
 *   INTERPOLATION     how smoothly another player moves on the client's screen
 *   HIT REGISTRATION  a hider disguised as a long prop strafes and turns; a seeker aims its scanner at the
 *                     middle of the prop exactly where its own screen shows it, and fires. Every such scan
 *                     should land. Run again with lag compensation off, to show what it is for.
 *   TRAFFIC           one person in a full room of ten
 *
 * Part 2 starts the real server and connects to it over real WebSockets.
 *
 *   node tools/net-test.mjs            # everything
 *   node tools/net-test.mjs --quick    # skip the real server
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BTN, MOVE, MAX_REWIND, TICK_RATE, ROLE } from "../game/data.js";
import { PROP_INDEX, PROP_SHAPE } from "../game/props.js";
import { quantizeYaw, quantizePitch, findPlayer } from "../game/sim.js";
import { Client, Loopback, Conditions, SocketTransport } from "../game/net.js";
import { INTERP_TICKS, SNAP_EVERY, PROTOCOL, WIRE } from "../game/protocol.js";
import { Room } from "../server/room.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "   " + detail : ""}`); };
const MS = 1000 / TICK_RATE;
const label = (net) => `ping ${net.latency} ms` + (net.jitter ? ` ±${net.jitter}` : "") + (net.loss ? `, ${net.loss * 100}% loss` : "");
const idle = () => ({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 });

/** A room and some clients on a clock that only moves when step() is called. The first client hides, the second seeks. */
function harness(roomOptions, links) {
    let now = 0, seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const room = new Room({ map: "greybox", hide: 0.5, seek: 1000, ...roomOptions });
    const clients = links.map((settings, i) => {
        const client = new Client(), link = new Conditions(new Loopback(room), { ...settings, now: () => now, random });
        client.attach(link);
        link.connect("P" + (i + 1));
        client.controls = idle();
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

/** Put a player somewhere, on the server (the client hears about it in the next snapshot). */
function place(p, x, y, z = 0) {
    Object.assign(p, { x, y, z, vx: 0, vy: 0, vz: 0, ground: true });
    for (let i = 0; i < p.hist.length; i += 6) { p.hist[i] = x; p.hist[i + 1] = y; p.hist[i + 2] = z; p.hist[i + 3] = p.propYaw; p.hist[i + 4] = p.prop; }
}

// ------------------------------------------------------------------ prediction

console.log("prediction: a hider runs, jumps, turns, takes a disguise and locks; how far is the client from the server at each snapshot?");
for (const net of [{ latency: 0 }, { latency: 60, jitter: 10 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 30, loss: 0.03 }, { latency: 300, jitter: 60, loss: 0.05 }]) {
    const h = harness({}, [net]), c = h.clients[0];
    h.run(90);
    const crate = h.room.map.props.findIndex((q) => q.type === PROP_INDEX.crate && q.z === 0);
    const q = h.room.map.props[crate];
    place(h.player(c), q.x, q.y + 2.2);
    h.run(60);
    let t = 0, worst = 0, sum = 0, n = 0, replayed = 0;
    c.stats.corrections = 0;
    const before = c.snapshot.bind(c);
    c.snapshot = (m) => { before(m); worst = Math.max(worst, c.stats.lastError); sum += c.stats.lastError; n++; replayed = Math.max(replayed, c.stats.replayed); };
    h.run(900, () => {
        t++;
        c.controls.my = t % 300 < 150 ? 127 : -100; c.controls.mx = Math.round(Math.sin(t * 0.05) * 127);
        c.controls.yaw = quantizeYaw(t * 0.035);
        c.controls.buttons = BTN.sprint | (t % 50 < 3 ? BTN.jump : 0) | (t % 400 === 200 ? BTN.lock : 0);
        c.controls.prop = t === 10 ? crate + 1 : 0;
    });
    const truth = h.player(c);
    check(`${label(net)}: the client stays with the server`, worst <= 1e-6 && truth.prop === PROP_INDEX.crate, `mean ${(sum / n).toFixed(4)} m, worst ${worst.toFixed(3)} m over ${n} snapshots; ${c.stats.corrections} corrected, up to ${replayed} inputs replayed; disguised as ${truth.prop === PROP_INDEX.crate ? "a crate" : "?"}`);
}

// ------------------------------------------------------------------ interpolation

console.log("interpolation: how smoothly does a running prop move on someone else's screen?");
for (const net of [{ latency: 0 }, { latency: 150, jitter: 30 }, { latency: 150, jitter: 40, loss: 0.05 }]) {
    const h = harness({}, [{ latency: 0 }, net]), [runner, watcher] = h.clients;
    h.run(90);
    place(h.player(runner), -5, 0); place(h.player(watcher), 12, -9);
    h.run(60);
    const s = { x: 0, y: 0 }, steps = [];
    let last = null, t = 0;
    h.run(200, (c) => {
        if (c === runner) { c.controls.my = 127; c.controls.yaw = quantizeYaw(0); return; }
        t++;
        if (!c.sample(runner.id, s)) return;
        if (last && t > 30) steps.push(Math.hypot(s.x - last[0], s.y - last[1]));
        last = [s.x, s.y];
    });
    const want = MOVE.hiderWalk / TICK_RATE, freezes = steps.filter((d) => d < want * 0.2).length, jumps = steps.filter((d) => d > want * 3).length;
    check(`${label(net)}: no jumps, few freezes`, jumps === 0 && freezes <= (net.loss ? 40 : 2), `${steps.length} frames: ${freezes} frozen, ${jumps} jumped; a frame's step is ${Math.min(...steps).toFixed(3)} to ${Math.max(...steps).toFixed(3)} m (${want.toFixed(3)} is exact)`);
}

// ------------------------------------------------------------------ hit registration

/**
 * The hider is a cooler (long and low: 0.72 × 0.44 × 0.46 m) strafing across the seeker's view and turning
 * as it goes, so its hit shape is a turned box that keeps changing. The seeker aims at the middle of the
 * cooler where its own screen draws it, and fires a scan every 40 ticks. Returns scans and hits as the
 * server counted them.
 */
function scanTest(net, rewind, seekerMoves = false) {
    const h = harness({ rewind }, [{ latency: 40, jitter: 8 }, net]), [a, b] = h.clients;
    h.run(90);
    const hider = h.player(a), seeker = h.player(b);
    if (hider.role !== ROLE.hider || seeker.role !== ROLE.seeker) throw new Error("roles are the wrong way round");
    const cooler = PROP_INDEX.cooler, s = PROP_SHAPE[cooler];
    hider.prop = cooler; hider.hx = s[0]; hider.hy = s[1]; hider.h = s[2];
    place(hider, 2, -9); place(seeker, 2, 2);
    h.run(90);
    let shots = 0, hits = 0, props = 0, t = 0;
    b.on("event", (e) => { if (e.type === "shot" && e.id === b.id) shots++; if (e.type === "hurt" && e.by === b.id && !e.self) hits++; if (e.type === "hurt" && e.id === b.id && e.self) props++; });
    const view = { x: 0, y: 0, z: 0 };
    h.run(40 * 24, (c) => {
        if (c === a) {
            // strafe east and west across a 3 m beat, turning steadily
            t++;
            c.controls.yaw = quantizeYaw(-Math.PI / 2 + t * 0.02);
            const yaw = -Math.PI / 2 + t * 0.02, east = [Math.cos(yaw - Math.PI / 2), Math.sin(yaw - Math.PI / 2)];
            if (c.me.x > 3.5) c.dir = -1; else if (c.me.x < 0.5) c.dir = 1; else if (!c.dir) c.dir = 1;
            // move along ±x whatever the facing: turn the wished direction into the hider's own axes
            const fx = Math.cos(yaw), fy = Math.sin(yaw);
            c.controls.my = Math.round(c.dir * fx * 127); c.controls.mx = Math.round(c.dir * (fx * 0 + fy) * 127);
            void east;
            return;
        }
        hider.health = 100; seeker.health = 100; seeker.charge = 100;
        if (!c.sample(a.id, view)) return;
        const me = c.me, dx = view.x - me.x, dy = view.y - me.y, dz = view.z + s[2] * 0.5 - (me.z + MOVE.eye);
        c.controls.yaw = quantizeYaw(Math.atan2(dy, dx)); c.controls.pitch = quantizePitch(Math.atan2(dz, Math.hypot(dx, dy)));
        c.controls.mx = seekerMoves ? (t % 90 < 45 ? 90 : -90) : 0;
        c.controls.buttons = t % 40 === 5 ? BTN.fire : 0;
    });
    return { shots, hits, props };
}

console.log(`hit registration: a scanner aimed at a turning, strafing disguised hider where it is seen (rewind cap ${MAX_REWIND} ticks = ${Math.round(MAX_REWIND * MS)} ms, of which ${INTERP_TICKS} + up to ${SNAP_EVERY} are interpolation)`);
const results = [];
for (const net of [{ latency: 0 }, { latency: 50, jitter: 10 }, { latency: 100, jitter: 20 }, { latency: 150 }, { latency: 150, jitter: 20 }, { latency: 150, jitter: 30, loss: 0.02 }]) {
    const on = scanTest(net, true), off = scanTest(net, false);
    results.push([label(net), on, off]);
    check(`${label(net)}: what looks like a hit is a hit`, on.shots >= 20 && on.hits >= on.shots * (net.loss ? 0.8 : 1), `${on.hits} of ${on.shots} land with lag compensation (${on.props} hit a real prop instead); ${off.hits} of ${off.shots} without`);
}
{
    const on = scanTest({ latency: 150, jitter: 20 }, true, true);
    check("ping 150 ms ±20, seeker strafing too", on.hits >= on.shots * 0.95 && on.shots >= 20, `${on.hits} of ${on.shots}`);
    const far = scanTest({ latency: 320, jitter: 20 }, true);
    console.log(`  note  ping 320 ms is past the rewind cap: ${far.hits} of ${far.shots} land. The cap is deliberate.`);
}

// ------------------------------------------------------------------ traffic

console.log("traffic: one person in a full room of ten (nine bots), for a minute of seeking");
for (const binary of [false, true]) {
    WIRE.binary = binary;
    const h = harness({ bots: 10, skill: 2, seed: 5, hide: 1, seek: 200 }, [{ latency: 0 }]), c = h.clients[0];
    h.run(3);
    let bytesIn = 0, bytesOut = 0;
    const inner = c.transport.inner, room = h.room, send = inner.send.bind(inner);
    inner.send = (data) => { bytesOut += typeof data === "string" ? data.length : data.byteLength; send(data); };
    const client = room.clients.get(c.id), out = client.send;
    client.send = (data) => { bytesIn += typeof data === "string" ? data.length : data.byteLength; out(data); };
    const seconds = 60;
    h.run(seconds * TICK_RATE, () => { c.controls.my = 127; c.controls.yaw = quantizeYaw(h.room.state.tick * 0.02); c.controls.buttons = BTN.fire; });
    const down = bytesIn / seconds / 1000, up = bytesOut / seconds / 1000;
    if (binary) check("a ten-player match costs a client under 20 kB/s down", down < 20, `packed: ${down.toFixed(1)} kB/s down, ${up.toFixed(1)} kB/s up`);
    else console.log(`  info  as JSON text: ${down.toFixed(1)} kB/s down, ${up.toFixed(1)} kB/s up`);
}
WIRE.binary = true;

// ------------------------------------------------------------------ the real server

if (!process.argv.includes("--quick")) {
    console.log("the real server, over real WebSockets, for four seconds");
    const port = 8300 + Math.floor(Math.random() * 500);
    const server = spawn(process.execPath, [fileURLToPath(new URL("../server/server.mjs", import.meta.url)), String(port)], { stdio: "ignore", env: { ...process.env, QUIET: "1" } });
    await new Promise((r) => setTimeout(r, 700));
    try {
        const connect = (name, hello) => new Promise((done, fail) => {
            const client = new Client(), link = new SocketTransport(`ws://localhost:${port}/ws`);
            client.attach(link);
            link.onopen = () => client.send({ t: "hello", v: PROTOCOL, name, ...hello });
            client.on("welcome", () => done(client));
            client.on("close", (reason) => fail(new Error(reason)));
            link.connect();
            client.controls = { mx: 0, my: 127, buttons: 0, yaw: 0, pitch: 0, prop: 0 };
        });
        const a = await connect("Ann", { create: { map: "greybox", bots: 0, open: false } });
        const b = await connect("Ben", { room: a.room.code });
        const loop = setInterval(() => { for (const c of [a, b]) { c.frame(1 / 60); c.controls.yaw = (c.controls.yaw + 300) & 0xffff; c.tick(c.controls); } }, MS);
        await new Promise((r) => setTimeout(r, 4000));
        clearInterval(loop);
        const s = { x: 0, y: 0 };
        check("two socket clients share a room", a.room.code === b.room.code && a.players.size === 2 && b.players.size === 2, `room ${a.room.code}`);
        check("each receives the other's position", a.sample(b.id, s) && b.sample(a.id, s));
        check("one hides and one seeks", a.me.role !== b.me.role && a.me.role > 0 && b.me.role > 0);
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
