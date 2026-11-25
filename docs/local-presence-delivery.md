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

This opt-in module is disabled unless the Office server starts with `AGENT_OFFICE_CUBBIES=1`. It adds a separate owner-chat and presence path to Satellites; ordinary `join` remains presence-only. Each cubby belongs to one Office account, one computer and one floor. Coworkers, including other admins, receive only its owner name, status lamp and working count. Its underlying Satellite record is owner-only too. Only one unconnected setup may be reserved per owner per floor; connect it before claiming another computer. Revoked accounts leave a visibly occupied “Former account” room, never a falsely free slot. They do not receive the lead name, computer name, roster, plan, decisions or chat. Watchers, draft floors, kickoff, task transfer and lite-view cubby controls are not part of step one.

The owner uses **Set up** at a free cubby, names and styles its lead, and runs the displayed connection command on their computer. The local project path stays on that computer. The computer opens the outbound connection; Office does not open a port or reach into it. Existing Cloudflare Access login applies unchanged. Cubby chat requires HTTPS, except for loopback development on the same computer. If the setup token is lost, stop the local connection and press E at your offline cubby’s door to use Set up again; the old token is revoked and the room remains bound to the same computer.

```sh
agent-office join https://office.example --token '<private invitation>' \
  --cubbies --floor '<floor id>' --project '/local/project' \
  --owner-key '<base64url P-256 SPKI public key from this browser>'
```

The local registry in `~/Documents/AgentHarness/projects.json`, when present, selects the existing project lead. Archived entries and conflicting session selections are rejected. On another computer, select the existing native session locally with `--lead-provider claude --lead-session '<UUID>'`; use `--lead-profile personal` or `phase-one` for an existing Claude profile. A new lead requires the local `--new-lead` option and no conflicting registered lead. Office cannot select executable names, profiles, paths, models or permissions remotely. Provider API routing from the parent shell is stripped; native subscription configuration remains local.

**Current integration limits:** the guarded Claude path resumes the exact existing session only when it is not open elsewhere, and reports native approval refusals for review locally. Codex desktop chat is currently blocked: this connector has no supported connection to the existing desktop lead. This preview must not be described as complete support for the registered Codex Office lead. Hall placement, the integrated UI, and provider acceptance remain under review before this step is ready to merge.

**Owner-held chat keys (Jonathan's accepted decision, 2026-11-24).** Setup/chat creates an ECDSA P-256 key in the owner's browser with WebCrypto. Its private key is non-extractable and stored in IndexedDB per Office origin and named sign-in account. Only the public SPKI key appears in the join command. `--cubbies` requires `--owner-key`; the computer pins that locally supplied key in a mode-0600 `owner-<floor hash>.json` record under `~/.agent-office/cubbies/<project hash>/`. The record includes a SHA-256 fingerprint (first 128 bits), shown in the setup window for comparison. Server frames can never install or replace a pin.

A different key on a later join is refused. To change browser/device, stop join on the computer, use **Set up** at your offline cubby from the new browser, compare fingerprints, and run its command locally with `--replace-owner-key`. The old browser then loses chat access. Clearing site data or losing that browser profile also requires this local re-pin; private keys are never exported or synchronized. The chat window explains a missing/mismatched pin and disables sending. The computer reports its public fingerprint for that display only; it independently verifies every message against the actual local pin.

The browser generates the request ID and millisecond timestamp, then signs UTF-8 JSON of `["agent-office/cubby-owner-chat/v1", cubbyId, floorId, computerId, requestId, at, text]` with ECDSA/SHA-256 (64-byte P1363 signature, base64url). Office relays the text, ID, timestamp and signature unchanged. The existing HMAC still binds the transport to the Satellite, account and connection, but knowing that HMAC key is insufficient to mint an accepted chat. The connector checks the owner signature before dispatch, rejects missing/invalid signatures with “Message not signed by this cubby's owner key”, requires clocks within ±60 seconds, and remembers request IDs across reconnects for the lifetime of join. No command, file, terminal-input or approval frame is supported.

This prevents a compromised relay from forging prompts without the browser key. It is signing, not encryption: Office still sees chat and can withhold it. The browser application and device must remain trusted; malicious same-origin JavaScript (including altered client code served by a compromised Office host) can use a non-extractable key to sign without exporting it. This browser design does not claim protection against that separate compromise. The Office server retains at most 40 chat lines in memory and writes no conversation files; native CLI history remains on the owner's computer.

Presence is limited to the selected Git project and actual worktrees. Direct sessions expose tool, branch and an explicitly unknown busy state when it cannot be verified, never their prompts or conversations. Factory and Paradev metadata is bounded and source failures are visible. Explicit local plan/Needs-you text may be published through `.agent-office/cubby.json`; arbitrary project documents are not collected. Installed CLIs do not establish that a subscription is ready.

Ctrl-C stops the connector and closes the chat path. It cancels only a native turn the connector itself owns, never another open lead. A clean disconnect greys the lamp immediately; an abrupt network loss or sleep is detected by the normal Satellite heartbeat timeout. Reconnection does not replay old messages or move work to the Office server. Turning the server flag off disables the module without deleting account credentials or native histories.

The relay is a narrow extension of existing Office protocols. Alternatives reviewed were [Happy](https://github.com/slopus/happy), a broader mobile/remote agent app, and the official [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Neither was installed; the implementation reuses the existing WebSocket transport and locally selected native CLI.

## Existing CI runs, one watcher

Open **CI evidence** in a PR or a queue record with an associated PR, in either the 3D office or lite view. The server takes the repository and exact head SHA from the existing PR board; it does not accept a browser-supplied repository or command. A changed head requires reopening the panel.

The panel reads existing GitHub Actions run metadata. It retains run ID, attempt, status, conclusion and link, and filters out runs whose reported head differs. A matching Actions head does **not** attest a custom checkout, PR merge checkout, runtime inputs, environment or target. Configuration association therefore remains **incomplete**. No result is advertised as candidate verification or release, and no equivalence is inferred between different runs/configurations.

Concurrent readers of the same repository and exact source SHA reuse one request and a one-minute cooldown. **Watch this run** atomically assigns one browser session to that exact run and attempt. Another viewer reuses its result. The lease lasts 150 seconds and is renewed by the open panel every 30 seconds. Only its owner can renew/release it; expiry, floor exit, browser disconnect or closing the panel releases ownership. A rerun's new attempt is a different identity. Completed runs end their watch and remain available as evidence; the owner receives a completion toast.

Only watched runs keep the shared one-minute poller active. Evidence and leases are in-memory metadata attached to existing PRs, not a new task backlog, and reset on server restart. GitHub read errors retain earlier evidence with a visible error and original read time. The server's existing `gh` account needs Actions read access. No logs or artifact bodies are fetched.

There are no dispatch, retry, cancellation, merge or deploy controls here. The controls coordinate readers inside this Office process; they cannot prevent independent agents or other Office instances from launching CI. Project pre-merge and exact-commit release gates still apply.
