import { png } from './support/draft-board.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanPitch } from '../src/shared/pitch/clean.js';
import { localPitch } from '../src/server/cubbies/local/pitch.js';
import { pitchSpend } from '../src/shared/pitch/flow.js';
import { PitchDecisions } from '../src/server/pitch/decisions.js';
import { startPitch, pitchAction } from '../src/server/pitch/actions.js';
import { pitchChanged, pitchView } from '../src/server/ws/handlers/pitch.js';
import { activityOffice } from './support/hq-activity.js';
import type { Pitch, PitchAction } from '../src/shared/protocol/pitch.js';
const base: Pitch = { department: 'Marketing', lead: 'Marketing lead', status: 'building', version: 'v1', pieces: [],
  brief: { title: 'Launch', audience: 'Parents', goal: 'Save time', constraints: ['No paid generation'] },
  directions: [{ id: 'a', title: 'Gallery', summary: 'Quiet' }, { id: 'b', title: 'Story', summary: 'Warm' }, { id: 'c', title: 'Demo', summary: 'Clear' }],
  budget: { session: 10 }, costs: [{ id: 'one', tool: 'Tool', what: 'One render', estimate: 6, status: 'asked' }, { id: 'two', tool: 'Tool', what: 'Another render', estimate: 5, status: 'asked' }] };
function folder(t: any) { mkdirSync('.paradev', { recursive: true }); const dir = mkdtempSync(path.resolve('.paradev/pitch-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const action = (action: PitchAction['action'], id: string): PitchAction => ({ t: 'pitch.action', project: 'Plimbo', version: 'v1', action, id });
test('additive cleaner caps publication fields and drops junk at local and shared boundaries', t => {
  const raw: any = { ...base, secret: 'junk', brief: { title: 't'.repeat(500), audience: 'a'.repeat(600), goal: 'g'.repeat(600), constraints: Array(20).fill('c'.repeat(500)), bad: 'junk' },
    directions: [...base.directions!, { id: 'd', title: 'D' }], costs: Array.from({ length: 40 }, (_, i) => ({ ...base.costs![0], id: `c${i}`, extra: 'junk' })) };
  const p = cleanPitch(raw)!;
  assert.equal(p.brief!.title.length, 120); assert.equal(p.brief!.audience.length, 300); assert.equal(p.brief!.constraints.length, 8);
  assert.equal(p.directions!.length, 3); assert.equal(p.costs!.length, 24); assert.doesNotMatch(JSON.stringify(p), /junk/); assert.deepEqual(cleanPitch(p), p);
  const dir = folder(t); mkdirSync(path.join(dir, '.agent-office')); writeFileSync(path.join(dir, '.agent-office/pitch.json'), JSON.stringify(raw));
  assert.deepEqual(localPitch(dir).pitch, p);
  mkdirSync(path.join(dir, '.agent-office/pitch')); writeFileSync(path.join(dir, '.agent-office/pitch/direction.png'), png);
  raw.directions[0].image = 'pitch/direction.png'; writeFileSync(path.join(dir, '.agent-office/pitch.json'), JSON.stringify(raw));
  const local = localPitch(dir); assert.equal(local.images.size, 1); assert.ok(local.pitch!.directions![0].image?.hash);
  raw.directions[0].image = '../private.png'; writeFileSync(path.join(dir, '.agent-office/pitch.json'), JSON.stringify(raw));
  assert.equal(localPitch(dir).pitch!.directions![0].image, undefined);
  assert.deepEqual(cleanPitch({ ...base, costs: [{ ...base.costs![0], estimate: Infinity }, { ...base.costs![0], id: '../bad' }], budget: { session: -1 } })!.costs, []);
  assert.equal(cleanPitch({ ...base, budget: { session: '10' } })!.budget, undefined);
  assert.equal(cleanPitch({ ...base, directions: [{ id: 'a', title: 'A', image: 'https://secret' }, { id: 'a', title: 'Dup' }] })!.directions!.length, 1);
});
test('decision ledger reserves budget, refuses repeated picks and OKs, never invents spent, survives restart and omitted costs', t => {
  const dir = folder(t), ledger = new PitchDecisions(dir), sent: string[] = [];
  ledger.act('owner', 'Plimbo', base, action('pick', 'a'), text => sent.push(text));
  assert.throws(() => ledger.act('owner', 'Plimbo', base, action('pick', 'b'), () => {}), /already picked/);
  ledger.act('owner', 'Plimbo', base, action('ok', 'one'), text => sent.push(text));
  assert.equal(ledger.view('owner', 'Plimbo', base).costs![0].spent, undefined);
  assert.throws(() => ledger.act('owner', 'Plimbo', base, action('ok', 'two'), () => {}), /remaining session budget/);
  assert.throws(() => ledger.act('owner', 'Plimbo', base, action('ok', 'one'), () => {}), /unanswered/);
  ledger.act('owner', 'Plimbo', base, action('decline', 'two'), text => sent.push(text));
  assert.deepEqual(sent, ['Jonathan picked direction Gallery (a)', 'Jonathan OKs cost one (One render, up to $6) for this one call', 'Jonathan declines cost two']);
  assert.equal(pitchSpend(new PitchDecisions(dir).view('owner', 'Plimbo', { ...base, costs: [] })).remaining, 4);
  const spent = ledger.view('owner', 'Plimbo', { ...base, costs: [{ ...base.costs![0], status: 'spent', spent: 4 }] });
  assert.equal(pitchSpend(spent).spent, 4); assert.equal(pitchSpend(spent).remaining, 6);
  assert.equal(pitchSpend(ledger.view('owner', 'Plimbo', { ...base, costs: [] })).spent, 4);
  assert.equal(pitchSpend({ ...base, budget: { session: .009 }, costs: [] }).remaining, 0);
  assert.throws(() => ledger.act('owner', 'Plimbo', { ...base, version: 'v2' }, action('pick', 'a'), () => { throw Error('offline'); }), /offline/);
  assert.equal(ledger.view('owner', 'Plimbo', { ...base, version: 'v2' }).picked, undefined);
});
test('fake linked node: owner-only start/Pick/OK/Decline, exact lead.send texts and department target, manager read-only, coworker private', t => {
  const dir = folder(t), f = activityOffice(dir); t.after(f.close); f.admit();
  const publish = (p: Pitch = base) => f.link.frame({ t: 'hq.snapshot', computerId: 'test-mac', observedAt: Date.now(), projects: [{ project: { name: 'Plimbo', repo: 'owner/plimbo', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }] }, agents: [], pitch: p }] });
  publish();
  const owner = f.client('owner'), manager = f.client('manager'), coworker = f.client('coworker');
  for (const c of [manager, coworker, { ...owner, out: true }]) {
    assert.throws(() => startPitch(f.ctx, c, 'Plimbo', 0), /Only the HQ owner/);
    for (const a of ['pick', 'ok', 'decline'] as const) assert.throws(() => pitchAction(f.ctx, c, action(a, a === 'pick' ? 'a' : 'one')), /Only the HQ owner/);
  }
  const reply = () => { const frame = f.link.sent.filter((m: any) => m.t === 'lead.send').at(-1); f.link.frame({ t: 'lead.reply', id: frame.id, text: 'Received' }); return frame; };
  startPitch(f.ctx, owner, 'Plimbo', 0);
  const start = reply(); assert.deepEqual(start.target, { project: 'Plimbo', department: 0 });
  assert.equal(start.text, 'Start a pitch brief for Plimbo Marketing: ask Jonathan 3–5 short questions here, then write the brief to `.agent-office/pitch.json` `brief` and pin 2–3 cheap directions in `directions`.');
  pitchAction(f.ctx, owner, action('pick', 'a')); assert.equal(reply().text, 'Jonathan picked direction Gallery (a)');
  pitchAction(f.ctx, owner, action('ok', 'one')); assert.equal(reply().text, 'Jonathan OKs cost one (One render, up to $6) for this one call');
  assert.throws(() => pitchAction(f.ctx, owner, action('ok', 'two')), /remaining session budget/);
  pitchAction(f.ctx, owner, action('decline', 'two')); assert.equal(reply().text, 'Jonathan declines cost two');
  assert.equal(pitchView(f.ctx, f.ctx.floorOf(manager), manager)?.readOnly, true);
  assert.equal(pitchView(f.ctx, f.ctx.floorOf(coworker), coworker), undefined);
  const projectOwner = f.client('owner', 'plimbo');
  assert.equal(pitchView(f.ctx, f.ctx.floorOf(projectOwner), projectOwner)?.displayFloorId, 'plimbo');
  f.client('owner');
  const events: any[] = []; f.ctx.sendTo = (c, m) => { events.push([c.accountId, m]); };
  publish({ ...base, status: 'ready' }); pitchChanged(f.ctx); pitchChanged(f.ctx); publish({ ...base, status: 'ready' }); pitchChanged(f.ctx);
  const ready = events.filter(([,m]) => m.t === 'pitch.ready'); assert.equal(ready.length, 1); assert.equal(ready[0][0], 'owner');
  assert.equal(new PitchDecisions(dir).ready('owner', 'Plimbo', { ...base, status: 'ready' }), false);
});
