// Disposable v14 world only. Start Foundry with the modules enabled before running.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", msg => {if (msg.type() === "error" && msg.text().includes("swade-better-powers")) errors.push(msg.text());});
const id = "swade-better-powers";
const prefix = `Powers QA ${Date.now()}`;
await mkdir("test-results", {recursive: true});
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa", "Refusing to modify a campaign world");
  await page.addStyleTag({content: "#notifications {pointer-events: none !important}"});
  const result = await page.evaluate(async ({id, prefix}) => {
    const service = await import("/modules/swade-better-powers/scripts/spellcasting.mjs");
    const mod = await import("/modules/swade-better-powers/scripts/power-modifiers.mjs");
    const data = await import("/modules/swade-better-powers/scripts/powers-data.mjs");
    const pc = await Actor.create({name: `${prefix} PC`, type: "character"});
    if (!game.items.some(item => item.type === "power" && item.name === "Bolt")) await Item.create({name: "Bolt", type: "power", system: {pp: 1, description: "<p>QA world power for catalog selection.</p>"}});
    const edge = await Item.create({name: "Arcane Background", type: "edge", system: {isArcaneBackground: true, description: "<p><strong>Arcane Skill:</strong> Weird Science (Smarts)</p>"}}, {parent: pc});
    await service.ensureArcaneBackground(edge);
    const entry = data.spellcastingEntries(pc).find(e => e.name === "Weird Science");
    await service.saveEntry(pc, entry, {noPowerPoints: true});
    const skill = await Item.create({name: "Weird Science", type: "skill", system: {attribute: "smarts"}}, {parent: pc});
    const power = await Item.create({name: `${prefix} Power`, type: "power", system: {pp: 1, arcane: entry.arcane, description: "<p>Base description</p>", actions: {trait: entry.trait}}}, {parent: pc});
    await mod.savePowerModifiers(power, [{id: "damage", name: "Damage", description: "<p><em>Extra damage</em></p>", options: [{id: "two", label: "", min: 2, max: 2}, {id: "variable", label: "Variable", min: -1, max: 4}], selected: "two", cost: 2}]);
    const {powerData} = await import("/modules/swade-better-powers/scripts/constants.mjs");
    const copy = await Item.create({...powerData(power), name: `${prefix} Copy`}, {parent: pc});
    const copyRetainsModifiers = copy.getFlag(id, "powerModifiers")[0].name === "Damage" && copy.system.ppModifiers.cost === 1;
    const plain = await pc.rollSkill(skill.id, {item: power, suppressChat: true});
    await power.setFlag(id, "maintained", true);
    const maintained = await pc.rollSkill(skill.id, {item: power, suppressChat: true});
    await service.saveEntry(pc, entry, {prepared: true});
    const legacyPrepared = await pc.rollSkill(skill.id, {item: power, suppressChat: true});
    await power.update({"system.description": "<p>Updated base</p>" + power.system.description});
    await service.saveEntry(pc, entry, {name: "Alchemy", trait: "Smarts", prepared: false});
    await pc.update({"system.powerPoints.Alchemy.value": 0});
    const canCast = power.canExpendResources(3);
    const worldRule = game.settings.get("swade", "noPowerPoints");
    let override;
    try {
      await service.saveEntry(pc, {...entry, arcane: "Alchemy", name: "Alchemy"}, {noPowerPoints: false});
      await game.settings.set("swade", "noPowerPoints", true);
      const roll = await pc.rollAttribute("smarts", {item: power, suppressChat: true});
      override = {canCast: power.canExpendResources(3), formula: roll.formula, chat: (await power.getChatData()).settingRules.noPowerPoints};
    } finally {
      await game.settings.set("swade", "noPowerPoints", worldRule);
      await service.saveEntry(pc, {...entry, arcane: "Alchemy", name: "Alchemy"}, {noPowerPoints: true});
    }
    const failure = await new Roll("2").evaluate();
    Hooks.callAll("swadeAction", pc, power, "formula", failure, game.user.id);
    globalThis.powersQA = {pc, power, entry: data.entryForPower(power)};
    return {entry: entry.name, attribute: entry.attribute, cost: power.system.ppModifiers.cost, plain: plain.formula, maintained: maintained.formula, legacyPrepared: legacyPrepared.formula,
      summaryCount: (power.system.description.match(/sbs-power-modifier-summary/g) ?? []).length, arcane: power.system.arcane, trait: power.system.actions.trait, canCast, override, copyRetainsModifiers, shaken: pc.statuses.has("shaken"), maintainedAfterFailure: !!power.getFlag(id, "maintained")};
  }, {id, prefix});
  assert.equal(result.entry, "Weird Science"); assert.equal(result.attribute, "smarts"); assert.equal(result.cost, 1);
  assert.match(result.plain, /-1\[No Power Points\]/); assert.match(result.maintained, /1\[Maintained powers\]/); assert.doesNotMatch(result.legacyPrepared, /Power preparation/);
  assert.equal(result.summaryCount, 1); assert.equal(result.arcane, "Alchemy"); assert.equal(result.trait, "smarts"); assert.equal(result.canCast, true);
  assert.equal(result.copyRetainsModifiers, true);
  assert.equal(result.override.canCast, false); assert.equal(result.override.chat, false); assert.doesNotMatch(result.override.formula, /No Power Points/);
  assert.equal(result.shaken, false); assert.equal(result.maintainedAfterFailure, true);
  console.log("PASS entries, modifier effects, generated descriptions, casting/maintenance, inactive legacy preparation, world overrides, and failed casting");
  await page.evaluate(async () => {await powersQA.power.sheet.render({force: true});});
  await page.locator('.sbs-modifier').waitFor({state: "attached"});
  const tabs = await page.locator('.swade-item-sheet nav [data-tab]').allTextContents();
  assert.deepEqual(tabs.map(text => text.trim()), ["Description", "Properties", "Mod/Raise", "Actions", "Effects"]);
  await page.locator('.swade-item-sheet nav [data-tab="modifiers"]').click();
  assert.equal(await page.locator('.sbs-modifier').isVisible(), true);
  await page.locator('.swade-item-sheet').screenshot({path: "test-results/power-modifiers.png"});
  await page.evaluate(async () => {await powersQA.power.sheet.close(); await powersQA.pc.sheet.render({force: true}); powersQA.pc.sheet.changeTab("powers", "primary");});
  const layout = await page.evaluate(() => {
    const root = powersQA.pc.sheet.element;
    const tab = root.querySelector(".sbs-powers");
    const tabBounds = tab.getBoundingClientRect();
    const contentBounds = root.querySelector(".window-content").getBoundingClientRect();
    return {count: root.querySelectorAll('section[data-tab="powers"], section.sbs-powers').length,
      insideSheet: !!tab.closest('[data-application-part="sheet"]'),
      bounded: tabBounds.top >= contentBounds.top && tabBounds.bottom <= contentBounds.bottom + 1,
      controlsFit: [...tab.querySelectorAll(".sbs-entry-controls")].every(control => control.getBoundingClientRect().right <= tabBounds.right + 1)};
  });
  assert.deepEqual(layout, {count: 1, insideSheet: true, bounded: true, controlsFit: true});
  assert.ok(await page.locator('.sbs-no-pp-text').count());
  await page.locator('.sbs-powers').screenshot({path: "test-results/powers.png"});
  await page.locator('.sbs-spellcasting-entry').filter({hasText: "Alchemy"}).locator('[data-sbs-power-action="add"]').click();
  await page.locator('.sbs-power-picker').waitFor();
  assert.ok(await page.locator('.sbs-power-picker .sbs-choice').count());
  await page.locator('.sbs-power-picker input[type="search"]').fill("Bolt");
  assert.ok(await page.locator('.sbs-power-picker .sbs-row:visible').count());
  await page.locator('.sbs-power-picker .sbs-row:visible .sbs-choice').first().click();
  await page.waitForFunction(() => powersQA.pc.itemTypes.power.some(power => power.name === "Bolt" && power.system.arcane === "Alchemy" && power.system.actions.trait === "smarts"));
  console.log("PASS modifier tab order, entry checkbox, catalog searching, and adding a power to an entry");
  await page.evaluate(async () => {
    for (const app of foundry.applications.instances.values()) if (app.hasFrame && app.rendered) await app.close();
    await game.modules.get("swade-better-setting").api.openActorSkills(powersQA.pc);
  });
  assert.equal(await page.locator('.sbs-star').first().evaluate(el => el.tagName), "A");
  assert.ok(await page.locator('.sbs-group h3').filter({hasText: "Core Skills"}).count());
  await page.locator('[data-action="createSkill"]').click();
  await page.locator('.sbs-skill-draft').waitFor();
  assert.equal(await page.locator('.sbs-picker').isVisible(), true);
  console.log("PASS skill anchors, core section, and keeping the picker open during creation");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({path: "test-results/powers-failure.png"}).catch(() => {});
  console.error(errors); throw error;
} finally { await browser.close(); }
