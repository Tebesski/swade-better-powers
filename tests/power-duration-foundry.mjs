// Run with Better Powers and Better Templates enabled in better-setting-qa.
import assert from "node:assert/strict";
import {chromium} from "playwright";

const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
  args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa", "Refusing to modify a campaign world");
  await page.evaluate(() => foundry.nue.Tour.activeTour?.complete());
  await page.addStyleTag({content: "#notifications {pointer-events:none !important}"});
  await page.evaluate(async () => {
    const powers = "swade-better-powers";
    const templates = "swade-better-templates";
    const actor = await Actor.create({name: "Duration QA", type: "character", flags: {[powers]: {
      spellcastingEntries: {general: {id: "general", name: "General", arcane: "general", trait: "smarts", noPowerPoints: true}}
    }}});
    const power = await Item.create({name: "Duration Ward", type: "power", system: {duration: "2 rounds", pp: 1,
      actions: {trait: "smarts"}, templates: {small: true}}, flags: {[powers]: {
      powerModifiers: [{id: "extended", name: "Extension", options: [{id: "plus", label: "Extended", cost: 1}]}]
    }}}, {parent: actor});
    const scene = await Scene.create({name: "Duration QA", width: 1000, height: 1000});
    await scene.activate();
    await scene.view();
    globalThis.durationQA = {actor, power, scene, powers, templates};
    await power.sheet.render({force: true});
    power.sheet.changeTab("modifiers", "main");
  });

  const tab = page.locator(".sbs-modifiers-tab");
  const modifier = tab.locator(".sbs-modifier");
  await modifier.waitFor();
  assert.equal(await modifier.getAttribute("open"), null);
  await modifier.getByRole("button", {name: "Expand modifier"}).click();
  await modifier.getByRole("button", {name: "Add behavior"}).click();
  await page.locator(".dialog").filter({hasText: "Add power behavior"}).getByRole("button", {name: "Add", exact: true}).click();
  const modifierBehavior = modifier.locator(".sbp-duration-behavior");
  await modifierBehavior.waitFor();
  assert.equal(await modifierBehavior.getAttribute("open"), null);
  await tab.getByRole("button", {name: "Add raise", exact: true}).click();
  const raised = tab.locator(".sbp-raise");
  await raised.waitFor();
  assert.equal(await raised.getAttribute("open"), null);
  await raised.locator("summary").click();
  await raised.getByRole("button", {name: "Add behavior"}).click();
  await page.locator(".dialog").filter({hasText: "Add power behavior"}).getByRole("button", {name: "Add", exact: true}).click();
  await raised.locator(".sbp-duration-behavior").waitFor();
  assert.equal(await raised.locator(".sbp-duration-behavior").getAttribute("open"), null);
  await page.waitForFunction(() => {
    const {power, templates} = durationQA;
    const automation = power.getFlag(templates, "automation");
    return automation?.raises[0]?.changes[0]?.system.scope === "power"
      && automation.modifiers[0].options[0].changes[0]?.system.scope === "power";
  });

  await page.evaluate(async () => {
    const {power, templates} = durationQA;
    await power.sheet.close();
    durationQA.builder = game.modules.get(templates).api.openBuilder(power);
  });
  const builder = page.locator(".sbt-builder");
  await builder.locator('[data-accordion="raises"] > [data-action="accordion"]').click();
  await builder.locator('[data-accordion="raises.0"] > [data-action="accordion"]').click();
  const powerAdjustment = builder.locator('[data-behavior-path="raises.0.changes.0"]');
  await powerAdjustment.locator('[data-action="collapseBehavior"]').click();
  await powerAdjustment.getByRole("spinbutton", {name: "Duration amount"}).fill("2");
  const row = builder.locator('[data-add-behavior-path="raises.0.changes"]');
  await row.getByRole("combobox", {name: "Behavior type"}).selectOption("adjustDuration");
  await row.getByRole("button", {name: "Add change", exact: true}).click();
  const adjustment = builder.locator('[data-behavior-path="raises.0.changes.1"]');
  if (!await adjustment.getByRole("spinbutton", {name: "Duration amount"}).isVisible()) {
    await adjustment.locator('[data-action="collapseBehavior"]').click();
  }
  await adjustment.locator('[data-path$=".system.operation"]').selectOption("subtract");
  await adjustment.getByRole("spinbutton", {name: "Duration amount"}).fill("2");
  await builder.getByRole("button", {name: "Save", exact: true}).click();
  await page.waitForFunction(() => {
    const {power, templates} = durationQA;
    return power.getFlag(templates, "automation").raises[0].changes.some(change =>
      change.system.scope === "template" && change.system.operation === "subtract" && change.system.amount === 2);
  });
  assert.deepEqual(await page.evaluate(async () => {
    const {power, templates, powers} = durationQA;
    const {castDefaults, resolveCastOptions} = await import("/modules/swade-better-templates/scripts/variants.mjs");
    const automation = game.modules.get(templates).api.readAutomation(power);
    automation.enabled = true;
    Object.assign(automation.expiration, {enabled: true, amount: 5, unit: "rounds"});
    const selection = castDefaults(automation, {raises: 1});
    const regionDuration = resolveCastOptions(automation, selection).automation.expiration.amount;
    const powerChanges = power.getFlag(powers, "powerRaises")[0].changes;
    return [selection.raise, regionDuration, powerChanges.length, powerChanges[0].system.amount];
  }), [1, 3, 1, 2]);

  await page.evaluate(async () => {
    const {builder, actor, power} = durationQA;
    await builder.close();
    CONFIG.Dice.randomUniform = () => 0.45;
    void actor.rollAttribute("smarts", {item: power, additionalMods: [{label: "QA", value: 10}]});
  });
  const roll = page.locator(".swade.roll-dialog");
  await roll.getByRole("button", {name: "Choose a Power Modifier"}).click();
  await roll.getByRole("button", {name: "Extended (+1)", exact: true}).click();
  await roll.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(() => {
    const {actor, powers} = durationQA;
    return actor.effects.some(effect => effect.getFlag(powers, "timedPower") && effect.toObject().duration.value === 5);
  });
  await page.evaluate(() => game.modules.get(durationQA.powers).api.openPowerTimers(durationQA.actor));
  await page.getByRole("button", {name: "Edit timer for Duration Ward"}).click();
  const editor = page.locator(".dialog").filter({hasText: "Elapsed is the current tick"});
  assert.equal(await editor.getByLabel("Total Duration").inputValue(), "5");
  await editor.getByLabel("Total Duration").fill("7");
  await editor.getByLabel("Elapsed", {exact: true}).fill("2");
  await editor.getByRole("button", {name: "Save", exact: true}).click();
  await page.waitForFunction(() => {
    const {actor, powers} = durationQA;
    const timer = actor.effects.find(effect => effect.getFlag(powers, "timedPower"));
    return timer?.toObject().duration.value === 7 && game.time.worldTime - timer.start.time === 2 * CONFIG.time.roundTime;
  });
  await page.evaluate(() => game.time.advance(5 * CONFIG.time.roundTime));
  const prompt = page.locator(".dialog").filter({hasText: "Duration Ward is expired"});
  await prompt.getByRole("button", {name: "Maintain", exact: true}).click();
  await page.waitForFunction(() => {
    const {actor, powers} = durationQA;
    return actor.effects.some(effect => effect.getFlag(powers, "maintenance") === 1 && effect.toObject().duration.value === 7);
  });
  await page.evaluate(() => durationQA.actor.delete());
  assert.deepEqual(errors, []);
  console.log("PASS shared modifier and raise editors, scoped duration adjustments, rolled duration, and editing a running timer");
} finally {
  await page.evaluate(async () => {
    if (!globalThis.durationQA) return;
    const {actor, scene} = durationQA;
    if (game.actors.has(actor.id)) await actor.delete();
    if (game.scenes.has(scene.id)) await scene.delete();
  }).catch(() => {});
  await browser.close();
}
