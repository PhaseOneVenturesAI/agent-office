import { EMPTY_BOARDS, type DraftBoards } from '../../shared/protocol/drafts.js';
import { randomBytes } from 'node:crypto';
import type { Look } from '../../shared/avatar.js';
import { sanitizeLook, lookFromSeed } from '../../shared/avatar.js';
import type { CubbyBinding, CubbyChatLine, CubbyInterior, CubbiesState, CubbyRelayFrame, CubbyOwnerMessage } from '../../shared/protocol/cubbies.js';
import type { Nodes, NodeExtension } from '../nodes.js';
import { CubbyRecords, type CubbyRecord } from './records.js';
import { HALL_SLOTS } from '../../shared/cubbyhall.js';
import { relaySignature } from './wire.js';
import { short, snapshot } from './snapshot.js';
interface Live { admitted: boolean; binding: CubbyBinding; interior: CubbyInterior; draft?: DraftBoards; pending?: { id: string; at: number }; }
const id = () => randomBytes(12).toString('hex');

/** No transcript files, provider credentials, collectors or process launchers on the server. */
export class Cubbies {
  readonly records: CubbyRecords;
  private live = new Map<string, Live>();
  constructor(dir: string, readonly enabled: boolean, private nodes: Nodes,
    private accountName: (id: string) => string | undefined, private floorExists: (id: string) => boolean,
    private changed: () => void, private now = Date.now, private draftOwner: (floor: string) => string | undefined = () => undefined) {
    this.records = new CubbyRecords(dir, enabled);
    if (enabled) nodes.extension = this.extension;
  }
  state(floorId?: string, owner?: string): CubbiesState {
    if (!this.enabled || !floorId || !this.floorExists(floorId) || (this.draftOwner(floorId) !== undefined && this.draftOwner(floorId) !== owner)) return { enabled: false, cubbies: [], setupAllowed: false };
    return { enabled: true, floorId, setupAllowed: !!owner && !!this.accountName(owner), cubbies: [...this.records.rows.values()]
      .filter(r => r.floorId === floorId)
      .map(r => {
        const mine = r.owner === owner && !!this.accountName(r.owner);
        const live = this.live.get(r.id), online = !!this.accountName(r.owner) && !!live?.admitted && this.nodes.isOnline(r.nodeId);
        const stale = online && live.interior.observedAt !== undefined && this.now() - live.interior.observedAt > 60_000;
        const working = online && !stale ? live.interior.agents.filter(a => a.status === 'working').length : 0;
        const interior = live?.interior ?? this.empty(r);
        const privateView = stale ? { ...interior, agents: interior.agents.map(a => ({ ...a, status: 'unknown' as const })), error: 'Local roster has not refreshed. Check the connector on your computer.' } : interior;
        return { id: r.id, slot: r.slot, ownerName: this.accountName(r.owner) ?? 'Former account', mine,
          lamp: !online ? 'asleep' as const : working ? 'working' as const : 'online' as const, working,
          ...(mine ? { interior: privateView } : {}) };
      }).sort((a, b) => a.slot - b.slot) };
  }
  /** Only the cubby's authenticated owner can read its in-memory draft boards. */
  draftBoards(id: string, owner: string): DraftBoards | undefined {
    const r = this.records.rows.get(id);
    if (!this.enabled || !r || r.owner !== owner || !this.accountName(owner) || this.draftOwner(r.floorId) !== owner) return;
    return this.live.get(id)?.draft ?? EMPTY_BOARDS;
  }
  setup(floorId: string, owner: string, slot: number, name: string, look: Look) {
    if (!this.enabled || !this.floorExists(floorId) || !this.accountName(owner)) throw Error('Cubbies require your own account on an open project floor');
    const draftOwner = this.draftOwner(floorId);
    if (draftOwner !== undefined && (owner !== draftOwner || slot !== 0)) throw Error('A draft has one cubby, for its owner at the studio table');
    if (!Number.isInteger(slot) || slot < 0 || slot >= HALL_SLOTS) throw Error(`Choose one of the ${HALL_SLOTS} cubbies`);
    const previous = [...this.records.rows.values()].find(r => r.floorId === floorId && r.slot === slot);
    if (previous && previous.owner !== owner) throw Error('That cubby is already set up');
    if (previous && this.nodes.isOnline(previous.nodeId)) throw Error('Stop your local connection before setting this cubby up again');
    const leadName = short(name, 32).trim(); if (!leadName) throw Error('Give your lead a name');
    if (!previous && [...this.records.rows.values()].some(r => r.owner === owner && r.floorId === floorId && !r.computerId)) throw Error('Connect your pending cubby before setting up another computer');
    const invite = this.nodes.invite('Cubby computer', 'private', owner, true);
    const r: CubbyRecord = { ...previous, id: previous?.id ?? id(), floorId, owner, nodeId: invite.id, slot, leadName, look: sanitizeLook(look, lookFromSeed(owner)) };
    this.records.rows.set(r.id, r);
    try { this.records.save(); } catch (e) {
      if (previous) this.records.rows.set(previous.id, previous); else this.records.rows.delete(r.id);
      this.nodes.revoke(invite.id); throw e;
    }
    if (previous) { this.live.delete(previous.id); this.nodes.revoke(previous.nodeId); }
    this.changed(); return { id: r.id, floorId, token: invite.token };
  }
  chat(floorId: string, owner: string, cubbyId: string, message: CubbyOwnerMessage) {
    const r = this.records.rows.get(cubbyId), live = this.live.get(cubbyId);
    if (!this.enabled || !r || r.floorId !== floorId || r.owner !== owner || !this.accountName(owner)) throw Error('Only the owner can talk to this lead');
    if (!live?.admitted || !this.nodes.isOnline(r.nodeId)) throw Error('Your computer is asleep. Reconnect it to talk to your lead');
    const { text, requestId, at, ownerSig } = message;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) || !Number.isSafeInteger(at) ||
      typeof ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(ownerSig)) throw Error('Send a message signed by your owner device');
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw Error('Send a message between 1 and 8,000 characters');
    this.expire(live);
    if (live.pending) throw Error('Your lead is still replying. Check its local permission prompt if it needs you');
    const frame: CubbyRelayFrame = { t: 'cubby.chat', ...live.binding, requestId, at, text, ownerSig, signature: '' };
    if (!this.send(r, frame)) throw Error('Your computer disconnected; your message was not queued');
    live.pending = { id: requestId, at: this.now() };
    this.line(live, { id: requestId, role: 'user', text: frame.text, at }); this.changed();
  }
  /** Node disconnects, expiry and revocation immediately clear the chat admission. */
  refresh() {
    for (const [key, live] of this.live) {
      this.expire(live);
      const r = this.records.rows.get(key);
      if (!r || !this.nodes.isOnline(r.nodeId)) {
        live.admitted = false;
        live.interior.error = 'Computer disconnected. Work stays on that computer.';
        live.pending = undefined;
      }
    }
    this.changed();
  }
  private expire(live: Live) {
    // Native turns have a ten-minute deadline; this only releases the UI, never dispatches a retry.
    if (!live.pending || this.now() - live.pending.at < 12 * 60_000) return;
    this.line(live, { id: id(), role: 'notice', text: 'The lead did not reply in time. Check its local conversation before sending again; no automatic retry was made.', at: this.now() });
    live.pending = undefined;
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
      if (typeof f.computerId !== 'string' || !/^[\w-]{8,128}$/.test(f.computerId) || (r.computerId && r.computerId !== f.computerId)) return true;
      if ([...this.records.rows.values()].some(other => other.id !== r.id && other.owner === owner && other.floorId === r.floorId && other.computerId === f.computerId)) return true;
      r.computerId = f.computerId; r.computerName = short(f.computerName, 60) || 'Your computer'; this.records.save();
      const binding = { cubbyId: r.id, floorId: r.floorId, ownerId: owner, connectionId: id(), computerId: r.computerId };
      const interior = this.live.get(r.id)?.interior ?? this.empty(r); interior.computerName = r.computerName; interior.computerId = r.computerId; interior.ownerFingerprint = undefined; interior.error = undefined;
      this.live.set(r.id, { admitted: true, binding, interior, draft: this.live.get(r.id)?.draft }); this.send(r, { t: 'cubby.ready', ...binding, signature: '' });
    } else {
      const live = this.live.get(r.id); if (!live?.admitted) return true;
      if (f.t === 'cubby.owner-key') {
        if (typeof f.fingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(f.fingerprint)) return true;
        live.interior.ownerFingerprint = f.fingerprint;
      } else if (f.t === 'cubby.snapshot') {
        const next = snapshot(f, this.now());
        if (!next || next.observedAt < (live.interior.observedAt ?? 0)) return true;
        if (this.draftOwner(r.floorId) === owner && next.draft) live.draft = next.draft;
        Object.assign(live.interior, { agents: next.agents, plan: next.plan, needsYou: next.needsYou, observedAt: next.observedAt, error: next.error });
        if (next.wake) this.line(live, { id: id(), role: 'notice', text: `💤→☀️ ${next.wake}`, at: this.now() });
      } else if (f.t === 'cubby.reply') {
        if (!live.pending || live.pending.id !== f.requestId || typeof f.text !== 'string') return true;
        this.line(live, { id: id(), role: f.error ? 'notice' : 'assistant', text: short(f.text, 12000), at: this.now() }); live.pending = undefined;
      } else return true;
    }
    this.changed(); return true;
  };
}
