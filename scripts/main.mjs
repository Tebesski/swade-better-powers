import {MODULE_ID, readPowerFlag, report, wrapMethod} from "./constants.mjs";
import {installPowers, readyPowers, openPowers} from "./powers.mjs";
import {renderCastingBreakdown} from "./casting-chat.mjs";
import {noPP} from "./power-rules.mjs";
import {castSuccesses, getCast, getPowerDamageChanges, installCastResults} from "./cast-results.mjs";
import {installApplyEffects} from "./apply-effects.mjs";
import {installMaintenance, isDurationTracker} from "./maintenance.mjs";
import {installPowerTimers, openPowerTimers} from "./power-timers.mjs";
import {registerBehaviorCode} from "./behavior-code.mjs";
import {installPowerDamage, wirePowerDamageControls} from "./power-damage.mjs";

Hooks.once("init", registerBehaviorCode);

Hooks.once("setup", () => {
  installPowers(wrapMethod);
  installCastResults();
  installApplyEffects();
  installMaintenance();
  installPowerTimers();
  installPowerDamage();
  game.modules.get(MODULE_ID).api = Object.freeze({
    openPowers, openPowerTimers, renderCastingBreakdown, readPowerFlag, usesNoPowerPoints: noPP, isDurationTracker, getPowerDamageChanges, wirePowerDamageControls,
    getCastContext: message => {
      const cast = getCast(message);
      return cast && {...cast, raises: Math.max(0, castSuccesses(message, cast) - 1)};
    }
  });
});
Hooks.once("ready", () => { void readyPowers(wrapMethod).catch(report); });
