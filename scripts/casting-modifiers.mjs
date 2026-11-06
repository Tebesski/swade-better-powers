import {effectsAPI} from "./constants.mjs";
import {getModifiers, modifierCostLabel, powerPointBreakdown} from "./powers-data.mjs";
import {noPP, preparation} from "./power-rules.mjs";
import {installCastingChat} from "./casting-chat.mjs";
import {rollCast, updateCast} from "./cast-results.mjs";

export function selectedChoices(power, selected) {
  return getModifiers(power).flatMap(modifier => {
    const option = modifier.options.find(option => option.id === selected.get(modifier.id));
    return option ? [{modifier, option}] : [];
  });
}
export const choicesCost = (power, selected) => selectedChoices(power, selected).reduce((sum, choice) => sum + choice.option.cost, 0);
const castingBreakdown = (power, selected, total) => powerPointBreakdown(power.name, power.system.ppModifiers.cost,
  selectedChoices(power, selected).map(({modifier, option}) => ({name: `${modifier.name}${option.label ? ` — ${option.label}` : ""}`, cost: option.cost})), total);

function buildChooser(power, selected, changed) {
  const panel = document.createElement("div");
  panel.className = "sbs-casting-modifiers";
  const presets = document.createElement("div"); presets.className = "presets sbs-power-presets";
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "toggle-list";
  toggle.innerHTML = '<i class="fa-solid fa-caret-right" inert></i> Choose a Power Modifier';
  const dropdown = document.createElement("div"); dropdown.className = "dropdown collapsed"; dropdown.setAttribute("role", "listbox");
  const list = document.createElement("ol"); list.className = "selections unmarked-list";
  const chips = document.createElement("div"); chips.className = "sbs-chosen-modifiers";
  const total = document.createElement("div"); total.className = "sbs-casting-total";
  const refresh = () => {
    chips.replaceChildren();
    for (const {modifier, option} of selectedChoices(power, selected)) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `${modifier.name}: ${option.label || modifier.name} (${modifierCostLabel(option)}) ×`;
      button.title = "Remove this modifier from this casting";
      button.addEventListener("click", event => {event.preventDefault(); event.stopPropagation(); selected.delete(modifier.id); changed(); refresh();});
      chips.append(button);
    }
  };
  for (const modifier of getModifiers(power)) {
    const group = document.createElement("li"); group.className = "group-header"; group.textContent = modifier.name; group.dataset.group = modifier.id;
    list.append(group);
    for (const option of modifier.options) {
      const row = document.createElement("li"); row.className = "modifier"; row.dataset.group = modifier.id;
      const button = document.createElement("button"); button.type = "button"; button.className = "add-preset";
      button.textContent = `${option.label || modifier.name} (${modifierCostLabel(option)})`;
      button.dataset.modifierId = modifier.id; button.dataset.optionId = option.id;
      button.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation(); selected.set(modifier.id, option.id);
        dropdown.classList.add("collapsed"); toggle.querySelector("i").classList.remove("rotate");
        changed(); refresh();
      });
      row.append(button); list.append(row);
    }
  }
  toggle.addEventListener("click", event => {event.preventDefault(); event.stopPropagation(); dropdown.classList.toggle("collapsed"); toggle.querySelector("i").classList.toggle("rotate"); if (!dropdown.classList.contains("collapsed")) list.querySelector("button")?.focus();});
  dropdown.append(list); presets.append(toggle, dropdown); panel.append(presets, chips, total); refresh();
  panel.updateTotal = cost => {total.textContent = noPP(power) ? `Casting penalty: ${-Math.ceil(Math.max(0, cost) / 2)} · Total cost: ${cost} PP` : `Total cost: ${cost} PP`;};
  return panel;
}

function updateNativeCast(app) {
  const power = app.ctx.item;
  const selected = app.sbsPowerChoices;
  const cost = app.sbsBasePowerCost + (selected ? choicesCost(power, selected) : 0);
  const total = Math.max(0, cost);
  const modifiers = app.modifiers;
  const index = modifiers.findIndex(mod => mod.sbsPowerBreakdown);
  if (noPP(power)) {
    const penalty = modifiers[index];
    penalty.value = -Math.ceil(total / 2);
    penalty.sbsPowerBreakdown = castingBreakdown(power, selected ?? new Map(), cost);
    let prep = modifiers.find(mod => mod.sbpPreparation);
    if (!prep) {
      prep = {label: "Power Preparation", value: 2, ignore: true, sbpPreparation: true};
      modifiers.splice(index, 0, prep);
    }
    prep.value = preparation(app.ctx.actor, power);
    if (!prep.value) prep.ignore = true;
    effectsAPI()?.setPowerPreparation?.(app.ctx.roll, !prep.ignore);
  }
  const cast = rollCast(app.ctx.roll);
  updateCast(cast, power, selected, modifiers.some(mod => mod.sbpPreparation && !mod.ignore));
  app.sbsCastingTotal = total;
}

export function installCastingModifiers(wrapMethod) {
  installCastingChat();
  const RollDialog = game.swade.RollDialog;
  wrapMethod(RollDialog.prototype, "_prepareContext", async function (original, ...args) {
    if (rollCast(this.ctx.roll)) {
      if (getModifiers(this.ctx.item).length) this.sbsPowerChoices ??= new Map();
      this.sbsBasePowerCost ??= this.ctx.roll.options.sbsPowerCost ?? this.ctx.item.system.ppModifiers.cost;
      updateNativeCast(this);
    }
    return original(...args);
  });
  Hooks.on("renderApplicationV2", (app, root) => {
    if (!(app instanceof RollDialog)) return;
    const prepIndex = app.modifiers.findIndex(mod => mod.sbpPreparation);
    const prep = root.querySelector(`input[data-index="${prepIndex}"]`);
    if (prep && prepIndex >= 0) {
      prep.setAttribute("aria-label", "Power Preparation");
      prep.disabled = !app.modifiers[prepIndex].value;
    }
    if (!app.sbsPowerChoices || root.querySelector(".sbs-casting-modifiers")) return;
    const panel = buildChooser(app.ctx.item, app.sbsPowerChoices, () => {updateNativeCast(app); void app.render();});
    panel.updateTotal(app.sbsCastingTotal);
    root.querySelector(".presets")?.after(panel);
  });
}

export async function installToolsCastingModifiers(wrapMethod) {
  if (!game.modules.get("swade-tools")?.active) return;
  const {default: ItemDialog} = await import(foundry.utils.getRoute("modules/swade-tools/scripts/class/ItemDialog.js"));
  let openingItem;
  const dialogs = new WeakMap();
  wrapMethod(ItemDialog.prototype, "showDialog", function (original, ...args) {
    const prior = openingItem; openingItem = this.item;
    try {return original(...args);} finally {openingItem = prior;}
  });
  wrapMethod(foundry.appv1.api.Dialog.prototype, "_render", function (original, ...args) {
    if (openingItem?.type === "power") dialogs.set(this, openingItem);
    return original(...args);
  });
  Hooks.on("renderDialog", (app, html) => {
    const power = dialogs.get(app);
    const root = html[0] ?? html;
    const anchor = root.querySelector("#mod")?.closest(".swadetools-mod-add");
    if (!power || !anchor || root.querySelector(".sbs-casting-modifiers")) return;
    if (noPP(power) && !root.querySelector(".sbp-tools-preparation")) {
      const row = document.createElement("label");
      row.className = "swadetools-mod-add sbp-tools-preparation";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.disabled = !preparation(power.actor, power);
      row.append("Power Preparation ", input);
      anchor.before(row);
    }
    if (!getModifiers(power).length) return;
    const selected = new Map(); root.sbsPowerChoices = selected;
    const panel = buildChooser(power, selected, () => {
      const extra = Number(root.querySelector("#extrapp")?.value) || 0;
      const total = Math.max(0, power.system.ppModifiers.cost + extra + choicesCost(power, selected));
      panel.updateTotal(total);
      const counter = root.querySelector(".swadetools-powercost"); if (counter) counter.textContent = total;
    });
    panel.classList.add("roll-dialog");
    panel.sbsPowerChoices = selected;
    (root.querySelector(".swadetools-power-modifiers") ?? root.querySelector("#mod").closest(".swadetools-mod-add")).after(panel);
    panel.updateTotal(power.system.ppModifiers.cost);
  });
  wrapMethod(ItemDialog.prototype, "processItemFormDialog", async function (original, html, charRoll, actionType) {
    const root = html[0] ?? html;
    const selected = root.sbsPowerChoices ?? root.querySelector(".sbs-casting-modifiers")?.sbsPowerChoices;
    if (this.item.type === "power" && !["damage", "resist"].includes(actionType)) {
      charRoll.sbpPrepared = root.querySelector(".sbp-tools-preparation input")?.checked;
      charRoll.sbpChoices = selected;
      charRoll.sbpForm = root;
    }
    const result = await original(html, charRoll, actionType);
    if (["damage", "resist"].includes(actionType) || !selected) return result;
    const cost = (charRoll.sbsPowerCost ?? this.item.system.ppModifiers.cost) + choicesCost(this.item, selected);
    charRoll.useShots(Math.max(0, cost));
    charRoll.sbsPowerBreakdown = castingBreakdown(this.item, selected, cost);
    return result;
  });
}
