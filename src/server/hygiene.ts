// The hygiene watchdog: the mess that regrows in a busy office, found before it bites. Every six
// hours (and whenever someone asks) it scans every floor's checkout for work at risk and clutter:
// commits no remote has (unpushed branches), worktrees no worker of the building sits in anymore
// (stale, prunable in one click — never anything with uncommitted or unpushed work), leftover
// folders git no longer tracks (strays, reported only), and workers whose pull requests merged
// but who never went home (idle, sendable in one click). The report is ☰ → 🧹 Hygiene.
//
// The git work is small and defensive: a floor that errors says why instead of failing the scan.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { HygieneFloor, HygieneIdle, HygieneStale, HygieneState, HygieneUnpushed } from '../shared/protocol.js';
import { notLeaving } from './leave-on-merge.js';
import { Worktrees, gitError } from './worktrees.js';
import type { Floor } from './floor.js';

const execFileP = promisify(execFile);
/** How often the building rescans by itself. */
const SCAN_EVERY_MS = 6 * 60 * 60_000;
/** A repo with more branches than this is reported, not walked. */
const MAX_BRANCHES = 100;

async function git(dir: string, args: string[], cwd = dir): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

export interface RepoScan {
  unpushed: HygieneUnpushed[];
  stale: HygieneStale[];
  strays: string[];
}

/**
 * One checkout's findings, given the paths and branches the building's workers still use
 * (POSIX-normalized, relative to the project dir). Nothing here writes.
 */
export async function scanRepo(dir: string, ownedPaths: Set<string>, ownedBranches: Set<string>): Promise<RepoScan> {
  const unpushed: HygieneUnpushed[] = [];
  const names = (await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').filter(Boolean);
  if (names.length > MAX_BRANCHES) {
    unpushed.push({ branch: `${names.length} branches — too many to walk`, commits: -1 });
  } else {
    for (const branch of names) {
      // Commits on this branch that no remote-tracking ref has: work a push away from safe.
      const count = Number(await git(dir, ['rev-list', '--count', branch, '--not', '--remotes'])) || 0;
      if (count > 0) unpushed.push({ branch, commits: count });
    }
  }
  const { worktrees, strays } = await new Worktrees(dir).list();
  const stale: HygieneStale[] = [];
  for (const w of worktrees) {
    const rel = path.normalize(w.path);
    if (ownedPaths.has(rel)) continue;
    if (w.branch && ownedBranches.has(w.branch)) continue;
    stale.push({ path: w.path, ...(w.branch ? { branch: w.branch } : {}) });
  }
  return { unpushed, stale, strays };
}

/**
 * Removes stale worktrees that hold nothing: no uncommitted changes, no commits no remote has.
 * Anything else is kept and said why. The branch an office worktree was on goes with it when it's
 * an office/* branch with nothing unpushed either. Never touches strays.
 */
export async function pruneStale(dir: string, stale: HygieneStale[]): Promise<{ removed: string[]; kept: { path: string; why: string }[] }> {
  const removed: string[] = [];
  const kept: { path: string; why: string }[] = [];
  for (const s of stale) {
    const abs = path.join(dir, s.path);
    try {
      const dirty = await git(dir, ['status', '--porcelain'], abs);
      if (dirty) {
        kept.push({ path: s.path, why: 'it has uncommitted changes' });
        continue;
      }
      const ahead = Number(await git(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], abs)) || 0;
      if (ahead > 0) {
        kept.push({ path: s.path, why: `it has ${ahead} commit${ahead === 1 ? '' : 's'} no remote has` });
        continue;
      }
      await git(dir, ['worktree', 'remove', abs]);
      removed.push(s.path);
      if (s.branch?.startsWith('office/')) {
        const branchAhead = Number(await git(dir, ['rev-list', '--count', s.branch, '--not', '--remotes']).catch(() => '0')) || 0;
        if (branchAhead === 0) await git(dir, ['branch', '-D', s.branch]).catch(() => '');
      }
    } catch (err) {
      kept.push({ path: s.path, why: gitError(err) });
    }
  }
  return { removed, kept };
}

export class Hygiene {
  private floors: HygieneFloor[] = [];
  private scannedAt?: number;
  private scanning?: Promise<void>;

  constructor(
    private readonly building: () => Floor[],
    private onChange: () => void,
  ) {
    // The mess regrows on its own schedule, so the scan runs on one too.
    const timer = setInterval(() => void this.scan(), SCAN_EVERY_MS);
    timer.unref?.();
  }

  state(): HygieneState {
    return {
      ...(this.scanning ? { scanning: true } : {}),
      ...(this.scannedAt ? { scannedAt: this.scannedAt } : {}),
      floors: this.floors,
      findings: this.floors.reduce((n, f) => n + f.unpushed.length + f.stale.length + f.strays.length + f.idle.length, 0),
    };
  }

  /** Scans every floor, once at a time; the report broadcasts when it lands. */
  scan(): Promise<void> {
    this.scanning ??= this.scanAll().finally(() => {
      this.scanning = undefined;
      this.scannedAt = Date.now();
      this.onChange();
    });
    this.onChange();
    return this.scanning;
  }

  /** Prunes a floor's stale worktrees (see pruneStale); a line for the toast. */
  async prune(floorId: string): Promise<string> {
    const scan = this.floors.find((f) => f.id === floorId);
    const floor = this.building().find((f) => f.id === floorId);
    if (!scan || !floor) return 'That floor is gone — rescanning will show it';
    if (!scan.stale.length) return 'Nothing stale there';
    const { removed, kept } = await pruneStale(floor.dir, scan.stale);
    void this.scan();
    const gone = removed.length ? `pruned ${removed.length} stale worktree${removed.length === 1 ? '' : 's'}` : 'nothing pruned';
    const stay = kept.length ? `, kept ${kept.length} (${kept[0].why}${kept.length > 1 ? `, +${kept.length - 1} more` : ''})` : '';
    return `${floor.def.name}: ${gone}${stay}`;
  }

  private async scanAll(): Promise<void> {
    const floors = this.building();
    // A path or branch any worker in the building uses is owned, whichever floor it sits on.
    const ownedPaths = new Set<string>();
    const ownedBranches = new Set<string>();
    for (const f of floors) {
      for (const w of f.workers.list()) {
        if (w.worktree) {
          ownedPaths.add(path.normalize(w.worktree.path));
          // Across repositories: the workspace folder its worktrees are in is its too.
          if (w.repos?.length) ownedPaths.add(path.normalize(path.dirname(w.worktree.path)));
          ownedBranches.add(w.worktree.branch);
          if (w.worktree.made) ownedBranches.add(w.worktree.made);
        }
      }
    }
    const out: HygieneFloor[] = [];
    for (const floor of floors) {
      const idle: HygieneIdle[] = [];
      for (const w of floor.workers.list()) {
        const landed = floor.landed(w);
        if (!landed || w.kind !== 'agent') continue;
        if (notLeaving(w)) continue;
        idle.push({ id: w.id, name: w.name, why: landed.prs?.length ? `its pull requests merged (${landed.prs.join(', ')})` : `PR #${landed.pr} merged` });
      }
      if (!floor.project.branch) {
        out.push({ id: floor.id, name: floor.def.name, unpushed: [], stale: [], strays: [], idle });
        continue;
      }
      try {
        const scan = await scanRepo(floor.dir, ownedPaths, ownedBranches);
        out.push({ id: floor.id, name: floor.def.name, ...scan, idle });
      } catch (err) {
        out.push({ id: floor.id, name: floor.def.name, error: gitError(err), unpushed: [], stale: [], strays: [], idle });
      }
    }
    this.floors = out;
  }
}
