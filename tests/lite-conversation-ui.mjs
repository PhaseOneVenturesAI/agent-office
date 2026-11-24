// Exercise the actual /lite entry point with synthetic state and a local fake WebSocket.
// No Office server, provider process, credentials, or live account is used.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const out = process.env.LITE_CONVERSATION_UI_OUTPUT ?? '/tmp/agent-office-lite-conversation-ui';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], sent = [];
page.on('pageerror', e => errors.push(e.message));
let didConnect;
const connected = new Promise(resolve => { didConnect = resolve; });
await page.routeWebSocket(/\/ws(?:\?|$)/, ws => {
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw)); sent.push(message);
      if (message.t === 'conversation.open') ws.send(JSON.stringify({ t: 'conversation.state', workerId: message.workerId, supported: true, messages: [{ id: 'existing', role: 'assistant', text: 'Existing task reply, ready for review.', at: 1 }] }));
    });
    didConnect();
});
const workerMessages = () => sent.filter(m => /^(worker\.|conversation\.|approval\.)/.test(m.t));
try {
  await page.addInitScript(() => {
    window.fixtureNotifications = [];
    window.Notification = class {
      static permission = 'granted';
      constructor(title, options) { this.title = title; this.options = options; window.fixtureNotifications.push(this); }
      close() { this.onclose?.(); }
    };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await page.route('**/api/whoami', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'owner', name: 'Owner', role: 'member' } } }) }));
  await page.route('**/api/linear?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false, connected: false, canManage: false, canConfigure: false, departments: [], taskPermissions: {} }) }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/lite.html`);
  await connected;
  await page.evaluate(async () => {
    const { store } = await import('/state/index.ts');
    store.floor = 'fixture'; store.floors = [{ id: 'fixture', name: 'Fixture office', people: 1, waiting: 0 }];
    store.project = { name: 'Fixture office', dir: '/fixture', agentProviders: ['claude', 'codex', 'kimi'], defaultProvider: 'claude' };
    store.emit('project'); store.emit('floors');
    window.setWorker = (patch = {}) => {
      const worker = { id: 'worker', owner: 'owner', name: 'Maya', kind: 'agent', provider: 'claude', status: 'idle', sessionId: 'native-fixture', deskId: 'desk-1', color: '#f90', createdAt: 1, cols: 80, rows: 24, viewers: [], viewerIds: [], ...patch };
      store.workers.clear(); store.workers.set(worker.id, worker); store.emit('workers');
    };
    window.addQueueTask = () => { store.queue = { tasks: [{ id: 'task', title: 'Fixture task', prompt: 'Fixture', addedBy: 'Owner', addedAt: 1, status: 'running', workerId: 'worker', workerName: 'Maya', owner: 'owner', provider: 'claude' }], maxWorkers: 2 }; store.emit('queue'); };
    window.setWorker();
  });

  for (const [provider, width, height] of [['claude', 1440, 1000], ['codex', 390, 844], ['kimi', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(p => window.setWorker({ provider: p }), provider);
    sent.length = 0;
    await page.locator('#workers .lite-card').click();
    const conversation = page.getByRole('dialog', { name: 'Maya conversation', exact: true });
    assert.equal(await conversation.count(), 1, `${provider}: lite worker cards must open Conversation first`);
    await conversation.getByText('Existing task reply, ready for review.', { exact: true }).waitFor();
    assert.deepEqual(workerMessages(), [{ t: 'approval.open', workerId: 'worker' }, { t: 'conversation.open', workerId: 'worker' }], 'awake cards do not attach, resume or spawn a provider');
    assert.match(await page.locator('#workers .lite-card').getAttribute('aria-label'), /open its conversation$/);
    await page.screenshot({ animations: 'disabled', path: `${out}/${provider}-conversation.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await conversation.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByRole('dialog', { name: 'Maya terminal', exact: true }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Keys', exact: true }).count(), 1, 'Terminal keeps the lite keypad');
    assert.ok(workerMessages().some(m => m.t === 'worker.attach' && m.workerId === 'worker'));
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);

    await page.evaluate(p => { window.setWorker({ provider: p }); window.setWorker({ provider: p, status: 'needs_input' }); }, provider);
    sent.length = 0;
    await page.evaluate(() => window.fixtureNotifications.at(-1).onclick());
    await conversation.waitFor();
    assert.ok(workerMessages().some(m => m.t === 'conversation.open'));
    assert.ok(!workerMessages().some(m => m.t === 'worker.attach'), 'notification clicks use the same Conversation route');
    await page.keyboard.press('Escape');
  }

  await page.evaluate(() => window.setWorker({ kind: 'shell', provider: undefined, name: 'Shell' }));
  sent.length = 0; await page.locator('#workers .lite-card').click();
  await page.getByRole('dialog', { name: 'Shell terminal', exact: true }).waitFor();
  assert.match(await page.locator('#workers .lite-card').getAttribute('aria-label'), /open its terminal$/);
  assert.ok(!workerMessages().some(m => m.t.startsWith('conversation.')));
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.setWorker({ status: 'offline' }));
  sent.length = 0; await page.locator('#workers .lite-card').click();
  await page.getByRole('dialog', { name: 'Maya conversation', exact: true }).waitFor();
  assert.deepEqual(workerMessages().filter(m => m.t === 'worker.resume'), [{ t: 'worker.resume', workerId: 'worker' }], 'opening an asleep agent preserves its one explicit resume');
  assert.ok(!workerMessages().some(m => ['worker.spawn', 'worker.prompt', 'conversation.send'].includes(m.t)));
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.setWorker({ status: 'offline', worktree: { path: '/fixture/missing', branch: 'office/fixture', base: 'main' }, lost: { branch: 'here' } }));
  sent.length = 0; await page.locator('#workers .lite-card').click();
  await page.getByRole('alertdialog', { name: "🌿 Maya's worktree was deleted", exact: true }).waitFor();
  assert.deepEqual(workerMessages(), [], 'lost worktree recovery comes before resume, attach or Conversation');
  await page.keyboard.press('Escape');

  await page.evaluate(() => { window.setWorker(); window.addQueueTask(); });
  await page.locator('#btn-queue').click();
  await page.getByText('🤖 Agent work queue', { exact: true }).click();
  sent.length = 0;
  await page.getByRole('button', { name: '🖥️ Terminal', exact: true }).click();
  await page.getByRole('dialog', { name: 'Maya terminal', exact: true }).waitFor();
  assert.ok(workerMessages().some(m => m.t === 'worker.attach'));
  assert.ok(!workerMessages().some(m => m.t.startsWith('conversation.')), 'an explicitly labeled Terminal action remains Terminal');
  assert.deepEqual(errors, []);
  console.log(`Actual lite card, notification, shell, resume, lost-worktree and Terminal routes passed; screenshots: ${out}`);
} finally {
  await browser.close();
  await server.close();
}
