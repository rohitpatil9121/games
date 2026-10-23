/**
 * SKYFARM: one atmosphere for the sky and for the haze on everything else (the
 * `threejs-atmosphere-aerial-perspective` skill, "small scene" tier: an analytic height/distance model rather
 * than precomputed LUTs, because the camera never leaves the low sky).
 *
 * The skill's rule is kept: sky and aerial perspective share the same coefficients, density profiles, sun
 * direction and scale. Two kinds of particle:
 *   - air (Rayleigh-like): scatters blue, thins with height over RAYLEIGH_H metres;
 *   - haze (Mie-like): grey-white, forward-scattering around the sun, thickest just over the cloud sea and
 *     thinning over MIE_H metres. This is what makes the far islands sink into a soft blue-white.
 * The coefficients are Earth's (the skill's defaults; the haze is three times Earth's aerosol, the damp air
 * over a cloud sea). The islands are 0.1–2 km apart, too close for real air to show, so there is one explicit
 * conversion: atmosphere metres = world metres × ATMO.scale (8). It applies to heights and distances alike, so
 * the sky, the sun's colour and the haze stay one consistent model; the world just "reads" eight times bigger,
 * which is what sells the scale (GDD §0).
 *
 * Optical depth along a straight segment through exponential density has a closed form, so there is no
 * ray marching. The sky radiance is single scattering with the attenuation taken as uniform along the view
 * path ("fog in-scatter"): L = E·T_sun·(βR·PR + βM·PM)/(βR + βM) · (1 − e^−τ). The haze on a surface uses
 * the same terms over the segment from the camera to it, so a far island fades exactly toward the sky behind it.
 *
 * The same maths runs in JavaScript (sunLight, skyAt) for the lights the materials use (sun colour, sky and
 * ground ambient) and for tuning in Node.
 * @module game/gfx/atmosphere
 */

export const ATMO = Object.freeze({
    /** scattering per atmosphere metre at the cloud sea */
    rayleigh: [5.802e-6, 13.558e-6, 33.1e-6],
    mie: 3.996e-6 * 3,
    mieExtinction: 4.44e-6 * 3,
    mieG: 0.78,
    RAYLEIGH_H: 8000,
    MIE_H: 1200,
    /** atmosphere metres per world metre */
    scale: 8,
    /** ozone: absorbs orange-red on the long path at sunset, which keeps the high sky blue at golden hour */
    ozone: [0.65e-6, 1.881e-6, 0.085e-6],
    OZONE_COLUMN: 15000,
    /** the reference height (the cloud sea's top) */
    z0: 0,
    /** sun irradiance (before the air reddens it), and an extra multiple-scattering fill */
    sun: [3.0, 2.92, 2.75],
    fill: 0.5,
});

const PI = Math.PI;
/** the colour of multiply-scattered skylight (normalised to luminance 1) */
const FILL = [0.62, 0.86, 1.45];

/** optical depth (density-weighted length) from height z along direction dz for `len` metres, density exp(-(z - z0)/H) */
function depth(z, dz, len, H) {
    const base = Math.exp(-(z - ATMO.z0) / H);
    if (Math.abs(dz) < 1e-4) return base * len;
    return base * (H / dz) * (1 - Math.exp(-(len * dz) / H));
}
/** optical depth to the top of the atmosphere (up-going or level rays; down-going rays are capped by `cap`) */
function depthOut(z, dz, H, cap = 60000) {
    if (dz > 1e-4) return Math.exp(-(z - ATMO.z0) / H) * (H / dz);
    return depth(z, dz, cap, H);
}

/** the light from the sun that reaches height z (rgb), given the sun's elevation (sz = sun direction's z) */
export function sunLight(z, sz, out = [0, 0, 0]) {
    z *= ATMO.scale;
    const s = Math.max(sz, -0.02) + 0.035;
    const dR = depthOut(z, s, ATMO.RAYLEIGH_H), dM = depthOut(z, s, ATMO.MIE_H);
    const airmass = 1 / s;
    for (let i = 0; i < 3; i++) out[i] = ATMO.sun[i] * Math.exp(-(ATMO.rayleigh[i] * dR + ATMO.mieExtinction * dM + ATMO.ozone[i] * ATMO.OZONE_COLUMN * Math.min(airmass, 40))) * smoothstep(-0.06, 0.02, sz);
    return out;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const phaseR = (c) => (3 / (16 * PI)) * (1 + c * c);
function phaseM(c) { const g = ATMO.mieG, g2 = g * g; return (3 / (8 * PI)) * ((1 - g2) * (1 + c * c)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * c, 1.5)); }

/** Sky radiance looking along unit direction d from height z, with the sun along unit s. */
export function skyAt(z, d, s, out = [0, 0, 0]) {
    const c = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
    const dz = Math.max(d[2], 0.0) + 0.012;
    const E = sunLight(z, s[2]);
    z *= ATMO.scale;
    const dR = depthOut(z, dz, ATMO.RAYLEIGH_H), dM = depthOut(z, dz, ATMO.MIE_H);
    const pr = phaseR(c), pm = phaseM(c), lum = 0.3 * E[0] + 0.59 * E[1] + 0.11 * E[2];
    for (let i = 0; i < 3; i++) {
        const bR = ATMO.rayleigh[i] * dR, bM = ATMO.mie * dM, tau = bR + ATMO.mieExtinction * dM;
        const scat = (bR * pr + bM * pm) / Math.max(1e-9, bR + bM);
        // multiple scattering: light that has bounced around the sky many times arrives blue whatever the
        // sun's colour, which is what keeps the high sky blue at golden hour
        out[i] = (E[i] * scat * PI + lum * FILL[i] * ATMO.fill * (bR / Math.max(1e-9, bR + bM)) * 0.6) * (1 - Math.exp(-tau));
    }
    return out;
}

/** GLSL: the same model. Needs u_sunDirection, u_camPos and the u_atmo* uniforms (see uniforms()). */
export const atmosphereChunk = /* glsl */ `
uniform vec3 u_atmoRayleigh;   // per metre at the cloud sea
uniform vec4 u_atmoMie;        // scattering, extinction, g, -
uniform vec4 u_atmoHeights;    // rayleigh H, mie H, z0, fill (atmosphere metres)
uniform float u_atmoScale;     // atmosphere metres per world metre
uniform vec3 u_atmoSun;        // the sun's light at the camera, already reddened (sunLight on the CPU)
uniform float u_atmoNight;     // 0 by day, 1 at night: the sky's own glow when the sun is gone
const float ATMO_PI = 3.14159265;

float atmoDepth(float z, float dz, float len, float H) {
    float base = exp(-(z - u_atmoHeights.z) / H);
    if (abs(dz) < 1e-4) return base * len;
    return base * (H / dz) * (1.0 - exp(-(len * dz) / H));
}
float atmoDepthOut(float z, float dz, float H) {
    if (dz > 1e-4) return exp(-(z - u_atmoHeights.z) / H) * (H / dz);
    return atmoDepth(z, dz, 60000.0, H);
}
float atmoPhaseR(float c) { return (3.0 / (16.0 * ATMO_PI)) * (1.0 + c * c); }
float atmoPhaseM(float c) {
    float g = u_atmoMie.z, g2 = g * g;
    return (3.0 / (8.0 * ATMO_PI)) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}
vec3 atmoNightSky(vec3 d) {
    float h = max(d.z, 0.0);
    return mix(vec3(0.09, 0.12, 0.24), vec3(0.02, 0.035, 0.09), pow(h, 0.5));
}
/** in-scattered light and transmittance for optical depths (dR, dM) seen along direction cosine c to the sun */
vec3 atmoScatter(float dR, float dM, float c, out vec3 trans) {
    vec3 bR = u_atmoRayleigh * dR;
    float bM = u_atmoMie.x * dM;
    vec3 tau = bR + u_atmoMie.y * dM;
    trans = exp(-tau);
    vec3 scat = (bR * atmoPhaseR(c) + bM * atmoPhaseM(c)) / max(bR + bM, vec3(1e-9));
    float lum = dot(u_atmoSun, vec3(0.3, 0.59, 0.11));
    vec3 fill = lum * vec3(0.62, 0.86, 1.45) * u_atmoHeights.w * (bR / max(bR + bM, vec3(1e-9))) * 0.6;
    return (u_atmoSun * scat * ATMO_PI + fill) * (1.0 - trans);
}
/** the sky's radiance looking along d from height z */
vec3 atmoSky(float z, vec3 d) {
    float c = dot(d, u_sunDirection);
    float dz = max(d.z, 0.0) + 0.012;
    vec3 t;
    z *= u_atmoScale;
    vec3 day = atmoScatter(atmoDepthOut(z, dz, u_atmoHeights.x), atmoDepthOut(z, dz, u_atmoHeights.y), c, t);
    return day + atmoNightSky(d) * u_atmoNight;
}
/** aerial perspective: what a surface's colour becomes between it and the camera */
vec3 atmoAerial(vec3 color, vec3 world) {
    vec3 v = world - u_camPos;
    float len = length(v);
    vec3 d = v / max(len, 1e-4);
    float c = dot(d, u_sunDirection);
    vec3 t;
    float z = u_camPos.z * u_atmoScale;
    len *= u_atmoScale;
    vec3 inscatter = atmoScatter(atmoDepth(z, d.z, len, u_atmoHeights.x), atmoDepth(z, d.z, len, u_atmoHeights.y), c, t);
    // at night the air glows faintly with the night sky's colour instead
    vec3 night = atmoNightSky(d) * u_atmoNight * (1.0 - t);
    return color * t + inscatter + night;
}
`;

/** The uniform block every material that uses the chunk shares (one set of arrays, updated in place). */
export function makeAtmoUniforms() {
    return {
        u_atmoRayleigh: Float32Array.from(ATMO.rayleigh),
        u_atmoMie: new Float32Array([ATMO.mie, ATMO.mieExtinction, ATMO.mieG, 0]),
        u_atmoHeights: new Float32Array([ATMO.RAYLEIGH_H, ATMO.MIE_H, ATMO.z0, ATMO.fill]),
        u_atmoScale: ATMO.scale,
        u_atmoSun: new Float32Array(3),
        u_atmoNight: 0,
    };
}
