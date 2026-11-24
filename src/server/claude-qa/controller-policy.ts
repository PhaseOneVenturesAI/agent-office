import type { PolicyEvidence } from './policy.js';

/** Root-side canonical account resolver output. No refresh token or API-key alternative. */
export interface SelectedClaudeAccount {
  accountId: string;
  accessToken: string;
  oauthAccount: {
    accountUuid: string;
    organizationUuid: string;
    workspaceUuid?: string;
    subscriptionType: string;
    scopes: string[];
    expiresAt: number;
  };
}
export type QualifySelectedPolicy = (context: SelectedClaudeAccount & { signal: AbortSignal }) => Promise<PolicyEvidence | undefined>;

/** Intentionally unregistered: real signed-policy propagation needs its independent review. */
export const unavailablePolicy: QualifySelectedPolicy = async () => undefined;
