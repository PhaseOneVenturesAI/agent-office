import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fixture } from './support/link-talk.js';
import { Building } from '../src/server/building.js';
import { Drafts } from '../src/server/drafts/index.js';
import { draftsHandlers } from '../src/server/ws/handlers/drafts.js';
import { CubbyRecords } from '../src/server/cubbies/records.js';

test('old VPS folders (including damaged git data) are ignored without deletion, named once, with presentation metadata retained', t => {
  const { home } = fixture(t), dir = path.join(home, 'server'), old = path.join(dir, 'drafts/draft-old');
  mkdirSync(old, { recursive: true }); writeFileSync(path.join(old, '.git'), 'malformed old checkout');
  writeFileSync(path.join(old, 'keep.txt'), 'admin owns cleanup');
  writeFileSync(path.join(dir, 'floors.json'), JSON.stringify([{ id: 'draft-old', name: 'Old', dir: old, draft: true, addedBy: 'owner', addedAt: 1 }]));
  writeFileSync(path.join(dir, 'drafts.json'), JSON.stringify([{ id: 'draft-old', name: 'Old', owner: 'owner', createdAt: 1 }]));
  writeFileSync(path.join(dir, 'devices.json'), '{broken old devices');
  const logs: string[] = [], log = console.log; console.log = line => logs.push(String(line));
  try {
    const building = new Building(dir, dir), drafts = new Drafts(dir, true, 'owner', id => id, building,
      { AGENT_OFFICE_PROJECT_STARTERS: 'owner', AGENT_OFFICE_KICKOFF_REMOTE: old, AGENT_OFFICE_KICKOFF_ORG: 'OldOrg' });
    const def = building.list()[0]; assert.equal(def.id, 'draft-old'); assert.equal(def.draft, true);
    assert.notEqual(def.dir, old); assert.equal(existsSync(path.join(def.dir,'.git')), false);
    assert.equal(drafts.owns(def.id,'owner'),true); assert.equal(drafts.canStart('owner'),false);
    assert.equal(readFileSync(path.join(old,'.git'),'utf8'),'malformed old checkout');
    assert.equal(readFileSync(path.join(old,'keep.txt'),'utf8'),'admin owns cleanup');
    assert.equal(logs.filter(l => l.includes(old) && l.includes('folder')).length,1);
    for (const name of ['AGENT_OFFICE_PROJECT_STARTERS','AGENT_OFFICE_KICKOFF_REMOTE','AGENT_OFFICE_KICKOFF_ORG']) assert.ok(logs.some(l => l.includes(name) && l.includes('ignored retired')));
    assert.doesNotThrow(() => new CubbyRecords(dir, true));
  } finally { console.log = log; }
});
test('retired draft create/kickoff wire commands cannot touch a server checkout', () => {
  const sent: any[] = [], ctx: any = { warn: (_: any,text: string) => sent.push(text), sendTo: (_: any,msg: any) => sent.push(msg) };
  draftsHandlers['drafts.new'](ctx, {} as any, { t: 'drafts.new', name: 'No server draft' });
  draftsHandlers['drafts.kickoff'](ctx, {} as any, { t: 'drafts.kickoff', floorId: 'draft-old', confirm: 'Old' });
  assert.match(sent[0], /New project.*Mac link/); assert.match(sent[1].error, /predates the Mac Studio/);
});
