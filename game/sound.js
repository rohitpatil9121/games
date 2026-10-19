import { Audio } from "../engine/index.js";

/**
 * DECOY: sound. Effects are synthesised with ZzFX through the engine's Audio. at() places a sound in the
 * world from the listener (the camera): quieter with distance, panned to its side. Taken from BREACH.
 * @module game/sound
 */

// ZzFX: volume, randomness, frequency, attack, sustain, release, shape (0 sine 1 triangle 2 saw 3 tan 4 noise),
// shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay
const SOUNDS = {
    scan: [0.7, 0.03, 880, 0, 0.02, 0.08, 2, 1.8, -40, 0, 0, 0, 0, 0.2, 0, 0.1, 0, 0.6, 0.03],
    hit: [0.6, 0, 980, 0, 0.01, 0.05, 1, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.01],
    miss: [0.7, 0, 180, 0, 0.04, 0.16, 2, 1.4, -6, 0, 0, 0, 0, 0.6, 0, 0.3, 0, 0.6, 0.05],
    found: [0.9, 0, 520, 0, 0.05, 0.3, 1, 1.5, 0, 0, 260, 0.06, 0, 0, 0, 0, 0, 0.7, 0.1],
    hurt: [0.8, 0.05, 160, 0, 0.03, 0.12, 2, 1.2, -3, 0, 0, 0, 0, 0.6, 0, 0.2, 0, 0.6, 0.05],
    death: [0.9, 0.05, 220, 0.01, 0.1, 0.5, 0, 1.1, -3, 0, 0, 0, 0, 0.5, 0, 0.1, 0, 0.6, 0.2],
    step: [0.2, 0.2, 92, 0, 0.01, 0.05, 4, 1, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.5, 0.02],
    scuff: [0.18, 0.3, 140, 0, 0.02, 0.06, 4, 1, 2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0.5, 0.02],
    jump: [0.25, 0.05, 220, 0, 0.02, 0.06, 1, 1, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    land: [0.35, 0.1, 78, 0, 0.02, 0.08, 4, 1, -2, 0, 0, 0, 0, 0.8, 0, 0, 0, 0.5, 0.03],
    poof: [0.6, 0.1, 300, 0.01, 0.05, 0.25, 4, 0.6, -2, 0, 0, 0, 0, 2, 0, 0, 0, 0.5, 0.1],
    lock: [0.4, 0, 640, 0, 0.01, 0.04, 2, 1, 0, 0, 120, 0.03, 0, 0.2, 0, 0, 0, 0.6, 0.01],
    unlock: [0.3, 0, 520, 0, 0.01, 0.04, 2, 1, 0, 0, -120, 0.03, 0, 0.2, 0, 0, 0, 0.6, 0.01],
    throw: [0.4, 0.05, 400, 0, 0.03, 0.1, 0, 1, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.03],
    land_ping: [0.4, 0, 1200, 0, 0.01, 0.05, 0, 1, 0, 0, 0, 0, 0.06, 0, 0, 0, 0, 0.5, 0.02],
    burst: [1.0, 0, 330, 0.02, 0.15, 0.6, 0, 1.4, 12, 0, 0, 0, 0, 0, 0.3, 0, 0.1, 0.6, 0.3],
    decoy: [0.6, 0, 260, 0.01, 0.1, 0.2, 1, 1, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.05],
    pop: [0.8, 0, 600, 0, 0.02, 0.15, 4, 1, -10, 0, 0, 0, 0, 1.5, 0, 0, 0, 0.5, 0.05],
    // taunts: what a hiding prop sounds like
    squeak: [0.9, 0, 1400, 0.01, 0.06, 0.12, 0, 1.2, 30, -2, 0, 0, 0.08, 0, 0, 0, 0, 0.8, 0.05],
    honk: [1.0, 0, 330, 0.02, 0.18, 0.12, 2, 1.6, -2, 0, 0, 0, 0, 0, 6, 0, 0, 0.8, 0.05],
    jingle: [0.8, 0, 1046, 0, 0.05, 0.25, 0, 1.6, 0, 0, 523, 0.06, 0.06, 0, 0, 0, 0.08, 0.6, 0.1],
    boing: [0.9, 0, 160, 0.01, 0.08, 0.35, 0, 1, 18, -4, 0, 0, 0, 0, 12, 0, 0, 0.7, 0.1],
    quack: [0.9, 0.05, 480, 0.01, 0.05, 0.1, 2, 2.4, -14, 0, 0, 0, 0, 0.4, 20, 0, 0, 0.7, 0.04],
    ui: [0.35, 0, 740, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    go: [0.9, 0, 440, 0.02, 0.2, 0.4, 0, 1.5, 0, 0, 220, 0.1, 0, 0, 0, 0, 0.1, 0.7, 0.2],
    tick: [0.5, 0, 1600, 0, 0.005, 0.02, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.01],
    win: [0.9, 0, 440, 0.03, 0.35, 0.8, 0, 1.5, 0, 0, 220, 0.11, 0.11, 0, 0, 0, 0.12, 0.7, 0.2],
    lose: [0.7, 0, 300, 0.05, 0.25, 0.8, 0, 1, -6, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.3],
    chat: [0.3, 0, 880, 0, 0.01, 0.05, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
};
export const TAUNT_SOUNDS = ["squeak", "honk", "jingle", "boing", "quack"];
/** how far each sound carries, in metres; the rest carry 30 */
const REACH = { step: 18, scuff: 14, jump: 14, land: 16, poof: 22, lock: 6, unlock: 6, scan: 45, pop: 30, squeak: 55, honk: 70, jingle: 55, boing: 55, quack: 60, burst: 40, decoy: 22, land_ping: 25 };

export class Sound {
    constructor(options = {}) {
        this.audio = new Audio({ volume: options.volume ?? 0.8, sfx: 1, music: options.music ?? 0.5 });
        for (const name in SOUNDS) this.audio.define(name, SOUNDS[name]);
        this.ear = { x: 0, y: 0, z: 0, rx: 1, ry: 0 };
        this.started = false;
    }
    async start() {
        if (this.started) return;
        this.started = true;
        await this.audio.unlock();
    }
    setVolume(v) { this.audio.setVolume("master", v); }
    setMusic(v) { this.audio.setVolume("music", v); }
    listen(camera) {
        const e = this.ear, eye = camera.eye, r = camera.right;
        if (!Number.isFinite(eye[0] + eye[1] + eye[2] + r[0] + r[1])) return;
        e.x = eye[0]; e.y = eye[1]; e.z = eye[2]; e.rx = r[0]; e.ry = r[1];
    }
    play(name, volume = 1, pitch = 1) { this.audio.play(name, { volume, pitch }); }
    at(name, x, y, z, volume = 1, pitch = 1) {
        const e = this.ear, dx = x - e.x, dy = y - e.y, dz = z - e.z, d = Math.hypot(dx, dy, dz), reach = REACH[name] || 30;
        if (d >= reach) return;
        const near = 1 - d / reach, flat = Math.hypot(dx, dy);
        const pan = flat > 0.5 ? ((dx * e.rx + dy * e.ry) / flat) * Math.min(1, d / 4) * 0.85 : 0;
        const loud = volume * near * near;
        if (!Number.isFinite(pan) || !Number.isFinite(loud)) return;
        this.audio.play(name, { volume: loud, pitch: pitch * (0.96 + Math.random() * 0.08), pan });
    }
    ambience(indoor) {
        this.audio.stopDrone(0.5);
        setTimeout(() => this.audio.drone(indoor ? { root: 55, level: 0.05 } : { root: 73, chord: [1, 1.5, 2.01, 3], level: 0.035 }), 700);
    }
    quiet() { this.audio.stopDrone(1); }
}
