// Validates every preset: all parts placed, connected, no blocked thrusters.
import { PRESETS, PARTS } from '../js/data.js';
import { Design, analyze } from '../js/shipdesign.js';
const all = { torch: 1, fusion: 1, cracker: 1, railgun: 1, shields: 1, tractor: 1, frame: 3 };
let fail = 0;
for (const [id, p] of Object.entries(PRESETS)) {
  const d = Design.fromJSON({ cells: p.cells });
  const a = analyze(d, all);
  const lost = p.cells.length - d.entries.length;
  const errs = a.warnings.filter((w) => w.lvl === 'err').map((w) => w.text);
  console.log(`${id.padEnd(11)} parts ${d.entries.length}/${p.cells.length} value ${a.value} mass ${a.mass.toFixed(1)} accel ${a.accel.toFixed(0)} turn90 ${a.turn90.toFixed(2)}s imb ${(a.imbalance/1000).toFixed(0)}k/${(a.gyroTorque/1000).toFixed(0)}k dps ${a.dps.toFixed(0)} mine ${a.mining.toFixed(0)} cargo ${a.cargo} pow ${a.gen}/${a.peakDraw.toFixed(1)}`);
  for (const w of a.warnings) console.log('   ', w.lvl, w.text);
  if (lost || (errs.length && id !== 'larry')) fail++;
}
process.exit(fail ? 1 : 0);
