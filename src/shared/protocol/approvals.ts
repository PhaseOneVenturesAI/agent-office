/** A real pending provider request, not text inferred from a terminal screen. */
export interface ApprovalRequest {
  /** One occurrence; prevents stale clicks when a provider reuses an RPC id. */
  id: string;
  /** ACP JSON-RPC id when supplied. PermissionRequest hooks do not expose a native id. */
  nativeRequestId?: string | number;
  source: 'acp' | 'permission-hook';
  provider: 'kimi' | 'claude' | 'codex';
  sessionId: string;
  title: string;
  detail: string;
  options: { id: string; label: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[];
  expiresAt?: number;
}
export interface ApprovalState { request?: ApprovalRequest; queued: number; fallback?: string }
export type ApprovalClientMsg =
  | { t: 'approval.open'; workerId: string }
  | { t: 'approval.close'; workerId: string }
  | { t: 'approval.answer'; workerId: string; requestId: string; optionId: string }
  | { t: 'approval.terminal'; workerId: string; requestId: string };
export type ApprovalServerMsg =
  | { t: 'approval.state'; workerId: string; state: ApprovalState }
  /** Delivery acknowledgement, not proof that a tool executed successfully. */
  | { t: 'approval.result'; workerId: string; requestId: string; error?: string };
