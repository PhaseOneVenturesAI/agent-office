import { createHash } from 'node:crypto';

export const CLAUDE_QA_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_QA_SHA256 = '4c00839cf46beb2b38ec310105f2d538f7f9321fe46c636299b74bcab94626b1';
export interface PolicyEvidence {
  accountId: string;
  fetchedAt: number;
  source: 'authenticated-native-policy';
  settings: Record<string, unknown>;
  limits: Record<string, unknown>;
  nativeIdentity: { accountUuid: string; organizationUuid: string; workspaceUuid?: string; subscriptionType: 'team' | 'enterprise'; scopes: string[]; expiresAt: number };
  settingsEnvelope: { uuid: string; checksum: string; settings: Record<string, unknown> };
  signatures: { settings: string; limits: string };
}
export interface ApprovedQaJob {
  accountId: string;
  model: string;
  prompt: string;
  policy: PolicyEvidence;
}
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function canonical(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
export const policyHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const known = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export function validatePolicyDocuments(settings: unknown, limits: unknown): void {
  if (!record(settings) || !known(settings, ['channelsEnabled']) || Object.values(settings).some(v => typeof v !== 'boolean')) throw new Error('Claude Q&A managed policy is unsupported.');
  if (!record(limits) || !known(limits, ['restrictions', 'compliance_taints', 'monitoring_notice', 'defaults']) || !record(limits.restrictions)) throw new Error('Claude Q&A policy limits are unsupported.');
  const keys = ['allow_connector_file_downloads', 'allow_connector_file_uploads', 'allow_computer_use', 'enforce_web_search_mcp_isolation', 'require_trusted_devices'];
  if (!known(limits.restrictions, keys) || Object.values(limits.restrictions).some(v => !record(v) || !known(v, ['allowed']) || typeof v.allowed !== 'boolean')) throw new Error('Claude Q&A restriction is unsupported.');
  if (limits.compliance_taints !== undefined && (!Array.isArray(limits.compliance_taints) || limits.compliance_taints.length)) throw new Error('Claude Q&A compliance policy is unsupported.');
  if (limits.monitoring_notice !== undefined && limits.monitoring_notice !== null) throw new Error('Claude Q&A requires a supported monitoring notice.');
  if (limits.defaults !== undefined && (!record(limits.defaults) || !known(limits.defaults, ['remote_control_at_startup']) || Object.values(limits.defaults).some(v => v !== false))) throw new Error('Claude Q&A remote defaults are unsupported.');
}

/** Called with evidence from a trusted policy fetcher, never from the sandbox's HTTP request. */
export function qualifyJob(job: ApprovedQaJob, now = Date.now()) {
  if (!job.accountId || job.model !== CLAUDE_QA_MODEL) throw new Error('Claude Q&A model or account is not qualified.');
  if (typeof job.prompt !== 'string' || !job.prompt.trim() || Buffer.byteLength(job.prompt) > 64_000) throw new Error('Claude Q&A input exceeds its limit.');
  const p = job.policy;
  if (!p || p.accountId !== job.accountId || p.source !== 'authenticated-native-policy' || !Number.isFinite(p.fetchedAt) || p.fetchedAt > now || now - p.fetchedAt > 60_000) throw new Error('Fresh authenticated custodian policy is required.');
  validatePolicyDocuments(p.settings, p.limits);
  const n = p.nativeIdentity;
  if (!n || !n.accountUuid || !n.organizationUuid || !['team', 'enterprise'].includes(n.subscriptionType) || !Array.isArray(n.scopes) || !n.scopes.includes('user:inference') || n.scopes.some(s => typeof s !== 'string') || !Number.isFinite(n.expiresAt) || n.expiresAt < now + 125_000) throw new Error('Qualified native subscription identity is required.');
  if (!p.settingsEnvelope || typeof p.settingsEnvelope.uuid !== 'string' || typeof p.settingsEnvelope.checksum !== 'string' || canonical(p.settingsEnvelope.settings) !== canonical(p.settings) || !p.signatures?.settings || !p.signatures.limits) throw new Error('Original signed policy documents are required.');
  // The original remote settings remain intact. This local source is only defense in depth;
  // remote precedence may shadow it, so the filesystem/network/process boundary remains required.
  return { settings: { disableAllHooks: true }, digest: policyHash(p), settingsDigest: policyHash(p.settings), limitsDigest: policyHash(p.limits) };
}
