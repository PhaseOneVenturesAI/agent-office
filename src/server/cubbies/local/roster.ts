import os from 'node:os';
import path from 'node:path';
import type { CubbyAgent, CubbyNodeFrame } from '../../../shared/protocol/cubbies.js';
import { projectScope, type LocalConfig } from './config.js';
import { canonical, clean, jsonFile, run, type Run } from './io.js';
import { processes, type ProcessScan } from './processes.js';

type Snapshot = Extract<CubbyNodeFrame, { t: 'cubby.snapshot' }>;
const rows = (value: any, key: string): any[] => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];
const list = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 16).map((s) => clean(s, 240)).filter(Boolean) : [];
export interface RosterDeps { run?: Run; scan?: () => Promise<ProcessScan>; home?: string }

/** Canonical metadata only; never forward a source record wholesale. */
export async function roster(config: LocalConfig, deps: RosterDeps = {}): Promise<Snapshot> {
  const invoke = deps.run ?? run;
  const deadline = Date.now() + 8000;
  let calls = 0;
  const execute: Run = (bin, args, cwd) => {
    if (++calls > 24 || Date.now() > deadline) return Promise.reject(new Error('Roster collection budget reached'));
    return invoke(bin, args, cwd);
  };
  const home = deps.home ?? os.homedir();
  const agents: CubbyAgent[] = [];
  const ids = new Map<string, CubbyAgent>();
  const errors: string[] = [];
  // Injected scanners own their scope; production refreshes actual Git worktrees
  // on each observation so newly created/removed workers do not go stale.
  if (!deps.scan) {
    try { Object.assign(config, await projectScope(config.project, execute)); }
    catch { return { t: 'cubby.snapshot', floorId: config.floor, agents: [], plan: [], needsYou: [], observedAt: Date.now(), error: 'Project worktree scope unavailable' }; }
  }
  const scan = await (deps.scan?.() ?? processes(config.roots, execute));
  if (!scan.complete) errors.push('Local process coverage unavailable or incomplete');
  const scoped = (value: unknown) => { const root = canonical(value); return root && config.roots.includes(root) ? root : undefined; };
  const add = (agent: CubbyAgent, pid?: number, session?: string) => {
    const aliases = [agent.id, ...(pid ? [`pid:${pid}`] : []), ...(session ? [`session:${session}`] : [])];
    const matches = new Set(aliases.map((id) => ids.get(id)).filter((item): item is CubbyAgent => !!item));
    const selected = matches.values().next().value ?? agent;
    // A later source can connect two earlier records via PID and session ID.
    for (const other of matches) if (other !== selected) {
      const index = agents.indexOf(other); if (index >= 0) agents.splice(index, 1);
      for (const [id, value] of ids) if (value === other) ids.set(id, selected);
    }
    aliases.forEach((id) => ids.set(id, selected));
    if (!matches.size && agents.length < 128) agents.push(selected);
    return selected;
  };
  try {
    const f = jsonFile(path.join(home, 'Library/Application Support/AgentHarness/factory/active-run.json'));
    const root = scoped(f.worktree) ?? scoped(f.repository);
    if (root && !['completed', 'failed', 'cancelled'].includes(f.phase)) {
      const live = scan.processes.find((p) => p.pid === f.pid || p.ppid === f.pid);
      const agent = add({ id: `factory:${clean(f.runId || f.branch, 100)}`, tool: ['codex', 'claude', 'kimi'].includes(f.builder) ? f.builder : 'factory',
        role: 'factory', task: list(f.taskIds).join(', ').slice(0, 160) || 'Factory run', branch: clean(f.branch),
        status: live && f.phase === 'running' ? 'working' : 'unknown',
        ...(typeof f.deadline === 'number' && Number.isFinite(f.deadline) ? { deadlineAt: f.deadline * 1000 } : {}) }, live?.pid ?? f.pid);
      if (live && live.ppid === f.pid) ids.set(`pid:${live.ppid}`, agent);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push('Factory metadata unavailable'); }
  try {
    const projects = rows(JSON.parse(await execute('paradev', ['projects', 'list', '--local', '--json'])), 'projects');
    for (const project of projects.slice(0, 128)) {
      if (!scoped(project.path ?? project.repoPath ?? project.repositoryPath) || typeof project.id !== 'string') continue;
      const workspaces = rows(JSON.parse(await execute('paradev', ['workspaces', 'list', '--local', '--project', project.id, '--json'])), 'workspaces');
      for (const workspace of workspaces.slice(0, 128)) {
        const root = scoped(workspace.path ?? workspace.worktreePath);
        if (!root || typeof workspace.id !== 'string') continue;
        const sessions = rows(JSON.parse(await execute('paradev', ['sessions', 'list', '--local', '--workspace', workspace.id, '--limit', '128', '--json'])), 'sessions');
        for (const s of sessions.slice(0, 128)) {
          if (typeof s.id !== 'string' || !s.id) continue;
          const tool = ['claude', 'codex', 'kimi'].includes(s.provider ?? s.agentType) ? s.provider ?? s.agentType : 'paradev';
          add({ id: `paradev:${clean(s.id, 100)}`, tool, role: 'paradev', task: `${tool} session`,
            branch: clean(config.branches.get(root)), status: ['working', 'idle', 'needs-you'].includes(s.status) ? s.status : 'unknown' },
          Number.isSafeInteger(s.pid) ? s.pid : undefined, typeof s.providerSessionId === 'string' ? s.providerSessionId : undefined);
        }
      }
    }
  } catch { errors.push('Paradev metadata unavailable'); }
  for (const p of scan.processes) {
    if (!scoped(p.cwd)) continue;
    add({ id: `pid:${p.pid}`, tool: p.tool, role: 'direct', task: `${p.tool} session`,
      branch: clean(config.branches.get(p.cwd)), status: 'unknown' }, p.pid, p.session);
  }
  let plan: string[] = [], needsYou: string[] = [];
  // Explicit local publication record only; never discover/parse Markdown or transcripts.
  try {
    const record = jsonFile(path.join(config.project, '.agent-office/cubby.json'));
    plan = list(record.plan); needsYou = list(record.needsYou);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push('Cubby board record unavailable'); }
  const snapshot: Snapshot = { t: 'cubby.snapshot', floorId: config.floor, agents, plan, needsYou, observedAt: Date.now(),
    ...(errors.length ? { error: errors.join('; ') } : {}) };
  while (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024 && agents.length) agents.pop();
  return snapshot;
}
