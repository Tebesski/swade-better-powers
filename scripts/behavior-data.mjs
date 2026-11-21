import {t as sbsI18n} from "./i18n.mjs";
import {DURATION_OPERATIONS, DURATION_UNITS, normalizePowerChanges} from "./durations.mjs";

const field = (key, label, type, value, options) => ({key, label, type, value, options});
const select = (key, label, value, options) => field(key, label, sbsI18n("swade-better-powers.UI.select_b1a36d25d9"), value, options);
const units = Object.fromEntries(Object.keys(DURATION_UNITS).map(unit => [unit, unit]));
export const EFFECT_MODES = {get add() { return sbsI18n("swade-better-powers.UI.Combinewithbaseeffects_dbc0726e66"); }, get replace() { return sbsI18n("swade-better-powers.UI.Replacebaseeffects_58c724701d"); }};

export const BEHAVIORS = {
  adjustDuration: {get label() { return sbsI18n("swade-better-powers.UI.AdjustDuration_583b9b5f41"); }, fields: [
    select("operation", sbsI18n("swade-better-powers.UI.Operation_0f044feb6c"), sbsI18n("swade-better-powers.UI.add_7e9e5ac30f"), Object.fromEntries(DURATION_OPERATIONS.map(op => [op, op[0].toUpperCase() + op.slice(1)]))),
    field("amount", sbsI18n("swade-better-powers.UI.Amount_49e96d7cdf"), sbsI18n("swade-better-powers.UI.number_12886f9d00"), 1), select("unit", sbsI18n("swade-better-powers.UI.Unit_4e545960f1"), "", {get ""() { return sbsI18n("swade-better-powers.UI.Currentunit_104a1f56b2"); }, ...units})]},
  increaseDieType: {get label() { return sbsI18n("swade-better-powers.UI.IncreaseDieType_26ecc75f97"); }, fields: [
    select("scope", sbsI18n("swade-better-powers.UI.Dicetoincrease_14e29d3778"), sbsI18n("swade-better-powers.UI.base_cae662172f"), {get base() { return sbsI18n("swade-better-powers.UI.BaseDieSet_bc51a3ffda"); }, get all() { return sbsI18n("swade-better-powers.UI.AllDice_c8852eda01"); }}), field("steps", sbsI18n("swade-better-powers.UI.Diesteps_ac5dd9b5e3"), sbsI18n("swade-better-powers.UI.text_982d9e3eb9"), "1"),
    field("flatOverflow", sbsI18n("swade-better-powers.UI.Addflatmodifierifdieincreases_60ab9c5148"), sbsI18n("swade-better-powers.UI.checkbox_6fe9eb8f46"), false)]},
  addDamageDice: {get label() { return sbsI18n("swade-better-powers.UI.AddDamageDice_73624e9689"); }, fields: [field("formula", sbsI18n("swade-better-powers.UI.Damageformulatoadd_33750a322d"), sbsI18n("swade-better-powers.UI.text_982d9e3eb9"), sbsI18n("swade-better-powers.UI.1d6_44868e6ec0"))]},
  chatMessage: {get label() { return sbsI18n("swade-better-powers.UI.SendChatMessage_78605c4cd0"); }, fields: [field("text", sbsI18n("swade-better-powers.UI.Message_2f77668a9d"), sbsI18n("swade-better-powers.UI.textarea_ee67f93d65"), ""),
    select("rollMode", sbsI18n("swade-better-powers.UI.Visibility_7448611d5f"), sbsI18n("swade-better-powers.UI.inherit_035300f3af"), {get inherit() { return sbsI18n("swade-better-powers.UI.Sameascast_b0c9c0b69f"); }, get publicroll() { return sbsI18n("swade-better-powers.UI.PublicRoll_710f31bd8c"); }, get gmroll() { return sbsI18n("swade-better-powers.UI.PrivateGMRoll_f1e976c2a6"); }, get blindroll() { return sbsI18n("swade-better-powers.UI.BlindGMRoll_c2cdd610b7"); }, get selfroll() { return sbsI18n("swade-better-powers.UI.SelfRoll_cca9d293b6"); }})]},
  removeEffect: {get label() { return sbsI18n("swade-better-powers.UI.RemoveEffect_cb1db795a7"); }, fields: [field("effect", sbsI18n("swade-better-powers.UI.EffectnameUUIDstatusorflag_6e36070cf1"), sbsI18n("swade-better-powers.UI.effect_dcb576426a"), "")]},
  executeMacro: {get label() { return sbsI18n("swade-better-powers.UI.ExecuteMacro_d3d8ff34d0"); }, code: true, fields: [field("macroUuid", sbsI18n("swade-better-powers.UI.MacroUUID_2c8e908655"), sbsI18n("swade-better-powers.UI.macro_27d66c0dce"), "")]},
  executeScript: {get label() { return sbsI18n("swade-better-powers.UI.ExecuteScript_98025a5b1a"); }, code: true, fields: [field("script", sbsI18n("swade-better-powers.UI.Script_102acc10e6"), sbsI18n("swade-better-powers.UI.textarea_ee67f93d65"), sbsI18n("swade-better-powers.UI.Availabletokenactoritemmessageroll_b4428a7433"))]},
  addEffect: {get label() { return sbsI18n("swade-better-powers.UI.AddEffect_86e0214437"); }, fields: [field("effectUuid", sbsI18n("swade-better-powers.UI.EffectUUID_8eb7fd794c"), sbsI18n("swade-better-powers.UI.effect_dcb576426a"), ""),
    select("application", sbsI18n("swade-better-powers.UI.Applyeffect_4b92049abb"), sbsI18n("swade-better-powers.UI.caster_8bdbbbd8f7"), {get caster() { return sbsI18n("swade-better-powers.UI.Oncastcaster_fdbe37aec3"); }, get chat() { return sbsI18n("swade-better-powers.UI.ApplyEffectbuttontargetorselected_eb3149cfec"); }}),
    select("mode", sbsI18n("swade-better-powers.UI.BaseeffectsApplyEffectbutton_db86750a0e"), sbsI18n("swade-better-powers.UI.add_7e9e5ac30f"), EFFECT_MODES),
    field("duration.enabled", sbsI18n("swade-better-powers.UI.Customeffectduration_9f2f033a5a"), sbsI18n("swade-better-powers.UI.checkbox_6fe9eb8f46"), false), field("duration.amount", sbsI18n("swade-better-powers.UI.Effectdurationamount_e0bad26ca2"), sbsI18n("swade-better-powers.UI.number_12886f9d00"), 5),
    select("duration.unit", sbsI18n("swade-better-powers.UI.Effectdurationunit_da67bb8e12"), sbsI18n("swade-better-powers.UI.rounds_206cd5ee00"), units)]}
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
export const isDamageBehavior = change => [sbsI18n("swade-better-powers.UI.increaseDieType_bfa98af90c"), sbsI18n("swade-better-powers.UI.addDamageDice_83050ac532")].includes(change.type);
export const isChatEffect = change => change.type === "addEffect" && change.system.application === "chat";
export const isActionBehavior = change => change.type !== "adjustDuration" && !isDamageBehavior(change) && !isChatEffect(change);

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
