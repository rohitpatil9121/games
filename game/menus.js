import { ACTIONS, defaultBindings, describe } from "./controls.js";
import { SLOTS } from "./save.js";

/**
 * SKYFARM: the settings screen, the saved-farms screen, and menus by gamepad (after TIDEFALL's main.js). Every
 * control writes straight into the settings object and calls apply(), which puts it into effect and saves the
 * profile; nothing here knows how a setting works.
 * @module game/menus
 */

const $ = (id) => document.getElementById(id);

/**
 * @param {{ settings: object, controls: import("./controls.js").Controls, apply: (changed?: string) => void,
 *           back: () => void }} c
 */
export function settingsScreen(c) {
    const { settings, controls } = c;
    let capturing = false;
    const bind = (id, key, read, write, event = "input") => {
        const node = $(id);
        write(node, settings[key]);
        node.addEventListener(event, () => { settings[key] = read(node); c.apply(key); labels(); });
    };
    const number = (n) => +n.value, checked = (n) => n.checked, value = (n) => n.value;
    const setValue = (n, v) => { n.value = String(v); }, setChecked = (n, v) => { n.checked = !!v; };
    const pct = (v) => Math.round(v * 100) + "%";
    const labels = () => {
        $("s-sensitivity-out").textContent = settings.sensitivity.toFixed(2);
        $("s-fov-out").textContent = settings.fov + "°";
        for (const k of ["volume", "music", "sfx", "ambience"]) $(`s-${k}-out`).textContent = pct(settings[k]);
    };
    bind("s-sensitivity", "sensitivity", number, setValue);
    bind("s-invert", "invertY", checked, setChecked, "change");
    bind("s-fov", "fov", number, setValue);
    bind("s-quality", "quality", value, setValue, "change");
    bind("s-dynres", "dynamicResolution", checked, setChecked, "change");
    bind("s-shadows", "shadows", checked, setChecked, "change");
    bind("s-bloom", "bloom", checked, setChecked, "change");
    for (const k of ["volume", "music", "sfx", "ambience"]) bind(`s-${k}`, k, number, setValue);
    bind("s-captions", "captions", checked, setChecked, "change");
    bind("s-roll", "reducedRoll", checked, setChecked, "change");
    bind("s-fovkick", "reducedFov", checked, setChecked, "change");
    bind("s-scheme", "scheme", value, setValue, "change");
    bind("s-text", "textSize", number, setValue, "change");
    bind("s-assist", "assist", checked, setChecked, "change");
    $("s-motion").value = settings.reducedMotion === null ? "system" : settings.reducedMotion ? "on" : "off";
    $("s-motion").addEventListener("change", () => { const v = $("s-motion").value; settings.reducedMotion = v === "system" ? null : v === "on"; c.apply("reducedMotion"); });
    labels();

    // bindings: one row per action; press its button, then the key, mouse button or pad button
    const list = $("bindings");
    const rows = () => {
        list.replaceChildren(...ACTIONS.map((a) => {
            const row = document.createElement("div"), label = document.createElement("span"), button = document.createElement("button"), pad = document.createElement("span");
            const d = describe(settings.bindings[a.id] || []);
            row.className = "binding"; label.textContent = a.label; button.textContent = d.keys; pad.className = "pad"; pad.textContent = d.pad === "none" ? "" : d.pad;
            button.setAttribute("aria-label", `${a.label}: ${d.keys}. Press to change.`);
            button.addEventListener("click", async () => {
                if (capturing) return;
                capturing = true;
                button.textContent = "Press a key…"; button.classList.add("listening");
                await controls.capture(a.id);
                capturing = false;
                c.apply("bindings"); rows();
                [...list.querySelectorAll("button")][ACTIONS.indexOf(a)].focus();
            });
            row.append(label, button, pad);
            return row;
        }));
    };
    rows();
    $("bindings-reset").addEventListener("click", () => { settings.bindings = defaultBindings(); controls.apply(); c.apply("bindings"); rows(); });
    $("settings-back").addEventListener("click", () => { if (!capturing) c.back(); });
    return { get capturing() { return capturing; } };
}

/**
 * The saved-farms screen: the autosave and three slots, each with Save (only during a game) and Load.
 * @param {{ store: import("./save.js").SaveStore, canSave: () => boolean, save: (n: number) => boolean,
 *           load: (n: number) => boolean, back: () => void }} c
 */
export function slotsScreen(c) {
    const list = $("slot-list"), status = $("slot-status");
    const when = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };
    const fill = () => {
        list.replaceChildren(...Array.from({ length: SLOTS + 1 }, (_, n) => {
            const li = document.createElement("li"), what = document.createElement("div"), info = c.store.peek(n);
            what.className = "what";
            const name = document.createElement("b"); name.textContent = n === 0 ? "Autosave" : `Slot ${n}`;
            what.append(name, document.createTextNode(info ? `Day ${info.day} · ${info.coins} coins · ${info.restored} of 20 islands green · ${when(info.savedAt)}` : "Empty"));
            li.append(what);
            if (n > 0 && c.canSave()) {
                const b = document.createElement("button"); b.textContent = "Save here";
                b.addEventListener("click", () => { const ok = c.save(n); status.textContent = ok ? `Saved in slot ${n}.` : "Couldn't save: the browser's storage is full or blocked."; fill(); list.children[n].querySelector("button").focus(); });
                li.append(b);
            }
            const l = document.createElement("button"); l.textContent = "Load"; l.disabled = !info;
            l.addEventListener("click", () => { if (!c.load(n)) status.textContent = "That save couldn't be read."; });
            li.append(l);
            return li;
        }));
    };
    $("slots-back").addEventListener("click", () => c.back());
    return { open() { status.textContent = ""; fill(); } };
}

/** Menus by gamepad: the d-pad or left stick moves focus, A presses, B goes back. */
export function gamepadMenus(c) {
    let held = 0, was = { a: false, b: false };
    setInterval(() => {
        const screen = c.screen();
        if (screen === "play" || c.capturing()) return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [], pad = [...pads].find((p) => p && p.connected);
        if (!pad) return;
        const up = pad.buttons[12]?.pressed || pad.axes[1] < -0.6, down = pad.buttons[13]?.pressed || pad.axes[1] > 0.6;
        const a = !!pad.buttons[0]?.pressed, b = !!pad.buttons[1]?.pressed;
        const panel = $(screen);
        if ((up || down) && held <= 0 && panel) {
            const items = [...panel.querySelectorAll("button, input, select")].filter((n) => n.offsetParent !== null && !n.disabled);
            const i = items.indexOf(document.activeElement);
            const next = items[(i + (down ? 1 : -1) + items.length) % items.length];
            if (next) next.focus();
            held = 8;
        } else if (!up && !down) held = 0; else held--;
        if (a && !was.a && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.click();
        if (b && !was.b) c.back(screen);
        was = { a, b };
    }, 50);
}
