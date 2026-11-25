// Codex's plan limits, from its app server's `account/rateLimits/read`: the same windows the
// Codex TUI's /status shows. The app server speaks newline-delimited JSON-RPC on stdio; asking
// for the account's rate limits starts no conversation and costs nothing, and Codex deals with
// the sign-in (its CODEX_HOME) itself.

import { spawn } from 'node:child_process';
import os from 'node:os';
import type { PlanLimits, PlanWindow } from '../../shared/protocol.js';
import type { LimitsRead } from './reader.js';

const TIMEOUT_MS = 30_000;
const LABEL_MAX = 24;

/** Reads Codex's plan limits with the `codex` binary, in `env` (whose CODEX_HOME to read). */
export function codexLimits(codex: string, env: Record<string, string>): LimitsRead {
  return () => ask(codex, env).then((answer) => (answer === null ? null : parseCodexLimits(answer)));
}

/** PlanType from the app server ('plus', 'pro', 'promax', 'team'…), for the meter's badge. */
function planName(planType: any): string | undefined {
  if (typeof planType !== 'string' || !planType || planType === 'unknown') return undefined;
  const known: Record<string, string> = { promax: 'Pro Max', prolite: 'Pro Lite', go: 'Go', edu: 'Edu' };
  const name = known[planType] ?? planType.charAt(0).toUpperCase() + planType.slice(1).replace(/_/g, ' ');
  return name.slice(0, LABEL_MAX);
}

/** A window's name from its length: Codex's 5-hour session and its week, like Claude's. */
function windowLabel(mins: any): string {
  if (mins === 300) return '5h session';
  if (mins === 10080) return 'Week';
  if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return 'Limit';
  if (mins < 60) return `${Math.round(mins)}m limit`;
  if (mins < 1440) return `${Math.round(mins / 60)}h limit`;
  return `${Math.round(mins / 1440)}d limit`;
}

function toWindow(w: any): PlanWindow | null {
  if (typeof w?.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return null;
  // resetsAt is Unix seconds on the wire.
  const resetsAt = typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : undefined;
  return { label: windowLabel(w.windowDurationMins), pct: Math.max(0, Math.min(100, w.usedPercent)), resetsAt };
}

/** The `account/rateLimits/read` answer as the meter's windows. Exported for tests. */
export function parseCodexLimits(answer: any): PlanLimits {
  const rl = answer?.rateLimits;
  if (!rl || typeof rl !== 'object') return { windows: [], at: Date.now() };
  const windows = [toWindow(rl.primary), toWindow(rl.secondary)].filter((w): w is PlanWindow => w !== null);
  return { plan: planName(rl.planType), windows, at: Date.now() };
}

/** One app-server session: initialize, ask for the rate limits, hang up. Null when it couldn't answer. */
function ask(codex: string, env: Record<string, string>): Promise<any> {
  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    const child = spawn(codex, ['app-server'], { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (v: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
      child.stdin.end();
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 10_000).unref();
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.id === 1) {
          if (msg.error) return finish(null);
          send({ id: 2, method: 'account/rateLimits/read', params: null });
        } else if (msg?.id === 2) {
          finish(msg.error ? null : (msg.result ?? null));
        }
      }
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.on('error', () => {});
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent-office', title: null, version: '1' } } });
  });
}
