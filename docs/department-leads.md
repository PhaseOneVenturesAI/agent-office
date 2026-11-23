# Department leads

Back to the [README](../README.md).

How a department gets a **lead**: one persistent character identity per department that Jonathan talks
to, which orchestrates the department's real workers, watches progress and reports results and
blockers. This is operational UX on the current map and styling — no new rooms, desks or geometry.

## Round 2 (coordinator review)

The review's points and where each is answered:

1. **Delegation is an authenticated agent tool, not only a browser message.** The lead delegates
   through `office-workers delegate` / the MCP `delegate_task` tool → `POST /office/workers/delegate`
   (the caller's own hook token is its identity). Only the department's live lead may delegate for
   it (parent ownership, enforced server-side). Generic `hire` stays generic — the department path
   is the supported one and carries the dept id and the lead as `parentId`.
2. **Ask-each-time is enforced server-side.** An agent-triggered delegation never accepts a provider:
   with an `ask` policy it creates a **pending engine request** a person approves (picking the
   engine) or rejects; with a `policy` policy the server applies the policy engine. The browser
   picker remains the person's own path. Policy applies to every child the lead launches.
3. **Ownership is one shared, atomically claimed source.** The floor queue is the only task source;
   a delegation is refused while *any* live task holds the same normalized title (case/whitespace
   insensitive — no claim of semantic duplicate detection). `queue.add` is synchronous and
   single-process, so the check-and-claim cannot interleave.
4. **Children report back to the lead, event-driven.** `LeadDispatch` (one per floor) watches child
   worker transitions — `needs_input` (blocker, with the question), `done` (turn ended, with the PR
   when there is one), `exited` — and prompts the lead when it is idle/done; while the lead works,
   one coalesced notice per child is held and delivered when the turn ends. Delivery is at-most-once
   while the lead is observed and never replayed; a lead that is gone drops its notices. UI state
   broadcasts alone are not orchestration — this is a real prompt into the lead's session.
5. **The two-writer cap is floor-wide.** Manual `worker.spawn`, queue seating and `office-workers`
   hire all refuse (or, for the queue, wait) once two implementation writers are live, counting
   every live agent that is not rostered as review/support/lead. Department role launches keep
   their role-aware check; lead launches stay exempt (orchestrators, not writers); meetings and
   resumes are continuations, not new writers.
6. **Engine swap is reserved, verified and reversible.** The source is reserved (`WorkerInfo.swap`)
   before anything spawns: refused when it is busy, has a pending handoff, or is already reserved.
   The replacement spawns idle, the pending handoff is prepared, and only then does the success
   toast fire; any failure rolls the reservation back and sends the unneeded replacement home. On
   acknowledgment the department roster — and the lead identity, when the source was a lead — relink
   to the replacement worker; policy is untouched. Uncommitted source work is *not* transferred: the
   replacement starts from the fresh base and the handoff tells it to preserve or merge from the
   source branch, with evidence explicitly unverified.
7. **Honest progress labels.** A finished task is a *turn ended* state, not a reviewed one: the
   lead's work list and status chips say "turn ended", with "PR #n opened (not yet reviewed)" where
   a pull request exists. The lead's worker is seated under the lead's own name, so the visible
   character, the terminal title and the card all agree.
8. **The window is built around talking to the lead.** One inviting sentence up top; the lead is the
   hero (avatar, status, current task, Talk primary, engine as a compact badge with Change); policy,
   Remove, named-by and revision metadata live under **Manage** in Details; on a phone the lead is
   on screen without scrolling past setup. In the 3D office, walking up to the lead's character
   shows 🎖️ in the hint with **T — Talk to the lead**, opening Talk / View team / View work / Terminal.

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
  lead is resumed (Talk), never duplicated. The seated worker takes the lead's name.
- `DeptPolicy { provider, model?, effort?, mode: 'policy' | 'ask', by, at }` — the team engine policy
  chosen once. `policy`: lead launches and delegations run on it silently. `ask`: a person's picker
  shows each time (prefilled); an agent's delegation becomes a pending request a person approves.
  Nothing ever switches providers on its own; a quota failure surfaces as a blocker instead.

The lead **is** a real worker: seated at a desk in the department's corner through the same spawn,
named for the lead, with a prompt that names the brief, the roles it staffs, and its tools
(`office-workers`, the queue). It orchestrates — it is not an implementation writer and does not
consume the writer cap. Review specialists serve it through the existing roles.

No UI open ever starts an agent. Starting a lead's shift is its own explicit action
(`departments.lead.launch`), signed in and base-fetched the way `departments.launch` is.

## Task ownership

The floor queue stays the single project-wide task source — there is no second backlog. A lead
delegates with `departments.delegate` (browser, person present) or `office-workers delegate`
(authenticated agent): the task is queued with `dept` set, `addedBy` the lead's name, and `parentId`
the lead's worker — the parent assignment the dispatch watches. The queue refuses a delegation whose
normalized title matches any live task, so two departments cannot be assigned the same job; the
claim is atomic because `queue.add` never yields mid-check. Issues keep their existing refusal.
Progress, blockers and results are the queue's own state, event-driven to every client and to the
lead — no polling, no keepalive.

## Talking to a lead

The department card carries the lead hero: status (off shift / working / needs you — with what /
turn ended — with what), the current task, and three actions:

- **Talk** — the existing worker conversation view on the lead's worker. Off shift it offers to start
  the shift explicitly. It never answers tool approvals; those stay in the terminal, and a lead
  stopped on one is in the Needs me inbox like any worker.
- **View team** — the roster with each worker's live status, engine, task and PR.
- **View work** — the department's queue tasks with states and outcomes (turn ended ≠ reviewed).

In the 3D office the lead's character sits at its corner desk under the lead's name: the desk hint
shows 🎖️ and **T — Talk to the lead**, which opens the same three actions (plus Terminal). **E** keeps
opening the terminal exactly as it does for every worker.

## Engine swap

`handoff.swap { workerId, provider, model?, effort?, note? }` is an explicit handoff to a replacement
engine, not an in-place conversion. The source is reserved first; a busy, pending-handoff or
already-reserved source is refused before anything spawns. The office seats a replacement worker
(its own worktree off the fresh base, idle — no prompt) and prepares the existing pending handoff
old → new with the brief composed from the worker's task and branch. The person reviews the exact
prompt, then the existing acknowledge delivers it once, after the idle/workspace re-checks; on
acknowledgment the roster and lead linkage move to the replacement. Uncommitted source work is not
transferred — the replacement is told to preserve or merge from the source branch, and the evidence
line says exactly that it is unverified. Any failure before that rolls back: reservation cleared,
unneeded replacement sent home, and no success toast. The old worker is otherwise untouched — its
transcript, session and branch stay where they are, and it goes home only when sent.

The swap modal is the safe reviewable picker path: engine picker (provider/model/effort, validated
like a hire) plus a note, with the composed handoff shown for review before one-shot delivery.
Deferred: auto-retiring the old worker after a landed swap, and mid-worktree branch transfer.

## The departments window

Entry cards, one per department, with only the selected department's panel open — the lead hero,
brief, roles, work and delegation up front; policy, Remove, named-by, revision metadata, brief
history, brand library, results and context under **Manage / Details**. Every direct hire shows the
provider/model picker prefilled from the saved policy (or the office default when there is none).

## First-version limits

- The lead is visible as its worker character at a corner desk while on shift; off shift it is a card
  and a directory line, not a standing character.
- Delegation dedupe is exact-title (normalized), not semantic; a reworded duplicate is not detected.
- A held child notice is the latest one only; if the lead never finishes its turn, notices coalesce.
- Swaps are prepared one at a time per worker; bulk moves are manual.
- A lead's conversation is the bounded conversation view (Claude/Kimi/Codex providers); other
  providers talk through their terminal.
- With two writers live, queue tasks wait for a desk writer instead of seating a third; the stall is
  visible on the queue board and the departments writers counter, not toasted repeatedly.
