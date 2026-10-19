import { TouchControls } from "../engine/index.js";
import { BTN } from "./data.js";

/**
 * DECOY: the player's controls. Taken from BREACH: keyboard and mouse first, then gamepad, then touch, all
 * ending up as one small input per tick (game/sim.js PlayerInput) and a view direction. What changed is
 * the actions: there is one weapon, and hiders have a disguise, a lock and a taunt.
 *
 * Every action can be rebound. A binding is a list of codes the engine's Input understands: a
 * KeyboardEvent.code ("KeyW"), a mouse button ("Mouse0"), a gamepad button ("GamepadA") or an on-screen
 * touch button ("TouchFire"). Rebinding replaces the keyboard-and-mouse codes of an action, or its
 * gamepad code, depending on what was pressed, and leaves the other device's alone.
 * @module game/controls
 */

export const ACTIONS = [
    { id: "forward", label: "Move forward", codes: ["KeyW", "ArrowUp"] },
    { id: "back", label: "Move back", codes: ["KeyS", "ArrowDown"] },
    { id: "left", label: "Move left", codes: ["KeyA", "ArrowLeft"] },
    { id: "right", label: "Move right", codes: ["KeyD", "ArrowRight"] },
    { id: "jump", label: "Jump", codes: ["Space", "GamepadA", "TouchJump"] },
    { id: "sprint", label: "Sprint", codes: ["ShiftLeft", "GamepadLS"] },
    { id: "crouch", label: "Crouch (seeker) · fly down (ghost)", codes: ["KeyC", "ControlLeft", "GamepadB", "TouchCrouch"] },
    { id: "fire", label: "Scan (seeker)", codes: ["Mouse0", "GamepadRT", "TouchFire"] },
    { id: "disguise", label: "Become what you look at (hider)", codes: ["KeyE", "Mouse0", "GamepadX", "TouchProp"] },
    { id: "lock", label: "Lock rotation (hider)", codes: ["KeyR", "Mouse2", "GamepadY", "TouchLock"] },
    { id: "taunt", label: "Taunt (hider)", codes: ["KeyT", "GamepadRB", "TouchTaunt"] },
    { id: "ability", label: "Ping grenade · decoy", codes: ["KeyG", "KeyQ", "GamepadLB", "TouchAbility"] },
    { id: "scores", label: "Scores", codes: ["Tab", "GamepadBack"] },
    { id: "chat", label: "Chat", codes: ["Enter"] },
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
/** The first key of an action, for prompts on screen ("E: become Crate"). */
export const keyName = (settings, action) => { const c = (settings.bindings[action] || []).find((x) => !isPad(x) && !isTouch(x)); return c ? codeName(c) : "?"; };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
        /** where the player is looking, in radians */
        this.view = { yaw: 0, pitch: 0 };
        this.active = false;
        this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        /** the pitch the view may reach: a hider's orbit camera stops short of straight down */
        this.pitchLimit = [-1.5, 1.5];
        this.apply();

        document.addEventListener("mousemove", (e) => {
            if (!this.active || !input.pointer.locked) return;
            this.turn(-e.movementX * 0.0022, -e.movementY * 0.0022);
        });
        // While the mouse is captured its buttons are read here (see BREACH: the engine's pointer handler
        // asks for pointer capture, which a browser refuses on an element holding the pointer lock).
        canvas.addEventListener("pointerdown", (e) => { if (input.pointer.locked) e.stopImmediatePropagation(); }, true);
        document.addEventListener("mousedown", (e) => { if (input.pointer.locked) { input.press("Mouse" + e.button); e.preventDefault(); } });
        document.addEventListener("mouseup", (e) => input.release("Mouse" + e.button));
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        // touch: a stick on the left, buttons on the right, a drag anywhere else on the right to look
        this.touch = new TouchControls(input, { visible: false });
        this.touch.joystick({ x: "moveX", y: "moveY" });
        this.buttons = {
            fire: this.touch.button({ code: "TouchFire", label: "Scan", size: 84, offset: [24, 30] }),
            prop: this.touch.button({ code: "TouchProp", label: "Become", size: 84, offset: [24, 30] }),
            jump: this.touch.button({ code: "TouchJump", label: "Jump", size: 60, offset: [122, 24] }),
            crouch: this.touch.button({ code: "TouchCrouch", label: "Duck", size: 56, offset: [30, 128] }),
            lock: this.touch.button({ code: "TouchLock", label: "Lock", size: 56, offset: [30, 128] }),
            ability: this.touch.button({ code: "TouchAbility", label: "Ping", size: 56, offset: [100, 108] }),
            taunt: this.touch.button({ code: "TouchTaunt", label: "Taunt", size: 56, offset: [170, 84] }),
        };
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

    turn(dYaw, dPitch) {
        const s = this.settings.sensitivity, v = this.view;
        v.yaw += dYaw * s;
        v.pitch = clamp(v.pitch + dPitch * s * (this.settings.invertY ? -1 : 1), this.pitchLimit[0], this.pitchLimit[1]);
    }

    apply() {
        const b = this.settings.bindings, input = this.input, keys = (id) => b[id] || [];
        input.bindAxis("moveX", { negative: keys("left"), positive: keys("right"), gamepad: "LeftX" });
        input.bindAxis("moveY", { negative: keys("back"), positive: keys("forward") });
        for (const a of ACTIONS) if (!["forward", "back", "left", "right"].includes(a.id)) input.bind(a.id, keys(a.id));
        input.bind("pause", ["GamepadStart"]);
    }

    /**
     * Show the on-screen controls for this role (touch screens only, and only during a match).
     * @param {"seeker" | "hider" | "ghost" | null} role
     */
    showTouch(role) {
        if (role === this._role) return;
        this._role = role;
        const on = !!role && this.coarse;
        this.touch.setVisible(on);
        if (!on) return;
        const show = (name, v) => { const el = this.buttons[name]; if (el) el.style.display = v ? "" : "none"; };
        show("fire", role === "seeker"); show("crouch", role !== "hider");
        show("prop", role === "hider"); show("lock", role === "hider"); show("taunt", role === "hider");
        show("ability", role !== "ghost");
    }

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

    held(action) {
        const input = this.input;
        if (input.pointer.type !== "touch") return input.isDown(action) || input.wasPressed(action);
        for (const code of this.settings.bindings[action] || []) if (!code.startsWith("Mouse") && input.down.has(code)) return true;
        return false;
    }
    pressed(action) {
        const input = this.input;
        if (input.pointer.type !== "touch") return input.wasPressed(action);
        return input.wasPressed(action) && (this.settings.bindings[action] || []).some((c) => !c.startsWith("Mouse") && input.down.has(c));
    }

    /** The right stick turns the view. Call once per rendered frame. */
    look(dt) {
        if (!this.active) return;
        const x = this.input.stick("RightX"), y = this.input.stick("RightY");
        if (x || y) this.turn(-x * Math.abs(x) * 3.4 * dt, -y * Math.abs(y) * 2.4 * dt);
    }

    /**
     * This tick's controls. Call once per fixed step. `disguise` is true on the tick the disguise key goes
     * down: the caller works out which prop is being looked at.
     * @param {boolean} hider which actions the shared buttons mean
     */
    gather(hider) {
        const input = this.input, out = { mx: 0, my: 0, buttons: 0, disguise: false, up: 0 };
        if (!this.active) return out;
        if (this.held("jump")) { out.buttons |= BTN.jump; out.up = 1; }
        if (this.held("sprint")) out.buttons |= BTN.sprint;
        if (this.held("crouch")) { out.buttons |= BTN.crouch; out.up = -1; }
        if (hider) {
            if (this.held("lock")) out.buttons |= BTN.lock;
            if (this.held("taunt")) out.buttons |= BTN.taunt;
            if (this.pressed("disguise")) out.disguise = true;
        } else if (this.held("fire")) out.buttons |= BTN.fire;
        if (this.held("ability")) out.buttons |= BTN.ability;
        const padY = -input.stick("LeftY"), keyY = input.axis("moveY");
        const y = Math.abs(padY) > Math.abs(keyY) ? padY : keyY, x = input.axis("moveX");
        if (Math.hypot(x, y) > 0.95 && (padY || input.virtualAxes.get("moveY"))) out.buttons |= BTN.sprint;
        out.mx = Math.round(clamp(x, -1, 1) * 127); out.my = Math.round(clamp(y, -1, 1) * 127);
        return out;
    }
}
