import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { cubbyKey, relaySignature } from '../src/server/cubbies/wire.js';
import { joinCommand } from '../src/server/join.js';

const session = '12345678-1234-1234-1234-123456789abc';
const token = 'fixture-token-not-a-real-account';

test('real join wiring is opt-in, hello order is correct, signed chats resume fake lead and dedupe across reconnect', { timeout: 10000 }, async (t) => {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-join-')));
  const bin = path.join(home, 'bin'), project = path.join(home, 'repo'), calls = path.join(home, 'calls');
  mkdirSync(bin); mkdirSync(path.join(project, '.git'), { recursive: true });
  const sessions = path.join(home, '.claude/projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(sessions, { recursive: true }); writeFileSync(path.join(sessions, session + '.jsonl'), 'private transcript must not be read');
  const executable = (name: string, code: string) => writeFileSync(path.join(bin, name), `#!${process.execPath}\n${code}`, { mode: 0o700 });
  executable('git', `const a=process.argv.slice(2), p=${JSON.stringify(project)}; process.stdout.write(a.includes('--show-toplevel')?p:a.includes('--git-common-dir')?p+'/.git':'worktree '+p+'\\0branch refs/heads/main\\0\\0');`);
  executable('ps', 'process.stdout.write("");');
  executable('paradev', 'process.stdout.write("[]");');
  executable('claude', `if(process.argv[2]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));process.exit(0);}
const fs=require('node:fs'); let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
const x=JSON.parse(input); fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:process.argv.slice(2),text:x.message.content})+'\\n');
process.stdout.write(JSON.stringify({type:'assistant',session_id:${JSON.stringify(session)},message:{content:[{type:'text',text:'fixture assistant'}]}})+'\\n');
process.stdout.write(JSON.stringify({type:'result',session_id:${JSON.stringify(session)},subtype:'success',permission_denials:[]})+'\\n'); });`);
  const server = http.createServer(); const ws = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const args = [url, '--token', token, '--cubbies', '--floor', 'floor', '--project', project, '--lead-provider', 'claude', '--lead-session', session];
  let connections = 0; const computerIds: string[] = []; const replies: string[] = []; const frames: string[][] = [];
  ws.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const number = ++connections; frames.push([]);
    const binding = { cubbyId: 'c', floorId: 'floor', ownerId: 'o', connectionId: `connection${number}` };
    const send = (value: any) => socket.send(JSON.stringify({ ...value, signature: relaySignature(cubbyKey(token), value) }));
    socket.on('message', (raw) => {
      const value = JSON.parse(raw.toString()); frames[number - 1].push(value.t);
      if (value.t === 'cubby.hello') {
        computerIds.push(value.computerId); send({ t: 'cubby.ready', ...binding });
        send({ t: 'cubby.chat', ...binding, requestId: 'same', at: Date.now(), text: 'first owner chat' });
        if (number === 2) send({ t: 'cubby.chat', ...binding, requestId: 'second', at: Date.now(), text: 'second owner chat' });
      }
      if (value.t === 'cubby.reply') { replies.push(value.text); socket.close(number === 1 ? 1001 : 1000); }
    });
  });
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import {joinCommand} from './src/server/join.ts'; process.exitCode=await joinCommand(JSON.parse(process.env.CUBBY_TEST_ARGS));`], {
    cwd: path.join(import.meta.dirname, '..'), env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, CUBBY_TEST_ARGS: JSON.stringify(args) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
  t.after(async () => { child.kill('SIGKILL'); for (const client of ws.clients) client.terminate(); ws.close(); await new Promise<void>((r) => server.close(() => r())); rmSync(home, { recursive: true, force: true }); });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, output);
  assert.equal(connections, 2); assert.equal(computerIds[0], computerIds[1]);
  assert.deepEqual(frames.map((f) => f.slice(0, 2)), [['hello', 'cubby.hello'], ['hello', 'cubby.hello']]);
  assert.deepEqual(replies, ['fixture assistant', 'fixture assistant']);
  const records = readFileSync(calls, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
  assert.deepEqual(records.map((r) => r.text), ['first owner chat', 'second owner chat']);
  assert.ok(records.every((r) => r.args.includes('--resume') && !r.args.includes('--fork-session')));
  assert.ok(!output.includes(token));
});

test('default join emits only its ordinary presence hello', { timeout: 5000 }, async () => {
  const server = http.createServer(), ws = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const messages: string[] = [];
  ws.on('connection', (socket) => socket.on('message', (raw) => { messages.push(JSON.parse(raw.toString()).t); socket.close(1000); }));
  try {
    assert.equal(await joinCommand([`http://127.0.0.1:${(server.address() as any).port}`, '--token', 'test']), 0);
    assert.deepEqual(messages, ['hello']);
  } finally { ws.close(); await new Promise<void>((r) => server.close(() => r())); }
});

test('local cubby flags require opt-in and remote plaintext chat is rejected before connection', async () => {
  assert.equal(await joinCommand(['http://localhost', '--token', 'test', '--floor', 'f']), 2);
  assert.equal(await joinCommand(['http://example.invalid', '--token', 'test', '--cubbies', '--floor', 'f', '--project', '/unused']), 2);
});
