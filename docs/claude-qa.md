# Claude Q&A isolation prototype

This is a reviewable Linux prototype, **not an enabled Q&A provider**. Nothing registers it with Office, grants the Office service root access, installs a service, or changes a custodian's Claude configuration. Kimi/Codex capability decisions remain in their existing dispatch modules. The prototype needs independent privileged-boundary review, an authenticated policy fetcher, selected-account authorization, and a real subscription acceptance check before integration.

The next integration step is a narrowly scoped root controller with fixed reviewed image/route/limits, app-side authorization, and root-side selected-custodian credential resolution. Native workers share the Office service UID, so a Unix socket UID check or sudo allowlist alone cannot authorize that controller. Admission must use the kernel-reported `SO_PEERCRED` PID and match the running Office service's current `MainPID`; caller-supplied PIDs and process ancestry are insufficient. This IPC and its independent review are deliberately not implemented here.

`src/server/claude-qa/runtime.ts` accepts one trusted, approved question, a selected access token, and fresh policy evidence. It launches only the pinned Claude Code **2.1.331** Linux x86-64 binary (SHA-256 `4c00839cf46beb2b38ec310105f2d538f7f9321fe46c636299b74bcab94626b1`) through the fixed C launcher. Callers cannot supply native arguments, executable paths, extra mounts, environments, models, or network destinations. The image path is an administrator-reviewed controller setting, never a user parameter. Do not expose this exported function directly through an HTTP request or general sudo helper.

## Boundary and data flow

The image contains the pinned native binary, a small loopback-to-Unix bridge, its glibc loader/libraries, and minimal static account/host files. It has no shell, package manager, project, host home, Claude credentials, refresh token, service socket, or Docker access. Image files and ancestry must be root-owned, protected from other writers, canonical, and match the file inventory and checksums. The manifest is root-trusted; it is not a signature protecting against a compromised administrator.

Each invocation gets a separate transient systemd unit, DynamicUser, private network namespace, readonly root, private `/work` and `/tmp` tmpfs, restricted execution paths, empty capabilities, and bounded CPU, memory, tasks and runtime. Only that job's Unix broker socket and policy snapshot are mounted. `/proc` hides other users' processes. The native process sees a random one-job surrogate in `CLAUDE_CODE_OAUTH_TOKEN`; the real selected access token stays in the trusted broker. The question arrives on stdin. Neither token nor prompt is placed in logs or native argv.

The broker accepts one authenticated `POST /v1/messages` (optional `?beta=true`) and sends it only to Anthropic's fixed Messages endpoint. It preserves the native OAuth beta/version headers and substitutes the selected token. It requires the pinned model, `tools: []`, one approved question, text-only context, and at most 4,096 output tokens. Unknown body keys, alternate routes, second requests, tool blocks, malformed SSE, oversized output and redirects fail closed. Validated values are serialized before forwarding to prevent duplicate JSON keys from creating different interpretations. Responses are buffered and validated before the native process receives them; streaming UI is deliberately outside this prototype.

The runner stops its exact transient unit on completion/error. `KillMode=control-group`, `RuntimeMaxSec`, task/memory/CPU limits and a controller deadline contain native descendants. The job broker, policy file and host scratch directory are removed afterward. There is no broad process-name cleanup. The controller retains only a sanitized outcome, policy digest and forward/accept/deny counts. Kernel/systemd/native vulnerabilities are outside this process boundary's guarantee.

## Required managed policy

Policy is **not inferred from missing network responses**. Before launch the trusted controller must obtain authenticated policy for the selected account, validate the complete schema, and attest `{ accountId, fetchedAt, source, settings, limits }`. The prototype accepts evidence at most 60 seconds old, the exact account and source `authenticated-native-policy`, settings containing only an optional boolean `channelsEnabled`, and empty limits. Unknown requirements—including hooks, MCP, forced remote refresh, or nonempty limits—return unsupported before inference. There is no unauthenticated policy fallback and no production policy fetcher in this PR.

A separate read-only qualification observed an authenticated policy-limits envelope containing restrictions, defaults, compliance taints and a monitoring notice. This prototype deliberately rejects that envelope. Fields named `allowed` do not all mean permission: some enable an enforcement requirement. Supporting those responses requires exact semantics, native policy propagation and signature/identity review; accepting their shape alone is insufficient.

The qualified snapshot is bind-mounted as readable, immutable managed settings. Local additional hooks are disabled only for this supported snapshot, which contains no mandatory hook requirement. A launcher readability preflight and controller failure detection reject policy-load failure. Denying policy routes from the native sandbox does not replace the required trusted preflight; a deployment unable to establish an authoritative supported snapshot must stay unavailable. Future managed policy cannot silently disappear or be replaced with `{}`. The hostile-hook fixture bypasses the production policy validator solely to test OS containment; it does not authorize ignoring required organizational hooks.

## Reproduce the dummy qualification

Use an administrator-controlled Linux x86-64 host with systemd 255, Node, Python and `cc`. Build the fixture bundles in the reviewed checkout; no credentials are needed:

```sh
mkdir -p /tmp/claude-qa-payload
node_modules/.bin/esbuild tests/fixtures/claude-qa-linux-driver.ts --bundle --platform=node --format=esm --outfile=/tmp/claude-qa-payload/claude-qa-linux-driver.mjs
node_modules/.bin/esbuild tests/fixtures/claude-qa-boundary-driver.ts --bundle --platform=node --format=esm --outfile=/tmp/claude-qa-payload/claude-qa-boundary-driver.mjs
node_modules/.bin/esbuild tests/fixtures/claude-qa-image-driver.ts --bundle --platform=node --format=esm --outfile=/tmp/claude-qa-payload/claude-qa-image-driver.mjs
cp deploy/claude-qa/{launcher.c,build-image.py,qualify-linux.py} tests/fixtures/claude-qa-boundary.c /tmp/claude-qa-payload/
```

Transfer that reviewed payload to a root-owned private directory on the test host. As root, run `python3 PAYLOAD/qualify-linux.py EXACT_CLAUDE_BINARY PAYLOAD`. It creates a unique `/root/office-claude-qa-qualification-*` directory, builds with umask 077, and runs only in-process dummy transports. It never requests an actual provider response or reads a real credential. It leaves the image, sanitized JSON evidence and fixture image for review; no service is installed. Preserve `summary.json` before removing that exact generated scratch directory. The fixture image contains an extra probe and is intentionally rejected by production image verification.

The harness checks actual native startup and text answer, OAuth header shape with dummy substitution, `tools: []`, output bound, forged-tool/oversized response refusal, timeout, image tampering/writable files/symlinks/extra files, distinct job UIDs and scratch, hidden other-process state, readonly root, no host or external network, absent shell, hostile managed startup-hook containment, unreadable policy refusal, and cgroup descendant cleanup. The hostile hook's inability to modify a host canary is containment evidence; it does not prove every possible native hook behavior. No raw native transcripts or credentials are saved.

Focused repository verification: `node --import tsx --test tests/claude-qa.test.ts tests/size.test.ts` and `npm run typecheck`. The lead runs the repository's complete tests/build on the integrated candidate. Dummy qualification does not establish real OAuth compatibility, subscription billing, account consent, policy completeness, or production readiness.

Protocol references: [Anthropic native gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol), [server-managed settings](https://code.claude.com/docs/en/server-managed-settings), and [systemd 255 execution isolation](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html).
