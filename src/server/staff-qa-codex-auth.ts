// Read an account's current ChatGPT access token only. Q&A never owns refresh credentials.
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CODEX_QA_TIMEOUT_MS } from './staff-qa-codex-config.js';

const REFRESH = 'The custodian’s Codex access token needs refreshing. Open their Codex sign-in or native manager session, then retry Q&A. Office will not refresh a disposable credential copy.';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);

/** Exact Codex external-ChatGPT-token storage shape; intentionally no renewable credential. */
export function codexQaAuth(sourceHome: string, now = Date.now()): RecordValue | string {
  try {
    const file = path.join(sourceHome, 'auth.json');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256_000) return 'Codex Q&A requires a regular account-owned ChatGPT credential file.';
    const auth: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!record(auth) || (auth.auth_mode !== undefined && auth.auth_mode !== 'chatgpt')
      || auth.OPENAI_API_KEY || auth.openai_api_key || !record(auth.tokens)) {
      return 'Codex Q&A requires this custodian’s personal ChatGPT login; API keys and other authentication modes are not supported.';
    }
    const token = auth.tokens.access_token;
    const account = auth.tokens.account_id;
    if (typeof token !== 'string' || typeof account !== 'string' || !account || token.length > 64_000) return REFRESH;
    const parts = token.split('.');
    if (parts.length !== 3) return REFRESH;
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!record(claims) || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
      || claims.exp * 1000 <= now + CODEX_QA_TIMEOUT_MS + 60_000) return REFRESH;
    // Claims are used for consistency/expiry, not signature authentication; native/provider auth
    // still validates the credential. The source is the selected custodian's canonical store.
    const identity = claims['https://api.openai.com/auth'];
    if (!record(identity) || identity.chatgpt_account_id !== account) return 'Codex Q&A found inconsistent custodian account credentials. Sign in again before retrying.';
    return {
      auth_mode: 'chatgptAuthTokens',
      tokens: { id_token: token, access_token: token, refresh_token: '', account_id: account },
      last_refresh: new Date(now).toISOString(),
    };
  } catch {
    return 'Codex Q&A could not read this custodian’s ChatGPT login. Sign in to Codex before retrying.';
  }
}
