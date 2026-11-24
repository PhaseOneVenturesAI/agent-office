// Display homes are furniture references only: no seat reservation, runtime, credentials or history.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface HomeRole { key: string; workerDesk?: string; desks?: string[] }
export class RoleHomes {
  private homes: Record<string, string> = {};
  private error?: string;
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'role-homes.json');
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.values(saved).some(x => typeof x !== 'string')) throw new Error('Invalid homes');
      this.homes = saved as Record<string, string>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.error = 'Character homes could not be loaded. The original record is preserved.';
    }
  }
  /** Retain existing built homes; first seed from the real worker, then an existing department/office desk. */
  resolve(roles: HomeRole[], built: string[], occupied: (id: string) => boolean): Record<string, string> | string {
    if (this.error) return this.error;
    const next = { ...this.homes }, used = new Set(Object.values(next).filter(id => built.includes(id)));
    for (const role of roles) {
      if (built.includes(next[role.key])) continue;
      const options = [...(role.desks ?? []), ...built].filter(id => built.includes(id));
      const desk = role.workerDesk && built.includes(role.workerDesk) ? role.workerDesk
        : options.find(id => !used.has(id) && !occupied(id)) ?? options.find(id => !used.has(id)) ?? options[0];
      if (!desk) return 'No built desk is available for this character’s display home.';
      next[role.key] = desk; used.add(desk);
    }
    if (JSON.stringify(next) !== JSON.stringify(this.homes)) {
      const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); renameSync(temp, this.file);
      } catch { return 'Character homes could not be saved; no home was changed.'; }
      finally { rmSync(temp, { force: true }); }
      this.homes = next;
    }
    return Object.fromEntries(roles.map(r => [r.key, next[r.key]]));
  }
}
