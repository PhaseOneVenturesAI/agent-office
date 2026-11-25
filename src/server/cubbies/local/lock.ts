import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/** Directory file lock. Recover only dead owners' unique files; rmdir refuses a
 * newly acquired nonempty lock. An incomplete (empty) lock fails closed. */
export function projectLock(directory: string, isAlive = alive): () => void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dir = path.join(directory, 'lead.lock');
  const owner = `${process.pid}-${randomUUID()}`;
  const file = path.join(dir, owner);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { mkdirSync(dir, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Cannot acquire local lead lock');
      const entries = readdirSync(dir);
      if (!entries.length || entries.some((name) => !/^\d+-[a-f0-9-]{36}$/.test(name) || Number(name.split('-')[0]) <= 1 || isAlive(Number(name.split('-')[0])))) {
        throw new Error('Project lead is busy (local lock)');
      }
      for (const name of entries) { try { unlinkSync(path.join(dir, name)); } catch { /* competing recovery */ } }
      try { rmdirSync(dir); } catch { /* new owner or competing recovery */ }
      continue;
    }
    try {
      writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
      const entries = readdirSync(dir);
      if (entries.length !== 1 || entries[0] !== owner) throw new Error('Contended lead lock');
    } catch {
      try { unlinkSync(file); } catch { /* never remove another owner's marker */ }
      throw new Error('Project lead is busy (lock recovery)');
    }
    return () => { try { unlinkSync(file); rmdirSync(dir); } catch { /* ownership-specific cleanup */ } };
  }
  throw new Error('Project lead is busy (lock recovery)');
}
