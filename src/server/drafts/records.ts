import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { cleanDraftName, type Launched } from '../../shared/protocol/drafts.js';
import { cleanDraftBoards } from './boards.js';
export interface DraftRecord { id: string; name: string; owner: string; createdAt: number; kickedOffAt?: number; launched?: Launched }
export class DraftRecords {
  readonly rows = new Map<string, DraftRecord>();
  private file: string;
  constructor(dir: string, enabled: boolean) {
    this.file = path.join(dir, 'drafts.json');
    if (!existsSync(this.file)) return;
    const saved = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(saved) || saved.length > 1536) throw Error('Invalid draft records');
    for (const r of saved) {
      if (!enabled && !r?.launched) continue; // Public Design books survive switching private cubbies off.
      if (!r || typeof r.id !== 'string' || !/^draft-[a-z0-9-]{1,34}$/.test(r.id) ||
        typeof r.owner !== 'string' || !/^[\w-]{1,128}$/.test(r.owner) || !cleanDraftName(r.name) ||
        !Number.isSafeInteger(r.createdAt) || this.rows.has(r.id)) throw Error('Invalid draft record');
      const row: DraftRecord = { id: r.id, name: cleanDraftName(r.name), owner: r.owner, createdAt: r.createdAt };
      if (r.kickedOffAt !== undefined) {
        if (!Number.isSafeInteger(r.kickedOffAt) || r.kickedOffAt < 0 || r.launched?.at !== r.kickedOffAt || !Array.isArray(r.launched?.screens)) throw Error('Invalid launched draft');
        const boards = cleanDraftBoards({ brand: r.launched.brand, screens: r.launched.screens.map((title: unknown) => ({ title, status: 'approved' })) });
        const repo = r.launched.repo;
        if (repo !== undefined && (typeof repo !== 'string' || !/^[a-z0-9-]{1,39}\/[a-z0-9-]{1,40}$/i.test(repo))) throw Error('Invalid launched repository');
        row.kickedOffAt = r.kickedOffAt;
        row.launched = { name: row.name, at: r.kickedOffAt, ...(repo ? { repo } : {}), brand: boards.brand, screens: boards.screens.map(s => s.title) };
      }
      this.rows.set(r.id, row);
    }
  }
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify([...this.rows.values()]), { mode: 0o600 });
    chmodSync(this.file + '.tmp', 0o600);
    renameSync(this.file + '.tmp', this.file);
  }
}
