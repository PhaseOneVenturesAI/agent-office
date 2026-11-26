import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Building } from '../building.js';

/** Identity stays outside Building: no new repo type or implicit kickoff path. */
export class HQ {
  private owner: string;
  /** Shown to people: the configured name, or an email's name part (never the address). */
  readonly ownerName: string;
  private managers: Set<string>;
  private id?: string;
  get enabled() { return !!this.owner; }
  constructor(dir: string, owner: string | undefined, managers: string | undefined,
    private account: (id: string) => { name: string; email?: string } | undefined, building: Building) {
    this.owner = owner?.trim() ?? '';
    const stem = this.owner.split('@')[0];
    this.ownerName = stem.charAt(0).toUpperCase() + stem.slice(1);
    this.managers = new Set((managers ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    const file = path.join(dir, 'hq.json');
    // A lost record must not turn a previously private data-directory floor public.
    const saved = building.list().filter(d => /^hq(?:-[0-9]+)?$/.test(d.id) && path.resolve(d.dir) === path.resolve(dir, 'hq', d.id));
    if (saved.length > 1) throw Error('Multiple HQ floors need checking');
    this.id = saved[0]?.id;
    let record: { id: string; createdAt: number } | undefined;
    if (existsSync(file)) {
      record = JSON.parse(readFileSync(file, 'utf8'));
      if (!record || typeof record.id !== 'string' || !/^hq(?:-[0-9]+)?$/.test(record.id) || !Number.isSafeInteger(record.createdAt)) throw Error('Invalid HQ record');
      if (this.id && this.id !== record.id) throw Error('HQ floor identity conflicts with its record');
      this.id = record.id;
    }
    if (!this.enabled) return;
    if (!record) {
      const taken = new Set([...building.list(), ...building.pending()].map(d => d.id));
      let id = this.id ?? 'hq';
      for (let n = 2; !this.id && taken.has(id); n++) id = `hq-${n}`;
      record = { id, createdAt: saved[0]?.addedAt ?? Date.now() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600 });
      chmodSync(file + '.tmp', 0o600); renameSync(file + '.tmp', file);
      this.id = id;
    }
    chmodSync(file, 0o600);
    const folder = path.join(dir, 'hq', record.id);
    const existing = building.list().find(d => d.id === record.id);
    if (existing && (path.resolve(existing.dir) !== path.resolve(folder) || existing.repo || existing.draft)) throw Error('HQ floor identity conflicts with an existing floor');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (!existing) building.addLocal({ id: record.id, name: 'HQ', dir: folder, addedBy: this.ownerName, addedAt: record.createdAt });
  }
  is(id?: string) { return !!id && id === this.id; }
  /** An entry with an @ is a Cloudflare email (it survives a renamed account); otherwise an account name. */
  private matches(entry: string, account?: string) {
    const a = account ? this.account(account) : undefined;
    if (!a) return false;
    const e = entry.toLowerCase();
    return e.includes('@') ? a.email?.toLowerCase() === e : a.name.toLowerCase() === e;
  }
  owns(account?: string) { return this.enabled && this.matches(this.owner, account); }
  visible(id: string, account?: string) {
    if (!this.is(id)) return true;
    return this.owns(account) || (this.enabled && [...this.managers].some(m => this.matches(m, account)));
  }
  info(id: string, account?: string) { return this.is(id) ? { hq: { ownerName: this.ownerName, mine: this.owns(account) } } : {}; }
}
