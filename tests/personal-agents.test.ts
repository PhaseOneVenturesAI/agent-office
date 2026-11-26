import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { OWNER_PALETTE, savedOwnerColor, defaultOwnerColor, isOwnerColor, personalRole, personalName, helperName, outfitFor } from '../src/shared/personal-agents/appearance.js';
import { CubbyRecords } from '../src/server/cubbies/records.js';
import { snapshot } from '../src/server/cubbies/snapshot.js';
import { Worker } from '../src/client/world/character/worker.js';
import { PersonalPerson } from '../src/client/features/cubbies/personal-agents/person.js';
import { PersonalHelper } from '../src/client/features/cubbies/personal-agents/helper.js';

const color = '#0f7a6b';
test('owner palette is closed and defaults are stable across accounts and reloads', () => {
  for (const p of OWNER_PALETTE) assert.equal(isOwnerColor(p.color), true);
  for (const bad of ['', '#ffffff', '#1F8A7A', 'red', null, {}, '<script>']) assert.equal(isOwnerColor(bad), false);
  assert.equal(defaultOwnerColor('alice'), '#414c60');
  assert.ok(new Set(Array.from({ length: 100 }, (_, i) => defaultOwnerColor(`account-${i}`))).size === 8);
});
test('every swatch meets 3:1 graphic contrast on the office cream; Blue remains Jonathan’s cobalt', () => {
  const luminance = (hex: string) => {
    const v = hex.slice(1).match(/../g)!.map(n => parseInt(n, 16) / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  };
  for (const p of OWNER_PALETTE) for (const [surface, minimum] of [['#f4ecdf', 3]] as const) {
    const a = luminance(p.color), b = luminance(surface);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= minimum, `${p.name} against ${surface}`);
  }
  assert.equal(OWNER_PALETTE.find(p => p.name === 'Blue')?.color, '#1e40c8');
  const old = ['#6c4fd8', '#1f8a7a', '#d1495b', '#e07a3f', '#1e40c8', '#3f8f4f', '#c94f8a', '#4a5568'];
  old.forEach((c, i) => assert.equal(savedOwnerColor(c), OWNER_PALETTE[i].color));
  assert.equal(savedOwnerColor('invalid'), undefined);
});
test('roles select approved outfits, with a plain fallback and main-lead default', () => {
  assert.equal(personalRole({}, true), 'CEO');
  assert.equal(personalRole({ harnessRole: 'marketing lead' }), 'Marketing');
  assert.equal(personalRole({ department: 'Design' }), 'Design');
  assert.equal(personalRole({ designer: true }), 'Design');
  assert.equal(personalRole({ leadTitle: 'Product lead' }), 'Product');
  assert.equal(personalRole({ department: 'Legal' }, true), 'Agent');
  assert.equal(personalRole({ harnessRole: 'builder' }), 'Agent');
  assert.deepEqual(outfitFor('CEO', color), { top: color, accent: color, prop: null });
  assert.equal(outfitFor('Marketing', color).prop, 'megaphone');
  assert.equal(outfitFor('Design', color).top, color);
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
  rows.forEach(r => r.ownerColor = '#1f8a7a');
  writeFileSync(path.join(dir, 'cubbies.json'), JSON.stringify(rows));
  assert.equal(new CubbyRecords(dir, true).color('alice'), color, 'saved teal retains its selected swatch');
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
const meshColor = (root: THREE.Object3D, name: string) => (root.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>).material.color.getHexString();
function onePlate(root: THREE.Object3D) {
  const sprites: THREE.Sprite[] = [];
  root.traverse(o => { if (o instanceof THREE.Sprite) sprites.push(o); });
  assert.equal(sprites.length, 1, 'exactly one sprite, including hidden labels');
  assert.equal(sprites[0].name, 'personal-nameplate');
  assert.equal(sprites[0].userData.lines.length, 2);
  return sprites[0];
}
function ringCheck(root: THREE.Object3D, diameter: number) {
  const ring = root.getObjectByName('owner-ring') as THREE.Mesh<THREE.RingGeometry, THREE.MeshToonMaterial>;
  assert.equal(ring.geometry.parameters.outerRadius * 2, diameter);
  assert.equal(ring.material.color.getHexString(), color.slice(1));
  assert.equal(ring.material.emissive.getHexString(), color.slice(1));
  assert.ok(ring.material.emissiveIntensity > 0);
  assert.equal(ring.castShadow, false); assert.equal(ring.receiveShadow, false);
  root.updateWorldMatrix(true, true);
  assert.ok(Math.abs(ring.getWorldPosition(new THREE.Vector3()).y - 0.035) < 1e-6, 'ring rests on the floor');
  assert.ok(Math.abs(new THREE.Box3().setFromObject(ring).getSize(new THREE.Vector3()).x - diameter) < 1e-6, 'seat scaling does not shrink ring');
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
    assert.equal(meshColor(person.root, 'owner-garment'), color.slice(1));
    if (role === 'CEO') { assert.equal(meshColor(person.root, 'shirt-front'), 'f4ecdf'); assert.equal(meshColor(person.root, 'dark-tie'), '2b2d42'); assert.ok(person.root.getObjectByName('blazer-lapel')); }
    if (role === 'Marketing') { assert.ok(person.root.getObjectByName('hood')); assert.ok(person.root.getObjectByName('megaphone')); }
    if (role === 'Design') { assert.equal(meshColor(person.root, 'smock'), color.slice(1)); assert.equal(meshColor(person.root, 'owner-beret'), 'f4ecdf'); }
    if (role === 'Product') { assert.equal(meshColor(person.root, 'chest-band'), 'f4ecdf'); assert.ok(person.root.getObjectByName('clipboard')); }
    person.setDoing('E to talk · Mac mini'); person.update(0.1, 1);
    assert.deepEqual(onePlate(person.root).userData.lines, [personalName('Jonathan', 'Plimbo', role), 'E to talk · Mac mini']);
    ringCheck(person.root, 0.9);
  }
  for (const tool of ['Codex', 'Kimi']) {
    const bot = new PersonalHelper(tool); bot.dress(tool, 'Build', color); bot.setStatus('working', false); bot.update(0.1, 1);
    assert.equal((bot.root.getObjectByName('owner-antenna-tip') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>).material.color.getHexString(), color.slice(1));
    assert.equal(meshColor(bot.root, 'personal-body'), 'f4ecdf');
    assert.equal(meshColor(bot.root, 'provider-badge'), tool === 'Codex' ? '4a7dbd' : '3f8f4f');
    assert.equal(meshColor(bot.root, 'owner-band'), color.slice(1));
    const seat = new THREE.Group(); seat.position.y = 0.36; seat.scale.setScalar(0.82); seat.add(bot.root);
    for (const status of ['working', 'idle', 'offline', 'needs_input'] as const) {
      bot.setStatus(status, false); bot.setTask({ name: 'Changed task' }); bot.update(0.1, 2);
      onePlate(bot.root); ringCheck(bot.root, 0.7);
    }
    bot.dispose();
  }
  assert.equal(office.root.getObjectByName('owner-ring'), undefined);
  assert.deepEqual(materials(office.root), before);
  calls.length = 0;
  const another = new Worker('Office worker', '#4a7dbd'); another.setOwner('Office');
  assert.deepEqual(materials(another.root), before); assert.deepEqual(calls, label);
  // Frozen material and canvas-drawing baseline from the unchanged office Worker.
  assert.equal(createHash('sha256').update(JSON.stringify([before, label])).digest('hex'), '7bb90577aaadb15d9e1108ea7d5a17321469c5a92a9ada8fd7b72a1f6fc1adfa');
  person.dispose(); office.dispose(); another.dispose();
});
