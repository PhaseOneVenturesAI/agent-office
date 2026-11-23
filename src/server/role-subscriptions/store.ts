import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentProvider } from '../../shared/protocol.js';
export interface RoleGrant { floor: string; department: string; provider: AgentProvider; custodian: string; controllers: string[]; configuration: string; allowStaffQA?: boolean; allowWorkers?: boolean; at: number }
/** Consent only; never credential material. Atomic saves fail closed. */
export class RoleSubscriptions {
  private grants: RoleGrant[] = [];
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'role-subscription-grants.json');
    try {
      const rows = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(rows)) this.grants = rows.filter((r) => r && ['floor','department','provider','custodian','configuration'].every(k => typeof r[k] === 'string') && Array.isArray(r.controllers) && r.controllers.every((v: unknown) => typeof v === 'string') && Number.isFinite(r.at));
    } catch { /* No valid consent means no shared subscription use. */ }
  }
  get(floor: string, department: string) { return this.grants.find(g => g.floor === floor && g.department === department); }
  set(grant: RoleGrant): string | undefined { return this.save([...this.grants.filter(g => g.floor !== grant.floor || g.department !== grant.department), grant]); }
  revoke(floor: string, department: string): string | undefined { return this.save(this.grants.filter(g => g.floor !== floor || g.department !== department)); }
  revokeFloor(floor: string): string | undefined { return this.save(this.grants.filter(g => g.floor !== floor)); }
  private save(next: RoleGrant[]): string | undefined {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
      this.grants = next;
    } catch { return 'Could not save subscription consent. No permission change was confirmed.'; }
  }
}
