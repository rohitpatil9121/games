/**
 * Simulation tests. Run with `npm test` (which also runs tools/check-maps.mjs).
 *
 * Plain Node, no test framework: each check prints ok or FAIL, and the process exits non-zero on a failure.
 * The rules are tested on the real simulation (game/sim.js) and through a real Room and Client joined by
 * the in-page Loopback, so what is checked is what runs.
 */
import { BTN, ROLE, SCANNER, TICK_RATE, PING, DECOY, TAUNT, ROUND, MOVE } from "../game/data.js";
import { PROP_INDEX, PROP_SHAPE, PROP_LIST, sizeAllowed } from "../game/props.js";
import { createState, addPlayer, step, stepPlayer, stuck, hashState, quantizeYaw, quantizePitch, squareYaw, rayProp, findPlayer, canDisguise, startRound } from "../game/sim.js";
import { getMap, compileMap } from "../game/maps/index.js";
import { Client, Loopback } from "../game/net.js";
import { Room } from "../server/room.mjs";
import { encode, decode } from "../game/protocol.js";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "   " + detail : ""}`); };
const map = getMap("greybox");
const input = (o = {}) => ({ seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0, ...o });

/** a match with one hider and one seeker, already seeking */
function duel() {
    const state = createState(map, { seed: 7 });
    const h = addPlayer(state, map, 1, "Hider", { team: 1 }), s = addPlayer(state, map, 2, "Seeker", { team: 2 });
    startRound(state, map);
    state.phase = "seek"; state.timeLeft = 100 * TICK_RATE; s.frozen = false;
    return { state, h, s };
}
const put = (p, x, y, z = 0) => { Object.assign(p, { x, y, z, vx: 0, vy: 0, vz: 0, ground: true }); for (let i = 0; i < p.hist.length; i += 6) { p.hist[i] = x; p.hist[i + 1] = y; p.hist[i + 2] = z; p.hist[i + 3] = p.propYaw; p.hist[i + 4] = p.prop; } };
const run = (state, inputs, n = 1) => { for (let i = 0; i < n; i++) step(state, map, inputs); };
const aimAt = (from, x, y, z) => ({ yaw: quantizeYaw(Math.atan2(y - from.y, x - from.x)), pitch: quantizePitch(Math.atan2(z - (from.z + MOVE.eye), Math.hypot(x - from.x, y - from.y))) });

// ------------------------------------------------------------------ props and maps
console.log("props");
{
    const wrong = PROP_LIST.filter((p) => !sizeAllowed(p.size)).map((p) => p.id);
    check("every prop type is between a mug and a small car", !wrong.length, wrong.join(", "));
}
{
    const q = map.props.find((p) => p.yaw !== 0 && p.yaw % 16384 !== 0), s = PROP_SHAPE[q.type];
    // a ray along the diagonal of a prop turned 45°: the turned box is hit where its corner is, not its square box
    const t = rayProp(q.x - 5, q.y, q.z + 0.3, 1, 0, 0, q.x, q.y, q.z, q.yaw, s[0], s[1], s[2]);
    const corner = Math.hypot(s[0], s[1]);
    check("a turned prop is hit as its exact turned box", Math.abs(5 - t - corner) < 0.02, `hit ${(5 - t).toFixed(3)} m from the middle, the corner is ${corner.toFixed(3)} m`);
}

// ------------------------------------------------------------------ disguise
console.log("disguise");
{
    const { state, h } = duel();
    const crate = map.props.findIndex((q) => PROP_LIST[q.type].id === "crate" && q.z === 0);
    const q = map.props[crate];
    put(h, q.x, q.y + 2.5);
    check("a hider starts as a box", h.prop === PROP_INDEX.box && h.h === PROP_SHAPE[PROP_INDEX.box][2]);
    stepPlayer(map, h, input({ seq: 1, prop: crate + 1 }));
    check("looking at a crate 2.5 m away and asking becomes a crate", h.prop === q.type && h.h === PROP_SHAPE[q.type][2] && h.hx === PROP_SHAPE[q.type][0], `prop ${PROP_LIST[h.prop].id}, box ${h.hx}×${h.hy}×${h.h}`);
    check("and stays clear of every solid", !stuck(map, h));
    const { h: far } = duel();
    put(far, q.x, q.y + 9);
    stepPlayer(map, far, input({ seq: 1, prop: crate + 1 }));
    check("9 m away it is refused", far.prop === PROP_INDEX.box);
    const { h: bogus } = duel();
    put(bogus, q.x, q.y + 2);
    stepPlayer(map, bogus, input({ seq: 1, prop: 9999 }));
    check("a prop that isn't in the map is refused", bogus.prop === PROP_INDEX.box);
    // behind a wall: the wall at x 4..4.4, y −8..−1; a barrel row at y −10.9 x 7..9.25
    const { h: blind } = duel();
    const barrel = map.props.findIndex((p) => PROP_LIST[p.type].id === "barrel" && p.x > 6);
    put(blind, 2.5, -6);
    check("a prop on the far side of a wall can't be taken", !canDisguise(map, blind, barrel));
    // no room: stand in a gap too small for a table
    const { h: tight } = duel();
    put(tight, -14.5, 11.3, 1.6);
    const table = map.props.findIndex((p) => PROP_LIST[p.type].id === "table");
    tight.x = -15.6; tight.y = 9.2;
    check("becoming something too big for where you stand is refused", !canDisguise(map, tight, table), "next to the wall on the deck");
    // a seeker can't disguise
    const { s } = duel();
    put(s, q.x, q.y + 2);
    stepPlayer(map, s, input({ seq: 1, prop: crate + 1 }));
    check("a seeker can't disguise", s.prop === -1);
}

// ------------------------------------------------------------------ lock and turning
console.log("lock");
{
    const { h } = duel();
    put(h, 0, -5);
    const bench = PROP_INDEX.cooler;
    h.prop = bench; h.hx = PROP_SHAPE[bench][0]; h.hy = PROP_SHAPE[bench][1]; h.h = PROP_SHAPE[bench][2];
    stepPlayer(map, h, input({ seq: 1, yaw: quantizeYaw(1.4) }));
    check("unlocked, the prop turns with the view", h.propYaw === quantizeYaw(1.4));
    check("and its collision box turns with it in quarter turns", h.hx === PROP_SHAPE[bench][1] && h.hy === PROP_SHAPE[bench][0]);
    stepPlayer(map, h, input({ seq: 2, yaw: quantizeYaw(1.4), buttons: BTN.lock }));
    check("lock squares it to the nearest quarter turn", h.locked && h.propYaw === squareYaw(quantizeYaw(1.4)) && h.propYaw === 16384);
    stepPlayer(map, h, input({ seq: 3, yaw: quantizeYaw(2.6) }));
    check("locked, turning the view leaves the prop alone", h.propYaw === 16384);
    stepPlayer(map, h, input({ seq: 4, yaw: quantizeYaw(2.6), my: 127 }));
    check("moving lets go", !h.locked && h.propYaw === quantizeYaw(2.6));
}

// ------------------------------------------------------------------ hit shapes swap on the server
console.log("hit shapes");
{
    const { state, h, s } = duel();
    put(h, 0, -6); put(s, -6, -6);
    // a tall thin bollard: a scan aimed 0.9 m up misses a box (0.38 m tall) and hits the bollard
    const shoot = (z) => { const a = aimAt(s, 0, -6, z); run(state, new Map([[2, input({ seq: ++s.seq, buttons: BTN.fire, ...a })], [1, input({ seq: ++h.seq })]])); run(state, new Map([[2, input({ seq: ++s.seq, ...a })], [1, input({ seq: ++h.seq })]]), SCANNER.interval); };
    const hp = () => h.health;
    shoot(0.9);
    check("as a box, a scan 0.9 m up passes over", hp() === 100, `health ${hp()}`);
    h.prop = PROP_INDEX.bollard; const b = PROP_SHAPE[h.prop]; h.hx = b[0]; h.hy = b[1]; h.h = b[2];
    run(state, new Map([[1, input({ seq: ++h.seq })], [2, input({ seq: ++s.seq })]]), 2);
    shoot(0.9);
    check("as a bollard, the same scan hits", hp() === 100 - SCANNER.damage, `health ${hp()}`);
    shoot(0.2);
    check("a scan through a bollard's thin side, 0.2 m up, still hits it", hp() === 100 - SCANNER.damage * 2);
}

// ------------------------------------------------------------------ seeking
console.log("seeking");
{
    const { state, h, s } = duel();
    put(h, 0, -6); put(s, -6, -6);
    const idle = () => input({ seq: ++h.seq });
    // hold the trigger aimed at a wall: charge drains, then the scanner stops
    const wall = { yaw: quantizeYaw(-Math.PI / 2), pitch: 0 };
    let shots = 0;
    for (let i = 0; i < 200; i++) { run(state, new Map([[2, input({ seq: ++s.seq, buttons: BTN.fire, ...wall })], [1, idle()]])); if (state.events.some((e) => e.type === "shot")) shots++; }
    check("the scanner runs dry", shots === Math.floor(SCANNER.charge / SCANNER.cost) && s.charge < SCANNER.cost, shots + " scans on one charge");
    run(state, new Map([[2, input({ seq: ++s.seq, ...wall })], [1, idle()]]), Math.ceil((SCANNER.rest + SCANNER.charge / SCANNER.recharge) * TICK_RATE) + 2);
    check("and charges again after a rest", s.charge === SCANNER.charge);
    check("a wall costs nothing", s.health === 100);
    // a real prop: the crate row along y = −10.8
    const crate = map.props.find((q) => PROP_LIST[q.type].id === "crate" && q.z === 0);
    put(s, crate.x, crate.y + 4);
    const at = aimAt(s, crate.x, crate.y, 0.25);
    run(state, new Map([[2, input({ seq: ++s.seq, buttons: BTN.fire, ...at })], [1, idle()]]));
    check("scanning a real prop costs the seeker", s.health === 100 - SCANNER.penalty, "health " + s.health);
    for (let i = 0; i < 12 && s.alive; i++) run(state, new Map([[2, input({ seq: ++s.seq, buttons: BTN.fire, ...at })], [1, idle()]]), SCANNER.interval);
    check("ten of those and the seeker is out", !s.alive, "alive " + s.alive);
    run(state, new Map());
    check("which ends the round for the hiders when they were the last seeker", state.phase === "end" && state.winner === h.team);
}
{
    const { state, h, s } = duel();
    put(h, 0, -6); put(s, -6, -6);
    const at = aimAt(s, 0, -6, 0.2);
    for (let i = 0; i < 10 && h.alive; i++) run(state, new Map([[2, input({ seq: ++s.seq, buttons: BTN.fire, ...at })], [1, input({ seq: ++h.seq })]]), SCANNER.interval);
    check("scanning the hider finds it", !h.alive && s.finds === 1 && s.health === 100);
    check("finding the last hider ends the round for the seekers", state.phase === "end" && state.winner === s.team);
}
{
    // ping grenade: hiders near where it lands and one far; the outline goes to the thrower alone
    const state = createState(map, { seed: 9 });
    const a = addPlayer(state, map, 1, "A", { team: 1 }), b = addPlayer(state, map, 3, "B", { team: 1 }), c = addPlayer(state, map, 5, "C", { team: 1 }), s = addPlayer(state, map, 2, "S", { team: 2 });
    startRound(state, map); state.phase = "seek"; state.timeLeft = 100 * TICK_RATE; s.frozen = false;
    put(s, -2, -6); put(a, 6.5, -9); put(b, 6, -8); put(c, 12, 8);
    const look = { yaw: quantizeYaw(-0.35), pitch: quantizePitch(-0.25) };
    const quiet = () => new Map([[1, input({ seq: ++a.seq })], [3, input({ seq: ++b.seq })], [5, input({ seq: ++c.seq })]]);
    const m = quiet(); m.set(2, input({ seq: ++s.seq, buttons: BTN.ability, ...look }));
    run(state, m);
    const events = [];
    for (let i = 0; i < 200 && !events.some((e) => e.type === "ping"); i++) { const q = quiet(); q.set(2, input({ seq: ++s.seq, ...look })); run(state, q); events.push(...state.events); }
    const ping = events.find((e) => e.type === "ping"), land = events.find((e) => e.type === "land");
    check("a ping grenade flies, lands and bursts", !!ping && !!land, land ? "landed at " + [land.x, land.y, land.z].map((v) => v.toFixed(1)).join(" ") : "");
    const near = land ? [a, b, c].filter((p) => Math.hypot(p.x - land.x, p.y - land.y, p.z + p.h / 2 - land.z) < PING.radius).map((p) => p.id).sort() : [];
    check("it finds the hiders inside its radius and no others", ping && near.length > 0 && JSON.stringify([...ping.ids].sort()) === JSON.stringify(near), JSON.stringify(ping && ping.ids) + " vs " + JSON.stringify(near));
    check("its result is addressed to the thrower alone", ping && ping.to === s.id);
    check("everyone hears each found prop squeak", events.filter((e) => e.type === "squeak").length === near.length);
    check("one grenade spent of two", s.pings === PING.perRound - 1);
}
{
    // the round: blindfold, the clock, sides swapping, four rounds
    const room = new Room({ map: "greybox", bots: 4, seed: 5, hide: 2, seek: 6 });
    const state = room.state;
    for (let i = 0; i < 3; i++) room.tick();
    const seekers = state.players.filter((p) => p.role === ROLE.seeker), hiders = state.players.filter((p) => p.role === ROLE.hider);
    check("round 1: two hide, two seek", state.phase === "hide" && seekers.length === 2 && hiders.length === 2);
    const where = seekers.map((p) => [p.x, p.y]);
    const sk = seekers[0];
    // a seeker asking to move while blindfolded goes nowhere
    const brain = room.brains.get(sk.id);
    room.brains.delete(sk.id); room.inputs.set(sk.id, input({ seq: 1, my: 127 }));
    for (let i = 0; i < 60; i++) room.tick();
    check("seekers can't move while blindfolded", seekers.every((p, i) => p.x === where[i][0] && p.y === where[i][1] && p.frozen));
    room.brains.set(sk.id, brain);
    for (let i = 0; i < 2 * 60; i++) room.tick();
    check("after the hiding time they can", state.phase === "seek" && seekers.every((p) => !p.frozen));
    const team1 = seekers[0].team;
    for (let i = 0; i < 7 * 60; i++) room.tick();
    check("when the clock runs out with a prop standing, the hiders win the round", state.phase === "end" && state.winner !== team1 && state.teamScore[3 - team1] === 1);
    for (let i = 0; i < ROUND.end * 60 + 5; i++) room.tick();
    check("then the sides swap", state.round === 2 && state.players.filter((p) => p.team === team1).every((p) => p.role === ROLE.hider));
    for (let r = 0; r < 3; r++) for (let i = 0; i < (2 + 6 + ROUND.end) * 60 + 30; i++) room.tick();
    check("after four rounds the match is over", state.phase === "over" && state.round === 4, "phase " + state.phase + ", round " + state.round + ", rounds won " + state.teamScore.slice(1).join(":"));
    for (let i = 0; i < ROUND.over * 60 + 5; i++) room.tick();
    check("and a new one starts", room.state !== state && room.state.round === 1);
}
{
    // taunts: forced on the clock, voluntary ones score more the nearer a seeker is
    const { state, h, s } = duel();
    put(h, 0, -6); put(s, -3, -6);
    h.tauntIn = 5;
    const quiet = () => new Map([[1, input({ seq: ++h.seq })], [2, input({ seq: ++s.seq })]]);
    const ev = []; for (let i = 0; i < 6; i++) { run(state, quiet()); ev.push(...state.events); }
    const forced = ev.find((e) => e.type === "taunt");
    check("a hider who hasn't taunted is made to", forced && forced.forced === 1 && h.tauntIn > 40 * TICK_RATE);
    run(state, new Map([[1, input({ seq: ++h.seq, buttons: BTN.taunt })], [2, input({ seq: ++s.seq })]]));
    const brave = state.events.find((e) => e.type === "taunt");
    check("a taunt 3 m from a seeker scores", brave && !brave.forced && brave.points === Math.round(TAUNT.points + TAUNT.bravery * (1 - 3 / TAUNT.near)), "points " + (brave && brave.points));
    check("and resets the clock", h.tauntIn === TAUNT.interval * TICK_RATE);
    run(state, new Map([[1, input({ seq: ++h.seq })], [2, input({ seq: ++s.seq })]]));
    run(state, new Map([[1, input({ seq: ++h.seq, buttons: BTN.taunt })], [2, input({ seq: ++s.seq })]]));
    check("but not again straight away", !state.events.some((e) => e.type === "taunt"));
}
{
    const { state, h, s } = duel();
    put(h, -2, -4); put(s, 12, 8);
    run(state, new Map([[1, input({ seq: ++h.seq, buttons: BTN.ability, yaw: quantizeYaw(0) })], [2, input({ seq: ++s.seq })]]));
    check("a decoy appears", state.decoys.length === 1 && state.decoys[0].type === h.prop);
    run(state, new Map([[1, input({ seq: ++h.seq })], [2, input({ seq: ++s.seq })]]), 90);
    const d = state.decoys[0];
    check("runs about " + DECOY.distance + " m and stops", Math.abs(d.x - -2 - DECOY.distance) < 0.05 && d.left <= 0, "at x " + d.x.toFixed(2));
    run(state, new Map([[1, input({ seq: ++h.seq, buttons: BTN.ability })], [2, input({ seq: ++s.seq })]]));
    check("only one per round", state.decoys.length === 1 && h.decoys === 0);
    put(s, d.x - 4, d.y);
    const at = aimAt(s, d.x, d.y, 0.2);
    run(state, new Map([[1, input({ seq: ++h.seq })], [2, input({ seq: ++s.seq, buttons: BTN.fire, ...at })]]));
    check("scanning it pops it and costs the seeker", state.decoys.length === 0 && s.health === 100 - SCANNER.penalty);
}

// ------------------------------------------------------------------ client and server agree
console.log("prediction");
{
    const room = new Room({ map: "greybox", bots: 0, seed: 3 });
    const a = new Client(), b = new Client();
    a.attach(new Loopback(room)); a.transport.connect("A");
    b.attach(new Loopback(room)); b.transport.connect("B");
    for (let i = 0; i < 5; i++) { a.tick({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 }); b.tick({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 }); room.tick(); a.frame(1 / 60); b.frame(1 / 60); }
    const hider = room.state.players.find((p) => p.role === ROLE.hider), cl = hider.id === a.id ? a : b;
    const crate = map.props.findIndex((q) => PROP_LIST[q.type].id === "crate");
    const q = map.props[crate];
    put(hider, q.x, q.y + 2.2);
    for (let i = 0; i < 4; i++) { a.tick({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 }); b.tick({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 }); room.tick(); }
    let worst = 0;
    for (let t = 0; t < 240; t++) {
        const c = { mx: t % 60 < 30 ? 60 : -60, my: 0, buttons: t === 100 ? BTN.lock : t > 150 && t < 170 ? BTN.jump : 0, yaw: quantizeYaw(t * 0.03), pitch: 0, prop: t === 20 ? crate + 1 : 0 };
        cl.tick(c);
        (cl === a ? b : a).tick({ mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0 });
        room.tick(); a.frame(1 / 60); b.frame(1 / 60);
        worst = Math.max(worst, cl.stats.lastError);
    }
    check("a hider's disguise is predicted exactly", cl.me.prop === hider.prop && hider.prop === q.type, `client ${PROP_LIST[cl.me.prop].id}, server ${PROP_LIST[hider.prop].id}`);
    check("and its movement as that prop", worst < 1e-6, `worst correction ${worst.toFixed(6)} m`);
    const other = cl === a ? b : a, s = {};
    other.sample(hider.id, s);
    check("the other client sees the new prop", s.prop === q.type);
}

// ------------------------------------------------------------------ the wire
console.log("protocol");
{
    const m = { t: "in", s: 5, mx: -3, my: 127, b: BTN.fire | BTN.lock, yaw: 1234, pitch: -200, pr: 301, vt: 77.5 };
    const back = decode(encode(m));
    check("an input survives the wire", back && back.s === 5 && back.pr === 301 && back.b === m.b && back.vt === 77.5);
}

// ------------------------------------------------------------------ determinism
console.log("determinism");
{
    const play = () => {
        const room = new Room({ map: "greybox", bots: 8, skill: 3, seed: 11, hide: 3, seek: 40 });
        for (let i = 0; i < 60 * 50; i++) room.tick();
        return hashState(room.state);
    };
    const one = play(), two = play();
    check("the same match twice gives the same state", one === two, one.toString(16));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
