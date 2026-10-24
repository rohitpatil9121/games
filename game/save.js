import { createState } from "./sim.js";
import { activeAir } from "./progression.js";
import { weatherOf } from "./farm.js";
import { DAY_TICKS } from "./data.js";

/**
 * SKYFARM: what is kept between visits (the `save-systems` skill, after TIDEFALL's save.js). Two kinds of record:
 *
 *   "skyfarm"        the profile: settings, key bindings, which tips have been seen, which slot to continue
 *   "skyfarm-slot-N" a game: slot 0 is the autosave (on every sleep, every 3 minutes of play, and when the
 *                    page is hidden); 1–3 are the player's own
 *
 * VERSIONED. Every record carries `version`; loading migrates older shapes one step at a time (MIGRATIONS)
 * and then fills anything missing from a fresh game or the default settings, so a new field never breaks an
 * old save.
 *
 * CRASH-SAFE. localStorage writes one key at a time, so a write goes to a scratch key first, is read back and
 * parsed (proof it is whole), then to the main key, keeping the previous good copy as a backup. Reading takes
 * the main key, then the backup, then the scratch copy: the first that parses. A full or blocked storage isn't
 * an error: the game plays on from memory, and says the save failed.
 *
 * THE GAME is the simulation state as plain JSON: Maps and Sets become tagged arrays, and what can be derived
 * again (the world, this tick's events, the air that blows) is left out and rebuilt on load. Loaded, the game
 * steps on exactly as the saved one would have (a test checks the hash after 20 s of play from both).
 * @module game/save
 */

export const SAVE_VERSION = 1;
export const SLOTS = 3;
const PROFILE = "skyfarm";
const slotKey = (n) => `skyfarm-slot-${n}`;

/** state fields that are derived, or only for this tick */
const SKIP = new Set(["world", "events", "air"]);

export function defaultSettings() {
    return {
        sensitivity: 1, invertY: false, fov: 58,
        quality: "auto", shadows: true, bloom: true, dynamicResolution: true,
        volume: 0.8, music: 0.8, sfx: 1, ambience: 1,
        captions: true, textSize: 1, scheme: "standard",
        reducedMotion: null, reducedRoll: false, reducedFov: false,
        assist: false, bindings: null,
    };
}
export function defaultProfile() {
    return { version: SAVE_VERSION, settings: defaultSettings(), tips: { seen: [], done: false }, last: 0 };
}

/** Old shapes to new: each step takes a record one version on. (Version 1 is the first.) */
export const MIGRATIONS = {};

// ------------------------------------------------------------------ the game as JSON

const encode = (v) => {
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [k, encode(x)]) };
    if (v instanceof Set) return { $set: [...v] };
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = encode(v[k]); return o; }
    return v;
};
const decode = (v) => {
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === "object") {
        if (v.$map) return new Map(v.$map.map(([k, x]) => [k, decode(x)]));
        if (v.$set) return new Set(v.$set);
        const o = {}; for (const k in v) o[k] = decode(v[k]); return o;
    }
    return v;
};

/** The game state as a plain object (no world, no events). */
export function snapshot(state) {
    const out = {};
    for (const k in state) if (!SKIP.has(k)) out[k] = encode(state[k]);
    return out;
}

/**
 * A game from a snapshot: a fresh game for this world, with every saved field laid over it (objects merged a
 * level deep, so a field added since the save keeps its new default).
 */
export function revive(world, snap) {
    const state = createState(world, { seed: snap.seed });
    const saved = decode(snap);
    for (const k in saved) {
        if (SKIP.has(k)) continue;
        const fresh = state[k], v = saved[k];
        if (fresh && v && typeof fresh === "object" && typeof v === "object" && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && !(fresh instanceof Map) && !(fresh instanceof Set)) {
            for (const f in v) {
                const a = fresh[f], b = v[f];
                // one more level for the pouch's seeds/crops/materials and the bridges' table
                fresh[f] = a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(b) && !(b instanceof Set) && !(b instanceof Map) ? { ...a, ...b } : b;
            }
        } else state[k] = v;
    }
    state.events = [];
    state.air = activeAir(world, state.progress.restored);
    state.weather = weatherOf(state.seed, Math.floor(state.tick / DAY_TICKS) + 1);
    return state;
}

// ------------------------------------------------------------------ storage

function parse(text) {
    if (!text) return null;
    try { const s = JSON.parse(text); return s && typeof s === "object" ? s : null; } catch { return null; }
}

export class SaveStore {
    /** @param {Storage | null} [storage] localStorage by default; a stand-in for tests */
    constructor(storage) {
        try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    }
    _get(key) { try { return this.storage ? this.storage.getItem(key) : null; } catch { return null; } }
    /** the first copy of a record that parses: main, backup, scratch */
    read(key) { return parse(this._get(key)) || parse(this._get(key + ".backup")) || parse(this._get(key + ".tmp")); }
    /** scratch, check, main (keeping the last good one as the backup). false if storage refused. */
    write(key, record) {
        const S = this.storage;
        if (!S) return false;
        try {
            const text = JSON.stringify({ ...record, version: SAVE_VERSION });
            S.setItem(key + ".tmp", text);
            if (!parse(S.getItem(key + ".tmp"))) return false;
            const previous = S.getItem(key);
            if (previous && parse(previous)) S.setItem(key + ".backup", previous);
            S.setItem(key, text);
            S.removeItem(key + ".tmp");
            return true;
        } catch { return false; }
    }
    _migrate(r) {
        let v = r.version || 1;
        while (v < SAVE_VERSION && MIGRATIONS[v]) { r = MIGRATIONS[v](r); v = r.version; }
        return r;
    }

    /** the profile, migrated and completed with defaults */
    profile() {
        const d = defaultProfile(), r = this.read(PROFILE);
        if (!r) return d;
        const s = this._migrate(r);
        return { ...d, ...s, version: SAVE_VERSION, settings: { ...d.settings, ...(s.settings || {}) }, tips: { ...d.tips, ...(s.tips || {}) } };
    }
    storeProfile(p) { return this.write(PROFILE, p); }

    /** what a slot holds, for the menu: { day, coins, restored, savedAt } or null */
    peek(n) {
        const r = this.read(slotKey(n));
        return r && r.game ? { day: r.day, coins: r.coins, restored: r.restored, savedAt: r.savedAt } : null;
    }
    /** save a game into a slot (0 = the autosave) */
    save(n, state) {
        return this.write(slotKey(n), {
            savedAt: Date.now(), day: Math.floor(state.tick / DAY_TICKS) + 1, coins: state.progress.coins, restored: state.progress.restored.size,
            game: snapshot(state),
        });
    }
    /** a slot's game, revived for this world, or null */
    load(n, world) {
        const r = this.read(slotKey(n));
        if (!r || !r.game) return null;
        try { return revive(world, this._migrate(r).game); } catch { return null; }
    }
    remove(n) { try { for (const s of ["", ".backup", ".tmp"]) this.storage.removeItem(slotKey(n) + s); } catch { /* blocked */ } }
}
