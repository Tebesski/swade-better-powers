import assert from "node:assert/strict";
import {test} from "node:test";
import {castEffectTargetUuids} from "../scripts/effect-targets.mjs";

test("effect controls use recorded native targets and never selected canvas tokens", () => {
  const message = {flags: {}, getFlag: (scope, key) => scope === "swade" && key === "targets" ? [{uuid: "Bao"}, {uuid: "Aputik"}, {uuid: "Bao"}] : null};
  assert.deepEqual(castEffectTargetUuids(message), ["Bao", "Aputik"]);
  assert.deepEqual(castEffectTargetUuids({flags: {}, getFlag: () => null}), []);
});
test("Tools targets resolve on the original scene, with stale tokens ignored", () => {
  const scene = {tokens: new Map([["a", {uuid: "Scene.original.Token.a"}], ["b", {uuid: "Scene.original.Token.b"}]])};
  const message = {flags: {"swade-tools": {usetarget: "a,b,a,deleted"}}, getFlag: () => [{uuid: "unrelated"}]};
  assert.deepEqual(castEffectTargetUuids(message, scene), ["Scene.original.Token.a", "Scene.original.Token.b"]);
});
test("effect context snapshots support cards without native or Tools target flags", () => {
  const message = {flags: {}, getFlag: scope => scope === "swade" ? [] : {targetUuids: ["caster"]}};
  assert.deepEqual(castEffectTargetUuids(message), ["caster"]);
});
