# Private HQ

Back to the [README](../README.md).

Set these variables on the office server, then restart it:

```sh
AGENT_OFFICE_HQ_OWNER=Jonathan
AGENT_OFFICE_HQ_MANAGERS=Ivan,Eddie
```

Names match signed-in account names, case-insensitively. Only the owner and the named managers see HQ in the elevator or can enter it. Admin status alone gives no access. With no owner configured, no HQ opens and ordinary floors keep their behavior. Turning the owner setting off also hides an existing HQ. The server keeps its identity in `hq.json` (mode `0600`) and its local folder under the office data directory; it has no repository and cannot be kicked off. Only its owner can remove it. Leaving the owner configured recreates it on the next server restart.

To populate HQ, enable `AGENT_OFFICE_CUBBIES=1` and connect the owner's Mac through an existing cubby. The connector reads `~/Documents/AgentHarness/projects.json` without changing it. It publishes up to 12 project names, whether each has a main lead, and up to eight department/title pairs per project. Paths, session IDs and app names are excluded. The latest owner snapshot across their cubbies supplies HQ; these project fields go only to HQ occupants. Without project data, HQ shows “Connect your Mac in your cubby to fill HQ”.

HQ has up to six project areas with empty desks and task-board placeholders. Its portfolio wall lists all published projects and lead titles, with a “+N more” label when more than six projects have been published. No task counts, progress or live agents are shown. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's latest available cubby pitch from any project floor. Managers can inspect it and its images while on HQ, but cannot give verdicts. The owner's verdicts still require a trusted device signature and are sent to the original publishing cubby. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.
