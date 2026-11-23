// Read-only checks before a building reuses or recovers a checkout.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { normalizeRepo, sameRepo } from '../shared/floors.js';

/** The GitHub repository a checkout's origin points at. */
export function originRepo(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    return /github\.com[/:]/i.test(url) ? normalizeRepo(url) : undefined;
  } catch {
    return undefined;
  }
}

/** Only a missing path can be recovered elsewhere; inaccessible paths and dangling links stay put. */
export function missingPath(dir: string): boolean {
  try {
    lstatSync(dir);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/**
 * What's at `dest`: nothing yet ('none'), a checkout of `repo` ('ok'), or why it's in the way. A
 * clone that was cut off has its origin but no commit checked out; an `empty` repository has none to.
 */
export function checkoutAt(dest: string, repo: string, empty: boolean): 'none' | 'ok' | string {
  if (!existsSync(dest)) return 'none';
  if (!statSync(dest).isDirectory()) return `${dest} is already there and isn't a folder`;
  if (!readdirSync(dest).length) return 'none';
  if (!sameRepo(originRepo(dest), repo)) return `${dest} already exists and isn't a checkout of ${repo} — move it out of the way first`;
  if (!empty && !hasCommit(dest)) return `${dest} is a clone of ${repo} that didn't finish — inspect and recover that checkout before adding the floor again`;
  return 'ok';
}

function hasCommit(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: dir, stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

