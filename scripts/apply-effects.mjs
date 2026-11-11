import {MODULE_ID, report} from "./constants.mjs";
import {getModifiers} from "./powers-data.mjs";
import {castSuccesses, getCast} from "./cast-results.mjs";
import {effectReference, pickEffect, prepareEffect, resolveReference} from "./effect-sources.mjs";

const FLAG = "applyEffects";
const QUERY = `${MODULE_ID}.applyCastEffect`;
const TEMPLATE = `modules/${MODULE_ID}/templates/apply-effects.hbs`;
const OPTIONS_TEMPLATE = `modules/${MODULE_ID}/templates/effect-cast-options.hbs`;
async function effectPreview(reference) {
  if (reference.startsWith("status:")) {
    const status = CONFIG.statusEffects.find(status => status.id === reference.slice(7));
    return {name: game.i18n.localize(status?.name ?? status?.label ?? reference), img: status?.img ?? status?.icon};
  }
  const effect = await foundry.utils.fromUuid(reference).catch(() => null);
  return {name: effect?.name ?? "Missing effect", img: effect?.img};
}

const effectReferences = value => (Array.isArray(value) ? value : [value]).filter(reference => typeof reference === "string" && reference);

function effectConfig(item) {
  const config = item.getFlag(MODULE_ID, FLAG) ?? {};
  return {
    base: effectReferences(config.base), raised: effectReferences(config.raised),
    modifiers: getModifiers(item).map(modifier => ({
      id: modifier.id, name: modifier.name, options: modifier.options.map(option => ({
        id: option.id, name: option.label || modifier.name, slot: `modifiers.${modifier.id}.${option.id}`,
        references: effectReferences(config.modifiers?.[modifier.id]?.[option.id])
      }))
    }))
  };
}

function castChoices(message, cast) {
  const saved = message.getFlag(MODULE_ID, "effectChoices");
  if (saved?.messageId === message.id) return saved;
  return {raised: castSuccesses(message, cast) > 1, modifierOptions: cast.modifierOptions ?? {}};
}

function chosenReferences(config, choices) {
  const primary = choices.raised && config.raised.length ? config.raised : config.base;
  const modifiers = config.modifiers.flatMap(modifier => modifier.options
    .filter(option => option.id === choices.modifierOptions?.[modifier.id]).flatMap(option => option.references));
  return [...new Set([...primary, ...modifiers])];
}

const editorAccordions = new WeakMap();
const pendingEdits = new WeakMap();

async function saveEffectRow(item, row, next) {
  if (!row.isConnected) return;
  const slot = row.closest("[data-effect-slot]").dataset.effectSlot;
  const previous = row.dataset.reference;
  const save = (pendingEdits.get(item) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const config = item.getFlag(MODULE_ID, FLAG) ?? {};
    const references = effectReferences(foundry.utils.getProperty(config, slot));
    const index = references.indexOf(previous);
    if (references.includes(next) || (previous && index === -1)) return;
    if (!previous) references.push(next);
    else if (next) references[index] = next;
    else references.splice(index, 1);
    await item.setFlag(MODULE_ID, `${FLAG}.${slot}`, references);
  });
  pendingEdits.set(item, save);
  return save;
}

async function renderEffectEditor(app, root) {
  const item = app.document;
  if (item?.type !== "power" || item.documentName !== "Item" || !app.isEditable) return;
  const properties = root.querySelector('section[data-tab="properties"]');
  if (!properties || properties.querySelector(".sbp-apply-effects")) return;
  const anchor = properties.querySelector('[name="system.actions.dmgMod"]')?.closest(".form-group");
  const section = document.createElement("fieldset");
  section.className = "sbp-apply-effects";
  if (anchor) anchor.after(section);
  else properties.append(section);
  const config = effectConfig(item);
  section.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, config);
  const accordions = editorAccordions.get(app) ?? new Set();
  editorAccordions.set(app, accordions);
  for (const details of section.querySelectorAll("[data-effect-accordion]")) {
    const key = details.dataset.effectAccordion;
    details.open = accordions.has(key);
    details.addEventListener("toggle", () => { if (details.open) accordions.add(key); else accordions.delete(key); });
  }
  for (const row of section.querySelectorAll(".sbp-effect-slot")) {
    const reference = row.dataset.reference;
    if (reference) void effectPreview(reference).then(({name, img}) => {
      const field = row.querySelector(".sbp-effect-name");
      field.value = field.title = name;
      const icon = row.querySelector(".sbp-effect-icon img");
      icon.src = img || "icons/svg/aura.svg";
      icon.hidden = false;
    }).catch(report);
    row.querySelector(".sbp-pick-effect").addEventListener("click", async () => {
      try { const value = await pickEffect(); if (value) await saveEffectRow(item, row, value); }
      catch (error) { report(error); }
    });
    row.querySelector(".sbp-clear-effect")?.addEventListener("click", () => { void saveEffectRow(item, row, "").catch(report); });
    row.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); });
    row.addEventListener("drop", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (!["ActiveEffect", "Item"].includes(data.type) || !data.uuid) return;
      void foundry.utils.fromUuid(data.uuid).then(doc => {
        const reference = effectReference(doc);
        if (!reference) throw new Error("Drop an Active Effect or an Item containing effects.");
        return saveEffectRow(item, row, reference);
      }).catch(report);
    });
  }
}

async function applyCastEffects({messageId, tokenUuid, choices}, {user}) {
  const message = game.messages.get(messageId);
  const cast = message && getCast(message);
  if (!cast || (!user.isGM && (message.author.id !== user.id || message.blind))) throw new Error("You cannot apply effects from this casting roll.");
  const [item, token] = await Promise.all([foundry.utils.fromUuid(cast.itemUuid), foundry.utils.fromUuid(tokenUuid)]);
  if (item?.type !== "power" || item.actor?.uuid !== cast.actorUuid || !item.actor.testUserPermission(user, "OWNER")) throw new Error("You must own the caster.");
  if (token?.documentName !== "Token" || !token.actor || (!user.isGM && token.parent.id !== user.viewedScene)
    || (token.hidden && !token.testUserPermission(user, "OWNER"))) throw new Error("Choose a visible token.");
  const references = chosenReferences(effectConfig(item), choices);
  if (!references.length) throw new Error("No effect is configured for the selected cast options.");
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  const batches = await Promise.all(references.map(async reference => {
    const effects = await resolveReference(reference, user);
    return effects.map(effect => prepareEffect(effect.toObject(), {item, reference, start}));
  }));
  await token.actor.createEmbeddedDocuments("ActiveEffect", batches.flat());
  return true;
}

async function chooseOptions(item, config, choices) {
  const content = await foundry.applications.handlebars.renderTemplate(OPTIONS_TEMPLATE, {
    raised: choices.raised,
    hasRaise: Boolean(config.raised.length),
    modifiers: config.modifiers.filter(modifier => modifier.options.some(option => option.references.length)).map(modifier => ({
      ...modifier, enabled: modifier.options.some(option => option.references.length && choices.modifierOptions?.[modifier.id] === option.id),
      options: modifier.options.filter(option => option.references.length).map(option => ({
        ...option, selected: choices.modifierOptions?.[modifier.id] === option.id
      }))
    }))
  });
  return foundry.applications.api.DialogV2.prompt({classes: ["sbp-dialog"], window: {title: `Cast Options · ${item.name}`}, content,
    ok: {label: "Save", callback: (_event, button) => ({
      raised: button.form.elements.raised?.checked ?? false,
      modifierOptions: Object.fromEntries([...button.form.querySelectorAll("[data-effect-modifier]")]
        .filter(select => select.closest(".form-group").querySelector(".sbp-use-modifier").checked)
        .map(select => [select.dataset.effectModifier, select.value]))
    })}, rejectClose: false});
}

const localChoices = new WeakMap();
function renderEffectControls(message, html) {
  const cast = getCast(message);
  if (!cast || !message.isContentVisible || (!message.isAuthor && !game.user.isGM)) return;
  const item = foundry.utils.fromUuidSync(cast.itemUuid);
  if (item?.type !== "power" || !item.actor?.isOwner) return;
  const config = effectConfig(item);
  const variants = Boolean(config.raised.length || config.modifiers.some(modifier => modifier.options.some(option => option.references.length)));
  if (!config.base.length && !variants) return;
  const content = html.querySelector(".message-content");
  if (!content || content.querySelector(".sbp-effect-controls")) return;
  const group = document.createElement("div");
  group.className = "card-buttons flexrow sbp-effect-controls";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply Effect";
  const options = document.createElement("button");
  options.type = "button";
  options.textContent = "Cast Options";
  let choices = localChoices.get(message) ?? castChoices(message, cast);
  let busy = false;
  const refresh = () => { apply.disabled = busy || !chosenReferences(config, choices).length; options.disabled = busy || !variants; };
  const run = action => async event => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || !message.isContentVisible) return;
    busy = true;
    refresh();
    try { await action(); }
    catch (error) { report(error); }
    finally { busy = false; refresh(); }
  };
  apply.addEventListener("click", run(async () => {
    const target = game.user.targets.first() ?? canvas.tokens?.controlled[0];
    if (!target?.actor) throw new Error("Target or select a token first.");
    const request = {messageId: message.id, tokenUuid: target.document.uuid, choices};
    if (target.actor.isOwner) await applyCastEffects(request, {user: game.user});
    else if (game.users.activeGM) await game.users.activeGM.query(QUERY, request);
    else throw new Error("An active GM is needed to apply effects to a token you do not own.");
  }));
  options.addEventListener("click", run(async () => {
    const next = await chooseOptions(item, config, choices);
    if (!next) return;
    if (message.isOwner) await message.setFlag(MODULE_ID, "effectChoices", {...next, messageId: message.id});
    else localChoices.set(message, next);
    choices = next;
  }));
  group.append(apply, options);
  refresh();
  (content.querySelector(".swade-hud-power-cast") ?? content).append(group);
}

export function installApplyEffects() {
  CONFIG.queries[QUERY] = (request, context) => {
    if (!game.user.isGM) throw new Error("Only a GM can apply effects for other users.");
    return applyCastEffects(request, context);
  };
  Hooks.on("renderApplicationV2", (app, html) => { void renderEffectEditor(app, html).catch(report); });
  Hooks.on("renderChatMessageHTML", renderEffectControls);
}
