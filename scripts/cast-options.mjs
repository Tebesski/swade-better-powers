import {t} from "./i18n.mjs";
import {MODULE_ID} from "./constants.mjs";
import {castSuccesses, getCast, updateCast} from "./cast-results.mjs";
import {escapeHTML as E, getModifiers, getPowerRaises, modifierCostLabel} from "./powers-data.mjs";

const text = key => t(`${MODULE_ID}.CastOptions.${key}`);
const QUERY = `${MODULE_ID}.castOptions`;

export function castOptionChoices(item) {
  const template = game.modules.get("swade-better-templates")?.api?.readCastAutomation?.(item);
  const modifiers = new Map(getModifiers(item).map(modifier => [modifier.id, modifier]));
  for (const modifier of template?.modifiers ?? []) {
    const power = modifiers.get(modifier.id);
    modifiers.set(modifier.id, power ? {...power, options: [...power.options,
      ...modifier.options.filter(option => !power.options.some(existing => existing.id === option.id))]} : modifier);
  }
  const levels = [...new Set([...getPowerRaises(item), ...(template?.raises ?? [])].map(raise => raise.level))].sort((a, b) => a - b);
  return {modifiers: [...modifiers.values()].filter(modifier => modifier.options.length), raises: levels.map(level => ({level}))};
}

async function saveOptions({messageId, choices, raise}, {user}) {
  const message = game.messages.get(messageId), cast = message && getCast(message);
  const item = cast?.itemUuid && foundry.utils.fromUuidSync(cast.itemUuid);
  if (!item?.actor?.testUserPermission(user, "OWNER") || !user.isGM && (message.blind
    || message.whisper.length && !message.whisper.includes(user.id) && message.author.id !== user.id)) throw new Error(text("Unavailable"));
  const available = castOptionChoices(item);
  const valid = new Map(available.modifiers.flatMap(modifier => {
    const option = modifier.options.find(option => option.id === choices?.[modifier.id]);
    return option ? [[modifier.id, option.id]] : [];
  }));
  const levels = [0, ...available.raises.map(entry => entry.level)];
  const level = levels.includes(Number(raise)) ? Number(raise) : 0;
  const next = structuredClone(cast);
  updateCast(next, item, valid, cast.tags?.includes("power-preparation"), null);
  const modifierOptions = Object.fromEntries(valid);
  const replacements = old => ({...modifierOptions, ...Object.fromEntries(Object.keys(old ?? {}).filter(id => !valid.has(id)).map(id => ["-=" + id, null]))});
  next.modifierOptions = replacements(cast.modifierOptions);
  await message.update({[`flags.${MODULE_ID}.powerCast`]: next,
    [`flags.${MODULE_ID}.effectChoices`]: {messageId, raise: level, modifierOptions: replacements(message.getFlag(MODULE_ID, "effectChoices")?.modifierOptions)},
    "flags.swade-better-templates.castOptions": {raise: level, modifiers: [...valid.keys()], modifierOptions: replacements(message.getFlag("swade-better-templates", "castOptions")?.modifierOptions)}});
}

export async function openCastOptions(message) {
  const cast = getCast(message), item = cast?.itemUuid && foundry.utils.fromUuidSync(cast.itemUuid);
  if (!item?.actor?.isOwner || message.isContentVisible === false) return;
  const {modifiers, raises} = castOptionChoices(item);
  const current = game.modules.get("swade-better-templates")?.api?.getChatCastOptions?.(message)
    ?? message.getFlag(MODULE_ID, "effectChoices") ?? {modifierOptions: cast.modifierOptions};
  const raised = current.raise ?? Math.max(0, castSuccesses(message, cast) - 1);
  const cost = option => game.modules.get(MODULE_ID)?.api?.modifierPenaltyLabel?.(item, option) ?? modifierCostLabel(option);
  const content = `<div class="standard-form sbp-cast-options-form">
    ${raises.length ? `<label>${E(text("Raise"))}<select name="raise">${[0, ...raises.map(entry => entry.level)].map(level =>
      `<option value="${level}" ${level === raised ? "selected" : ""}>${level}</option>`).join("")}</select></label>` : ""}
    ${modifiers.map(modifier => `<div class="form-group"><label><input type="checkbox" name="modifier" value="${E(modifier.id)}" ${current.modifierOptions?.[modifier.id] ? "checked" : ""}> ${E(modifier.name)}</label>
      <div class="form-fields"><select name="option.${E(modifier.id)}" aria-label="${E(modifier.name)}">${modifier.options.map(option =>
        `<option value="${E(option.id)}" ${current.modifierOptions?.[modifier.id] === option.id ? "selected" : ""}>${E(option.label || modifier.name)} (${E(cost(option))})</option>`).join("")}</select></div></div>`).join("")}
    ${!modifiers.length && !raises.length ? `<p class="hint">${E(text("Empty"))}</p>` : ""}</div>`;
  const choices = await foundry.applications.api.DialogV2.prompt({window: {title: text("Title")}, classes: ["sbp-dialog"], position: {width: 480}, content, rejectClose: false,
    ok: {label: text("Apply"), callback: (_event, button) => {
      const data = new FormData(button.form);
      return {messageId: message.id, raise: Number(data.get("raise") ?? raised),
        choices: Object.fromEntries(data.getAll("modifier").map(id => [id, data.get(`option.${id}`)]))};
    }}});
  if (!choices) return;
  if (game.user.isGM || message.isOwner) await saveOptions(choices, {user: game.user});
  else if (game.users.activeGM) await game.users.activeGM.query(QUERY, choices);
  else throw new Error(text("NeedsGM"));
}

export function installCastOptions() {
  CONFIG.queries[QUERY] = (data, context) => {
    if (!game.user.isGM) throw new Error(text("NeedsGM"));
    return saveOptions(data, context);
  };
  Hooks.on("renderChatMessageHTML", (message, root) => {
    const cast = getCast(message), item = cast?.itemUuid && foundry.utils.fromUuidSync(cast.itemUuid);
    if (!item?.actor?.isOwner || message.isContentVisible === false) return;
    const content = root.querySelector(".message-content");
    if (!content || content.querySelector(".sbp-cast-options-button")) return;
    root.classList.add("sbp-has-cast-options");
    const button = document.createElement("button"); button.type = "button"; button.className = "sbp-cast-options-button";
    button.textContent = text("Title");
    button.addEventListener("click", async event => {
      event.preventDefault(); event.stopPropagation(); button.disabled = true;
      try { await openCastOptions(message); } catch (error) { ui.notifications.error(error.message, {console: true}); }
      finally { button.disabled = false; }
    });
    const accordion = content.querySelector("details.modifiers");
    if (accordion) accordion.before(button); else content.append(button);
  });
}
