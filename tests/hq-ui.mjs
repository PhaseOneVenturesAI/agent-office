// Real client + rendered office with routed fixture frames, as in drafts-ui/pitch-ui.
// Server account/access enforcement and actual connector input are covered by hq.test.ts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-hq`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/hq-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], sockets = new Map(), sent = [];
const projects = [
  { name: 'Kindly', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }] },
  { name: 'Agent Office', hasMainLead: true, departmentLeads: [] },
  { name: 'Garden', hasMainLead: false, departmentLeads: [] },
];
const hq = mine => ({ floorId: 'hq', ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine, projects });
const pitch = { cubbyId: 'jonathan-cubby', floorId: 'source-project', displayFloorId: 'hq', readOnly: true, computerId: 'mac-fixture',
  pitch: { department: 'Marketing', lead: 'Marketing lead', version: 'v1', status: 'ready', pieces: [{ id: 'site', kind: 'site', title: 'Home page', notes: ['A published fixture pitch'], images: [], url: 'https://example.com' }] } };
const push = (page, m) => sockets.get(page).send(JSON.stringify(m));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
async function setup(role) {
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const p = CanvasRenderingContext2D.prototype, draw = p.fillText;
    p.fillText = function(text) { (this.canvas.__texts ??= []).push(text); return draw.apply(this, arguments); };
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#5b3cc4', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Disabled in fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivan' : 'Outsider', role: 'member' } } }) }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit = { ctx, core, parts };' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { sockets.set(page, ws); ws.onMessage(raw => sent.push(JSON.parse(String(raw)))); });
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
async function enter(mine = true, data = projects) {
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'hq'; s.project.name = 'HQ'; s.emit('project'); s.emit('floor'); });
  push(page, { t: 'hq', view: { ...hq(mine), projects: data } });
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
const state = () => page.evaluate(() => {
  const o = window.__office, g = o.office.hq.group, names = [], texts = [];
  g.traverse(obj => { names.push(obj.name); const image = obj.material?.map?.image; if (image?.__texts) texts.push(...image.__texts); });
  return { shown: g.visible, names, texts, colliders: o.world().colliders.length, desks: [...o.office.desks.values()].map(d => d.group.visible), off: o.office.interactables.filter(it => it.off).length };
});
try {
  await setup('owner'); const baseline = await state(); assert.equal(baseline.shown, false);
  await elevator(); assert.match(await page.locator('.elevator').innerText(), /Private · Jonathan/); await shot('01-elevator-owner');
  await page.locator('button.floor-btn[title="Ride to HQ"]').click();
  assert.ok(sent.some(m => m.t === 'floor.go' && m.floor === 'hq'));
  await enter(); const on = await state();
  assert.equal(on.names.filter(n => /^hq-area-/.test(n)).length, 3); assert.equal(on.names.filter(n => /^hq-desk-/.test(n)).length, 5);
  assert.ok(on.texts.includes('Kindly')); assert.ok(on.texts.includes('Marketing')); assert.ok(on.texts.includes('Design')); assert.ok(on.names.includes('hq-portfolio'));
  await stand(9.8, -9, -4, -3, -.08); await shot('02-entrance');
  await stand(-11.5, 1, -11.5, -5, -.06); await shot('03-project-area', () => stand(-11.5, 3.2, -11.5, -5, -.03));
  await stand(-5, 6, -5, -13, .12); await shot('04-portfolio', () => stand(-12.3, 2, -12.3, -13, .14));
  await enter(true, []); assert.match((await state()).texts.join(' '), /Connect your Mac in your cubby/);
  await stand(2, 1.8, 2, -6, .07); await shot('07-empty');
  await enter();
  await page.evaluate(async () => { const { openHQBoard } = await import('/features/hq/ui.ts'); openHQBoard(window.__office.store.hq); });
  await page.waitForSelector('.hq-board'); await shot('09-readable-portfolio');
  assert.match(await page.locator('.hq-board').innerText(), /Marketing lead/);
  await page.locator('.hq-board button.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.evaluate(() => { const a = window.__audit, it = a.ctx.office.hq.interactables.find(it => it.label === 'Portfolio'); a.ctx.interactions.use(it, 'E'); });
  await page.waitForSelector('.hq-board'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await leave(); const after = await state(); assert.equal(after.shown, false); assert.deepEqual(after.desks, baseline.desks); assert.equal(after.colliders, baseline.colliders); assert.equal(after.off, baseline.off);
  await account('manager'); await elevator(); assert.equal(await page.getByRole('button', { name: 'Remove HQ', exact: true }).count(), 0);
  await page.locator('button.floor-btn[title="Ride to HQ"]').click(); await enter(false);
  push(page, { t: 'pitch', view: pitch }); await page.waitForFunction(() => window.__office.store.pitch?.readOnly);
  await stand(12.5, 10, 17.7, 9.5); await shot('05-pitch-room-manager');
  await page.evaluate(async () => { const { openPitchPiece } = await import('/shared/pitch/review.ts'); openPitchPiece({ send: m => window.__office.net.send(m) }, 'site'); });
  await page.waitForSelector('.pitch-review');
  assert.equal(await page.locator('.pitch-review .pitch-actions button').count(), 0); assert.equal(await page.locator('.pitch-review textarea:visible').count(), 0);
  assert.match(await page.locator('.pitch-review').innerText(), /Read-only/); await shot('06-pitch-manager-readonly');
  await page.locator('.pitch-review button.close').click();
  await leave(); await account('owner'); await enter();
  const fingerprint = await page.evaluate(async () => (await (await import('/shared/cubby/keys.ts')).ownerDeviceKey('Jonathan')).fingerprint);
  push(page, { t: 'pitch', view: { ...pitch, readOnly: false, ownerDevices: [{ fingerprint, label: 'Fixture browser', addedAt: Date.now() }] } });
  await page.waitForFunction(() => window.__office.store.pitch?.ownerDevices?.length === 1);
  await page.evaluate(async () => { const { openPitchPiece } = await import('/shared/pitch/review.ts'); openPitchPiece({ send: m => window.__office.net.send(m) }, 'site', 0, 'approve'); });
  await page.waitForTimeout(400);
  const verdict = sent.find(m => m.t === 'pitch.verdict');
  assert.equal(verdict?.floorId, 'source-project'); assert.equal(verdict?.ownerSig.length, 86);
  await page.locator('.pitch-review button.close').click();
  await leave(); await account('outsider'); await elevator(); assert.doesNotMatch(await page.locator('.elevator').innerText(), /HQ|Jonathan/); await shot('08-elevator-outsider');
  await page.keyboard.press('Escape');
  await account('owner'); await enter(true, Array.from({ length: 8 }, (_, i) => ({ ...projects[i % 3], name: `Project ${i + 1}` })));
  const many = await state(); assert.equal(many.names.filter(n => /^hq-area-/.test(n)).length, 6); assert.ok(many.texts.includes('+2 more'));
  await leave(); assert.equal((await state()).shown, false);
  assert.deepEqual(errors, []); assert.equal(sent.filter(m => m.t === 'pitch.verdict').length, 1);
  writeFileSync(`${out}/report.json`, JSON.stringify({ baseline, on, after, errors, screenshots: out, browser: browser.version() }, null, 2));
  console.log(`HQ UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
