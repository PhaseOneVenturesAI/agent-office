// Durable scoped history for role characters (see src/server/role-chat.ts): append-only, paged
// newest-first, corrupt lines skipped, staff Q&A scoped apart from the controller record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoleChat } from '../src/server/role-chat.js';

test('appends survive a reload and page newest-first with a cursor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-role-chat-'));
  try {
    const chat = new RoleChat(dir);
    for (let i = 1; i <= 10; i++) chat.append('w1', { id: `m${i}`, role: i % 2 ? 'user' : 'assistant', text: `message ${i}`, at: i * 1000 });
    assert.equal(chat.tail('w1').length, 10);
    assert.equal(chat.tail('w1', 3)[0].text, 'message 10', 'newest first');
    // Page back from a cursor: only older messages.
    const page = chat.tail('w1', 3, 8000);
    assert.deepEqual(page.map((m) => m.text), ['message 7', 'message 6', 'message 5']);
    // A fresh instance (restart) sees the same record.
    const reloaded = new RoleChat(dir);
    assert.equal(reloaded.tail('w1', 2)[0].text, 'message 10');
    assert.equal(reloaded.tail('nobody').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt lines are skipped, scopes ride along, and staff Q&A stays separate', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-role-chat-'));
  try {
    const file = path.join(dir, 'role-chat-w1.jsonl');
    writeFileSync(file, 'not json\n{"id":"a","role":"user","text":"hello","at":1}\n{"id":"b","role":"nope","text":"x","at":2}\n');
    appendFileSync(file, '{"id":"c","role":"assistant","text":"answer","at":3,"scope":"staff"}\n');
    const chat = new RoleChat(dir);
    const all = chat.tail('w1', 10);
    assert.deepEqual(all.map((m) => m.id), ['c', 'a'], 'bad JSON and bad roles are skipped');
    assert.equal(all[0].scope, 'staff');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
