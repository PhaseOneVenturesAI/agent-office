// Actual Settings modal with a synthetic account transport. No Office server or provider calls.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const out = process.env.PERSONAL_AUTONOMY_UI_OUTPUT ?? '/tmp/agent-office-personal-autonomy-ui';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.stack ?? error.message));
try {
  await page.context().route('**/__my_agents.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="modal-root"></div>
<script type="module">
import {openSettings} from '/ui/settings.ts';import {store,loadSettings} from '/state/index.ts';
store.me.account={id:'aaaaaaaaaaaaaaaa',name:'Alex',role:'member'};store.project={name:'Demo',agentCmd:'kimi',agentProviders:['claude','kimi','codex'],defaultProvider:'kimi'};
window.sent=[];window.listeners=new Set();const statuses=new Set();const net={up:true,send:m=>window.sent.push(m),onMessage:f=>{window.listeners.add(f);return()=>window.listeners.delete(f)},onStatus:f=>{statuses.add(f);return()=>statuses.delete(f)}};
window.receive=m=>{for(const f of window.listeners)f(m)};
window.reply=(state,error)=>window.receive({t:'personal.autonomy.state',requestId:window.sent.at(-1).requestId,state,error});
window.disconnect=()=>{net.up=false;for(const f of statuses)f(false)};
window.open=()=>openSettings(net,loadSettings(),()=>{},()=>{},{ding(){},needsYou(){}},{sample(){}},()=>{},undefined,'agents');window.open();
</script>` }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__my_agents.html`);
  assert.deepEqual(errors, []);
  const toggle = page.getByRole('switch', { name: 'Automatic approvals for my agents' });
  await toggle.waitFor(); assert.equal(await toggle.isDisabled(), true);
  const state = { configured: true, automatic: true, workers: [
    { id: 'kimi', name: 'My Kimi agent', floor: 'Plimbo', provider: 'kimi', requested: 'autonomous', status: 'applied', detail: 'Kimi acknowledged automatic review.', pendingApproval: true },
    { id: 'claude', name: 'My Claude agent', floor: 'Runway', provider: 'claude', requested: 'autonomous', status: 'pending', detail: 'Saved for the next launch; active work is kept.' },
    { id: 'manager', name: 'Marketing manager', floor: 'Plimbo', provider: 'kimi', requested: 'supervised', status: 'override', detail: 'Explicit role setting: manual. Your default does not replace it.', roleOverride: true },
  ] };
  await page.evaluate(s => window.reply(s), state);
  assert.equal(await toggle.isChecked(), true); assert.equal(await toggle.isEnabled(), true);
  await page.getByText('An existing approval still needs a choice in this agent’s Conversation.').waitFor();
  assert.equal(await page.getByText('Role override', { exact: true }).count(), 1);
  await page.screenshot({ animations: 'disabled', path: `${out}/my-agents-desktop.png` });
  const phone = await page.context().newPage(); phone.on('pageerror', error => errors.push(error.message));
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.goto(page.url());
  await phone.getByRole('switch').waitFor(); await phone.evaluate(s => window.reply(s), state);
  assert.equal(await phone.getByRole('dialog').count(), 1);
  await phone.screenshot({ animations: 'disabled', path: `${out}/my-agents-phone.png` });
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await phone.close();
  await toggle.click(); assert.equal(await toggle.isDisabled(), true);
  const request = await page.evaluate(() => window.sent.at(-1)); assert.equal(request.t, 'personal.autonomy.set'); assert.equal(request.automatic, false); assert.equal(request.accountId, undefined);
  await page.evaluate(s => window.receive({ t: 'personal.autonomy.state', requestId: 'stale', state: s }), state);
  assert.equal(await toggle.isDisabled(), true, 'stale response cannot confirm a new save');
  await page.evaluate(s => window.reply(s, 'The setting could not be saved. Try again.'), state);
  assert.equal(await toggle.isChecked(), true); assert.equal(await toggle.isEnabled(), true);
  await page.getByText('The setting could not be saved. Try again.', { exact: true }).waitFor();
  await toggle.click(); await page.evaluate(s => window.reply({ ...s, automatic: false }), state);
  assert.equal(await toggle.isChecked(), false);
  await page.evaluate(() => window.disconnect()); assert.equal(await toggle.isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => window.listeners.size), 0);
  await page.evaluate(() => window.open()); await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0); assert.deepEqual(errors, []);
  console.log(`Personal autonomy Settings regression passed; screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
