import { execFile } from 'node:child_process';
import { LOCAL_ID, LOCAL_STATES, type LocalSnapshot } from '../../shared/protocol/local-sessions.js';
import { readSnapshot } from './schema.js';

export type JsonRunner = (bin: string, args: string[]) => Promise<unknown>;
export const runJson: JsonRunner = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
    if (err) return reject(new Error('Local status unavailable'));
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Local status unavailable')); }
  });
});

export function addMapping(mappings: Map<string, string>, input: string): void {
  const [workspace, floor, extra] = input.split('=');
  if (extra !== undefined || !LOCAL_ID.test(workspace ?? '') || !LOCAL_ID.test(floor ?? '') || mappings.has(workspace) || mappings.size >= 20) throw new Error('Use a unique --paradev-map workspace-id=floor-id (at most 20)');
  mappings.set(workspace, floor);
}

/** Only the explicit mappings are inspected; reads are sequential and never overlap samples. */
export async function collectParadev(bin: string, mappings: ReadonlyMap<string, string>, run: JsonRunner = runJson, clock = Date.now): Promise<LocalSnapshot> {
  const sessions: LocalSnapshot['sessions'] = [];
  let collection: LocalSnapshot['collection'] = 'ok';
  const deadline = clock() + 15_000;
  try {
    const raw = await run(bin, ['workspaces', 'list', '--local', '--json']);
    if (!Array.isArray(raw)) throw new Error();
    for (const workspace of raw) {
      if (clock() >= deadline) { collection = 'partial'; break; }
      const floorId = mappings.get(workspace?.id);
      if (!floorId || workspace.archivedAt || workspace.worktreeExists === false) continue;
      try {
        const terminalResult = await run(bin, ['terminals', 'list', '--local', '--workspace', workspace.id, '--json']);
        // Supported Paradev CLI envelope, not a bare array. Never propagate its titles.
        const terminals = (terminalResult as { sessions?: unknown } | null)?.sessions;
        if (!Array.isArray(terminals) || terminals.length > 100) throw new Error();
        for (const t of terminals) {
          if (clock() >= deadline) { collection = 'partial'; break; }
          if (sessions.length >= 100) { collection = 'partial'; break; }
          if (typeof t?.terminalId !== 'string' || !LOCAL_ID.test(t.terminalId) || t.workspaceId !== workspace.id) { collection = 'partial'; continue; }
          let a: any = {};
          try { a = await run(bin, ['agents', 'explain', '--local', '--workspace', workspace.id, '--terminal', t.terminalId, '--json']); }
          catch { collection = 'partial'; }
          sessions.push({ floorId, workspaceId: workspace.id, terminalId: t.terminalId, provider: ['claude', 'codex', 'kimi'].includes(a?.agentId) ? a.agentId : 'unknown', state: LOCAL_STATES.includes(a?.state) ? a.state : 'unknown', lastEventAt: Number.isSafeInteger(a?.lastEventAt) && a.lastEventAt > 0 && a.lastEventAt <= clock() ? a.lastEventAt : null, exited: t.exited === true });
        }
      } catch { collection = 'partial'; }
    }
  } catch { collection = 'unavailable'; }
  return readSnapshot({ observedAt: clock(), collection, sessions }, clock())!;
}
