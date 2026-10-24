import { bedroom } from "./bedroom.js";

/**
 * PAPER PLANES: every room, by id. A room on the wire is only its id; each side loads the same file.
 * @module game/rooms
 */
export const ROOMS = Object.freeze({ bedroom });
export const ROOM_IDS = Object.freeze(Object.keys(ROOMS));
