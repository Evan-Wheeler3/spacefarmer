// Shared Playwright helpers for playtests and screenshots.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
export { devices };
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function launch({ port = 8123, width = 1366, height = 768, clearSave = true, device = null } = {}) {
  const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(device ? devices[device] : { viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (clearSave) {
    await page.goto(`http://localhost:${port}/tools/blank.html`).catch(() => {});
    await page.evaluate(() => localStorage.clear()).catch(() => {});
  }
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => window.game, null, { timeout: 8000 });
  const close = async () => { await browser.close(); server.kill(); };
  return { page, browser, errors, close };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function hold(page, key, ms) { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); }
