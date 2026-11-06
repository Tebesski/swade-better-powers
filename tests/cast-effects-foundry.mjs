// Run with Better Powers, Better Effects, Better Templates, and SWADE HUD enabled in better-setting-qa.
import assert from "node:assert/strict";
import {chromium} from "playwright";

const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
  args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.stack));
const dialog = page.locator(".swade.roll-dialog");
const formula = dialog.locator("textarea");
const prep = dialog.getByRole("checkbox", {name: "Power Preparation"});
const id = "swade-better-powers";
const messageControls = () => page.locator(".chat-message").filter({has: page.locator(".sbp-effect-controls")}).last().locator(".sbp-effect-controls");

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa", "Refusing to modify a campaign world");
  await page.evaluate(async () => { await canvas.initializing; await foundry.nue.Tour.activeTour?.complete(); });
  await page.addStyleTag({content: "#notifications {pointer-events:none !important}"});
  await page.evaluate(async id => {
    const prefix = `Cast Effects QA ${Date.now()}`;
    const caster = await Actor.create({name: prefix, type: "character", flags: {"swade-better-setting": {
      spellcastingEntries: {general: {id: "general", name: "General", arcane: "general", trait: "Spellcasting", noPowerPoints: true}}
    }}});
    const skill = await Item.create({name: "Spellcasting", type: "skill"}, {parent: caster});
    const target = await Actor.create({name: `${prefix} target`, type: "npc"});
    const effects = {};
    for (const name of ["Normal Ward", "Second Ward", "Raised Ward", "Extended Ward"]) {
      effects[name] = await Item.create({name: `${prefix} ${name}`, type: "swade-better-effects.effect", effects: [{name, type: "base"}]});
    }
    const [power] = await caster.createEmbeddedDocuments("Item", [{
      name: "Ward", type: "power", system: {pp: 2, duration: "1 min.", actions: {trait: "smarts"}},
      flags: {"swade-better-setting": {powerModifiers: [{id: "reach", name: "Reach", options: [{id: "far", label: "Far", cost: 1}]}]},
        [id]: {applyEffects: {modifiers: {reach: {far: effects["Extended Ward"].uuid}}}}}
    }]);
    const scene = await Scene.create({name: prefix, width: 1000, height: 1000});
    const [casterToken, targetToken] = await scene.createEmbeddedDocuments("Token", [
      {name: caster.name, actorId: caster.id, actorLink: true, x: 200, y: 200},
      {name: target.name, actorId: target.id, actorLink: true, x: 500, y: 200}
    ]);
    await scene.activate();
    await canvas.initializing;
    globalThis.castQA = {caster, target, power, skill, scene, casterToken, targetToken, effects, random: CONFIG.Dice.randomUniform};
    await power.sheet.render({force: true});
    power.sheet.changeTab("properties", "main");
  }, id);
  const editor = page.locator(".sbp-apply-effects");
  const baseRows = editor.locator('[data-effect-slot="base"] .sbp-effect-slot');
  await baseRows.first().getByPlaceholder("Drop an Effect").waitFor();
  assert.equal(await editor.evaluate(node => !!node.previousElementSibling.querySelector('[name="system.actions.dmgMod"]')), true);
  assert.equal(await editor.getByText("Normal", {exact: true}).count(), 0);
  await baseRows.last().getByRole("button", {name: "Choose effect"}).click();
  await page.locator(".sbe-effect-picker input[type=search]").fill(await page.evaluate(() => castQA.effects["Normal Ward"].name));
  await page.locator(".sbe-effect-picker-results label:visible input").first().check();
  await page.getByRole("button", {name: "Insert", exact: true}).click();
  await page.waitForFunction(id => castQA.power.getFlag(id, "applyEffects").base?.[0] === castQA.effects["Normal Ward"].uuid, id);
  await baseRows.first().locator("img").waitFor();
  assert.equal(await baseRows.count(), 2);
  assert.equal(await baseRows.first().getByPlaceholder("Drop an Effect").inputValue(),
    await page.evaluate(() => castQA.effects["Normal Ward"].name));
  const dropEffect = async (row, name) => {
    const drop = await page.evaluateHandle(name => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", JSON.stringify({type: "Item", uuid: castQA.effects[name].uuid}));
      return transfer;
    }, name);
    await row.dispatchEvent("drop", {dataTransfer: drop});
    await drop.dispose();
  };
  await dropEffect(baseRows.last(), "Second Ward");
  await page.waitForFunction(id => castQA.power.getFlag(id, "applyEffects").base?.length === 2, id);
  await baseRows.nth(2).waitFor();
  assert.equal(await baseRows.last().getByPlaceholder("Drop an Effect").inputValue(), "");
  await baseRows.nth(1).getByRole("button", {name: "Remove effect"}).click();
  await page.waitForFunction(id => castQA.power.getFlag(id, "applyEffects").base.length === 1, id);
  await baseRows.nth(2).waitFor({state: "detached"});
  await dropEffect(baseRows.last(), "Second Ward");
  await page.waitForFunction(id => castQA.power.getFlag(id, "applyEffects").base.length === 2, id);
  await page.locator('[data-effect-accordion="raised"] > summary').click();
  await dropEffect(editor.locator('[data-effect-slot="raised"] .sbp-effect-slot').last(), "Raised Ward");
  await page.waitForFunction(id => castQA.power.getFlag(id, "applyEffects").raised?.[0] === castQA.effects["Raised Ward"].uuid, id);
  await editor.locator('[data-effect-slot="raised"] .sbp-effect-slot').last().getByPlaceholder("Drop an Effect").waitFor();
  await page.evaluate(() => castQA.power.sheet.close());
  await page.waitForFunction(() => canvas.ready && castQA.targetToken.object && castQA.casterToken.object);
  await page.evaluate(() => {
    castQA.casterToken.object.control();
    castQA.targetToken.object.setTarget(true);
    ui.sidebar.changeTab("chat", "primary");
    ui.sidebar.expand();
    CONFIG.Dice.randomUniform = () => 0.45;
    void castQA.caster.rollAttribute("smarts", {item: castQA.power, additionalMods: [{label: "QA", value: 10}]});
  });
  await prep.waitFor();
  assert.equal(await prep.isChecked(), false);
  assert.equal(await prep.locator("xpath=../following-sibling::li[1]/div[1]").textContent(), "No Power Points");
  await prep.check();
  await dialog.getByRole("button", {name: "Choose a Power Modifier"}).click();
  await dialog.getByRole("button", {name: "Far (+1)", exact: true}).click();
  assert.match(await formula.inputValue(), /2\[Power Preparation\]/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(id => castQA.caster.effects.some(effect => effect.getFlag(id, "timedPower")), id);
  assert.deepEqual(await page.evaluate(id => {
    const effect = castQA.caster.effects.find(effect => effect.getFlag(id, "timedPower"));
    return [effect.duration.value, effect.duration.units, effect.showIcon, [...castQA.caster.allApplicableEffects()].includes(effect)];
  }, id), [1, "minutes", 0, false]);
  assert.ok(await page.evaluate(() => {
    const message = game.messages.contents.at(-1);
    return game.modules.get("swade-better-effects").api.getRollContext(message).roll.includes("power-preparation");
  }));
  const buttons = messageControls();
  await buttons.getByRole("button", {name: "Cast Options"}).click();
  const options = page.locator(".sbp-effect-cast-options");
  assert.equal(await options.getByRole("checkbox", {name: "Raised"}).isChecked(), true);
  assert.equal(await options.getByRole("checkbox", {name: "Reach"}).isChecked(), true);
  await options.getByRole("checkbox", {name: "Raised"}).uncheck();
  await page.locator(".dialog").filter({has: options}).getByRole("button", {name: "Save"}).click();
  await buttons.getByRole("button", {name: "Apply Effect"}).click();
  await page.waitForFunction(() => castQA.target.effects.some(effect => effect.name === "Extended Ward"));
  assert.deepEqual(await page.evaluate(() => castQA.target.effects.map(effect => effect.name).sort()), ["Extended Ward", "Normal Ward", "Second Ward"]);
  assert.ok(await page.evaluate(() => castQA.target.effects.every(effect =>
    effect.getFlag("swade-better-effects", "templateUuid") === castQA.effects[effect.name].uuid)));
  assert.equal(await page.evaluate(() => castQA.caster.effects.size), 1);

  await page.evaluate(() => { void castQA.caster.rollAttribute("smarts", {item: castQA.power, additionalMods: [{label: "QA", value: 10}]}); });
  await prep.waitFor();
  assert.equal(await prep.isChecked(), false);
  assert.doesNotMatch(await formula.inputValue(), /Maintining/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(id => castQA.caster.effects.filter(effect => effect.getFlag(id, "timedPower")).length === 2, id);
  const prompt = page.locator(".dialog").filter({hasText: "Ward is expired. You can choose to maintain it."});
  const maintain = prompt.getByRole("button", {name: "Maintain", exact: true});
  const expire = prompt.getByRole("button", {name: "Let Expire", exact: true});
  await page.evaluate(() => game.time.advance(61));
  await maintain.waitFor();
  assert.equal(await page.evaluate(() => castQA.caster.effects.some(effect => effect.name === "Maintining: Ward")), false);
  await maintain.click();
  await page.waitForFunction(id => castQA.caster.effects.filter(effect => effect.getFlag(id, "maintenance") === 1).length === 1, id);
  await maintain.click();
  await page.waitForFunction(id => castQA.caster.effects.filter(effect => effect.getFlag(id, "maintenance") === 1).length === 2, id);
  const skillFormula = () => page.evaluate(async () => (await castQA.caster.rollSkill(castQA.skill.id, {suppressChat: true})).formula);
  assert.equal((await skillFormula()).match(/1\[Maintining: Ward\]/g)?.length, 2);
  assert.doesNotMatch(await page.evaluate(async () =>
    (await castQA.caster.rollSkill(castQA.caster.items.getName("Notice").id, {suppressChat: true})).formula), /Maintining/);
  assert.ok(await page.evaluate(() => game.modules.get("swade-better-effects").api.getFlags(castQA.caster).includes("power-maintain")));
  await page.evaluate(() => game.time.advance(61));
  await maintain.click();
  await page.waitForFunction(id => castQA.caster.effects.some(effect => effect.getFlag(id, "maintenance") === 2), id);
  await expire.click();
  await page.waitForFunction(id => castQA.caster.effects.filter(effect => effect.getFlag(id, "timedPower")).length === 1, id);
  assert.match(await skillFormula(), /2\[Maintining: Ward\]/);
  await page.evaluate(async () => {
    await castQA.caster.createEmbeddedDocuments("ActiveEffect", [{name: "Ignore maintenance", type: "base", system: {changes: [
      {key: "sbe.modifyFlag", type: "subtract", value: "power-maintain"}, {key: "sbe.powerRoll.power-preparation", type: "override", value: "3"}
    ]}}]);
    void castQA.caster.rollAttribute("smarts", {item: castQA.power, additionalMods: [{label: "QA failure", value: -20}]});
  });
  await prep.waitFor();
  await prep.check();
  assert.doesNotMatch(await formula.inputValue(), /Maintining/);
  assert.match(await formula.inputValue(), /3\[Power Preparation\]/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(() => !document.querySelector(".roll-dialog"));
  assert.equal(await page.evaluate(id => castQA.caster.effects.filter(effect => effect.getFlag(id, "timedPower")).length, id), 1);
  await page.evaluate(async () => {
    CONFIG.Dice.randomUniform = castQA.random;
    await game.time.advance(61);
  });
  await expire.click();
  await page.waitForFunction(id => !castQA.caster.effects.some(effect => effect.getFlag(id, "timedPower")), id);
  assert.doesNotMatch(await skillFormula(), /Maintining/);

  await page.evaluate(async () => {
    await castQA.caster.sheet.render({force: true});
    castQA.caster.sheet.changeTab("powers", "primary");
  });
  await page.locator(".sbs-powers").getByRole("button", {name: "Power Timers", exact: true}).click();
  const timers = page.locator(".sbp-power-timers");
  const start = timers.getByRole("button", {name: "Start Timer"});
  const stop = timers.getByRole("button", {name: "Stop timer for Ward"});
  await start.click();
  await stop.waitFor();
  assert.match(await timers.locator(".sbp-timer-list").textContent(), /Ward.*Initial duration/s);
  assert.equal(await page.evaluate(id => {
    const effect = castQA.caster.effects.find(effect => effect.getFlag(id, "timedPower"));
    return effect?.showIcon;
  }, id), 0);
  assert.doesNotMatch(await skillFormula(), /Maintining/);
  await start.click();
  await stop.nth(1).waitFor();
  await stop.first().click();
  const stopPrompt = page.locator(".dialog").filter({hasText: "Stop this cast’s timer"});
  await stopPrompt.getByRole("button", {name: "Cancel", exact: true}).click();
  await stopPrompt.waitFor({state: "detached"});
  assert.equal(await stop.count(), 2);
  await stop.first().click();
  await stopPrompt.getByRole("button", {name: "Stop Timer", exact: true}).click();
  await stop.nth(1).waitFor({state: "detached"});

  await page.evaluate(async () => {
    await castQA.caster.sheet.close();
    await [...foundry.applications.instances.values()].find(app => app.element?.matches(".sbp-power-timers"))?.close();
  });
  await page.locator('#swade-hud-persistent [data-sidebar="spells"]').click();
  await page.locator("#swade-hud-sidebar").getByRole("button", {name: "Power Timers", exact: true}).click();
  await stop.waitFor();
  await page.evaluate(() => game.time.advance(61));
  await maintain.click();
  await page.waitForFunction(id => castQA.caster.effects.some(effect => effect.getFlag(id, "maintenance") === 1), id);
  await page.evaluate(async id => {
    // Remove the suppression used earlier so the effect is visible in both HUD panels.
    await castQA.caster.effects.getName("Ignore maintenance").delete();
    castQA.effectId = castQA.caster.effects.find(effect => effect.getFlag(id, "maintenance") === 1).id;
    await [...foundry.applications.instances.values()].find(app => app.element?.matches(".sbp-power-timers"))?.close();
  }, id);
  const effectId = await page.evaluate(() => castQA.effectId);
  const effectSelector = `.effect-item[data-item-id="${effectId}"]`;
  const dockEffect = page.locator("#swade-hud-persistent").locator(effectSelector);
  const sidebarEffect = page.locator("#swade-hud-effects-panel").locator(effectSelector);
  const deletePrompt = page.locator(".swade-hud-effect-delete");
  await dockEffect.click({button: "right"});
  await deletePrompt.getByRole("button", {name: "Cancel", exact: true}).click();
  await deletePrompt.waitFor({state: "detached"});
  await dockEffect.waitFor();
  await sidebarEffect.click({button: "right"});
  await deletePrompt.getByRole("button", {name: "Delete", exact: true}).click();
  await page.waitForFunction(() => !castQA.caster.effects.has(castQA.effectId));
  await dockEffect.waitFor({state: "detached"});
  await sidebarEffect.waitFor({state: "detached"});
  assert.deepEqual(errors, []);
  console.log("PASS effect rows, multi-effect casting, maintenance, manual timers, and HUD deletion confirmations");
} finally {
  await browser.close();
}
