# Private HQ

Back to the [README](../README.md).

Set these variables on the office server, then restart it:

```sh
AGENT_OFFICE_HQ_OWNER=Jonathan
AGENT_OFFICE_HQ_MANAGERS=Ivan,Eddie
```

Names match signed-in account names, case-insensitively. Only the owner and the named managers see HQ in the elevator or can enter it. Admin status alone gives no access. With no owner configured, no HQ opens and ordinary floors keep their behavior. Turning the owner setting off also hides an existing HQ. The server keeps its identity in `hq.json` (mode `0600`) and its local folder under the office data directory; it has no repository and cannot be kicked off. Only its owner can remove it. Leaving the owner configured recreates it on the next server restart.

To populate HQ, enable `AGENT_OFFICE_CUBBIES=1` and connect the owner's Mac through an existing cubby. The connector reads `~/Documents/AgentHarness/projects.json` without changing it. It publishes up to 12 project names, whether each has a main lead, and up to eight department/title pairs per project. Paths, session IDs and app names are excluded. The latest owner snapshot across their cubbies supplies HQ; these project fields go only to HQ occupants. Without project data, HQ shows “Connect your Mac in your cubby to fill HQ”.

HQ has up to six project areas with dashed owner-colour borders, low project signs, a large CEO desk and smaller department desks with front plaques. Each area has a 1.4 m task-board easel at its edge. Open-floor desks, pod furniture and their hanging signs are hidden while on HQ and restored on leaving. The north portfolio wall uses four large project columns at most, with a “+N more” label for the remaining projects; the readable portfolio window lists them all. Main leads are labelled “CEO”; default department lead titles are shortened to the department name, while custom titles remain. No task counts, progress or live agents are shown. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's latest available cubby pitch from any project floor. Managers can inspect it and its images while on HQ, but cannot give verdicts. The owner's verdicts still require a trusted device signature and are sent to the original publishing cubby. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.

## Current visual review

V6 step 2, second pass — Jonathan’s builder brief, 2026-11-26: retain access, project data and pitch behavior; keep the north portfolio wall, dashed owner-colour areas, large CEO and smaller department desks, low task boards, and unobstructed entrance views. This supersedes the first-pass floating project/desk pills and wide task panels. Kitchen, bookshelf, pitch room, gong, windows and plants stay.

Owner: Agent Office lead; bounded implementation: Codex visual-fix worker on `feat/hq-floor-20261126`, based on `d23f5f9` (including the lead’s Cloudflare-email access change). Within-scope choices: side-edge easels, low two-sided project signs and desk-front plaques; no new direction or access behavior.

Verification: typecheck, Vite build with `--configLoader runner`, server build and all five UI scripts (`hq`, `pitch`, `drafts`, `cubby`, `personal-agents`) passed. `npm test`: 996/998 passed, including the unchanged size guard; the two known clone-recovery failures remain in this environment where process inspection is denied. HQ checks cover projected label boxes against each other and the wall at desktop/phone entrances and every area's default approach, including six projects with eight departments each; furniture, colliders, signs and plants restore on leaving. Task-board dimensions, enlarged wall type, four-column overflow, custom lead titles, owner access and read-only manager pitch behavior are checked. Logs: `.paradev/hq-second-*.log`. Refreshed evidence: `.paradev/shots-hq/01-*` through `10-*`, desktop and phone, plus `report.json`; `10-across-floor` uses a diagnostic 110° horizontal view, while the entrance/default projection checks retain the normal camera field of view.

Docs check: two existing Markdown files updated, none added. Startup harness health and running-worker inspection remain unverified because the environment denied them. Next step: the lead reviews these screenshots and integrates the local commit. Built and verified locally; not pushed, merged, deployed or released. No open product, brand, scope or security decision.
