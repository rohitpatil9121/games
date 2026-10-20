import { defaultBindings, ACTIONS } from "./controls.js";

/**
 * TIDEFALL: what is kept between visits (the `save-systems` skill): name, practice setup, settings,
 * bindings, which first-match tips have been seen, and a personal best.
 *
 * VERSIONED. The save carries `version`; load() migrates older shapes step by step (v1 → v2) and fills
 * anything missing from the defaults, so a new setting never breaks an old save.
 *
 * CRASH-SAFE. localStorage writes one key at a time, so a write is done in three steps: the new save to a
 * scratch key, read back and parsed (proof it is whole), then to the main key, with the previous good
 * save kept as a backup. load() takes the main key, then the backup, then the scratch copy, then the
 * defaults: whichever is first to parse. A full or blocked storage is not an error: the game plays
 * on with what it has in memory.
 * @module game/save
 */

export const SAVE_VERSION = 2;
const KEY = "tidefall-save", BACKUP = KEY + ".backup", SCRATCH = KEY + ".tmp";

export function defaults() {
    return {
        version: SAVE_VERSION,
        name: "",
        practice: { teams: 2, bots: 4, skill: 2 },
        settings: {
            sensitivity: 1, invertY: false, fov: 70,
            quality: "high", water: "high", shadows: true, bloom: true,
            volume: 0.8, music: 0.7, sfx: 1,
            reducedMotion: null, scheme: "standard", captions: true, textSize: 1, assist: false,
            bindings: defaultBindings(),
        },
        tutorial: { seen: [], done: false },
        stats: { matches: 0, best: 0, banked: 0 },
    };
}

/** Old shapes to new. Each step takes the save one version on. */
const MIGRATIONS = {
    // v1 (stages 4 to 8) kept everything under "tidefall-save-v1" with fewer settings and no version
    1: (s) => ({ ...s, version: 2 }),
};

function parse(text) {
    if (!text) return null;
    try { const s = JSON.parse(text); return s && typeof s === "object" ? s : null; } catch { return null; }
}
function read(key) { try { return localStorage.getItem(key); } catch { return null; } }

/** The save, from the first copy that parses, migrated and completed with defaults. */
export function load() {
    let s = parse(read(KEY)) || parse(read(BACKUP)) || parse(read(SCRATCH)) || parse(read("tidefall-save-v1"));
    const d = defaults();
    if (!s) return d;
    let v = s.version || 1;
    while (v < SAVE_VERSION && MIGRATIONS[v]) { s = MIGRATIONS[v](s); v = s.version; }
    const st = s.settings || {};
    // bindings: keep the player's, add any action that is new since they saved
    const bindings = { ...d.settings.bindings, ...(st.bindings || {}) };
    for (const a of ACTIONS) if (!Array.isArray(bindings[a.id])) bindings[a.id] = d.settings.bindings[a.id];
    return {
        ...d, ...s, version: SAVE_VERSION,
        practice: { ...d.practice, ...(s.practice || {}) },
        settings: { ...d.settings, ...st, bindings },
        tutorial: { ...d.tutorial, ...(s.tutorial || {}) },
        stats: { ...d.stats, ...(s.stats || {}) },
    };
}

/** Write the save: scratch, check, main (keeping the last good one as the backup). Returns false if storage refused. */
export function store(save) {
    try {
        const text = JSON.stringify({ ...save, version: SAVE_VERSION });
        localStorage.setItem(SCRATCH, text);
        if (!parse(localStorage.getItem(SCRATCH))) return false;
        const previous = localStorage.getItem(KEY);
        if (previous && parse(previous)) localStorage.setItem(BACKUP, previous);
        localStorage.setItem(KEY, text);
        localStorage.removeItem(SCRATCH);
        return true;
    } catch { return false; }
}
