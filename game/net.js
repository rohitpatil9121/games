import { createPlane, applyInput } from "./sim.js";
import { RingRun } from "./rings.js";
import { ROOMS } from "./rooms/index.js";
import { encode, decode, byteLength, rowAngles, FLAG, INTERP_TICKS, SNAP_EVERY } from "./protocol.js";

/**
 * PAPER PLANES: the client's side of the network. Copied from TIDEFALL's net.js (itself BREACH's:
 * prediction, reconciliation, interpolation, the three transports) and adapted to planes.
 *
 * PREDICTION. Each tick the client sends its input and applies it at once to its own copy of its plane,
 * with the same applyInput() the server runs. The air depends on time, so (TIDEFALL's rule) each plane
 * carries a clock of its own that advances by one tick per input applied, and flies through the air of
 * that tick. The snapshot gives the clock with the rest of the plane; replaying a pending input advances it
 * by one, exactly as the server will.
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
    connect(name, fold) {
        this.open = true;
        this.id = this.room.join((data) => { if (this.open && this.onmessage) this.onmessage(data); }, name, fold);
    }
    send(data) { if (this.open) this.room.receive(this.id, data); }
    close() { if (!this.open) return; this.open = false; this.room.leave(this.id); }
}

/** A WebSocket to a PAPER PLANES server. */
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
    connect(name, fold) { this.inner.connect(name, fold); }
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
        /** what prediction needs of the match: the room file, the seed, a place for events */
        this.world = null;
        this.me = blankPlane(0);
        this.seq = 0;
        this.pending = [];
        this.prev = { x: 0, y: 0, z: 0 };
        this.offset = { x: 0, y: 0, z: 0 };
        /** who is in the room: id → { id, name, fold, bot, next, ticks, best, ping, flags } */
        this.players = new Map();
        this.hostId = 0;
        this.snaps = [];
        this.renderTick = 0;
        this.serverTick = 0;
        /** the round: phase, ticks of results left, ticks of the tag clock left, grace, winners, erasers out */
        this.match = { phase: "play", overTicks: 0, clock: 0, grace: 0, winners: [], erasers: [] };
        this.ping = 0;
        this.stats = { bytesIn: 0, bytesOut: 0, snaps: 0, corrections: 0, lastError: 0, replayed: 0 };
        this._count = { bytesIn: 0, bytesOut: 0, snaps: 0, since: 0 };
        this._on = new Map();
    }

    /** Listen: "welcome", "start", "roster", "event", "predicted" (my own plane's events, at once), "chat", "close". */
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
        this.transport = null; this.joined = false; this.players.clear(); this.snaps.length = 0; this.pending.length = 0;
    }
    send(message) {
        if (!this.transport) return;
        const data = encode(message);
        this._count.bytesOut += byteLength(data);
        this.transport.send(data);
    }

    /** The server's present, smoothly: what the drawn world is at, plus the interpolation delay. */
    get clock() { return this.renderTick + INTERP_TICKS; }

    // ------------------------------------------------------------------ outgoing

    /** Send this tick's controls and predict their effect. Call once per fixed step. */
    tick(controls) {
        if (!this.joined) return;
        const me = this.me;
        const input = { seq: ++this.seq, pitch: controls.pitch, roll: controls.roll, buttons: controls.buttons, lag: 0 };
        this.pending.push(input);
        if (this.pending.length > 240) this.pending.shift();
        this.send({ t: "in", s: input.seq, p: input.pitch, r: input.roll, b: input.buttons, vt: Math.round(this.renderTick * 16) / 16 });
        this.prev.x = me.x; this.prev.y = me.y; this.prev.z = me.z;
        if (this.match.phase !== "play") return;
        this.world.events.length = 0;
        applyInput(this.world, me, input);
        for (const e of this.world.events) this.emit("predicted", e);
    }

    // ------------------------------------------------------------------ incoming

    receive(data) {
        this._count.bytesIn += byteLength(data);
        const m = decode(data);
        if (!m) return;
        if (m.t === "snap") this.snapshot(m);
        else if (m.t === "ping") this.send({ t: "pong", n: m.n });
        else if (m.t === "welcome") {
            this.id = m.id; this.me = blankPlane(m.id); this.seq = 0; this.pending.length = 0;
            this.setRoom(m.room, m.tick);
            this.joined = true;
            this.emit("welcome", m);
        } else if (m.t === "start") { this.setRoom(m.room, m.tick); this.pending.length = 0; this.emit("start", m); }
        else if (m.t === "roster") {
            const seen = new Set();
            for (const r of m.players) { seen.add(r.id); this.players.set(r.id, { ...(this.players.get(r.id) || { next: 0, ticks: 0, best: 0, ping: 0, flags: 0 }), ...r }); }
            for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
            this.hostId = m.host;
            this.emit("roster", m);
        } else if (m.t === "chat") this.emit("chat", m);
        else if (m.t === "error") this.emit("close", m.text);
    }

    setRoom(room, tick) {
        this.room = room;
        this.world = { room: ROOMS[room.room], seed: room.seed, mode: room.mode, set: room.set, tick, events: [] };
        this.snaps.length = 0;
        this.renderTick = tick - INTERP_TICKS;
        this.serverTick = tick;
        this.match.phase = "play"; this.match.winners = []; this.match.erasers = [];
        this.offset.x = this.offset.y = this.offset.z = 0;
    }

    snapshot(m) {
        this._count.snaps++;
        this.serverTick = m.tick;
        const mt = this.match;
        mt.phase = m.ph; mt.overTicks = m.ot; mt.clock = m.clock; mt.grace = m.grace; mt.winners = m.win; mt.erasers = m.er;

        const last = this.snaps[this.snaps.length - 1], players = new Map();
        if (last) for (const [id, row] of last.players) if (this.players.has(id)) players.set(id, row);
        for (const row of m.p) {
            players.set(row[0], row);
            const info = this.players.get(row[0]);
            if (info) info.flags = row[7];
        }
        for (const row of m.sc) {
            const info = this.players.get(row[0]);
            // Ring Run: next ring, ticks, best; tag: tags made, ticks as "it" (or clean), erasers
            if (info) { info.next = info.tags = row[1]; info.ticks = row[2]; info.best = info.erasers = row[3]; info.ping = row[4]; }
            if (row[0] === this.id) this.ping = row[4];
        }
        this.snaps.push({ tick: m.tick, players });
        if (this.snaps.length > BUFFER) this.snaps.shift();

        this.reconcile(m.you, m.ack);
        for (const e of m.ev) this.emit("event", e);
    }

    /** Take the server's word for my plane, then replay what it hasn't seen yet, one tick of its clock each. */
    reconcile(you, ack) {
        const me = this.me, bx = me.x, by = me.y, bz = me.z, wasDown = me.crumpled > 0;
        while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
        const run = you.run;
        Object.assign(me, you);
        if (run && this.world.room.rings[this.world.set]) {
            me.run = new RingRun(this.world.room.rings[this.world.set]);
            me.run.next = run.next; me.run.ticks = run.ticks; me.run.done = run.done;
        } else me.run = null;
        if (this.match.phase === "play") {
            const ev = this.world.events;
            for (let i = 0; i < this.pending.length; i++) { ev.length = 0; applyInput(this.world, me, this.pending[i]); }
            ev.length = 0;
        }
        this.stats.replayed = this.pending.length;

        const ex = bx - me.x, ey = by - me.y, ez = bz - me.z, error = Math.hypot(ex, ey, ez);
        this.stats.lastError = error;
        if (error < 1e-5) return;
        this.stats.corrections++;
        if (error > SNAP_DISTANCE || wasDown !== me.crumpled > 0) { this.offset.x = this.offset.y = this.offset.z = 0; this.prev.x = me.x; this.prev.y = me.y; this.prev.z = me.z; return; }
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
     * Where another plane is at the moment being drawn, blended between the two snapshots around it.
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
        // a refold is a jump to a launch spot: don't draw it flying there
        if (dx * dx + dy * dy + dz * dz > 0.25 || (ra[7] & FLAG.crumpled) !== (rb[7] & FLAG.crumpled)) f = f < 0.5 ? 0 : 1;
        out.x = ra[1] + dx * f; out.y = ra[2] + dy * f; out.z = ra[3] + dz * f;
        rowAngles(ra, _a); rowAngles(rb, _b);
        let dyaw = _b.yaw - _a.yaw;
        if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        out.yaw = _a.yaw + dyaw * f; out.pitch = _a.pitch + (_b.pitch - _a.pitch) * f; out.roll = _a.roll + (_b.roll - _a.roll) * f;
        const near = f < 0.5 ? ra : rb;
        out.flags = near[7]; out.fold = near[8];
        const span = (b.tick - a.tick) / 60;
        out.vx = span > 0 ? dx / span : 0; out.vy = span > 0 ? dy / span : 0; out.vz = span > 0 ? dz / span : 0;
        return true;
    }
}

const _a = { yaw: 0, pitch: 0, roll: 0 }, _b = { yaw: 0, pitch: 0, roll: 0 };

/** a plane with no room yet (replaced from the first snapshot) */
function blankPlane(id) {
    const p = createPlane(id, "glider", { at: [0, 0, 1], yaw: 0 });
    p.run = null; p.seq = 0;
    return p;
}
