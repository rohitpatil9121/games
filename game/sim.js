/**
 * ORBITAL — gravity simulation (pure, deterministic, no rendering).
 *
 * The comet is a test particle pulled by every body with Newtonian gravity:
 *
 *     a = Σ G·m_i · d_i / (|d_i|² + ε²)^(3/2)
 *
 * ε ("softening") keeps the force finite when the comet grazes a body. Integration is semi-implicit
 * (symplectic) Euler — v += a·h, then p += v·h — which keeps orbits stable instead of spiralling out,
 * with several substeps per 60 Hz frame for accuracy. Pulsars have negative mass and push instead of pull.
 *
 * Because it is deterministic, the same code draws the trajectory preview, runs the real flight, and lets
 * tools/solve.mjs prove every level is solvable.
 * @module game/sim
 */

export const PHYS = Object.freeze({
    G: 1,
    softening: 0.35,
    substeps: 6,
    dt: 1 / 60,
    maxTime: 26,
    cometRadius: 0.22,
    dustRadius: 0.6,
    /** playfield half extents; leaving them (plus margin) means the comet is lost */
    bounds: { x: 16, y: 9 },
    margin: 3,
});

/** Body kinds. Placeable ones appear in a level's inventory. */
export const BODY = Object.freeze({
    moon: { mass: 12, radius: 0.5, label: "Moon", color: [0.62, 0.86, 1.0] },
    planet: { mass: 26, radius: 0.78, label: "Planet", color: [0.38, 0.95, 0.78] },
    giant: { mass: 46, radius: 1.1, label: "Giant", color: [1.0, 0.72, 0.38] },
    pulsar: { mass: -22, radius: 0.45, label: "Pulsar", color: [1.0, 0.45, 0.8] },
    blackhole: { mass: 85, radius: 0.55, label: "Black hole", color: [0.1, 0.05, 0.2] },
});

/**
 * @typedef {{ type: keyof BODY, x: number, y: number, orbit?: { cx: number, cy: number, r: number, speed: number, phase: number } }} BodySpec
 * @typedef {{ x: number, y: number }} Point
 */

/** Position of a body at time t (orbiting bodies move on a circle; others are fixed). */
export function bodyPosition(b, t, out) {
    if (b.orbit) {
        const a = b.orbit.phase + b.orbit.speed * t;
        out.x = b.orbit.cx + Math.cos(a) * b.orbit.r;
        out.y = b.orbit.cy + Math.sin(a) * b.orbit.r;
    } else { out.x = b.x; out.y = b.y; }
    return out;
}

/**
 * @param {object} level
 * @param {BodySpec[]} placed bodies the player placed
 */
export function createState(level, placed = []) {
    const L = level.launch;
    const bodies = [...level.fixed, ...placed].map((b) => ({
        ...b, mass: BODY[b.type].mass, radius: BODY[b.type].radius, px: b.x, py: b.y,
    }));
    return {
        t: 0,
        comet: { x: L.x, y: L.y, vx: Math.cos(L.angle) * L.speed, vy: Math.sin(L.angle) * L.speed },
        bodies,
        dust: level.dust.map((d) => ({ x: d.x, y: d.y, taken: false })),
        dustTaken: 0,
        portal: level.portal,
        status: "flying",   // flying | won | crashed | swallowed | lost
        hit: null,          // the body hit, if any
        events: [],         // this step's events: { type: "dust", index } | { type: "end" }
        closest: Infinity,  // closest approach to the portal (used by the solver)
    };
}

const tmp = { x: 0, y: 0 };

/** Advance one 60 Hz frame. Returns the state (mutated in place). */
export function step(s) {
    s.events.length = 0;
    if (s.status !== "flying") return s;
    const h = PHYS.dt / PHYS.substeps, eps2 = PHYS.softening * PHYS.softening, c = s.comet;
    for (let k = 0; k < PHYS.substeps; k++) {
        let ax = 0, ay = 0;
        for (const b of s.bodies) {
            bodyPosition(b, s.t, tmp);
            b.px = tmp.x; b.py = tmp.y;
            const dx = tmp.x - c.x, dy = tmp.y - c.y;
            const r2 = dx * dx + dy * dy;
            const inv = (PHYS.G * b.mass) / Math.pow(r2 + eps2, 1.5);
            ax += dx * inv; ay += dy * inv;
            if (r2 < (b.radius + PHYS.cometRadius) ** 2) {
                s.status = b.type === "blackhole" ? "swallowed" : "crashed";
                s.hit = b;
                s.events.push({ type: "end" });
                return s;
            }
        }
        c.vx += ax * h; c.vy += ay * h;
        c.x += c.vx * h; c.y += c.vy * h;
        s.t += h;

        s.dust.forEach((d, i) => {
            if (!d.taken && (d.x - c.x) ** 2 + (d.y - c.y) ** 2 < PHYS.dustRadius ** 2) {
                d.taken = true; s.dustTaken++; s.events.push({ type: "dust", index: i });
            }
        });
        const pd = Math.hypot(s.portal.x - c.x, s.portal.y - c.y);
        if (pd < s.closest) s.closest = pd;
        if (pd < s.portal.r) { s.status = "won"; s.events.push({ type: "end" }); return s; }
    }
    const B = PHYS.bounds, m = PHYS.margin;
    if (Math.abs(c.x) > B.x + m || Math.abs(c.y) > B.y + m || s.t > PHYS.maxTime) {
        s.status = "lost"; s.events.push({ type: "end" });
    }
    return s;
}

/**
 * Run a whole flight. Used for the preview and by the solver.
 * @returns {{ state: object, path: number[] }} path = flat [x0, y0, x1, y1, ...] one point per frame
 */
export function simulate(level, placed, maxFrames = Math.ceil(PHYS.maxTime * 60) + 2, path = null) {
    const s = createState(level, placed);
    if (path) { path.length = 0; path.push(s.comet.x, s.comet.y); }
    for (let f = 0; f < maxFrames && s.status === "flying"; f++) {
        step(s);
        if (path) path.push(s.comet.x, s.comet.y);
    }
    return { state: s, path };
}

/**
 * Can a body be placed here? Keeps clear of the launcher, the portal, other bodies and the edges.
 * @returns {string | null} null when allowed, otherwise the reason
 */
export function placementError(level, placed, x, y, type, ignoreIndex = -1) {
    const r = BODY[type].radius, B = PHYS.bounds;
    if (Math.abs(x) > B.x - r || Math.abs(y) > B.y - r) return "Too close to the edge";
    if (Math.hypot(x - level.launch.x, y - level.launch.y) < 2.2 + r) return "Too close to the launcher";
    if (Math.hypot(x - level.portal.x, y - level.portal.y) < level.portal.r + 1.4 + r) return "Too close to the portal";
    for (const b of level.fixed) {
        if (b.orbit) {
            const d = Math.hypot(x - b.orbit.cx, y - b.orbit.cy);
            if (Math.abs(d - b.orbit.r) < BODY[b.type].radius + r + 0.6) return "In the path of an orbiting body";
        } else if (Math.hypot(x - b.x, y - b.y) < BODY[b.type].radius + r + 0.9) return "Overlaps another body";
    }
    for (let i = 0; i < placed.length; i++) {
        if (i === ignoreIndex) continue;
        const b = placed[i];
        if (Math.hypot(x - b.x, y - b.y) < BODY[b.type].radius + r + 0.6) return "Overlaps another body";
    }
    return null;
}
