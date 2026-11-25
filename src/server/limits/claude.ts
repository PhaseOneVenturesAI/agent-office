// Claude's plan limits, as Claude Code's /usage shows them. Claude Code answers a `get_usage`
// control request on its stream-json protocol; asking starts no conversation and costs nothing,
// and Claude Code deals with the sign-in (keychain, token refresh) itself.

import { spawn } from 'node:child_process';
import os from 'node:os';
import type { PlanLimits, PlanWindow } from '../../shared/protocol.js';
import type { LimitsRead } from './reader.js';

const TIMEOUT_MS = 30_000;
const LABEL_MAX = 24;

/** Reads Claude's plan limits with the `claude` binary, in `env` (whose sign-in to read). */
export function claudeLimits(claude: string, env: Record<string, string>): LimitsRead {
  /** Per-model weeks from the last answer that listed them; an answer from Claude Code's cache may not. */
  let modelWeeks: PlanWindow[] = [];
  return async () => {
    const answer = await ask(claude, env);
    if (answer === null) return null;
    const rl = answer?.rate_limits;
    const plan = typeof answer?.subscription_type === 'string' ? answer.subscription_type.slice(0, LABEL_MAX) : undefined;
    if (answer?.rate_limits_available === false || !rl || typeof rl !== 'object') {
      modelWeeks = [];
      return { plan, windows: [], at: Date.now() };
    }
    const windows = [toWindow('5h session', rl.five_hour), toWindow('Week', rl.seven_day)];
    if (Array.isArray(rl.model_scoped)) {
      modelWeeks = rl.model_scoped
        .filter((m: any) => typeof m?.display_name === 'string' && m.display_name.trim())
        .map((m: any) => toWindow(`${m.display_name.trim().slice(0, LABEL_MAX)} week`, m))
        .filter((w: PlanWindow | null): w is PlanWindow => w !== null);
    } else if (rl.seven_day_opus || rl.seven_day_sonnet) {
      // Claude Code before per-model buckets
      modelWeeks = [toWindow('Opus week', rl.seven_day_opus), toWindow('Sonnet week', rl.seven_day_sonnet)].filter((w): w is PlanWindow => w !== null);
    }
    return { plan, windows: [...windows.filter((w): w is PlanWindow => w !== null), ...modelWeeks], at: Date.now() };
  };
}

function toWindow(label: string, w: any): PlanWindow | null {
  if (typeof w?.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
  const resetsAt = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
  return { label, pct: Math.max(0, Math.min(100, w.utilization)), resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined };
}

/** Claude Code's structured /usage answer, or null when it couldn't give one. */
function ask(claude: string, env: Record<string, string>): Promise<any> {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    // Not the user's or the project's settings: no hooks, no MCP servers, no plugins, no transcript.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    const child = spawn(claude, args, { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (v: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
      // No prompt was sent, so a closed stdin ends the session; a stuck one is killed.
      child.stdin.end();
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 10_000).unref();
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
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
        const res = msg?.type === 'control_response' ? msg.response : undefined;
        if (res?.request_id === 'usage') finish(res.subtype === 'success' ? (res.response ?? null) : null);
      }
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } }) + '\n');
  });
}
