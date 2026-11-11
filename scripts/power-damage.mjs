import {applyDamageAdjustment, damagePlan, damageState} from "../../swade-better-setting/scripts/damage-dice.mjs";
import {report, wrapMethod} from "./constants.mjs";
import {getCast, getPowerDamageChanges} from "./cast-results.mjs";
import {TEMPLATES_ID} from "./template-modifiers.mjs";

const templates = () => game.modules.get(TEMPLATES_ID)?.api;
const pending = new WeakMap();
const BONUS = "sbpExplicitBonus";
const PLAN = "sbpDamagePlan";
function dieAmount(formula, actor, max) {
  const expression = Roll.replaceFormulaData(String(formula), actor.getRollData()).trim().replaceAll("^", "**");
  if (!expression || !/^[\d\s.+*/%()-]+$/.test(expression) || /\/[/\*]/.test(expression)) throw new Error(`Invalid die step formula: ${formula}`);
  const number = Number(expression);
  const value = Number.isFinite(number) ? number : Roll.safeEval(expression);
  if (!Number.isFinite(value)) throw new Error(`Invalid die step formula: ${formula}`);
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

export function wirePowerDamageControls(item, message, card, rollDamage) {
  const changes = getPowerDamageChanges(message);
  if (!changes.length || !item.actor?.isOwner || !message.isContentVisible) return;
  const buttons = card.querySelectorAll(".damage-rolls button[data-action]:not([data-sbt-cast-damage], [data-sbp-cast-damage])");
  const project = templates()?.projectDamageChanges ?? localProjection;
  let preview = [];
  for (const original of buttons) {
    const action = original.dataset.action;
    const base = item.system.actions?.additional?.[action]?.override || item.system.damage;
    if (!base?.trim()) continue;
    let plan;
    try { plan = project(changes, base, item.actor); }
    catch (error) { console.warn("Better Powers | Damage projection", error); }
    const button = original.cloneNode(true);
    original.replaceWith(button);
    button.dataset.sbpCastDamage = "";
    if (plan?.adjustments.length) {
      button.title = plan.formula;
      if (action === "damage") button.textContent = plan.formula;
      if (!preview.length || action === "damage") preview = plan.adjustments;
    }
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const actor = item.actor;
      if (button.disabled || !actor?.isOwner || actor.items.get(item.id) !== item || !message.isContentVisible) return;
      button.disabled = true;
      try {
        const modifiers = damageMods(item, project(changes, base, actor));
        if (rollDamage) await rollDamage(action, modifiers);
        else await game.swade.itemChatCardHelper.handleAction(item, actor, action, {additionalMods: modifiers});
      } catch (error) { report(error); }
      finally { button.disabled = false; }
    });
  }
  if (preview.length) templates()?.renderDamageAdjustments?.(card, preview, {preview: true});
}

function nativeDamageControls(message, html) {
  if (!message.isContentVisible || !getPowerDamageChanges(message).length
    || (game.modules.get("swade-hud")?.active && message.flags["swade-hud"]?.powerCast)) return;
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
