import {t as sbsI18n} from "./i18n.mjs";
import {isBasicSwadePack} from "../../swade-better-setting/scripts/compendium-sources.mjs";
import {EFFECTS_ID} from "./constants.mjs";
import {isDurationTracker} from "./maintenance.mjs";

export function effectReference(doc) {
  return doc?.documentName === "ActiveEffect" || (doc?.documentName === "Item" && doc.effects?.size) ? doc.uuid : null;
}

export async function pickEffect() {
  const shared = game.modules.get(EFFECTS_ID)?.api?.pickEffect ?? game.modules.get("swade-better-templates")?.api?.pickEffect;
  if (shared) return (await shared())?.value;
  const options = document.createElement("select");
  options.name = sbsI18n("swade-better-powers.UI.reference_52367a6622");
  const addGroup = (name, entries) => {
    if (!entries.length) return;
    const group = document.createElement("optgroup");
    group.label = name;
    for (const [label, value] of entries) group.append(new Option(label, value));
    options.append(group);
  };
  const embedded = (doc, uuid = doc.uuid) => doc.type === `${EFFECTS_ID}.effect`
    ? [[doc.name, uuid]]
    : Array.from(doc.effects ?? []).filter(effect => !isDurationTracker(effect))
      .map(effect => [`${doc.name} · ${effect.name}`, effect.uuid ?? `${uuid}.ActiveEffect.${effect._id}`]);
  addGroup("Conditions", CONFIG.statusEffects.map(effect => [game.i18n.localize(effect.name), `status:${effect.id}`]));
  addGroup(sbsI18n("swade-better-powers.UI.WorldItems_bfe275cae4"), game.items.filter(item => item.visible).flatMap(item => embedded(item)));
  for (const actor of game.actors.filter(actor => actor.visible)) {
    addGroup(actor.name, [...embedded(actor), ...actor.items.flatMap(item => embedded(item))]);
  }
  const packs = game.packs.filter(pack => pack.documentName === "Item" && pack.visible && !isBasicSwadePack(pack));
  const results = await Promise.allSettled(packs.map(async pack => {
    const index = await pack.getIndex({fields: ["type", "effects"]});
    return [pack.title, index.contents.flatMap(doc => embedded(doc, pack.getUuid(doc._id)))];
  }));
  for (const result of results) if (result.status === "fulfilled") addGroup(...result.value);
  return foundry.applications.api.DialogV2.prompt({classes: ["sbp-dialog"], window: {title: sbsI18n("swade-better-powers.UI.Chooseaneffect_2e51d20c1d")}, content: options.outerHTML,
    ok: {label: sbsI18n("swade-better-powers.UI.Choose_c7f937836f"), callback: (_event, button) => button.form.elements.reference.value}, rejectClose: false});
}

export async function resolveReference(reference, user) {
  const effectClass = CONFIG.ActiveEffect.documentClass;
  if (reference.startsWith("status:")) return [await effectClass.fromStatusEffect(reference.slice(7))];
  const doc = await foundry.utils.fromUuid(reference);
  if (!effectReference(doc) || !doc.testUserPermission(user, "LIMITED")) throw new Error(sbsI18n("swade-better-powers.UI.Aconfiguredeffectismissingor_2d4aa57309"));
  return doc.documentName === "ActiveEffect" ? [doc] : [...doc.effects];
}

export function prepareEffect(data, {item, reference, start, duration = data.duration}) {
  const source = foundry.utils.deepClone(data);
  for (const key of ["_id", "_stats", "folder", "sort"]) delete source[key];
  if (reference && !reference.startsWith("status:")) {
    source.flags ??= {};
    source.flags[EFFECTS_ID] = {...source.flags[EFFECTS_ID], templateUuid: reference};
  }
  return {...source, transfer: false, origin: item.uuid, start, duration: {...duration, expired: false}};
}

export function effectBehaviorSources({effectUuid, duration, effects = []}) {
  const reference = effectUuid.trim();
  const override = duration.enabled ? {value: duration.amount, units: duration.unit} : undefined;
  return [...(reference ? [{reference}] : []), ...effects.map(data => ({data}))]
    .map(source => ({...source, duration: override, enable: true}));
}

export async function prepareEffectSources(sources, {item, user}) {
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  const batches = await Promise.all(sources.map(async ({reference, data, duration, enable}) => {
    const effects = reference ? (await resolveReference(reference, user)).map(effect => effect.toObject()) : [data];
    return effects.map(effect => ({...prepareEffect(effect, {item, reference, start, duration}), ...(enable ? {disabled: false} : {})}));
  }));
  return batches.flat();
}
