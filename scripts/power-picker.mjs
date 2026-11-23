import {t as sbsI18n} from "./i18n.mjs";
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
    classes: ["sbs-picker", "sbs-power-picker"], position: {width: 520, height: 640}, window: {get title() { return sbsI18n("swade-better-powers.UI.AddPower_47801ca8b2"); }, resizable: true},
    actions: {
      choose: async function (_event, target) {
        if (this.busy) return;
        this.busy = true;
        try {
          if (!this.actor.isOwner) throw new Error(sbsI18n("swade-better-powers.UI.Youdonothavepermissionto_e12b555e4a"));
          const power = await foundry.utils.fromUuid(target.dataset.uuid);
          if (!power || power.type !== "power" || !power.testUserPermission(game.user, "LIMITED")) throw new Error(sbsI18n("swade-better-powers.UI.Thispowerisnolongeravailable_c01f4cf749"));
          await this.addPower(powerData(power));
          ui.notifications.info(sbsI18n("swade-better-powers.UI.addedto_5332f322c9", {p0: (power.name), p1: (this.entry.name)}));
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
      if (!entry) throw new Error(sbsI18n("swade-better-powers.UI.Thisspellcastingentryisnolonger_e8c9589090"));
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
      this.sources = [{label: sbsI18n("swade-better-powers.UI.WorldPowers_4d2f1a59f8"), rows: world}, ...results.filter(r => r.status === "fulfilled").map(r => r.value)].filter(group => group.rows.length);
      for (const source of this.sources) source.rows.sort((a,b) => a.name.localeCompare(b.name));
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length) ui.notifications.warn(sbsI18n("swade-better-powers.UI.powercompendiumscouldnotbe_a3bbe82e93", {p0: (failed.length)}));
    }
    return {...context, sources: this.sources, entry: this.entry};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector('input[type="search"]');
    const empty = this.element.querySelector(".sbs-empty");
    const groups = [...this.element.querySelectorAll(".sbs-group")].map(group => ({group,
      rows: [...group.querySelectorAll(".sbs-row")].map(row => ({row, name: normalizeName(row.dataset.name)}))
    }));
    search.addEventListener("input", () => {
      const query = normalizeName(search.value);
      let found = false;
      for (const {group, rows} of groups) {
        let visible = false;
        for (const {row, name} of rows) {
          const hidden = !name.includes(query);
          if (row.hidden !== hidden) row.hidden = hidden;
          visible ||= !hidden;
        }
        group.hidden = !visible;
        found ||= visible;
      }
      empty.hidden = found;
    });
    empty.hidden = !!this.sources.length;
    search.focus();
  }
}
