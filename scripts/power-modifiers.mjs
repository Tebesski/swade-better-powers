import {effectsAPI, readPowerFlag, MODULE_ID} from "./constants.mjs";
import {escapeHTML, getLocalModifiers, getPowerRaises, modifierCostLabel, modifierSummary, normalizeModifiers, normalizePowerRaises, validateModifiers} from "./powers-data.mjs";
import {BEHAVIORS, behaviorFieldValue, behaviorSystem, isCodeBehavior} from "./behavior-data.mjs";
import {trustPowerBehaviors} from "./behavior-code.mjs";
import {effectReference, pickEffect} from "./effect-sources.mjs";
import {POWER_MODIFIERS, POWER_RAISES, templateModifierPatch, syncTemplateModifierUpdate} from "./template-modifiers.mjs";

const pending = new Map();
export function descriptionWithModifiers(description, modifiers) {
  const container = document.createElement("div");
  container.innerHTML = description ?? "";
  container.querySelectorAll(".sbs-power-modifier-summary").forEach(el => el.remove());
  return container.innerHTML + modifierSummary(normalizeModifiers(modifiers));
}

export async function separateModifierDescription(item, parts) {
  if (item.type !== "power") return;
  for (const part of Object.values(parts)) {
    const editor = part?.querySelector?.('prose-mirror[name="system.description"]');
    if (!editor) continue;
    const content = document.createElement("div");
    content.innerHTML = editor.querySelector(".editor-content")?.innerHTML ?? editor.innerHTML;
    const legacy = content.querySelector(".sbs-power-modifier-summary");
    const summary = legacy?.outerHTML ?? modifierSummary(getLocalModifiers(item));
    if (!summary) continue;
    legacy?.remove();
    const replacement = customElements.get("prose-mirror").create({
      name: editor.getAttribute("name"), toggled: true,
      value: descriptionWithModifiers(item.system.description, []), enriched: content.innerHTML
    });
    for (const {name, value} of editor.attributes) if (name !== "value") replacement.setAttribute(name, value);
    const display = document.createRange().createContextualFragment(legacy ? summary :
      await foundry.applications.ux.TextEditor.implementation.enrichHTML(summary, {relativeTo: item, secrets: item.isOwner}));
    display.querySelector(".sbs-power-modifier-summary > h3")?.classList.add("additional-stats-header");
    editor.parentElement.classList.add("sbp-readonly-summary");
    editor.replaceWith(replacement, display);
  }
}

function queuePowerUpdate(item, update) {
  const previous = pending.get(item.uuid) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => {
    if (!item.isOwner) throw new Error("You do not have permission to edit this power.");
    return update();
  });
  pending.set(item.uuid, next);
  return next;
}

export function savePowerModifiers(item, modifiers) {
  modifiers = normalizeModifiers(modifiers);
  validateModifiers(modifiers);
  return queuePowerUpdate(item, async () => {
    await trustPowerBehaviors(modifiers.flatMap(modifier => modifier.options.flatMap(option => option.changes ?? [])));
    await item.update({[`flags.${MODULE_ID}.powerModifiers`]: modifiers,
      "system.description": descriptionWithModifiers(item._source.system.description, modifiers)});
    await syncModifierEffects(item);
  });
}

export function savePowerRaises(item, raises) {
  const normalized = normalizePowerRaises(raises);
  if (normalized.length !== raises.length) throw new Error("Each raise needs a different positive whole number.");
  return queuePowerUpdate(item, async () => {
    await trustPowerBehaviors(normalized.flatMap(raise => raise.changes));
    return item.update({[POWER_RAISES]: normalized});
  });
}
export async function syncModifierEffects(item) {
  // Older versions stored casting choices as effects; choices now belong to the current roll.
  const old = item.effects.filter(effect => readPowerFlag(effect, "modifierId"));
  const remove = old.map(effect => effect.id);
  if (remove.length) await item.deleteEmbeddedDocuments("ActiveEffect", remove);
}

const modifierView = app => app.sbsModifierView ??= {scrollTop: 0, expanded: new Set(), expandedDetails: new Set()};

export function openModifierEditor(item, id) {
  const sheet = item.sheet;
  modifierView(sheet).expanded.add(id);
  sheet.tabGroups.main = "modifiers";
  return sheet.render({force: true});
}

export function renderLibraryBehaviors(root, modifier, optionId, onSave) {
  const library = {modifier, optionId, onSave, saves: Promise.resolve()};
  root.classList.add("sbp-library-automation");
  const app = {isEditable: true, render: async () => {
    if (!root.isConnected) return;
    root.replaceChildren();
    await renderPowerModifiers(app, root, library);
  }};
  return app.render();
}

const settingAPI = () => game.modules.get("swade-better-setting").api;

export async function renderPowerModifiers(app, root, library) {
  if ((!library && app.document?.type !== "power") || root.querySelector(".sbs-modifiers-tab")) return;
  const state = modifierView(app);
  const setting = settingAPI();
  const catalog = Boolean(library);
  const storedChanges = new Map();
  const showChanges = changes => (changes ?? []).map((change, index) => {
    storedChanges.set(change.id, change);
    const def = BEHAVIORS[change.type];
    return {...change, title: def.label, expanded: state.expandedDetails.has(change.id), addEffect: change.type === "addEffect",
      inlineEffects: change.system.effects,
      editable: app.isEditable && (!def.code || game.user.isGM), canMoveUp: index > 0, canMoveDown: index < changes.length - 1,
      fields: def.fields.map(field => ({...field, inputType: field.type === "number" ? "number" : "text",
        value: behaviorFieldValue(change, field), select: field.type === "select", checkbox: field.type === "checkbox",
        textarea: field.type === "textarea", effect: field.type === "effect", drop: ["effect", "macro"].includes(field.type)}))};
  });
  const modifiers = library ? normalizeModifiers([library.modifier]) : getLocalModifiers(app.document);
  for (const modifier of modifiers) {
    modifier.expanded = state.expanded.has(modifier.id);
    const removable = modifier.options.length > 1;
    modifier.options = modifier.options.map(option => ({...option, removable, changes: showChanges(option.changes),
      costText: option.cost ? modifierCostLabel(option) : ""}));
  }
  const raises = (catalog ? [] : getPowerRaises(app.document)).map(raise => ({...raise, expanded: state.expandedDetails.has(raise.id), changes: showChanges(raise.changes)}));
  const section = document.createElement("section");
  section.className = catalog ? "sbp-library-behaviors" : "tab scrollable sbs-modifiers-tab";
  const libraryOption = library && modifiers[0].options.find(option => option.id === library.optionId);
  if (library && !libraryOption) return;
  section.dataset.group = "main";
  section.dataset.tab = "modifiers";
  section.innerHTML = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/power-modifiers.hbs`, {
    modifiers, raises, libraryOption, editable: app.isEditable,
    canSaveToLibrary: !catalog && game.user.isGM && Boolean(setting?.saveModifierToLibrary),
    canEditEffects: Boolean(effectsAPI()?.editEffectSource && Item.canUserCreate(game.user))
  });
  if (!catalog) section.classList.toggle("active", app.tabGroups.main === "modifiers");
  (catalog ? root : root.querySelector(".sheet-body"))?.append(section);
  // Foundry restores native part scroll before this asynchronously rendered tab exists.
  const restoreScroll = () => {if (section.isConnected && section.classList.contains("active")) section.scrollTop = state.scrollTop;};
  restoreScroll();
  requestAnimationFrame(restoreScroll);
  section.addEventListener("scroll", () => {
    if (section.isConnected && section.classList.contains("active")) state.scrollTop = section.scrollTop;
  }, {passive: true});
  for (const row of section.querySelectorAll(".sbs-modifier")) {
    const updateToggle = () => {
      const toggle = row.querySelector('[data-modifier-action="toggle"]');
      toggle.setAttribute("aria-expanded", String(row.open));
      toggle.setAttribute("aria-label", row.open ? "Collapse modifier" : "Expand modifier");
      if (row.open) state.expanded.add(row.dataset.id); else state.expanded.delete(row.dataset.id);
    };
    updateToggle();
    row.addEventListener("toggle", updateToggle);
  }
  for (const row of section.querySelectorAll("details[data-variant-accordion]")) {
    row.addEventListener("toggle", () => {
      if (row.open) state.expandedDetails.add(row.dataset.id);
      else state.expandedDetails.delete(row.dataset.id);
    });
  }
  section.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key) && event.target.matches('a[role="button"]')) { event.preventDefault(); event.target.click(); }
  });
  const captureChanges = root => [...root.querySelectorAll(".sbp-power-behavior")].map(behavior => {
    const {id, type} = behavior.dataset;
    const previous = storedChanges.get(id);
    if (!game.user.isGM && isCodeBehavior(previous)) return previous;
    const input = key => behavior.querySelector(`[data-field="${key}"]`);
    const system = behaviorSystem(type, field => {
      const element = input(field.key);
      if (field.type === "checkbox") return element.checked;
      if (field.type !== "number") return element.value;
      const value = element.valueAsNumber;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field.label} requires a nonnegative whole number.`);
      return value;
    });
    return {id, type, enabled: input("enabled").checked, label: input("behaviorLabel").value.trim(), system: {...previous?.system, ...system}};
  });
  const captureModifiers = () => {
    if (library) return [{...library.modifier, options: library.modifier.options.map(option => option.id === library.optionId
      ? {...option, changes: captureChanges(section)} : option)}];
    return [...section.querySelectorAll(".sbs-modifier")].map(row => ({
      id: row.dataset.id, name: row.querySelector('[data-field="name"]').value,
      description: row.querySelector("prose-mirror").value,
      options: [...row.querySelectorAll(".sbs-cost-option")].map(option => ({
        id: option.dataset.id, label: option.querySelector('[data-field="label"]').value,
        cost: Number(option.querySelector('[data-field="cost"]').textContent.trim() || 0),
        changes: captureChanges(option.closest(".sbp-modifier-option"))
      }))
    }));
  };
  const captureRaises = () => [...section.querySelectorAll(".sbp-raise")].map(row => ({id: row.dataset.id,
    level: row.querySelector('[data-field="level"]').valueAsNumber, changes: captureChanges(row)}));
  const save = async (isRaise, mutate) => {
    state.scrollTop = section.scrollTop;
    try {
      const definitions = isRaise ? captureRaises() : captureModifiers();
      mutate?.(definitions);
      if (library) {
        const modifier = normalizeModifiers(definitions)[0];
        const changes = modifier.options.find(option => option.id === library.optionId).changes ?? [];
        library.modifier = modifier;
        const save = library.saves.then(async () => {
          await trustPowerBehaviors(changes);
          await library.onSave(changes);
        });
        library.saves = save.catch(() => {});
        // Rebuild only this option's behavior controls after a structural change.
        if (mutate) await app.render();
        await save;
      } else await (isRaise ? savePowerRaises(app.document, definitions) : savePowerModifiers(app.document, definitions));
    } catch (error) { ui.notifications.error(error.message); }
  };
  if (!catalog && app.isEditable) {
    section.addEventListener("dragstart", event => {
      const handle = event.target.closest("[data-modifier-drag]");
      if (handle) setting.writeModifierDrag(event, "power", handle.closest(".sbs-modifier").dataset.id, app.document.uuid);
    });
  }
  section.addEventListener("change", event => { event.stopPropagation(); if (app.isEditable) void save(Boolean(event.target.closest(".sbp-raise"))); });
  section.addEventListener("dragover", event => {
    if (event.target.matches("[data-behavior-drop]:enabled")) event.preventDefault();
  });
  section.addEventListener("drop", async event => {
    const input = event.target.closest("[data-behavior-drop]:enabled");
    if (!input) return;
    event.preventDefault(); event.stopPropagation();
    try {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (!data.uuid) return;
      const document = await foundry.utils.fromUuid(data.uuid);
      const value = input.dataset.behaviorDrop === "macro" ? document?.documentName === "Macro" && document.uuid : effectReference(document);
      if (value) { input.value = value; await save(Boolean(input.closest(".sbp-raise"))); }
    } catch (error) { ui.notifications.error(error.message); }
  });
  section.addEventListener("focusout", event => {
    if (app.isEditable && event.target.matches('[contenteditable="true"][data-field="cost"]')) void save(false);
  });
  section.addEventListener("keydown", event => {
    if (event.target.matches('[contenteditable="true"][data-field="cost"]') && event.key === "Enter") {event.preventDefault(); event.stopPropagation(); event.target.blur();}
  }, {capture: true});
  section.addEventListener("paste", event => {
    if (!event.target.matches('[contenteditable="true"][data-field="cost"]')) return;
    event.preventDefault();
    const value = event.clipboardData.getData("text/plain").trim();
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) event.target.textContent = value;
  });
  section.addEventListener("beforeinput", event => {
    if (!event.target.matches('[contenteditable="true"][data-field="cost"]') || !event.inputType.startsWith("insert") || !event.data) return;
    const selection = window.getSelection();
    const text = event.target.textContent;
    const start = selection?.anchorNode?.parentElement === event.target ? Math.min(selection.anchorOffset, selection.focusOffset) : text.length;
    const end = selection?.anchorNode?.parentElement === event.target ? Math.max(selection.anchorOffset, selection.focusOffset) : text.length;
    const next = text.slice(0, start) + event.data + text.slice(end);
    if (!/^[+-]?\d*(?:\.\d*)?$/.test(next)) event.preventDefault();
  });
  section.addEventListener("click", async event => {
    const button = event.target.closest("[data-modifier-action]");
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    if (button.dataset.modifierAction === "toggle") {
      const row = button.closest(".sbs-modifier"); row.open = !row.open;
      return;
    }
    if (!app.isEditable) return;
    const action = button.dataset.modifierAction;
    if (action === "pickLibrary") return setting.openModifierLibrary({item: app.document});
    const raise = button.closest(".sbp-raise");
    const isRaise = Boolean(raise || action === "addRaise");
    const id = library?.modifier.id ?? (raise ?? button.closest(".sbs-modifier"))?.dataset.id;
    if (action === "remove") {
      try {
        const modifier = getLocalModifiers(app.document).find(row => row.id === id);
        if (!modifier || !await foundry.applications.api.DialogV2.confirm({
          classes: ["sbp-dialog"], window: {title: "Remove modifier"}, rejectClose: false,
          content: `<p>Remove “${escapeHTML(modifier.name)}” from this power?</p>`
        })) return;
        await pending.get(app.document.uuid)?.catch(() => {});
        await savePowerModifiers(app.document, getLocalModifiers(app.document).filter(row => row.id !== id));
      } catch (error) { ui.notifications.error(error.message); }
      return;
    }
    if (action === "saveToLibrary") {
      try {
        await pending.get(app.document.uuid);
        await setting.saveModifierToLibrary(app.document, id);
      } catch (error) { ui.notifications.error(error.message); }
      return;
    }
    const option = () => ({id: foundry.utils.randomID(), label: "", cost: 0});
    let added;
    if (action === "addBehavior") {
      const types = Object.entries(BEHAVIORS).filter(([, def]) => !def.code || game.user.isGM);
      added = await foundry.applications.api.DialogV2.prompt({classes: ["sbp-dialog"], window: {title: "Add power behavior"}, rejectClose: false,
        content: `<label>Behavior <select name="behavior">${types.map(([key, def]) => `<option value="${key}">${escapeHTML(def.label)}</option>`).join("")}</select></label>`,
        ok: {label: "Add", callback: (_event, target) => target.form.elements.behavior.value}});
      if (!added || !section.isConnected) return;
    }
    if (action === "pickBehaviorEffect") {
      try {
        const value = await pickEffect();
        if (!value || !section.isConnected) return;
        button.previousElementSibling.value = value;
        await save(isRaise);
      } catch (error) { ui.notifications.error(error.message); }
      return;
    }
    let effectSource;
    const effectIndex = Number(button.dataset.effectIndex);
    if (action === "editBehaviorEffect") {
      try {
        const behavior = storedChanges.get(button.closest(".sbp-power-behavior").dataset.id);
        effectSource = await effectsAPI()?.editEffectSource(behavior.system.effects?.[effectIndex], `${app.document?.name ?? library.modifier.name} — Caster Effect`);
        if (!effectSource || !section.isConnected) return;
      } catch (error) { ui.notifications.error(error.message); return; }
    }
    void save(isRaise, definitions => {
      const variant = definitions.find(entry => entry.id === id);
      switch (action) {
        case "add": definitions.push({id: foundry.utils.randomID(), name: "New modifier", description: "", options: [option()]}); break;
        case "addRaise": definitions.push({id: foundry.utils.randomID(), level: Math.max(0, ...definitions.map(row => row.level)) + 1, changes: []}); break;
        case "removeRaise": definitions.splice(definitions.indexOf(variant), 1); break;
        case "addOption": variant.options.push(option()); break;
        case "removeOption":
          if (variant.options.length > 1) variant.options = variant.options.filter(o => o.id !== button.closest(".sbs-cost-option").dataset.id);
          break;
        case "addBehavior":
        case "moveBehaviorUp":
        case "moveBehaviorDown":
        case "editBehaviorEffect":
        case "removeBehaviorEffect":
        case "removeBehavior": {
          const parent = isRaise ? variant : variant.options.find(o => o.id === (library?.optionId ?? button.closest(".sbp-modifier-option").dataset.optionId));
          if (added) {
            const id = foundry.utils.randomID();
            parent.changes.push({id, type: added, enabled: true, label: "", system: behaviorSystem(added, field => field.value)});
            state.expandedDetails.add(id);
          } else {
            const index = parent.changes.findIndex(change => change.id === button.closest(".sbp-power-behavior").dataset.id);
            if (index < 0) break;
            if (action === "removeBehavior") parent.changes.splice(index, 1);
            else if (action === "editBehaviorEffect" || action === "removeBehaviorEffect") {
              const effects = [...(parent.changes[index].system.effects ?? [])];
              if (action === "removeBehaviorEffect") effects.splice(effectIndex, 1);
              else if (Number.isInteger(effectIndex)) effects[effectIndex] = effectSource;
              else effects.push(effectSource);
              parent.changes[index].system.effects = effects;
            } else {
              const next = index + (action === "moveBehaviorUp" ? -1 : 1);
              if (next >= 0 && next < parent.changes.length) [parent.changes[index], parent.changes[next]] = [parent.changes[next], parent.changes[index]];
            }
          }
          break;
        }
      }
    });
  });
}

const descriptionLayouts = new WeakMap();

export function alignModifierDescription(app, root) {
  descriptionLayouts.get(app)?.disconnect();
  descriptionLayouts.delete(app);
  const container = root.querySelector(".sbp-readonly-summary");
  const heading = root.querySelector(".sheet-sidebar .additional-stats-header");
  const divider = heading?.previousElementSibling;
  if (!container || !divider?.matches("hr")) return;

  const align = () => {
    if (!container.getClientRects().length) return;
    const offset = divider.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.style.setProperty("--sbp-description-split", `${offset}px`);
  };
  const observer = new ResizeObserver(align);
  observer.observe(container);
  for (const child of heading.parentElement.children) observer.observe(child);
  descriptionLayouts.set(app, observer);
  align();
}

export function installModifierDescriptionHook() {
  Hooks.on("closeApplicationV2", app => {
    descriptionLayouts.get(app)?.disconnect();
    descriptionLayouts.delete(app);
  });
  Hooks.on("preCreateItem", item => {
    const patch = templateModifierPatch(item);
    if (!patch) return;
    const modifiers = patch[POWER_MODIFIERS] ?? readPowerFlag(item, "powerModifiers");
    if (modifiers?.length) patch["system.description"] = descriptionWithModifiers(item._source.system.description, modifiers);
    item.updateSource(patch);
  });
  Hooks.on("preUpdateItem", (item, changed) => {
    if (item.type !== "power") return;
    syncTemplateModifierUpdate(item, changed);
    const path = POWER_MODIFIERS;
    const modifiers = changed[path] ?? foundry.utils.getProperty(changed, path) ?? readPowerFlag(item, "powerModifiers");
    const description = changed["system.description"] ?? changed.system?.description;
    if (modifiers && (description !== undefined || changed[path] || foundry.utils.getProperty(changed, path))) {
      changed["system.description"] = descriptionWithModifiers(description ?? item._source.system.description, modifiers);
      if (changed.system) delete changed.system.description;
    }
  });
}

export function enableLibraryDrop(app, root) {
  if (!app.isEditable || root.dataset.sbpLibraryDrop) return;
  root.dataset.sbpLibraryDrop = "true";
  const setting = settingAPI();
  root.addEventListener("dragover", event => {
    if (!setting.hasModifierDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  root.addEventListener("drop", event => {
    if (!setting.hasModifierDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const drop = setting.readModifierDrag(event);
    if (drop?.source === "library" && drop.id) void setting.applyLibraryModifier(app.document, drop.id).catch(error => ui.notifications.error(error.message));
  }, {capture: true});
}
