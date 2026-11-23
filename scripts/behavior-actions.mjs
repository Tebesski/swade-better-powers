import {EFFECTS_ID, MODULE_ID, effectsAPI, normalizeName, report} from "./constants.mjs";
import {isActionBehavior, selectedBehaviors} from "./behavior-data.mjs";
import {runPowerCode} from "./behavior-code.mjs";
import {effectBehaviorSources, prepareEffectSources} from "./effect-sources.mjs";
import {isDurationTracker} from "./maintenance.mjs";
import {getModifiers, getPowerRaises} from "./powers-data.mjs";
import {findCastMessage, RESOLVED_BEHAVIORS} from "./cast-history.mjs";

export function castBehaviors(item, choices = {}, available = Object.keys(choices).length ? getModifiers(item) : []) {
  const withSource = (changes, source) => (changes ?? []).map(change => ({source, change}));
  const modifiers = available.flatMap(modifier => {
    const selected = choices?.[modifier.id];
    const option = modifier.options.find(row => row.id === selected);
    if (!option) return [];
    return withSource(option.changes, option.label ? `${modifier.name} · ${option.label}` : modifier.name);
  });
  const raises = getPowerRaises(item).map(({level, changes}) => ({level, active: changes.some(change => change.enabled),
    changes: withSource(changes, `Raised ${level}`)}));
  return {modifiers, raises};
}

async function addEffect(entry, {actor, item}) {
  const sources = await prepareEffectSources(effectBehaviorSources(entry.system), {item, user: game.user});
  if (sources.length) await actor.createEmbeddedDocuments("ActiveEffect", sources);
}

async function removeEffect(entry, {actor}) {
  const reference = entry.system.effect.trim();
  if (!reference) return;
  const status = normalizeName(reference.replace(/^status:/i, ""));
  const source = reference.includes(".") ? await foundry.utils.fromUuid(reference).catch(() => null) : null;
  const name = normalizeName(source?.name ?? reference);
  const ids = actor.effects.filter(effect => !isDurationTracker(effect) && (effect.uuid === reference || effect.origin === reference
    || effect.getFlag(EFFECTS_ID, "templateUuid") === reference || effect.getFlag("swade-better-templates", "effectReference") === reference
    || effect.statuses.has(status) || normalizeName(effect.name) === name
    || effectsAPI()?.getFlags(effect)?.some(flag => normalizeName(flag) === name))).map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

async function chatMessage(entry, {actor, item, message, token}) {
  const {text, rollMode} = entry.system;
  if (!text.trim()) return;
  const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {relativeTo: item});
  const speaker = ChatMessage.getSpeaker({actor, token: token?.document ?? token});
  const data = {content, speaker};
  if (rollMode === "inherit") {
    data.whisper = [...message.whisper];
    data.blind = message.blind;
    await ChatMessage.create(data);
    return;
  }
  const messageMode = {publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self"}[rollMode];
  await ChatMessage.create(data, {messageMode});
}

const actions = {addEffect, removeEffect, chatMessage, executeMacro: runPowerCode, executeScript: runPowerCode};
export async function runCastBehaviors(message, cast, earned) {
  if (message.author?.id !== game.user.id) return;
  const item = await foundry.utils.fromUuid(cast.itemUuid);
  const actor = item?.actor;
  if (item?.type !== "power" || !actor?.isOwner || actor.uuid !== cast.actorUuid || actor.items.get(item.id) !== item) return;
  const chosen = selectedBehaviors(castBehaviors(item, cast.modifierOptions), earned, isActionBehavior);
  if (!chosen.length || findCastMessage(RESOLVED_BEHAVIORS, cast.id)) return;
  // Record the first successful execution before side effects can create further messages or roll updates.
  await message.setFlag(MODULE_ID, RESOLVED_BEHAVIORS, cast.id);
  const speakerToken = game.scenes.get(message.speaker.scene)?.tokens.get(message.speaker.token);
  const token = actor.token ?? (speakerToken?.actor?.uuid === actor.uuid ? speakerToken : undefined);
  const context = {actor, item, message, token: token?.object ?? token, roll: message.rolls.find(roll => !roll.isCritFailConfirmationRoll), cast};
  for (const {change} of chosen) {
    try { await actions[change.type](change, context); }
    catch (error) { report(error); }
  }
}
