/**
 * DECOY: bot brains (a stand-in until the real ones: they stand still).
 * @module game/bots
 */
export function createBrain(id, skill = 2, seed = 1) { return { seq: 0, input: { seq: 0, mx: 0, my: 0, buttons: 0, yaw: 0, pitch: 0, prop: 0, lag: 0 } }; }
export function think(state, map, bot, B) { const i = B.input; i.seq = ++B.seq; i.yaw = bot.yaw; return i; }
