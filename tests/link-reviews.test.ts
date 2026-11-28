import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { activityOffice } from './support/hq-activity.js';
import { fixture, frame, flush, session, record, Clock } from './support/link-talk.js';
import { draftsHandlers } from '../src/server/ws/handlers/drafts.js';
import { pitchHandlers } from '../src/server/ws/handlers/pitch.js';
import { studioFeedback, projectPitch } from '../src/server/hq/reviews.js';
import { passTalk } from '../src/server/hq/talk-handlers.js';
import { messages, messageLeads } from '../src/server/hq/messages.js';
import { leadsFor } from '../src/server/hq/leads.js';
import { LeadTalk } from '../src/server/link/talk.js';
import { MacConnector } from '../src/server/hq/local/connector.js';
import { macSignature } from '../src/server/hq/wire.js';
import { cubbyKey } from '../src/server/cubbies/wire.js';
import { localPitch } from '../src/server/cubbies/local/pitch.js';
import { localDesign } from '../src/server/cubbies/local/design.js';
import { macSnapshot } from '../src/server/hq/local/snapshot.js';
const pitch = { department: 'Design', lead: 'Lead', status: 'ready', version: 'v1', pieces: [{ id: 'home', kind: 'site', title: 'Home', images: [], notes: [] }] };
const boards = { ideas: [{ id: 'idea', title: 'Idea' }], screens: [{ id: 'screen', title: 'Home', status: 'review', version: 2 }] };
function setup(t: any) {
  const f = fixture(t); f.registry({ Plimbo: { path: f.project, leadSessionId: session } });
  mkdirSync(path.join(f.project, '.agent-office'));
  writeFileSync(path.join(f.project, '.agent-office/pitch.json'), JSON.stringify(pitch));
  writeFileSync(path.join(f.project, '.agent-office/draft.json'), JSON.stringify(boards));
  const office = activityOffice(path.join(f.home, 'server')); t.after(() => office.close());
  office.admit();
  office.link.frame({ t: 'hq.snapshot', computerId: 'test-mac', observedAt: Date.now(), projects: [{ project: { name: 'Plimbo', repo: 'owner/plimbo', hasMainLead: true, departmentLeads: [] }, agents: [], pitch, draft: boards }] });
  const warnings: string[] = [];
  office.ctx.warn = (_, text) => { if (text) warnings.push(text); };
  office.ctx.drafts = { owns: (id: string, who: string) => id === 'plimbo' && who === 'owner' } as any;
  const review = () => ({ t: 'pitch.verdict' as const, ...office.mac.pitchViews('owner')[0], version: 'v1', pieceId: 'home', verdict: 'approve' as const, requestId: randomUUID(), at: Date.now() });
  const reply = () => { const msg = office.link.sent.filter(f => f.t === 'lead.send').at(-1); office.link.frame({ t: 'lead.reply', id: msg.id, text: 'Saved' }); return msg; };
  return { ...f, ...office, warnings, review, reply };
}
test('account owner alone reviews draft cards and pitches; forged manager, coworker and signed-out frames are refused', t => {
  const f = setup(t);
  for (const role of ['manager','coworker']) {
    const c = f.client(role);
    assert.throws(() => studioFeedback(f.ctx, c, 'Plimbo', 'idea', 'Change'), /Only the HQ owner/);
    draftsHandlers['drafts.feedback'](f.ctx, c, { t: 'drafts.feedback', floorId: 'plimbo', cardId: 'idea', text: 'Change', requestId: 'id', at: 1 });
    pitchHandlers['pitch.verdict'](f.ctx, c, f.review());
  }
  assert.equal(f.hqView('manager')?.pitches?.[0].readOnly, true);
  assert.equal(projectPitch(f.ctx, f.client('owner', 'plimbo'))?.readOnly, undefined);
  assert.equal(projectPitch(f.ctx, f.client('coworker', 'plimbo')), undefined);
  const owner = f.client('owner'); owner.out = true;
  assert.throws(() => studioFeedback(f.ctx, owner, 'Plimbo', 'idea', 'Change'), /Only/); owner.out = false;
  assert.equal(f.link.sent.filter(f => f.t === 'lead.send').length, 0);
  draftsHandlers['drafts.feedback'](f.ctx, owner, { t: 'drafts.feedback', floorId: 'plimbo', cardId: 'idea', text: 'Change', requestId: 'draft-note', at: 1 });
  const draft = f.reply(); assert.equal(draft.review.kind, 'draft'); assert.equal(draft.review.requestId, 'draft-note'); assert.equal(draft.from, 'Jonathan');
  for (const verdict of ['approve','change','drop'] as const) {
    pitchHandlers['pitch.verdict'](f.ctx, owner, { ...f.review(), verdict, ...(verdict === 'change' ? { note: 'More contrast' } : {}) });
    assert.equal(f.reply().review.verdict, verdict);
  }
  assert.equal(f.warnings.length, 4);
  assert.ok(f.warnings.every(w => /Only the HQ owner/.test(w)));
  assert.throws(() => studioFeedback(f.ctx, owner, 'Plimbo', 'missing', 'Change'), /current card/);
});
test('old held cubby message resolves to the linked project; only owner passes; offline never marks it passed', t => {
  const f = setup(t);
  f.ctx.cubbies.records.rows.set('old-room', { id: 'old-room', floorId: 'plimbo', owner: 'owner' } as any);
  const held = messages(f.ctx).send('owner','manager','Ivan','cubby:old-room','Please check');
  for (const role of ['manager','coworker']) assert.throws(() => passTalk(f.ctx, f.client(role), held.id), /Only the owner/);
  const owner = f.client('owner');
  const visible = messageLeads(f.ctx, owner, 'owner', leadsFor(f.ctx, 'owner', true), true);
  assert.ok(visible.some(l => l.mac && l.messages?.some(m => m.id === held.id)), 'old held message stays visible on its linked lead');
  passTalk(f.ctx, owner, held.id);
  const msg = f.reply(); assert.deepEqual(msg.target, { project: 'Plimbo' });
  assert.equal(msg.from, 'Ivan (held, passed on by Jonathan)'); assert.equal(msg.text, 'Please check');
  assert.equal(messages(f.ctx).visible('owner','owner','cubby:old-room')[0].state, 'passed');
  const second = messages(f.ctx).send('owner','manager2','Eddie','project:owner/plimbo:ceo','Check again');
  f.link.close();
  assert.throws(() => passTalk(f.ctx, f.client('owner'), second.id), /offline/);
  assert.equal(messages(f.ctx).waiting(second.id, 'owner').state, 'waiting');
});
test('real lead.send frames pass the authenticated link, persist on the Mac and return through snapshots without device files', async t => {
  const f = setup(t), replies: any[] = [], turns: any[] = [];
  // Malformed historical trust files are irrelevant to the link and local publications.
  writeFileSync(path.join(f.config.state, 'owner-floor.json'), '{bad device data');
  writeFileSync(path.join(f.config.state, 'devices-waiting-floor.json'), '{bad device data');
  writeFileSync(path.join(f.project, '.agent-office/pitch-feedback.json'), JSON.stringify([{ ownerSig: 'legacy', pieceId: 'home', version: 'v1', verdict: 'approve', at: 1, requestId: 'old' }]));
  assert.equal(localPitch(f.project).pitch?.pieces[0].stamp, undefined);
  const talk = new LeadTalk(f.config, r => replies.push(r), { platform: 'darwin', live: () => undefined, headless: async (_c, _t, msg) => { turns.push(msg); return 'Saved'; } });
  const connector = new MacConnector(f.config, 'token', async () => ({ t: 'hq.snapshot', computerId: f.config.computerId, observedAt: Date.now(), projects: [] }), msg => talk.receive(msg));
  t.after(async () => { await talk.close(); await connector.close(); });
  connector.connected(() => {});
  const owner = f.client('owner'); studioFeedback(f.ctx, owner, 'Plimbo', 'idea', 'Make it clearer', 'draft-note');
  const draft = f.reply(); connector.receive(JSON.stringify(draft));
  assert.equal(existsSync(path.join(f.project, '.agent-office/feedback.json')), false, 'no review before authenticated ready');
  const ready = { t: 'hq.ready' as const, computerId: f.config.computerId, owner: 'owner', floor: 'hq', connection: 'one' };
  connector.receive(JSON.stringify({ ...ready, signature: macSignature(cubbyKey('token'), ready) }));
  connector.receive(JSON.stringify(draft)); await flush();
  pitchHandlers['pitch.verdict'](f.ctx, owner, { ...f.review(), verdict: 'change', note: 'More contrast' });
  const verdict = f.reply(); connector.receive(JSON.stringify(verdict)); await flush();
  for (const name of ['feedback.json','pitch-feedback.json']) assert.equal(statSync(path.join(f.project, '.agent-office', name)).mode & 0o777, 0o600);
  assert.equal(localDesign(f.project).boards.ideas[0].feedback[0].text, 'Make it clearer');
  assert.equal(localPitch(f.project).pitch?.pieces[0].stamp?.verdict, 'change');
  const snapshot = await macSnapshot(f.config, { run: async (_bin,args) => args.includes('--show-toplevel') ? f.project : `worktree ${f.project}\0branch refs/heads/main\0`, isAlive: () => false });
  assert.equal(snapshot.projects[0].pitch?.pieces[0].stamp?.requestId, verdict.review.requestId);
  assert.equal(snapshot.projects[0].draft?.ideas[0].feedback[0].id, 'draft-note');
  const before = readFileSync(path.join(f.project,'.agent-office/pitch-feedback.json'));
  connector.receive(JSON.stringify({ ...verdict, id: randomUUID() })); await flush();
  assert.deepEqual(readFileSync(path.join(f.project,'.agent-office/pitch-feedback.json')), before, 'persisted request IDs block replay with a fresh turn ID');
  assert.equal(turns.length, 2); assert.ok(replies.some(r => r.state === 'failed'));
});
test('link refuses malformed, unknown, changed-version and aliased reviews without dispatching a lead', async t => {
  const f = setup(t), sent: any[] = [], turns: any[] = [];
  const talk = new LeadTalk(f.config, r => sent.push(r), { platform: 'darwin', live: () => undefined, headless: async (_c,_t,f) => { turns.push(f); return 'bad'; } }); t.after(() => talk.close());
  const base = { ...frame('Plimbo'), review: { kind: 'draft', cardId: 'missing', text: 'test', requestId: 'note', at: Date.now() } };
  talk.receive(base); talk.receive({ ...base, id: randomUUID(), review: { ...base.review, cardId: '../bad' } });
  talk.receive({ ...base, id: randomUUID(), review: { kind: 'pitch', pieceId: 'home', version: 'v0', verdict: 'approve', requestId: 'p', at: Date.now() } });
  const privateFile = path.join(f.home,'private'); writeFileSync(privateFile,'{}'); symlinkSync(privateFile,path.join(f.project,'.agent-office/feedback.json'));
  talk.receive({ ...base, id: randomUUID(), review: { ...base.review, cardId: 'idea' } }); await flush();
  assert.deepEqual(turns, []); assert.equal(readFileSync(privateFile,'utf8'),'{}'); assert.equal(sent.length, 3);
});

test('busy native lead queues notification after saving; a new pitch version clears its stamp', async t => {
  const f = setup(t), clock = new Clock(), sent: any[] = [], inbox: any[] = [];
  const talk = new LeadTalk(f.config, r => sent.push(r), { platform: 'darwin', clock, live: () => record('busy'), inbox: async (_h,_r,msg) => { inbox.push(msg); } });
  t.after(() => talk.close());
  talk.receive({ ...frame('Plimbo'), review: { kind: 'pitch', pieceId: 'home', version: 'v1', verdict: 'approve', requestId: 'busy-review', at: Date.now() } });
  await flush();
  assert.equal(localPitch(f.project).pitch?.pieces[0].stamp?.verdict, 'approve');
  assert.equal(sent.at(-1).state, 'queued'); assert.deepEqual(inbox, []);
  writeFileSync(path.join(f.project,'.agent-office/pitch.json'), JSON.stringify({ ...pitch, version: 'v2' }));
  assert.equal(localPitch(f.project).pitch?.pieces[0].stamp, undefined);
});
