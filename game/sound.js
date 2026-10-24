import { Audio } from "../engine/index.js";

/**
 * SKYFARM: sound (the `audio-design` skill; the mixer after TIDEFALL's sound.js). The engine's Audio plays the
 * ZzFX effects and the recorded takes; everything else is synthesised here with Web Audio, so nothing is
 * downloaded and every source is free (THIRD_PARTY.md).
 *
 *   effects ─► sfx ─────┐
 *   menus ───► ui ──────┼─► duck ─► master ─► speakers
 *   wind, rain, birds ► ambience ┘   ▲
 *   score layers ► music ────────────┘
 *   the airship horn, thunder ► near ─► master     (never ducked: they duck the rest)
 *
 * Volumes are decibels, converted at the edge. The horn pulls the duck bus down 8 dB for its length, close
 * thunder 5 dB for a moment, a conversation takes 6 dB off the music only.
 *
 * WIND is the sound of flying: band-passed noise whose loudness and pitch follow the glider's speed, with a
 * thin whistle on top at speed, and a colder, emptier tone the higher you are. On foot it's a breeze.
 * RAIN is high-passed noise, heavier in a storm, with a low rumble of storm wind under it. A gust's warning
 * swell is heard in the wind before it pushes (weather.js), and captioned.
 * BIRDS: each band its own: the Meadow warbling chirps, the Orchard two-note calls, the High Rocks a long
 * falling cry. Placed round the listener (panned, quieter further off), by day and out of the rain, near an
 * island; at night crickets on restored islands instead.
 * MUSIC is a gentle adaptive score of piano and strings, vertical layers that glide in and out, never a cut:
 * a piano figure at home, strings that swell while gliding, a sparse low piano at night, a darker minor pad in a
 * storm, everything together for the ending. Notes are scheduled on a lookahead clock at 68 beats a minute,
 * in F major pentatonic (D minor in a storm).
 * CAPTIONS: every cue that matters (storm building, gusts, thunder, the horn, sprites) also calls onCaption.
 * @module game/sound
 */

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide,
// pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay
const SOUNDS = {
    till: [0.6, 0.1, 160, 0.01, 0.05, 0.08, 4, 0.6, , , , , , 1.2],
    plant: [0.5, 0.05, 420, 0.005, 0.02, 0.06, 1, 1.6],
    water: [0.35, 0.3, 900, 0.03, 0.2, 0.25, 4, 0.2, , , , , , 3, , 0.2],
    harvest: [0.7, 0.05, 520, 0.01, 0.08, 0.2, 1, 1.4, , , 260, 0.06],
    pick: [0.6, 0.05, 880, 0.01, 0.05, 0.25, 1, 1.8, , , 440, 0.05],
    sprout: [0.45, 0, 1320, 0.01, 0.1, 0.35, 1, 2],
    open: [0.5, 0.2, 300, 0.02, 0.1, 0.2, 4, 0.4, 8],
    land: [0.5, 0.1, 110, 0.01, 0.05, 0.12, 4, 0.5],
    bump: [0.6, 0.1, 90, 0.01, 0.05, 0.2, 4, 1.2],
    jump: [0.25, 0.05, 220, 0, 0.02, 0.06, 1, 1, 4],
    coins: [0.45, 0.1, 1400, 0, 0.01, 0.08, 0, 1.6, 0, 0, 500, 0.03, 0.04, 0, 0, 0, 0.05, 0.6, 0.02],
    chime: [0.4, 0, 1047, 0.01, 0.05, 0.4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.2],
    sprite: [0.3, 0.05, 1760, 0.02, 0.05, 0.3, 0, 1, 0, 0, 220, 0.05, 0.06, 0, 0, 0, 0.08, 0.5, 0.1],
    boost: [0.4, 0.2, 400, 0.02, 0.08, 0.3, 4, 1, 6, 0, 0, 0, 0, 3, 0, 0, 0, 0.5, 0.1],
    hammer: [0.5, 0.05, 1100, 0, 0.01, 0.12, 1, 2, 0, 0, 0, 0, 0, 0.4, 0, 0.3, 0, 0.6, 0.03],
    ui: [0.3, 0, 740, 0.003, 0.01, 0.06, 0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02],
    win: [0.9, 0, 440, 0.03, 0.35, 0.8, 0, 1.5, 0, 0, 220, 0.11, 0.11, 0, 0, 0, 0.12, 0.7, 0.2],
    breath: [0.35, 0.05, 260, 0.15, 0.1, 0.45, 4, 0.4, 0, 0, 0, 0, 0, 1.6, 0, 0, 0, 0.5, 0.2],
};
/** recorded takes (Kenney CC0, assets/sounds), picked at random per play; each has a ZzFX stand-in above */
const FILES = {
    pick: ["powerUp2"], land: ["impactSoft_medium_000"], bump: ["impactPunch_medium_000"], hammer: ["impactPlate_light_000"],
    coins: ["confirmation_002"], ui: ["select_001"], open: ["switch_003"], win: ["powerUp11"],
};
/** how far each placed sound carries, in metres; the rest carry 30 */
const REACH = { sprite: 40, hammer: 60, land: 20, bump: 20 };

const dB = (db) => Math.pow(10, db / 20);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const PENTA = [0, 2, 4, 7, 9];
/** chords for the pad and the piano's left hand, as semitones over the root, two bars each */
const CHORDS = { major: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]], minor: [[0, 3, 7, 10], [-4, 0, 3, 7], [5, 8, 12, 15], [-2, 2, 5, 9]] };

export class Sound {
    constructor(options = {}) {
        this.audio = new Audio({ volume: 1, sfx: 1, music: 1 });
        for (const name in SOUNDS) this.audio.define(name, SOUNDS[name]);
        for (const name in FILES) this.audio.load(name, FILES[name].map((f) => `assets/sounds/${f}.ogg`));
        this.ear = { x: 0, y: 0, z: 0, rx: 1, ry: 0 };
        this.started = false;
        /** bus levels in dB, from the settings */
        this.levels = { master: 0, music: 0, sfx: -2, ui: -6, ambience: -3 };
        this.volume = options.volume ?? 0.8;
        /** called with (text, seconds) for a caption, when captions are on */
        this.onCaption = null;
        this.captions = true;
        this.state = { speed: 0, height: 0, gliding: false, raining: 0, storm: 0, night: 0, band: "meadow", near: 0, restored: false, talking: false, ending: false, playing: false, gustWarn: 0 };
        this._birdIn = 2;
        /** for tools: fields here win over what the game says (tools/sound-mix.mjs) */
        this.override = null;
    }

    /** Wake the audio. Call from a click or key press (browsers allow sound only after one). */
    async start() {
        if (this.started) return;
        this.started = true;
        await this.audio.unlock();
        const a = this.audio, ctx = a.ctx;
        if (!ctx) return;
        a.master.disconnect();
        // a limiter last, so a close thunderclap over a storm never clips
        this.limit = ctx.createDynamicsCompressor();
        this.limit.threshold.value = -6; this.limit.knee.value = 3; this.limit.ratio.value = 12; this.limit.attack.value = 0.003; this.limit.release.value = 0.25;
        this.out = ctx.createGain(); this.out.connect(this.limit).connect(ctx.destination);
        a.master.connect(this.out);
        this.duck = ctx.createGain();
        a.channels.sfx.disconnect(); a.channels.music.disconnect();
        a.channels.sfx.connect(this.duck);
        // the music goes through a gain of its own first, so a conversation can take it down alone
        this.musicDuck = ctx.createGain(); a.channels.music.connect(this.musicDuck).connect(this.duck);
        this.ui = ctx.createGain(); this.ui.connect(this.duck);
        this.amb = ctx.createGain(); this.amb.connect(this.duck);
        this.duck.connect(a.master);
        this.near = ctx.createGain(); this.near.connect(this.out);
        this.apply();
        this.ambience();
        this.music();
    }

    setVolume(v) { this.volume = v; this.apply(); }
    /** Put the settings' levels on the buses (dB to gain at the edge). */
    apply() {
        const a = this.audio, ctx = a.ctx;
        if (!ctx || !this.out) return;
        const t = ctx.currentTime, L = this.levels;
        this.out.gain.setTargetAtTime(this.volume <= 0 ? 0 : dB(L.master) * this.volume * this.volume, t, 0.03);
        a.channels.sfx.gain.setTargetAtTime(dB(L.sfx), t, 0.03);
        a.channels.music.gain.setTargetAtTime(dB(L.music), t, 0.03);
        this.ui.gain.setTargetAtTime(dB(L.ui), t, 0.03);
        this.amb.gain.setTargetAtTime(dB(L.ambience), t, 0.03);
        this.near.gain.setTargetAtTime(dB(-3), t, 0.03);
    }

    listen(eye, right) {
        const e = this.ear;
        if (!Number.isFinite(eye[0] + eye[1] + eye[2] + right[0] + right[1])) return;
        e.x = eye[0]; e.y = eye[1]; e.z = eye[2]; e.rx = right[0]; e.ry = right[1];
    }

    caption(text, seconds = 2.5) { if (this.captions && this.onCaption) this.onCaption(text, seconds); }

    /** A sound with no place (what happens to me). */
    play(name, volume = 1, pitch = 1) { this.audio.play(name, { volume, pitch: pitch * (0.97 + Math.random() * 0.06) }); }
    /** An interface sound, on the ui bus. */
    click(pitch = 1) { this.audio.play("ui", { volume: 0.8, pitch, bus: this.ui }); }

    /** pan (-1..1) and loudness (0..1) of a place, for the listener */
    place(x, y, z, reach) {
        const e = this.ear, dx = x - e.x, dy = y - e.y, dz = z - e.z, d = Math.hypot(dx, dy, dz);
        if (d >= reach) return null;
        const near = 1 - d / reach, flat = Math.hypot(dx, dy);
        const pan = flat > 0.5 ? ((dx * e.rx + dy * e.ry) / flat) * Math.min(1, d / 4) * 0.85 : 0;
        return Number.isFinite(pan) ? { pan, loud: near * near, d } : null;
    }
    /** A sound at a place in the world: quieter with distance, and to the side it is on. */
    at(name, x, y, z, volume = 1, pitch = 1) {
        const p = this.place(x, y, z, REACH[name] || 30);
        if (p) this.audio.play(name, { volume: volume * p.loud, pitch: pitch * (0.95 + Math.random() * 0.1), pan: p.pan });
    }

    /** dip the duck bus: fast in, slow out */
    dip(db, seconds) {
        const ctx = this.audio.ctx;
        if (!ctx || !this.duck) return;
        const t = ctx.currentTime;
        this.duck.gain.cancelScheduledValues(t);
        this.duck.gain.setTargetAtTime(dB(db), t, 0.03);
        this.duck.gain.setTargetAtTime(1, t + seconds, 0.5);
    }

    /** The airship's horn: two soft low reeds a fifth apart, swelling, from where the airship is. */
    horn(x, y, z) {
        const ctx = this.audio.ctx;
        if (!ctx || !this.near) return;
        const p = this.place(x, y, z, 2500) || { pan: 0, loud: 0.05 }, t = ctx.currentTime;
        const env = ctx.createGain(), pan = ctx.createStereoPanner(), lp = ctx.createBiquadFilter();
        pan.pan.value = p.pan; lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 2;
        env.gain.setValueAtTime(0.0001, t);
        for (const [s, e] of [[0, 1.4], [1.8, 3.6]]) {
            env.gain.exponentialRampToValueAtTime(0.0001, t + s + 0.01);
            env.gain.exponentialRampToValueAtTime(0.35 * (0.3 + 0.7 * Math.sqrt(p.loud)), t + s + 0.4);
            env.gain.setValueAtTime(0.35 * (0.3 + 0.7 * Math.sqrt(p.loud)), t + e - 0.4);
            env.gain.exponentialRampToValueAtTime(0.0001, t + e);
        }
        lp.connect(env).connect(pan).connect(this.near);
        for (const [f, d] of [[110, -5], [110, 6], [165, 0], [220, 3]]) {
            const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = d;
            o.connect(lp); o.start(t); o.stop(t + 3.8);
        }
        this.dip(-8, 3.6);
        this.caption("[An airship's horn: Captain Bram is coming]", 4);
    }

    /** Thunder `d` metres away: arrives d / 343 s after the flash, lower and longer the further it is. */
    thunder(d) {
        const ctx = this.audio.ctx;
        if (!ctx || !this.near) return;
        const t = ctx.currentTime + d / 343, far = clamp01(d / 1100), len = 2 + far * 3;
        const s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner();
        s.buffer = this.noise; lp.type = "lowpass"; lp.frequency.setValueAtTime(1400 - far * 1100, t); lp.frequency.exponentialRampToValueAtTime(90, t + len);
        pan.pan.value = Math.random() * 1.4 - 0.7;
        const peak = 3 * (1 - far * 0.75);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.05 + far * 0.4);
        // the rolls: a few swells as it echoes off the cloud
        for (let k = 1; k < 4; k++) g.gain.setTargetAtTime(peak * (0.9 - k * 0.2), t + k * len / 5, 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        s.connect(lp).connect(g).connect(pan).connect(this.near);
        s.start(t, Math.random()); s.stop(t + len + 0.1);
        if (d < 400) setTimeout(() => this.dip(-5, 1.2), (d / 343) * 1000);
        setTimeout(() => this.caption(d < 400 ? "[Thunder, close]" : "[Thunder, far off]", 2.5), (d / 343) * 1000);
    }

    // ------------------------------------------------------------------ ambience

    noiseBuffer() {
        const ctx = this.audio.ctx, n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return b;
    }

    ambience() {
        const ctx = this.audio.ctx;
        this.noise = this.noiseBuffer();
        const loop = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(0, Math.random() * 2); return s; };
        const chain = (src, ...nodes) => { let n = src; for (const x of nodes) n = n.connect(x); return n; };
        const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
        const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
        // wind: band-passed noise, wandering a little in pitch; plus a thin whistle that comes in at speed
        const windBp = filter("bandpass", 400, 0.6), windGain = gain(0.05), wander = ctx.createOscillator(), wanderDepth = gain(120);
        wander.frequency.value = 0.09; wander.connect(wanderDepth).connect(windBp.frequency); wander.start();
        chain(loop(), windBp, windGain, this.amb);
        const whistleBp = filter("bandpass", 1800, 9), whistleGain = gain(0);
        chain(loop(), whistleBp, whistleGain, this.amb);
        // rain: hiss, and a storm's low roar under it
        const rainGain = gain(0), roarGain = gain(0);
        chain(loop(), filter("highpass", 2200), filter("lowpass", 9000), rainGain, this.amb);
        chain(loop(), filter("lowpass", 220), roarGain, this.amb);
        this.amb_ = { windBp, windGain, whistleBp, whistleGain, rainGain, roarGain };
    }

    /** one bird call, of this band, at a place round the listener */
    bird(band) {
        const ctx = this.audio.ctx, e = this.ear, a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 40;
        const p = this.place(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, e.z + Math.random() * 6, 60);
        if (!p) return;
        const t = ctx.currentTime, pan = ctx.createStereoPanner(), g = ctx.createGain();
        pan.pan.value = p.pan; g.gain.value = 0.35 * p.loud; g.connect(pan).connect(this.amb);
        const chirp = (t0, f0, f1, len, vol = 1, fm = 0) => {
            const o = ctx.createOscillator(), env = ctx.createGain();
            o.type = "sine"; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + len);
            if (fm) { const m = ctx.createOscillator(), md = ctx.createGain(); m.frequency.value = fm; md.gain.value = f0 * 0.08; m.connect(md).connect(o.frequency); m.start(t0); m.stop(t0 + len + 0.02); }
            env.gain.setValueAtTime(0.0001, t0); env.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); env.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
            o.connect(env).connect(g); o.start(t0); o.stop(t0 + len + 0.02);
        };
        if (band === "meadow") {
            // a warbler: a quick run of trilled chirps
            const n = 3 + (Math.random() * 5 | 0), base = 2800 + Math.random() * 1400;
            for (let k = 0; k < n; k++) chirp(t + k * 0.09, base * (1 + 0.15 * Math.sin(k * 1.7)), base * 1.3, 0.07, 0.8, 40);
        } else if (band === "orchard") {
            // two notes falling, sometimes twice
            const f = 900 + Math.random() * 300, twice = Math.random() < 0.5;
            for (let k = 0; k < (twice ? 2 : 1); k++) { chirp(t + k * 0.7, f * 1.26, f * 1.22, 0.22); chirp(t + k * 0.7 + 0.28, f, f * 0.97, 0.3); }
        } else {
            // high rocks: a long falling cry, far and alone
            chirp(t, 2400 + Math.random() * 400, 1300, 0.9, 0.6, 22);
        }
    }

    /** night: a few crickets, a fast pulse at a high pitch */
    cricket() {
        const ctx = this.audio.ctx, e = this.ear, a = Math.random() * Math.PI * 2;
        const p = this.place(e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, e.z - 1, 40);
        if (!p) return;
        const t = ctx.currentTime, o = ctx.createOscillator(), env = ctx.createGain(), pan = ctx.createStereoPanner();
        o.type = "sine"; o.frequency.value = 4300 + Math.random() * 600; pan.pan.value = p.pan;
        env.gain.value = 0;
        for (let k = 0; k < 9; k++) { const s = t + k * 0.045; env.gain.setValueAtTime(0.12 * p.loud, s); env.gain.setValueAtTime(0, s + 0.025); }
        o.connect(env).connect(pan).connect(this.amb); o.start(t); o.stop(t + 0.5);
    }

    // ------------------------------------------------------------------ music

    music() {
        const ctx = this.audio.ctx, out = this.audio.channels.music;
        const layer = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; g.connect(out); return g; };
        // a soft room: a feedback delay, filtered, shared by every layer
        const send = ctx.createGain(), delay = ctx.createDelay(1), fb = ctx.createGain(), dlp = ctx.createBiquadFilter();
        delay.delayTime.value = 0.33; fb.gain.value = 0.35; dlp.type = "lowpass"; dlp.frequency.value = 2200; send.gain.value = 0.35;
        send.connect(delay).connect(dlp).connect(fb).connect(delay); dlp.connect(out);
        this.mus = { piano: layer(), glide: layer(), night: layer(), storm: layer(), send, step: 0, next: ctx.currentTime + 0.3, minor: false };
        for (const k of ["piano", "glide", "night", "storm"]) this.mus[k].connect(send);
        // the strings: four detuned saw voices per chord note through a slow low-pass, swelling with the layer
        const strings = (dest, cutoff, oct) => {
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cutoff; lp.Q.value = 0.4; lp.connect(dest);
            const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 0.13; depth.gain.value = cutoff * 0.25; lfo.connect(depth).connect(lp.frequency); lfo.start();
            return [0, 1, 2, 3].map(() => [-7, 7].map((det) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.detune.value = det; o.frequency.value = 220; g.gain.value = 0.05; o.connect(g).connect(lp); o.start(); o.oct = oct; return o; }));
        };
        this.mus.glideStrings = strings(this.mus.glide, 1400, 0);
        this.mus.stormStrings = strings(this.mus.storm, 600, -12);
        this.mus.timer = setInterval(() => this.schedule(), 50);
    }

    /** a piano-ish note: a bright attack, a quick fall to a long soft decay */
    keys(t, freq, len, gain, dest) {
        const ctx = this.audio.ctx, g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
        g.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        g.connect(dest);
        for (const [mul, type, v] of [[1, "triangle", 1], [2, "sine", 0.35], [3, "sine", 0.12]]) {
            const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = freq * mul; og.gain.value = v;
            o.connect(og).connect(g); o.start(t); o.stop(t + len + 0.05);
        }
    }

    /** Schedule ahead of the clock: eighth notes at 68 bpm, chords every two bars. */
    schedule() {
        const ctx = this.audio.ctx, m = this.mus;
        if (!ctx || !m) return;
        const eighth = 60 / 68 / 2;
        while (m.next < ctx.currentTime + 0.2) {
            const t = m.next, s = m.step, root = m.minor ? 62 : 65; // D minor in a storm, F major otherwise
            const hz = (semi) => 440 * Math.pow(2, (root + semi - 69) / 12);
            const chord = CHORDS[m.minor ? "minor" : "major"][(s / 16 | 0) % 4];
            if (s % 16 === 0) {
                for (const voices of [m.glideStrings, m.stormStrings]) voices.forEach((pair, i) => pair.forEach((o) => o.frequency.setTargetAtTime(hz(chord[i] + o.oct), t, 0.8)));
                // the piano's left hand: the chord's root, low
                this.keys(t, hz(chord[0] - 12), 3.5, 0.36, m.piano);
                this.keys(t, hz(chord[0] - 24), 4, 0.5, m.night);
            }
            // the right hand: a slow pentatonic figure over the chord, with rests
            const fig = [0, -1, 2, 4, -1, 3, 1, -1, 4, -1, 2, 0, 1, -1, -1, -1][s % 16];
            if (fig >= 0) this.keys(t, hz(PENTA[(fig + (s / 16 | 0)) % 5] + 12), 1.8, 0.26, m.piano);
            // night: one high note now and then, very soft
            if (s % 8 === 3 && Math.random() < 0.6) this.keys(t, hz(PENTA[(Math.random() * 5) | 0] + 24), 3, 0.22, m.night);
            // gliding: a high arpeggio on the strings' chord
            if (s % 2 === 0) this.keys(t, hz(chord[(s / 2) % 4] + 24), 0.9, 0.07, m.glide);
            m.next += eighth; m.step = (s + 1) % 256;
        }
    }

    /**
     * Follow the game: which layers play, how loud the wind and rain are, when birds call.
     * @param {number} dt seconds since the last call
     * @param {Partial<Sound["state"]>} s
     */
    update(dt, s) {
        Object.assign(this.state, s, this.override);
        s = this.state;
        const ctx = this.audio.ctx, m = this.mus, A = this.amb_;
        if (!ctx || !m || !A) return;
        const t = ctx.currentTime, day = 1 - s.night;
        // score layers
        const want = s.ending ? { piano: 0.9, glide: 0.8, night: 0.3, storm: 0 }
            : !s.playing ? { piano: 0.6, glide: 0.2, night: 0, storm: 0 }
            : { piano: (s.gliding ? 0.25 : 0.8) * day * (1 - s.storm), glide: Math.max(s.gliding ? 0.75 : 0, s.night * 0.3) * (1 - s.storm * 0.7), night: s.night * (1 - s.storm), storm: s.storm * 0.8 };
        for (const k in want) m[k].gain.setTargetAtTime(want[k], t, 2.5);
        m.minor = s.storm > 0.5;
        this.musicDuck.gain.setTargetAtTime(s.talking ? dB(-6) : 1, t, 0.4);
        // wind: speed and height (cold and empty up high); a gust's swell before it pushes
        const sp = clamp01(s.speed / 30), high = clamp01((s.height - 100) / 400), gust = Math.max(s.gustWarn, s.gust || 0);
        A.windGain.gain.setTargetAtTime(0.1 + sp * 0.7 + high * 0.15 + s.storm * 0.12 + gust * 0.7, t, 0.3);
        A.windBp.frequency.setTargetAtTime(320 + sp * 700 + high * 300 + gust * 400, t, 0.3);
        A.whistleGain.gain.setTargetAtTime(clamp01((s.speed - 14) / 16) * 0.1 + high * 0.04, t, 0.4);
        A.whistleBp.frequency.setTargetAtTime(1500 + sp * 1200 + high * 800, t, 0.5);
        A.rainGain.gain.setTargetAtTime(s.raining * (0.35 + s.storm * 0.1), t, 1);
        A.roarGain.gain.setTargetAtTime(s.storm * 0.4, t, 1.5);
        // birds by day, crickets by night
        this._birdIn -= dt;
        if (this._birdIn <= 0) {
            const near = s.near > 0.2;
            if (near && s.night < 0.5 && s.raining < 0.3 && s.storm < 0.3) { this.bird(s.band); this._birdIn = (s.band === "high" ? 7 : 2.2) + Math.random() * 4; }
            else if (near && s.night > 0.6 && s.restored && !s.raining) { this.cricket(); this._birdIn = 0.6 + Math.random() * 1.5; }
            else this._birdIn = 1.5;
        }
    }
}
