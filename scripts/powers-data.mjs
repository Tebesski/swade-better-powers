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
  const general = {id: GENERAL, name: "General", arcane: GENERAL, trait: "", ...stored.find(e => e.arcane === GENERAL)};
  const entries = stored.filter(entry => entry.arcane !== GENERAL).map(entry => ({...entry}));
  if (readPowerFlag(actor, "generalSpellcastingRemoved") !== true) entries.unshift(general);
  for (const power of actor.itemTypes?.power ?? []) {
    const arcane = powerArcane(power);
    if (entries.some(e => normalizeName(e.arcane) === normalizeName(arcane))) continue;
    if (normalizeName(arcane) === GENERAL) entries.unshift(general);
    else entries.push({id: `existing-${power.id}`, arcane, name: arcane, trait: power.system.actions?.trait ?? ""});
  }
  return entries.length ? entries : [general];
}
export function entryForPower(power) {
  return power.actor ? spellcastingEntries(power.actor).find(e => normalizeName(e.arcane) === normalizeName(powerArcane(power))) : null;
}
export function usesNoPowerPoints(power, worldDefault = false) {
  const entry = entryForPower(power);
  return entry?.noPowerPoints ?? worldDefault;
}
export function castingPenalty(cost, maintained = 0) {
  const penalty = Math.ceil(Math.max(0, Number(cost) || 0) / 2) + Math.max(0, Number(maintained) || 0);
  return -penalty;
}
export function powerPointBreakdown(name, baseCost, choices = [], totalCost = Number(baseCost) + choices.reduce((sum, choice) => sum + choice.cost, 0)) {
  const costs = [{name, cost: Number(baseCost)}, ...choices.map(choice => ({name: choice.name, cost: Number(choice.cost)}))];
  const adjustment = totalCost - costs.reduce((sum, choice) => sum + choice.cost, 0);
  if (adjustment) costs.push({name: "Additional Power Points", cost: adjustment});
  const total = Math.max(0, totalCost);
  const terms = costs.map((choice, index) => index ? `${choice.cost < 0 ? "-" : "+"} ${Math.abs(choice.cost)} PP` : `${choice.cost} PP`).join(" ");
  const expression = totalCost < 0 ? `max(0, (${terms}))` : `(${terms})`;
  return {costs, total, penalty: castingPenalty(total), formula: `${expression} / 2 = ${castingPenalty(total) || 0}`};
}
export function modifierCostLabel(option) {
  const signed = value => Number(value) > 0 ? `+${Number(value)}` : String(Number(value) || 0);
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

export const getModifiers = item => normalizeModifiers(readPowerFlag(item, "powerModifiers") ?? []);

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
    if (!modifier.name.trim()) throw new Error("Each modifier needs a name.");
    if (!modifier.options.length) throw new Error("Each modifier needs at least one cost option.");
    for (const option of modifier.options) {
      if (!Number.isFinite(option.cost)) throw new Error("Enter a numeric modifier cost.");
    }
  }
  return modifiers;
}
export function modifierSummary(modifiers) {
  if (!modifiers.length) return "";
  const rows = modifiers.map(modifier => {
    const costs = modifier.options.map(modifierCostLabel).join(" / ");
    // Put the first paragraph beside the name, preserving further rich-text blocks.
    const description = (modifier.description || "").trim().replace(/^<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i, "$1");
    return `<li><strong>${escapeHTML(modifier.name)} (${costs}):</strong> ${description}</li>`;
  }).join("");
  return `<section class="sbs-power-modifier-summary"><hr><h3>Modifiers</h3><ul>${rows}</ul></section>`;
}
