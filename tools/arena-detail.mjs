// Per-contract comparison: real fighter simulation vs the rating model.
// Usage: node tools/arena-detail.mjs preset sector [researchLevel] [minutes]
import { launch } from './pw.mjs';
const [preset = 'bastion', sector = '0', rl = '0', minutes = '12'] = process.argv.slice(2);
const { page, errors, close } = await launch({ port: 8195 });
await page.click('text=NEW GAME');
const out = await page.evaluate(async ({ preset, si, rl, minutes }) => {
  const { PRESETS, SECTORS, UPGRADES } = await import('/js/data.js');
  const { rate, contractWave, bossThreat } = await import('/js/contracts.js');
  const { BOSSES } = await import('/js/data.js');
  const s = game.save; game.state = 'hangar';
  s.upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(rl, u.cost.length)]));
  Object.assign(s.upgrades, { shields: 1, railgun: 1, fusion: 1, cracker: 1, frame: Math.max(3, s.upgrades.frame || 0) });
  s.credits = 1e7; s.contracts = {}; s.bossKills = {};
  s.fighter.design = { cells: PRESETS[preset].cells }; s.fighter.sector = si; s.fighter.fails = {}; s.fighter.auto = true;
  const f = game.fighter; f.world = null; f.mode = 'idle';
  const a = f.analysis();
  const rows = []; let start = null, cur = null, t = 0;
  const origDone = f.onContractDone.bind(f), origRetreat = f.retreat.bind(f), origBoss = f.onBossDefeated.bind(f);
  f.onContractDone = (c, pay) => { rows.push({ c: c.farm ? 'patrol' + (c.k + 1) : 'w' + (c.k + 1), ok: 1, secs: Math.round(t - start) }); origDone(c, pay); };
  f.onBossDefeated = (b, first) => { rows.push({ c: 'BOSS', ok: 1, secs: Math.round(t - start) }); origBoss(b, first); };
  f.retreat = (d) => { const c = f.enemySystem.contract; rows.push({ c: c ? (c.kind === 'boss' ? 'BOSS' : 'w' + (c.k + 1)) : '-', ok: 0, secs: Math.round(t - start) }); origRetreat(d); };
  for (let i = 0; i < 60 * 60 * minutes; i++) {
    const c = f.enemySystem.contract;
    if (c && c !== cur) { cur = c; start = t; }
    f.update(1 / 60); t += 1 / 60;
  }
  const pred = [];
  for (let k = 0; k < SECTORS[si].contracts; k++) { const r = rate(a, contractWave(si, k)); pred.push(`w${k + 1} risk ${r.risk.toFixed(2)} ttk ${r.ttk.toFixed(0)}s`); }
  if (SECTORS[si].boss) { const r = rate(a, bossThreat(BOSSES[SECTORS[si].boss])); pred.push(`BOSS risk ${r.risk.toFixed(2)} ttk ${r.ttk.toFixed(0)}s`); }
  return { dps: a.dps, hp: a.hp, shield: a.shield, rows, pred };
}, { preset, si: Number(sector), rl: Number(rl), minutes: Number(minutes) });
console.log(`${preset} @ sector ${sector} rl${rl}: dps ${out.dps.toFixed(0)} hp ${out.hp.toFixed(0)} shield ${out.shield.toFixed(0)}`);
console.log('predicted:', out.pred.join(' | '));
console.log('actual:   ', out.rows.map((r) => `${r.c}:${r.ok ? '✓' : '✗'}${r.secs}s`).join(' '));
if (errors.length) console.log(errors);
await close();
