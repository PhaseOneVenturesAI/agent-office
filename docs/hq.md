# Private HQ

Back to the [README](../README.md).

Set these variables on the office server, then restart it:

```sh
AGENT_OFFICE_HQ_OWNER=Jonathan
AGENT_OFFICE_HQ_MANAGERS=ivan@example.com,Eddie
```

Each entry is an account name or, if it contains `@`, the email Cloudflare Access signs that account in as; both match case-insensitively. An email keeps matching if the account is renamed, and an account that only shares the name doesn't get in. The owner can be either too; an email owner is shown by the office name of the account that email signs in as (or, before that account exists, by the part before the `@`). Only the owner and the named managers see HQ in the elevator or can enter it. Admin status alone gives no access. With no owner configured, no HQ opens and ordinary floors keep their behavior. Turning the owner setting off also hides an existing HQ. The server keeps its identity in `hq.json` (mode `0600`) and its local folder under the office data directory; it has no repository and cannot be kicked off. Only its owner can remove it. Leaving the owner configured recreates it on the next server restart.

## Connect your Mac

Enter HQ as its owner and press **E** at **Connect your Mac**. The window creates or reuses this browser's owner key and shows its fingerprint and a copyable command:

```sh
agent-office join https://office.example --token '<invitation>' --hq --owner-key '<key>'
```

Run the command on the Mac that has your AgentHarness registry and leave it running. Compare the owner-key fingerprint printed by the command with the window. There is no `--project` or `--floor`: one connection publishes the Mac's projects together. The owner sees the computer name and **Connected · last seen <time>** on the panel. Managers and other accounts cannot create invitations or see the command or token. Reopening setup replaces the owner's pending invitation. Once joined, an invitation is bound to that owner, HQ and computer identity; the same computer can reconnect. Existing single-cubby connections continue to work.

For an office behind Cloudflare Access, sign in locally first:

```sh
cloudflared access login https://office.example
agent-office join https://office.example --token '<invitation>' --hq --owner-key '<key>' --cloudflare-access
```

The setup window includes `--cloudflare-access` when the office reports Access is enabled. Join uses the existing local application-token cache; it does not refresh expired Access credentials. Log in again and restart join after expiry. Reconnects use the existing retry behaviour. Stop join with Ctrl-C.

The connector reads `~/Documents/GitHub/AgentHarness/projects.json` through `registryFile()` (with the existing older `~/Documents/AgentHarness/projects.json` fallback). It uses the registry's project keys as names and only these entry fields: `path`, `url`, `localState`, `hostId`, `leadSessionId`, `leadThreadId`, `leadAppSession`, `departmentLeads` (`department`, `title`, `sessionId`, `appSession`) and `sidebarGroup`. It does not consult `lead`, `note`, `historicalLead` or `creativeLineage`. Archived and remote-only entries are skipped, as are missing paths. Null lead IDs are accepted. Git verifies the existing project/worktree roots; no repository is cloned or opened as a new Office floor.

Every normal 15-second observation includes up to 12 projects and 64 live workers total, with existing text caps and a 60 KiB snapshot limit. Oversized observations shorten display text and omit optional pitch detail or needs lines to preserve project and worker identities. For each project the connector reads scoped AgentHarness presence, the needs publication and `.agent-office/pitch.json`. It publishes the cleaned name, GitHub repository slug, registered main/department leads, worker metadata, needs and pitch. Paths, process working directories, registry prose and app-session metadata stay on the Mac. Cleaned lead session IDs reach the server only to match workers to their lead; they never reach browsers. URL credentials and query strings are removed from repository links. Neither registry files nor transcripts are forwarded.

The owner key is pinned in a private `0600` record under `~/.agent-office/hq/<computer-id>/`. A different key is rejected unless locally authorised with `--replace-owner-key`. The connector takes a local lock so a second HQ connector cannot run on the same Mac. HQ invitations persist privately in `hq-macs.json`; project and worker snapshots stay in server memory and must be republished after a server restart.

HQ uses the freshest connected Mac observation, falling back to the owner's existing cubby snapshots if no Mac observation is fresh. Repository slugs link projects to matching open floors without a cubby `own` flag. Mac leads stay at HQ or at a ready pitch in this step; their status shows their role and **N working** when scoped live workers are present. It never guesses whether an app lead is running or idle. Chat to Mac leads and their project-floor rooms are separate steps.

Each Mac project's lead card and portfolio entry list its published pitch pieces. Selecting one opens its read-only view and selects that project in the HQ pitch room; existing cubby pitch verdicts continue to use their signed cubby connection. Mac manager messages stay held for the owner and can be declined; they are not sent to the lead. Needs lines are owner-only, managers receive counts and age, and outsiders receive no HQ data. All existing cubby ownership, appearance, sharing and signed control rules remain in place.

## Portfolio


HQ has up to six project areas with dashed owner-colour borders, low project signs, a large CEO desk and smaller department desks with front plaques. Each area has a 1.9 m task-board easel at its edge. Open-floor desks, pod furniture and their hanging signs are hidden while on HQ and restored on leaving. The north portfolio wall uses four large project columns at most, with a “+N more” label for the remaining projects; the readable portfolio window lists them all. Main leads are labelled “CEO”; default department lead titles are shortened to the department name, while custom titles remain. Task counts and progress are not inferred. The furnished areas have personal-agent characters at their CEO and department desks, with the owner’s colour, role outfit, floor ring and one two-line nameplate. Only a connected cubby lead shows a live status (working, idle, asleep or error); unconnected leads show their role. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's latest available cubby pitch from any project floor. Managers can inspect it and its images while on HQ, but cannot give verdicts. The owner's verdicts still require a trusted device signature and are sent to the original publishing cubby. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.

## One lead across two floors

Projects beyond HQ’s six furnished areas remain listed in the portfolio and keep their existing cubby bodies; they do not offer an HQ status card or Go there destination.

A cubby-connected lead in a furnished area keeps one identity and one conversation. Its body stands at its HQ desk by default. While that project has a published ready pitch with pieces awaiting a verdict, the publishing cubby lead stands inside HQ’s pitch room by the screens. Otherwise, a live presence worker in a worktree of the linked project, with a matching lead session ID, places that lead on the project floor. This applies to the CEO and department leads. The CEO uses its existing cubby body; department leads visit that project room. When no matching live worker remains, the lead returns to HQ. A ready pitch takes precedence over project presence. Location changes at HQ use the existing fade, respecting reduced motion.

On the linked project floor, the absent cubby lead is replaced by an “At HQ” status card at its usual interior spot and a small sign at the door. During a pending pitch these say “In the HQ pitch room”, and its HQ desk has an “In the pitch room” card. A project without a floor link keeps its lead at HQ and offers no cross-floor Go there action.

Press E at the connected lead or its status card to open the same cubby chat. The owner can send from a trusted browser device; its signature still names the source cubby and project floor. HQ managers on HQ can read the thread and send a message for the owner to review first. Waiting messages are held in memory for 24 hours, visible only to the owner and sending manager; each manager can have five waiting messages and send once per 30 seconds, with a 4,000-character limit. The owner can **Decline** or **Pass on** from a trusted device; Pass on signs the full text `Message from <Manager> (HQ manager; can't approve merges, publishes or spending): <text>` as ordinary cubby chat, and the connector still verifies the owner signature. Managers see waiting, passed on, declined or expired states, and passed messages are labelled with the manager’s name in the thread. A waiting-message badge appears on the lead’s HQ plate or status card for the owner and sending manager, and on the project-floor status card for the owner only; message items do not leave HQ. Queue records are not saved to disk; restarting the server clears them, and records are discarded 48 hours after creation. For department leads and main leads without a connected conversation, E shows where to talk to that lead in the Claude app on the owner’s computer.

The conversation window’s **Go there** button rides the existing elevator from a project-floor card to HQ, then places you near the lead. At a vacant HQ desk it takes you to the pitch-room body or the linked project floor, according to the location card; from the pitch-room body it can take you back to the linked project floor’s cubby door. Cubby sharing rules remain unchanged: manager access to HQ never admits a manager to an owner’s cubby interior.

When the cubby lead needs the owner, its body raises a hand, its HQ desk has a soft amber glow, and its status cards show an amber “✋ Needs you” badge, or “✋ 2 need you” for a published count of two. An unknown count reads “✋ Needs you · unknown”; stale counts append “· as of” and a short local observation time. These HQ details are visible only to the owner and allowed managers. With HQ disabled, for viewers without HQ access, and for other owners’ cubbies, the original cubby body and sharing behaviour remain unchanged.

## Live helpers, tasks and needs

The local connector reads AgentHarness presence records from `~/Library/Application Support/AgentHarness/runs`. A record counts only while its process is alive and its folder is an exact Git worktree root of the selected project in cubby mode, or of each registered local project in HQ mode. A cleaned optional `lead` identifies the registered CEO or department lead. Missing or unknown lead IDs fall back to that project's CEO desk; workers without a matching lead or project desk do not appear on HQ. No lead activity or worker progress is guessed from these records. HQ lead plates show roles without guessing app activity. Mac-connected lead plates also show their live-worker count.

HQ helpers use the owner's trim and carry smaller task-title plates overhead. CEO helpers stand beside their desk and department helpers behind their lead. Helper plates hide where their projected screen boxes overlap an HQ status card or lead plate, and return when the view clears. Close-up HQ plates are capped at 1.3 times their projected size at 3 m, with an additional phone-width fit. Each desk shows up to three helpers and a “+N” label for overflow. A helper appears at most once per floor: at its HQ desk on HQ, and in its existing cubby representation on the project floor. Task boards show live worker titles, providers and branch short names, newest first, up to five rows plus “+N more”. E opens the same rows in a readable window.

The connector also reads `~/Library/Application Support/AgentHarness/needs.json`, a read-only publication of the AgentHarness health check, limited to 64 KB. It matches project paths as the lead registry does and never opens the publication's source files or other repositories' Markdown. Missing data adds nothing; malformed data adds nothing and reports a quiet connector error. An unknown count stays unknown. The Office never interprets these lines as approval.

A positive project needs count raises only its CEO's hand, lights the desk, and adds a Needs you count alongside any existing cubby needs. Department leads do not inherit a project-wide hand. When the publication is older than its stated freshness interval, the hand remains raised but dimmed, and the count says “stale · as of” with the observation time. The owner can read the first line by aiming at the HQ lead or status card, and the published lines by pressing E. Managers receive only the count and age; needs lines are removed on the server before sending their HQ view.

These signals also appear on the linked project floor and through the HQ entry in `/lite`, beside My cubby. Only the HQ owner and allowed managers receive this additional data. There are no phone push alerts. Ordinary cubby sharing stays unchanged.

When an already-linked project floor detects a merged PR, its existing merge gong event also rings HQ's gong and shows “<Project>: PR #N merged” to current HQ viewers. Each PR rings once; HQ adds no GitHub polling.
