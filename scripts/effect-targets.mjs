export function castEffectTargetUuids(message, scene) {
  const tools = message.flags?.["swade-tools"]?.usetarget;
  const native = message.getFlag("swade", "targets");
  const uuids = tools ? String(tools).split(",").map(id => scene?.tokens.get(id)?.uuid)
    : native?.length ? native.map(target => target.uuid)
    : message.getFlag("swade-better-effects", "context")?.targetUuids ?? [];
  return [...new Set(uuids.filter(Boolean))];
}

