# Department leads and the CEO

Back to the [README](../README.md).

One **CEO per project** — a persistent, non-fireable character privately owned by the project owner —
directs the department **managers**, who delegate the actual **workers**. Everything runs on the
existing map and game: the characters sit at real desks, the floor queue stays the one task source,
and no UI ever starts an agent by itself.

## The chain

- **CEO** (`src/server/ceo.ts`, `.agent-office/ceo.json`): one identity per floor, never cross-floor.
  Owned by one account email (the identity's `owner`, else the operator setting
  `AGENT_OFFICE_CEO_OWNER`). Only that owner talks to the CEO, edits it, launches its shift, or
  passes ownership on — **office admins are not a bypass**; they may only bootstrap while no owner
  exists anywhere. The CEO assigns managers scoped objectives (`office-workers assign`, or the
  panel); `execute` starts an off-shift manager only on explicit ask, on the asking worker's
  sign-ins. Engine swaps hand a role over from the maintained objective and last reviewed reply,
  never a generated task label; the routing identity relinks on acknowledgment.
- **Managers** (`Departments`, `lead` on each department): human controllers (emails) edit settings,
  context and decisions and give major objectives; the CEO owner may too. A manager delegates
  workers **only** through the floor queue, on the team engine policy; an `ask` policy holds the job
  for a person's engine decision instead of letting an agent choose. Delegation binds the approved
  context server-side: current brief revision, current brand-reference labels, and the role skills
  that actually exist at this office's harness root (available ≠ confirmed-read; missing skills are
  named as unavailable). The task records the brief revision it started from.
- **Workers**: seated by the queue with the bound context, capped at two implementation writers
  project-wide (active writers only; the CEO and managers direct, they don't write). Children
  report blockers and results to their manager; a manager with an active CEO objective rolls the
  same lines — and its own finished turns' last reviewed reply — up to the CEO. Delivery is a real
  prompt when the parent is idle, one coalesced notice held per child while it works, never injected
  into a busy terminal, never replayed.

## Staff Q&A — a separate, provider-enforced tool-free session

Staff (any signed-in account in a manager's Q&A audience) can ask the department questions, but the
question **never enters the manager's provider session**: the manager chat refuses staff outright,
and the Ask box answers on a **separate one-shot ACP session** that is restricted by the provider,
not by prompt text:

- It runs on the **department's configured engine only** (Kimi ACP today), and only on CLI versions
  whose tool-free behavior was **verified on the actual installed binary** (2.7.2) — never an
  arbitrary binary from PATH, never an unverified version (the wildcard disable-all is an
  implementation detail, not a stable API, and the deployed provider may differ).
- The session boots from a **dedicated tool-free home**: the global tool switch removes every tool
  (verified against the installed Kimi's documented config), `session/new` declares no MCP servers,
  the office **additionally** auto-rejects any permission request that still fires, and the
  read-only framing lives in the home's SYSTEM.md.
- The environment is **account-scoped to the department's billing custodian** (its custodian email's
  account sign-in) — never the host's credentials; in accounts mode a missing or unknown custodian
  is refused outright, no fallback. The session works in an **empty scratch directory**, so the CLI
  cannot auto-load the project's AGENTS.md — only the approved snapshot reaches the prompt.
- The prompt carries only the approved context snapshot (current brief, objective, reference
  labels), and the exchange is recorded under the staff scope.

Engines whose tool-free mode is not verified fail closed with a truthful unavailable status —
tracked honestly rather than approximated. Staff personal agents on their own subscriptions remain
possible and remain unable to commandeer the team queue or the generic hire path: only department
managers (and board agents through office-queue) may spawn workers from agent land; people still
hire their own standalone agents at a desk.

## Talking to the characters

The CEO and managers are permanent characters: send-home is refused server-side (browser, hook, and
landed-merge paths), the desk hint shows them protected, and retiring the role (Roles view) is what
frees the seat — pausing a process is not deleting the role. Walk up and **T** talks to them; **E**
stays the terminal. Talk opens the conversation window: durable, paged history (the provider session
stays the bounded execution context; the record is a per-worker append-only file), clickable
artifact links, a real pending-decision card that routes to the terminal (approvals are never
guessed), and honest status labels (turn ended ≠ reviewed; stopped ≠ completed). Dictation and
read-aloud reuse the existing browser speech and say so.

## Roles view (☰ → 🛡️ Roles)

Lists the CEO and each manager with owner, controllers, Q&A audience, billing custodian, engine, and
an effective-autonomy label. Quick edits are re-authorized server-side on every change; delegation
of control passes only through the current owner/controllers (admins bootstrap an undesignated
role). The autonomy label is applied only where the provider supports it — the office never
approves terminal text blindly, and unsupported providers show the label as information only with
quota unknown.

## Task ownership and history

The floor queue is the single project-wide task source: a delegation is refused while any live task
holds the same normalized title (claim re-verified synchronously). A **retry supersedes**: a new
task id, the original record and outcome kept as the audit, the context re-bound, and a brief
revision drift marked `staleContext` with the change called out in the worker's prompt.

## The departments window

Conversation-first: the CEO hero, then one card per department with its manager hero (Talk primary,
engine badge + Change), work and delegation; brief, brand library, results and the advanced
configuration live under Manage/Details; manual role hiring sits under "Add a teammate yourself".
There is deliberately **no standing directory fixture** — the map is untouched, and the characters
are the front door.

## Limits (honest)

- Off-shift characters are card + desk presence, not a standing 3D character.
- Staff Q&A draws on the approved snapshot, not the manager's full history; the manager's own
  session is what preserves controller history. Kimi's tool-free home is verified against its
  documented config and the office's permission denials; a paid one-shot behavioral re-verification
  on the installed CLI is still owed (tracked, not claimed).
- In-conversation approval answering (the prototype's queued request cards) is not implemented;
  approvals are answered in the terminal, where the actual request lives.
- Effective autonomy is honored only where the provider exposes a real mode; everywhere else it is
  a visible label, and tool approvals always need a person.
- The Linear sync backend is owned by another worker; this branch deliberately carries no queue
  assignee/external-id fields.
- Durable history pages the record; it never replays old turns into the provider's context window.

### Recovery and account boundaries

- Role Conversation open, send, history, streaming and interruption require both current role authority and runtime credential access, matching approvals. A controller cannot silently use another person's subscription.
- Staff Q&A requires an explicit custodian in accounts mode, including direct floor-service calls. The floor forwards its account sign-ins; only an explicitly configured shared-password office may use the office login.
- Worker discovery applies the same private-role redaction as the game. An ordinary worker's token does not expose the CEO's prompt or activity.
- Swap history is copied and deduplicated before the role seat is saved; the source record is retained for recovery. A failed history or identity save leaves the swap reservation available to retry. A retry of a delivered handoff saves the seat without sending a second prompt. Ordinary worker swaps need no role record.
- Manager completion reports fire once per observed transition, with remembered status across restarts. Removing a child also removes its held notice from durable storage. A project owner may create the first manager; only an unowned project falls back to office-admin setup.

Engine-swap confirmation stays open until the server confirms completion. If the handoff was delivered but saving the role failed, reopen the swap and choose **Finish role swap**: this retries the role update without delivering the handoff again. Disconnects and server errors leave the swap unconfirmed and retryable.
