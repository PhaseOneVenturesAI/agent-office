// `agent-office join`, run on your own computer: this machine becomes a satellite of the office
// (☰ → 🛰️ Satellites) — it shows up on the wall with what it is and which agent CLIs it could
// run, and stays for as long as this runs. An admin mints the join token in the office. This is
// the presence layer: the office can see the machine; hiring a worker onto it is the next
// iteration.

import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { AGENT_PROVIDERS, type AgentProvider } from '../shared/providers.js';
import type { NodeFrame } from './nodes.js';
import { accessHeaders, ACCESS_HELP, officeOrigin, nodeSocket } from './join-access.js';
import { addMapping, collectParadev } from './local-sessions/paradev.js';

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
  --paradev-map <workspace-id=floor-id>  Opt in one local workspace (repeatable)
  --paradev-bin <path>  Paradev CLI (default ~/.paradev/bin/paradev)
  -h, --help      Show this help
`;

const HELLO_MS = 15_000;
/** Reconnect patience: right away, then doubling to half a minute. */
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
  let paradevBin = path.join(os.homedir(), '.paradev/bin/paradev');
  const mappings = new Map<string, string>();
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
      else if (a === '--paradev-map') addMapping(mappings, value());
      else if (a === '--paradev-bin') paradevBin = value();
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

  try { url = officeOrigin(url); } catch { console.error('Use an http(s) office origin without credentials, path, query or fragment'); return 2; }
  let access: Awaited<ReturnType<typeof accessHeaders>> | undefined;
  if (cloudflareAccess) {
    try { access = await accessHeaders(url); } catch { console.error(ACCESS_HELP); return 1; }
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
  let current: WebSocket | undefined;
  let quit: (() => void) | undefined;
  process.once('SIGINT', () => {
    quit?.();
    current?.close(1000, 'bye');
  });
  for (;;) {
    if (access && Date.now() >= access.expiresAt - 1000) { say(ACCESS_HELP); return 1; }
    const code = await once(ws, token, name, say);
    if (code !== undefined) return code;
    const wait = Math.min(1000 * 2 ** retry++, RETRY_MAX_MS);
    say(`… reconnecting in ${Math.round(wait / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  /** One connection's whole life; undefined to retry, an exit code to stop. */
  function once(wsUrl: string, tok: string, nodeName: string | undefined, out: (line: string) => void): Promise<number | undefined> {
    return new Promise((resolve) => {
      const socket = nodeSocket(wsUrl, tok, access?.headers);
      current = socket;
      let heartbeat: NodeJS.Timeout | undefined;
      let sampleTimer: NodeJS.Timeout | undefined;
      let expiry: NodeJS.Timeout | undefined;
      let ended = false;
      const sample = async () => {
        const snapshot = await collectParadev(paradevBin, mappings);
        if (ended || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ t: 'local.snapshot', snapshot } satisfies NodeFrame));
        sampleTimer = setTimeout(() => void sample(), 30_000);
      };
      const stop = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        ended = true;
        if (sampleTimer) clearTimeout(sampleTimer);
        if (expiry) clearTimeout(expiry);
      };
      quit = () => {
        stop();
        out('  closed');
        resolve(0);
      };
      socket.on('open', () => {
        retry = 0;
        socket.send(JSON.stringify(hello(nodeName)));
        out('✓ joined — this machine is on the office wall (☰ → 🛰️ Satellites). Leave this running; Ctrl-C leaves.');
        heartbeat = setInterval(() => socket.send(JSON.stringify({ t: 'ping' } satisfies NodeFrame)), HELLO_MS);
        if (mappings.size) void sample();
        if (access) expiry = setTimeout(() => { stop(); out(ACCESS_HELP); socket.close(1000, 'Access session expired'); resolve(1); }, Math.min(2 ** 31 - 1, Math.max(1, access.expiresAt - Date.now() - 1000)));
      });
      socket.on('close', (code, reason) => {
        stop();
        quit = undefined;
        if (code === 4001 || code === 4000) {
          out("✗ the office doesn't know this token — it was revoked, or it's mistyped. Mint a new one in ☰ → 🛰️ Satellites.");
          resolve(1);
          return;
        }
        if (code === 1000) { resolve(0); return; }
        out(`… the connection dropped (${code})`);
        resolve(undefined);
      });
      socket.on('unexpected-response', (_req, res) => {
        res.resume();
        stop();
        socket.terminate();
        out(access ? ACCESS_HELP : 'Satellite authentication failed. Check the node invite and whether this office requires --cloudflare-access.');
        resolve(1);
      });
      socket.on('error', () => {
        stop();
        quit = undefined;
        out("… couldn't reach the office");
        resolve(undefined);
      });
    });
  }
}
