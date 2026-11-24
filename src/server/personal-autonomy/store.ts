import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AutonomyMode } from '../providers/autonomy.js';

interface Preference { automatic: boolean; at: number }
/** One private server-side preference per account; unreadable state is never overwritten. */
export class PersonalAutonomy {
  private users = new Map<string, Preference>();
  private error?: string;
  private file: string;
  private busy = new Set<string>();
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'personal-autonomy.json');
    try {
      if (!lstatSync(this.file).isFile()) throw new Error();
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !saved.users || typeof saved.users !== 'object' || Array.isArray(saved.users)) throw new Error();
      for (const [id, p] of Object.entries(saved.users) as [string, Preference][]) {
        if (!/^[A-Za-z0-9]{6,64}$/.test(id) || !p || typeof p.automatic !== 'boolean' || !Number.isFinite(p.at)) throw new Error();
        this.users.set(id, p);
      }
    } catch (error) {
      this.users.clear();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.error = 'Your agent preferences could not be read. Existing settings were kept.';
    }
  }
  get(id: string): Preference | undefined { const p = this.users.get(id); return p && { ...p }; }
  mode(id: string): AutonomyMode | undefined { const p = this.get(id); return p ? p.automatic ? 'autonomous' : 'supervised' : undefined; }
  begin(id: string): boolean { if (this.busy.has(id)) return false; this.busy.add(id); return true; }
  end(id: string): void { this.busy.delete(id); }
  set(id: string, automatic: boolean): string | undefined {
    if (this.error) return this.error;
    if (!/^[A-Za-z0-9]{6,64}$/.test(id) || typeof automatic !== 'boolean') return 'Invalid personal preference.';
    const next = new Map(this.users); next.set(id, { automatic, at: Date.now() });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      try { if (!lstatSync(this.file).isFile()) throw new Error(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      writeFileSync(tmp, JSON.stringify({ version: 1, users: Object.fromEntries(next) }), { mode: 0o600, flag: 'wx' });
      renameSync(tmp, this.file); this.users = next;
    } catch { return 'Your agent preference could not be saved. No running agent was changed.'; }
    finally { try { rmSync(tmp, { force: true }); } catch { /* Preserve the original save result. */ } }
  }
}
declare module '../office/context.js' { interface BuildingServices { personalAutonomy: PersonalAutonomy } }
