/**
 * NIGHT MARKET — interface icons, drawn as inline SVG so they stay sharp at any size and need no image
 * files. Each is a 24×24 drawing in flat colours with a dark outline, in one consistent style.
 *
 *   icon("coin")            → "<svg class="ic" …>…</svg>"
 *   icon("noodles", 28)     → the same at 28 px
 * @module game/icons
 */

const O = `stroke="#3a2230" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"`;

const ART = {
    coin: `<circle cx="12" cy="12" r="9.3" fill="#ffc83d" ${O}/><circle cx="12" cy="12" r="6.2" fill="#ffe08a" stroke="#d99a1c" stroke-width="1.2"/><path d="M12 8.2v7.6M9.8 10.2c0-1 1-1.6 2.2-1.6s2.2.6 2.2 1.5c0 2.2-4.4 1.2-4.4 3.5 0 1 1 1.6 2.2 1.6s2.2-.6 2.2-1.6" fill="none" stroke="#b9770e" stroke-width="1.3" stroke-linecap="round"/>`,
    star: `<path d="M12 2.6l2.8 6 6.5.8-4.8 4.5 1.3 6.5L12 17.2 6.2 20.4l1.3-6.5L2.7 9.4l6.5-.8z" fill="#ffd34d" ${O}/>`,
    rent: `<path d="M3.5 11.5 12 4l8.5 7.5" fill="none" ${O} stroke-width="1.8"/><path d="M5.8 10.5V20h12.4v-9.5L12 5.2z" fill="#ff8f7a" ${O}/><rect x="10" y="13.5" width="4" height="6.5" rx=".8" fill="#fff3e4" ${O}/>`,
    clock: `<circle cx="12" cy="12" r="9" fill="#fff3e4" ${O}/><path d="M12 6.8V12l3.6 2.2" fill="none" ${O} stroke-width="1.8"/>`,
    energy: `<path d="M13.5 2.5 5.5 13.5h5.2L9.5 21.5l9-11.6h-5.6z" fill="#7df0a8" ${O}/>`,
    mood: `<circle cx="12" cy="12" r="9" fill="#ffd34d" ${O}/><circle cx="8.8" cy="10" r="1.2" fill="#3a2230"/><circle cx="15.2" cy="10" r="1.2" fill="#3a2230"/><path d="M7.8 14.2c1 1.8 2.5 2.6 4.2 2.6s3.2-.8 4.2-2.6" fill="none" ${O}/>`,
    people: `<circle cx="8.5" cy="8" r="3.3" fill="#ffc7a0" ${O}/><path d="M2.8 20c0-3.6 2.4-6 5.7-6s5.7 2.4 5.7 6z" fill="#6fb6ff" ${O}/><circle cx="16.5" cy="9" r="2.7" fill="#e9a878" ${O}/><path d="M13.6 20c.2-3 1.6-5.2 3.9-5.2 2.6 0 4 2.2 4 5.2z" fill="#ff8fb4" ${O}/>`,
    skewers: `<path d="M3.5 20.5 20.5 3.5" ${O} stroke="#a9773f" stroke-width="1.8" fill="none"/><rect x="6.2" y="12.6" width="5.2" height="5.2" rx="1.4" transform="rotate(-45 8.8 15.2)" fill="#c0562b" ${O}/><rect x="10" y="8.8" width="5.2" height="5.2" rx="1.4" transform="rotate(-45 12.6 11.4)" fill="#7fbf3f" ${O}/><rect x="13.8" y="5" width="5.2" height="5.2" rx="1.4" transform="rotate(-45 16.4 7.6)" fill="#c0562b" ${O}/>`,
    dumplings: `<path d="M3 16.5h18v2.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 18.7z" fill="#d9a561" ${O}/><path d="M4.2 16.5c0-5.2 3.4-9.5 7.8-9.5s7.8 4.3 7.8 9.5z" fill="#fff3e0" ${O}/><path d="M12 7c-.4 1.2-.4 2.3 0 3.4M8.6 8.2c.2 1.2.7 2.1 1.5 2.8M15.4 8.2c-.2 1.2-.7 2.1-1.5 2.8" fill="none" ${O} stroke-width="1.1"/>`,
    noodles: `<path d="M3 11.5h18c0 4.8-3.2 8.5-9 8.5s-9-3.7-9-8.5z" fill="#ff5f8f" ${O}/><path d="M5.5 11.3c1-2 2.3-2 3.3 0 1-2 2.3-2 3.3 0 1-2 2.3-2 3.3 0 1-2 2.1-2 3.1 0" fill="none" stroke="#ffcf4d" stroke-width="2" stroke-linecap="round"/><path d="M13.5 9 20 3M16.2 9.4 21.5 5" fill="none" ${O} stroke="#a9773f" stroke-width="1.5"/>`,
    tea: `<path d="M6.5 8.5h11l-1.4 11a1.6 1.6 0 0 1-1.6 1.4h-5a1.6 1.6 0 0 1-1.6-1.4z" fill="#8fd3ff" ${O}/><path d="M5.6 8.5h12.8v-1.2c0-.8-.6-1.4-1.4-1.4H7c-.8 0-1.4.6-1.4 1.4z" fill="#fff3e4" ${O}/><path d="M13 6 15 2.4" fill="none" ${O} stroke="#ff5f8f" stroke-width="1.8"/><circle cx="9.8" cy="17.2" r="1.15" fill="#3a2230"/><circle cx="12.6" cy="18.2" r="1.15" fill="#3a2230"/><circle cx="14.6" cy="16.2" r="1.15" fill="#3a2230"/>`,
    takoyaki: `<path d="M2.5 14.5h19l-1.6 4.2a2 2 0 0 1-1.9 1.3H6a2 2 0 0 1-1.9-1.3z" fill="#f1dfb8" ${O}/><circle cx="7.3" cy="11.2" r="3.4" fill="#c9792e" ${O}/><circle cx="16.7" cy="11.2" r="3.4" fill="#c9792e" ${O}/><circle cx="12" cy="9.4" r="3.6" fill="#dc9440" ${O}/><path d="M10.2 8.6c1-.9 2.6-.9 3.6 0" fill="none" stroke="#5a2f12" stroke-width="1.2" stroke-linecap="round"/><path d="M17.5 3.2 14.2 7.6" fill="none" ${O} stroke="#a9773f" stroke-width="1.3"/>`,
    rival: `<path d="M2.5 9.5h19" fill="none" ${O} stroke-width="1.8"/><path d="M3.5 9.5h7v3.2a3.5 3.5 0 0 1-7 0zM13.5 9.5h7v3.2a3.5 3.5 0 0 1-7 0z" fill="#2a1a26" ${O}/><path d="M5.2 11.2l2-.9M15.2 11.2l2-.9" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>`,
    rain: `<path d="M7 15.5a4.2 4.2 0 0 1-.5-8.4 5.6 5.6 0 0 1 10.8 1.2 3.7 3.7 0 0 1-.6 7.2z" fill="#cfe4ff" ${O}/><path d="M8.5 18l-1 2.8M12.5 18l-1 2.8M16.5 18l-1 2.8" fill="none" stroke="#5aa9ff" stroke-width="1.8" stroke-linecap="round"/>`,
    festival: `<path d="M12 2.5v2.2M12 19.3v2.2" fill="none" ${O}/><path d="M7.2 6.2h9.6c2 2.3 2 9.3 0 11.6H7.2c-2-2.3-2-9.3 0-11.6z" fill="#ff5f5f" ${O}/><path d="M9.6 6.2c-1 3.2-1 8.4 0 11.6M14.4 6.2c1 3.2 1 8.4 0 11.6" fill="none" stroke="#ffcf4d" stroke-width="1.2"/><rect x="8.2" y="4.6" width="7.6" height="1.8" rx=".6" fill="#ffcf4d" ${O}/><rect x="8.2" y="17.6" width="7.6" height="1.8" rx=".6" fill="#ffcf4d" ${O}/>`,
    lock: `<path d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5" fill="none" ${O} stroke-width="1.8"/><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="#ffc83d" ${O}/><circle cx="12" cy="15.2" r="1.5" fill="#3a2230"/>`,
    upgrade: `<path d="M12 3.5 4.5 11h4.3v8.5h6.4V11h4.3z" fill="#7df0a8" ${O}/>`,
    away: `<path d="M19.5 14.8A8.3 8.3 0 0 1 9.2 4.5a8.3 8.3 0 1 0 10.3 10.3z" fill="#ffe08a" ${O}/><path d="m16.5 4.2.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff" ${O} stroke-width="1"/>`,
};

/**
 * @param {keyof typeof ART} name
 * @param {number} [size] pixels
 * @returns {string} inline SVG markup ("" for an unknown name)
 */
export function icon(name, size = 20) {
    const art = ART[name];
    return art ? `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${art}</svg>` : "";
}

/** The same drawing as a data URL, for an <img> or for painting onto a canvas. */
export function iconURL(name, size = 96) {
    return "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${ART[name] || ""}</svg>`);
}

/** Decoded <img> elements for some icons, ready to paint on a canvas. A failed one is simply left out. */
export async function iconImages(names, size = 128) {
    const out = {};
    await Promise.all(names.map((name) => new Promise((done) => {
        const img = new Image();
        img.onload = () => { out[name] = img; done(); };
        img.onerror = done;
        img.src = iconURL(name, size);
    })));
    return out;
}
