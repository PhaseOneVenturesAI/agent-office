import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { cleanDraftName, EMPTY_BOARDS, NEW_BADGE_MS, type DraftsState } from '../../shared/protocol/drafts.js';
import type { Building, FloorDef } from '../building.js';
import type { Cubbies } from '../cubbies/index.js';
import { DraftRecords } from './records.js';
import { kickoffProject } from './kickoff.js';
import { kickoffRemote, runKickoff, type KickoffRunner } from './remote.js';

/** Private local floors, with remote creation only through explicit kickoff configuration. */
export class Drafts {
  readonly records: DraftRecords;
  private starters: Set<string>;
  private kicking = new Set<string>();
  private remote: ReturnType<typeof kickoffRemote>;
  constructor(private dir: string, readonly enabled: boolean, starters: string | undefined,
    private accountName: (id: string) => string | undefined, private building: Building,
    env: NodeJS.ProcessEnv = process.env, private run: KickoffRunner = runKickoff) {
    this.records = new DraftRecords(dir, enabled);
    this.remote = kickoffRemote(env);
    this.starters = new Set((starters ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  }
  isKicking(id: string): boolean { return this.kicking.has(id); }
  isNew(id: string, now = Date.now()): boolean {
    const at = this.records.rows.get(id)?.kickedOffAt;
    return at !== undefined && now < at + NEW_BADGE_MS && !this.building.list().find(d => d.id === id)?.draft;
  }
  async kickoff(id: string, confirm: unknown, owner: string | undefined, cubbies: Cubbies) {
    const def = this.building.list().find(d => d.id === id), r = this.records.rows.get(id);
    if (!def?.draft || !r || r.kickedOffAt !== undefined || !this.owns(id, owner)) throw Error('No such floor');
    if (!this.remote) throw Error('Kickoff is not switched on in this office yet');
    if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== r.name.toLowerCase()) throw Error('Type the project name again to kick it off');
    if (this.kicking.has(id)) throw Error('Kickoff is already in progress');
    if (path.resolve(def.dir) !== path.resolve(this.dir, 'drafts', id)) throw Error('The draft folder needs checking');
    this.kicking.add(id);
    try {
      const boards = this.state(id, owner, cubbies).here!.boards;
      const launched = await kickoffProject(def, boards, this.remote, this.run, launched => {
        if (!this.owns(id, owner) || this.building.list().find(d => d.id === id) !== def) throw Error('Draft changed');
        this.records.rows.set(id, { ...r, kickedOffAt: launched.at, launched });
        try {
          this.records.save();
          this.building.launchDraft(id, launched.repo);
        } catch (e) {
          this.records.rows.set(id, r);
          this.records.save();
          throw e;
        }
      }, hash => cubbies.draftImage(id, owner!, hash));
      cubbies.dropDraftImages(id);
      return launched;
    } finally { this.kicking.delete(id); }
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
    const state: DraftsState = { enabled: this.enabled, canStart: this.canStart(owner), canKickoff: this.enabled && !!this.remote };
    const saved = floorId && this.records.rows.get(floorId);
    if (saved && !this.building.list().find(d => d.id === floorId)?.draft && saved.launched) {
      state.launched = saved.launched;
      return state;
    }
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
