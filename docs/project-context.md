# Project context

Open **☰ → 📖 Project context** in the Office, or **📖 Context** on `/lite`.
Pick a Markdown source to inspect its exact text, project, host and content revision.
The source is the actual file in that floor's checkout; this is not a separate memory
backlog. A source being available does not prove any agent loaded it. Existing worker
worktrees and provider sessions can contain different revisions. No provider's private
home, credentials or account memory is read.

The list reuses the project's bookshelf discovery (up to 5,000 Markdown files), plus
bounded discovery of conventional local instructions even when gitignored:
`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.local.md`, `MEMORY.md`,
`.claude/CLAUDE.md`, `.claude/rules/`, `.agents/` and `.paradev/LEAD.md`.
Conventional discovery stops after 500 paths or six nested levels. Search narrows the
visible list. Only safe, regular UTF-8 Markdown files up to 256 KB can be opened;
symlink/hardlink aliases, generated directories, private paths and known credential
patterns are refused. Pattern checks are not a complete secret scanner.

Any signed-in member can inspect project sources and history, matching the existing
shared bookshelf access. Only admins can mutate them. The API uses the registered
floor, rejects traversal and aliases, and requires the same Office origin for writes.

## Edit with a visible conflict

**Edit source** keeps a draft in this browser while the window closes or changes sources.
Give the change a reason, then **Save revision**. The server compares the source's
content hash with the revision you opened. A changed or deleted source rejects the
save without silently recreating or overwriting it. The draft remains available.
Compare the current source, then explicitly choose **Use current revision as base**
if your draft should replace it. Drafts survive modal close/reopen, not a browser reload.
No operation commits, pushes, prompts a worker or refreshes a provider context.

## Archive, supersede and restore

**Archive or supersede** removes the selected actual file after preserving its full
prior text and reason. Select another existing project source to record what supersedes
it; links in other files are not rewritten. **Inspect prior text** opens the immutable
snapshot. **Restore this text as current source** writes that snapshot back using the
current revision as its base and records who restored it, why and which snapshot was
used. These are explicit actions; review verdicts never change context automatically.

History stays inspectable when the current folder is moved, deleted, or replaced by an
unsafe link. The current path is labeled unavailable, and restore refuses until its
parent is safe and exists. History storage itself may never be a symlink.

## History and scope

Prior text, hashes, actor, reason, action and restore/supersede references are retained
under this project's `.agent-office/project-context/`. Records are append-only through
this API; there is no prune or rewrite endpoint. **Load older history** pages through
all operations, 50 at a time. The canonical file remains authoritative. Edits made by
other tools have unknown authors here; their current text is preserved before the next
Office replacement, but intermediate external edits cannot be reconstructed.

The snapshot is written before replacing or unlinking the source. A failed replacement
leaves the source untouched and records a failed attempt. An interrupted attempt or a
failed completion-receipt write is labeled **unconfirmed**; it is not asserted successful.
If the source changed but the receipt failed, the response explicitly reports that
partial bookkeeping outcome. Atomic rename protects individual replacements, not a
multi-file database transaction or filesystem tamper-proof audit. Hash checks coordinate
Office edits and detect external changes observed before replacement; independent tools
do not participate in an OS-level compare-and-swap lock.

**Shared Harness** opens the existing separate server-default editor. Project edits
never push shared defaults, refresh existing workers or synchronize local computers.
