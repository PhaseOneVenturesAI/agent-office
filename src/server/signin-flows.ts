// The machinery behind server/signins.ts: the pipe-based device-code login GitHub and Kimi share
// (spawn, watch the output for the one-time code and the page to open, report the exit), the
// per-kind output parsers, and the pure file and process helpers the sign-ins use. The bookkeeping
// (who is signing in, what their state is) stays in signins.ts.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A sign-in the office is running for someone. */
export interface Flow {
  stop(): void;
  /** Types into it: the code from Claude's sign-in page. */
  write?(data: string): void;
}

export interface DeviceLogin {
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** The login is given up on after this long. */
  timeoutMs: number;
  /** The first code and page found in the accumulated output, when there are any yet. */
  find(out: string): { url?: string; code?: string } | undefined;
  onPending(pending: { url?: string; code?: string }): void;
  onExit(exitCode: number | null, out: string): void;
  onError(message: string): void;
}

/**
 * Runs a device-code login to its end: over pipes the CLI prints the one-time code and the page,
 * then waits for the service to say yes. Callbacks guard against a stale flow themselves (an
 * `error` event is followed by `exit`).
 */
export function deviceLogin(opts: DeviceLogin): Flow {
  const p = spawn(opts.cmd, opts.args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const flow: Flow = { stop: () => p.kill() };
  const timer = setTimeout(flow.stop, opts.timeoutMs);
  const onData = (d: Buffer) => {
    out = (out + d.toString('utf8')).slice(-20_000);
    const found = opts.find(out);
    if (found) opts.onPending(found);
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('error', (err) => {
    clearTimeout(timer);
    opts.onError(err.message);
  });
  p.on('exit', (exitCode) => {
    clearTimeout(timer);
    opts.onExit(exitCode, out);
  });
  return flow;
}

/** GitHub's one-time code and device page in `gh auth login --web` output. */
export function findGithub(out: string): { url?: string; code?: string } | undefined {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(out)?.[1];
  if (!code) return undefined;
  const url = /https:\/\/github\.com\/login\/device\S*/.exec(out)?.[0] ?? 'https://github.com/login/device';
  return { url, code };
}

/** Kimi's device code and authorize page in `kimi login` output. */
export function findKimi(out: string): { url?: string; code?: string } | undefined {
  const text = plain(out);
  // The CLI prints verificationUriComplete, not a fixed .ai domain/path. Wait for both complete
  // lines: signins.ts keeps the first pending code, so a partial/fallback URL would stick.
  const code = /enter code:[ \t]*([A-Z0-9]{4}-[A-Z0-9]{4})[ \t]*\n/i.exec(text)?.[1];
  const url = /(?:^|\n)Opening browser for Kimi device login:[ \t]*(https:\/\/\S+)[ \t]*\n/i.exec(text)?.[1];
  if (!code || !url) return undefined;
  try {
    const parsed = new URL(url);
    const codes = parsed.searchParams.getAll('user_code');
    if (!/(^|\.)kimi\.(com|ai)$/.test(parsed.hostname) || parsed.username || parsed.password || codes.length !== 1 || codes[0] !== code) return undefined;
    return { url, code };
  } catch {
    return undefined;
  }
}

/** Codex's one-time code and device page in `codex login --device-auth` output (ANSI between words). */
export function findCodex(out: string): { url?: string; code?: string } | undefined {
  const code = /one-time code[\s\S]{0,120}?([A-Z0-9]{4}-[A-Z0-9]{5})/i.exec(out)?.[1];
  if (!code) return undefined;
  const url = /https:\/\/auth\.openai\.com\/codex\/device[\w/?=&%-]*/.exec(out)?.[0];
  return { url: url ?? 'https://auth.openai.com/codex/device', code };
}

/** Whether a CODEX_HOME holds login credentials (auth.json, written by any of its logins). */
export function codexSignedIn(codexHome: string): boolean {
  return existsSync(path.join(codexHome, 'auth.json'));
}

/** The CODEX_HOME of the office machine itself, when its environment doesn't say. */
export function defaultCodexHome(env: Record<string, string>): string {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** Who a signed-in Codex answers as, from `codex login status` (an email when it prints one). */
export async function codexWho(codex: string, env: Record<string, string>): Promise<string | undefined> {
  const r = await run(codex, ['login', 'status'], env);
  if (!r.out || /not logged in/i.test(r.out)) return undefined;
  return /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(r.out)?.[0] ?? 'your ChatGPT account';
}

/** Whether a KIMI_CODE_HOME holds login credentials (the CLI refreshes them itself). */
export function kimiSignedIn(kimiHome: string): boolean {
  try {
    return readdirSync(path.join(kimiHome, 'credentials')).some((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
}

/** The KIMI_CODE_HOME of the office machine itself, when its environment doesn't say. */
export function defaultKimiHome(env: Record<string, string>): string {
  return env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

/** Claude's own settings in an account's folder: its first-run questions already answered. */
export function seed(dir: string, change?: (c: any) => void) {
  const file = path.join(dir, '.claude.json');
  let c: any = {};
  try {
    c = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // new
  }
  const before = JSON.stringify(c);
  c.hasCompletedOnboarding = true;
  change?.(c);
  if (JSON.stringify(c) === before) return;
  try {
    writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
  }
}

/** Folders the office's own Claude trusts, the account's Claude trusts too: they're the same projects. */
export function trust(configDir: string, dirs: string[], base: Record<string, string>) {
  let office: any;
  try {
    office = JSON.parse(readFileSync(base.CLAUDE_CONFIG_DIR ? path.join(base.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return;
  }
  const trusted = (d: string) => office?.projects?.[d]?.hasTrustDialogAccepted === true;
  if (!dirs.some(trusted)) return;
  seed(configDir, (c) => {
    c.projects ??= {};
    for (const d of dirs) c.projects[d] = { ...c.projects[d], hasTrustDialogAccepted: true };
  });
}

/**
 * An account's git config: its own gh credentials for GitHub, without including host credentials, so
 * pushes go out as them, and their GitHub name and private email on commits once it's known.
 */
export function writeGitConfig(home: string, _base: Record<string, string>, gh: string | null, user?: { name: string; email: string }) {
  const lines = ['# Written by Agent Office: git for this account, using only its own credentials.'];
  if (gh) {
    for (const host of ['https://github.com', 'https://gist.github.com']) {
      lines.push(`[credential ${quote(host)}]`, '\thelper =', `\thelper = ${quote(`!'${gh.replace(/'/g, `'\\''`)}' auth git-credential`)}`);
    }
  }
  if (user) lines.push('[user]', `\tname = ${quote(user.name)}`, `\temail = ${quote(user.email)}`);
  const text = `${lines.join('\n')}\n`;
  const file = path.join(home, 'gitconfig');
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(file, text, { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
  }
}

/** A value for a git config file, quoted. */
function quote(v: string): string {
  return `"${v.replace(/[\p{C}]/gu, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Terminal output as plain text: no colors, links or cursor moves. */
export function plain(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n');
}

/** The last thing a command said, minus the link and the prompt, for an error line. */
export function lastWords(s: string): string {
  const lines = plain(s)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/https?:\/\/|paste code|opening browser|press enter/i.test(l));
  return (lines.at(-1) ?? '').slice(0, 300);
}

const RUN_TIMEOUT_MS = 30_000;

/** Runs a command to the end; never rejects. `last` is the last line it said on stderr (or stdout). */
export function run(cmd: string, args: string[], env: Record<string, string>, input?: string): Promise<{ code: number; out: string; last: string }> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { env, timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as { code?: number | string } | null;
      const code = !e ? 0 : typeof e.code === 'number' ? e.code : -1;
      const last = lastWords(stderr || (err && !stdout ? err.message : ''));
      resolve({ code, out: stdout.trim(), last });
    });
    if (input !== undefined) p.stdin?.end(input);
    else p.stdin?.end();
  });
}
