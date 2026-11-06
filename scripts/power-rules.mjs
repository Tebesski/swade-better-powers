import {effectsAPI, MAINTENANCE, MODULE_ID, normalizeName, PREPARATION, readPowerFlag} from "./constants.mjs";
import {spellcastingEntries, usesNoPowerPoints, powerPointBreakdown} from "./powers-data.mjs";
import {startCast, updateCast} from "./cast-results.mjs";
import {powerDurationEnded} from "./maintenance.mjs";
import {importSwadeTools} from "./tools-imports.mjs";

export const noPP = power => power?.type === "power" && usesNoPowerPoints(power, game.settings.get("swade", "noPowerPoints"));
const rollCosts = new WeakMap();
export const recordPowerCost = (power, cost) => { if (Number.isFinite(Number(cost))) rollCosts.set(power, Math.max(0, Number(cost))); };
export const maintainedPowers = actor => actor.itemTypes.power.filter(item => noPP(item) && readPowerFlag(item, "maintained"));
const powerModifier = (actor, item, flag, value) => effectsAPI()?.powerRollModifier?.(actor, item, flag, value) ?? value;
export const preparation = (actor, item) => powerModifier(actor, item, PREPARATION, 2);

export function powerRollModifiers(actor, skill, modifiers, options) {
  const item = options?.item;
  if (options?.sbsResistance || (item?.actor && item.actor.uuid !== actor.uuid)) return;
  const isPower = item?.type === "power";
  const capturedCost = isPower ? rollCosts.get(item) : undefined;
  const castingCost = isPower ? Math.max(0, options.sbsPowerCost ?? capturedCost ?? item.system.ppModifiers.cost) : undefined;
  if (isPower) rollCosts.delete(item);
  const traits = new Set([skill?.name ?? skill, skill?.system?.swid].map(normalizeName).filter(Boolean));
  const entryTrait = () => spellcastingEntries(actor).some(entry => traits.has(normalizeName(entry.trait)));
  const rawArcaneSkill = (!item || item.type === "skill") && skill?.type === "skill"
    && (entryTrait() || actor.itemTypes.power.some(power => traits.has(normalizeName(power.system.actions.trait))));
  if (!isPower && !rawArcaneSkill && (item || !entryTrait())) return;
  if (isPower && game.settings.get("swade", "noPowerPoints")) {
    // Replace the world's native casting penalty so explicit per-entry overrides work both ways.
    for (let index = modifiers.length - 1; index >= 0; index--) if (modifiers[index].label === game.i18n.localize("TYPES.Item.power")) modifiers.splice(index, 1);
  }
  if (isPower || rawArcaneSkill) {
    let value;
    for (const effect of actor.effects ?? []) {
      const periods = effect.flags[MODULE_ID]?.maintenance;
      if (!Number.isInteger(periods) || periods < 1 || !effect.active || powerDurationEnded(effect)) continue;
      value ??= powerModifier(actor, item, MAINTENANCE, -1);
      if (value) modifiers.push({label: effect.name, value: value * periods});
    }
  }
  if (isPower && noPP(item)) {
    const penalty = -Math.ceil(castingCost / 2);
    modifiers.push({label: "No Power Points", value: penalty,
      sbsPowerBreakdown: powerPointBreakdown(item.name, item.system.ppModifiers.cost, [], castingCost)});
  }
  const maintained = maintainedPowers(actor).length;
  if (maintained) modifiers.push({label: "Maintained powers", value: -maintained});
  return castingCost;
}

export function installPowerRules(wrapMethod) {
  const powerModel = CONFIG.Item.dataModels.power.prototype;
  wrapMethod(powerModel, "_canExpendResources", function (_original, cost = 1) {
    if (this.innate || noPP(this.parent)) return true;
    return Number(this.parent.actor?.system.powerPoints?.[this.arcane || "general"]?.value ?? 0) >= Math.max(0, cost);
  });
  wrapMethod(CONFIG.Item.documentClass.prototype, "getChatData", async function (original, ...args) {
    const data = await original(...args);
    if (this.type === "power") data.settingRules.noPowerPoints = noPP(this);
    return data;
  });
  // Capture total cost from native character and chat-card controls, including ad-hoc PP adjustments.
  wrapMethod(game.swade.sheets.CharacterSheet.prototype, "_handleItemActions", function (original, event) {
    const card = event.currentTarget?.closest(".chat-card.item-card");
    const power = this.actor.items.get(card?.dataset.itemId);
    if (power?.type === "power") recordPowerCost(power, card.querySelector("input.pp-adjust")?.valueAsNumber ?? power.system.ppModifiers.cost);
    return original(event);
  });
  wrapMethod(CONFIG.ChatMessage.dataModels.itemCard.prototype, "_handleButtonClick", async function (original, event, button, html) {
    const item = this._item;
    if (item?.type === "power") {
      recordPowerCost(item, html.querySelector("input.pp-adjust")?.valueAsNumber ?? item.system.ppModifiers.cost);
      if (button.dataset.action === "pp-adjust") {
        if (!noPP(item) && item.actor?.isOwner) {
          const key = `system.powerPoints.${item.system.arcane || "general"}.value`;
          const cost = rollCosts.get(item) ?? item.system.ppModifiers.cost;
          await item.actor.update({[key]: Math.max(0, foundry.utils.getProperty(item.actor, key) + (button.dataset.adjust === "plus" ? cost : -cost))});
        }
        return;
      }
    }
    return original(event, button, html);
  });
  const castItems = new WeakMap();
  const prepare = (actor, trait, roll, modifiers, options) => {
    const cost = powerRollModifiers(actor, trait, modifiers, options);
    if (cost === undefined) return;
    const item = options.item;
    roll.options.sbsPowerCost = cost;
    castItems.set(roll, item);
    const cast = startCast(roll, actor, item, noPP(item), roll.targetNumber);
    updateCast(cast, item);
  };
  // SWADE forwards the casting item for skills. Its attribute dialog omits it.
  wrapMethod(game.swade.RollDialog, "asPromise", function (original, context) {
    const item = castItems.get(context.roll);
    return original(item ? {...context, item} : context);
  });
  Hooks.on("swadePreRollAttribute", prepare);
  Hooks.on("swadePreRollSkill", prepare);
}

export async function installToolsPowerRules(wrapMethod) {
  if (!game.modules.get("swade-tools")?.active) return;
  const [{default: CharRoll}, {default: BasicRoll}] = await importSwadeTools("scripts/class/CharRoll.js", "scripts/class/BasicRoll.js");
  wrapMethod(CharRoll.prototype, "isItem", function (original, item, count = true) {
    const result = original(item, count);
    if (item.type === "power") this.manageshots = count && !noPP(item);
    return result;
  });
  wrapMethod(CharRoll.prototype, "useShots", function (original, shots) {
    if (this.item?.type === "power" && Number.isFinite(Number(shots))) this.sbsPowerCost = Math.max(0, Number(shots));
    return original(shots);
  });
  wrapMethod(CharRoll.prototype, "powerCount", function (original, ...args) {
    if (noPP(this.item)) { this.manageshots = false; return; }
    return original(...args);
  });
  wrapMethod(BasicRoll.prototype, "buildRoll", async function (original, die, wild, modifier, rof) {
    if (this.rolltype === "damage" || this.rolltype === "resist") return original(die, wild, modifier, rof);
    const mods = [];
    if (this.item?.type !== "power") {
      const skill = this.rolltype === "skill" && this.actor?.itemTypes.skill.find(skill => skill.name === this.skillName);
      if (skill) powerRollModifiers(this.actor, skill, mods, {item: this.item});
      return original(die, wild, mods.length ? Number(modifier || 0) + mods.reduce((sum, mod) => sum + mod.value, 0) : modifier, rof);
    }
    const cost = Math.max(0, this.sbsPowerCost ?? this.item.system.ppModifiers.cost);
    powerRollModifiers(this.actor, this.skillName, mods, {item: this.item, sbsPowerCost: cost});
    // Tools puts the global NPP modifier into its own numeric modifier input.
    const native = game.settings.get("swade", "noPowerPoints") ? -Math.ceil(this.item.system.pp / 2) : 0;
    const prepared = this.sbpPrepared && noPP(this.item) ? preparation(this.actor, this.item) : 0;
    const roll = await original(die, wild, Number(modifier || 0) - native + prepared + mods.reduce((sum, mod) => sum + mod.value, 0), rof);
    const cast = startCast(roll, this.actor, this.item, noPP(this.item), this.targetNumber);
    updateCast(cast, this.item, this.sbpChoices, prepared !== 0, this.sbpForm);
    effectsAPI()?.setPowerPreparation?.(roll, prepared !== 0);
    if (noPP(this.item)) roll.options.sbsPowerBreakdown = this.sbsPowerBreakdown
      ?? powerPointBreakdown(this.item.name, this.item.system.ppModifiers.cost, [], cost);
    return roll;
  });
}
