// Isolated real-component preview: no Office login, provider process, or live Linear request.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.LINEAR_UI_OUTPUT ?? '/tmp/agent-office-linear-ui'; mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
const tasks = [{ id: 'task-one', title: 'Keep Plimbo’s mascot consistent in the explainer', prompt: 'Use the approved illustrated style. Review the scene before rendering.', addedBy: 'Linear', addedAt: Date.now(), status: 'planned', linear: { organizationId: 'test-org', issueId: 'test-issue', teamId: 'team', identifier: 'PLI-142', url: 'https://linear.app/example/issue/PLI-142', assigneeId: 'ivan-linear', assigneeName: 'Ivan', accountId: 'ivan', stateId: 'todo', stateName: 'To do', workStatus: 'todo', updatedAt: '2026-11-23T00:00:00.000Z' } }];
const state = { configured: true, connected: true, canConfigure: true, canManage: true, organization: { id: 'test-org', name: 'Preview workspace' }, lastSync: Date.now(), mapping: { floorId: 'plimbo', teamId: 'team', states: { todo: 'todo', inProgress: 'progress', inReview: 'review', completed: 'complete' } }, people: [{ id: 'ivan-linear', name: 'Ivan', email: 'ivan@example.test' }], teams: [{ id: 'team', name: 'Plimbo', key: 'PLI', states: [{ id: 'todo', name: 'To do' }, { id: 'progress', name: 'In progress' }, { id: 'review', name: 'In review' }, { id: 'complete', name: 'Completed' }] }], departments: [{ id: 'marketing', name: 'Marketing', canCreate: true }], taskPermissions: { 'task-one': { edit: true, assign: true } }, accounts: [{ id: 'ivan', name: 'Ivan' }], userMap: { 'ivan-linear': 'ivan' } };
try {
  await page.route('**/api/linear?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
  await page.route('**/__linear_preview.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="modal-root"></div><div id="toasts"></div><script type="module">import {store} from '/state/index.ts'; import {openQueue} from '/ui/queue.ts'; store.floor='plimbo'; store.me={admin:false,account:{id:'ivan',name:'Ivan',role:'member'}}; store.queue=${JSON.stringify({ tasks, maxWorkers: 2 })}; store.project={agentProviders:['claude','kimi','codex'],defaultProvider:'claude'}; window.sent=[]; openQueue({send:(msg)=>window.sent.push(msg)},()=>{});</script></body></html>` }));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('http://127.0.0.1:5197/__linear_preview.html');
  await page.getByText('PLI-142', { exact: false }).waitFor();
  await page.screenshot({ animations: 'disabled', path: `${out}/linear-desktop.png` });
  await page.getByRole('button', { name: 'Start my agent', exact: true }).click();
  await page.getByText('Runs using Ivan’s connected subscription.', { exact: false }).waitFor();
  assert.equal((await page.evaluate(() => window.sent)).length, 0, 'opening a provider picker must not launch an agent');
  await page.getByRole('button', { name: 'Start my agent', exact: true }).first().click();
  assert.equal((await page.evaluate(() => window.sent))[0].t, 'queue.startOwn');
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: `${out}/linear-edit-desktop.png` });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ animations: 'disabled', path: `${out}/linear-mobile.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow on phone');
  await page.getByRole('button', { name: 'Linear settings', exact: true }).click();
  await page.getByRole('button', { name: 'Link floor & people', exact: true }).click();
  await page.getByLabel('Default department for imported tasks').waitFor();
  await page.screenshot({ animations: 'disabled', path: `${out}/linear-setup-mobile.png` });
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []); console.log(`Linear UI checks passed; screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
