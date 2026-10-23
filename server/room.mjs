import { TICK_RATE, MATCH, MAX_REWIND } from "../game/data.js";
import { createState, addPlayer, removePlayer, findPlayer, step, setFold } from "../game/sim.js";
import { ROOMS, ROOM_IDS } from "../game/rooms/index.js";
import { encode, decode, cleanInput, cleanText, cleanFold, cleanMode, planeRow, SNAP_EVERY, NAME_MAX, CHAT_MAX } from "../game/protocol.js";

/**
 * One match and the planes in it. Copied from TIDEFALL's room.mjs (itself BREACH's) and adapted: a room
 * file and a mode instead of an island and teams, planes in the snapshot instead of players and loot.
 *
 * The Room is the authority: it owns the simulation state, feeds it each player's inputs in order, and
 * tells everyone what happened. It knows nothing about sockets or timers. The Node server (server.mjs)
 * drives it from WebSockets; Practice drives the very same class inside the page (game/net.js, Loopback),
 * so there is one code path for online and offline play.
 *
 * INPUTS (as BREACH and TIDEFALL). One input per tick per client; each tick the room applies every input
 * that has arrived for a player, in order, paid for with credit earned at one per tick and capped at half a
 * second. Each applied input is one tick of that plane's own clock, and the plane flies through the air of
 * that tick, so a prediction is exact however late its inputs arrive.
 *
 * LAG COMPENSATION. Each input says which server tick its sender was drawing; the room turns that into
 * "how many ticks ago", capped at MAX_REWIND (200 ms). Tags (stage 4) test against where the others were then.
 *
 * VALIDATION. The simulation decides everything (flight, collisions, rings); a client only ever sends
 * pitch, roll and buttons, clamped by cleanInput. Messages are rate-limited.
 *
 * BOTS. `fillBots` keeps the room at its bot-fill size; their brains come in stage 5 (game/bots.js).
 * @module server/room
 */

const BOT_NAMES = ["Crane", "Dart", "Fold", "Glide", "Kite", "Loop", "Origami", "Swoop", "Tissue", "Vellum", "Wisp", "Zephyr"];
const QUEUE_MAX = 60;
const CREDIT_MAX = 30, PER_TICK = 10;
const NOTHING = Object.freeze([]);
const RATE = 150, BURST = 250;

export class Room {
    /**
     * @param {{ code?: string, room?: string, mode?: string, set?: number, bots?: number, skill?: number, open?: boolean, seed?: number,
     *           rewind?: boolean, log?: (line: string) => void, brains?: { create: Function, think: Function } }} [options]
     *        bots: fill the room with bots up to this many planes in all. open: listed for quick play.
     */
    constructor(options = {}) {
        this.code = options.code || "LOCAL";
        this.settings = {
            room: ROOMS[options.room] ? options.room : ROOM_IDS[0],
            mode: cleanMode(options.mode),
            set: Math.max(0, Math.round(options.set || 0)),
            bots: Math.max(0, Math.min(MATCH.maxPlayers, options.bots ?? 0)),
            skill: Math.max(1, Math.min(3, options.skill ?? 2)),
            open: options.open ?? true,
        };
        this.rewind = options.rewind ?? true;
        this.seed = (options.seed ?? 1) >>> 0;
        this.log = options.log || (() => {});
        /** bot brains (stage 5); without them bots fly hands-off */
        this.ai = options.brains || null;
        this.clients = new Map();
        this.brains = new Map();
        this.inputs = new Map();
        this.events = [];
        this.host = 0;
        this.nextId = 1;
        this.age = 0;
        this.startMatch();
    }

    get humans() { return this.clients.size; }
    get full() { return this.humans >= MATCH.maxPlayers; }
    info() { return { code: this.code, host: this.host, ...this.settings, seed: this.state.seed, players: this.humans, max: MATCH.maxPlayers }; }

    // ------------------------------------------------------------------ people

    join(send, name, fold) {
        const id = this.freeId();
        const client = { id, send, name: cleanText(name, NAME_MAX) || "Player", queue: [], lastSeq: 0, credit: CREDIT_MAX, ping: 0,
            sent: new Map(), sentScores: new Map(), pingSent: 0, pingN: 0, tokens: BURST, chatAt: -1000, fold: cleanFold(fold) };
        this.clients.set(id, client);
        if (!this.host) this.host = id;
        this.fillBots();
        addPlayer(this.state, id, client.name, { fold: client.fold });
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

    /** Keep the room at its bot-fill size: add bots while there is space, drop the newest when a person takes it. */
    fillBots() {
        const want = Math.max(0, Math.min(MATCH.maxPlayers, this.settings.bots) - this.humans);
        const bots = this.state.players.filter((p) => p.bot);
        for (let i = bots.length; i > want; i--) {
            const bot = bots.pop();
            removePlayer(this.state, bot.id); this.brains.delete(bot.id); this.inputs.delete(bot.id);
        }
        for (let i = bots.length; i < want; i++) {
            const id = this.freeId(), taken = new Set(this.state.players.map((p) => p.name));
            const name = BOT_NAMES.find((n) => !taken.has(n)) || "Bot " + id;
            const fold = ["glider", "dart", "stunt"][id % 3];
            const p = addPlayer(this.state, id, name, { fold, bot: this.settings.skill });
            if (this.ai) this.brains.set(id, this.ai.create(p, this.settings.skill, this.seed + id * 7919));
        }
    }

    // ------------------------------------------------------------------ the match

    /** Start (or restart) a round, keeping everyone who is here. */
    startMatch() {
        const old = this.state ? this.state.players : [];
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        this.state = createState(ROOMS[this.settings.room], this.seed, { mode: this.settings.mode, set: this.settings.set });
        this.inputs.clear();
        this.events.length = 0;
        this.brains.clear();
        for (const p of old) {
            const c = this.clients.get(p.id);
            if (!c) continue;
            addPlayer(this.state, p.id, p.name, { fold: p.fold });
            c.queue.length = 0; c.lastSeq = 0; c.sent.clear(); c.sentScores.clear();
        }
        this.fillBots();
        this.log(`${this.code}: new round in the ${this.settings.room}, ${this.settings.mode}`);
        this.broadcast({ t: "start", room: this.info(), tick: this.state.tick });
        this.roster();
    }

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
        // bots think in a turning order, so none always goes last
        const brains = [...this.brains], first = brains.length ? this.age % brains.length : 0;
        for (let k = 0; k < brains.length; k++) {
            const [id, brain] = brains[(first + k) % brains.length];
            const bot = findPlayer(state, id);
            const input = bot && this.ai.think(state, bot, brain);
            if (input) this.inputs.set(id, input); else this.inputs.delete(id);
        }

        step(state, this.inputs);
        for (const e of state.events) this.events.push(e);

        if (state.phase === "over" && state.overTicks <= 0) { this.startMatch(); return; }
        if (state.tick % SNAP_EVERY === 0) this.sendSnapshots();
        if (this.age % TICK_RATE === 0) for (const c of this.clients.values()) { c.pingSent = this.age; this.sendTo(c, { t: "ping", n: ++c.pingN }); }
    }

    /** Each client gets its own plane in full, and of everything else only what differs from what it was last sent. */
    sendSnapshots() {
        const s = this.state;
        const rows = s.players.map(planeRow);
        const scores = s.players.map((p) => [p.id, p.run ? p.run.next : 0, p.run ? p.run.ticks : 0, p.best, this.clients.get(p.id)?.ping || 0]);
        for (const c of this.clients.values()) {
            const p = findPlayer(s, c.id);
            if (!p) continue;
            const changed = [], changedScores = [];
            for (const row of rows) {
                if (row[0] === c.id) continue;
                const was = c.sent.get(row[0]);
                if (was && sameRow(was, row)) continue;
                c.sent.set(row[0], row); changed.push(row);
            }
            for (const row of scores) {
                const was = c.sentScores.get(row[0]);
                if (was && sameRow(was, row)) continue;
                c.sentScores.set(row[0], row); changedScores.push(row);
            }
            this.sendTo(c, { t: "snap", tick: s.tick, ack: p.seq, ph: s.phase, ot: s.overTicks, you: p, p: changed, sc: changedScores, ev: this.events });
        }
        this.events.length = 0;
    }

    // ------------------------------------------------------------------ messages

    receive(id, data) {
        const c = this.clients.get(id);
        if (!c) return;
        if (--c.tokens < 0) { c.tokens = 0; return; }
        const m = decode(data);
        if (!m) return;
        if (m.t === "in") {
            const input = cleanInput(m);
            if (input && input.seq > c.lastSeq) { c.lastSeq = input.seq; c.queue.push(input); }
        } else if (m.t === "fold") {
            const p = findPlayer(this.state, id);
            if (p) { setFold(this.state, p, cleanFold(m.fold)); c.fold = p.fold; this.roster(); }
        } else if (m.t === "pong") {
            if (m.n === c.pingN) c.ping = Math.min(999, Math.round(((this.age - c.pingSent) * 1000) / TICK_RATE));
        } else if (m.t === "chat") {
            const text = cleanText(m.text, CHAT_MAX);
            if (text && this.age - c.chatAt >= TICK_RATE / 2) { c.chatAt = this.age; this.broadcast({ t: "chat", id, name: c.name, text }); }
        } else if (m.t === "setup" && id === this.host) {
            const s = this.settings;
            if (typeof m.room === "string" && ROOMS[m.room]) s.room = m.room;
            if (typeof m.mode === "string") s.mode = cleanMode(m.mode);
            if (Number.isFinite(m.set)) s.set = Math.max(0, Math.min(ROOMS[s.room].rings.length - 1, Math.round(m.set)));
            if (Number.isFinite(m.bots)) s.bots = Math.max(0, Math.min(MATCH.maxPlayers, Math.round(m.bots)));
            if (Number.isFinite(m.skill)) s.skill = Math.max(1, Math.min(3, Math.round(m.skill)));
            this.startMatch();
        }
    }

    roster() {
        this.broadcast({ t: "roster", host: this.host, players: this.state.players.map((p) => ({ id: p.id, name: p.name, fold: p.fold, bot: p.bot })) });
    }

    sendTo(client, message) { client.send(encode(message)); }
    broadcast(message) { const data = encode(message); for (const c of this.clients.values()) c.send(data); }
}

function sameRow(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
