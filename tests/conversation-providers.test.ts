import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KimiSession } from '../src/server/kimi.js';
import { claude } from '../src/server/providers/claude.js';
import { codex } from '../src/server/providers/codex.js';

test('Kimi ACP completion forwards assistant prose without tool output, thoughts or cancelled turns', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'office-kimi-conversation-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const script = path.join(home, 'agent.mjs');
  writeFileSync(script, `import readline from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); const result=(value)=>send({jsonrpc:'2.0',id:m.id,result:value});
 if(m.method==='initialize') result({protocolVersion:1});
 if(m.method==='session/new') result({sessionId:'kimi-session'});
 if(m.method==='session/prompt') {
  const update=(update)=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'kimi-session',update}});
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'other-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'another session'}}}});
  update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private reasoning'}});
  update({sessionUpdate:'tool_call_update',toolCallId:'t',status:'completed',content:[{type:'content',content:{type:'text',text:'tool secret'}}]});
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'The requested change is ready.'}});
  result({stopReason:m.params.prompt[0].text==='cancelled'?'cancelled':'end_turn'});
 }
});`);
  const replies: string[] = [];
  let done: (() => void) | undefined;
  const session = new KimiSession({ file: process.execPath, args: [script], cwd: home, env: process.env, firstPrompt: 'finish' }, {
    output() {}, status(status) { if (status === 'done') done?.(); }, action() {}, usage() {}, session() {}, prompted() {}, exit() {}, assistant: (text) => replies.push(text),
  });
  t.after(() => session.close());
  const turn = () => Promise.race([new Promise<void>((resolve) => { done = resolve; }), new Promise<never>((_resolve, reject) => { const timeout = setTimeout(() => reject(new Error('ACP did not finish')), 4000); timeout.unref(); })]);
  const first = turn(); session.start(); await first;
  assert.deepEqual(replies, ['The requested change is ready.']);
  const second = turn(); session.prompt('cancelled'); await second;
  assert.equal(replies.length, 1);
});

test('Claude and Codex Stop hooks deliver only the exact hooked session final reply', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'office-hook-conversation-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const claudeDir = path.join(home, 'projects', 'project'); mkdirSync(claudeDir, { recursive: true });
  const claudeFile = path.join(claudeDir, 'root-session.jsonl');
  writeFileSync(claudeFile, JSON.stringify({ type: 'assistant', sessionId: 'root-session', uuid: 'claude-message', message: { role: 'assistant', content: [{ type: 'text', text: 'Claude final reply.' }] } })+'\n');
  const replies: string[] = [];
  const h: any = { info: { id: 'w', sessionId: 'root-session', status: 'working' }, tracker: {}, state: undefined, scheduleScan() {}, persist() {}, emit() {}, setStatus(status: string) { this.info.status = status; }, assistant(reply: { text: string }) { replies.push(reply.text); } };
  claude.usage!.locate!(h, home, { CLAUDE_CONFIG_DIR: home });
  claude.hook!.handle(h, 'Stop', { session_id: 'root-session', transcript_path: claudeFile });
  assert.deepEqual(replies, ['Claude final reply.']);
  const codexDir = path.join(home, 'sessions'); mkdirSync(codexDir);
  const codexFile = path.join(codexDir, 'rollout-root-session.jsonl');
  writeFileSync(codexFile, [JSON.stringify({type:'session_meta',payload:{id:'root-session'}}),JSON.stringify({type:'response_item',payload:{id:'codex-message',type:'message',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:'Codex final reply.'}]}}),''].join('\n'));
  h.state = codex.createState!(); h.running = true;
  codex.usage!.locate!(h, home, { CODEX_HOME: home });
  codex.hook!.handle(h, 'Stop', { session_id: 'root-session', transcript_path: codexFile });
  assert.deepEqual(replies, ['Claude final reply.', 'Codex final reply.']);
  codex.hook!.handle(h, 'Stop', { session_id: 'root-session', transcript_path: codexFile, agent_id: 'child' });
  assert.equal(replies.length, 2);
});
