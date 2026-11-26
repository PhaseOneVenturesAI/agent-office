import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Building } from '../building.js';

/** Identity stays outside Building: no new repo type or implicit kickoff path. */
export class HQ {
  readonly ownerName: string;
  private managers: Set<string>;
  private id?: string;
  get enabled() { return !!this.ownerName; }
  constructor(dir: string, owner: string | undefined, managers: string | undefined,
    private accountName: (id: string) => string | undefined, building: Building) {
    this.ownerName = owner?.trim() ?? '';
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
  owns(account?: string) { return this.enabled && !!account && this.accountName(account)?.toLowerCase() === this.ownerName.toLowerCase(); }
  visible(id: string, account?: string) {
    if (!this.is(id)) return true;
    const name = account && this.accountName(account);
    return this.enabled && !!name && (this.owns(account) || this.managers.has(name.toLowerCase()));
  }
  info(id: string, account?: string) { return this.is(id) ? { hq: { ownerName: this.ownerName, mine: this.owns(account) } } : {}; }
}
