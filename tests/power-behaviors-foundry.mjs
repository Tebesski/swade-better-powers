// Run with Better Powers, Better Effects and Better Templates in better-setting-qa.
import assert from "node:assert/strict";
import {chromium} from "playwright";

const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const powers = "swade-better-powers";
const effects = "swade-better-effects";
const picker = page.locator(".sbe-effect-picker");

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa", "Refusing to modify a campaign world");
  await page.evaluate(async () => { await canvas.initializing; await foundry.nue.Tour.activeTour?.complete(); });
  await page.addStyleTag({content: "#notifications {pointer-events:none !important}"});

  await page.evaluate(async ({effects, powers}) => {
    const prefix = `Power Behaviors QA ${Date.now()}`;
    const actor = await Actor.create({name: prefix, type: "character", effects: [{name: "Clear QA Ward", type: "base"}], flags: {[powers]: {
      spellcastingEntries: {general: {id: "general", name: "General", arcane: "general", trait: "smarts", noPowerPoints: true}}
    }}});
    const target = await Actor.create({name: `${prefix} Target`, type: "npc", effects: [{name: "Clear QA Ward", type: "base"}]});
    const template = await Item.create({name: `${prefix} Caster Ward`, type: `${effects}.effect`, effects: [{name: "QA Caster Ward", type: "base"}]});
    const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({name: `power-picker-qa-${Date.now()}`,
      label: `${prefix} Pack`, type: "Item", package: "world", system: "swade"});
    await Item.create({name: "QA Pack Ward", type: `${effects}.effect`, effects: [{name: "QA Pack Ward", type: "base"}]}, {pack: pack.collection});
    const macro = await Macro.create({name: prefix, type: "script", command: 'await actor.setFlag("swade-better-powers", "qaMacro", item.name);'});
    const power = await Item.create({name: "QA Power", type: "power", system: {duration: "2 rounds", damage: "2d6", pp: 1,
      actions: {trait: "smarts"}, templates: {small: true}}}, {parent: actor});
    const trusted = game.settings.get(powers, "trustedPowerCode");
    const {savePowerModifiers, savePowerRaises} = await import(`/modules/${powers}/scripts/power-modifiers.mjs`);
    const behavior = (type, system) => ({id: foundry.utils.randomID(), type, system, enabled: true});
    await savePowerModifiers(power, [{id: "alter", name: "Alter", options: [{id: "alter-one", label: "One", cost: 0, changes: [
      behavior("removeEffect", {effect: "Clear QA Ward"}),
      behavior("addEffect", {effectUuid: template.uuid, duration: {enabled: true, amount: 3, unit: "minutes"}}),
      behavior("addDamageDice", {formula: "1d4"})
    ]}]}]);
    await savePowerRaises(power, [{id: "raise-one", level: 1, changes: [
      behavior("adjustDuration", {scope: "power", operation: "add", amount: 1, unit: "rounds"}),
      behavior("increaseDieType", {scope: "all", steps: "1"}),
      behavior("chatMessage", {text: `${prefix} cast behavior`, rollMode: "inherit"}),
      behavior("executeMacro", {macroUuid: macro.uuid}),
      behavior("executeScript", {script: `await actor.setFlag("${powers}", "qaScript", (actor.getFlag("${powers}", "qaScript") ?? 0) + 1);`})
    ]}, {id: "raise-two", level: 2, changes: [behavior("addDamageDice", {formula: "5d12"})]}]);
    const scene = await Scene.create({name: prefix, width: 1200, height: 1000});
    const [casterToken, targetToken] = await scene.createEmbeddedDocuments("Token", [
      {name: actor.name, actorId: actor.id, actorLink: true, x: 200, y: 200},
      {name: target.name, actorId: target.id, actorLink: true, x: 500, y: 200}
    ]);
    await scene.activate();
    await canvas.initializing;
    const saved = game.settings.get(effects, "effectPickerSources");
    globalThis.qa = {prefix, actor, target, scene, casterToken, targetToken, template, power, macro, pack, saved, trusted, dice: CONFIG.Dice.randomUniform};
    await game.settings.set(effects, "effectPickerSources", {});
    await power.sheet.render({force: true});
    power.sheet.changeTab("modifiers", "main");
  }, {effects, powers});

  const modifier = page.locator(".sbs-modifier");
  await modifier.getByRole("button", {name: "Expand modifier"}).click();
  await modifier.getByRole("button", {name: "Add behavior", exact: true}).click();
  const types = page.locator('.dialog select[name="behavior"]');
  assert.deepEqual(await types.locator("option").allTextContents(), ["Adjust Duration", "Increase Die Type", "Add Damage Dice", "Send Chat Message", "Remove Effect", "Execute Macro", "Execute Script", "Add Effect"]);
  await types.locator("xpath=ancestor::dialog").getByRole("button", {name: "Close Window"}).click();
  const addEffect = modifier.locator('[data-type="addEffect"]');
  assert.equal(await addEffect.getAttribute("open"), null);
  await addEffect.locator("summary").click();
  await addEffect.getByRole("button", {name: "Browse effects"}).click();
  await picker.locator("summary").click();
  const packRow = picker.locator(".sbe-effect-picker-results label").filter({hasText: "QA Pack Ward"});
  await packRow.waitFor();
  await picker.getByRole("checkbox", {name: await page.evaluate(() => qa.pack.title), exact: true}).uncheck();
  await packRow.waitFor({state: "hidden"});
  await picker.getByRole("button", {name: "Clear all"}).click();
  await picker.getByRole("checkbox", {name: "World effects", exact: true}).check();
  await picker.getByRole("checkbox", {name: "SWADE conditions", exact: true}).check();
  assert.deepEqual(await picker.locator("[data-source]:visible").evaluateAll(rows => [...new Set(rows.map(row => row.dataset.source))].sort()), ["swade", "world"]);
  await picker.locator("xpath=ancestor::dialog").getByRole("button", {name: "Close Window"}).click();
  await picker.waitFor({state: "detached"});
  await addEffect.getByRole("button", {name: "Construct with A.E.G.I.S."}).click();
  await page.locator('.sbe-aegis input[name="name"]').fill("QA Inline Ward");
  await page.locator('.sbe-aegis button[type="submit"]').click();
  await addEffect.getByText("QA Inline Ward", {exact: true}).waitFor();
  await page.waitForFunction(effects => game.settings.get(effects, "effectPickerSources").sources?.join() === "world,swade", effects);
  await page.evaluate(() => { void game.modules.get("swade-better-templates").api.pickEffect(); });
  await picker.waitFor();
  await picker.locator("summary").click();
  assert.deepEqual(await picker.locator('[name="source"]:checked').evaluateAll(inputs => inputs.map(input => input.value)), ["world", "swade"]);
  await picker.locator("xpath=ancestor::dialog").getByRole("button", {name: "Close Window"}).click();
  await picker.waitFor({state: "detached"});

  await page.evaluate(async ({effects}) => {
    await game.settings.set(effects, "effectPickerSources", qa.saved);
    await qa.power.sheet.close();
  }, {effects});
  await page.waitForFunction(() => canvas.ready && qa.targetToken.object && qa.casterToken.object);
  await page.evaluate(() => {
    qa.casterToken.object.control();
    qa.targetToken.object.setTarget(true);
    ui.sidebar.changeTab("chat", "primary");
    ui.sidebar.expand();
    CONFIG.Dice.randomUniform = () => 0.45;
    void qa.actor.rollAttribute("smarts", {item: qa.power, additionalMods: [{label: "QA", value: 7}]});
  });
  const dialog = page.locator(".swade.roll-dialog");
  await dialog.getByRole("button", {name: "Choose a Power Modifier"}).click();
  await dialog.locator('button[data-option-id="alter-one"]').click();
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(powers => qa.actor.getFlag(powers, "qaScript") === 1, powers);
  const result = await page.evaluate(powers => {
    const messages = game.messages.filter(message => message.getFlag(powers, "powerCast")?.itemUuid === qa.power.uuid);
    const cast = messages.at(-1);
    const timer = qa.actor.effects.find(effect => effect.flags[powers]?.timedPower);
    const ward = qa.actor.effects.find(effect => effect.name === "QA Caster Ward");
    qa.cast = cast;
    return {timer: timer?.toObject().duration.value, ward: [ward?.toObject().duration.value, ward?.toObject().duration.units],
      inlineWard: qa.actor.effects.some(effect => effect.name === "QA Inline Ward"),
      casterCleared: !qa.actor.effects.some(effect => effect.name === "Clear QA Ward"),
      targetEffects: qa.target.effects.map(effect => effect.name), macro: qa.actor.getFlag(powers, "qaMacro"),
      messages: game.messages.filter(message => message.content.includes(`${qa.prefix} cast behavior`)).length,
      leakedCode: JSON.stringify(cast.flags[powers]).includes("await actor.setFlag"),
      templateChanges: qa.power.getFlag("swade-better-templates", "automation").raises[0].changes.map(change => change.type)};
  }, powers);
  assert.deepEqual(result, {timer: 3, ward: [3, "minutes"], inlineWard: true, casterCleared: true, targetEffects: ["Clear QA Ward"], macro: "QA Power", messages: 1,
    leakedCode: false, templateChanges: ["adjustDuration"]});

  const damage = page.locator("button[data-sbp-cast-damage]").last();
  assert.equal(await damage.textContent(), "(2d8) + (1d6)");
  await damage.click();
  const formula = await dialog.locator("textarea").inputValue();
  assert.match(formula, /2d8x/);
  assert.match(formula, /\(1d6\)/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(() => game.messages.some(message => message.rolls.some(roll => /2d8x.*1d6/.test(roll.formula))));

  await page.evaluate(async powers => {
    await qa.cast.update({rolls: qa.cast.rolls.map(roll => roll.toJSON())}, {render: false});
    const {runCastBehaviors} = await import(`/modules/${powers}/scripts/behavior-actions.mjs`);
    await runCastBehaviors(qa.cast, qa.cast.getFlag(powers, "powerCast"), 1);
  }, powers);
  assert.equal(await page.evaluate(powers => qa.actor.getFlag(powers, "qaScript"), powers), 1);
  if (await page.evaluate(() => game.modules.get("swade-hud")?.active)) {
    await page.evaluate(async () => {
      const {useItem} = await import("/modules/swade-hud/scripts/swade.js");
      void useItem(qa.actor, qa.power, "formula", undefined, {castCard: true, nativeOnly: true, additionalMods: [{label: "QA", value: 15}]});
    });
    await dialog.getByRole("button", {name: "Roll", exact: true}).click();
    const hudDamage = page.locator(".swade-hud-power-cast button[data-sbp-cast-damage]").last();
    await hudDamage.waitFor();
    assert.equal(await hudDamage.textContent(), "(2d6) + (5d12)");
    assert.equal(await page.evaluate(powers => qa.actor.getFlag(powers, "qaScript"), powers), 1);
    await hudDamage.click();
    assert.match(await dialog.locator("textarea").inputValue(), /2d6x.*\(5d12\)/);
    await dialog.getByRole("button", {name: "Roll", exact: true}).click();
    await page.waitForFunction(() => game.messages.some(message => message.rolls.some(roll => /2d6x.*5d12/.test(roll.formula))));
  }
  assert.deepEqual(errors, []);
  console.log("All eight behaviors, caster-only effects, rolled damage, template isolation, and shared picker persistence passed.");
} finally {
  await page.evaluate(async ({powers, effects}) => {
    if (!globalThis.qa) return;
    CONFIG.Dice.randomUniform = qa.dice;
    await game.settings.set(effects, "effectPickerSources", qa.saved);
    await game.settings.set(powers, "trustedPowerCode", qa.trusted);
    const messages = game.messages.filter(message => message.getFlag(powers, "powerCast")?.itemUuid === qa.power.uuid
      || message.content.includes(qa.prefix) || message.speaker.actor === qa.actor.id);
    if (messages.length) await ChatMessage.deleteDocuments(messages.map(message => message.id));
    for (const document of [qa.scene, qa.actor, qa.target, qa.template, qa.macro]) await document.delete();
    await qa.pack.deleteCompendium();
  }, {powers, effects}).catch(() => {});
  await browser.close();
}
