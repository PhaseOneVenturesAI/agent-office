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

## Staff Q&A — isolated from the manager

Questions use the approved brief/objective/reference labels, never the manager's native history.
The effective engine matches execution policy (`policy.provider ?? lead.provider`), with the
custodian's selected-provider sign-in. Accounts mode refuses missing custody. Each invocation
uses an empty cwd, temporary home, and environment allowlist; Office tokens, other providers'
credentials, project settings and user skills are not inherited.

- **Kimi 2.7.2:** verified embedded tool-policy implementation; an isolated config disables all
  tools, ACP declares no MCP servers, and additional approval requests are rejected.
- **Codex 0.171.0 on Linux, `gpt-6.2-sol` only:** a pinned static model catalog removes shell,
  patch and model-advertised tools; explicit capability controls remove MCP/apps, hooks,
  delegation, memory, browser and other action tools. Native dummy transport verified an empty
  tool catalog and rejection of forged tool calls. No project or source-home configuration is
  copied. The native CLI receives a fresh home/cwd, strict config, an ephemeral session, and the
  approved question on stdin. Unknown/unspecified models and changed versions are refused.
- **Claude Code 2.1.331:** unavailable. `--safe-mode` preserves subscription auth, but a native
  dummy test demonstrated that managed startup hooks still execute with an empty tool catalog.
  A local managed `disableAllHooks` setting stops them only when that policy wins; remote policy
  can override the local source. No Claude Q&A adapter is enabled.

Codex requires an explicit personal custodian even in shared-password offices. Office reads only
that account's canonical `auth.json`, requires a ChatGPT OAuth login and a consistent account ID,
and copies only its current access token into native `chatgptAuthTokens` mode. It never copies
or writes a refresh token, invokes refresh, or changes the canonical sign-in. If fewer than three
minutes remain, refresh through the custodian's existing native session/sign-in and retry. A
concurrent native refresh may make an in-flight Q&A fail; retry reads the new snapshot. This
avoids rotating a disposable copy and losing the owner's renewable login. API keys, PAT/agent
identity tokens, host-login fallback, inherited provider URLs and custom runtime configuration
are refused. `CODEX_ACCESS_TOKEN` is not used: this version treats it as PAT/agent identity.

The process has a two-minute deadline and one-megabyte output ceiling; unexpected tool events,
invalid output, failed auth and cleanup failures return unavailable. Answers enter only the
separate staff Q&A history. This native no-tools boundary is not advertised as an OS sandbox.

Unsupported-provider messages direct staff to a manager controller. A separate Q&A provider
choice needs explicit owner authorization and is not implemented. Version checks are refreshed
at launch, including prerelease suffixes. Temporary Kimi homes are removed on setup failures;
closure errors return a failure instead of leaving the caller waiting indefinitely.

The Codex adapter also has a loopback-only native dummy-provider regression fixture (see
`tests/fixtures/codex-qa-native/README.md`). It does not use real credentials or verify live
subscription acceptance; the fixture performs no paid provider turn or real authentication
change. Capability references: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[managed hook scope](https://code.claude.com/docs/en/settings-reference#disableallhooks), and
[Codex tool composition](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/tools/spec_plan.rs).

## Talking to the characters

The CEO and managers are permanent characters: send-home and role deletion are refused server-side
(browser, hook, and landed-merge paths), and the desk hint shows them protected. Pause and continue
preserve their identities and history. Click a character, or walk up and press **T** or **E**. Owners
and controllers with current subscription access open Conversation; **Terminal** is an explicit
fallback. An off-shift role offers an explicit **Start shift** on its saved engine (the existing
ask-each-time policy still shows its picker). Staff in a manager's Q&A audience open the same
isolated Ask used in Roles, including its separate custodian consent. Looking at or approaching a
character never starts a provider, shares credentials, or grants consent. Conversation includes durable, paged history (the provider
session stays the bounded execution context), clickable artifact links, supported native approval
choices, and honest status labels (turn ended ≠ reviewed; stopped ≠ completed). Unsupported questions
open in Terminal. Dictation and read-aloud reuse the existing browser speech and say so.

Off-shift characters use the existing worker appearance and desks on the original map.
Gold nameplates identify the CEO (with a small crown) and each department manager, whether
active or off shift. The role and personal name appear once; a default name such as `CEO` or
`MarketingManager` does not repeat the title. Regular worker tags keep their existing colors.
Nameplate sprites and textures are reused until the displayed name or role changes. Each role's
display home is retained in `.agent-office/role-homes.json`: first from its retained worker's seat,
otherwise from an existing built department/office desk. It is a display reference, not a runtime
worker or reserved seat. If the desk is occupied, the character stands beside it; shared home
references use distinct nearby spots. A real role worker replaces the off-shift figure. Floor and
map changes remove the old figure and hit target. An unreadable home file is preserved and reported,
rather than overwritten or presented as a successful home assignment.

## Roles view (☰ → 🛡️ Roles)

Lists the CEO and each manager with owner, controllers, Q&A audience, billing custodian, engine, and
an effective-autonomy label. Quick edits are re-authorized server-side on every change; delegation
of control passes only through the current owner/controllers. A project owner can create its first
manager; office admins may bootstrap only an unowned project. Saved autonomy applies at the next
verified provider launch, separately from the current session's reported settings. Unsupported
versions fail clearly; the office never approves terminal text blindly. Subscription quota stays
unknown unless the provider reports it.

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

- Display homes reserve no worker capacity and never expand the map. Only a launched role has a
  provider runtime; the off-shift character itself does not consume a session.
- Staff Q&A draws on the approved snapshot, not the manager's full history; the manager's own
  session is what preserves controller history. Kimi's tool-free home is verified against its
  documented config and the office's permission denials; a paid one-shot behavioral re-verification
  on the installed CLI is still owed (tracked, not claimed).
- Conversation supports native approval cards for Claude, Codex and Kimi; unsupported questions
  and setup screens still require Terminal. See [provider capabilities](conversation-approvals.md).
- Autonomy uses verified provider launch modes, with saved and current-session policy shown
  separately. It never grants role authority or access to another person's subscription.
- Linear task sync is integrated but requires native OAuth setup and explicit floor/person
  mappings before use. A connected chat plugin does not configure Office. See [setup](linear.md).
- Durable history pages the record; it never replays old turns into the provider's context window.

### Recovery and account boundaries

- Role Conversation open, send, history, streaming and interruption require both current role authority and runtime credential access, matching approvals. A controller cannot silently use another person's subscription.
- Staff Q&A requires an explicit custodian in accounts mode, including direct floor-service calls. The floor forwards its account sign-ins; only an explicitly configured shared-password office may use the office login.
- Worker discovery applies the same private-role redaction as the game. An ordinary worker's token does not expose the CEO's prompt or activity.
- Swap history is copied and deduplicated before the role seat is saved; the source record is retained for recovery. A failed history or identity save leaves the swap reservation available to retry. A retry of a delivered handoff saves the seat without sending a second prompt. Ordinary worker swaps need no role record.
- Manager completion reports fire once per observed transition, with remembered status across restarts. Removing a child also removes its held notice from durable storage. A project owner may create the first manager; only an unowned project falls back to office-admin setup.

Private role provenance survives engine swaps. Before delivering a role handoff, Office durably marks both workers with the originating CEO/department identity. The source remains removable and keeps its work/history, but its card, discovery entry, terminal and Conversation retain the role's current access restrictions as well as credential ownership checks after restart. A damaged provenance file fails closed for that worker. Ordinary personal workers are unchanged; these are Office API/UI access checks, not operating-system isolation between local processes.
Engine-swap confirmation stays open until the server confirms completion. If the handoff was delivered but saving the role failed, reopen the swap and choose **Finish role swap**: this retries the role update without delivering the handoff again. Disconnects and server errors leave the swap unconfirmed and retryable.


### Department subscription consent

In **Roles**, designate the manager’s custodian, provider and human controllers. The custodian signs into their own Office account, connects a personal Claude/Kimi/Codex sign-in, and reviews the named project, department, provider and controllers before choosing **Allow these controllers to use my subscription**. This explicitly permits the manager and its same-provider department child workers to use that subscription. Office-host credentials cannot be re-granted this way. Merely editing the custodian field grants nothing; administrators and controllers cannot consent for someone else.

The optional staff Q&A checkbox separately authorizes a separate read-only session for the displayed audience. An empty audience explicitly means all signed-in colleagues. It never opens the manager’s conversation to staff. Provider capability restrictions still apply independently of consent.

Consent is stored without credential secrets in `role-subscription-grants.json`. Controller, audience, custodian and provider-setting edits invalidate it, including removing and re-adding a controller. Authority, current provider sign-in and exact runtime custody are checked again for shared conversations, terminal access, approvals, manager launches, CEO assignments, automatic notices, agent delegation and actual queued execution. Other providers require their own newly reviewed consent. Revocation blocks future shared actions and queued starts; already-running turns are not forcibly terminated or moved onto someone else’s credentials. The payer can still use their own personal workers.

Existing seated managers are never silently rebound to a different payer. A mismatched runtime must be replaced explicitly. Changing provider invalidates the old consent; the existing credential owner may need to finish the explicit swap before other controllers can use the newly consented runtime. Pending swaps retain their normal one-shot handoff and recovery behavior. Human-initiated personal child workers continue to use the initiating human’s subscription.

This is application-level credential routing and consent, not an OS tenant sandbox: approving a coding agent’s tool access still authorizes code execution within the existing host environment. No live grants are created by installing this feature.

## Runtime autonomy

The CEO and each manager are permanent identities. Clear/remove APIs refuse deletion, including
removing a department with a manager. Pause the current turn and continue in Conversation;
neither action deletes the role, native session, or memory.

Saving autonomy is explicit and acknowledged after persistence. Old informational labels never
activate permissions. The saved role preference and worker's pending preference are separate from
its current launch policy: saving during a running session does not restart it or silently approve
anything. The next process start or explicit engine replacement applies the preference. A failed
worker-setting save is reported and must be retried before restart.

Verified installed modes:

| Provider | Automatic | Manual (`off` / `supervised`) |
| --- | --- | --- |
| Claude Code 2.1.330 / 2.1.331 | `--permission-mode auto` | `--permission-mode manual` |
| Codex 0.171.0-alpha.13 / 0.171.0 | `--approve-for-me --sandbox workspace-write` | `--ask-for-approval on-request --sandbox read-only` |
| Kimi 2.7.2 ACP | `session/set_mode` with `auto` | `session/set_mode` with `default` |

Kimi's ACP subcommand ignores root `--yolo` and `--auto` flags. ACP advertises `auto` for safe
operations and `yolo` for approving everything; Office chooses only `auto`. It checks the advertised
mode and waits for the RPC acknowledgement before sending a prompt. Rejection or missing support
stops and cleans up the child without sending work. Claude/Codex labels describe the requested
launch flags, not an invented runtime acknowledgement. Versions are checked at every new process
start; unsupported versions or conflicting permission arguments fail clearly rather than falling
back. No bypass-permissions or never-ask mode is selected.

Automatic permissions do not grant account access, another person's subscription, delegation,
publication, or deployment authority. Existing role and subscription checks still gate Office
actions. Validation uses fake providers, CLI help/source inspection, and focused tests; it does not
require spending tokens or changing live accounts.

### Conversation and live Roles editing

For agents, desk **E**, the workers sidebar and waiting notifications open Conversation first, including Claude, Codex and Kimi. Shells and explicit terminal/search actions keep their terminal behavior. Conversation retains its Terminal fallback and native approval choices.

Roles settings are saved explicitly and confirmed by a correlated server response. Rejected saves retain the entered values and show an inline error; typing a newer draft while a save is pending does not make that draft “saved.” Worker and department updates preserve the mounted editors, focus, pending staff question and unsubmitted consent choice. A changed consent scope is fetched again for review rather than silently authorizing its new people/provider. Ask refusals and provider failures end the pending indicator with an inline reason and retain the question for retry.

Requested autonomy and current-session launch settings are displayed separately. Saving a preference does not claim to change an existing process. Legacy unconfirmed labels are identified as such and need an explicit save. Runtime launch details come from the provider adapter; missing details remain “not reported,” not an inferred effective permission mode.

The 23 November 2026 deployment check inspected Claude 2.1.331 and Codex 0.171.0 help on the actual VPS. Both retain the launch modes above. These exact versions are accepted alongside the earlier inspected versions; unknown versions and conflicting permission flags still fail closed. This verifies the requested launch configuration, not runtime permission acknowledgment or isolated staff Q&A support.

CEO assignment commands accept an objective on stdin or with `--objective`; `--execute` explicitly starts the manager. The generated CEO instructions use those supported arguments. Role display names, including spaces and emoji, stay intact while worktree and branch names use a safe slug.
