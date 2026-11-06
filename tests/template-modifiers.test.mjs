import test from "node:test";
import assert from "node:assert/strict";
import {reconcileTemplateModifiers, reconcileTemplateRaises} from "../scripts/template-modifiers.mjs";

test("a shared raise retains its template behaviors when the power editor changes its level", () => {
  const power = {id: "duration", type: "adjustDuration", enabled: true, label: "",
    system: {scope: "power", operation: "add", amount: 2, unit: "rounds"}};
  const template = {...power, id: "region-duration", system: {...power.system, scope: "template"}};
  const result = reconcileTemplateRaises([{id: "shared", level: 2, changes: [power]}],
    [{id: "shared", level: 1, mode: "replace", changes: [template]}]);
  assert.deepEqual(result.setting, [{id: "shared", level: 2, changes: [power]}]);
  assert.deepEqual(result.templates, [{id: "shared", level: 2, mode: "replace", changes: [template, power]}]);
});

test("older modifiers with one matching name share the template ID and retain automation", () => {
  const changes = [{target: "template", field: "size", operation: "set", value: 4}];
  const shared = {name: "Area Protection", description: "<p>Protect allies.</p>", options: [{id: "mbt", label: "MBT", cost: 3}, {id: "lbt", label: "LBT", cost: 4}]};
  const result = reconcileTemplateModifiers([{id: "old-setting", ...shared}], [{id: "old-template", name: "area protection", changes}]);
  assert.deepEqual(result.setting, [{id: "old-template", ...shared}]);
  assert.deepEqual(result.templates, [{id: "old-template", ...shared, changes}]);
  assert.deepEqual(reconcileTemplateModifiers(result.setting, result.templates), result);
});

test("template edits replace shared rules data without merging unrelated modifiers with the same name", () => {
  const option = {id: "base", label: "", cost: 0};
  const setting = [{id: "a", name: "Widen", description: "Original text", options: [option]}, {id: "b", name: "Widen", options: [option]}];
  const templates = [{id: "a", name: "Widen", description: "", options: [{...option, cost: -1}], changes: []}, {id: "c", name: "Widen", changes: []}];
  const result = reconcileTemplateModifiers(setting, templates, "templates");
  assert.deepEqual(result.setting.map(row => row.id), ["a", "b", "c"]);
  assert.deepEqual(result.templates.map(row => row.id), ["a", "c", "b"]);
  assert.equal(result.setting[0].description, "");
  assert.equal(result.setting[0].options[0].cost, -1);
  assert.deepEqual(result.setting[2].options, [option]);
});

test("editing prices in Better Powers keeps the distinct behaviors of each change option", () => {
  const light = [{type: "attachLight"}], sound = [{type: "attachSound"}];
  const templates = [{id: "power", name: "Area", options: [
    {id: "base", label: "Light", cost: 1, changes: light}, {id: "extra", label: "Sound", cost: 2, changes: sound}
  ]}];
  const setting = [{id: "power", name: "Area", options: [{id: "extra", label: "Sound", cost: 4}, {id: "base", label: "Light", cost: 1}]}];
  const result = reconcileTemplateModifiers(setting, templates);
  assert.deepEqual(result.setting[0].options, setting[0].options);
  assert.deepEqual(result.templates[0].options, [{...setting[0].options[0], changes: sound}, {...setting[0].options[1], changes: light}]);
});
