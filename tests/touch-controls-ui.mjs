// Real office + renderer + input. All office messages use a routed WebSocket; no office server/providers.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = realpathSync(process.cwd());
const out = root + '/.paradev/shots-touch';
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: root + '/vite.config.ts', configLoader: 'runner', cacheDir: root + '/.paradev/cache-touch', server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const url = 'http://127.0.0.1:' + server.httpServer.address().port;
const errors = [], checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };

async function open(touch, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(12000);
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Touch fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture', 'NotAllowedError'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false } }) }));
  let socket;
  const sent = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(raw => sent.push(JSON.parse(String(raw)))); });
  await page.goto(url);
  await page.waitForFunction(() => window.__office?.net.up);
  // Reuse the protocol defaults, then deliver them over the same socket as a real welcome.
  const welcome = await page.evaluate(() => {
    const s = window.__office.store;
    return { ...JSON.parse(JSON.stringify(s)), t: 'welcome', version: 'fixture', you: 'touch-fixture', peers: [], workers: [], floor: null,
      whiteboard: { elements: [], people: [] }, cabinet: { ...s.cabinet, frame: null }, plan: s.floorPlan, cars: [], tv: { video: null },
      issues: { items: [], fetchedAt: Date.now(), loading: false }, pulls: { items: [], fetchedAt: Date.now(), loading: false } };
  });
  socket.send(JSON.stringify(welcome));
  await page.waitForSelector('#loading', { state: 'detached', timeout: 60000 });
  await page.locator('.backdrop .close').last().click();
  if (touch) {
    check('touch offer explains on-screen controls', await page.locator('.lite-offer').innerText().then(t => t.includes('Walk around in 3D with on-screen controls')));
    await page.getByRole('button', { name: 'Stay in 3D', exact: true }).tap();
    check('stay-in-3D choice persists', await page.evaluate(() => localStorage.getItem('agent-office.lite-declined') === '1'));
    await page.waitForSelector('.touch-controls:visible');
  }
  // Deterministic empty walkway, retaining actual collisions and frame ticks.
  await page.evaluate(() => {
    const p = window.__office.player;
    let spot;
    for (let x = -8; x <= 8 && !spot; x += 2) for (let z = 6; z >= -6 && !spot; z -= 2) {
      if ([-1, 0, 1].every(dx => [-1, 0, 1].every(dz => p.fits(x + dx, z + dz, 0)))) spot = { x, z };
    }
    if (!spot) throw new Error('No fixture walkway');
    p.pos.set(spot.x, 0, spot.z); p.camYaw = 0; p.lookPitch = -0.08; p.updateCamera(true);
  });
  return { page, context, sent, send: message => socket.send(JSON.stringify(message)) };
}
async function settle(page) { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function position(page) { return page.evaluate(() => ({ ...window.__office.player.pos, yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch })); }
async function center(page, selector) { const r = await page.locator(selector).boundingBox(); assert.ok(r, selector); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
async function aimBoard(page) {
  await page.evaluate(() => {
    const o = window.__office, p = o.player;
    const it = o.office.interactables.find(it => it.kind === 'issues');
    p.view = 'third'; p.pos.set(it.x, it.y ?? 0, it.z + 1); p.camYaw = 0; p.updateCamera(true);
  });
  await page.waitForFunction(() => document.querySelector('.touch-action')?.textContent === 'Open');
}
async function layoutCheck(page, name) {
  await settle(page);
  const result = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const controls = [...document.querySelectorAll('.touch-surface')].filter(el => el.getClientRects().length && !el.hidden).map(rect);
    const hud = [...document.querySelectorAll('.topbar, #chat-input, #chat-log, .hint')].filter(el => el.getClientRects().length).map(rect);
    const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    return { controls, hud, overlap: controls.some(a => hud.some(b => overlaps(a, b))), width: visualViewport.width, height: visualViewport.height };
  });
  check(name + ' controls inside viewport', result.controls.every(r => r.x >= 0 && r.y >= 0 && r.right <= result.width + 1 && r.bottom <= result.height + 1));
  check(name + ' controls clear HUD', !result.overlap);
  const look = await page.locator('.touch-look').boundingBox();
  check(name + ' has usable look area', look.width >= 72 && look.height >= 44);
  return result;
}

try {
  const { page, context, sent, send } = await open(true, 390, 844);
  check('controls appear on touch', await page.locator('.touch-controls').isVisible());
  check('Q absent without hint', !await page.locator('.touch-secondary').isVisible());
  const cdp = await context.newCDPSession(page);
  const touches = new Map();
  async function touch(type, id, point) {
    if (type === 'touchEnd' || type === 'touchCancel') touches.delete(id);
    else touches.set(id, { ...point, id, radiusX: 4, radiusY: 4, force: 1 });
    // CDP ends every pointer on touchEnd; a reduced active set releases just one finger.
    await cdp.send('Input.dispatchTouchEvent', { type: type === 'touchEnd' && touches.size ? 'touchMove' : type, touchPoints: [...touches.values()] });
    await settle(page);
  }
  const stick = await center(page, '.touch-stick');
  const look = await center(page, '.touch-look');
  const before = await position(page);
  await touch('touchStart', 1, stick);
  await touch('touchMove', 1, { x: stick.x, y: stick.y - 30 });
  await touch('touchStart', 2, look);
  await touch('touchMove', 2, { x: look.x + 35, y: look.y + 20 });
  await page.waitForFunction(z => Math.abs(window.__office.player.pos.z - z) > 0.12, before.z);
  await page.waitForFunction(yaw => window.__office.player.camYaw < yaw - 0.1, before.yaw);
  const moved = await position(page);
  check('stick moves player during simultaneous look', Math.hypot(moved.x - before.x, moved.z - before.z) > 0.12);
  check('right drag turns yaw and pitch', moved.yaw < before.yaw - 0.1 && moved.pitch < before.pitch - 0.05);
  await touch('touchEnd', 2);
  check('releasing look preserves walking', await page.evaluate(() => window.__office.player.walkInput.z < 0));
  await touch('touchEnd', 1);
  await settle(page);
  const released = await position(page);
  await page.waitForTimeout(150);
  const stopped = await position(page);
  check('releasing stick stops movement', Math.hypot(released.x - stopped.x, released.z - stopped.z) < 0.001);
  await touch('touchStart', 1, stick);
  await touch('touchMove', 1, { x: stick.x, y: stick.y - 30 });
  await touch('touchCancel', 1);
  check('cancel clears movement', await page.evaluate(() => window.__office.player.walkInput.z === 0));

  await touch('touchStart', 1, stick);
  await touch('touchMove', 1, { x: stick.x, y: stick.y - 30 });
  await page.keyboard.press('h');
  await page.waitForSelector('.backdrop');
  check('opening window cancels held stick', await page.evaluate(() => window.__office.player.walkInput.z === 0));
  await touch('touchEnd', 1);
  await page.locator('.backdrop .close').last().tap();
  await page.waitForSelector('.touch-controls:visible');
  check('closed window does not resume old gesture', await page.evaluate(() => window.__office.player.walkInput.z === 0));

  await aimBoard(page);
  await page.locator('.touch-action').tap();
  await page.waitForSelector('.backdrop');
  check('action uses E on actual issues board', (await page.locator('.backdrop').innerText()).includes('Issues'));
  check('modal hides controls', !await page.locator('.touch-controls').isVisible());
  await page.locator('.backdrop .close').last().tap();
  await page.waitForSelector('.touch-controls:visible');
  check('close immediately restores touch', await page.locator('.touch-controls').isVisible());

  // Aim at the same actual board in first person, then tap the look surface to click the crosshair.
  await page.evaluate(() => {
    const o = window.__office, mesh = o.office.boardMeshes.issues, p = o.player;
    mesh.updateWorldMatrix(true, false);
    const target = mesh.getWorldPosition(p.pos.clone());
    p.view = 'first'; p.pos.set(target.x, 0, target.z + 2); p.camYaw = 0;
    p.lookPitch = Math.atan2(target.y - 1.6, 2); p.updateCamera(true);
  });
  await page.waitForFunction(() => document.querySelector('.touch-action')?.textContent === 'Open');
  await page.locator('.touch-look').tap();
  await page.waitForSelector('.backdrop');
  check('look tap selects crosshair target', await page.locator('.backdrop').isVisible());
  await page.locator('.backdrop .close').last().tap();
  await page.waitForSelector('.touch-controls:visible');

  await page.locator('#chat-input').focus();
  await page.waitForSelector('.touch-controls', { state: 'hidden' });
  check('typing hides controls', !await page.locator('.touch-controls').isVisible());
  await page.locator('#chat-input').blur();
  await page.waitForSelector('.touch-controls:visible');
  // An existing dock panel uses HUD classes, not the modal stack.
  await page.locator('.dock-panel').first().tap();
  await page.waitForSelector('.touch-controls', { state: 'hidden' });
  check('side panel hides controls', !await page.locator('.touch-controls').isVisible());
  await page.locator('.dock-panel').first().tap();
  await page.waitForSelector('.touch-controls:visible');

  const issue = { number: 1, title: 'Touch fixture card', state: 'OPEN', url: 'https://example.invalid/issues/1', author: 'fixture', labels: [], assignees: [], createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', body: 'Local fixture', comments: 0 };
  await page.route('**/api/gh/issue?*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...issue, comments: [], viewer: 'fixture' }) }));
  send({ t: 'gh.issues', state: { items: [issue], loading: false, fetchedAt: Date.now() } });
  await aimBoard(page);
  await page.locator('.touch-action').tap();
  await page.locator('.card .ttl').filter({ hasText: 'Touch fixture card' }).tap();
  await page.getByRole('button', { name: '✋ Pick it up', exact: true }).tap();
  await page.waitForSelector('.touch-secondary:visible');
  check('Q follows real carried-card hint', (await page.locator('.touch-secondary').getAttribute('aria-label')).startsWith('Q:'));
  await layoutCheck(page, 'with-Q');
  await page.locator('.touch-secondary').tap();
  await page.waitForFunction(() => !window.__office.carried());
  await page.waitForSelector('.touch-secondary', { state: 'hidden' });
  check('Q puts card back and disappears', !await page.locator('.touch-secondary').isVisible());
  check('Q sends actual carry release', sent.some(m => m.t === 'carry' && !m.issue));
  send({ t: 'gh.issues', state: { items: [], loading: false, fetchedAt: Date.now() } });

  // Simulate the viewport shrink reported by a phone keyboard; desktop headless has no soft keyboard.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: innerHeight - 280 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForSelector('.touch-controls', { state: 'hidden' });
  check('keyboard viewport hides controls', !await page.locator('.touch-controls').isVisible());
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
  await page.waitForSelector('.touch-controls:visible');
  await aimBoard(page);
  await page.waitForFunction(() => !document.getElementById('toasts').children.length);
  // Screenshot every requested size, with an actual target's hint visible.
  for (const [width, height, name] of [[390, 844, 'phone'], [320, 720, 'duo-outer'], [744, 1000, 'duo-inner'], [320, 720, 'duo-refolded'], [720, 320, 'landscape']]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(w => Math.abs(visualViewport.width - w) < 1, width);
    await layoutCheck(page, name);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  const desktop = await open(false, 1440, 1000);
  check('desktop has no touch UI or styles', await desktop.page.locator('.touch-controls, body.touch-enabled').count() === 0);
  await desktop.page.screenshot({ path: `${out}/desktop.png` });
  check('no browser errors', errors.length === 0);
  check('no workers started', !sent.some(m => /spawn|hire|resume/.test(m.t)));
  writeFileSync(`${out}/report.json`, JSON.stringify({ checks, errors, browser: browser.version() }, null, 2));
  console.log(`${checks.length} browser checks passed; screenshots: ${out}`);
} catch (error) {
  console.error('Browser errors:', errors);
  for (const c of browser.contexts()) for (const p of c.pages()) {
    console.error(await p.evaluate(() => ({ pos: window.__office?.player.pos, input: window.__office?.player.walkInput, enabled: window.__office?.player.enabled, mouseLook: window.__office?.player.mouseLook, hidden: document.hidden, typing: document.activeElement?.tagName, modals: document.querySelector('#modal-root')?.textContent, panels: [...document.querySelectorAll('.side section')].map(el => [el.className, el.getClientRects().length]), root: document.querySelector('.touch-controls')?.outerHTML, width: innerWidth, vv: [visualViewport.width, visualViewport.height, visualViewport.scale] })));
    await p.screenshot({ path: out + '/failure.png' });
  }
  throw error;
} finally { await browser.close(); await server.close(); }
