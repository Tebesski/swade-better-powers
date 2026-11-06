import {MODULE_ID} from "./constants.mjs";
import {isCodeBehavior} from "./behavior-data.mjs";

const KEY = "trustedPowerCode";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = source => new AsyncFunction("token", "actor", "item", "message", "roll", "cast", source);
let pending = Promise.resolve();

export function registerBehaviorCode() {
  game.settings.register(MODULE_ID, KEY, {scope: "world", config: false, type: Array, default: []});
}

async function executable(entry) {
  if (entry.type === "executeMacro") {
    if (!entry.system.macroUuid.trim()) return null;
    const macro = await foundry.utils.fromUuid(entry.system.macroUuid);
    if (macro?.documentName !== "Macro") throw new Error("Choose an existing macro.");
    return {signature: [entry.id, macro.uuid, macro.type, macro.command], run: context => macro.execute({...context, speaker: context.message.speaker})};
  }
  const source = entry.system.script.trim();
  if (!source) return null;
  const fn = script(source);
  return {signature: [entry.id, source], run: ({token, actor, item, message, roll, cast}) => fn(token, actor, item, message, roll, cast)};
}

export function trustPowerBehaviors(changes) {
  if (!game.user.isGM) return;
  pending = pending.catch(() => {}).then(async () => {
    const saved = game.settings.get(MODULE_ID, KEY);
    const next = new Set(saved);
    for (const entry of changes.filter(change => change.enabled && isCodeBehavior(change))) {
      const code = await executable(entry);
      if (code) next.add(JSON.stringify(code.signature));
    }
    if (next.size !== saved.length) await game.settings.set(MODULE_ID, KEY, [...next]);
  });
  return pending;
}

export async function runPowerCode(entry, context) {
  const code = await executable(entry);
  if (!code) return;
  if (!game.settings.get(MODULE_ID, KEY).includes(JSON.stringify(code.signature))) {
    throw new Error("A GM must save this power macro or script in Mod/Raise before it can run.");
  }
  await code.run(context);
}
