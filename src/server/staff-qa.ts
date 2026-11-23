// Staff Q&A (see docs/department-leads.md): a read-only question about a department, answered on a
// SEPARATE one-shot ACP session — never the manager's own provider session. The session is
// provider-restricted, not prompt-restricted: it runs on the department's configured engine under
// an explicitly authorized custodian's own sign-in, from a dedicated tool-free home (the config's
// global tool switch removes every tool; the office additionally auto-rejects any permission
// request, and session/new declares no MCP servers). The prompt carries only an approved context
// snapshot. When the engine is not Kimi ACP, or no custodian is designated in an accounts office,
// the answer is a truthful "unavailable" — staff content is never passed into a manager session,
// never run on an arbitrary binary from PATH, and never on host credentials.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DshSession } from './dsh.js';
import { resolveCommand } from './workers/process.js';
import type { AgentEffort, AgentProvider } from '../shared/providers.js';

export type QaOutcome = { ok: true; answer: string } | { ok: false; why: string };

/** Providers whose tool-free mode the office can actually enforce today. Others fail closed. */
export const QA_SUPPORTED: ReadonlySet<AgentProvider> = new Set(['kimi']);

/**
 * Kimi versions whose tool-free behavior was VERIFIED on the actual installed binary (the reviewer's
 * source inspection of 2.7.2's toolPolicy). The wildcard disable-all is an implementation detail,
 * not a stable API, and the deployed provider version may differ — anything outside this pin fails
 * closed rather than assuming.
 */
export const QA_VERIFIED_VERSIONS: ReadonlySet<string> = new Set(['2.7.2']);

const versionCache = new Map<string, string | undefined>();
/** The CLI's reported version, cached; undefined when it can't be read. */
export function cliVersion(file: string): string | undefined {
  if (versionCache.has(file)) return versionCache.get(file);
  let found: string | undefined;
  try {
    const out = execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    found = /(\d+\.\d+\.\d+)/.exec(out)?.[1];
  } catch {
    found = undefined;
  }
  versionCache.set(file, found);
  return found;
}

/** Is this exact binary's tool-free mode verified? */
export function toolFreeVerified(file: string): boolean {
  const v = cliVersion(file);
  return !!v && QA_VERIFIED_VERSIONS.has(v);
}

/** The dedicated Q&A home: the source home's credentials, a tool-free config, the framing prompt. */
export function buildQaHome(sourceHome: string, framing: string): { home: string; cleanup: () => void } | string {
  let home: string;
  try {
    home = mkdtempSync(path.join(tmpdir(), 'agent-office-staff-qa-'));
    const credentials = path.join(sourceHome, 'credentials');
    if (existsSync(credentials)) cpSync(credentials, path.join(home, 'credentials'), { recursive: true });
    // Verified against the installed Kimi's documented global tool switch: an enabled list holding
    // only the bare wildcard disables every tool (and it is enforced again before execution). The
    // office ALSO auto-rejects permission requests; this is the provider-enforced layer beneath it.
    writeFileSync(
      path.join(home, 'config.toml'),
      [
        'default_permission_mode = "manual"',
        'telemetry = false',
        '',
        '[tools]',
        'enabled = ["*"]',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    writeFileSync(path.join(home, 'SYSTEM.md'), framing, { mode: 0o600 });
  } catch (err) {
    return `Couldn't prepare the read-only session: ${(err as Error).message}`;
  }
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/** The launch for a department's Q&A: its configured engine's CLI — never an arbitrary PATH binary. */
export function qaLaunch(provider: AgentProvider | undefined): { file: string; args: string[] } | string {
  if (!provider || !QA_SUPPORTED.has(provider)) {
    return `Read-only staff Q&A is only available on a Kimi-backed manager today (the manager's engine is ${provider ?? 'not configured'}); running it on an engine whose tool-free mode isn't verified would not be honest.`;
  }
  const file = resolveCommand('kimi');
  if (!file) return 'The Kimi CLI is not installed on this office machine.';
  if (!toolFreeVerified(file)) {
    const v = cliVersion(file);
    return `Read-only Q&A is withheld: this office's Kimi is ${v ?? 'unversioned'}, and its tool-free mode is only verified on ${[...QA_VERIFIED_VERSIONS].join(', ')}. The deployed provider version may differ, so the office fails closed rather than assuming.`;
  }
  return { file, args: ['acp'] };
}

/**
 * Runs one read-only question to a throwaway ACP session on an explicitly authorized environment.
 * Every permission request is rejected by the office (Esc); the provider config has already removed
 * the tools. Resolves with the answer text, or a truthful why.
 */
export function staffQaAsk(opts: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; prompt: string; model?: string; effort?: AgentEffort; timeoutMs?: number }): Promise<QaOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let answered = false;
    let session: DshSession;
    const finish = (outcome: QaOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void session.close().then(() => resolve(outcome));
    };
    session = new DshSession(
      { file: opts.file, args: opts.args, cwd: opts.cwd, env: opts.env, model: opts.model, effort: opts.effort, firstPrompt: opts.prompt },
      {
        output: () => {},
        status: (status) => {
          // Defense in depth: the config removed the tools; anything still asking is rejected.
          if (status === 'needs_input') session.writeInput('\x1b');
          if (status === 'done' && !answered) finish({ ok: false, why: 'The read-only session ended without an answer.' });
        },
        assistant: (text) => {
          answered = true;
          const answer = text.trim();
          finish(answer ? { ok: true, answer } : { ok: false, why: 'The read-only session answered with nothing.' });
        },
        action: () => {},
        usage: () => {},
        session: () => {},
        prompted: () => {},
        exit: (code, error) => finish({ ok: false, why: error ?? `The read-only session exited (${code ?? 'killed'}) before answering.` }),
      },
    );
    const timer = setTimeout(() => finish({ ok: false, why: 'The read-only session timed out.' }), opts.timeoutMs ?? 120_000);
    session.start();
  });
}

/** The approved context snapshot a staff answer may draw on: current brief, objective, references. */
export function qaContext(dept: { name: string; brief: { rev: number; text: string }[]; lead?: { objective?: { text: string } }; assets: { label: string; status: string }[] }): string {
  const brief = dept.brief[0];
  const assets = dept.assets.filter((a) => a.status === 'current').slice(0, 8);
  return [
    `Department: ${dept.name}.`,
    brief ? `Current brief (rev ${brief.rev}):\n${brief.text}` : 'No brief is written yet.',
    dept.lead?.objective ? `Active objective (for context only — you may not act on it):\n${dept.lead.objective.text}` : '',
    assets.length ? `Current approved references (labels only): ${assets.map((a) => a.label).join(', ')}.` : '',
  ].filter(Boolean).join('\n\n');
}
