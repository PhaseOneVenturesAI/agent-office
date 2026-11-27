// Real client + rendered office with routed fixture frames, as in drafts-ui/pitch-ui.
// Server account/access enforcement and actual connector input are covered by hq.test.ts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-hq-leads`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/hq-leads-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], sockets = new Map(), sent = [];
const projects = [
  { name: 'Plimbo', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }] },
  { name: 'Agent Office', hasMainLead: true, departmentLeads: [] },
  { name: 'Garden', hasMainLead: false, departmentLeads: [] },
];
const hq = mine => ({ floorId: 'hq', ownerName: 'Jonathan', ownerColor: '#5b3cc4', mine, projects, leads: leads(mine) });
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
async function enter(mine = true, data = projects) {
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
  const c = ownerCubby();
  if (!mine) { c.mine = false; c.watching = true; delete c.interior.ownerDevices; delete c.interior.computerId; }
  return projects.flatMap((p, projectIndex) => [
    ...(p.hasMainLead ? [{ id: `project-${projectIndex}-ceo`, project: p.name, projectIndex, role: 'CEO', title: 'Main lead', computer: 'Mac mini',
      where: projectIndex === 0 ? where : 'hq', needsYou: projectIndex === 0 && needsYou, ...(projectIndex === 0 ? { floorId: 'normal', cubby: c, messages: held.map(i => ({ ...i })) } : {}) }] : []),
    ...p.departmentLeads.map((d, departmentIndex) => ({ id: `project-${projectIndex}-department-${departmentIndex}`, project: p.name, projectIndex, departmentIndex,
      role: d.department, title: d.title, computer: 'Mac mini', where: 'hq', needsYou: false })),
  ]);
}
async function projectFloor(hqEnabled = true, mine = true) {
  await leave();
  const c = ownerCubby();
  if (!mine) { delete c.interior; c.mine = false; }
  if (hqEnabled) { const lead = leads(mine)[0]; delete lead.messages; c.hqLead = { hqFloorId: 'hq', lead }; }
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
    const cards = []; window.__office.scene.getObjectByName('hq-away-cards').traverse(o => { if (o.name === 'hq-lead-status') { r.group.updateWorldMatrix(true, false); const local = r.group.worldToLocal(o.position.clone()); cards.push({ ...o.userData, withinRoom: Math.abs(local.x) + o.geometry.parameters.width / 2 < r.place.width / 2 }); } });
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
const evidence = [];
async function close() { await page.locator('.modal button.close').click(); await page.waitForFunction(() => window.__office.player.hasMouse); }
async function arrive() { await page.evaluate(() => window.__audit.parts.travel.arrive('elevator')); await page.waitForTimeout(600); }
try {
  await setup('owner');
  fingerprint = await page.evaluate(async () => (await (await import('/shared/cubby/keys.ts')).ownerDeviceKey('Jonathan')).fingerprint);
  await enter();
  for (const [width, height] of [[1280,800],[390,844]]) {
    await page.setViewportSize({ width, height }); await stand(-11.5, 1.8, -11.5, -6, .02);
    const v = await leadView(); evidence.push(v);
    assert.equal(v.bodies.length, 4); assert.ok(v.bodies.every(b => b.plateCount === 1)); assert.deepEqual(v.collisions, []);
    assert.equal(v.bodies[0].lines[0], "Jonathan's · Plimbo CEO"); assert.match(v.bodies[0].lines[1], /CEO/);
    assert.equal(v.bodies[1].lines[1], 'Marketing');
  }
  await page.mouse.click(720, 700);
  await shot('01-hq-project-leads', () => stand(-12.7, 7, -12.7, -6, .02));
  await useLead('project-0-ceo'); await page.waitForSelector('.cubby-chat');
  await page.waitForFunction(() => !document.querySelector('.cubby-chat textarea').disabled);
  assert.match(await page.locator('.cb-log').innerText(), /same conversation from Plimbo/);
  await page.locator('.cubby-chat textarea').fill('Hello from HQ'); await page.locator('.cubby-chat button[type=submit]').click();
  await page.waitForTimeout(200);
  const message = sent.find(m => m.t === 'cubbies.chat'); assert.equal(message?.id, 'jonathan-cubby'); assert.equal(message?.ownerSig.length, 86);
  const publicKey = await page.evaluate(async () => (await (await import('/shared/cubby/keys.ts')).ownerDeviceKey('Jonathan')).publicKey);
  const { createPublicKey, verify } = await import('node:crypto');
  const signed = JSON.stringify(['agent-office/cubby-owner-chat/v1', message.id, 'normal', 'mac-fixture', message.requestId, message.at, message.text]);
  assert.equal(verify('sha256', Buffer.from(signed), { key: createPublicKey({ key: Buffer.from(publicKey, 'base64url'), type: 'spki', format: 'der' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(message.ownerSig, 'base64url')), true, 'HQ chat is signed for source floor');
  await close();
  await useLead('project-0-department-0'); await page.waitForSelector('.hq-lead-card');
  assert.match(await page.locator('.hq-lead-card').innerText(), /Talk to Marketing lead in the Claude app on Mac mini/);
  assert.equal(await page.locator('.hq-lead-card textarea').count(), 0); await shot('06-department-lead-card'); await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__office.player.hasMouse);
  await projectFloor(); assert.equal((await cubbyView()).body, false); assert.equal((await cubbyView()).cards.length, 2); assert.ok((await cubbyView()).cards.every(c => c.withinRoom), 'cards do not clip through cubby side walls');
  const place = await page.evaluate(() => window.__audit.parts.cubbies.rooms().get(0).place);
  const spot = await page.evaluate(async () => { const { furniture, toFloor } = await import('/features/cubbies/model.ts'); const p = window.__audit.parts.cubbies.rooms().get(0).place, f = furniture(p.width, p.depth).lead; return toFloor(p, Math.max(-p.width / 2 + .95, Math.min(p.width / 2 - .95, f.x)), f.z); });
  await stand(spot.x + 2.8, spot.z, spot.x, spot.z, -.06); await shot('02-project-status-card', () => stand(spot.x + 4.1, spot.z, spot.x, spot.z, -.06));
  assert.ok((await cubbyView()).cards.every(c => c.statusText === 'At HQ'));
  await stand(place.x + place.depth / 2 + 2, place.z, place.x, place.z, .25); await shot('09-project-door-sign', () => stand(place.x + place.depth / 2 + 3.2, place.z, place.x, place.z, .25));
  await stand(spot.x + 2.5, spot.z, spot.x, spot.z, -.06);
  await page.keyboard.press('e'); await page.waitForSelector('.cubby-chat');
  await page.locator('.hq-go').click(); await page.waitForTimeout(500);
  assert.equal(sent.filter(m => m.t === 'floor.go').at(-1).floor, 'hq');
  await enter(); await arrive();
  assert.ok(await page.evaluate(() => Math.hypot(window.__office.player.pos.x + 11.5, window.__office.player.pos.z + 7.55) < 3), 'Go there arrives near HQ body');
  needsYou = true; await enter();
  assert.equal((await leadView()).bodies[0].hand, true);
  await stand(-11.5, -3.5, -11.5, -7.55, .03); await shot('08-needs-you-body');
  where = 'pitch'; await enter();
  push(page, { t: 'pitch', view: { ...pitch, floorId: 'normal', readOnly: false } });
  await page.waitForTimeout(400);
  let v = await leadView(); assert.equal(v.bodies.filter(b => b.id === 'project-0-ceo').length, 1);
  assert.ok(v.bodies[0].position[0] > 9 && v.bodies[0].position[2] > 8.15); assert.equal(v.bodies[0].hand, true); assert.equal(v.cards[0].statusText, 'In the pitch room'); assert.equal(v.glow, true);
  await stand(-11.5, -3.9, -11.5, -6.7, 0); await shot('04-needs-you-hq', () => stand(-10.3, -3.1, -11.5, -6.7, 0));
  await useLead('project-0-ceo', true); await page.waitForSelector('.cubby-chat'); await page.locator('.hq-go').click();
  await page.waitForTimeout(500); assert.equal(await page.evaluate(() => window.__office.store.floor), 'hq');
  assert.ok(await page.evaluate(() => { const p = window.__office.player; return p.pos.z > 8.15 && p.pos.x > 9.15 && p.fits(p.pos.x, p.pos.z, 0); }), 'pitch arrival is inside the room and clear of the table');
  await stand(16.7, 11.7, 16.7, 9.3, .05); await shot('03-pitch-room-lead');
  await useLead('project-0-ceo'); await page.waitForSelector('.cubby-chat'); await page.locator('.hq-go').click(); await page.waitForTimeout(500);
  assert.equal(sent.filter(m => m.t === 'floor.go').at(-1).floor, 'normal');
  await projectFloor(); await arrive();
  assert.ok(await page.evaluate(() => { const p = window.__office.player.pos, r = window.__audit.parts.cubbies.rooms().get(0); return p.x > r.place.x + r.place.depth / 2; }), 'return stops outside cubby door');
  assert.equal((await cubbyView()).body, false); assert.ok((await cubbyView()).cards.every(c => c.needsYou && c.statusText === 'In the HQ pitch room'));
  await stand(spot.x + 2.8, spot.z, spot.x, spot.z, -.06); await shot('05-needs-you-project', () => stand(spot.x + 4.1, spot.z, spot.x, spot.z, -.06));
  await account('manager'); await enter(false); await useLead('project-0-ceo'); await page.waitForSelector('.cubby-chat.watching');
  assert.equal(await page.locator('.cubby-chat textarea:visible').count(), 1);
  assert.match(await page.locator('.cb-note.watch').innerText(), /Goes to Jonathan first. Nova only sees it if Jonathan passes it on./);
  assert.match(await page.locator('.cb-log').innerText(), /same conversation/);
  await page.locator('.cubby-chat textarea').fill('Could you check the next project milestone?');
  await shot('10-manager-compose');
  await page.locator('.cubby-chat button[type=submit]').click(); await page.waitForTimeout(150);
  const composed = sent.filter(m => m.t === 'hq.message').at(-1);
  assert.equal(composed.lead, 'project-0-ceo'); assert.equal(composed.text, 'Could you check the next project milestone?');
  assert.equal(sent.filter(m => m.t === 'cubbies.chat').length, 1, 'manager compose does not send cubby chat');
  held.push({ id: 'held-one', manager: 'Ivanh', lead: composed.lead, text: composed.text, at: Date.now(), state: 'waiting' });
  push(page, { t: 'hq', view: hq(false) });
  await page.waitForFunction(() => document.querySelector('.hq-messages')?.textContent.includes('waiting'));
  assert.equal(await page.getByRole('button', { name: 'Pass on', exact: true }).count(), 0);
  await close(); await account('owner'); await enter();
  assert.equal((await leadView()).cards[0].messageBadge, '1 message from Ivanh');
  await useLead('project-0-ceo');
  await page.getByRole('button', { name: 'Pass on', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Pass on')?.disabled);
  await shot('11-owner-waiting');
  // An untrusted browser can decline, but cannot pass anything to the connector.
  const savedFingerprint = fingerprint; fingerprint = 'untrusted'; push(page, { t: 'hq', view: hq(true) });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Pass on')?.disabled);
  assert.match(await page.locator('.hq-messages').innerText(), /Use your trusted device/);
  assert.equal(await page.getByRole('button', { name: 'Decline', exact: true }).isEnabled(), true);
  fingerprint = savedFingerprint; push(page, { t: 'hq', view: hq(true) });
  await page.getByRole('button', { name: 'Pass on', exact: true }).click(); await page.waitForTimeout(150);
  const passed = sent.filter(m => m.t === 'cubbies.chat').at(-1);
  assert.equal(passed.hqMessageId, 'held-one'); assert.equal(passed.text, labelled(held[0]));
  assert.equal(passed.requestId, 'held-one'); assert.equal(passed.ownerPublicKey, publicKey);
  const full = JSON.stringify(['agent-office/cubby-owner-chat/v1', passed.id, 'normal', 'mac-fixture', passed.requestId, passed.at, passed.text]);
  assert.equal(verify('sha256', Buffer.from(full), { key: createPublicKey({ key: Buffer.from(publicKey, 'base64url'), type: 'spki', format: 'der' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(passed.ownerSig, 'base64url')), true);
  held[0].state = 'passed'; deliveredLines.push({ id: passed.requestId, role: 'user', text: passed.text, at: passed.at });
  push(page, { t: 'hq', view: hq(true) });
  await page.waitForFunction(() => document.querySelector('.cb-line.user b')?.textContent === 'Ivanh');
  assert.equal(await page.locator('.cb-line.user b').innerText(), 'Ivanh');
  await shot('12-passed-on-thread');
  await close(); await account('manager'); await enter(false); await useLead('project-0-ceo');
  assert.match(await page.locator('.hq-messages').innerText(), /passed on/);
  await page.locator('.cubby-chat textarea').fill('A second idea to decline.');
  await page.locator('.cubby-chat button[type=submit]').click(); await page.waitForTimeout(150);
  held.push({ id: 'held-two', manager: 'Ivanh', lead: composed.lead, text: sent.filter(m => m.t === 'hq.message').at(-1).text, at: Date.now(), state: 'waiting' });
  await close(); await account('owner'); await enter(); await useLead('project-0-ceo');
  await page.getByRole('button', { name: 'Decline', exact: true }).click(); await page.waitForTimeout(150);
  assert.equal(sent.filter(m => m.t === 'hq.decline').at(-1).id, 'held-two'); held[1].state = 'declined';
  await close(); await account('manager'); await enter(false); await useLead('project-0-ceo');
  assert.match(await page.locator('.hq-messages').innerText(), /declined/);
  await page.locator('.hq-go').click(); await page.waitForTimeout(500);
  assert.equal(sent.filter(m => m.t === 'floor.go').at(-1).floor, 'normal');
  await projectFloor(true, false); await arrive(); assert.equal((await cubbyView()).interior, false);
  await useLead('project-0-ceo', true, true);
  assert.equal(await page.locator('.cubby-chat textarea:visible').count(), 0);
  assert.equal(await page.locator('.hq-message').count(), 0); await close();
  await account('owner'); where = 'hq'; needsYou = false; await enter(); assert.equal((await leadView()).cards.length, 0);
  await projectFloor(false); assert.equal((await cubbyView()).body, true); assert.equal((await cubbyView()).cards.length, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await enter(); assert.equal((await leadView()).bodies.length, 4);
  assert.deepEqual(errors, []); assert.equal(sent.filter(m => m.t === 'cubbies.chat').length, 2);
  writeFileSync(`${out}/report.json`, JSON.stringify({ evidence, errors, sentChat: message, screenshots: out }, null, 2));
  console.log(`HQ leads UI checks passed. Screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
