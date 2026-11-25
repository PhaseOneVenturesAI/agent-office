// Kimi's plan limits, from the same account endpoint the Kimi CLI's /usage panel reads
// (`GET <base>/usages`, plus `/me` for the plan's name). It takes the access token the CLI
// already stored in its home (or a pasted KIMI_API_KEY), so asking starts no conversation and
// costs nothing. The token is never refreshed here — refreshing rotates it, and the CLI's own
// copy would be left stale — so an expired one is a failed read until the CLI runs again.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PlanLimits, PlanWindow } from '../../shared/protocol.js';
import { defaultKimiHome } from '../signin-flows.js';
import type { LimitsRead } from './reader.js';

const TIMEOUT_MS = 15_000;
const LABEL_MAX = 24;
const MAINLAND_BASE = 'https://api.kimi.com/coding/v1';
const GLOBAL_BASE = 'https://api.kimi.ai/coding/v1';

/** Reads Kimi's plan limits, in `env` (whose KIMI_CODE_HOME or KIMI_API_KEY to read). */
export function kimiLimits(env: Record<string, string>): LimitsRead {
  return () => read(env);
}

async function read(env: Record<string, string>): Promise<PlanLimits | null> {
  const token = env.KIMI_API_KEY || storedToken(defaultKimiHome(env));
  // No sign-in at all: nothing to show, and no reason to keep asking often.
  if (!token) return { windows: [], at: Date.now() };
  if (token === 'expired') return null;
  const base = baseUrl(env, defaultKimiHome(env));
  const usage = await getJson(`${base}/usages`, token);
  if (usage === null) return null;
  if (usage === 'missing') return { windows: [], at: Date.now() };
  const me = await getJson(`${base}/me`, token);
  const plan = me && typeof me === 'object' && typeof (me as any).user_level_name === 'string' ? (me as any).user_level_name.slice(0, LABEL_MAX) : undefined;
  return parseKimiLimits(usage, plan);
}

/** The CLI's stored OAuth access token: undefined when there is none, 'expired' when it's past its time. */
function storedToken(home: string): string | 'expired' | undefined {
  let saved: any;
  try {
    saved = JSON.parse(readFileSync(path.join(home, 'credentials', 'kimi-code.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof saved?.access_token !== 'string' || !saved.access_token) return undefined;
  // expires_at is Unix seconds (older files may say 0, meaning unknown: take the token as it is).
  if (typeof saved.expires_at === 'number' && saved.expires_at > 0 && saved.expires_at * 1000 <= Date.now()) return 'expired';
  return saved.access_token;
}

/** The account endpoint the CLI would use: KIMI_CODE_BASE_URL, else by its region marker. */
function baseUrl(env: Record<string, string>, home: string): string {
  if (env.KIMI_CODE_BASE_URL) return env.KIMI_CODE_BASE_URL.replace(/\/+$/, '');
  let region = '';
  try {
    region = readFileSync(path.join(home, 'region'), 'utf8').trim();
  } catch {
    // no marker: the CLI's default region
  }
  return region === 'global' ? GLOBAL_BASE : MAINLAND_BASE;
}

/** The answer's JSON; 'missing' when the endpoint isn't there (an API key with no plan); null on failure. */
async function getJson(url: string, token: string): Promise<any | 'missing' | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function toWindow(label: string, e: any): PlanWindow | null {
  if (typeof e?.used_ratio !== 'number' || !Number.isFinite(e.used_ratio)) return null;
  const resetsAt = typeof e.reset_time === 'string' ? Date.parse(e.reset_time) : NaN;
  return { label, pct: Math.max(0, Math.min(100, e.used_ratio * 100)), resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined };
}

/** The `/usages` answer as the meter's windows: the 5-hour session, the week and the month. Exported for tests. */
export function parseKimiLimits(payload: any, plan?: string): PlanLimits {
  const u = payload?.usages;
  const windows = [toWindow('5h session', u?.limit_5h), toWindow('Week', u?.limit_7d), toWindow('Month', u?.limit_month_total)].filter((w): w is PlanWindow => w !== null);
  return { plan, windows, at: Date.now() };
}
