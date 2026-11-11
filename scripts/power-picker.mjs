import {isBasicSwadePack} from "../../swade-better-setting/scripts/compendium-sources.mjs";
import {MODULE_ID, normalizeName, powerData} from "./constants.mjs";
import {entryArcane, spellcastingEntries} from "./powers-data.mjs";
import {owned, queueActor} from "./spellcasting.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;
export function applyEntry(data, entry) {
  data.system ??= {};
  data.system.arcane = entryArcane(entry);
  data.system.actions ??= {};
  data.system.actions.trait = entry.trait ?? "";
  return data;
}
export class PowerPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({actor, entry}) { super(); Object.assign(this, {actor, entry, query: ""}); }
  static DEFAULT_OPTIONS = {
    classes: ["sbs-picker", "sbs-power-picker"], position: {width: 520, height: 640}, window: {title: "Add Power", resizable: true},
    actions: {
      choose: async function (_event, target) {
        if (this.busy) return;
        this.busy = true;
        try {
          if (!this.actor.isOwner) throw new Error("You do not have permission to edit this actor.");
          const power = await foundry.utils.fromUuid(target.dataset.uuid);
          if (!power || power.type !== "power" || !power.testUserPermission(game.user, "LIMITED")) throw new Error("This power is no longer available.");
          await this.addPower(powerData(power));
          ui.notifications.info(`${power.name} added to ${this.entry.name}.`);
        } catch(error) { ui.notifications.error(error.message); }
        finally { this.busy = false; }
      },
      createPower: async function () {
        if (!this.actor.isOwner) return;
        await this.addPower({name: game.i18n.localize("TYPES.Item.power"), type: "power"}, {renderSheet: true});
      }
    }
  };
  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/power-picker.hbs`, scrollable: [".sbs-results"]}};
  addPower(data, options) {
    return queueActor(this.actor, async () => {
      owned(this.actor);
      const entry = spellcastingEntries(this.actor).find(candidate => candidate.id === this.entry.id);
      if (!entry) throw new Error("This spellcasting entry is no longer available.");
      this.entry = entry;
      return CONFIG.Item.documentClass.create(applyEntry(data, entry), {parent: this.actor, ...options});
    });
  }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!this.sources) {
      const world = game.items.filter(item => item.type === "power" && item.visible).map(item => ({name: item.name, img: item.img, uuid: item.uuid}));
      const packs = game.packs.filter(pack => pack.documentName === "Item" && pack.visible &&
        !isBasicSwadePack(pack) && pack.collection !== "world.better-setting-modifiers");
      const results = await Promise.allSettled(packs.map(async pack => ({label: pack.title, rows: (await pack.getIndex({fields: ["type"]})).filter(item => item.type === "power").map(item => ({name: item.name, img: item.img, uuid: pack.getUuid(item._id)}))})));
      this.sources = [{label: "World Powers", rows: world}, ...results.filter(r => r.status === "fulfilled").map(r => r.value)].filter(group => group.rows.length);
      for (const source of this.sources) source.rows.sort((a,b) => a.name.localeCompare(b.name));
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length) ui.notifications.warn(`${failed.length} power compendium(s) could not be read. Reopen the picker to retry.`);
    }
    return {...context, sources: this.sources, entry: this.entry};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector('input[type="search"]');
    search.addEventListener("input", () => {
      let count = 0;
      for (const group of this.element.querySelectorAll(".sbs-group")) {
        let visible = 0;
        for (const row of group.querySelectorAll(".sbs-row")) { row.hidden = !normalizeName(row.dataset.name).includes(normalizeName(search.value)); if (!row.hidden) visible++; }
        group.hidden = !visible; count += visible;
      }
      this.element.querySelector(".sbs-empty").hidden = !!count;
    });
    this.element.querySelector(".sbs-empty").hidden = !!this.sources.length;
    search.focus();
  }
}
