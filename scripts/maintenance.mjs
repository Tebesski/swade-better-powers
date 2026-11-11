import {EFFECTS_ID, MAINTENANCE, MODULE_ID, report, wrapMethod} from "./constants.mjs";
import {DURATION_UNITS, durationRates} from "./durations.mjs";

const timing = effect => effect.flags?.[MODULE_ID]?.timedPower;
const legacy = effect => !timing(effect) && effect.flags?.[MODULE_ID]?.maintenance === true;
export const isPowerTimer = effect => Boolean(timing(effect) || legacy(effect));
export const isDurationTracker = effect => legacy(effect) || Boolean(timing(effect) && !effect.flags[MODULE_ID].maintenance);
export const timerName = effect => timing(effect)?.name ?? effect.name.replace(/^Maintining: /, "");

export async function createPowerTimer(item, duration, {id, userId = game.user.id} = {}) {
  const actor = item?.actor;
  if (item?.type !== "power" || !actor?.isOwner || actor.items.get(item.id) !== item) throw new Error("You must own the power's caster.");
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    _id: id, name: "Power duration", type: "base", img: item.img, origin: item.uuid, transfer: false,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER, duration,
    flags: {[MODULE_ID]: {timedPower: {name: item.name, userId}}, [EFFECTS_ID]: {excludedTags: ["power-duration"]}}
  }], {keepId: Boolean(id), animate: false});
  return effect;
}

export async function trackPowerDuration(message, cast) {
  const item = await foundry.utils.fromUuid(cast.itemUuid);
  const actor = await foundry.utils.fromUuid(cast.actorUuid);
  if (!actor?.isOwner || item?.actor?.uuid !== actor.uuid) return;
  if (actor.effects.has(cast.id) || game.messages.some(other => other.getFlag(MODULE_ID, "maintainedCast") === cast.id)) return;
  const effect = await createPowerTimer(item, cast.duration, {id: cast.id, userId: message.author.id});
  if (effect) await message.setFlag(MODULE_ID, "maintainedCast", cast.id);
}

function* timedEffects() {
  for (const actor of game.actors) {
    if (actor.isOwner) yield* actor.effects.filter(isPowerTimer);
  }
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (token.actorLink || !token.delta?.effects?.some(isPowerTimer)) continue;
    const actor = token.actor;
    if (actor?.isOwner) yield* actor.effects.filter(isPowerTimer);
  }
}

function promptUser(effect) {
  const caster = game.users.get(timing(effect).userId);
  if (caster && effect.actor.testUserPermission(caster, "OWNER")) return caster;
  return game.users.getDesignatedUser(user => user.active && effect.actor.testUserPermission(user, "OWNER"));
}

export function powerDurationEnded(effect) {
  const {remaining, units} = effect.updateDuration();
  if (remaining > 0) return false;
  if (remaining < 0 || units !== "rounds") return true;
  const combat = effect.start?.combat ?? game.combat;
  if (!combat?.started) return true;
  // At the round boundary, wait until the turn where the duration started.
  const anchor = combat.combatants.get(effect.start?.combatant) ?? combat.getCombatantsByActor(effect.actor)[0];
  const turn = combat.turns.indexOf(anchor);
  return turn < 0 || (Number.isInteger(combat.turn) && combat.turn >= turn);
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
    throw new Error("Enter a positive whole duration and a nonnegative elapsed time.");
  }
  const actor = effect.actor;
  const previousCombat = effect.start?.combat;
  const combat = previousCombat?.started ? previousCombat
    : game.combat?.started && game.combat.getCombatantsByActor(actor).length ? game.combat : null;
  const start = CONFIG.ActiveEffect.documentClass.getEffectStart(combat);
  const rates = durationRates();
  if (units === "rounds" && combat?.started) {
    if (!Number.isSafeInteger(elapsed)) throw new Error("Enter elapsed combat rounds as a whole number.");
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
  if (!effect.duration.expired) await effect.update({"duration.expired": true}, {animate: false});
  const {name} = timing(effect);
  const content = document.createElement("p");
  content.textContent = `${name} is expired. You can choose to maintain it. For every maintenance period you want to sustain it, you suffer a cumulative −1 penalty to all subsequent arcane skill rolls.`;
  const extend = await foundry.applications.api.DialogV2.confirm({
    classes: ["sbp-dialog"],
    window: {title: "Maintain Power"}, content: content.outerHTML,
    yes: {label: "Maintain", default: false}, no: {label: "Let Expire", default: true}, rejectClose: false,
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
    name: `Maintining: ${name}`, showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.CONDITIONAL,
    start: CONFIG.ActiveEffect.documentClass.getEffectStart(), "duration.expired": false,
    [`flags.${MODULE_ID}.maintenance`]: periods,
    [`flags.${EFFECTS_ID}.tags`]: [...new Set([...tags, MAINTENANCE])]
  }, {animate: false});
}

let checking = false;
async function checkExpiredPowers() {
  if (checking || !game.ready) return;
  checking = true;
  try {
    for (const effect of timedEffects()) {
      if (legacy(effect) && game.user.isDesignated(user => user.active && effect.actor.testUserPermission(user, "OWNER"))) {
        const message = game.messages.find(message => message.getFlag(MODULE_ID, "maintainedCast") === effect.id);
        await effect.update({
          name: "Power duration", showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER,
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
    for (;;) {
      const expired = [...timedEffects()].find(effect => timing(effect) && !effect.disabled
        && promptUser(effect)?.isSelf && powerDurationEnded(effect));
      if (!expired) break;
      await resolveExpiration(expired);
    }
  } finally {
    checking = false;
  }
}

export function installMaintenance() {
  // SWADE normally deletes expired effects. Keep our record until the caster answers, including across reconnects.
  const effectClass = CONFIG.ActiveEffect.documentClass.prototype;
  for (const method of ["isExpiryEvent", "handleTurnExpirations"]) {
    if (typeof effectClass[method] !== "function") continue;
    wrapMethod(effectClass, method, function (original, ...args) {
      return !isPowerTimer(this) && original(...args);
    });
  }
  wrapMethod(CONFIG.Actor.documentClass.prototype, "allApplicableEffects", function* (original, ...args) {
    for (const effect of original(...args)) if (!isDurationTracker(effect)) yield effect;
  });
  const check = () => { void checkExpiredPowers().catch(report); };
  for (const event of ["ready", "updateWorldTime", "updateCombat", "deleteCombat", "canvasReady"]) Hooks.on(event, check);
  Hooks.on("updateActiveEffect", effect => {
    if (!timing(effect)) return;
    if (expirationPrompt?.effect.uuid === effect.uuid && !powerDurationEnded(effect)) void expirationPrompt.dialog.close().catch(report);
    check();
  });
  Hooks.on("deleteActiveEffect", effect => {
    if (expirationPrompt?.effect.uuid === effect.uuid) void expirationPrompt.dialog.close().catch(report);
  });
}
