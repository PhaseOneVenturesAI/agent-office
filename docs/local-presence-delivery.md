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

Owner device keys, their storage/lock and the old signed connector are removed. All reviews and Pass on use the signed-in HQ owner's account, exactly as `hq.talk` does, over the existing Mac link. Managers and coworkers cannot give feedback or verdicts. Old device files on either computer are ignored, including malformed files; they are not migrated or deleted.

Existing non-HQ-owner cubby sharing and owner task transfer remain compatible. Old sharing grants never expose the HQ owner's conversation on project floors. Linked-lead conversations use the signed-in owner identity through the Mac link.

**Cubby hall at night and roomier cubbies (2026-11-26).** The hall's lamps follow the office's own interior lights through day and night, and dim with the rest of a draft floor. At night the corridor reads as night: its pendants glow low, the room's fill drops to about an eighth while you stand in it, and the cubbies' desk lamps and windows do most of the work. By day nothing changes. While the hall is open, its box counts as indoors for the sky, so night shading, rain and snow stay outside. Each cubby is 4 m deep (the hall's outer wall is at x −25; the corridor is still 2.4 m), with a window in the west wall and a desk lamp. Each slot also gets its own arrangement of rug, plant, books, mug and print. Trees and holiday props that the open hall would overlap step west while it's open and go back when it shuts. A floor without cubbies is unchanged.

## Draft floors (preview)

Use **New project** while signed in through Cloudflare as the HQ owner. The linked Mac creates the checkout and Studio lead; the VPS stores only private floor metadata. `AGENT_OFFICE_PROJECT_STARTERS`, `AGENT_OFFICE_KICKOFF_REMOTE` and `AGENT_OFFICE_KICKOFF_ORG` are inert and named in a startup notice when set. Existing `<dataDir>/drafts/<id>` folders are ignored and each is named in one startup log line for admin cleanup; nothing deletes them automatically. Existing private floor records and public Design books remain readable. At the old Studio table, E says “This draft predates the Mac Studio; start a New project”, with no Set up.

Only the owner sees the draft in the elevator, welcome or floor view. Other accounts (including admins) cannot ride there, arrive with `?floor=`, remove it or fetch its project files. Private locations are removed from the people list, and draft checkouts are excluded from the shared hygiene report. Turning the cubbies flag off keeps saved drafts closed and invisible. Server workers, board agents, meetings and queue hiring stay idle on drafts; work runs on the owner's computer.

After **New project** creates the draft, the server announces `drafts.made` without moving you. The 3D client rides the elevator and requests `floor.go`, which checks that the floor is visible to you before arrival. If you arrive some other way before the ride's delayed steps run, those steps stop, so the view doesn't go dark.

Existing draft rooms and boards remain readable. Studio and Open floor run on the linked Mac. Publish boards from the connected project's local `.agent-office/draft.json`:

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

The signed-in HQ owner sends feedback over the existing `lead.send` relay, with structured review fields. The authenticated Mac link resolves the registered local project, checks that the card still exists, atomically saves `.agent-office/feedback.json` with mode `0600`, then notifies the lead through its normal queue. Managers and coworkers are refused before any frame is sent. No browser key or device approval is involved.

Notes are bounded to 1,000 characters, 20 per card and 16 KiB aggregate feedback. A full board or unsafe file path leaves files unchanged. Persisted request IDs reject duplicates. The board shows saved notes only when the Mac publishes them back; decisions still update when the lead writes the board. A busy lead can read the saved feedback while its notification waits in the ordinary talk queue. Feedback never grants tool permissions, spending or publishing approval.

### Design board (cubbies step 5)

On the owner's draft the north wall keeps **📝 Decisions**, **🗺️ Plan** and **🖼️ Screens**, and a **💡 Ideas** board covers the Services board on the east wall, beside the **🎨 Brand wall**. Ideas and Screens show cards three across and two down: each card's design image as a thumbnail (or its words when it has none, or its image won't load), its title, a screen's status chip and a 💬 count once it has feedback. With more than six, the last place says “+N more” and opens the first card that didn't fit; ‹ › in the card window step through the whole board.

Aim at a card and press **E** for its image, title, status, note and feedback. Studio offers **👍**, **👎**, **Approve** for screens and **Change this…**; older boards have **Send feedback** when their project has a linked lead. The owner account authorizes each review. Saved feedback returns through the Mac snapshot. Offline feedback is disabled. ✕ or Esc returns straight to mouse-look.

On `/lite`, **🧩 Draft board** appears on your own draft floor. It lists the ideas and screens with their thumbnails, and tapping one opens the same card window, feedback included.

The page loads each image from `/api/drafts/<floorId>/images/<hash>` with its own session cookie, checks the 16-million-pixel limit before fetching, and keeps at most 24 decoded bitmaps by floor and hash in a least-recently-used cache. Eviction closes the bitmap; removing a card, leaving a draft or kicking it off closes its cached images and cancels pending loads. Images exist only on the owner's page and are never sent over the socket. `tests/design-board-ui.mjs` covers the wall, the card window, account-based feedback and the phone, using generated PNGs and no server.

### Open floor

**Open floor** runs on the Mac after the owner confirms the exact project name. The link uses the shared `kickoffDocuments` export for README, brief, plan, feedback, design system/tokens and approved screen files, commits those explicit paths, then creates the private repository through the Mac's GitHub sign-in. The office opens its normal public repository floor and retains the Design book, brand poster, gong and New badge. See [Studio and Open floor](hq.md#new-projects-and-add-your-project) for failure/retry behavior. The retired `drafts.new` and `drafts.kickoff` wire requests only return migration notices and never touch a checkout.

## Sharing (step 4)

For legacy rooms not owned by the configured HQ owner, behind `AGENT_OFFICE_CUBBIES=1`, the server accepts `cubbies.knock` from a signed-in account on an online cubby's floor, except its owner. The owner receives `cubbies.knocked` (including in their other browser tabs) and an owner-only `knocking` list. Each account can knock on each cubby at most once per 30 seconds, including across tabs and reconnects. A pending knock cannot be repeated until answered or expired. There are at most eight pending knocks per cubby, and each expires after two minutes.

The owner, on that floor, answers with `cubbies.admit`: `allow: true` admits the requesting browser connection; `allow: false` refuses its knock or sends that account's watchers out. The affected connection receives `cubbies.answer`. An admitted connection gets `watching: true` and the live interior, including the lead's chat, roster, plan and Needs you. Pairing computer IDs, watcher lists and pending knocks stay owner-only. Other tabs and reconnected browsers must knock separately. Admins have no bypass. Watching grants no permission to chat with the lead, change someone else's setup, approve anything or send their tasks.

`cubbies.leave`, leaving the floor, browser disconnect, account loss, owner dismissal, and the computer sleeping or going offline end watching. Pending knocks also clear on exit or disconnect. Watching does not return automatically on wake. Grants and knocks live only in server memory and never enter `cubbies.json`; the existing bounded chat tail stays in memory too.

Only the owner on their cubby's floor can use `cubbies.sendTask`. It requires a nonblank title of at most 120 characters and a prompt of at most 4,000 characters; the normal queue also rejects an empty prompt. It reuses `queue.add`'s personal provider sign-in checks, queue validation, owner attribution and normal office-server scheduling. `cubbies.taskSent` acknowledges successful insertion only. Owners can explicitly send a task while their computer sleeps; sleep, reconnects, snapshots and chat never transfer work automatically. Private drafts refuse server tasks until kickoff, preserving their existing local-only execution rule.

The `/lite?…` browser's `lite=1` WebSocket uses the existing welcome and floor-entry paths. Those already include the same per-account `cubbies` and `drafts` pieces as 3D; ongoing messages use those same views. The owner receives their interior and draft boards, and other accounts never receive private drafts. This server step adds no client controls.

Server verification: `tests/cubby-sharing.test.ts` covers admission, revocation, account/floor boundaries, queue attribution and lite privacy. `tests/cubby-sharing-ui.mjs` keeps read-only history, watcher admission/removal, explicit task transfer and phone coverage. Legacy signed-chat composer and key-enrollment checks are retired; `tests/link-reviews.test.ts`, `hq-talk-ui.mjs` and `studio-ui.mjs` cover their linked replacements.

## Existing CI runs, one watcher

Open **CI evidence** in a PR or a queue record with an associated PR, in either the 3D office or lite view. The server takes the repository and exact head SHA from the existing PR board; it does not accept a browser-supplied repository or command. A changed head requires reopening the panel.

The panel reads existing GitHub Actions run metadata. It retains run ID, attempt, status, conclusion and link, and filters out runs whose reported head differs. A matching Actions head does **not** attest a custom checkout, PR merge checkout, runtime inputs, environment or target. Configuration association therefore remains **incomplete**. No result is advertised as candidate verification or release, and no equivalence is inferred between different runs/configurations.

Concurrent readers of the same repository and exact source SHA reuse one request and a one-minute cooldown. **Watch this run** atomically assigns one browser session to that exact run and attempt. Another viewer reuses its result. The lease lasts 150 seconds and is renewed by the open panel every 30 seconds. Only its owner can renew/release it; expiry, floor exit, browser disconnect or closing the panel releases ownership. A rerun's new attempt is a different identity. Completed runs end their watch and remain available as evidence; the owner receives a completion toast.

Only watched runs keep the shared one-minute poller active. Evidence and leases are in-memory metadata attached to existing PRs, not a new task backlog, and reset on server restart. GitHub read errors retain earlier evidence with a visible error and original read time. The server's existing `gh` account needs Actions read access. No logs or artifact bodies are fetched.

There are no dispatch, retry, cancellation, merge or deploy controls here. The controls coordinate readers inside this Office process; they cannot prevent independent agents or other Office instances from launching CI. Project pre-merge and exact-commit release gates still apply.

## Pitch gallery (step 1)

A lead on the linked Mac can publish `.agent-office/pitch.json` in its registered project folder. The Mac link reads this explicit file on its normal snapshot cycle. For example:

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

On matching project floors, only the signed-in HQ owner receives the linked Mac's pitch, image URLs, verdicts and lead replies. An explicitly configured [private HQ](hq.md) also shows the owner's pitch and images to allowed managers on HQ, read-only; lead replies stay owner-only. Admitted watchers and admins have no extra access. Other accounts' meeting rooms are unchanged. The freshest Mac link supplies linked pitches. Legacy cubby publications remain read-only, selected in slot order, with images scoped to their publishing cubby. A server restart waits for a fresh computer snapshot; verdicts persist on the computer.

`building` puts a status pill beside the meeting-room door. `ready` displays a home-page screenshot on the wall, a video screen, a slide easel and ad cards on the existing table. Entering the room eases down the owner's lighting and brings up up to four warm lights without shadows. The owner’s back-wall board shows the pitch’s building or ready state; other accounts keep the normal meeting board. The door, seats and existing meeting board keep their original interactions. Press **E** on a piece for its large view; slides have previous/next controls. **✕** and **Esc** return to mouse-look. `/lite` lists the same pieces with large views and verdict controls.

**Approve**, **Change…** and **Drop** apply to a piece; one verdict covers the entire ads set. Change requires a note, at most 1,000 characters. The signed-in HQ owner sends the review through the same `lead.send` frame used by chat and Studio feedback. The admitted Mac link resolves the publishing project, validates piece/version, rejects duplicate request IDs and atomically writes mode-`0600` `.agent-office/pitch-feedback.json`. The file records `source: "office-link"` and the owner attribution; old signature-only rows are ignored. Stamps come from the Mac's next snapshot. Increment `version` for a fresh review. Reviews never authorize merges, publishing or spending. Lead notifications use the normal private talk queue and replies remain owner-only.

Home-page links accept HTTPS only, without credentials, and open with no opener or referrer. On desktop the wall plays the https page live in a sandboxed frame, falling back to the published screenshot (see [HQ](hq.md)). YouTube videos use the existing TV embed/player path only while the owner is inside the ready room; leaving removes the iframe. A video without a YouTube ID keeps its poster and the “▶ opens on your computer” note. A future live-site screen must use `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`, without same-origin, forms, popups or top navigation permissions; an iframe load event alone cannot establish that a site accepted framing.
