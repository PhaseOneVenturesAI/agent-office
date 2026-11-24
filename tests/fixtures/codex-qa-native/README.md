# Codex Q&A native regression

This fixture exercises the **compiled Office adapter** with Codex 0.171.0 on Linux,
synthetic ChatGPT OAuth credentials, and a local Responses stub. It never uses a real
subscription or renewable credential. It is intentionally separate from `npm test`.

1. Run `npm run build:server`.
2. Copy `dist/server/server/staff-qa-codex*.js`, the corresponding catalog JSON, and
   `run.py` into a disposable directory on the qualified Linux host. Preserve the JS
   modules' relative paths. The host needs its existing `agentoffice` user, `/usr/bin/node`,
   Python 3, `ip`, `unshare` and native `/usr/bin/codex` 0.171.0.
3. As root, run (replace both paths):

   ```sh
   unshare --net sh -c 'ip link set lo up; python3 /tmp/qa-fixture/run.py /tmp/qa-fixture/staff-qa-codex.js'
   ```

The fixture refuses host networking or interfaces/routes beyond loopback. Child processes
run as `agentoffice`. A fixture-only wrapper selects the local provider with
`requires_openai_auth=true`; production code exposes no provider-URL override. Native
ChatGPT Bearer/account headers, empty tool catalogs, forged-call rejection, 401 without
refresh, unknown-model refusal, source credential preservation and scratch cleanup are
checked. The printed evidence path contains all captured dummy requests and outcomes.
No actual account token, refresh credential, manager history or project is read.

Public model metadata is pinned from `openai/codex` tag `rust-v0.171.0`,
`codex-rs/models-manager/models.json`, with only the four capability changes described in
`staff-qa-codex-config.ts`. The precise feature list is in that compiled module, so the
fixture tests the implementation rather than maintaining another configuration copy.

A successful stub test does not establish live subscription acceptance. That requires a
separately authorized owner-specific smoke test. Do not put real tokens into this fixture.
