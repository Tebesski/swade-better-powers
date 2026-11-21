import test from "node:test";
import assert from "node:assert/strict";
import {installMaintenance, powerDurationEnded} from "../scripts/maintenance.mjs";

test("maintenance waits for the caster's turn even when overdue or cast off-turn", () => {
  const caster = {}, other = {};
  const combat = {started: true, turn: 0, turns: [other, caster], getCombatantsByActor: () => [caster]};
  globalThis.game = {combat};
  for (const units of ["rounds", "minutes"]) for (const remaining of [0, -1]) {
    const effect = {actor: {}, start: {combat, combatant: "other"}, updateDuration: () => ({remaining, units})};
    combat.turn = 0;
    assert.equal(powerDurationEnded(effect), false);
    combat.turn = 1;
    assert.equal(powerDurationEnded(effect), true);
    combat.turn = null;
    assert.equal(powerDurationEnded(effect), false);
    combat.started = false;
    assert.equal(powerDurationEnded(effect), true);
    combat.started = true;
  }
});

test("cast effects wait for the maintenance decision and are removed with their timer", async () => {
  const id = "swade-better-powers";
  const hooks = new Map();
  class Effect {
    isExpiryEvent() { return true; }
    handleTurnExpirations() { return "expired"; }
  }
  class Actor { *allApplicableEffects() {} }
  globalThis.CONFIG = {ActiveEffect: {documentClass: Effect}, Actor: {documentClass: Actor}};
  globalThis.Hooks = {on: (name, callback) => hooks.set(name, callback)};
  const timer = {uuid: "Actor.caster.ActiveEffect.timer", flags: {[id]: {timedPower: {name: "Shield"}}}};
  let deleted = false;
  const linked = Object.assign(new Effect(), {
    flags: {[id]: {powerTimer: timer.uuid}}, delete: async () => { deleted = true; }
  });
  const unrelated = new Effect();
  globalThis.game = {actors: [{effects: [linked]}], scenes: new Map().values(), users: {activeGM: {isSelf: true}}};
  installMaintenance();
  assert.equal(linked.isExpiryEvent("updateWorldTime"), false);
  assert.equal(linked.handleTurnExpirations("end"), false);
  assert.equal(unrelated.isExpiryEvent("updateWorldTime"), true);
  hooks.get("deleteActiveEffect")(timer);
  assert.equal(deleted, true);
});
