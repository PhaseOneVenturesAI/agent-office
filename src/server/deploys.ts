// The Deploy board: the office's Cloudflare Pages and Workers projects, listed from the
// Cloudflare API with credentials that stay on the server (--cf-account-id / --cf-api-token,
// or their AGENT_OFFICE_CF_* envs). This board is read-only.
import type { DeployItem, DeploysState } from '../shared/protocol.js';

/** How long a fetch is trusted before the next ask refetches. */
const CACHE_MS = 5 * 60_000;
const API = 'https://api.cloudflare.com/client/v4';

async function defaultFetchJson(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    // handled by the status
  }
  return { status: res.status, json };
}

type FetchJson = typeof defaultFetchJson;

export interface DeploysConfig {
  accountId: string;
  apiToken: string;
}

export class Deploys {
  private items: DeployItem[] = [];
  private fetchedAt?: number;
  private error?: string;
  private fetching?: Promise<void>;

  constructor(
    private cfg: DeploysConfig | undefined,
    private onChange: () => void,
    private fetchJson: FetchJson = defaultFetchJson,
  ) {}

  state(): DeploysState {
    return {
      configured: !!this.cfg,
      items: this.items,
      ...(this.fetchedAt ? { fetchedAt: this.fetchedAt } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Refetch when the cache is old (or always, when forced). Safe to call concurrently. */
  refresh(force = false): Promise<void> {
    if (!this.cfg) return Promise.resolve();
    if (!force && this.fetchedAt && Date.now() - this.fetchedAt < CACHE_MS) return Promise.resolve();
    this.fetching ??= this.fetchAll().finally(() => {
      this.fetching = undefined;
    });
    return this.fetching;
  }

  private async fetchAll(): Promise<void> {
    const cfg = this.cfg!;
    const headers = { authorization: `Bearer ${cfg.apiToken}` };
    const get = async (path: string) => {
      const { status, json } = await this.fetchJson(`${API}${path}`, { headers });
      const body = json as { success?: boolean; result?: unknown; errors?: { message?: string }[] };
      if (status !== 200 || body?.success !== true) {
        throw new Error(body?.errors?.[0]?.message || `Cloudflare said ${status}`);
      }
      return body.result;
    };
    try {
      // Each list is independent: a permission the token lacks shouldn't blank the others.
      const settle = <T>(p: Promise<T>) => p.then((v) => ({ v })).catch((e: Error) => ({ e }));
      const [pages, workers, subdomain] = await Promise.all([
        settle(get(`/accounts/${cfg.accountId}/pages/projects?per_page=50`)),
        settle(get(`/accounts/${cfg.accountId}/workers/scripts?per_page=50`)),
        settle(get(`/accounts/${cfg.accountId}/workers/subdomain`)),
      ]);
      const errors = [...new Set([pages, workers].flatMap((r) => ('e' in r ? [r.e.message] : [])))];
      const zone = 'v' in subdomain && subdomain.v && typeof subdomain.v === 'object' ? (subdomain.v as { subdomain?: string }).subdomain : undefined;
      const items: DeployItem[] = [];
      if ('v' in pages && Array.isArray(pages.v)) {
        for (const p of pages.v as Record<string, unknown>[]) {
          const name = typeof p.name === 'string' ? p.name : '';
          if (!name) continue;
          const latest = p.latest_deployment && typeof p.latest_deployment === 'object' ? (p.latest_deployment as Record<string, unknown>) : undefined;
          const prod = typeof p.subdomain === 'string' ? `https://${p.subdomain}` : undefined;
          const url = prod ?? (typeof latest?.url === 'string' ? latest.url : undefined);
          const at = Date.parse((latest?.created_on as string) ?? (p.created_on as string) ?? '') || undefined;
          items.push({
            id: `pages:${name}`,
            name,
            kind: 'pages',
            ...(url ? { url } : {}),
            ...(at ? { updatedAt: at } : {}),
            ...(typeof p.production_branch === 'string' ? { meta: `branch ${p.production_branch}` } : {}),
          });
        }
      }
      if ('v' in workers && Array.isArray(workers.v)) {
        for (const w of workers.v as Record<string, unknown>[]) {
          const id = typeof w.id === 'string' ? w.id : '';
          if (!id) continue;
          const at = Date.parse((w.modified_on as string) ?? (w.created_on as string) ?? '') || undefined;
          items.push({
            id: `worker:${id}`,
            name: id,
            kind: 'worker',
            ...(zone ? { url: `https://${id}.${zone}.workers.dev` } : {}),
            ...(at ? { updatedAt: at } : {}),
          });
        }
      }
      this.items = items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      this.fetchedAt = Date.now();
      this.error = errors.length ? errors.join(' · ') : undefined;
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.onChange();
  }
}
