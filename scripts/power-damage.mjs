import {t as sbsI18n} from "./i18n.mjs";
import {applyDamageAdjustment, damagePlan, damageState} from "../../swade-better-setting/scripts/damage-dice.mjs";
import {report, wrapMethod} from "./constants.mjs";
import {castSuccesses, getCast, getPowerDamageChanges, getPowerDamageRaiseLevels} from "./cast-results.mjs";
import {TEMPLATES_ID} from "./template-modifiers.mjs";

const templates = () => game.modules.get(TEMPLATES_ID)?.api;
const pending = new WeakMap();
const BONUS = "sbpExplicitBonus";
const PLAN = "sbpDamagePlan";
function dieAmount(formula, actor, max) {
  const expression = Roll.replaceFormulaData(String(formula), actor.getRollData()).trim().replaceAll("^", "**");
  if (!expression || !/^[\d\s.+*/%()-]+$/.test(expression) || /\/[/\*]/.test(expression)) throw new Error(sbsI18n("swade-better-powers.UI.Invaliddiestepformula_6bfb20f554", {p0: (formula)}));
  const number = Number(expression);
  const value = Number.isFinite(number) ? number : Roll.safeEval(expression);
  if (!Number.isFinite(value)) throw new Error(sbsI18n("swade-better-powers.UI.Invaliddiestepformula_6bfb20f554", {p0: (formula)}));
  return Math.max(0, Math.min(max, Math.floor(value)));
}

// This path also runs in worlds where Better Templates is disabled.
function localProjection(changes, base, actor) {
  const state = damageState(base);
  for (const {source, change} of changes) {
    applyDamageAdjustment(state, change, source, (formula, max) => dieAmount(formula, actor, max));
  }
  return damagePlan(state);
}

function damageMods(item, plan) {
  if (templates()?.castDamageModifiers) return templates().castDamageModifiers(item, plan);
  const modifiers = [];
  if (plan.adjustments.length) pending.set(modifiers, {itemUuid: item.uuid, ...plan});
  return modifiers;
}

// Reuse the same projection and native damage hooks for both cards and inline target rolls.
export function getPowerDamageOptions(message, {action = "damage", raise, preview = false} = {}) {
  const cast = getCast(message);
  const item = cast?.itemUuid && foundry.utils.fromUuidSync(cast.itemUuid);
  if (!item?.actor) return null;
  const base = item.system.actions?.additional?.[action]?.override || item.system.damage || "0";
  raise ??= templates()?.getChatCastOptions?.(message)?.raise;
  const changes = getPowerDamageChanges(message, raise, {preview});
  const project = templates()?.projectDamageChanges ?? localProjection;
  const plan = templates()?.getChatDamagePlan?.(item, message, base, changes, {...cast, raises: Math.max(0, castSuccesses(message, cast) - 1)})
    ?? project(changes, base, item.actor);
  return {formula: plan.formula, hasDamage: base.trim() !== "0" || plan.bonuses.length > 0,
    options: {dmgOverride: base, additionalMods: damageMods(item, plan)}};
}

export function wirePowerDamageControls(item, message, card, rollDamage) {
  if (!hasPowerDamage(message) || !item.actor?.isOwner || !message.isContentVisible) return;
  // A modifier can supply the entire damage formula to an otherwise harmless power.
  if (!item.system.damage?.trim() && !card.querySelector('.damage-rolls button[data-action="damage"]')) {
    let group = card.querySelector(".damage-rolls");
    if (!group) { group = document.createElement("div"); group.className = "card-buttons damage-rolls"; card.append(group); }
    const button = document.createElement("button"); button.type = "button"; button.dataset.action = "damage";
    button.dataset.sbpAddedDamage = ""; group.prepend(button);
  }
  const buttons = card.querySelectorAll(".damage-rolls button[data-action]:not([data-sbt-cast-damage], [data-sbp-cast-damage])");
  if (!buttons.length) return;
  const project = templates()?.projectDamageChanges ?? localProjection;
  const changes = () => getPowerDamageChanges(message, templates()?.getChatCastOptions?.(message)?.raise, {preview: true});
  const previews = [];
  for (const original of buttons) {
    const action = original.dataset.action;
    const base = item.system.actions?.additional?.[action]?.override || item.system.damage || "0";
    const button = original.cloneNode(true);
    original.replaceWith(button);
    button.dataset.sbpCastDamage = "";
    const primary = action === "damage";
    previews.push({primary, render: selected => {
      let plan;
      try { plan = project(selected, base, item.actor); }
      catch (error) { console.warn("Better Powers | Damage projection", error); }
      button.title = plan?.formula ?? base;
      if (primary) button.textContent = button.title;
      button.disabled = false;
      if (button.hasAttribute("data-sbp-added-damage")) button.hidden = !plan?.bonuses.length;
      return plan?.adjustments ?? [];
    }});
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const actor = item.actor;
      if (button.disabled || !actor?.isOwner || actor.items.get(item.id) !== item || !message.isContentVisible) return;
      button.disabled = true;
      try {
        const plan = project(changes(), base, actor);
        if (button.hasAttribute("data-sbp-added-damage") && !plan.bonuses.length) return;
        const modifiers = damageMods(item, plan);
        if (rollDamage) await rollDamage(action, modifiers);
        else await game.swade.itemChatCardHelper.handleAction(item, actor, action, {additionalMods: modifiers});
      } catch (error) { report(error); }
      finally { button.disabled = false; }
    });
  }
  const refresh = () => {
    const selected = changes();
    const primary = previews.find(entry => entry.primary) ?? previews[0];
    for (const preview of previews) {
      const rows = preview.render(selected);
      if (preview === primary) templates()?.renderDamageAdjustments?.(card, rows, {preview: true});
    }
  };
  card.addEventListener("sbtCastOptionsChange", refresh);
  refresh();
}

const hasPowerDamage = message => getPowerDamageChanges(message, undefined, {preview: true}).length || getPowerDamageRaiseLevels(message).length;

function nativeDamageControls(message, html) {
  if (!message.isContentVisible || !hasPowerDamage(message)) return;
  const item = foundry.utils.fromUuidSync(getCast(message).itemUuid);
  if (!item?.actor?.isOwner || (item.actor.type === "npc" && !game.user.isGM && game.settings.get("swade", "hideNpcItemChatCards"))) return;
  const content = html.querySelector(".message-content");
  if (!content) return;
  if (!content.querySelector(".damage-rolls")) {
    const group = document.createElement("div");
    group.className = "card-buttons damage-rolls";
    const addButton = (action, label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.textContent = label;
      group.append(button);
    };
    if (item.system.damage?.trim()) addButton("damage", item.system.damage);
    for (const [key, action] of Object.entries(item.system.actions?.additional ?? {})) {
      if (action.type === "damage" && (action.override || item.system.damage)?.trim()) addButton(key, action.name);
    }
    if (group.childElementCount) content.append(group);
  }
  wirePowerDamageControls(item, message, content);
}

export function installPowerDamage() {
  Hooks.on("renderChatMessageHTML", nativeDamageControls);
  if (templates()?.castDamageModifiers) return;
  wrapMethod(CONFIG.Item.documentClass.prototype, "rollDamage", function (original, options = {}) {
    const plan = pending.get(options.additionalMods);
    if (plan?.itemUuid !== this.uuid) return original(options);
    return original({...options, dmgOverride: [plan.base, ...plan.bonuses.map(bonus => `(${bonus})`)].join(" + "), [PLAN]: plan});
  });
  wrapMethod(CONFIG.Dice.DamageRoll.prototype, "_enableAcing", function (original, roll) {
    const terms = roll.terms.filter(term => term.options?.[BONUS]);
    const nested = terms.map(term => term.roll);
    for (const term of terms) term.roll = undefined;
    try { return original(roll); }
    finally { terms.forEach((term, index) => { term.roll = nested[index]; }); }
  });
  Hooks.on("swadeRollDamage", (_actor, _item, roll, _modifiers, options) => {
    const plan = options?.[PLAN];
    if (!plan?.bonuses.length) return;
    const authored = new Roll(options.dmgOverride, roll.data).terms;
    for (let offset = 1; offset < plan.bonuses.length * 2; offset += 2) {
      const term = authored.at(-offset);
      if (!(term instanceof foundry.dice.terms.ParentheticalTerm)) continue;
      (term.options ??= {})[BONUS] = true;
      roll.terms[roll.terms.length - offset] = term;
    }
    roll.resetFormula();
  });
}
