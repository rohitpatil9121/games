import { BTN, FOLD_IDS, MATCH } from "./data.js";

/**
 * PAPER PLANES: the wire protocol, shared by the server and the client. Copied from TIDEFALL's protocol.js
 * (itself from BREACH's) and adapted: the same message types and packing, plane fields.
 *
 * Every message is an object with a type `t`. encode() and decode() are the only place that knows how a
 * message is laid out in bytes.
 *
 *   client → server
 *     hello   { v, name, fold, room?, create? }   join a room by code, create one ({ mode, set, bots, skill, open }), or quick-play
 *     in      { s, p, r, b, vt }                  one tick of input: pitch, roll, buttons; vt = the server tick being drawn
 *     fold    { fold }                            change fold (the plane refolds at a launch spot)
 *     pong    { n }
 *     chat    { text }
 *     setup   { mode?, set?, bots?, skill? }      the host changes the room (starts a new round)
 *
 *   server → client
 *     welcome { id, room, tick }                  you are in; `room` carries its room file id, seed and mode
 *     start   { room, tick }                      a new round
 *     roster  { host, players: [{ id, name, fold, bot }] }
 *     snap    (see below)                         20 a second
 *     ping    { n }, chat { id, name, text }, error { text }
 *
 * THE AIR COSTS NOTHING. The wind is a pure function of the room, the seed and the time (game/air.js), so
 * no snapshot carries it; each plane's clock does.
 *
 * LAYOUT. `snap` and `in` travel as packed bytes; the rest are JSON text.
 *   in    1 type, 4 seq, 1 pitch, 1 roll, 1 buttons, 4 view tick                                  = 12 bytes
 *   snap  a header (tick, the last input applied, phase, the tag clock and grace, winners, erasers out:
 *         [spot, present]); your own plane in full (doubles where
 *         prediction must restart from the server's exact numbers); then only what changed since the last
 *         snapshot this client was sent: other planes (15 bytes: millimetres, heading, pitch, bank, flags,
 *         fold), score rows ([id, a, b, c, ping]: Ring Run next ring, ticks, best; Classic tags made,
 *         ticks as "it", erasers; Ink Spread tags made, ticks clean, erasers); then this interval's events.
 * The transport is reliable and ordered, so "changed since the last one sent" needs no acknowledgements.
 * @module game/protocol
 */

export const PROTOCOL = 1;
/** a snapshot goes out every this many ticks (20 Hz) */
export const SNAP_EVERY = 3;
/** remote planes are drawn this many ticks behind the newest snapshot */
export const INTERP_TICKS = 5;
export const NAME_MAX = 16;
export const CHAT_MAX = 120;
export const ALL_BUTTONS = Object.values(BTN).reduce((a, b) => a | b, 0);

/** flag bits of another plane in a snapshot */
export const FLAG = Object.freeze({ crumpled: 1, stalled: 2, guard: 4, it: 8, ink: 16, shield: 32 });

/** Set false to send everything as JSON (tools/net-test.mjs does, to measure what the packing saves). */
export const WIRE = { binary: true };

const TYPE_SNAP = 1, TYPE_IN = 2;
const EVENT = { flap: 1, stall: 2, glance: 3, crumple: 4, refold: 5, ring: 6, done: 7, restart: 8, tag: 9, shield: 10, eraser: 11, it: 12, over: 13 };
const EVENT_NAME = Object.fromEntries(Object.entries(EVENT).map(([name, code]) => [code, name]));
const mm = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 1000)));
const TAU = Math.PI * 2;
/** angles as they travel: heading as 16 bits of a turn, pitch and bank as fractions of a half turn */
export const angle16 = (a) => Math.round((a / TAU) * 65536) & 0xffff;
const pitch16 = (a) => Math.max(-32767, Math.min(32767, Math.round((a / Math.PI) * 32767)));
const roll8 = (a) => Math.max(-127, Math.min(127, Math.round((a / Math.PI) * 127)));

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
    const b = new Bytes(new ArrayBuffer(12));
    b.u8(TYPE_IN); b.u32(m.s); b.i8(m.p); b.i8(m.r); b.u8(m.b); b.f32(m.vt);
    return b.view.buffer;
}
function decodeInput(b) {
    if (b.left < 11) return null;
    return { t: "in", s: b.u32(), p: b.i8(), r: b.i8(), b: b.u8(), vt: b.f32() };
}

function encodeEvent(b, e) {
    const code = EVENT[e.type];
    if (!code) return;
    b.u8(code); b.u8(e.id);
    if (code === EVENT.glance || code === EVENT.crumple) { b.i16(mm(e.x)); b.i16(mm(e.y)); b.i16(mm(e.z)); }
    else if (code === EVENT.ring || code === EVENT.done) { b.u8(e.ring); b.u32(e.ticks); }
    else if (code === EVENT.tag) { b.u8(e.target); b.u8(e.lag); }
    else if (code === EVENT.shield) b.u8(e.target);
    else if (code === EVENT.eraser) b.u8(e.spot);
}
function decodeEvent(b) {
    const code = b.u8(), type = EVENT_NAME[code], id = b.u8();
    if (!type) throw new Error("unknown event " + code);
    if (code === EVENT.glance || code === EVENT.crumple) return { type, id, x: b.i16() / 1000, y: b.i16() / 1000, z: b.i16() / 1000 };
    if (code === EVENT.ring || code === EVENT.done) return { type, id, ring: b.u8(), ticks: b.u32() };
    if (code === EVENT.tag) return { type, id, target: b.u8(), lag: b.u8() };
    if (code === EVENT.shield) return { type, id, target: b.u8() };
    if (code === EVENT.eraser) return { type, id, spot: b.u8() };
    return { type, id };
}

/** Your own plane, in full: everything stepPlane and applyInput read, so prediction restarts from the server's state. */
function encodeYou(b, y) {
    for (const k of ["x", "y", "z", "yaw", "pitch", "roll", "speed", "bump"]) b.f64(y[k]);
    b.f32(y.vx); b.f32(y.vy); b.f32(y.vz);
    b.u8((y.stalled ? 1 : 0) | (y.run ? 2 : 0) | (y.run && y.run.done ? 4 : 0) | (y.it ? 8 : 0) | (y.ink ? 16 : 0) | (y.shield ? 32 : 0));
    b.u16(y.noBack); b.u8(y.noBackId);
    b.u16(y.flapWait); b.u8(y.flapBuffer); b.u8(y.crumpled); b.u8(y.guard); b.u8(y.held); b.u32(y.clock);
    b.u8(Math.max(0, FOLD_IDS.indexOf(y.fold)));
    if (y.run) { b.u8(y.run.next); b.u32(y.run.ticks); }
}
function decodeYou(b) {
    const y = {};
    for (const k of ["x", "y", "z", "yaw", "pitch", "roll", "speed", "bump"]) y[k] = b.f64();
    y.vx = b.f32(); y.vy = b.f32(); y.vz = b.f32();
    const f = b.u8();
    y.stalled = (f & 1) !== 0; y.it = (f & 8) !== 0; y.ink = (f & 16) !== 0; y.shield = f & 32 ? 1 : 0;
    y.noBack = b.u16(); y.noBackId = b.u8();
    y.flapWait = b.u16(); y.flapBuffer = b.u8(); y.crumpled = b.u8(); y.guard = b.u8(); y.held = b.u8(); y.clock = b.u32();
    y.fold = FOLD_IDS[b.u8()] || "glider";
    y.run = f & 2 ? { next: b.u8(), ticks: b.u32(), done: (f & 4) !== 0 } : null;
    return y;
}

function encodeSnap(m) {
    const b = new Bytes(scratch);
    b.u8(TYPE_SNAP); b.u32(m.tick); b.u32(m.ack);
    b.u8(m.ph === "over" ? 1 : 0); b.u16(m.ot);
    b.u16(Math.max(0, m.clock)); b.u8(Math.min(255, m.grace));
    b.u8(m.win.length); for (const id of m.win) b.u8(id);
    b.u8(m.er.length); for (const e of m.er) { b.u8(e[0]); b.u8(e[1]); }
    encodeYou(b, m.you);
    // the others, where they changed: [id, x, y, z (mm), heading, pitch, bank, flags, fold]
    b.u8(m.p.length);
    for (const r of m.p) { b.u8(r[0]); b.i16(r[1]); b.i16(r[2]); b.i16(r[3]); b.u16(r[4]); b.i16(r[5]); b.i8(r[6]); b.u8(r[7]); b.u8(r[8]); }
    // score rows: [id, next ring, run ticks, best ticks, ping]
    b.u8(m.sc.length);
    for (const r of m.sc) { b.u8(r[0]); b.u8(r[1]); b.u32(r[2]); b.u32(r[3]); b.u8(Math.min(255, r[4] >> 2)); }
    const count = b.at;
    b.u8(0);
    let n = 0;
    for (const e of m.ev) { if (b.left < 64 || n === 255) break; encodeEvent(b, e); n++; }
    b.view.setUint8(count, n);
    return scratch.slice(0, b.at);
}
function decodeSnap(b) {
    const m = { t: "snap", tick: b.u32(), ack: b.u32() };
    m.ph = b.u8() & 1 ? "over" : "play"; m.ot = b.u16();
    m.clock = b.u16(); m.grace = b.u8();
    m.win = []; for (let n = b.u8(); n > 0; n--) m.win.push(b.u8());
    m.er = []; for (let n = b.u8(); n > 0; n--) m.er.push([b.u8(), b.u8()]);
    m.you = decodeYou(b);
    m.p = [];
    for (let n = b.u8(); n > 0; n--) m.p.push([b.u8(), b.i16() / 1000, b.i16() / 1000, b.i16() / 1000, b.u16(), b.i16(), b.i8(), b.u8(), b.u8()]);
    m.sc = [];
    for (let n = b.u8(); n > 0; n--) m.sc.push([b.u8(), b.u8(), b.u32(), b.u32(), b.u8() * 4]);
    m.ev = [];
    for (let n = b.u8(); n > 0; n--) m.ev.push(decodeEvent(b));
    return m;
}

export function flagsOf(p) {
    return (p.crumpled > 0 ? FLAG.crumpled : 0) | (p.stalled ? FLAG.stalled : 0) | (p.guard > 0 ? FLAG.guard : 0) | (p.it ? FLAG.it : 0) | (p.ink ? FLAG.ink : 0) | (p.shield ? FLAG.shield : 0);
}

/** A snapshot row for another plane, as it travels. The room compares rows to decide who has changed. */
export function planeRow(p) {
    return [p.id, mm(p.x), mm(p.y), mm(p.z), angle16(p.yaw), pitch16(p.pitch), roll8(p.roll), flagsOf(p), Math.max(0, FOLD_IDS.indexOf(p.fold))];
}
/** what a row's angles mean, back in radians */
export const rowAngles = (r, out) => { out.yaw = (r[4] / 65536) * TAU; out.pitch = (r[5] / 32767) * Math.PI; out.roll = (r[6] / 127) * Math.PI; return out; };

/** @returns {string | ArrayBuffer} */
export function encode(message) {
    if (WIRE.binary) {
        if (message.t === "snap") return encodeSnap(message);
        if (message.t === "in") return encodeInput(message);
    } else if (message.t === "snap") {
        // the same message as text, rows in metres, as decodeSnap would give them
        const y = message.you;
        return JSON.stringify({ ...message, you: { ...pick(y), run: y.run ? { next: y.run.next, ticks: y.run.ticks, done: y.run.done } : null },
            p: message.p.map((r) => [r[0], r[1] / 1000, r[2] / 1000, r[3] / 1000, r[4], r[5], r[6], r[7], r[8]]) });
    }
    return JSON.stringify(message);
}
const YOU_KEYS = ["x", "y", "z", "yaw", "pitch", "roll", "speed", "bump", "vx", "vy", "vz", "stalled", "flapWait", "flapBuffer", "crumpled", "guard", "held", "clock", "fold", "it", "ink", "shield", "noBack", "noBackId"];
const pick = (y) => Object.fromEntries(YOU_KEYS.map((k) => [k, y[k]]));

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

/** a fold id from anything a client sent */
export const cleanFold = (f) => (FOLD_IDS.includes(f) ? f : "glider");
/** a mode from anything a client sent */
export const cleanMode = (m) => (MATCH.modes.includes(m) ? m : "rings");

/** Turn whatever a client sent as an input into one the simulation can trust, or null. */
export function cleanInput(m) {
    const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const s = n(m.s), vt = n(m.vt);
    if (!(s > 0) || !Number.isFinite(vt)) return null;
    const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);
    return { seq: Math.floor(s), pitch: clamp(n(m.p), -127, 127), roll: clamp(n(m.r), -127, 127), buttons: clamp(n(m.b), 0, 255) & ALL_BUTTONS, vt, lag: 0 };
}
