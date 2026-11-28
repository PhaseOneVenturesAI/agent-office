// Real client + rendered office with routed fixture frames, as in drafts-ui/pitch-ui.
// Server account/access enforcement and actual connector input are covered by hq.test.ts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-hq-live`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/hq-live-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], sockets = new Map(), sent = [], labelEvidence = [];
const projects = [
  { name: 'Plimbo', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }] },
  { name: 'Agent Office', hasMainLead: true, departmentLeads: [] },
  { name: 'Garden', hasMainLead: false, departmentLeads: [] },
];
const hq = mine => ({ floorId: 'hq', ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine, projects: liveView(mine), leads: leads(mine) });
const pitch = { cubbyId: 'jonathan-cubby', floorId: 'source-project', displayFloorId: 'hq', readOnly: true, computerId: 'mac-fixture',
  pitch: { department: 'Marketing', lead: 'Marketing lead', version: 'v1', status: 'ready', pieces: [{ id: 'site', kind: 'site', title: 'Home page', notes: ['A published fixture pitch'], images: [], url: 'https://example.com' }] } };
const push = (page, m) => sockets.get(page).send(JSON.stringify(m));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
async function setup(role) {
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const p = CanvasRenderingContext2D.prototype, draw = p.fillText;
    p.fillText = function(text) { (this.canvas.__texts ??= []).push(text); (this.canvas.__runs ??= []).push({ text, font: this.font }); return draw.apply(this, arguments); };
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#5b3cc4', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Disabled in fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivanh' : 'Outsider', role: 'member' } } }) }));
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
    s.me = { admin: false, account: { id: role, name: role === 'owner' ? 'Jonathan' : role === 'manager' ? 'Ivanh' : 'Outsider', role: 'member' } };
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
async function enter(mine = true, data = liveView(mine)) {
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'hq'; s.project.name = 'HQ'; s.emit('project'); s.emit('floor'); });
  push(page, { t: 'cubbies', state: { enabled: false, cubbies: [], setupAllowed: false } });
  push(page, { t: 'hq', view: { ...hq(mine), projects: data } });
  await page.waitForFunction(() => window.__office.office.hq.group.visible);
  await page.waitForFunction(() => window.__office.scene.getObjectByName('hq-leads')?.children.length > 0);
  await page.waitForTimeout(400);
}
async function leave() {
  push(page, { t: 'pitch' }); push(page, { t: 'hq' });
  await page.evaluate(() => { const s = window.__office.store; s.floor = 'normal'; s.project.name = 'Plimbo'; s.emit('project'); s.emit('floor'); });
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
    await page.setViewportSize({ width, height }); if (suffix === 'phone' && phone) await phone();
    if (!await page.locator('.modal:visible').count()) { await page.keyboard.press('Shift'); await page.evaluate(() => window.__audit.parts.focus.backToGame()); }
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#fade').evaluate(el => getComputedStyle(el).opacity), '0', 'screenshots must not capture an unfinished elevator transition');
    if (['01-helpers-at-desks', '03-lead-on-project-floor-hq', '04-needs-you-hq'].includes(name)) {
      const labels = await projectedLabels();
      labelEvidence.push({ name, viewport: suffix, ...labels });
      assert.deepEqual(labels.overlaps, [], `${name} ${suffix}: helper plates must not overlap status cards or lead plates`);
      assert.deepEqual(labels.oversized, [], `${name} ${suffix}: close plates must stay within 1.3× their size at 3 m`);
      if (name === '03-lead-on-project-floor-hq') {
        assert.equal(labels.cards.length, 0, 'no away cards');
        assert.ok(labels.leads.some(l => l.name.includes('Plimbo CEO')), 'CEO stays at HQ');
      }
      if (name === '04-needs-you-hq') assert.ok(labels.leads.some(l => l.name.includes('Plimbo CEO')), 'CEO plate is in view');
    }
    if (name.startsWith('10-') || name.startsWith('11-') || name.startsWith('12-')) {
      assert.equal(await page.locator('.cb-send button').evaluate(el => {
        const r = el.getBoundingClientRect(), parent = el.closest('.cb-main').getBoundingClientRect();
        return r.bottom <= parent.bottom && r.right <= innerWidth && r.left >= 0;
      }), true, `${name} ${suffix}: composer is fully visible`);
    }
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}
let where = 'hq', needsYou = false, fingerprint = '';
const held = [], deliveredLines = [];
const labelled = item => `Message from ${item.manager} (HQ manager; can't approve merges, publishes or spending): ${item.text}`;
const ownerCubby = () => ({ id: 'jonathan-cubby', slot: 0, ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine: true, lamp: 'working', working: 1,
  interior: { computerId: 'mac-fixture', computerName: 'Mac mini', leadName: 'Nova', look: { skin: 0, hair: 0, style: 0 },
    agents: [{ id: 'lead', tool: 'Claude', role: 'lead', task: 'Lead', branch: 'main', status: 'working' }], plan: [], needsYou: needsYou ? ['Review the pitch'] : [],
    ownerDevices: [{ fingerprint, label: 'Browser', addedAt: 1 }], chat: [{ id: 'same-thread', role: 'assistant', text: 'The same conversation from Plimbo.', at: 1 }, ...deliveredLines] } });
function leads(mine = true) {
  return projectLeads(projects, [source()], [{ id: 'normal' }], mine);
}
async function projectFloor(hqEnabled = true, mine = true) {
  await leave();
  const c = ownerCubby(); c.interior.agents.push(...workers);
  if (!mine) { delete c.interior; c.mine = false; }
  if (hqEnabled) { const lead = leads(mine)[0]; delete lead.messages; c.hqLead = { hqFloorId: 'hq', lead, departments: leads(mine).filter(l => l.projectIndex === 0 && l.departmentIndex !== undefined) }; }
  push(page, { t: 'cubbies', state: { enabled: true, floorId: 'normal', setupAllowed: true, cubbies: [c] } });
  await page.waitForFunction(() => window.__audit.parts.cubbies.rooms().get(0)?.info?.id === 'jonathan-cubby');
  await page.waitForTimeout(250);
}
async function useLead(id, card = false, away = false) {
  await page.evaluate(({id, card, away}) => {
    const a = window.__audit, g = a.ctx.scene.getObjectByName(away ? 'hq-away-cards' : 'hq-leads');
    let it; g.traverse(o => { const t = o.userData.interact; if (t?.kind === 'hqlead' && t.lead.id === id && !!t.card === card) it = t; });
    if (!it) throw Error(`Missing lead target ${id} card=${card}`);
    a.ctx.interactions.use(it, 'E');
  }, { id, card, away });
}
async function cubbyView() {
  return page.evaluate(() => {
    const r = window.__audit.parts.cubbies.rooms().get(0), lead = r?.interior?.lead?.root;
    const cards = []; window.__office.scene.getObjectByName('hq-away-cards')?.traverse(o => { if (o.name === 'hq-lead-status') { r.group.updateWorldMatrix(true, false); const local = r.group.worldToLocal(o.position.clone()); cards.push({ ...o.userData, withinRoom: Math.abs(local.x) + o.geometry.parameters.width / 2 < r.place.width / 2 }); } });
    return { body: lead?.visible, cards, watching: r.info?.watching, interior: !!r.interior };
  });
}
async function leadView() {
  return page.evaluate(async () => {
    const { screenBox, overlaps, headBox } = await import('/features/cubbies/personal-agents/declutter.ts');
    const o = window.__office, g = o.scene.getObjectByName('hq-leads'), bodies = [], cards = [];
    g.traverse(obj => {
      if (obj.name.startsWith('hq-body-')) {
        const plates = []; obj.traverse(p => { if (p.name === 'personal-nameplate') plates.push(p); });
        bodies.push({ id: obj.userData.leadId, position: obj.position.toArray(), plateCount: plates.length, lines: plates[0].userData.lines,
          box: screenBox(plates[0], o.camera), head: headBox(obj, o.camera), role: obj.userData.personal.role,
          hand: obj.userData.handRaised });
      }
      if (obj.name === 'hq-lead-status') cards.push(obj.userData);
    });
    const visible = bodies.filter(b => b.box.maxX > -1 && b.box.minX < 1 && b.box.maxY > -1 && b.box.minY < 1 && b.position[0] < -7);
    const collisions = [];
    visible.forEach((a, i) => { visible.slice(i + 1).forEach(b => { if (overlaps(a.box, b.box)) collisions.push([a.id, b.id]); }); visible.filter(b => b.id !== a.id).forEach(b => { if (overlaps(a.box, b.head)) collisions.push([a.id, b.id + '-head']); }); });
    return { bodies, cards, collisions, glow: !!g.getObjectByName('hq-needs-glow') };
  });
}

// Real bounded connector reads feed the server's decision/projection functions, then the actual client.
const { tsImport } = await import('tsx/esm/api');
const { presence } = await tsImport('../src/server/cubbies/local/presence.ts', import.meta.url);
const { readNeeds, needsFor } = await tsImport('../src/server/cubbies/local/needs.ts', import.meta.url);
const { projectLeads } = await tsImport('../src/server/hq/leads.ts', import.meta.url);
const { liveProjects } = await tsImport('../src/server/hq/live.ts', import.meta.url);
const { publicProjects } = await tsImport('../src/shared/protocol/hq.ts', import.meta.url);
const fixture = `${out}/fixture`, runs = `${fixture}/runs`, repo = `${fixture}/repo`;
mkdirSync(runs, { recursive: true }); mkdirSync(repo, { recursive: true });
projects[0].own = true; projects[0].lead = 'main-session'; projects[0].departmentLeads[0].lead = 'marketing-session';
let workers = [], readyPitch;
function publish({ linked = false, stale = false, open = 2 } = {}) {
  for (let i = 1; i <= 8; i++) writeFileSync(`${runs}/${i + 100}-abcd1234.json`, JSON.stringify({ schema: 1, kind: 'worker', pid: i + 100, provider: i % 2 ? 'codex' : 'kimi', role: 'builder',
    folder: repo, title: `Live task ${i}`, branch: `refs/heads/live-${i}`, lead: i > 5 ? 'marketing-session' : linked ? 'main-session' : 'unknown', startedAt: new Date(Date.now() + i * 1000).toISOString() }));
  workers = presence([realpathSync(repo)], runs, () => true).map(r => r.agent);
  const file = `${fixture}/needs.json`;
  writeFileSync(file, JSON.stringify({ schema: 1, generatedAt: new Date(Date.now() - (stale ? 25 : 0) * 3600000).toISOString(), staleAfterHours: 24,
    projects: { plimbo: { path: repo, open, items: ['Review <script>literal text</script>', 'Choose a date'], sources: [] } } }));
  projects[0].needs = needsFor(readNeeds(file), repo);
}
function source() { const cubby = ownerCubby(); cubby.interior.agents.push(...workers); return { floorId: 'normal', projects, cubby, pitch: readyPitch }; }
function liveView(mine) { return publicProjects(liveProjects(projects, [source()]), mine); }
async function helperView() {
  return page.evaluate(() => {
    const g = window.__office.scene.getObjectByName('hq-leads'), helpers = [], overflow = [];
    g.traverse(o => { if (o.name.startsWith('hq-helper-harness:')) helpers.push({ id: o.userData.worker.id, desk: o.userData.desk, title: o.getObjectByName('personal-nameplate').userData.lines[0] }); if (o.name === 'hq-helper-overflow') overflow.push(o.name); });
    return { helpers, overflow };
  });
}
async function projectedLabels() {
  return page.evaluate(async () => {
    const { screenBox, overlaps } = await import('/features/cubbies/personal-agents/declutter.ts');
    const { camera, scene } = window.__office, helpers = [], leads = [], cards = [], oversized = [];
    const onScreen = b => b.maxX > -1 && b.minX < 1 && b.maxY > -1 && b.minY < 1;
    scene.getObjectByName('hq-leads').traverseVisible(o => {
      if (o.name === 'personal-nameplate') {
        const depth = -o.getWorldPosition(camera.position.clone()).applyMatrix4(camera.matrixWorldInverse).z;
        const box = screenBox(o, camera);
        if (depth <= 0 || !onScreen(box)) return;
        const entry = { name: o.userData.lines[0], box };
        (o.parent.name.startsWith('hq-helper-') ? helpers : leads).push(entry);
        const parentScale = o.parent.getWorldScale(camera.position.clone());
        const at3m = o.material.map.image.width * .003 * parentScale.x * camera.projectionMatrix.elements[0] / 3;
        if (box.maxX - box.minX > at3m * 1.31) oversized.push(entry.name);
      }
      if (o.name === 'hq-lead-status') {
        const vertices = o.geometry.attributes.position, points = [];
        for (let i = 0; i < vertices.count; i++) points.push(camera.position.clone().fromBufferAttribute(vertices, i).applyMatrix4(o.matrixWorld));
        if (points.every(p => p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0)) return;
        points.forEach(p => p.project(camera));
        const box = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
        if (onScreen(box)) cards.push({ name: o.userData.statusText, box, text: o.material.map.image.__texts });
      }
    });
    return { helpers, leads, cards, oversized, overlaps: helpers.flatMap(h => [...leads, ...cards].filter(p => overlaps(h.box, p.box)).map(p => [h.name, p.name])) };
  });
}
async function close() { await page.locator('.modal button.close').click(); await page.waitForFunction(() => window.__office.player.hasMouse); }
try {
  publish(); await setup('owner'); await enter();
  const badges = await page.evaluate(async () => {
    const { statusCard } = await import('/features/hq/lead-world.ts');
    const lead = window.__office.store.hq.leads[0], at = '2026-11-26T12:16:00.000Z';
    const text = [2, null].flatMap(open => [false, true].map(stale => {
      const face = statusCard({ ...lead, needsYou: true, needs: { open, stale, at, items: [] } }, 'On the Plimbo floor');
      const badge = face.mesh.material.map.image.__texts.at(-1); face.dispose(); return badge;
    }));
    return { text, time: new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) };
  });
  assert.deepEqual(badges.text, ['✋ 2 need you', `✋ 2 need you · as of ${badges.time}`, '✋ Needs you · unknown', `✋ Needs you · unknown · as of ${badges.time}`]);
  const first = leads()[0].id, dept = leads()[1].id;
  const helpers = await helperView();
  assert.equal(helpers.helpers.length, 6); assert.equal(new Set(helpers.helpers.map(w => w.id)).size, 6); assert.equal(helpers.overflow.length, 1);
  assert.equal(helpers.helpers.filter(w => w.desk === first).length, 3); assert.equal(helpers.helpers.filter(w => w.desk === dept).length, 3);
  assert.ok(helpers.helpers.every(w => w.title.includes('Live task')));
  await stand(-11.5, -2.1, -11.5, -7, .08); await shot('01-helpers-at-desks', () => stand(-11.5, -.5, -11.5, -7, .08));
  const rows = await page.evaluate(() => { const b = window.__office.office.hq.group.getObjectByName('hq-tasks-0'); return b.material.map.image.__texts; });
  assert.ok(rows.includes('Live task 8')); assert.ok(rows.includes('+3 more')); assert.ok(rows.includes('2 need you')); assert.ok(rows.includes('kimi · live-8')); assert.ok(!rows.includes('Live task 1'));
  await stand(-4.7, -5.7, -8.05, -5.7, -.05); await shot('02-task-board');
  await page.evaluate(async () => (await import('/features/hq/ui.ts')).openHQBoard(window.__office.store.hq, 'Plimbo'));
  assert.match(await page.locator('.hq-board').innerText(), /Live task 8.*kimi.*live-8/); assert.match(await page.locator('.hq-board').innerText(), /\+3 more/); await close();
  publish({ linked: true }); await enter();
  assert.equal((await leadView()).bodies.filter(b => b.id === first).length, 1); assert.equal((await leadView()).cards.length, 0);
  await stand(-11.5, -3.9, -11.5, -6.7, 0); await shot('03-lead-on-project-floor-hq');
  await projectFloor(); await page.evaluate(() => window.__audit.parts.travel.arrive('elevator')); await page.waitForTimeout(700); assert.equal((await cubbyView()).body, true);
  assert.equal(await page.evaluate(() => { const r = window.__audit.parts.cubbies.rooms().get(0); const ids = r.interior.roster.map(a => a.id); return ids.length === new Set(ids).size && ids.filter(id => id.startsWith('harness:')).length === 8; }), true);
  const spot = await page.evaluate(async () => { const { furniture, toFloor } = await import('/features/cubbies/model.ts'); const r = window.__audit.parts.cubbies.rooms().get(0); return toFloor(r.place, furniture(r.place.width, r.place.depth).lead.x, furniture(r.place.width, r.place.depth).lead.z); });
  await stand(spot.x + 3, spot.z, spot.x, spot.z, -.02); await shot('03-lead-on-project-floor-project');
  assert.equal(await page.evaluate(() => window.__audit.parts.cubbies.rooms().get(0).leadBody().root.userData.handRaised), true);
  await shot('04-needs-you-project');
  publish({ stale: true }); await enter();
  assert.equal((await leadView()).bodies.find(b => b.id === first).hand, true);
  await stand(-11.5, -3.8, -11.5, -7.55, .03); await shot('04-needs-you-hq');
  await useLead(first); assert.match(await page.locator('.hq-needs').innerText(), /stale.*as of/); assert.match(await page.locator('.hq-needs').innerText(), /<script>literal text<\/script>/); assert.equal(await page.locator('.hq-needs script').count(), 0); await close();
  push(page, { t: 'hq.gong', project: 'Plimbo', pr: 123 }); await page.waitForSelector('.toast'); assert.match(await page.locator('.toast').last().innerText(), /Plimbo: PR #123 merged/); await shot('05-gong-toast');
  readyPitch = pitch.pitch; await enter();
  const pitched = await leadView(); assert.equal(pitched.bodies.filter(b => b.id === first).length, 1); assert.ok(pitched.bodies.find(b => b.id === first).position[0] < 0); assert.equal(pitched.cards.length, 0);
  await stand(16.7, 11.7, 16.7, 9.3, .05); await shot('07-pitch-walk');
  await account('manager'); await enter(false); await useLead(first); assert.equal(await page.locator('.hq-needs').innerText().then(t => t.includes('literal text')), false); await close();
  // Real lite entry receives exactly the same owner/manager-filtered HQ view.
  const lite = await browser.newPage(); await lite.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await lite.addInitScript(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#5b3cc4', look: { skin: 0, hair: 0, style: 0 } })));
  await lite.routeWebSocket(/\/ws(?:\?|$)/, ws => sockets.set(lite, ws));
  await lite.goto(`http://127.0.0.1:${server.httpServer.address().port}/lite`); await lite.waitForFunction(() => window.__lite?.net.up);
  await lite.evaluate(() => { const s = window.__lite.store; s.floor = 'hq'; s.emit('floor'); });
  push(lite, { t: 'hq', view: hq(true) }); await lite.locator('#btn-hq').click();
  assert.match(await lite.locator('.hq-needs').first().innerText(), /literal text/);
  for (const [width, height, suffix] of [[1280,800,'desktop'],[390,844,'phone']]) { await lite.setViewportSize({ width, height }); await lite.waitForTimeout(400); await lite.screenshot({ path: `${out}/06-phone-lite-${suffix}.png` }); }
  push(lite, { t: 'hq', view: hq(false) }); await lite.waitForTimeout(100); assert.doesNotMatch(await lite.locator('.body').innerText(), /literal text/);
  push(lite, { t: 'hq' }); await lite.waitForTimeout(100); assert.equal(await lite.locator('#btn-hq').isVisible(), false); assert.doesNotMatch(await lite.locator('.body').innerText(), /Live task|literal text/);
  await lite.close(); assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ helpers, rows, labelEvidence, errors, screenshots: out }, null, 2));
  console.log(`HQ live UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
