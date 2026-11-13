// Version line for the title, settings and pause menus, with a check for a newer deployed build.
import { VERSION, BUILT } from '../version.js';
import { el } from './dom.js';

let latest = null, checked = 0;
async function check() {
  if (Date.now() - checked < 60000) return latest;
  checked = Date.now();
  try {
    const txt = await (await fetch('js/version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    latest = (txt.match(/VERSION = '([^']+)'/) || [])[1] || null;
  } catch { latest = null; }
  return latest;
}
const num = (v) => v.split('.').map(Number).reduce((a, x) => a * 10000 + x, 0);

export function versionLine() {
  const line = el('div', { class: 'version dim small' }, `Version ${VERSION} · built ${BUILT}`);
  check().then((v) => {
    if (v && num(v) > num(VERSION)) {
      line.append(el('span', { class: 'version-new' }, ` · update ${v} available `),
        el('button', { class: 'btn small gold', onclick: () => location.reload() }, 'Reload'));
    } else if (v) line.append(' · up to date');
  });
  return line;
}
