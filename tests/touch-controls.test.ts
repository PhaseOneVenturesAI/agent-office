import test from 'node:test';
import assert from 'node:assert/strict';
import { stickMovement, lookDrag, touchLayout, touchFirst } from '../src/client/features/touch/math.js';

test('stick is camera-relative, analog, dead-zoned and capped diagonally', () => {
  assert.deepEqual(stickMovement(0, 0, 40), { x: 0, z: 0 });
  assert.deepEqual(stickMovement(2, 2, 40), { x: 0, z: 0 });
  assert.deepEqual(stickMovement(0, -40, 40), { x: 0, z: -1 });
  const half = stickMovement(0, -21.6, 40);
  assert.ok(Math.abs(half.z + 0.5) < 1e-9);
  const diag = stickMovement(100, 100, 40);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.z) - 1) < 1e-9);
  assert.ok(diag.x > 0 && diag.z > 0);
  assert.deepEqual(stickMovement(10, 10, 0), { x: 0, z: 0 });
});

test('look drag matches mouse yaw and pitch direction and clamps both views', () => {
  const look = lookDrag(0, 0, 40, 20, 400);
  assert.ok(Math.abs(look.yaw + 0.18) < 1e-9);
  assert.ok(Math.abs(look.pitch + 0.09) < 1e-9);
  assert.equal(lookDrag(0, 0, 0, 10000, 320).pitch, -1.45);
  assert.equal(lookDrag(0, 0, 0, -10000, 744).pitch, 1.45);
  assert.equal(lookDrag(0, 0.4, 0, 10000, 744, true).pitch, 1.3);
  assert.equal(lookDrag(0, 0.4, 0, -10000, 744, true).pitch, 0.05);
  assert.deepEqual(lookDrag(0, 0, 40, 20, 400), lookDrag(0, 0, 80, 40, 800));
});

for (const [width, height] of [[320, 720], [390, 844], [744, 1000], [1000, 744], [720, 320]]) {
  test(`touch layout fits ${width}×${height}, with safe areas and usable targets`, () => {
    const l = touchLayout(width, height, { top: 24, left: 10, right: 10, bottom: 34 });
    assert.ok(l.left + l.stick + 24 < width - l.right - l.action);
    assert.ok(l.bottom + l.row < height);
    assert.ok(l.action >= 72 && l.stick >= 96);
    assert.equal(l.bottom, 46);
    assert.equal(l.short, Math.min(width, height));
  });
}

test('landscape look area fits beside HUD instead of disappearing above it', async () => {
  const { lookRegion } = await import('../src/client/features/touch/math.js');
  const r = lookRegion(720, 94, 224, 720, [
    { left: 12, right: 192, top: 136, bottom: 172 },
    { left: 230, right: 490, top: 80, bottom: 124 },
  ]);
  assert.ok(r.left > 490);
  assert.ok(r.width >= 72 && r.height >= 44);
});

test('touch controls show when touch is the main pointer, even if iOS also reports a fine pointer', () => {
  assert.equal(touchFirst(true, 5), true); // iPhone Duo Safari: pointer coarse, any-pointer fine
  assert.equal(touchFirst(false, 10), false); // touchscreen laptop: mouse is primary
  assert.equal(touchFirst(true, 0), false);
});
