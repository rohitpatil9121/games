import { BTN } from "./data.js";
import { steerToward } from "./sim.js";

/**
 * PAPER PLANES: the player's controls (the `input-systems` skill). Mouse-aim, keyboard and gamepad all end up
 * as the same thing: one small input per tick (pitch, roll, buttons) for game/sim.js, and a view direction
 * for the chase camera.
 *
 * Adapted from TIDEFALL's controls.js (from BREACH's). Gameplay reads actions, never keys; a binding is a
 * list of codes the engine's Input understands ("KeyW", "Mouse0", "GamepadA", "TouchFlap"). Rebinding
 * replaces the keyboard-and-mouse codes of an action, or its gamepad code, depending on what was pressed.
 *
 * Steering:
 * - mouse-aim (default with a mouse): the mouse moves an aim direction; `steerToward` banks and pitches the
 *   plane toward it, so the plane does the flying and the camera looks where you aim.
 * - keys or the left stick: pitch and roll directly; the camera follows the plane. Touching them switches
 *   to this mode; moving the mouse switches back.
 * - Sticks use a radial deadzone rescaled to start at zero at its edge.
 * - Flap is an edge in the simulation (pressed this tick), buffered there for 8 ticks.
 * @module game/controls
 */

export const ACTIONS = [
    { id: "up", label: "Nose up", codes: ["KeyW", "ArrowUp"] },
    { id: "down", label: "Nose down", codes: ["KeyS", "ArrowDown"] },
    { id: "left", label: "Bank left", codes: ["KeyA", "ArrowLeft"] },
    { id: "right", label: "Bank right", codes: ["KeyD", "ArrowRight"] },
    { id: "flap", label: "Flap", codes: ["Space", "Mouse0", "GamepadA", "TouchFlap"] },
    { id: "restart", label: "Restart the run", codes: ["KeyR", "GamepadY"] },
];
export const defaultBindings = () => Object.fromEntries(ACTIONS.map((a) => [a.id, a.codes.slice()]));

const isPad = (code) => code.startsWith("Gamepad"), isTouch = (code) => code.startsWith("Touch");
const NAMES = { Mouse0: "Left mouse", Mouse1: "Middle mouse", Mouse2: "Right mouse", Space: "Space", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
    AltLeft: "Left Alt", AltRight: "Right Alt", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Tab: "Tab", Backquote: "`", Minus: "-", Equal: "=" };
/** A code as a person would say it. */
export function codeName(code) {
    if (NAMES[code]) return NAMES[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "Num " + code.slice(6);
    if (isPad(code)) return "Pad " + code.slice(7);
    return code;
}
/** The keyboard-or-mouse part and the gamepad part of a binding, for showing in the settings. */
export function describe(codes) {
    return { keys: codes.filter((c) => !isPad(c) && !isTouch(c)).map(codeName).join(" or ") || "none", pad: codes.filter(isPad).map(codeName).join(" or ") || "none" };
}
/** The first keyboard-or-mouse key of an action, short, for prompts ("Space to flap"). */
export function keyHint(bindings, id) {
    const c = (bindings[id] || []).find((k) => !isPad(k) && !isTouch(k));
    return c ? codeName(c) : "";
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEADZONE = 0.16;

/** A stick's two axes through a radial deadzone, rescaled to start at zero at its edge. */
function radial(x, y, out) {
    const m = Math.hypot(x, y);
    if (m < DEADZONE) { out[0] = 0; out[1] = 0; return out; }
    const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
    out[0] = x * k; out[1] = y * k;
    return out;
}

export class Controls {
    /**
     * @param {import("../engine/Input.js").Input} input
     * @param {HTMLCanvasElement} canvas
     * @param {{ sensitivity: number, invertPitch: boolean, bindings: Record<string, string[]> }} settings read live
     */
    constructor(input, canvas, settings) {
        this.input = input;
        this.canvas = canvas;
        this.settings = settings;
        /** the aim direction (mouse-aim), radians; pitch up is positive */
        this.aim = { yaw: 0, pitch: 0 };
        /** "mouse": steer toward the aim; "direct": keys or stick fly the plane */
        this.mode = "mouse";
        /** "keyboard" or "gamepad": the device that last did something, for prompts */
        this.device = "keyboard";
        this.active = false;
        this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        this._stick = [0, 0];
        this.apply();

        document.addEventListener("mousemove", (e) => {
            if (!this.active || !input.pointer.locked) return;
            if (Math.abs(e.movementX) + Math.abs(e.movementY) < 1) return;
            this.mode = "mouse"; this.device = "keyboard";
            const s = 0.0026 * this.settings.sensitivity;
            this.aim.yaw -= e.movementX * s;
            this.aim.pitch = clamp(this.aim.pitch - e.movementY * s * (this.settings.invertPitch ? -1 : 1), -1.1, 1.1);
        });
        // While the mouse is captured its buttons are read here (BREACH: the engine's pointer handler asks for
        // pointer capture, which a browser refuses on an element holding the pointer lock).
        canvas.addEventListener("pointerdown", (e) => { if (input.pointer.locked) e.stopImmediatePropagation(); }, true);
        document.addEventListener("mousedown", (e) => { if (input.pointer.locked) { input.press("Mouse" + e.button); e.preventDefault(); } });
        document.addEventListener("mouseup", (e) => input.release("Mouse" + e.button));
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    /** Hand the bindings to the engine's Input. Call after any change. */
    apply() {
        const b = this.settings.bindings, input = this.input, keys = (id) => b[id] || [];
        input.bindAxis("pitch", { negative: keys("down"), positive: keys("up") });
        input.bindAxis("roll", { negative: keys("left"), positive: keys("right") });
        input.bind("flap", keys("flap"));
        input.bind("restart", keys("restart"));
        input.bind("pause", ["GamepadStart"]);
    }

    /** Point the aim where the plane is going (after a refold, or when switching to keys). */
    resetAim(plane) { this.aim.yaw = plane.yaw; this.aim.pitch = plane.pitch; }

    /**
     * Wait for the next key, mouse button or gamepad button and make it the binding for an action.
     * Escape cancels. Resolves to the code, or null.
     */
    capture(actionId) {
        return new Promise((done) => {
            const finish = (code) => {
                removeEventListener("keydown", onKey, true); removeEventListener("mousedown", onMouse, true); clearInterval(poll);
                if (code) {
                    const codes = this.settings.bindings[actionId] || [];
                    this.settings.bindings[actionId] = isPad(code) ? [...codes.filter((c) => !isPad(c)), code] : [code, ...codes.filter((c) => isPad(c) || isTouch(c))];
                    this.apply();
                }
                done(code);
            };
            const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(e.code === "Escape" ? null : e.code); };
            const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); finish("Mouse" + e.button); };
            const names = ["GamepadA", "GamepadB", "GamepadX", "GamepadY", "GamepadLB", "GamepadRB", "GamepadLT", "GamepadRT", "GamepadBack", "GamepadStart", "GamepadLS", "GamepadRS", "GamepadUp", "GamepadDown", "GamepadLeft", "GamepadRight"];
            const poll = setInterval(() => {
                for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) if (pad) for (let i = 0; i < names.length; i++) if (pad.buttons[i] && pad.buttons[i].pressed) return finish(names[i]);
            }, 60);
            addEventListener("keydown", onKey, true);
            setTimeout(() => addEventListener("mousedown", onMouse, true), 150);
        });
    }

    /** Is an action held this tick (or pressed and released within it)? */
    held(action) { return this.input.isDown(action) || this.input.wasPressed(action); }

    _pad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) if (p && p.connected) return p;
        return null;
    }

    /**
     * This tick's input for a plane. Call once per fixed step.
     * @param {object} plane the player's (predicted) plane
     * @returns {{ pitch: number, roll: number, buttons: number }}
     */
    gather(plane) {
        const input = this.input, out = { pitch: 0, roll: 0, buttons: 0 };
        if (!this.active) return out;
        if (this.held("flap")) out.buttons |= BTN.flap;
        if (this.held("restart")) out.buttons |= BTN.restart;
        let x = input.axis("roll"), y = input.axis("pitch");
        const pad = this._pad();
        if (pad) {
            const [px, py] = radial(pad.axes[0] || 0, pad.axes[1] || 0, this._stick);
            if (px || py) this.device = "gamepad";
            if (Math.hypot(px, py) > Math.hypot(x, y)) { x = px; y = -py; }
        }
        if (x || y) {
            this.mode = "direct";
            if (this.settings.invertPitch) y = -y;
            out.pitch = Math.round(clamp(y, -1, 1) * 127);
            out.roll = Math.round(clamp(x, -1, 1) * 127);
            this.resetAim(plane);
        } else if (this.mode === "mouse") {
            const s = steerToward(plane, this.aim.yaw, this.aim.pitch);
            out.pitch = s.pitch; out.roll = s.roll;
        } else {
            this.resetAim(plane);
        }
        return out;
    }
}
