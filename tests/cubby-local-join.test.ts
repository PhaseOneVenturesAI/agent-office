import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { joinCommand } from '../src/server/join.js';

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

test('retired commands fail clearly before local reads or network access', () => {
  for (const args of [['join', '--cubbies'], ['join', '--lead-bridge'], ['join', '--hq'], ['join', '--owner-key', 'ignored'], ['cubby', 'wait'], ['cubby', 'reply'], ['cubby', 'devices'], ['cubby', 'devices', 'approve', 'old-code']]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /removed: use `agent-office link <url>`/);
  }
});
