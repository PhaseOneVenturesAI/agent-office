# Local presence and CI evidence

## A read-only Paradev satellite

An existing satellite can optionally report observations from explicitly mapped local Paradev workspaces. It cannot start agents, send prompts, read terminal content, forward services or operate the Office queue. Office workers and these external sessions remain separate.

1. An admin invites the computer in **Satellites**. Keep the existing node credential in `AGENT_OFFICE_NODE_TOKEN` rather than a command-line argument.
2. Find the workspace ID using `paradev workspaces list --local --json`. Open the intended Office floor and **Satellites** to find that floor's mapping ID.
3. Run the foreground command, adding one mapping per workspace:

```sh
agent-office join https://office.example \
  --paradev-map workspace-id=floor-id
```

The default CLI is `~/.paradev/bin/paradev`; `--paradev-bin /absolute/path/to/paradev` selects another installed binary. No workspaces are sampled unless mapped. The collector uses only:

```text
workspaces list --local --json
terminals list --local --workspace ID --json
agents explain --local --workspace ID --terminal ID --json
```

Each bounded sample reconstructs this allowlist, rather than forwarding CLI JSON:

```json
{
  "observedAt": 1795413600000,
  "collection": "ok",
  "sessions": [{
    "floorId": "floor-id",
    "workspaceId": "workspace-id",
    "terminalId": "terminal-id",
    "provider": "claude",
    "state": "starting",
    "lastEventAt": 1795381200000,
    "exited": false
  }]
}
```

IDs, provider/state enums, timestamps and exit observations are the only session fields sent. Titles, prompts, transcripts, explanations, command lines, paths and credentials are omitted. Ownership is **unknown**. A partial or unavailable collection is visible; an absent row does not establish completion. There are at most 20 mappings and 100 rows, and sampling is sequential with a bounded time budget. A completed sample schedules the next after 30 seconds.

Node authentication must precede a hello and snapshot. The server rejects future/out-of-order or malformed snapshots and isolates replaced/revoked connections. Observations are held in memory, filtered to the viewer's current floor and lost on Office restart. Machine presence remains building-wide. Removing the satellite revokes its credential and removes its observations.

A machine's heartbeat is not agent activity. A sample older than 90 seconds, an event older than five minutes, an absent event timestamp, or an offline node makes the row **stale**. A nine-hour-old `Attached`/`starting` observation is not shown as active. Even a recent event does not prove account readiness, ownership, successful work or release. Terminal exit has an unknown outcome.

### Existing Cloudflare Access login

For an office behind Cloudflare Access, first authenticate through the existing account and application policy:

```sh
cloudflared access login --quiet https://office.example
agent-office join https://office.example --cloudflare-access \
  --paradev-map workspace-id=floor-id
```

The foreground client reads the application-specific cache through `cloudflared access token --app`, captures the result in memory, and sends it as `CF-Access-Token` with the node credential in the Authorization header. It does not log either credential, follow WebSocket redirects, invoke login itself or silently rotate credentials. The existing node invite is still required; Access authentication does not create an Office browser session or execution capability. The Access token's expiry ends the connection visibly; repeat the normal login and restart join. No public bypass, service credential or policy change is introduced.

This is an interactive user CLI connection, not an unattended service authentication solution. Cloudflare validates the application's token at the edge; the client's expiry parsing is only a stop timer. See [Cloudflare's CLI authentication documentation](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/). The bridge does not bypass or alter any Access policies.

## Existing CI runs, one watcher

Open **CI evidence** in a PR or a queue record with an associated PR, in either the 3D office or lite view. The server takes the repository and exact head SHA from the existing PR board; it does not accept a browser-supplied repository or command. A changed head requires reopening the panel.

The panel reads existing GitHub Actions run metadata. It retains run ID, attempt, status, conclusion and link, and filters out runs whose reported head differs. A matching Actions head does **not** attest a custom checkout, PR merge checkout, runtime inputs, environment or target. Configuration association therefore remains **incomplete**. No result is advertised as candidate verification or release, and no equivalence is inferred between different runs/configurations.

Concurrent readers of the same repository and exact source SHA reuse one request and a one-minute cooldown. **Watch this run** atomically assigns one browser session to that exact run and attempt. Another viewer reuses its result. The lease lasts 150 seconds and is renewed by the open panel every 30 seconds. Only its owner can renew/release it; expiry, floor exit, browser disconnect or closing the panel releases ownership. A rerun's new attempt is a different identity. Completed runs end their watch and remain available as evidence; the owner receives a completion toast.

Only watched runs keep the shared one-minute poller active. Evidence and leases are in-memory metadata attached to existing PRs, not a new task backlog, and reset on server restart. GitHub read errors retain earlier evidence with a visible error and original read time. The server's existing `gh` account needs Actions read access. No logs or artifact bodies are fetched.

There are no dispatch, retry, cancellation, merge or deploy controls here. The controls coordinate readers inside this Office process; they cannot prevent independent agents or other Office instances from launching CI. The existing Deploy board's **Stage** still submits a URL to the Review Room, not a deployment. Project pre-merge and exact-commit release gates still apply.
