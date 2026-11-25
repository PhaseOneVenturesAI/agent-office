import { randomBytes } from 'node:crypto';
import type { Look } from '../../shared/avatar.js';
import { sanitizeLook, lookFromSeed } from '../../shared/avatar.js';
import type { CubbyBinding, CubbyChatLine, CubbyInterior, CubbiesState, CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
import type { Nodes, NodeExtension } from '../nodes.js';
import { CubbyRecords, type CubbyRecord } from './records.js';
import { relaySignature } from './wire.js';
import { short, snapshot } from './snapshot.js';
interface Live { admitted: boolean; binding: CubbyBinding; interior: CubbyInterior; pending?: { id: string; at: number }; }
const id = () => randomBytes(12).toString('hex');

/** No transcript files, provider credentials, collectors or process launchers on the server. */
export class Cubbies {
  readonly records: CubbyRecords;
  private live = new Map<string, Live>();
  constructor(dir: string, readonly enabled: boolean, private nodes: Nodes,
    private accountName: (id: string) => string | undefined, private floorExists: (id: string) => boolean,
    private changed: () => void, private now = Date.now) {
    this.records = new CubbyRecords(dir, enabled);
    if (enabled) nodes.extension = this.extension;
  }
  state(floorId?: string, owner?: string): CubbiesState {
    if (!this.enabled || !floorId || !this.floorExists(floorId)) return { enabled: false, cubbies: [], setupAllowed: false };
    return { enabled: true, floorId, setupAllowed: !!owner && !!this.accountName(owner), cubbies: [...this.records.rows.values()]
      .filter(r => r.floorId === floorId && !!this.accountName(r.owner))
      .map(r => {
        const live = this.live.get(r.id), online = !!live?.admitted && this.nodes.isOnline(r.nodeId);
        const working = online ? live.interior.agents.filter(a => a.status === 'working').length : 0;
        return { id: r.id, slot: r.slot, ownerName: this.accountName(r.owner)!, mine: r.owner === owner,
          lamp: !online ? 'asleep' as const : working ? 'working' as const : 'online' as const, working,
          ...(owner === r.owner ? { interior: live?.interior ?? this.empty(r) } : {}) };
      }).sort((a, b) => a.slot - b.slot) };
  }
  setup(floorId: string, owner: string, slot: number, name: string, look: Look) {
    if (!this.enabled || !this.floorExists(floorId) || !this.accountName(owner)) throw Error('Cubbies require your own account on an open project floor');
    if (!Number.isInteger(slot) || slot < 0 || slot >= 6) throw Error('Choose one of the six cubbies');
    const previous = [...this.records.rows.values()].find(r => r.floorId === floorId && r.slot === slot);
    if (previous && previous.owner !== owner) throw Error('That cubby is already set up');
    if (previous && this.nodes.isOnline(previous.nodeId)) throw Error('Stop your local connection before setting this cubby up again');
    const leadName = short(name, 32).trim(); if (!leadName) throw Error('Give your lead a name');
    const invite = this.nodes.invite('Cubby computer', 'private', owner);
    const r: CubbyRecord = { ...previous, id: previous?.id ?? id(), floorId, owner, nodeId: invite.id, slot, leadName, look: sanitizeLook(look, lookFromSeed(owner)) };
    this.records.rows.set(r.id, r);
    try { this.records.save(); } catch (e) {
      if (previous) this.records.rows.set(previous.id, previous); else this.records.rows.delete(r.id);
      this.nodes.revoke(invite.id); throw e;
    }
    if (previous) { this.live.delete(previous.id); this.nodes.revoke(previous.nodeId); }
    this.changed(); return { id: r.id, floorId, token: invite.token };
  }
  chat(floorId: string, owner: string, cubbyId: string, text: unknown) {
    const r = this.records.rows.get(cubbyId), live = this.live.get(cubbyId);
    if (!this.enabled || !r || r.floorId !== floorId || r.owner !== owner || !this.accountName(owner)) throw Error('Only the owner can talk to this lead');
    if (!live?.admitted || !this.nodes.isOnline(r.nodeId)) throw Error('Your computer is asleep. Reconnect it to talk to your lead');
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw Error('Send a message between 1 and 8,000 characters');
    if (live.pending) throw Error('Your lead is still replying. Check its local permission prompt if it needs you');
    const requestId = id(), at = this.now();
    const frame: CubbyRelayFrame = { t: 'cubby.chat', ...live.binding, requestId, at, text: short(text, 8000).trim(), signature: '' };
    if (!this.send(r, frame)) throw Error('Your computer disconnected; your message was not queued');
    live.pending = { id: requestId, at };
    this.line(live, { id: requestId, role: 'user', text: frame.text, at }); this.changed();
  }
  /** Node disconnects, expiry and revocation immediately clear the chat admission. */
  refresh() {
    for (const [key, live] of this.live) {
      const r = this.records.rows.get(key);
      if (!r || !this.nodes.isOnline(r.nodeId)) {
        live.admitted = false;
        live.interior.error = 'Computer disconnected. Work stays on that computer.';
        live.pending = undefined;
      }
    }
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
      if (typeof f.computerId !== 'string' || !/^[\w-]{8,128}$/.test(f.computerId) || (r.computerId && r.computerId !== f.computerId)) return true;
      if ([...this.records.rows.values()].some(other => other.id !== r.id && other.owner === owner && other.floorId === r.floorId && other.computerId === f.computerId)) return true;
      r.computerId = f.computerId; r.computerName = short(f.computerName, 60) || 'Your computer'; this.records.save();
      const binding = { cubbyId: r.id, floorId: r.floorId, ownerId: owner, connectionId: id() };
      const interior = this.live.get(r.id)?.interior ?? this.empty(r); interior.computerName = r.computerName; interior.error = undefined;
      this.live.set(r.id, { admitted: true, binding, interior }); this.send(r, { t: 'cubby.ready', ...binding, signature: '' });
    } else {
      const live = this.live.get(r.id); if (!live?.admitted) return true;
      if (f.t === 'cubby.snapshot') {
        const next = snapshot(f, this.now());
        if (!next || next.observedAt < (live.interior.observedAt ?? 0)) return true;
        Object.assign(live.interior, { agents: next.agents, plan: next.plan, needsYou: next.needsYou, observedAt: next.observedAt, error: next.error });
      } else if (f.t === 'cubby.reply') {
        if (!live.pending || live.pending.id !== f.requestId || typeof f.text !== 'string') return true;
        this.line(live, { id: id(), role: f.error ? 'notice' : 'assistant', text: short(f.text, 12000), at: this.now() }); live.pending = undefined;
      } else return true;
    }
    this.changed(); return true;
  };
}
