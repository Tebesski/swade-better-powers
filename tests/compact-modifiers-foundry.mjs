import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {if (message.type() === "error" && message.text().includes("swade-better-powers")) errors.push(message.text());});
async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa", "Disposable world required");
  await page.addStyleTag({content: "#notifications {pointer-events: none !important}"});
}
async function closeRoll() {
  await page.evaluate(async () => {for (const app of foundry.applications.instances.values()) if (app instanceof game.swade.RollDialog && app.rendered) await app.close();});
}
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready();
  if (!await page.evaluate(() => ["swade-better-powers", "swade-tools", "swade-hud"].every(id => game.modules.get(id)?.active))) {
    await page.evaluate(() => game.settings.set("core", "moduleConfiguration", {...game.settings.get("core", "moduleConfiguration"), "swade-better-powers": true, "swade-tools": true, "swade-hud": true}));
    await page.reload(); await ready();
  }
  await page.evaluate(async () => {
    const id = "swade-better-powers";
    globalThis.compactQA = {actor: await Actor.create({name: `Compact QA ${Date.now()}`, type: "character", flags: {[id]: {spellcastingEntries: {science: {id: "science", name: "Science", arcane: "Science", trait: "Spellcasting", noPowerPoints: true}}}}, system: {powerPoints: {general: {value: 10, max: 10}, Science: {value: 10, max: 10}}}})};
    compactQA.skill = await Item.create({name: "Spellcasting", type: "skill", system: {attribute: "smarts", die: {sides: 8}}}, {parent: compactQA.actor});
    compactQA.power = await Item.create({name: "Elemental Protection", type: "power", system: {pp: 1, arcane: "Science", actions: {trait: "Spellcasting"}}}, {parent: compactQA.actor});
    const {savePowerModifiers} = await import("/modules/swade-better-powers/scripts/power-modifiers.mjs");
    await savePowerModifiers(compactQA.power, [{id: "area", name: "Area Protection", description: "<p>You can extend Elemental Protection in a Medium Blast Template (Large for +4) around yourself.</p>", options: [{id: "mbt", label: "MBT", cost: 3}, {id: "lbt", label: "LBT", cost: 4}]}]);
    await compactQA.power.sheet.render({force: true});
  });
  await page.locator('.sbs-modifier').waitFor({state: "attached"});
  await page.locator('.swade-item-sheet nav [data-tab="modifiers"]').click();
  await page.locator('.sbs-modifier [data-modifier-action="toggle"]').click();
  assert.equal(await page.locator('[data-field="min"], [data-field="max"], [data-field="selected"]').count(), 0);
  assert.equal(await page.locator('.sbs-option-cost [contenteditable="true"]').count(), 2);
  await page.locator('.sbs-option-cost [contenteditable="true"]').last().fill("+4");
  await page.locator('.sbs-option-cost [contenteditable="true"]').last().press("Tab");
  await page.waitForFunction(() => compactQA.power.getFlag("swade-better-powers", "powerModifiers")[0].options[1].cost === 4);
  assert.ok(await page.locator('.sbs-modifier').evaluate(el => el.getBoundingClientRect().height < 280));
  assert.equal(await page.evaluate(() => compactQA.power.system.ppModifiers.cost), 1);
  assert.equal(await page.evaluate(() => compactQA.power.effects.size), 0);
  await mkdir("test-results", {recursive: true});
  await page.locator('.swade-item-sheet').screenshot({path: "test-results/compact-modifiers-editor.png"});
  console.log("PASS compact fixed options, editable costs, requested summary, and no persistent choice/effect");
  await page.evaluate(async () => {await compactQA.power.sheet.close(); compactQA.roll = compactQA.actor.rollSkill(compactQA.skill.id, {item: compactQA.power});});
  await page.locator('.roll-dialog .sbs-power-presets .toggle-list').click();
  await page.getByRole("button", {name: "MBT (+3)", exact: true}).click();
  await page.waitForFunction(() => [...foundry.applications.instances.values()].some(app => app instanceof game.swade.RollDialog && app.sbsCastingTotal === 4));
  assert.match(await page.locator('.roll-dialog .formula textarea').inputValue(), /2\[No Power Points\]/);
  await page.locator('.roll-dialog .sbs-power-presets .toggle-list').click();
  await page.getByRole("button", {name: "LBT (+4)", exact: true}).click();
  await page.waitForFunction(() => [...foundry.applications.instances.values()].some(app => app instanceof game.swade.RollDialog && app.sbsCastingTotal === 5));
  assert.match(await page.locator('.roll-dialog .formula textarea').inputValue(), /3\[No Power Points\]/);
  await closeRoll();
  await page.evaluate(() => {compactQA.roll = compactQA.actor.rollSkill(compactQA.skill.id, {item: compactQA.power});});
  await page.locator('.sbs-casting-total').waitFor();
  assert.match(await page.locator('.sbs-casting-total').innerText(), /Total cost: 1 PP/);
  await closeRoll();
  console.log("PASS per-cast versions replace one another, change the casting penalty, and reset next roll");
  await page.evaluate(async () => {const {default: ItemDialog} = await import("/modules/swade-tools/scripts/class/ItemDialog.js"); new ItemDialog(compactQA.actor, compactQA.power.id).showDialog();});
  await page.locator('.swadetools-vertical .sbs-power-presets .toggle-list').click();
  await page.getByRole("button", {name: "LBT (+4)", exact: true}).click();
  const toolsCost = await page.evaluate(async () => {
    const {default: ItemDialog} = await import("/modules/swade-tools/scripts/class/ItemDialog.js");
    const {default: ItemRoll} = await import("/modules/swade-tools/scripts/class/ItemRoll.js");
    const itemDialog = new ItemDialog(compactQA.actor, compactQA.power.id);
    const roll = new ItemRoll(compactQA.actor, compactQA.power);
    const app = Object.values(ui.windows).find(app => app.element?.[0]?.querySelector(".sbs-casting-modifiers"));
    await itemDialog.processItemFormDialog(app.element, roll, "skill"); await app.close();
    return roll.sbsPowerCost;
  });
  assert.equal(toolsCost, 5);
  console.log("PASS SWADE Tools receives the selected total cost without changing the power");
  const hud = await page.evaluate(async () => {
    await compactQA.power.update({"system.pp": 3});
    await Item.create({name: "Normal PP power", type: "power", system: {pp: 2}}, {parent: compactQA.actor});
    const hud = game.modules.get("swade-hud").api; hud.actor = compactQA.actor;
    let list = document.createElement("div"); hud.powerSidebar(list);
    const individual = [...list.querySelectorAll(".pp-cost")].map(el => el.textContent);
    const old = game.settings.get("swade", "noPowerPoints");
    try {
      await game.settings.set("swade", "noPowerPoints", true); hud.actor = compactQA.actor;
      const root = document.createElement("div"); hud.buildStatistics(root);
      list = document.createElement("div"); hud.powerSidebar(list);
      return {individual, resources: [...root.querySelector('[data-panel="resources"]').children].map(el => el.dataset.section), pools: list.querySelectorAll(".power-pool").length};
    } finally {await game.settings.set("swade", "noPowerPoints", old);}
  });
  assert.deepEqual(hud, {individual: ["-2", "2 PP"], resources: ["bennies"], pools: 0});
  await page.evaluate(() => game.modules.get("swade-better-powers").api.openPowers(compactQA.actor));
  await page.locator('.sbs-power-picker').waitFor();
  assert.equal(await page.evaluate(() => [...foundry.applications.instances.values()].find(app => app.constructor.name === "PowerPicker").sources.some(group => group.rows.some(row => row.uuid.startsWith("Compendium.swade.powers.")))), false);
  console.log("PASS per-entry HUD penalties, global Bennies-only resources, and excluded Basic Powers pack");
  assert.deepEqual(errors, []);
} catch (error) {
  await mkdir("test-results", {recursive: true}); await page.screenshot({path: "test-results/compact-modifiers-failure.png"}).catch(() => {});
  console.error(errors); throw error;
} finally {await browser.close();}
