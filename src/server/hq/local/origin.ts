import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

function small(file: string, cap = 64 * 1024): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > cap) return;
    const buffer = Buffer.alloc(stat.size), size = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, size).toString('utf8');
  } catch { return; } finally { if (fd !== undefined) closeSync(fd); }
}

/** The git directory holding `config`: `.git` itself, or a worktree's common dir. */
function configFile(checkout: string): string | undefined {
  const dotGit = path.join(checkout, '.git');
  const pointer = small(dotGit, 4096);
  if (pointer === undefined) return path.join(dotGit, 'config');
  const gitdir = /^gitdir:\s*(.+)\s*$/m.exec(pointer)?.[1];
  if (!gitdir) return;
  const dir = path.resolve(checkout, gitdir), common = small(path.join(dir, 'commondir'), 4096)?.trim();
  return path.join(common ? path.resolve(dir, common) : dir, 'config');
}

/** `owner/repo` for a GitHub remote URL in https, ssh or scp form; anything else is undefined. */
export function githubRemote(url: string): string | undefined {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** A project's GitHub repo from its checkout's `origin` remote, read from git config on disk (no git, no network). */
export function originRepo(checkout: unknown): string | undefined {
  if (typeof checkout !== 'string' || !path.isAbsolute(checkout)) return;
  const file = configFile(checkout), text = file && small(file);
  if (!text) return;
  let inOrigin = false;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (section) { inOrigin = /^remote\s+"origin"$/.test(section[1]); continue; }
    const url = inOrigin && /^\s*url\s*=\s*(.+?)\s*$/.exec(line)?.[1];
    if (url) return githubRemote(url);
  }
}
