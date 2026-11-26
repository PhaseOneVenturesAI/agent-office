import { PitchStore } from '../pitch/store.js';
import { validVerdict } from '../../shared/pitch/clean.js';
import type { PitchVerdictMessage } from '../../shared/protocol/pitch.js';
import { DraftImages } from './design-images.js';
import { boardFeedbackBytes, FEEDBACK_FULL } from '../drafts/feedback-budget.js';
import { BOARD_TOO_BIG } from './publication.js';
import { DRAFT_LIMITS, EMPTY_BOARDS, type DraftFeedbackMessage, type DraftBoards } from '../../shared/protocol/drafts.js';
import { randomBytes } from 'node:crypto';
import type { Look } from '../../shared/avatar.js';
import { sanitizeLook, lookFromSeed } from '../../shared/avatar.js';
import type { CubbyBinding, CubbyChatLine, CubbyDevice, CubbyDeviceAction, CubbyDeviceRequest, CubbyInterior, CubbiesState, CubbyRelayFrame, CubbyOwnerMessage } from '../../shared/protocol/cubbies.js';
import type { Nodes, NodeExtension } from '../nodes.js';
import { CubbyRecords, type CubbyRecord } from './records.js';
import { HALL_SLOTS } from '../../shared/cubbyhall.js';
import { relaySignature } from './wire.js';
import { devicesOf, short, snapshot } from './snapshot.js';
import { CubbySharing, watcherInterior } from './sharing.js';
interface Live { admitted: boolean; binding: CubbyBinding; interior: CubbyInterior; draft?: DraftBoards; verdicts?: Map<string, number>; feedback?: Map<string, number>; pending?: { id: string; at: number }; asks?: Map<string, string>; }
const id = () => randomBytes(12).toString('hex');

/** No transcript files, provider credentials, collectors or process launchers on the server. */
export class Cubbies {
  private pitches = new PitchStore();
  readonly records: CubbyRecords;
  private live = new Map<string, Live>();
  private sharing: CubbySharing;
  private images = new Map<string, DraftImages>();
  private deviceRequests = new Map<string, number[]>();
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
  dropDraftImages(floorId: string): void { this.images.delete(floorId); }
  draftImage(floorId: string, owner: string, hash: string) {
    if (!this.enabled || !this.floorExists(floorId) || this.draftOwner(floorId) !== owner || !this.accountName(owner)) {
      if (!this.floorExists(floorId) || this.draftOwner(floorId) === undefined) this.dropDraftImages(floorId);
      return;
    }
    return this.images.get(floorId)?.get(hash);
  }
  feedback(floorId: string, owner: string, message: DraftFeedbackMessage) {
    if (this.draftOwner(floorId) !== owner || !this.floorExists(floorId)) throw Error('No such draft');
    const r = [...this.records.rows.values()].find(r => r.floorId === floorId && r.owner === owner && r.slot === 0);
    if (!r) throw Error('Connect your computer to leave feedback');
    const { live } = this.ownerLink(floorId, owner, r.id);
    const { cardId, text, requestId, at, ownerSig } = message;
    if (typeof cardId !== 'string' || !/^[\w-]{1,64}$/.test(cardId) ||
      ![...live.draft?.ideas ?? [], ...live.draft?.screens ?? []].some(c => c.id === cardId) ||
      typeof text !== 'string' || !text.trim() || text.length > DRAFT_LIMITS.feedbackText ||
      typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId) || !Number.isSafeInteger(at) ||
      typeof ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(ownerSig)) throw Error('Sign feedback for a current board card on your device');
    if (live.draft && boardFeedbackBytes(live.draft) >= DRAFT_LIMITS.feedbackBytes) {
      this.line(live, { id: id(), role: 'notice', text: FEEDBACK_FULL, at: this.now() });
      this.changed();
      throw Error(FEEDBACK_FULL);
    }
    const pending = live.feedback ??= new Map();
    for (const [id, time] of pending) if (this.now() - time > 12 * 60_000) pending.delete(id);
    if (pending.has(requestId) || pending.size >= 40) throw Error('Feedback already sent or too many notes awaiting replies');
    const frame: CubbyRelayFrame = { t: 'cubby.feedback', ...live.binding, cardId, text, requestId, at, ownerSig, signature: '' };
    pending.set(requestId, this.now());
    if (!this.send(r, frame)) { pending.delete(requestId); throw Error('Your computer disconnected; feedback was not queued'); }
  }
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
  verdict(floorId: string, owner: string, cubbyId: string, message: PitchVerdictMessage) {
    const { r, live } = this.ownerLink(floorId, owner, cubbyId);
    const pitch = this.pitches.view(r.id, floorId, live.binding.computerId)?.pitch;
    if (!validVerdict(message) || !pitch || pitch.version !== message.version || !pitch.pieces.some(p => p.id === message.pieceId) ||
      typeof message.ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(message.ownerSig)) throw Error('Sign a verdict for the current pitch');
    const pending = live.verdicts ??= new Map();
    for (const [id, time] of pending) if (this.now() - time > 12 * 60_000) pending.delete(id);
    if (pending.has(message.requestId) || pending.size >= 40) throw Error('Verdict already sent or too many notes awaiting replies');
    const { pieceId, version, verdict, note, requestId, at, ownerSig } = message;
    const frame: CubbyRelayFrame = { t: 'cubby.verdict', ...live.binding, pieceId, version, verdict, ...(note !== undefined ? { note } : {}), requestId, at, ownerSig, signature: '' };
    pending.set(requestId, this.now());
    if (!this.send(r, frame)) { pending.delete(requestId); throw Error('Your computer disconnected; verdict was not queued'); }
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
    if (previous) { this.dropDraftImages(floorId); this.pitches.drop(previous.id); this.live.delete(previous.id); this.nodes.revoke(previous.nodeId); }
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
  /** From a device that isn't trusted yet: ask the owner's computer to trust its key. Only the computer decides. */
  addDevice(floorId: string, owner: string, cubbyId: string, publicKey: unknown, label: unknown) {
    const { r, live } = this.ownerLink(floorId, owner, cubbyId);
    if (typeof publicKey !== 'string' || !/^[A-Za-z0-9_-]{100,160}$/.test(publicKey)) throw Error('This device’s key is not valid');
    const now = this.now();
    for (const [account, times] of this.deviceRequests) {
      const recent = times.filter(at => now - at < 60_000);
      if (recent.length && this.accountName(account)) this.deviceRequests.set(account, recent);
      else this.deviceRequests.delete(account);
    }
    const recent = this.deviceRequests.get(owner) ?? [];
    if (recent.length >= 4) throw Error('You can request at most 4 devices per minute. Wait a minute and try again.');
    this.deviceRequests.set(owner, [...recent, now]);
    const frame: CubbyRelayFrame = { t: 'cubby.device-request', ...live.binding, requestId: id(), at: now, publicKey, label: short(label, 40) || 'Device', signature: '' };
    if (!this.send(r, frame)) throw Error('Your computer disconnected; try again when it’s back');
  }
  /** A trusted device approves, denies or removes a device. Its signature is checked on the computer, not here. */
  device(floorId: string, owner: string, cubbyId: string, a: Partial<CubbyDeviceAction>) {
    const { r, live } = this.ownerLink(floorId, owner, cubbyId);
    if (!['add', 'deny', 'revoke'].includes(a.action as string) || typeof a.target !== 'string' || a.target.length > 200 ||
      typeof a.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(a.requestId) || !Number.isSafeInteger(a.at) ||
      typeof a.ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(a.ownerSig)) throw Error('Sign the change on a device your computer trusts');
    const frame: CubbyRelayFrame = { t: 'cubby.device', ...live.binding, action: a.action as CubbyDeviceAction['action'], target: a.target, requestId: a.requestId, at: a.at!, ownerSig: a.ownerSig, signature: '' };
    if (!this.send(r, frame)) throw Error('Your computer disconnected; try again when it’s back');
  }
  private ownerLink(floorId: string, owner: string, cubbyId: string) {
    const r = this.records.rows.get(cubbyId), live = this.live.get(cubbyId);
    if (!this.enabled || !r || r.floorId !== floorId || r.owner !== owner || !this.accountName(owner)) throw Error('Only the cubby’s owner can add or remove its devices');
    if (!live?.admitted || !this.nodes.isOnline(r.nodeId)) throw Error('Your computer is asleep. Devices are added on it, so wake it first');
    return { r, live };
  }
  /** Node disconnects, expiry and revocation immediately clear the chat admission. */
  refresh() {
    for (const floorId of this.images.keys()) {
      const owner = this.draftOwner(floorId);
      if (!this.floorExists(floorId) || owner === undefined || !this.accountName(owner) ||
        ![...this.records.rows.values()].some(r => r.floorId === floorId && r.owner === owner)) this.dropDraftImages(floorId);
    }
    for (const [key, live] of this.live) {
      this.expire(live);
      const r = this.records.rows.get(key);
      if (!r || !this.nodes.isOnline(r.nodeId)) {
        live.admitted = false;
        live.interior.error = 'Computer disconnected. Work stays on that computer.';
        live.pending = undefined;
      }
    }
    this.sharing.refresh();
    this.changed();
  }
  private expire(live: Live) {
    // Native turns have a ten-minute deadline; this only releases the UI, never dispatches a retry.
    if (!live.pending || this.now() - live.pending.at < 12 * 60_000) return;
    this.line(live, { id: id(), role: 'notice', text: 'The lead did not reply in time. Check its local conversation before sending again; no automatic retry was made.', at: this.now() });
    live.pending = undefined;
  }
  private empty(r: CubbyRecord): CubbyInterior { return { computerName: r.computerName ?? 'Your computer', leadName: r.leadName, look: r.look, agents: [], plan: [], needsYou: [], chat: [] }; }
  /** A device's "asks to talk" note goes once its request is settled, however it was settled (here or on the computer). */
  private devices(live: Live, devices: CubbyDevice[], requests: CubbyDeviceRequest[], note?: string) {
    const before = live.interior.deviceRequests ?? [], trusted = new Set((live.interior.ownerDevices ?? []).map(d => d.fingerprint));
    const waiting = new Set(requests.map(r => r.requestId)), settled = before.filter(r => !waiting.has(r.requestId));
    live.interior.ownerDevices = devices; live.interior.deviceRequests = requests;
    const stale = new Set(settled.flatMap(r => live.asks?.get(r.requestId) ?? []));
    if (stale.size) live.interior.chat = live.interior.chat.filter(l => !stale.has(l.id));
    for (const r of settled) live.asks?.delete(r.requestId);
    if (note) {
      const line = id(); this.line(live, { id: line, role: 'notice', text: note, at: this.now() });
      const fresh = requests.filter(r => !before.some(b => b.requestId === r.requestId));
      if (fresh.length === 1) (live.asks ??= new Map()).set(fresh[0].requestId, line);
    } else {
      const added = devices.filter(d => !trusted.has(d.fingerprint));
      for (const r of settled) if (added.some(d => d.label === r.label)) this.line(live, { id: id(), role: 'notice', text: `✅ ${r.label} can talk to your lead now.`, at: this.now() });
    }
  }
  private line(live: Live, line: CubbyChatLine) { live.interior.chat = [...live.interior.chat, line].slice(-40); }
  private send(r: CubbyRecord, frame: CubbyRelayFrame) { return this.nodes.sendSigned(r.nodeId, key => ({ ...frame, signature: relaySignature(key, frame) })); }
  private extension: NodeExtension = (nodeId, owner, raw) => {
    if (!this.enabled || !owner || !this.accountName(owner) || !raw || typeof raw !== 'object') return false;
    const f = raw as Record<string, unknown>;
    if (typeof f.t !== 'string' || !f.t.startsWith('cubby.')) return false;
    const r = [...this.records.rows.values()].find(r => r.nodeId === nodeId && r.owner === owner && r.floorId === f.floorId);
    if (!r || !this.floorExists(r.floorId)) return true;
    if (f.t === 'cubby.hello') {
      this.images.get(r.floorId)?.reconnect(); this.pitches.reconnect(r.id);
      if (typeof f.computerId !== 'string' || !/^[\w-]{8,128}$/.test(f.computerId) || (r.computerId && r.computerId !== f.computerId)) return true;
      if ([...this.records.rows.values()].some(other => other.id !== r.id && other.owner === owner && other.floorId === r.floorId && other.computerId === f.computerId)) return true;
      r.computerId = f.computerId; r.computerName = short(f.computerName, 60) || 'Your computer'; this.records.save();
      const binding = { cubbyId: r.id, floorId: r.floorId, ownerId: owner, connectionId: id(), computerId: r.computerId };
      const interior = this.live.get(r.id)?.interior ?? this.empty(r); interior.computerName = r.computerName; interior.computerId = r.computerId; interior.ownerDevices = interior.deviceRequests = undefined; interior.error = undefined;
      const live = { admitted: false, binding, interior, draft: this.live.get(r.id)?.draft };
      this.live.set(r.id, live);
      live.admitted = this.send(r, { t: 'cubby.ready', ...binding, signature: '' });
    } else {
      const live = this.live.get(r.id); if (!live?.admitted) return true;
      if (f.t === 'cubby.design-image') {
        const pitchChanged = this.pitches.accept(r.id, f);
        const draftChanged = this.draftOwner(r.floorId) === owner && this.images.get(r.floorId)?.accept(f);
        if (!pitchChanged && !draftChanged) return true;
      } else if (f.t === 'cubby.devices') {
        const next = devicesOf(f, this.now());
        if (!next) return true;
        this.devices(live, next.devices, next.requests, next.note);
      } else if (f.t === 'cubby.snapshot') {
        const next = snapshot(f, this.now());
        if (!next || next.observedAt < (live.interior.observedAt ?? 0)) return true;
        if (this.draftOwner(r.floorId) === owner) {
          live.draft = next.draft ?? (next.error === BOARD_TOO_BIG ? live.draft : undefined) ?? EMPTY_BOARDS;
          let images = this.images.get(r.floorId);
          if (!images) this.images.set(r.floorId, images = new DraftImages());
          images.boards(live.draft);
        } else { live.draft = undefined; this.dropDraftImages(r.floorId); }
        if (next.error !== BOARD_TOO_BIG) this.pitches.publish(r.id, next.pitch);
        Object.assign(live.interior, { agents: next.agents, plan: next.plan, needsYou: next.needsYou, observedAt: next.observedAt, error: next.error });
        if (next.wake) this.line(live, { id: id(), role: 'notice', text: `💤→☀️ ${next.wake}`, at: this.now() });
      } else if (f.t === 'cubby.reply') {
        if (typeof f.text !== 'string') return true;
        if (typeof f.requestId === 'string' && live.verdicts?.has(f.requestId)) {
          if (this.now() - live.verdicts.get(f.requestId)! <= 12 * 60_000) {
            this.pitches.notice(r.id, f.requestId, f.text);
            if (!f.error) live.verdicts.delete(f.requestId);
            this.changed();
          }
          return true;
        }
        if (typeof f.requestId === 'string' && live.feedback?.has(f.requestId)) {
          if (this.now() - live.feedback.get(f.requestId)! <= 12 * 60_000) {
            this.line(live, { id: id(), role: f.error ? 'notice' : 'assistant', text: short(f.text, 12000), at: this.now() });
            if (!f.error) live.feedback.delete(f.requestId);
            this.changed();
          }
          return true;
        }
        if (!live.pending || live.pending.id !== f.requestId) return true;
        this.line(live, { id: id(), role: f.error ? 'notice' : 'assistant', text: short(f.text, 12000), at: this.now() }); live.pending = undefined;
      } else return true;
    }
    this.changed(); return true;
  };
}
