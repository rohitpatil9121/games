/**
 * Turn a prepared generated character (tools/prepare-model.mjs: decimated, its shirt split out and
 * greyed) into the game's raider: assets/models/raider.glb, the same skeleton names, clips and bone tricks
 * as the procedural one (tools/make-models.mjs), so game/characters.js drives it the same way.
 *
 *   node tools/make-raider-glb.mjs <prepared.glb> [--face +x|-x|+z|-z] [--height 1.88] [--out assets/models/raider.glb]
 *
 * It reads the mesh from its shape, not from labels:
 *   - turns it Z-up and facing +Y (the engine's convention; --face says where the model's front points in
 *     glTF), stands it on z = 0 and scales it to --height;
 *   - finds the T-pose arms by where the body's vertical extent drops off (the shoulder), the hand tips by
 *     the furthest points, the crotch as the lowest point between the legs, and lays the joints out from
 *     those (img2threejs: measure, don't guess; and mirror left and right);
 *   - lowers the arms from the T-pose about each shoulder, blended over a short span so the shoulder doesn't
 *     tear, because the game's clips are written for arms that hang;
 *   - weights every vertex by region and by bands at the joints (a head, a hat and the sack are rigid on
 *     one bone; limbs blend at elbow, wrist, knee and ankle);
 *   - adds the team pennant on a pole above the sack, the one thing the generated model lacks for telling
 *     teams apart at a distance;
 *   - writes the body and the shirt as two textured meshes sharing one image (the game tints the shirt in
 *     the team's colour), the pennant as a palette mesh, and the clips from make-models.mjs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Builder, box, cylinder, sphere, pal, skeleton, writeGLB } from "./modelkit.mjs";
import { clips } from "./make-models.mjs";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SRC = args[0];
const FACE = opt("--face", "+x"), HEIGHT = Number(opt("--height", 1.88));
const OUT = opt("--out", fileURLToPath(new URL("../assets/models/raider.glb", import.meta.url)));
if (!SRC) { console.error("usage: node tools/make-raider-glb.mjs <prepared.glb> [--face +x] [--height 1.88]"); process.exit(1); }

// ------------------------------------------------------------------ read the GLB
const buf = readFileSync(SRC);
const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8, bin = buf.subarray(binStart);
const view = (i) => { const v = json.bufferViews[i]; return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
function accessor(i) {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const C = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const off = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || comps * C.BYTES_PER_ELEMENT;
    const out = new (C === Float32Array ? Float32Array : Uint32Array)(a.count * comps);
    const dv = new DataView(bin.buffer, bin.byteOffset + off, a.count * stride);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
        const at = k * stride + c * C.BYTES_PER_ELEMENT;
        out[k * comps + c] = C === Float32Array ? dv.getFloat32(at, true) : C === Uint32Array ? dv.getUint32(at, true) : C === Uint16Array ? dv.getUint16(at, true) : dv.getUint8(at);
    }
    return out;
}
const imageIndex = json.textures?.[json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index ?? 0]?.source ?? 0;
const image = view(json.images[imageIndex].bufferView), mime = json.images[imageIndex].mimeType || "image/jpeg";

/** each primitive as { name, pos (Z-up), nrm, uv, idx } */
const parts = [];
for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const mat = json.materials?.[prim.material]?.name || "body";
    const P = accessor(prim.attributes.POSITION), N = accessor(prim.attributes.NORMAL), UV = accessor(prim.attributes.TEXCOORD_0), I = accessor(prim.indices);
    // primitives may share one vertex buffer: keep only the vertices this one uses
    const remap = new Map(), keep = [];
    const idx = Uint32Array.from(I, (v) => { if (!remap.has(v)) { remap.set(v, keep.length); keep.push(v); } return remap.get(v); });
    const pick = (A, n) => Float32Array.from({ length: keep.length * n }, (_, i) => A[keep[Math.floor(i / n)] * n + (i % n)]);
    parts.push({ name: /shirt/i.test(mat) ? "shirt" : "body", P: pick(P, 3), N: pick(N, 3), UV: pick(UV, 2), I: idx });
}

// glTF Y-up → Z-up (x, −z, y), then turn so the front faces +Y
const turn = { "+x": [0, -1, 1, 0], "-x": [0, 1, -1, 0], "+z": [-1, 0, 0, -1], "-z": [1, 0, 0, 1] }[FACE];
if (!turn) throw new Error("--face is one of +x, -x, +z, -z");
const toZup = (x, y, z) => { const X = x, Y = -z, Z = y; return [turn[0] * X + turn[1] * Y, turn[2] * X + turn[3] * Y, Z]; };
// for "+x": a point on +X goes to +Y (turn by +90°): x' = −y, y' = x
for (const p of parts) {
    for (const [A] of [[p.P], [p.N]]) for (let i = 0; i < A.length; i += 3) { const v = toZup(A[i], A[i + 1], A[i + 2]); A[i] = v[0]; A[i + 1] = v[1]; A[i + 2] = v[2]; }
}

// stand it up: feet on z = 0, height scaled, centred on the legs
let zmin = Infinity, zmax = -Infinity;
for (const p of parts) for (let i = 2; i < p.P.length; i += 3) { zmin = Math.min(zmin, p.P[i]); zmax = Math.max(zmax, p.P[i]); }
const scale = HEIGHT / (zmax - zmin);
let cx = 0, cy = 0, cn = 0;
for (const p of parts) for (let i = 0; i < p.P.length; i += 3) if ((p.P[i + 2] - zmin) * scale < 0.3) { cx += p.P[i]; cy += p.P[i + 1]; cn++; }
cx /= cn; cy /= cn;
for (const p of parts) for (let i = 0; i < p.P.length; i += 3) { p.P[i] = (p.P[i] - cx) * scale; p.P[i + 1] = (p.P[i + 1] - cy) * scale; p.P[i + 2] = (p.P[i + 2] - zmin) * scale; }
const H = HEIGHT;
const all = []; for (const p of parts) for (let i = 0; i < p.P.length; i += 3) all.push([p.P[i], p.P[i + 1], p.P[i + 2]]);

// ------------------------------------------------------------------ landmarks
// hand tips: the furthest points to each side
let tipR = all.reduce((a, v) => (v[0] > a[0] ? v : a)), tipL = all.reduce((a, v) => (v[0] < a[0] ? v : a));
const armZ = (tipR[2] + tipL[2]) / 2;
// the armpit: going out from the middle, where the body under the arm ends (counting points in a band
// below the arm; the hat brim and things hanging off the belt only leave a few). The shoulder joint sits just inside it.
function shoulderX(sign) {
    const step = H * 0.0125, counts = [];
    for (const v of all) {
        if (v[0] * sign <= 0 || v[2] > armZ - H * 0.064 || v[2] < armZ - H * 0.16) continue;
        const b = Math.floor(Math.abs(v[0]) / step); counts[b] = (counts[b] || 0) + 1;
    }
    const ref = Math.max(...counts.slice(2, 10).map((c) => c || 0));
    for (let b = 4; b < 40; b++) if ((counts[b] || 0) < ref * 0.15) return b * step - H * 0.012;
    return H * 0.1;
}
const shR = shoulderX(1), shL = shoulderX(-1), sh = Math.min(shR, shL); // mirrored: gear hanging on one side only widens that side
console.log("shoulders", shR.toFixed(3), shL.toFixed(3));
// the crotch: the lowest point of the body between the legs
let crotch = H;
for (const v of all) if (Math.abs(v[0]) < H * 0.015 && v[2] > H * 0.08 && v[2] < H * 0.6 && Math.abs(v[1]) < H * 0.08) crotch = Math.min(crotch, v[2]);
const legX = (() => { let s = 0, n = 0; for (const v of all) if (v[2] > H * 0.12 && v[2] < crotch - H * 0.05 && v[0] > 0) { s += v[0]; n++; } return n ? s / n : H * 0.06; })();
console.log(`landmarks: hands at x ±${tipR[0].toFixed(2)} z ${armZ.toFixed(2)}, shoulders at x ±${sh.toFixed(3)}, crotch z ${crotch.toFixed(2)}, legs at x ±${legX.toFixed(3)}`);

// ------------------------------------------------------------------ lower the arms
const DOWN = (72 * Math.PI) / 180, BLEND = H * 0.05;
const pivot = (s) => [s * sh, 0, armZ];
function lower(x, y, z, nx, ny, nz) {
    const s = Math.sign(x), ax = Math.abs(x);
    const w = Math.max(0, Math.min(1, (ax - (sh - BLEND)) / (2 * BLEND)));
    const near = Math.abs(z - armZ) < H * 0.08;
    if (!w || !near || z < crotch) return null;
    const a = -s * DOWN * (w * w * (3 - 2 * w)), c = Math.cos(a), sn = Math.sin(a), pv = pivot(s);
    const rx = x - pv[0], rz = z - pv[2];
    return [pv[0] + rx * c - rz * sn, y, pv[2] + rx * sn + rz * c, nx * c - nz * sn, ny, nx * sn + nz * c, w];
}
/** per vertex: which arm it belongs to (−1 left, 1 right, 0 none), and how far along the arm (0 shoulder .. 1 tip) */
for (const p of parts) {
    const n = p.P.length / 3;
    p.side = new Int8Array(n); p.along = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const x = p.P[k * 3], y = p.P[k * 3 + 1], z = p.P[k * 3 + 2];
        const tip = x > 0 ? tipR[0] : tipL[0];
        const r = lower(x, y, z, p.N[k * 3], p.N[k * 3 + 1], p.N[k * 3 + 2]);
        if (!r) continue;
        p.side[k] = Math.sign(x);
        p.along[k] = Math.max(0, Math.min(1, (Math.abs(x) - sh) / (Math.abs(tip) - sh)));
        p.P.set(r.slice(0, 3), k * 3); p.N.set(r.slice(3, 6), k * 3);
    }
}
const armPoint = (s, f) => { const pv = pivot(s), len = (s > 0 ? tipR[0] : -tipL[0]) - sh, a = -s * DOWN; return [pv[0] + s * len * f * Math.cos(a), 0, pv[2] + s * len * f * Math.sin(a)]; };

// ------------------------------------------------------------------ the skeleton, laid out from the landmarks
const hipsZ = crotch + H * 0.06, neckZ = armZ + H * 0.05, chestZ = hipsZ + (armZ - hipsZ) * 0.72, spineZ = hipsZ + (armZ - hipsZ) * 0.35;
const knee = crotch * 0.52, ankle = H * 0.055;
const J = skeleton([
    { name: "hips", parent: null, at: [0, 0, hipsZ] },
    { name: "spine", parent: "hips", at: [0, 0, spineZ] },
    { name: "chest", parent: "spine", at: [0, 0, chestZ] },
    { name: "head", parent: "chest", at: [0, 0, neckZ] },
    { name: "armL", parent: "chest", at: armPoint(-1, 0) }, { name: "foreL", parent: "armL", at: armPoint(-1, 0.47) }, { name: "handL", parent: "foreL", at: armPoint(-1, 0.82) },
    { name: "armR", parent: "chest", at: armPoint(1, 0) }, { name: "foreR", parent: "armR", at: armPoint(1, 0.47) }, { name: "handR", parent: "foreR", at: armPoint(1, 0.82) },
    { name: "thighL", parent: "hips", at: [-legX, 0, crotch] }, { name: "shinL", parent: "thighL", at: [-legX, 0, knee] }, { name: "footL", parent: "shinL", at: [-legX, 0, ankle] },
    { name: "thighR", parent: "hips", at: [legX, 0, crotch] }, { name: "shinR", parent: "thighR", at: [legX, 0, knee] }, { name: "footR", parent: "shinR", at: [legX, 0, ankle] },
    { name: "pack", parent: "chest", at: [0, -H * 0.12, chestZ - H * 0.04] },
    { name: "flag", parent: "chest", at: [H * 0.07, -H * 0.15, chestZ + H * 0.05] },
]);
const j = (n) => J.index(n);

// ------------------------------------------------------------------ weights
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** a blend between bone a (below z0 - half) and bone b (above z0 + half) */
const bandZ = (a, b, z, z0, half) => { const t = smooth((z - (z0 - half)) / (2 * half)); return [[a, 1 - t], [b, t]]; };
function weigh(p, k) {
    const x = p.P[k * 3], y = p.P[k * 3 + 1], z = p.P[k * 3 + 2], side = p.side[k];
    if (side) {
        const L = side < 0 ? "L" : "R", f = p.along[k];
        if (f < 0.12) { const t = smooth(f / 0.12); return [[j("chest"), 1 - t], [j("arm" + L), t]]; }
        if (f < 0.55) { const t = smooth((f - 0.4) / 0.15); return [[j("arm" + L), 1 - t], [j("fore" + L), t]]; }
        const t = smooth((f - 0.74) / 0.12); return [[j("fore" + L), 1 - t], [j("hand" + L), t]];
    }
    if (z > neckZ - H * 0.02) return bandZ(j("chest"), j("head"), z, neckZ, H * 0.015);
    // the sack: behind the back, above the hips
    if (y < -H * 0.09 && z > hipsZ - H * 0.06 && z < neckZ) return [[j("pack"), 1]];
    if (z < crotch + H * 0.03) {
        const L = x < 0 ? "L" : "R";
        if (z > crotch - H * 0.03) { const t = smooth((crotch + H * 0.03 - z) / (H * 0.06)); return [[j("hips"), 1 - t], [j("thigh" + L), t]]; }
        if (z > ankle + H * 0.03) return bandZ(j("shin" + L), j("thigh" + L), z, knee, H * 0.03);
        return bandZ(j("foot" + L), j("shin" + L), z, ankle + H * 0.015, H * 0.015);
    }
    if (z < spineZ) return bandZ(j("hips"), j("spine"), z, (hipsZ + spineZ) / 2, H * 0.03);
    return bandZ(j("spine"), j("chest"), z, (spineZ + chestZ) / 2, H * 0.03);
}

// ------------------------------------------------------------------ meshes for the writer
function meshOf(p) {
    const n = p.P.length / 3, col = new Float32Array(n * 4).fill(1), jnt = new Uint8Array(n * 4), wgt = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
        const w = weigh(p, k).filter((e) => e[1] > 1e-4).slice(0, 4), sum = w.reduce((a, e) => a + e[1], 0);
        w.forEach(([b, v], i) => { jnt[k * 4 + i] = b; wgt[k * 4 + i] = v / sum; });
    }
    return { name: p.name, pos: Array.from(p.P), nrm: Array.from(p.N), col: Array.from(col), uv: Array.from(p.UV), idx: Array.from(p.I), jnt: Array.from(jnt), wgt: Array.from(wgt), skinned: true, triangles: p.I.length / 3, image, mime };
}
const meshes = parts.map(meshOf);

// the pennant on its pole, above the sack (palette slot 0 is the team colour, as on the procedural raider)
const flagAt = J.joints[j("flag")].at, top = flagAt[2] + H * 0.42;
const pennant = new Builder("pennant");
pennant.add(cylinder(0.012, 0.012, top - flagAt[2], 6), { at: [flagAt[0], flagAt[1], (flagAt[2] + top) / 2], color: pal(5), skin: j("flag") });
pennant.add(box(0.02, 0.3, 0.2), { at: [flagAt[0], flagAt[1] - 0.15, top - 0.12], color: pal(0), skin: j("flag") });
pennant.add(cylinder(0.1, 0.002, 0.18, 4), { at: [flagAt[0], flagAt[1] - 0.34, top - 0.12], rot: [Math.PI / 2, 0, 0], scale: [0.2, 1, 1], color: pal(0), skin: j("flag") });
pennant.add(sphere(1, 6, 5), { at: [flagAt[0], flagAt[1], top + 0.01], scale: [0.025, 0.025, 0.025], color: pal(4), skin: j("flag") });

// the clips also move bones this model doesn't have (hat, hair, face): keep only the ones it has
const ours = (pose) => Object.fromEntries(Object.entries(pose).filter(([n]) => n === "move" || J.index(n) !== undefined));
const trimmed = clips().map((c) => ({ ...c, keys: c.keys.map((k) => ({ ...k, pose: { ...ours(k.pose), ...(k.pose.move ? { move: ours(k.pose.move) } : {}) } })) }));
const r = writeGLB(OUT, { meshes: [...meshes, pennant], skeleton: J, clips: trimmed });
console.log(`${OUT.split(/[\\/]/).pop()}: ${r.meshes} meshes, ${r.triangles} triangles, ${(r.bytes / 1024).toFixed(0)} KB (texture ${(image.length / 1024).toFixed(0)} KB)`);
