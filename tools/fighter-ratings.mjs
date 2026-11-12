// Prints how each fighter preset rates against every contract wave and boss.
import { SECTORS, PRESETS, BOSSES, UPGRADES } from '../js/data.js';
import { Design, analyze } from '../js/shipdesign.js';
import { contractWave, rate, bossThreat, contractPay } from '../js/contracts.js';
const lv = (n) => Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(n, u.cost.length)]));
const levels = process.argv[2] ? lv(Number(process.argv[2])) : {};
for (const id of Object.keys(PRESETS).filter((k) => PRESETS[k].role === 'fighter')) {
  const a = analyze(Design.fromPreset(PRESETS[id]), { ...levels, shields: 1, railgun: 1, fusion: 1, cracker: 1, frame: 3 }, { role: 'fighter' });
  console.log(`\n${id}  dps ${a.dps.toFixed(0)}  hp ${a.hp.toFixed(0)}  shield ${a.shield.toFixed(0)}  value ${a.value}`);
  SECTORS.forEach((sec, si) => {
    const row = [];
    for (let k = 0; k < sec.contracts; k++) { const r = rate(a, contractWave(si, k)); row.push(r.risk.toFixed(2)); }
    if (sec.boss) { const r = rate(a, bossThreat(BOSSES[sec.boss])); row.push('B' + r.risk.toFixed(2) + `/${r.ttk.toFixed(0)}s`); }
    console.log('  ' + sec.name.padEnd(14), row.join(' '));
  });
}
