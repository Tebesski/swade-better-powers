import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
page.setDefaultTimeout(20000);
const setting = "swade-better-powers", templates = "swade-better-templates";
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const builder = page.locator(".sbt-builder");
const variants = builder.locator('[data-variant-list="modifiers"]');
const field = path => variants.locator(`[data-path="${path}"]`);
const modifierTab = page.locator(".sbs-modifiers-tab");
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.ok(["better-setting-qa", "templates-qa"].includes(await page.evaluate(() => game.world.id)), "Disposable world required");
  const modules = [setting, templates, "swade-hud"];
  if (!await page.evaluate(ids => ids.every(id => game.modules.get(id)?.active), modules)) {
    await page.evaluate(ids => game.settings.set("core", "moduleConfiguration", {
      ...game.settings.get("core", "moduleConfiguration"), ...Object.fromEntries(ids.map(id => [id, true]))
    }), modules);
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready);
  }
  await page.addStyleTag({content: "#notifications {pointer-events: none !important}"});
  await page.evaluate(async ({setting, templates}) => {
    const actor = await Actor.create({name: `Modifier Sync ${Date.now()}`, type: "character", flags: {[setting]: {spellcastingEntries: {
      magic: {id: "magic", name: "Magic", arcane: "Magic", trait: "Spellcasting", noPowerPoints: true}
    }}}});
    const skill = await Item.create({name: "Spellcasting", type: "skill", system: {attribute: "smarts"}}, {parent: actor});
    const power = await Item.create({name: "Ward", type: "power", system: {pp: 1, arcane: "Magic", damage: "2d6", templates: {medium: true}, description: "<p>Original ward text.</p>", actions: {trait: skill.name}}}, {parent: actor});
    const api = game.modules.get(templates).api;
    const automation = api.defaultAutomation(power);
    const add = api.defaultBehavior("addDamageDice"); add.system.formula = "1d6+1d6x";
    automation.raises = [{level: 1, changes: [add, api.defaultBehavior("increaseDieType")]}];
    await power.setFlag(templates, "automation", automation);
    globalThis.syncQA = {actor, skill, power, api, setting, templates,
      list: () => power.getFlag(setting, "powerModifiers"), templateList: () => power.getFlag(templates, "automation")?.modifiers,
      app: api.openBuilder(power)};
  }, {setting, templates});
  await builder.waitFor();
  assert.equal(await builder.locator('.sbt-accordion-header[aria-expanded="true"], .sbt-behavior-name[aria-expanded="true"]').count(), 0);
  await builder.locator('[data-accordion="raises"] > [data-action="accordion"]').click();
  const raise = builder.locator('[data-accordion="raises.0"]');
  await raise.locator(':scope > [data-action="accordion"]').click();
  await raise.locator('[data-behavior-path="raises.0.changes.1"] [data-action="collapseBehavior"]').click();
  assert.equal(await raise.locator('[data-path="raises.0.changes.1.system.scope"]').inputValue(), "base");
  await builder.locator('[data-accordion="modifiers"] > [data-action="accordion"]').click();
  await variants.locator('[data-action="addVariant"]').click();
  await field("modifiers.0.name").fill("Area Protection");
  await field("modifiers.0.options.0.label").fill("MBT");
  await field("modifiers.0.options.0.cost").fill("3");
  const description = field("modifiers.0.description");
  await description.hover();
  await description.locator("button.toggle").click();
  await description.locator(".ProseMirror").fill("Extend the ward around yourself.");
  const textFits = await description.evaluate(editor => {
    const area = editor.querySelector(".editor-content").getBoundingClientRect();
    const paragraph = editor.querySelector(".ProseMirror p").getBoundingClientRect();
    return paragraph.height > 0 && paragraph.top >= area.top && paragraph.bottom <= area.bottom;
  });
  assert.equal(textFits, true, "The rich text field fits a full line below the toolbar");
  await description.locator('[data-action="save"]').click();
  await variants.locator('[data-action="addModifierOption"]').click();
  await field("modifiers.0.options.1.label").fill("Wide");
  await field("modifiers.0.options.1.cost").fill("4");
  const wide = variants.locator('[data-variant-index="0"] [data-cost-index="1"]');
  await wide.getByLabel("Behavior type").selectOption("changeTemplate");
  await wide.getByRole("button", {name: "Add behavior", exact: true}).click();
  const wideRange = field("modifiers.0.options.1.changes.0.system.range");
  await wideRange.fill("4");
  await field("modifiers.0.options.1.changes.0.system.replacements.medium").selectOption("large");
  await builder.locator('[data-action="save"]').click();
  await page.waitForFunction(() => syncQA.list()?.[0]?.name === "Area Protection" && !syncQA.app.dirty);
  const initial = await page.evaluate(() => ({setting: syncQA.list()[0], template: syncQA.templateList()[0], description: syncQA.power.system.description}));
  assert.deepEqual(initial.setting, {id: initial.template.id, name: "Area Protection", description: "<p>Extend the ward around yourself.</p>", options: [{id: initial.template.options[0].id, label: "MBT", cost: 3}, {id: initial.template.options[1].id, label: "Wide", cost: 4}]});
  assert.equal(initial.template.options[1].changes[0].system.range, 4);
  assert.match(initial.description, /Original ward text[\s\S]+Area Protection \(\+3 \/ \+4\)/);
  await page.evaluate(async () => {await syncQA.power.sheet.render({force: true});});
  await modifierTab.waitFor({state: "attached"});
  await page.locator('.swade-item-sheet nav [data-tab="modifiers"]').click();
  assert.equal(await modifierTab.locator('[data-field="name"]').first().inputValue(), "Area Protection");
  console.log("PASS creating a Better Templates modifier populates Better Powers and the power description");

  await modifierTab.locator('[data-modifier-action="add"]').click();
  await page.waitForFunction(() => syncQA.templateList()?.length === 2 && syncQA.app.draft.modifiers.length === 2);
  await page.evaluate(async () => {
    const {savePowerModifiers} = await import("/modules/swade-better-powers/scripts/power-modifiers.mjs");
    const [area, created] = syncQA.list();
    await savePowerModifiers(syncQA.power, [area, {...created, name: "Selective", description: "<p><em>Choose</em> who is protected.</p>", options: [
      {id: "discount", label: "Personal", cost: -1}, {id: "free", label: "Normal", cost: 0}, {id: "allies", label: "Allies", cost: 2}
    ]}]);
    await syncQA.power.sheet.close();
  });
  await page.waitForFunction(() => syncQA.app.draft.modifiers[1]?.name === "Selective");
  assert.equal(await field("modifiers.1.name").inputValue(), "Selective");
  assert.equal(await field("modifiers.1.options.0.cost").inputValue(), "-1");
  assert.equal(await field("modifiers.1.options.1.cost").inputValue(), "0");
  assert.equal(await field("modifiers.1.options.2.cost").inputValue(), "2");
  assert.equal(await field("modifiers.1.description").locator("em").textContent(), "Choose");
  assert.equal(await page.evaluate(() => syncQA.api.readAutomation(syncQA.power).modifiers[1].options.every(option => !option.changes.length)), true);
  console.log("PASS creating a Better Powers modifier updates the open builder with formatted text and all signed costs");

  await wideRange.fill("5");
  await page.evaluate(async () => {
    const {savePowerModifiers} = await import("/modules/swade-better-powers/scripts/power-modifiers.mjs");
    const [area, selective] = syncQA.list();
    await savePowerModifiers(syncQA.power, [{...area, name: "Wider Ward", options: [area.options[0], {...area.options[1], cost: 5}]}, selective]);
  });
  await builder.locator('[data-action="save"]').click();
  await page.waitForFunction(() => !syncQA.app.dirty && syncQA.templateList()[0]?.options[1]?.changes[0]?.system.range === 5);
  assert.equal(await field("modifiers.0.name").inputValue(), "Wider Ward");
  assert.equal(await field("modifiers.0.options.1.cost").inputValue(), "5");
  assert.equal(await page.evaluate(() => syncQA.list()[0].id), initial.setting.id);
  console.log("PASS an open builder preserves external name/cost edits while saving local automation changes");

  await page.evaluate(async () => {
    await syncQA.app.close();
    const {withPowerCastCard} = await import("/modules/swade-hud/scripts/power-chat.js");
    const mods = [];
    syncQA.roll = withPowerCastCard(syncQA.power, mods, () => syncQA.actor.rollSkill(syncQA.skill.id, {item: syncQA.power, additionalMods: mods}));
  });
  await page.locator(".sbs-power-presets .toggle-list").click();
  await page.getByRole("button", {name: "Wide (+5)", exact: true}).click();
  await page.waitForFunction(() => [...foundry.applications.instances.values()].some(app => app.sbsCastingTotal === 6));
  await page.locator('.roll-dialog button[type="submit"]').first().click();
  await page.waitForFunction(() => game.messages.contents.some(message => message.getFlag("swade-hud", "powerCast")?.itemUuid === syncQA.power.uuid));
  const {cast, chatId} = await page.evaluate(() => {
    ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand();
    const message = game.messages.contents.findLast(message => message.getFlag("swade-hud", "powerCast")?.itemUuid === syncQA.power.uuid);
    return {cast: message.getFlag("swade-hud", "powerCast"), chatId: message.id};
  });
  assert.ok(cast.modifiers.includes(initial.setting.id));
  assert.equal(cast.modifierOptions[initial.setting.id], initial.setting.options[1].id);
  const castCard = page.locator(`#chat .chat-message[data-message-id="${chatId}"] .swade-hud-power-cast`);
  const templateControls = castCard.locator(".sbt-cast-template-controls");
  await templateControls.getByRole("button", {name: "LBT", exact: true}).waitFor();
  assert.equal(await templateControls.getByRole("button", {name: "MBT", exact: true}).count(), 0);
  assert.match(await castCard.locator(".sbs-npp-breakdown").textContent(), /Wider Ward — Wide: \+5 PP/);
  assert.equal(await castCard.locator(".sbs-npp-formula").textContent(), "(1 PP + 5 PP) / 2 = -3");
  await page.evaluate(async cast => {
    const {chooseCastOptions} = await import("/modules/swade-better-templates/scripts/variants.mjs");
    syncQA.placement = chooseCastOptions(syncQA.api.readAutomation(syncQA.power), syncQA.power.name, "medium", {castContext: cast});
  }, cast);
  const templateChoice = page.locator(`.sbt-cast-options input[name="modifier"][value="${initial.setting.id}"]`);
  await templateChoice.waitFor();
  assert.equal(await templateChoice.isChecked(), true);
  assert.equal(await page.locator('.sbt-cast-options').getByLabel("Wider Ward option").inputValue(), initial.setting.options[1].id);
  assert.equal(await page.locator('.sbt-cast-options input[name="modifier"]').count(), 1);
  await page.getByRole("button", {name: "Place template", exact: true}).click();
  assert.deepEqual(await page.evaluate(async () => {
    const {resolveCastOptions} = await import("/modules/swade-better-templates/scripts/variants.mjs");
    const {shapeKey, automation} = resolveCastOptions(syncQA.api.readAutomation(syncQA.power), await syncQA.placement);
    return {shapeKey, range: automation.placementRange};
  }), {shapeKey: "large", range: {enabled: true, max: 5}});
  console.log("PASS a HUD casting choice preselects the matching template modifier and resolves its automation");

  await templateControls.getByRole("button", {name: "Cast options"}).click();
  await page.locator(".sbt-cast-options").getByLabel("Raised 1", {exact: true}).check();
  await page.getByRole("button", {name: "Apply", exact: true}).click();
  const damageButton = castCard.locator("[data-sbt-cast-damage]");
  assert.equal(await damageButton.textContent(), "(2d8) + (1d6+1d6x)");
  assert.match(await castCard.locator(".modifier-list").textContent(), /Raised 1: Increase Die Type \(2d6 → 2d8\)/);
  await damageButton.click();
  await page.locator('.roll-dialog button[type="submit"]').first().click();
  await page.waitForFunction(() => game.messages.contents.some(message => message.speaker.actor === syncQA.actor.id
    && message.getFlag("swade-better-templates", "damageAdjustments")?.length));
  const damage = await page.evaluate(() => {
    const message = game.messages.contents.findLast(message => message.speaker.actor === syncQA.actor.id
      && message.getFlag("swade-better-templates", "damageAdjustments")?.length);
    return {id: message.id, dice: message.rolls[0].dice.map(die => [die.number, die.faces, die.modifiers.includes("x")])};
  });
  assert.deepEqual(damage.dice, [[2, 8, true], [1, 6, false], [1, 6, true]]);
  assert.match(await page.locator(`#chat .chat-message[data-message-id="${damage.id}"] .modifier-list`).textContent(), /Raised 1: Increase Die Type \(2d6 → 2d8\)/);
  console.log("PASS raised card damage uses the adjusted dice and records the adjustments on the posted roll");

  const legacy = await page.evaluate(async () => {
    const {initializeTemplateModifiers} = await import("/modules/swade-better-powers/scripts/template-modifiers.mjs");
    const {setting, templates, power, actor} = syncQA;
    const item = await Item.create({name: "Legacy Modifier Sync", type: "power", flags: {
      [setting]: {powerModifiers: [{id: "setting-id", name: "Widen", description: "<p>Existing text.</p>", options: [{id: "more", label: "Wider", cost: 2}]}]},
      [templates]: {automation: {enabled: true, shapes: ["medium"], modifiers: [{id: "template-id", name: "widen", changes: [{target: "template", field: "size", operation: "set", value: 3}]}]}}
    }}, {noHook: true});
    await initializeTemplateModifiers();
    const read = doc => ({setting: doc.getFlag(setting, "powerModifiers"), template: doc.getFlag(templates, "automation"), description: doc.system.description});
    const first = read(item);
    await initializeTemplateModifiers();
    const copy = await Item.create({name: "Copied Ward", type: "power", flags: {[templates]: {automation: power.getFlag(templates, "automation")}}}, {parent: actor});
    const onlySetting = await Item.create({name: "Unconfigured automation", type: "power", flags: {[setting]: {powerModifiers: first.setting}}});
    await power.update({flags: {[setting]: {powerModifiers: syncQA.list().filter(row => row.name !== "Selective")}}});
    const result = {first, second: read(item), copied: read(copy), unconfigured: read(onlySetting), remaining: syncQA.templateList().map(row => row.name)};
    await Item.deleteDocuments([item.id, onlySetting.id]);
    return result;
  });
  assert.deepEqual(legacy.first, legacy.second);
  assert.equal(legacy.first.setting.length, 1);
  assert.equal(legacy.first.setting[0].id, "template-id");
  assert.equal(legacy.first.template.modifiers[0].changes[0].value, 3);
  assert.equal(legacy.first.setting[0].options[0].cost, 2);
  assert.match(legacy.first.description, /Existing text/);
  assert.equal(legacy.copied.setting[0].id, initial.setting.id);
  assert.equal(legacy.unconfigured.template.enabled, false);
  assert.deepEqual(legacy.remaining, ["Wider Ward"]);
  assert.deepEqual(errors, []);
  console.log("PASS existing, copied, and deleted modifiers stay in sync without enabling unconfigured automation");
  await page.evaluate(() => syncQA.actor.delete());
} catch (error) {
  console.error(errors);
  throw error;
} finally {await browser.close();}
