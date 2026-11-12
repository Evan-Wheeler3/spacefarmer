// Runs the REAL fighter simulation headlessly: for each fighter preset and
// sector, fast-forwards N game-minutes from a fresh board and reports what
// it cleared. Used to tune wave sizes, bosses and payouts.
// Usage: node tools/arena.mjs [minutes=10] [presets=bastion,bulwark,citadel,doom] [research level=0]
import { launch } from './pw.mjs';
const minutes = Number(process.argv[2] || 10);
const presets = (process.argv[3] || 'bastion,bulwark,citadel,doom').split(',');
const rl = Number(process.argv[4] || 0);
const { page, errors, close } = await launch({ port: 8190 });
await page.click('text=NEW GAME');
const out = await page.evaluate(async ({ minutes, presets, rl }) => {
  const { PRESETS, SECTORS, UPGRADES } = await import('/js/data.js');
  const res = [];
  game.state = 'hangar';
  for (const id of presets) {
    for (let si = 0; si < SECTORS.length; si++) {
      const s = game.save;
      s.upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(rl, u.cost.length)]));
      Object.assign(s.upgrades, { shields: 1, railgun: 1, fusion: 1, cracker: 1, frame: Math.max(3, s.upgrades.frame || 0), licRust: 1, licGlass: 1, licPale: 1, licGorvox: 1 });
      s.credits = 1e7; s.contracts = {}; s.bossKills = {};
      s.fighter.design = { cells: PRESETS[id].cells }; s.fighter.sector = si; s.fighter.fails = {}; s.fighter.auto = true;
      s.fighter.stats = { earned: 0, contracts: 0, bosses: 0, retreats: 0, kills: 0, since: Date.now() };
      const f = game.fighter; f.world = null; f.mode = 'idle';
      const c0 = s.credits;
      let firstBoss = null;
      for (let i = 0; i < 60 * 60 * minutes; i++) { f.update(1 / 60); if (!firstBoss && s.fighter.stats.bosses) firstBoss = Math.round(i / 60); }
      res.push({ id, sector: SECTORS[si].name, contracts: s.fighter.stats.contracts, retreats: s.fighter.stats.retreats, boss: firstBoss, perMin: Math.round((s.credits - c0) / minutes), board: (s.contracts[SECTORS[si].id] || {}).k });
    }
  }
  return res;
}, { minutes, presets, rl });
for (const r of out) console.log(`${r.id.padEnd(8)} ${r.sector.padEnd(14)} cleared ${String(r.contracts).padStart(3)}  retreats ${String(r.retreats).padStart(3)}  boss ${r.boss != null ? r.boss + 's' : '—'}`.padEnd(70) + `  ¢/min ${r.perMin}  board@${r.board}`);
if (errors.length) console.log(errors);
await close();
