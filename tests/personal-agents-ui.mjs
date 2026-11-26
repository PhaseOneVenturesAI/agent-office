// Actual office renderer with synthetic cubby state; no real providers or external accounts.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-personal-agents`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: out + '/.vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [], sent = [], evidence = [];
let socket;
page.on('pageerror', e => errors.push(e.message));
const color = '#1f8a7a', look = { skin: 2, hair: 4, style: 1 };
const agents = [
  { id: 'lead', tool: 'Claude', role: 'lead', task: 'Project lead', branch: 'main', status: 'working' },
  { id: 'marketing', tool: 'Claude', role: 'lead', department: 'Marketing', task: 'Launch plan', branch: 'main', status: 'working' },
  { id: 'codex', tool: 'Codex', role: 'builder', task: 'Build checkout', branch: 'build', status: 'working' },
  { id: 'kimi', tool: 'Kimi', role: 'builder', task: 'Review checkout', branch: 'review', status: 'idle' },
];
const cubby = { id: 'cub-me', slot: 0, ownerName: 'Jonathan Fixture', ownerColor: color, mine: true, lamp: 'working', working: 4,
  interior: { computerName: 'Mac mini', leadName: 'Nova', look, agents, plan: ['Build checkout', 'Prepare launch'], needsYou: [], chat: [] } };
const state = { enabled: true, floorId: 'fixture', setupAllowed: true, ownerColor: color, cubbies: [cubby,
  { id: 'cub-other', slot: 1, ownerName: 'Alex Fixture', ownerColor: '#d1495b', mine: false, lamp: 'working', working: 2 }] };
const push = m => socket.send(JSON.stringify(m));
const shot = async (name, frame) => {
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height }); if (frame) await frame(width); await page.waitForTimeout(350);
    if (name === 'setup-swatches') await page.getByRole('radiogroup', { name: 'Owner colour', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page overflow');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
};
const stand = (x, z, yaw, pitch = -0.05) => page.evaluate(([x, z, yaw, pitch]) => {
  const o = window.__office;
  o.player.view = 'first'; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
}, [x, z, yaw, pitch]);
try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan Fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture', 'NotAllowedError'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { name: 'Jonathan Fixture', role: 'member' } } }) }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: await response.text() + '\nwindow.__audit = { ctx, core, parts, cubbies: parts.cubbies };\n' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(raw => sent.push(JSON.parse(String(raw)))); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'fixture'; s.you = 'fixture-self';
    s.project = { name: 'Plimbo', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    for (const e of ['project', 'floor']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    o.sky.show({ hour: 12, weather: 'clear' });
  });
  push({ t: 'cubbies', state: { ...state, ownerColor: '#6c4fd8', cubbies: [] } });
  await page.waitForTimeout(300);
  await page.mouse.click(700, 700);
  await page.evaluate(() => { const a = window.__audit; a.ctx.interactions.use(a.cubbies.rooms().get(0).door, 'E', null); });
  await page.waitForSelector('.cubby-setup');
  assert.equal(await page.getByRole('radio', { name: 'Owner colour: Violet', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('radio', { name: 'Owner colour: Teal', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: 'Owner colour: Teal', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.cubby-setup .btn.close').count(), 1);
  await shot('setup-swatches');
  await page.fill('input[aria-label="Lead name"]', 'Nova');
  await page.locator('.cubby-setup button[type="submit"]').click();
  await page.waitForTimeout(150);
  assert.equal(sent.find(m => m.t === 'cubbies.setup')?.ownerColor, color);
  await page.locator('.cubby-setup .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse);
  // The existing setup close/Escape path returns directly to mouse-look.
  await page.evaluate(() => { const a = window.__audit; a.ctx.interactions.use(a.cubbies.rooms().get(0).door, 'E', null); });
  await page.waitForSelector('.cubby-setup');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.hasMouse);
  push({ t: 'cubbies', state }); await page.waitForTimeout(400);
  const materialEvidence = await page.evaluate(() => {
    const room = window.__audit.cubbies.rooms().get(0), inside = room.interior;
    const models = [inside.lead, ...[...inside.views.values()].map(v => v.model).filter(Boolean)];
    const result = models.map(m => {
      const colors = {};
      for (const name of ['owner-band', 'owner-tie', 'owner-antenna-tip']) { const o = m.root.getObjectByName(name); if (o) colors[name] = '#' + o.material.color.getHexString(); }
      return { ...m.root.userData.personal, colors };
    });
    const other = window.__audit.cubbies.rooms().get(1);
    const frost = []; other.shapes.forEach(s => s.traverse(o => { if (o.isMesh) { if (o.material.opacity !== 0.55 || o.material.type !== 'MeshBasicMaterial') throw Error('Silhouette opacity changed'); frost.push('#' + o.material.color.getHexString()); } }));
    return { models: result, frost, place: room.place };
  });
  assert.equal(materialEvidence.models.length, 4);
  for (const m of materialEvidence.models) { assert.equal(m.ownerColor, color); assert.equal(m.colors['owner-band'], color); }
  assert.ok(materialEvidence.models.some(m => m.label === "Jonathan's · Plimbo CEO"));
  assert.ok(materialEvidence.models.some(m => m.label === "Jonathan's · Plimbo Marketing"));
  assert.ok(materialEvidence.models.some(m => m.label === 'Codex · Build checkout' && m.colors['owner-antenna-tip'] === color));
  assert.ok(materialEvidence.models.some(m => m.label === 'Kimi · Review checkout' && m.colors['owner-antenna-tip'] === color));
  assert.ok(materialEvidence.frost.every(c => c === '#d1495b'));
  evidence.push(materialEvidence);
  const p = materialEvidence.place;
  await stand(p.x + p.depth / 2 + 1.7, p.z, Math.PI / 2, -0.12);
  // Wider phone overview of the actual room so all four models fit; the other captures use normal FOV.
  await page.evaluate(() => { window.__wide = true; window.__audit.ctx.view.add({ fov: f => window.__wide && innerWidth < 500 ? 110 : f }); });
  await shot('interior-lineup');
  await page.evaluate(() => { window.__wide = false; });
  // Actual office Worker alongside the personal models, on the open floor, for direct visual comparison.
  await page.evaluate(async () => {
    const { Worker } = await import('/world/character/worker.ts');
    const { PersonalPerson } = await import('/features/cubbies/personal-agents/person.ts');
    const group = new window.__audit.cubbies.group.constructor(); group.name = 'personal-comparison';
    const office = new Worker('Office worker', '#4a7dbd'); office.setOwner('Office'); office.setStatus('idle', false); office.root.position.set(-0.9, 0, 0);
    const person = new PersonalPerson('Nova', '#1f8a7a', { skin: 2, hair: 4, style: 1 }); person.setUniform('Jonathan', 'Plimbo', 'CEO', '#1f8a7a'); person.root.position.set(0.9, 0, 0);
    for (const m of [office, person]) { group.add(m.root); m.update(0.1, 1); }
    group.position.set(-14, 0, -4); window.__office.scene.add(group);
  });
  await shot('office-vs-personal', width => stand(-14, width < 500 ? 6 : 2.5, 0, -0.07));
  await page.evaluate(() => window.__office.scene.getObjectByName('personal-comparison').removeFromParent());
  await stand(8.3, -10.3, Math.atan2(8.3 - 9.8, -10.3 + 7.3), 0.12);
  push({ t: 'drafts', state: { enabled: true, canStart: true, here: { id: 'fixture', name: 'Plimbo', createdAt: 1, cubbyId: 'cub-me', leadName: 'Nova', online: true, designers: 0, boards: { ideas: [], decisions: [], plan: [], screens: [], brand: { colors: [] } } } } });
  await page.waitForTimeout(700);
  const draft = await page.evaluate(() => {
    let found; window.__office.scene.getObjectByName('drafts').traverse(o => { if (o.userData.personal) found = { ...o.userData.personal, band: '#' + o.getObjectByName('owner-band').material.color.getHexString() }; }); return found;
  });
  assert.equal(draft?.band, color); assert.equal(draft.label, "Jonathan's · Plimbo CEO"); evidence.push({ draft });
  await shot('draft-lead');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.deepEqual(errors, []);
  writeFileSync(out + '/evidence.json', JSON.stringify({ phoneInteriorOverviewFov: 110, evidence, errors, sent: sent.filter(m => m.t === 'cubbies.setup') }, null, 2));
  console.log(`PASS: setup, materials, silhouettes, labels, draft and desktop/phone captures: ${out}`);
} finally { await browser.close(); await server.close(); }
