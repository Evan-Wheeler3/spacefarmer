// Captures key screens at a few resolutions into docs/screens/ for layout review.
// Usage: node tools/screenshots.mjs
import { launch, sleep, hold } from './pw.mjs';
const sizes = [[1280, 720], [1920, 1080], [1024, 768]];
for (const [w, h] of sizes) {
  const { page, errors, close } = await launch({ width: w, height: h, port: 8200 + (w % 97) });
  const shot = (name) => page.screenshot({ path: `docs/screens/${name}-${w}x${h}.png` });
  await sleep(500); await shot('title');
  await page.click('text=NEW GAME'); await sleep(400);
  await hold(page, 'w', 900); await sleep(200); await shot('flight');
  await page.evaluate(async () => {
    const { PRESETS } = await import('/js/data.js');
    game.save.credits = 12000; game.save.upgrades = { frame: 1, shields: 1, brokers: 2, optics: 2 }; game.save.design = { cells: PRESETS.excavator.cells };
    game.save.cargo = { ferrite: 40, cuprite: 12 }; game.save.cargoUnits = 52; game.save.tutorial.done = true;
    game.enterHangar('market');
  });
  await sleep(300); await shot('market');
  for (const tab of ['shipyard', 'research', 'map', 'log']) { await page.evaluate((t) => game.hangar.show(t), tab); await sleep(350); await shot(tab); }
  await page.evaluate(() => game.launch()); await sleep(1200); await shot('flight-excavator');
  console.log(`${w}x${h}`, errors.length ? errors : 'ok');
  await close();
}
