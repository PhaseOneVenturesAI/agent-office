# Private HQ

Back to the [README](../README.md).

Set these variables on the office server, then restart it:

```sh
AGENT_OFFICE_HQ_OWNER=Jonathan
AGENT_OFFICE_HQ_MANAGERS=ivan@example.com,Eddie
```

Each entry is an account name or, if it contains `@`, the email Cloudflare Access signs that account in as; both match case-insensitively. An email keeps matching if the account is renamed, and an account that only shares the name doesn't get in. The owner can be either too; an email owner is shown by the office name of the account that email signs in as (or, before that account exists, by the part before the `@`). Only the owner and the named managers see HQ in the elevator or can enter it. Admin status alone gives no access. With no owner configured, no HQ opens and ordinary floors keep their behavior. Turning the owner setting off also hides an existing HQ. The server keeps its identity in `hq.json` (mode `0600`) and its local folder under the office data directory; it has no repository and cannot be kicked off. Only its owner can remove it. Leaving the owner configured recreates it on the next server restart.

## Link your Mac

On the Mac that holds your projects, run:

```sh
agent-office link https://office.example
```

The command prints an approval link. Open it in a browser signed in to the office as the HQ owner, then choose **Approve** or **Deny** on “Link <computer name> to your office?”. You can also answer pending requests from HQ's **Link your Mac** panel. Only the owner can see or answer them; managers and admins have no bypass. One pairing can wait per owner, and it expires after ten minutes. The approval URL contains a request ID, never the pairing secret or link token. The waiting Mac receives the approved token once.

Leave the command running to publish the snapshot. The token is bound to the owner and computer and has no automatic expiry. It is stored under `~/.agent-office/link/`, with directory mode `0700` and file mode `0600`. No browser device key or `--owner-key` is used for the Mac link. The owner can **Revoke** a link from the HQ panel; this disconnects it and rejects its token. The panel lists each computer with **Connected** or **Offline since <time>**. Existing `join --cubbies` connections continue to work; `join --hq` is replaced by `link`.

The harness-managed LaunchAgent uses the same command with `--run`:

```sh
agent-office link https://office.example --run
```

This mode uses the saved token and never starts pairing. Without a token it prints the one-time setup command and exits with code `78`, which the harness must treat as needing setup rather than repeatedly relaunching. The Office CLI does not install the LaunchAgent. Network reconnects wait 1, 2, 4, 8, 16, then at most 30 seconds. Stop a foreground link with Ctrl-C.

For an office behind Cloudflare Access, the link automatically reads the existing `cloudflared access token --app` cache. It never launches a login or follows a credential-bearing redirect. If Access refuses the connection, the running link prints:

```sh
Cloudflare sign-in needed: run `cloudflared access login https://office.example`
```

The run loop retries every five minutes without exiting, reading the cache again on each attempt. Complete that sign-in locally; the next retry can reconnect. A first-run pairing refused by Access prints the same instruction; sign in and run `link` again.

### Snapshot sources and privacy

The link reads the project registry selected by `registryFile()`: `~/Documents/GitHub/AgentHarness/projects.json`, with the existing older `~/Documents/AgentHarness/projects.json` fallback. Project keys supply names. Allowed entry fields are `path`, `url`, `localState`, `hostId`, `leadSessionId`, `leadThreadId`, `leadAppSession`, `departmentLeads` (`department`, `title`, `sessionId`, `appSession`) and `sidebarGroup`; `office` is checked only to filter hidden entries. It never consults `lead`, `note`, `historicalLead` or `creativeLineage`. Entries marked `office: "hidden"`, `localState: "archived"` or `"remote-only"`, and missing paths, are excluded together with their workers and needs. Git verifies existing worktree roots; linking creates no project floors and clones no repositories.

Every 15 seconds, the snapshot includes at most 12 projects and 64 scoped live workers, within a 60 KiB frame. Each project contributes AgentHarness presence records with cleaned lead matching IDs, needs from `~/Library/Application Support/AgentHarness/needs.json`, its published `.agent-office/pitch.json`, and cleaned `.agent-office/draft.json` boards. Oversized frames shorten text and omit optional pitch/board detail or needs lines while preserving project and worker identities. Draft boards are collected for the server; this link does not add draft editing.

The read-only Claude session registry, `~/.claude/sessions/*.json`, is limited to 256 regular files of at most 16 KiB each. Main leads match `leadSessionId` or `leadAppSession`; department leads match `sessionId` or `appSession`, against a record's `sessionId` or `bridgeSessionId`. A valid record's `status` (`busy` or `idle`) and `updatedAt` supply the lead status while its process is alive. Missing, malformed or dead records produce `off`. Only the status and update time enter the snapshot, attached to the already-cleaned lead. HQ displays **working**, **idle** or **offline**, plus **N helpers** when workers are live. Helper presence never determines the lead's activity.

The link also runs one fixed local command at startup and every five minutes to refresh needs:

```sh
python3 ~/Documents/GitHub/AgentHarness/doctor.py --write-needs
```

It uses no shell, accepts no office-supplied command or arguments, times out after 60 seconds, and logs failures while continuing the link. It does not start another refresh while one is running.

Local project paths, session-registry names, process IDs, working directories, socket paths, app-session identities, registry prose and raw transcripts never leave the Mac. Explicit lead replies are sent through the talk relay to the owner. Cleaned lead IDs reach the server only for matching and never reach browsers. Presence worker IDs keep their existing opaque harness identity. URL credentials and query strings are removed from repository links. Published pitch and board text is intentionally sent; source files and raw registry records are not. A local lock prevents two links on the same Mac. Link records persist privately in `hq-macs.json`; snapshots stay in server memory and are republished after a restart.

HQ prefers the freshest connected link snapshot, with the owner's cubby snapshots as fallback when none is fresh. Repository slugs or project names associate matching open floors. A project whose projects.json `url` is not a GitHub URL takes its repository from the checkout's `origin` remote, read from its git config on disk (no git command, no network). Mac-linked leads appear at HQ and on their own project floor with the same chat. Each project's lead card and portfolio entry can open its published pitch read-only. Existing cubby pitch verdicts still use their signed cubby connection.

Managers receive projects, lead statuses, helpers and needs counts/age, but no link controls, pairing secrets, tokens, local paths, matching session IDs or needs text. Outsiders receive only names and statuses for linked leads on their current project floor, never HQ conversations. Mac manager messages stay held for the owner until Pass on; they can also be declined. Existing cubby ownership, sharing and signed control rules remain in place.

## Talking to your leads (office side)

Press **E** at a linked main lead, department lead or the **Cofounder** head desk in HQ. The portfolio's **Talk to** buttons also reach leads beyond the six furnished project areas. On a project floor, only that project's linked leads appear, in its existing cubby room or near the entrance. Their identity and conversation are the same in both places; linked leads do not use “At HQ” cards. In `/lite`, the **Leads** list puts Cofounder first, followed by each project's leads, and opens the same phone-friendly chat.

Only the configured HQ owner's signed-in Cloudflare/office account can talk directly. No browser device keys are needed for linked leads. Coworkers see the owner/project/title nameplate and status on project floors. Managers see the list read-only and can **Send to owner**: the message stays held until the owner chooses **Pass on**. Passing it on uses the same Mac relay, labelled `<manager name> (held, passed on by <owner name>)`, and its reply appears only in the owner's conversation. Managers cannot direct leads or approve their work.

Chats show queued, delivered, working, replied or failed. When disconnected, sending fails with **Your Mac link is offline** and **Open in the Claude app**. Messages are never automatically replayed after an office restart. Pending messages become failed on restart, disconnect or after 31 minutes without a reply (the link itself waits up to 10 minutes for a busy lead, then 20 for its reply). One message can be in flight per lead, with ten sends per minute per owner. Cofounder shows **status unknown** until the link publishes its optional status.

The office keeps the last 50 conversation entries per lead in `hq-talk.json` and held manager messages in `hq-messages.json`, both in the server data directory, atomically replaced with mode `0600`. Held messages keep their existing five-waiting-message and 30-second send limits, expire after 24 hours and are removed after 48 hours. Restarts preserve the queue and its decisions. Conversation data is owner-only; the relay sends project name and department index (or Cofounder), never local session IDs or filesystem paths.

Every chat has a top-right **✕** and **Esc** close; in the 3D office both return directly to mouse-look.

## Talking to your leads (Mac link side)

The Mac link accepts validated `lead.send` messages only after its authenticated `hq.ready` handshake. It resolves main and department leads from the same visible project entries and department order as the snapshot, and the Cofounder from the top-level `cofounder` registration. When the registered Claude chat is open, the link waits for it to become idle, then delivers one attributed message through its local authenticated inbox socket. Otherwise it resumes the registered native session headlessly with the existing Claude subscription checks; an app-only registration must first be opened in the Claude app. Cofounder headless resume currently fails explicitly because its registration contract supplies no working directory. The link permits one outstanding turn and five waiting messages per lead, with twenty pending messages across all leads. It never delivers to hidden, archived or remote-only projects.

Inbox replies arrive through the harness Stop hook. The link publishes a private `office-link.json` capability file (mode `0600`) in `~/Library/Application Support/AgentHarness`, naming its authenticated localhost activity endpoint, and writes a private `office-turns/<sessionId>` marker for each inbox turn. Only a Stop carrying the matching session and turn returns a reply to the office. Busy waits fail after ten minutes; an inbox turn without a reply fails after twenty minutes. Headless replies come directly from NativeLead and do not write a hook marker. Hook events also have an in-process emitter for later activity integration; this phase does not forward that activity feed. Session identities, paths, working directories, process IDs, socket paths, peer tokens, and the localhost capability token stay on the Mac in this chat path; only the turn ID, delivery state, bounded assistant reply or short failure message returns to the office. Existing snapshot metadata is described above. Office text supplies no executable, path, socket or CLI argument, and a cross-session message does not grant approval for merges, deployments or spending.

The manual inbox contract is `node --import tsx tests/contract/inbox-contract.mjs <trusted-project-dir>`. It starts and cleans up a throwaway Haiku background session, uses a copy of the real harness hook from commit `bf5d53b`, and checks inbox delivery followed by a `pong` reply. It is deliberately excluded from `npm test` and must be run locally by the lead.

## Portfolio


HQ has up to six project areas with dashed owner-colour borders, low project signs, a large CEO desk and smaller department desks with front plaques. Each area has a 1.9 m task-board easel at its edge. Open-floor desks, pod furniture and their hanging signs are hidden while on HQ and restored on leaving. The north portfolio wall uses four large project columns at most, with a “+N more” label for the remaining projects; the readable portfolio window lists them all. Main leads are labelled “CEO”; default department lead titles are shortened to the department name, while custom titles remain. Task counts and progress are not inferred. The furnished areas have personal-agent characters at their CEO and department desks, with the owner’s colour, role outfit, floor ring and one two-line nameplate. Cubby leads retain their existing status display; Mac-linked leads use the session registry statuses described above. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's latest available cubby pitch from any project floor. Managers can inspect it and its images while on HQ, but cannot give verdicts. The owner's verdicts still require a trusted device signature and are sent to the original publishing cubby. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.

## Legacy cubby-connected leads

Projects beyond HQ’s six furnished areas remain listed in the portfolio and keep their existing cubby bodies; they do not offer an HQ status card or Go there destination.

A cubby-connected lead in a furnished area keeps one identity and one conversation. Its body stands at its HQ desk by default. While that project has a published ready pitch with pieces awaiting a verdict, the publishing cubby lead stands inside HQ’s pitch room by the screens. Otherwise, a live presence worker in a worktree of the linked project, with a matching lead session ID, places that lead on the project floor. This applies to the CEO and department leads. The CEO uses its existing cubby body; department leads visit that project room. When no matching live worker remains, the lead returns to HQ. A ready pitch takes precedence over project presence. Location changes at HQ use the existing fade, respecting reduced motion.

On the linked project floor, the absent cubby lead is replaced by an “At HQ” status card at its usual interior spot and a small sign at the door. During a pending pitch these say “In the HQ pitch room”, and its HQ desk has an “In the pitch room” card. A project without a floor link keeps its lead at HQ and offers no cross-floor Go there action.

Press E at the connected lead or its status card to open the same cubby chat. The owner can send from a trusted browser device; its signature still names the source cubby and project floor. HQ managers on HQ can read the thread and send a message for the owner to review first. Waiting messages are persisted for 24 hours, visible only to the owner and sending manager; each manager can have five waiting messages and send once per 30 seconds, with a 4,000-character limit. The owner can **Decline** or **Pass on** from a trusted device; Pass on signs the full text `Message from <Manager> (HQ manager; can't approve merges, publishes or spending): <text>` as ordinary cubby chat, and the connector still verifies the owner signature. Managers see waiting, passed on, declined or expired states, and passed messages are labelled with the manager’s name in the thread. A waiting-message badge appears on the lead’s HQ plate or status card for the owner and sending manager, and on the project-floor status card for the owner only; legacy cubby message controls are available on HQ. Queue records survive server restarts and are discarded 48 hours after creation. For department leads and main leads without a connected conversation, E shows where to talk to that lead in the Claude app on the owner’s computer.

The conversation window’s **Go there** button rides the existing elevator from a project-floor card to HQ, then places you near the lead. At a vacant HQ desk it takes you to the pitch-room body or the linked project floor, according to the location card; from the pitch-room body it can take you back to the linked project floor’s cubby door. Cubby sharing rules remain unchanged: manager access to HQ never admits a manager to an owner’s cubby interior.

When the cubby lead needs the owner, its body raises a hand, its HQ desk has a soft amber glow, and its status cards show an amber “✋ Needs you” badge, or “✋ 2 need you” for a published count of two. An unknown count reads “✋ Needs you · unknown”; stale counts append “· as of” and a short local observation time. These HQ details are visible only to the owner and allowed managers. With HQ disabled, for viewers without HQ access, and for other owners’ cubbies, the original cubby body and sharing behaviour remain unchanged.

## Live helpers, tasks and needs

The local connector reads AgentHarness presence records from `~/Library/Application Support/AgentHarness/runs`. A record counts only while its process is alive and its folder is an exact Git worktree root of the selected project in cubby mode, or of each visible registered local project in link mode. A cleaned optional `lead` identifies the registered CEO or department lead. Missing or unknown lead IDs fall back to that project's CEO desk; workers without a matching lead or project desk do not appear on HQ. No lead activity or worker progress is guessed from these records. Mac-linked lead plates show registry activity separately from their live helper count.

HQ helpers use the owner's trim and carry smaller task-title plates overhead. CEO helpers stand beside their desk and department helpers behind their lead. Helper plates hide where their projected screen boxes overlap an HQ status card or lead plate, and return when the view clears. Close-up HQ plates are capped at 1.3 times their projected size at 3 m, with an additional phone-width fit. Each desk shows up to three helpers and a “+N” label for overflow. A helper appears at most once per floor: at its HQ desk on HQ, and in its existing cubby representation on the project floor. Task boards show live worker titles, providers and branch short names, newest first, up to five rows plus “+N more”. E opens the same rows in a readable window.

The connector also reads `~/Library/Application Support/AgentHarness/needs.json`, a read-only publication of the AgentHarness health check, limited to 64 KB. It matches project paths as the lead registry does and never opens the publication's source files or other repositories' Markdown. Missing data adds nothing; malformed data adds nothing and reports a quiet connector error. An unknown count stays unknown. The Office never interprets these lines as approval.

A positive project needs count raises only its CEO's hand, lights the desk, and adds a Needs you count alongside any existing cubby needs. Department leads do not inherit a project-wide hand. When the publication is older than its stated freshness interval, the hand remains raised but dimmed, and the count says “stale · as of” with the observation time. The owner can read the first line by aiming at the HQ lead or status card, and the published lines by pressing E. Managers receive only the count and age; needs lines are removed on the server before sending their HQ view.

These signals also appear on the linked project floor and through the HQ entry in `/lite`, beside My cubby. Only the HQ owner and allowed managers receive this additional data. There are no phone push alerts. Ordinary cubby sharing stays unchanged.

When an already-linked project floor detects a merged PR, its existing merge gong event also rings HQ's gong and shows “<Project>: PR #N merged” to current HQ viewers. Each PR rings once; HQ adds no GitHub polling.
