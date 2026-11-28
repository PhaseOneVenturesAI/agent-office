// Real rendering + actual HQ node admission/projections; the Mac hooks and node socket are fixtures.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tsImport } from 'tsx/esm/api';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-activity`;
mkdirSync(out, { recursive: true });
const data = mkdtempSync(`${root}/.paradev/activity-ui-`);
const { activityOffice } = await tsImport('./support/hq-activity.ts', import.meta.url);
const { LiveActivity } = await tsImport('../src/server/link/live.ts', import.meta.url);
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/activity-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], frames = [];
page.on('pageerror', e => errors.push(e.message));
let ws, role = 'owner', floor = 'hq';
const office = activityOffice(data, Date.now, () => publish());
const live = new LiveActivity(() => ({ project: 'Plimbo' }), frame => { frames.push(frame); office.link.frame(frame); });
const hook = (event, extra = {}) => live.activity({ schema: 1, event, sessionId: '11111111-1111-4111-8111-111111111111', ...extra });
function publish() {
  if (!ws) return;
  ws.send(JSON.stringify({ t: 'hq', ...(floor === 'hq' ? { view: office.hqView(role) } : {}) }));
  ws.send(JSON.stringify({ t: 'hq.leads', view: office.talkView(role, floor) }));
}
const snapshotTimer = setInterval(() => office.snapshot(), 15000);
async function enter(nextRole, nextFloor) {
  role = nextRole; floor = nextFloor;
  await page.evaluate(({ role, floor }) => {
    const s = window.__office.store;
    s.me = { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivan' : 'Coworker', role: 'member' } };
    s.floor = floor; s.project.name = floor === 'hq' ? 'HQ' : 'Plimbo'; s.emit('floor'); s.emit('me');
  }, { role, floor });
  publish();
  await page.waitForFunction(floor => floor === 'hq' ? window.__office.office.hq.group.visible : window.__office.scene.getObjectByName('linked-project-leads').visible, floor);
}
async function stand(x, z, tx, tz) {
  await page.evaluate(([x, z, tx, tz]) => {
    const p = window.__office.player; p.pos.set(x, 0, z); p.vy = 0; p.camYaw = Math.atan2(-(tx - x), -(tz - z)); p.facing = p.camYaw + Math.PI; p.lookPitch = .04; p.updateCamera(true);
  }, [x, z, tx, tz]);
  await page.waitForTimeout(300);
}
const body = () => `${floor === 'hq' ? 'hq' : 'project'}-body-project:owner/plimbo:ceo`;
async function leadLine(expected) {
  await page.waitForFunction(({ body, expected }) => window.__office.scene.getObjectByName(body)?.getObjectByName('personal-nameplate')?.userData.lines[1].includes(expected), { body: body(), expected });
}
async function helperState() {
  return page.evaluate(prefix => {
    const rows = [];
    window.__office.scene.traverse(o => { if (o.name.startsWith(`${prefix}-helper-`) && o.userData.helper) rows.push({ ...o.userData.helper, lines: o.getObjectByName('personal-nameplate').userData.lines, visible: o.getObjectByName('personal-nameplate').visible }); });
    return rows;
  }, floor === 'hq' ? 'hq' : 'project');
}
async function helpers(count) {
  await page.waitForFunction(({ prefix, count }) => {
    let n = 0; window.__office.scene.traverse(o => { if (o.name.startsWith(`${prefix}-helper-`) && o.userData.helper) n++; }); return n === count;
  }, { prefix: floor === 'hq' ? 'hq' : 'project', count });
}
async function shots(name) {
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height });
    if (floor === 'hq') await stand(-11.5, suffix === 'phone' ? 1.8 : -1.9, -11.5, -7.5);
    else if (suffix === 'phone') await stand(-5, 14, -5, 9);
    else await stand(-3.8, 14, -4.7, 9);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Reuse production decluttering, and assert it has actually prevented helper/lead plate overlaps.
    assert.equal(await page.evaluate(async prefix => {
      const { screenBox, overlaps } = await import('/features/cubbies/personal-agents/declutter.ts');
      const scene = window.__office.scene, camera = window.__audit.ctx.camera, leads = [], helpers = [];
      scene.traverseVisible(o => {
        const p = o.getObjectByName('personal-nameplate');
        if (!p?.visible || p.getWorldPosition(p.position.clone()).applyMatrix4(camera.matrixWorldInverse).z >= 0) return;
        if (o.name.startsWith(`${prefix}-body-`)) leads.push(screenBox(p, camera));
        if (o.name.startsWith(`${prefix}-helper-`) && o.userData.helper) helpers.push(screenBox(p, camera));
      });
      return helpers.some((h, i) => [...leads, ...helpers.slice(0, i)].some(l => overlaps(h, l)));
    }, floor === 'hq' ? 'hq' : 'project'), false, 'helper plates yield to leads and each other');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}
try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#5b3cc4', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Disabled in fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit = { ctx, core, parts };' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, socket => { ws = socket; ws.onMessage(raw => { if (JSON.parse(String(raw)).t === 'hq.leads.get') publish(); }); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'hq'; s.you = 'self'; s.project = { name: 'HQ', dir: '/fixture', agentProviders: ['claude'], defaultProvider: 'claude' };
    s.floors = [{ id: 'hq', name: 'HQ', dir: '/fixture/hq', workers: 0, people: 0, busy: 0, waiting: 0, palette: 0, hq: { ownerName: 'Jonathan', mine: true } }, { id: 'plimbo', name: 'Plimbo', dir: '/fixture', workers: 0, people: 0, busy: 0, waiting: 0, palette: 0 }];
    s.emit('project'); s.emit('floors'); s.emit('floor');
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove(); o.sky.show({ hour: 12, weather: 'clear' });
  });
  office.admit(); office.snapshot(); await enter('owner', 'hq');
  hook('PreToolUse', { tool: 'Edit', summary: 'Edit /Users/private/hero.tsx' });
  await leadLine('editing hero.tsx'); await helpers(2);
  const workerRows = await helperState();
  assert.ok(workerRows.some(h => h.title === 'Homepage worker' && h.lines[1] === 'reading layout.tsx'));
  assert.ok(workerRows.some(h => h.kind === 'factory' && h.title === 'Release factory' && h.lines[1] === 'running tests'));
  hook('SubagentStart', { agentId: 'secret-helper-id', agentType: 'Research helper' }); await helpers(3);
  await stand(-11.5, -1.9, -11.5, -7.5); await shots('01-hq-live');
  assert.ok(office.hqView().projects[0].workers.some(w => w.title === 'Research helper'));
  assert.ok(await page.evaluate(() => window.__office.store.hq.projects[0].workers.some(w => w.doing === 'editing hero.tsx')));
  assert.ok(await page.evaluate(() => window.__office.store.hq.projects[0].workers.some(w => w.title === 'Release factory' && w.doing === 'running tests')));
  hook('SubagentStop', { agentId: 'secret-helper-id' }); await helpers(2); await shots('02-hq-helper-left');
  await enter('manager', 'hq'); await leadLine('editing hero.tsx'); await helpers(2);
  await enter('owner', 'plimbo'); await leadLine('editing hero.tsx'); await helpers(2);
  hook('SubagentStart', { agentId: 'secret-helper-id', agentType: 'Research helper' }); await helpers(3);
  await stand(-5.1, 14.5, -5, 9); await shots('03-project-live');
  assert.ok(await page.evaluate(() => window.__office.scene.getObjectByName('project-live-tasks').userData.rows.some(r => r.doing === 'editing hero.tsx')));
  hook('SubagentStop', { agentId: 'secret-helper-id' }); await helpers(2);
  await enter('coworker', 'plimbo'); await leadLine('idle'); await helpers(2);
  assert.ok((await helperState()).every(h => !h.doing && h.lines[1] === ''));
  assert.doesNotMatch(JSON.stringify(office.talkView('coworker', 'plimbo')), /"doing"|hero.tsx|layout.tsx|private-/);
  assert.equal(await page.evaluate(() => window.__office.scene.getObjectByName('project-live-tasks').userData.rows.some(r => r.doing)), false);
  await shots('04-coworker-watch');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await shots('05-reduced-motion');
  await enter('owner', 'plimbo'); hook('Stop'); await leadLine('idle');
  assert.doesNotMatch(JSON.stringify(frames), /Users|private|secret-helper|sessionId|agentId/);
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ frames, errors, workerRows, viewports: ['1280x800', '390x844'] }, null, 2));
  console.log(`Activity UI checks passed. Screenshots: ${out}`);
} finally { clearInterval(snapshotTimer); live.close(); office.close(); await browser.close(); await server.close(); rmSync(data, { recursive: true, force: true }); }
