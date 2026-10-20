/**
 * Make a generated character model (Tripo, Meshy and the like) light enough for the game, with no Blender:
 *
 *   node tools/prepare-model.mjs <in.glb> <out.glb> [--faces 10000] [--texture 1024]
 *
 *   1. welds the duplicate vertices image-to-3D meshes come with (same place and same UV: one vertex);
 *   2. decimates to `faces` triangles by quadric-error half-edge collapse (Garland & Heckbert). A vertex only
 *      ever moves onto a neighbour, so every surviving vertex keeps its original UV and the texture stays put.
 *      UV seams survive: a vertex on a seam may only slide along it (each of its UV copies must have a
 *      matching copy at the target across a shared triangle), boundaries only slide along themselves, no
 *      collapse may flip a triangle, and the link condition keeps the surface manifold;
 *   3. shrinks the texture to `texture` pixels square, in headless Chrome (Node has no image decoder);
 *   4. finds the shirt by its colour (the commonest saturated hue on the torso), greys those texels keeping
 *      their shading, and moves those faces to a second material "shirt", which the game tints per team;
 *   5. writes a GLB (Y-up, as it came in) with smooth normals and a JPEG texture.
 *
 * tools/make-raider-glb.mjs then fits the game's skeleton and clips to the result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { launch } from "./chrome.mjs";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const [SRC, OUT] = args;
const TARGET = Number(opt("--faces", 10000)), SIZE = Number(opt("--texture", 1024));
if (!SRC || !OUT) { console.error("usage: node tools/prepare-model.mjs <in.glb> <out.glb> [--faces 10000] [--texture 1024]"); process.exit(1); }
const t0 = performance.now(), lap = (what) => console.log(`${what} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

// ------------------------------------------------------------------ read
const buf = readFileSync(SRC);
const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()), bin = buf.subarray(28 + buf.readUInt32LE(12));
function accessor(i) {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType], stride = v.byteStride || comps * size;
    const dv = new DataView(bin.buffer, bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0));
    const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
        const at = k * stride + c * size;
        out[k * comps + c] = a.componentType === 5126 ? dv.getFloat32(at, true) : a.componentType === 5125 ? dv.getUint32(at, true) : a.componentType === 5123 ? dv.getUint16(at, true) : dv.getUint8(at);
    }
    return out;
}
if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) throw new Error("expected one mesh with one primitive");
const prim = json.meshes[0].primitives[0];
const srcP = accessor(prim.attributes.POSITION), srcUV = accessor(prim.attributes.TEXCOORD_0), srcI = accessor(prim.indices);
const node = json.nodes.find((n) => n.mesh === 0);
if (node.matrix || node.rotation || node.scale || node.translation) console.warn("note: the mesh node has a transform, which is ignored");
const imgDef = json.images[json.textures[json.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index].source];
const imgView = json.bufferViews[imgDef.bufferView];
const srcImage = bin.subarray(imgView.byteOffset || 0, (imgView.byteOffset || 0) + imgView.byteLength);
console.log(`in: ${srcI.length / 3} triangles, ${srcP.length / 3} vertices, texture ${(srcImage.length / 1024).toFixed(0)} KB ${imgDef.mimeType}`);

// ------------------------------------------------------------------ weld
// positions by a 1e-5 grid; wedges (a position plus a UV) by position and UV
const posId = new Map(), wedgeId = new Map(), q = (x) => Math.round(x * 1e5);
const px = [], py = [], pz = [], wPos = [], wU = [], wV = [], srcToW = new Int32Array(srcP.length / 3);
for (let k = 0; k < srcP.length / 3; k++) {
    const pk = q(srcP[k * 3]) + "," + q(srcP[k * 3 + 1]) + "," + q(srcP[k * 3 + 2]);
    let p = posId.get(pk);
    if (p === undefined) { p = px.length; posId.set(pk, p); px.push(srcP[k * 3]); py.push(srcP[k * 3 + 1]); pz.push(srcP[k * 3 + 2]); }
    const wk = p + "|" + q(srcUV[k * 2]) + "," + q(srcUV[k * 2 + 1]);
    let w = wedgeId.get(wk);
    if (w === undefined) { w = wPos.length; wedgeId.set(wk, w); wPos.push(p); wU.push(srcUV[k * 2]); wV.push(srcUV[k * 2 + 1]); }
    srcToW[k] = w;
}
posId.clear(); wedgeId.clear();
const nP = px.length;
const tri = new Int32Array(srcI.length), alive = new Uint8Array(srcI.length / 3);
let live = 0;
for (let t = 0; t < srcI.length / 3; t++) {
    const a = srcToW[srcI[t * 3]], b = srcToW[srcI[t * 3 + 1]], c = srcToW[srcI[t * 3 + 2]];
    tri[t * 3] = a; tri[t * 3 + 1] = b; tri[t * 3 + 2] = c;
    if (wPos[a] !== wPos[b] && wPos[b] !== wPos[c] && wPos[a] !== wPos[c]) { alive[t] = 1; live++; }
}
lap(`welded: ${nP} positions, ${wPos.length} wedges, ${live} triangles`);

// per-position triangle lists (dead entries are dropped lazily)
const vt = Array.from({ length: nP }, () => []);
for (let t = 0; t < alive.length; t++) if (alive[t]) for (let c = 0; c < 3; c++) vt[wPos[tri[t * 3 + c]]].push(t);
const P = (t, c) => wPos[tri[t * 3 + c]];
function trisOf(p) {
    const l = vt[p];
    let n = 0;
    for (let i = 0; i < l.length; i++) if (alive[l[i]]) l[n++] = l[i];
    l.length = n;
    return l;
}

// ------------------------------------------------------------------ quadrics
const Q = new Float64Array(nP * 10);
function addPlane(p, a, b, c, d, w) {
    const o = p * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
}
function triNormal(a, b, c) {
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a], vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
for (let t = 0; t < alive.length; t++) {
    if (!alive[t]) continue;
    const a = P(t, 0), b = P(t, 1), c = P(t, 2), n = triNormal(a, b, c), l = Math.hypot(...n);
    if (l < 1e-20) continue;
    const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l, d = -(nx * px[a] + ny * py[a] + nz * pz[a]);
    for (const p of [a, b, c]) addPlane(p, nx, ny, nz, d, l / 2);
}
// open edges get a plane through them, perpendicular to their face, weighted heavily, so holes keep their shape
{
    const edges = new Map();
    for (let t = 0; t < alive.length; t++) if (alive[t]) for (let c = 0; c < 3; c++) {
        const a = P(t, c), b = P(t, (c + 1) % 3), k = a < b ? a * nP + b : b * nP + a;
        const e = edges.get(k); if (e) e.n++; else edges.set(k, { n: 1, t, a, b });
    }
    let open = 0;
    for (const e of edges.values()) {
        if (e.n !== 1) continue;
        open++;
        const fn = triNormal(P(e.t, 0), P(e.t, 1), P(e.t, 2)), ex = px[e.b] - px[e.a], ey = py[e.b] - py[e.a], ez = pz[e.b] - pz[e.a];
        let nx = ey * fn[2] - ez * fn[1], ny = ez * fn[0] - ex * fn[2], nz = ex * fn[1] - ey * fn[0];
        const l = Math.hypot(nx, ny, nz); if (l < 1e-20) continue;
        nx /= l; ny /= l; nz /= l;
        const d = -(nx * px[e.a] + ny * py[e.a] + nz * pz[e.a]), w = (ex * ex + ey * ey + ez * ez) * 10;
        addPlane(e.a, nx, ny, nz, d, w); addPlane(e.b, nx, ny, nz, d, w);
    }
    lap(`quadrics; ${open} open edges`);
}
function cost(p, u) {
    const x = px[u], y = py[u], z = pz[u];
    let s = 0;
    for (const o of [p * 10, u * 10]) {
        s += Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x
            + Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y
            + Q[o + 7] * z * z + 2 * Q[o + 8] * z + Q[o + 9];
    }
    return Math.max(0, s);
}

// ------------------------------------------------------------------ heap (lazy: an entry is stale when its stamp is old)
const hk = [], hv = [], hs = [], stamp = new Int32Array(nP);
function push(key, v) {
    let i = hk.length; hk.push(key); hv.push(v); hs.push(stamp[v]);
    while (i > 0) {
        const pa = (i - 1) >> 1; if (hk[pa] <= hk[i]) break;
        [hk[pa], hk[i]] = [hk[i], hk[pa]]; [hv[pa], hv[i]] = [hv[i], hv[pa]]; [hs[pa], hs[i]] = [hs[i], hs[pa]]; i = pa;
    }
}
function pop() {
    const top = [hk[0], hv[0], hs[0]], k = hk.pop(), v = hv.pop(), s = hs.pop();
    if (hk.length) {
        hk[0] = k; hv[0] = v; hs[0] = s;
        let i = 0;
        for (;;) {
            const l = 2 * i + 1, r = l + 1; let m = i;
            if (l < hk.length && hk[l] < hk[m]) m = l;
            if (r < hk.length && hk[r] < hk[m]) m = r;
            if (m === i) break;
            [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; [hs[m], hs[i]] = [hs[i], hs[m]]; i = m;
        }
    }
    return top;
}
function neighbours(p) {
    const out = [];
    for (const t of trisOf(p)) for (let c = 0; c < 3; c++) { const x = P(t, c); if (x !== p && !out.includes(x)) out.push(x); }
    return out;
}
function schedule(p) {
    stamp[p]++;
    let best = Infinity;
    for (const u of neighbours(p)) best = Math.min(best, cost(p, u));
    if (best < Infinity) push(best, p);
}
for (let p = 0; p < nP; p++) schedule(p);
lap("costs");

// ------------------------------------------------------------------ collapse
/** if p can collapse onto u: a map from p's wedges to u's, else null */
function tryCollapse(p, u) {
    const tp = trisOf(p), count = new Map(), map = new Map();
    let sharedN = 0;
    for (const t of tp) {
        let hasU = -1;
        for (let c = 0; c < 3; c++) { const x = P(t, c); if (x !== p) count.set(x, (count.get(x) || 0) + 1); if (x === u) hasU = c; }
        if (hasU >= 0) {
            sharedN++;
            for (let c = 0; c < 3; c++) if (P(t, c) === p) map.set(tri[t * 3 + c], tri[t * 3 + hasU]);
        }
    }
    if (!sharedN) return null;
    // on an open boundary: only along it
    let boundary = false;
    for (const n of count.values()) if (n === 1) boundary = true;
    if (boundary && count.get(u) !== 1) return null;
    // every UV copy of p needs a partner at u (seams slide only along themselves)
    for (const t of tp) for (let c = 0; c < 3; c++) if (P(t, c) === p && !map.has(tri[t * 3 + c])) return null;
    // link condition: the neighbours p and u share are only the tips of their shared triangles
    let common = 0;
    for (const t of trisOf(u)) for (let c = 0; c < 3; c++) { const x = P(t, c); if (x !== u && x !== p && count.has(x)) { common++; count.delete(x); } }
    if (common > sharedN) return null;
    // no flips, no slivers
    for (const t of tp) {
        let hasU = false; for (let c = 0; c < 3; c++) if (P(t, c) === u) hasU = true;
        if (hasU) continue;
        const v = [P(t, 0), P(t, 1), P(t, 2)], before = triNormal(v[0], v[1], v[2]);
        const after = triNormal(...v.map((x) => (x === p ? u : x)));
        const lb = Math.hypot(...before), la = Math.hypot(...after);
        if (la < 1e-14 || (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) < 0.2 * lb * la) return null;
    }
    return map;
}
let attempts = 0;
while (live > TARGET && hk.length) {
    const [, p, s] = pop();
    if (s !== stamp[p]) continue;
    attempts++;
    const options = neighbours(p).map((u) => [cost(p, u), u]).sort((a, b) => a[0] - b[0]);
    let done = false;
    for (const [, u] of options) {
        const map = tryCollapse(p, u);
        if (!map) continue;
        for (const t of trisOf(p)) {
            let hasU = false; for (let c = 0; c < 3; c++) if (P(t, c) === u) hasU = true;
            if (hasU) { alive[t] = 0; live--; continue; }
            for (let c = 0; c < 3; c++) if (P(t, c) === p) tri[t * 3 + c] = map.get(tri[t * 3 + c]);
            vt[u].push(t);
        }
        vt[p] = [];
        for (let k = 0; k < 10; k++) Q[u * 10 + k] += Q[p * 10 + k];
        stamp[p]++;
        schedule(u);
        for (const n of neighbours(u)) schedule(n);
        done = true;
        break;
    }
    if (!done) stamp[p]++; // stuck for now; a change next to it will schedule it again
    if (attempts % 200000 === 0) lap(`  ${live} triangles`);
}
lap(`decimated to ${live} triangles`);

// ------------------------------------------------------------------ compact, smooth normals (shared across UV seams)
const keep = [], wNew = new Int32Array(wPos.length).fill(-1);
for (let t = 0; t < alive.length; t++) if (alive[t]) keep.push(t);
const outW = [];
for (const t of keep) for (let c = 0; c < 3; c++) { const w = tri[t * 3 + c]; if (wNew[w] < 0) { wNew[w] = outW.length; outW.push(w); } }
const pn = new Float64Array(nP * 3);
for (const t of keep) {
    const n = triNormal(P(t, 0), P(t, 1), P(t, 2));
    for (let c = 0; c < 3; c++) { const p = P(t, c); pn[p * 3] += n[0]; pn[p * 3 + 1] += n[1]; pn[p * 3 + 2] += n[2]; }
}
const nV = outW.length, oP = new Float32Array(nV * 3), oN = new Float32Array(nV * 3), oUV = new Float32Array(nV * 2);
outW.forEach((w, i) => {
    const p = wPos[w], l = Math.hypot(pn[p * 3], pn[p * 3 + 1], pn[p * 3 + 2]) || 1;
    oP.set([px[p], py[p], pz[p]], i * 3); oN.set([pn[p * 3] / l, pn[p * 3 + 1] / l, pn[p * 3 + 2] / l], i * 3); oUV.set([wU[w], wV[w]], i * 2);
});
const faces = keep.map((t) => [wNew[tri[t * 3]], wNew[tri[t * 3 + 1]], wNew[tri[t * 3 + 2]]]);

// ------------------------------------------------------------------ texture, in Chrome
const browser = await launch();
let pixels, image;
try {
    const page = await browser.page("about:blank", { width: 64, height: 64 });
    const b64 = await page.evaluate(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(srcImage).toString("base64"))}), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: ${JSON.stringify(imgDef.mimeType)} }));
        // halve step by step: one big drawImage drops detail
        let src = bmp, w = bmp.width;
        while (w > ${SIZE}) {
            w = Math.max(${SIZE}, w >> 1);
            const c = new OffscreenCanvas(w, w), g = c.getContext("2d");
            g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, w); src = c;
        }
        const c = new OffscreenCanvas(${SIZE}, ${SIZE}), g = c.getContext("2d");
        g.drawImage(src, 0, 0, ${SIZE}, ${SIZE});
        window.__ctx = g;
        const d = g.getImageData(0, 0, ${SIZE}, ${SIZE}).data;
        let s = ""; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
        return btoa(s);
    })()`);
    pixels = new Uint8Array(Buffer.from(b64, "base64"));

    // the shirt: the commonest saturated hue under the torso faces (Y up; arms out to the sides at shoulder height)
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 1; i < oP.length; i += 3) { ymin = Math.min(ymin, oP[i]); ymax = Math.max(ymax, oP[i]); }
    const H = ymax - ymin;
    const texel = (u, v) => { const x = Math.min(SIZE - 1, Math.max(0, Math.floor(u * SIZE))), y = Math.min(SIZE - 1, Math.max(0, Math.floor(v * SIZE))), k = (y * SIZE + x) * 4; return [pixels[k] / 255, pixels[k + 1] / 255, pixels[k + 2] / 255]; };
    const faceTexel = (f) => texel((oUV[f[0] * 2] + oUV[f[1] * 2] + oUV[f[2] * 2]) / 3, (oUV[f[0] * 2 + 1] + oUV[f[1] * 2 + 1] + oUV[f[2] * 2 + 1]) / 3);
    const hsl = ([r, g, b]) => {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
        if (d < 1e-6) return [0, 0, l];
        const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
        return [h, s, l];
    };
    const bins = new Array(36).fill(0);
    for (const f of faces) {
        const cy = (oP[f[0] * 3 + 1] + oP[f[1] * 3 + 1] + oP[f[2] * 3 + 1]) / 3 - ymin, cx = (oP[f[0] * 3] + oP[f[1] * 3] + oP[f[2] * 3]) / 3, cz = (oP[f[0] * 3 + 2] + oP[f[1] * 3 + 2] + oP[f[2] * 3 + 2]) / 3;
        // the chest's front: above the belt, below the scarf, in front of the sack (the model faces +X)
        if (cy < H * 0.5 || cy > H * 0.6 || cx < 0 || cx > H * 0.15 || Math.abs(cz) > H * 0.1) continue;
        const [h, s, l] = hsl(faceTexel(f));
        if (s > 0.3 && l > 0.15 && l < 0.8) bins[Math.floor(h * 36) % 36]++;
    }
    console.log("torso hues:", bins.map((n, i) => n ? `${(i / 36).toFixed(2)}:${n}` : "").filter(Boolean).join(" "));
    const peak = bins.indexOf(Math.max(...bins)), hue = opt("--shirt-hue") !== undefined ? Number(opt("--shirt-hue")) : (peak + 0.5) / 36;
    console.log(`shirt hue ${hue.toFixed(3)} (${bins[peak]} torso faces; next best ${[...bins].sort((a, b) => b - a)[1]})`);
    const isShirt = (rgb) => { const [h, s, l] = hsl(rgb); let d = Math.abs(h - hue); d = Math.min(d, 1 - d); return d < 0.05 && s > 0.22 && l > 0.08 && l < 0.85; };
    // faces first (against the original colours), then grey the texels
    for (const f of faces) f.shirt = isShirt(faceTexel(f));
    for (let k = 0; k < pixels.length; k += 4) {
        const rgb = [pixels[k] / 255, pixels[k + 1] / 255, pixels[k + 2] / 255];
        if (!isShirt(rgb)) continue;
        const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], g = Math.round(Math.min(1, 0.25 + l * 1.6) * 255);
        pixels[k] = pixels[k + 1] = pixels[k + 2] = g;
    }
    const jpg = await page.evaluate(`(async () => {
        const d = Uint8ClampedArray.from(atob(${JSON.stringify(Buffer.from(pixels).toString("base64"))}), (c) => c.charCodeAt(0));
        const c = new OffscreenCanvas(${SIZE}, ${SIZE});
        c.getContext("2d").putImageData(new ImageData(d, ${SIZE}, ${SIZE}), 0, 0);
        const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.88 });
        const b = new Uint8Array(await blob.arrayBuffer());
        let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
        return btoa(s);
    })()`);
    image = Buffer.from(jpg, "base64");
} finally {
    await browser.close();
}
const shirtFaces = faces.filter((f) => f.shirt), bodyFaces = faces.filter((f) => !f.shirt);
lap(`texture ${SIZE}x${SIZE} JPEG ${(image.length / 1024).toFixed(0)} KB; shirt ${shirtFaces.length} of ${faces.length} faces`);

// ------------------------------------------------------------------ write
const chunks = [], views = [], accessors = [];
let offset = 0;
const view = (bytes, target) => {
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), pad = (4 - (u8.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: u8.length, ...(target ? { target } : {}) });
    chunks.push(u8); if (pad) chunks.push(new Uint8Array(pad)); offset += u8.length + pad;
    return views.length - 1;
};
const acc = (typed, type, componentType, count, extra = {}, target = 34962) => { accessors.push({ bufferView: view(typed, target), componentType, count, type, ...extra }); return accessors.length - 1; };
const min = [0, 1, 2].map((c) => Math.min(...oP.filter((_, i) => i % 3 === c))), max = [0, 1, 2].map((c) => Math.max(...oP.filter((_, i) => i % 3 === c)));
const attributes = { POSITION: acc(oP, "VEC3", 5126, nV, { min, max }), NORMAL: acc(oN, "VEC3", 5126, nV), TEXCOORD_0: acc(oUV, "VEC2", 5126, nV) };
const indices = (list) => { const a = nV > 65535 ? new Uint32Array(list.flat()) : new Uint16Array(list.flat()); return acc(a, "SCALAR", nV > 65535 ? 5125 : 5123, a.length, {}, 34963); };
const primitives = [{ attributes, indices: indices(bodyFaces), material: 0 }];
if (shirtFaces.length) primitives.push({ attributes, indices: indices(shirtFaces), material: 1 });
const out = {
    asset: { version: "2.0", generator: "tidefall prepare-model" }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: "character", mesh: 0 }], meshes: [{ name: "character", primitives }],
    materials: ["body", "shirt"].map((name) => ({ name, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } })),
    textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: view(image), mimeType: "image/jpeg" }],
};
out.buffers = [{ byteLength: offset }]; out.bufferViews = views; out.accessors = accessors;
let text = JSON.stringify(out); while (text.length % 4) text += " ";
const jb = Buffer.from(text), total = 28 + jb.length + offset, glb = Buffer.alloc(total);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jb.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jb.copy(glb, 20);
glb.writeUInt32LE(offset, 20 + jb.length); glb.writeUInt32LE(0x004e4942, 24 + jb.length);
let at = 28 + jb.length; for (const c of chunks) { glb.set(c, at); at += c.length; }
writeFileSync(OUT, glb);
lap(`wrote ${OUT}: ${faces.length} triangles, ${nV} vertices, ${(total / 1024).toFixed(0)} KB`);
