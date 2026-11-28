import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Drafts } from '../../src/server/drafts/index.js';
import type { Building } from '../../src/server/building.js';
/** Seed saved pre-Studio metadata, never recreate the removed VPS checkout feature. */
export function legacyDraft(drafts: Drafts, building: Building, dir: string, name: string, owner: string) {
  const base = 'draft-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let id = base; for (let n = 2; drafts.records.rows.has(id); n++) id = `${base}-${n}`;
  const record = { id, name, owner, createdAt: Date.now() };
  drafts.records.rows.set(id, record); drafts.records.save();
  const folder = path.join(dir, 'legacy-drafts', id); mkdirSync(folder, { recursive: true });
  return building.addLocal({ id, name, dir: folder, addedBy: owner, addedAt: record.createdAt, draft: true });
}
