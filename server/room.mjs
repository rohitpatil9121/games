import { TICK_RATE, MATCH, MAX_REWIND } from "../game/data.js";
import { createState, addPlayer, removePlayer, findPlayer, step } from "../game/sim.js";
import { fairIsland } from "../game/fairness.js";
import { encode, decode, cleanInput, cleanText, playerRow, lootRow, SNAP_EVERY, NAME_MAX, CHAT_MAX } from "../game/protocol.js";
import { createBrain, think } from "../game/bots.js";

/**
 * One match and the people in it. Copied from BREACH's room.mjs and adapted to TIDEFALL: teams and an
 * island instead of a map and a mode, loot in the snapshot instead of pickups and rockets.
 *
 * The room is the authority: it owns the simulation state, feeds it each player's inputs in order, and
 * tells everyone what happened. It knows nothing about sockets or timers. The Node server (server.mjs)
 * drives it from WebSockets; Practice mode drives the very same class inside the page (game/net.js,
 * Loopback), so there is one code path for online and offline play.
 *
 * INPUTS (as BREACH). One input per tick per client; each tick the room applies every input that has
 * arrived for a player, in order, paid for with credit earned at one per tick and capped at half a second.
 *
 * LAG COMPENSATION. Each input says which server tick its sender was drawing; the room turns that into
 * "how many ticks ago", capped at MAX_REWIND (200 ms), and a shove is tested against where the others were
 * then (game/sim.js).
 *
 * VALIDATION. The simulation decides every pickup (in reach, room in the pack, not already held), every
 * bank (inside your own camp), every grapple (a ray from the player's own position, at most its range)
 * and carried weight; a client only ever sends buttons and angles. Messages are rate-limited.
 *
 * THE ISLAND. A new match makes a new island from the room's seed, skipping ahead to the next seed if the
 * fairness check fails (game/fairness.js); only the seed that passed is sent.
 * @module server/room
 */

const BOT_NAMES = ["Barnacle", "Cutter", "Driftwood", "Eddy", "Flotsam", "Gully", "Harbor", "Jetsam", "Kelp", "Lagan", "Marlin", "Nettle"];
const QUEUE_MAX = 60;
const CREDIT_MAX = 30, PER_TICK = 10;
const NOTHING = Object.freeze([]);
const RATE = 150, BURST = 250;

export class Room {
    /**
     * @param {{ code?: string, teams?: number, bots?: number, skill?: number, open?: boolean, seed?: number,
     *           rewind?: boolean, log?: (line: string) => void }} [options]
     *        bots: fill the room with bots up to this many players in all. open: listed for quick play.
     */
    constructor(options = {}) {
        this.code = options.code || "LOCAL";
        this.settings = {
            teams: Math.max(2, Math.min(MATCH.maxTeams, options.teams ?? 2)),
            bots: Math.max(0, Math.min(MATCH.maxPlayers, options.bots ?? 0)),
            skill: Math.max(1, Math.min(3, options.skill ?? 2)),
            open: options.open ?? true,
        };
        this.rewind = options.rewind ?? true;
        this.seed = (options.seed ?? 1) >>> 0;
        this.log = options.log || (() => {});
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
    info() { return { code: this.code, host: this.host, ...this.settings, seed: this.island.seed, players: this.humans, max: MATCH.maxPlayers }; }

    // ------------------------------------------------------------------ people

    /** @param {boolean} [assist] the player asked for more breath (shown to everyone on the scoreboard) */
    join(send, name, assist = false) {
        const id = this.freeId();
        const client = { id, send, name: cleanText(name, NAME_MAX) || "Player", queue: [], lastSeq: 0, credit: CREDIT_MAX, ping: 0,
            sent: new Map(), sentScores: new Map(), sentLoot: new Map(), pingSent: 0, pingN: 0, tokens: BURST, chatAt: -1000 };
        this.clients.set(id, client);
        if (!this.host) this.host = id;
        this.fillBots();
        addPlayer(this.state, this.island, id, client.name, { team: this.smallerTeam(), assist });
        client.assist = !!assist;
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

    /** The team with fewest players (the lowest number on a tie). */
    smallerTeam() {
        const count = [0, 0, 0, 0];
        for (const p of this.state.players) count[p.team]++;
        let best = 0;
        for (let t = 1; t < this.settings.teams; t++) if (count[t] < count[best]) best = t;
        return best;
    }

    /** Keep the room at its bot-fill size: add bots while there is space, drop one when a person takes it. */
    fillBots() {
        const want = Math.max(0, Math.min(MATCH.maxPlayers, this.settings.bots) - this.humans);
        const bots = this.state.players.filter((p) => this.brains.has(p.id));
        for (let i = bots.length; i > want; i--) {
            // the bot to go is the newest on the biggest team
            const count = [0, 0, 0, 0];
            for (const p of this.state.players) count[p.team]++;
            let big = 0;
            for (let t = 1; t < this.settings.teams; t++) if (count[t] > count[big]) big = t;
            const at = bots.findLastIndex((b) => b.team === big);
            const [bot] = bots.splice(at < 0 ? bots.length - 1 : at, 1);
            removePlayer(this.state, bot.id); this.brains.delete(bot.id); this.inputs.delete(bot.id);
        }
        for (let i = bots.length; i < want; i++) {
            const id = this.freeId(), taken = new Set(this.state.players.map((p) => p.name));
            const name = BOT_NAMES.find((n) => !taken.has(n)) || "Bot " + id;
            const p = addPlayer(this.state, this.island, id, name, { team: this.smallerTeam(), bot: this.settings.skill });
            this.brains.set(id, createBrain(p, this.settings.skill, this.seed + id * 7919));
        }
    }

    // ------------------------------------------------------------------ the match

    /** Start (or restart) a match on a fresh island, keeping everyone who is here. */
    startMatch() {
        const old = this.state ? this.state.players : [];
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        const fair = fairIsland(this.seed, this.settings.teams);
        this.island = fair.island;
        this.state = createState(this.island);
        this.inputs.clear();
        this.events.length = 0;
        this.brains.clear();
        for (const p of old) {
            if (!this.clients.has(p.id)) continue;
            const c = this.clients.get(p.id);
            addPlayer(this.state, this.island, p.id, p.name, { team: this.smallerTeam(), assist: c.assist });
            c.queue.length = 0; c.lastSeq = 0; c.sent.clear(); c.sentScores.clear(); c.sentLoot.clear();
        }
        this.fillBots();
        this.log(`${this.code}: new island ${this.island.seed} for ${this.settings.teams} teams${fair.tries > 1 ? ` (seed ${fair.tries - 1} skipped as unfair)` : ""}`);
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
        for (const [id, brain] of this.brains) {
            const bot = findPlayer(state, id);
            const input = bot && think(state, this.island, bot, brain);
            if (input) this.inputs.set(id, input); else this.inputs.delete(id);
        }

        step(state, this.island, this.inputs);
        for (const e of state.events) this.events.push(e);

        if (state.phase === "over" && state.overTicks <= 0) { this.startMatch(); return; }
        if (state.tick % SNAP_EVERY === 0) this.sendSnapshots();
        if (this.age % TICK_RATE === 0) for (const c of this.clients.values()) { c.pingSent = this.age; this.sendTo(c, { t: "ping", n: ++c.pingN }); }
    }

    /** Each client gets its own player in full, and of everything else only what differs from what it was last sent. */
    sendSnapshots() {
        const s = this.state;
        const rows = s.players.map(playerRow);
        const scores = s.players.map((p) => [p.id, p.banked, p.lost, p.steals, p.shoves, this.clients.get(p.id)?.ping || 0]);
        const loot = s.loot.map(lootRow);
        const present = new Set(loot.map((r) => r[0]));
        for (const c of this.clients.values()) {
            const p = findPlayer(s, c.id);
            if (!p) continue;
            const changed = [], changedScores = [], changedLoot = [], gone = [];
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
            for (const row of loot) {
                const was = c.sentLoot.get(row[0]);
                if (was && sameRow(was, row)) continue;
                c.sentLoot.set(row[0], row); changedLoot.push(row);
            }
            for (const id of c.sentLoot.keys()) if (!present.has(id)) { gone.push(id); c.sentLoot.delete(id); }
            this.sendTo(c, { t: "snap", tick: s.tick, ack: p.seq, ph: s.phase, ot: s.overTicks, win: s.winner, bank: s.bank,
                you: p, p: changed, sc: changedScores, l: changedLoot, lg: gone, ev: this.events });
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
        } else if (m.t === "pong") {
            if (m.n === c.pingN) c.ping = Math.min(999, Math.round(((this.age - c.pingSent) * 1000) / TICK_RATE));
        } else if (m.t === "chat") {
            const text = cleanText(m.text, CHAT_MAX);
            if (text && this.age - c.chatAt >= TICK_RATE / 2) { c.chatAt = this.age; this.broadcast({ t: "chat", id, name: c.name, text }); }
        } else if (m.t === "setup" && id === this.host) {
            const s = this.settings;
            if (Number.isFinite(m.teams)) s.teams = Math.max(2, Math.min(MATCH.maxTeams, Math.round(m.teams)));
            if (Number.isFinite(m.bots)) s.bots = Math.max(0, Math.min(MATCH.maxPlayers, Math.round(m.bots)));
            if (Number.isFinite(m.skill)) s.skill = Math.max(1, Math.min(3, Math.round(m.skill)));
            this.startMatch();
        }
    }

    roster() {
        this.broadcast({ t: "roster", host: this.host, players: this.state.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, assist: p.assist ? 1 : 0 })) });
    }

    sendTo(client, message) { client.send(encode(message)); }
    broadcast(message) { const data = encode(message); for (const c of this.clients.values()) c.send(data); }
}

function sameRow(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
