import test from 'node:test';
import assert from 'node:assert/strict';
import { harnessRequests } from '../src/client/ui/harness-requests.js';

function fixture() {
  const sent: any[] = [], listeners = new Set<(msg: any) => void>();
  const net: any = { up: true, send: (msg: any) => sent.push(msg), onMessage: (fn: (msg: any) => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
  return { sent, listeners, net, api: harnessRequests(net), reply: (msg: any) => { for (const fn of listeners) fn(msg); } };
}

test('Harness responses correlate concurrent requests and cannot acknowledge a different source', async () => {
  const f = fixture();
  const first = f.api.read('CLAUDE.md'), second = f.api.read('WORKFLOW.md');
  f.reply({ t: 'harness.file', request: f.sent[1].request, path: 'WORKFLOW.md', text: 'Workflow', status: 'present', revision: 'hash2' });
  f.reply({ t: 'harness.file', request: 'unrelated', path: 'CLAUDE.md', text: 'Wrong', status: 'present', revision: 'wrong' });
  f.reply({ t: 'harness.file', request: f.sent[0].request, path: 'CLAUDE.md', text: 'Instructions', status: 'present', revision: 'hash1' });
  assert.equal((await first).text, 'Instructions'); assert.equal((await second).text, 'Workflow');
  const pending = f.api.change({ action: 'edit', path: 'CLAUDE.md', base: 'hash1', text: 'Draft' });
  f.reply({ t: 'harness.result', request: f.sent.at(-1).request, path: 'CLAUDE.md', file: { path: 'OTHER.md', text: 'Wrong source' } });
  await assert.rejects(pending, /Incomplete save acknowledgment/);
  f.api.dispose(); assert.equal(f.listeners.size, 0);
});

test('Harness request failure, disconnect and disposal never manufacture a save acknowledgment', async () => {
  const f = fixture();
  const stale = f.api.change({ action: 'edit', path: 'CLAUDE.md', base: 'old', text: 'Draft' });
  f.reply({ t: 'harness.result', request: f.sent[0].request, path: 'CLAUDE.md', error: 'Source changed; draft kept' });
  await assert.rejects(stale, /Source changed/);
  f.net.up = false;
  await assert.rejects(f.api.read('CLAUDE.md'), /disconnected/);
  assert.equal(f.sent.length, 1);
  f.net.up = true;
  const abandoned = f.api.read('CLAUDE.md'); f.api.dispose();
  await assert.rejects(abandoned, /window closed/); assert.equal(f.listeners.size, 0);
});
