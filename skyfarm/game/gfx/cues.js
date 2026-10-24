/**
 * SKYFARM: the colours of the cues that matter (the preamble: told apart in under a second, in colour-blind modes
 * too). Each cue also has a shape or motion that doesn't depend on colour: ripe crops bob and sparkle upward,
 * sprites fly and flutter, low stamina pulses. The settings' scheme swaps the hues to ones that stay apart for
 * red-green (protan, deutan) or blue-yellow (tritan) colour vision; HDR values (above 1) so bloom still finds them.
 * @module game/gfx/cues
 */

const SCHEMES = {
    standard: { ripe: [1.8, 1.5, 0.8], helped: [0.6, 1.8, 1.6], sprite: [0.6, 1.8, 1.6], wing: [1.2, 1.6, 1.7] },
    // gold against blue: the pair every red-green deficiency keeps apart
    redgreen: { ripe: [1.9, 1.6, 0.5], helped: [0.5, 0.9, 2.0], sprite: [0.5, 0.9, 2.0], wing: [1.0, 1.3, 2.0] },
    // red-orange against cyan for blue-yellow
    blueyellow: { ripe: [2.0, 0.75, 0.5], helped: [0.4, 1.8, 2.0], sprite: [0.4, 1.8, 2.0], wing: [1.1, 1.7, 1.9] },
};

/** the live cue colours (mutated by setCueScheme; read every frame) */
export const CUES = { ...SCHEMES.standard, scheme: "standard" };

export function setCueScheme(name) {
    const s = SCHEMES[name] || SCHEMES.standard;
    Object.assign(CUES, s, { scheme: SCHEMES[name] ? name : "standard" });
}
