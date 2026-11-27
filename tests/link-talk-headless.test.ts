import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sendHeadless } from '../src/server/link/headless.js';
import { LeadTalk } from '../src/server/link/talk.js';
import { deliveredText } from '../src/shared/protocol/lead-talk.js';
import { fixture, frame, session, flush } from './support/link-talk.js';

test('headless resumes the registered session with fixed argv and stdin, then forwards only its answer', async t => {
  const f = fixture(t), native = path.join(f.home, '.claude/projects', f.project.replace(/[^a-zA-Z0-9]/g, '-'), session + '.jsonl');
  mkdirSync(path.dirname(native), { recursive: true }); writeFileSync(native, 'private native transcript; never read');
  const capture = path.join(f.home, 'argv.json'), input = path.join(f.home, 'input.json'), executable = path.join(f.home, 'fake-claude.cjs');
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'auth') { console.log(JSON.stringify({loggedIn:true, authMethod:'claude.ai', apiProvider:'firstParty'})); process.exit(0); }
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));
let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => {
fs.writeFileSync(${JSON.stringify(input)}, input);
console.log(JSON.stringify({type:'assistant',session_id:${JSON.stringify(session)},message:{content:[{type:'text',text:'pong'}]}}));
console.log(JSON.stringify({type:'result',session_id:${JSON.stringify(session)},subtype:'success',permission_denials:[]}));
});`, { mode: 0o700 });
  const frames: any[] = [];
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', headless: (c, t, f, s) => sendHeadless(c, t, f, s, executable) });
  t.after(() => talk.close()); const message = { ...frame(), text: 'literal $(touch /no) `echo no` ;' }; talk.receive(message);
  const deadline = Date.now() + 5000;
  while (!frames.some(f => f.t === 'lead.reply' || f.state === 'failed') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(frames, [{ t: 'lead.state', id: message.id, state: 'delivered', path: 'headless' }, { t: 'lead.reply', id: message.id, text: 'pong' }]);
  const args = JSON.parse(readFileSync(capture, 'utf8'));
  assert.deepEqual(args, { argv: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', session], cwd: f.project });
  assert.equal(JSON.parse(readFileSync(input, 'utf8')).message.content, deliveredText(message));
  assert.equal(existsSync(path.join(f.stateDirectory, 'office-turns', session)), false);
});

test('app-only offline target fails with the specified local-open instruction', async t => {
  const f = fixture(t), frames: any[] = [];
  f.registry({ One: { path: f.project, leadAppSession: 'app-only' } });
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', headless: async () => assert.fail('no native id') });
  t.after(() => talk.close()); talk.receive(frame()); await flush();
  assert.equal(frames.at(-1).error, 'Open this lead in the Claude app once so it can be reached');
  await assert.rejects(sendHeadless(f.config, { key: 'app-only', appSession: 'app-only', project: f.project }, frame(), new AbortController().signal), /Open this lead/);
});

test('Cofounder headless is explicitly blocked until its local working-directory contract is supplied', async t => {
  const f = fixture(t), frames: any[] = [];
  f.registry({}, { leadSessionId: session });
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', headless: async () => assert.fail('no guessed directory') });
  t.after(() => talk.close()); talk.receive({ ...frame(), target: { cofounder: true } }); await flush();
  assert.equal(frames.length, 1); assert.equal(frames[0].state, 'failed');
  assert.equal(frames[0].error, 'Cofounder has no registered project folder for headless resume');
});
