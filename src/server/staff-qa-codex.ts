// One-shot Codex Q&A, independent of manager sessions and renewable credentials.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AgentEffort } from '../shared/providers.js';
import type { QaOutcome } from './staff-qa.js';
import { codexQaAuth } from './staff-qa-codex-auth.js';
import { CODEX_QA_CATALOG, CODEX_QA_TIMEOUT_MS, CODEX_QA_VERSION, codexQaConfig, codexQaModelProblem } from './staff-qa-codex-config.js';

const RUNTIME_KEYS = new Set(['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'CODEX_HOME']);
const MAX_OUTPUT = 1_000_000;

export async function codexStaffQaAsk(opts: {
  file: string; env: Record<string, string>; prompt: string; model?: string; effort?: AgentEffort;
}): Promise<QaOutcome> {
  const problem = codexQaModelProblem(opts.model);
  if (problem) return { ok: false, why: problem };
  // This is not a generic command runner. In particular, API keys, provider URLs, alternate homes,
  // dynamic-loader variables and arbitrary Codex configuration must never cross this boundary.
  if (Object.keys(opts.env).some((key) => !RUNTIME_KEYS.has(key))) return { ok: false, why: 'The isolated Codex environment contains unsupported settings or credentials.' };
  const sourceHome = opts.env.CODEX_HOME;
  if (!sourceHome || !path.isAbsolute(sourceHome)) return { ok: false, why: 'Codex Q&A requires the selected custodian’s own sign-in; the office machine’s login is not a fallback.' };
  let root: string | undefined;
  try {
    root = mkdtempSync(path.join(process.platform === 'linux' ? '/tmp' : tmpdir(), 'agent-office-codex-qa-'));
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'cwd');
    const temp = path.join(root, 'tmp');
    for (const dir of [home, cwd, temp]) mkdirSync(dir, { mode: 0o700 });
    const env: Record<string, string> = { HOME: home, CODEX_HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp };
    for (const key of ['PATH', 'LANG', 'LC_ALL']) if (opts.env[key]) env[key] = opts.env[key];
    // The CLI may update between the capability check and launch. Check again without inherited
    // account or Office environment, before opening the selected credential store.
    const version = execFileSync(opts.file, ['--version'], { env, cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (version !== `codex-cli ${CODEX_QA_VERSION}`) return { ok: false, why: `Isolated Codex Q&A requires exactly codex-cli ${CODEX_QA_VERSION}.` };
    const auth = codexQaAuth(sourceHome);
    if (typeof auth === 'string') return { ok: false, why: auth };
    const catalog = path.join(home, 'qa-models.json');
    writeFileSync(catalog, JSON.stringify(CODEX_QA_CATALOG), { mode: 0o600 });
    writeFileSync(path.join(home, 'config.toml'), codexQaConfig(catalog), { mode: 0o600 });
    writeFileSync(path.join(home, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
    const args = ['exec', '--strict-config', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json', '--color', 'never'];
    if (opts.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(opts.effort)}`);
    args.push('-'); // Prompt via stdin, never command-line process listings.
    return await runCodexQa({ file: opts.file, args, cwd, env, prompt: opts.prompt });
  } catch {
    return { ok: false, why: 'The isolated Codex Q&A session could not be prepared or started.' };
  } finally {
    if (root) {
      try { rmSync(root, { recursive: true, force: true }); }
      catch { return { ok: false, why: 'The disposable Codex Q&A home could not be removed.' }; }
    }
  }
}

/** Bounded JSONL transport. No native diagnostic/error text can disclose credentials to staff. */
export function runCodexQa(opts: {
  file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; prompt: string; timeoutMs?: number;
}): Promise<QaOutcome> {
  return new Promise((resolve) => {
    const child = spawn(opts.file, opts.args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let answer = '';
    let completed = false;
    let failed = false;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    let bytes = 0;
    let why: string | undefined;
    let settled = false;
    const kill = () => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    const stop = (reason: string) => { why ??= reason; kill(); };
    const timer = setTimeout(() => stop('The isolated Codex Q&A session timed out.'), opts.timeoutMs ?? CODEX_QA_TIMEOUT_MS);
    const line = (text: string) => {
      if (!text.trim()) return;
      try {
        const event = JSON.parse(text);
        if (event.type === 'turn.completed') completed = true;
        if (event.type === 'turn.failed' || event.type === 'error') failed = true;
        if (event.type === 'item.completed' || event.type === 'item.started' || event.type === 'item.updated') {
          if (event.item?.type === 'agent_message' && event.type === 'item.completed' && typeof event.item.text === 'string') answer = event.item.text.trim();
          else if (event.item?.type === 'error') failed = true;
          else if (!['agent_message', 'reasoning'].includes(event.item?.type)) stop('The isolated Codex session reported an unexpected capability; Q&A was stopped.');
        }
      } catch { stop('The isolated Codex session returned an invalid response.'); }
    };
    const count = (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_OUTPUT) stop('The isolated Codex Q&A session exceeded its output limit.'); };
    child.stdout.on('data', (chunk: Buffer) => {
      count(chunk);
      if (why) return;
      buffer += decoder.write(chunk);
      let at: number;
      while ((at = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    });
    child.stderr.on('data', count);
    child.stdin.on('error', () => {}); // A rejected auth/startup may close stdin immediately.
    child.on('error', () => { why = 'The isolated Codex Q&A process could not start.'; });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      kill(); // Reap any descendants before deleting the disposable home.
      buffer += decoder.end();
      if (buffer && !why) line(buffer);
      resolve(why ? { ok: false, why }
        : code === 0 && completed && !failed && answer ? { ok: true, answer }
          : { ok: false, why: 'Codex Q&A did not complete. Check the custodian’s ChatGPT sign-in and retry; no account or provider fallback was used.' });
    });
    child.stdin.end(opts.prompt);
  });
}
