import {t as sbsI18n} from "./i18n.mjs";
import {modifierCostLabel} from "./powers-data.mjs";
import {readPowerFlag, MODULE_ID} from "./constants.mjs";

function rollBreakdown(message) {
  for (const roll of message.rolls) {
    const modifier = roll.options.modifiers?.find(entry => entry.sbsPowerBreakdown && !entry.ignore);
    const breakdown = modifier?.sbsPowerBreakdown ?? roll.options.sbsPowerBreakdown;
    if (breakdown) return breakdown;
  }
  return null;
}

export function renderCastingBreakdown(message, html) {
  if (!message.isContentVisible) return;
  const breakdown = readPowerFlag(message, "castingBreakdown") ?? rollBreakdown(message);
  const root = html[0] ?? html;
  if (!breakdown || root.querySelector(".sbs-npp-breakdown")) return;
  let list = root.querySelector("details.modifiers .modifier-list");
  if (!list) {
    const details = document.createElement("details"); details.className = "modifiers";
    const summary = document.createElement("summary"); summary.textContent = game.i18n.localize("SWADE.Modifiers");
    const content = document.createElement("span"); content.className = "content";
    list = document.createElement("ul"); list.className = "modifier-list";
    content.append(list); details.append(summary, content);
    (root.querySelector(".swade-roll-message") ?? root.querySelector(".message-content"))?.prepend(details);
  }
  let line = [...list.children].find(li => /^No Power Points\s*:/.test(li.textContent.trim()));
  if (!line) {
    line = document.createElement("li"); line.textContent = sbsI18n("swade-better-powers.UI.NoPowerPoints_3b6a94929b", {p0: (breakdown.penalty || 0)});
    list.append(line);
  }
  const costs = document.createElement("ul"); costs.className = "sbs-npp-breakdown";
  breakdown.costs.forEach((cost, index) => {
    const row = document.createElement("li");
    row.textContent = sbsI18n("swade-better-powers.UI.PP_8f87a084f9", {p0: (cost.name), p1: (index ? modifierCostLabel(cost) : cost.cost)});
    costs.append(row);
  });
  const formula = document.createElement("li"); formula.className = "sbs-npp-formula";
  formula.textContent = breakdown.formula;
  formula.title = sbsI18n("swade-better-powers.UI.Castingpenaltynegativehalfofthe_ee26994668");
  costs.append(formula); line.append(costs);
}

export function installCastingChat() {
  Hooks.on("preCreateChatMessage", (message, _data, _options, userId) => {
    if (userId !== game.user.id || readPowerFlag(message, "castingBreakdown")) return;
    const breakdown = rollBreakdown(message);
    if (breakdown) message.updateSource({[`flags.${MODULE_ID}.castingBreakdown`]: breakdown});
  });
  Hooks.on("renderChatMessageHTML", renderCastingBreakdown);
}
