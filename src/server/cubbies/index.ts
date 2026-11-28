import { cubbyWithoutHQMetadata } from '../hq/privacy.js';
import { hqRecords, hqCubbyPitch } from '../hq/cubbies.js';
import { PitchStore } from '../pitch/store.js';
import { DraftImages } from './design-images.js';
import { BOARD_TOO_BIG } from './publication.js';
import { EMPTY_BOARDS, type DraftBoards } from '../../shared/protocol/drafts.js';
import { randomBytes } from 'node:crypto';
import type { CubbyChatLine, CubbyInterior, CubbiesState, CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
import type { Nodes, NodeExtension } from '../nodes.js';
import { CubbyRecords, type CubbyRecord } from './records.js';
import { relaySignature } from './wire.js';
import { short, snapshot } from './snapshot.js';
import { CubbySharing, watcherInterior } from './sharing.js';
interface Live { projects?: import('../../shared/protocol/hq.js').HQProject[]; admitted: boolean; interior: CubbyInterior; draft?: DraftBoards; }
const id = () => randomBytes(12).toString('hex');

/** No transcript files, provider credentials, collectors or process launchers on the server. */
export class Cubbies {
  private pitches = new PitchStore();
  readonly records: CubbyRecords;
  private live = new Map<string, Live>();
  private sharing: CubbySharing;
  private images = new Map<string, DraftImages>();
  constructor(dir: string, readonly enabled: boolean, private nodes: Nodes,
    private accountName: (id: string) => string | undefined, private floorExists: (id: string) => boolean,
    private changed: () => void, private now = Date.now, private draftOwner: (floor: string) => string | undefined = () => undefined) {
    this.records = new CubbyRecords(dir, enabled);
    this.sharing = new CubbySharing(accountName, id => this.online(id), changed, now);
    if (enabled) nodes.extension = this.extension;
  }
  state(floorId?: string, owner?: string, clientId?: string): CubbiesState {
    this.sharing.refresh();
    if (!this.enabled || !floorId || !this.floorExists(floorId) || (this.draftOwner(floorId) !== undefined && this.draftOwner(floorId) !== owner)) return { enabled: false, cubbies: [], setupAllowed: false };
    return { enabled: true, floorId, ...(owner ? { ownerColor: this.records.color(owner) } : {}), setupAllowed: false, cubbies: [...this.records.rows.values()]
      .filter(r => r.floorId === floorId)
      .map(r => {
        const mine = r.owner === owner && !!this.accountName(r.owner);
        const live = this.live.get(r.id), online = !!this.accountName(r.owner) && !!live?.admitted && this.nodes.isOnline(r.nodeId);
        const stale = online && live.interior.observedAt !== undefined && this.now() - live.interior.observedAt > 60_000;
        const working = online && !stale ? live.interior.agents.filter(a => a.status === 'working').length : 0;
        const interior = cubbyWithoutHQMetadata(live?.interior ?? this.empty(r));
        const privateView = stale ? { ...interior, agents: interior.agents.map(a => ({ ...a, status: 'unknown' as const })), error: 'Local roster has not refreshed. Check the connector on your computer.' } : interior;
        return { id: r.id, slot: r.slot, ownerColor: this.records.color(r.owner), ownerName: this.accountName(r.owner) ?? 'Former account', mine,
          lamp: !online ? 'asleep' as const : working ? 'working' as const : 'online' as const, working,
          ...(mine ? { interior: privateView, ...this.sharing.people(r.id) }
            : this.sharing.watching(r.id, owner, clientId) ? { watching: true as const, interior: watcherInterior(privateView) } : {}) };
      }).sort((a, b) => a.slot - b.slot) };
  }
  private online(id: string): boolean {
    const r = this.records.rows.get(id);
    return !!r && this.enabled && this.floorExists(r.floorId) && !!this.accountName(r.owner) &&
      !!this.live.get(id)?.admitted && this.nodes.isOnline(r.nodeId);
  }
  private room(floorId: string, account: string, id: string) {
    const r = this.records.rows.get(id), draftOwner = this.draftOwner(floorId);
    if (!this.enabled || !r || r.floorId !== floorId || !this.floorExists(floorId) || !this.accountName(account) ||
      !this.accountName(r.owner) || (draftOwner !== undefined && draftOwner !== account)) throw Error('No cubby available on this floor');
    return r;
  }
  knock(floorId: string, account: string, id: string, clientId: string) {
    const r = this.room(floorId, account, id);
    if (r.owner === account) throw Error('You already own this cubby');
    if (!this.online(id)) throw Error('This cubby is asleep. Knock when its computer is online');
    const by = this.sharing.knock(id, account, clientId);
    this.changed(); return { owner: r.owner, by };
  }
  admit(floorId: string, owner: string, id: string, account: string, allow: boolean) {
    const r = this.room(floorId, owner, id);
    if (r.owner !== owner) throw Error('Only the cubby owner can answer a knock or send a watcher out');
    if (typeof allow !== 'boolean' || typeof account !== 'string') throw Error('Choose an account and whether to let it watch');
    const clients = this.sharing.answer(id, account, allow);
    this.changed(); return clients;
  }
  leave(clientId: string, id?: string) {
    if (!this.enabled) return;
    this.sharing.leave(clientId, id); this.changed();
  }
  task(floorId: string, owner: string, id: string, title: string, prompt: string) {
    const r = this.room(floorId, owner, id);
    if (r.owner !== owner) throw Error('Only the cubby owner can send a task to the floor');
    if (this.draftOwner(floorId) !== undefined) throw Error('Draft work runs on your computer. Kick off the project before sending a task to the floor');
    if (typeof title !== 'string' || !title.trim() || title.length > 120) throw Error('Give the task a title of 1 to 120 characters');
    if (typeof prompt !== 'string' || prompt.length > 4000) throw Error('Keep the task prompt to at most 4,000 characters');
    return { title: title.trim(), prompt };
  }
  /** Only the cubby's authenticated owner can read its in-memory draft boards. */
  draftBoards(id: string, owner: string): DraftBoards | undefined {
    const r = this.records.rows.get(id);
    if (!this.enabled || !r || r.owner !== owner || !this.accountName(owner) || this.draftOwner(r.floorId) !== owner) return;
    const boards = this.live.get(id)?.draft ?? EMPTY_BOARDS, images = this.images.get(r.floorId);
    // Announce an image URL only after its final chunk is checked. The completion update then
    // changes the owner view, so the browser never caches a premature failed image load.
    const ready = <T extends DraftBoards['ideas'][number]>(card: T): T => {
      if (!card.image || images?.get(card.image.hash)) return card;
      const { image: _image, ...rest } = card; return rest as T;
    };
    return { ...boards, ideas: boards.ideas.map(ready), screens: boards.screens.map(ready) };
  }
  dropDraftImages(floorId: string): void {
    this.images.delete(floorId);
    this.pitches.retain(id => this.online(id));
  }
  draftImage(floorId: string, owner: string, hash: string) {
    if (!this.enabled || !this.floorExists(floorId) || this.draftOwner(floorId) !== owner || !this.accountName(owner)) {
      if (!this.floorExists(floorId) || this.draftOwner(floorId) === undefined) this.dropDraftImages(floorId);
      return;
    }
    return this.images.get(floorId)?.get(hash);
  }
  private hqRecords(owner: string) { return hqRecords(this.records.rows.values(), this.live, owner, floor => this.enabled && !!this.accountName(owner) && this.floorExists(floor)); }
  hqSources(owner: string) {
    return this.hqRecords(owner).map(r => ({ floorId: r.floorId, projects: this.live.get(r.id)?.projects ?? [],
      agents: this.live.get(r.id)?.interior.agents, cubby: this.state(r.floorId, owner).cubbies.find(c => c.id === r.id)!,
      pitch: r.computerId ? this.pitches.view(r.id, r.floorId, r.computerId)?.pitch : undefined }));
  }
  hqProjects(owner: string) { return this.live.get(this.hqRecords(owner)[0]?.id)?.projects; }
  hqPitch(owner: string, mine: boolean) { return hqCubbyPitch(this.hqRecords(owner), this.live, this.pitches, mine); }
  pitchView(floorId?: string, owner?: string) {
    if (!this.enabled || !floorId || !owner || !this.floorExists(floorId) || !this.accountName(owner)) return;
    const records = [...this.records.rows.values()].filter(r => r.floorId === floorId && r.owner === owner).sort((a, b) => a.slot - b.slot);
    for (const r of records) {
      const view = r.computerId && this.pitches.view(r.id, floorId, r.computerId);
      if (view) return view;
    }
  }
  pitchImage(cubbyId: string, owner: string, hash: string) {
    const r = this.records.rows.get(cubbyId);
    if (!this.enabled || !r || r.owner !== owner || !this.accountName(owner) || !this.floorExists(r.floorId)) return;
    return this.pitches.image(cubbyId, hash);
  }
  /** Node disconnects, expiry and revocation immediately clear the chat admission. */
  refresh() {
    this.pitches.retain(id => this.online(id));
    for (const floorId of this.images.keys()) {
      const owner = this.draftOwner(floorId);
      if (!this.floorExists(floorId) || owner === undefined || !this.accountName(owner) ||
        ![...this.records.rows.values()].some(r => r.floorId === floorId && r.owner === owner)) this.dropDraftImages(floorId);
    }
    for (const [key, live] of this.live) {
      const r = this.records.rows.get(key);
      if (!r || !this.online(key)) {
        live.admitted = false;
        live.interior.error = 'Computer disconnected. Work stays on that computer.';
      }
    }
    this.sharing.refresh();
    this.changed();
  }
  private empty(r: CubbyRecord): CubbyInterior { return { computerName: r.computerName ?? 'Your computer', leadName: r.leadName, look: r.look, agents: [], plan: [], needsYou: [], chat: [] }; }
  private line(live: Live, line: CubbyChatLine) { live.interior.chat = [...live.interior.chat, line].slice(-40); }
  private send(r: CubbyRecord, frame: CubbyRelayFrame) { return this.nodes.sendSigned(r.nodeId, key => ({ ...frame, signature: relaySignature(key, frame) })); }
  private extension: NodeExtension = (nodeId, owner, raw) => {
    if (!this.enabled || !owner || !this.accountName(owner) || !raw || typeof raw !== 'object') return false;
    const f = raw as Record<string, unknown>;
    if (typeof f.t !== 'string' || !f.t.startsWith('cubby.')) return false;
    const r = [...this.records.rows.values()].find(r => r.nodeId === nodeId && r.owner === owner && r.floorId === f.floorId);
    if (!r || !this.floorExists(r.floorId)) return true;
    if (f.t === 'cubby.hello') {
      this.images.get(r.floorId)?.reconnect(); this.pitches.drop(r.id);
      if (typeof f.computerId !== 'string' || !/^[\w-]{8,128}$/.test(f.computerId) || (r.computerId && r.computerId !== f.computerId)) return true;
      if ([...this.records.rows.values()].some(other => other.id !== r.id && other.owner === owner && other.floorId === r.floorId && other.computerId === f.computerId)) return true;
      r.computerId = f.computerId; r.computerName = short(f.computerName, 60) || 'Your computer'; this.records.save();
      const binding = { cubbyId: r.id, floorId: r.floorId, ownerId: owner, connectionId: id(), computerId: r.computerId };
      const interior = this.live.get(r.id)?.interior ?? this.empty(r); interior.computerName = r.computerName; interior.computerId = r.computerId; interior.error = undefined;
      const live = { admitted: false, interior, draft: this.live.get(r.id)?.draft };
      this.live.set(r.id, live);
      live.admitted = this.send(r, { t: 'cubby.ready', ...binding, signature: '' });
    } else {
      const live = this.live.get(r.id); if (!live?.admitted) return true;
      if (f.t === 'cubby.design-image') {
        const pitchChanged = this.pitches.accept(r.id, f);
        const draftChanged = this.draftOwner(r.floorId) === owner && this.images.get(r.floorId)?.accept(f);
        if (!pitchChanged && !draftChanged) return true;
      } else if (f.t === 'cubby.snapshot') {
        const next = snapshot(f, this.now());
        if (!next || next.observedAt < (live.interior.observedAt ?? 0)) return true;
        live.projects = next.projects;
        if (this.draftOwner(r.floorId) === owner) {
          live.draft = next.draft ?? (next.error === BOARD_TOO_BIG ? live.draft : undefined) ?? EMPTY_BOARDS;
          let images = this.images.get(r.floorId);
          if (!images) this.images.set(r.floorId, images = new DraftImages());
          images.boards(live.draft);
        } else { live.draft = undefined; this.dropDraftImages(r.floorId); }
        if (next.error !== BOARD_TOO_BIG) this.pitches.publish(r.id, owner, next.pitch);
        Object.assign(live.interior, { agents: next.agents, plan: next.plan, needsYou: next.needsYou, observedAt: next.observedAt, error: next.error });
        if (next.wake) this.line(live, { id: id(), role: 'notice', text: `💤→☀️ ${next.wake}`, at: this.now() });
      } else return true;
    }
    this.changed(); return true;
  };
}
