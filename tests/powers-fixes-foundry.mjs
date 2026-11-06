// Real browser drop and dialog regression tests; never run against a campaign world.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", msg => {if (msg.type() === "error" && msg.text().includes("swade-better-powers")) errors.push(msg.text());});
const moduleId = "swade-better-powers";
const prefix = `Power fixes ${Date.now()}`;
async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa");
  await page.addStyleTag({content: "#notifications {pointer-events: none !important}"});
}
async function closeItems() {
  await page.evaluate(async () => {for (const app of foundry.applications.instances.values()) if (app.document?.documentName === "Item" && app.rendered) await app.close();});
}
async function drop(uuid, selector) {
  const transfer = await page.evaluateHandle(uuid => {const transfer = new DataTransfer(); transfer.setData("text/plain", JSON.stringify({type: "Item", uuid})); return transfer;}, uuid);
  const target = page.locator(selector);
  const rect = await target.boundingBox();
  await target.dispatchEvent("drop", {dataTransfer: transfer, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2});
  await transfer.dispose();
}
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready();
  const modules = ["swade-better-powers", "swade-better-setting", "swade-better-effects", "swade-tools"];
  if (!await page.evaluate(ids => ids.every(id => game.modules.get(id)?.active), modules)) {
    await page.evaluate(ids => game.settings.set("core", "moduleConfiguration", {
      ...game.settings.get("core", "moduleConfiguration"), ...Object.fromEntries(ids.map(id => [id, true]))
    }), modules);
    await page.reload(); await ready();
  }
  await page.waitForFunction(() => game.settings.get("swade-better-setting", "libraryInitialized"));
  await page.evaluate(async ({prefix, moduleId}) => {
    globalThis.fixes = {prefix, actors: []};
    const entries = {science: {id: "science", name: "Science", arcane: "Science", trait: "Weird Science", noPowerPoints: true, prepared: true},
      miracles: {id: "miracles", name: "Miracles", arcane: "Miracles", trait: "Faith"}};
    for (const type of ["character", "npc"]) fixes.actors.push(await Actor.create({name: `${prefix} ${type}`, type, flags: {[moduleId]: {spellcastingEntries: entries}},
      system: {powerPoints: {general: {value: 10, max: 10}, Science: {value: 10, max: 10}, Miracles: {value: 10, max: 10}}},
      items: [{name: "Existing Power", type: "power", system: {arcane: "Science", pp: 1, actions: {trait: "Weird Science"}}}]}));
    fixes.world = await Item.create({name: `${prefix} World Power`, type: "power", system: {actions: {trait: "Fighting"}}});
    const collection = "world.better-setting-power-qa";
    const pack = game.packs.get(collection) ?? await foundry.documents.collections.CompendiumCollection.createCompendium({name: "better-setting-power-qa", label: "Power QA", type: "Item", system: "swade"});
    fixes.source = await Item.create({name: `${prefix} Pack Power`, type: "power", system: {actions: {trait: "Fighting"}}}, {pack: pack.collection});
  }, {prefix, moduleId});
  for (let index = 0; index < 2; index++) {
    await page.evaluate(async index => {
      if (fixes.actor) await fixes.actor.sheet.close();
      fixes.actor = fixes.actors[index]; await fixes.actor.sheet.render({force: true}); fixes.actor.sheet.changeTab("powers", "primary");
    }, index);
    await page.locator('.sbs-spellcasting-entry[data-sbs-entry="miracles"]').waitFor();
    const world = await page.evaluate(() => fixes.world.uuid);
    await drop(world, '.sbs-spellcasting-entry[data-sbs-entry="miracles"] .sbs-entry-empty');
    await page.waitForFunction(() => fixes.actor.items.getName(`${fixes.prefix} World Power`)?.system.actions.trait === "Faith");
    assert.equal(await page.evaluate(() => fixes.actor.items.getName(`${fixes.prefix} World Power`).system.arcane), "Miracles");
    await closeItems();
    const pack = await page.evaluate(() => fixes.source.uuid);
    await drop(pack, '.sbs-spellcasting-entry[data-sbs-entry="science"] .sbs-entry-header');
    await page.waitForFunction(() => fixes.actor.items.getName(`${fixes.prefix} Pack Power`)?.system.actions.trait === "Weird Science");
    await closeItems();
    const own = await page.evaluate(() => fixes.actor.items.getName("Existing Power").uuid);
    await drop(own, '.sbs-spellcasting-entry[data-sbs-entry="miracles"] .sbs-entry-header');
    await page.waitForFunction(() => fixes.actor.items.getName("Existing Power").system.actions.trait === "Faith");
    assert.equal(await page.evaluate(() => fixes.actor.items.filter(i => i.name === "Existing Power").length), 1);
    console.log(`PASS browser world/compendium drops and existing-power moves on ${index ? "NPC" : "PC"}`);
  }
  const label = page.locator('.sbs-no-pp-label').first();
  assert.equal(await label.getAttribute("title"), null);
  assert.equal(await label.getAttribute("data-tooltip"), "No Power Points");
  assert.equal(await page.locator('.sbs-no-pp[title]').count(), 0);
  assert.equal(await page.locator('.sbs-prepared').count(), 0);
  await page.locator('[data-sbs-entry="miracles"] [data-sbs-power-action="settings"]').click();
  await page.locator('.sbs-entry-settings').waitFor();
  assert.equal(await page.locator('.sbs-entry-settings [name="entryName"]').inputValue(), "Miracles");
  assert.equal(await page.locator('.sbs-entry-settings [name="entryTrait"]').inputValue(), "Faith");
  assert.equal(await page.locator('[name="prepared"]').count(), 0);
  await page.getByRole("button", {name: "Choose a trait", exact: true}).click();
  await page.locator('.sbs-picker').waitFor();
  await page.locator('.sbs-picker input[type="search"]').fill("Smarts");
  await page.locator('.sbs-picker').getByRole("button", {name: "Smarts", exact: true}).click();
  assert.equal(await page.locator('.sbs-entry-settings [name="entryTrait"]').inputValue(), "smarts");
  await page.locator('dialog').getByRole("button", {name: "Save", exact: true}).click();
  await page.waitForFunction(() => fixes.actor.items.getName("Existing Power").system.actions.trait === "smarts");
  console.log("PASS single tooltip, rendered trait-picker selection and save, and removed preparation UI");
  assert.deepEqual(errors, []);
} catch (error) {
  await mkdir("test-results", {recursive: true});
  await page.screenshot({path: "test-results/power-fixes-failure.png"}).catch(() => {});
  console.error(errors); throw error;
} finally {await browser.close();}
