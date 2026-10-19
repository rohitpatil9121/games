import { TICK_RATE, ROLE, SCANNER, TAUNT, TEAM_NAMES, colorOf, cssColor } from "./data.js";
import { PROP_LIST } from "./props.js";
import { clearLine } from "./sim.js";
import { FLAG } from "./protocol.js";

/**
 * DECOY: the heads-up display. Plain DOM over the canvas (the engine draws no text). Reads the client;
 * changes nothing. Taken from BREACH's and changed for teams, roles, the scanner's charge and the
 * hider's kit.
 * @module game/hud
 */

const $ = (id) => document.getElementById(id);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export class Hud {
    /** @param {import("./net.js").Client} client */
    constructor(client) {
        this.client = client;
        this.el = {};
        for (const id of ["health", "crosshair", "hitmarker", "damage", "clock", "round", "teams", "role", "feed", "notice", "scores", "scores-title", "scores-sub", "scores-body", "debug",
            "blind", "blind-count", "seeker-kit", "hider-kit", "charge", "pings", "prop-name", "locked", "decoys", "taunt", "taunt-label", "prompt", "ghost", "banner", "banner-title", "banner-sub", "tags", "chat-log"]) this.el[id] = $(id);
        this.tags = new Map();
        this._s = { x: 0, y: 0, z: 0, flags: 0 }; this._p = { x: 0, y: 0, depth: 0, visible: false };
        this.noticeFor = 0;
        this.bannerFor = 0;
        this.shown = {};
        this.hit = 0;
        this.hurt = 0;
        this.scoresAge = 1;
    }

    set(key, value, apply) { if (this.shown[key] !== value) { this.shown[key] = value; apply(value); } }
    name(id) { return this.client.players.get(id)?.name || "someone"; }

    /** A scan of mine landed: on a hider (amount), or on a prop that cost me (self). */
    hitMarker(kind, amount) {
        this.hit = kind === "kill" ? 0.5 : 0.22;
        this.el.hitmarker.className = kind === "kill" ? "kill" : kind === "miss" ? "miss" : "";
        if (!amount) return;
        const n = document.createElement("span");
        n.className = kind === "miss" ? "dmg self" : "dmg";
        n.textContent = kind === "miss" ? `−${amount} you` : amount;
        n.style.left = `calc(50% + ${Math.round((Math.random() - 0.5) * 50) + 26}px)`;
        this.el.hitmarker.parentNode.append(n);
        setTimeout(() => n.remove(), 700);
    }
    hurtFlash(amount) { this.hurt = Math.min(1, this.hurt + 0.25 + amount / 100); }

    /** A line in the feed. */
    feed(parts, mine) {
        const li = document.createElement("li");
        for (const [text, cls] of parts) { const s = document.createElement("span"); s.textContent = text; if (cls) s.className = cls; li.append(s); }
        if (mine) li.className = "me";
        this.el.feed.prepend(li);
        while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
        setTimeout(() => li.remove(), 6000);
    }
    kill(e) {
        const me = this.client.id;
        if (e.by) this.feed([[this.name(e.by)], [" found ", "how"], [this.name(e.id)]], e.by === me || e.id === me);
        else this.feed([[this.name(e.id)], [e.how === 1 ? " scanned one prop too many" : " fell out of the world", "how"]], e.id === me);
    }

    chat(m) {
        const li = document.createElement("li"), who = document.createElement("b"), info = this.client.players.get(m.id);
        who.textContent = m.name; who.style.color = cssColor(colorOf(info || { id: m.id, team: 0 }));
        li.append(who, m.text);
        this.el["chat-log"].append(li);
        while (this.el["chat-log"].children.length > 6) this.el["chat-log"].firstChild.remove();
        setTimeout(() => li.classList.add("old"), 9000);
        setTimeout(() => li.remove(), 10000);
    }

    /**
     * Names over teammates' heads only (and only when in view): a name over a prop would give a hider away,
     * so nobody ever sees an opponent's. A ghost sees everyone's.
     */
    nameTags(camera, width, height, ghost) {
        const c = this.client, s = this._s, p = this._p, mine = c.players.get(c.id);
        const ex = camera.eye[0], ey = camera.eye[1], ez = camera.eye[2];
        for (const info of c.players.values()) {
            if (info.id === c.id) continue;
            let tag = this.tags.get(info.id);
            if (!tag) {
                tag = document.createElement("div"); tag.className = "tag-name";
                const name = document.createElement("span"); name.textContent = info.name; tag.append(name);
                this.el.tags.append(tag); this.tags.set(info.id, tag);
                tag.shown = false; tag.team = -1; tag.style.display = "none";
            }
            if (tag.team !== info.team) { tag.team = info.team; tag.style.color = cssColor(colorOf(info)); }
            let show = c.joined && (ghost || (mine && info.team === mine.team)) && c.sample(info.id, s) && (s.flags & FLAG.alive) !== 0;
            if (show) {
                const top = s.z + (s.flags & FLAG.seeker ? 2.05 : 0.6);
                show = Math.hypot(s.x - ex, s.y - ey, s.z - ez) < 60 && (ghost || clearLine(c.map, ex, ey, ez, s.x, s.y, top - 0.2));
                if (show) { camera.project([s.x, s.y, top], width, height, p); show = p.visible; }
                if (show) tag.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
            }
            if (tag.shown !== show) { tag.shown = show; tag.style.display = show ? "" : "none"; }
        }
        for (const [id, tag] of this.tags) if (!c.players.has(id)) { tag.remove(); this.tags.delete(id); }
    }

    notice(text, seconds = 3) { this.el.notice.textContent = text; this.el.notice.hidden = false; this.noticeFor = seconds; }
    banner(title, sub = "", seconds = 3) { this.el["banner-title"].textContent = title; this.el["banner-sub"].textContent = sub; this.el.banner.hidden = false; this.bannerFor = seconds; }

    /** What the hider would become: a prompt under the crosshair. null hides it. */
    prompt(html, ok = true) {
        this.set("prompt", html, (v) => { this.el.prompt.hidden = !v; if (v) this.el.prompt.innerHTML = v; });
        this.set("promptOk", ok, (v) => this.el.prompt.classList.toggle("no", !v));
    }

    /** The scoreboard: held open with its key, and as the results between rounds. Built from text nodes. */
    scores(show, dt) {
        const el = this.el, c = this.client, m = c.match, over = m.phase === "over", end = m.phase === "end";
        show = show || over;
        this.set("scoresShown", show, (v) => { el.scores.hidden = !v; this.scoresAge = 1; });
        if (!show || (this.scoresAge += dt) < 0.25) return;
        this.scoresAge = 0;
        const players = [...c.players.values()].sort((a, b) => b.score - a.score);
        el["scores-title"].textContent = over ? (m.winner ? `${TEAM_NAMES[m.winner]} win the match` : "A draw") : `Round ${m.round || 1} of ${m.rounds}`;
        el["scores-sub"].textContent = over ? `A new match in ${Math.ceil(m.timeLeft / TICK_RATE)}` : end ? `Sides swap in ${Math.ceil(m.timeLeft / TICK_RATE)}` : c.map ? c.map.name : "";
        const rows = [];
        const row = (p) => {
            const tr = document.createElement("tr"), name = document.createElement("td"), swatch = document.createElement("span");
            swatch.className = "swatch"; swatch.style.background = cssColor(colorOf(p));
            name.append(swatch, p.name);
            if (p.bot) { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "bot"; name.append(tag); }
            if (!((p.flags ?? 1) & FLAG.alive) && (m.phase === "seek" || m.phase === "hide")) { const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "ghost"; name.append(tag); }
            tr.append(name);
            for (const v of [p.score, p.finds, p.bot ? "" : p.ping]) { const td = document.createElement("td"); td.textContent = v; tr.append(td); }
            if (p.id === c.id) tr.className = "me";
            return tr;
        };
        for (const t of [1, 2]) {
            const head = document.createElement("tr"), td = document.createElement("td");
            head.className = "team"; td.colSpan = 4;
            td.textContent = `${TEAM_NAMES[t]}  ${m.teamScore[t]}  · ${t === m.seekTeam ? "seeking" : "hiding"}`;
            td.style.color = cssColor(colorOf({ id: 0, team: t }));
            head.append(td); rows.push(head);
            for (const p of players) if (p.team === t) rows.push(row(p));
        }
        el["scores-body"].replaceChildren(...rows);
    }

    /** @param {number} dt @param {string} [debug] */
    update(dt, debug) {
        const c = this.client, me = c.me, el = this.el, m = c.match, mine = c.players.get(c.id);
        const seeker = me.role === ROLE.seeker, playing = m.phase === "hide" || m.phase === "seek";
        this.set("health", Math.max(0, me.health), (v) => { el.health.textContent = v; el.health.classList.toggle("low", v <= 30); });
        const seconds = Math.ceil(m.timeLeft / TICK_RATE);
        this.set("clock", m.phase === "wait" ? "—" : clock(seconds), (v) => { el.clock.textContent = v; });
        this.set("late", m.late, (v) => el.clock.classList.toggle("late", v));
        this.set("round", m.phase === "wait" ? "Waiting for players" : m.phase === "hide" ? `Round ${m.round}/${m.rounds} · hide` : m.phase === "seek" ? `Round ${m.round}/${m.rounds} · seek` : `Round ${m.round}/${m.rounds}`, (v) => { el.round.textContent = v; });
        this.set("teams", `${m.teamScore[1]}:${m.teamScore[2]}`, () => {
            const a = document.createElement("b"), b = document.createElement("b");
            a.textContent = `${TEAM_NAMES[1]} ${m.teamScore[1]}`; a.style.color = cssColor(colorOf({ team: 1 }));
            b.textContent = `${m.teamScore[2]} ${TEAM_NAMES[2]}`; b.style.color = cssColor(colorOf({ team: 2 }));
            el.teams.replaceChildren(a, " : ", b);
        });
        const roleText = !c.joined ? "" : !me.alive && playing ? "" : m.phase === "wait" ? "Waiting for the other side" : seeker ? "You are seeking" : "You are hiding";
        this.set("role", roleText, (v) => { el.role.hidden = !v; el.role.textContent = v; });
        this.set("blind", seeker && me.frozen && m.phase === "hide", (v) => { el.blind.hidden = !v; });
        if (seeker && me.frozen) this.set("blindCount", seconds, (v) => { el["blind-count"].textContent = v; });
        this.set("ghost", c.joined && !me.alive && playing, (v) => { el.ghost.hidden = !v; });
        this.set("crosshair", me.alive && playing || m.phase === "wait", (v) => { el.crosshair.style.display = v ? "" : "none"; });

        const kit = !me.alive ? "" : seeker ? "seeker" : "hider";
        this.set("kit", kit, (v) => { el["seeker-kit"].hidden = v !== "seeker"; el["hider-kit"].hidden = v !== "hider"; });
        if (kit === "seeker") {
            this.set("charge", Math.round((me.charge / SCANNER.charge) * 100), (v) => el.charge.style.setProperty("--fill", v + "%"));
            this.set("pings", me.pings, (v) => { el.pings.textContent = `Ping ×${v}`; el.pings.classList.toggle("off", v === 0); });
        } else if (kit === "hider") {
            this.set("propName", me.prop, (v) => { el["prop-name"].textContent = PROP_LIST[v]?.name || ""; });
            this.set("locked", me.locked, (v) => { el.locked.textContent = v ? "Locked straight" : "Free to turn"; el.locked.classList.toggle("on", v); });
            this.set("decoys", me.decoys, (v) => { el.decoys.textContent = `Decoy ×${v}`; el.decoys.classList.toggle("off", v === 0); });
            const every = (m.late ? TAUNT.lateInterval : TAUNT.interval) * TICK_RATE, left = m.phase === "seek" ? Math.max(0, me.tauntIn) : every;
            this.set("taunt", Math.round((left / every) * 100), (v) => el.taunt.style.setProperty("--fill", Math.min(100, v) + "%"));
            this.set("tauntSoon", m.phase === "seek" && left < 5 * TICK_RATE, (v) => el.taunt.parentNode.classList.toggle("soon", v));
            this.set("tauntLabel", me.tauntCool > 0 ? "Taunt resting" : m.phase === "seek" ? `Taunt in ${Math.ceil(left / TICK_RATE)}` : "Taunt", (v) => { el["taunt-label"].textContent = v; });
        }

        if (this.hit > 0) { this.hit -= dt; el.hitmarker.style.opacity = Math.max(0, Math.min(1, this.hit * 6)); }
        if (this.hurt > 0) { this.hurt = Math.max(0, this.hurt - dt * 1.6); el.damage.style.opacity = this.hurt; }
        if (this.noticeFor > 0 && (this.noticeFor -= dt) <= 0) el.notice.hidden = true;
        if (this.bannerFor > 0 && (this.bannerFor -= dt) <= 0) el.banner.hidden = true;
        if (debug !== undefined && !el.debug.hidden) el.debug.textContent = debug;
        void mine;
    }
}
