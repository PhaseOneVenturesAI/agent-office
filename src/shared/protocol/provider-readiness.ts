import type { SignInKind } from './accounts.js';

export interface ProviderReadiness {
  provider: SignInKind;
  installed: boolean;
  auth: 'configured' | 'missing' | 'checking';
  evidence: string;
  checkedAt: number;
  models: { worker: string; selected?: string; reported?: string }[];
  /** Usage totals are not a subscription's remaining allowance. */
  quota: 'unknown';
}
export type ProviderReadinessClientMsg = { t: 'readiness.get' };
export type ProviderReadinessServerMsg = { t: 'readiness'; providers: ProviderReadiness[] };
