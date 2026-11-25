// `agent-office join`, run on your own computer: this machine becomes a satellite of the office
// (☰ → 🛰️ Satellites) — it shows up on the wall with what it is and which agent CLIs it could
// run, and stays for as long as this runs. An admin mints the join token in the office. This is
// the presence layer: the office can see the machine; hiring a worker onto it is the next
// iteration.

import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { AGENT_PROVIDERS, type AgentProvider } from '../shared/providers.js';
import type { NodeFrame } from './nodes.js';
import { accessHeaders, ACCESS_HELP, officeOrigin, nodeSocket, handshakeFailure } from './join-access.js';
import { configure, type LocalOptions } from './cubbies/local/config.js';
import { CubbyConnector } from './cubbies/local/connector.js';

const HELP = `agent-office join — make this computer a satellite of an office

Usage:
  agent-office join <office-url> --token <token> [--name <name>]

The office shows this machine in ☰ → 🛰️ Satellites for as long as this runs:
its name, platform and memory, and the agent CLIs its PATH offers. An admin
mints the token in the office (🛰️ Satellites → Invite a machine); keep it
somewhere safe — the office only keeps its hash.

Options:
  --token <t>     The join token (env AGENT_OFFICE_NODE_TOKEN)
  --name <name>   What to call this machine (default: its hostname)
  --cloudflare-access  Use an existing cloudflared user application-token cache
  --cubbies      Opt in to signed owner chat and project-scoped agent presence
  --owner-key <key>  Required P-256 public key copied from your cubby setup window
  --replace-owner-key  Locally authorize replacing the pinned owner device key
  --floor <id>   Cubby floor (requires --cubbies)
  --project <p>  Local repository/worktree root (requires --cubbies)
  --lead-provider claude|codex  Local provider selection (registry takes priority)
  --lead-session <UUID>  Existing native session; never forks the conversation
  --lead-profile personal|phase-one  Local Claude subscription profile
  --new-lead     Locally authorize a new persistent lead only if none is recorded
  --lead-bridge  Talk to the project's lead session already running here (it runs
                 agent-office cubby wait); never starts a second lead
  -h, --help      Show this help
`;

const HELLO_MS = 15_000;
/** Reconnect patience: one second, then doubling to half a minute. */
const RETRY_MAX_MS = 30_000;

/** The provider each agent CLI's binary stands for (a cursor-agent binary is a Cursor). */
const BINS: [string, AgentProvider][] = [
  ['claude', 'claude'],
  ['kimi', 'kimi'],
  ['opencode', 'opencode'],
  ['codex', 'codex'],
  ['grok', 'grok'],
  ['muse', 'muse'],
  ['dsh', 'dsh'],
  ['pi', 'pi'],
  ['cursor-agent', 'cursor'],
];

/** The agent CLIs this computer's PATH offers, by looking for the binaries. */
export function detectProviders(env: NodeJS.ProcessEnv = process.env): AgentProvider[] {
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE').split(';') : [''];
  const found: AgentProvider[] = [];
  for (const [bin, provider] of BINS) {
    if (
      dirs.some((dir) => exts.some((ext) => existsSync(path.join(dir, bin + ext.toLowerCase())) || existsSync(path.join(dir, bin + ext))))
    )
      found.push(provider);
  }
  return found.filter((p, i) => found.indexOf(p) === i && AGENT_PROVIDERS.includes(p));
}

/** e.g. "macOS arm64", "Linux x64". */
function platform(): string {
  const names: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
  return `${names[process.platform] ?? process.platform} ${process.arch}`;
}

/** The agent-office version this runs from, found by walking up to its package.json. */
function ownVersion(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'agent-office' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function hello(name: string | undefined): NodeFrame {
  return {
    t: 'hello',
    name: name ?? os.hostname(),
    host: os.hostname(),
    platform: platform(),
    cpus: os.cpus().length,
    memGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    providers: detectProviders(),
    ...(ownVersion() ? { version: ownVersion() } : {}),
  };
}

/** Runs until Ctrl-C; resolves to an exit code only when it can't go on. */
export async function joinCommand(argv: string[]): Promise<number> {
  let url = '';
  let name: string | undefined;
  let cloudflareAccess = false;
  let cubbies = false;
  const local: LocalOptions = {};
  let token = process.env.AGENT_OFFICE_NODE_TOKEN ?? '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === '-h' || a === '--help') {
        console.log(HELP);
        return 0;
      } else if (a === '--token') token = value();
      else if (a === '--name') name = value();
      else if (a === '--cloudflare-access') cloudflareAccess = true;
      else if (a === '--cubbies') cubbies = true;
      else if (a === '--owner-key') local.ownerKey = value();
      else if (a === '--replace-owner-key') local.replaceOwnerKey = true;
      else if (a === '--floor') local.floor = value();
      else if (a === '--project') local.project = value();
      else if (a === '--lead-provider') local.provider = value();
      else if (a === '--lead-session') local.session = value();
      else if (a === '--lead-profile') local.profile = value();
      else if (a === '--new-lead') local.newLead = true;
      else if (a === '--lead-bridge') local.bridge = true;
      else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
      else if (url) throw new Error(`one office at a time: ${url} or ${a}?`);
      else url = a;
    } catch (err) {
      console.error(`agent-office join: ${(err as Error).message} (see agent-office join --help)`);
      return 2;
    }
  }
  if (!/^https?:\/\//i.test(url)) {
    console.error('agent-office join: the office address comes first, e.g. agent-office join https://office.example --token …');
    return 2;
  }
  if (!token) {
    console.error('agent-office join: a join token is needed (--token) — an admin mints one in the office, ☰ → 🛰️ Satellites → Invite a machine');
    return 2;
  }
  if (!cubbies && Object.keys(local).length) {
    console.error('Local cubby options require --cubbies; default join is presence-only.'); return 2;
  }

  try { url = officeOrigin(url); } catch { console.error('Use an http(s) office origin without credentials, path, query or fragment'); return 2; }
  const origin = new URL(url);
  if (cubbies && origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    console.error('Cubby chat requires HTTPS, except on your own loopback computer.'); return 2;
  }
  let access: Awaited<ReturnType<typeof accessHeaders>> | undefined;
  if (cloudflareAccess) {
    try { access = await accessHeaders(url); } catch { console.error(ACCESS_HELP); return 1; }
  }
  let connector: CubbyConnector | undefined;
  if (cubbies) {
    if (!url.startsWith('https://') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      console.error('Cubby owner chat requires HTTPS (HTTP is allowed only on loopback).'); return 2;
    }
    try {
      connector = new CubbyConnector(await configure(local), token);
      if (connector.notice) console.error(connector.notice);
      console.log('Cubbies enabled. Native permissions stay local; stop join to turn this connector off.');
    } catch (error) { console.error(`Cubby setup: ${(error as Error).message}`); return 2; }
  }
  const ws = url.replace(/^http/, 'ws').replace(/\/$/, '');
  const say = (line: string) => console.log(`  ${line}`);
  say(`\n  🛰️  agent-office join\n`);
  say(`the office: ${url}`);
  say(`this machine: ${name ?? os.hostname()} — ${platform()}, ${os.cpus().length} cpus, ${Math.round(os.totalmem() / 1024 ** 3)} GB`);
  const providers = detectProviders();
  say(providers.length ? `agents it could run: ${providers.join(', ')}` : 'no agent CLIs on its PATH (install one and restart this to offer it)');
  say('');

  let retry = 0;
  const shutdown = new AbortController();
  let quit: (() => void) | undefined;
  const interrupt = () => {
    connector?.disconnected();
    shutdown.abort();
    quit?.();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('SIGHUP', interrupt);
  try {
    while (!shutdown.signal.aborted) {
      if (access && Date.now() >= access.expiresAt - 1000) { say(ACCESS_HELP); return 1; }
      const code = await once(ws, token, name, say);
      if (code !== undefined) return code;
      if (shutdown.signal.aborted) break;
      const wait = Math.min(1000 * 2 ** retry, RETRY_MAX_MS);
      retry = Math.min(retry + 1, 5);
      say(`… reconnecting in ${Math.round(wait / 1000)}s`);
      // Wake for expiry as well as Ctrl-C; retries never refresh the cached credential.
      const untilExpiry = access ? Math.max(1, access.expiresAt - Date.now() - 1000) : wait;
      try { await delay(Math.min(wait, untilExpiry), undefined, { signal: shutdown.signal }); }
      catch (err) { if (!shutdown.signal.aborted) throw err; }
    }
    return 0;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGHUP', interrupt);
    quit?.();
    await connector?.close();
  }

  /** One connection's whole life; undefined to retry, an exit code to stop. */
  function once(wsUrl: string, tok: string, nodeName: string | undefined, out: (line: string) => void): Promise<number | undefined> {
    return new Promise((resolve) => {
      const socket = nodeSocket(wsUrl, tok, access?.headers);
      let heartbeat: NodeJS.Timeout | undefined;
      let expiry: NodeJS.Timeout | undefined;
      let ended = false;
      const finish = (code: number | undefined, message?: string) => {
        if (ended) return;
        ended = true;
        connector?.disconnected();
        if (heartbeat) clearInterval(heartbeat);
        if (expiry) clearTimeout(expiry);
        if (quit === leave) quit = undefined;
        if (message) out(message);
        // Mark ended before terminating: a failed handshake also emits error/close.
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        resolve(code);
      };
      const leave = () => finish(0, '  closed');
      quit = leave;
      socket.on('open', () => {
        if (ended) return;
        retry = 0;
        socket.send(JSON.stringify(hello(nodeName)));
        connector?.connected((frame) => {
          if (!ended && socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 128 * 1024) socket.send(JSON.stringify(frame));
        }, nodeName);
        out('✓ joined — this machine is on the office wall (☰ → 🛰️ Satellites). Leave this running; Ctrl-C leaves.');
        heartbeat = setInterval(() => socket.send(JSON.stringify({ t: 'ping' } satisfies NodeFrame)), HELLO_MS);
        if (access) expiry = setTimeout(() => finish(1, ACCESS_HELP), Math.min(2 ** 31 - 1, Math.max(1, access.expiresAt - Date.now() - 1000)));
      });
      socket.on('message', (raw) => { if (!ended) connector?.receive(raw); });
      socket.on('close', (code) => {
        if (code === 4001 || code === 4000) {
          finish(1, "✗ the office doesn't know this token — it was revoked, or it's mistyped. Mint a new one in ☰ → 🛰️ Satellites.");
          return;
        }
        if (code === 1000) { finish(0); return; }
        finish(undefined, `… the connection dropped (${code})`);
      });
      socket.on('unexpected-response', (_req, res) => {
        const status = res.statusCode ?? 0;
        const failure = handshakeFailure(status);
        if (failure === 'retry') finish(undefined, `… the office is temporarily unavailable (HTTP ${status})`);
        else if (failure === 'auth' || failure === 'redirect') {
          finish(1, `Satellite handshake ${failure === 'redirect' ? 'redirect refused' : 'authorization rejected'} (HTTP ${status}). Check the node invite and ${access ? 'your Cloudflare Access login, then restart join --cloudflare-access.' : 'whether this office requires --cloudflare-access.'}`);
        } else finish(1, `Satellite handshake rejected (HTTP ${status}). Check the office address and server configuration.`);
        res.destroy();
      });
      socket.on('error', () => {
        finish(undefined, "… couldn't reach the office");
      });
    });
  }
}
