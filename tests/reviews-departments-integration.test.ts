import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Reviews } from '../src/server/reviews.js';

function fixture(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-review-integration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'reviews.json');
  let changes = 0;
  const reviews = new Reviews(dir, () => changes++);
  return { dir, file, reviews, changes: () => changes };
}

const take = { title: 'Homepage', url: 'https://example.invalid/staged', by: 'Builder', floorId: 'project-a', group: 'hero' };

test('new grouped takes allocate distinct versions despite duplicate or custom client labels', (t) => {
  const { dir, reviews } = fixture(t);
  const first = reviews.submit({ ...take, version: 'v1' });
  const second = reviews.submit({ ...take, version: 'v1' });
  const third = reviews.submit({ ...take, version: 'director cut' });
  assert.ok(typeof first !== 'string' && typeof second !== 'string' && typeof third !== 'string');
  assert.deepEqual([first.version, second.version, third.version], ['v1', 'v2', 'v3']);
  assert.notEqual(first.id, second.id);

  const other = reviews.submit({ ...take, floorId: 'project-b', version: 'v99' });
  assert.ok(typeof other !== 'string');
  assert.equal(other.version, 'v1', 'each project has its own series');
  const resumed = new Reviews(dir, () => {});
  const next = resumed.submit({ ...take, version: 'v1' });
  assert.ok(typeof next !== 'string');
  assert.equal(next.version, 'v4', 'allocation continues from persisted history after restart');
});

test('allocating new versions preserves historical labels, including history outside the visible board', (t) => {
  const { dir, file } = fixture(t);
  const history = [
    ...Array.from({ length: 51 }, (_, i) => ({ ...take, id: `other-${i}`, group: 'another-series', version: `v${i + 1}`, at: 100 + i, status: 'accepted' })),
    { ...take, id: 'old-number', version: 'v7', at: 2, status: 'accepted' },
    { ...take, id: 'old-label', version: 'director cut', at: 1, status: 'accepted' },
  ];
  writeFileSync(file, JSON.stringify(history));
  const reviews = new Reviews(dir, () => {});
  assert.ok(!reviews.state().items.some((item) => item.id === 'old-number'));
  const next = reviews.submit({ ...take, version: 'v1' });
  assert.ok(typeof next !== 'string');
  assert.equal(next.version, 'v8');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as typeof history;
  assert.deepEqual(saved.filter((item) => item.id.startsWith('old-')), history.slice(-2), 'existing labels and records are unchanged');
});

for (const stage of ['approved', 'released'] as const) {
  test(`a pending take cannot acquire ${stage} through stage bookkeeping`, (t) => {
    const { file, reviews, changes } = fixture(t);
    const item = reviews.submit(take);
    assert.ok(typeof item !== 'string');
    const beforeState = structuredClone(reviews.state());
    const beforeFile = readFileSync(file, 'utf8');
    const beforeChanges = changes();

    const result = reviews.stage(item.id, stage, 'A nonempty evidence note is not an accepted verdict.', 'Reviewer');
    assert.equal(typeof result, 'string', `${stage} must be refused while the verdict is pending`);
    assert.deepEqual(reviews.state(), beforeState);
    assert.equal(readFileSync(file, 'utf8'), beforeFile);
    assert.equal(changes(), beforeChanges, 'refused transitions do not publish a changed state');
  });
}

test('acceptance does not release a take; a later evidence-backed release preserves its verdict', (t) => {
  const { dir, file, reviews } = fixture(t);
  const item = reviews.submit(take);
  assert.ok(typeof item !== 'string');
  const accepted = reviews.resolve(item.id, true, 'Approved this exact staged take.', 'Reviewer');
  assert.ok(typeof accepted !== 'string');
  assert.equal(accepted.item.status, 'accepted');
  assert.ok(!accepted.item.stages?.some((entry) => entry.stage === 'released'), 'approval alone is not release evidence');
  const verdict = structuredClone(accepted.item.verdict);
  const acceptedFile = readFileSync(file, 'utf8');
  assert.equal(typeof reviews.stage(item.id, 'released', '', 'Publisher'), 'string');
  assert.equal(readFileSync(file, 'utf8'), acceptedFile, 'release still requires explicit evidence');

  const released = reviews.stage(item.id, 'released', 'Deployed revision abc123; checked the published URL.', 'Publisher');
  assert.ok(typeof released !== 'string');
  assert.equal(released.status, 'accepted');
  assert.deepEqual(released.verdict, verdict);
  assert.equal(released.stages?.at(-1)?.stage, 'released');
  assert.equal(released.stages?.at(-1)?.by, 'Publisher');
  assert.match(released.stages?.at(-1)?.note ?? '', /abc123/);
  assert.deepEqual(new Reviews(dir, () => {}).state().items.find((entry) => entry.id === item.id), released);
});

test('a rejected take cannot be moved to any pipeline stage or accepted afterward', (t) => {
  const { file, reviews, changes } = fixture(t);
  const item = reviews.submit(take);
  assert.ok(typeof item !== 'string');
  assert.equal(typeof reviews.resolve(item.id, false, 'The take does not match the approved brief.', 'Reviewer'), 'object');
  const beforeState = structuredClone(reviews.state());
  const beforeFile = readFileSync(file, 'utf8');
  const beforeChanges = changes();
  for (const stage of ['built', 'verified', 'staged', 'approved', 'released'] as const) {
    assert.equal(typeof reviews.stage(item.id, stage, 'Attempted later evidence.', 'Publisher'), 'string');
  }
  assert.equal(typeof reviews.resolve(item.id, true, 'Changed my mind.', 'Reviewer'), 'string');
  assert.deepEqual(reviews.state(), beforeState);
  assert.equal(readFileSync(file, 'utf8'), beforeFile);
  assert.equal(changes(), beforeChanges);
});
