// Satellite nodes: invites, the hello that brings a machine online, heartbeats, and revokes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Nodes } from '../src/server/nodes.js';

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-nodes-'));
  let broadcasts = 0;
  const nodes = new Nodes(dir, () => broadcasts++);
  return { nodes, cleanup: () => (nodes.close(), rmSync(dir, { recursive: true, force: true })), broadcasts: () => broadcasts };
}

/** A WebSocket good enough for the registry: records frames, fires close by hand. */
function fakeWs() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    sent: [] as string[],
    closed: undefined as number | undefined,
    on(ev: string, fn: (...args: any[]) => void) {
      (listeners[ev] ??= []).push(fn);
    },
    send(s: string) {
      this.sent.push(s);
    },
    close(code?: number) {
      this.closed = code;
    },
    emit(ev: string, ...args: any[]) {
      for (const fn of listeners[ev] ?? []) fn(...args);
    },
  };
}

const hello = { t: 'hello', host: 'ivan-mac', platform: 'macOS arm64', cpus: 10, memGB: 32, providers: ['claude', 'kimi', 'not-a-provider'], version: '0.1.0' };

test('an invite brings a node into being offline; its hello brings it online', () => {
  const { nodes, cleanup } = setup();
  try {
    const invite = nodes.invite("Ivan's MacBook");
    assert.equal(nodes.state().nodes.length, 1);
    assert.equal(nodes.state().nodes[0].online, false, 'invited but never here');

    assert.equal(nodes.known(invite.token), true);
    assert.equal(nodes.known('ao_node_wrong'), false);

    const ws = fakeWs();
    nodes.attach(ws as any, invite.token);
    ws.emit('message', Buffer.from(JSON.stringify(hello)));
    const [info] = nodes.state().nodes;
    assert.equal(info.online, true);
    assert.equal(info.host, 'ivan-mac');
    assert.deepEqual(info.providers, ['claude', 'kimi'], 'unknown CLIs are dropped');
    assert.equal(info.cpus, 10);

    ws.emit('message', Buffer.from(JSON.stringify({ t: 'ping' })));
    assert.ok(nodes.state().nodes[0].lastSeen > 0);

    ws.emit('close');
    assert.equal(nodes.state().nodes[0].online, false, 'a closed socket is an offline machine');
  } finally {
    cleanup();
  }
});

test('a wrong token is refused, and revoke takes the node off the wall', () => {
  const { nodes, cleanup } = setup();
  try {
    const invite = nodes.invite();
    const bad = fakeWs();
    nodes.attach(bad as any, 'ao_node_nope');
    assert.equal(bad.closed, 4001);

    const ws = fakeWs();
    nodes.attach(ws as any, invite.token);
    ws.emit('message', Buffer.from(JSON.stringify(hello)));
    assert.equal(nodes.state().nodes.length, 1);

    assert.equal(nodes.revoke('nope'), false);
    assert.equal(nodes.revoke(invite.id), true);
    assert.equal(ws.closed, 4000, 'the online machine was disconnected');
    assert.equal(nodes.state().nodes.length, 0);
    assert.equal(nodes.known(invite.token), false, 'the token dies with the invite');
  } finally {
    cleanup();
  }
});

test('the registry survives a restart, with machines offline until they say hello again', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-nodes-'));
  try {
    const first = new Nodes(dir, () => {});
    const invite = first.invite('keven-pc');
    first.close();

    const second = new Nodes(dir, () => {});
    assert.equal(second.state().nodes.length, 1);
    assert.equal(second.state().nodes[0].name, 'keven-pc');
    assert.equal(second.state().nodes[0].online, false);
    assert.equal(second.known(invite.token), true, 'the same token still works');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProviders finds the CLIs a PATH offers', async () => {
  const { detectProviders } = await import('../src/server/join.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-path-'));
  try {
    for (const bin of ['claude', 'codex']) writeFileSync(path.join(dir, bin), '#!/bin/sh\n');
    const found = detectProviders({ PATH: dir } as NodeJS.ProcessEnv);
    assert.deepEqual(found.sort(), ['claude', 'codex']);
    assert.deepEqual(detectProviders({ PATH: '/nonexistent' } as NodeJS.ProcessEnv), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
