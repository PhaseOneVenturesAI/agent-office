# Satellites and CI evidence

## Whole-Mac HQ connection

Owners connect their Mac with `agent-office link <office-url>`, open the printed approval link while signed in as the HQ owner, and choose Approve. The harness LaunchAgent uses `link <office-url> --run` with the saved private token. One link publishes up to 12 visible local projects and 64 scoped live workers, registry-based lead statuses, needs, pitches and draft boards; hidden, archived and remote-only projects are excluded. Managers cannot approve or revoke links. Fresh link snapshots take priority over cubby snapshots. See [Mac linking and privacy](hq.md#link-your-mac).

## Satellite presence

`agent-office join <office-url>` reports a registered machine’s connectivity and installed agent CLIs. This ordinary satellite join stays supported because the Satellites wall still uses it. It does not inspect local workspaces, sessions or transcripts, or dispatch local agents. Installed CLIs do not prove sign-in or subscription readiness.

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

Saved cubby colours and stable account defaults remain. Personal people wear CEO, Marketing, Design or Product clothes from the roster’s department, lead title or harness role; unrecognised roles use a plain owner-colour top, and an unspecified main lead uses CEO clothes. The owner colour covers the main garment: CEO blazer (cream shirt, dark tie and lapels), Marketing hoodie (hood and megaphone), Design smock (cream beret), or Product top (cream chest band and clipboard). A flat, softly emissive owner-colour floor ring marks each personal person (0.9 m across) and helper bot (0.7 m), including seated agents. Codex and Kimi helpers have cream bodies (#f4ecdf), owner-colour bands and antenna tips, and small provider-colour chest badges (Codex #4a7dbd; Kimi #3f8f4f). One two-line nameplate combines a bold `<Owner first name>'s · <Project> <Role>` (or `Codex · <task>`) with smaller status text and an owner-colour edge. The lead's second line includes `E to talk · <computer>`, listen-in, sleep or error status; there is no separate floating computer/status pill. Helper plates appear only for the helper aimed at or standing nearby; while reading a helper, the lead plate gives way so the two cannot overlap. Draft leads use the same outfit and colour. Office agents and owner-only control rules are unchanged. The palette is Violet #5b3cc4, Teal #0f7a6b, Red #c0283f, Orange #c2560f, Blue #1e40c8, Green #2e7d3a, Pink #b8327a and Slate #414c60. Saved older colours map to the same named swatch. Every swatch keeps at least 3:1 contrast against the office cream #f4ecdf, the usual minimum for graphics; Blue is Jonathan's cobalt #1e40c8.


With `AGENT_OFFICE_CUBBIES=1`, existing cubby rooms remain available as visual homes. New local agents connect with `agent-office link <url>`, without per-floor setup. Linked leads appear on HQ and their project floor at the same time. Coworkers see names, status and helper titles, never conversation text; no Talk, Knock or held-message action is available to them. A manager visiting a project floor is also watch-only. HQ managers keep their read and held-message behavior on HQ.

`join --cubbies`, `join --hq`, `--lead-bridge`, and `cubby wait`, `cubby reply` and `cubby devices` exit nonzero with `removed: use agent-office link <url>`. Old setup and device-enrollment browser requests receive a migration notice and create no token or device. The HQ floor has no cubby. Ordinary satellites, office agents, queue tasks, meetings, shared workers and pitch rooms remain.

The legacy signed connector, browser signing key, pinned-device storage and lock remain temporarily: draft-board feedback and pitch verdicts still depend on them. Existing saved rooms/pins remain readable, and the Mac link does not load old device files. No trust check was weakened. Device enrollment UI and its CLI are gone. Migrating those remaining feedback paths is required before deleting their key/connector dependency chain.

Existing non-HQ-owner cubby sharing and owner task transfer remain compatible. Old sharing grants never expose the HQ owner's conversation on project floors. Linked-lead conversations use the signed-in owner identity through the Mac link.

**Cubby hall at night and roomier cubbies (2026-11-26).** The hall's lamps follow the office's own interior lights through day and night, and dim with the rest of a draft floor. At night the corridor reads as night: its pendants glow low, the room's fill drops to about an eighth while you stand in it, and the cubbies' desk lamps and windows do most of the work. By day nothing changes. While the hall is open, its box counts as indoors for the sky, so night shading, rain and snow stay outside. Each cubby is 4 m deep (the hall's outer wall is at x −25; the corridor is still 2.4 m), with a window in the west wall and a desk lamp. Each slot also gets its own arrangement of rug, plant, books, mug and print. Trees and holiday props that the open hall would overlap step west while it's open and go back when it shuts. A floor without cubbies is unchanged.

## Draft floors (preview)

With `AGENT_OFFICE_CUBBIES=1`, set `AGENT_OFFICE_PROJECT_STARTERS=Jonathan` to allow that account to use **New project**. This is a comma-separated list of account names, matched case-insensitively; unset, empty, and shared-password guests allow nobody. Each draft is a local Git repository on `main` with one empty commit, under `<dataDir>/drafts/<id>`. It has no remote. Ownership and names are saved in `drafts.json` with mode `0600`; the Building registers it through `addLocal`, without cloning or replacing the office's own local floor.

Only the owner sees the draft in the elevator, welcome or floor view. Other accounts (including admins) cannot ride there, arrive with `?floor=`, remove it or fetch its project files. Private locations are removed from the people list, and draft checkouts are excluded from the shared hygiene report. Turning the cubbies flag off keeps saved drafts closed and invisible. Server workers, board agents, meetings and queue hiring stay idle on drafts; work runs on the owner's computer.

After **New project** creates the draft, the server announces `drafts.made` without moving you. The 3D client rides the elevator and requests `floor.go`, which checks that the floor is visible to you before arrival. If you arrive some other way before the ride's delayed steps run, those steps stop, so the view doesn't go dark.

The old Studio table setup entry now shows a migration notice. Phase 4 owns its replacement; this cleanup does not change Studio or the VPS draft checkout. Existing draft rooms and boards remain readable. Publish boards from the connected project's local `.agent-office/draft.json`:

```json
{
  "decisions": ["Keep the first release small"],
  "plan": ["Review the first screen"],
  "ideas": [{ "id": "first-visit", "title": "A calm first visit", "note": "One clear next step", "image": "design/idea.png" }],
  "screens": [{ "id": "welcome", "title": "Welcome", "status": "review", "note": "Review the main action", "image": "design/welcome.webp" }],
  "brand": { "name": "Project", "tagline": "A short promise", "colors": ["#336699"] }
}
```

The connector reads this explicit JSON file (at most 64 KiB) without following symlinks. Decisions and plan have at most 16 lines of 300 characters each. Ideas have at most 16 cards; screens have at most 24 with status `sketch`, `review` or `approved`. Each card has a title (120 characters), optional note (400 characters), and a stable `id` of up to 64 letters, digits, underscores or hyphens. Omitted IDs are derived from titles; supply IDs to preserve feedback when renaming a card. Brand name and tagline are optional (80 and 200 characters); colors are at most six `#rrggbb` values. Text is cleaned and unknown fields are discarded. Harness agents with role `designer` keep their builder seat and publish the designer marker used by the draft view.

Place design files in `<project>/.agent-office/design/` and reference them as `"image": "design/<file>"`. Only regular files beneath that folder are read: no symlinked files or folders, traversal paths or files larger than 2 MiB or images above 16 million pixels. Oversize images show as text cards. Up to 16 images are published per board. The file contents determine the type, regardless of extension: PNG, JPEG and still WebP are supported. The connector strips PNG ancillary metadata, JPEG APP1–APP15 and comments, and WebP EXIF, XMP and ICC profiles before calculating the SHA-256 hash and dimensions. Paths and original image bytes stay on the computer. Cleaned images travel in ordered chunks of at most 48 KiB of base64, retrying transport backpressure, and resend on reconnect or when removed bytes are referenced again.

The office keeps boards and images in private memory only, including while the computer sleeps. Images are served only to the signed-in draft owner at `/api/drafts/<floorId>/images/<hash>` with `private, no-store`, `nosniff` and a restrictive content policy. Other accounts receive the same 404 as a missing image. Images disappear when removed from the latest board, when the cubby or floor is removed, or after successful kickoff. Restarting the office clears them until the connector republishes.

### Card feedback

The owner's device signs a note on an idea or screen card using its trusted owner key. The office relays it only to that draft's online computer. The computer verifies against all locally trusted devices, requires a timestamp within 60 seconds, rejects replays, and checks the card still exists in the current local board. Invalid signatures change nothing and produce a chat notice. Feedback never approves tools or changes local permissions.

Accepted notes are written atomically with mode `0600` to `.agent-office/feedback.json`, shaped as `{ "<card-id>": [{ "id": "<request-id>", "text": "...", "at": 1800000000000 }] }`. Each card retains its latest 20 notes, each at most 1,000 characters. This file merges into the published boards.

Across all idea and screen cards, feedback has a 16 KiB budget: the UTF-8 bytes of JSON-escaped note text plus 192 bytes per note for its maximum-length ID, timestamp and JSON envelope. The computer checks the existing total plus the incoming note before any write (including before the existing per-card retention step). A note that would exceed the budget changes no file and sends the owner’s chat: “The board's feedback is full. Moving or resolving notes on your computer frees room.” The office uses the same notice to refuse early when its current board is already at the budget. Move notes off the published board or resolve/remove them locally to free room; moving between cards on that same board does not reduce the total.

If the lead is idle, it also receives `Feedback on <card title>: <text>` as a chat turn; a busy lead leaves the saved note for later. The owner's chat receives a notice either way.

The 64 KiB snapshot frame limit still applies to the complete board and roster. The aggregate budget leaves room for all 16 ideas and 24 screens with maximum ASCII board text, 16 image references, and full cubby plan/Needs-you lists. It bounds the total note count as well as text: it cannot permit 800 maximum-ID notes at once. Maximum Unicode/escaped board text, a large roster, manually edited feedback or older oversized records can still exceed the frame cap. In that case the connector sends a small snapshot with “The board is too big to show; it is still saved on your computer” and a fresh roster (bounded separately if necessary), instead of dropping publication. Device presence continues. The office retains its last complete board and images while showing the error; after local cleanup, the complete board publishes again. Feedback is never trimmed to fit a snapshot. Kickoff continues exporting every note in the office’s last complete board; unpublishable local edits have not reached that snapshot.

### Design board (cubbies step 5)

On the owner's draft the north wall keeps **📝 Decisions**, **🗺️ Plan** and **🖼️ Screens**, and a **💡 Ideas** board covers the Services board on the east wall, beside the **🎨 Brand wall**. Ideas and Screens show cards three across and two down: each card's design image as a thumbnail (or its words when it has none, or its image won't load), its title, a screen's status chip and a 💬 count once it has feedback. With more than six, the last place says “+N more” and opens the first card that didn't fit; ‹ › in the card window step through the whole board.

Aim at a card and the hint says **[E] Open <title>**. The card window shows the image large, the title, status and note, and every feedback note, newest last, with its time. Type in the box and press **Send feedback** or Enter (Shift+Enter is a new line). The note is signed with this browser's owner key over `["agent-office/cubby-owner-feedback/v1", cubbyId, floorId, computerId, requestId, at, cardId, text]`, the same way as chat. It shows as “Sending…” until the computer reports it back in the boards, and says so if the computer doesn't within 20 seconds. With the computer asleep, the box is shut. Legacy feedback still requires an already trusted browser; device enrollment has been removed pending the feedback migration. ✕ or Esc goes straight back to mouse-look.

On `/lite`, **🧩 Draft board** appears on your own draft floor. It lists the ideas and screens with their thumbnails, and tapping one opens the same card window, feedback included.

The page loads each image from `/api/drafts/<floorId>/images/<hash>` with its own session cookie, checks the 16-million-pixel limit before fetching, and keeps at most 24 decoded bitmaps by floor and hash in a least-recently-used cache. Eviction closes the bitmap; removing a card, leaving a draft or kicking it off closes its cached images and cancels pending loads. Images exist only on the owner's page and are never sent over the socket. `tests/design-board-ui.mjs` covers the wall, the card window, signing and the phone, using generated PNGs and no server.

### Kickoff

The draft's owner confirms its name again (trimmed, case-insensitive). Configure one of these server environment variables before starting the Office:

- `AGENT_OFFICE_KICKOFF_REMOTE=/absolute/folder`: local mode creates `<folder>/<slug>.git` with `git init --bare`, adds `origin`, and pushes `main`. Existing destinations are refused and left intact. Use this mode for tests and local acceptance; it does not contact GitHub.
- `AGENT_OFFICE_KICKOFF_ORG=PhaseOneVenturesAI`: real org mode runs `gh repo create <org>/<slug> --private --source . --push` in the draft checkout, using the server's GitHub CLI sign-in. **This creates a private GitHub repository.** The local setting takes precedence when both are set. Invalid settings fail closed; neither set means `canKickoff: false` and a polite refusal with no changes.

Kickoff snapshots the cubby's last boards and available images, including those retained while its computer sleeps. It writes these files in the existing `<dataDir>/drafts/<id>` checkout:

- `README.md`: project name and tagline.
- `docs/BRIEF.md`: decisions and idea cards with notes.
- `docs/PLAN.md`: the plan.
- `docs/FEEDBACK.md`: feedback on every idea and screen card.
- `design/system.md` and `design/tokens.json`: brand name, tagline and color tokens.
- `design/SCREENS.md`: every screen's status and note, approved first, with links to exported images.
- `design/screens/<card-id>.<png|jpg|webp>`: cleaned bytes for each approved screen whose image is available in office memory. Unapproved screens and missing images produce no image file.

These explicit paths are committed as Agent Office with hooks and commit signing disabled. Only validated card IDs become image filenames; board text never becomes a command. The transaction accepts binary files and refuses symlinked or non-directory parents and aliased files. The checkout must be clean on `main` with no existing remotes. Concurrent kickoff attempts are refused. A failure restores previous bytes, modes, Git state and newly created folders exactly; it keeps draft images available for retry. Successful kickoff drops the draft's image memory, and the public floor serves no draft image URLs.

After the push and persistence succeed, the same floor becomes public, everyone receives the opening announcement, and its gong rings. Its elevator entry wears **New** for three days. `drafts.json` retains the kickoff timestamp, brand and approved screen titles for everyone's Design book and brand poster. The owner's slot-0 cubby keeps its identity and setup in the hall; its interior remains private to its owner and explicitly admitted watchers. A failed kickoff leaves the floor private, restores its previous files and commit, and removes any local bare repository made by that attempt. Org-mode failures do not delete GitHub repositories: if GitHub created one before a later failure, an operator must inspect it before retrying.

## Sharing (step 4)

For legacy rooms not owned by the configured HQ owner, behind `AGENT_OFFICE_CUBBIES=1`, the server accepts `cubbies.knock` from a signed-in account on an online cubby's floor, except its owner. The owner receives `cubbies.knocked` (including in their other browser tabs) and an owner-only `knocking` list. Each account can knock on each cubby at most once per 30 seconds, including across tabs and reconnects. A pending knock cannot be repeated until answered or expired. There are at most eight pending knocks per cubby, and each expires after two minutes.

The owner, on that floor, answers with `cubbies.admit`: `allow: true` admits the requesting browser connection; `allow: false` refuses its knock or sends that account's watchers out. The affected connection receives `cubbies.answer`. An admitted connection gets `watching: true` and the live interior, including the lead's chat, roster, plan and Needs you. Pairing computer IDs, trusted devices and device requests, watcher lists and pending knocks stay owner-only. Other tabs and reconnected browsers must knock separately. Admins have no bypass. Watching grants no permission to chat with the lead, change someone else's setup, approve anything or send their tasks.

`cubbies.leave`, leaving the floor, browser disconnect, account loss, owner dismissal, and the computer sleeping or going offline end watching. Pending knocks also clear on exit or disconnect. Watching does not return automatically on wake. Grants and knocks live only in server memory and never enter `cubbies.json`; the existing bounded chat tail stays in memory too.

Only the owner on their cubby's floor can use `cubbies.sendTask`. It requires a nonblank title of at most 120 characters and a prompt of at most 4,000 characters; the normal queue also rejects an empty prompt. It reuses `queue.add`'s personal provider sign-in checks, queue validation, owner attribution and normal office-server scheduling. `cubbies.taskSent` acknowledges successful insertion only. Owners can explicitly send a task while their computer sleeps; sleep, reconnects, snapshots and chat never transfer work automatically. Private drafts refuse server tasks until kickoff, preserving their existing local-only execution rule.

The `/lite?…` browser's `lite=1` WebSocket uses the existing welcome and floor-entry paths. Those already include the same per-account `cubbies` and `drafts` pieces as 3D; ongoing messages use those same views. The owner receives their interior and draft boards, and other accounts never receive private drafts. This server step adds no client controls.

Server verification: `tests/cubby-sharing.test.ts` exercises socket dispatch, admission and revocation, session cleanup, limits and expiry, admin restrictions, task queue attribution and delayed sign-in checks, and lite welcome/floor-entry/update privacy. PR #96 review fixes (2026-11-25), owned by the bounded Codex worker on `feat/cubbies-step-four-sharing-20261125` from `0f756f5`, add seven regressions for cross-process device revocation, lock recovery/contention, signer rechecks, per-account request throttling, and signed-send backpressure/retry. Typecheck, client build with `--configLoader runner`, server build, both cubby browser scripts (zero page errors), source-size guard and docs check pass. The full suite passes 916 of 918 tests; the two clone-recovery failures also reproduce on untouched base `0f756f5` because this sandbox denies the `ps` lookup used to adopt a running clone. Evidence is in `.agent-office/review-fixes/` in this worktree. Next: the lead reviews and reruns the full suite with normal process inspection before integration. No push, merge, release or deployment is part of this worker task.

## Existing CI runs, one watcher

Open **CI evidence** in a PR or a queue record with an associated PR, in either the 3D office or lite view. The server takes the repository and exact head SHA from the existing PR board; it does not accept a browser-supplied repository or command. A changed head requires reopening the panel.

The panel reads existing GitHub Actions run metadata. It retains run ID, attempt, status, conclusion and link, and filters out runs whose reported head differs. A matching Actions head does **not** attest a custom checkout, PR merge checkout, runtime inputs, environment or target. Configuration association therefore remains **incomplete**. No result is advertised as candidate verification or release, and no equivalence is inferred between different runs/configurations.

Concurrent readers of the same repository and exact source SHA reuse one request and a one-minute cooldown. **Watch this run** atomically assigns one browser session to that exact run and attempt. Another viewer reuses its result. The lease lasts 150 seconds and is renewed by the open panel every 30 seconds. Only its owner can renew/release it; expiry, floor exit, browser disconnect or closing the panel releases ownership. A rerun's new attempt is a different identity. Completed runs end their watch and remain available as evidence; the owner receives a completion toast.

Only watched runs keep the shared one-minute poller active. Evidence and leases are in-memory metadata attached to existing PRs, not a new task backlog, and reset on server restart. GitHub read errors retain earlier evidence with a visible error and original read time. The server's existing `gh` account needs Actions read access. No logs or artifact bodies are fetched.

There are no dispatch, retry, cancellation, merge or deploy controls here. The controls coordinate readers inside this Office process; they cannot prevent independent agents or other Office instances from launching CI. Project pre-merge and exact-commit release gates still apply.

## Pitch gallery (step 1)

With `AGENT_OFFICE_CUBBIES=1`, a lead on the owner's connected computer can publish `.agent-office/pitch.json` in the selected project folder. The connector reads this explicit file on its normal snapshot cycle. For example:

```json
{
  "department": "Marketing",
  "lead": "Plimbo Marketing lead",
  "status": "ready",
  "version": "v3",
  "pieces": [
    { "id": "home", "kind": "site", "title": "Home page", "url": "https://example.com/", "image": "pitch/home.png", "notes": ["Review the main promise"] },
    { "id": "video", "kind": "video", "title": "Explainer", "youtube": "dQw4w9WgXcQ", "image": "pitch/poster.png" },
    { "id": "slides", "kind": "slides", "title": "Launch deck", "images": ["pitch/slide-1.png", "pitch/slide-2.png"] },
    { "id": "ads", "kind": "ads", "title": "Ads", "images": ["pitch/ad-1.png", "pitch/ad-2.png"] }
  ]
}
```

The file is limited to 64 KiB. IDs must match `[\w-]{1,64}`; there is at most one piece of each kind, four pieces total, 24 slide images and eight ad images. Images must be PNG, JPEG or WebP under `.agent-office/pitch/`, with regular directories and no symlinks or traversal. The existing design-image checks strip metadata, cap files at 2 MiB and decoded dimensions at 16 megapixels, then transfer cleaned bytes over the same chunked channel. The server announces an image only after its complete hash, format and dimensions have been checked. Pitch images have a 32 MiB cleaned-file byte budget per owner across all their cubbies, including the decoded byte size of in-flight base64 chunks; an image exceeding the budget is omitted while earlier images remain. Pitch rows and images are discarded when their cubby record, account or floor is removed, or their computer is offline or no longer admitted.

On ordinary project floors, only the publishing cubby's owner receives the pitch, image URLs, verdicts and lead replies. An explicitly configured [private HQ](hq.md) also shows the owner's pitch and images to allowed managers on HQ, read-only; lead replies and device fingerprints stay owner-only. Admitted watchers and admins have no extra access. Other accounts' meeting rooms are unchanged. When one owner has multiple publishing computers on a floor, the room shows the pitch from their first publishing cubby in slot order. Images remain scoped to their publishing cubby. A server restart waits for a fresh computer snapshot; verdicts persist on the computer.

`building` puts a status pill beside the meeting-room door. `ready` displays a home-page screenshot on the wall, a video screen, a slide easel and ad cards on the existing table. Entering the room eases down the owner's lighting and brings up up to four warm lights without shadows. The owner’s back-wall board shows the pitch’s building or ready state; other accounts keep the normal meeting board. The door, seats and existing meeting board keep their original interactions. Press **E** on a piece for its large view; slides have previous/next controls. **✕** and **Esc** return to mouse-look. `/lite` lists the same pieces with large views and verdict controls.

**Approve**, **Change…** and **Drop** apply to a piece; one verdict covers the entire ads set. Change requires a note, at most 1,000 characters. The trusted owner device signs the piece ID, pitch version, verdict, note, request ID, timestamp and cubby/computer binding. The connector checks the signature, a ±60-second window and replay IDs before atomically saving a private, bounded `.agent-office/pitch-feedback.json`. The saved rows include the owner signature and all signed fields; every snapshot re-verifies them against the current trusted devices and cubby/floor/computer binding, dropping unsigned or invalid rows. Stamps appear only when the verified saved file comes back in a snapshot. A stamp records the owner’s review only; it is never a merge, publish or spend approval, which still requires an explicit yes from the owner. Increment `version` for a fresh review. An idle lead receives `Pitch verdict on <title> (<version>): Change — <note>`; a busy lead can read the saved file. Pitch replies stay out of the cubby's watcher-visible conversation.

Home-page links accept HTTPS only, without credentials, and open with no opener or referrer. The wall currently uses the published screenshot: arbitrary-site live framing is not enabled. YouTube videos use the existing TV embed/player path only while the owner is inside the ready room; leaving removes the iframe. A video without a YouTube ID keeps its poster and the “▶ opens on your computer” note. A future live-site screen must use `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`, without same-origin, forms, popups or top navigation permissions; an iframe load event alone cannot establish that a site accepted framing.

## v8 phase 5 cleanup handoff

Source: Jonathan’s bounded cleanup brief, 2026-11-27, part 1. Owner: Codex builder. Branch: `feat/v8-cleanup-20261128`, based on `573fd01`; delivery is a local commit only. Phase 4 owns Studio, Open floor, Add your project and the later VPS draft-checkout removal.

- Approved: retire per-floor setup, legacy cubby CLI/bridge and enrollment UI, remove away cards and the HQ cubby, enforce coworker watch-only, preserve office features and managers on HQ.
- Chosen within scope: retain ordinary satellite joins because the Satellites wall depends on them; keep retired wire messages as inert migration notices, `setupAllowed: false`, and the legacy `where: hq` value for old clients. Existing room records remain readable.
- Built: no coworker talk targets, chat windows, knocking or held messages on project floors; server rejection and private-text filtering include visiting managers and old cubby sharing grants. HQ managers keep their existing behavior.
- Verification evidence: `.paradev/cleanup-focused-final.log`, `.paradev/cleanup-tests-final.log`, `.paradev/browser-*.log`, `.paradev/cleanup-browser-talk.log`, and desktop/phone screenshots under `.paradev/shots-*`. Typecheck, Vite runner build and server build pass. The focused suite passes 151 tests. The full suite has two clone-recovery failures also reproduced on untouched `573fd01`; the legacy cubby-sharing browser aiming failure also reproduces on that base. Other requested browser suites pass.
- Next step: lead integration after phase 4, then migrate the remaining signed feedback/thread consumers before deleting their keys and connector. No push, merge or deployment was performed.

## Needs Jonathan

- Dependency conflict from this brief: browser `shared/cubby/keys.ts`, local `devices.ts` and `device-lock.ts`, and the signed connector still serve draft-board feedback, pitch verdict verification and legacy HQ message passing. They were retained with trust checks intact. Their deletion needs the dependent flows migrated first; no authorization model was substituted here.
- The protected Studio table still labels its old action “Set up”; its compatibility seam now only shows the Mac-link migration notice. Phase 4 must replace that caller. Protected Studio/draft/kickoff implementation files and VPS checkouts were not changed.
