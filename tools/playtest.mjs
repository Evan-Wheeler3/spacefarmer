// Automated playtest: runs the REAL game in headless Chromium, flies the real
// ship with a test autopilot (seek rock -> mine -> return -> dock -> sell),
// fast-forwarding game time, and reports trip timings + any console errors.
// Usage: node tools/playtest.mjs [gameSeconds=300] [preset]
import { launch, sleep } from './pw.mjs';
const seconds = Number(process.argv[2] || 300);
const preset = process.argv[3] || null;
const { page, errors, close } = await launch();
await page.click('text=NEW GAME');
await sleep(200);
const res = await page.evaluate(async ({ seconds, preset }) => {
  const ap = await import('/tools/autopilot.js');
  const { PRESETS } = await import('/js/data.js');
  if (preset) { game.save.design = { cells: PRESETS[preset].cells }; game.save.upgrades = { frame: 3, torch: 1, fusion: 1, railgun: 1, shields: 1, tractor: 1, cracker: 1 }; game.launch(); }
  ap.install(game);
  const trips = [];
  let t0 = game.time;
  game.onAutoHangar = () => {
    const c = game.save.cargoUnits, before = game.save.credits;
    game.hangar.sellAll(document.createElement('button'));
    game.repair();
    trips.push({ t: +(game.time - t0).toFixed(1), ore: Math.round(c), earned: game.save.credits - before, kills: game.lastTrip?.kills || 0 });
    t0 = game.time;
    game.launch();
  };
  ap.simulate(game, seconds);
  const total = trips.reduce((a, t) => a + t.earned, 0);
  return { trips, perMinute: Math.round(total / (seconds / 60)), credits: game.save.credits, deaths: game.save.stats.deaths };
}, { seconds, preset });
console.log(JSON.stringify(res, null, 1));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
await close();
process.exit(errors.length ? 1 : 0);
