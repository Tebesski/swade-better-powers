import {MODULE_ID, PREPARATION, report} from "./constants.mjs";
import {getModifiers} from "./powers-data.mjs";
import {trackPowerDuration} from "./maintenance.mjs";
import {durationRates, resolvePowerDuration} from "./durations.mjs";
import {castBehaviors, runCastBehaviors} from "./behavior-actions.mjs";
import {isDamageBehavior, selectedBehaviors} from "./behavior-data.mjs";

const CAST = "powerCast";
const MARKER = "sbpPowerCast";
const units = new Map([
  ...["", "r", "rd", "rds", "rnd", "rnds", "round", "rounds"].map(unit => [unit, "rounds"]),
  ...["m", "min", "mins", "minute", "minutes"].map(unit => [unit, "minutes"]),
  ...["h", "hr", "hrs", "hour", "hours"].map(unit => [unit, "hours"])
]);

export function parseDuration(text, seconds = {rounds: 6, minutes: 60, hours: 3600}) {
  const match = String(text ?? "").normalize("NFKC").trim().match(/^(\d+(?:\.\d+)?)(?:\s*(?:[-–]\s*)?([a-z]+))?\.?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = units.get(match[2]?.toLowerCase() ?? "");
  if (value < 1 || !Number.isSafeInteger(Math.ceil(value)) || !unit) return null;
  if (Number.isInteger(value)) return {value, units: unit};
  return {value: Math.ceil(value * seconds[unit]), units: "seconds"};
}

export function powerDuration(item) {
  return parseDuration(item.system.duration, durationRates());
}

export function startCast(roll, actor, item, noPP, targetNumber) {
  const cast = {id: foundry.utils.randomID(), itemUuid: item.uuid, actorUuid: actor.uuid,
    noPP, duration: noPP ? powerDuration(item) : null, targetNumber, modifierOptions: {}};
  const term = roll.terms[0];
  term.options[MARKER] = cast;
  // Tools rerolls retain the dice options inside the pool.
  if (term.dice?.[0]) term.dice[0].options[MARKER] = cast;
  return cast;
}

export const rollCast = roll => roll?.terms[0]?.options[MARKER] ?? roll?.terms[0]?.dice?.[0]?.options[MARKER];

export function updateCast(cast, item, choices, prepared, root) {
  const toggles = new Map(Array.from(root?.querySelectorAll(".swadetools-powermod-check[data-id]") ?? [],
    input => [input.dataset.id, input.checked]));
  const modifiers = item.effects.filter(effect => effect.type === "modifier" && !effect.isSuppressed
    && (toggles.get(effect.id) ?? effect.active)).flatMap(effect => [effect.id, effect.name]);
  const selected = getModifiers(item).flatMap(modifier => {
    const option = modifier.options.find(option => option.id === choices?.get(modifier.id));
    if (!option) return [];
    modifiers.push(modifier.id, modifier.name, option.id);
    if (option.label) modifiers.push(option.label, `${modifier.name} — ${option.label}`);
    return [[modifier.id, option.id]];
  });
  Object.assign(cast, {modifierOptions: Object.fromEntries(selected), modifiers, tags: prepared ? [PREPARATION] : []});
  const behaviors = castBehaviors(item, cast.modifierOptions);
  const duration = rows => rows.map(row => row.change).filter(change => change.type === "adjustDuration");
  if (cast.noPP) cast.durationChanges = {modifiers: duration(behaviors.modifiers),
    raises: behaviors.raises.map(raise => ({...raise, changes: duration(raise.changes)}))};
  const damage = rows => rows.filter(row => isDamageBehavior(row.change));
  cast.damageChanges = {modifiers: damage(behaviors.modifiers),
    raises: behaviors.raises.map(raise => ({...raise, changes: damage(raise.changes)}))};
}

export const getCast = message => message.getFlag(MODULE_ID, CAST);

export function castSuccesses(message, cast) {
  const roll = message.rolls.find(entry => !entry.isCritFailConfirmationRoll);
  if (!Number.isFinite(roll?.total) || roll.isCritfail || message.isCritfail) return 0;
  const term = roll.terms[0];
  const dice = term?.dice ?? (term?.faces ? [term] : roll.dice ?? []);
  const wild = dice.find(die => die.constructor?.name === "WildDie" || die.denomination === "w" || die.options?.flavor === "Wild Die");
  if (dice.filter(die => die.total === 1).length > dice.length / 2 && (!wild || wild.total === 1)) return 0;
  const total = roll.total + (Number(message.flags["swade-tools"]?.gmmod) || 0);
  const target = cast.targetNumber ?? roll.targetNumber ?? 4;
  return Math.max(0, Math.floor((total - target) / 4) + 1);
}

const pending = new Map();
export function getPowerDamageChanges(message) {
  const cast = getCast(message);
  const successes = cast?.damageChanges && castSuccesses(message, cast);
  return successes ? selectedBehaviors(cast.damageChanges, successes - 1, isDamageBehavior) : [];
}

function resolveCast(message, userId) {
  const cast = getCast(message);
  if (userId !== game.user.id || !cast?.id || pending.has(cast.id)) return;
  const successes = castSuccesses(message, cast);
  if (!successes) return;
  const duration = (cast.noPP ?? cast.duration) && resolvePowerDuration(cast.duration, cast.durationChanges, successes - 1, durationRates());
  const task = Promise.resolve().then(async () => {
    if (duration) await trackPowerDuration(message, {...cast, duration}).catch(report);
    await runCastBehaviors(message, cast, successes - 1);
  }).catch(report).finally(() => pending.delete(cast.id));
  pending.set(cast.id, task);
}

export function installCastResults() {
  Hooks.on("preCreateChatMessage", (message, _data, _options, userId) => {
    if (userId !== game.user.id || getCast(message)) return;
    const cast = rollCast(message.rolls[0]);
    if (cast) message.updateSource({[`flags.${MODULE_ID}.${CAST}`]: cast});
  });
  Hooks.on("createChatMessage", (message, _options, userId) => resolveCast(message, userId));
  // SWADE Tools rerolls update the existing chat message.
  Hooks.on("updateChatMessage", (message, changes, _options, userId) => {
    if (changes.rolls) resolveCast(message, userId);
  });
}
