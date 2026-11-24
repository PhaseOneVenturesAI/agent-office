import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { main } from '../bin/office-workers.js';

test('CEO assignment accepts a piped objective and only starts on explicit execute', async () => {
  for (const execute of [false, true]) {
    const sent: unknown[] = [], errors: string[] = [];
    const code = await main(['assign', '--dept', 'marketing', ...(execute ? ['--execute'] : [])], {
      env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4600', AGENT_OFFICE_WORKER_ID: 'ceo', AGENT_OFFICE_HOOK_TOKEN: 'test-only' },
      stdin: Readable.from(['Read the README.\nReturn file evidence.\n']),
      fetch: (async (_url: unknown, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ manager: 'Marketing', started: execute }));
      }) as typeof fetch,
      out: () => {}, err: (s: string) => errors.push(s),
    });
    assert.equal(code, 0, errors.join('\n'));
    assert.deepEqual(sent, [{ dept: 'marketing', objective: 'Read the README.\nReturn file evidence.', ...(execute ? { execute: true } : {}) }]);
  }
});

test('empty piped objective is refused before sending an assignment', async () => {
  let sent = false;
  const code = await main(['assign', '--dept', 'marketing'], {
    env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4600', AGENT_OFFICE_WORKER_ID: 'ceo', AGENT_OFFICE_HOOK_TOKEN: 'test-only' },
    stdin: Readable.from(['  \n']), fetch: (async () => { sent = true; return new Response('{}'); }) as typeof fetch,
    out: () => {}, err: () => {},
  });
  assert.equal(code, 2); assert.equal(sent, false);
});
