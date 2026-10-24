import { TICK_RATE, ROUND, MAX_REWIND } from "../game/data.js";
import { createState, addPlayer, removePlayer, findPlayer, step } from "../game/sim.js";
import { getMap, PLAY_MAPS, MAP_LIST } from "../game/maps/index.js";
import { encode, decode, cleanInput, cleanText, playerRow, decoyRow, pingRow, youOf, SNAP_EVERY, NAME_MAX, CHAT_MAX } from "../game/protocol.js";
import { createBrain, think } from "../game/bots.js";

/**
 * One match and the people in it. Copied from BREACH's room and changed only where DECOY differs:
 * teams instead of a free-for-all, bots that hide as well as seek, decoys and grenades in the snapshot,
 * and events meant for one player (a ping grenade's result goes to its thrower alone).
 *
 * The room is the authority. It knows nothing about sockets or timers: whoever owns it calls tick() 60
 * times a second and hands it each arriving message with receive(). The Node server drives it from
 * WebSockets; Practice mode drives the very same class inside the page (game/net.js, Loopback).
 *
 * INPUTS. Each tick the room applies every input that has arrived for a player, in order, paid for with
 * credit earned at one per tick (so a stall is caught up exactly along the predicted path, and nobody
 * can run fast). LAG COMPENSATION: each input says which server tick its sender was looking at; the
 * simulation rewinds the hiders by that much (capped) when the input fires.
 * @module server/room
 */

const BOT_NAMES = ["Pip", "Moss", "Tuck", "Wren", "Bramble", "Nib", "Sorrel", "Quill", "Fen", "Juniper", "Clove", "Ash"];
const QUEUE_MAX = 60;
const CREDIT_MAX = 30, PER_TICK = 10;
const NOTHING = Object.freeze([]);
const RATE = 150, BURST = 250;

export class Room {
    /**
     * @param {{ code?: string, map?: string, bots?: number, skill?: number, open?: boolean, seed?: number,
     *           rounds?: number, hide?: number, seek?: number, rewind?: boolean, log?: (line: string) => void }} [options]
     *        bots: fill the room with bots up to this many players in all. open: listed for quick play.
     */
    constructor(options = {}) {
        this.code = options.code || "LOCAL";
        this.settings = {
            map: MAP_LIST.includes(options.map) ? options.map : PLAY_MAPS[0] || MAP_LIST[0],
            bots: Math.max(0, Math.min(ROUND.maxPlayers, options.bots ?? 0)),
            skill: Math.max(1, Math.min(3, options.skill ?? 2)),
            open: options.open ?? true,
        };
        this.options = { rounds: options.rounds, hide: options.hide, seek: options.seek };
        this.rewind = options.rewind ?? true;
        this.seed = (options.seed ?? 1) >>> 0;
        this.log = options.log || (() => {});
        /** @type {Map<number, object>} people, by player id */
        this.clients = new Map();
        /** @type {Map<number, object>} bot memory, by player id */
        this.brains = new Map();
        this.inputs = new Map();
        this.events = [];
        this.host = 0;
        this.nextId = 1;
        this.age = 0;
        this.startMatch();
    }

    get humans() { return this.clients.size; }
    get full() { return this.humans >= ROUND.maxPlayers; }
    info() { return { code: this.code, host: this.host, ...this.settings, players: this.humans, max: ROUND.maxPlayers }; }

    // ------------------------------------------------------------------ people

    join(send, name) {
        const id = this.freeId();
        const client = { id, send, name: cleanText(name, NAME_MAX) || "Player", queue: [], lastSeq: 0, credit: CREDIT_MAX, ping: 0, sent: new Map(), sentScores: new Map(), pingSent: 0, pingN: 0, tokens: BURST, chatAt: -1000 };
        this.clients.set(id, client);
        if (!this.host) this.host = id;
        this.fillBots();
        addPlayer(this.state, this.map, id, client.name, { team: this.smallerTeam() });
        this.sendTo(client, { t: "welcome", id, room: this.info(), tick: this.state.tick });
        this.roster();
        this.log(`${this.code}: ${client.name} joined (${this.humans} here)`);
        return id;
    }

    leave(id) {
        const client = this.clients.get(id);
        if (!client) return;
        this.clients.delete(id);
        for (const c of this.clients.values()) { c.sent.delete(id); c.sentScores.delete(id); }
        this.inputs.delete(id);
        removePlayer(this.state, id);
        if (this.host === id) this.host = this.clients.keys().next().value || 0;
        this.fillBots();
        this.roster();
        this.log(`${this.code}: ${client.name} left (${this.humans} here)`);
    }

    freeId() {
        for (let n = 0; n < 250; n++) {
            const id = this.nextId;
            this.nextId = (this.nextId % 250) + 1;
            if (!findPlayer(this.state, id)) return id;
        }
        throw new Error("room has no free ids");
    }

    smallerTeam() {
        let a = 0, b = 0;
        for (const p of this.state.players) { if (p.team === 1) a++; else if (p.team === 2) b++; }
        return a <= b ? 1 : 2;
    }

    /** Keep the room at its bot-fill size: add bots while there is space, drop one when a person takes it. */
    fillBots() {
        const want = Math.max(0, Math.min(ROUND.maxPlayers, this.settings.bots) - this.humans);
        const bots = this.state.players.filter((p) => this.brains.has(p.id));
        for (let i = bots.length; i > want; i--) {
            const big = this.smallerTeam() === 1 ? 2 : 1, at = bots.findLastIndex((b) => b.team === big);
            const [bot] = bots.splice(at < 0 ? bots.length - 1 : at, 1);
            removePlayer(this.state, bot.id); this.brains.delete(bot.id); this.inputs.delete(bot.id);
        }
        for (let i = bots.length; i < want; i++) {
            const id = this.freeId(), taken = new Set(this.state.players.map((p) => p.name));
            const name = BOT_NAMES.find((n) => !taken.has(n)) || "Bot " + id;
            addPlayer(this.state, this.map, id, name, { team: this.smallerTeam(), bot: this.settings.skill });
            this.brains.set(id, createBrain(id, this.settings.skill, this.seed + id * 7919));
        }
    }

    // ------------------------------------------------------------------ the match

    /** Start (or restart) a match with the room's settings, keeping everyone who is here. */
    startMatch() {
        const old = this.state ? this.state.players : [];
        this.map = getMap(this.settings.map);
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        this.state = createState(this.map, { seed: this.seed, ...this.options });
        this.inputs.clear();
        this.events.length = 0;
        this.brains.clear();
        // people keep their places; teams are dealt again so they stay even
        for (const p of old) {
            if (!this.clients.has(p.id)) continue;
            addPlayer(this.state, this.map, p.id, p.name, { team: this.smallerTeam() });
            const c = this.clients.get(p.id);
            c.queue.length = 0; c.lastSeq = 0; c.sent.clear(); c.sentScores.clear();
        }
        this.fillBots();
        this.broadcast({ t: "start", room: this.info(), tick: this.state.tick });
        this.roster();
    }

    /** One simulation tick. Call at 60 Hz. */
    tick() {
        const state = this.state;
        this.age++;
        for (const c of this.clients.values()) {
            if (c.tokens < BURST) c.tokens = Math.min(BURST, c.tokens + RATE / TICK_RATE);
            while (c.queue.length > QUEUE_MAX) c.queue.shift();
            if (c.credit < CREDIT_MAX) c.credit++;
            if (c.queue.length > c.credit) c.queue.splice(0, c.queue.length - c.credit);
            const n = Math.min(c.queue.length, c.credit, PER_TICK);
            if (!n) { this.inputs.set(c.id, NOTHING); continue; }
            c.credit -= n;
            const batch = c.queue.splice(0, n);
            for (const input of batch) input.lag = this.rewind ? Math.max(0, Math.min(MAX_REWIND, state.tick + 1 - input.vt)) : 0;
            this.inputs.set(c.id, batch);
        }
        for (const [id, brain] of this.brains) {
            const bot = findPlayer(state, id);
            const input = bot && think(state, this.map, bot, brain);
            if (input) this.inputs.set(id, input); else this.inputs.delete(id);
        }

        step(state, this.map, this.inputs);
        for (const e of state.events) this.events.push({ ...e, tick: state.tick });

        if (state.phase === "over" && state.timeLeft <= 0) { this.startMatch(); return; }
        if (state.tick % SNAP_EVERY === 0) this.sendSnapshots();
        if (this.age % TICK_RATE === 0) for (const c of this.clients.values()) { c.pingSent = this.age; this.sendTo(c, { t: "ping", n: ++c.pingN }); }
    }

    /** Each client gets its own player in full, and of everything else only what differs from the last snapshot it was sent. */
    sendSnapshots() {
        const s = this.state;
        const rows = s.players.map(playerRow);
        const scores = s.players.map((p) => [p.id, p.score, p.finds, p.deaths, this.clients.get(p.id)?.ping || 0]);
        const decoys = s.decoys.map(decoyRow), pings = s.pings.map(pingRow);
        const events = this.events.map(wireEvent);
        for (const c of this.clients.values()) {
            const p = findPlayer(s, c.id);
            if (!p) continue;
            const changed = [], changedScores = [];
            for (const row of rows) {
                const was = c.sent.get(row[0]);
                if (was && same(was, row)) continue;
                c.sent.set(row[0], row); changed.push(row);
            }
            for (const row of scores) {
                const was = c.sentScores.get(row[0]);
                if (was && same(was, row)) continue;
                c.sentScores.set(row[0], row); changedScores.push(row);
            }
            this.sendTo(c, {
                t: "snap", tick: s.tick, ack: p.seq, ph: s.phase, late: s.late, round: s.round, rounds: s.rounds, tl: Math.max(0, s.timeLeft), ts: s.teamScore, win: s.winner, st: s.seekTeam,
                you: youOf(p), p: changed, sc: changedScores, d: decoys, g: pings,
                // an event meant for one player (what a ping grenade found) goes to that player alone
                ev: events.filter((e) => !e.to || e.to === c.id),
            });
        }
        this.events.length = 0;
    }

    // ------------------------------------------------------------------ messages

    /** A message arrived from a client. Nothing in it is trusted. */
    receive(id, data) {
        const c = this.clients.get(id);
        if (!c) return;
        if (--c.tokens < 0) { c.tokens = 0; return; }
        const m = decode(data);
        if (!m) return;
        if (m.t === "in") {
            const input = cleanInput(m);
            if (input && input.seq > c.lastSeq) { c.lastSeq = input.seq; c.queue.push(input); }
        } else if (m.t === "pong") {
            if (m.n === c.pingN) c.ping = Math.min(999, Math.round(((this.age - c.pingSent) * 1000) / TICK_RATE));
        } else if (m.t === "chat") {
            const text = cleanText(m.text, CHAT_MAX);
            if (text && this.age - c.chatAt >= TICK_RATE / 2) { c.chatAt = this.age; this.broadcast({ t: "chat", id, name: c.name, text }); }
        } else if (m.t === "setup" && id === this.host) {
            const s = this.settings;
            if (MAP_LIST.includes(m.map)) s.map = m.map;
            if (Number.isFinite(m.bots)) s.bots = Math.max(0, Math.min(ROUND.maxPlayers, Math.round(m.bots)));
            if (Number.isFinite(m.skill)) s.skill = Math.max(1, Math.min(3, Math.round(m.skill)));
            this.startMatch();
        }
    }

    roster() {
        this.broadcast({ t: "roster", host: this.host, players: this.state.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot })) });
    }

    sendTo(client, message) { client.send(encode(message)); }
    broadcast(message) { const data = encode(message); for (const c of this.clients.values()) c.send(data); }
}

const same = (a, b) => { for (let i = 1; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/** Events as they travel: positions rounded to the centimetre. */
function wireEvent(e) {
    const r = (v) => Math.round(v * 100) / 100;
    if (e.type === "shot") return { ...e, o: e.o.map(r), end: e.end.map(r) };
    if ("x" in e) return { ...e, x: r(e.x), y: r(e.y), z: r(e.z) };
    return e;
}
