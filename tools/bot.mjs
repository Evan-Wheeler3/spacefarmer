// Pacing bot: plays the real game headless, as fast as the CPU allows.
// The autopilot mines, the fighter defends, the swarm escalates: all of it is
// the actual simulation (stepped directly, no rendering). Between docks the bot
// buys research (cheapest useful first) and swaps to the biggest preset ships
// that fit. Repair time is added to the clock without being simulated.
//
//   node tools/bot.mjs                 # until 3 planets are mined (or 12 h)
//   node tools/bot.mjs --hours 2       # stop after 2 game hours
//   node tools/bot.mjs --planets 1     # stop after the first planet
import { launch, sleep } from './pw.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const HOURS = opt('--hours', 12), PLANETS = opt('--planets', 3);

const { page, errors, close } = await launch({ port: 8290, width: 800, height: 500 });
await page.click('text=NEW GAME');
await sleep(300);
await page.evaluate(async () => {
  const [{ PRESETS, UPGRADES, PARTS, LEGACY }, { Design, analyze }, eco] = await Promise.all([import('/js/data.js'), import('/js/shipdesign.js'), import('/js/economy.js')]);
  const g = window.game;
  g.timeScale = 0; // the page's own loop stops simulating; the bot steps the game itself
  g.save.tutorial.done = true; g.tutorial && g.tutorial.remove && g.tutorial.remove();
  g.settings.volume = 0; g.settings.music = 0;
  const bot = window.bot = { simT: 0, repairT: 0, log: [], buys: [] };
  const byRole = (role) => Object.entries(PRESETS).filter(([, p]) => p.role === role);
  const score = (a, role) => role === 'freighter' ? a.mining * Math.min(1, (a.gen + 4) / Math.max(1, a.peakDraw)) * 3 + a.cargo * 0.2 : a.hp + a.dps * 40 + a.shield;
  const fits = (p, role) => {
    const d = Design.fromPreset(p);
    const h = (eco.frameSize(g.save.upgrades) - 1) / 2;
    if (!d.entries.every((e) => eco.partUnlocked(e.part, g.save.upgrades) && Math.abs(e.x) <= h && Math.abs(e.y) <= h && Math.abs(e.x + PARTS[e.part].w - 1) <= h && Math.abs(e.y + PARTS[e.part].h - 1) <= h)) return null;
    const a = analyze(d, g.save.upgrades, { role });
    return a.launchable ? { d, a } : null;
  };
  const best = (role) => {
    let top = null;
    for (const [id, p] of byRole(role)) { const f = fits(p, role); if (f && (!top || score(f.a, role) > top.s)) top = { id, s: score(f.a, role), d: f.d }; }
    return top;
  };
  // weights: lower = buy sooner (tools for the next layer, the swarm, automation)
  const weight = (u) => ({ plasma: 0.15, deepbore: 0.15, frame: 0.8, ballistics: 0.8, fortify: 0.9, optics: 0.8 }[u.id] || 1);
  bot.shop = () => {
    const L = g.save.legacy;
    for (let guard = 0; guard < 40; guard++) {
      const opts = LEGACY.filter((p) => (L.spent[p.id] || 0) < p.cost.length && p.cost[L.spent[p.id] || 0] <= L.points);
      if (!opts.length) break;
      const p = opts.sort((a, b) => a.cost[L.spent[a.id] || 0] - b.cost[L.spent[b.id] || 0])[0];
      L.points -= p.cost[L.spent[p.id] || 0]; L.spent[p.id] = (L.spent[p.id] || 0) + 1;
    }
    g.save.upgrades.__legacy = eco.legacyEffects(L.spent);
    for (let guard = 0; guard < 60; guard++) {
      let pick = null;
      for (const u of UPGRADES) {
        const c = eco.canBuyUpgrade(u.id, g.save);
        if (!c.ok) continue;
        const v = c.cost * weight(u);
        if (!pick || v < pick.v) pick = { u, v, cost: c.cost };
      }
      if (!pick) break;
      g.save.credits -= pick.cost;
      g.save.upgrades[pick.u.id] = (g.save.upgrades[pick.u.id] || 0) + 1;
      bot.buys.push([Math.round(bot.simT + bot.repairT), pick.u.id, g.save.upgrades[pick.u.id]]);
    }
    for (const role of ['freighter', 'fighter']) {
      const b = best(role);
      if (!b) continue;
      const json = b.d.toJSON();
      if (role === 'freighter') { if (bot.freighter !== b.id) { g.save.design = json; bot.freighter = b.id; bot.log.push([Math.round(bot.simT + bot.repairT), 'freighter → ' + b.id]); } }
      else if (bot.fighter !== b.id) { g.save.fighter.design = json; bot.fighter = b.id; bot.log.push([Math.round(bot.simT + bot.repairT), 'fighter → ' + b.id]); }
    }
  };
  // advance the game by `sec` simulated seconds
  bot.run = (sec) => {
    for (const m of document.querySelectorAll('.modal-back')) m.remove();
    if (g.completing) return bot.status();
    if (g.state === 'hangar') {
      if (g.save.fighter.repairT > 0) { bot.repairT += g.save.fighter.repairT; g.save.fighter.repairT = 0; }
      bot.shop();
      g.launch();
      if (g.state !== 'flight') return bot.status('launch failed');
    }
    const steps = Math.round(sec * 60);
    for (let i = 0; i < steps && (g.state === 'flight' || g.state === 'watch') && !g.completing; i++) {
      g.idleLeft = 1e9; // an active player keeps the autopilot going
      g.update(1 / 60);
      bot.simT += 1 / 60;
    }
    return bot.status();
  };
  bot.status = (err) => ({
    err, t: bot.simT + bot.repairT, sim: bot.simT, rep: bot.repairT, state: g.state, planet: g.save.planet.index,
    pct: g.world ? g.world.planet.percent : 0, credits: Math.floor(g.save.credits), freighter: bot.freighter, fighter: bot.fighter,
    kills: g.save.stats.kills, retreats: g.save.stats.retreats, longest: g.save.fighter.longestShift || 0,
    ap: g.ship && g.world ? (() => { const t = g.autopilot.target, pl = g.world.planet; return { mode: g.autopilot.mode, r: Math.round(Math.hypot(g.ship.x, g.ship.y)), tr: t ? Math.round(Math.hypot(t.x, t.y)) : null, mat: t ? pl.matName(pl.matAt(t.i, t.j)) : null, theta: +(g.autopilot.theta || 0).toFixed(2), cargo: Math.round(g.ship.cargoUnits), fuel: Math.round(g.ship.fuel), v: Math.round(Math.hypot(g.ship.vx, g.ship.vy)) }; })() : null,
  });
});

const hms = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const t0 = Date.now();
let lastLog = -1, planet = 0, planetStart = 0;
const splits = [];
for (;;) {
  const st = await page.evaluate(() => bot.run(30));
  if (st.err) { console.log('ERR', st.err); break; }
  if (st.planet !== planet) {
    splits.push(st.t - planetStart);
    console.log(`*** planet ${planet + 1} mined in ${hms(st.t - planetStart)} (total ${hms(st.t)})`);
    planet = st.planet; planetStart = st.t;
    if (planet >= PLANETS) break;
  }
  if (st.state === 'hangar' && st.pct === 0 && st.planet === planet && splits.length) await sleep(50);
  if (Math.floor(st.t / 600) !== lastLog) {
    lastLog = Math.floor(st.t / 600);
    console.log(`${hms(st.t)}  P${st.planet + 1} ${st.pct.toFixed(2)}%  ¢${st.credits}  ${st.freighter}/${st.fighter}  kills ${st.kills}  retreats ${st.retreats}  repairs ${hms(st.rep)}  longest shift ${Math.round(st.longest)}s ${process.env.AP ? JSON.stringify(st.ap) : ''}  [${Math.round((Date.now() - t0) / 1000)}s real]`);
  }
  if (st.t > HOURS * 3600) break;
}
if (args.includes('--shot')) {
  await page.evaluate(() => { game.timeScale = 1; game.cam.snap(game.ship.x, game.ship.y); });
  await sleep(800);
  await page.screenshot({ path: 'docs/screens/bot-end.png' });
  await page.evaluate(() => { game.planetView = true; }); await sleep(800);
  await page.screenshot({ path: 'docs/screens/bot-end-planet.png' });
}
const extra = await page.evaluate(() => ({ log: bot.log, buys: bot.buys.length, ups: game.save.upgrades }));
console.log('ship changes', extra.log.map(([t, s]) => `${hms(t)} ${s}`).join(' · '));
console.log('research', JSON.stringify(extra.ups), `(${extra.buys} purchases)`);
if (splits.length) console.log('planet splits', splits.map(hms).join(' / '));
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await close();
