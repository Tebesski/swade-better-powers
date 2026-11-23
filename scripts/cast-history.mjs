import {MODULE_ID} from "./constants.mjs";

export const MAINTAINED_CAST = "maintainedCast";
export const RESOLVED_BEHAVIORS = "resolvedPowerBehaviors";

const markers = new Map([MAINTAINED_CAST, RESOLVED_BEHAVIORS].map(flag => [flag, new Map()]));
const indexed = new Map();
let initialized = false;

function forget(message) {
  const flags = indexed.get(message.id);
  if (!flags) return;
  for (const [flag, castId] of flags) {
    const casts = markers.get(flag);
    const messages = casts.get(castId);
    messages.delete(message.id);
    if (!messages.size) casts.delete(castId);
  }
  indexed.delete(message.id);
}

function index(message) {
  forget(message);
  for (const [flag, casts] of markers) {
    const castId = message.getFlag(MODULE_ID, flag);
    if (!castId) continue;
    if (!casts.has(castId)) casts.set(castId, new Set());
    casts.get(castId).add(message.id);
    if (!indexed.has(message.id)) indexed.set(message.id, new Map());
    indexed.get(message.id).set(flag, castId);
  }
}

export function findCastMessage(flag, castId) {
  if (!initialized) {
    for (const message of game.messages) index(message);
    initialized = true;
  }
  for (const id of markers.get(flag).get(castId) ?? []) {
    const message = game.messages.get(id);
    if (message?.getFlag(MODULE_ID, flag) === castId) return message;
  }
}

export function installCastHistory() {
  const refresh = message => { if (initialized) index(message); };
  Hooks.on("createChatMessage", refresh);
  Hooks.on("updateChatMessage", refresh);
  Hooks.on("deleteChatMessage", forget);
}
