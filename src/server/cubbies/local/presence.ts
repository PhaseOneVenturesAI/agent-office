import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CubbyAgent, CubbyRole } from '../../../shared/protocol/cubbies.js';
import { canonical, clean, jsonFile } from './io.js';
import { leadId } from '../../../shared/protocol/hq.js';
import { alive } from './lock.js';

// AgentHarness presence records: one small JSON file per running agent-worker or factory-run, in
// ~/Library/Application Support/AgentHarness/runs (format: ~/Documents/GitHub/AgentHarness/presence.py,
// schema 1). Presence only: provider, role, a short title, folder, branch and process id. A record
// counts only while its process is alive, so a crashed worker never lingers in the cubby.

export interface PresenceAgent { agent: CubbyAgent; pid: number }

const PROVIDERS: Record<string, string> = { codex: 'codex', kimi: 'kimi', 'claude-personal': 'claude', 'claude-phase-one': 'claude', claude: 'claude' };

/** Where each harness role sits in the cubby: helpers at the builders' desk, read-only ones on the bean bag. */
export function cubbyRole(role: unknown, readOnly: unknown, kind: unknown): CubbyRole {
  if (kind === 'factory' || role === 'factory') return 'factory';
  if (role === 'builder' || role === 'designer') return readOnly === true ? 'reviewer' : 'builder';
  if (role === 'reviewer' || role === 'researcher') return 'reviewer';
  return readOnly === true ? 'reviewer' : 'builder';
}

export function runsDir(home = os.homedir()): string {
  return path.join(home, 'Library/Application Support/AgentHarness/runs');
}

/** The live records whose folder is one of the project's worktrees (at most 64). */
export function presence(roots: readonly string[], dir = runsDir(), isAlive: (pid: number) => boolean = alive): PresenceAgent[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => /^\d+-[0-9a-f]{1,32}\.json$/.test(f)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Harness presence unavailable'); }
  if (files.length > 512) throw new Error('Harness presence exceeds its safety limit');
  const out: PresenceAgent[] = [];
  for (const file of files) {
    let r: any;
    try { r = jsonFile(path.join(dir, file), 8192); } catch { continue; }
    if (r?.schema !== 1 || !Number.isSafeInteger(r.pid) || r.pid <= 1 || !isAlive(r.pid)) continue;
    const folder = canonical(r.folder);
    if (!folder || !roots.includes(folder)) continue;
    const role = cubbyRole(r.role, r.readOnly, r.kind);
    const tool = PROVIDERS[r.provider] ?? 'agent';
    out.push({
      pid: r.pid,
      agent: {
        id: `harness:${r.pid}`,
        tool,
        role,
        harnessRole: clean(r.role, 60),
        ...(leadId(r.lead) ? { lead: leadId(r.lead) } : {}),
        ...(typeof r.startedAt === 'string' && Number.isFinite(Date.parse(r.startedAt)) ? { startedAt: Date.parse(r.startedAt) } : {}),
        ...(typeof r.department === 'string' ? { department: clean(r.department, 60) } : {}),
        ...(typeof r.leadTitle === 'string' ? { leadTitle: clean(r.leadTitle, 60) } : {}),
        task: clean(r.title, 80) || (role === 'reviewer' ? 'Review' : 'Harness task'),
        branch: clean(r.branch),
        status: 'working',
        ...(r.role === 'designer' ? { designer: true } : {}),
        ...(role === 'reviewer' && r.role === 'researcher' ? { progress: 'research' } : {}),
      },
    });
    if (out.length >= 64) break;
  }
  return out;
}
