import {readPowerFlag, MODULE_ID, normalizeName} from "./constants.mjs";
import {normalizeModifiers, normalizePowerRaises} from "./powers-data.mjs";
import {normalizePowerChanges} from "./durations.mjs";

export const TEMPLATES_ID = "swade-better-templates";
export const POWER_MODIFIERS = `flags.${MODULE_ID}.powerModifiers`;
export const POWER_RAISES = `flags.${MODULE_ID}.powerRaises`;
const AUTOMATION = `flags.${TEMPLATES_ID}.automation`;
const TEMPLATE_MODIFIERS = `${AUTOMATION}.modifiers`;
const TEMPLATE_RAISES = `${AUTOMATION}.raises`;
const enabled = () => game.modules.get(TEMPLATES_ID)?.active;

const list = value => Array.isArray(value) ? value.filter(row => row && typeof row.id === "string" && row.id) : [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPowerChange = change => change?.type === "adjustDuration" && change.system?.scope === "power";

function sharedChanges(power, template, source) {
  const fromTemplate = normalizePowerChanges(template);
  let changes = power ?? fromTemplate;
  if (source === "templates" && Array.isArray(template) && !same(normalizePowerChanges(power), fromTemplate)) {
    changes = [...(power ?? []).filter(change => !isPowerChange(change)), ...fromTemplate];
  }
  return changes.length || Array.isArray(power) ? changes : undefined;
}

function templateChanges(existing, power) {
  const duration = normalizePowerChanges(power);
  if (power === undefined || same(normalizePowerChanges(existing), duration)) return existing;
  return [...(existing ?? []).filter(change => !isPowerChange(change)), ...duration];
}

// Keep one ID per modifier across both editors and preserve the order of template changes.
export function reconcileTemplateModifiers(setting, templates, source = "setting") {
  setting = normalizeModifiers(list(setting));
  templates = list(templates);
  const paired = new Map();
  const matched = new Set();
  const templatesById = new Map(templates.map(row => [row.id, row]));
  for (const row of setting) {
    const template = templatesById.get(row.id);
    if (template) {paired.set(row, template); matched.add(template);}
  }
  // Older documents may already have independently created versions of a modifier.
  for (const row of setting) {
    if (paired.has(row)) continue;
    const name = normalizeName(row.name);
    if (!name || setting.filter(candidate => normalizeName(candidate.name) === name).length !== 1) continue;
    const candidates = templates.filter(candidate => normalizeName(candidate.name) === name);
    if (candidates.length === 1 && !matched.has(candidates[0])) {
      paired.set(row, candidates[0]); matched.add(candidates[0]);
    }
  }
  const settingRows = [];
  const projected = new Map();
  const templateAdditions = [];
  function add(row, template) {
    const [preferred, fallback] = source === "templates" ? [template, row] : [row, template];
    const name = [preferred?.name, fallback?.name].find(value => typeof value === "string" && value.trim())?.trim() ?? "New modifier";
    const rawDescription = [preferred?.description, fallback?.description].find(value => typeof value === "string") ?? "";
    const description = globalThis.foundry?.utils?.cleanHTML?.(rawDescription) ?? rawDescription;
    const options = [preferred?.options, fallback?.options].map(list).find(rows => rows.length) ?? [{id: "base", label: "", cost: 0}];
    const powerOptions = new Map(list(row?.options).map(option => [option.id, option]));
    const templateOptions = new Map(list(template?.options).map(option => [option.id, option]));
    const shared = {id: template?.id ?? row.id, name, description, options: options.map(option => {
      const changes = sharedChanges(powerOptions.get(option.id)?.changes, templateOptions.get(option.id)?.changes, source);
      return {id: option.id, label: typeof option.label === "string" ? option.label : "",
        cost: Number.isFinite(Number(option.cost)) ? Number(option.cost) : 0, ...(changes === undefined ? {} : {changes})};
    })};
    settingRows.push(shared);
    if (template) {
      projected.set(template, {...template, ...shared, options: shared.options.map(({changes: power, ...option}) => {
        const changes = templateChanges(templateOptions.get(option.id)?.changes, power);
        return Array.isArray(changes) ? {...option, changes} : option;
      })});
    } else templateAdditions.push({...shared, options: shared.options.map(option => ({...option, changes: normalizePowerChanges(option.changes)}))});
  }
  for (const row of setting) add(row, paired.get(row));
  for (const template of templates) if (!matched.has(template)) add(null, template);
  return {setting: settingRows, templates: [...templates.map(row => projected.get(row)), ...templateAdditions]};
}

export function reconcileTemplateRaises(power, templates, source = "setting") {
  const templateRows = templates.filter(raise => Number.isSafeInteger(raise?.level) && raise.level > 0)
    .map(raise => ({...raise, id: raise.id ?? `raise-${raise.level}`}));
  const matched = new Set();
  const setting = [];
  const projected = [];
  function add(row, template) {
    const preferred = source === "templates" ? template ?? row : row ?? template;
    const {id, level} = preferred;
    const changes = sharedChanges(row?.changes, template?.changes, source) ?? [];
    setting.push({id, level, changes});
    projected.push({id, level, mode: template?.mode ?? "auto", changes: templateChanges(template?.changes, changes) ?? []});
  }
  for (const row of normalizePowerRaises(power)) {
    const template = templateRows.find(raise => !matched.has(raise) && raise.id === row.id)
      ?? templateRows.find(raise => !matched.has(raise) && raise.level === row.level);
    if (template) matched.add(template);
    add(row, template);
  }
  for (const template of templateRows) if (!matched.has(template)) add(null, template);
  setting.sort((a, b) => a.level - b.level);
  projected.sort((a, b) => a.level - b.level);
  return {setting, templates: projected};
}

export function templateModifierPatch(item, update = {}) {
  if (item.type !== "power" || !enabled()) return null;
  const get = path => foundry.utils.getProperty(update, path);
  const oldSetting = list(readPowerFlag(item, "powerModifiers"));
  const automation = item.getFlag(TEMPLATES_ID, "automation");
  const oldTemplates = list(automation?.modifiers);
  const nextSetting = get(POWER_MODIFIERS);
  const nextTemplates = get(TEMPLATE_MODIFIERS);
  const settingChanged = Array.isArray(nextSetting);
  const templatesChanged = Array.isArray(nextTemplates);
  const source = templatesChanged && !settingChanged ? "templates" : "setting";
  let setting = settingChanged ? list(nextSetting) : oldSetting;
  let templates = templatesChanged ? list(nextTemplates) : oldTemplates;
  // Only remove records that were already linked. Preserve anything created independently.
  if (settingChanged && !templatesChanged) {
    const removed = new Set(oldSetting.filter(row => !setting.some(next => next.id === row.id)).map(row => row.id));
    templates = templates.filter(row => !removed.has(row.id));
  } else if (templatesChanged && !settingChanged) {
    const removed = new Set(oldTemplates.filter(row => !templates.some(next => next.id === row.id)).map(row => row.id));
    setting = setting.filter(row => !removed.has(row.id));
  }
  const synced = reconcileTemplateModifiers(setting, templates, source);
  const patch = {};
  if ((settingChanged || templatesChanged || oldSetting.length || oldTemplates.length)) {
    if (!same(synced.setting, settingChanged ? nextSetting : oldSetting)) patch[POWER_MODIFIERS] = synced.setting;
    if (!same(synced.templates, templatesChanged ? nextTemplates : oldTemplates)) patch[TEMPLATE_MODIFIERS] = synced.templates;
  }
  const oldPowerRaiseFlag = readPowerFlag(item, "powerRaises");
  const oldPowerRaises = normalizePowerRaises(oldPowerRaiseFlag);
  const oldTemplateRaises = Array.isArray(automation?.raises) ? automation.raises : [];
  const nextPowerRaises = get(POWER_RAISES);
  const nextTemplateRaises = get(TEMPLATE_RAISES);
  const powerRaisesChanged = Array.isArray(nextPowerRaises);
  const templateRaisesChanged = Array.isArray(nextTemplateRaises);
  if (powerRaisesChanged || templateRaisesChanged || oldPowerRaises.length || oldTemplateRaises.length) {
    let power = powerRaisesChanged ? normalizePowerRaises(nextPowerRaises) : oldPowerRaises;
    let template = templateRaisesChanged ? nextTemplateRaises : oldTemplateRaises;
    const key = row => row.id ?? `raise-${row.level}`;
    if (powerRaisesChanged && !templateRaisesChanged) {
      const removed = oldPowerRaises.filter(raise => !power.some(next => key(next) === key(raise)));
      template = template.filter(raise => !removed.some(old => key(old) === key(raise) || old.level === raise.level));
    } else if (templateRaisesChanged && !powerRaisesChanged) {
      const removed = oldTemplateRaises.filter(raise => !template.some(next => key(next) === key(raise)));
      power = power.filter(raise => !removed.some(old => key(old) === key(raise) || old.level === raise.level));
    }
    const shared = reconcileTemplateRaises(power, template, templateRaisesChanged && !powerRaisesChanged ? "templates" : "setting");
    if (!same(shared.setting, powerRaisesChanged ? nextPowerRaises : oldPowerRaiseFlag ?? [])) patch[POWER_RAISES] = shared.setting;
    if (!same(shared.templates, templateRaisesChanged ? nextTemplateRaises : oldTemplateRaises)) patch[TEMPLATE_RAISES] = shared.templates;
  }
  // Copying rules text and cost options alone must not turn on region automation.
  if (!automation && !get(AUTOMATION) && (patch[TEMPLATE_MODIFIERS] || patch[TEMPLATE_RAISES])) {
    patch[`${AUTOMATION}.enabled`] = false;
  }
  return Object.keys(patch).length ? patch : null;
}

export function syncTemplateModifierUpdate(item, changed) {
  if (!enabled()) return;
  const update = foundry.utils.expandObject(changed);
  if (![POWER_MODIFIERS, TEMPLATE_MODIFIERS, POWER_RAISES, TEMPLATE_RAISES]
    .some(path => Array.isArray(foundry.utils.getProperty(update, path)))) return;
  const patch = templateModifierPatch(item, update);
  if (!patch) return;
  for (const [path, value] of Object.entries(patch)) foundry.utils.setProperty(update, path, value);
  for (const key of Object.keys(changed)) delete changed[key];
  Object.assign(changed, update);
}

export async function initializeTemplateModifiers() {
  if (!enabled() || game.users.activeGM?.id !== game.user.id) return;
  const updatesFor = items => items.flatMap(item => {
    const patch = templateModifierPatch(item);
    return patch ? [{_id: item.id, ...patch}] : [];
  });
  const world = updatesFor(game.items.contents);
  if (world.length) await Item.updateDocuments(world);
  for (const actor of game.actors) {
    const updates = updatesFor(actor.itemTypes.power ?? []);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
}
