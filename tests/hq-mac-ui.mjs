// Real client + rendered office with routed fixture frames, as in drafts-ui/pitch-ui.
// Server account/access enforcement and actual connector input are covered by hq.test.ts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-mac-link`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/hq-mac-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], sockets = new Map(), sent = [];
let roleNow = 'owner';
const pairingId = 'a'.repeat(48);
let linkState = { pending: [{ id: pairingId, computerName: 'Mac mini', expiresAt: Date.now() + 600000 }], links: [] };
const actions = [];
const projects = [
  { name: 'Kindly', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }] },
  { name: 'Agent Office', hasMainLead: true, departmentLeads: [] },
  { name: 'Garden', hasMainLead: true, departmentLeads: [] },
  { name: 'Skedaddle', hasMainLead: true, departmentLeads: [] },
];
const { tsImport } = await import('tsx/esm/api');
const { projectLeads } = await tsImport('../src/server/hq/leads.ts', import.meta.url);
const { liveProjects } = await tsImport('../src/server/hq/live.ts', import.meta.url);
const { publicProjects } = await tsImport('../src/shared/protocol/hq.ts', import.meta.url);
const macSnapshot = { projects: projects.map((p, i) => ({ project: { ...p, lead: `private-lead-${i}`, leadStatus: { status: ['busy', 'idle', 'off', 'busy'][i], updatedAt: Date.now() } }, agents: [{ id: `harness:${100 + i}`, role: 'builder', tool: 'codex', task: `Build ${p.name}`, branch: 'feature', status: 'working', lead: `private-lead-${i}` }] })) };
const sources = macSnapshot.projects.map(row => ({ mac: true, floorId: '', projects: [row.project], agents: row.agents, computerName: 'Mac mini', observedAt: Date.now() }));
const hq = mine => ({ floorId: 'hq', ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine,
  ...(mine ? { mac: { computerName: 'Mac mini', connected: true, lastSeen: Date.now() } } : {}),
  projects: publicProjects(liveProjects(macSnapshot.projects.map(p => p.project), sources), mine),
  leads: projectLeads(macSnapshot.projects.map(p => p.project), sources, [], mine) });
const pitch = { cubbyId: 'jonathan-cubby', floorId: 'source-project', displayFloorId: 'hq', readOnly: true, computerId: 'mac-fixture',
  pitch: { department: 'Marketing', lead: 'Marketing lead', version: 'v1', status: 'ready', pieces: [{ id: 'site', kind: 'site', title: 'Home page', notes: ['A published fixture pitch'], images: [], url: 'https://example.com' }] } };
const push = (page, m) => sockets.get(page).send(JSON.stringify(m));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
async function setup(role) {
  roleNow = role;
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const p = CanvasRenderingContext2D.prototype, draw = p.fillText;
    p.fillText = function(text) { (this.canvas.__texts ??= []).push(text); (this.canvas.__runs ??= []).push({ text, font: this.font }); return draw.apply(this, arguments); };
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#5b3cc4', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Disabled in fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/mac-link', async r => {
    if (roleNow !== 'owner') return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    if (r.request().method() === 'POST') {
      const action = r.request().postDataJSON(); actions.push(action);
      if (action.action === 'approve') { linkState.pending = []; linkState.links = [{ id: 'node-fixture', computerName: 'Mac mini', connected: true, lastSeen: Date.now() }]; }
      if (action.action === 'deny') linkState.pending = [];
      if (action.action === 'revoke') linkState.links = [];
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(linkState) });
  });
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivan' : 'Outsider', role: 'member' } } }) }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit = { ctx, core, parts };' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { sockets.set(page, ws); ws.onMessage(raw => { const m = JSON.parse(String(raw)); sent.push(m); }); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1&link=${pairingId}`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  await account(role);
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'normal'; s.you = 'self'; s.project = { name: 'Normal', dir: '/fixture', agentProviders: ['claude'], defaultProvider: 'claude' };
    s.emit('project'); s.emit('floor');
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    o.sky.show({ hour: 12, weather: 'clear' });
  });
}
async function account(role) {
  roleNow = role;
  await page.evaluate(role => {
    const s = window.__office.store;
    s.me = { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivan' : 'Outsider', role: 'member' } };
    s.floors = [{ id: 'normal', name: 'Normal', dir: '/fixture', workers: 0, people: 0, busy: 0, waiting: 0, palette: 0 }];
    if (role !== 'outsider') s.floors.push({ id: 'hq', name: 'HQ', dir: '/fixture/hq', workers: 0, people: 0, busy: 0, waiting: 0, palette: 1, hq: { ownerName: 'Jonathan', mine: role === 'owner' } });
    s.emit('floors');
  }, role);
}
async function elevator() {
  await page.evaluate(async () => {
    const { openElevator } = await import('/ui/elevator.ts');
    openElevator({ net: window.__office.net, ride: id => window.__office.net.send({ t: 'floor.go', floor: id }), downstairs: () => false });
  });
  await page.waitForSelector('.modal.elevator');
}
async function enter(mine = true, data = hq(mine).projects) {
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'hq'; s.project.name = 'HQ'; s.emit('project'); s.emit('floor'); });
  push(page, { t: 'hq', view: { ...hq(mine), projects: data, ...(data.length ? {} : { mac: undefined, leads: [] }) } });
  await page.waitForFunction(() => window.__office.office.hq.group.visible);
  await page.waitForTimeout(400);
}
async function leave() {
  push(page, { t: 'pitch' }); push(page, { t: 'hq' });
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'normal'; s.emit('floor'); });
  await page.waitForTimeout(250);
}
async function stand(x, z, tx, tz, pitch = 0) {
  await page.evaluate(([x, z, tx, tz, pitch]) => {
    const p = window.__office.player; p.pos.set(x, 0, z); p.vy = 0; p.camYaw = Math.atan2(-(tx - x), -(tz - z)); p.facing = p.camYaw + Math.PI; p.lookPitch = pitch; p.updateCamera(true);
  }, [x, z, tx, tz, pitch]);
  await page.waitForTimeout(300);
}
async function shot(name, phone) {
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height }); if (suffix === 'phone' && phone) await phone(); await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

try {
  await setup('owner'); await enter(true, []);
  await page.waitForSelector('.hq-connect');
  assert.match(await page.locator('.hq-connect').innerText(), /Link Mac mini to your office\?/);
  await shot('02-approve');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.hq-link-record')?.textContent.includes('Connected'));
  assert.deepEqual(actions, [{ id: pairingId, action: 'approve' }]);
  const command = await page.locator('.hq-connect code').innerText();
  assert.match(command, /agent-office link http:\/\/127.0.0.1:/);
  assert.doesNotMatch(command, /owner-key|token|--hq/);
  await shot('01-link-panel');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__office.player.hasMouse);
  const usePanel = () => page.evaluate(() => {
    const a = window.__audit, target = a.ctx.office.hq.interactables.find(it => it.label === 'Link your Mac');
    if (!target) throw Error('Missing Link your Mac'); a.ctx.interactions.use(target, 'E');
  });
  linkState.links[0].connected = false;
  await usePanel(); await page.waitForSelector('.hq-connect');
  assert.match(await page.locator('.hq-connect').innerText(), /Offline since/);
  await page.screenshot({ path: `${out}/01-link-panel-offline-desktop.png` });
  await page.locator('.hq-connect .close').click(); await page.waitForFunction(() => window.__office.player.hasMouse);
  linkState.links[0].connected = true;
  await enter();
  await page.waitForFunction(() => window.__office.scene.getObjectByName('hq-body-project:Kindly:ceo'));
  const objects = await page.evaluate(() => {
    const o = window.__office, labels = [], names = [];
    o.scene.traverse(obj => { if (obj.name.startsWith('hq-')) names.push(obj.name); if (obj.name === 'personal-nameplate') labels.push(obj.userData.lines); });
    return { names, labels, projects: o.store.hq.projects, mac: o.store.hq.mac };
  });
  for (let i = 0; i < 4; i++) { assert.ok(objects.names.includes(`hq-area-${i}`)); assert.ok(objects.names.includes(`hq-tasks-${i}`)); assert.ok(objects.names.includes(`hq-helper-harness:${100 + i}`)); }
  assert.match(await page.evaluate(() => window.__office.office.hq.group.getObjectByName('hq-connect-panel').material.map.image.__texts.join(' ')), /Mac mini.*Connected/);
  assert.equal(objects.mac.computerName, 'Mac mini'); assert.ok(objects.labels.flat().some(l => l?.includes('1 helper')));
  assert.doesNotMatch(JSON.stringify(objects.projects), /private-lead/);
  for (const status of ['working', 'idle', 'offline']) assert.ok(objects.labels.flat().some(l => l?.includes(status)), status);
  await stand(-3, 9, -3, -5, .03); await shot('03-hq-live-projects');
  await stand(-11.5, -2, -11.5, -7.5, .02); await shot('04-phone', () => stand(-11.5, -.4, -11.5, -7.5, .02));
  // A Mac connection does not remove the existing cubby-only HQ projection.
  const fallback = { ...hq(true), mac: undefined, projects: [projects[0]], leads: [{ ...hq(true).leads[0], mac: undefined, working: undefined }] };
  push(page, { t: 'hq', view: fallback }); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__office.store.hq.projects.length), 1);
  await account('manager'); await enter(false);
  assert.equal(await page.evaluate(() => window.__office.office.hq.interactables.some(it => it.label === 'Link your Mac')), false);
  await page.evaluate(async id => { history.replaceState(null, '', `/?3d=1&link=${id}`); const m = await import('/features/hq/connection.ts'); m.wireMacConnection(window.__audit.ctx); }, pairingId);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.hq-connect').count(), 0);
  await account('outsider'); await leave();
  assert.equal(await page.evaluate(() => !!window.__office.store.hq), false);
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ command: command.replace(/--token '[^']+'/, "--token '<fixture>'"), objects, errors }, null, 2));
  console.log(`Mac link UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
