import assert from "node:assert/strict";
import test from "node:test";
import {parseDuration, castSuccesses} from "../scripts/cast-results.mjs";
import {resolvePowerDuration} from "../scripts/durations.mjs";

test("modifier duration changes run before the highest applicable earned raise", () => {
  const adjustment = (operation, amount, unit = "") => ({enabled: true, system: {operation, amount, unit}});
  const changes = {modifiers: [adjustment("add", 2)], raises: [
    {level: 1, changes: [adjustment("subtract", 1)]},
    {level: 2, changes: []},
    {level: 3, changes: [adjustment("override", 1, "minutes"), adjustment("subtract", 1, "rounds")]}
  ]};
  assert.deepEqual(resolvePowerDuration({value: 2, units: "rounds"}, changes, 2), {value: 3, units: "rounds"});
  assert.deepEqual(resolvePowerDuration({value: 2, units: "rounds"}, changes, 3), {value: 54, units: "seconds"});
  assert.equal(resolvePowerDuration({value: 2, units: "rounds"}, {modifiers: [adjustment("subtract", 2)]}, 0), null);
});

test("positive durations use Foundry v14's native duration units", () => {
  for (const input of ["1", " 1 ROUND ", "1r", "1 rd", "1 rnd.", "1-round"]) {
    assert.deepEqual(parseDuration(input), {value: 1, units: "rounds"}, input);
  }
  for (const input of ["2m", "2 Mins.", "2 minutes", "2-minute"]) {
    assert.deepEqual(parseDuration(input), {value: 2, units: "minutes"}, input);
  }
  for (const input of ["3h", "3hrs", "3 hr.", "3 hours"]) {
    assert.deepEqual(parseDuration(input), {value: 3, units: "hours"}, input);
  }
  assert.deepEqual(parseDuration("1.5 minutes"), {value: 90, units: "seconds"});
  for (const input of ["0", "-2 rounds", "0.5h", "instant", "Special (2 hours)", "1d6 rounds", "2 days"]) {
    assert.equal(parseDuration(input), null, input);
  }
});

test("cast outcomes account for the target number and critical failure", () => {
  const message = (total, values) => ({flags: {}, rolls: [{total, terms: [], dice: values.map(total => ({total}))}]});
  assert.equal(castSuccesses(message(12, [5, 6]), {targetNumber: 8}), 2);
  assert.equal(castSuccesses(message(7, [5, 6]), {targetNumber: 8}), 0);
  assert.equal(castSuccesses(message(12, [1, 1]), {targetNumber: 4}), 0);
});
