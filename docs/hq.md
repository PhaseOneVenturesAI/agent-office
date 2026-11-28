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

Leave the command running to publish the snapshot. The token is bound to the owner and computer and has no automatic expiry. It is stored under `~/.agent-office/link/`, with directory mode `0700` and file mode `0600`. No browser device key or `--owner-key` is used for the Mac link. The owner can **Revoke** a link from the HQ panel; this disconnects it and rejects its token. The panel lists each computer with **Connected** or **Offline since <time>**. Retired cubby/HQ join flags and cubby bridge/device commands exit nonzero and point to `agent-office link <url>`. Ordinary satellite joins remain supported.

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

To stop sign-in expiry from disconnecting the Mac, give the link a Cloudflare Access **service token** (a Service Auth policy on the office's Access application). Save its Client ID and Secret, created by your Cloudflare admin, as `~/.agent-office/link/cf-service-token.json` with mode `0600`:

```sh
printf '%s' '{"clientId":"<client id>","clientSecret":"<client secret>"}' > ~/.agent-office/link/cf-service-token.json
chmod 600 ~/.agent-office/link/cf-service-token.json
agent-office link https://office.example --check-access
```

When that file exists, the link sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` on every pairing and poll request and on the `/ws/node` websocket, instead of the cloudflared login. It reads the file again for each connection, so replacing the token takes effect at the next reconnect. The values are only sent to an `https` office and are never logged or printed. Without the file, the cloudflared login is used as above. If the file is readable by anyone else, is a link, or lacks either field, the link refuses to start and names the fix (under `--run` it exits `78`). `--check-access` makes one request and prints only `service token OK` or `refused (<reason>)`.

### Snapshot sources and privacy

The link reads the project registry selected by `registryFile()`: `~/Documents/GitHub/AgentHarness/projects.json`, with the existing older `~/Documents/AgentHarness/projects.json` fallback. Project keys supply names. Allowed entry fields are `path`, `url`, `localState`, `hostId`, `leadSessionId`, `leadThreadId`, `leadAppSession`, `departmentLeads` (`department`, `title`, `sessionId`, `appSession`) and `sidebarGroup`; `office` is checked only to filter hidden entries. It never consults `lead`, `note`, `historicalLead` or `creativeLineage`. Entries marked `office: "hidden"`, `localState: "archived"` or `"remote-only"`, and missing paths, are excluded together with their workers and needs. Git verifies existing worktree roots; ordinary linking does not clone repositories. Studio drafts and explicit Open/Add actions are described below.

Every 15 seconds, the snapshot includes at most 12 projects and 64 scoped live workers, within a 60 KiB frame. Each project contributes AgentHarness presence records with cleaned lead matching IDs, needs from `~/Library/Application Support/AgentHarness/needs.json`, its published `.agent-office/pitch.json`, and cleaned `.agent-office/draft.json` boards. Oversized frames shorten text and omit optional pitch/board detail or needs lines while preserving project and worker identities. Draft boards are collected for the server; Studio feedback reaches the lead through the talk relay described below.

The read-only Claude session registry, `~/.claude/sessions/*.json`, is limited to 256 regular files of at most 16 KiB each. Main leads match `leadSessionId` or `leadAppSession`; department leads match `sessionId` or `appSession`, against a record's `sessionId` or `bridgeSessionId`. A valid record's `status` (`busy` or `idle`) and `updatedAt` supply the lead status while its process is alive. Missing, malformed or dead records produce `off`. Only the status and update time enter the snapshot, attached to the already-cleaned lead. HQ displays **working**, **idle** or **offline**, plus **N helpers** when workers are live. Helper presence never determines the lead's activity.

The link also runs one fixed local command at startup and every five minutes to refresh needs:

```sh
python3 ~/Documents/GitHub/AgentHarness/doctor.py --write-needs
```

It uses no shell, accepts no office-supplied command or arguments, times out after 60 seconds, and logs failures while continuing the link. It does not start another refresh while one is running.

Local project paths, session-registry names, process IDs, working directories, socket paths, app-session identities, registry prose and raw transcripts never leave the Mac. Explicit lead replies are sent through the talk relay to the owner. Cleaned lead IDs reach the server only for matching and never reach browsers. Presence worker IDs are opaque hashes of the run record, never process IDs. URL credentials and query strings are removed from repository links. Published pitch and board text is intentionally sent; source files and raw registry records are not. A local lock prevents two links on the same Mac. Link records persist privately in `hq-macs.json`; snapshots stay in server memory and are republished after a restart.

HQ prefers the freshest connected link snapshot, with the owner's cubby snapshots as fallback when none is fresh. Repository slugs or project names associate matching open floors. A project whose projects.json `url` is not a GitHub URL takes its repository from the checkout's `origin` remote, read from its git config on disk (no git command, no network). Mac-linked leads appear at HQ and on their own project floor with the same chat. Each project's lead card and portfolio entry can open its published pitch read-only. Pitch verdicts use the owner account and the same `lead.send` relay; the link saves them on the publishing Mac. Legacy cubby publications remain read-only until that project is linked.

Managers receive projects, lead statuses, helpers and needs counts/age, but no link controls, pairing secrets, tokens, local paths, matching session IDs or needs text. Outsiders receive names and statuses for linked leads and helper titles on their current project floor, never doing lines or HQ conversations. Mac manager messages stay held for the owner until Pass on; they can also be declined. The linked owner’s project-floor rooms refuse knocking and omit conversations, including when an old sharing grant exists. Card feedback and Pass on require the owner account; device files are ignored.

## New projects and Add your project

The HQ owner, signed in through Cloudflare Access, can press **New project** in the elevator, HQ portfolio or `/lite`. Managers and coworkers cannot start, review, open or add projects. The existing v8 direction is Jonathan’s approved phase 4 brief (2026-11-27); the link registry replaces the plan’s proposed direct writes to the harness registry.

Give the project a name (up to 60 characters). The admitted Mac link derives a safe folder name, exclusively creates `~/Documents/GitHub/<Folder>`, runs `git init -b main`, and creates `.agent-office/`. An existing folder is refused. It starts a native Claude subscription session with a fixed UUID and Studio prompt; no Claude app chat is required. The same session handles subsequent messages through `lead.send` and headless resume. Native permission denials remain local approval requirements; the office does not bypass them.

`AGENT_OFFICE_PROJECT_STARTERS`, `AGENT_OFFICE_KICKOFF_REMOTE` and `AGENT_OFFICE_KICKOFF_ORG` are ignored with a startup notice. The VPS never creates a draft git checkout or commits one. Old `drafts/<id>` folders are logged for admin cleanup and left untouched; old floors use separate presentation metadata.

Only the owner sees the private Studio floor. The VPS stores its identity and ordinary room metadata, **not a git checkout**. Walk up to the Studio lead or table and press **E** to chat. The Mac publishes cleaned `.agent-office/draft.json` boards every three seconds while a draft exists (otherwise the normal fifteen-second interval). Published image files remain under `.agent-office/design/`; only cleaned, referenced images reach the owner’s board.

Each idea and screen offers **👍**, **👎** and **Change this…** on desktop and phone. Screens may include a positive integer `version` (up to 1000). Keep versions as separate cards with different stable IDs and the same title: the review window compares them side by side and **Approve** targets the selected version. Every review is a compact message to the Studio lead through the normal conversation relay. The decisions view updates when the lead writes the board; clicking a verdict does not invent a decision locally. Card feedback is also saved by the link to `.agent-office/feedback.json` before notifying the lead. Old draft boards can receive feedback when their project is registered on the Mac link; their table directs the owner to start a New project.

Press **K** while aiming at the Studio table, or **Open floor** in `/lite`, and type the exact project name. The Mac writes the cleaned board through `kickoffDocuments` (README, brief, plan, feedback, design system, tokens and approved screen files), stages those explicit files and commits them. It then runs:

```sh
gh repo create PhaseOneVenturesAI/<slug> --private --source . --push
```

This uses the Mac’s GitHub sign-in. Existing remotes or an already-existing GitHub repository are refused; the link does not force-push or silently reuse them. Other staged changes must be committed or unstaged locally first. A failure leaves the local project intact for inspection; if GitHub creation or push partly succeeded, inspect that remote before retrying. The office receives only the project name, repository slug and a short result, never command output or local paths.

After success, the office uses its normal repository-floor clone path, reusing an existing floor for the same repository. The public floor has its **New** badge, gong, Design book and brand poster. The Studio lead remains the same native session, and its conversation becomes the main lead’s repository conversation. The private metadata floor is retired. The office server needs its normal GitHub read access to clone the private repository; a clone failure is reported separately from the completed Mac operation.

**Add your project**, in the HQ portfolio and `/lite`, takes `owner/repo` (for example `PhaseOneVenturesAI/Skedaddle`) or a folder name already under `~/Documents/GitHub`. The Mac verifies an existing folder’s GitHub origin or runs `gh repo clone owner/repo <folder>`. It preserves an existing registered lead; if there is none, it starts a headless main lead. Pressing Add is the explicit request to open that repository’s public floor. Duplicate adds reuse one floor.

The Mac link never writes AgentHarness’s `projects.json`. It atomically writes its own `~/.agent-office/link/projects.json` (directory `0700`, file `0600`), with `name`, `path`, `url`, `localState`, `leadSessionId`, and `office: "draft"` while drafting. Snapshot and chat resolution merge this with the harness registry; a harness entry with the same name or canonical path wins, including hidden and archived entries. With exact harness precedence, an existing harness entry without a lead, or still marked draft after Open, remains authoritative until the harness processes the request. The link retains its newly started session and never starts a duplicate while that registration is pending.

Each New, Open and Add also writes an atomic `0600` request under `~/Library/Application Support/AgentHarness/office-requests/<id>.json`. Schema 1 contains `kind` (`new-project`, `kicked-off` or `add-project`), `id`, `createdAt`, `project`, `folder`, nullable `repoUrl` and `leadSessionId`, and `source: "office-link"`. AgentHarness owns registration. Its optional `done/<id>.json` receipt is shown as a bounded status in the owner’s Mac link panel; a missing receipt does not gate an office-created project. No raw harness receipt prose or paths are sent.

All Studio modals have a top-right **✕** and **Esc** close, using the office’s existing return-to-mouse-look behavior. Commands use fixed executable arguments, no shell, bounded output and timeouts. Chat and review text never authorize spending, publishing or contacting anyone.

## Talking to your leads (office side)

Press **E** at a linked main lead, department lead or the **Cofounder** head desk in HQ. The portfolio's **Talk to** buttons also reach leads beyond the six furnished project areas. On a project floor, only that project's linked leads appear, in its existing cubby room or near the entrance. Their identity and conversation are the same in both places; linked leads do not use “At HQ” cards. In `/lite`, the **Leads** list puts Cofounder first, followed by each project's leads, and opens the same phone-friendly chat.

Only the configured HQ owner's signed-in Cloudflare/office account can talk directly. No browser device keys are needed for linked leads. Coworkers see the owner/project/title nameplate and status on project floors. Managers see the list read-only and can **Send to owner**: the message stays held until the owner chooses **Pass on**. Passing it on uses the same Mac relay, labelled `<manager name> (held, passed on by <owner name>)`, and its reply appears only in the owner's conversation. Managers cannot direct leads or approve their work.

Chats show queued, delivered, working, replied or failed. When disconnected, sending fails with **Your Mac link is offline** and **Open in the Claude app**. Messages are never automatically replayed after an office restart. Pending messages become failed on restart, disconnect or after 31 minutes without a reply (the link itself waits up to 10 minutes for a busy lead, then 20 for its reply). One message can be in flight per lead, with ten sends per minute per owner. Cofounder shows **status unknown** until the link publishes its optional status.

The office keeps the last 50 conversation entries per lead in `hq-talk.json` and held manager messages in `hq-messages.json`, both in the server data directory, atomically replaced with mode `0600`. Held messages keep their existing five-waiting-message and 30-second send limits, expire after 24 hours and are removed after 48 hours. Restarts preserve the queue and its decisions. Conversation data is owner-only; the relay sends project name and department index (or Cofounder), never local session IDs or filesystem paths.

Every chat has a top-right **✕** and **Esc** close; in the 3D office both return directly to mouse-look.

## Talking to your leads (Mac link side)

The Mac link accepts validated `lead.send` messages only after its authenticated `hq.ready` handshake. It resolves main and department leads from the same visible project entries and department order as the snapshot, and the Cofounder from the top-level `cofounder` registration. When the registered Claude chat is open, the link waits for it to become idle, then delivers one attributed message through its local authenticated inbox socket. Otherwise it resumes the registered native session headlessly with the existing Claude subscription checks; an app-only registration must first be opened in the Claude app. Cofounder headless resume currently fails explicitly because its registration contract supplies no working directory. The link permits one outstanding turn and five waiting messages per lead, with twenty pending messages across all leads. It never delivers to hidden, archived or remote-only projects.

Inbox replies arrive through the harness Stop hook. The link publishes a private `office-link.json` capability file (mode `0600`) in `~/Library/Application Support/AgentHarness`, naming its authenticated localhost activity endpoint, and writes a private `office-turns/<sessionId>` marker for each inbox turn. Only a Stop carrying the matching session and turn returns a reply to the office. Busy waits fail after ten minutes; an inbox turn without a reply fails after twenty minutes. Headless replies come directly from NativeLead and do not write a hook marker. Hook events also feed the live work projection described below; that projection never includes a hook prompt or reply. Session identities, paths, working directories, process IDs, socket paths, peer tokens, and the localhost capability token stay on the Mac in this chat path; only the turn ID, delivery state, bounded assistant reply or short failure message returns to the office. Existing snapshot metadata is described above. Office text supplies no executable, path, socket or CLI argument, and a cross-session message does not grant approval for merges, deployments or spending.

The manual inbox contract is `node --import tsx tests/contract/inbox-contract.mjs <trusted-project-dir>`. It starts and cleans up a throwaway Haiku background session, uses a copy of the real harness hook from commit `bf5d53b`, and checks inbox delivery followed by a `pong` reply. It is deliberately excluded from `npm test` and must be run locally by the lead.

## Seeing the work

The Mac link forwards a cleaned `hq.activity` replacement frame for each visible registered main lead, department lead or Cofounder. Local session-registry matching is the same as talk targets; the event's project name or working directory cannot authorize a session. Unregistered, hidden, archived, remote-only, dead and ambiguous lead sessions are dropped.

At HQ and on its project floor, a linked lead's plate shows **editing hero.tsx**, **reading README.md**, **running tests**, or **using <tool>**. File summaries keep only the basename. Bash summaries keep only the first command word; npm/node/pytest/python summaries that contain a simple test marker say “running tests”. A first-word-only hook summary cannot establish that npm is testing. Stop clears the activity. After two minutes without fresh activity, the office returns to the registry status. Frames coalesce to the latest state at most once per lead per second.

SubagentStart adds a helper bot labelled with its agent type (or “Helper”), and SubagentStop removes it. A lead has at most eight subagents. The link refreshes helper presence once a minute while clearing tool lines that have had no activity for two minutes. Missing stops expire after 30 minutes; Stop and SessionStart clear the parent's helpers. Harness presence workers show their title and last-tool activity, or working/idle status. Each live factory run gets its own existing factory-machine prop with its title and progress plate. Live task boards use the same lead and helper data. Plates retain the existing close-up size cap and yield to lead plates and other helper plates.

Presence records are live only while the process is alive. When `pidStartedAt` is present, the link also compares it to `LC_ALL=C ps -o lstart= -p <pid>`; a reused process ID, failed lookup or mismatch removes that run. Older records without a start time retain their process-alive check. `running` and `busy` map to the existing “working” status; `idle` clears any old last-tool line. Worker identities are opaque hashes of the run record, not process IDs.

The owner and HQ managers see activity and helper progress at HQ. On project floors only the owner receives doing lines. Coworkers (including managers visiting a project floor) receive watch-only helper bodies and titles, without doing lines; this grants no chat, command or approval rights.

Only the admitted Mac link node can send activity. Activity is held in memory and discarded on disconnect/revoke; it is not persisted or replayed. The activity frame contains a project/department target (or Cofounder), a bounded display line and opaque helper hashes/titles. Paths, working directories, native session IDs, raw agent IDs, process IDs, command arguments, prompts and hook replies never enter this feed. Explicit replies to office messages still use the separate owner-only talk relay. Existing snapshot matching metadata remains as documented above.

## Portfolio


HQ has up to six project areas with dashed owner-colour borders, low project signs, a large CEO desk and smaller department desks with front plaques. Each area has a 1.9 m task-board easel at its edge. Open-floor desks, pod furniture and their hanging signs are hidden while on HQ and restored on leaving. The north portfolio wall uses four large project columns at most, with a “+N more” label for the remaining projects; the readable portfolio window lists them all. Main leads are labelled “CEO”; default department lead titles are shortened to the department name, while custom titles remain. Task counts and progress are not inferred. The furnished areas have personal-agent characters at their CEO and department desks, with the owner’s colour, role outfit, floor ring and one two-line nameplate. Cubby leads retain their existing status display; Mac-linked leads use the session registry statuses described above. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's selected Mac-linked pitch, with read-only legacy publications as fallback. Managers can inspect it and its images while on HQ, but cannot give verdicts. Only the signed-in owner can send verdicts, through the existing Mac link. The link writes bounded, private `.agent-office/pitch-feedback.json`; a fresh snapshot supplies the saved stamp. Managers and coworkers cannot submit reviews. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.

## Existing cubby rooms

Existing rooms and saved colours remain. Leads keep their HQ desk and project-floor presence simultaneously; there are no away cards or Go there relocation actions. The legacy `where` wire field remains `hq` for older clients, and the optional cubby lead metadata remains compatible. HQ itself has no cubby and never advertises setup.

Managers on HQ retain read access and held messages for existing legacy threads. On project floors they are watch-only, like other coworkers. Feedback, verdicts and Pass on use the same owner-account check as `hq.talk`. Legacy held messages are resolved to the linked main lead for their original project floor; if no matching lead is linked or the Mac is offline, they stay waiting. Old browser keys, pinned-device files and waiting-device files are ignored. Device enrollment and per-floor setup are removed.

## Live helpers, tasks and needs

The local connector reads AgentHarness presence records from `~/Library/Application Support/AgentHarness/runs`. A record counts only while its process is alive and its folder is an exact Git worktree root of the selected project in cubby mode, or of each visible registered local project in link mode. A cleaned optional `lead` identifies the registered CEO or department lead. Missing or unknown lead IDs fall back to that project's CEO desk; workers without a matching lead or project desk do not appear on HQ. Presence status and last-tool summaries provide worker progress; they never infer lead activity. Mac-linked lead plates use the hook activity described below, falling back to registry status.

HQ helpers use the owner's trim and carry smaller task-title plates overhead. CEO helpers stand beside their desk and department helpers behind their lead. Helper plates hide where their projected screen boxes overlap an HQ status card or lead plate, and return when the view clears. Close-up HQ plates are capped at 1.3 times their projected size at 3 m, with an additional phone-width fit. Legacy cubby desks show up to three helpers and a “+N” label for overflow. Linked leads show each live helper beside its desk. A helper appears at most once per floor: at its HQ desk on HQ, and beside its linked lead on the project floor (legacy cubby helpers retain their cubby representation). Task boards show live worker titles, providers and branch short names, newest first, up to five rows plus “+N more”. E opens the same rows in a readable window.

The connector also reads `~/Library/Application Support/AgentHarness/needs.json`, a read-only publication of the AgentHarness health check, limited to 64 KB. It matches project paths as the lead registry does and never opens the publication's source files or other repositories' Markdown. Missing data adds nothing; malformed data adds nothing and reports a quiet connector error. An unknown count stays unknown. The Office never interprets these lines as approval.

A positive project needs count raises only its CEO's hand, lights the desk, and adds a Needs you count alongside any existing cubby needs. Department leads do not inherit a project-wide hand. When the publication is older than its stated freshness interval, the hand remains raised but dimmed, and the count says “stale · as of” with the observation time. The owner can read the first line by aiming at the HQ lead or status card, and the published lines by pressing E. Managers receive only the count and age; needs lines are removed on the server before sending their HQ view.

These signals also appear on the linked project floor and through the HQ entry in `/lite`, beside My cubby. Only the HQ owner and allowed managers receive this additional data. There are no phone push alerts. Ordinary cubby sharing stays unchanged.

When an already-linked project floor detects a merged PR, its existing merge gong event also rings HQ's gong and shows “<Project>: PR #N merged” to current HQ viewers. Each PR rings once; HQ adds no GitHub polling.
