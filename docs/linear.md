# Linear and the office task board

Linear links to the existing 📋 board; no map replacement or separate CRM. Open the
board for **My tasks** or **Department tasks**. The existing autonomous queue remains
under **Agent work queue**.

- **Do myself** marks an assigned task in progress without starting a provider.
- **Start my agent** lets the assignee choose provider/model and uses their own sign-in.
  The human stays assigned. An agent turn ending is a review cue, not completion.
- **Edit task** updates title, description and mapped status. Assigned staff can edit
  their own tasks; only the owner or an explicitly authorized department controller
  can assign project work or change its employee assignment.
- Reassignment never transfers a running worker or its credentials. A queued run that
  has not started is withdrawn when assignment changes. The next assignee must opt in.
- **Open Linear** preserves the external issue identity; archived or removed issues
  remain visible without deleting agent sessions, branches or worktrees.

## Native host setup

Nothing connects by default. This is separate from a Linear chat plugin and from
Claude, Codex and Kimi subscription sign-ins. Do not copy plugin credentials.

1. In the intended Linear workspace, open Settings → API → OAuth applications and
   create a **private** app. Keep client-credentials grants off. Register the exact
   redirect `https://YOUR-OFFICE/api/linear/callback`.
2. Enable app webhooks for Issue and OAuthApp at
   `https://YOUR-OFFICE/api/linear/webhook`. Save its signing secret. Keep the rest of
   Office behind login. If Cloudflare Access protects the host, permit external POSTs
   only to this exact signed webhook path. Do not bypass Access for the whole site.
3. Supply the service configuration below through the host's protected environment
   file. The `AGENT_OFFICE_` prefix is already excluded from worker environments.
   Do not rename these to unprefixed `LINEAR_*` variables. Do not put secrets in Git,
   project memory, agent prompts or browser storage.

```dotenv
AGENT_OFFICE_LINEAR_CLIENT_ID=<private OAuth app client ID>
AGENT_OFFICE_LINEAR_CLIENT_SECRET=<private OAuth app secret>
AGENT_OFFICE_LINEAR_WEBHOOK_SECRET=<webhook signing secret>
AGENT_OFFICE_LINEAR_ORIGIN=https://YOUR-OFFICE
AGENT_OFFICE_LINEAR_OWNER_ACCOUNT_ID=<verified Office owner account ID>
AGENT_OFFICE_LINEAR_ORGANIZATION_ID=<verified Linear workspace UUID>
```

4. Restart through the normal release process. Sign in as the designated Office owner,
   open 📋, then **Connect Linear**. Authorization requests `actor=app` with `read` and
   `issues:create`, state binding and S256 PKCE. It does not request admin scope.
5. **Link floor & people**: choose the actual authorized team, optionally an existing
   project's UUID, actual workflow states, and an optional default department for
   imported work. Choose explicit Office↔Linear person mappings. Names or email
   similarities do not establish identity. No teams or projects are auto-created.
6. Verify a test task in both directions, manual completion, an intentionally started
   own-agent task, duplicate webhook delivery, and reconnection before production use.

The existing deployment's verified candidate mappings are Phase One Ventures workspace
`4eeb58e3-c11a-4ac9-9ed6-9ba0ab7589aa`, Plimbo team
`7fbd33b2-80b0-4218-b6d6-364bef8409e9`; this documentation does not install them.
Other floors need separately chosen mappings. Jonathan's Linear and Office emails are
different and require explicit verification; never infer a shared identity.

## Department authorization seam

`LinearService` takes `controller(accountId, scope)` where scope includes `floorId`,
`departmentId`, optional `taskId`, and `action` (`create`, `edit`, `assign`, `sync`).
Wire this to the maintained department role ACL during integration. The default denies
all department control; only the explicitly configured integration owner has broad
access. A generic admin flag never grants this power. Unknown/unscoped tasks remain
owner-controlled. A controller in Marketing must not gain Development permissions.
Assignees retain their own manual work and own-agent execution independently.

New Office tasks can select an existing department. Imported issues use the explicit
floor mapping's default department; no department is guessed from a title, team name
or assignee. The integration currently maps one team/project selection per floor and
rejects overlapping mappings. Department metadata stays Office-local. Existing floor
team/project remapping requires host review so external links cannot silently migrate.
The integration does not authorize CEO prompts or department-agent orchestration.

## Reliability and security boundary

`<office-data-dir>/linear.json` holds OAuth tokens, explicit mappings, canonical field
baselines, stable links, deduplicated webhook inbox and outbound pending changes. It
is atomically replaced with mode 0600. Tokens are never returned in public state.
One service performs sync; refreshing credentials is single-flight. OAuth reconnect
is restricted to the configured owner and expected organization.

Incoming requests require a valid HMAC-SHA256 of the raw bytes, signed timestamp,
workspace UUID and delivery UUID. Accepted events are persisted before acknowledgement;
processing is asynchronous. Every three minutes, paginated incremental polling with an
overlap recovers missed events. Rate limits/errors back off; requests time out. Very
old webhook retries can fail freshness verification; reconciliation recovers updates.
The webhook queue deduplicates the latest 10,000 delivery IDs; older replays still
reconcile by issue UUID rather than creating tasks.

Creation persists a UUIDv4 before contacting Linear. A lost create reply is resolved
by querying that same UUID before retrying. Existing issue IDs stay stable when their
display identifiers change. The integration never sends `delegateId` and never starts
an agent from webhook text. Local IDs remain separate from Linear UUIDs.

Before sending edits, sync compares changed fields against their saved baseline.
Independent fields merge; overlapping edits require **Use Linear version** or **Keep
Office edits**. Browser edits carry the displayed remote revision. Linear does not
provide a cross-system compare-and-swap guarantee: a concurrent external write between
the last read and mutation can still race. Preserve human review for important changes.
Manual task backlog is independent of the 100-task executable queue limit.

This is application-level control on the existing shared host, not OS tenant isolation.
Do not give untrusted shell agents the same operating-system account as server secrets.
New Linear users/teams are refreshed during reconnection; reconnect to refresh the setup
catalog before mapping newly added employees. Native live sync is not verified merely
because the chat plugin is connected or the fake-service tests pass.

## Verification

- `node --import tsx --import=#tests/css --test tests/linear.test.ts tests/queue.test.ts`
- `node tests/linear-ui.mjs` (headless Chrome, isolated fake API, real board components;
  optional `CHROME_BIN` and `LINEAR_UI_OUTPUT` overrides)
- Standard repository typecheck, full tests and production build at the checkpoint.

Official references: [OAuth](https://linear.app/developers/oauth-2-0-authentication),
[webhooks](https://linear.app/developers/webhooks),
[GraphQL](https://linear.app/developers/graphql),
[rate limits](https://linear.app/developers/rate-limiting).
