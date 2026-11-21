import {chromium} from "playwright";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const data = JSON.parse(await readFile(process.env.SHIELD_EXPORT ?? "C:/Users/Aztec/Downloads/fvtt-Item-shield-6VtoJk8SDH93kCX2.json", "utf8"));
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.on("pageerror", e => console.log("PAGE ERROR", e.stack));
page.on("console", m => { if (m.type() === "error" || m.type() === "warn") console.log(m.text()); });
try {
  await page.goto("http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  await page.addStyleTag({content: ".tour-overlay,#notifications {pointer-events:none!important}"});
  await page.evaluate(async ({data, failed}) => {
    if (game.world.id !== "better-setting-qa") throw Error("QA world required");
    const id = "swade-better-powers";
    const actor = await Actor.create({name: "Shield Maintenance QA", type: "character", flags: {[id]: {spellcastingEntries: {
      spell: {id: "spell", name: "Spellcasting", arcane: "Spellcasting", trait: "Focus", noPowerPoints: true}
    }}}});
    globalThis.shieldQA = {actor, documents: []};
    const [skill] = await actor.createEmbeddedDocuments("Item", [{name: "Focus", type: "skill"}]);
    for (const [index, name] of ["Small Shield", "Medium Shield", "Heavy Shield"].entries()) {
      const gear = await Item.create({name, type: "shield"});
      const effect = await Item.create({name, type: "swade-better-effects.effect", effects: [{name, type: "base",
        duration: {value: 5, units: "rounds"}, system: {changes: [{key: "sbe.addItem", type: "add", value: {uuid: gear.uuid, equipStatus: 3}}]}}]});
      shieldQA.documents.push(gear, effect);
      const config = data.flags[id].applyEffects;
      if (!index) config.base = [effect.uuid];
      else config.modifiers.sturdy[`pm${index}`] = [effect.uuid];
    }
    delete data._id;
    const [power] = await actor.createEmbeddedDocuments("Item", [data]);
    Object.assign(shieldQA, {power});
    const scene = await Scene.create({name: "Shield Maintenance QA", width: 1000, height: 1000});
    shieldQA.scene = scene;
    const [token] = await scene.createEmbeddedDocuments("Token", [{name: actor.name, actorId: actor.id, actorLink: true}]);
    shieldQA.token = token;
    CONFIG.Dice.randomUniform = () => .45;
    void actor.rollSkill(skill.id, {item: power, additionalMods: [{label: "QA", value: failed ? -20 : 10}]});
  }, {data, failed: Boolean(process.env.SHIELD_FAILED)});
  await page.locator(".swade.roll-dialog").getByRole("button", {name: "Roll", exact: true}).click();
  if (!process.env.SHIELD_FAILED) await page.waitForFunction(() => shieldQA.actor.effects.some(e => e.flags["swade-better-powers"]?.timedPower));
  else await page.waitForFunction(() => game.messages.contents.at(-1)?.getFlag("swade-better-powers", "powerCast"));
  await page.evaluate(async () => {
    const message = game.messages.contents.at(-1);
    // Applying an older cast must recover a missing tracker even when its historical marker remains.
    const cast = message.getFlag("swade-better-powers", "powerCast");
    await shieldQA.actor.effects.get(cast.id)?.delete();
    await message.setFlag("swade-better-powers", "powerCast", {...cast, noPP: false, duration: null});
  });
  await page.evaluate(async option => {
    const message = game.messages.contents.at(-1);
    await CONFIG.queries["swade-better-powers.applyCastEffect"]({messageId: message.id, tokenUuid: shieldQA.token.uuid,
      choices: {raise: 0, modifierOptions: option ? {sturdy: option} : {}}}, {user: game.user});
  }, process.env.SHIELD_OPTION ?? "");
  await page.waitForFunction(() => shieldQA.actor.itemTypes.shield.length === 1);
  assert.equal(await page.evaluate(() => shieldQA.actor.effects.some(e => e.flags["swade-better-powers"]?.timedPower)), true);
  assert.equal(await page.evaluate(() => shieldQA.actor.itemTypes.shield[0].name),
    {pm1: "Medium Shield", pm2: "Heavy Shield"}[process.env.SHIELD_OPTION] ?? "Small Shield");
  await page.evaluate(() => game.time.advance(5 * CONFIG.time.roundTime));
  await page.getByRole("button", {name: "Maintain", exact: true}).click();
  await page.waitForFunction(() => shieldQA.actor.effects.some(e => e.flags["swade-better-powers"]?.maintenance === 1));
  assert.equal(await page.evaluate(() => shieldQA.actor.itemTypes.shield.length), 1);
  await page.evaluate(() => game.time.advance(5 * CONFIG.time.roundTime));
  await page.getByRole("button", {name: "Let Expire", exact: true}).click();
  await page.waitForFunction(() => shieldQA.actor.itemTypes.shield.length === 0);
  console.log("PASS Shield expires, maintains without losing item, and expires on request");
} finally {
  await page.evaluate(async () => {
    if (!globalThis.shieldQA) return;
    await shieldQA.actor.delete(); await shieldQA.scene.delete();
    for (const doc of shieldQA.documents) await doc.delete();
  }).catch(() => {});
  await browser.close();
}
