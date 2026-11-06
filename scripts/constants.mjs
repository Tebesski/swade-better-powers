export const MODULE_ID = "swade-better-powers";
export const LEGACY_ID = "swade-better-setting";
export const EFFECTS_ID = "swade-better-effects";
export const PREPARATION = "power-preparation";
export const MAINTENANCE = "power-maintain";

export const normalizeName = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
export const readPowerFlag = (document, key) => document?.flags?.[MODULE_ID]?.[key]
  ?? document?.flags?.[LEGACY_ID]?.[key] ?? document?.getFlag?.(MODULE_ID, key);
export const effectsAPI = () => game.modules.get(EFFECTS_ID)?.api;

export function powerData(document) {
  const data = document.toObject ? document.toObject() : structuredClone(document);
  for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete data[key];
  for (const scope of [MODULE_ID, LEGACY_ID]) {
    if (!data.flags?.[scope]) continue;
    delete data.flags[scope].pendingLibrary;
    delete data.flags[scope].maintained;
  }
  return data;
}

export function wrapMethod(object, name, wrapper) {
  const original = object[name];
  object[name] = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
}

export function report(error) {
  console.error(`${MODULE_ID} |`, error);
  ui.notifications.error(error.message);
}
