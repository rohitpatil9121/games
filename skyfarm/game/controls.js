import { TouchControls } from "../engine/index.js";
import { BTN } from "./data.js";

/**
 * SKYFARM: the player's controls (the `input-systems` skill), adapted from TIDEFALL's controls.js. Keyboard and
 * mouse first, then gamepad, then touch, all ending up as the same thing: one small input per tick (sim.js
 * PlayerInput) and a view direction for the camera. While gliding, the move keys steer the glider: A/D bank,
 * W dives, S pulls up.
 *
 * Every action can be rebound; a binding is a list of codes the engine's Input understands: a
 * KeyboardEvent.code ("KeyW"), a mouse button ("Mouse0"), a gamepad button ("GamepadA") or an on-screen touch
 * button ("TouchJump"). Gamepad sticks use a radial deadzone rescaled from its edge (the engine's is per axis,
 * which makes diagonals sticky) and a curve on the look stick.
 * @module game/controls
 */

export const ACTIONS = [
    { id: "forward", label: "Move forward / dive", codes: ["KeyW", "ArrowUp"] },
    { id: "back", label: "Move back / pull up", codes: ["KeyS", "ArrowDown"] },
    { id: "left", label: "Move left / bank left", codes: ["KeyA", "ArrowLeft"] },
    { id: "right", label: "Move right / bank right", codes: ["KeyD", "ArrowRight"] },
    { id: "jump", label: "Jump / open or close the glider", codes: ["Space", "GamepadA", "TouchJump"] },
    { id: "sprint", label: "Run", codes: ["ShiftLeft", "GamepadLS"] },
    { id: "interact", label: "Use (till, plant, water, harvest, pick up, sleep)", codes: ["KeyE", "Mouse0", "GamepadX", "TouchUse"] },
    { id: "cycle", label: "Next seed", codes: ["KeyQ", "GamepadY", "TouchSeed"] },
];
export const defaultBindings = () => Object.fromEntries(ACTIONS.map((a) => [a.id, a.codes.slice()]));

const isPad = (code) => code.startsWith("Gamepad"), isTouch = (code) => code.startsWith("Touch");
const NAMES = { Mouse0: "Left mouse", Mouse1: "Middle mouse", Mouse2: "Right mouse", Space: "Space", ShiftLeft: "Shift", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
/** A code as a person would say it. */
export function codeName(code) {
    if (NAMES[code]) return NAMES[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (isPad(code)) return "Pad " + code.slice(7);
    return code;
}
/** An action's keys and pad buttons as words, for the settings ("E or Left mouse", "Pad X"). */
export function describe(codes) {
    return { keys: codes.filter((c) => !isPad(c) && !isTouch(c)).map(codeName).join(" or ") || "none", pad: codes.filter(isPad).map(codeName).join(" or ") || "none" };
}
/** The first keyboard-or-mouse key of an action, short, for prompts ("E"). */
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
     * @param {{ sensitivity: number, invertY: boolean, bindings: Record<string, string[]> }} settings read live
     */
    constructor(input, canvas, settings) {
        this.input = input;
        this.canvas = canvas;
        this.settings = settings;
        /** where the player is looking, in radians (pitch up is positive); idle: seconds since the last look */
        this.view = { yaw: 0, pitch: -0.25, idle: 99 };
        this.active = false;
        this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        this._stick = [0, 0];
        this.apply();

        document.addEventListener("mousemove", (e) => {
            if (!this.active || !input.pointer.locked) return;
            this.turn(-e.movementX * 0.0022, -e.movementY * 0.0022);
        });
        // While the mouse is captured its buttons are read here (BREACH: the engine's pointer handler asks for
        // pointer capture, which a browser refuses on an element holding the pointer lock).
        canvas.addEventListener("pointerdown", (e) => { if (input.pointer.locked) e.stopImmediatePropagation(); }, true);
        document.addEventListener("mousedown", (e) => { if (input.pointer.locked) { input.press("Mouse" + e.button); e.preventDefault(); } });
        document.addEventListener("mouseup", (e) => input.release("Mouse" + e.button));
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        // touch: a stick on the left, buttons on the right, and a drag anywhere else to look
        this.touch = new TouchControls(input, { visible: false });
        this.touch.joystick({ x: "moveX", y: "moveY" });
        this.touch.button({ code: "TouchJump", label: "Jump", size: 78, offset: [24, 28] });
        this.touch.button({ code: "TouchUse", label: "Use", size: 64, offset: [118, 30] });
        this.touch.button({ code: "TouchSeed", label: "Seed", size: 50, offset: [40, 124] });
        const drags = new Map();
        canvas.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") drags.set(e.pointerId, [e.clientX, e.clientY]); });
        canvas.addEventListener("pointermove", (e) => {
            const from = drags.get(e.pointerId);
            if (!from || !this.active) return;
            this.turn(-(e.clientX - from[0]) * 0.006, -(e.clientY - from[1]) * 0.006);
            from[0] = e.clientX; from[1] = e.clientY;
        });
        for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, (e) => drags.delete(e.pointerId));
    }

    /** Turn the view by an angle (already scaled for the device); sensitivity and inversion are applied here. */
    turn(dYaw, dPitch) {
        const s = this.settings.sensitivity, v = this.view;
        v.yaw += dYaw * s;
        v.pitch = clamp(v.pitch + dPitch * s * (this.settings.invertY ? -1 : 1), -1.25, 0.9);
        v.idle = 0;
    }

    /** Hand the bindings to the engine's Input. Call after any change. */
    apply() {
        const b = this.settings.bindings, input = this.input, keys = (id) => b[id] || [];
        input.bindAxis("moveX", { negative: keys("left"), positive: keys("right") });
        input.bindAxis("moveY", { negative: keys("back"), positive: keys("forward") });
        for (const a of ACTIONS) if (!["forward", "back", "left", "right"].includes(a.id)) input.bind(a.id, keys(a.id));
        input.bind("pause", ["GamepadStart"]);
    }

    showTouch(on) { this.touch.setVisible(on && this.coarse); }

    /**
     * Rebind an action (TIDEFALL's): resolves with the next key, mouse button or gamepad button pressed (null for
     * Escape, which cancels). A key replaces the action's keyboard/mouse codes; a pad button replaces its pad
     * codes; touch buttons stay.
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
            // ignore a pad button already held when listening starts (the A that pressed "change")
            const held = new Set();
            for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) if (pad) pad.buttons.forEach((b, i) => b.pressed && held.add(i));
            const poll = setInterval(() => {
                for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) if (pad) for (let i = 0; i < names.length; i++) {
                    if (pad.buttons[i] && pad.buttons[i].pressed) { if (!held.has(i)) return finish(names[i]); } else held.delete(i);
                }
            }, 60);
            addEventListener("keydown", onKey, true);
            setTimeout(() => addEventListener("mousedown", onMouse, true), 150);
        });
    }

    /** Is an action held? A finger on the view is for looking, so it doesn't count as the mouse button. */
    held(action) {
        const input = this.input;
        if (input.pointer.type !== "touch") return input.isDown(action) || input.wasPressed(action);
        for (const code of this.settings.bindings[action] || []) if (!code.startsWith("Mouse") && input.down.has(code)) return true;
        return false;
    }

    _pad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) if (p && p.connected) return p;
        return null;
    }

    /** The right stick turns the view. Call once per rendered frame. */
    look(dt) {
        this.view.idle += dt;
        if (!this.active) return;
        const pad = this._pad();
        if (!pad) return;
        const [x, y] = radial(pad.axes[2] || 0, pad.axes[3] || 0, this._stick);
        if (x || y) this.turn(-x * Math.abs(x) * 3.2 * dt, -y * Math.abs(y) * 2.2 * dt);
    }

    /**
     * This tick's controls. Call once per fixed step.
     * @returns {{ mx: number, my: number, buttons: number }}
     */
    gather() {
        const input = this.input, out = { mx: 0, my: 0, buttons: 0 };
        if (!this.active) return out;
        for (const [id, bit] of [["jump", BTN.jump], ["sprint", BTN.sprint], ["interact", BTN.interact], ["cycle", BTN.cycle]]) {
            if (this.held(id)) out.buttons |= bit;
        }
        let x = input.axis("moveX"), y = input.axis("moveY");
        const pad = this._pad();
        if (pad) {
            const [px, py] = radial(pad.axes[0] || 0, pad.axes[1] || 0, this._stick);
            if (Math.hypot(px, py) > Math.hypot(x, y)) { x = px; y = -py; }
        }
        out.mx = Math.round(clamp(x, -1, 1) * 127); out.my = Math.round(clamp(y, -1, 1) * 127);
        return out;
    }
}
