import './style.css';
import type { NodeInfo } from '../../../shared/protocol/nodes';
import { localObservation } from '../../../shared/protocol/local-sessions';
import { h, timeAgo } from '../dom';

export function localSessions(node: NodeInfo, floorId: string | null): HTMLElement | null {
  const snapshot = node.localSessions;
  if (!snapshot) return null;
  const rows = snapshot.sessions.filter((s) => s.floorId === floorId);
  return h('section.local-sessions', { 'aria-label': 'Local session observations' },
    h('b', {}, 'Local sessions · read only'),
    h('p', {}, `Sampled ${timeAgo(snapshot.observedAt)} · ${snapshot.collection === 'ok' ? 'snapshot received' : `${snapshot.collection} collection`}`),
    ...rows.map((s) => h('article.local-session', {},
      h('strong', {}, `${s.provider} · ${s.terminalId.slice(0, 8)}`),
      h('p', {}, localObservation(s, snapshot, node.online)),
      h('p', {}, `Workspace ${s.workspaceId.slice(0, 8)} · owner unknown`),
      h('p', {}, s.lastEventAt ? `Last event ${timeAgo(s.lastEventAt)}` : 'No event timestamp available'),
    )),
    !rows.length ? h('p', {}, 'No session observations mapped to this floor.') : null,
  );
}
