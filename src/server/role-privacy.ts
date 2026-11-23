// Private role provenance outlives an engine swap. Files contain role keys, never chat content.
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export type RoleOrigin = { kind: 'ceo' } | { kind: 'manager'; department: string } | { kind: 'unavailable' };
export class RolePrivacy {
  constructor(private dir: string) {}
  private file(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid worker identity');
    return path.join(this.dir, `role-origin-${id}.json`);
  }
  get(id: string): RoleOrigin | undefined {
    try {
      const file = this.file(id);
      if (!existsSync(file)) return undefined;
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.kind === 'ceo') return { kind: 'ceo' };
      if (value.kind === 'manager' && typeof value.department === 'string') return { kind: 'manager', department: value.department };
    } catch { /* Damaged provenance must never turn private history public. */ }
    return { kind: 'unavailable' };
  }
  protect(id: string, origin: RoleOrigin): string | undefined {
    let temp: string | undefined;
    try {
      const existing = this.get(id);
      if (existing) return JSON.stringify(existing) === JSON.stringify(origin) ? undefined : 'This worker already holds a different private role history.';
      const file = this.file(id); temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(temp, JSON.stringify(origin), { mode: 0o600 }); renameSync(temp, file);
    } catch { return 'Could not preserve private role ownership; no handoff was sent.'; }
    finally { if (temp) rmSync(temp, { force: true }); }
  }
}
