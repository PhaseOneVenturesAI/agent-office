import { EMPTY_BOARDS, NEW_BADGE_MS, type DraftsState } from '../../shared/protocol/drafts.js';
import type { Building } from '../building.js';
import type { Cubbies } from '../cubbies/index.js';
import { DraftRecords } from './records.js';
/** Historical draft presentation; new projects and Open floor run through Mac Studio. */
export class Drafts {
  readonly records: DraftRecords;
  constructor(dir: string, readonly enabled: boolean, _starters: string | undefined,
    private accountName: (id: string) => string | undefined, private building: Building,
    env: NodeJS.ProcessEnv = process.env) {
    this.records = new DraftRecords(dir, enabled);
    const retired = ['AGENT_OFFICE_PROJECT_STARTERS', 'AGENT_OFFICE_KICKOFF_REMOTE', 'AGENT_OFFICE_KICKOFF_ORG'].filter(k => env[k] !== undefined || k === 'AGENT_OFFICE_PROJECT_STARTERS' && _starters !== undefined);
    if (retired.length) console.log(`agent-office: ignored retired settings ${retired.join(', ')}; use New project and Open floor through the Mac link`);
  }
  isKicking(_id: string): boolean { return false; }
  isNew(id: string, now = Date.now()): boolean {
    const at = this.records.rows.get(id)?.kickedOffAt;
    return at !== undefined && now < at + NEW_BADGE_MS && !this.building.list().find(d => d.id === id)?.draft;
  }
  canStart(_owner?: string): boolean { return false; }
  owns(id: string, owner?: string): boolean {
    return this.enabled && !!owner && !!this.accountName(owner) && this.records.rows.get(id)?.owner === owner;
  }
  state(floorId: string | undefined, owner: string | undefined, cubbies: Cubbies): DraftsState {
    const state: DraftsState = { enabled: this.enabled, canStart: this.canStart(owner), canKickoff: false };
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
