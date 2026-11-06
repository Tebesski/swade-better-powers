import test from "node:test";
import assert from "node:assert/strict";
import {castingPenalty, powerPointBreakdown, parseArcaneSkill, modifierCostLabel, normalizeModifiers, validateModifiers, modifierSummary, spellcastingEntries, usesNoPowerPoints} from "../scripts/powers-data.mjs";
import {MODULE_ID, powerData} from "../scripts/constants.mjs";

test("Arcane Background parser accepts formatting, UUID labels, and multiword skills", () => {
  assert.deepEqual(parseArcaneSkill('<p><strong>Arcane Skill:</strong> @UUID[Compendium.example.skills.Item.abc]{Weird Science} (Smarts)</p><p>Power Points: 10</p>'), {name: "Weird Science", attribute: "Smarts"});
  assert.deepEqual(parseArcaneSkill('<p>Arcane Skill: Faith (Spirit)</p>'), {name: "Faith", attribute: "Spirit"});
  assert.equal(parseArcaneSkill("<p>A background without skill information.</p>"), null);
});
test("No Power Points rounds up, clamps negative costs, and applies maintenance", () => {
  assert.equal(castingPenalty(1), -1);
  assert.equal(castingPenalty(3), -2);
  assert.equal(castingPenalty(4, 2), -4);
  assert.equal(castingPenalty(3, 1), -3);
  assert.equal(castingPenalty(-4), -0);
});
test("compact modifiers have named fixed-cost options and the requested summary", () => {
  const modifier = {name: "Area Protection", description: "You can extend protection.", options: [{id: "mbt", label: "MBT", cost: 3}, {id: "lbt", label: "LBT", cost: 4}]};
  assert.equal(modifierCostLabel(modifier.options[0]), "+3");
  assert.equal(modifierCostLabel({cost: -2}), "-2");
  assert.equal(modifierCostLabel({cost: 0}), "0");
  assert.ok(modifierSummary([modifier]).includes("<strong>Area Protection (+3 / +4):</strong>"));
  assert.match(modifierSummary([{...modifier, description: "<p><em>Extend</em> protection.</p><p>More details.</p>"}]), /<hr><h3>Modifiers<\/h3><ul><li><strong>Area Protection \(\+3 \/ \+4\):<\/strong> <em>Extend<\/em> protection\.<p>More details\.<\/p><\/li>/);
  assert.equal(validateModifiers([modifier]).length, 1);
  assert.throws(() => validateModifiers([{...modifier, options: [{cost: NaN}]}]), /numeric/i);
});
test("legacy ranges migrate to fixed options without a saved casting choice", () => {
  const [modifier] = normalizeModifiers([{id: "area", name: "Area", selected: "old", cost: 4, options: [{id: "old", label: "Area", min: 3, max: 4}]}]);
  assert.deepEqual(modifier.options.map(option => option.cost), [3, 4]);
  assert.equal(modifier.selected, undefined);
  assert.equal(modifier.cost, undefined);
});
test("casting breakdown retains power, chosen options, manual adjustments and round-up calculation", () => {
  const choices = [{name: "Area Protection — MBT", cost: 3}, {name: "Limitation", cost: -1}];
  const result = powerPointBreakdown("Protection", 1, choices, 5);
  assert.deepEqual(result.costs, [{name: "Protection", cost: 1}, ...choices, {name: "Additional Power Points", cost: 2}]);
  assert.equal(result.penalty, -3);
  assert.equal(result.formula, "(1 PP + 3 PP - 1 PP + 2 PP) / 2 = -3");
  const reduced = powerPointBreakdown("Protection", 1, [{name: "Limitation", cost: -4}]);
  assert.equal(reduced.total, 0);
  assert.equal(reduced.formula, "max(0, (1 PP - 4 PP)) / 2 = 0");
});
test("spellcasting entries stay visible without powers and per-entry overrides honor false", () => {
  const actor = {getFlag: () => ({magic: {id: "magic", name: "Magic", arcane: "Magic", trait: "Spellcasting", noPowerPoints: false}}), itemTypes: {power: []}};
  assert.equal(spellcastingEntries(actor).length, 2);
  const power = {actor, system: {arcane: "Magic"}};
  assert.equal(usesNoPowerPoints(power, true), false);
  assert.equal(usesNoPowerPoints({actor, system: {arcane: ""}}, true), true);
});
test("power compendium copies retain modifier definitions without copying active maintenance", () => {
  const source = {_id: "source", type: "power", name: "Bolt", flags: {[MODULE_ID]: {powerModifiers: [{id: "damage", name: "Damage"}], maintained: true}}, system: {pp: 1}};
  const copy = powerData(source);
  assert.equal(copy._id, undefined);
  assert.equal(copy.flags[MODULE_ID].powerModifiers[0].name, "Damage");
  assert.equal(copy.flags[MODULE_ID].maintained, undefined);
  assert.equal(source.flags[MODULE_ID].maintained, true);
});
