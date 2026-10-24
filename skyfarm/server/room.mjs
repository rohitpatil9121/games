import { TICK_RATE, DAY_TICKS } from "../game/data.js";
import { createState, step, addPlayer, removePlayer, findPlayer, finishTalk } from "../game/sim.js";
import { revive, snapshot, worldSnapshot } from "../game/save.js";
import { sell, buy, merchantAt } from "../game/progression.js";
import { encode, decode, cleanInput, cleanText, playerRow, spriteRow, SNAP_EVERY, WORLD_MIN, WORLD_MAX, MAX_PLAYERS, NAME_MAX } from "../game/protocol.js";

/**
 * SKYFARM: one shared farm and the people on it (after TIDEFALL's room.mjs). The room is the authority: it owns
 * the simulation state, feeds it each player's inputs in order, and tells everyone what happened. It knows
 * nothing about sockets or timers (server.mjs drives it; tools/net-test.mjs drives it directly).
 *
 * THE HOST'S FARM. A room starts from the save its host sends (or a fresh farm), with the host as player 1.
 * Every 30 s and after every night the host is sent the farm to keep (`save`); guests are never in it. When
 * the host leaves the room closes, and the guests go back to their own farms.
 *
 * INPUTS (as TIDEFALL). One input per tick per client; each tick the room applies the inputs that have arrived
 * for a player, in order, paid for with credit earned at one per tick and capped at half a second, so a
 * client can neither run fast nor bank up a burst. sim.js steps a player once per input: a client predicting
 * itself with the same inputs lands where the room does.
 *
 * WHAT IS SENT. Every SNAP_EVERY ticks each client gets its own player in full, the others as rows, the sprites
 * and the events since the last snapshot. The world (plots, items, pouch, bridges, progress) goes as a whole
 * when something has changed it (any event that isn't only movement), at most every WORLD_MIN ticks, and every
 * WORLD_MAX ticks anyway; between those the client grows the crops itself with the same code.
 *
 * VALIDATION. The simulation decides every farm action from where the player is; a client only sends buttons
 * and a heading. A finished conversation counts only beside that hermit (or the Crown), a trade only by the
 * moored airship; messages are rate-limited.
 * @module server/room
 */

const QUEUE_MAX = 60, CREDIT_MAX = 30, PER_TICK = 10;
const RATE = 150, BURST = 250;
const SAVE_EVERY = 30 * TICK_RATE;
/** events that only move a player: they don't change the world, so they don't make it go out again */
const MOVEMENT = new Set(["jump", "open", "close", "land", "bump", "stall", "boost", "gust", "tired", "waiting", "talk-open", "trade-open", "not-tired", "wrong-band", "needs-storm", "bridge-needs", "cant-cook"]);

export class Room {
    /** @param {{ world: object, code?: string, game?: object, log?: (line: string) => void }} options game: the host's save snapshot */
    constructor(options) {
        this.world = options.world;
        this.code = options.code || "LOCAL";
        this.log = options.log || (() => {});
        this.state = options.game ? revive(this.world, options.game) : createState(this.world);
        this.state.players[0].id = 1;
        this.clients = new Map();
        this.inputs = new Map();
        this.events = [];
        this.host = 0;
        this.closed = false;
        this.age = 0;
        this.dirty = true; this.worldAt = -1e9; this.saveAt = 0;
        this.bytes = { world: 0, snaps: 0 };
    }

    get humans() { return this.clients.size; }
    get full() { return this.humans >= MAX_PLAYERS; }

    /** The first to join is the host and plays the saved gardener (player 1); the rest join beside the bed. */
    join(send, name) {
        if (this.closed || this.full) return 0;
        const isHost = !this.host;
        const id = isHost ? 1 : this.freeId();
        const client = { id, send, name: cleanText(name, NAME_MAX) || (isHost ? "Host" : "Guest"), queue: [], lastSeq: 0, credit: CREDIT_MAX, ping: 0, pingSent: 0, pingN: 0, tokens: BURST, sentWorld: false };
        this.clients.set(id, client);
        const s = this.state;
        if (isHost) { this.host = id; s.players[0].name = client.name; }
        else addPlayer(s, id, client.name);
        this.sendTo(client, { t: "welcome", id, room: { code: this.code, host: this.host }, tick: s.tick, world: worldSnapshot(s), players: s.players.map((p) => ({ ...p })) });
        client.sentWorld = true;
        this.roster();
        this.log(`${this.code}: ${client.name} joined (${this.humans} here)`);
        return id;
    }

    /** A guest leaving takes their body away; the host leaving closes the farm. Returns true when the room is closed. */
    leave(id) {
        const client = this.clients.get(id);
        if (!client) return this.closed;
        this.clients.delete(id);
        this.inputs.delete(id);
        if (id === this.host) {
            this.closed = true;
            this.broadcast({ t: "closed", why: `${client.name} has gone home, and took the farm with them.` });
            this.log(`${this.code}: the host left; closed`);
            return true;
        }
        removePlayer(this.state, id);
        this.roster();
        this.log(`${this.code}: ${client.name} left (${this.humans} here)`);
        return false;
    }

    freeId() { for (let id = 2; id < 64; id++) if (!this.clients.has(id) && !findPlayer(this.state, id)) return id; throw new Error("no free id"); }

    tick() {
        if (this.closed) return;
        const s = this.state;
        this.age++;
        for (const c of this.clients.values()) {
            if (c.tokens < BURST) c.tokens = Math.min(BURST, c.tokens + RATE / TICK_RATE);
            while (c.queue.length > QUEUE_MAX) c.queue.shift();
            if (c.credit < CREDIT_MAX) c.credit++;
            if (c.queue.length > c.credit) c.queue.splice(0, c.queue.length - c.credit);
            const n = Math.min(c.queue.length, c.credit, PER_TICK);
            c.credit -= n;
            this.inputs.set(c.id, c.queue.splice(0, n));
        }
        const day = Math.floor(s.tick / DAY_TICKS);
        step(s, this.inputs);
        this.note(s.events);
        // a night has passed (everyone slept): the host keeps the morning
        if (Math.floor(s.tick / DAY_TICKS) > day && s.events.some((e) => e.type === "slept")) this.saveAt = 0;
        if (s.tick % SNAP_EVERY === 0) this.sendSnapshots();
        if (this.age - this.saveAt >= SAVE_EVERY || this.saveAt === 0) this.sendSave();
        if (this.age % TICK_RATE === 0) for (const c of this.clients.values()) { c.pingSent = this.age; this.sendTo(c, { t: "ping", n: ++c.pingN }); }
    }

    note(events) {
        for (const e of events) { this.events.push(e); if (!MOVEMENT.has(e.type)) this.dirty = true; }
    }

    sendSnapshots() {
        const s = this.state, rows = s.players.map(playerRow), sp = s.sprites.map(spriteRow);
        // the world, if it's due
        const since = this.age - this.worldAt;
        let w = null;
        if ((this.dirty && since >= WORLD_MIN) || since >= WORLD_MAX) { w = worldSnapshot(s); this.dirty = false; this.worldAt = this.age; }
        for (const c of this.clients.values()) {
            const p = findPlayer(s, c.id);
            if (!p) continue;
            const msg = { t: "snap", tick: s.tick, ack: p.seq || 0, you: p, p: rows.filter((r) => r[0] !== c.id), sp, ev: this.events };
            if (w) msg.w = w;
            const out = encode(msg);
            if (w) this.bytes.world += JSON.stringify(w).length; this.bytes.snaps += out.length;
            c.send(out);
        }
        this.events.length = 0;
    }

    sendSave() {
        this.saveAt = this.age;
        const host = this.clients.get(this.host);
        if (host) this.sendTo(host, { t: "save", game: snapshot(this.state) });
    }

    receive(id, data) {
        const c = this.clients.get(id);
        if (!c || this.closed) return;
        if (--c.tokens < 0) { c.tokens = 0; return; }
        const m = decode(data);
        if (!m) return;
        const s = this.state, p = findPlayer(s, id);
        if (m.t === "in") {
            const input = cleanInput(m);
            if (input && input.seq > c.lastSeq) { c.lastSeq = input.seq; c.queue.push(input); }
        } else if (m.t === "pong") {
            if (m.n === c.pingN) c.ping = Math.min(999, Math.round(((this.age - c.pingSent) * 1000) / TICK_RATE));
        } else if (m.t === "talk" && p && typeof m.who === "string") {
            // only beside the one you talked to
            const h = (this.world.data.hermits || []).find((q) => q.id === m.who);
            const crown = this.world.islands.find((i) => i.landmark.kind === "giant-tree");
            const near = h ? Math.hypot(p.x - h.x, p.y - h.y) < 4 : m.who === "crown" && crown ? Math.hypot(p.x - crown.landmark.x, p.y - crown.landmark.y) < 4 : m.who === "bram";
            if (!near) return;
            this.direct(s, id, () => finishTalk(s, m.who));
        } else if (m.t === "trade" && p && typeof m.what === "string" && Number.isInteger(m.n) && m.n > 0 && m.n <= 99) {
            const M = this.world.data.merchant;
            if (!M || merchantAt(s.tick).phase !== "moored" || Math.hypot(p.x - M.gangway[0], p.y - M.gangway[1]) > 5) return;
            this.direct(s, id, () => (m.op === "sell" ? sell(s, m.what, m.n) : m.op === "buy" ? buy(s, m.what, m.n) : 0));
        }
    }

    /** Run a player's request on the state as that player; its events are marked as theirs and direct (not predicted). */
    direct(s, id, fn) {
        const was = s.player;
        s.player = findPlayer(s, id) || was;
        const from = s.events.length;
        fn();
        for (let k = from; k < s.events.length; k++) { s.events[k].by = id; s.events[k].direct = 1; }
        this.note(s.events.slice(from));
        s.events.length = from;
        s.player = was;
        this.dirty = true;
    }

    roster() { this.broadcast({ t: "roster", host: this.host, players: this.state.players.map((p) => ({ id: p.id, name: p.name })) }); }
    sendTo(client, message) { client.send(encode(message)); }
    broadcast(message) { const data = encode(message); for (const c of this.clients.values()) c.send(data); }
}
