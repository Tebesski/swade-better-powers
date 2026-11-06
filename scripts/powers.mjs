import {readPowerFlag, MODULE_ID, LEGACY_ID, normalizeName, report} from "./constants.mjs";
import {powerArcane, spellcastingEntries} from "./powers-data.mjs";
import {saveEntry, removeEntry, queueActor, ensureArcaneBackground, initializeBackgrounds} from "./spellcasting.mjs";
import {PowerPicker, applyEntry} from "./power-picker.mjs";
import {renderPowerModifiers, installModifierDescriptionHook, syncModifierEffects} from "./power-modifiers.mjs";
import {installCastingModifiers, installToolsCastingModifiers} from "./casting-modifiers.mjs";
import {noPP, recordPowerCost, installPowerRules, installToolsPowerRules} from "./power-rules.mjs";
import {initializeTemplateModifiers} from "./template-modifiers.mjs";
import {openPowerTimers} from "./power-timers.mjs";

export const openPowers = (actor, entry = spellcastingEntries(actor)[0]) => new PowerPicker({actor, entry}).render({force: true});
const dropEntries = new WeakMap();

function dropEntry(sheet, event) {
  const target = event.target instanceof Element ? event.target : null;
  const direct = target?.closest("[data-sbs-entry]");
  if (direct && sheet.element.contains(direct)) return spellcastingEntries(sheet.actor).find(entry => entry.id === direct.dataset.sbsEntry);
  const tab = sheet.element.querySelector(".sbs-powers.active");
  if (!tab) return null;
  const {clientX: x, clientY: y} = event;
  const bounds = tab.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  const sections = [...tab.querySelectorAll("[data-sbs-entry]")];
  const section = sections.filter(element => element.getBoundingClientRect().top <= y).at(-1);
  return section ? spellcastingEntries(sheet.actor).find(entry => entry.id === section.dataset.sbsEntry) : null;
}

async function editEntry(actor, entry) {
  const {DialogV2} = foundry.applications.api;
  const content = document.createElement("div");
  content.className = "standard-form sbs-entry-settings";
  const name = document.createElement("input"); name.type = "text"; name.name = "entryName"; name.value = entry.name;
  name.setAttribute("value", entry.name);
  name.id = `sbs-entry-name-${foundry.utils.randomID()}`;
  const nameLabel = document.createElement("label"); nameLabel.textContent = "Name"; nameLabel.htmlFor = name.id;
  const nameRow = document.createElement("div"); nameRow.className = "sbs-entry-field form-fields";
  nameRow.append(name);
  if (spellcastingEntries(actor).length > 1) {
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "sbs-entry-remove";
    remove.innerHTML = '<i class="fa-solid fa-trash" inert></i>';
    remove.title = "Remove spellcasting entry"; remove.setAttribute("aria-label", remove.title);
    nameRow.append(remove);
  }
  const nameField = document.createElement("div"); nameField.className = "sbs-entry-name";
  nameField.append(nameLabel, nameRow);
  const traitInput = document.createElement("input"); traitInput.type = "text"; traitInput.name = "entryTrait"; traitInput.value = entry.trait ?? "";
  traitInput.setAttribute("value", entry.trait ?? "");
  const traitLabel = document.createElement("label"); traitLabel.textContent = "Casting trait";
  const row = document.createElement("div"); row.className = "sbs-entry-field form-fields";
  const choose = document.createElement("button"); choose.type = "button"; choose.innerHTML = '<i class="fa-solid fa-list" inert></i>'; choose.title = "Choose a trait";
  choose.className = "sbs-entry-trait-picker";
  choose.setAttribute("aria-label", "Choose a trait");
  row.append(traitInput, choose); traitLabel.append(row);
  content.append(nameField, traitLabel);
  const shell = document.createElement("div");
  shell.append(content);
  const dialog = new DialogV2({window: {title: "Spellcasting entry"}, position: {width: 440}, content: shell,
    buttons: [{action: "save", label: "Save", default: true, callback: async (_event, button) => {
      const form = button.form;
      await saveEntry(actor, entry, {name: form.querySelector('[name="entryName"]').value, trait: form.querySelector('[name="entryTrait"]').value.trim()});
    }}]});
  await dialog.render({force: true});
  // DialogV2 stringifies its supplied content; bind to the actual rendered elements.
  dialog.element.querySelector(".sbs-entry-remove")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const prompt = document.createElement("p");
    prompt.textContent = `Remove ${entry.name}? Any powers assigned to this entry will move to another spellcasting entry.`;
    try {
      const confirmed = await DialogV2.confirm({window: {title: "Remove spellcasting entry"}, content: prompt.outerHTML,
        yes: {label: "Remove", default: false}, no: {label: "Cancel", default: true}, rejectClose: false});
      if (confirmed) {
        await removeEntry(actor, entry.id);
        await dialog.close();
      }
    } catch (error) { report(error); }
    finally { button.disabled = false; }
  });
  dialog.element.querySelector(".sbs-entry-trait-picker").addEventListener("click", event => {
    event.preventDefault();
    const input = dialog.element.querySelector('[name="entryTrait"]');
    const onSelect = value => {
      if (!input.isConnected) throw new Error("The spellcasting settings window was closed.");
      input.value = value;
      input.dispatchEvent(new Event("change", {bubbles: true}));
    };
    const picker = game.modules.get(LEGACY_ID)?.api?.openTraitPicker;
    if (picker) void picker(onSelect, {title: "Choose a casting trait"}).catch(report);
    else void pickCastingTrait(actor).then(value => { if (value) onSelect(value); }).catch(report);
  });
}

function pickCastingTrait(actor) {
  const select = document.createElement("select");
  const attributes = document.createElement("optgroup");
  attributes.label = "Attributes";
  for (const [id, attr] of Object.entries(CONFIG.SWADE.attributes)) attributes.append(new Option(game.i18n.localize(attr.long), id));
  const skills = document.createElement("optgroup");
  skills.label = "Skills";
  for (const name of [...new Set(actor.itemTypes.skill.map(skill => skill.name))].sort()) skills.append(new Option(name));
  select.name = "trait";
  select.append(attributes, skills);
  return foundry.applications.api.DialogV2.prompt({window: {title: "Choose a casting trait"}, content: select.outerHTML,
    ok: {label: "Choose", callback: (_event, button) => button.form.elements.trait.value}, rejectClose: false});
}

function actorEntries(actor) {
  return spellcastingEntries(actor).map(entry => {
    const powers = actor.itemTypes.power.filter(power => normalizeName(powerArcane(power)) === normalizeName(entry.arcane));
    return {...entry, noPP: entry.noPowerPoints ?? game.settings.get("swade", "noPowerPoints"),
      value: actor.system.powerPoints[entry.arcane]?.value ?? 0, max: actor.system.powerPoints[entry.arcane]?.max ?? 0,
      powers: powers.sort((a,b) => a.sort - b.sort).map(power => ({
        id: power.id, uuid: power.uuid, name: power.name, img: power.img, system: power.system,
        cost: Math.max(0, power.system.ppModifiers.cost), maintained: readPowerFlag(power, "maintained"),
        extraActions: Object.entries(power.system.actions.additional).map(([id, action]) => ({id, name: action.name, type: action.type})),
        templates: Object.entries(power.system.templates ?? {}).filter(([, enabled]) => enabled).map(([key]) => ({key, label: CONFIG.SWADE.templates?.[key] ?? key}))
      }))};
  });
}

async function castPower(actor, power, action, card, event) {
  const extra = power.system.actions.additional[action];
  if (action === "damage" || extra?.type === "damage") {
    const mods = [];
    if (power.system.actions.dmgMod) mods.push({label: power.name, value: power.system.actions.dmgMod});
    if (extra?.modifier) mods.push({label: extra.name, value: extra.modifier});
    const roll = await power.rollDamage({additionalMods: mods, dmgOverride: extra?.override, ap: extra?.ap, isHeavyWeapon: extra?.isHeavyWeapon, flavour: extra?.name});
    if (roll) Hooks.callAll("swadeAction", actor, power, action, roll, game.user.id);
    return roll;
  }
  if (extra?.type === "macro") {
    const macro = extra.uuid ? await foundry.utils.fromUuid(extra.uuid) : null;
    const token = extra.macroActor === "target" ? game.user.targets.first() : undefined;
    if (extra.macroActor === "target" && !token?.actor) throw new Error("Select a target for this macro action.");
    return macro?.execute({item: power, actor: extra.macroActor === "self" ? actor : token?.actor, token, event});
  }
  if (extra?.type === "resist") {
    if (canvas.tokens.controlled.length !== 1) throw new Error("Select one token to make a resistance roll.");
    actor = canvas.tokens.controlled[0].actor;
  }
  if (action !== "formula" && !["trait", "resist"].includes(extra?.type)) return power.show();
  const trait = extra?.override || power.system.actions.trait;
  const cost = Math.max(0, card.querySelector(".pp-adjust")?.valueAsNumber ?? power.system.ppModifiers.cost);
  if (extra?.type !== "resist" && !power.canExpendResources(cost)) return ui.notifications.warn("Not enough Power Points.");
  recordPowerCost(power, cost);
  const options = {item: power, sbsPowerCost: cost, sbsResistance: extra?.type === "resist", additionalMods: [...power.traitModifiers], rof: extra?.dice ?? 1};
  if (extra?.modifier) options.additionalMods.push({label: extra.name, value: extra.modifier});
  const attribute = Object.keys(CONFIG.SWADE.attributes).includes(trait) ? trait : null;
  const skill = actor.itemTypes.skill.find(skill => normalizeName(skill.name) === normalizeName(trait) || skill.system.swid === trait);
  const roll = attribute ? await actor.rollAttribute(attribute, options) : await actor.rollSkill(skill?.id, options);
  if (roll) Hooks.callAll("swadeAction", actor, power, action, roll, game.user.id);
  return roll;
}

export function installPowers(wrapMethod) {
  installPowerRules(wrapMethod);
  installModifierDescriptionHook();
  installCastingModifiers(wrapMethod);
  const itemSheet = game.swade.sheets.SwadeItemSheetV2.prototype;
  wrapMethod(itemSheet, "_getTabs", function (original, ...args) {
    const tabs = original(...args);
    if (this.document.type !== "power") return tabs;
    const result = {};
    for (const [key, tab] of Object.entries(tabs)) {
      result[key] = tab;
      if (key === "properties") {
        const active = this.tabGroups.main === "modifiers";
        result.modifiers = {id: "modifiers", group: "main", label: "Mod/Raise", cssClass: active ? "item active" : "item", tabCssClass: `tab scrollable ${active ? "active" : ""}`, active};
      }
    }
    return result;
  });
  wrapMethod(itemSheet, "_processFormData", function (original, event, form, formData) {
    for (const key of Object.keys(formData.object)) if (key.startsWith("sbs-modifier-")) delete formData.object[key];
    return original(event, form, formData);
  });
  for (const Sheet of [game.swade.sheets.CharacterSheet, game.swade.sheets.SwadeNPCSheet]) {
    wrapMethod(Sheet.prototype, "_prepareContext", async function (original, ...args) {
      const context = await original(...args);
      context.sbsEntries = actorEntries(this.actor);
      await Promise.all(context.sbsEntries.flatMap(entry => entry.powers.map(async power => {
        power.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(power.system.description, {relativeTo: this.actor.items.get(power.id), secrets: this.actor.isOwner});
      })));
      return context;
    });
    // Both SWADE actor sheets include Powers inside the main "sheet" part.
    // Replace that nested tab before sheet listeners and scroll handling are attached.
    wrapMethod(Sheet.prototype, "_renderHTML", async function (original, context, options) {
      const rendered = await original(context, options);
      const nativeTab = rendered.sheet?.querySelector('section[data-tab="powers"][data-group="primary"]');
      if (!nativeTab || !context.tabs.powers) return rendered;
      const html = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/powers.hbs`, {
        ...context, tab: context.tabs.powers
      });
      const template = document.createElement("template");
      template.innerHTML = html.trim();
      nativeTab.replaceWith(template.content.firstElementChild);
      return rendered;
    });
    wrapMethod(Sheet.prototype, "_onDrop", function (original, event) {
      // Capture the destination before other asynchronous drop hooks can re-render the sheet.
      const entry = dropEntry(this, event);
      if (entry) dropEntries.set(event, {...entry});
      return original(event);
    });
    wrapMethod(Sheet.prototype, "_onDropItem", async function (original, event, data) {
      const entry = dropEntries.get(event) ?? dropEntry(this, event);
      if (!entry) return original(event, data);
      const item = await CONFIG.Item.documentClass.fromDropData(data);
      if (item?.type !== "power") return original(event, data);
      return queueActor(this.actor, async () => {
        if (!this.actor.isOwner) return false;
        const current = spellcastingEntries(this.actor).find(candidate => candidate.id === entry.id);
        if (!current) return false;
        const power = applyEntry(item.toObject(), current);
        if (item.actor?.uuid === this.actor.uuid) return item.update({"system.arcane": power.system.arcane, "system.actions.trait": power.system.actions.trait});
        delete power._id;
        return this._onDropItemCreate(power);
      });
    });
  }
  Hooks.on("renderApplicationV2", (app, root) => {
    if (app.document?.type === "power") void renderPowerModifiers(app, root).catch(report);
    const actor = app.actor;
    if (!["character", "npc"].includes(actor?.type) || !app.isEditable || root.dataset.sbsPowersListener) return;
    root.dataset.sbsPowersListener = "true";
    root.addEventListener("keydown", event => {
      if (["Enter", " "].includes(event.key) && event.target.matches('a[role="button"][data-sbs-power-action]')) {
        event.preventDefault(); event.target.click();
      }
    });
    root.addEventListener("change", event => {
      const input = event.target;
      if (!input.matches(".sbs-no-pp, .sbs-maintained")) return;
      event.stopImmediatePropagation();
      if (input.matches(".sbs-no-pp")) {
        const entry = spellcastingEntries(actor).find(e => e.id === input.closest("[data-sbs-entry]").dataset.sbsEntry);
        void saveEntry(actor, entry, {noPowerPoints: input.checked}).catch(report);
      } else {
        const power = actor.items.get(input.closest("[data-item-id]").dataset.itemId);
        void power.setFlag(MODULE_ID, "maintained", input.checked).catch(report);
      }
    }, {capture: true});
    root.addEventListener("click", event => {
      const button = event.target.closest('[data-sbs-power-action], [data-action="createDocument"][data-type="power"]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const entry = spellcastingEntries(actor).find(e => e.id === button.closest("[data-sbs-entry]")?.dataset.sbsEntry) ?? spellcastingEntries(actor)[0];
      const action = button.dataset.sbsPowerAction ?? "add";
      const power = actor.items.get(button.closest("[data-item-id]")?.dataset.itemId);
      const run = async () => {
        if (action === "add") return openPowers(actor, entry);
        if (action === "timers") return openPowerTimers(actor);
        if (action === "settings") return editEntry(actor, entry);
        if (action === "refresh") return actor.update({[`system.powerPoints.${entry.arcane}.value`]: actor.system.powerPoints[entry.arcane]?.max ?? 0});
        if (action === "show") return power.show();
        if (action === "edit") return power.sheet.render({force: true});
        if (action === "favorite") return power.update({"system.favorite": !power.system.favorite});
        if (action === "template") return game.swade.util.createRegionFromPreset(button.dataset.template, power);
        if (action === "pp-plus" || action === "pp-minus") {
          if (noPP(power)) return;
          const cost = button.closest(".sbs-power-card").querySelector(".pp-adjust").valueAsNumber;
          if (!Number.isFinite(cost) || cost < 0) throw new Error("Enter a nonnegative Power Point cost.");
          const key = `system.powerPoints.${powerArcane(power)}.value`;
          return actor.update({[key]: Math.max(0, foundry.utils.getProperty(actor, key) + (action === "pp-plus" ? cost : -cost))});
        }
        if (button.disabled) return;
        button.disabled = true;
        try { return await castPower(actor, power, action, button.closest(".sbs-power-card"), event); }
        finally { if (button.isConnected) button.disabled = false; }
      };
      void run().catch(report);
    }, {capture: true});
  });
  Hooks.on("createItem", (item, _options, userId) => {
    if (userId !== game.user.id) return;
    void ensureArcaneBackground(item).catch(report);
    if (item.type === "power" && item.isOwner) void syncModifierEffects(item).catch(report);
  });
  Hooks.on("updateItem", (item, changed, _options, userId) => {
    if (userId === game.user.id && (changed["system.isArcaneBackground"] || changed.system?.isArcaneBackground)) void ensureArcaneBackground(item).catch(report);
  });
  Hooks.on("createActor", (actor, _options, userId) => {
    if (userId === game.user.id) for (const edge of actor.itemTypes.edge ?? []) void ensureArcaneBackground(edge).catch(report);
  });
}

export async function readyPowers(wrapMethod) {
  await installToolsPowerRules(wrapMethod);
  await installToolsCastingModifiers(wrapMethod);
  await initializeBackgrounds();
  for (const actor of game.actors) if (actor.isOwner) for (const power of actor.itemTypes.power ?? []) await syncModifierEffects(power);
  for (const power of game.items) if (power.type === "power" && power.isOwner) await syncModifierEffects(power);
  await initializeTemplateModifiers();
}
