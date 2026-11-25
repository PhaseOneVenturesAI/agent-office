import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Look } from '../../shared/avatar.js';
import { sanitizeLook, lookFromSeed } from '../../shared/avatar.js';
export interface CubbyRecord {
  id: string; floorId: string; owner: string; nodeId: string; slot: number;
  leadName: string; look: Look; computerId?: string; computerName?: string;
}
const key = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{1,128}$/.test(s);
export class CubbyRecords {
  readonly rows = new Map<string, CubbyRecord>();
  private file: string;
  constructor(dir: string, enabled: boolean) {
    this.file = path.join(dir, 'cubbies.json');
    if (!enabled || !existsSync(this.file)) return;
    // Refuse corrupt state instead of silently freeing someone else's private room.
    const saved = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(saved) || saved.length > 1536) throw Error('Invalid cubby records');
    const slots = new Set<string>();
    for (const r of saved) {
      if (!r || !key(r.id) || !key(r.floorId) || !key(r.owner) || !key(r.nodeId) || !Number.isInteger(r.slot) || r.slot < 0 || r.slot >= 6 || typeof r.leadName !== 'string') throw Error('Invalid cubby record');
      const slot = `${r.floorId}:${r.slot}`;
      if (slots.has(slot) || this.rows.has(r.id)) throw Error('Duplicate cubby record');
      slots.add(slot);
      this.rows.set(r.id, { id: r.id, floorId: r.floorId, owner: r.owner, nodeId: r.nodeId, slot: r.slot,
        leadName: r.leadName.slice(0, 32), look: sanitizeLook(r.look, lookFromSeed(r.id)),
        ...(key(r.computerId) ? { computerId: r.computerId } : {}),
        ...(typeof r.computerName === 'string' ? { computerName: r.computerName.slice(0, 60) } : {}) });
    }
  }
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify([...this.rows.values()]), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
}
