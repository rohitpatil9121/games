import { BTN, ROLE, MOVE } from "./data.js";
import { PROP_SHAPE } from "./props.js";

/**
 * DECOY: the wire protocol, shared by the server and the client. Taken from BREACH and changed only
 * where the game is different: an input can name a prop to become, a player row carries its prop, and
 * there are decoys and ping grenades instead of rockets and pickups.
 *
 *   client → server
 *     hello   { v, name, room?, create? }   join a room by code, create one, or quick-play
 *     in      { s, mx, my, b, yaw, pitch, pr, vt }   one tick of input; pr = 1 + map prop to become, or 0
 *     pong    { n }
 *     chat    { text }
 *     setup   { map?, bots?, skill? }        the host changes the room
 *
 *   server → client
 *     welcome { id, room, tick }
 *     roster  { host, players: [{ id, name, team, bot }] }
 *     snap    (see below)                    20 times a second
 *     start   { room, tick }                 a new match on (maybe) a new map
 *     ping    { n }
 *     chat    { id, name, text }
 *     error   { text }
 *
 * LAYOUT. `snap` and `in` travel as packed bytes; the rest are rare and stay JSON text.
 *
 *   in    1 type, 4 seq, 1 mx, 1 my, 1 buttons, 2 yaw, 2 pitch, 2 prop, 4 view tick           = 18 bytes
 *   snap  header; your own player in full (doubles for position and velocity, so prediction restarts from
 *         exactly the server's numbers); the others, only those that changed since the last snapshot this
 *         client was sent (13 bytes each); score rows that changed; decoys and grenades; events.
 * The transport is reliable and ordered, so "since the last one sent" is safe without acknowledgements.
 * @module game/protocol
 */

export const PROTOCOL = 1;
/** the simulation runs at 60 Hz; a snapshot goes out every this many ticks (20 Hz) */
export const SNAP_EVERY = 3;
/** remote players are drawn this many ticks behind the newest snapshot */
export const INTERP_TICKS = 5;
export const NAME_MAX = 16;
export const CHAT_MAX = 120;
export const ALL_BUTTONS = Object.values(BTN).reduce((a, b) => a | b, 0);

/** flag bits of a player in a snapshot */
export const FLAG = Object.freeze({ alive: 1, crouched: 2, ground: 4, locked: 8, seeker: 16, frozen: 32 });

export function flagsOf(p) {
    return (p.alive ? FLAG.alive : 0) | (p.crouched ? FLAG.crouched : 0) | (p.ground ? FLAG.ground : 0) | (p.locked ? FLAG.locked : 0)
        | (p.role === ROLE.seeker ? FLAG.seeker : 0) | (p.frozen ? FLAG.frozen : 0);
}

/** Set false to send everything as JSON (tools/net-test.mjs does, to measure what the packing saves). */
export const WIRE = { binary: true };

const TYPE_SNAP = 1, TYPE_IN = 2;
export const PHASES = ["wait", "hide", "seek", "end", "over"];
const EVENT = { shot: 1, hurt: 2, kill: 3, spawn: 4, disguise: 5, throw: 6, land: 7, burst: 8, ping: 9, squeak: 10, decoy: 11, pop: 12, taunt: 13, phase: 14, late: 15 };
const EVENT_NAME = Object.fromEntries(Object.entries(EVENT).map(([name, code]) => [code, name]));
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
    xyz(p) { this.i16(cm(p[0])); this.i16(cm(p[1])); this.i16(cm(p[2])); }
    rxyz() { return [this.i16() / 100, this.i16() / 100, this.i16() / 100]; }
}
const scratch = new ArrayBuffer(8192);

function encodeInput(m) {
    const b = new Bytes(new ArrayBuffer(18));
    b.u8(TYPE_IN); b.u32(m.s); b.i8(m.mx); b.i8(m.my); b.u8(m.b); b.u16(m.yaw); b.i16(m.pitch); b.u16(m.pr); b.f32(m.vt);
    return b.view.buffer;
}
function decodeInput(b) {
    if (b.left < 17) return null;
    return { t: "in", s: b.u32(), mx: b.i8(), my: b.i8(), b: b.u8(), yaw: b.u16(), pitch: b.i16(), pr: b.u16(), vt: b.f32() };
}

function encodeEvent(b, e) {
    const code = EVENT[e.type];
    if (!code) return;
    b.u8(code);
    switch (code) {
        case EVENT.shot: b.u8(e.id); b.xyz(e.o); b.xyz(e.end); b.u8(e.what); b.u16(e.prop + 1); b.u8(e.target); break;
        case EVENT.hurt: b.u8(e.id); b.u8(e.by); b.u8(Math.min(255, e.amount)); b.u8(e.self); break;
        case EVENT.kill: b.u8(e.id); b.u8(e.by); b.u8(e.how); break;
        case EVENT.spawn: b.u8(e.id); b.u16(e.yaw); b.u8(e.role); break;
        case EVENT.disguise: b.u8(e.id); b.u8(e.prop); break;
        case EVENT.throw: b.u8(e.id); break;
        case EVENT.land: case EVENT.burst: b.u16(e.gid); b.xyz([e.x, e.y, e.z]); break;
        case EVENT.ping: b.u8(e.by); b.u8(e.ids.length); for (const id of e.ids) b.u8(id); break;
        case EVENT.squeak: b.u8(e.id); b.xyz([e.x, e.y, e.z]); break;
        case EVENT.decoy: b.u8(e.id); b.u16(e.did); break;
        case EVENT.pop: b.u16(e.did); b.xyz([e.x, e.y, e.z]); break;
        case EVENT.taunt: b.u8(e.id); b.u8(e.kind | (e.forced ? 128 : 0)); b.u8(e.points); b.xyz([e.x, e.y, e.z]); break;
        case EVENT.phase: b.u8(PHASES.indexOf(e.phase)); b.u8(e.round); b.u8(e.winner); break;
        case EVENT.late: break;
    }
}
function decodeEvent(b) {
    const code = b.u8(), type = EVENT_NAME[code];
    switch (code) {
        case EVENT.shot: { const e = { type, id: b.u8(), o: b.rxyz(), end: b.rxyz(), what: b.u8() }; e.prop = b.u16() - 1; e.target = b.u8(); return e; }
        case EVENT.hurt: return { type, id: b.u8(), by: b.u8(), amount: b.u8(), self: b.u8() };
        case EVENT.kill: return { type, id: b.u8(), by: b.u8(), how: b.u8() };
        case EVENT.spawn: return { type, id: b.u8(), yaw: b.u16(), role: b.u8() };
        case EVENT.disguise: return { type, id: b.u8(), prop: b.u8() };
        case EVENT.throw: return { type, id: b.u8() };
        case EVENT.land: case EVENT.burst: { const gid = b.u16(), [x, y, z] = b.rxyz(); return { type, gid, x, y, z }; }
        case EVENT.ping: { const e = { type, by: b.u8(), ids: [] }; for (let n = b.u8(); n > 0; n--) e.ids.push(b.u8()); return e; }
        case EVENT.squeak: { const id = b.u8(), [x, y, z] = b.rxyz(); return { type, id, x, y, z }; }
        case EVENT.decoy: return { type, id: b.u8(), did: b.u16() };
        case EVENT.pop: { const did = b.u16(), [x, y, z] = b.rxyz(); return { type, did, x, y, z }; }
        case EVENT.taunt: { const id = b.u8(), k = b.u8(), points = b.u8(), [x, y, z] = b.rxyz(); return { type, id, kind: k & 127, forced: k >> 7, points, x, y, z }; }
        case EVENT.phase: return { type, phase: PHASES[b.u8()], round: b.u8(), winner: b.u8() };
        case EVENT.late: return { type };
    }
    throw new Error("unknown event " + code);
}

/** your own player, as it travels */
function encodeYou(b, y) {
    b.f64(y.x); b.f64(y.y); b.f64(y.z); b.f64(y.vx); b.f64(y.vy); b.f64(y.vz); b.f64(y.charge);
    // the collision box is not sent: it is the prop's, and the bit says whether its footprint is turned a quarter
    const odd = y.prop >= 0 && y.hx !== PROP_SHAPE[y.prop][0];
    b.u8((y.ground ? 1 : 0) | (y.crouched ? 2 : 0) | (y.alive ? 4 : 0) | (y.locked ? 8 : 0) | (y.frozen ? 16 : 0) | (odd ? 32 : 0));
    b.u8(Math.max(0, Math.min(255, y.health))); b.u8(y.role); b.u8(y.prop + 1); b.u16(y.propYaw);
    b.u8(y.cool); b.u8(y.buttons); b.u16(Math.min(65535, y.rest)); b.u8(y.pings); b.u8(y.decoys);
    b.u16(Math.max(0, y.tauntIn)); b.u16(y.tauntCool); b.u8(y.disguiseCool); b.u16(y.yaw); b.i16(y.pitch);
}
function decodeYou(b) {
    const y = { x: b.f64(), y: b.f64(), z: b.f64(), vx: b.f64(), vy: b.f64(), vz: b.f64(), charge: b.f64() }, f = b.u8();
    y.ground = (f & 1) !== 0; y.crouched = (f & 2) !== 0; y.alive = (f & 4) !== 0; y.locked = (f & 8) !== 0; y.frozen = (f & 16) !== 0;
    y.health = b.u8(); y.role = b.u8(); y.prop = b.u8() - 1; y.propYaw = b.u16();
    if (y.prop >= 0) { const s = PROP_SHAPE[y.prop], odd = (f & 32) !== 0; y.hx = odd ? s[1] : s[0]; y.hy = odd ? s[0] : s[1]; y.h = s[2]; }
    else { y.hx = y.hy = MOVE.radius; y.h = MOVE.height; }
    y.cool = b.u8(); y.buttons = b.u8(); y.rest = b.u16(); y.pings = b.u8(); y.decoys = b.u8();
    y.tauntIn = b.u16(); y.tauntCool = b.u16(); y.disguiseCool = b.u8(); y.yaw = b.u16(); y.pitch = b.i16();
    return y;
}

function encodeSnap(m) {
    const b = new Bytes(scratch);
    b.u8(TYPE_SNAP); b.u32(m.tick); b.u32(m.ack);
    b.u8(PHASES.indexOf(m.ph) | (m.late ? 16 : 0)); b.u8(m.round); b.u8(m.rounds); b.u16(m.tl); b.u8(m.ts[1]); b.u8(m.ts[2]); b.u8(m.win); b.u8(m.st);
    encodeYou(b, m.you);
    b.u8(m.p.length);
    for (const r of m.p) { b.u8(r[0]); b.i16(r[1]); b.i16(r[2]); b.i16(r[3]); b.u16(r[4]); b.i8(r[5]); b.u8(r[6]); b.u8(r[7]); b.u16(r[8]); }
    b.u8(m.sc.length);
    for (const r of m.sc) { b.u8(r[0]); b.i16(r[1]); b.u8(r[2]); b.u8(r[3]); b.u8(Math.min(255, r[4] >> 2)); }
    b.u8(m.d.length);
    for (const r of m.d) { b.u16(r[0]); b.u8(r[1]); b.u8(r[2]); b.i16(r[3]); b.i16(r[4]); b.i16(r[5]); b.u16(r[6]); }
    b.u8(m.g.length);
    for (const r of m.g) { b.u16(r[0]); b.u8(r[1]); b.i16(r[2]); b.i16(r[3]); b.i16(r[4]); b.u8(r[5]); }
    const count = b.at;
    b.u8(0);
    let n = 0;
    for (const e of m.ev) { if (b.left < 96 || n === 255) break; encodeEvent(b, e); n++; }
    b.view.setUint8(count, n);
    return scratch.slice(0, b.at);
}
function decodeSnap(b) {
    const m = { t: "snap", tick: b.u32(), ack: b.u32() }, ph = b.u8();
    m.ph = PHASES[ph & 15]; m.late = (ph & 16) !== 0;
    m.round = b.u8(); m.rounds = b.u8(); m.tl = b.u16(); m.ts = [0, b.u8(), b.u8()]; m.win = b.u8(); m.st = b.u8();
    m.you = decodeYou(b);
    m.p = [];
    for (let n = b.u8(); n > 0; n--) m.p.push([b.u8(), b.i16() / 100, b.i16() / 100, b.i16() / 100, b.u16(), b.i8() * 256, b.u8(), b.u8() - 1, b.u16()]);
    m.sc = [];
    for (let n = b.u8(); n > 0; n--) m.sc.push([b.u8(), b.i16(), b.u8(), b.u8(), b.u8() * 4]);
    m.d = [];
    for (let n = b.u8(); n > 0; n--) m.d.push([b.u16(), b.u8(), b.u8(), b.i16() / 100, b.i16() / 100, b.i16() / 100, b.u16()]);
    m.g = [];
    for (let n = b.u8(); n > 0; n--) m.g.push([b.u16(), b.u8(), b.i16() / 100, b.i16() / 100, b.i16() / 100, b.u8()]);
    m.ev = [];
    for (let n = b.u8(); n > 0; n--) m.ev.push(decodeEvent(b));
    return m;
}

/**
 * A snapshot row for one player, as it travels: id, position in whole centimetres, view yaw, pitch to
 * 8 bits, flags, prop (−1 none), prop yaw. The room compares rows to decide who has changed.
 */
export function playerRow(p) {
    return [p.id, cm(p.x), cm(p.y), cm(p.z), p.yaw, Math.max(-127, Math.min(127, Math.round(p.pitch / 256))), flagsOf(p), p.prop + 1, p.propYaw];
}
/** a decoy as it travels: id, owner, type, position, yaw */
export const decoyRow = (d) => [d.id, d.owner, d.type, cm(d.x), cm(d.y), cm(d.z), d.yaw];
/** a grenade: id, owner, position, landed */
export const pingRow = (g) => [g.id, g.owner, cm(g.x), cm(g.y), cm(g.z), g.fuse >= 0 ? 1 : 0];

/** @returns {string | ArrayBuffer} */
export function encode(message) {
    if (WIRE.binary) {
        if (message.t === "snap") return encodeSnap(message);
        if (message.t === "in") return encodeInput(message);
    } else if (message.t === "snap") {
        const metres = (r, from, to) => r.map((v, i) => (i >= from && i <= to ? v / 100 : v));
        return JSON.stringify({ ...message, p: message.p.map((r) => { const o = metres(r, 1, 3); o[5] *= 256; o[7] -= 1; return o; }),
            d: message.d.map((r) => metres(r, 3, 5)), g: message.g.map((r) => metres(r, 2, 4)) });
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
        // which prop: the simulation checks it against the real prop list, the distance and the line of sight
        prop: clamp(n(m.pr), 0, 65535),
        vt, lag: 0,
    };
}

/** Your own player as a snapshot carries it: only these fields travel. */
export const YOU_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "charge", "ground", "crouched", "alive", "locked", "frozen", "health", "role", "prop", "propYaw", "hx", "hy", "h", "cool", "buttons", "rest", "pings", "decoys", "tauntIn", "tauntCool", "disguiseCool", "yaw", "pitch"];
export function youOf(p) { const o = {}; for (const k of YOU_FIELDS) o[k] = p[k]; return o; }
