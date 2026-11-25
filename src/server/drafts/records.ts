import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { cleanDraftName } from '../../shared/protocol/drafts.js';
export interface DraftRecord { id: string; name: string; owner: string; createdAt: number }
export class DraftRecords {
  readonly rows = new Map<string, DraftRecord>();
  private file: string;
  constructor(dir: string, enabled: boolean) {
    this.file = path.join(dir, 'drafts.json');
    if (!enabled || !existsSync(this.file)) return;
    const saved = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(saved) || saved.length > 1536) throw Error('Invalid draft records');
    for (const r of saved) {
      if (!r || typeof r.id !== 'string' || !/^draft-[a-z0-9-]{1,34}$/.test(r.id) ||
        typeof r.owner !== 'string' || !/^[\w-]{1,128}$/.test(r.owner) || !cleanDraftName(r.name) ||
        !Number.isSafeInteger(r.createdAt) || this.rows.has(r.id)) throw Error('Invalid draft record');
      this.rows.set(r.id, { id: r.id, name: cleanDraftName(r.name), owner: r.owner, createdAt: r.createdAt });
    }
  }
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify([...this.rows.values()]), { mode: 0o600 });
    chmodSync(this.file + '.tmp', 0o600);
    renameSync(this.file + '.tmp', this.file);
  }
}
