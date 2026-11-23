# Department leads

Back to the [README](../README.md).

How a department gets a **lead**: one persistent character identity per department that Jonathan talks
to, which orchestrates the department's real workers, watches progress and reports results and
blockers. This is operational UX on the current map and styling — no new rooms, desks or geometry.

## What exists that leads are built from

- **Departments** (`src/server/departments.ts`, protocol `src/shared/protocol/departments.ts`, UI
  `src/client/ui/departments.ts`): briefs with revision history, roles with skill references, a brand
  library, and a roster. `departments.launch` hires a role through the same spawn every hire uses,
  with the two-implementation-writer cap enforced at spawn time.
- **Workers** (`src/server/workers/manager.ts`): `spawn(desk, by, prompt, worktree, kind, provider,
  model, effort, …)` is the one door every hire goes through. A worker's status, task, PR and usage
  already surface everywhere.
- **office-workers** (`bin/office-workers.js`, `src/server/hooks/office-workers.ts`): the loopback
  API and MCP server agents use to list, hire, message and send home workers — the lead's real
  orchestration tools.
- **Queue** (`src/server/queue.ts`): the project's one task source. Tasks carry provider/model/effort
  and issue, refuse duplicate issues, and seat themselves as workers.
- **Conversation** (`src/server/workers/conversations.ts`, UI `src/client/ui/worker-conversation.ts`):
  a bounded text/voice view of a worker's session (Claude, Kimi, Codex). Talk.
- **Handoffs** (`src/server/workers/handoffs.ts`, UI `src/client/ui/worker-handoff.ts`): an explicit,
  human-reviewed transfer of task responsibility between two existing agents in distinct worktrees,
  delivered exactly once after idle re-checks. The only honest engine change.
- **Needs me** (`src/client/features/needsyou/`): any worker stopped on a question already lights a
  beacon and lands in the inbox; a lead's worker is no different.

## The lead model

A department gains `lead?: DeptLead` and `policy?: DeptPolicy` (protocol):

- `DeptLead { name, workerId?, provider?, model?, effort?, by, at }` — the persistent identity. The
  name and engine survive restarts; `workerId` is set only while the lead's worker is live, and is
  cleared when that worker goes home. Launching while `workerId` is live is refused — the existing
  lead is resumed (Talk), never duplicated.
- `DeptPolicy { provider, model?, effort?, mode: 'policy' | 'ask', by, at }` — the team engine policy
  chosen once. `policy`: lead launches and delegations run on it silently. `ask`: the client shows
  the picker each time, prefilled from the policy. Nothing ever switches providers on its own; a
  quota failure surfaces as a blocker instead.

The lead **is** a real worker: seated at a desk in the department's corner through the same spawn,
with a prompt that names the brief, the roles it staffs, and its tools (`office-workers`, the queue).
It orchestrates — it is not an implementation writer and does not consume the writer cap. Review
specialists serve it through the existing roles.

No UI open ever starts an agent. Starting a lead's shift is its own explicit action
(`departments.lead.launch`), signed in and base-fetched the way `departments.launch` is.

## Task ownership

The floor queue stays the single project-wide task source — there is no second backlog. A lead
delegates with `departments.delegate { id, title, task }`: the task is queued with `dept` set to the
department id and `addedBy` the lead's name, on the policy engine unless `ask` sent an explicit
choice. The queue refuses a delegation whose department already has a live (non-done) task with the
same title, so two leads cannot double-assign the same job; issues keep their existing duplicate
refusal. Progress, blockers and results are the queue's own state, event-driven to every client —
no polling, no keepalive.

## Talking to a lead

The department card carries the lead row: status (off shift / working / needs you — with what / done
— with what), and three actions:

- **Talk** — the existing worker conversation view on the lead's worker. Off shift it offers to start
  the shift explicitly. It never answers tool approvals; those stay in the terminal, and a lead
  stopped on one is in the Needs me inbox like any worker.
- **View team** — the roster with each worker's live status, engine, task and PR.
- **View work** — the department's queue tasks with states and outcomes, plus staged reviews.

## Engine swap

`handoff.swap { workerId, provider, model?, effort?, note? }` is an explicit handoff to a replacement
engine, not an in-place conversion. The server validates the engine, refuses while the worker has a
pending handoff, seats a replacement worker (its own worktree off the fresh base, idle — no prompt),
and prepares the existing pending handoff old → new with the brief composed from the worker's task
and branch. The person reviews the exact prompt, then the existing acknowledge delivers it once,
after the idle/workspace re-checks. The old worker is untouched — its transcript, session and branch
stay where they are, and it goes home only when sent. Nothing silently switches providers.

The swap modal is the safe reviewable picker path: engine picker (provider/model/effort, validated
like a hire) plus brief/evidence/next, all prefilled and editable. Deferred: auto-retiring the old
worker after a landed swap, and mid-worktree branch transfer (the replacement starts from the fresh
base and is told the source branch to preserve/merge from).

## The departments window

Entry cards, one per department, with only the selected department's panel open — brief, lead, roles,
work. Advanced configuration (brief history, brand library editing, context, results) sits behind
**Details**. Every direct hire shows the provider/model picker prefilled from the saved policy (or the
office default when there is none).

## First-version limits

- The lead is visible as its worker character at a corner desk while on shift; off shift it is a card
  and a directory line, not a standing character.
- Swaps are prepared one at a time per worker; bulk moves are manual.
- A lead's conversation is the bounded conversation view (Claude/Kimi/Codex providers); other
  providers talk through their terminal.
