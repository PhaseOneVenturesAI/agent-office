// Actual HUD/sidebar rendering with synthetic workers; no Office server or provider session.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const out = process.env.USAGE_WORKERS_UI_OUTPUT ?? '/tmp/agent-office-usage-workers-ui';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.context().route('**/__usage_workers.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css">
<div id="app"><div id="hud"><header class="topbar"><nav id="dock" class="dock" aria-label="Office"></nav></header>
<aside class="side"><section id="workers-panel" class="panel workers"><h3>Workers <span id="worker-count" class="count"></span></h3><ul id="workers"></ul></section>
<section id="people-panel"></section><section id="spend"></section><section id="limits"></section><section id="chat"></section><section id="project-meta"></section></aside></div></div>
<script type="module">
import { mountHud } from '/ui/menu.ts';
import { renderWorkers } from '/ui/workers-panel.ts';
import { store, loadSettings } from '/state/index.ts';
const settings = loadSettings(); settings.hud.workers = true; settings.hud.people = false;
store.project = { agentProviders: ['claude'], defaultProvider: 'claude' };
const hud = mountHud([], settings, () => {});
window.setWorkers = workers => {
  store.workers.clear();
  for (const w of workers) store.workers.set(w.id, { kind: 'agent', provider: 'claude', createdAt: 1, color: '#f90', viewers: [], viewerIds: [], ...w });
  renderWorkers(() => {}); hud.refresh();
};
window.setWorkers([]);
</script>` }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__usage_workers.html`);
  const chip = page.locator('#dock .dock-panel').filter({ hasText: 'Workers' });
  await chip.waitFor();
  assert.equal(await page.locator('#hud').count(), 1);
  assert.match(await chip.getAttribute('title'), /^No workers on this floor yet/);
  const board = { id: 'board', name: 'Issues agent', deskId: 'station-issues', status: 'idle' };
  await page.evaluate(w => window.setWorkers([w]), board);
  assert.equal(await page.locator('#workers li').count(), 1);
  assert.match(await chip.getAttribute('title'), /^1 board agent on this floor/);
  assert.equal(await chip.locator('.n').count(), 0, 'the badge retains its hired-worker count');
  assert.equal(await page.locator('#worker-count').textContent(), '');
  await page.screenshot({ path: `${out}/board-only-desktop.png` });

  const desk = { id: 'desk', name: 'Maya', deskId: 'desk-1', status: 'working' };
  await page.evaluate(ws => window.setWorkers(ws), [board, desk]);
  assert.match(await chip.getAttribute('title'), /^1 worker and 1 board agent on this floor/);
  assert.equal(await chip.locator('.n').textContent(), '1');
  assert.equal(await page.locator('#worker-count').textContent(), '1');
  await page.evaluate(w => window.setWorkers([{ ...w, status: 'needs_input' }]), board);
  assert.match(await chip.getAttribute('title'), /^1 board agent on this floor, 1 waiting on someone/);
  const phone = await page.context().newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(page.url());
  await phone.locator('#workers li').waitFor();
  await phone.evaluate(w => window.setWorkers([{ ...w, status: 'needs_input' }]), board);
  await phone.screenshot({ animations: 'disabled', path: `${out}/board-only-phone.png` });
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => window.setWorkers([]));
  assert.match(await chip.getAttribute('title'), /^No workers on this floor yet/);
  assert.deepEqual(errors, []);
  console.log(`HUD worker counts regression passed; screenshots: ${out}`);
} finally {
  await browser.close();
  await server.close();
}
