import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerNameplate } from '../src/client/world/character/worker-nameplate.js';

test('owner label reuses textures until verified text changes and disposes replaced labels', t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const drawn: string[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => ({ measureText: (s: string) => ({ width: s.length * 18 }), beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText(s: string) { drawn.push(s); } }) }) } });
  t.after(() => before ? Object.defineProperty(globalThis, 'document', before) : Reflect.deleteProperty(globalThis, 'document'));
  const label = new WorkerNameplate(); label.setName('Issues agent'); label.setOwner('Info');
  const children = [...label.children]; let disposed = 0;
  (children[1] as any).material.map.addEventListener('dispose', () => disposed++);
  for (let i = 0; i < 20; i++) { label.setName('Issues agent'); label.setOwner('Info'); }
  assert.deepEqual(label.children, children); assert.deepEqual(drawn, ['Issues agent', 'Owner: Info']);
  label.setOwner('Former account'); assert.equal(disposed, 1); assert.equal(label.children.length, 2);
  label.setName('☠️ Issues agent'); assert.equal(label.children.length, 2);
  label.setOwner(undefined); assert.equal(drawn.at(-1), 'Owner: Unknown');
  label.setOwner('Office'); assert.equal(drawn.at(-1), 'Owner: Office');
  label.dispose(); assert.equal(label.children.length, 0);
});
