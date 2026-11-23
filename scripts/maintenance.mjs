import {t as sbsI18n} from "./i18n.mjs";
import {EFFECTS_ID, MAINTENANCE, MODULE_ID, report, wrapMethod} from "./constants.mjs";
import {DURATION_UNITS, durationRates} from "./durations.mjs";
import {findCastMessage, MAINTAINED_CAST} from "./cast-history.mjs";

const timing = effect => effect.flags?.[MODULE_ID]?.timedPower;
const legacy = effect => !timing(effect) && effect.flags?.[MODULE_ID]?.maintenance === true;
const linkedTimer = effect => effect.flags?.[MODULE_ID]?.powerTimer;
function* linkedEffects(timer) {
  const uuid = timer.uuid;
  for (const actor of game.actors) yield* actor.effects.filter(effect => linkedTimer(effect) === uuid);
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (token.actorLink || !token.delta?.effects?.some(effect => linkedTimer(effect) === uuid)) continue;
    if (token.actor) yield* token.actor.effects.filter(effect => linkedTimer(effect) === uuid);
  }
}
export const isPowerTimer = effect => Boolean(timing(effect) || legacy(effect));
export const isDurationTracker = effect => legacy(effect) || Boolean(timing(effect) && !effect.flags[MODULE_ID].maintenance);
export const timerName = effect => timing(effect)?.name ?? effect.name.replace(/^Maintining: /, "");

export async function createPowerTimer(item, duration, {id, userId = game.user.id} = {}) {
  const actor = item?.actor;
  if (item?.type !== "power" || !actor?.isOwner || actor.items.get(item.id) !== item) throw new Error(sbsI18n("swade-better-powers.UI.Youmustownthepowers_e36af877e2"));
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    _id: id, name: sbsI18n("swade-better-powers.UI.Powerduration_73d79ff70b"), type: "base", img: item.img, origin: item.uuid, transfer: false,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER, duration,
    flags: {[MODULE_ID]: {timedPower: {name: item.name, userId}}, [EFFECTS_ID]: {excludedTags: ["power-duration"]}}
  }], {keepId: Boolean(id), animate: false});
  return effect;
}

export async function trackPowerDuration(message, cast, {restoreMissing = false} = {}) {
  const item = await foundry.utils.fromUuid(cast.itemUuid);
  const actor = item?.actor;
  if (!actor?.isOwner || actor.uuid !== cast.actorUuid) return;
  if (actor.effects.has(cast.id) || (!restoreMissing && findCastMessage(MAINTAINED_CAST, cast.id))) return;
  const effect = await createPowerTimer(item, cast.duration, {id: cast.id, userId: message.author.id});
  if (effect) await message.setFlag(MODULE_ID, MAINTAINED_CAST, cast.id);
}

let timerUuids;
function indexTimer(effect) {
  if (isPowerTimer(effect) && effect.actor?.uuid === effect.parent?.uuid) timerUuids.add(effect.uuid);
}

function timerIndex() {
  if (timerUuids) return timerUuids;
  timerUuids = new Set();
  for (const actor of game.actors) for (const effect of actor.effects) indexTimer(effect);
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (token.actorLink || !token.delta?.effects?.some(isPowerTimer)) continue;
    for (const effect of token.actor?.effects ?? []) indexTimer(effect);
  }
  return timerUuids;
}

function* timedEffects() {
  for (const uuid of timerIndex()) {
    const effect = foundry.utils.fromUuidSync(uuid);
    if (effect?.actor?.isOwner && isPowerTimer(effect)) yield effect;
  }
}

function promptUser(effect) {
  const caster = game.users.get(timing(effect).userId);
  if (caster && effect.actor.testUserPermission(caster, "OWNER")) return caster;
  return game.users.getDesignatedUser(user => user.active && effect.actor.testUserPermission(user, "OWNER"));
}

export function powerDurationEnded(effect) {
  const {remaining} = effect.updateDuration();
  if (remaining > 0) return false;
  const combat = effect.start?.combat ?? game.combat;
  if (!combat?.started) return true;
  // A round/time boundary can pass before the caster acts. Wait for their turn,
  // including overdue timers and powers cast during someone else's turn.
  const casters = combat.getCombatantsByActor(effect.actor);
  if (!casters.length) return true;
  return Number.isInteger(combat.turn) && casters.includes(combat.turns[combat.turn]);
}

export function timerProgress(effect) {
  const {value, units} = effect.toObject().duration;
  const current = effect.updateDuration();
  const remaining = units === "rounds" && current.units === "rounds"
    ? current.remaining : current.secondsRemaining / durationRates()[units];
  return {value, units, elapsed: Math.max(0, value - remaining)};
}

export async function editPowerTimer(effect, {value, units, elapsed}) {
  if (!isPowerTimer(effect) || !effect.actor.isOwner || effect.actor.effects.get(effect.id) !== effect) return;
  if (!Object.hasOwn(DURATION_UNITS, units) || !Number.isSafeInteger(value) || value < 1 || !Number.isFinite(elapsed) || elapsed < 0) {
    throw new Error(sbsI18n("swade-better-powers.UI.Enterapositivewholedurationand_ec5ec3c580"));
  }
  const actor = effect.actor;
  const previousCombat = effect.start?.combat;
  const combat = previousCombat?.started ? previousCombat
    : game.combat?.started && game.combat.getCombatantsByActor(actor).length ? game.combat : null;
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart(combat);
  const rates = durationRates();
  if (units === "rounds" && combat?.started) {
    if (!Number.isSafeInteger(elapsed)) throw new Error(sbsI18n("swade-better-powers.UI.Enterelapsedcombatroundsasa_2a69b90bdc"));
    start.round = Math.max(1, combat.round - elapsed);
    if (previousCombat === combat && combat.combatants.has(effect.start.combatant)) {
      start.combatant = effect.start.combatant;
      start.turn = effect.start.turn;
    }
  }
  start.time -= Math.round(elapsed * rates[units]);
  await effect.update({start, duration: {value, units, expired: false}}, {animate: false});
}

let expirationPrompt;
async function resolveExpiration(effect) {
  if (effect.actor.effects.get(effect.id) !== effect) return;
  if (!effect.duration.expired) await effect.update({"duration.expired": true}, {animate: false});
  const {name} = timing(effect);
  const content = document.createElement("p");
  content.textContent = sbsI18n("swade-better-powers.UI.isexpiredYoucanchooseto_2e940635c3", {p0: (name)});
  const extend = await foundry.applications.api.DialogV2.confirm({
    classes: ["sbp-dialog"],
    window: {title: sbsI18n("swade-better-powers.UI.MaintainPower_26d14db7a4")}, content: content.outerHTML,
    yes: {label: sbsI18n("swade-better-powers.UI.Maintain_0f011be4a5"), default: false}, no: {label: sbsI18n("swade-better-powers.UI.LetExpire_6bc2322211"), default: true}, rejectClose: false,
    render: (_event, dialog) => {
      expirationPrompt = {effect, dialog};
      if (effect.actor.effects.get(effect.id) !== effect) void dialog.close().catch(report);
    }
  }).finally(() => { expirationPrompt = undefined; });
  if (effect.actor.effects.get(effect.id) !== effect || effect.disabled || !powerDurationEnded(effect)) return;
  if (!extend) {
    await effect.delete({animate: false});
    return;
  }
  const periods = Number(effect.flags[MODULE_ID].maintenance || 0) + 1;
  const tags = effect.flags[EFFECTS_ID]?.tags ?? [];
  await effect.update({
    name: sbsI18n("swade-better-powers.UI.Maintining_06bc144528", {p0: (name)}), showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.CONDITIONAL,
    start: CONFIG.ActiveEffect.documentClass.getEffectStart(), "duration.expired": false,
    [`flags.${MODULE_ID}.maintenance`]: periods,
    [`flags.${EFFECTS_ID}.tags`]: [...new Set([...tags, MAINTENANCE])]
  }, {animate: false});
  const {start, duration} = effect.toObject();
  for (const linked of linkedEffects(effect)) await linked.update({
    start, duration: {...duration, expired: false}
  }, {animate: false});
}

let checking = false;
async function checkExpiredPowers() {
  if (checking || !game.ready) return;
  checking = true;
  try {
    const timers = [...timedEffects()];
    for (const effect of timers) {
      if (legacy(effect) && game.user.isDesignated(user => user.active && effect.actor.testUserPermission(user, "OWNER"))) {
        const message = findCastMessage(MAINTAINED_CAST, effect.id);
        await effect.update({
          name: sbsI18n("swade-better-powers.UI.Powerduration_73d79ff70b"), showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER,
          [`flags.${MODULE_ID}.timedPower`]: {name: effect.name.replace(/^Maintining: /, ""), userId: message?.author?.id ?? null},
          [`flags.${MODULE_ID}.maintenance`]: 0,
          [`flags.${EFFECTS_ID}.tags`]: (effect.flags[EFFECTS_ID]?.tags ?? []).filter(tag => tag !== MAINTENANCE),
          [`flags.${EFFECTS_ID}.excludedTags`]: ["power-duration"]
        }, {animate: false});
      }
      if (timing(effect) && !isDurationTracker(effect) && !effect.disabled && !effect.duration.expired
        && game.users.activeGM?.isSelf && !promptUser(effect)?.active && powerDurationEnded(effect)) {
        await effect.update({"duration.expired": true}, {animate: false});
      }
    }
    let remaining = timers;
    for (;;) {
      const expired = remaining.find(effect => timing(effect) && !effect.disabled
        && promptUser(effect)?.isSelf && powerDurationEnded(effect));
      if (!expired) break;
      await resolveExpiration(expired);
      remaining = [...timedEffects()];
    }
  } finally {
    checking = false;
  }
}

export function installMaintenance() {
  // SWADE normally deletes expired effects. Keep our record until the caster answers, including across reconnects.
  const effectClass = CONFIG.ActiveEffect.documentClass.prototype;
  for (const method of [sbsI18n("swade-better-powers.UI.isExpiryEvent_ca8ff4b160"), sbsI18n("swade-better-powers.UI.handleTurnExpirations_4492e2f4ba")]) {
    if (typeof effectClass[method] !== "function") continue;
    wrapMethod(effectClass, method, function (original, ...args) {
      return !isPowerTimer(this) && !linkedTimer(this) && original(...args);
    });
  }
  wrapMethod(CONFIG.Actor.documentClass.prototype, "allApplicableEffects", function* (original, ...args) {
    for (const effect of original(...args)) if (!isDurationTracker(effect)) yield effect;
  });
  const check = () => { void checkExpiredPowers().catch(report); };
  for (const event of ["ready", "updateWorldTime", "updateCombat", "deleteCombat", "canvasReady"]) Hooks.on(event, check);
  // Rebuild when an actor or synthetic actor can be replaced in bulk.
  const invalidate = () => { timerUuids = undefined; };
  for (const event of ["createActor", "deleteActor", "createToken", "deleteToken", "createScene", "deleteScene"]) Hooks.on(event, invalidate);
  Hooks.on("updateActor", (_actor, changes) => { if (Object.hasOwn(changes, "effects")) invalidate(); });
  Hooks.on("updateActorDelta", (_delta, changes) => { if (Object.hasOwn(changes, "effects")) invalidate(); });
  Hooks.on("updateScene", (_scene, changes) => { if (Object.hasOwn(changes, "tokens")) invalidate(); });
  Hooks.on("updateToken", (_token, changes) => {
    if (Object.keys(changes).some(key => ["actorId", "actorLink", "delta"].includes(key.split(".")[0]))) invalidate();
  });
  Hooks.on("createActiveEffect", effect => { if (timerUuids) indexTimer(effect); });
  Hooks.on("updateActiveEffect", effect => {
    if (timerUuids) {
      timerUuids.delete(effect.uuid);
      indexTimer(effect);
    }
    if (!timing(effect)) return;
    if (expirationPrompt?.effect.uuid === effect.uuid && !powerDurationEnded(effect)) void expirationPrompt.dialog.close().catch(report);
    check();
  });
  Hooks.on("deleteActiveEffect", effect => {
    timerUuids?.delete(effect.uuid);
    if (expirationPrompt?.effect.uuid === effect.uuid) void expirationPrompt.dialog.close().catch(report);
    if (isPowerTimer(effect) && game.users.activeGM?.isSelf) {
      for (const linked of linkedEffects(effect)) void linked.delete({animate: false}).catch(report);
    }
  });
}
