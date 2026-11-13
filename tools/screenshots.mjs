// Captures key screens at a few resolutions into docs/screens/ for layout review.
// Usage: node tools/screenshots.mjs
import { launch, sleep } from './pw.mjs';
const sizes = [[1280, 720], [1920, 1080], [1024, 768]];
for (const [w, h] of sizes) {
  const { page, errors, close } = await launch({ width: w, height: h, port: 8200 + (w % 97) });
  const shot = (name) => page.screenshot({ path: `docs/screens/${name}-${w}x${h}.png` });
  await sleep(1200); await shot('title');
  await page.click('text=NEW GAME'); await sleep(400);
  await page.evaluate(async () => {
    const { PRESETS } = await import('/js/data.js');
    const s = game.save;
    s.tutorial.done = true; game.tutorial.remove();
    s.credits = 42000; s.upgrades = { frame: 2, shields: 1, brokers: 3, optics: 3, plasma: 1, autopilot: 3, ballistics: 2, railgun: 1, fusion: 1, alloys: 1 };
    s.design = { cells: PRESETS.cutter.cells }; s.fighter.design = { cells: PRESETS.citadel.cells };
    s.legacy.points = 3; s.legacy.completed = 0;
    game.enterHangar('market');
    game.world.planet.removeNearest(0, -game.world.planet.R, Math.floor(game.world.planet.total * 0.06));
  });
  await sleep(300); await shot('planet-tab');
  for (const tab of ['shipyard', 'fighter', 'research', 'legacy', 'log']) { await page.evaluate((t) => game.hangar.show(t), tab); await sleep(350); await shot(tab); }
  await page.evaluate(() => { game.launch(); game.lastInput = -1e9; });
  await sleep(9000); await shot('flight');
  await page.evaluate(() => { game.planetView = true; }); await sleep(900); await shot('planet-view');
  await page.evaluate(() => { game.planetView = false; game.enterWatch(); game.enemySystem.shiftT = 240; }); await sleep(5000); await shot('fighter-view');
  console.log(`${w}x${h}`, errors.length ? errors : 'ok');
  await close();
}
