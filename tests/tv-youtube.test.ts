import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkTvUrl } from '../src/shared/tv.js';
import { TvSet } from '../src/server/tvset.js';

test('only YouTube links go on the TV', () => {
  assert.deepEqual(checkTvUrl(' https://youtu.be/dQw4w9WgXcQ?si=x '), { id: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ?si=x' });
  assert.ok('error' in checkTvUrl(''));
  assert.ok('error' in checkTvUrl('https://example.com/video.mp4'));
  assert.ok('error' in checkTvUrl('not a link'));
  assert.ok('error' in checkTvUrl(`https://youtu.be/dQw4w9WgXcQ?x=${'a'.repeat(3000)}`));
});

test('a floor TV keeps its video across a restart, and turns off', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tv-'));
  try {
    const tv = new TvSet(dir);
    assert.equal(tv.state().video, null);
    assert.ok('error' in tv.play('https://example.com', 'Ann'));
    assert.deepEqual(tv.play('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Ann'), { ok: true });
    const v = tv.state().video!;
    assert.equal(v.id, 'dQw4w9WgXcQ');
    assert.equal(v.by, 'Ann');
    assert.ok(v.elapsed >= 0);

    const again = new TvSet(dir).state().video!;
    assert.equal(again.id, 'dQw4w9WgXcQ');
    assert.equal(again.startedAt, v.startedAt);

    assert.equal(tv.stop(), true);
    assert.equal(tv.stop(), false);
    assert.equal(new TvSet(dir).state().video, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
