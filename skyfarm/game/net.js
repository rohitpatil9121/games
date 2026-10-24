import { createState, stepWorld, stepAfter, stepAs, findPlayer } from "./sim.js";
import { applyWorld } from "./save.js";
import { stepBridges } from "./progression.js";
import { encode, decode, readRow, INTERP_TICKS, SNAP_EVERY, PROTOCOL } from "./protocol.js";

/**
 * SKYFARM: the client's side of co-op (after TIDEFALL's and BREACH's net.js: prediction, reconciliation,
 * interpolation, the transports).
 *
 * THE CLIENT'S COPY. A client keeps its own copy of the farm (`local`), marked `remote`, made from the room's
 * world snapshot. Every tick it steps the world's clock (the crops grow with the same code as the room) and
 * its own player with this tick's input, actions included, so tilling and planting answer at once. It never
 * sleeps by itself and never moves the sprites: the room does those (sim.js `remote`).
 *
 * RECONCILIATION. Each snapshot carries this player as the room has it after the last input it applied (`ack`):
 * the client takes that, and replays the inputs the room hasn't seen yet, quietly (moving, not acting again,
 * since those actions are already in the copy). The difference from where it was drawn becomes an offset that
 * fades in a fraction of a second, unless it is a jump of metres (falling home), which is taken at once.
 *
 * THE WORLD. When a snapshot brings the world (`w`), it replaces the copy's (keeping the players), and the copy's
 * clock is run forward from the room's tick to where the client had got, world only.
 *
 * THE OTHERS are drawn INTERP_TICKS behind the newest snapshot, blended between the two around that moment.
 * Their copies in `local.players` are stubs kept up to date from the rows (who is asleep, who runs near the
 * sprites); the client never simulates them.
 *
 * EVENTS. The client's own predicted events come out of its copy at once; from the room it takes only the
 * events that aren't its own predictions: the world's (no `by`), the others', and its own that the room alone
 * decides (`direct`: a conversation's gifts, a sale, the night passing).
 * @module game/net
 */

const SNAP_DISTANCE = 3;
const BUFFER = 40;

// ------------------------------------------------------------------ transports

/** A room in this process (tests). Messages still go through encode() and decode(). */
export class Loopback {
    constructor(room) { this.room = room; this.id = 0; this.onmessage = null; this.onclose = null; this.open = false; }
    connect(hello) {
        this.open = true;
        this.id = this.room.join((data) => { if (this.open && this.onmessage) this.onmessage(data); }, hello.name);
        if (!this.id && this.onclose) this.onclose("Couldn't join that farm.");
    }
    send(data) { if (this.open) this.room.receive(this.id, data); }
    close() { if (!this.open) return; this.open = false; this.room.leave(this.id); }
}

/** A WebSocket to a SKYFARM server; the hello goes first. */
export class SocketTransport {
    constructor(url) { this.url = url; this.onmessage = null; this.onclose = null; this.open = false; this.ws = null; }
    connect(hello) {
        const ws = (this.ws = new WebSocket(this.url));
        ws.onopen = () => { this.open = true; ws.send(encode({ t: "hello", v: PROTOCOL, ...hello })); };
        ws.onmessage = (e) => { if (this.onmessage) this.onmessage(e.data); };
        ws.onclose = (e) => { const was = this.open; this.open = false; if (this.onclose) this.onclose(e.reason || (was ? "The connection was lost." : "Couldn't reach the server.")); };
    }
    send(data) { if (this.open && this.ws.readyState === 1) this.ws.send(data); }
    close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.open = false; }
}

/**
 * Bad network on demand (BREACH's Conditions): every message each way waits latency/2 plus up to `jitter` ms;
 * a "lost" one arrives one round trip later, as TCP would bring it; order is kept.
 */
export class Conditions {
    constructor(inner, settings = {}) {
        this.inner = inner;
        this.settings = { latency: 0, jitter: 0, loss: 0, ...settings };
        this.onmessage = null; this.onclose = null;
        this.out = []; this.in = []; this.lastOut = 0; this.lastIn = 0;
        this.now = settings.now || (() => performance.now());
        this.random = settings.random || Math.random;
        inner.onmessage = (data) => this.hold(this.in, data, "lastIn");
        inner.onclose = (reason) => { if (this.onclose) this.onclose(reason); };
    }
    get open() { return this.inner.open; }
    connect(hello) { this.inner.connect(hello); }
    hold(queue, data, last) {
        const s = this.settings;
        let due = this.now() + s.latency / 2 + this.random() * s.jitter;
        if (s.loss > 0 && this.random() < s.loss) due += 20 + s.latency;
        if (due < this[last]) due = this[last];
        this[last] = due;
        queue.push({ due, data });
    }
    send(data) { this.hold(this.out, data, "lastOut"); }
    pump() {
        const now = this.now();
        while (this.out.length && this.out[0].due <= now) this.inner.send(this.out.shift().data);
        while (this.in.length && this.in[0].due <= now) { const m = this.in.shift(); if (this.onmessage) this.onmessage(m.data); }
    }
    close() { this.inner.close(); }
}

// ------------------------------------------------------------------ the client

export class Client {
    /** @param {object} world the generated world (islands.js makeWorld) */
    constructor(world) {
        this.world = world;
        this.transport = null;
        this.id = 0; this.host = 0; this.code = "";
        this.joined = false;
        /** the client's copy of the farm (null until welcomed) */
        this.local = null;
        this.me = null;
        this.seq = 0;
        this.pending = [];
        this.offset = { x: 0, y: 0, z: 0 };
        this.snaps = [];
        this.renderTick = 0; this.serverTick = 0;
        /** who is here: id → name */
        this.names = new Map();
        /** events from the room to show (see EVENTS above), taken by the game each tick */
        this.incoming = [];
        this.stats = { bytesIn: 0, bytesOut: 0, worlds: 0, corrections: 0, lastError: 0, maxError: 0, replayed: 0 };
        this._on = new Map();
    }

    /** "welcome", "roster", "save" (host: the farm to keep), "world" (a new world arrived), "close" */
    on(name, fn) { (this._on.get(name) || this._on.set(name, []).get(name)).push(fn); return this; }
    emit(name, a) { for (const fn of this._on.get(name) || []) { try { fn(a); } catch (e) { console.error(e); } } }

    /** Connect through a transport: hello = { name, create?: { game } } or { name, room } */
    connect(transport, hello) {
        this.transport = transport;
        transport.onmessage = (data) => this.receive(data);
        transport.onclose = (reason) => { const was = this.joined; this.joined = false; this.emit("close", { reason, was }); };
        transport.connect(hello);
    }
    close() { if (this.transport) { this.transport.onclose = null; this.transport.close(); } this.transport = null; this.joined = false; }
    send(m) { if (!this.transport) return; const d = encode(m); this.stats.bytesOut += d.length; this.transport.send(d); }

    // ------------------------------------------------------------------ outgoing

    /**
     * This tick's controls: sent, and predicted on the copy (the world's clock, then this player). Returns the
     * copy's events for this tick (the player's own, at once).
     */
    tick(input) {
        const L = this.local;
        if (!this.joined || !L) return [];
        const inp = { seq: ++this.seq, mx: input.mx, my: input.my, buttons: input.buttons, yaw: input.yaw };
        this.pending.push(inp);
        if (this.pending.length > 300) this.pending.shift();
        this.send({ t: "in", s: inp.seq, mx: inp.mx, my: inp.my, b: inp.buttons, yaw: inp.yaw, vt: Math.round(this.renderTick) });
        L.events.length = 0;
        stepWorld(L);
        stepAs(L, this.me, [inp]);
        L.player = this.me;
        stepAfter(L);
        return L.events;
    }
    talk(who) { this.send({ t: "talk", who }); }
    trade(op, what, n) { this.send({ t: "trade", op, what, n }); }

    // ------------------------------------------------------------------ incoming

    receive(data) {
        this.stats.bytesIn += data.length || 0;
        const m = decode(data);
        if (!m) return;
        if (m.t === "snap") this.snapshot(m);
        else if (m.t === "ping") this.send({ t: "pong", n: m.n });
        else if (m.t === "welcome") this.welcome(m);
        else if (m.t === "roster") {
            this.host = m.host;
            this.names = new Map(m.players.map((p) => [p.id, p.name]));
            const L = this.local;
            if (L) {
                // stubs for the others: added as they come, dropped as they go
                L.players = L.players.filter((p) => p === this.me || this.names.has(p.id));
                for (const p of m.players) if (!findPlayer(L, p.id)) L.players.push({ id: p.id, name: p.name, x: 0, y: 0, z: -1000, vx: 0, vy: 0, mode: "foot", asleep: false, stub: true });
                // the host first, as in the room (sim.js reads players[0] as the host)
                L.players.sort((a, b) => a.id - b.id);
            }
            this.emit("roster", m);
        } else if (m.t === "save") this.emit("save", m.game);
        else if (m.t === "closed") { this.joined = false; this.emit("close", { reason: m.why, was: true }); }
        else if (m.t === "error") { this.joined = false; this.emit("close", { reason: m.text, was: false }); }
    }

    welcome(m) {
        this.id = m.id; this.host = m.room.host; this.code = m.room.code;
        const L = createState(this.world);
        applyWorld(L, m.world);
        L.players = m.players.map((p) => (p.id === m.id ? p : { ...p, stub: true }));
        L.players.sort((a, b) => a.id - b.id);
        L.remote = true;
        this.me = findPlayer(L, m.id);
        L.player = this.me;
        L.events = [];
        this.local = L;
        this.seq = 0; this.pending.length = 0; this.snaps.length = 0;
        this.serverTick = m.tick; this.renderTick = m.tick - INTERP_TICKS;
        this.joined = true;
        this.emit("welcome", m);
    }

    snapshot(m) {
        const L = this.local;
        if (!L) return;
        this.serverTick = m.tick;
        if (m.w) {
            // the room's world, then forward to where this copy had got (the world's clock only)
            const ahead = L.tick;
            applyWorld(L, m.w);
            const keep = L.events;
            L.events = [];
            for (let t = L.tick; t < ahead && t < L.tick + 600; ) { stepWorld(L); stepBridges(L); t = L.tick; }
            L.events = keep; L.events.length = 0;
            this.stats.worlds++;
            this.emit("world");
        }
        L.sprites = m.sp.map(([id, x, y, z, vx, vy]) => ({ id, x, y, z, vx, vy }));
        const players = new Map();
        for (const row of m.p) {
            const r = readRow(row);
            players.set(r.id, r);
            const stub = findPlayer(L, r.id);
            if (stub && stub !== this.me) Object.assign(stub, { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, asleep: r.asleep, mode: r.glide ? "glide" : "foot" });
        }
        this.snaps.push({ tick: m.tick, players });
        if (this.snaps.length > BUFFER) this.snaps.shift();
        this.reconcile(m.you, m.ack);
        for (const e of m.ev) if (!e.by || e.by !== this.id || e.direct) this.incoming.push(e);
    }

    /** Take the room's word for this player, then replay what it hasn't seen yet. */
    reconcile(you, ack) {
        const me = this.me, L = this.local, bx = me.x, by = me.y, bz = me.z;
        while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
        Object.assign(me, you);
        L.player = me;
        for (const inp of this.pending) stepAs(L, me, [inp], true);
        this.stats.replayed = this.pending.length;
        const ex = bx - me.x, ey = by - me.y, ez = bz - me.z, error = Math.hypot(ex, ey, ez);
        this.stats.lastError = error;
        if (error < 1e-4) return;
        this.stats.corrections++;
        if (error > SNAP_DISTANCE) { this.offset.x = this.offset.y = this.offset.z = 0; return; }
        this.stats.maxError = Math.max(this.stats.maxError, error);
        this.offset.x += ex; this.offset.y += ey; this.offset.z += ez;
    }

    /** Take the room's events that this client should show (see EVENTS above). */
    takeEvents() { const e = this.incoming; this.incoming = []; return e; }

    // ------------------------------------------------------------------ drawing

    /** Advance the drawing clock and fade the correction. Call once per rendered frame. */
    frame(dt) {
        if (this.transport && this.transport.pump) this.transport.pump();
        const k = Math.exp(-dt * 12);
        this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
        const target = this.serverTick - INTERP_TICKS, gap = target - this.renderTick;
        if (Math.abs(gap) > 60) this.renderTick = target;
        else this.renderTick += dt * 60 * (1 + Math.max(-0.25, Math.min(0.75, (gap - SNAP_EVERY * 0.5) * 0.1)));
        if (this.renderTick > this.serverTick) this.renderTick = this.serverTick;
    }

    /** The others where they are at the drawn moment: [{ id, name, x, y, z, yaw, pitch, roll, glide, speed, fx, fy, asleep }] */
    others() {
        const out = [], t = this.renderTick, snaps = this.snaps;
        for (const [id, name] of this.names) {
            if (id === this.id) continue;
            let a = null, b = null;
            for (let i = snaps.length - 1; i >= 0; i--) {
                const r = snaps[i].players.get(id);
                if (!r) continue;
                if (snaps[i].tick <= t) { a = snaps[i]; break; }
                b = snaps[i];
            }
            if (!a) a = b; if (!b) b = a;
            if (!a) continue;
            const ra = a.players.get(id), rb = b.players.get(id);
            let f = b.tick > a.tick ? Math.max(0, Math.min(1, (t - a.tick) / (b.tick - a.tick))) : 0;
            if (Math.hypot(rb.x - ra.x, rb.y - ra.y, rb.z - ra.z) > 8) f = f < 0.5 ? 0 : 1;
            const lerp = (u, v) => u + (v - u) * f;
            let dy = rb.yaw - ra.yaw; dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
            const near = f < 0.5 ? ra : rb;
            out.push({ id, name, x: lerp(ra.x, rb.x), y: lerp(ra.y, rb.y), z: lerp(ra.z, rb.z), yaw: ra.yaw + dy * f, pitch: lerp(ra.pitch, rb.pitch), roll: lerp(ra.roll, rb.roll),
                glide: near.glide, speed: lerp(ra.speed, rb.speed), fx: lerp(ra.fx, rb.fx), fy: lerp(ra.fy, rb.fy), vx: near.vx, vy: near.vy, asleep: near.asleep });
        }
        return out;
    }
}
