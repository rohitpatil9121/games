import { BTN } from "./data.js";

/**
 * TIDEFALL: the wire protocol, shared by the server and the client. Copied from BREACH's protocol.js and
 * adapted: the same message types, the same packing, different fields.
 *
 * Every message is an object with a type `t`. encode() and decode() are the only place that knows how a
 * message is laid out in bytes.
 *
 *   client → server
 *     hello   { v, name, room?, create? }   join a room by code, create one, or quick-play
 *     in      { s, mx, my, b, yaw, pitch, vt }   one tick of input; vt = the server tick the client was drawing
 *     pong    { n }
 *     chat    { text }
 *     setup   { teams?, bots?, skill? }      the host changes the room (starts a new match)
 *
 *   server → client
 *     welcome { id, room, tick }             you are in; `room` carries the island's seed and team count
 *     start   { room, tick }                 a new match on a new island
 *     roster  { host, players: [{ id, name, team, bot }] }
 *     snap    (see below)                    20 a second
 *     ping    { n }, chat { id, name, text }, error { text }
 *
 * THE SEA COSTS NOTHING. The water level is a pure function of the island seed and the tick
 * (game/tide.js), so no snapshot carries it.
 *
 * LAYOUT. `snap` and `in` travel as packed bytes; the rest are JSON text.
 *   in    1 type, 4 seq, 1 mx, 1 my, 1 buttons, 2 yaw, 2 pitch, 4 view tick                      = 16 bytes
 *   snap  a header (tick, the last input applied, phase, banks); your own player in full (doubles where
 *         prediction must restart from the server's exact numbers); then only what changed since the last
 *         snapshot this client was sent: other players (14 bytes, 20 while grappling), score rows, loot
 *         items (10 bytes) and loot that is gone; then this interval's events.
 * The transport is reliable and ordered, so "changed since the last one sent" needs no acknowledgements.
 * @module game/protocol
 */

export const PROTOCOL = 2;
/** a snapshot goes out every this many ticks (20 Hz) */
export const SNAP_EVERY = 3;
/** remote players are drawn this many ticks behind the newest snapshot */
export const INTERP_TICKS = 5;
export const NAME_MAX = 16;
export const CHAT_MAX = 120;
export const ALL_BUTTONS = Object.values(BTN).reduce((a, b) => a | b, 0);

/** flag bits of another player in a snapshot */
export const FLAG = Object.freeze({ alive: 1, ground: 2, swim: 4, sunk: 8, hook: 16, stun: 32, idol: 64, blind: 128 });

/** Set false to send everything as JSON (tools/net-test.mjs does, to measure what the packing saves). */
export const WIRE = { binary: true };

const TYPE_SNAP = 1, TYPE_IN = 2;
const EVENT = { phase: 1, spawn: 2, drown: 3, pick: 4, drop: 5, bank: 6, shove: 7, flare: 8, blind: 9, hook: 10, jump: 11, over: 12, refill: 13, nopick: 14 };
const EVENT_NAME = Object.fromEntries(Object.entries(EVENT).map(([name, code]) => [code, name]));
const DROP_WHY = ["drop", "shove", "gasp", "drown"];
const cm = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 100)));

class Bytes {
    constructor(buffer) { this.view = new DataView(buffer); this.at = 0; }
    get left() { return this.view.byteLength - this.at; }
    u8(v) { if (v === undefined) return this.view.getUint8(this.at++); this.view.setUint8(this.at++, v); }
    i8(v) { if (v === undefined) return this.view.getInt8(this.at++); this.view.setInt8(this.at++, v); }
    u16(v) { const a = this.at; this.at += 2; if (v === undefined) return this.view.getUint16(a, true); this.view.setUint16(a, v, true); }
    i16(v) { const a = this.at; this.at += 2; if (v === undefined) return this.view.getInt16(a, true); this.view.setInt16(a, v, true); }
    u32(v) { const a = this.at; this.at += 4; if (v === undefined) return this.view.getUint32(a, true); this.view.setUint32(a, v, true); }
    f32(v) { const a = this.at; this.at += 4; if (v === undefined) return this.view.getFloat32(a, true); this.view.setFloat32(a, v, true); }
    f64(v) { const a = this.at; this.at += 8; if (v === undefined) return this.view.getFloat64(a, true); this.view.setFloat64(a, v, true); }
}
const scratch = new ArrayBuffer(16384);

function encodeInput(m) {
    const b = new Bytes(new ArrayBuffer(16));
    b.u8(TYPE_IN); b.u32(m.s); b.i8(m.mx); b.i8(m.my); b.u8(m.b); b.u16(m.yaw); b.i16(m.pitch); b.f32(m.vt);
    return b.view.buffer;
}
function decodeInput(b) {
    if (b.left < 15) return null;
    return { t: "in", s: b.u32(), mx: b.i8(), my: b.i8(), b: b.u8(), yaw: b.u16(), pitch: b.i16(), vt: b.f32() };
}

function encodeEvent(b, e) {
    const code = EVENT[e.type];
    if (!code) return;
    b.u8(code);
    switch (code) {
        case EVENT.phase: b.u8(e.phase); b.u8(e.tide); break;
        case EVENT.spawn: case EVENT.drown: case EVENT.jump: case EVENT.nopick: b.u8(e.id); break;
        case EVENT.pick: b.u8(e.id); b.u16(e.loot); b.u8(e.kind); break;
        case EVENT.drop: b.u8(e.id); b.u16(e.loot); b.u8(Math.max(0, DROP_WHY.indexOf(e.why))); break;
        case EVENT.bank: b.u8(e.id); b.u8(e.team); b.u16(e.value); b.u8(e.n); break;
        case EVENT.shove: b.u8(e.id); b.u8(e.target); b.u8(e.behind); break;
        case EVENT.flare: b.u8(e.id); b.u8(e.team); b.i16(cm(e.x)); b.i16(cm(e.y)); b.i16(cm(e.z)); break;
        case EVENT.blind: b.u8(e.id); b.u8(e.by); break;
        case EVENT.hook: b.u8(e.id); b.u8(e.hit); b.i16(cm(e.x)); b.i16(cm(e.y)); b.i16(cm(e.z)); break;
        case EVENT.over: b.i8(e.winner); break;
        default: break;
    }
}
function decodeEvent(b) {
    const code = b.u8(), type = EVENT_NAME[code];
    switch (code) {
        case EVENT.phase: return { type, phase: b.u8(), tide: b.u8() };
        case EVENT.spawn: case EVENT.drown: case EVENT.jump: case EVENT.nopick: return { type, id: b.u8() };
        case EVENT.pick: return { type, id: b.u8(), loot: b.u16(), kind: b.u8() };
        case EVENT.drop: return { type, id: b.u8(), loot: b.u16(), why: DROP_WHY[b.u8()] };
        case EVENT.bank: return { type, id: b.u8(), team: b.u8(), value: b.u16(), n: b.u8() };
        case EVENT.shove: return { type, id: b.u8(), target: b.u8(), behind: b.u8() };
        case EVENT.flare: return { type, id: b.u8(), team: b.u8(), x: b.i16() / 100, y: b.i16() / 100, z: b.i16() / 100 };
        case EVENT.blind: return { type, id: b.u8(), by: b.u8() };
        case EVENT.hook: return { type, id: b.u8(), hit: b.u8(), x: b.i16() / 100, y: b.i16() / 100, z: b.i16() / 100 };
        case EVENT.over: return { type, winner: b.i8() };
        case EVENT.refill: return { type };
        default: throw new Error("unknown event " + code);
    }
}

/** Your own player, in full: everything stepPlayer reads, so prediction restarts from the server's state. */
function encodeYou(b, y) {
    b.f64(y.x); b.f64(y.y); b.f64(y.z); b.f64(y.vx); b.f64(y.vy); b.f64(y.vz);
    b.f32(y.fx); b.f32(y.fy);
    b.u8((y.ground ? 1 : 0) | (y.alive ? 2 : 0) | (y.hook ? 4 : 0));
    b.u16(y.breath); b.u8(Math.min(255, y.air)); b.u8(Math.min(255, y.jumpAge)); b.u8(Math.min(255, y.pickAge));
    b.u8(y.weight); b.u8(Math.min(255, y.hookT)); b.u16(y.hookCool); b.u8(y.shoveCool); b.u16(y.flareCool); b.u8(y.stun); b.u8(y.blind); b.u8(y.guard); b.u16(y.respawn);
    b.u8(y.buttons); b.u16(y.yaw); b.i16(y.pitch); b.u32(y.clock);
    if (y.hook) { b.f64(y.hx); b.f64(y.hy); b.f64(y.hz); }
    b.u8(y.carry.length);
    for (const id of y.carry) b.u16(id);
}
function decodeYou(b) {
    const y = { x: b.f64(), y: b.f64(), z: b.f64(), vx: b.f64(), vy: b.f64(), vz: b.f64(), fx: b.f32(), fy: b.f32() }, f = b.u8();
    y.ground = (f & 1) !== 0; y.alive = (f & 2) !== 0; y.hook = f & 4 ? 1 : 0;
    y.breath = b.u16(); y.air = b.u8(); y.jumpAge = b.u8(); y.pickAge = b.u8();
    y.weight = b.u8(); y.hookT = b.u8(); y.hookCool = b.u16(); y.shoveCool = b.u8(); y.flareCool = b.u16(); y.stun = b.u8(); y.blind = b.u8(); y.guard = b.u8(); y.respawn = b.u16();
    y.buttons = b.u8(); y.yaw = b.u16(); y.pitch = b.i16(); y.clock = b.u32();
    if (y.hook) { y.hx = b.f64(); y.hy = b.f64(); y.hz = b.f64(); }
    y.carry = [];
    for (let n = b.u8(); n > 0; n--) y.carry.push(b.u16());
    return y;
}

function encodeSnap(m) {
    const b = new Bytes(scratch);
    b.u8(TYPE_SNAP); b.u32(m.tick); b.u32(m.ack);
    b.u8((m.ph === "over" ? 1 : 0));
    b.u16(m.ot); b.i8(m.win);
    for (let t = 0; t < 4; t++) b.u16(Math.max(0, Math.min(65535, m.bank[t])));
    encodeYou(b, m.you);
    // the others, where they changed: [id, x, y, z (cm), face, flags, weight, hx, hy, hz (cm, only while hooked)]
    b.u8(m.p.length);
    for (const r of m.p) { b.u8(r[0]); b.i16(r[1]); b.i16(r[2]); b.i16(r[3]); b.u16(r[4]); b.u8(r[5]); b.u8(r[6]); if (r[5] & FLAG.hook) { b.i16(r[7]); b.i16(r[8]); b.i16(r[9]); } }
    // score rows: [id, banked, lost, steals, shoves, ping]
    b.u8(m.sc.length);
    for (const r of m.sc) { b.u8(r[0]); b.u16(r[1]); b.u16(r[2]); b.u8(r[3]); b.u8(r[4]); b.u8(Math.min(255, r[5] >> 2)); }
    // loot: changed items [id, kind, holder, x, y, z (cm)], then ids gone
    b.u16(m.l.length);
    for (const r of m.l) { b.u16(r[0]); b.u8(r[1]); b.u8(r[2]); b.i16(r[3]); b.i16(r[4]); b.i16(r[5]); }
    b.u16(m.lg.length);
    for (const id of m.lg) b.u16(id);
    // events, as many as fit
    const count = b.at;
    b.u8(0);
    let n = 0;
    for (const e of m.ev) { if (b.left < 64 || n === 255) break; encodeEvent(b, e); n++; }
    b.view.setUint8(count, n);
    return scratch.slice(0, b.at);
}
function decodeSnap(b) {
    const m = { t: "snap", tick: b.u32(), ack: b.u32() }, bits = b.u8();
    m.ph = bits & 1 ? "over" : "play";
    m.ot = b.u16(); m.win = b.i8();
    m.bank = [b.u16(), b.u16(), b.u16(), b.u16()];
    m.you = decodeYou(b);
    m.p = [];
    for (let n = b.u8(); n > 0; n--) {
        const r = [b.u8(), b.i16() / 100, b.i16() / 100, b.i16() / 100, b.u16(), b.u8(), b.u8(), 0, 0, 0];
        if (r[5] & FLAG.hook) { r[7] = b.i16() / 100; r[8] = b.i16() / 100; r[9] = b.i16() / 100; }
        m.p.push(r);
    }
    m.sc = [];
    for (let n = b.u8(); n > 0; n--) m.sc.push([b.u8(), b.u16(), b.u16(), b.u8(), b.u8(), b.u8() * 4]);
    m.l = [];
    for (let n = b.u16(); n > 0; n--) m.l.push([b.u16(), b.u8(), b.u8(), b.i16() / 100, b.i16() / 100, b.i16() / 100]);
    m.lg = [];
    for (let n = b.u16(); n > 0; n--) m.lg.push(b.u16());
    m.ev = [];
    for (let n = b.u8(); n > 0; n--) m.ev.push(decodeEvent(b));
    return m;
}

export function flagsOf(p) {
    let f = (p.alive ? FLAG.alive : 0) | (p.ground ? FLAG.ground : 0) | (p.water === 2 ? FLAG.swim : 0) | (p.water === 3 ? FLAG.sunk : 0)
        | (p.hook ? FLAG.hook : 0) | (p.stun > 0 ? FLAG.stun : 0) | (p.blind > 0 ? FLAG.blind : 0);
    if (p.weight >= 7) f |= FLAG.idol;
    return f;
}

/**
 * A snapshot row for another player, as it travels: whole centimetres, facing as 16 bits of a turn.
 * The room compares rows to decide who has changed.
 */
export function playerRow(p) {
    const face = Math.round((Math.atan2(p.fy, p.fx) / (Math.PI * 2)) * 65536) & 0xffff, f = flagsOf(p);
    return [p.id, cm(p.x), cm(p.y), cm(p.z), face, f, Math.min(255, Math.round(p.weight)), f & FLAG.hook ? cm(p.hx) : 0, f & FLAG.hook ? cm(p.hy) : 0, f & FLAG.hook ? cm(p.hz) : 0];
}
/** A loot row: [id, kind, holder, x, y, z] in centimetres (a held item's position isn't sent; it rides its holder). */
export function lootRow(l) { return l.holder ? [l.id, l.kind, l.holder, 0, 0, 0] : [l.id, l.kind, 0, cm(l.x), cm(l.y), cm(l.z)]; }

/** @returns {string | ArrayBuffer} */
export function encode(message) {
    if (WIRE.binary) {
        if (message.t === "snap") return encodeSnap(message);
        if (message.t === "in") return encodeInput(message);
    } else if (message.t === "snap") {
        // the same message as text, rows in metres, as decodeSnap would give them
        return JSON.stringify({ ...message, p: message.p.map((r) => [r[0], r[1] / 100, r[2] / 100, r[3] / 100, r[4], r[5], r[6], r[7] / 100, r[8] / 100, r[9] / 100]),
            l: message.l.map((r) => [r[0], r[1], r[2], r[3] / 100, r[4] / 100, r[5] / 100]) });
    }
    return JSON.stringify(message);
}

/** @returns {object | null} null for anything that isn't a well-formed message */
export function decode(data) {
    try {
        if (typeof data === "string") {
            const m = JSON.parse(data);
            return m && typeof m === "object" && typeof m.t === "string" ? m : null;
        }
        const b = new Bytes(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), type = b.u8();
        return type === TYPE_SNAP ? decodeSnap(b) : type === TYPE_IN ? decodeInput(b) : null;
    } catch { return null; }
}

export function byteLength(data) { return typeof data === "string" ? data.length : data.byteLength; }

/** Names and chat are shown as text, never as markup; this only keeps them short and printable. */
export function cleanText(text, max) {
    return String(text ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Turn whatever a client sent as an input into one the simulation can trust, or null. */
export function cleanInput(m) {
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const s = n(m.s), vt = n(m.vt);
    if (!(s > 0) || !Number.isFinite(vt)) return null;
    const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);
    return {
        seq: Math.floor(s),
        mx: clamp(n(m.mx), -127, 127), my: clamp(n(m.my), -127, 127),
        buttons: clamp(n(m.b), 0, 255) & ALL_BUTTONS,
        yaw: clamp(n(m.yaw), 0, 65535), pitch: clamp(n(m.pitch), -32000, 32000),
        vt, lag: 0,
    };
}
