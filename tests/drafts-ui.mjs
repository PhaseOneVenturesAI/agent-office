// A draft floor in a real browser: the actual main.ts, office, renderer and PlayerController, with the
// drafts feature installed by main.ts and fixtures served through the client's own message path (a
// routed WebSocket), no server. Synthetic draft, cubby and helpers only. Whole-floor screenshots at
// desktop (1440×1000) and phone (390×844) go to OFFICE_DRAFTS_OUTPUT (default .paradev/shots-drafts).
//
//   node tests/drafts-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = realpathSync(process.env.OFFICE_DRAFTS_ROOT ?? process.cwd());
const out = process.env.OFFICE_DRAFTS_OUTPUT ?? `${root}/.paradev/shots-drafts`;
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: '/tmp/agent-office-drafts-ui/.vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
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
const cubbies = { enabled: true, floorId: 'draft-1', setupAllowed: true, cubbies: [
  { id: 'cub-me', slot: 0, ownerName: 'Jordan Fixture', mine: true, lamp: 'working', working: 1, interior: { computerId: 'fixture-computer', computerName: 'Mac mini', leadName: 'Nova', look, agents, plan: [], needsYou: [], chat: [], observedAt: 1 } },
] };
const boards = {
  decisions: ['Audience: busy parents', 'Problem: too many group chats', 'One shared family calendar', 'Must work on a phone first', 'Needs you: free or paid?'],
  plan: ['Approve the brand direction', 'Draw the five core screens', 'Turn the screens into a spec', 'Kick off and build'],
  screens: [{ title: 'Home', status: 'approved' }, { title: 'Calendar', status: 'review' }, { title: 'Add event', status: 'sketch' }, { title: 'Family', status: 'sketch' }],
  brand: { name: 'Kindly', tagline: 'Your family’s week, in one calm place', colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#2b2d42'] },
};
const here = (extra = {}) => ({ id: 'draft-1', name: 'Kindly', createdAt: 1, cubbyId: 'cub-me', leadName: 'Nova', online: true, boards, designers: 1, ...extra });
const drafts = (h) => ({ enabled: true, canStart: true, ...(h ? { here: h } : {}) });
const push = (m) => socket.send(JSON.stringify(m));

/** Both sizes; `phone` turns you for the phone's narrower view first (where the desktop's would leave the subject out). */
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

  const baseline = await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'draft-1'; s.you = 'fixture-self';
    s.project = { name: 'Kindly', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    for (const e of ['project', 'floor']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    return { colliders: o.world().colliders.length, off: o.office.interactables.filter((it) => it.off).length };
  });
  /** You at (x, z), looking `yaw` (0 is north, π/2 west, π south) and `pitch` up, in first person. */
  const stand = (x, z, yaw, pitch = -0.05) =>
    page.evaluate(([x, z, yaw, pitch]) => {
      const o = window.__office;
      o.player.view = 'first'; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
    }, [x, z, yaw, pitch]);
  /** The yaw that looks from (x, z) toward (tx, tz). */
  const toward = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));
  const state = () => page.evaluate(() => {
    const a = window.__audit, o = window.__office;
    const d = o.scene.getObjectByName('drafts');
    const its = o.office.interactables;
    return {
      shown: !!d?.visible,
      whiteboard: o.office.whiteboard.group.visible,
      off: its.filter((it) => it.off).length,
      offIds: its.filter((it) => it.off).map((it) => `${it.kind}:${it.deskId ?? it.seatId ?? ''}`).sort(),
      offKinds: [...new Set(its.filter((it) => it.off).map((it) => it.kind))].sort(),
      idle: a.parts.worlds.idleAgents().map((x) => x.model.root.visible),
      colliders: o.world().colliders.length,
      hemi: a.parts.stage.hemi.intensity,
      podsHidden: [...o.office.desks.values()].filter((v) => !v.def.beanbag && !v.def.station && !v.def.room && !v.def.wing && !v.group.visible).length,
    };
  });

  // ---- Not a draft: nothing changes. ----
  await page.evaluate(() => {
    const s = window.__office.store;
    s.floors = [
      { id: 'office', name: 'agent-office', dir: '/fixture/agent-office', repo: 'PhaseOneVenturesAI/agent-office', workers: 3, people: 2, busy: 1, waiting: 0, palette: 0 },
      { id: 'draft-1', name: 'Kindly', dir: '/fixture/kindly', workers: 0, people: 1, busy: 0, waiting: 0, palette: 1, draft: true },
    ];
    s.emit('floors');
  });
  push({ t: 'cubbies', state: cubbies });
  push({ t: 'drafts', state: drafts(null) });
  await page.waitForTimeout(400);
  const before = await state();
  assert.equal(before.shown, false);
  assert.equal(before.whiteboard, true);
  assert.ok(before.idle.every(Boolean));

  // ---- Your draft: lights off, covers on, boards swapped. ----
  await stand(8.3, -10.3, toward(8.3, -10.3, 9.8, -7.3), 0.12);
  push({ t: 'drafts', state: drafts(here()) });
  await page.waitForTimeout(1800);
  const on = await state();
  assert.equal(on.shown, true);
  assert.equal(on.whiteboard, false);
  assert.ok(on.off > before.off, 'boards, TV, whiteboard, pod desks and kiosks are off');
  for (const k of ['issues', 'pulls', 'queue', 'station', 'tv', 'whiteboard', 'desk']) assert.ok(on.offKinds.includes(k), `${k} is off`);
  assert.ok(on.idle.every((v) => !v), 'board agents hidden');
  assert.ok(on.hemi < before.hemi * 0.4, `lights down (${before.hemi} → ${on.hemi})`);
  assert.equal(on.podsHidden, 12, 'three pods covered, one uncovered');
  assert.equal(on.colliders, before.colliders, 'the whiteboard swapped for the studio table');

  // Arriving: the lead at the doors with its greeting.
  const greet = await page.evaluate(() => {
    const d = window.__office.scene.getObjectByName('drafts');
    let bubble = false;
    d.traverse((o) => { if (o.isSprite && o.material.map?.image && o.visible && o.parent?.userData?.interact?.kind === 'draftlead') bubble = true; });
    return bubble;
  });
  assert.equal(greet, true, 'the lead has its tags and bubble');
  console.error('LIGHTS', JSON.stringify(await page.evaluate(() => { const L = []; window.__office.scene.traverse((o) => { if (o.isLight) L.push([o.type, +o.intensity.toFixed(3), o.visible]); }); return L; })));
  await shot('01-arrive-lead-greets', () => stand(8.0, -10.35, toward(8.0, -10.35, 9.8, -7.3), 0.2));

  // Hints: the lead and the studio table.
  const hints = await page.evaluate(() => {
    const a = window.__audit;
    const its = a.ctx.usables.lists().flat();
    const text = (it) => a.ctx.interactions.hint(it).parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join(' ');
    return { lead: text(its.find((it) => it.kind === 'draftlead')), table: text(its.find((it) => it.kind === 'studiotable')) };
  });
  assert.match(hints.lead, /Nova.*E.*Talk to Nova/);
  assert.match(hints.table, /Studio table.*E.*Talk to Nova/);

  // Walk on past: the lead goes over to the studio table.
  await stand(3.2, 8.5, toward(3.2, 8.5, 2.6, -4), -0.14);
  await page.waitForTimeout(4500);
  const leadAt = await page.evaluate(() => { const it = window.__audit.ctx.usables.lists().flat().find((x) => x.kind === 'draftlead'); return { x: it.x, z: it.z }; });
  assert.ok(Math.hypot(leadAt.x - 6.3, leadAt.z - -6.6) < 0.2, `the lead waits by the table (${JSON.stringify(leadAt)})`);
  await shot('02-dark-floor-studio-table', () => stand(3.2, 8.5, toward(3.2, 8.5, 5.2, -5.4), -0.12));

  // The north boards: Decisions, Plan and Screens.
  await stand(-4, 3.5, 0, 0.12);
  await shot('03-boards-decisions-plan-screens');
  // The brand wall, where the TV is.
  await stand(7.5, 0, -Math.PI / 2, 0.08);
  await shot('04-brand-wall');
  // One pod uncovered, a designer at it.
  await stand(-1.3, -1.1, toward(-1.3, -1.1, -2.2, -4.6), -0.12);
  await shot('05-pod-uncovered-designer');

  // Empty boards say what to expect.
  push({ t: 'drafts', state: drafts(here({ boards: { decisions: [], plan: [], screens: [], brand: { colors: [] } }, designers: 0 })) });
  await page.waitForTimeout(400);
  await stand(-4, 3.5, 0, 0.12);
  await shot('06-boards-empty');
  assert.equal((await state()).podsHidden, 16, 'no designers: every pod covered');

  // No cubby yet: E at the studio table is Set up (slot 0).
  push({ t: 'drafts', state: drafts(here({ cubbyId: undefined })) });
  await page.waitForTimeout(200);
  const setupHint = await page.evaluate(() => {
    const a = window.__audit;
    const it = a.ctx.usables.lists().flat().find((x) => x.kind === 'studiotable');
    const t = a.ctx.interactions.hint(it).parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join(' ');
    a.ctx.interactions.use(it, 'E', null);
    return t;
  });
  assert.match(setupHint, /Studio table.*E.*Set up/);
  await page.waitForSelector('.cubby-setup');
  await page.locator('.cubby-setup button[type="submit"]').click();
  await page.waitForTimeout(150);
  const setup = sent.filter((m) => m.t === 'cubbies.setup');
  assert.equal(setup.length, 1);
  assert.equal(setup[0].slot, 0);
  await page.keyboard.press('Escape');
  push({ t: 'drafts', state: drafts(here()) });

  // ---- The elevator: your draft's row, and New project. ----
  await stand(3, 6, Math.PI, -0.3);
  await page.waitForTimeout(1200);
  await page.mouse.click(700, 500);

  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.evaluate(async () => {
    const { openElevator } = await import('/ui/elevator.ts');
    const a = window.__audit;
    openElevator({ net: a.parts.net, ride: (id) => a.parts.travel.ride(id), downstairs: () => false });
  });
  await page.waitForSelector('.modal.elevator');
  assert.match(await page.locator('.floor-btn.draft').innerText(), /Kindly[\s\S]*draft[\s\S]*Only you/);
  await shot('07-elevator-draft-row');
  await page.locator('.elevator .new-project').click();
  await page.waitForSelector('.modal.draft-new');
  assert.equal(await page.locator('.modal.draft-new .btn.close').count(), 1, 'the panel has its ✕');
  await page.fill('.draft-new input', 'Plimbo Studio');
  await shot('08-new-project-panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0, 'Esc closes it');
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  // ✕ too, straight back to mouse-look.
  await page.evaluate(async () => { const { openNewProject } = await import('/features/drafts/ui-new.ts'); openNewProject(window.__audit.parts.net); });
  await page.locator('.draft-new .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse, null, { timeout: 2000 });
  // Sending it, and riding to it once it's made.
  await page.evaluate(async () => { const { openNewProject } = await import('/features/drafts/ui-new.ts'); openNewProject(window.__audit.parts.net); });
  await page.fill('.draft-new input', '  Plimbo   Studio ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const made = sent.filter((m) => m.t === 'drafts.new');
  assert.deepEqual(made.map((m) => m.name), ['Plimbo Studio']);
  await stand(12, -2, 0, 0);
  push({ t: 'drafts.made', floorId: 'draft-2' });
  await page.waitForTimeout(200);
  const trip = await page.evaluate(() => window.__audit.core.trip?.floor ?? null);
  assert.equal(trip, 'draft-2', 'rides to the new draft');
  await page.evaluate(() => { const a = window.__audit; clearTimeout(a.core.trip?.timer); a.core.trip = null; window.__office.player.enabled = true; });

  // ---- Leaving the draft: everything back as it was. ----
  push({ t: 'drafts', state: drafts(null) });
  await page.waitForTimeout(1800);
  const after = await state();
  assert.equal(after.shown, false);
  assert.equal(after.whiteboard, true);
  assert.deepEqual(after.offIds, before.offIds);
  assert.ok(after.idle.every(Boolean));
  assert.equal(after.colliders, before.colliders);
  assert.equal(after.podsHidden, 0);
  assert.ok(Math.abs(after.hemi - before.hemi) < 0.05, `lights back (${before.hemi} → ${after.hemi})`);

  assert.deepEqual(errors, []);
  const report = { out, before, on, hints, after, sentTypes: [...new Set(sent.map((m) => m.t))], errors, browser: browser.version() };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
