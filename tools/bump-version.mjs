// Stamps js/version.js with the build number (= commit count + 1, i.e. the commit
// about to be made) and the time. Run it right before committing:
//   node tools/bump-version.mjs && git add js/version.js
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
try { n = Number(execSync('git rev-list --count HEAD', { cwd: root }).toString().trim()) || 0; } catch {}
const build = n + 1;
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
writeFileSync(path.join(root, 'js/version.js'),
  `// Written by tools/bump-version.mjs before every commit. Don't edit by hand.\nexport const VERSION = '1.0.${build}';\nexport const BUILT = '${built}';\n`);
console.log(`version 1.0.${build} (${built})`);
