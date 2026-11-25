# Satellites and CI evidence

## Satellite presence

`agent-office join <office-url>` reports a registered machine’s connectivity and installed agent CLIs. Without `--cubbies`, it does not inspect local workspaces, sessions or transcripts, or dispatch local agents. Installed CLIs do not prove sign-in or subscription readiness.

### Existing Cloudflare Access login

For an office behind Cloudflare Access, first authenticate through the existing account and application policy:

```sh
cloudflared access login --quiet https://office.example
agent-office join https://office.example --cloudflare-access
```

The foreground client reads the application-specific cache through `cloudflared access token --app`, captures the result in memory, and sends it as `CF-Access-Token` with the node credential in the Authorization header. It does not log either credential, follow WebSocket redirects, invoke login itself or silently rotate credentials. The existing node invite is still required; Access authentication does not create an Office browser session or execution capability. The Access token's expiry ends the connection visibly; repeat the normal login and restart join. No public bypass, service credential or policy change is introduced.

An Office restart, connection failure or temporary handshake failure retries with the same in-memory credentials after 1, 2, 4, 8, 16, then at most 30 seconds between attempts. A successful connection resets the delay. Retryable HTTP responses are 500, 502, 503 and 504, plus Cloudflare's origin failure/unavailable/timeout responses 520–524. These responses do not establish that authentication expired. HTTP 401/403 and all redirects stop with an authorization/redirect diagnostic; other HTTP failures stop for configuration review. Redirect destinations and response bodies are never logged or followed. Ctrl-C stops an open connection, pending handshake or reconnect wait. Credential expiry still stops retries and requires normal login; the client never reads a replacement token automatically.

This is an interactive user CLI connection, not an unattended service authentication solution. Cloudflare validates the application's token at the edge; the client's expiry parsing is only a stop timer. See [Cloudflare's CLI authentication documentation](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/). The bridge does not bypass or alter any Access policies.

## Private cubbies (preview)

This opt-in module is disabled unless the Office server starts with `AGENT_OFFICE_CUBBIES=1`. It adds a separate owner-chat and presence path to Satellites; ordinary `join` remains presence-only. Each cubby belongs to one Office account, one computer and one floor. Unless the owner explicitly admits them to watch, coworkers, including other admins, receive only its owner name, status lamp and working count. Its underlying Satellite record is owner-only too. Only one unconnected setup may be reserved per owner per floor; connect it before claiming another computer. Revoked accounts leave a visibly occupied “Former account” room, never a falsely free slot. Unadmitted coworkers do not receive the lead name, computer name, roster, plan, decisions or chat. The server supports explicit watching and task transfer as described under Sharing below. Draft floors and kickoff are described below.

The owner uses **Set up** at a free cubby, names and styles its lead, and runs the displayed connection command on their computer. The local project path stays on that computer. The computer opens the outbound connection; Office does not open a port or reach into it. Existing Cloudflare Access login applies unchanged. Cubby chat requires HTTPS, except for loopback development on the same computer. If the setup token is lost, stop the local connection and press E at your offline cubby’s door to use Set up again; the old token is revoked and the room remains bound to the same computer.

```sh
agent-office join https://office.example --token '<private invitation>' \
  --cubbies --floor '<floor id>' --project '/local/project' \
  --owner-key '<base64url P-256 SPKI public key from this browser>' [--lead-bridge]
```

The local registry in `~/Documents/AgentHarness/projects.json`, when present, selects the existing project lead. Archived entries and conflicting session selections are rejected. On another computer, select the existing native session locally with `--lead-provider claude --lead-session '<UUID>'`; use `--lead-profile personal` or `phase-one` for an existing Claude profile. A new lead requires the local `--new-lead` option and no conflicting registered lead. Office cannot select executable names, profiles, paths, models or permissions remotely. Provider API routing from the parent shell is stripped; native subscription configuration remains local.

**Talking to a lead that's already running (`--lead-bridge`).** When the project's lead is a session already open on the computer (for example a Claude app session), add `--lead-bridge`. The connector never starts a second lead. After checking the owner signature, it writes each message to this computer's own inbox (mode 0600, under `~/.agent-office/cubbies/<project hash>/bridge/`). The lead session keeps `agent-office cubby wait --project <path>` running in the background. That command prints the message and exits, and the lead answers with `agent-office cubby reply --project <path> --id <request id> --text '…'`. If no lead has been listening for the last minute, the owner gets a notice straight away and nothing is queued. An unanswered message is withdrawn after ten minutes. The lead keeps its own rules and permission prompts, and the bridge runs no commands and opens no files.

Without `--lead-bridge`, the guarded Claude path resumes the exact existing session only when it is not open elsewhere, and it reports native approval refusals for review locally. Codex desktop chat has no supported connection and is refused instead of starting a second lead.

**Roles and the wake summary.** Workers started by AgentHarness (`agent-worker --role … --title …`, `factory-run`) each leave a presence record in `~/Library/Application Support/AgentHarness/runs/`. The connector reads only the live ones for this project's worktrees. Builders and designers sit at the builders' desk, reviewers and researchers (or anything read-only) take the bean bag, factory runs get the machine, and the card shows their task title. The lead's own session shows as the room's lead. When the computer has been away for more than two minutes, the first snapshot after it reconnects carries a one-line summary for the owner's chat: what finished, what started, what needs them and how many commits landed on the project branch. It's worked out from the roster and Git, never from transcripts.

**Owner-held chat keys (Jonathan's accepted decision, 2026-11-24).** Setup/chat creates an ECDSA P-256 key in the owner's browser with WebCrypto. Its private key is non-extractable and stored in IndexedDB per Office origin and named sign-in account. Only the public SPKI key appears in the join command. `--cubbies` requires `--owner-key`; the computer pins that locally supplied key in a mode-0600 `owner-<floor hash>.json` record under `~/.agent-office/cubbies/<project hash>/`. The record includes a SHA-256 fingerprint (first 128 bits), shown in the setup window for comparison. Server frames can never install or replace a pin.

A different key on a later join is refused. To change browser/device, stop join on the computer, use **Set up** at your offline cubby from the new browser, compare fingerprints, and run its command locally with `--replace-owner-key`. The old browser then loses chat access. Clearing site data or losing that browser profile also requires this local re-pin; private keys are never exported or synchronized. The chat window explains a missing/mismatched pin and disables sending. The computer reports its public fingerprint for that display only; it independently verifies every message against the actual local pin.

The browser generates the request ID and millisecond timestamp, then signs UTF-8 JSON of `["agent-office/cubby-owner-chat/v1", cubbyId, floorId, computerId, requestId, at, text]` with ECDSA/SHA-256 (64-byte P1363 signature, base64url). Office relays the text, ID, timestamp and signature unchanged. The existing HMAC still binds the transport to the Satellite, account and connection, but knowing that HMAC key is insufficient to mint an accepted chat. The connector checks the owner signature before dispatch, rejects missing/invalid signatures with “Message not signed by this cubby's owner key”, requires clocks within ±60 seconds, and remembers request IDs across reconnects for the lifetime of join. No command, file, terminal-input or approval frame is supported.

This prevents a compromised relay from forging prompts without the browser key. It is signing, not encryption: Office still sees chat and can withhold it. The browser application and device must remain trusted; malicious same-origin JavaScript (including altered client code served by a compromised Office host) can use a non-extractable key to sign without exporting it. This browser design does not claim protection against that separate compromise. The Office server retains at most 40 chat lines in memory and writes no conversation files; native CLI history remains on the owner's computer.

Presence is limited to the selected Git project and actual worktrees. Direct sessions expose tool, branch and an explicitly unknown busy state when it cannot be verified, never their prompts or conversations. Factory and Paradev metadata is bounded and source failures are visible. Explicit local plan/Needs-you text may be published through `.agent-office/cubby.json`; arbitrary project documents are not collected. Installed CLIs do not establish that a subscription is ready.

Ctrl-C stops the connector and closes the chat path. It cancels only a native turn the connector itself owns, never another open lead. A clean disconnect greys the lamp immediately; an abrupt network loss or sleep is detected by the normal Satellite heartbeat timeout. Reconnection does not replay old messages or move work to the Office server. Turning the server flag off disables the module without deleting account credentials or native histories.

The relay is a narrow extension of existing Office protocols. Alternatives reviewed were [Happy](https://github.com/slopus/happy), a broader mobile/remote agent app, and the official [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Neither was installed; the implementation reuses the existing WebSocket transport and locally selected native CLI.

**Sharing and the phone (cubbies step 4).** E at someone else's frosted door knocks; the hint shows “Knocked, waiting for <name>…”. The owner, wherever they are on the floor, gets a prompt with **Let in** and **Not now** (✕ and Esc are Not now). A watcher the owner lets in sees the door open and the inside as the owner does, read-only: the lead chat shows its lines with no box to type in, and E at the door leaves. The owner's lead chat lists who's watching, each with a ✕ that sends them out. Inside your own cubby, **Q** opens **Send a task to the floor** (a title up to 120 characters and a prompt up to 4,000): it goes to the floor's public Task queue, where office-server agents take it, and your computer's work stays where it is. On the 2D view (`/lite`), **My cubby** appears when you have a cubby on that floor and opens the same lead chat, Needs you and helper status; someone watching gets the read-only version there, and draft floors show in their owner's floor list tagged “draft”. Chat from the phone is signed with that browser's own owner key, so it sends only from the browser whose key the computer pinned (see the re-pin steps above).

## Draft floors (preview)

With `AGENT_OFFICE_CUBBIES=1`, set `AGENT_OFFICE_PROJECT_STARTERS=Jonathan` to allow that account to use **New project**. This is a comma-separated list of account names, matched case-insensitively; unset, empty, and shared-password guests allow nobody. Each draft is a local Git repository on `main` with one empty commit, under `<dataDir>/drafts/<id>`. It has no remote. Ownership and names are saved in `drafts.json` with mode `0600`; the Building registers it through `addLocal`, without cloning or replacing the office's own local floor.

Only the owner sees the draft in the elevator, welcome or floor view. Other accounts (including admins) cannot ride there, arrive with `?floor=`, remove it or fetch its project files. Private locations are removed from the people list, and draft checkouts are excluded from the shared hygiene report. Turning the cubbies flag off keeps saved drafts closed and invisible. Server workers, board agents, meetings and queue hiring stay idle on drafts; work runs on the owner's computer.

Press **E** at the studio table to use the existing cubby setup flow, slot `0`. A draft has exactly one cubby, its owner's. Publish the boards from the connected project's local `.agent-office/draft.json`:

```json
{
  "decisions": ["Keep the first release small"],
  "plan": ["Review the first screen"],
  "screens": [{ "title": "Welcome", "status": "review" }],
  "brand": { "name": "Project", "tagline": "A short promise", "colors": ["#336699"] }
}
```

The connector reads only this explicit JSON file, at most 64 KiB, without following symlinks. Decisions and plan have at most 16 lines of 300 characters each; screens have at most 24 titles of 120 characters and status `sketch`, `review` or `approved`. Brand name and tagline are optional (80 and 200 characters); colors are at most six `#rrggbb` values. Text is cleaned to single lines and unknown fields are discarded. The server validates the same limits and keeps the last boards only in memory, visible only to the owner, including while the computer sleeps. Restarting the Office clears them until the connector republishes. Harness agents with role `designer` keep their builder seat and publish the designer marker used by the draft view.

### Kickoff

The draft's owner confirms its name again (trimmed, case-insensitive). Configure one of these server environment variables before starting the Office:

- `AGENT_OFFICE_KICKOFF_REMOTE=/absolute/folder`: local mode creates `<folder>/<slug>.git` with `git init --bare`, adds `origin`, and pushes `main`. Existing destinations are refused and left intact. Use this mode for tests and local acceptance; it does not contact GitHub.
- `AGENT_OFFICE_KICKOFF_ORG=PhaseOneVenturesAI`: real org mode runs `gh repo create <org>/<slug> --private --source . --push` in the draft checkout, using the server's GitHub CLI sign-in. **This creates a private GitHub repository.** The local setting takes precedence when both are set. Invalid settings fail closed; neither set means `canKickoff: false` and a polite refusal with no changes.

Kickoff snapshots the cubby's last boards, including those retained while its computer sleeps. It writes plain, bounded Markdown into the existing `<dataDir>/drafts/<id>` checkout: `README.md` (project name and tagline), `docs/BRIEF.md` (decisions), `docs/PLAN.md` (plan), `docs/SCREENS.md` (all screen titles and statuses, approved first), and `docs/BRAND.md` (brand name, tagline, colors). These five fixed paths are committed as Agent Office with hooks and commit signing disabled; board text never becomes a command or path. The checkout must be clean on `main` with no existing remotes. Concurrent kickoff attempts are refused.

After the push and persistence succeed, the same floor becomes public, everyone receives the opening announcement, and its gong rings. Its elevator entry wears **New** for three days. `drafts.json` retains the kickoff timestamp, brand and approved screen titles for everyone's Design book and brand poster. The owner's slot-0 cubby keeps its identity and setup in the hall; its interior remains private to its owner and explicitly admitted watchers. A failed kickoff leaves the floor private, restores its previous files and commit, and removes any local bare repository made by that attempt. Org-mode failures do not delete GitHub repositories: if GitHub created one before a later failure, an operator must inspect it before retrying.

## Sharing (step 4)

Still behind `AGENT_OFFICE_CUBBIES=1`, the server accepts `cubbies.knock` from a signed-in account on an online cubby's floor, except its owner. The owner receives `cubbies.knocked` (including in their other browser tabs) and an owner-only `knocking` list. Each account can knock on each cubby at most once per 30 seconds, including across tabs and reconnects. A pending knock cannot be repeated until answered or expired. There are at most eight pending knocks per cubby, and each expires after two minutes.

The owner, on that floor, answers with `cubbies.admit`: `allow: true` admits the requesting browser connection; `allow: false` refuses its knock or sends that account's watchers out. The affected connection receives `cubbies.answer`. An admitted connection gets `watching: true` and the live interior, including the lead's chat, roster, plan and Needs you. Pairing computer IDs, owner-key fingerprints, watcher lists and pending knocks stay owner-only. Other tabs and reconnected browsers must knock separately. Admins have no bypass. Watching grants no permission to chat with the lead, change someone else's setup, approve anything or send their tasks.

`cubbies.leave`, leaving the floor, browser disconnect, account loss, owner dismissal, and the computer sleeping or going offline end watching. Pending knocks also clear on exit or disconnect. Watching does not return automatically on wake. Grants and knocks live only in server memory and never enter `cubbies.json`; the existing bounded chat tail stays in memory too.

Only the owner on their cubby's floor can use `cubbies.sendTask`. It requires a nonblank title of at most 120 characters and a prompt of at most 4,000 characters; the normal queue also rejects an empty prompt. It reuses `queue.add`'s personal provider sign-in checks, queue validation, owner attribution and normal office-server scheduling. `cubbies.taskSent` acknowledges successful insertion only. Owners can explicitly send a task while their computer sleeps; sleep, reconnects, snapshots and chat never transfer work automatically. Private drafts refuse server tasks until kickoff, preserving their existing local-only execution rule.

The `/lite?…` browser's `lite=1` WebSocket uses the existing welcome and floor-entry paths. Those already include the same per-account `cubbies` and `drafts` pieces as 3D; ongoing messages use those same views. The owner receives their interior and draft boards, and other accounts never receive private drafts. This server step adds no client controls.

Server verification: `tests/cubby-sharing.test.ts` exercises socket dispatch, admission and revocation, session cleanup, limits and expiry, admin restrictions, task queue attribution and delayed sign-in checks, and lite welcome/floor-entry/update privacy. Built on `feat/cubby-sharing-server-20261125` from `47d5cb0`; client integration and visual acceptance remain with the lead. No release or deployment is part of this step. Worker verification (2026-11-25): all 15 sharing tests, typecheck, build, the source-size guard and docs check passed. The full suite passed 894 of 896 tests; the two clone-recovery failures also reproduce on untouched base `47d5cb0` because this execution environment denies the `ps` lookup used to adopt a running clone. The lead must rerun that suite with normal process inspection before integration.

## Existing CI runs, one watcher

Open **CI evidence** in a PR or a queue record with an associated PR, in either the 3D office or lite view. The server takes the repository and exact head SHA from the existing PR board; it does not accept a browser-supplied repository or command. A changed head requires reopening the panel.

The panel reads existing GitHub Actions run metadata. It retains run ID, attempt, status, conclusion and link, and filters out runs whose reported head differs. A matching Actions head does **not** attest a custom checkout, PR merge checkout, runtime inputs, environment or target. Configuration association therefore remains **incomplete**. No result is advertised as candidate verification or release, and no equivalence is inferred between different runs/configurations.

Concurrent readers of the same repository and exact source SHA reuse one request and a one-minute cooldown. **Watch this run** atomically assigns one browser session to that exact run and attempt. Another viewer reuses its result. The lease lasts 150 seconds and is renewed by the open panel every 30 seconds. Only its owner can renew/release it; expiry, floor exit, browser disconnect or closing the panel releases ownership. A rerun's new attempt is a different identity. Completed runs end their watch and remain available as evidence; the owner receives a completion toast.

Only watched runs keep the shared one-minute poller active. Evidence and leases are in-memory metadata attached to existing PRs, not a new task backlog, and reset on server restart. GitHub read errors retain earlier evidence with a visible error and original read time. The server's existing `gh` account needs Actions read access. No logs or artifact bodies are fetched.

There are no dispatch, retry, cancellation, merge or deploy controls here. The controls coordinate readers inside this Office process; they cannot prevent independent agents or other Office instances from launching CI. Project pre-merge and exact-commit release gates still apply.
