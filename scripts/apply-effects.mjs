import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID, report} from "./constants.mjs";
import {castEffectTargetUuids} from "./effect-targets.mjs";
import {usesTargetRows} from "../../swade-better-setting/scripts/chat-target-data.mjs";
import {getModifiers, getPowerRaises} from "./powers-data.mjs";
import {EFFECT_MODES, isChatEffect} from "./behavior-data.mjs";
import {castSuccesses, getCast, powerDuration} from "./cast-results.mjs";
import {noPP} from "./powers-data.mjs";
import {trackPowerDuration} from "./maintenance.mjs";
import {durationRates, resolvePowerDuration} from "./durations.mjs";
import {effectBehaviorSources, effectReference, pickEffect, prepareEffectSources} from "./effect-sources.mjs";

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
  return {name: effect?.name ?? sbsI18n("swade-better-powers.UI.Missingeffect_786c40e6d2"), img: effect?.img};
}

const effectReferences = value => (Array.isArray(value) ? value : [value]).filter(reference => typeof reference === "string" && reference);
const referenceSources = references => references.map(reference => ({reference}));

function linkedEffects(changes = []) {
  return changes.filter(change => change.enabled && isChatEffect(change)).flatMap(({system}) => {
    const sources = effectBehaviorSources(system);
    return sources.length ? [{sources, mode: system.mode}] : [];
  });
}

function effectConfig(item) {
  const config = item.getFlag(MODULE_ID, FLAG) ?? {};
  const raised = effectReferences(config.raised);
  const raises = getPowerRaises(item).map(({level, changes}) => ({level, effects: linkedEffects(changes)}))
    .filter(raise => raise.effects.length);
  return {
    base: effectReferences(config.base), raised, raises,
    raiseLevels: [...new Set([...(raised.length ? [1] : []), ...raises.map(raise => raise.level)])].sort((a, b) => a - b),
    raisedMode: config.modes?.raised ?? "replace", modes: EFFECT_MODES,
    modifiers: getModifiers(item).map(modifier => ({
      id: modifier.id, name: modifier.name, options: modifier.options.map(option => {
        const slot = `modifiers.${modifier.id}.${option.id}`;
        const references = effectReferences(config.modifiers?.[modifier.id]?.[option.id]);
        const linked = linkedEffects(option.changes);
        const savedMode = config.modes?.modifiers?.[modifier.id]?.[option.id];
        const modeOptions = linked.length ? {inherit: sbsI18n("swade-better-powers.UI.UseModRaisesettings_3f26a743ee"), ...EFFECT_MODES} : EFFECT_MODES;
        const modeSelection = Object.hasOwn(modeOptions, savedMode) ? savedMode : Object.keys(modeOptions)[0];
        const inheritedMode = linked.some(effect => effect.mode === "replace") ? "replace" : "add";
        return {id: option.id, name: option.label || modifier.name, slot, references, linked,
          hasEffects: references.length > 0 || linked.length > 0,
          mode: modeSelection === "inherit" ? inheritedMode : modeSelection, modeSelection, modeOptions};
      })
    }))
  };
}

function castChoices(message, cast, config) {
  const earnedRaises = castSuccesses(message, cast) - 1;
  const earned = config.raiseLevels.findLast(level => level <= earnedRaises) ?? 0;
  const saved = message.getFlag(MODULE_ID, "effectChoices");
  if (saved?.messageId === message.id) {
    return {...saved, raise: saved.raise ?? (saved.raised ? earned || config.raiseLevels[0] || 0 : 0)};
  }
  return {raise: earned, modifierOptions: cast.modifierOptions ?? {}};
}

function chosenEffects(config, choices) {
  const selectedRaise = choices.raise ?? (choices.raised ? 1 : 0);
  const raised = selectedRaise > 0 ? config.raised : [];
  const linkedRaise = config.raises.findLast(raise => raise.level <= selectedRaise)?.effects ?? [];
  const replaceBase = (raised.length && config.raisedMode === "replace") || linkedRaise.some(effect => effect.mode === "replace");
  const modifiers = config.modifiers.flatMap(modifier => modifier.options.filter(option =>
    option.hasEffects && option.id === choices.modifierOptions?.[modifier.id]));
  const primary = modifiers.some(option => option.mode === "replace") ? [] : [
    ...referenceSources(replaceBase ? [] : config.base), ...referenceSources(raised), ...linkedRaise.flatMap(effect => effect.sources)
  ];
  const sources = [...primary, ...modifiers.flatMap(option => [
    ...referenceSources(option.references), ...option.linked.flatMap(effect => effect.sources)
  ])];
  // Keep one copy of a reference. Prefer the behavior's custom duration when the reference is also in Properties.
  const unique = new Map();
  for (const source of sources) {
    const key = source.reference ?? source;
    if (!unique.has(key) || source.enable) unique.set(key, source);
  }
  return [...unique.values()];
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
  section.addEventListener("change", event => {
    const mode = event.target.closest("[data-effect-mode]");
    if (!mode) return;
    event.stopPropagation();
    void item.setFlag(MODULE_ID, `${FLAG}.modes.${mode.dataset.effectMode}`, mode.value).catch(report);
  });
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
        if (!reference) throw new Error(sbsI18n("swade-better-powers.UI.DropanActiveEffectoran_47fa50aa22"));
        return saveEffectRow(item, row, reference);
      }).catch(report);
    });
  }
}

async function applyCastEffects({messageId, tokenUuid, choices}, {user}) {
  const message = game.messages.get(messageId);
  const cast = message && getCast(message);
  if (!cast || (!user.isGM && (message.author.id !== user.id || message.blind))) throw new Error(sbsI18n("swade-better-powers.UI.Youcannotapplyeffectsfromthis_2fa62b5b03"));
  const [item, token] = await Promise.all([foundry.utils.fromUuid(cast.itemUuid), foundry.utils.fromUuid(tokenUuid)]);
  if (item?.type !== "power" || item.actor?.uuid !== cast.actorUuid || !item.actor.testUserPermission(user, "OWNER")) throw new Error(sbsI18n("swade-better-powers.UI.Youmustownthecaster_36633aaa51"));
  if (token?.documentName !== "Token" || !token.actor || (!user.isGM && token.parent.id !== user.viewedScene)
    || (token.hidden && !token.testUserPermission(user, "OWNER"))) throw new Error(sbsI18n("swade-better-powers.UI.Chooseavisibletoken_c9843ea508"));
  const scene = game.scenes.get(message.speaker?.scene) ?? canvas.scene;
  if (!castEffectTargetUuids(message, scene).includes(tokenUuid)) throw new Error(sbsI18n("swade-better-powers.UI.Thistokenwasnottargetedby_9ad1fe3e48"));
  const sources = chosenEffects(effectConfig(item), choices);
  if (!sources.length) throw new Error(sbsI18n("swade-better-powers.UI.Noeffectisconfiguredforthe_42ae681624"));
  const successes = castSuccesses(message, cast);
  const duration = (cast.noPP || noPP(item))
    ? resolvePowerDuration(cast.duration ?? powerDuration(item), cast.durationChanges, Math.max(0, successes - 1), durationRates()) : null;
  if (duration) await trackPowerDuration(message, {...cast, duration}, {restoreMissing: true});
  const timer = duration && item.actor.effects.get(cast.id);
  const effects = await prepareEffectSources(sources, {item, user});
  if (timer) for (const effect of effects) {
    effect.flags ??= {};
    effect.flags[MODULE_ID] = {...effect.flags[MODULE_ID], powerTimer: timer.uuid};
    effect.start = timer.toObject().start;
    effect.duration = {...timer.toObject().duration, expired: false};
  }
  await token.actor.createEmbeddedDocuments("ActiveEffect", effects);
  return true;
}

async function chooseOptions(item, config, choices) {
  const content = await foundry.applications.handlebars.renderTemplate(OPTIONS_TEMPLATE, {
    raised: choices.raise > 0,
    hasRaise: config.raiseLevels.length > 0,
    raiseOptions: config.raiseLevels.some(level => level > 1) ? Object.fromEntries([[0, sbsI18n("swade-better-powers.UI.Normal_a7248eeb45")], ...config.raiseLevels.map(level => [level, `Raised ${level}`])]) : null,
    raise: choices.raise,
    modifiers: config.modifiers.filter(modifier => modifier.options.some(option => option.hasEffects)).map(modifier => ({
      ...modifier, enabled: modifier.options.some(option => option.hasEffects && choices.modifierOptions?.[modifier.id] === option.id),
      options: modifier.options.filter(option => option.hasEffects).map(option => ({
        ...option, selected: choices.modifierOptions?.[modifier.id] === option.id
      }))
    }))
  });
  return foundry.applications.api.DialogV2.prompt({classes: ["sbp-dialog"], window: {title: sbsI18n("swade-better-powers.UI.CastOptions_64a5046db6", {p0: (item.name)})}, content,
    ok: {label: sbsI18n("swade-better-powers.UI.Save_1509f561f2"), callback: (_event, button) => ({
      raise: Number(button.form.elements.raise?.value ?? (button.form.elements.raised?.checked ? 1 : 0)),
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
  if (!usesTargetRows({item, context: message.getFlag("swade-better-effects", "context") ?? {}})) return;
  const config = effectConfig(item);
  const variants = Boolean(config.raiseLevels.length || config.modifiers.some(modifier => modifier.options.some(option => option.hasEffects)));
  if (!config.base.length && !variants) return;
  const content = html.querySelector(".message-content");
  if (!content || content.querySelector(".sbp-effect-controls")) return;
  const group = document.createElement("div");
  group.className = "card-buttons flexrow sbp-effect-controls";
  const scene = game.scenes.get(message.speaker?.scene) ?? canvas.scene;
  const targets = castEffectTargetUuids(message, scene).map(uuid => foundry.utils.fromUuidSync(uuid))
    .filter(token => token?.actor && (!token.hidden || game.user.isGM || token.isOwner));
  let rows = content.querySelector(".sbe-target-responses");
  if (!rows && targets.length) {
    rows = document.createElement("section"); rows.className = "sbe-target-responses sbp-effect-targets"; content.append(rows);
  }
  const applyControls = [];
  for (const token of targets) {
    let row = [...rows.querySelectorAll(".sbe-target-row")].find(row => row.dataset.tokenUuid === token.uuid);
    if (!row) {
      row = document.createElement("div"); row.className = "sbe-target-row"; row.dataset.tokenUuid = token.uuid;
      const name = document.createElement("span"); name.className = "sbe-target-name";
      const portrait = document.createElement("img"); portrait.src = token.texture.src; portrait.alt = "";
      name.append(portrait, token.name);
      const controls = document.createElement("span"); controls.className = "sbe-target-controls";
      row.append(name, controls); rows.append(row);
    }
    const apply = document.createElement("a");
    apply.className = "sbp-apply-target-effect"; apply.dataset.tokenUuid = token.uuid;
    apply.setAttribute("role", "button"); apply.tabIndex = 0;
    apply.setAttribute("aria-label", sbsI18n("swade-better-powers.UI.Applyeffectto_99a7a884ca", {p0: (token.name)})); apply.dataset.tooltipText = sbsI18n("swade-better-powers.UI.Applyeffectto_99a7a884ca", {p0: (token.name)});
    const icon = document.createElement("i"); icon.className = "fa-solid fa-wand-magic-sparkles"; apply.append(icon);
    row.querySelector(".sbe-target-controls").prepend(apply); applyControls.push(apply);
  }
  const options = document.createElement("button");
  options.type = "button";
  options.textContent = sbsI18n("swade-better-powers.UI.CastOptions_ac5c378894");
  let choices = localChoices.get(message) ?? castChoices(message, cast, config);
  let busy = false;
  const refresh = () => {
    for (const apply of applyControls) apply.setAttribute("aria-disabled", String(busy || !chosenEffects(config, choices).length));
    options.disabled = busy || !variants;
  };
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
  for (const apply of applyControls) {
    const handler = run(async () => {
      if (!chosenEffects(config, choices).length) return;
      const token = foundry.utils.fromUuidSync(apply.dataset.tokenUuid);
      if (!token?.actor) throw new Error(sbsI18n("swade-better-powers.UI.Thistargetisnolongeravailable_b7ae36984d"));
      const request = {messageId: message.id, tokenUuid: token.uuid, choices};
      if (token.actor.isOwner) await applyCastEffects(request, {user: game.user});
      else if (game.users.activeGM) await game.users.activeGM.query(QUERY, request);
      else throw new Error(sbsI18n("swade-better-powers.UI.AnactiveGMisneededto_c758fbf44c"));
    });
    apply.addEventListener("click", handler);
    apply.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) void handler(event); });
  }
  options.addEventListener("click", run(async () => {
    const next = await chooseOptions(item, config, choices);
    if (!next) return;
    if (message.isOwner) await message.setFlag(MODULE_ID, "effectChoices", {...next, messageId: message.id});
    else localChoices.set(message, next);
    choices = next;
  }));
  if (variants) group.append(options);
  refresh();
  (content.querySelector(".swade-hud-power-cast") ?? content).append(group);
}

export function installApplyEffects() {
  CONFIG.queries[QUERY] = (request, context) => {
    if (!game.user.isGM) throw new Error(sbsI18n("swade-better-powers.UI.OnlyaGMcanapplyeffects_f2439b256e"));
    return applyCastEffects(request, context);
  };
  Hooks.on("renderApplicationV2", (app, html) => { void renderEffectEditor(app, html).catch(report); });
  Hooks.on("renderChatMessageHTML", renderEffectControls);
}
