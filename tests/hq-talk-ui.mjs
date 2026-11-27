// Real client + rendered office with routed fixture frames, as in drafts-ui/pitch-ui.
// Server account/access enforcement and actual connector input are covered by hq.test.ts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-talk`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/hq-talk-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
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
let held = [];
const hq = mine => ({ floorId: 'hq', ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine,
  ...(mine ? { mac: { computerName: 'Mac mini', connected: true, lastSeen: Date.now() } } : {}),
  projects: publicProjects(liveProjects(macSnapshot.projects.map(p => p.project), sources), mine),
  leads: [{ id: 'cofounder', mac: true, project: 'HQ', projectIndex: -1, title: 'Cofounder', role: 'Chief of staff', computer: 'Mac mini', where: 'hq', needsYou: false, leadStatus: { status: 'unknown', updatedAt: 0 } }, ...projectLeads(macSnapshot.projects.map(p => p.project), sources, [{ id: 'normal', name: 'Kindly' }], mine)].map(l => ({ ...l, conversation: relay.view('owner', l.id, mine ? 'owner' : 'manager'), messages: held.filter(m => m.lead === l.id) })) });
const { HQTalk } = await tsImport('../src/server/hq/talk.ts', import.meta.url);
const data = mkdtempSync(`${root}/.paradev/talk-ui-`);
const linkFrames = [];
const relay = new HQTalk(data, id => id === 'owner', () => 'mac-node', (_, frame) => {
  linkFrames.push(frame);
  setTimeout(() => relay.accept('mac-node', 'owner', { t: 'lead.state', id: frame.id, state: 'working', path: 'inbox' }), 40);
  setTimeout(() => relay.accept('mac-node', 'owner', { t: 'lead.reply', id: frame.id, text: `Reply from ${'cofounder' in frame.target ? 'Cofounder' : frame.target.department === undefined ? frame.target.project + ' main lead' : frame.target.project + ' department lead'}: I received your message.` }), 150);
  return true;
}, () => publish());
function publish() {
  if (!sockets.has(page)) return;
  const view = hq(roleNow === 'owner');
  push(page, { t: 'hq', view });
  push(page, { t: 'hq.leads', view: { ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine: roleNow === 'owner', manager: roleNow === 'manager', leads: view.leads } });
}
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
  await page.route('**/lite.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__lite = { store, net };' }); });
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit = { ctx, core, parts };' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { sockets.set(page, ws); ws.onMessage(raw => { const m = JSON.parse(String(raw)); sent.push(m); if (m.t === 'hq.leads.get') publish(); if (m.t === 'hq.talk') { relay.submit(roleNow, hq(true).leads.find(l => l.id === m.lead), m.text, 'Jonathan'); } if (m.t === 'hq.message') { held.push({ id: 'held', lead: m.lead, text: m.text, manager: 'Ivan', state: 'waiting', at: Date.now() }); publish(); } if (m.t === 'hq.pass') { const item = held.find(i => i.id === m.id); relay.submit('owner', hq(true).leads.find(l => l.id === item.lead), item.text, 'Ivan (held, passed on by Jonathan)'); item.state = 'passed'; publish(); } }); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1`);
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
    await page.setViewportSize({ width, height }); if (suffix === 'phone' && phone) await phone(); await page.waitForTimeout(250); const box = await page.locator('.lead-talk').boundingBox(); if (box) assert.ok(box.x >= 0 && box.x + box.width <= width, `Chat fits ${width}px`); await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function open(id) {
  await page.evaluate(id => {
    const a = window.__audit;
    const target = a.ctx.scene.getObjectByName(`hq-body-${id}`) ?? a.ctx.scene.getObjectByName(`project-body-${id}`);
    if (!target) throw Error(`No lead body: ${id}`);
    a.ctx.interactions.use(target.userData.interact, 'E');
  }, id);
  await page.waitForSelector('.lead-talk');
}
async function chat(text) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.talk-log .assistant'));
}
async function close() {
  await page.locator('.lead-talk .close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse);
}
try {
  await setup('owner'); await enter(); publish();
  const main = 'project:Kindly:ceo', department = hq(true).leads.find(l => l.project === 'Kindly' && l.departmentIndex === 0).id;
  await page.waitForFunction(() => window.__office.scene.getObjectByName('hq-body-cofounder'));
  await stand(-11.5, -2, -11.5, -7.5, .02);
  await open(main); await chat('Can you check our next milestone?'); await shot('01-hq-chat'); await close();
  await open(department); await chat('What is the next marketing task?'); await shot('02-department-chat');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__office.player.hasMouse);
  await stand(2, -6, 2, -10.7, .02);
  await open('cofounder'); assert.match(await page.locator('.lead-talk').innerText(), /Chief of staff · status unknown/);
  await chat('Which project needs my attention?'); await shot('03-cofounder'); await close();
  assert.deepEqual(linkFrames.map(f => f.target), [{ project: 'Kindly' }, { project: 'Kindly', department: 0 }, { cofounder: true }]);
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'normal'; s.project.name = 'Kindly'; s.emit('floor'); });
  publish();
  await page.waitForFunction(() => window.__office.scene.getObjectByName('project-body-project:Kindly:ceo'));
  assert.equal(await page.evaluate(() => window.__office.scene.getObjectByName('linked-project-leads').children.length), 3);
  await stand(-5, 12, -5, 9, .02); await open(main);
  assert.match(await page.locator('.talk-log').innerText(), /Can you check our next milestone/);
  await chat('Hello from the project floor');
  await page.waitForFunction(() => document.querySelectorAll('.talk-log .assistant').length === 2);
  await shot('04-project-floor-lead'); await close();
  await account('manager'); await enter(false); publish(); await open(main);
  assert.equal(await page.locator('.talk-log .talk-line').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Please review the homepage');
  const before = linkFrames.length;
  await page.getByRole('button', { name: 'Send to owner', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.talk-held').textContent.includes('Please review'));
  assert.equal(linkFrames.length, before); await shot('06-manager-held'); await close();
  await account('owner'); await enter(); publish(); await open(main);
  await page.getByRole('button', { name: 'Pass on', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.talk-held').textContent.includes('passed on'));
  assert.equal(linkFrames.at(-1).from, 'Ivan (held, passed on by Jonathan)'); await close();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/lite`);
  await page.waitForFunction(() => window.__lite?.net.up);
  await page.evaluate(() => { const s = window.__lite.store; s.me = { admin: false, account: { name: 'Jonathan', role: 'member' } }; s.floor = 'hq'; s.emit('floor'); });
  publish(); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Cofounder · status unknown', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello from my phone');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.talk-log .assistant').length === 2);
  await shot('05-lite-chat');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.lead-talk .close').click();
  roleNow = 'manager';
  await page.evaluate(() => { window.__lite.store.me.account.name = 'Ivan'; window.__lite.store.emit('me'); });
  publish();
  await page.getByRole('button', { name: 'Kindly · Main lead · working', exact: true }).click();
  assert.equal(await page.locator('.talk-log .talk-line').count(), 0);
  const phoneBefore = linkFrames.length;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Held from phone');
  await page.getByRole('button', { name: 'Send to owner', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.talk-held').textContent.includes('Held from phone'));
  assert.equal(linkFrames.length, phoneBefore);
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ linkFrames, errors }, null, 2));
  console.log(`Talk UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); await server.close(); rmSync(data, { recursive: true, force: true }); }
