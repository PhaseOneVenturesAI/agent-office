// The cubby hall in a real browser: the actual main.ts, office, renderer and PlayerController, with the
// cubbies feature installed by main.ts and the hall the office floor builds west of its west wall
// (features/cubbies/hall.ts). Synthetic accounts' cubbies and synthetic agents only: no providers, no
// live office, no real tokens. Screenshots at desktop and 390 px go to OFFICE_CUBBY_OUTPUT.
//
//   node tests/cubby-ui.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';

const root = realpathSync(process.env.OFFICE_CUBBY_ROOT ?? process.cwd());
const out = process.env.OFFICE_CUBBY_OUTPUT ?? `${root}/.paradev/shots-cubby-v5`;
mkdirSync(out, { recursive: true });
const FAKE_TOKEN = 'fixture-token-not-real';
const SECRET = 'SECRET-OTHER-ACCOUNT-INTERIOR';

const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', configLoader: 'runner', cacheDir: out + '/.vite', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
const sent = [];
let socket = null;
let ownerFingerprint = '';
let publicKey = '';
page.on('pageerror', (e) => errors.push(e.message));

const look = { skin: 2, hair: 4, style: 1 };
const agents = [
  { id: 'lead', tool: 'Claude', role: 'lead', task: 'Lead', branch: 'main', status: 'working' },
  { id: 'b1', tool: 'Codex', role: 'builder', task: 'Fix checkout', branch: 'fix/checkout', status: 'working', progress: 'tests 41/41' },
  { id: 'b2', tool: 'Claude', role: 'builder', task: 'Cart screen polish', branch: 'feat/cart', status: 'needs-you' },
  { id: 'rv', tool: 'Kimi', role: 'reviewer', task: 'Review PR 512', branch: 'review/512', status: 'idle' },
  { id: 'fx', tool: 'Factory', role: 'factory', task: 'Invoices, tasks 1-4', branch: 'factory/invoices', status: 'working', progress: 'task 2 of 4', deadlineAt: Date.now() + 12 * 60_000 },
  { id: 'pd', tool: 'Paradev', role: 'paradev', task: 'npm test -- cart', branch: 'plimbo/fix-checkout', status: 'working' },
  { id: 'dr', tool: 'Codex', role: 'direct', task: 'PRIVATE-DIRECT-PROMPT', branch: 'spike/search', status: 'working', progress: 'PRIVATE-DIRECT-PROGRESS' },
  { id: 'b3', tool: 'Claude', role: 'builder', task: 'Extra builder', branch: 'feat/extra', status: 'working' },
];
const chat = [
  { id: 'c1', role: 'user', text: 'What is next?', at: 1 },
  { id: 'c2', role: 'assistant', text: 'Checkout fix lands first, then the cart polish. <img src=x onerror="window.__xss=1">', at: 2 },
];
/** The 16-character code for a key, as deviceCode works it out (protocol/cubbies.ts): 80 bits in Crockford base32. */
const codeOf = (key) => {
  const d = createHash('sha256').update(Buffer.from(key, 'base64url')).digest();
  let bits = '', out = '';
  for (const b of d.subarray(0, 10)) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < 80; i += 5) out += '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g).join(' ');
};
const interior = (lamp) => ({ computerId: 'fixture-computer', ownerDevices: [{ fingerprint: ownerFingerprint, label: 'Mac', addedAt: 1 }], deviceRequests: [], computerName: 'Mac mini', leadName: 'Nova', look, agents, plan: ['Fix checkout bug', 'Cart screen polish', 'Review PR #512', 'Invoices, tasks 1-4'], needsYou: ['Approve the new cart screen?', 'Merge PR #512 after review?'], chat, observedAt: 1 });
const cubbies = (lamp = 'working', extra = {}) => ({
  enabled: true,
  floorId: 'fixture',
  setupAllowed: true,
  cubbies: [
    { id: 'cub-me', slot: 0, ownerName: 'Jordan Fixture', mine: true, lamp, working: 6, interior: interior(lamp) },
    // Another account's: the server never sends its inside; this one smuggles one in to prove the page drops it.
    { id: 'cub-alex', slot: 1, ownerName: 'Alex Fixture', mine: false, lamp: 'working', working: 2, interior: { ...interior('working'), leadName: SECRET, computerName: SECRET, plan: [SECRET] } },
    { id: 'cub-sam', slot: 2, ownerName: 'Sam Fixture', mine: false, lamp: 'asleep', working: 0 },
  ],
  ...extra,
});
const push = (m) => socket.send(JSON.stringify(m));

const shot = async (name) => {
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(450);
    if (name === 'owner-key-mismatch') {
      const fits = await page.locator('.cb-main').evaluate((main) => main.scrollHeight <= main.clientHeight + 1);
      assert.equal(fits, true, `key notice fits at ${width}px`);
    }
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
    if (name === 'chat' || name === 'setup') await page.locator(`.cubby-${name}`).screenshot({ path: `${out}/${name}-dialog-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
};

const nightEvidence = [];
/** Mean luma of the central scene (HUD excluded), per viewport, as the page stands. */
const sceneLuma = async () => {
  const out = {};
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(450);
    out[suffix] = await page.evaluate(() => {
      const o = window.__office;
      o.renderer.render(o.scene, o.camera);
      const gl = o.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const width = Math.floor(w * 0.8), height = Math.floor(h * 0.7), pixels = new Uint8Array(width * height * 4);
      gl.readPixels(Math.floor(w * 0.1), Math.floor(h * 0.15), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      return sum / (width * height);
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return out;
};
const nightShot = async (name, day = null) => {
  await page.evaluate(() => window.__office.sky.show({ hour: 21, weather: 'clear' }));
  await page.waitForTimeout(1200);
  for (const [width, height, suffix] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(450);
    const evidence = await page.evaluate(() => {
      const o = window.__office, a = window.__audit;
      o.renderer.render(o.scene, o.camera);
      const gl = o.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      // Central scene only: exclude the hint bar and HUD, so text can't mask a black room.
      const width = Math.floor(w * 0.8), height = Math.floor(h * 0.7), pixels = new Uint8Array(width * height * 4);
      gl.readPixels(Math.floor(w * 0.1), Math.floor(h * 0.15), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      const lights = [];
      for (const root of [a.ctx.office.cubbyHall.group, a.cubbies.group]) root.traverse(x => { if (x.isPointLight && x.visible) lights.push({ intensity: x.intensity, shadow: x.castShadow }); });
      return { meanLuma: sum / (width * height), lights, hands: o.sky.lightAt(o.player.pos) };
    });
    assert.ok(evidence.meanLuma >= 60, `${name} ${suffix}: room lit at night (${evidence.meanLuma})`);
    // The corridor reads as night: clearly darker than the same view by day (Jonathan, 2026-11-26).
    if (day) assert.ok(evidence.meanLuma <= day[suffix] * 0.6, `${name} ${suffix}: night ${evidence.meanLuma} vs day ${day[suffix]}`);
    if (day) evidence.dayLuma = day[suffix];
    assert.equal(evidence.hands, 1);
    assert.equal(evidence.lights.length, 6, 'three corridor lamps and three occupied desks; empty desk emissive only');
    assert.ok(evidence.lights.every(l => l.intensity > 0 && !l.shadow));
    nightEvidence.push({ name, suffix, ...evidence });
    await page.screenshot({ path: `${out}/${name}-${suffix}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.__office.sky.show({ hour: 12, weather: 'clear' }));
  await page.waitForTimeout(300);
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jordan Fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
  });
  await page.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'acct-jordan', name: 'Jordan Fixture', role: 'member' } } }) }));
  await page.route('**/api/login', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ accounts: true, shared: false, cloudflare: true }) }));
  await page.route('**/main.ts*', async (r) => {
    const response = await r.fetch();
    const body = (await response.text()) + "\nwindow.__audit = { ctx, core, parts, cubbies: parts.cubbies };\n";
    await r.fulfill({ response, body });
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => sent.push(JSON.parse(String(raw))));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?3d=1`);
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  const keyEvidence = await page.evaluate(async () => {
    const { ownerDeviceKey } = await import('/shared/cubby/keys.ts');
    const first = await ownerDeviceKey('Jordan Fixture');
    const reload = await import('/shared/cubby/keys.ts?reload');
    const persisted = await reload.ownerDeviceKey('Jordan Fixture');
    const other = await ownerDeviceKey('Alex Fixture');
    const otherOffice = await ownerDeviceKey('Jordan Fixture', 'https://other-office.example');
    const race = await Promise.all([ownerDeviceKey('Race Fixture'), reload.ownerDeviceKey('Race Fixture')]);
    let exportBlocked = false;
    try { await crypto.subtle.exportKey('pkcs8', persisted.privateKey); } catch { exportBlocked = true; }
    return { publicKey: first.publicKey, fingerprint: first.fingerprint, persisted: first.publicKey === persisted.publicKey,
      isolatedAccount: first.publicKey !== other.publicKey, isolatedOrigin: first.publicKey !== otherOffice.publicKey,
      oneWinner: race[0].publicKey === race[1].publicKey, extractable: persisted.privateKey.extractable, exportBlocked };
  });
  assert.equal(keyEvidence.persisted, true); assert.equal(keyEvidence.isolatedAccount, true);
  assert.equal(keyEvidence.isolatedOrigin, true); assert.equal(keyEvidence.oneWinner, true);
  assert.equal(keyEvidence.extractable, false); assert.equal(keyEvidence.exportBlocked, true);
  ownerFingerprint = keyEvidence.fingerprint; publicKey = keyEvidence.publicKey;
  const baseColliders = await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'fixture'; s.you = 'fixture-self';
    s.project = { name: 'Plimbo', dir: '/fixture', branch: 'main', agentProviders: ['claude'], defaultProvider: 'claude' };
    for (const e of ['project', 'floor']) s.emit(e);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first';
    return o.world().colliders.length;
  });
  /** You at (x, z), looking `yaw` (0 is north, π/2 west, π south) and `pitch` up, in first person. */
  const stand = (x, z, yaw, pitch = -0.05, view = 'first') =>
    page.evaluate(([x, z, yaw, pitch, view]) => {
      const o = window.__office;
      o.player.view = view; o.player.pos.set(x, 0, z); o.player.vy = 0; o.player.camYaw = yaw; o.player.facing = yaw + Math.PI; o.player.lookPitch = pitch; o.player.updateCamera(true);
    }, [x, z, yaw, pitch, view]);
  /** Walks you `ms` with `key` held, and says where you got to. */
  const walk = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    return page.evaluate(() => ({ x: window.__office.player.pos.x, z: window.__office.player.pos.z }));
  };
  const clearanceState = () => page.evaluate(() => window.__audit.ctx.office.exteriorClearance.moves.map(m => ({
    x: m.root.position.x, original: m.x, shift: m.dx,
    colliders: m.cols.map(({ c, min, max }) => [c.minX - min, c.maxX - max]),
  })));
  const hallState = () => page.evaluate(() => {
    const h = window.__audit.ctx.office.cubbyHall, cols = window.__office.world().colliders;
    return { on: h.on, visible: h.group.visible, inWorld: h.colliders.filter((c) => cols.includes(c)).length };
  });

  // ---- Disabled: nothing drawn, nothing to bump into or use. ----
  push({ t: 'cubbies', state: { enabled: false, cubbies: cubbies().cubbies, setupAllowed: true } });
  await page.waitForTimeout(200);
  const off = await page.evaluate((base) => {
    const a = window.__audit, o = window.__office;
    const kinds = a.ctx.usables.lists().flat().map((it) => it.kind).filter((k) => k.startsWith('cubby'));
    return { visible: a.cubbies.group.visible, rooms: a.cubbies.rooms().size, kinds, colliders: o.world().colliders.length - base };
  }, baseColliders);
  assert.deepEqual(off, { visible: false, rooms: 0, kinds: [], colliders: 0 });
  assert.deepEqual(await hallState(), { on: false, visible: false, inWorld: 0 });
  // The doorway is wall: walking at it from the open floor gets you nowhere.
  await stand(-16.6, -11.6, Math.PI / 2);
  const blocked = await walk('KeyW', 900);
  assert.ok(blocked.x > -18 + 0.2, `the wall stops you (${JSON.stringify(blocked)})`);

  // ---- Enabled: four slots, only your own inside. ----
  push({ t: 'cubbies', state: cubbies() });
  await page.waitForTimeout(400);
  const on = await page.evaluate((secret) => {
    const a = window.__audit, s = window.__office.store;
    const rooms = [...a.cubbies.rooms().values()];
    const texts = [];
    a.cubbies.group.traverse((x) => { const img = x.material?.map?.image; if (img instanceof HTMLCanvasElement) texts.push(img.toDataURL().length); });
    let leaked = false;
    a.cubbies.group.traverse((x) => { if (JSON.stringify(x.userData ?? {}).includes(secret)) leaked = true; });
    const mine = rooms[0].interior;
    return {
      visible: a.cubbies.group.visible,
      rooms: rooms.length,
      interiors: rooms.map((r) => !!r.interior),
      storeDropped: s.cubbies.cubbies[1].interior === undefined,
      leaked,
      workers: [...mine.views.values()].filter((v) => v.model).map((v) => `${v.agent.id}:${v.spot.kind}`).sort(),
      machine: mine.machine.group.visible,
      screen: mine.screens[0].group.visible,
      kinds: [...new Set(a.ctx.usables.lists().flat().map((it) => it.kind))].filter((k) => k.startsWith('cubby')).sort(),
    };
  }, SECRET);
  assert.equal(on.visible, true);
  assert.equal(on.rooms, 4);
  assert.deepEqual(on.interiors, [true, false, false, false]);
  assert.equal(on.storeDropped, true);
  assert.equal(on.leaked, false);
  assert.deepEqual(on.workers, ['b1:seat', 'b2:seat', 'b3:bag', 'dr:stand', 'rv:reviewer']);
  assert.equal(on.machine, true);
  assert.equal(on.screen, true);
  assert.deepEqual(on.kinds, ['cubbyagent', 'cubbycomputer', 'cubbydoor', 'cubbylead']);
  const moved = await clearanceState();
  assert.ok(moved.length >= 3, 'tree canopy, west pumpkins and graves registered');
  for (const m of moved) {
    assert.equal(m.x, m.original + m.shift);
    for (const [min, max] of m.colliders) { assert.ok(Math.abs(min - m.shift) < 1e-9); assert.ok(Math.abs(max - m.shift) < 1e-9); }
  }
  const open = await hallState();
  assert.equal(open.on && open.visible, true);
  assert.ok(open.inWorld >= 8, `the hall's walls, floor and partitions are in the way (${open.inWorld})`);

  // Walking in: through the doorway from the open floor, then down the corridor.
  await stand(-16.6, -11.6, Math.PI / 2);
  const through = await walk('KeyW', 1100);
  assert.ok(through.x < -18.6, `through the doorway into the corridor (${JSON.stringify(through)})`);
  await stand(-18.9, through.z, Math.PI);
  const down = await walk('KeyW', 1500);
  assert.ok(down.z > -8 && down.x > -19.5 && down.x < -18.3, `down the corridor (${JSON.stringify(down)})`);
  const indoors = await page.evaluate(() => window.__audit.parts.place.indoors());
  assert.equal(indoors, true, 'the hall counts as indoors');

  // The doorway from the open floor, its sign over it.
  await stand(-13.2, -9.4, Math.PI / 2 - 0.55, 0.08);
  await shot('hall-entrance');
  // Down the corridor from the entrance: your cubby by the door, then the others' frosted, then free ones.
  await stand(-18.75, -12.6, Math.PI - 0.22, 0.02);
  await shot('hall-corridor-entrance');
  // And the whole corridor from its far end: free cubbies nearest, the others' frosted, yours by the doorway.
  await stand(-18.6, 4.7, 0.16, 0.06);
  await shot('hall-corridor');
  await page.evaluate(() => window.__office.sky.show({ hour: 12, weather: 'clear' }));
  await page.waitForTimeout(1200);
  const dayCorridor = await sceneLuma();
  for (const [suffix, luma] of Object.entries(dayCorridor)) await page.setViewportSize(suffix === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 800 }).then(() => page.waitForTimeout(450)).then(() => page.screenshot({ path: `${out}/day-corridor-${suffix}.png` })).then(() => luma);
  await page.setViewportSize({ width: 1280, height: 800 });
  await nightShot('night-corridor', dayCorridor);

  // ---- Inside: hint bar names the lead; E talks to it. ----
  const hints = await page.evaluate(() => {
    const a = window.__audit, o = window.__office;
    const its = a.ctx.usables.lists().flat();
    const text = (it) => a.ctx.interactions.hint(it).parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join(' ');
    const lead = its.find((it) => it.kind === 'cubbylead');
    const doorOf = (slot) => its.find((it) => it.kind === 'cubbydoor' && it.slot === slot);
    o.player.pos.set(lead.x + 1.6, 0, lead.z); o.player.camYaw = Math.PI / 2; o.player.lookPitch = -0.12; o.player.updateCamera(true);
    return { lead: text(lead), mine: text(doorOf(0)), alex: text(doorOf(1)), sam: text(doorOf(2)), free: text(doorOf(3)), direct: text(its.find((it) => it.agentId === 'dr')) };
  });
  assert.match(hints.lead, /Nova.*Runs on your Mac mini.*E.*Talk to Nova/);
  // Someone else's: name, lamp and count only, and E knocks (cubbies step 4, tests/cubby-sharing-ui.mjs).
  assert.match(hints.alex, /Alex Fixture.*2 working.*E.*Knock/);
  assert.match(hints.sam, /asleep/);
  assert.match(hints.free, /Free cubby.*E.*Set up/);
  assert.match(hints.direct, /Tool and branch/);
  // Inside your own cubby, from just in its door.
  const mineAt = await page.evaluate(() => { const p = window.__audit.cubbies.rooms().get(0).place; return { x: p.x, z: p.z, depth: p.depth, width: p.width }; });
  // At eye height, the way a player stands.
  // In the doorway, looking in: the whole room in view at eye height.
  const leadAt = await page.evaluate(() => { const l = window.__audit.ctx.usables.lists().flat().find((it) => it.kind === 'cubbylead'); return { x: l.x, z: l.z }; });
  const fromX = mineAt.x + mineAt.depth / 2 + 0.45, fromZ = mineAt.z + 0.6;
  // Turned toward the lead's desk, so the phone's narrow view still shows the lead and the plan board.
  await stand(fromX, fromZ, Math.atan2(-(leadAt.x - fromX), -(leadAt.z - fromZ)), -0.2);
  await page.waitForTimeout(300);
  await shot('inside');
  // Never more than one helper's name tag and card at a time.
  const tagged = await page.evaluate(() => {
    const room = window.__audit.cubbies.rooms().get(0);
    let n = 0;
    for (const v of room.interior.views.values()) {
      let on = false;
      v.model?.root.traverse((o) => { if (o.isSprite && o.layers.isEnabled(0)) on = true; });
      if (on) n++;
    }
    return n;
  });
  assert.ok(tagged <= 1, `at most one helper shows its tag (${tagged})`);
  await stand(mineAt.x + mineAt.depth / 2 + 1.0, mineAt.z + 0.1, Math.PI / 2, -0.12);
  await shot('inside-doorway');
  await nightShot('night-interior');
  await stand(mineAt.x, mineAt.z + 0.8, Math.PI / 2, 0.08);
  await shot('room-window-and-desk');
  const freeAt = await page.evaluate(() => window.__audit.cubbies.rooms().get(3).place);
  await stand(freeAt.x + freeAt.depth / 2 + 0.3, freeAt.z, Math.PI / 2, 0.03);
  await shot('free-room-decor');
  await stand(mineAt.x + mineAt.depth / 2 + 1.0, mineAt.z + 0.1, Math.PI / 2, -0.12);
  const cam = await page.evaluate(() => ({ x: window.__office.camera?.position.x ?? window.__audit.ctx.camera.position.x }));
  assert.ok(cam.x > -24.7 && cam.x < -18.3, `the camera keeps inside the hall (${JSON.stringify(cam)})`);
  await stand(mineAt.x + mineAt.depth / 2 - 0.25, mineAt.z + 0.1, Math.PI / 2, -0.22);

  // ---- The lead's window: chat only, text only. ----
  await page.evaluate(() => { window.__office.player.view = 'first'; });
  await page.mouse.click(700, 700);
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.evaluate(() => {
    const a = window.__audit;
    const lead = a.ctx.usables.lists().flat().find((it) => it.kind === 'cubbylead');
    a.ctx.interactions.use(lead, 'E', null);
  });
  await page.waitForSelector('.cubby-chat');
  assert.equal(await page.locator('.cubby-chat img').count(), 0, 'chat text is never HTML');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await page.fill('.cubby-chat textarea', 'Ship the checkout fix first');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const firstChat = sent.filter((m) => m.t === 'cubbies.chat');
  assert.equal(firstChat.length, 1);
  assert.equal(firstChat[0].id, 'cub-me');
  assert.equal(firstChat[0].text, 'Ship the checkout fix first');
  assert.match(firstChat[0].ownerSig, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(await page.locator('.cubby-chat .btn.close').count(), 1, 'the chat has its ✕');
  // Keep the injection assertion above, then use ordinary fixture copy for the review capture.
  await page.evaluate(() => { const s = window.__office.store; s.cubbies.cubbies[0].interior.chat[1].text = 'Checkout fix lands first, then the cart polish.'; s.emit('cubbies'); });
  await page.waitForFunction(() => !document.querySelector('.cubby-chat textarea').disabled);
  await page.fill('.cubby-chat textarea', 'Signed owner message 字');
  await page.locator('.cubby-chat button[type="submit"]').click();
  await page.waitForTimeout(100);
  const signed = sent.filter((m) => m.t === 'cubbies.chat').at(-1);
  assert.equal(signed.text, 'Signed owner message 字');
  assert.equal(typeof signed.requestId, 'string'); assert.ok(Math.abs(Date.now() - signed.at) < 5000);
  assert.equal(verify('sha256', Buffer.from(JSON.stringify(['agent-office/cubby-owner-chat/v1', 'cub-me', 'fixture', 'fixture-computer', signed.requestId, signed.at, signed.text])),
    { key: createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signed.ownerSig, 'base64url')), true);
  await shot('chat');
  // A device the computer doesn't trust yet can't send, even if submit is forced: it asks to be added.
  const setDevices = (devices, requests = []) => page.evaluate(([d, r]) => { const s = window.__office.store; Object.assign(s.cubbies.cubbies[0].interior, { ownerDevices: d, deviceRequests: r }); s.emit('cubbies'); }, [devices, requests]);
  await setDevices([{ fingerprint: '0'.repeat(32), label: 'Mac', addedAt: 1 }]);
  assert.equal(await page.locator('.cubby-chat textarea').isDisabled(), true);
  assert.match(await page.locator('.cubby-chat').innerText(), /can't talk to Nova yet/);
  const beforeMismatch = sent.filter((m) => m.t === 'cubbies.chat').length;
  await page.locator('.cubby-chat form').evaluate((f) => { f.querySelector('textarea').value = 'must not send'; f.requestSubmit(); });
  assert.equal(sent.filter((m) => m.t === 'cubbies.chat').length, beforeMismatch);
  await page.locator('.cb-device-add').click();
  await page.waitForTimeout(100);
  const asked = sent.filter((m) => m.t === 'cubbies.addDevice').at(-1);
  assert.equal(asked.publicKey, publicKey); assert.equal(asked.id, 'cub-me'); assert.equal(typeof asked.label, 'string');
  const myCode = codeOf(publicKey);
  assert.match(await page.locator('.cb-device-ask').innerText(), new RegExp(`Waiting for approval.*${myCode}`));
  await shot('device-asking');
  // Back on a trusted device: another device asks. The code here is worked out from its key, not taken from the server.
  const phone = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  await setDevices([{ fingerprint: ownerFingerprint, label: 'Mac', addedAt: 1 }], [{ requestId: 'q1', label: 'iPhone', publicKey: phone, at: Date.now() }]);
  await page.waitForSelector('.cb-device-request b');
  assert.equal(await page.locator('.cb-device-request b').innerText(), codeOf(phone));
  assert.equal(await page.locator('.cubby-chat textarea').isDisabled(), false);
  await shot('device-approve');
  await page.locator('.cb-device-request button', { hasText: 'Approve' }).click();
  await page.waitForTimeout(200);
  const approve = sent.filter((m) => m.t === 'cubbies.device').at(-1);
  assert.equal(approve.action, 'add'); assert.equal(approve.target, phone);
  assert.equal(verify('sha256', Buffer.from(JSON.stringify(['agent-office/cubby-owner-device/v1', 'cub-me', 'fixture', 'fixture-computer', approve.requestId, approve.at, 'add', phone])),
    { key: createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(approve.ownerSig, 'base64url')), true);
  await setDevices([{ fingerprint: ownerFingerprint, label: 'Mac', addedAt: 1 }, { fingerprint: 'b'.repeat(32), label: 'iPhone', addedAt: Date.now() }]);
  await page.locator('.cb-device-list summary').click();
  assert.match(await page.locator('.cb-device-list').innerText(), /Mac \(this device\)[\s\S]*iPhone/);
  await shot('device-list');
  await page.locator('.cb-device-remove[title="Remove iPhone"]').click();
  await page.waitForTimeout(200);
  const removed = sent.filter((m) => m.t === 'cubbies.device').at(-1);
  assert.equal(removed.action, 'revoke'); assert.equal(removed.target, 'b'.repeat(32));
  await setDevices([{ fingerprint: ownerFingerprint, label: 'Mac', addedAt: 1 }]);

  // A helper's card from the roster; a direct session shows tool, branch and state only.
  await page.locator('.cb-roster button', { hasText: 'Codex session' }).click();
  await page.waitForSelector('.cubby-agent');
  const direct = await page.locator('.cubby-agent').innerText();
  assert.match(direct, /spike\/search/);
  assert.doesNotMatch(direct, /PRIVATE-DIRECT/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.modal').count(), 0, 'Esc closes them');
  await page.waitForFunction(() => window.__office.player.hasMouse);
  await page.evaluate(() => { const a = window.__audit; a.ctx.interactions.use(a.ctx.usables.lists().flat().find((it) => it.kind === 'cubbylead'), 'E', null); });
  await page.locator('.cubby-chat .btn.close').click();
  await page.waitForFunction(() => window.__office.player.hasMouse);

  // ---- Asleep: lamp grey, helpers 💤, chat can't send. ----
  push({ t: 'cubbies', state: cubbies('asleep') });
  await page.waitForTimeout(1200);
  const asleep = await page.evaluate(() => {
    const a = window.__audit;
    const mine = a.cubbies.rooms().get(0).interior;
    return { statuses: [...mine.views.values()].filter((v) => v.model).map((v) => v.model.status), lid: mine.laptop.lid.rotation.x };
  });
  assert.ok(asleep.statuses.every((s) => s === 'offline'), JSON.stringify(asleep));
  assert.ok(asleep.lid > 1.5, `lid closed (${asleep.lid})`);
  await page.evaluate(() => {
    const a = window.__audit;
    a.ctx.interactions.use(a.ctx.usables.lists().flat().find((it) => it.kind === 'cubbylead'), 'E', null);
  });
  await page.waitForSelector('.cubby-chat');
  assert.equal(await page.locator('.cubby-chat textarea').isDisabled(), true);
  const before = sent.length;
  await page.locator('.cubby-chat form').evaluate((f) => f.requestSubmit());
  assert.equal(sent.length, before, 'nothing sent while asleep');
  await shot('asleep-chat');
  await page.keyboard.press('Escape');

  // ---- Setting up a free cubby, then the join command. ----
  await page.evaluate(() => {
    const a = window.__audit;
    a.ctx.interactions.use(a.ctx.usables.lists().flat().find((it) => it.kind === 'cubbydoor' && it.slot === 3), 'E', null);
  });
  await page.waitForSelector('.cubby-setup');
  await page.fill('.cubby-setup input[aria-label="Lead name"]', 'Atlas');
  await page.locator('.cubby-setup button[role="radio"]', { hasText: 'Bun' }).click();
  await shot('setup');
  await page.locator('.cubby-setup button[type="submit"]').click();
  await page.waitForTimeout(100);
  const setup = sent.filter((m) => m.t === 'cubbies.setup');
  assert.equal(setup.length, 1);
  assert.equal(setup[0].slot, 3);
  assert.equal(setup[0].leadName, 'Atlas');
  assert.equal(setup[0].look.style, 2);
  push({ t: 'cubbies.token', id: 'cub-new', floorId: 'fixture', token: FAKE_TOKEN });
  await page.waitForSelector('.cb-join');
  await page.waitForTimeout(150);
  let cmd = await page.locator('.cb-cmd').innerText();
  assert.equal(cmd, `agent-office join ${new URL(page.url()).origin} --token ${FAKE_TOKEN} --cubbies --floor fixture --project '<local project path>' --cloudflare-access --owner-key ${publicKey}`);
  await page.fill('.cb-join input', '/Users/fixture/Projects/plimbo');
  cmd = await page.locator('.cb-cmd').innerText();
  assert.match(cmd, /--project \/Users\/fixture\/Projects\/plimbo --cloudflare-access --owner-key [A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(sent).includes('/Users/fixture/Projects'), false, 'the project folder never goes to the office');
  await shot('join');
  await page.keyboard.press('Escape');

  // ---- Off again: everything goes. ----
  push({ t: 'cubbies', state: { enabled: false, cubbies: [], setupAllowed: false } });
  await page.waitForTimeout(200);
  const gone = await page.evaluate((base) => ({ visible: window.__audit.cubbies.group.visible, colliders: window.__office.world().colliders.length - base }), baseColliders);
  assert.deepEqual(gone, { visible: false, colliders: 0 });
  assert.deepEqual(await hallState(), { on: false, visible: false, inWorld: 0 });
  for (const m of await clearanceState()) {
    assert.equal(m.x, m.original, 'closed floor restores original scenery');
    for (const offsets of m.colliders) assert.deepEqual(offsets, [0, 0]);
  }
  const back = await page.evaluate(() => ({ x: window.__office.player.pos.x, z: window.__office.player.pos.z }));
  assert.ok(back.x > -18, `anyone left in the hall is put back on the open floor (${JSON.stringify(back)})`);

  assert.deepEqual(errors, []);
  assert.deepEqual(sent.filter((m) => /spawn|hire|resume|worker/.test(m.t)), []);
  const report = { out, nightEvidence, keyEvidence, off, on, hints, asleep, sentTypes: [...new Set(sent.map((m) => m.t))], errors, browser: browser.version() };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
