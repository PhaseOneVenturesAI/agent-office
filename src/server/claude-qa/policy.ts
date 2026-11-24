import { createHash } from 'node:crypto';

export const CLAUDE_QA_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_QA_SHA256 = '4c00839cf46beb2b38ec310105f2d538f7f9321fe46c636299b74bcab94626b1';
export interface PolicyEvidence {
  accountId: string;
  fetchedAt: number;
  source: 'authenticated-native-policy';
  settings: Record<string, unknown>;
  limits: Record<string, unknown>;
}
export interface ApprovedQaJob {
  accountId: string;
  model: string;
  prompt: string;
  policy: PolicyEvidence;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Called with evidence from a trusted policy fetcher, never from the sandbox's HTTP request. */
export function qualifyJob(job: ApprovedQaJob, now = Date.now()) {
  if (!job.accountId || job.model !== CLAUDE_QA_MODEL) throw new Error('Claude Q&A model or account is not qualified.');
  if (typeof job.prompt !== 'string' || !job.prompt.trim() || Buffer.byteLength(job.prompt) > 64_000) throw new Error('Claude Q&A input exceeds its limit.');
  const p = job.policy;
  if (!p || p.accountId !== job.accountId || p.source !== 'authenticated-native-policy' || !Number.isFinite(p.fetchedAt) || p.fetchedAt > now || now - p.fetchedAt > 60_000) throw new Error('Fresh authenticated custodian policy is required.');
  if (!record(p.settings) || !record(p.limits) || Object.keys(p.limits).length) throw new Error('Claude Q&A policy limits are unsupported.');
  // Initial qualification is deliberately small. New policy never disappears into a default.
  for (const [key, value] of Object.entries(p.settings)) {
    if (key !== 'channelsEnabled' || typeof value !== 'boolean') throw new Error('Claude Q&A managed policy is unsupported.');
  }
  const settings = { ...p.settings, disableAllHooks: true };
  return { settings, digest: createHash('sha256').update(JSON.stringify({ accountId: p.accountId, fetchedAt: p.fetchedAt, settings: p.settings, limits: p.limits })).digest('hex') };
}
