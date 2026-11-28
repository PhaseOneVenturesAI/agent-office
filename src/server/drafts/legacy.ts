import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { FloorDef } from '../building.js';
/** Never open or delete an old VPS checkout. Keep only a separate presentation directory. */
export function legacyDrafts(dataDir: string, floors: FloorDef[]) {
  const root = path.join(dataDir, 'drafts');
  if (existsSync(root)) {
    try { for (const name of readdirSync(root)) console.log(`agent-office: ignored legacy VPS draft folder ${path.join(root, name)}; an admin may remove it`); }
    catch { console.log(`agent-office: ignored legacy VPS drafts folder ${root}; an admin may inspect it`); }
  }
  for (const floor of floors) {
    if (!floor.draft || !floor.id.startsWith('draft-')) continue;
    floor.dir = path.join(dataDir, 'legacy-drafts', floor.id);
    mkdirSync(floor.dir, { recursive: true, mode: 0o700 });
  }
}
