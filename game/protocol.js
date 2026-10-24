import { BTN } from "./data.js";

/**
 * SKYFARM: the co-op wire protocol, shared by the server and the client (after TIDEFALL's and BREACH's
 * protocol.js). Every message is a JSON object with a type `t`; the server runs `ws` with per-message deflate,
 * so the repetitive JSON of a world costs a fraction of its text on the wire (tools/net-test.mjs measures both).
 *
 *   client → server
 *     hello   { v, name, create?: { game } | room? }  host a farm (with its save) or join one by its code
 *     in      { s, mx, my, b, yaw, vt }               one tick of input; vt = the server tick being drawn
 *     talk    { who }                                 a conversation finished: its gifts, please
 *     trade   { op: "sell" | "buy", what, n }         at Captain Bram's
 *     pong    { n }
 *
 *   server → client
 *     welcome { id, room: { code, host }, tick, world, players }  you're in: the whole farm and who's here
 *     roster  { host, players: [{ id, name }] }
 *     snap    { tick, ack, you, p, sp, ev, w? }       20 a second: your own player in full, the others as
 *                                                     rows, the sprites, this interval's events; the world
 *                                                     (`w`, see room.mjs) when it changed, at most 5 a second
 *     save    { game }                                to the host only: the farm to keep (every 30 s, on sleep)
 *     ping    { n }, closed { why }, error { text }
 *
 * Nothing the client sends is trusted (cleanInput, cleanText; the room checks every talk and trade against
 * where the player actually is).
 * @module game/protocol
 */

export const PROTOCOL = 1;
/** a snapshot every this many ticks (20 Hz) */
export const SNAP_EVERY = 3;
/** others are drawn this many ticks behind the newest snapshot */
export const INTERP_TICKS = 5;
/** the world goes out at most this often (ticks), and at least every WORLD_MAX ticks */
export const WORLD_MIN = 12, WORLD_MAX = 300;
export const MAX_PLAYERS = 4;
export const NAME_MAX = 16;
export const ALL_BUTTONS = Object.values(BTN).reduce((a, b) => a | b, 0);

export const encode = (m) => JSON.stringify(m);
export function decode(data) {
    if (typeof data !== "string" || data.length > 300000) return null;
    try { const m = JSON.parse(data); return m && typeof m === "object" && typeof m.t === "string" ? m : null; } catch { return null; }
}

/** A name as it may be shown: printable, trimmed, short. */
export function cleanText(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** An input from the wire, checked and clamped, or null. */
export function cleanInput(m) {
    const int = (v, a, b) => (Number.isInteger(v) && v >= a && v <= b ? v : null);
    const seq = int(m.s, 1, 2 ** 31), mx = int(m.mx, -127, 127), my = int(m.my, -127, 127), b = int(m.b, 0, 255), yaw = int(m.yaw, 0, 65535);
    if (seq === null || mx === null || my === null || b === null || yaw === null) return null;
    return { seq, mx, my, buttons: b & ALL_BUTTONS, yaw, vt: Number.isFinite(m.vt) ? m.vt : 0 };
}

const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
/** another player as a snapshot row: id, position, heading, glide attitude, mode, speed, facing, asleep */
export const playerRow = (p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), r3(p.roll), p.mode === "glide" ? 1 : 0, r2(p.speed), r3(p.fx), r3(p.fy), p.asleep ? 1 : 0, r2(p.vx), r2(p.vy)];
export function readRow(row) {
    const [id, x, y, z, yaw, pitch, roll, glide, speed, fx, fy, asleep, vx, vy] = row;
    return { id, x, y, z, yaw, pitch, roll, glide, speed, fx, fy, asleep: !!asleep, vx, vy };
}
export const spriteRow = (s) => [s.id, r2(s.x), r2(s.y), r2(s.z), r2(s.vx), r2(s.vy)];
