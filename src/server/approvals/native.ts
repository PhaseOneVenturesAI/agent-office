import type { ApprovalRequest } from '../../shared/protocol/approvals.js';
export const APPROVAL_WAIT_MS = 5 * 60_000;
export const nativeDecision = (option: string): Record<string, unknown> => option === 'allow' || option === 'deny'
  ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: option } } }
  : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max && value.trim() ? value.trim() : undefined;
/** No guesswork for interactive questionnaires or permission-input rewrites. */
export function nativeRequest(provider: 'claude' | 'codex', payload: unknown, id: string): ApprovalRequest | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const p = payload as Record<string, unknown>;
  const sessionId = text(p.session_id, 200), tool = text(p.tool_name, 200);
  if (!sessionId || !tool || p.agent_id || p.agent_type || !Object.hasOwn(p, 'tool_input')) return;
  if (/(?:^|[._])(?:AskUserQuestion|ExitPlanMode|request_user_input)$/.test(tool)) return;
  if (provider === 'codex' && !text(p.turn_id, 200)) return;
  const detail = JSON.stringify(p.tool_input, null, 2);
  // Never make an incomplete command look reviewable. Large requests stay in the native terminal.
  if (!detail || detail.length > 20000) return;
  return { id, source: 'permission-hook', provider, sessionId, title: `${tool} requests permission`, detail,
    options: [{ id: 'allow', label: 'Allow once', kind: 'allow_once' }, { id: 'deny', label: 'Deny', kind: 'reject_once' }], expiresAt: Date.now() + APPROVAL_WAIT_MS };
}
