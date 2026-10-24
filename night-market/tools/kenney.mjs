/**
 * Reads models from the Kenney asset packs in assets/packs (CC0, see THIRD_PARTY.md) and hands them to
 * the model builder as ordinary shapes.
 *
 * The packs colour everything from one small palette image: each vertex's UV points at a flat swatch.
 * The game's street is one merged, vertex-coloured mesh with no textures, so the swatch under each vertex
 * is looked up here and becomes that vertex's colour. Node transforms are applied and the model is turned
 * from glTF's Y-up to the builder's Z-up, so a shape can be placed like any other.
 *
 *   const s = packShape("food-kit", "steamer");
 *   builder.add(s, { at: [0, 2.25, 1.03], color: s.color });
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const PACKS = fileURLToPath(new URL("../assets/packs/", import.meta.url));

/** Decode an 8-bit, non-interlaced PNG (truecolour, with or without alpha, or paletted) to RGB floats. */
function readPNG(path) {
    const b = readFileSync(path);
    let at = 8, width = 0, height = 0, type = 0, palette = null;
    const data = [];
    while (at < b.length) {
        const len = b.readUInt32BE(at), name = b.toString("latin1", at + 4, at + 8), body = b.subarray(at + 8, at + 8 + len);
        if (name === "IHDR") {
            width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9];
            if (body[8] !== 8 || body[12] !== 0) throw new Error("PNG must be 8-bit and non-interlaced: " + path);
        } else if (name === "PLTE") palette = body;
        else if (name === "IDAT") data.push(body);
        at += 12 + len;
    }
    const channels = { 2: 3, 6: 4, 3: 1, 0: 1 }[type], stride = width * channels, raw = inflateSync(Buffer.concat(data));
    const px = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? px[o + x - channels] : 0, up = y ? px[o + x - stride] : 0, c = x >= channels && y ? px[o + x - stride - channels] : 0;
            let predict = 0;
            if (filter === 1) predict = a;
            else if (filter === 2) predict = up;
            else if (filter === 3) predict = (a + up) >> 1;
            else if (filter === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); predict = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
            px[o + x] = (line[x] + predict) & 255;
        }
    }
    return {
        width, height,
        at(u, v) {
            const x = Math.min(width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * width))), y = Math.min(height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * height)));
            const i = (y * width + x) * channels;
            if (type === 3) { const k = px[i] * 3; return [palette[k] / 255, palette[k + 1] / 255, palette[k + 2] / 255]; }
            if (type === 0) return [px[i] / 255, px[i] / 255, px[i] / 255];
            return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
        },
    };
}

const images = new Map(), shapes = new Map();
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** A node's local matrix (column-major) from its translation, rotation and scale. */
function local(node) {
    if (node.matrix) return node.matrix;
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1], [tx, ty, tz] = node.translation || [0, 0, 0];
    return [
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
    ];
}
const multiply = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * One model from a pack as a builder shape, Z-up, at the size it was made (about half a metre across).
 * @param {string} pack folder under assets/packs
 * @param {string} name file name without ".glb"
 * @returns {{ p: number[][], f: number[][], n: number[][], color: (p: number[], i: number) => number[] }}
 */
export function packShape(pack, name) {
    const key = pack + "/" + name;
    if (shapes.has(key)) return shapes.get(key);
    const dir = PACKS + pack + "/Models/GLB format/", file = readFileSync(dir + name + ".glb");
    const jsonLength = file.readUInt32LE(12), json = JSON.parse(file.toString("utf8", 20, 20 + jsonLength)), bin = file.subarray(20 + jsonLength + 8);
    const read = (index) => {
        const a = json.accessors[index], view = json.bufferViews[a.bufferView], size = SIZES[a.type];
        const bytes = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1, stride = view.byteStride || size * bytes;
        const out = [], base = (view.byteOffset || 0) + (a.byteOffset || 0);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) {
            const o = base + i * stride + k * bytes;
            out.push(a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin[o]);
        }
        return out;
    };
    const imagePath = dir + json.images[0].uri;
    if (!images.has(imagePath)) images.set(imagePath, readPNG(imagePath));
    const image = images.get(imagePath);

    const shape = { p: [], f: [], n: [], colors: [] };
    const visit = (index, parent) => {
        const node = json.nodes[index], m = multiply(parent, local(node));
        if (node.mesh != null) for (const prim of json.meshes[node.mesh].primitives) {
            const pos = read(prim.attributes.POSITION), nrm = read(prim.attributes.NORMAL), uv = read(prim.attributes.TEXCOORD_0), idx = read(prim.indices), base = shape.p.length;
            for (let i = 0; i < pos.length / 3; i++) {
                const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
                const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
                const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1;
                shape.p.push([wx, -wz, wy]);                 // glTF is Y-up; the builder is Z-up
                shape.n.push([nx / l, -nz / l, ny / l]);
                shape.colors.push(image.at(uv[i * 2], uv[i * 2 + 1]));
            }
            for (let i = 0; i < idx.length; i += 3) shape.f.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
        }
        for (const child of node.children || []) visit(child, m);
    };
    for (const root of json.scenes[json.scene || 0].nodes) visit(root, IDENTITY);
    shape.color = (p, i) => shape.colors[i];
    shapes.set(key, shape);
    return shape;
}
