import assert from "node:assert/strict";
import test from "node:test";
import {findCastMessage, installCastHistory, MAINTAINED_CAST, RESOLVED_BEHAVIORS} from "../scripts/cast-history.mjs";

test("cast history indexes existing markers once and follows message changes", () => {
  let scans = 0;
  class ChatLog extends Map {
    [Symbol.iterator]() { scans++; return this.values(); }
  }
  const message = (id, flags = {}) => ({id, flags, getFlag: (_scope, key) => flags[key]});
  const old = message("old", {[MAINTAINED_CAST]: "cast", [RESOLVED_BEHAVIORS]: "cast"});
  const copy = message("copy", {[MAINTAINED_CAST]: "cast"});
  const messages = new ChatLog([[old.id, old], [copy.id, copy]]);
  const hooks = new Map();
  globalThis.game = {messages};
  globalThis.Hooks = {on: (event, callback) => hooks.set(event, callback)};
  installCastHistory();

  assert.equal(findCastMessage(MAINTAINED_CAST, "cast"), old);
  assert.equal(findCastMessage(RESOLVED_BEHAVIORS, "cast"), old);
  messages.delete(old.id);
  hooks.get("deleteChatMessage")(old);
  assert.equal(findCastMessage(MAINTAINED_CAST, "cast"), copy);
  assert.equal(findCastMessage(RESOLVED_BEHAVIORS, "cast"), undefined);

  const fresh = message("fresh");
  messages.set(fresh.id, fresh);
  hooks.get("createChatMessage")(fresh);
  fresh.flags[RESOLVED_BEHAVIORS] = "cast";
  hooks.get("updateChatMessage")(fresh);
  assert.equal(findCastMessage(RESOLVED_BEHAVIORS, "cast"), fresh);
  delete fresh.flags[RESOLVED_BEHAVIORS];
  hooks.get("updateChatMessage")(fresh);
  assert.equal(findCastMessage(RESOLVED_BEHAVIORS, "cast"), undefined);
  assert.equal(scans, 1);
});
