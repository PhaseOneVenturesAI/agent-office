import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { cleanDraftName, EMPTY_BOARDS, type DraftsState } from '../../shared/protocol/drafts.js';
import type { Building, FloorDef } from '../building.js';
import type { Cubbies } from '../cubbies/index.js';
import { DraftRecords } from './records.js';

/** Private local floors; no repository creation, remote lookup or agent execution. */
export class Drafts {
  readonly records: DraftRecords;
  private starters: Set<string>;
  constructor(private dir: string, readonly enabled: boolean, starters: string | undefined,
    private accountName: (id: string) => string | undefined, private building: Building) {
    this.records = new DraftRecords(dir, enabled);
    this.starters = new Set((starters ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  }
  canStart(owner?: string): boolean {
    const name = owner && this.accountName(owner);
    return this.enabled && !!name && this.starters.has(name.toLowerCase());
  }
  owns(id: string, owner?: string): boolean {
    return this.enabled && !!owner && !!this.accountName(owner) && this.records.rows.get(id)?.owner === owner;
  }
  create(raw: unknown, owner?: string): FloorDef {
    if (!this.canStart(owner)) throw Error('Only designated project starters can make a draft floor');
    const name = cleanDraftName(raw);
    if (!name) throw Error('Give your project a name');
    const base = 'draft-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'project');
    const taken = new Set([...this.building.list(), ...this.building.pending()].map(d => d.id));
    let id = base;
    for (let n = 2; taken.has(id) || this.records.rows.has(id) || existsSync(path.join(this.dir, 'drafts', id)); n++) id = `${base}-${n}`;
    const dir = path.join(this.dir, 'drafts', id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      const git = (args: string[]) => execFileSync('git', args, { cwd: dir, timeout: 10_000, stdio: 'ignore' });
      git(['init', '-b', 'main']);
      git(['-c', 'user.name=Agent Office', '-c', 'user.email=office@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'Start draft project']);
      const record = { id, name, owner: owner!, createdAt: Date.now() };
      this.records.rows.set(id, record);
      this.records.save();
      return this.building.addLocal({ id, name, dir, addedBy: this.accountName(owner!)!, addedAt: record.createdAt, draft: true });
    } catch (error) {
      this.records.rows.delete(id);
      try { this.records.save(); }
      finally { rmSync(dir, { recursive: true, force: true }); }
      throw error;
    }
  }
  state(floorId: string | undefined, owner: string | undefined, cubbies: Cubbies): DraftsState {
    const state: DraftsState = { enabled: this.enabled, canStart: this.canStart(owner) };
    if (!floorId || !this.owns(floorId, owner)) return state;
    const r = this.records.rows.get(floorId)!;
    const cubby = cubbies.state(floorId, owner).cubbies.find(c => c.mine && c.slot === 0);
    state.here = { id: r.id, name: r.name, createdAt: r.createdAt, online: !!cubby && cubby.lamp !== 'asleep',
      boards: cubby ? cubbies.draftBoards(cubby.id, owner!) ?? EMPTY_BOARDS : EMPTY_BOARDS,
      designers: cubby?.interior?.agents.filter(a => a.designer === true).length ?? 0,
      ...(cubby ? { cubbyId: cubby.id, leadName: cubby.interior?.leadName } : {}) };
    return state;
  }
}
