import { Audio } from "../engine/index.js";

/**
 * TIDEFALL: sound (the `audio-design` skill). Built on the engine's Audio (ZzFX samples plus recorded
 * takes), with its own mixer on top:
 *
 *   effects ─► sfx ─┐
 *   menus ───► ui ──┼─► duck ─► master ─► speakers
 *   sea, wind ► ambience ┘   ▲
 *   music layers ► music ────┘
 *   the tide horn ► horn ─────────────► master       (never ducked: it ducks everything else)
 *
 * Volumes are set in decibels and converted at the edge. The horn pulls the duck bus down 9 dB for its
 * length, so it cuts through anything; low breath ducks it 4 dB.
 *
 * MUSIC is vertical layering, never a hard cut: a pad always, a plucked pulse that joins at low water,
 * drums and a rising line with the flood, and a filter that opens as the water rises. Each layer's gain
 * glides to the level the tide phase asks for; notes are scheduled on a lookahead clock (the usual
 * Web Audio pattern) at 96 beats a minute in a major pentatonic, turning to the relative minor in the flood.
 *
 * AMBIENCE is synthesised: surf (filtered noise breathing on a slow swell, louder the nearer the camera is
 * to the water's edge) and wind (band-passed noise, stronger on the high ground).
 *
 * WHERE: at() places a sound by the listener (the camera): quieter with distance, panned to its side, as
 * BREACH's sound.js. Each important cue also has a caption (`onCaption`), for players who can't hear it.
 * Recorded effects are Kenney CC0 files copied from BREACH's folder; every one has a ZzFX stand-in.
 * @module game/sound
 */

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide,
// pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay
const SOUNDS = {
    step: [0.25, 0.3, 180, 0, 0.01, 0.05, 4, 1, 0, 0, 0, 0, 0, 2.5, 0, 0, 0, 0.4, 0.02],
    splash: [0.6, 0.3, 300, 0.01, 0.05, 0.35, 4, 0.5, -4, 0, 0, 0, 0, 3, 0, 0, 0.05, 0.5, 0.1],
    stroke: [0.3, 0.3, 240, 0.02, 0.06, 0.2, 4, 0.6, -2, 0, 0, 0, 0, 2.2, 0, 0, 0, 0.4, 0.05],
    jump: [0.28, 0.05, 200, 0, 0.02, 0.06, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    land: [0.35, 0.2, 90, 0, 0.02, 0.08, 4, 1, -2, 0, 0, 0, 0, 1.5, 0, 0, 0, 0.5, 0.03],
    pick: [0.5, 0, 660, 0, 0.03, 0.12, 0, 1.4, 0, 0, 330, 0.05, 0, 0, 0, 0, 0, 0.7, 0.04],
    coins: [0.45, 0.1, 1400, 0, 0.01, 0.08, 0, 1.6, 0, 0, 500, 0.03, 0.04, 0, 0, 0, 0.05, 0.6, 0.02],
    bank: [0.8, 0, 523, 0.01, 0.12, 0.35, 0, 1.4, 0, 0, 262, 0.08, 0.08, 0, 0, 0, 0.1, 0.7, 0.1],
    drop: [0.4, 0.1, 160, 0, 0.02, 0.1, 2, 1, -3, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0.04],
    sink: [0.5, 0.2, 120, 0.02, 0.2, 0.6, 0, 1, -1.5, 0, 0, 0, 0.06, 1, 0, 0, 0, 0.5, 0.2],
    shove: [0.8, 0.1, 120, 0, 0.03, 0.12, 4, 1.2, -6, 0, 0, 0, 0, 1.5, 0, 0.2, 0, 0.6, 0.05],
    whoosh: [0.3, 0.2, 400, 0.02, 0.04, 0.1, 4, 1, -8, 0, 0, 0, 0, 3, 0, 0, 0, 0.4, 0.04],
    hook: [0.45, 0.05, 900, 0, 0.02, 0.18, 2, 1.2, -20, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.6, 0.05],
    clank: [0.5, 0.05, 1100, 0, 0.01, 0.12, 1, 2, 0, 0, 0, 0, 0, 0.4, 0, 0.3, 0, 0.6, 0.03],
    miss: [0.25, 0.05, 300, 0, 0.02, 0.06, 1, 1, -4, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.02],
    flare: [0.6, 0.1, 800, 0.01, 0.4, 0.5, 4, 0.3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0.6, 0.2],
    blind: [0.6, 0, 1800, 0, 0.1, 0.5, 0, 1, -0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.3],
    breath: [0.35, 0, 880, 0, 0.03, 0.06, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    gasp: [0.6, 0.1, 350, 0.02, 0.05, 0.25, 4, 1, 4, 0, 0, 0, 0, 2, 0, 0, 0, 0.5, 0.05],
    drown: [0.7, 0.05, 200, 0.02, 0.2, 0.8, 0, 1, -1, 0, 0, 0, 0.1, 1, 0, 0, 0, 0.5, 0.3],
    ui: [0.3, 0, 740, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    uiBack: [0.3, 0, 520, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    win: [0.9, 0, 440, 0.03, 0.35, 0.8, 0, 1.5, 0, 0, 220, 0.11, 0.11, 0, 0, 0, 0.12, 0.7, 0.2],
    lose: [0.7, 0, 300, 0.05, 0.25, 0.8, 0, 1, -6, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.3],
    gull: [0.35, 0.15, 1200, 0.02, 0.08, 0.25, 2, 1.8, -12, 0, 0, 0, 0.12, 0, 6, 0, 0, 0.5, 0.1],
    chime: [0.4, 0, 1047, 0.01, 0.05, 0.4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.2],
};
/** recorded takes (Kenney CC0, assets/sounds), picked at random per play */
const FILES = {
    pick: ["powerUp2"], bank: ["confirmation_002"], shove: ["impactPunch_medium_000"], land: ["impactSoft_medium_000"],
    clank: ["impactPlate_light_000"], ui: ["select_001"], uiBack: ["switch_003"], win: ["powerUp11"], lose: ["lowDown"], drown: ["impactPunch_heavy_000"],
};
/** how far each sound carries, in metres; the rest carry 30 */
const REACH = { gull: 60, step: 18, stroke: 18, jump: 14, land: 18, splash: 35, pick: 22, coins: 22, shove: 30, hook: 40, clank: 40, flare: 60, drop: 18, sink: 25, bank: 45 };

const dB = (db) => Math.pow(10, db / 20);
const PENTA = [0, 2, 4, 7, 9], MINOR = [0, 3, 5, 7, 10];

export class Sound {
    constructor(options = {}) {
        this.audio = new Audio({ volume: 1, sfx: 1, music: 1 });
        for (const name in SOUNDS) this.audio.define(name, SOUNDS[name]);
        for (const name in FILES) this.audio.load(name, FILES[name].map((f) => `assets/sounds/${f}.ogg`));
        this.ear = { x: 0, y: 0, z: 0, rx: 1, ry: 0 };
        this.started = false;
        /** bus levels in dB, from the settings */
        this.levels = { master: 0, music: -8, sfx: 0, ui: -4, ambience: -6 };
        this.volume = options.volume ?? 0.8;
        /** called with (text, seconds) for a caption, when captions are on */
        this.onCaption = null;
        this.captions = false;
        this.state = { phase: 3, level: 0, shore: 50, height: 0, under: 0, playing: false };
    }

    /** Wake the audio. Call from a click or key press (browsers allow sound only after one). */
    async start() {
        if (this.started) return;
        this.started = true;
        await this.audio.unlock();
        const a = this.audio, ctx = a.ctx;
        if (!ctx) return;
        // the mixer: engine channels feed a duck bus; ui, ambience and the horn get buses of their own
        a.master.disconnect();
        this.out = ctx.createGain(); this.out.connect(ctx.destination);
        a.master.connect(this.out);
        this.duck = ctx.createGain();
        a.channels.sfx.disconnect(); a.channels.music.disconnect();
        a.channels.sfx.connect(this.duck); a.channels.music.connect(this.duck);
        this.ui = ctx.createGain(); this.ui.connect(this.duck);
        this.amb = ctx.createGain(); this.amb.connect(this.duck);
        this.duck.connect(a.master);
        this.horn = ctx.createGain(); this.horn.connect(this.out);
        this.apply();
        this.ambience();
        this.music();
    }

    setVolume(v) { this.volume = v; this.apply(); }
    /** Put the settings' levels on the buses (dB to gain at the edge). */
    apply() {
        const a = this.audio, ctx = a.ctx;
        if (!ctx) return;
        const t = ctx.currentTime, L = this.levels;
        this.out.gain.setTargetAtTime(this.volume <= 0 ? 0 : dB(L.master) * this.volume * this.volume, t, 0.03);
        a.channels.sfx.gain.setTargetAtTime(dB(L.sfx), t, 0.03);
        a.channels.music.gain.setTargetAtTime(dB(L.music), t, 0.03);
        this.ui.gain.setTargetAtTime(dB(L.ui), t, 0.03);
        this.amb.gain.setTargetAtTime(dB(L.ambience), t, 0.03);
        this.horn.gain.setTargetAtTime(dB(-2), t, 0.03);
    }

    listen(camera) {
        const e = this.ear, eye = camera.eye, r = camera.right;
        if (!Number.isFinite(eye[0] + eye[1] + eye[2] + r[0] + r[1])) return;
        e.x = eye[0]; e.y = eye[1]; e.z = eye[2]; e.rx = r[0]; e.ry = r[1];
    }

    caption(text, seconds = 2) { if (this.captions && this.onCaption) this.onCaption(text, seconds); }

    /** A sound with no place (what happens to me). */
    play(name, volume = 1, pitch = 1) { this.audio.play(name, { volume, pitch: pitch * (0.97 + Math.random() * 0.06) }); }
    /** An interface sound, on the ui bus. */
    click(back = false) { this.routed(back ? "uiBack" : "ui", this.ui, 0.8, 1); }

    /** A sound at a place in the world: quieter with distance, and to the side it is on. */
    at(name, x, y, z, volume = 1, pitch = 1) {
        const e = this.ear, dx = x - e.x, dy = y - e.y, dz = z - e.z, d = Math.hypot(dx, dy, dz), reach = REACH[name] || 30;
        if (d >= reach) return;
        const near = 1 - d / reach, flat = Math.hypot(dx, dy);
        const pan = flat > 0.5 ? ((dx * e.rx + dy * e.ry) / flat) * Math.min(1, d / 4) * 0.85 : 0;
        const loud = volume * near * near;
        if (!Number.isFinite(pan) || !Number.isFinite(loud)) return;
        // under water everything is muffled and a little lower
        this.audio.play(name, { volume: loud * (this.state.under ? 0.6 : 1), pitch: pitch * (0.95 + Math.random() * 0.1) * (this.state.under ? 0.8 : 1), pan });
    }

    /** Play a defined sound into a given bus (the engine's Audio.play takes a bus; see engine/Audio.js). */
    routed(name, bus, volume = 1, pitch = 1) { this.audio.play(name, { volume, pitch, bus }); }

    /** The tide horn: two low brass-like voices with a slow swell, through its own bus; everything else ducks. */
    hornBlast(urgent = true) {
        const ctx = this.audio.ctx;
        if (!ctx) return;
        const t = ctx.currentTime, len = urgent ? 2.6 : 1.6;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
        env.gain.setValueAtTime(0.5, t + len - 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 3;
        lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1400, t + 0.5); lp.frequency.linearRampToValueAtTime(700, t + len);
        lp.connect(env).connect(this.horn);
        for (const [f, detune] of [[98, -6], [98, 7], [147, 0], [196, 4]]) {
            const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = detune;
            o.frequency.setValueAtTime(f * 0.94, t); o.frequency.linearRampToValueAtTime(f, t + 0.3);
            o.connect(lp); o.start(t); o.stop(t + len + 0.1);
        }
        // duck the rest for the length of the blast: fast in, slow out
        this.duck.gain.cancelScheduledValues(t);
        this.duck.gain.setTargetAtTime(dB(-9), t, 0.03);
        this.duck.gain.setTargetAtTime(1, t + len, 0.4);
        this.caption(urgent ? "[Horn: the flood is coming]" : "[Horn]", 3);
    }

    /** A short dip for a critical cue that isn't the horn (low breath). */
    dip(db = -4, seconds = 0.6) {
        const ctx = this.audio.ctx;
        if (!ctx) return;
        const t = ctx.currentTime;
        this.duck.gain.setTargetAtTime(dB(db), t, 0.02);
        this.duck.gain.setTargetAtTime(1, t + seconds, 0.2);
    }

    // ------------------------------------------------------------------ ambience

    noiseBuffer() {
        const ctx = this.audio.ctx, n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        let last = 0;
        for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.15; }
        return b;
    }

    ambience() {
        const ctx = this.audio.ctx, buf = this.noiseBuffer();
        const loop = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
        // surf: low-passed noise whose loudness rides a slow swell
        const surf = loop(), surfLp = ctx.createBiquadFilter(), surfGain = ctx.createGain(), swell = ctx.createOscillator(), swellDepth = ctx.createGain();
        surfLp.type = "lowpass"; surfLp.frequency.value = 700;
        surfGain.gain.value = 0.4;
        swell.frequency.value = 0.12; swellDepth.gain.value = 0.25;
        swell.connect(swellDepth).connect(surfGain.gain); swell.start();
        surf.connect(surfLp).connect(surfGain).connect(this.amb);
        // wind: band-passed noise, a slow wander in pitch
        const wind = loop(), bp = ctx.createBiquadFilter(), windGain = ctx.createGain(), wander = ctx.createOscillator(), wanderDepth = ctx.createGain();
        bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.8;
        wander.frequency.value = 0.07; wanderDepth.gain.value = 250; wander.connect(wanderDepth).connect(bp.frequency); wander.start();
        windGain.gain.value = 0.08;
        wind.connect(bp).connect(windGain).connect(this.amb);
        this.amb_ = { surfGain, surfLp, windGain };
    }

    // ------------------------------------------------------------------ music

    music() {
        const ctx = this.audio.ctx, out = this.audio.channels.music;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.5; lp.connect(out);
        const layer = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(lp); return g; };
        this.mus = { lp, pad: layer(), pulse: layer(), drums: layer(), rise: layer(), step: 0, next: ctx.currentTime + 0.2, root: 57, minor: false };
        // the pad: a soft chord that changes every two bars
        this.mus.padOsc = [0, 4, 7, 12].map((semi) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "triangle"; o.frequency.value = 220 * Math.pow(2, semi / 12); g.gain.value = 0.05;
            o.connect(g).connect(this.mus.pad); o.start();
            return o;
        });
        this.mus.timer = setInterval(() => this.schedule(), 50);
    }

    note(t, freq, len, type, gain, dest, attack = 0.005) {
        const ctx = this.audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(dest); o.start(t); o.stop(t + len + 0.05);
    }
    hit(t, kind, dest) {
        const ctx = this.audio.ctx;
        if (kind === "kick") { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.25); return; }
        const s = ctx.createBufferSource(), g = ctx.createGain(), hp = ctx.createBiquadFilter();
        s.buffer = this._hat || (this._hat = this.noiseBuffer()); hp.type = "highpass"; hp.frequency.value = kind === "hat" ? 7000 : 1800;
        g.gain.setValueAtTime(kind === "hat" ? 0.08 : 0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === "hat" ? 0.05 : 0.14));
        s.connect(hp).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + 0.2);
    }

    /** Schedule the next notes ahead of the clock (16th notes at 96 bpm). */
    schedule() {
        const ctx = this.audio.ctx, m = this.mus;
        if (!ctx || !m) return;
        const sixteenth = 60 / 96 / 4;
        while (m.next < ctx.currentTime + 0.15) {
            const t = m.next, s = m.step, scale = m.minor ? MINOR : PENTA, root = m.minor ? 57 - 3 : 57;
            const hz = (semi) => 440 * Math.pow(2, (root + semi - 69) / 12);
            if (s % 32 === 0) {
                const chord = [[0, 4, 7, 12], [5, 9, 12, 17], [-3, 0, 4, 9], [7, 11, 14, 19]][(s / 32) % 4 | 0].map((c) => c - (m.minor ? 3 : 0));
                m.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(hz(chord[i] - 12), t, 0.4));
            }
            if (s % 2 === 0) { const deg = [0, 2, 4, 1, 3, 4, 2, 0][(s / 2) % 8]; this.note(t, hz(scale[deg] + 12), 0.22, "triangle", 0.09, m.pulse); }
            if (s % 8 === 0) this.hit(t, "kick", m.drums);
            if (s % 8 === 4) this.hit(t, "snare", m.drums);
            if (s % 2 === 1) this.hit(t, "hat", m.drums);
            if (s % 4 === 0) { const climb = (s / 4) % 16; this.note(t, hz(scale[climb % 5] + 12 * (1 + Math.floor(climb / 5))), sixteenth * 3.5, "sawtooth", 0.04, m.rise, 0.02); }
            m.next += sixteenth; m.step = (s + 1) % 128;
        }
    }

    /**
     * Follow the match: which layers play, how open the filter is, how loud the surf is.
     * @param {{ phase: number, level: number, shore: number, height: number, under: number, playing: boolean, over?: boolean }} s
     */
    update(s) {
        Object.assign(this.state, s);
        const ctx = this.audio.ctx, m = this.mus;
        if (!ctx || !m) return;
        const t = ctx.currentTime;
        // phase → layers: high water only the pad; ebb adds the pulse quietly; low, the pulse; flood, everything
        const want = !s.playing ? [0.7, 0, 0, 0] : s.over ? [0.8, 0.3, 0, 0] : [[0.6, 0.35, 0, 0], [0.55, 0.8, 0.25, 0], [0.5, 0.9, 0.9, 0.8], [0.8, 0.1, 0, 0]][s.phase];
        [m.pad, m.pulse, m.drums, m.rise].forEach((g, i) => g.gain.setTargetAtTime(want[i], t, 1.2));
        m.minor = s.playing && s.phase === 2;
        // the water rising opens the filter: tension you hear
        const open = 700 + Math.max(0, Math.min(1, (s.level + 8) / 10)) * 2600 * (s.phase === 2 ? 1 : 0.6);
        m.lp.frequency.setTargetAtTime(s.under ? 400 : open, t, 0.5);
        if (this.amb_) {
            const shore = Math.max(0, 1 - s.shore / 60);
            this.amb_.surfGain.gain.setTargetAtTime(s.under ? 0.15 : 0.15 + shore * 0.6, t, 0.4);
            this.amb_.surfLp.frequency.setTargetAtTime(s.under ? 250 : 700, t, 0.3);
            this.amb_.windGain.gain.setTargetAtTime(s.under ? 0 : 0.04 + Math.max(0, Math.min(1, s.height / 9)) * 0.1, t, 0.6);
        }
    }
}
