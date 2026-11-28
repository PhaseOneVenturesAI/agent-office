import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HQTalk } from '../src/server/hq/talk.js';
import { headlessIdle } from '../src/server/hq/local/headless-status.js';
import { cleanProjectResult } from '../src/shared/protocol/studio.js';
import { floorLeads } from '../src/client/lite-leads.js';
function dir(t: any) { mkdirSync('.paradev', { recursive: true }); const d = mkdtempSync(path.resolve('.paradev/greet-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }
const id = '11111111-1111-4111-8111-111111111111';

test('a started lead\'s first reply becomes the opening line of its owner-only conversation', t => {
  const talk = new HQTalk(dir(t), o => o === 'owner', () => 'node', () => true, () => {}, () => 5);
  talk.greet('owner', 'project:Phase One:ceo', 'Hi Jonathan. What are we building?');
  talk.greet('manager', 'project:Phase One:ceo', 'not the owner');
  assert.deepEqual(talk.view('owner', 'project:Phase One:ceo', 'owner')?.map(l => [l.role, l.text, l.state]), [['assistant', 'Hi Jonathan. What are we building?', 'replied']]);
  assert.equal(talk.view('owner', 'project:Phase One:ceo', 'manager'), undefined);
  assert.equal(cleanProjectResult({ t: 'project.result', id, ok: true, detail: 'Ready', project: 'Phase One', greeting: ' Hi\u0007 there ' })?.greeting, 'Hi  there');
});

test('a headless lead with a transcript is idle, not offline; app-chat leads and unknown sessions are unchanged', t => {
  const home = dir(t), project = '/Users/x/Documents/GitHub/Phase-One', off = { status: 'off' as const, updatedAt: 1 };
  assert.equal(headlessIdle(home, project, [id, undefined], off).status, 'off', 'no transcript yet');
  const native = path.join(home, '.claude/projects', project.replace(/[^a-zA-Z0-9]/g, '-')); mkdirSync(native, { recursive: true }); writeFileSync(path.join(native, id + '.jsonl'), '');
  assert.equal(headlessIdle(home, project, [id, undefined], off).status, 'idle');
  assert.equal(headlessIdle(home, project, [id, 'local_app'], off).status, 'off', 'an app chat that is closed stays offline');
  assert.equal(headlessIdle(home, project, [id, undefined], { status: 'busy', updatedAt: 1 }).status, 'busy');
});

test('/lite lists every lead on HQ but only the floor\'s own project leads elsewhere', () => {
  const leads = [{ id: 'cofounder', project: 'HQ' }, { id: 'p', project: 'Plimbo', floorId: 'plimbo' }, { id: 'a', project: 'Agent Office', floorId: 'agent-office' }, { id: 's', project: 'Phase One' }];
  const floors: any[] = [{ id: 'hq', name: 'HQ', hq: { ownerName: 'J', mine: true } }, { id: 'plimbo', name: 'Plimbo' }, { id: 'studio-x', name: 'Phase One' }];
  assert.deepEqual(floorLeads(leads, 'hq', floors).map(l => l.id), ['cofounder', 'p', 'a', 's']);
  assert.deepEqual(floorLeads(leads, 'plimbo', floors).map(l => l.id), ['p']);
  const drafts: any[] = [...floors.slice(0, 2), { id: 'studio-x', name: 'Phase One', draft: true }, { id: 'draft-phase-one', name: 'Phase One', draft: true }];
  const studio = [...leads.slice(0, 3), { id: 's', project: 'Phase One', floorId: 'draft-phase-one' }];
  assert.deepEqual(floorLeads(studio, 'studio-x', drafts).map(l => l.id), ['s'], 'a draft floor matches its Studio lead by name even when an older same-name floor claimed its floorId');
  assert.deepEqual(floorLeads(studio, 'plimbo', drafts).map(l => l.id), ['p']);
});
