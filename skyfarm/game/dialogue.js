/**
 * SKYFARM: who says what (GDD §6: 3–6 lines a visit; environmental storytelling first, dialogue second), and a
 * small runner for it (the `dialogue-systems` skill's custom-runner path: a graph as data, not a language).
 *
 * A conversation is a list of entries tried in order; the first whose `if` holds is played. An entry is lines
 * (line IDs into STRINGS, so the words can be translated without touching the graph), optional choices that jump
 * to other entries, and effects applied when it ends. Conditions and effects are short strings, read by the
 * runner, so the graph stays plain data:
 *   if:   "restored:<island>" · "flag:<name>" · "!flag:<name>" · "has:<material>" · "!has:<material>" (all must hold)
 *   do:   "flag:<name>" · "seeds:<crop>:<n>" · "material:<name>:<n>"
 * The runner is pure: give it the game state and it returns lines and what to do; sim.js applies the effects.
 * @module game/dialogue
 */

export const STRINGS = {
    // Ona, the bell-keeper (Bell Rock)
    ona_1: "Oh! Footsteps. Nobody's climbed Bell Rock since the long storm.",
    ona_2: "I keep the bell. It used to call the wind home every evening, and the islands would lean together to listen.",
    ona_3: "Now the Old Mill stands still and the wind doesn't know where to go.",
    ona_4: "Here, take these. Sunflowers. The sprites can't resist them.",
    ona_5: "If the mill ever turns again, come and tell me.",
    ona_again: "Is the mill turning yet? I listen for it every morning.",
    ona_mill_1: "I heard it! The sails, over the water, creaking like an old song.",
    ona_mill_2: "Then you should have this. My grandmother called it the Meadow's Old Seed.",
    ona_mill_3: "It isn't for a garden. It's for the great tree at the top of the sky. Take it up there one day.",
    ona_after: "Ring the bell for me sometime? No, don't. I like the quiet now. The good kind.",
    // Pell, the kite maker (Kite Cliffs)
    pell_1: "Mind the gusts here, they come off the cliff sideways.",
    pell_2: "I make kites. Well. I make kites and lose them. The wind up here is greedy.",
    pell_3: "The silk I use is spun by the cloud moths. Sky-silk. A scrap of it on a glider and you'd fly twice as far.",
    pell_4: "There's a bolt by my poles. Take it to a workbench. Fly further than my kites ever did.",
    pell_5: "And these: cloud-cotton. It only finishes when it's rained on. Like me.",
    pell_again: "If you see a red kite out over the Orchard, it's mine. Tell it to come home.",
    // Mabel, the beekeeper (Beehive Spire)
    mabel_1: "Shh. They're listening. The sprites, I mean, not the bees. The bees are always listening.",
    mabel_2: "Sprites go where flowers stand together. Three or more, two colours at least. They're fussy that way.",
    mabel_3: "Have you seen one at your garden yet? You'd know. Your crops would come up heavy.",
    mabel_no: "Plant a little flower bed by your crops and wait. Here, berries. Pink flowers, they like those.",
    mabel_yes_1: "You have! I can see the pollen on your sleeves.",
    mabel_yes_2: "Then you've earned this. The Orchard's Old Seed. I've kept it in the warmest skep for forty years.",
    mabel_after: "Come back in spring. Well. It's always spring up here, isn't it.",
    // Tor, at the roost (Eagle Roost)
    tor_1: "Hm. A gardener. On my rock.",
    tor_2: "The birds ride the warm columns. Watch where they circle and you'll know where the air goes up.",
    tor_3: "Up here the cold takes your breath twice as fast. Eat before you fly. Frost-mint tea. Best thing for it.",
    tor_4: "Take some mint. It only grows where it's cold enough to be honest.",
    tor_again: "Glass Lake's ice holds frost-glass. Light as a feather, strong as a promise. Your glider wants it.",
    // Iris, the astronomer (Lantern Ruins)
    iris_1: "You can see the whole sky from here. All the islands, like stars that came down for a closer look.",
    iris_2: "Star-lilies only open in the rain or at night. I think they're shy of the sun.",
    iris_3: "The great tree on the Crown has been asleep since the storm. Three Old Seeds woke it once, they say.",
    iris_gate_1: "The bell tower's ringing again. The Orchard and the High Rocks are joined.",
    iris_gate_2: "Then the last seed is yours. The High Rocks' Old Seed. It's been waiting for someone to come this far.",
    iris_wait: "When the Orchard Gate's bell rings again, the High Rocks will be part of the sky once more. Come back then.",
    iris_after: "Take the three seeds to the Crown. I'll be watching from here.",
    // Captain Bram (the airship)
    bram_1: "Ahoy, gardener! Captain Bram, merchant of the upper air. What have you grown for me?",
    bram_again: "Back again! Let's see your pouch.",
    // the Crown
    crown_need: "The great tree is still. Something should be planted here. Three somethings.",
    crown_ready: "The three Old Seeds are warm in your hands. Plant them at the tree's roots?",
};

/** the conversations, per speaker */
export const TALKS = {
    ona: [
        { if: "flag:ona_seed", lines: ["ona_after"] },
        { if: "restored:mill flag:met_ona", lines: ["ona_mill_1", "ona_mill_2", "ona_mill_3"], do: ["material:oldseed_meadow:1", "flag:ona_seed"] },
        { if: "flag:met_ona", lines: ["ona_again"] },
        { lines: ["ona_1", "ona_2", "ona_3", "ona_4", "ona_5"], do: ["seeds:sunflower:3", "flag:met_ona"] },
    ],
    pell: [
        { if: "flag:met_pell", lines: ["pell_again"] },
        { lines: ["pell_1", "pell_2", "pell_3", "pell_4", "pell_5"], do: ["seeds:cotton:2", "flag:met_pell"] },
    ],
    mabel: [
        { if: "flag:mabel_seed", lines: ["mabel_after"] },
        { if: "flag:pollinated", lines: ["mabel_1", "mabel_yes_1", "mabel_yes_2"], do: ["material:oldseed_orchard:1", "flag:mabel_seed"] },
        { if: "flag:met_mabel", lines: ["mabel_3", "mabel_no"] },
        { lines: ["mabel_1", "mabel_2", "mabel_3", "mabel_no"], do: ["seeds:berry:2", "flag:met_mabel"] },
    ],
    tor: [
        { if: "flag:met_tor", lines: ["tor_again"] },
        { lines: ["tor_1", "tor_2", "tor_3", "tor_4"], do: ["seeds:frostmint:3", "flag:met_tor"] },
    ],
    iris: [
        { if: "flag:iris_seed", lines: ["iris_after"] },
        { if: "restored:ogate", lines: ["iris_gate_1", "iris_gate_2", "iris_after"], do: ["material:oldseed_high:1", "flag:iris_seed"] },
        { if: "flag:met_iris", lines: ["iris_wait"] },
        { lines: ["iris_1", "iris_2", "iris_3", "iris_wait"], do: ["seeds:starlily:1", "flag:met_iris"] },
    ],
    bram: [
        { if: "flag:met_bram", lines: ["bram_again"] },
        { lines: ["bram_1"], do: ["flag:met_bram"] },
    ],
    crown: [
        { if: "has:oldseed_meadow has:oldseed_orchard has:oldseed_high", lines: ["crown_ready"], do: ["flag:ending"] },
        { lines: ["crown_need"] },
    ],
};

export const SPEAKERS = { ona: "Ona", pell: "Pell", mabel: "Mabel", tor: "Tor", iris: "Iris", bram: "Captain Bram", crown: "" };

/** does a condition string hold for this state? */
export function holds(cond, state) {
    if (!cond) return true;
    return cond.split(" ").every((c) => {
        const neg = c.startsWith("!"), [k, v] = (neg ? c.slice(1) : c).split(":");
        const r = k === "restored" ? state.progress.restored.has(v) : k === "flag" ? state.flags.has(v) : k === "has" ? (state.pouch.materials[v] || 0) > 0 : false;
        return neg ? !r : r;
    });
}

/** the entry this speaker would play now: { lines: [text], do: [effects] } */
export function talkTo(who, state) {
    const e = (TALKS[who] || []).find((t) => holds(t.if, state));
    if (!e) return null;
    return { who, speaker: SPEAKERS[who], ids: e.lines, lines: e.lines.map((id) => STRINGS[id] || id), do: e.do || [] };
}

/** apply an entry's effects to the state (called by sim.js when a conversation ends) */
export function applyEffects(state, effects) {
    for (const fx of effects) {
        const [k, a, b] = fx.split(":");
        if (k === "flag") state.flags.add(a);
        else if (k === "seeds") { state.pouch.seeds[a] = (state.pouch.seeds[a] || 0) + Number(b); if (!state.pouch.selected) state.pouch.selected = a; }
        else if (k === "material") state.pouch.materials[a] = (state.pouch.materials[a] || 0) + Number(b);
        state.events.push({ type: "gift", what: k, id: a, n: Number(b) || 1 });
    }
}
