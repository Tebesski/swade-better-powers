import {DURATION_OPERATIONS, DURATION_UNITS, normalizePowerChanges} from "./durations.mjs";

const field = (key, label, type, value, options) => ({key, label, type, value, options});
const select = (key, label, value, options) => field(key, label, "select", value, options);
const units = Object.fromEntries(Object.keys(DURATION_UNITS).map(unit => [unit, unit]));

export const BEHAVIORS = {
  adjustDuration: {label: "Adjust Duration", fields: [
    select("operation", "Operation", "add", Object.fromEntries(DURATION_OPERATIONS.map(op => [op, op[0].toUpperCase() + op.slice(1)]))),
    field("amount", "Amount", "number", 1), select("unit", "Unit", "", {"": "Current unit", ...units})]},
  increaseDieType: {label: "Increase Die Type", fields: [
    select("scope", "Dice to increase", "base", {base: "Base Die Set", all: "All Dice"}), field("steps", "Die steps (up to d12)", "text", "1")]},
  addDamageDice: {label: "Add Damage Dice", fields: [field("formula", "Damage formula to add", "text", "1d6")]},
  chatMessage: {label: "Send Chat Message", fields: [field("text", "Message", "textarea", ""),
    select("rollMode", "Visibility", "inherit", {inherit: "Same as cast", publicroll: "Public Roll", gmroll: "Private GM Roll", blindroll: "Blind GM Roll", selfroll: "Self Roll"})]},
  removeEffect: {label: "Remove Effect", fields: [field("effect", "Effect name, UUID, status or flag", "effect", "")]},
  executeMacro: {label: "Execute Macro", code: true, fields: [field("macroUuid", "Macro UUID", "macro", "")]},
  executeScript: {label: "Execute Script", code: true, fields: [field("script", "Script", "textarea", "// Available: token, actor, item, message, roll, cast\n")]},
  addEffect: {label: "Add Effect", fields: [field("effectUuid", "Effect UUID", "effect", ""),
    field("duration.enabled", "Custom effect duration", "checkbox", false), field("duration.amount", "Effect duration amount", "number", 5),
    select("duration.unit", "Effect duration unit", "rounds", units)]}
};

const read = (system, key) => key.split(".").reduce((value, part) => value?.[part], system);
const write = (system, key, value) => {
  const [root, nested] = key.split(".");
  if (nested) (system[root] ??= {})[nested] = value;
  else system[root] = value;
};

export function behaviorSystem(type, readField) {
  const system = type === "adjustDuration" ? {scope: "power"} : {};
  for (const field of BEHAVIORS[type].fields) {
    let value = readField(field);
    if (field.type === "select" && !Object.hasOwn(field.options, value)) value = field.value;
    if (field.type === "number" && (!Number.isSafeInteger(value) || value < 0)) value = field.value;
    if (field.type === "checkbox") value = value === true;
    if (["text", "textarea", "effect", "macro"].includes(field.type)) value = typeof value === "string" ? value : field.value;
    write(system, field.key, value);
  }
  return system;
}

export function behaviorFieldValue(change, field) {
  const value = read(change.system, field.key) ?? field.value;
  return field.key === "steps" && typeof value === "number" ? String(value) : value;
}
export const isCodeBehavior = change => Boolean(Object.hasOwn(BEHAVIORS, change?.type) && BEHAVIORS[change.type].code);
export const isDamageBehavior = change => ["increaseDieType", "addDamageDice"].includes(change.type);
export const isActionBehavior = change => change.type !== "adjustDuration" && !isDamageBehavior(change);

export function normalizePowerBehaviors(changes) {
  return (Array.isArray(changes) ? changes : []).flatMap(change => {
    if (!Object.hasOwn(BEHAVIORS, change?.type)) return [];
    if (change.type === "adjustDuration") return normalizePowerChanges([change]);
    const system = behaviorSystem(change.type, field => behaviorFieldValue(change, field));
    if (change.type === "addEffect" && Array.isArray(change.system?.effects)) system.effects = change.system.effects;
    return [{id: change.id, type: change.type, enabled: change.enabled !== false,
      label: typeof change.label === "string" ? change.label : "", system}];
  });
}

export function selectedBehaviors({modifiers = [], raises = []}, earned, predicate) {
  const active = ({change}) => change.enabled && predicate(change);
  const raise = raises.findLast(raise => raise.level <= earned && (raise.active ?? raise.changes.some(({change}) => change.enabled)));
  return [...modifiers, ...(raise?.changes ?? [])].filter(active);
}
