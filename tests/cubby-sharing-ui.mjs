// Sharing a cubby (cubbies step 4) in a real browser: the actual main.ts and lite.ts, on the fixture
// pattern of tests/cubby-ui.mjs. Knocking at a frosted door, the owner's prompt, the watcher inside with
// the read-only chat, the owner's watcher list, Send a task to the floor and its toast, then the phone's
// My cubby and its floor list with a draft. Synthetic accounts and agents only: no providers, no live
// office, no real tokens. Screenshots at 1440×1000 and 390×844 go to OFFICE_SHARING_OUTPUT.
//
//   node tests/cubby-sharing-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = realpathSync(process.env.OFFICE_SHARING_ROOT ?? process.cwd());
const out = process.env.OFFICE_SHARING_OUTPUT ?? `${root}/.paradev/shots-sharing`;
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: '/tmp/agent-office-sharing-vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
const sent = [];
let socket = null;
page.on('pageerror', (e) => errors.push(e.message));

const look = { skin: 2, hair: 4, style: 1 };
const agents = [
  { id: 'lead', tool: 'Claude', role: 'lead', task: 'Lead', branch: 'main', status: 'working' },
  { id: 'b1', tool: 'Codex', role: 'builder', task: 'Fix checkout', branch: 'fix/checkout', status: 'working', progress: 'tests 41/41' },
  { id: 'b2', tool: 'Claude', role: 'builder', task: 'Cart screen polish', branch: 'feat/cart', status: 'needs-you' },
  { id: 'rv', tool: 'Kimi', role: 'reviewer', task: 'Review PR 512', branch: 'review/512', status: 'idle' },
  { id: 'dr', tool: 'Codex', role: 'direct', task: 'PRIVATE-DIRECT-PROMPT', branch: 'spike/search', status: 'working' },
];
const chat = [
  { id: 'c1', role: 'user', text: 'What is next?', at: 1 },
  { id: 'c2', role: 'assistant', text: 'Checkout fix lands first, then the cart polish.', at: 2 },
];
let ownerFingerprint = '';
const mineInterior = () => ({ computerId: 'fixture-computer', ownerFingerprint, computerName: 'Mac mini', leadName: 'Nova', look, agents, plan: ['Fix checkout bug', 'Cart screen polish', 'Review PR #512'], needsYou: ['Approve the new cart screen?', 'Merge PR #512 after review?'], chat, observedAt: 1 });
const alexInterior = { computerName: 'Alex’s MacBook', leadName: 'Atlas', look: { skin: 1, hair: 1, style: 2 }, agents: [agents[1], agents[3]], plan: ['Search results page'], needsYou: [], chat: [{ id: 'a1', role: 'user', text: 'Start on the search page', at: 1 }, { id: 'a2', role: 'assistant', text: 'On it: the builder has the branch.', at: 2 }], observedAt: 1 };
const state = ({ watching = false, watchers = [], knocking = [] } = {}) => ({
  enabled: true,
  floorId: 'fixture',
  setupAllowed: true,
  cubbies: [
    { id: 'cub-me', slot: 0, ownerName: 'Jordan Fixture', mine: true, lamp: 'working', working: 4, interior: mineInterior(), watchers, knocking },
    { id: 'cub-alex', slot: 1, ownerName: 'Alex Fixture', mine: false, lamp: 'working', working: 2, ...(watching ? { watching: true, interior: alexInterior } : {}) },
    { id: 'cub-sam', slot: 2, ownerName: 'Sam Fixture', mine: false, lamp: 'asleep', working: 0 },
  ],
});
const push = (m) => socket.send(JSON.stringify(m));
const shots = [];
/** Desktop then phone; `phone` puts the view right for the narrow one first. */
const shot = async (name, phone) => {
  for (const [width, height, suffix] of [[1440, 1000, 'desktop'], [390, 844, 'phone']]) {
    if (suffix === 'phone' && phone) await phone();
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
    shots.push(`${name}-${suffix}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};
const hintText = () => page.locator('#hint').innerText();
const its = (kind, slot) => `window.__audit.ctx.usables.lists().flat().find((it) => it.kind === '${kind}'${slot === undefined ? '' : ` && it.slot === ${slot}`})`;

try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jordan Fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first', notify: false }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
  });
  await context.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await context.route('**/api/whoami', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'acct-jordan', name: 'Jordan Fixture', role: 'member' } } }) }));
  await page.route('**/main.ts*', async (r) => {
    const response = await r.fetch();
    const body = (await response.text()) + "\nwindow.__audit = { ctx, core, parts, cubbies: parts.cubbies };\n";
    await r.fulfill({ response, body });
  });
  await context.routeWebSocket(/\/ws(?:\?|$)/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => sent.push(JSON.parse(String(raw))));
  });
  await page.goto(`${origin}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  ownerFingerprint = await page.evaluate(async () => (await (await import('/shared/cubby/keys.ts')).ownerDeviceKey('Jordan Fixture')).fingerprint);
  await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'fixture'; s.you = 'fixture-self';
    s.project = { name: 'Plimbo', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    for (const e of ['project', 'floor']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
  });
  const stand = (x, z, yaw, pitch = -0.05) =>
    page.evaluate(([x, z, yaw, pitch]) => {
      const o = window.__office;
      o.player.view = 'first'; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
    }, [x, z, yaw, pitch]);
  const place = (slot) => page.evaluate((slot) => { const p = window.__audit.cubbies.rooms().get(slot).place; return { x: p.x, z: p.z, depth: p.depth, width: p.width, rotY: p.rotY }; }, slot);
  /** In the hall, facing a cubby's door from `back` m out in the corridor. */
  /** In the corridor `back` m out from a cubby's front and `along` m down it, looking at the glass beside its door. */
  const atDoor = async (slot, back = 0.7, pitch = 0.16, along = 1.9) => {
    const p = await place(slot);
    const c = Math.cos(p.rotY), sn = Math.sin(p.rotY);
    const floor = (lx, lz) => ({ x: p.x + lx * c + lz * sn, z: p.z - lx * sn + lz * c });
    const me = floor(along, p.depth / 2 + back), aim = floor(0.9, p.depth / 2);
    await stand(me.x, me.z, Math.atan2(-(aim.x - me.x), -(aim.z - me.z)), pitch);
  };
  const captureMouse = async () => {
    await page.mouse.click(700, 500);
    await page.waitForFunction(() => window.__office.player.hasMouse);
  };

  push({ t: 'cubbies', state: state() });
  await page.waitForTimeout(500);
  await captureMouse();
  assert.equal(await page.evaluate(() => window.__audit.cubbies.rooms().get(1).interior), null, 'no inside before you’re let in');

  // ---- 1. Knocking at Alex's frosted door. ----
  await atDoor(1);
  await page.waitForTimeout(400);
  // First person picks what you look at: the frosted front is the door.
  assert.equal(await page.evaluate(() => window.__audit.parts.pointer.target()?.kind), 'cubbydoor');
  assert.match(await hintText(), /🔒 Alex Fixture[\s\S]*2 working[\s\S]*E[\s\S]*Knock/);
  await shot('01-knock-hint');
  await page.evaluate(`window.__audit.ctx.interactions.use(${its('cubbydoor', 1)}, 'E', null)`);
  await page.waitForTimeout(200);
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.knock'), [{ t: 'cubbies.knock', id: 'cub-alex' }]);
  assert.match(await hintText(), /Knocked, waiting for Alex Fixture…/);
  // A second E while it waits doesn't knock again.
  await page.evaluate(`window.__audit.ctx.interactions.use(${its('cubbydoor', 1)}, 'E', null)`);
  assert.equal(sent.filter((m) => m.t === 'cubbies.knock').length, 1);
  await shot('02-knock-waiting');

  // ---- 2. Alex lets you in: the toast, the door opens, the inside as Alex sees it. ----
  push({ t: 'cubbies', state: state({ watching: true }) });
  push({ t: 'cubbies.answer', id: 'cub-alex', allow: true });
  await page.waitForSelector('.toast:has-text("Alex Fixture let you in")');
  const inAlex = await page.evaluate(() => ({ interior: !!window.__audit.cubbies.rooms().get(1).interior, kinds: [...new Set(window.__audit.ctx.usables.lists().flat().filter((it) => it.slot === 1).map((it) => it.kind))].sort() }));
  assert.deepEqual(inAlex, { interior: true, kinds: ['cubbyagent', 'cubbycomputer', 'cubbydoor', 'cubbylead'] });
  // Just inside the door, looking in toward the lead.
  const pa = await place(1);
  const lookAtLead = async (p, slot, out = 0.45, pitch = -0.2) => {
    const lead = await page.evaluate(`(() => { const l = ${its('cubbylead', slot)}; return { x: l.x, z: l.z }; })()`);
    const c = Math.cos(p.rotY), sn = Math.sin(p.rotY), lx = 0.1, lz = p.depth / 2 + out;
    const me = { x: p.x + lx * c + lz * sn, z: p.z - lx * sn + lz * c };
    await stand(me.x, me.z, Math.atan2(-(lead.x - me.x), -(lead.z - me.z)), pitch);
  };
  await lookAtLead(pa, 1);
  await page.waitForTimeout(500);
  const doorHint = await page.evaluate(`(() => { const a = window.__audit; return a.ctx.interactions.hint(${its('cubbydoor', 1)}).parts.map((p) => typeof p === 'string' ? p : p.textContent).join(' '); })()`);
  assert.match(doorHint, /👀 Watching Alex Fixture's cubby.*E.*Leave/);
  const leadHint = await page.evaluate(`(() => { const a = window.__audit; return a.ctx.interactions.hint(${its('cubbylead', 1)}).parts.map((p) => typeof p === 'string' ? p : p.textContent).join(' '); })()`);
  assert.doesNotMatch(leadHint, /Talk to|Send a task/);
  assert.equal(await page.evaluate(() => window.__audit.parts.pointer.target()?.kind), 'cubbylead');
  assert.match(await hintText(), /Atlas[\s\S]*Watching Alex Fixture's cubby[\s\S]*Listen in/);
  await page.evaluate(() => document.getElementById('toasts').replaceChildren());
  await shot('03-watcher-inside');
  // From inside, looking out at the glass beside the door: Watching · E Leave.
  {
    const lx = 1.3, lz = pa.depth / 2 - 0.9, c = Math.cos(pa.rotY), sn = Math.sin(pa.rotY);
    await stand(pa.x + lx * c + lz * sn, pa.z - lx * sn + lz * c, pa.rotY + Math.PI + 0.25, 0.05);
  }
  await page.waitForTimeout(300);
  assert.match(await hintText(), /👀 Watching Alex Fixture's cubby[\s\S]*Leave/);
  await shot('04-watcher-leave-hint');

  // The lead chat, read-only.
  await page.evaluate(`window.__audit.ctx.interactions.use(${its('cubbylead', 1)}, 'E', null)`);
  await page.waitForSelector('.cubby-chat.watching');
  const ro = await page.locator('.cubby-chat').innerText();
  assert.match(ro, /Watching: only Alex Fixture can talk to Atlas/);
  assert.match(ro, /On it: the builder has the branch\./);
  assert.equal(await page.locator('.cubby-chat textarea').isVisible(), false, 'no box to type in');
  assert.equal(await page.locator('.cubby-chat button[type="submit"]').isVisible(), false, 'no send');
  assert.equal(await page.locator('.cubby-chat .btn.close').count(), 1);
  await shot('05-watcher-read-only-chat');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0);

  // E at the door leaves; once the office says so, you're put back out in the hall.
  await page.evaluate(`window.__audit.ctx.interactions.use(${its('cubbydoor', 1)}, 'E', null)`);
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.leave'), [{ t: 'cubbies.leave', id: 'cub-alex' }]);
  await stand(pa.x, pa.z, 0);
  push({ t: 'cubbies', state: state() });
  await page.waitForTimeout(300);
  const outside = await page.evaluate(([px, pz, w, d, r]) => {
    const p = window.__office.player.pos, dx = p.x - px, dz = p.z - pz;
    return { lz: dx * Math.sin(r) + dz * Math.cos(r), d, interior: window.__audit.cubbies.rooms().get(1).interior };
  }, [pa.x, pa.z, pa.width, pa.depth, pa.rotY]);
  assert.ok(outside.lz > outside.d / 2, `put outside the door (${JSON.stringify(outside)})`);
  assert.equal(outside.interior, null);

  // ---- 3. Someone knocks on yours: the prompt, wherever you are. ----
  await stand(-10, 2, Math.PI / 2);
  await captureMouse();
  push({ t: 'cubbies', state: state({ knocking: [{ accountId: 'acct-sam', name: 'Sam Fixture' }] }) });
  push({ t: 'cubbies.knocked', id: 'cub-me', by: { accountId: 'acct-sam', name: 'Sam Fixture' } });
  await page.waitForSelector('.cubby-knock');
  assert.match(await page.locator('.cubby-knock').innerText(), /Sam Fixture knocked on your cubby: let them watch and listen\?[\s\S]*Not now[\s\S]*Let in/);
  assert.equal(await page.locator('.cubby-knock .btn.close').count(), 1, 'its ✕');
  await shot('06-owner-admit-prompt');
  // Esc is Not now, straight back to mouse-look.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.admit').at(-1), { t: 'cubbies.admit', id: 'cub-me', accountId: 'acct-sam', allow: false });
  // ✕ is Not now too.
  push({ t: 'cubbies.knocked', id: 'cub-me', by: { accountId: 'acct-sam', name: 'Sam Fixture' } });
  await page.waitForSelector('.cubby-knock');
  await page.locator('.cubby-knock .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  assert.equal(sent.filter((m) => m.t === 'cubbies.admit' && !m.allow).length, 2);
  // Let in.
  push({ t: 'cubbies.knocked', id: 'cub-me', by: { accountId: 'acct-alex', name: 'Alex Fixture' } });
  await page.waitForSelector('.cubby-knock');
  await page.locator('.cubby-knock .btn.primary').click();
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.admit').at(-1), { t: 'cubbies.admit', id: 'cub-me', accountId: 'acct-alex', allow: true });
  // Answered in another tab: the prompt goes by itself.
  push({ t: 'cubbies', state: state({ knocking: [{ accountId: 'acct-sam', name: 'Sam Fixture' }] }) });
  push({ t: 'cubbies.knocked', id: 'cub-me', by: { accountId: 'acct-sam', name: 'Sam Fixture' } });
  await page.waitForSelector('.cubby-knock');
  push({ t: 'cubbies', state: state({ knocking: [{ accountId: 'acct-sam', name: 'Sam Fixture' }] }) });
  push({ t: 'cubbies', state: state() });
  await page.waitForSelector('.cubby-knock', { state: 'detached' });

  // ---- 4. Your chat lists who's watching; ✕ sends them out. ----
  push({ t: 'cubbies', state: state({ watchers: [{ accountId: 'acct-alex', name: 'Alex Fixture' }, { accountId: 'acct-sam', name: 'Sam Fixture' }] }) });
  await page.waitForTimeout(200);
  await page.evaluate(`window.__audit.ctx.interactions.use(${its('cubbylead', 0)}, 'E', null)`);
  await page.waitForSelector('.cubby-chat .cb-watchers');
  assert.match(await page.locator('.cubby-chat .cb-side').innerText(), /WATCHING · 2[\s\S]*Alex Fixture[\s\S]*Sam Fixture/i);
  await page.waitForFunction(() => !document.querySelector('.cubby-chat textarea').disabled);
  await shot('07-owner-watcher-list');
  await page.locator('.cubby-chat .cb-out[aria-label="Send Sam Fixture out"]').click();
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.admit').at(-1), { t: 'cubbies.admit', id: 'cub-me', accountId: 'acct-sam', allow: false });
  await page.locator('.cubby-chat .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });

  // ---- 5. Send a task to the floor: Q, only inside your own cubby. ----
  await stand(-10, 2, Math.PI / 2);
  await page.keyboard.press('q');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.cubby-task').count(), 0, 'Q does nothing out on the floor');
  const pm = await place(0);
  await lookAtLead(pm, 0, -0.15);
  await page.waitForTimeout(500);
  assert.match(await hintText(), /Nova[\s\S]*Talk to Nova[\s\S]*Q[\s\S]*Send a task to the floor/);
  const ownLead = await page.evaluate(`(() => { const a = window.__audit; return a.ctx.interactions.hint(${its('cubbylead', 0)}).parts.map((p) => typeof p === 'string' ? p : p.textContent).join(' '); })()`);
  assert.match(ownLead, /Runs on your Mac mini.*E.*Talk to Nova.*Q.*Send a task to the floor/);
  await shot('08-own-cubby-q-hint');
  await page.keyboard.press('q');
  await page.waitForSelector('.cubby-task');
  assert.match(await page.locator('.cubby-task').innerText(), /Runs on the office server, in this floor's public Task queue\. Your computer's work stays put\./);
  assert.equal(await page.locator('.cubby-task .btn.close').count(), 1);
  assert.equal(await page.locator('.cubby-task input').getAttribute('maxlength'), '120');
  assert.equal(await page.locator('.cubby-task textarea').getAttribute('maxlength'), '4000');
  await page.fill('.cubby-task input', 'Export invoices as CSV');
  await page.fill('.cubby-task textarea', 'Add a CSV export to the invoices page, with a test. My Mac will be asleep tonight.');
  await shot('09-send-task-panel');
  await page.locator('.cubby-task button[type="submit"]').click();
  await page.waitForTimeout(100);
  assert.deepEqual(sent.filter((m) => m.t === 'cubbies.sendTask'), [{ t: 'cubbies.sendTask', id: 'cub-me', title: 'Export invoices as CSV', prompt: 'Add a CSV export to the invoices page, with a test. My Mac will be asleep tonight.' }]);
  push({ t: 'cubbies.taskSent', id: 'cub-me', title: 'Export invoices as CSV' });
  await page.waitForSelector('.cubby-task', { state: 'detached' });
  await page.waitForSelector('.toast:has-text("Export invoices as CSV")');
  await shot('10-task-sent-toast');
  // Esc closes the panel straight back to mouse-look (the click that captures the mouse aims at the ceiling).
  await page.evaluate(() => { const o = window.__office; o.player.lookPitch = 1.2; o.player.updateCamera(true); });
  await page.waitForTimeout(150);
  await captureMouse();
  await lookAtLead(pm, 0, -0.15);
  await page.keyboard.press('q');
  await page.waitForSelector('.cubby-task');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  assert.equal(sent.filter((m) => m.t === 'cubbies.sendTask').length, 1);

  // ---- 6. The phone: My cubby, and the floor list with a draft. ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/lite`);
  await page.waitForFunction(() => window.__lite?.net.up);
  await page.evaluate(() => {
    const s = window.__lite.store;
    s.floors = [
      { id: 'fixture', name: 'Plimbo', people: 2, waiting: 0 },
      { id: 'kindly', name: 'Kindly', people: 0, waiting: 0, draft: true },
      { id: 'ops', name: 'Ops', people: 1, waiting: 1 },
    ];
    s.floor = 'fixture';
    s.project = { name: 'Plimbo', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    for (const e of ['floors', 'floor', 'project']) s.emit(e);
  });
  push({ t: 'cubbies', state: state() });
  await page.waitForSelector('#btn-cubby:not(.hidden)');
  const options = await page.locator('#floor option').allInnerTexts();
  assert.ok(options.includes('🔒 Kindly · draft'), JSON.stringify(options));
  assert.match(await page.locator('#btn-cubby').innerText(), /My cubby\s*2/);
  await page.screenshot({ path: `${out}/11-lite-home-phone.png` });
  shots.push('11-lite-home-phone.png');
  // The floor list, open: a select can't be screenshotted open, so its options as a list.
  const floorList = await page.evaluate(() => [...document.querySelectorAll('#floor option')].map((o) => o.textContent));
  await page.evaluate((list) => {
    const ul = document.createElement('ul');
    ul.id = 'fixture-floor-list';
    ul.style.cssText = 'position:fixed;top:70px;left:12px;right:12px;z-index:99;list-style:none;margin:0;padding:6px;background:#fff;border:3px solid #2b2d42;border-radius:14px;font:800 17px/1.2 Nunito,sans-serif;box-shadow:0 4px 0 #2b2d42';
    for (const t of list) { const li = document.createElement('li'); li.textContent = t; li.style.cssText = 'padding:12px 10px;border-bottom:2px solid #eee'; ul.append(li); }
    document.body.append(ul);
  }, floorList);
  await page.screenshot({ path: `${out}/12-lite-floor-list-draft-phone.png` });
  shots.push('12-lite-floor-list-draft-phone.png');
  await page.evaluate(() => document.getElementById('fixture-floor-list').remove());
  await page.locator('#btn-cubby').click();
  await page.waitForSelector('.cubby-chat');
  await page.waitForFunction(() => !document.querySelector('.cubby-chat textarea').disabled);
  await page.waitForTimeout(500);
  const liteChat = await page.locator('.cubby-chat').innerText();
  assert.match(liteChat, /Nova[\s\S]*Checkout fix lands first/);
  assert.match(liteChat, /NEEDS YOU[\s\S]*Approve the new cart screen\?/i);
  assert.match(liteChat, /HELPERS · 4[\s\S]*Codex · Builder[\s\S]*working[\s\S]*Fix checkout/i);
  assert.doesNotMatch(liteChat, /PRIVATE-DIRECT/);
  await page.screenshot({ path: `${out}/13-lite-my-cubby-phone.png` });
  shots.push('13-lite-my-cubby-phone.png');
  await page.locator('.cubby-chat .cb-side').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/14-lite-my-cubby-helpers-phone.png` });
  shots.push('14-lite-my-cubby-helpers-phone.png');
  await page.fill('.cubby-chat textarea', 'From my phone: ship it');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const fromPhone = sent.filter((m) => m.t === 'cubbies.chat').at(-1);
  assert.equal(fromPhone?.text, 'From my phone: ship it');
  assert.match(fromPhone.ownerSig, /^[A-Za-z0-9_-]{86}$/);
  await page.locator('.cubby-chat .btn.close').click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // Watching from the phone: read-only.
  push({ t: 'cubbies', state: { ...state({ watching: true }), cubbies: state({ watching: true }).cubbies.filter((c) => !c.mine) } });
  await page.waitForFunction(() => /Alex's cubby/.test(document.getElementById('btn-cubby').textContent));
  await page.locator('#btn-cubby').click();
  await page.waitForSelector('.cubby-chat.watching');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.cubby-chat textarea').isVisible(), false);
  assert.match(await page.locator('.cubby-chat').innerText(), /Watching: only Alex Fixture can talk to Atlas/);
  await page.screenshot({ path: `${out}/15-lite-watching-phone.png` });
  shots.push('15-lite-watching-phone.png');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.screenshot({ path: `${out}/16-lite-watching-button-phone.png` });
  shots.push('16-lite-watching-button-phone.png');

  assert.deepEqual(errors, []);
  const report = { out, shots, sentTypes: [...new Set(sent.map((m) => m.t))], errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
