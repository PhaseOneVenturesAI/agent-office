import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { OWNER_PALETTE, defaultOwnerColor, isOwnerColor, personalRole, personalName, helperName, outfitFor } from '../src/shared/personal-agents/appearance.js';
import { CubbyRecords } from '../src/server/cubbies/records.js';
import { snapshot } from '../src/server/cubbies/snapshot.js';
import { Worker } from '../src/client/world/character/worker.js';
import { PersonalPerson } from '../src/client/features/cubbies/personal-agents/person.js';
import { PersonalHelper } from '../src/client/features/cubbies/personal-agents/helper.js';

const color = '#1f8a7a';
test('owner palette is closed and defaults are stable across accounts and reloads', () => {
  for (const p of OWNER_PALETTE) assert.equal(isOwnerColor(p.color), true);
  for (const bad of ['', '#ffffff', '#1F8A7A', 'red', null, {}, '<script>']) assert.equal(isOwnerColor(bad), false);
  assert.equal(defaultOwnerColor('alice'), '#4a5568');
  assert.ok(new Set(Array.from({ length: 100 }, (_, i) => defaultOwnerColor(`account-${i}`))).size === 8);
});
test('roles select approved outfits, with a plain fallback and main-lead default', () => {
  assert.equal(personalRole({}, true), 'CEO');
  assert.equal(personalRole({ harnessRole: 'marketing lead' }), 'Marketing');
  assert.equal(personalRole({ department: 'Design' }), 'Design');
  assert.equal(personalRole({ designer: true }), 'Design');
  assert.equal(personalRole({ leadTitle: 'Product lead' }), 'Product');
  assert.equal(personalRole({ department: 'Legal' }, true), 'Agent');
  assert.equal(personalRole({ harnessRole: 'builder' }), 'Agent');
  assert.deepEqual(outfitFor('CEO', color), { top: '#303449', accent: color, prop: null });
  assert.equal(outfitFor('Marketing', color).prop, 'megaphone');
  assert.equal(outfitFor('Design', color).top, '#fff3da');
  assert.equal(outfitFor('Product', color).prop, 'clipboard');
  assert.equal(outfitFor('Agent', color).top, color);
  assert.equal(personalName(' Jonathan Diaz ', 'Plimbo', 'Marketing'), "Jonathan's · Plimbo Marketing");
  assert.equal(helperName('codex', 'Fix checkout'), 'Codex · Fix checkout');
});
test('saved account colour migrates, persists across cubbies, and rolls back', t => {
  const dir = mkdtempSync(path.join(import.meta.dirname, '.personal-records-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = [0, 1].map(slot => ({ id: `c${slot}`, floorId: `f${slot}`, owner: 'alice', nodeId: `n${slot}`, slot, leadName: 'Nova', look: { skin: 0, hair: 0, style: 0 }, ownerColor: 'arbitrary' }));
  writeFileSync(path.join(dir, 'cubbies.json'), JSON.stringify(rows));
  const records = new CubbyRecords(dir, true);
  assert.equal(records.color('alice'), defaultOwnerColor('alice'));
  const undo = records.setColor('alice', color);
  assert.ok([...records.rows.values()].every(r => r.ownerColor === color));
  undo(); assert.equal(records.color('alice'), defaultOwnerColor('alice'));
  records.setColor('alice', color); records.save();
  const restored = new CubbyRecords(dir, true);
  assert.ok([...restored.rows.values()].every(r => r.ownerColor === color));
});
test('snapshot keeps bounded role metadata without forwarding arbitrary fields', () => {
  const agent = { id: 'marketing', tool: 'Claude', role: 'lead', department: 'Marketing', harnessRole: 'lead', leadTitle: 'Marketing lead', status: 'working', secret: 'no' };
  const result = snapshot({ agents: [agent], observedAt: 100, floorId: 'f' }, 100)!;
  assert.equal(result.agents[0].department, 'Marketing');
  assert.equal(result.agents[0].leadTitle, 'Marketing lead');
  assert.equal((result.agents[0] as any).secret, undefined);
});

function canvasFixture(t: { after(fn: () => void): void }) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: unknown[][] = [];
  const context: any = new Proxy({ measureText: (s: string) => ({ width: s.length * 18 }), fillText(s: string) { calls.push(['text', s, this.fillStyle]); }, stroke() { calls.push(['border', this.strokeStyle]); } }, { get: (o, key) => key in o ? o[key] : () => {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => context }) } });
  t.after(() => old ? Object.defineProperty(globalThis, 'document', old) : Reflect.deleteProperty(globalThis, 'document'));
  return calls;
}
function materials(root: THREE.Object3D) {
  const result: unknown[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh) result.push([o.geometry.type, ...[o.material].flat().map((m: any) => [m.type, m.color?.getHexString(), m.emissive?.getHexString()])]); });
  return result;
}
test('personal outfits and helper accents do not mutate an office worker or its nameplate', t => {
  const calls = canvasFixture(t);
  const office = new Worker('Office worker', '#4a7dbd'); office.setOwner('Office');
  const before = materials(office.root), label = [...calls];
  assert.ok(label.some(row => row[0] === 'text' && row[1] === 'Owner: Office'));
  assert.ok(label.some(row => row[0] === 'border' && row[1] === '#fffaf3'));
  const person = new PersonalPerson('Lead', color, { skin: 0, hair: 0, style: 0 });
  for (const role of ['CEO', 'Marketing', 'Design', 'Product', 'Agent'] as const) {
    person.setUniform('Jonathan', 'Plimbo', role, color);
    assert.equal((person.root.getObjectByName('owner-band') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>).material.color.getHexString(), color.slice(1));
    assert.equal(person.root.userData.personal.label, personalName('Jonathan', 'Plimbo', role));
  }
  for (const tool of ['Codex', 'Kimi']) {
    const bot = new PersonalHelper(tool); bot.dress(tool, 'Build', color); bot.setStatus('working', false); bot.update(0.1, 1);
    assert.equal((bot.root.getObjectByName('owner-antenna-tip') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>).material.color.getHexString(), color.slice(1));
    bot.dispose();
  }
  assert.deepEqual(materials(office.root), before);
  calls.length = 0;
  const another = new Worker('Office worker', '#4a7dbd'); another.setOwner('Office');
  assert.deepEqual(materials(another.root), before); assert.deepEqual(calls, label);
  // Frozen material and canvas-drawing baseline from the unchanged office Worker.
  assert.equal(createHash('sha256').update(JSON.stringify([before, label])).digest('hex'), '7bb90577aaadb15d9e1108ea7d5a17321469c5a92a9ada8fd7b72a1f6fc1adfa');
  person.dispose(); office.dispose(); another.dispose();
});
