# Conversation approvals

Open the existing agent character's **Conversation**. A supported pending permission
shows its request details and actual choices. There is no terminal scraping, free-text
“yes” inference, auto-approval, or claim that a submitted choice proves tool success.
The original Office map and conversation styling are preserved.

## Provider mechanisms

- **Kimi:** the native ACP `session/request_permission` JSON-RPC request and its offered
  `optionId` values. The existing FIFO is retained: only the head is answerable. The
  UI occurrence ID maps to that original RPC ID, so reusing an RPC ID on a later turn
  cannot revive an old button. Offered allow-once, allow-always, reject-once and
  reject-always options are shown; unknown choices stay in Terminal.
- **Claude:** native synchronous `PermissionRequest` command hook output with
  `hookSpecificOutput.hookEventName="PermissionRequest"` and a decision behavior of
  `allow` or `deny`. The helper's actual pending HTTP response carries the answer back
  to that invocation. There is **no provider-native request ID in this hook schema**.
- **Codex:** native synchronous `PermissionRequest` hook with the same allow/deny
  decision shape. Its schema likewise has no native request/tool-use ID. Each actual
  invocation gets a unique Office correlation nonce, bound to the live response,
  worker run token, session and provider. It is not presented as a native tool ID.

Claude/Codex offer **Allow once** and **Deny**, not persistent permission updates.
Codex currently rejects `updatedInput`, `updatedPermissions` and `interrupt` for this
hook. Claude's permission suggestions are not an authoritative list of native dialog
options, so they are not copied into buttons. Interactive questions, plan acceptance,
large inputs, missing correlation fields and unsupported native network/setup prompts
remain in Terminal. A Kimi request without a matching ACP session is not exposed as
an actionable conversation card.

**Use Terminal** releases the exact Claude/Codex hook without a decision (`{}`), then
opens the native terminal. For Kimi it opens another view of the same FIFO request.
Native hooks expire after five minutes without a decision and return to normal
provider approval handling; expiry never means approval. Closing a conversation does
not answer a request. Reconnecting fetches fresh state; stale buttons fail closed.

## Authority and privacy

Approval state is private, fetched only through its authenticated WebSocket handlers;
it is not added to public worker/floor snapshots. Each read, subscription tick, answer
and Terminal release rechecks current account, floor, role authority and credential
ownership. Losing control clears an existing view even if the request did not change.

The CEO requires its owner; managers require an authorized controller. Both also
require permission to use the actual runtime credentials through `canUseWorker`.
A manager's editable `custodian` email is **not** a subscription-sharing grant.
Consequently a controller cannot approve another account's runtime merely because
both control the department. Cross-account shared approval needs a separately verified
custodian grant policy; this implementation denies that case. Generic admin status,
Q&A audience membership and worker IDs are never bypasses. Ordinary workers retain
personal ownership rules; explicit host-owner credential grants retain their existing
shared-password/account semantics.

The handler factory accepts an explicit `ApprovalAuthority` policy; the registered
adapter uses maintained `roleAccess` plus `canUseWorker`. Any later shared-custodian
extension must be enforced for reads, streaming, answering and terminal access alike.
This does not create OS isolation between processes sharing the Office service user.

## Lifecycle and rollout

Claude/Codex keep their PTY runtimes. Their generated hook helpers are changed only in
Office-managed data, with mode 0600, and authenticate to Office's loopback hook server.
No personal provider settings or credentials are rewritten. Parent hook notifications
retain their short timeout; only the decision hook waits for a person. Hook callbacks
are root-session only. Invalid payloads and lost connections return no decision.

Hook disconnect, token/session replacement, interruption and session termination remove
pending choices. Request IDs and options are checked atomically against the FIFO head.
Kimi Terminal answers also invalidate the conversation's old choice. Restarting Office
never recreates historical approval buttons; the native provider must ask again.

Already-running PTY sessions may have cached their earlier hook configuration. Do not
interrupt active work merely to install this UI: adopt the bridge on the next explicit
resume/relaunch and verify it there. Other hooks or provider deny rules can still reject
an allowed request. The acknowledgement says only that the choice was submitted.

Local capability inspection: Claude Code `2.1.330`, Codex CLI `0.171.0-alpha.13`.
These versions were inspected without starting paid turns. Generated hook helpers
were exercised against an authenticated fake loopback provider bridge; Kimi was tested
with a fake ACP subprocess. This is not a claim that the deployed host's provider
version or an actual paid model run has been verified.

Primary contracts:
- [Claude PermissionRequest reference](https://code.claude.com/docs/en/hooks#permissionrequest)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex native permission output schema](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/permission-request.command.output.schema.json)
- [ACP tool permissions](https://agentclientprotocol.com/protocol/tool-calls)

Checks: `tests/approvals.test.ts`, `tests/kimi-permissions.test.ts` and
`node tests/approval-ui.mjs` (actual Conversation component, fake structured transport,
desktop/phone screenshots, no provider usage). Standard repository typecheck, full
suite and production build apply before integration/release.
