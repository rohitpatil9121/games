import { createPlayer, stepPlayer } from "./sim.js";
import { generateIsland } from "./island.js";
import { waterAt } from "./tide.js";
import { encode, decode, byteLength, FLAG, INTERP_TICKS, SNAP_EVERY } from "./protocol.js";

/**
 * TIDEFALL: the client's side of the network. Copied from BREACH's net.js (prediction, reconciliation,
 * interpolation, the three transports) and adapted.
 *
 * PREDICTION. Each tick the client sends its input and applies it at once to its own copy of its player,
 * with the same stepPlayer() the server runs. One thing is new: stepPlayer needs the water level, and
 * the water depends on the tick. The client predicts the tick the server will apply each input on: an
 * input acknowledged by the snapshot for server tick T was applied on T, so the inputs still pending
 * after it will be applied on T+1, T+2 and so on. Replays use those ticks; new inputs carry on counting.
 * When the server applies a burst of late inputs in one tick they share that tick's level, which is at
 * most a few millimetres different; reconciliation eases that away like any other small correction.
 *
 * RECONCILIATION, INTERPOLATION, transports: as BREACH (see its net.js and README).
 * @module game/net
 */

const SNAP_DISTANCE = 2.5;
const BUFFER = 40;

// ------------------------------------------------------------------ transports

/** A room in this page (Practice). Messages still go through encode() and decode(). */
export class Loopback {
    constructor(room) { this.room = room; this.id = 0; this.onmessage = null; this.onclose = null; this.open = false; }
    connect(name) {
        this.open = true;
        this.id = this.room.join((data) => { if (this.open && this.onmessage) this.onmessage(data); }, name);
    }
    send(data) { if (this.open) this.room.receive(this.id, data); }
    close() { if (!this.open) return; this.open = false; this.room.leave(this.id); }
}

/** A WebSocket to a TIDEFALL server. */
export class SocketTransport {
    constructor(url) { this.url = url; this.onmessage = null; this.onclose = null; this.onopen = null; this.open = false; this.ws = null; }
    connect() {
        const ws = (this.ws = new WebSocket(this.url));
        ws.binaryType = "arraybuffer";
        ws.onopen = () => { this.open = true; if (this.onopen) this.onopen(); };
        ws.onmessage = (e) => { if (this.onmessage) this.onmessage(e.data); };
        ws.onclose = (e) => { const was = this.open; this.open = false; if (this.onclose) this.onclose(e.reason || (was ? "The connection was lost." : "Could not reach the server.")); };
    }
    send(data) { if (this.open && this.ws.readyState === 1) this.ws.send(data); }
    close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.open = false; }
}

/**
 * Bad network on demand (BREACH's Conditions, unchanged): holds every message each way for latency/2
 * plus up to `jitter` ms; a "lost" message arrives one more round trip late, as TCP would bring it.
 */
export class Conditions {
    constructor(inner, settings = {}) {
        this.inner = inner;
        this.settings = { latency: 0, jitter: 0, loss: 0, ...settings };
        this.onmessage = null; this.onclose = null; this.onopen = null;
        this.out = []; this.in = [];
        this.lastOut = 0; this.lastIn = 0;
        this.now = settings.now || (() => performance.now());
        inner.onmessage = (data) => this.hold(this.in, data, "lastIn");
        inner.onclose = (reason) => { if (this.onclose) this.onclose(reason); };
        inner.onopen = () => { if (this.onopen) this.onopen(); };
        this.random = settings.random || Math.random;
    }
    get open() { return this.inner.open; }
    get active() { const s = this.settings; return s.latency > 0 || s.jitter > 0 || s.loss > 0; }
    connect(name) { this.inner.connect(name); }
    hold(queue, data, last) {
        const s = this.settings;
        let due = this.now() + s.latency / 2 + this.random() * s.jitter;
        if (s.loss > 0 && this.random() < s.loss) due += 20 + s.latency;
        if (due < this[last]) due = this[last];
        this[last] = due;
        queue.push({ due, data });
    }
    send(data) { this.hold(this.out, data, "lastOut"); if (!this.active) this.pump(); }
    pump() {
        const now = this.now();
        while (this.out.length && this.out[0].due <= now) this.inner.send(this.out.shift().data);
        while (this.in.length && this.in[0].due <= now) { const m = this.in.shift(); if (this.onmessage) this.onmessage(m.data); }
    }
    close() { this.inner.close(); }
}

// ------------------------------------------------------------------ the client

export class Client {
    constructor() {
        this.transport = null;
        this.id = 0;
        this.joined = false;
        this.room = null;
        this.island = null;
        this.me = createPlayer(0);
        this.seq = 0;
        /** the server tick the next input is expected to be applied on, minus one */
        this.predTick = 0;
        this.pending = [];
        this.prev = { x: 0, y: 0, z: 0 };
        this.offset = { x: 0, y: 0, z: 0 };
        /** who is in the room: id → { id, name, team, bot, banked, lost, steals, shoves, ping, flags, weight } */
        this.players = new Map();
        this.hostId = 0;
        this.snaps = [];
        this.renderTick = 0;
        this.serverTick = 0;
        this.match = { phase: "play", overTicks: 0, winner: -1, bank: [0, 0, 0, 0] };
        /** loot as last told: id → { id, kind, holder, x, y, z } */
        this.loot = new Map();
        this.ping = 0;
        this.stats = { bytesIn: 0, bytesOut: 0, snaps: 0, corrections: 0, lastError: 0, replayed: 0 };
        this._count = { bytesIn: 0, bytesOut: 0, snaps: 0, since: 0 };
        this._on = new Map();
    }

    /** Listen: "welcome", "start", "roster", "event", "predicted" (my own jump or grapple, at once), "chat", "close". */
    on(name, fn) { (this._on.get(name) || this._on.set(name, []).get(name)).push(fn); return this; }
    emit(name, a, b) {
        const list = this._on.get(name);
        if (!list) return;
        for (const fn of list) { try { fn(a, b); } catch (error) { console.error(error); } }
    }

    attach(transport) {
        this.detach();
        this.transport = transport;
        transport.onmessage = (data) => this.receive(data);
        transport.onclose = (reason) => { this.joined = false; this.emit("close", reason); };
    }
    detach() {
        if (this.transport) { this.transport.onmessage = null; this.transport.onclose = null; this.transport.close(); }
        this.transport = null; this.joined = false; this.players.clear(); this.snaps.length = 0; this.pending.length = 0; this.loot.clear();
    }
    send(message) {
        if (!this.transport) return;
        const data = encode(message);
        this._count.bytesOut += byteLength(data);
        this.transport.send(data);
    }

    /** The water level at a tick of this match. */
    level(tick) { return this.island ? waterAt(this.island.seed, tick) : 0; }
    /** The server's present, smoothly: what the drawn world is at, plus the interpolation delay. */
    get clock() { return this.renderTick + INTERP_TICKS; }

    // ------------------------------------------------------------------ outgoing

    /** Send this tick's controls and predict their effect. Call once per fixed step. */
    tick(controls) {
        if (!this.joined) return;
        const me = this.me;
        const input = { seq: ++this.seq, mx: controls.mx, my: controls.my, buttons: controls.buttons, yaw: controls.yaw, pitch: controls.pitch, lag: 0 };
        this.pending.push(input);
        if (this.pending.length > 240) this.pending.shift();
        this.send({ t: "in", s: input.seq, mx: input.mx, my: input.my, b: input.buttons, yaw: input.yaw, pitch: input.pitch, vt: Math.round(this.renderTick * 16) / 16 });
        this.prev.x = me.x; this.prev.y = me.y; this.prev.z = me.z;
        if (this.match.phase !== "play") return;
        this.predTick++;
        stepPlayer(this.island, me, input, this.level(this.predTick));
        if (me.jumped) this.emit("predicted", { type: "jump", id: this.id });
        if (me.hookFired) this.emit("predicted", { type: "hook", id: this.id, hit: me.hookFired === 1 ? 1 : 0, x: me.hx, y: me.hy, z: me.hz });
    }

    // ------------------------------------------------------------------ incoming

    receive(data) {
        this._count.bytesIn += byteLength(data);
        const m = decode(data);
        if (!m) return;
        if (m.t === "snap") this.snapshot(m);
        else if (m.t === "ping") this.send({ t: "pong", n: m.n });
        else if (m.t === "welcome") {
            this.id = m.id; this.me = createPlayer(m.id); this.seq = 0; this.pending.length = 0;
            this.setRoom(m.room, m.tick);
            this.joined = true;
            this.emit("welcome", m);
        } else if (m.t === "start") { this.setRoom(m.room, m.tick); this.pending.length = 0; this.emit("start", m); }
        else if (m.t === "roster") {
            const seen = new Set();
            for (const r of m.players) { seen.add(r.id); this.players.set(r.id, { ...(this.players.get(r.id) || { banked: 0, lost: 0, steals: 0, shoves: 0, ping: 0, flags: 0, weight: 0 }), ...r }); }
            for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
            this.hostId = m.host;
            const mine = this.players.get(this.id);
            if (mine) this.me.team = mine.team;
            this.emit("roster", m);
        } else if (m.t === "chat") this.emit("chat", m);
        else if (m.t === "error") this.emit("close", m.text);
    }

    setRoom(room, tick) {
        this.room = room;
        if (!this.island || this.island.seed !== room.seed || this.island.teams !== room.teams) this.island = generateIsland(room.seed, room.teams);
        this.snaps.length = 0;
        this.loot.clear();
        this.renderTick = tick - INTERP_TICKS;
        this.serverTick = tick;
        this.predTick = tick;
        this.match.phase = "play"; this.match.winner = -1; this.match.bank = [0, 0, 0, 0];
        this.offset.x = this.offset.y = this.offset.z = 0;
    }

    snapshot(m) {
        this._count.snaps++;
        this.serverTick = m.tick;
        const mt = this.match;
        mt.phase = m.ph; mt.overTicks = m.ot; mt.winner = m.win; mt.bank = m.bank;

        const last = this.snaps[this.snaps.length - 1], players = new Map();
        if (last) for (const [id, row] of last.players) if (this.players.has(id)) players.set(id, row);
        for (const row of m.p) {
            players.set(row[0], row);
            const info = this.players.get(row[0]);
            if (info) { info.flags = row[5]; info.weight = row[6]; }
        }
        for (const row of m.sc) {
            const info = this.players.get(row[0]);
            if (info) { info.banked = row[1]; info.lost = row[2]; info.steals = row[3]; info.shoves = row[4]; info.ping = row[5]; }
            if (row[0] === this.id) this.ping = row[5];
        }
        for (const r of m.l) this.loot.set(r[0], { id: r[0], kind: r[1], holder: r[2], x: r[3], y: r[4], z: r[5] });
        for (const id of m.lg) this.loot.delete(id);
        this.snaps.push({ tick: m.tick, players });
        if (this.snaps.length > BUFFER) this.snaps.shift();

        this.reconcile(m.you, m.ack, m.tick);
        for (const e of m.ev) this.emit("event", e);
    }

    /** Take the server's word for my state, then replay what it hasn't seen yet, each on the tick it will land on. */
    reconcile(you, ack, tick) {
        const me = this.me, bx = me.x, by = me.y, bz = me.z, wasAlive = me.alive;
        while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
        const yaw = me.yaw, pitch = me.pitch;
        Object.assign(me, you);
        me.carry = you.carry.slice();
        if (!you.hook) me.hook = 0;
        me.water = 0;
        if (this.match.phase === "play") for (let i = 0; i < this.pending.length; i++) stepPlayer(this.island, me, this.pending[i], this.level(tick + i + 1));
        this.predTick = tick + this.pending.length;
        if (!this.pending.length) { me.yaw = yaw; me.pitch = pitch; }
        this.stats.replayed = this.pending.length;

        const ex = bx - me.x, ey = by - me.y, ez = bz - me.z, error = Math.hypot(ex, ey, ez);
        this.stats.lastError = error;
        if (error < 1e-5) return;
        this.stats.corrections++;
        if (error > SNAP_DISTANCE || !wasAlive || !me.alive) { this.offset.x = this.offset.y = this.offset.z = 0; this.prev.x = me.x; this.prev.y = me.y; this.prev.z = me.z; return; }
        this.offset.x += ex; this.offset.y += ey; this.offset.z += ez;
        this.prev.x -= ex; this.prev.y -= ey; this.prev.z -= ez;
    }

    // ------------------------------------------------------------------ drawing

    /** Advance the clocks used for drawing. Call once per rendered frame. */
    frame(dt) {
        if (this.transport && this.transport.pump) this.transport.pump();
        const k = Math.exp(-dt * 14);
        this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
        const target = this.serverTick - INTERP_TICKS, gap = target - this.renderTick;
        if (Math.abs(gap) > 60) this.renderTick = target;
        else this.renderTick += dt * 60 * (1 + Math.max(-0.25, Math.min(0.75, (gap - SNAP_EVERY * 0.5) * 0.1)));
        if (this.renderTick > this.serverTick) this.renderTick = this.serverTick;

        const c = this._count;
        if ((c.since += dt) >= 1) {
            this.stats.bytesIn = Math.round(c.bytesIn / c.since); this.stats.bytesOut = Math.round(c.bytesOut / c.since); this.stats.snaps = Math.round(c.snaps / c.since);
            c.bytesIn = c.bytesOut = c.snaps = 0; c.since = 0;
        }
    }

    myPosition(alpha, out) {
        const me = this.me, p = this.prev, o = this.offset;
        out.x = p.x + (me.x - p.x) * alpha + o.x; out.y = p.y + (me.y - p.y) * alpha + o.y; out.z = p.z + (me.z - p.z) * alpha + o.z;
        return out;
    }

    /**
     * Where another player is at the moment being drawn, blended between the two snapshots around it.
     * @returns {boolean} false if there is nothing to draw for them yet
     */
    sample(id, out) {
        const snaps = this.snaps, t = this.renderTick;
        let a = null, b = null;
        for (let i = snaps.length - 1; i >= 0; i--) {
            const row = snaps[i].players.get(id);
            if (!row) continue;
            if (snaps[i].tick <= t) { a = snaps[i]; break; }
            b = snaps[i];
        }
        if (!a) a = b;
        if (!b) b = a;
        if (!a) return false;
        const ra = a.players.get(id), rb = b.players.get(id);
        let f = b.tick > a.tick ? (t - a.tick) / (b.tick - a.tick) : 0;
        f = Math.max(0, Math.min(1, f));
        const dx = rb[1] - ra[1], dy = rb[2] - ra[2], dz = rb[3] - ra[3];
        if (dx * dx + dy * dy + dz * dz > 36 || !(ra[5] & FLAG.alive)) f = f < 0.5 ? 0 : 1;
        out.x = ra[1] + dx * f; out.y = ra[2] + dy * f; out.z = ra[3] + dz * f;
        let dface = rb[4] - ra[4];
        if (dface > 32768) dface -= 65536; else if (dface < -32768) dface += 65536;
        out.face = ((ra[4] + dface * f) * Math.PI * 2) / 65536;
        const near = f < 0.5 ? ra : rb;
        out.flags = near[5]; out.weight = near[6]; out.hx = near[7]; out.hy = near[8]; out.hz = near[9];
        const span = (b.tick - a.tick) / 60;
        out.speed = span > 0 ? Math.hypot(dx, dy) / span : 0;
        out.vz = span > 0 ? dz / span : 0;
        return true;
    }
}
