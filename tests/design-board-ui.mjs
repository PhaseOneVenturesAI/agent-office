// The design board (cubbies step 5) in a real browser: the actual main.ts and lite.ts, with a draft's
// Ideas and Screens cards served through the client's own message path (a routed WebSocket) and their
// images through page.route from small PNGs made here. No server. Checks the image is drawn on the
// wall's card, E on a card opens it, feedback is signed with this browser's owner key (verified here
// with ownerFeedbackEncoding's bytes), the note shows once the boards carry it, ✕ and Esc go straight
// back to mouse-look, and the phone's Draft board opens the same card. Screenshots at 1440×1000 and
// 390×844 go to OFFICE_BOARD_OUTPUT (default .paradev/shots-board).
//
//   node tests/design-board-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

const root = realpathSync(process.env.OFFICE_BOARD_ROOT ?? process.cwd());
const out = process.env.OFFICE_BOARD_OUTPUT ?? `${root}/.paradev/shots-board`;
mkdirSync(out, { recursive: true });

// ---- Small PNGs: a phone-ish screen mockup in a few flat colors. ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
/** `paint(x, y)` gives each pixel's #rrggbb. */
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(hex(paint(x, y)), y * (w * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A screen: a bar across the top, a big colored block in the middle (what the wall's thumbnail centers on), rows below. */
const mock = (w, h, bar, block, bg = '#fdfcf8') => png(w, h, (x, y) => {
  if (y < h * 0.12) return bar;
  if (y > h * 0.3 && y < h * 0.7 && x > w * 0.12 && x < w * 0.88) return block;
  if (y > h * 0.76 && (y % 40) < 18 && x > w * 0.12 && x < w * (0.5 + ((y / 40) % 3) * 0.12)) return '#c9cbd6';
  return bg;
});
const images = {
  home: mock(480, 360, '#2b2d42', '#ef476f'),
  calendar: mock(480, 360, '#118ab2', '#ffd166'),
  family: mock(360, 480, '#06d6a0', '#118ab2'),
  idea: mock(400, 300, '#ef476f', '#06d6a0', '#fff3bf'),
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const byHash = new Map(Object.values(images).map((b) => [sha(b), b]));
const meta = (b, w, h) => ({ hash: sha(b), mime: 'image/png', width: w, height: h });
const MISSING = 'f'.repeat(64);
const requested = [];

const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: '/tmp/agent-office-board-ui/.vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
const sent = [];
let socket = null;
page.on('pageerror', (e) => errors.push(e.message));

let fingerprint = '';
let publicKey = '';
const look = { skin: 2, hair: 4, style: 1 };
const interior = (lamp = 'working') => ({ computerId: 'fixture-computer', computerName: 'Mac mini', leadName: 'Nova', look, ownerDevices: [{ fingerprint, label: 'Mac', addedAt: 1 }], deviceRequests: [], agents: [{ id: 'lead', tool: 'Claude', role: 'lead', task: 'Lead', branch: 'main', status: 'working' }], plan: [], needsYou: [], chat: [], observedAt: 1, lamp });
const cubbies = (lamp = 'working', it = interior(lamp)) => ({ enabled: true, floorId: 'draft-1', setupAllowed: true, cubbies: [{ id: 'cub-me', slot: 0, ownerName: 'Jordan Fixture', mine: true, lamp, working: 1, interior: it }] });
const t0 = Date.now() - 3 * 60 * 60_000;
const boards = (extra = {}) => ({
  ideas: [
    { id: 'idea-calendar', title: 'One shared family calendar', note: 'Everyone sees the same week, on any phone.', image: meta(images.idea, 400, 300), feedback: [{ id: 'fb-a', text: 'Yes, this is the heart of it.', at: t0 }] },
    { id: 'idea-chats', title: 'Fewer group chats', note: 'Plans live in one place instead of six threads.', feedback: [] },
    { id: 'idea-kids', title: 'Kids can add their own events', note: 'Parents approve before it shows to everyone.', feedback: [] },
  ],
  decisions: ['Audience: busy parents', 'Problem: too many group chats', 'One shared family calendar', 'Must work on a phone first', 'Needs you: free or paid?'],
  plan: ['Approve the brand direction', 'Draw the five core screens', 'Turn the screens into a spec', 'Kick off and build'],
  screens: [
    { id: 'scr-home', title: 'Home', status: 'approved', note: 'Today first, then the week.', image: meta(images.home, 480, 360), feedback: [] },
    { id: 'scr-calendar', title: 'Calendar', status: 'review', image: meta(images.calendar, 480, 360), feedback: [{ id: 'fb-b', text: 'Make the week start on Monday.', at: t0 + 60_000 }, { id: 'fb-c', text: 'Colors per person, please.', at: t0 + 120_000 }] },
    { id: 'scr-add', title: 'Add event', status: 'sketch', image: { hash: MISSING, mime: 'image/png', width: 480, height: 360 }, feedback: [] },
    { id: 'scr-family', title: 'Family', status: 'sketch', image: meta(images.family, 360, 480), feedback: [] },
  ],
  brand: { name: 'Kindly', tagline: 'Your family’s week, in one calm place', colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#2b2d42'] },
  ...extra,
});
const here = (b = boards(), extra = {}) => ({ id: 'draft-1', name: 'Kindly', createdAt: 1, cubbyId: 'cub-me', leadName: 'Nova', online: true, boards: b, designers: 1, ...extra });
const drafts = (h) => ({ enabled: true, canStart: true, ...(h ? { here: h } : {}) });
const push = (m) => socket.send(JSON.stringify(m));
const verifySig = (m) => verify('sha256',
  Buffer.from(JSON.stringify(['agent-office/cubby-owner-feedback/v1', 'cub-me', 'draft-1', 'fixture-computer', m.requestId, m.at, m.cardId, m.text])),
  { key: createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(m.ownerSig, 'base64url'));

const shot = async (name, sizes = [[1440, 1000, 'desktop'], [390, 844, 'phone']]) => {
  for (const [width, height, suffix] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

try {
  await context.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jordan Fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
  });
  await context.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await context.route('**/api/whoami', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'acct-jordan', name: 'Jordan Fixture', role: 'member' } } }) }));
  await context.route('**/api/drafts/*/images/*', (r) => {
    const url = new URL(r.request().url());
    const hash = url.pathname.split('/').pop();
    requested.push(url.pathname);
    const body = byHash.get(hash);
    if (!body || !url.pathname.startsWith('/api/drafts/draft-1/')) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' });
    return r.fulfill({ status: 200, contentType: 'image/png', body });
  });
  await page.route('**/main.ts*', async (r) => {
    const response = await r.fetch();
    const body = (await response.text()) + '\nwindow.__audit = { ctx, core, parts };\n';
    await r.fulfill({ response, body });
  });
  await context.routeWebSocket(/\/ws(?:\?|$)/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => sent.push(JSON.parse(String(raw))));
  });
  await page.goto(`${origin}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  ({ fingerprint, publicKey } = await page.evaluate(async () => {
    const { ownerDeviceKey } = await import('/shared/cubby/keys.ts');
    const k = await ownerDeviceKey('Jordan Fixture');
    return { fingerprint: k.fingerprint, publicKey: k.publicKey };
  }));
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'draft-1'; s.you = 'fixture-self';
    s.project = { name: 'Kindly', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    s.floors = [{ id: 'draft-1', name: 'Kindly', dir: '/fixture/kindly', workers: 0, people: 1, busy: 0, waiting: 0, palette: 1, draft: true }];
    for (const e of ['project', 'floor', 'floors']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
  });
  const stand = (x, z, yaw, pitch = -0.05) =>
    page.evaluate(([x, z, yaw, pitch]) => {
      const o = window.__office;
      o.player.view = 'first'; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
    }, [x, z, yaw, pitch]);
  /** Stands `back` meters in front of a card's patch and aims the crosshair at its middle. */
  const aimAt = async (name, back = 4) => {
    const p = await page.evaluate((name) => {
      const m = window.__office.scene.getObjectByName(name);
      const v = m.getWorldPosition(m.position.clone());
      const n = m.getWorldDirection(m.position.clone());
      return { x: v.x, y: v.y, z: v.z, nx: n.x, nz: n.z };
    }, name);
    const x = p.x + p.nx * back, z = p.z + p.nz * back;
    await stand(x, z, Math.atan2(-(p.x - x), -(p.z - z)), Math.atan2(p.y - 1.4, back));
    await page.waitForTimeout(250);
  };

  push({ t: 'cubbies', state: cubbies() });
  push({ t: 'drafts', state: drafts(here()) });
  await page.waitForFunction(() => window.__office.scene.getObjectByName('drafts')?.visible);
  // Images in (the missing one falls back to its text card).
  for (let i = 0; i < 50 && requested.length < 5; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(400);
  assert.equal(requested.length, 5, 'four images and the missing one asked for');
  assert.ok(requested.every((p) => p.startsWith('/api/drafts/draft-1/images/')), JSON.stringify(requested));
  assert.equal(new Set(requested).size, requested.length, 'each image fetched once');

  // ---- The wall: the image drawn on the Screens board's first card. ----
  const pixel = await page.evaluate(() => {
    const o = window.__office;
    const faces = [];
    o.scene.getObjectByName('drafts').traverse((m) => { if (m.name === 'draft-board') faces.push(m); });
    const at = (m) => m.getWorldPosition(m.position.clone());
    const screens = faces.find((m) => Math.abs(at(m).x - 3.9) < 0.1 && at(m).z < -12);
    const ideas = faces.find((m) => at(m).x > 17);
    const read = (m, x, y) => [...m.material.map.image.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)];
    // First card's thumbnail middle: x 40 + (461-32)/2 + 16, y 160 + 16 + 0.6*405/2.
    const cw = (1536 - 80 - 72) / 3, ch = (1056 - 160 - 50 - 36) / 2;
    const mid = (i) => [Math.round(40 + (i % 3) * (cw + 36) + cw / 2), Math.round(160 + Math.floor(i / 3) * (ch + 36) + 16 + (ch * 0.6) / 2)];
    return { home: read(screens, ...mid(0)), calendar: read(screens, ...mid(1)), add: read(screens, mid(2)[0] - 150, mid(2)[1]), idea: read(ideas, ...mid(0)), ideaText: read(ideas, Math.round(40 + cw + 36 + 30), Math.round(160 + ch - 20)) };
  });
  const near = (rgb, want, tol = 40) => rgb.every((v, i) => Math.abs(v - hex(want)[i]) <= tol);
  assert.ok(near(pixel.home, '#ef476f'), `Home's image on its card (${pixel.home})`);
  assert.ok(near(pixel.calendar, '#ffd166'), `Calendar's image on its card (${pixel.calendar})`);
  assert.ok(near(pixel.add, '#e9ecef', 12), `a missing image leaves its placeholder (${pixel.add})`);
  assert.ok(near(pixel.idea, '#06d6a0'), `the idea's image on its card (${pixel.idea})`);
  assert.ok(near(pixel.ideaText, '#fde7a1', 12), `an idea without one is a sticky note (${pixel.ideaText})`);
  await stand(3.9, -3.2, 0, 0.22);
  await shot('01-wall-screens');
  await stand(8.5, -5.5, -Math.PI / 2 + 0.05, 0.18);
  await shot('02-wall-ideas-brand');

  // ---- E on a card: the hint, then the card window. ----
  await aimAt('draft-card-screens-1', 4.2);
  const hint = await page.evaluate(() => document.body.innerText.match(/E\s*Open Calendar/)?.[0] ?? '');
  assert.match(hint, /E\s*Open Calendar/, 'aiming at the card says [E] Open Calendar');
  await shot('03-aim-card', [[1440, 1000, 'desktop']]);
  await page.mouse.click(720, 500);
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.draft-card');
  const card = await page.locator('.draft-card').innerText();
  assert.match(card, /Calendar[\s\S]*review/);
  assert.match(card, /Make the week start on Monday\.[\s\S]*Colors per person, please\./, 'feedback, newest last');
  assert.equal(await page.locator('.draft-card canvas.dc-image').count(), 1, 'the image, big');
  assert.equal(await page.locator('.draft-card header .btn.close').count(), 1, 'its ✕ top right');
  await page.waitForFunction(() => !document.querySelector('.draft-card textarea').disabled && document.querySelector('.draft-card .dc-send').style.display !== 'none');
  // Keys while typing stay in the box.
  const posBefore = await page.evaluate(() => window.__office.player.pos.z);
  await page.locator('.draft-card textarea').focus();
  await page.keyboard.type('Could the week view');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('show the weekend smaller?');
  assert.equal(await page.evaluate(() => window.__office.player.pos.z), posBefore, 'typing W/S does not walk');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.draft-card .dc-fb.pending'));
  const fb = sent.filter((m) => m.t === 'drafts.feedback');
  assert.equal(fb.length, 1);
  assert.deepEqual([fb[0].floorId, fb[0].cardId, fb[0].text], ['draft-1', 'scr-calendar', 'Could the week view\nshow the weekend smaller?']);
  assert.equal(verifySig(fb[0]), true, 'signed with this device’s owner key over ownerFeedbackEncoding');
  assert.match(await page.locator('.draft-card .dc-fb.pending').innerText(), /Sending…/);
  // The computer reports it: it shows once, no longer pending.
  const withNote = boards();
  withNote.screens[1].feedback.push({ id: fb[0].requestId, text: fb[0].text, at: fb[0].at });
  push({ t: 'drafts', state: drafts(here(withNote)) });
  await page.waitForFunction(() => !document.querySelector('.draft-card .dc-fb.pending'));
  assert.equal(await page.locator('.draft-card .dc-fb', { hasText: 'show the weekend smaller?' }).count(), 1);
  assert.match(await page.locator('.draft-card .dc-log').innerText(), /Colors per person[\s\S]*show the weekend smaller\?\s*\S+ [AP]M$/);
  await shot('04-card-feedback');
  // Esc: straight back to mouse-look.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0);
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  // ✕ too.
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.draft-card');
  await page.locator('.draft-card .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  // Still aiming at it: the hint counts the new note.
  await page.waitForTimeout(150);
  assert.match(await page.evaluate(() => document.body.innerText), /💬 3[\s\S]*Open Calendar/);

  // ---- Asleep, then an untrusted device: nothing sent, and it says why. ----
  push({ t: 'cubbies', state: cubbies('asleep') });
  await aimAt('draft-card-ideas-1', 4);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.modal.draft-card');
  assert.match(await page.locator('.draft-card').innerText(), /Fewer group chats[\s\S]*Mac mini is asleep/);
  assert.equal(await page.locator('.draft-card .dc-textcard').count(), 1, 'an idea with no image is its words');
  const n = sent.filter((m) => m.t === 'drafts.feedback').length;
  await page.locator('.draft-card form').evaluate((f) => { f.querySelector('textarea').value = 'must not send'; f.requestSubmit(); });
  await page.waitForTimeout(100);
  push({ t: 'cubbies', state: cubbies('working', { ...interior(), ownerDevices: [{ fingerprint: '0'.repeat(32), label: 'Mac', addedAt: 1 }] }) });
  await page.waitForTimeout(100);
  assert.match(await page.locator('.draft-card').innerText(), /can't leave feedback yet[\s\S]*Add this device/);
  assert.equal(await page.locator('.draft-card .dc-chat').isVisible(), true);
  await page.locator('.draft-card form').evaluate((f) => { f.querySelector('textarea').value = 'must not send'; f.requestSubmit(); });
  await page.waitForTimeout(100);
  assert.equal(sent.filter((m) => m.t === 'drafts.feedback').length, n, 'nothing sent asleep or untrusted');
  await shot('05-card-untrusted');
  await page.locator('.draft-card .dc-chat').click();
  await page.waitForSelector('.cubby-chat');
  assert.match(await page.locator('.cubby-chat').innerText(), /Add this device/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0);
  push({ t: 'cubbies', state: cubbies() });

  // ---- The phone: Draft board, then a card. ----
  const phone = await context.newPage();
  phone.on('pageerror', (e) => errors.push(`lite: ${e.message}`));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${origin}/lite`);
  await phone.waitForFunction(() => window.__lite?.net.up);
  await phone.evaluate(() => { const s = window.__lite.store; s.floor = 'draft-1'; s.emit('floor'); });
  push({ t: 'cubbies', state: cubbies() });
  push({ t: 'drafts', state: drafts(here(withNote)) });
  await phone.waitForSelector('#btn-board:not(.hidden)');
  await phone.locator('#btn-board').click();
  await phone.waitForSelector('.modal.draft-board');
  await phone.waitForFunction(() => document.querySelectorAll('.draft-board canvas.dl-thumb').length >= 4);
  const list = await phone.locator('.draft-board').innerText();
  assert.match(list, /IDEAS · 3[\s\S]*One shared family calendar[\s\S]*SCREENS · 4[\s\S]*Home[\s\S]*Calendar[\s\S]*💬 3/i);
  await phone.waitForTimeout(500);
  assert.equal(await phone.locator('.draft-board').evaluate((m) => [...m.querySelectorAll('.dl-card')].every((b) => b.getBoundingClientRect().right <= m.getBoundingClientRect().right + 1)), true, 'every row fits the window');
  await phone.screenshot({ path: `${out}/06-phone-board-phone.png` });
  await phone.locator('.dl-card', { hasText: 'Home' }).click();
  await phone.waitForSelector('.modal.draft-card');
  await phone.waitForFunction(() => !document.querySelector('.draft-card textarea').disabled && document.querySelector('.draft-card .dc-send').style.display !== 'none');
  await phone.fill('.draft-card textarea', 'Love the today-first layout.');
  await phone.locator('.draft-card button[type="submit"]').click();
  await phone.waitForFunction(() => document.querySelector('.draft-card .dc-fb.pending'));
  const fromPhone = sent.filter((m) => m.t === 'drafts.feedback').at(-1);
  assert.deepEqual([fromPhone.cardId, fromPhone.text], ['scr-home', 'Love the today-first layout.']);
  assert.equal(verifySig(fromPhone), true, 'the phone signs it the same way');
  const withPhone = structuredClone(withNote);
  withPhone.screens[0].feedback.push({ id: 'computer-id-1', text: fromPhone.text, at: fromPhone.at });
  push({ t: 'drafts', state: drafts(here(withPhone)) });
  await phone.waitForFunction(() => !document.querySelector('.draft-card .dc-fb.pending'));
  assert.match(await phone.locator('.draft-card .dc-log').innerText(), /Love the today-first layout\./);
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${out}/07-phone-card-phone.png` });
  await phone.locator('.draft-card .btn.close').click();
  assert.equal(await phone.locator('.modal.draft-card').count(), 0);
  await phone.keyboard.press('Escape');
  assert.equal(await phone.locator('.modal').count(), 0);
  // Off the draft: no Draft board button.
  push({ t: 'drafts', state: drafts(null) });
  await phone.waitForSelector('#btn-board.hidden', { state: 'attached' });

  // Never anywhere but the owner's own page: the image URL and bytes never go over the socket.
  assert.equal(JSON.stringify(sent).includes('/api/drafts/'), false);
  assert.deepEqual(errors, []);
  const report = { out, pixel, requested, sentTypes: [...new Set(sent.map((m) => m.t))], errors, browser: browser.version() };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
