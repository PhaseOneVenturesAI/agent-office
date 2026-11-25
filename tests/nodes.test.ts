// Satellite nodes: invites, the hello that brings a machine online, heartbeats, and revokes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Nodes } from '../src/server/nodes.js';
import { nodesHandlers } from '../src/server/ws/handlers/nodes.js';

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

test('a private machine shows only for its inviter and the admins', () => {
  const { nodes, cleanup } = setup();
  try {
    nodes.invite('shared box');
    const priv = nodes.invite('my laptop', 'private', 'acct-ivan');
    assert.deepEqual(nodes.state().nodes.map((n) => n.name), ['shared box'], 'no viewer: the public wall only');
    assert.deepEqual(nodes.state({ id: 'acct-keven' }).nodes.map((n) => n.name), ['shared box'], 'someone else doesn’t see it');
    assert.deepEqual(
      nodes.state({ id: 'acct-ivan' }).nodes.map((n) => n.name).sort(),
      ['my laptop', 'shared box'],
      'its inviter does',
    );
    const adminView = nodes.state({ id: 'acct-keven', admin: true }).nodes;
    assert.equal(adminView.length, 2, 'an admin sees it, marked');
    const info = adminView.find((n) => n.id === priv.id)!;
    assert.equal(info.visibility, 'private');
    assert.equal(info.owner, 'acct-ivan');
  } finally {
    cleanup();
  }
});

test('an admin rename survives the machine saying hello again, and a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-nodes-'));
  try {
    const first = new Nodes(dir, () => {});
    const invite = first.invite();
    assert.equal(first.rename('nope', 'Build box'), false, 'no such machine');
    assert.equal(first.rename(invite.id, '   '), false, 'an empty name is refused');

    const ws = fakeWs();
    first.attach(ws as any, invite.token);
    ws.emit('message', Buffer.from(JSON.stringify({ ...hello, name: 'ivan-mac' })));
    assert.equal(first.state().nodes[0].name, 'ivan-mac', 'the hello names it at first');
    assert.equal(first.rename(invite.id, 'Build box'), true);
    ws.emit('close');

    const again = fakeWs();
    first.attach(again as any, invite.token);
    again.emit('message', Buffer.from(JSON.stringify({ ...hello, name: 'ivan-mac' })));
    assert.equal(first.state().nodes[0].name, 'Build box', 'the hello no longer overwrites the rename');
    first.close();

    const second = new Nodes(dir, () => {});
    assert.equal(second.state().nodes[0].name, 'Build box', 'the rename survives a restart');
    const third = fakeWs();
    second.attach(third as any, invite.token);
    third.emit('message', Buffer.from(JSON.stringify({ ...hello, name: 'ivan-mac' })));
    assert.equal(second.state().nodes[0].name, 'Build box', 'even after a restart');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only an admin can rename, invite with a visibility, or remove', () => {
  const { nodes, cleanup } = setup();
  try {
    const invite = nodes.invite('box');
    const sent: any[] = [];
    const warns: string[] = [];
    const ctxAs = (admin: boolean) =>
      ({
        meOf: () => ({ admin }),
        warn: (_c: any, w: string) => warns.push(w),
        sendTo: (_c: any, m: any) => sent.push(m),
        nodes,
      }) as any;
    const client = { accountId: 'acct-ivan' } as any;

    nodesHandlers['nodes.rename'](ctxAs(false), client, { t: 'nodes.rename', id: invite.id, name: 'Nope' });
    assert.equal(nodes.state().nodes[0].name, 'box', 'a non-admin rename changes nothing');
    assert.equal(warns.length, 1);

    nodesHandlers['nodes.rename'](ctxAs(true), client, { t: 'nodes.rename', id: invite.id, name: 'Renamed' });
    assert.equal(nodes.state().nodes[0].name, 'Renamed');
    nodesHandlers['nodes.rename'](ctxAs(true), client, { t: 'nodes.rename', id: invite.id, name: '   ' });
    assert.equal(nodes.state().nodes[0].name, 'Renamed', 'an empty name is refused');

    nodesHandlers['nodes.invite'](ctxAs(true), client, { t: 'nodes.invite', name: 'secret', visibility: 'private' });
    const tokenMsg = sent.find((m) => m.t === 'nodes.token');
    const priv = nodes.state({ admin: true }).nodes.find((n) => n.id === tokenMsg.id)!;
    assert.equal(priv.visibility, 'private');
    assert.equal(priv.owner, 'acct-ivan', 'the inviter’s account owns it');

    nodesHandlers['nodes.revoke'](ctxAs(true), client, { t: 'nodes.revoke', id: tokenMsg.id });
    assert.equal(nodes.state({ admin: true }).nodes.some((n) => n.id === tokenMsg.id), false, 'remove works for a private machine');
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
