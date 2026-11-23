import type { ProviderReadiness, SignInKind, SignInState, WorkerInfo } from '../shared/protocol.js';

/** Describe evidence, never turn a credential file or a selected model into a successful API call. */
export function providerReadiness(provider: SignInKind, installed: boolean, state: SignInState, workers: WorkerInfo[], checkedAt: number): ProviderReadiness {
  const auth = state.status === 'busy' ? 'checking' : state.status === 'ok' ? 'configured' : 'missing';
  const evidence = auth === 'checking' ? 'Sign-in check or login is in progress.' : auth === 'missing' ? 'No usable sign-in reported by the current check.'
    : state.how === 'token' ? 'A pasted credential is configured; service access is not verified.'
    : provider === 'kimi' || provider === 'codex' ? 'Local credential file found; expiry and service access are not verified.'
    : 'The provider CLI reports a sign-in; this is not a remaining-usage check.';
  return { provider, installed, auth, evidence, checkedAt, quota: 'unknown',
    models: workers.filter((w) => w.kind === 'agent' && w.provider === provider).map((w) => ({ worker: w.name, selected: w.model, reported: w.usage?.model })) };
}
