// Actual main.ts, original office, renderer, OutlineEffect and PlayerController; only server data is synthetic.
// Synthetic accounts only; never starts providers or contacts a live Office.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.env.OFFICE_LABEL_ROOT ?? process.cwd());
const out = process.env.OFFICE_LABEL_OUTPUT ?? '/tmp/agent-office-owner-tag-polish'; mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', cacheDir: root + '/node_modules/.vite-owner-label', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [], sent = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Owner label fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'fixture', name: 'Owner label fixture', role: 'member' } } }) }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit={ctx,core,parts};\n' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(raw => {
    const m = JSON.parse(String(raw)); sent.push(m.t);
  }));
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?3d=1');
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'fixture'; s.you = 'fixture-self';
    s.project = { name: 'Owner label fixture', dir: '/fixture', branch: 'main', agentProviders: ['kimi'], defaultProvider: 'kimi' };
    s.workers.clear();
    for (let n = 0; n < 3; n++) { const id = 'worker-' + n; s.workers.set(id, { id, name: ['Issues agent', 'Review agent', 'Build agent'][n], ownerName: ['Jonathan', 'Former account', 'Office'][n], deskId: ['desk-1', 'desk-2', 'desk-5'][n], kind: 'agent', provider: 'kimi', status: 'idle', color: '#4a7dbd', createdAt: Date.now(), createdBy: 'Misleading queue label', cols: 80, rows: 24, viewers: [], viewerIds: [], acked: true }); }
    for (const event of ['project', 'floor', 'workers']) s.emit(event);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    const d = o.office.desks.get('desk-1').def;
    o.player.pos.set(d.x, 0, d.z - 4.5); o.player.camYaw = Math.PI; o.player.lookPitch = -.06; o.player.updateCamera(true);
  });
  await page.waitForTimeout(1000);
  const checks = await page.evaluate(() => {
    const a = window.__audit, s = window.__office.store;
    const label = a.parts.views.workerViews.get('worker-0').model.nameTag;
    const old = label.children.map(c => c.uuid);
    for (let i = 0; i < 20; i++) s.emit('workers');
    const stable = JSON.stringify(old) === JSON.stringify(label.children.map(c => c.uuid));
    const owners = [...a.parts.views.workerViews.values()].map(v => v.model.nameTag.ownerText);
    s.workers.get('worker-0').ownerName = 'Updated owner'; s.emit('workers');
    const updated = label.ownerText === 'Owner: Updated owner' && label.children.length === 2;
    s.workers.get('worker-0').ownerName = 'Jonathan'; s.emit('workers');
    return { stable, updated, owners };
  });
  assert.equal(checks.stable, true); assert.equal(checks.updated, true);
  assert.deepEqual(checks.owners, ['Owner: Jonathan', 'Owner: Former account', 'Owner: Office']);
  for (const [width, height, name] of [[1440, 1000, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({width, height}); await page.waitForTimeout(300);
    await page.screenshot({path: out + '/' + name + '.png'});
  }
  const workers = await page.evaluate(() => [...window.__office.store.workers.values()]);
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/lite.html');
  await page.waitForFunction(() => window.__lite?.net.up);
  await page.evaluate(workers => { const s = window.__lite.store; s.project = { name: 'Owner label fixture', dir: '/fixture', branch: 'main', agentProviders: ['kimi'], defaultProvider: 'kimi' }; for (const w of workers) s.workers.set(w.id, w); s.emit('workers'); s.emit('project'); }, workers);
  assert.deepEqual(await page.locator('.lite-owner').allTextContents(), ['Owner: Jonathan', 'Owner: Former account', 'Owner: Office']);
  for (const [width, height, name] of [[1440, 1000, 'lite-desktop'], [390, 844, 'lite-phone']]) {
    await page.setViewportSize({width, height}); await page.waitForTimeout(300); await page.screenshot({path: out + '/' + name + '.png'});
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(sent.filter(t => /spawn|hire|resume/.test(t)), []);
  writeFileSync(out + '/report.json', JSON.stringify({ checks, errors, providerStarts: sent.filter(t => /spawn|hire|resume/.test(t)), browser: browser.version() }, null, 2));
  console.log(JSON.stringify({out,checks,errors}));
} finally { await browser.close(); await server.close(); }
