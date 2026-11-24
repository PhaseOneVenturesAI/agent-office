import { createHash, randomBytes } from 'node:crypto';
import type { LinearStore } from './store.js';
export interface LinearConfig { clientId: string; clientSecret: string; webhookSecret: string; origin: string; ownerAccountId: string; organizationId: string }
export function linearConfig(): LinearConfig | undefined {
  const prefix = 'AGENT_OFFICE_LINEAR_';
  const get = (name: string) => process.env[prefix + name] ?? '';
  const config = { clientId: get('CLIENT_ID'), clientSecret: get('CLIENT_SECRET'), webhookSecret: get('WEBHOOK_SECRET'), origin: get('ORIGIN'), ownerAccountId: get('OWNER_ACCOUNT_ID'), organizationId: get('ORGANIZATION_ID') };
  if (!Object.values(config).every(Boolean)) return;
  const url = new URL(config.origin);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Linear requires an HTTPS Office origin');
  config.origin = url.origin; return config;
}
export class LinearApiError extends Error { constructor(message: string, readonly retryAfter = 60_000) { super(message); } }
export class LinearClient {
  private refreshing?: Promise<void>;
  private pending = new Map<string, { account: string; verifier: string; expires: number }>();
  constructor(readonly config: LinearConfig, readonly store: LinearStore, private request: typeof fetch = fetch) {}
  authorize(account: string) {
    if (account !== this.config.ownerAccountId) throw new Error('Only the configured Office owner can connect Linear');
    for (const [key, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(key);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    this.pending.set(state, { account, verifier, expires: Date.now() + 600_000 });
    const q = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.callback(), response_type: 'code', scope: 'read,issues:create', actor: 'app', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    return `https://linear.app/oauth/authorize?${q}`;
  }
  private callback() { return `${this.config.origin}/api/linear/callback`; }
  async exchange(account: string, state: string, code: string) {
    const pending = this.pending.get(state); this.pending.delete(state);
    if (!pending || pending.account !== account || pending.expires < Date.now() || account !== this.config.ownerAccountId) throw new Error('Linear authorization expired or belongs to another account');
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.callback(), code_verifier: pending.verifier });
  }
  private async token(params: Record<string, string>) {
    const response = await this.request('https://api.linear.app/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: this.config.clientId, client_secret: this.config.clientSecret }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) { this.store.data.token = undefined; this.store.save(); }
      throw new LinearApiError('Linear authorization needs reconnecting');
    }
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!result.access_token || !result.refresh_token || !result.expires_in) throw new Error('Incomplete Linear token response');
    this.store.data.token = { access: result.access_token, refresh: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000 };
    this.store.save();
  }
  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const saved = this.store.data.token;
    if (!saved) throw new Error('Connect Linear first');
    if (saved.expiresAt < Date.now() + 60_000) {
      this.refreshing ??= this.token({ grant_type: 'refresh_token', refresh_token: saved.refresh }).finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    const response = await this.request('https://api.linear.app/graphql', { method: 'POST', headers: { Authorization: `Bearer ${this.store.data.token!.access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
    if (response.status === 401) { this.store.data.token = undefined; this.store.save(); throw new LinearApiError('Linear authorization needs reconnecting'); }
    if (!response.ok) throw new LinearApiError(`Linear request failed (${response.status})`, Math.max(60_000, Number(response.headers.get('retry-after') || 60) * 1000));
    const result = await response.json() as { data?: T; errors?: { message: string }[] };
    if (result.errors?.length || !result.data) throw new LinearApiError('Linear rejected the request; check team access and integration permissions');
    return result.data;
  }
}
