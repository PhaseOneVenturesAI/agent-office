import test from 'node:test';
import assert from 'node:assert/strict';
import { Deliveries, WATCH_LEASE_MS } from '../src/server/delivery/index.js';
import { normalizeRuns } from '../src/server/delivery/runs.js';
import { deliveryHandlers, deliveryHooks } from '../src/server/ws/handlers/delivery.js';

const ref = { repo: 'owner/repo', sha: 'a'.repeat(40), dir: '/fixture', number: 1 };
const raw = { id: 10, run_attempt: 1, head_sha: ref.sha, name: 'CI', status: 'in_progress', event: 'workflow_dispatch', updated_at: '2026-11-23T00:00:00Z', conclusion: null, html_url: 'https://attacker.invalid/' };
const runs = normalizeRuns({ workflow_runs: [raw] }, ref);

test('only real matching head metadata is associated; manual checkout/config is never inferred', () => {
  assert.equal(runs[0].configuration, 'incomplete');
  assert.equal(runs[0].url, 'https://github.com/owner/repo/actions/runs/10');
  assert.equal(normalizeRuns({ workflow_runs: [{ ...raw, head_sha: 'b'.repeat(40) }] }, ref).length, 0);
  assert.equal(normalizeRuns({ workflow_runs: [raw, raw] }, ref).length, 1);
  assert.notEqual(normalizeRuns({ workflow_runs: [{ ...raw, run_attempt: 2 }] }, ref)[0].key, runs[0].key);
  assert.throws(() => normalizeRuns({}, ref));
});

test('simultaneous readers share one flight; same branch new SHA is distinct; cooldown survives failures', async () => {
  let now = 1000, count = 0;
  let finish!: (value: typeof runs) => void;
  const d = new Deliveries(() => { count++; return new Promise((resolve) => { finish = resolve; }); }, () => now);
  try {
    const a = d.refresh(ref), b = d.refresh({ ...ref, number: 2 });
    assert.equal(a, b);
    await Promise.resolve(); assert.equal(count, 1);
    finish(runs); await a;
    await d.refresh(ref); assert.equal(count, 1);
    const newHead = d.refresh({ ...ref, sha: 'b'.repeat(40) });
    await Promise.resolve(); assert.equal(count, 2); finish([]); await newHead;
    now += 60_001;
    const next = d.refresh(ref); await Promise.resolve(); assert.equal(count, 3); finish(runs); await next;
  } finally { d.close(); }
  const errors = new Deliveries(async () => { count++; throw new Error('token=secret'); }, () => now);
  try { await errors.refresh(ref); const before = count; await errors.refresh(ref); assert.equal(count, before); assert.equal(errors.state(ref, 'x').error?.includes('secret'), false); } finally { errors.close(); }
});

test('watch claims are atomic; rivals cannot renew/release; expiry and disconnect release without CI execution', async () => {
  let now = 1000, calls = 0;
  const d = new Deliveries(async () => { calls++; return runs; }, () => now);
  try {
    await d.refresh(ref);
    const claim = await Promise.all(['alice', 'bob'].map((id) => Promise.resolve().then(() => d.claim(ref, runs[0].key, { id, name: id }))));
    assert.equal(claim.filter((x) => !x).length, 1);
    const end = d.state(ref, 'alice').runs[0].watcher!.expiresAt;
    d.renew(ref, runs[0].key, 'bob'); d.release(ref, runs[0].key, 'bob');
    assert.equal(d.state(ref, 'alice').runs[0].watcher!.expiresAt, end);
    assert.match(d.claim(ref, 'invented', { id: 'bob', name: 'bob' })!, /existing/);
    now += 60_001; d.tick(); await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 2);
    now += WATCH_LEASE_MS;
    assert.equal(d.claim(ref, runs[0].key, { id: 'bob', name: 'bob' }), undefined);
    assert.equal(d.state(ref, 'bob').runs[0].watcher?.mine, true);
    d.releaseOwner('bob'); assert.equal(d.state(ref, 'bob').runs[0].watcher, undefined);
  } finally { d.close(); }
});

test('handlers attach to server-known PRs only; floor exit and moved heads stop reads and release owners', async () => {
  const d = new Deliveries(async () => runs), messages: any[] = [], warnings: string[] = [];
  const c: any = { id: 'viewer', peer: { name: 'Name' } };
  const floor: any = { id: 'floor-a', dir: '/fixture', def: { repo: ref.repo }, github: { pulls: { items: [{ number: 1, headRefOid: ref.sha }] } } };
  let here: any = floor;
  const ctx: any = { deliveries: d, floorOf: () => here, meOf: () => ({ account: { name: 'Known account' } }), sendTo: (_: unknown, m: unknown) => messages.push(m), warn: (_: unknown, warning: string) => { if (warning) warnings.push(warning); } };
  try {
    deliveryHandlers['delivery.open'](ctx, c, { t: 'delivery.open', number: 999 });
    assert.equal(messages.length, 0);
    deliveryHandlers['delivery.open'](ctx, c, { t: 'delivery.open', number: 1 });
    await d.refresh(ref);
    deliveryHandlers['delivery.watch'](ctx, c, { t: 'delivery.watch', runKey: runs[0].key });
    assert.equal(d.state(ref, c.id).runs[0].watcher?.name, 'Known account');
    floor.github.pulls.items[0].headRefOid = 'b'.repeat(40);
    deliveryHandlers['delivery.refresh'](ctx, c, { t: 'delivery.refresh' });
    assert.equal(d.state(ref, c.id).runs[0].watcher, undefined);
    assert.match(warnings.at(-1)!, /head changed/);
    here = undefined; deliveryHooks.leaving!(ctx, c, floor);
    const length = messages.length; d.tick(); assert.equal(messages.length, length);
  } finally { d.close(); }
});
