import {readPowerFlag, MODULE_ID, normalizeName} from "./constants.mjs";
import {GENERAL, parseArcaneSkill, powerArcane, spellcastingEntries} from "./powers-data.mjs";

const queues = new Map();
export function queueActor(actor, operation) {
  const next = (queues.get(actor.uuid) ?? Promise.resolve()).then(operation);
  queues.set(actor.uuid, next.catch(() => {}));
  return next;
}
export const owned = actor => { if (!actor?.isOwner) throw new Error("You do not have permission to edit this actor."); };

export function saveEntry(actor, entry, changes) {
  return queueActor(actor, async () => {
    owned(actor);
    const entries = structuredClone(readPowerFlag(actor, "spellcastingEntries") ?? {});
    const current = entries[entry.id] ?? entry;
    const updated = {...current, ...changes};
    updated.name = updated.name.trim();
    updated.trait = String(updated.trait ?? "").trim();
    const attribute = Object.entries(CONFIG.SWADE.attributes).find(([key, value]) => [key, game.i18n.localize(value.long)].some(label => normalizeName(label) === normalizeName(updated.trait)));
    if (attribute) updated.trait = attribute[0];
    if (!updated.name || /[.\[\]{}]/.test(updated.name) || ["__proto__", "constructor", "prototype"].includes(updated.name)) {
      throw new Error("Enter an entry name without periods or brackets.");
    }
    if (current.arcane !== GENERAL) updated.arcane = updated.name;
    if (spellcastingEntries(actor).some(e => e.id !== entry.id && normalizeName(e.arcane) === normalizeName(updated.arcane))) {
      throw new Error("A spellcasting entry with that name already exists.");
    }
    entries[entry.id] = updated;
    const updates = {[`flags.${MODULE_ID}.spellcastingEntries`]: entries};
    if (!actor._source.system.powerPoints?.[updated.arcane]) {
      updates[`system.powerPoints.${updated.arcane}`] = structuredClone(actor._source.system.powerPoints?.[current.arcane] ?? {value: 10, max: 10});
    }
    if (current.arcane !== updated.arcane) updates[`system.powerPoints.-=${current.arcane}`] = null;
    await actor.update(updates);
    const powers = actor.itemTypes.power.filter(item => powerArcane(item) === current.arcane);
    if (powers.length && (current.arcane !== updated.arcane || current.trait !== updated.trait)) {
      await actor.updateEmbeddedDocuments("Item", powers.map(item => ({_id: item.id, "system.arcane": updated.arcane === GENERAL ? "" : updated.arcane, "system.actions.trait": updated.trait})));
    }
    return updated;
  });
}

export function ensureArcaneBackground(edge) {
  const actor = edge.actor;
  if (!actor || edge.type !== "edge" || !edge.system.isArcaneBackground) return Promise.resolve();
  return queueActor(actor, async () => {
    owned(actor);
    const entries = structuredClone(readPowerFlag(actor, "spellcastingEntries") ?? {});
    if (Object.values(entries).some(e => e.sources?.includes(edge.id))) return;
    const parsed = parseArcaneSkill(edge.system.description);
    let entry = spellcastingEntries(actor).find(e => normalizeName(e.arcane) === normalizeName(parsed?.name ?? GENERAL));
    if (!entry) {
      const attribute = Object.entries(CONFIG.SWADE.attributes).find(([key, value]) =>
        [key, game.i18n.localize(value.long)].some(label => normalizeName(label) === normalizeName(parsed.attribute)))?.[0] ?? "";
      entry = {id: foundry.utils.randomID(), name: parsed.name, arcane: parsed.name, trait: parsed.name, attribute};
    }
    entries[entry.id] = {...entry, sources: [...new Set([...(entry.sources ?? []), edge.id])]};
    const update = {[`flags.${MODULE_ID}.spellcastingEntries`]: entries};
    if (!actor._source.system.powerPoints?.[entry.arcane]) update[`system.powerPoints.${entry.arcane}`] = {value: 10, max: 10};
    await actor.update(update);
  });
}

export async function initializeBackgrounds() {
  const primaryGM = game.users.activeGM?.id;
  for (const actor of game.actors) {
    if (primaryGM ? game.user.id !== primaryGM : !actor.isOwner || game.users.filter(u => u.active && actor.testUserPermission(u, "OWNER")).sort((a,b) => a.id.localeCompare(b.id))[0]?.id !== game.user.id) continue;
    for (const edge of actor.itemTypes.edge ?? []) await ensureArcaneBackground(edge);
  }
}
