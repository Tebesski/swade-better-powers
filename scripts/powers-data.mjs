import {t as sbsI18n} from "./i18n.mjs";
import {readPowerFlag, normalizeName} from "./constants.mjs";
import {normalizePowerBehaviors} from "./behavior-data.mjs";
import {normalizePowerChanges} from "./durations.mjs";

export const GENERAL = "general";
export const entryArcane = entry => entry.arcane === GENERAL ? "" : entry.arcane;
export const powerArcane = power => power.system?.arcane?.trim() || GENERAL;
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

export function parseArcaneSkill(description) {
  const text = String(description ?? "").replace(/@(?:UUID|Compendium)\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&");
  const match = text.match(/Arcane\s+Skill\s*:\s*([^\n(:]+?)\s*(?:\(([^)]+)\))?\s*(?=\n|$)/i);
  return match ? {name: match[1].trim().replace(/\.$/, ""), attribute: match[2]?.trim() ?? ""} : null;
}

export function spellcastingEntries(actor) {
  const stored = Object.values(readPowerFlag(actor, "spellcastingEntries") ?? {});
  const general = {id: GENERAL, name: sbsI18n("swade-better-powers.UI.General_c910d474dc"), arcane: GENERAL, trait: "", ...stored.find(e => e.arcane === GENERAL)};
  const entries = stored.filter(entry => entry.arcane !== GENERAL).map(entry => ({...entry}));
  if (readPowerFlag(actor, "generalSpellcastingRemoved") !== true) entries.unshift(general);
  const known = new Set(entries.map(entry => normalizeName(entry.arcane)));
  for (const power of actor.itemTypes?.power ?? []) {
    const arcane = powerArcane(power);
    const key = normalizeName(arcane);
    if (known.has(key)) continue;
    known.add(key);
    if (key === GENERAL) entries.unshift(general);
    else entries.push({id: `existing-${power.id}`, arcane, name: arcane, trait: power.system.actions?.trait ?? ""});
  }
  return entries.length ? entries : [general];
}
export function entryForPower(power) {
  if (!power.actor) return null;
  const key = normalizeName(powerArcane(power));
  return spellcastingEntries(power.actor).find(e => normalizeName(e.arcane) === key);
}
export function usesNoPowerPoints(power, worldDefault = false) {
  const entry = entryForPower(power);
  return entry?.noPowerPoints ?? worldDefault;
}
export const noPP = power => power?.type === "power" && usesNoPowerPoints(power, game.settings.get("swade", "noPowerPoints"));

// Batch callers use the same entry lookup for every power on this actor.
export function noPPForActor(actor) {
  const worldNoPP = game.settings.get("swade", "noPowerPoints");
  const byArcane = new Map();
  for (const entry of spellcastingEntries(actor)) {
    const key = normalizeName(entry.arcane);
    if (!byArcane.has(key)) byArcane.set(key, entry.noPowerPoints ?? worldNoPP);
  }
  return power => byArcane.get(normalizeName(powerArcane(power))) ?? worldNoPP;
}
export function castingPenalty(cost, maintained = 0) {
  const penalty = Math.ceil(Math.max(0, Number(cost) || 0) / 2) + Math.max(0, Number(maintained) || 0);
  return -penalty;
}
export function powerPointBreakdown(name, baseCost, choices = [], totalCost = Number(baseCost) + choices.reduce((sum, choice) => sum + choice.cost, 0)) {
  const costs = [{name, cost: Number(baseCost)}, ...choices.map(choice => ({name: choice.name, cost: Number(choice.cost)}))];
  const adjustment = totalCost - costs.reduce((sum, choice) => sum + choice.cost, 0);
  if (adjustment) costs.push({name: sbsI18n("swade-better-powers.UI.AdditionalPowerPoints_97510a5219"), cost: adjustment});
  const total = Math.max(0, totalCost);
  const terms = costs.map((choice, index) => index ? `${choice.cost < 0 ? "-" : "+"} ${Math.abs(choice.cost)} PP` : `${choice.cost} PP`).join(" ");
  const expression = totalCost < 0 ? `max(0, (${terms}))` : `(${terms})`;
  return {costs, total, penalty: castingPenalty(total), formula: `${expression} / 2 = ${castingPenalty(total) || 0}`};
}
export function modifierCostLabel(option, noPP = false) {
  const signed = value => {
    const cost = Number(value) || 0;
    const display = noPP ? -Math.ceil(cost / 2) : cost;
    return display > 0 ? `+${display}` : String(display);
  };
  if (option.cost !== undefined) return signed(option.cost);
  return Number(option.min) === Number(option.max) ? signed(option.min) : `${signed(option.min)} to ${signed(option.max)}`;
}
export function normalizeModifiers(modifiers = []) {
  return modifiers.map(modifier => ({id: modifier.id, name: modifier.name, description: modifier.description ?? "", options: (modifier.options ?? []).flatMap(option => {
    if (option.cost !== undefined) return [{id: option.id, label: option.label ?? "", cost: Number(option.cost),
      ...(Array.isArray(option.changes) ? {changes: normalizePowerBehaviors(option.changes)} : {})}];
    const first = {id: option.id, label: option.label ?? "", cost: Number(option.min) || 0};
    return Number(option.min) === Number(option.max) ? [first] : [first, {id: `${option.id}-max`, label: option.label ?? "", cost: Number(option.max) || 0}];
  })}));
}

export const getLocalModifiers = item => normalizeModifiers(readPowerFlag(item, "powerModifiers") ?? []);

export function getGlobalModifiers(item, local = getLocalModifiers(item)) {
  const setting = globalThis.game?.modules?.get?.("swade-better-setting");
  return normalizeModifiers(setting?.active ? setting.api?.getGlobalModifiers?.(item, "powers", local) ?? [] : []);
}

export function getModifiers(item) {
  const local = getLocalModifiers(item);
  return [...local, ...getGlobalModifiers(item, local)];
}

export function normalizePowerRaises(raises) {
  const levels = new Set();
  return (Array.isArray(raises) ? raises : []).flatMap(raise => {
    if (!Number.isSafeInteger(raise?.level) || raise.level < 1 || levels.has(raise.level)) return [];
    levels.add(raise.level);
    return [{id: typeof raise.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(raise.id) ? raise.id : `raise-${raise.level}`,
      level: raise.level, changes: normalizePowerBehaviors(raise.changes)}];
  }).sort((a, b) => a.level - b.level);
}

export function getPowerRaises(item) {
  const power = readPowerFlag(item, "powerRaises");
  const template = item.flags?.["swade-better-templates"]?.automation?.raises;
  if (power == null && Array.isArray(template)) {
    return normalizePowerRaises(template.filter(Boolean).map(raise => ({...raise, changes: normalizePowerChanges(raise.changes)})));
  }
  return normalizePowerRaises(power);
}
export function validateModifiers(modifiers) {
  for (const modifier of modifiers) {
    if (!modifier.name.trim()) throw new Error(sbsI18n("swade-better-powers.UI.Eachmodifierneedsaname_1fe0891771"));
    if (!modifier.options.length) throw new Error(sbsI18n("swade-better-powers.UI.Eachmodifierneedsatleastone_078ef0c956"));
    for (const option of modifier.options) {
      if (!Number.isFinite(option.cost)) throw new Error(sbsI18n("swade-better-powers.UI.Enteranumericmodifiercost_9e0f8821ac"));
    }
  }
  return modifiers;
}
export function modifierSummary(modifiers, noPP = false, accordion = false) {
  if (!modifiers.length) return "";
  const rows = modifiers.map(modifier => {
    const costs = modifier.options.map(option => modifierCostLabel(option, noPP)).join(" / ");
    // Put the first paragraph beside the name, preserving further rich-text blocks.
    const description = (modifier.description || "").trim().replace(/^<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i, "$1");
    return `<li><strong>${escapeHTML(modifier.name)} (${costs}):</strong> ${description}</li>`;
  }).join("");
  if (accordion) return `<details class="sbs-power-modifier-summary"><summary>${sbsI18n("swade-better-powers.UI.Modifiers_072da57fac")}</summary><ul>${rows}</ul></details>`;
  return `<section class="sbs-power-modifier-summary"><hr><h3>${sbsI18n("swade-better-powers.UI.Modifiers_072da57fac")}</h3><ul>${rows}</ul></section>`;
}
