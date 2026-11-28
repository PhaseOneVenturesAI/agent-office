// Real client, synthetic owner publication over the WebSocket boundary; server privacy/signatures
// are exercised separately in pitch.test.ts. No live external sites or provider calls.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-pitch`;
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${root}/.paradev/pitch-vite`, logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], sent = [], sockets = new Map();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const hash = 'a'.repeat(64), meta = { hash, mime: 'image/png', width: 960, height: 540 };
const pitch = { department: 'Marketing', lead: 'Plimbo Marketing lead', status: 'ready', version: 'v3', pieces: [
  { id: 'home', kind: 'site', title: 'Home page', url: 'https://example.com/', image: meta, notes: ['A calmer week for your family.'], images: [] },
  { id: 'video', kind: 'video', title: 'Explainer', image: meta, notes: ['A 30-second introduction.'], images: [] },
  { id: 'slides', kind: 'slides', title: 'Launch deck', notes: ['The story, one slide at a time.'], images: [meta, { ...meta, hash: 'b'.repeat(64) }] },
  { id: 'ads', kind: 'ads', title: 'Ads', notes: ['One verdict covers this set.'], images: [meta, meta, meta, meta] },
] };
const view = { cubbyId: 'cub-alice', floorId: 'fixture', computerId: 'computer-alice', pitch };
const cubbies = { enabled: true, floorId: 'fixture', setupAllowed: true, cubbies: [{ id: view.cubbyId, slot: 0, mine: true, ownerName: 'Alice', lamp: 'online', working: 0,
  interior: { computerId: view.computerId, computerName: 'Mac mini', leadName: pitch.lead, look: { skin: 0, hair: 0, style: 0 }, agents: [], plan: [], needsYou: [], chat: [] } }] };
let png;
const push = (page, frame) => sockets.get(page).send(JSON.stringify(frame));
async function setup(page, owner = true, lite = false) {
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    // Inspect the actual canvas text drawn on the back-wall board, without production test hooks.
    const proto = CanvasRenderingContext2D.prototype, fillRect = proto.fillRect, fillText = proto.fillText;
    if (!proto.__pitchAudit) {
      proto.__pitchAudit = true;
      proto.fillRect = function(x, y, w, h) {
        if (x === 0 && y === 0 && w === this.canvas.width && h === this.canvas.height) this.canvas.__drawnText = [];
        return fillRect.apply(this, arguments);
      };
      proto.fillText = function(text) { (this.canvas.__drawnText ??= []).push(text); return fillText.apply(this, arguments); };
    }
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alice', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('Disabled in fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: owner ? 'alice' : 'bob', name: owner ? 'Alice' : 'Bob', role: 'member' } } }) }));
  await page.route('**/api/pitch/**', r => r.fulfill({ contentType: 'image/png', body: png }));
  // The site piece's live wall frame is served locally: no external site calls.
  await page.route('https://example.com/**', r => r.fulfill({ contentType: 'text/html', body: '<h1>Live site</h1>' }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit = { ctx, core, parts };' }); });
  await page.route('**/lite.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__lite = { store, net };' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { sockets.set(page, ws); ws.onMessage(raw => {
    const m = JSON.parse(String(raw)); sent.push(m);
    if (m.t === 'pitch.verdict') {
      assert.equal(m.ownerSig, undefined);
      // Echo models the computer saving a verified verdict (the full path is tested in pitch.test.ts).
      const p = pitch.pieces.find(p => p.id === m.pieceId);
      p.stamp = { requestId: m.requestId, verdict: m.verdict, note: m.note, at: m.at };
      setTimeout(() => push(page, { t: 'pitch', view }), 50);
    }
  }); });
  await page.goto(`${base}/${lite ? 'lite.html' : '?3d=1'}`);
  await page.waitForFunction(lite => lite ? window.__lite?.net.up : window.__audit && window.__office?.net.up, lite);
  await page.evaluate(([lite, owner]) => {
    const s = lite ? window.__lite.store : window.__office.store;
    s.floor = 'fixture'; s.you = 'self'; s.me = { admin: false, account: { id: owner ? 'alice' : 'bob', name: owner ? 'Alice' : 'Bob', role: 'member' } };
    s.floors = [{ id: 'fixture', name: 'Gallery fixture', dir: '/fixture', workers: 0, people: 1, busy: 0, waiting: 0, palette: 0 }]; s.emit('floors');
    s.project = { name: 'Gallery fixture', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    if (!lite) {
      const a = window.__audit, o = window.__office;
      a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
      document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    }
  }, [lite, owner]);
  if (!png) png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540; const g = c.getContext('2d');
    g.fillStyle = '#fff1de'; g.fillRect(0, 0, 960, 540); g.fillStyle = '#2b2d42'; g.font = 'bold 34px sans-serif'; g.fillText('KINDLY', 55, 65);
    g.font = 'bold 65px sans-serif'; g.fillText('A calmer week.', 55, 210); g.fillText('Together.', 55, 290);
    g.fillStyle = '#80ac94'; g.fillRect(58, 352, 285, 78); g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('Plan your week', 85, 402);
    g.fillStyle = '#df9a71'; g.beginPath(); g.arc(750, 290, 135, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  if (owner) {
    push(page, { t: 'cubbies', state: cubbies }); push(page, { t: 'pitch', view });
  } else push(page, { t: 'pitch' });
  await page.waitForTimeout(400);
}
async function stand(page, x, z, tx, tz, pitch = 0) {
  await page.evaluate(([x, z, tx, tz, pitch]) => { const p = window.__office.player;
    p.pos.set(x, 0, z); p.vy = 0; p.camYaw = Math.atan2(-(tx - x), -(tz - z)); p.facing = p.camYaw + Math.PI; p.lookPitch = pitch; p.updateCamera(true);
  }, [x, z, tx, tz, pitch]);
  await page.waitForTimeout(400);
}
const boardText = page => page.evaluate(() => window.__audit.ctx.office.meetingBoard.material.map.image.__drawnText.join(' '));
const readyBoard = 'Marketing pitch · ready — walk the room';
const normalBoard = '🤝 The meeting room is free Press E at the table to call a meeting: whatever it writes shows up here.';
const shot = async (page, name) => {
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); await setup(page);
  assert.equal(await boardText(page), readyBoard);
  await page.evaluate(() => window.__office.store.emit('meeting'));
  assert.equal(await boardText(page), readyBoard, 'meeting refresh preserves the private notice');
  await stand(page, 10.7, 7.1, 13.5, 10.4);
  const before = await page.evaluate(() => window.__office.scene.getObjectByName('pitch-room').userData.dim);
  assert.ok(before > 0.98);
  // Walk in through the north door under normal movement, rather than teleporting into the room.
  await stand(page, 10.7, 7.5, 10.7, 11);
  await page.locator('#scene').click(); await page.keyboard.down('KeyW'); await page.waitForTimeout(650); await page.keyboard.up('KeyW');
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const o = window.__office, room = o.scene.getObjectByName('pitch-room');
    return { visible: room.visible, dim: room.userData.dim, pos: o.player.pos.toArray(), kinds: [...new Set(room.children.filter(c => c.name.startsWith('pitch-')).map(c => c.name.split('-')[1]))], lights: room.children.filter(c => c.isLight).length };
  });
  assert.ok(state.visible); assert.ok(state.dim < 0.4, JSON.stringify(state)); assert.deepEqual(state.kinds.sort(), ['ads', 'site', 'slides', 'video']); assert.equal(state.lights, 4);
  await stand(page, 10.7, 8.8, 14, 10.2, -0.03); await shot(page, '01-room-overview-dimmed');
  await stand(page, 12.8, 9, 12.8, 13, 0.08); await shot(page, '07-owner-board-ready');
  await stand(page, 14.3, 9.3, 16.1, 9.5, 0.08); await shot(page, '02-wall-screen');
  await stand(page, 10.25, 10.8, 10.15, 12.4, -0.08); await shot(page, '03-easel');
  await stand(page, 13.5, 9.1, 13.7, 10.5, -0.5); await shot(page, '04-ads-table');
  for (const id of ['home', 'video', 'slides', 'ads']) {
    // Walk up to each physical station, aim its preview, then press the real E key.
    const points = { home: [14.3, 9.3, 16.1, 9.5, 0.08], video: [13.7, 9.5, 13.75, 8.3, 0.15], slides: [10.25, 10.8, 10.15, 12.4, -0.08], ads: [13.5, 9.1, 13.7, 10.5, -0.5] };
    await stand(page, ...points[id]);
    await page.keyboard.press('KeyE');
    const modal = page.getByRole('dialog', { name: 'Pitch review' }); await modal.waitFor(); assert.equal(await modal.getByRole('button', { name: 'Close', exact: true }).count(), 1);
    if (id === 'home') {
      await modal.getByRole('button', { name: 'Change…', exact: true }).click(); await modal.getByText('Add a note so your lead knows what to change.').waitFor();
      assert.equal(sent.filter(m => m.t === 'pitch.verdict').length, 0);
      await modal.getByRole('textbox', { name: 'Change note' }).fill('Give the main promise more room.');
      await modal.getByRole('button', { name: 'Change…', exact: true }).click(); await modal.getByText('Saved on your computer.').waitFor();
      await shot(page, '05-verdict-modal');
    }
    if (id === 'slides') { await modal.getByRole('button', { name: 'Next image' }).click(); await modal.getByText('2 / 2').waitFor(); }
    if (id === 'ads' || id === 'video') await modal.getByRole('button', { name: 'Close', exact: true }).click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(100); assert.ok(await page.evaluate(() => window.__office.player.enabled), 'close returns keyboard control');
    assert.ok(await page.evaluate(() => window.__office.player.hasMouse), 'close returns mouse-look without another click');
  }
  assert.ok(await page.evaluate(() => !!window.__office.scene.getObjectByName('pitch-stamp')));
  // A reload receives the persisted echo, and the stamp survives.
  await setup(page); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => window.__office.store.pitch.pitch.pieces[0].stamp));
  const other = await browser.newPage({ viewport: { width: 1280, height: 800 } }); await setup(other, false);
  await stand(other, 10.7, 9, 14, 10.4);
  assert.deepEqual(await other.evaluate(() => { const r = window.__office.scene.getObjectByName('pitch-room'); return [r.visible, r.children.length, r.userData.dim]; }), [false, 0, 1]);
  assert.equal(await boardText(other), normalBoard);
  await stand(other, 12.8, 9, 12.8, 13, 0.08); await shot(other, '08-other-board');
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } }); await setup(phone, true, true);
  assert.equal(await phone.locator('.pitch-list li').count(), 4); await phone.getByText('Change requested — Give the main promise more room.', { exact: true }).waitFor();
  await phone.screenshot({ path: `${out}/06-lite-list-phone.png`, fullPage: true });
  await phone.setViewportSize({ width: 1280, height: 800 }); await phone.screenshot({ path: `${out}/06-lite-list-desktop.png`, fullPage: true });
  await phone.locator('.pitch-list button').first().click(); await phone.getByRole('dialog').waitFor(); await phone.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click(); await phone.getByText('Saved on your computer.').waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Deterministic YouTube API fixture: verify the existing embed path and teardown without network.
  await page.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Fixture video</body>' }));
  await page.evaluate(() => { window.YT = { Player: class {
    constructor(frame, options) { queueMicrotask(() => { options.events.onReady({ target: this }); options.events.onStateChange({ data: 1, target: this }); }); }
    playVideo() {} pauseVideo() {} stopVideo() {} seekTo() {} setVolume() {} getDuration() { return 300; } getCurrentTime() { return 0; } destroy() {}
  } }; });
  pitch.pieces[1].youtube = 'dQw4w9WgXcQ'; push(page, { t: 'pitch', view });
  await stand(page, 10.7, 9, 13.7, 8.3);
  await page.waitForSelector('.pitch-video-layer iframe');
  assert.match(await page.locator('.pitch-video-layer iframe').getAttribute('src'), /^https:\/\/www.youtube.com\/embed\/dQw4w9WgXcQ/);
  await stand(page, 10.7, 7, 13.7, 8.3); assert.equal(await page.locator('.pitch-video-layer iframe').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  push(page, { t: 'pitch', view: { ...view, pitch: { ...pitch, status: 'building' } } }); await page.waitForTimeout(1700);
  assert.ok(await page.evaluate(() => window.__office.scene.getObjectByName('pitch-room').userData.dim > 0.99));
  assert.equal(await page.evaluate(() => window.__audit.ctx.usables.lists().flat().filter(i => i.kind === 'pitchpiece').length), 0);
  assert.equal(await boardText(page), 'Marketing pitch · building');
  await stand(page, 12.8, 9, 12.8, 13, 0.08); await shot(page, '09-owner-board-building');
  push(page, { t: 'pitch' }); await page.waitForTimeout(200);
  assert.equal(await boardText(page), normalBoard, 'clearing the pitch restores the shared board');
  assert.equal(await boardText(other), normalBoard, 'other account stays unchanged');
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/results.json`, JSON.stringify({ state, errors, checks: 'owner stations, walk-in dimming, four E reviews, close, owner-account verdict echo/stamp, slides, non-owner, lite, owner ready/building board, normal second-account board, cleared-board restoration, building restoration' }, null, 2));
  console.log(`Pitch UI passed; screenshots in ${out}`);
} finally { await browser.close(); await server.close(); }
