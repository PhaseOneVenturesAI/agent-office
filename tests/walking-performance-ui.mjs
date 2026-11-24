// Actual main.ts, original office, renderer, OutlineEffect and PlayerController; only server data is synthetic.
// OFFICE_PERF_ROOT can point at an archived baseline; OFFICE_PERF_REFERENCE compares furniture geometry.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = realpathSync(process.env.OFFICE_PERF_ROOT ?? process.cwd());
const out = process.env.OFFICE_PERF_OUTPUT ?? '/tmp/agent-office-walking-performance'; mkdirSync(out, { recursive: true });
const baseline = !!process.env.OFFICE_PERF_BASELINE;
const roles = process.env.OFFICE_PERF_ROLES ? [{ key: 'ceo', name: 'Avery', title: 'CEO', deskId: 'desk-1', talk: false, start: false, ask: false }, ...['product', 'review', 'marketing'].map((id, i) => ({ key: 'manager:' + id, name: id, title: 'Manager', department: id, deskId: 'desk-' + (i + 2), talk: false, start: false, ask: true }))] : [];
const server = await createServer({ configFile: root + '/vite.config.ts', root: root + '/src/client', cacheDir: root + '/node_modules/.vite-walking', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(root + '/node_modules')] } } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [], sent = []; page.on('pageerror', e => errors.push(e.message));
const quantile = (numbers, q) => [...numbers].sort((a, b) => a - b)[Math.min(numbers.length - 1, Math.floor(numbers.length * q))];
try {
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Performance fixture', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted: true, musicMuted: true, volume: 0, music: 0, view: 'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Disabled in local fixture', 'NotAllowedError'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/api/whoami', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ me: { admin: false, account: { id: 'fixture', name: 'Performance fixture', role: 'member' } } }) }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body: (await response.text()) + '\nwindow.__audit={ctx,core,parts};\n' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(raw => {
    const m = JSON.parse(String(raw)); sent.push(m.t);
    if (m.t === 'role.presence.get') ws.send(JSON.stringify({ t: 'role.presence', requestId: m.requestId, floor: 'fixture', roles }));
  }));
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?3d=1');
  await page.waitForFunction(() => window.__audit && window.__office?.net.up);
  const setup = await page.evaluate(() => {
    const a = window.__audit, o = window.__office, s = o.store;
    s.floor = 'fixture'; s.you = 'fixture-self'; s.floors = [{ id: 'fixture', name: 'Local original office', palette: 0, people: 1, workers: 5, busy: 0, waiting: 0, wing: 0, dir: '/fixture', addedBy: 'Fixture', addedAt: 1 }];
    s.project = { name: 'Local original office', dir: '/fixture', branch: 'main', agentProviders: ['claude', 'codex', 'kimi'], defaultProvider: 'kimi' };
    s.ceo = { ceo: { name: 'Avery', provider: 'kimi', owner: 'fixture', by: 'Fixture', at: 1 } };
    s.departments = { departments: ['product', 'review', 'marketing'].map((id, i) => ({ id, name: id, preset: id, desks: ['desk-' + (i + 2)], lead: { name: id, provider: 'kimi', by: 'Fixture', at: 1 } })), sources: [] };
    s.workers.clear(); for (let n = 0; n < 5; n++) { const id = 'worker-' + n; s.workers.set(id, { id, name: ['CEO', 'Product', 'Review', 'Marketing', 'Issues agent'][n], deskId: 'desk-' + (n + 1), kind: 'agent', provider: 'kimi', status: 'idle', color: '#4a7dbd', createdAt: 1, createdBy: 'Fixture', cols: 80, rows: 24, viewers: [], viewerIds: [], acked: true }); }
    for (const event of ['project', 'floors', 'floor', 'workers', 'ceo', 'departments']) s.emit(event);
    document.getElementById('loading')?.remove(); document.getElementById('loading-screen')?.remove();
    a.core.upTop = false; a.core.trip = null; o.player.enabled = true; o.player.view = 'first'; o.player.pos.set(-6, 0, 5); o.player.camYaw = 0; o.player.lookPitch = 0; o.player.updateCamera(true);
    const gl = o.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info'), timing = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    window.auditFrames = []; window.auditGpu = []; window.auditEnabled = false; window.auditWalking = false; window.auditPhase = {};
    for (const [phase, list] of a.ctx.ticks.phases) for (const entry of list.items) { const original = entry.fn, name = phase + ':' + (original.name || 'anonymous'); entry.fn = f => { const start = performance.now(); original(f); window.auditPhase[name] = (window.auditPhase[name] || 0) + performance.now() - start; }; }
    const run = a.ctx.ticks.run.bind(a.ctx.ticks), queries = []; let frameCount = 0; o.renderer.info.autoReset = false;
    a.ctx.ticks.run = f => {
      if (window.auditWalking) { if (o.player.pos.z > 5) o.player.keys = new Set(['KeyW']); else if (o.player.pos.z < 1.5) o.player.keys = new Set(['KeyS']); }
      for (let i = queries.length - 1; i >= 0; i--) { const q = queries[i]; if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(timing.GPU_DISJOINT_EXT) && window.auditEnabled) window.auditGpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); queries.splice(i, 1); } }
      const q = timing && window.auditEnabled && frameCount++ % 20 === 0 ? gl.createQuery() : null; if (q) gl.beginQuery(timing.TIME_ELAPSED_EXT, q);
      window.auditPhase = {}; o.renderer.info.reset(); const start = performance.now(); run(f); if (q) { gl.endQuery(timing.TIME_ELAPSED_EXT); queries.push(q); }
      if (window.auditEnabled) window.auditFrames.push({ dt: f.delta * 1000, cpu: performance.now() - start, phase: window.auditPhase, calls: o.renderer.info.render.calls, triangles: o.renderer.info.render.triangles, x: o.player.pos.x, z: o.player.pos.z, cx: o.camera.position.x, cz: o.camera.position.z });
    };
    // Compare all static triangle positions/materials and anchors across baseline and patch, independent of batching.
    o.scene.updateMatrixWorld(true); const furniture = {}, budgets = [];
    for (const d of o.office.desks.values()) {
      if (!d.def.id.startsWith('desk-')) continue;
      const skip = new Set([d.laptopAnchor, d.seatAnchor, d.stage, d.vacancy]); const triangles = []; let chairMeshes = 0;
      const visit = object => { if (skip.has(object)) return; if (object.isMesh) { const geometry = object.geometry, pos = geometry.attributes.position, index = geometry.index; const count = index ? index.count : pos.count;
        const material = object.material; const paint = [material.type, material.color?.getHexString(), material.emissive?.getHexString(), material.opacity, object.castShadow, object.receiveShadow];
        for (let i = 0; i < count; i += 3) { const points = []; for (let j = 0; j < 3; j++) { const p = o.player.pos.clone().fromBufferAttribute(pos, index ? index.getX(i + j) : i + j).applyMatrix4(object.matrixWorld); points.push(p.toArray().map(x => Math.round(x * 10000) / 10000)); } triangles.push(JSON.stringify([paint, points])); }
      } for (const child of object.children) visit(child); };
      visit(d.group); d.chair.traverse(obj => { if (obj.isMesh) chairMeshes++; });
      furniture[d.def.id] = { triangles: triangles.sort(), anchors: [d.laptopAnchor, d.seatAnchor, d.stage].map(p => p.getWorldPosition(o.player.pos.clone()).toArray()) };
      budgets.push({ id: d.def.id, chairMeshes });
    }
    return { furniture, budgets, meta: { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), dpr: devicePixelRatio, timer: !!timing } };
  });
  setup.meta.browser = browser.version();
  for (const data of Object.values(setup.furniture)) data.triangles = createHash('sha256').update(JSON.stringify(data.triangles)).digest('hex');
  if (process.env.OFFICE_PERF_REFERENCE) assert.deepEqual(setup.furniture, JSON.parse(readFileSync(process.env.OFFICE_PERF_REFERENCE, 'utf8')).furniture, 'static geometry, colors, shadows and anchors match baseline');
  if (!baseline) assert.ok(setup.budgets.every(d => d.chairMeshes === 2), 'chair upholstery and metal draw once each');
  await page.waitForTimeout(3500);
  if (roles.length) assert.equal(await page.evaluate(() => { let count = 0; window.__office.scene.traverse(o => { if (o.userData.interact?.kind === 'role') count++; }); return count; }), roles.length, 'all off-shift characters are rendered');
  const cdp = await page.context().newCDPSession(page), runs = [];
  for (const rate of process.env.OFFICE_PERF_BEHAVIOR_ONLY ? [] : [1, 4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.evaluate(() => { window.auditWalking = true; window.__office.player.keys = new Set(['KeyW']); }); await page.waitForTimeout(800);
    await page.evaluate(() => { window.auditFrames = []; window.auditGpu = []; window.auditEnabled = true; }); await page.waitForTimeout(6000);
    const data = await page.evaluate(() => { window.auditEnabled = false; return { frames: window.auditFrames, gpu: window.auditGpu }; });
    const f = data.frames, phase = {}; for (const frame of f) for (const [key, value] of Object.entries(frame.phase)) phase[key] = (phase[key] || 0) + value / f.length;
    const zRange = Math.max(...f.map(x => x.z)) - Math.min(...f.map(x => x.z)); assert.ok(zRange > 3, 'walking continuously through the clear aisle'); assert.ok(f.every(x => Math.abs(x.x - x.cx) < 1e-6 && Math.abs(x.z - x.cz) < 1e-6), 'first-person camera follows local player');
    const result = { rate, frames: f.length, fps: f.length / 6, frameP95: quantile(f.map(x => x.dt), .95), cpuP50: quantile(f.map(x => x.cpu), .5), cpuP95: quantile(f.map(x => x.cpu), .95), gpuP50: quantile(data.gpu, .5), gpuP95: quantile(data.gpu, .95), framesOver25ms: f.filter(x => x.dt > 25).length, drawCalls: quantile(f.map(x => x.calls), .5), zRange, phase };
    runs.push({ result, ...data }); console.log(JSON.stringify(result));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => { window.auditWalking = false; window.__office.player.keys.clear(); });
  // Real pointer/controller against real desk and board geometry, at desktop and phone width.
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100);
    const checks = await page.evaluate(() => {
      const { ctx, parts } = window.__audit, o = window.__office, p = o.player;
      const vector = (x, y, z) => p.pos.clone().set(x, y, z);
      const aim = (from, at, view = 'first') => { p.view = view; p.pos.set(from.x, 0, from.z); o.camera.position.copy(from); o.camera.lookAt(at); o.camera.updateMatrixWorld(true); for (const entry of ctx.ticks.phases.get('aim').items) entry.fn({ delta: 1 / 60, dt: 1 / 60, t: 0, now: performance.now() }); return parts.pointer.target(); };
      const desk = o.office.desks.get('desk-1'); o.scene.updateMatrixWorld(true);
      const from = desk.group.localToWorld(vector(0, 1.6, 2.4)), at = desk.group.localToWorld(vector(0, .78, 0));
      let hiddenCalls = 0; const hiddenProbe = desk.chair.children[0].clone(); hiddenProbe.visible = false; hiddenProbe.raycast = () => { hiddenCalls++; }; o.office.group.add(hiddenProbe);
      const deskTarget = aim(from, at); hiddenProbe.removeFromParent(); const chairParent = desk.chair.parent; desk.chair.visible = false; const hiddenChair = aim(from, at); desk.chair.visible = true;
      const board = o.office.boardMeshes.issues; const center = board.getWorldPosition(vector(0, 0, 0)); const normal = vector(0, 0, 1).transformDirection(board.matrixWorld); const near = center.clone().addScaledVector(normal, 3); near.y = 1.6;
      const boardTarget = aim(near, center);
      const high = center.clone(); high.y = 3.2; const distant = high.clone().addScaledVector(normal, 15); aim(distant, high, 'third'); document.getElementById('toasts').replaceChildren(); p.onClick({ x: 0, y: 0 });
      const distantClick = document.getElementById('toasts').textContent.includes('Walk closer to that first');
      // Test the server-message path, including a bogus own-position update, with no local movement tick.
      const before = [...p.pos.toArray(), ...o.camera.position.toArray(), p.camYaw, p.lookPitch];
      const peer = { id: o.store.you, name: 'Self', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 }, floor: 'fixture', x: 100, y: 0, z: 100, rotY: 2, moving: true, voice: false, muted: true, sharing: false };
      ctx.messages.dispatch({ t: 'peer.update', peer }); ctx.messages.dispatch({ t: 'peer.move', id: peer.id, x: -100, y: 0, z: -100, rotY: -2, moving: true });
      const after = [...p.pos.toArray(), ...o.camera.position.toArray(), p.camYaw, p.lookPitch];
      document.getElementById('toasts').replaceChildren(); aim(near, center, 'third'); p.onClick({ x: 0, y: 0 });
      return { hiddenCalls, desk: deskTarget?.deskId, hiddenChair: hiddenChair?.deskId, board: boardTarget?.kind, chairParent: chairParent === desk.group, distantClick, ownPoseUnchanged: JSON.stringify(before) === JSON.stringify(after) };
    });
    assert.deepEqual(checks, { hiddenCalls: baseline ? 1 : 0, desk: 'desk-1', hiddenChair: 'desk-1', board: 'issues', chairParent: true, distantClick: true, ownPoseUnchanged: true });
    await page.getByRole('dialog', { name: 'Issues board', exact: true }).waitFor(); await page.waitForTimeout(100);
    await page.screenshot({ path: out + `/board-${width}.png` }); await page.keyboard.press('Escape');
    await page.evaluate(() => { const p = window.__office.player; p.pos.set(-6, 0, 5); p.view = 'first'; p.camYaw = 0; p.lookPitch = 0; p.updateCamera(true); });
    await page.waitForTimeout(100); await page.screenshot({ path: out + `/office-${width}.png` });
  }
  assert.deepEqual(errors, []);
  assert.equal(sent.some(t => /launch|spawn|prompt/.test(t)), false, 'no provider action');
  if (!baseline && runs.length) assert.ok(runs[0].result.drawCalls < (roles.length ? 1450 : 1350), 'static furniture reduces submission work');
  writeFileSync(out + '/report.json', JSON.stringify({ root, baseline, roles: roles.length, meta: setup.meta, furniture: setup.furniture, runs, checks: 'desktop/390 desk, chair visibility, board and own peer update passed', errors }, null, 2));
  console.log('PASS', out + '/report.json');
} finally { await browser.close(); await server.close(); }
