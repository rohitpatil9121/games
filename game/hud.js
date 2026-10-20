import { TIDE, LOOT, LOOT_KINDS, WATER, CARRY, TICK_RATE, TEAM_NAMES, ISLAND, teamColor, cssColor } from "./data.js";
import { FLAG } from "./protocol.js";
import { tideAt } from "./tide.js";

/**
 * TIDEFALL: the heads-up display (the `game-ui-ux` and `threejs-game-ui-designer` skills). Plain DOM over
 * the canvas, as in BREACH. It reads the client and changes nothing.
 *
 * Hierarchy, most urgent first: breath and the flood (survival), then the tide clock and the way home
 * (the objective), then what you carry and the banks (status), then the feed and prompts (feedback).
 * Everything is anchored to an edge or the centre, with safe-area insets; values that change every frame
 * only touch the DOM when what is shown actually changes (`set`).
 * @module game/hud
 */

const $ = (id) => document.getElementById(id);
const PHASE_CLASS = ["ebb", "low", "flood", "high"];
const KIND_ICON = ["", "●", "◆", "▲"];

export class Hud {
    /** @param {import("./net.js").Client} client */
    constructor(client) {
        this.client = client;
        this.el = {};
        for (const id of ["tide-pips", "tide-phase", "tide-time", "tide-bar", "tide-mark", "tide-trend", "banks", "carry-items", "carry-bar", "carry-fill", "carry-label", "compass", "compass-arrow",
            "compass-text", "breath", "breath-fill", "prompt", "notice", "feed", "markers", "blind", "scores", "scores-title", "scores-sub", "scores-body", "debug", "crosshair", "flood-warn", "caption", "tip"]) this.el[id] = $(id);
        // the tide bar: four segments sized by their share of a cycle
        this.el["tide-bar"].replaceChildren(...TIDE.phases.map((p, i) => { const s = document.createElement("i"); s.className = PHASE_CLASS[i]; s.style.flexGrow = String(p.seconds); s.title = p.name; return s; }));
        this.el["tide-pips"].replaceChildren(...Array.from({ length: TIDE.tides }, () => document.createElement("i")));
        // the weight bar marks how much a swimmer can hold up
        const cap = document.createElement("b");
        cap.style.left = `${(WATER.swimCapacity / CARRY.maxWeight) * 100}%`;
        cap.title = "Above this you sink in deep water";
        this.el["carry-bar"].append(cap);
        this.shown = {};
        this.noticeLeft = 0;
        this.tide = {};
        /** world markers: key → element */
        this.markers = new Map();
        this._p = { x: 0, y: 0, depth: 0, visible: false };
        this._s = {};
        this.scoresAge = 1;
        this.blind = 0;
    }

    set(key, value, apply) { if (this.shown[key] !== value) { this.shown[key] = value; apply(value); } }
    name(id) { return this.client.players.get(id)?.name || "someone"; }

    notice(text, seconds = 3) { this.el.notice.textContent = text; this.noticeLeft = seconds; this.el.notice.classList.remove("show"); void this.el.notice.offsetWidth; this.el.notice.classList.add("show"); }

    /** A caption for a sound (accessibility): bottom centre, a few seconds. */
    caption(text, seconds = 2) {
        const el = this.el.caption;
        if (!el) return;
        el.textContent = text; el.classList.add("on");
        clearTimeout(this._captionTimer);
        this._captionTimer = setTimeout(() => el.classList.remove("on"), seconds * 1000);
    }

    /** A first-match tip (game/tutorial.js). */
    tip(text, seconds = 6) {
        const el = this.el.tip;
        el.textContent = text; el.classList.add("on");
        clearTimeout(this._tipTimer);
        this._tipTimer = setTimeout(() => el.classList.remove("on"), seconds * 1000);
    }

    /** A line in the feed (newest at the bottom, five kept, each fading after a while). */
    feed(html, team = -1) {
        const li = document.createElement("li");
        li.innerHTML = html;
        if (team >= 0) li.style.setProperty("--team", cssColor(teamColor(team)));
        this.el.feed.append(li);
        while (this.el.feed.children.length > 5) this.el.feed.firstElementChild.remove();
        setTimeout(() => li.classList.add("old"), 6000);
        setTimeout(() => li.remove(), 7000);
    }
    /** A name as safe markup in its team's colour. */
    who(id) {
        const info = this.client.players.get(id), span = document.createElement("span");
        span.textContent = info ? info.name : "someone";
        span.className = "who";
        if (info) span.style.color = cssColor(teamColor(info.team));
        return span.outerHTML;
    }

    /**
     * @param {number} dt
     * @param {{ camera: object, width: number, height: number, viewYaw: number, scores: boolean, flares: Array, debug?: string, crosshairReach?: boolean }} o
     */
    update(dt, o) {
        const c = this.client, me = c.me, island = c.island, el = this.el;
        if (!island) return;
        const tide = tideAt(island.seed, Math.max(0, c.clock), this.tide), over = c.match.phase === "over";

        // ---- the tide clock: pips for tides, the phase, seconds left, where we are in the cycle
        this.set("tide", over ? -1 : tide.tide, (t) => [...el["tide-pips"].children].forEach((pip, i) => { pip.className = i < t ? "done" : i === t ? "now" : ""; }));
        this.set("phase", over ? "over" : PHASE_CLASS[tide.phase], (p) => { el["tide-phase"].textContent = over ? "Match over" : TIDE.phases[tide.phase].name; document.body.dataset.phase = p; });
        this.set("time", over ? "" : String(Math.ceil(tide.phaseLeft / TICK_RATE)), (t) => { el["tide-time"].textContent = t; });
        this.set("mark", Math.round(tide.cycle * 400) / 4, (m) => { el["tide-mark"].style.left = m + "%"; });
        const trend = tide.phase === 0 ? "falling" : tide.phase === 2 ? "rising" : "still";
        this.set("trend", over ? "" : trend, (t) => { el["tide-trend"].textContent = t === "falling" ? "▼ water falling" : t === "rising" ? "▲ water rising" : t ? "water still" : ""; el["tide-trend"].className = t; });
        // the flood is coming: the last seconds of low water, and the whole flood, if you are out in the sea with loot
        const camp = island.camps[me.team] || island.camps[0];
        const dist = Math.hypot(camp.x - me.x, camp.y - me.y);
        const danger = !over && me.alive && dist > ISLAND.campPad + 4 && ((tide.phase === 1 && tide.phaseLeft < 6 * TICK_RATE) || tide.phase === 2) && me.z < TIDE.high + 1;
        this.set("danger", danger, (d) => el["flood-warn"].classList.toggle("on", d));

        // ---- banks, richest first, mine marked
        const order = Array.from({ length: island.teams }, (_, t) => t).sort((a, b) => c.match.bank[b] - c.match.bank[a]);
        this.set("banks", order.map((t) => t + ":" + c.match.bank[t]).join(",") + "|" + me.team, () => {
            el.banks.replaceChildren(...order.map((t) => {
                const li = document.createElement("li"), name = document.createElement("span"), value = document.createElement("b");
                li.style.setProperty("--team", cssColor(teamColor(t)));
                li.className = t === me.team ? "mine" : "";
                name.textContent = TEAM_NAMES[t]; value.textContent = c.match.bank[t];
                li.append(name, value);
                return li;
            }));
        });

        // ---- what I carry
        const items = me.carry.map((id) => c.loot.get(id)).filter(Boolean);
        this.set("carry", items.map((l) => l.kind).join(","), () => {
            el["carry-items"].replaceChildren(...items.map((l) => { const i = document.createElement("i"); i.className = LOOT_KINDS[l.kind]; i.textContent = KIND_ICON[l.kind]; i.title = LOOT[LOOT_KINDS[l.kind]].name; return i; }));
        });
        const value = items.reduce((v, l) => v + LOOT[LOOT_KINDS[l.kind]].value, 0);
        this.set("weight", me.weight + "|" + value, () => {
            el["carry-fill"].style.width = `${(me.weight / CARRY.maxWeight) * 100}%`;
            el["carry-label"].textContent = me.weight ? `${me.weight} kg · worth ${value}${me.weight > WATER.swimCapacity ? " · too heavy to swim" : ""}` : "Empty-handed";
            el["carry-bar"].classList.toggle("heavy", me.weight > WATER.swimCapacity);
        });

        // ---- the way home: an arrow relative to where the camera looks, and how far
        const home = !over && me.alive && dist > ISLAND.campPad;
        this.set("compass", home, (h) => el.compass.classList.toggle("on", h));
        if (home) {
            const bearing = Math.atan2(camp.y - me.y, camp.x - me.x), rel = o.viewYaw - bearing;
            el["compass-arrow"].style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
            this.set("campDist", Math.round(dist), (d) => { el["compass-text"].textContent = `Camp ${d} m${me.weight ? "" : ""}`; });
        }

        // ---- breath
        const breath = me.breath / (WATER.breath * TICK_RATE);
        this.set("breath", Math.round(breath * 100), (b) => { el["breath-fill"].style.width = b + "%"; el.breath.classList.toggle("on", b < 100); el.breath.classList.toggle("low", b < 35); });

        // ---- blind: a white-out that fades
        const blindTarget = me.blind > 0 ? Math.min(1, me.blind / 50) : 0;
        this.blind += (blindTarget - this.blind) * (1 - Math.exp(-dt * (blindTarget > this.blind ? 30 : 4)));
        this.set("blind", Math.round(this.blind * 50) / 50, (b) => { el.blind.style.opacity = b; });

        // ---- notices
        if (this.noticeLeft > 0 && (this.noticeLeft -= dt) <= 0) el.notice.classList.remove("show");

        // ---- markers in the world: my camp, flares my team lit, and anyone carrying an idol
        this.drawMarkers(o, camp);

        // ---- scoreboard (held) and results (match over)
        const showScores = over || o.scores;
        this.set("scoresOn", showScores, (on) => el.scores.classList.toggle("on", on));
        if (showScores && (this.scoresAge += dt) > 0.25) { this.scoresAge = 0; this.scoreboard(over); }

        if (o.debug !== undefined) el.debug.textContent = o.debug;
    }

    drawMarkers(o, camp) {
        const c = this.client, me = c.me, p = this._p, seen = new Set(), cam = o.camera;
        const place = (key, x, y, z, cls, text, color) => {
            cam.project([x, y, z], o.width, o.height, p);
            if (!p.visible) return;
            let m = this.markers.get(key);
            if (!m) { m = document.createElement("div"); this.el.markers.append(m); this.markers.set(key, m); }
            seen.add(key);
            if (m.className !== "marker " + cls) m.className = "marker " + cls;
            if (m.textContent !== text) m.textContent = text;
            if (color) m.style.setProperty("--team", color);
            const px = Math.max(16, Math.min(o.width - 16, p.x)), py = Math.max(16, Math.min(o.height - 16, p.y));
            m.style.transform = `translate(${px}px, ${py}px)`;
        };
        if (Math.hypot(camp.x - me.x, camp.y - me.y) > 12) place("camp", camp.x, camp.y, camp.z + 6.5, "camp", "", cssColor(teamColor(me.team)));
        for (const f of o.flares) if (f.team === me.team) place("flare" + f.id, f.x, f.y, f.z + 1.2, "flare", `${Math.round(Math.hypot(f.x - me.x, f.y - me.y))} m`, cssColor(teamColor(f.team)));
        const s = this._s;
        for (const [id, info] of c.players) {
            if (id === c.id) continue;
            if (!c.sample(id, s) || !(s.flags & FLAG.alive)) continue;
            const mate = info.team === me.team, idol = (s.flags & FLAG.idol) !== 0;
            if (!mate && !idol) continue;
            const d = Math.hypot(s.x - me.x, s.y - me.y);
            if (mate && d < 4 && !idol) continue;
            place("p" + id, s.x, s.y, s.z + 2.3, idol ? "idol" : "mate", mate ? info.name : `${info.name}: idol`, cssColor(teamColor(info.team)));
        }
        for (const [key, m] of this.markers) if (!seen.has(key)) { m.remove(); this.markers.delete(key); }
    }

    scoreboard(over) {
        const c = this.client, island = c.island, el = this.el;
        const winner = c.match.winner;
        el["scores-title"].textContent = over ? (winner < 0 ? "A draw" : `${TEAM_NAMES[winner]} wins`) : "Scores";
        el["scores-sub"].textContent = over ? `Next island in ${Math.ceil(c.match.overTicks / TICK_RATE)} s` : "";
        const teams = Array.from({ length: island.teams }, (_, t) => t).sort((a, b) => c.match.bank[b] - c.match.bank[a]);
        const rows = [];
        for (const t of teams) {
            const head = document.createElement("tr");
            head.className = "team";
            head.style.setProperty("--team", cssColor(teamColor(t)));
            head.innerHTML = `<th colspan="2"></th><th>${c.match.bank[t]}</th><th></th><th></th><th></th><th></th>`;
            head.firstElementChild.textContent = TEAM_NAMES[t];
            rows.push(head);
            for (const info of [...c.players.values()].filter((p) => p.team === t).sort((a, b) => b.banked - a.banked)) {
                const tr = document.createElement("tr");
                if (info.id === c.id) tr.className = "me";
                const cells = [info.name + (info.bot ? " (bot)" : ""), "", info.banked, info.lost, info.steals, info.shoves, info.bot ? "" : info.ping];
                for (const v of cells) { const td = document.createElement("td"); td.textContent = v; tr.append(td); }
                rows.push(tr);
            }
        }
        el["scores-body"].replaceChildren(...rows);
    }
}
