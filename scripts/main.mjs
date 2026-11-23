import {MODULE_ID, readPowerFlag, report, wrapMethod} from "./constants.mjs";
import {installPowers, readyPowers, openPowers} from "./powers.mjs";
import {renderCastingBreakdown} from "./casting-chat.mjs";
import {noPP} from "./power-rules.mjs";
import {castSuccesses, getCast, getPowerDamageChanges, getPowerDamageRaiseLevels, installCastResults} from "./cast-results.mjs";
import {installApplyEffects} from "./apply-effects.mjs";
import {installMaintenance, isDurationTracker} from "./maintenance.mjs";
import {installPowerTimers, openPowerTimers} from "./power-timers.mjs";
import {registerBehaviorCode} from "./behavior-code.mjs";
import {getPowerDamageOptions, installPowerDamage, wirePowerDamageControls} from "./power-damage.mjs";
import {installCastOptions, openCastOptions} from "./cast-options.mjs";
import {getModifiers, modifierCostLabel} from "./powers-data.mjs";
import {renderLibraryBehaviors, openModifierEditor, powerChatDescription} from "./power-modifiers.mjs";

Hooks.once("init", registerBehaviorCode);

Hooks.once("setup", () => {
  installPowers(wrapMethod);
  installCastResults();
  installApplyEffects();
  installMaintenance();
  installPowerTimers();
  installPowerDamage();
  installCastOptions();
  game.modules.get(MODULE_ID).api = Object.freeze({
    openPowers, openPowerTimers, renderLibraryBehaviors, openModifierEditor, getModifiers, powerChatDescription, renderCastingBreakdown, readPowerFlag, usesNoPowerPoints: noPP, isDurationTracker, getPowerDamageChanges, wirePowerDamageControls,
    modifierPenaltyLabel: (item, option) => noPP(item) ? modifierCostLabel(option, true) : undefined,
    getPowerDamageRaiseLevels, getPowerDamageOptions, openCastOptions,
    getCastContext: message => {
      const cast = getCast(message);
      return cast && {...cast, raises: Math.max(0, castSuccesses(message, cast) - 1)};
    }
  });
});
Hooks.once("ready", () => { void readyPowers(wrapMethod).catch(report); });
