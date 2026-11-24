import { Agent, request } from 'node:https';
import { record, validatePolicyDocuments, type PolicyEvidence } from './policy.js';
import { verifyPolicySignature } from './policy-signature.js';

export interface NativePolicyContext {
  accountId: string; accessToken: string; oauthAccount: Record<string, unknown>; signal: AbortSignal;
}
export interface NativePolicyReply { status: number; body: Buffer; headers: Record<string, string> }
export type NativePolicyFetcher = (route: 'settings' | 'policy_limits', token: string, signal: AbortSignal) => Promise<NativePolicyReply>;
/** Exact 2.1.331 read contract; no profile lookup, refresh, API key, redirect, or inherited proxy. */
export const fetchNativePolicy: NativePolicyFetcher = (route, token, signal) => new Promise((resolve, reject) => {
  const agent = new Agent({ keepAlive: false });
  const req = request({ hostname: 'api.anthropic.com', port: 443, path: `/api/claude_code/${route}`, method: 'GET', agent, signal,
    headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'claude-code/2.1.331', 'cache-control': 'no-cache', pragma: 'no-cache', accept: 'application/json', ...(route === 'policy_limits' ? { 'anthropic-client-capabilities': 'computer_use_apps_v1' } : {}) },
  }, response => {
    const parts: Buffer[] = []; let size = 0;
    response.on('data', (part: Buffer) => { size += part.length; if (size > 1_000_000) req.destroy(new Error('Policy response exceeds limit.')); else parts.push(part); });
    response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(parts), headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }));
  });
  req.on('error', () => reject(new Error('Authenticated Claude policy is unavailable.')));
  req.on('close', () => agent.destroy()); req.setTimeout(15_000, () => req.destroy()); req.end();
});

/** Trusted controller only. The app cannot supply documents, identity fields, endpoints or tokens. */
export async function qualifySelectedAccount(context: NativePolicyContext, fetcher: NativePolicyFetcher = fetchNativePolicy): Promise<PolicyEvidence> {
  const { accountId, accessToken, oauthAccount: a } = context, now = Date.now();
  if (!accountId || !accessToken || /[\r\n]/.test(accessToken) || typeof a.accountUuid !== 'string' || !a.accountUuid || typeof a.organizationUuid !== 'string' || !a.organizationUuid || (a.workspaceUuid !== undefined && typeof a.workspaceUuid !== 'string') || !['team', 'enterprise'].includes(String(a.subscriptionType)) || !Array.isArray(a.scopes) || a.scopes.some(s => typeof s !== 'string') || !a.scopes.includes('user:inference') || typeof a.expiresAt !== 'number' || !Number.isFinite(a.expiresAt) || a.expiresAt < now + 180_000) throw new Error('Selected native Claude identity is not qualified or needs owner refresh.');
  const nativeIdentity: PolicyEvidence['nativeIdentity'] = { accountUuid: a.accountUuid, organizationUuid: a.organizationUuid, ...(typeof a.workspaceUuid === 'string' ? { workspaceUuid: a.workspaceUuid } : {}), subscriptionType: a.subscriptionType as 'team' | 'enterprise', scopes: [...a.scopes] as string[], expiresAt: a.expiresAt };
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]);
  const read = async (route: 'settings' | 'policy_limits') => {
    const r = await fetcher(route, accessToken, signal);
    if (signal.aborted || r.status !== 200 || !r.headers['content-type']?.includes('application/json') || !r.headers['request-id'] || !r.headers['x-claude-code-signature'] || r.body.length > 1_000_000) throw new Error('A complete authenticated Claude policy response is required.');
    try { return { body: JSON.parse(r.body.toString()) as unknown, signature: r.headers['x-claude-code-signature'] }; }
    catch { throw new Error('Claude policy response is not valid JSON.'); }
  };
  const [settings, limits] = await Promise.all([read('settings'), read('policy_limits')]);
  if (!record(settings.body) || Object.keys(settings.body).some(k => !['uuid', 'checksum', 'settings'].includes(k)) || typeof settings.body.uuid !== 'string' || typeof settings.body.checksum !== 'string' || !record(settings.body.settings) || !record(limits.body)) throw new Error('Claude policy envelope is unsupported.');
  validatePolicyDocuments(settings.body.settings, limits.body);
  verifyPolicySignature({ jws: settings.signature, kind: 'managed-settings', body: settings.body.settings, identity: nativeIdentity });
  verifyPolicySignature({ jws: limits.signature, kind: 'policy-limits', body: limits.body, identity: nativeIdentity });
  return { accountId, fetchedAt: Date.now(), source: 'authenticated-native-policy', settings: settings.body.settings, limits: limits.body, nativeIdentity,
    settingsEnvelope: { uuid: settings.body.uuid, checksum: settings.body.checksum, settings: settings.body.settings }, signatures: { settings: settings.signature, limits: limits.signature } };
}
