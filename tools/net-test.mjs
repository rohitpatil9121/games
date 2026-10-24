/**
 * SKYFARM: co-op under a bad network, in Node (after TIDEFALL's net-test). A room and three clients in one
 * process, every message through encode/decode and a Conditions link (latency, jitter, loss) on a simulated
 * clock, so a test of minutes runs in seconds and the same every time.
 *
 *   node tools/net-test.mjs            # 150 ms round trip, 30 ms jitter, 3% of messages late
 *   node tools/net-test.mjs 300 60 5   # another link
 *
 * Checks: everyone joins and sees everyone; a walking client's prediction stays close to the room's and ends
 * exactly on it; what one gardener plants shows on the others' copies; the night passes only when everyone is
 * in bed; a talk from far away gives nothing; the host is handed saves that load back into a one-player farm;
 * the host leaving closes the farm for the guests. Reports the bytes per second each way, raw and deflated.
 */
import { deflateRawSync } from "node:zlib";
import { makeWorld, WORLD, topAt, islandUnder } from "../game/islands.js";
import { Room } from "../server/room.mjs";
import { Client, Loopback, Conditions } from "../game/net.js";
import { createState, step, findPlayer, hashState } from "../game/sim.js";
import { snapshot, revive } from "../game/save.js";
import { BTN, DAY_TICKS, TICK_RATE } from "../game/data.js";
import { quantizeYaw, makeRandom } from "../game/det.js";

const [latency = 150, jitter = 30, loss = 3] = process.argv.slice(2).map(Number);
let failed = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failed++; };
const world = makeWorld(WORLD);

// a played host farm: a little way into day 1, the glider found
const hostGame = createState(world);
hostGame.player.hasGlider = true;
hostGame.tick = Math.round(0.45 * DAY_TICKS);
const room = new Room({ world, code: "TEST", game: snapshot(hostGame) });

let now = 0;
const rnd = makeRandom(11);
const link = () => new Conditions(new Loopback(room), { latency, jitter, loss: loss / 100, now: () => now, random: rnd });
const names = ["Rohit", "Ana", "Kai"];
const clients = names.map(() => new Client(world));
const saves = [];
clients[0].on("save", (g) => saves.push(g));
const closed = [];
clients.forEach((c, i) => c.on("close", (e) => closed.push([i, e.reason])));
clients.forEach((c, i) => c.connect(link(), i === 0 ? { name: names[i], create: {} } : { name: names[i], room: "TEST" }));

const NO = { mx: 0, my: 0, buttons: 0, yaw: 0 };
/** the room's events each client chose to show */
const shown = clients.map(() => []);
const control = clients.map(() => ({ ...NO }));
const bytes = { up: 0, down: 0, deflated: 0 };
/** run the room and the clients for some seconds of game time */
function run(seconds, each) {
    for (let k = 0; k < seconds * TICK_RATE; k++) {
        now += 1000 / TICK_RATE;
        for (const [i, c] of clients.entries()) { c.frame(1 / TICK_RATE); if (c.joined) { c.tick(control[i]); for (const e of c.takeEvents()) shown[i].push(e); } }
        room.tick();
        if (each) each(k);
    }
    for (const c of clients) c.frame(0);
}
// count what goes over the wire (wrap the room's sends)
for (const c of room.clients.values()) { const send = c.send; c.send = (d) => { bytes.down += d.length; bytes.deflated += deflateRawSync(d).length; send(d); }; }

run(2);
const roomP = (i) => findPlayer(room.state, clients[i].id);
check(clients.every((c) => c.joined && c.names.size === 3) && room.humans === 3, `three gardeners join (${clients.map((c) => c.id).join(", ")}) and each sees all three`);

const place = (i, x, y) => { const p = roomP(i); p.x = x; p.y = y; p.z = topAt(world.islands[0], x, y); p.vx = p.vy = p.vz = 0; p.ground = true; p.mode = "foot"; p.fx = 1; p.fy = 0; };
// 1. prediction while walking: a guest walks forward for 3 s through a 150 ms link, then stops
const g = clients[1];
// out on the grass, so the walk isn't into the hut's wall
place(1, 2, -12); run(0.5);
let maxErr = 0;
const from = { x: roomP(1).x, y: roomP(1).y };
control[1] = { mx: 0, my: 127, buttons: 0, yaw: quantizeYaw(0.6) };
run(3, () => { maxErr = Math.max(maxErr, g.stats.lastError); });
control[1] = { ...NO, yaw: quantizeYaw(0.6) };
run(1.5);
const rp = roomP(1), me = g.me, end = Math.hypot(rp.x - me.x, rp.y - me.y, rp.z - me.z), walked = Math.hypot(rp.x - from.x, rp.y - from.y);
check(walked > 5 && maxErr < 0.05 && end < 1e-6, `walking ${walked.toFixed(1)} m through ${latency} ms ± ${jitter}, ${loss}% late: prediction off by at most ${(maxErr * 100).toFixed(1)} cm, and exactly on the room's when stopped (${end.toExponential(1)} m)`);

// 2. one plants, the others see it: put the guest by the tilled soil with seeds, press use until a plot is planted
const [ix, iy] = world.data.tilled[0], home = world.islands[0];
room.state.pouch.seeds.turnip = 5; room.state.pouch.selected = "turnip"; room.dirty = true;
run(0.5);
place(2, ix - 0.6, iy + 0.5);
for (let k = 0; k < 6; k++) { control[2] = { mx: 0, my: 0, buttons: k % 2 ? 0 : BTN.interact, yaw: 0 }; run(0.3); }
control[2] = { ...NO };
run(1);
const planted = (s) => [...s.plots.values()].filter((p) => p.crop === "turnip").length;
const inRoom = planted(room.state);
check(inRoom > 0 && clients.every((c) => planted(c.local) === inRoom) && clients.every((c) => c.local.pouch.seeds.turnip === room.state.pouch.seeds.turnip), `Kai plants ${inRoom} turnip plot${inRoom > 1 ? "s" : ""}; every copy shows the same plots and the same seeds left (${room.state.pouch.seeds.turnip})`);

// 3. growth between worlds: every copy's plots match the room's to the last digit
const growthOff = Math.max(...clients.map((c) => Math.max(...[...room.state.plots.values()].map((p) => Math.abs((c.local.plots.get(p.ix + "," + p.iy)?.growth ?? -1) - p.growth)))));
check(growthOff < 0.002, `the crops grow on every copy as in the room (largest difference ${growthOff.toExponential(1)})`);

// 4. the night: two in bed is not enough; the third makes it pass
room.state.tick = Math.floor(room.state.tick / DAY_TICKS) * DAY_TICKS + Math.round(0.8 * DAY_TICKS);
const bed = world.data.bed || world.data.wake, dayBefore = Math.floor(room.state.tick / DAY_TICKS);
const sleepNow = (i) => { const p = roomP(i); p.asleep = true; };
sleepNow(0); sleepNow(1);
run(1);
const notYet = Math.floor(room.state.tick / DAY_TICKS) === dayBefore;
// the last one goes to bed by the game's own rule: standing at the bed and pressing use
const w = world.data.bed;
let slept = false;
if (w) { place(2, w.x, w.y); for (let k = 0; k < 6 && !slept; k++) { control[2] = { mx: 0, my: 0, buttons: k % 2 ? 0 : BTN.interact, yaw: 0 }; run(0.3); slept = Math.floor(room.state.tick / DAY_TICKS) > dayBefore; } }
if (!slept) { sleepNow(2); const p = roomP(2); p.does = "sleep"; p.actAge = 0; p.actCool = 0; control[2] = { ...NO }; run(0.3); slept = Math.floor(room.state.tick / DAY_TICKS) > dayBefore; }
control[2] = { ...NO };
run(1);
check(notYet && slept && clients.every((c) => Math.floor(c.local.tick / DAY_TICKS) > dayBefore), "two in bed don't end the day; the third does, and every copy wakes on the next morning");

// 5. talking from far away gives nothing
const seedsBefore = JSON.stringify(room.state.pouch.seeds);
clients[1].talk("ona");
run(0.5);
check(JSON.stringify(room.state.pouch.seeds) === seedsBefore, "a conversation 'finished' far from the hermit gives nothing");
// beside Ona it counts: her gift goes into the shared pouch, and only the one who talked is shown it
const ona = world.data.hermits.find((h) => h.id === "ona"), oi = islandUnder(world, ona.x, ona.y);
{ const p = roomP(1); p.x = ona.x + 1.5; p.y = ona.y; p.z = topAt(oi, p.x, p.y); p.vx = p.vy = p.vz = 0; p.ground = true; p.mode = "foot"; }
run(0.5);
const sun0 = room.state.pouch.seeds.sunflower;
shown.forEach((s) => (s.length = 0));
clients[1].talk("ona");
run(1);
const gifted = (i) => shown[i].some((e) => e.type === "gift");
check(room.state.pouch.seeds.sunflower > sun0 && clients.every((c) => c.local.pouch.seeds.sunflower === room.state.pouch.seeds.sunflower) && gifted(1), `beside Ona it counts: ${room.state.pouch.seeds.sunflower - sun0} sunflower seeds in the shared pouch on every copy; Ana is shown the gift`);

// 6. the host is handed saves; one loads back as a one-player farm
run(1);
const last = saves[saves.length - 1];
const back = last && revive(world, last);
check(saves.length >= 2 && back && back.players.length === 1 && planted(back) === inRoom && Math.floor(back.tick / DAY_TICKS) > dayBefore, `the host has been handed ${saves.length} saves; the last loads as the host's farm alone, with Kai's turnips and the new day in it`);

// 7. bandwidth (this run, everything): per client, per second
const secs = room.age / TICK_RATE, per = (n) => (n / secs / clients.length / 1024).toFixed(1);
console.log(`  bandwidth per client: down ${per(bytes.down)} KB/s as JSON, about ${per(bytes.deflated)} KB/s deflated (each message alone; ws keeps its dictionary, so less); worlds sent ${room.bytes.world ? (room.bytes.world / 1024).toFixed(0) : 0} KB in all; up ${(clients.reduce((n, c) => n + c.stats.bytesOut, 0) / secs / clients.length / 1024).toFixed(1)} KB/s`);

// 8. the host leaves: the guests are told, and the room is closed
clients[0].close();
run(1);
check(room.closed && closed.filter(([i]) => i > 0).length === 2, `the host goes home: the room closes and both guests are told ("${(closed.find(([i]) => i > 0) || [0, ""])[1]}")`);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
