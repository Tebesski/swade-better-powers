import {MODULE_ID, report} from "./constants.mjs";
import {powerDuration} from "./cast-results.mjs";
import {createPowerTimer, editPowerTimer, isDurationTracker, isPowerTimer, powerDurationEnded, timerName, timerProgress} from "./maintenance.mjs";
import {noPP} from "./power-rules.mjs";
import {DURATION_UNITS} from "./durations.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;
const managers = new Map();

class PowerTimers extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor) {
    super({window: {title: `Power Timers · ${actor.name}`}});
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["sbp-power-timers"], position: {width: 460},
    window: {resizable: true, contentClasses: ["standard-form"]},
    actions: {
      editTimer: async function (_event, button) {
        const effect = this.actor.effects.get(button.dataset.effectId);
        if (!this.actor.isOwner || !isPowerTimer(effect)) return;
        const current = timerProgress(effect);
        const units = Object.keys(DURATION_UNITS).map(unit => `<option value="${unit}" ${unit === current.units ? "selected" : ""}>${unit}</option>`).join("");
        const content = `<div class="standard-form">
          <label>Total Duration <input type="number" name="value" min="1" step="1" required value="${current.value}"></label>
          <label>Unit <select name="units">${units}</select></label>
          <label>Elapsed <input type="number" name="elapsed" min="0" step="any" required value="${Number(current.elapsed.toFixed(4))}"></label>
          <p class="hint">Elapsed is the current tick in the selected unit. Reaching the total duration triggers expiration.</p>
        </div>`;
        try {
          await foundry.applications.api.DialogV2.prompt({classes: ["sbp-dialog"], window: {title: `Edit Timer · ${timerName(effect)}`}, content, rejectClose: false,
            ok: {label: "Save", callback: (_event, submit) => {
              const fields = submit.form.elements;
              return editPowerTimer(effect, {value: fields.value.valueAsNumber, units: fields.units.value, elapsed: fields.elapsed.valueAsNumber});
            }}
          });
        } catch (error) { report(error); }
      },
      startTimer: async function () {
        if (this.starting) return;
        this.starting = true;
        try {
          const power = this.actor.items.get(this.element.querySelector("select")?.value);
          const duration = noPP(power) && powerDuration(power);
          if (!duration) throw new Error("Choose a No Power Points power with a timed duration.");
          await createPowerTimer(power, duration);
        } catch (error) { report(error); }
        finally { this.starting = false; }
      },
      stopTimer: async function (_event, button) {
        const effect = this.actor.effects.get(button.dataset.effectId);
        if (!this.actor.isOwner || !isPowerTimer(effect) || this.stopping.has(effect.id)) return;
        this.stopping.add(effect.id);
        try {
          await effect.deleteDialog({
            window: {title: `Stop Timer · ${timerName(effect)}`},
            content: "<p>Stop this cast’s timer and end any maintenance penalty from it?</p>",
            yes: {label: "Stop Timer", default: false, callback: () => {
              if (this.actor.isOwner && this.actor.effects.get(effect.id) === effect) return effect.delete({animate: false});
            }},
            no: {label: "Cancel", default: true}, rejectClose: false
          });
        } catch (error) { report(error); }
        finally { this.stopping.delete(effect.id); }
      }
    }
  };

  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/power-timers.hbs`, scrollable: [".sbp-timer-list"]}};

  stopping = new Set();

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const powers = this.actor.itemTypes.power.filter(power => noPP(power) && powerDuration(power))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(power => ({id: power.id, label: `${power.name} (${power.system.duration})`}));
    const timers = this.actor.effects.filter(isPowerTimer).map(effect => {
      const renewals = effect.flags[MODULE_ID]?.maintenance;
      const phase = isDurationTracker(effect) ? "Initial duration" : `Maintaining · ${renewals} ${renewals === 1 ? "renewal" : "renewals"}`;
      const state = effect.disabled ? "Disabled" : powerDurationEnded(effect) ? "Expired · awaiting decision" : effect.duration.label;
      return {id: effect.id, img: effect.img, name: timerName(effect), detail: `${phase} · ${state}`};
    });
    return {...context, powers, timers, selectedPower: this.selectedPower, powerSelectId: `${this.id}-power`};
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const select = this.element.querySelector("select");
    select?.addEventListener("change", () => { this.selectedPower = select.value; });
  }

  async _onClose(options) {
    if (managers.get(this.actor.uuid) === this) managers.delete(this.actor.uuid);
    await super._onClose(options);
  }
}

export function openPowerTimers(actor) {
  if (!actor?.isOwner) throw new Error("You must own the caster to manage power timers.");
  let manager = managers.get(actor.uuid);
  if (!manager) {
    manager = new PowerTimers(actor);
    managers.set(actor.uuid, manager);
  } else if (manager.rendered) manager.bringToFront();
  return manager.render({force: true});
}

export function installPowerTimers() {
  const refresh = manager => { if (manager?.rendered) void manager.render().catch(report); };
  for (const event of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(event, effect => { if (isPowerTimer(effect)) refresh(managers.get(effect.actor?.uuid)); });
  }
  for (const event of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(event, item => { if (item.type === "power") refresh(managers.get(item.actor?.uuid)); });
  }
  for (const event of ["updateWorldTime", "updateCombat", "deleteCombat"]) {
    Hooks.on(event, () => { for (const manager of managers.values()) refresh(manager); });
  }
}
