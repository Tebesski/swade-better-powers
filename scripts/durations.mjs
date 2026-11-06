export const DURATION_UNITS = {rounds: 6, seconds: 1, minutes: 60, hours: 3600, days: 86400};
export const DURATION_OPERATIONS = ["override", "add", "subtract"];

export function durationRates() {
  const calendar = game.time.calendar;
  return {...DURATION_UNITS, rounds: CONFIG.time.roundTime || DURATION_UNITS.rounds,
    minutes: calendar.componentsToTime({minute: 1}), hours: calendar.componentsToTime({hour: 1}),
    days: calendar.componentsToTime({day: 1})};
}

export function adjustDuration(duration, {operation, amount, unit}, rates = DURATION_UNITS) {
  unit ||= duration?.units ?? "rounds";
  if (operation === "override") return {value: amount, units: unit};
  const currentUnit = duration?.units ?? unit;
  const delta = (operation === "subtract" ? -amount : amount) * rates[unit];
  const seconds = Math.max(0, (duration?.value ?? 0) * rates[currentUnit] + delta);
  const value = seconds / rates[currentUnit];
  return Number.isInteger(value) ? {value, units: currentUnit} : {value: seconds, units: "seconds"};
}

export function normalizePowerChanges(changes) {
  return (Array.isArray(changes) ? changes : []).flatMap(change => {
    const data = change?.system;
    const amount = Number(data?.amount);
    if (change?.type !== "adjustDuration" || data?.scope !== "power" || !DURATION_OPERATIONS.includes(data.operation)
      || !Number.isSafeInteger(amount) || amount < 0 || data.amount == null || data.amount === ""
      || (data.unit && !Object.hasOwn(DURATION_UNITS, data.unit))) return [];
    return [{id: change.id, type: change.type, enabled: change.enabled !== false, label: change.label ?? "",
      system: {scope: "power", operation: data.operation, amount, unit: data.unit || ""}}];
  });
}

export function resolvePowerDuration(base, changes, earnedRaises, rates = DURATION_UNITS) {
  const raised = (changes?.raises ?? []).findLast(raise => raise.level <= earnedRaises && (raise.active ?? raise.changes.some(change => change.enabled)));
  const adjustments = [...(changes?.modifiers ?? []), ...(raised?.changes ?? [])];
  const duration = adjustments.reduce((value, change) => change.enabled ? adjustDuration(value, change.system, rates) : value, base);
  return duration?.value > 0 ? duration : null;
}
