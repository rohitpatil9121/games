/*
 * Space: a small WebGL renderer adapted from rohit-s-init/projection_library (public/Space.js).
 *
 * Kept from the original:
 *   - the orbit camera: camera (Xc,Yc,Zc) sits on a sphere of radius Rc around the view point
 *     (X0,Y0,Z0), steered by alpha (yaw) and beta (pitch); the world is Z-up
 *   - getXaxisUnitVector / getYaxisUnitVector / getZaxisUnitVector (the lambda-projection basis)
 *   - the vertex shader idea: project every vertex onto the camera axes with dot products
 *     (cPoint, xAxis, yAxis, zAxis, veriables uniforms)
 *
 * Upgraded:
 *   - perspective divide goes through gl_Position.w, so points behind the camera are clipped
 *     instead of mirrored, and there is no divide-by-zero at zProj = 0
 *   - xAxis from the original basis points to screen-left, so the shader negates it (no mirroring)
 *   - aspect ratio comes from the canvas instead of hardcoded 16/8/1.77
 *   - static geometry is uploaded once; dynamic geometry streams each frame
 *   - normals + hemisphere/sun/point lighting, emissive, fog, alpha and additive passes
 *   - post pass: glow, rewind (VHS) distortion, alarm tint, vignette
 *
 * Loaded as a classic script so the game still works from file://.
 */
(function () {
  const STRIDE = 11; // pos3 nrm3 col3 emissive1 alpha1

  function hexToRgb(c) {
    if (Array.isArray(c)) return c;
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  }

  // ------------------------------------------------------------------ geometry builder
  class MeshBuilder {
    constructor(verts = 4096) { this.data = new Float32Array(verts * STRIDE); this.n = 0; }
    reset() { this.n = 0; }
    ensure(k) {
      if ((this.n + k) * STRIDE <= this.data.length) return;
      const d = new Float32Array(Math.max(this.data.length * 2, (this.n + k) * STRIDE));
      d.set(this.data); this.data = d;
    }
    vert(p, nm, c, e, a) {
      this.ensure(1);
      const d = this.data, o = this.n * STRIDE;
      d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
      d[o + 3] = nm[0]; d[o + 4] = nm[1]; d[o + 5] = nm[2];
      d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2];
      d[o + 9] = e; d[o + 10] = a;
      this.n++;
    }
    tri(p0, p1, p2, nm, c, e, a) { this.vert(p0, nm, c, e, a); this.vert(p1, nm, c, e, a); this.vert(p2, nm, c, e, a); }
    quad(p0, p1, p2, p3, nm, c, e, a) { this.tri(p0, p1, p2, nm, c, e, a); this.tri(p0, p2, p3, nm, c, e, a); }

    // axis-aligned-in-XY box (optionally rotated around Z by yaw), centred at (cx,cy,cz)
    box(cx, cy, cz, sx, sy, sz, color, o = {}) {
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, yaw = o.yaw || 0;
      const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const P = (x, y, z) => [cx + x * cs - y * sn, cy + x * sn + y * cs, cz + z];
      const N = (x, y, z) => [x * cs - y * sn, x * sn + y * cs, z];
      const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
                 P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
      this.quad(v[4], v[5], v[6], v[7], N(0, 0, 1), c, e, a);
      if (!o.noBottom) this.quad(v[3], v[2], v[1], v[0], N(0, 0, -1), c, e, a);
      this.quad(v[0], v[1], v[5], v[4], N(0, -1, 0), c, e, a);
      this.quad(v[2], v[3], v[7], v[6], N(0, 1, 0), c, e, a);
      this.quad(v[1], v[2], v[6], v[5], N(1, 0, 0), c, e, a);
      this.quad(v[3], v[0], v[4], v[7], N(-1, 0, 0), c, e, a);
    }
    // glowing outline of a box (12 thin bars)
    boxEdges(cx, cy, cz, sx, sy, sz, t, color, o = {}) {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      for (const y of [-hy, hy]) for (const z of [-hz, hz]) this.box(cx, cy + y, cz + z, sx + t, t, t, color, o);
      for (const x of [-hx, hx]) for (const z of [-hz, hz]) this.box(cx + x, cy, cz + z, t, sy + t, t, color, o);
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) this.box(cx + x, cy + y, cz, t, t, sz, color, o);
    }
    cylinder(cx, cy, z0, r, h, seg, color, o = {}) {
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, r2 = o.rTop ?? r;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
        const b0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0], b1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0];
        const t0 = [cx + Math.cos(a0) * r2, cy + Math.sin(a0) * r2, z0 + h], t1 = [cx + Math.cos(a1) * r2, cy + Math.sin(a1) * r2, z0 + h];
        this.quad(b0, b1, t1, t0, [Math.cos(am), Math.sin(am), 0], c, e, a);
        this.tri([cx, cy, z0 + h], t0, t1, [0, 0, 1], c, e, a);
      }
    }
    sphere(cx, cy, cz, r, color, o = {}) {
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, sx = o.sx || 1, sz = o.sz || 1;
      const la = o.lat || 7, lo = o.lon || 12;
      const pt = (i, j) => {
        const th = i / la * Math.PI, ph = j / lo * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        return [[cx + n[0] * r * sx, cy + n[1] * r * sx, cz + n[2] * r * sz], n];
      };
      for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
        const [p0, n0] = pt(i, j), [p1] = pt(i + 1, j), [p2] = pt(i + 1, j + 1), [p3] = pt(i, j + 1);
        this.quad(p0, p1, p2, p3, n0, c, e, a);
      }
    }
    // flat ring / disc / sector lying on the ground plane at height z
    ring(cx, cy, z, r0, r1, seg, color, o = {}) {
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, s = o.start || 0, len = o.len ?? Math.PI * 2;
      for (let i = 0; i < seg; i++) {
        const a0 = s + i / seg * len, a1 = s + (i + 1) / seg * len;
        const p = (rr, an) => [cx + Math.cos(an) * rr, cy + Math.sin(an) * rr, z];
        if (r0 <= 0) this.tri([cx, cy, z], p(r1, a0), p(r1, a1), [0, 0, 1], c, e, a);
        else this.quad(p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1), [0, 0, 1], c, e, a);
      }
    }
    // square bar between two points
    beam(p, q, t, color, o = {}) {
      const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], len = Math.hypot(dx, dy, dz) || 1e-6;
      const d = [dx / len, dy / len, dz / len];
      let u = Math.abs(d[2]) < 0.9 ? [-d[1], d[0], 0] : [1, 0, 0];
      const ul = Math.hypot(...u); u = u.map(v => v / ul);
      const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, h = t / 2;
      const corner = (base, su, sw) => [base[0] + (u[0] * su + w[0] * sw) * h, base[1] + (u[1] * su + w[1] * sw) * h, base[2] + (u[2] * su + w[2] * sw) * h];
      const sides = [[1, 1, -1, 1, u], [-1, 1, -1, -1, w.map(v => v)], [-1, -1, 1, -1, u.map(v => -v)], [1, -1, 1, 1, w.map(v => -v)]];
      for (const [a1, b1, a2, b2, nm] of sides) {
        this.quad(corner(p, a1, b1), corner(q, a1, b1), corner(q, a2, b2), corner(p, a2, b2), nm, c, e, a);
      }
    }
    octa(cx, cy, cz, r, color, o = {}) {
      const c = hexToRgb(color), e = o.e || 0, a = o.a ?? 1, yaw = o.yaw || 0;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const eq = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => [cx + (x * cs - y * sn) * r, cy + (x * sn + y * cs) * r, cz]);
      const top = [cx, cy, cz + r * 1.3], bot = [cx, cy, cz - r * 1.3];
      for (let i = 0; i < 4; i++) {
        const p0 = eq[i], p1 = eq[(i + 1) % 4];
        const mx = (p0[0] + p1[0]) / 2 - cx, my = (p0[1] + p1[1]) / 2 - cy;
        this.tri(p0, p1, top, [mx, my, 0.8], c, e, a);
        this.tri(p1, p0, bot, [mx, my, -0.8], c, e, a);
      }
    }
  }

  // ------------------------------------------------------------------ shaders
  const VERT = `
    attribute vec3 pos; attribute vec3 nrm; attribute vec3 col; attribute vec2 ea;
    uniform vec3 cPoint; uniform vec3 xAxis; uniform vec3 yAxis; uniform vec3 zAxis;
    uniform vec4 veriables;            // x: aspect, y: focal (1/tan(fov/2)), z: near, w: far
    varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying vec2 vEA;
    void main(){
      vec3 v = pos - cPoint;
      float xProj = -dot(v, xAxis);    // original xAxis points screen-left
      float yProj =  dot(v, yAxis);
      float zProj =  dot(v, zAxis);    // distance along the view direction
      float n = veriables.z, f = veriables.w;
      gl_Position = vec4(xProj * veriables.y / veriables.x, yProj * veriables.y,
                         zProj * (f + n) / (f - n) - 2.0 * f * n / (f - n), zProj);
      vN = nrm; vCol = col; vW = pos; vEA = ea;
    }`;
  const FRAG = `
    precision highp float;
    uniform vec3 cPoint; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyCol; uniform vec3 groundCol;
    uniform vec3 fogCol; uniform vec2 fog; uniform vec4 lights[8]; uniform vec3 lightCols[8]; uniform float unlit;
    varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying vec2 vEA;
    void main(){
      vec3 n = normalize(vN);
      vec3 lit = mix(groundCol, skyCol, n.z * 0.5 + 0.5) + sunCol * max(dot(n, sunDir), 0.0);
      for (int i = 0; i < 8; i++) {
        vec3 L = lights[i].xyz - vW; float d = length(L);
        float att = clamp(1.0 - d / lights[i].w, 0.0, 1.0); att *= att;
        lit += lightCols[i] * att * (max(dot(n, L / max(d, 0.001)), 0.0) + 0.3);
      }
      vec3 c = mix(vCol * lit, vCol, unlit) + vCol * vEA.x;
      float fo = clamp((length(vW - cPoint) - fog.x) / (fog.y - fog.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(c, fogCol, fo), vEA.y);
    }`;
  const POST_VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const POST_FRAG = `
    precision highp float;
    uniform sampler2D tex; uniform vec2 res; uniform float amount; uniform float time; uniform float alarm; uniform float glowAmt;
    varying vec2 uv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 u = uv; float a = amount;
      u.x += (rand(vec2(floor(u.y * 90.0), floor(time * 30.0))) - 0.5) * 0.04 * a;
      vec3 col;
      col.r = texture2D(tex, u + vec2(0.008 * a, 0.0)).r;
      col.g = texture2D(tex, u).g;
      col.b = texture2D(tex, u - vec2(0.008 * a, 0.0)).b;
      vec3 glow = vec3(0.0);
      for (int i = 0; i < 20; i++) {
        float an = float(i) * 2.39996, r = (float(i) + 1.0) / 20.0;
        glow += max(texture2D(tex, u + vec2(cos(an), sin(an)) * r * 22.0 / res).rgb - 0.5, 0.0);
      }
      col += glow / 20.0 * glowAmt;
      col += (rand(u * (time + 1.0)) - 0.5) * 0.3 * a;
      col *= 1.0 - 0.22 * a * step(0.5, fract(u.y * 220.0));
      col = mix(col, col * vec3(0.75, 0.95, 1.3), a * 0.8);
      col = mix(col, col * vec3(1.5, 0.55, 0.55), alarm * 0.35);
      vec2 q = uv - 0.5; col *= 1.0 - dot(q, q) * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program not linked: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // ------------------------------------------------------------------ Space
  class Space {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl', { antialias: false, alpha: false });
      if (!gl) throw new Error('WebGL not supported');

      // --- camera (same model as the original Space.js)
      this.X0 = 0; this.Y0 = 0; this.Z0 = 0;
      this.Rc = 30; this.alpha = -Math.PI / 2; this.beta = 1.0;
      this.fov = 50; this.near = 0.1; this.far = 160;
      this.updateCamera();

      // --- scene settings
      this.sunDir = [-0.35, 0.3, 0.88]; this.sunCol = [0.75, 0.75, 0.9];
      this.skyCol = [0.32, 0.36, 0.7]; this.groundCol = [0.08, 0.05, 0.12];
      this.fogCol = [0.02, 0.02, 0.045]; this.fog = [40, 110];
      this.bg = [0.02, 0.02, 0.045];
      this.lights = [];
      this.post = { amount: 0, time: 0, alarm: 0, glow: 1.4 };

      // --- geometry
      this.staticMesh = new MeshBuilder(60000);
      this.opaque = new MeshBuilder(40000);
      this.trans = new MeshBuilder(20000);
      this.add = new MeshBuilder(20000);
      this.bufStatic = gl.createBuffer(); this.staticCount = 0;
      this.bufDyn = gl.createBuffer();

      this.program = compile(gl, VERT, FRAG);
      this.loc = {};
      for (const n of ['pos', 'nrm', 'col', 'ea']) this.loc[n] = gl.getAttribLocation(this.program, n);
      for (const n of ['cPoint', 'xAxis', 'yAxis', 'zAxis', 'veriables', 'sunDir', 'sunCol', 'skyCol', 'groundCol', 'fogCol', 'fog', 'lights', 'lightCols', 'unlit'])
        this.loc[n] = gl.getUniformLocation(this.program, n);

      this.postProgram = compile(gl, POST_VERT, POST_FRAG);
      this.postLoc = { p: gl.getAttribLocation(this.postProgram, 'p') };
      for (const n of ['tex', 'res', 'amount', 'time', 'alarm', 'glowAmt']) this.postLoc[n] = gl.getUniformLocation(this.postProgram, n);
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      this.fbo = null;
      this.resize();
    }

    // ---------------- camera (original Space.js math) ----------------
    updateCamera() {
      this.beta = Math.max(-1.5, Math.min(1.5, this.beta));
      this.Xc = this.X0 + Math.cos(this.beta) * Math.cos(this.alpha) * this.Rc;
      this.Yc = this.Y0 + Math.cos(this.beta) * Math.sin(this.alpha) * this.Rc;
      this.Zc = this.Z0 + Math.sin(this.beta) * this.Rc;
      this.updateMyVectors();
    }
    updateMyVectors() {
      this.xUnitVec = this.getXaxisUnitVector();
      this.yUnitVec = this.getYaxisUnitVector();
      this.zUnitVec = this.getZaxisUnitVector();
    }
    getYaxisLamdanot() {
      return 1 - (this.Zc - this.Z0) / ((this.X0 - this.Xc) ** 2 + (this.Y0 - this.Yc) ** 2 + (this.Z0 - this.Zc) ** 2);
    }
    getYaxisUnitVector() {
      const l = this.getYaxisLamdanot();
      const m = this.X0 + l * (this.Xc - this.X0) - this.Xc;
      const n = this.Y0 + l * (this.Yc - this.Y0) - this.Yc;
      const o = (1 + this.Z0) + l * (this.Zc - this.Z0) - this.Zc;
      const mag = Math.hypot(m, n, o);
      return [m / mag, n / mag, o / mag];
    }
    getXaxisUnitVector() {
      const l = this.getYaxisLamdanot();
      const m = this.X0 + l * (this.Xc - this.X0) - this.Xc;
      const n = this.Y0 + l * (this.Yc - this.Y0) - this.Yc;
      const o = (1 + this.Z0) + l * (this.Zc - this.Z0) - this.Zc;
      const r = (this.Z0 - this.Zc) * n - (this.Y0 - this.Yc) * o;
      const s = -((this.Z0 - this.Zc) * m - (this.X0 - this.Xc) * o);
      const t = (this.Y0 - this.Yc) * m - (this.X0 - this.Xc) * n;
      const mag = Math.hypot(r, s, t);
      return [r / mag, s / mag, t / mag];
    }
    getZaxisUnitVector() {
      const a = this.X0 - this.Xc, b = this.Y0 - this.Yc, c = this.Z0 - this.Zc, mag = Math.hypot(a, b, c);
      return [a / mag, b / mag, c / mag];
    }
    get focal() { return 1 / Math.tan(this.fov * Math.PI / 360); }
    get aspect() { return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight); }

    // world point -> CSS pixel coords (same math as the vertex shader)
    project(X, Y, Z) {
      const v = [X - this.Xc, Y - this.Yc, Z - this.Zc], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const z = dot(v, this.zUnitVec);
      if (z < this.near) return { x: 0, y: 0, visible: false };
      const x = -dot(v, this.xUnitVec) * this.focal / this.aspect / z, y = dot(v, this.yUnitVec) * this.focal / z;
      return { x: (x + 1) / 2 * this.canvas.clientWidth, y: (1 - y) / 2 * this.canvas.clientHeight, visible: true };
    }
    // CSS pixel -> world ray (origin at camera)
    screenRay(px, py) {
      const nx = px / this.canvas.clientWidth * 2 - 1, ny = 1 - py / this.canvas.clientHeight * 2;
      const kx = -nx * this.aspect / this.focal, ky = ny / this.focal;
      const d = [0, 1, 2].map(i => this.zUnitVec[i] + this.xUnitVec[i] * kx + this.yUnitVec[i] * ky);
      return { o: [this.Xc, this.Yc, this.Zc], d };
    }

    // ---------------- buffers ----------------
    uploadStatic() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufStatic);
      gl.bufferData(gl.ARRAY_BUFFER, this.staticMesh.data.subarray(0, this.staticMesh.n * STRIDE), gl.STATIC_DRAW);
      this.staticCount = this.staticMesh.n;
    }
    resize() {
      const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      this.canvas.width = w; this.canvas.height = h;
      // offscreen target, supersampled a little on low-DPI screens for smoother edges
      const ss = dpr < 1.5 ? 1.5 : 1;
      this.fw = Math.round(w * ss); this.fh = Math.round(h * ss);
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (this.fw > maxTex || this.fh > maxTex) { this.fw = w; this.fh = h; }
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); gl.deleteRenderbuffer(this.fboDepth); }
      this.fboTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fw, this.fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fboDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.fw, this.fh);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fboDepth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    bindMesh(buf) {
      const gl = this.gl, L = this.loc, B = STRIDE * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, B, 0);
      gl.enableVertexAttribArray(L.nrm); gl.vertexAttribPointer(L.nrm, 3, gl.FLOAT, false, B, 12);
      gl.enableVertexAttribArray(L.col); gl.vertexAttribPointer(L.col, 3, gl.FLOAT, false, B, 24);
      gl.enableVertexAttribArray(L.ea); gl.vertexAttribPointer(L.ea, 2, gl.FLOAT, false, B, 36);
    }
    drawDynamic(mesh) {
      if (!mesh.n) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDyn);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.data.subarray(0, mesh.n * STRIDE), gl.DYNAMIC_DRAW);
      this.bindMesh(this.bufDyn);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
    }

    // ---------------- frame ----------------
    reDraw() {
      const gl = this.gl, L = this.loc;
      this.updateCamera();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.fw, this.fh);
      gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE); // geometry is built double-sided

      gl.useProgram(this.program);
      gl.uniform3f(L.cPoint, this.Xc, this.Yc, this.Zc);
      gl.uniform3fv(L.xAxis, this.xUnitVec); gl.uniform3fv(L.yAxis, this.yUnitVec); gl.uniform3fv(L.zAxis, this.zUnitVec);
      gl.uniform4f(L.veriables, this.aspect, this.focal, this.near, this.far);
      const sl = Math.hypot(...this.sunDir);
      gl.uniform3fv(L.sunDir, this.sunDir.map(v => v / sl)); gl.uniform3fv(L.sunCol, this.sunCol);
      gl.uniform3fv(L.skyCol, this.skyCol); gl.uniform3fv(L.groundCol, this.groundCol);
      gl.uniform3fv(L.fogCol, this.fogCol); gl.uniform2fv(L.fog, this.fog);
      const lp = new Float32Array(32), lc = new Float32Array(24);
      this.lights.slice(0, 8).forEach((l, i) => { lp.set([l.p[0], l.p[1], l.p[2], l.r], i * 4); lc.set(hexToRgb(l.c).map(v => v * (l.i ?? 1)), i * 3); });
      for (let i = this.lights.length; i < 8; i++) lp[i * 4 + 3] = 0.001;
      gl.uniform4fv(L.lights, lp); gl.uniform3fv(L.lightCols, lc);

      // opaque: static level + dynamic objects
      gl.disable(gl.BLEND); gl.depthMask(true); gl.uniform1f(L.unlit, 0);
      if (this.staticCount) { this.bindMesh(this.bufStatic); gl.drawArrays(gl.TRIANGLES, 0, this.staticCount); }
      this.drawDynamic(this.opaque);
      // transparent (ghosts, doors) then additive (beams, cones, particles)
      gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.drawDynamic(this.trans);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.uniform1f(L.unlit, 1);
      this.drawDynamic(this.add);
      gl.depthMask(true); gl.disable(gl.BLEND);

      // post pass to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.postProgram);
      for (const n of ['pos', 'nrm', 'col', 'ea']) gl.disableVertexAttribArray(this.loc[n]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.enableVertexAttribArray(this.postLoc.p); gl.vertexAttribPointer(this.postLoc.p, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.uniform1i(this.postLoc.tex, 0);
      gl.uniform2f(this.postLoc.res, this.fw, this.fh);
      gl.uniform1f(this.postLoc.amount, this.post.amount); gl.uniform1f(this.postLoc.time, this.post.time);
      gl.uniform1f(this.postLoc.alarm, this.post.alarm); gl.uniform1f(this.postLoc.glowAmt, this.post.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(this.postLoc.p);
    }
  }

  window.Space = Space;
  window.MeshBuilder = MeshBuilder;
})();
