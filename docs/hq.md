# Private HQ

Back to the [README](../README.md).

Set these variables on the office server, then restart it:

```sh
AGENT_OFFICE_HQ_OWNER=Jonathan
AGENT_OFFICE_HQ_MANAGERS=ivan@example.com,Eddie
```

Each entry is an account name or, if it contains `@`, the email Cloudflare Access signs that account in as; both match case-insensitively. An email keeps matching if the account is renamed, and an account that only shares the name doesn't get in. The owner can be either too; an email owner is shown by the part before the `@`. Only the owner and the named managers see HQ in the elevator or can enter it. Admin status alone gives no access. With no owner configured, no HQ opens and ordinary floors keep their behavior. Turning the owner setting off also hides an existing HQ. The server keeps its identity in `hq.json` (mode `0600`) and its local folder under the office data directory; it has no repository and cannot be kicked off. Only its owner can remove it. Leaving the owner configured recreates it on the next server restart.

To populate HQ, enable `AGENT_OFFICE_CUBBIES=1` and connect the owner's Mac through an existing cubby. The connector reads `~/Documents/AgentHarness/projects.json` without changing it. It publishes up to 12 project names, whether each has a main lead, and up to eight department/title pairs per project. The snapshot also marks the connected cubby’s own project and includes an optional GitHub `owner/name` repository slug. The own project links to that cubby’s floor; other projects link only when an open floor has the same repository. Paths, session IDs, URL credentials/query strings and app names are excluded. The latest owner snapshot across their cubbies supplies HQ; the portfolio goes only to HQ occupants. On a linked project floor, only the HQ owner and allowed managers receive the lead’s location and conversation metadata. Without project data, HQ shows “Connect your Mac in your cubby to fill HQ”.

HQ has up to six project areas with dashed owner-colour borders, low project signs, a large CEO desk and smaller department desks with front plaques. Each area has a 1.4 m task-board easel at its edge. Open-floor desks, pod furniture and their hanging signs are hidden while on HQ and restored on leaving. The north portfolio wall uses four large project columns at most, with a “+N more” label for the remaining projects; the readable portfolio window lists them all. Main leads are labelled “CEO”; default department lead titles are shortened to the department name, while custom titles remain. Task counts and progress are not inferred. The furnished areas have personal-agent characters at their CEO and department desks, with the owner’s colour, role outfit, floor ring and one two-line nameplate. Only a connected cubby lead shows a live status (working, idle, asleep or error); unconnected leads show their role. Use E or tap a board to read the same text in a window that fits a phone. The existing meeting room is the pitch room and the gong stays in place.

The pitch room shows the owner's latest available cubby pitch from any project floor. Managers can inspect it and its images while on HQ, but cannot give verdicts. The owner's verdicts still require a trusted device signature and are sent to the original publishing cubby. Ordinary-floor pitch access remains owner-only. HQ chat is labelled with the sender's account name and reaches only current HQ occupants; it is not saved in building-wide chat history. Worker spawning, station prompts, meetings and queue execution are blocked on HQ for everyone. Manager access grants no merge, publish or spending approval.

## One lead across two floors

Projects beyond HQ’s six furnished areas remain listed in the portfolio and keep their existing cubby bodies; they do not offer an HQ status card or Go there destination.

A connected lead in a furnished area keeps one identity and one conversation. Its body stands at its HQ desk by default. While that project has a published ready pitch with pieces awaiting a verdict, the publishing cubby lead stands inside HQ’s pitch room by the screens. Department leads stay at their desks. Once the connector reports verdicts for all pieces in that pitch version, the lead returns to its desk. Project-floor presence will determine working locations in a later step; it does not move leads yet.

On the linked project floor, the absent cubby lead is replaced by an “At HQ” status card at its usual interior spot and a small sign at the door. During a pending pitch these say “In the HQ pitch room”, and its HQ desk has an “In the pitch room” card. A project without a floor link keeps its lead at HQ and offers no cross-floor Go there action.

Press E at the connected lead or its status card to open the same cubby chat. The owner can send from a trusted browser device; its signature still names the source cubby and project floor. HQ managers can read the thread, with no send box and no ability to send messages. For department leads and main leads without a connected conversation, E shows where to talk to that lead in the Claude app on the owner’s computer.

The conversation window’s **Go there** button rides the existing elevator from a project-floor card to HQ, then places you near the lead. At a vacant HQ desk it takes you to the pitch-room body; from the pitch-room body it can take you back to the linked project floor’s cubby door. Cubby sharing rules remain unchanged: manager access to HQ never admits a manager to an owner’s cubby interior.

When the cubby lead needs the owner, its body raises a hand, its HQ desk has a soft amber glow, and its status cards show an amber “Needs you” badge. These HQ details are visible only to the owner and allowed managers. With HQ disabled, for viewers without HQ access, and for other owners’ cubbies, the original cubby body and sharing behaviour remain unchanged.
