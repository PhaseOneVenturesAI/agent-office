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

## Staff Q&A — a separate, read-only session

Staff (any signed-in account in a manager's Q&A audience) can ask the department questions, but the
question **never enters the manager's provider session**: the manager chat refuses staff outright,
and the Ask box answers on a **separate one-shot ACP session** (Kimi or DeepSeek Harness) whose
every tool permission the office auto-rejects, from an approved context snapshot (current brief,
objective, reference labels). The exchange is recorded under the staff scope. When no ACP CLI is
available the answer is a truthful "unavailable" — staff content is never passed into a manager
session to make do. Staff personal agents on their own subscriptions remain possible and remain
unable to commandeer the team queue.

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
  session is what preserves controller history.
- Effective autonomy is honored only where the provider exposes a real mode; everywhere else it is
  a visible label, and tool approvals always need a person.
- The Linear sync backend is owned by another worker; this branch deliberately carries no queue
  assignee/external-id fields.
- Durable history pages the record; it never replays old turns into the provider's context window.
