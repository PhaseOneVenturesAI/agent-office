// Kickoff (cubbies step 3) in a real browser: the actual main.ts, office, renderer and PlayerController,
// with fixtures served through the client's own message path (a routed WebSocket), no server, on the
// same pattern as tests/drafts-ui.mjs. Synthetic draft, cubby and helpers only. Whole-floor screenshots at
// desktop (1440×1000) and phone (390×844) go to OFFICE_KICKOFF_OUTPUT (default .paradev/shots-kickoff).
// The kickoff's clock (performance.now) is held still for the shots in the middle of it; frames go on.
//
//   node tests/kickoff-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = realpathSync(process.env.OFFICE_KICKOFF_ROOT ?? process.cwd());
const out = process.env.OFFICE_KICKOFF_OUTPUT ?? `${root}/.paradev/shots-kickoff`;
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: '/tmp/agent-office-kickoff-ui/.vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
const sent = [];
let socket = null;
page.on('pageerror', (e) => errors.push(e.message));

const look = { skin: 2, hair: 4, style: 1 };
const agents = [
  { id: 'lead', tool: 'Claude', role: 'lead', task: 'Lead', branch: 'main', status: 'working' },
  { id: 'd1', tool: 'Claude', role: 'builder', task: 'Checkout screens', branch: 'draft/screens', status: 'working', designer: true },
];
const myCubby = { id: 'cub-me', slot: 0, ownerName: 'Jordan Fixture', mine: true, lamp: 'working', working: 1, interior: { computerId: 'fixture-computer', computerName: 'Mac mini', leadName: 'Nova', look, agents, plan: ['Build the home screen'], needsYou: [], chat: [], observedAt: 1 } };
const boards = {
  decisions: ['Audience: busy parents', 'Problem: too many group chats', 'One shared family calendar', 'Must work on a phone first'],
  plan: ['Approve the brand direction', 'Draw the five core screens', 'Turn the screens into a spec', 'Kick off and build'],
  screens: [{ title: 'Home', status: 'approved' }, { title: 'Calendar', status: 'approved' }, { title: 'Add event', status: 'approved' }, { title: 'Family', status: 'review' }],
  brand: { name: 'Kindly', tagline: 'Your family’s week, in one calm place', colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#2b2d42'] },
};
const here = { id: 'draft-1', name: 'Kindly', createdAt: 1, cubbyId: 'cub-me', leadName: 'Nova', online: true, boards, designers: 1 };
const launched = { name: 'Kindly', at: 2, repo: 'PhaseOneVenturesAI/kindly', brand: boards.brand, screens: ['Home', 'Calendar', 'Add event'] };
const floors = (kicked) => [
  { id: 'office', name: 'agent-office', dir: '/fixture/agent-office', repo: 'PhaseOneVenturesAI/agent-office', workers: 3, people: 2, busy: 1, waiting: 0, palette: 0 },
  kicked
    ? { id: 'draft-1', name: 'Kindly', dir: '/fixture/kindly', repo: 'PhaseOneVenturesAI/kindly', workers: 0, people: 1, busy: 0, waiting: 0, palette: 1, isNew: true }
    : { id: 'draft-1', name: 'Kindly', dir: '/fixture/kindly', workers: 0, people: 1, busy: 0, waiting: 0, palette: 1, draft: true },
];
const push = (m) => socket.send(JSON.stringify(m));

/** Both sizes; `phone` turns you for the phone's narrower view first. */
const shot = async (name, phone) => {
  for (const [width, height, suffix] of [[1440, 1000, 'desktop'], [390, 844, 'phone']]) {
    if (suffix === 'phone' && phone) await phone();
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jordan Fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
    // A clock the test can hold still (the frame loop runs on requestAnimationFrame's own).
    const real = performance.now.bind(performance);
    let base = 0;
    let held = null;
    performance.now = () => (held ?? real() - base);
    window.__hold = () => { held = performance.now(); };
    window.__go = () => { if (held !== null) { base = real() - held; held = null; } };
  });
  await page.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'acct-jordan', name: 'Jordan Fixture', role: 'member' } } }) }));
  await page.route('**/main.ts*', async (r) => {
    const response = await r.fetch();
    const body = (await response.text()) + '\nwindow.__audit = { ctx, core, parts };\n';
    await r.fulfill({ response, body });
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => sent.push(JSON.parse(String(raw))));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);

  await page.evaluate((floors) => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'draft-1'; s.you = 'fixture-self';
    s.project = { name: 'Kindly', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    s.floors = floors;
    for (const e of ['project', 'floor', 'floors']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
  }, floors(false));
  /** You at (x, z), looking `yaw` (0 is north, π/2 west, π south) and `pitch` up, in first person. */
  const stand = (x, z, yaw, pitch = -0.05) =>
    page.evaluate(([x, z, yaw, pitch]) => {
      const o = window.__office;
      o.player.view = 'first'; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
    }, [x, z, yaw, pitch]);
  const toward = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));
  const hintText = () => page.evaluate(() => document.querySelector('#hint, .hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  const hintOf = (kind) => page.evaluate((kind) => {
    const a = window.__audit;
    const it = [...a.ctx.usables.lists().flat(), ...window.__office.office.interactables].find((x) => x.kind === kind && !x.off);
    return it ? a.ctx.interactions.hint(it).parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join(' ') : null;
  }, kind);
  const state = () => page.evaluate(() => {
    const a = window.__audit, o = window.__office;
    const d = o.scene.getObjectByName('drafts');
    const its = o.office.interactables;
    const loft = [];
    o.office.group.traverse((m) => { if (m.isMesh && m.material?.emissive && m.material.emissive.getHex() && m.getWorldPosition(new m.position.constructor()).x > 9 && m.getWorldPosition(new m.position.constructor()).z > 8) loft.push(m.material.emissive.getHex()); });
    return {
      shown: !!d?.visible,
      whiteboard: o.office.whiteboard.group.visible,
      offIds: its.filter((it) => it.off).map((it) => `${it.kind}:${it.deskId ?? it.seatId ?? ''}`).sort(),
      idle: a.parts.worlds.idleAgents().map((x) => x.model.root.visible),
      colliders: o.world().colliders.length,
      hemi: a.parts.stage.hemi.intensity,
      podsHidden: [...o.office.desks.values()].filter((v) => !v.def.beanbag && !v.def.station && !v.def.room && !v.def.wing && !v.group.visible).length,
      hall: o.office.cubbyHall.on,
      launched: o.scene.getObjectByName('launched')?.visible ?? null,
      loft,
    };
  });
  /** The designer at the uncovered pod: its sprites drawn (on layer 0) or not. */
  const designerTags = () => page.evaluate(() => {
    const o = window.__office;
    let shown = 0, all = 0;
    for (const v of o.office.desks.values()) for (const c of v.seatAnchor.children) c.traverse((s) => { if (s.isSprite) { all++; if (s.layers.isEnabled(0)) shown++; } });
    return { shown, all };
  });

  // ---- Before: the office's own floor, for comparing with after. ----
  push({ t: 'cubbies', state: { enabled: false, cubbies: [] } });
  push({ t: 'drafts', state: { enabled: true, canStart: true } });
  await page.waitForTimeout(600);
  const before = await state();
  assert.equal(before.shown, false);
  assert.equal(before.launched, false, 'no Design book or poster on a floor that was never kicked off');

  // ---- Your draft, with kickoff set up in this office. ----
  push({ t: 'drafts', state: { enabled: true, canStart: true, here, canKickoff: true } });
  await page.waitForTimeout(1800);
  const draft = await state();
  assert.equal(draft.shown, true);
  assert.ok(draft.hemi < before.hemi * 0.4);
  assert.equal(draft.hall, false, 'no hall before kickoff');
  assert.ok(draft.loft.length >= 3 && draft.loft.every((hex, i) => hex < before.loft[i]), `the loft's lamps are down too (${before.loft} → ${draft.loft})`);

  // A: the designer's tags only when you're right by it, in front of it.
  await stand(-4, 3.5, 0, 0.12);
  await page.waitForTimeout(300);
  const far = await designerTags();
  assert.ok(far.all > 0 && far.shown === 0, `no designer tags over the boards from across the room (${JSON.stringify(far)})`);
  await shot('01-draft-boards-no-helper-tags');
  const seat = await page.evaluate(() => { const v = window.__office.office.desks.get('desk-5'); const p = v.seatAnchor.getWorldPosition(v.seatAnchor.position.clone()); return { x: p.x, z: p.z }; });
  await stand(seat.x, seat.z - 0.9, Math.PI, -0.2);
  await page.waitForTimeout(300);
  const near = await designerTags();
  assert.ok(near.shown > 0, `the designer you stand by shows its tags (${JSON.stringify(near)})`);

  // No kickoff in this office: the hint says why.
  push({ t: 'drafts', state: { enabled: true, canStart: true, here } });
  await page.waitForTimeout(200);
  assert.match(await hintOf('studiotable'), /Studio table.*Talk to Nova.*Kickoff isn’t set up in this office/);
  push({ t: 'drafts', state: { enabled: true, canStart: true, here, canKickoff: true } });
  await page.waitForTimeout(200);
  assert.match(await hintOf('studiotable'), /Studio table.*E.*Talk to Nova.*K.*Kick off/);

  // ---- K at the studio table: the confirm panel. ----
  await stand(5.4, -2.2, 0, -0.22);
  await page.waitForTimeout(400);
  await page.mouse.click(700, 500);
  await page.waitForFunction(() => window.__office.player.hasMouse);
  assert.equal(await page.evaluate(() => window.__audit.parts.pointer.target()?.kind), 'studiotable');
  assert.match(await hintText(), /Kick off/);
  await shot('02-studio-table-hint');
  await page.keyboard.press('k');
  await page.waitForSelector('.modal.draft-kickoff');
  assert.equal(await page.locator('.draft-kickoff .btn.close').count(), 1, 'the panel has its ✕');
  const button = page.locator('.draft-kickoff button[type="submit"]');
  assert.equal(await button.isDisabled(), true, 'disabled until the name is typed');
  await page.fill('.draft-kickoff input', 'kindly');
  assert.equal(await button.isDisabled(), true, 'the name as it is');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0, 'Esc closes it');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  await page.keyboard.press('k');
  await page.waitForSelector('.modal.draft-kickoff');
  await page.locator('.draft-kickoff .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  assert.equal(sent.filter((m) => m.t === 'drafts.kickoff').length, 0, 'closing sends nothing');

  await page.keyboard.press('k');
  await page.waitForSelector('.modal.draft-kickoff');
  await page.fill('.draft-kickoff input', 'Kindly');
  assert.equal(await button.isDisabled(), false);
  await shot('03-confirm-panel');
  await button.click();
  await page.waitForTimeout(150);
  assert.deepEqual(sent.filter((m) => m.t === 'drafts.kickoff'), [{ t: 'drafts.kickoff', floorId: 'draft-1', confirm: 'Kindly' }]);
  assert.match(await page.locator('.draft-kickoff footer').innerText(), /Kicking off…/);
  assert.equal(await button.isDisabled(), true);
  await shot('04-kicking-off');
  push({ t: 'drafts.kickoffFailed', floorId: 'draft-1', error: 'GitHub said no: the team’s token can’t make repositories' });
  await page.waitForTimeout(150);
  assert.match(await page.locator('.draft-kickoff .ko-err').innerText(), /GitHub said no/);
  assert.equal(await button.isDisabled(), false, 'try again');
  await shot('05-kickoff-failed');
  await button.click();
  await page.waitForTimeout(100);
  assert.equal(sent.filter((m) => m.t === 'drafts.kickoff').length, 2);

  // ---- The kickoff moment. ----
  // Where you see the floor change: by the studio table, looking over the desks.
  const overView = [12.5, 7.5, toward(12.5, 7.5, -4, -4.5), -0.12];
  const overPhone = () => stand(12.5, 7.5, toward(12.5, 7.5, -3, 3.2), -0.12);
  await stand(...overView);
  push({ t: 'drafts.kicked', floorId: 'draft-1', name: 'Kindly', by: 'Jordan Fixture' });
  push({ t: 'drafts', state: { enabled: true, canStart: true, launched } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0, 'the panel closes as it kicks off');
  const at = () => page.evaluate(() => performance.now());
  const t0 = (await at()) - 100;
  const holdAt = async (ms) => {
    await page.waitForFunction((until) => performance.now() >= until, t0 + ms, { polling: 16 });
    await page.evaluate(() => window.__hold());
  };
  await holdAt(900);
  const early = await state();
  assert.equal(early.shown, true, 'the draft stays up while it changes');
  assert.ok(early.hemi > draft.hemi && early.hemi < before.hemi * 0.6, `the front rows coming on (${early.hemi})`);
  await shot('06-kickoff-first-row', overPhone);
  await page.evaluate(() => window.__go());
  await holdAt(1950);
  const mid = await state();
  assert.ok(mid.hemi > early.hemi && mid.hemi < before.hemi * 0.95, `about half on (${mid.hemi})`);
  await shot('07-kickoff-lights-half-covers-lifting', overPhone);
  await page.evaluate(() => window.__go());

  // The office opens the hall with your cubby set up.
  push({ t: 'cubbies', state: { enabled: true, floorId: 'draft-1', setupAllowed: true, cubbies: [myCubby] } });
  push({ t: 'floors', floors: floors(true) });
  await page.waitForFunction((until) => performance.now() >= until, t0 + 4200);
  const open = await state();
  assert.equal(open.whiteboard, true, 'the whiteboard is back');
  assert.deepEqual(open.offIds, before.offIds.filter((x) => x !== 'designbook:'), 'the boards, the TV and every desk are usable again');
  assert.ok(open.idle.every(Boolean), 'the board agents are back');
  assert.equal(open.podsHidden, 0, 'every desk uncovered');
  assert.ok(Math.abs(open.hemi - before.hemi) < 0.05, `all the lights on (${open.hemi})`);
  assert.deepEqual(open.loft, before.loft, 'the loft’s lamps as they were');
  assert.equal(open.hall, true);
  assert.equal(open.launched, true, 'the Design book and the poster are up');

  // The lead heading into the cubby hall.
  await page.waitForFunction(() => { const d = window.__office.scene.getObjectByName('drafts'); let x = 99; d.traverse((o) => { if (o.userData?.interact?.kind === 'draftlead' && o.type === 'Group') x = o.position.x; }); return x < -14.5; }, null, { timeout: 15000, polling: 50 });
  await page.evaluate(() => window.__hold());
  const doorView = () => stand(-8.5, -6.2, toward(-8.5, -6.2, -18.5, -11.2), -0.02);
  await doorView();
  await page.waitForTimeout(300);
  assert.notEqual(await page.evaluate(() => window.__audit.parts.pointer.target()?.kind ?? null), 'draftlead', 'the lead on its way is nobody to talk to');
  await shot('08-open-floor-lead-to-cubby-hall', () => stand(-11.5, -7.0, toward(-11.5, -7.0, -16.5, -9.6), -0.02));
  await page.evaluate(() => window.__go());
  await page.waitForFunction(() => !window.__office.scene.getObjectByName('drafts').visible, null, { timeout: 15000, polling: 100 });
  const cubbyLead = await page.evaluate(() => {
    let lead = false;
    window.__office.scene.getObjectByName('cubbies').traverse((o) => { if (o.userData?.interact?.kind === 'cubbylead') lead = true; });
    return lead;
  });
  assert.equal(cubbyLead, true, 'the cubby’s own lead is in cubby 0');
  await stand(-18.45, -10.75, Math.PI / 2 + 0.15, -0.12);
  await shot('09-lead-in-cubby-0', () => stand(-18.45, -10.6, Math.PI / 2 + 0.5, -0.12));

  // ---- What the floor keeps: the Design book and the brand poster. ----
  await stand(-6.08, 11.2, Math.PI, -0.18);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__audit.parts.pointer.target()?.kind), 'designbook');
  assert.match(await hintOf('designbook'), /Design.*Kindly · 3 approved screens.*E.*Open/);
  await shot('10-bookshelf-design-book');
  // The mouse is still captured from the studio table (a click here would open the book).
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await stand(-6.08, 11.2, Math.PI, -0.18);
  await page.waitForTimeout(200);
  await page.keyboard.press('e');
  await page.waitForSelector('.modal.design-book');
  assert.match(await page.locator('.design-book').innerText(), /Kindly[\s\S]*Your family’s week[\s\S]*#EF476F[\s\S]*Approved screens · 3[\s\S]*Home[\s\S]*Calendar[\s\S]*Add event/);
  assert.equal(await page.locator('.design-book .btn.close').count(), 1);
  await shot('11-design-book-panel');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });

  // Walking up to the elevator: the poster hung beside its doors, the PR board and the merge gong both clear of it.
  await stand(8.6, -5.4, toward(8.6, -5.4, 8.6, -11.5), 0.1);
  await shot('12-brand-poster-by-elevator', () => stand(7.7, -8.3, toward(7.7, -8.3, 7.46, -10.6), 0.05));

  // ---- Everyone's elevator: the floor with its "New" badge. ----
  await stand(3, 6, Math.PI, -0.3);
  await page.evaluate(async () => {
    const { openElevator } = await import('/ui/elevator.ts');
    const a = window.__audit;
    openElevator({ net: a.parts.net, ride: (id) => a.parts.travel.ride(id), downstairs: () => false });
  });
  await page.waitForSelector('.modal.elevator');
  assert.match(await page.locator('.floor-btn', { hasText: 'Kindly' }).innerText(), /Kindly[\s\S]*New/);
  assert.equal(await page.locator('.floor-btn.draft').count(), 0);
  await shot('13-elevator-new-badge');
  await page.keyboard.press('Escape');

  // Kicked off from another floor: nothing moves here (the office's toast says so).
  assert.deepEqual(errors, []);
  const report = { out, before, draft, early, mid, open, sentTypes: [...new Set(sent.map((m) => m.t))], errors, browser: browser.version() };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, out }));
} finally {
  await browser.close();
  await server.close();
}
