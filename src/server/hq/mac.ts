import { PitchDecisions } from '../pitch/decisions.js';
import { HQLiveWork, leadWorkTarget } from './live-work.js';
import type { HQLead } from '../../shared/protocol/hq.js';
import { HQTalk } from './talk.js';
import { cleanLeadStatus, type LeadStatus } from '../../shared/protocol/hq.js';
import { Pairings } from '../link/pairings.js';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Nodes } from '../nodes.js';
import type { HQ } from './index.js';
import { snapshot, short } from '../cubbies/snapshot.js';
import { macSignature, type MacProject, MAC_BYTES } from './wire.js';
import type { LeadSource } from './leads.js';
import { PitchStore } from '../pitch/store.js';
interface Record { owner: string; floor: string; nodeId: string; computerId?: string; computerName?: string; lastSeen?: number }
interface Observation { nodeId: string; computerName: string; observedAt: number; projects: MacProject[]; cofounder?: LeadStatus }
const id = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);
/** Invitations persist; observations, workers and session identities never do. */
export class HQMac {
  private records = new Map<string, Record>();
  private live = new Map<string, Observation>();
  private admitted = new Map<string, string>();
  private file: string;
  readonly talk: HQTalk;
  readonly decisions: PitchDecisions;
  readonly work: HQLiveWork;
  readonly dataDir: string;
  readonly pairings: Pairings;
  readonly pitches = new PitchStore();
  constructor(dir: string, private hq: Pick<HQ, 'owns' | 'is' | 'floorId' | 'studio'>, private nodes: Nodes, private changed: () => void, private now = Date.now) {
    this.dataDir = dir;
    this.decisions = new PitchDecisions(dir);
    this.work = new HQLiveWork(now);
    this.talk = new HQTalk(dir, owner => hq.owns(owner), owner => this.talkNode(owner), (node, frame) => nodes.sendSigned(node, () => frame), changed, now);
    this.pairings = new Pairings(owner => this.hq.owns(owner), (owner, computer, name) => this.link(owner, computer, name), id => this.remove(id), changed, now);
    this.file = path.join(dir, 'hq-macs.json');
    if (existsSync(this.file)) {
      const rows = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(rows) || rows.length > 128) throw Error('Invalid HQ Mac invitations');
      for (const r of rows) {
        if (!r || !id(r.owner) || !id(r.floor) || !id(r.nodeId) || (r.computerId !== undefined && !id(r.computerId))) throw Error('Invalid HQ Mac invitation');
        this.records.set(r.nodeId, { owner: r.owner, floor: r.floor, nodeId: r.nodeId, ...(r.computerId ? { computerId: r.computerId } : {}), computerName: short(r.computerName, 60), lastSeen: Number(r.lastSeen) || 0 });
      }
      chmodSync(this.file, 0o600);
    }
    const previous = nodes.extension;
    nodes.extension = (node, owner, raw) => this.accept(node, owner, raw) || (previous?.(node, owner, raw) ?? false);
  }
  private link(owner: string, computerId: string, computerName: string) {
    const floor = this.hqFloor();
    const invitation = this.setup(owner, floor);
    const r = [...this.records.values()].find(r => r.owner === owner && !r.computerId)!;
    r.computerId = computerId; r.computerName = computerName; r.lastSeen = this.now();
    try { this.save(); } catch (e) { this.remove(r.nodeId); throw e; }
    return { id: r.nodeId, token: invitation.token };
  }
  private hqFloor() { if (!this.hq.floorId) throw Error('HQ unavailable'); return this.hq.floorId; }
  links(owner: string) {
    if (!this.hq.owns(owner)) throw Error('Owner only');
    return [...this.records.values()].filter(r => r.owner === owner && r.computerId).map(r => ({ id: r.nodeId,
      computerName: r.computerName || 'Mac', connected: this.nodes.isOnline(r.nodeId) && this.admitted.has(r.nodeId),
      lastSeen: this.nodes.state({ id: owner }).nodes.find(n => n.id === r.nodeId)?.lastSeen || r.lastSeen || 0 }));
  }
  revoke(owner: string, id: string) {
    if (!this.hq.owns(owner) || this.records.get(id)?.owner !== owner) throw Error('Owner only');
    this.remove(id);
  }
  private remove(id: string) {
    this.work.forget(id);
    this.pairings.forgetNode(id);
    const r = this.records.get(id); this.records.delete(id); this.admitted.delete(id);
    if (r?.computerId) this.live.delete(this.key(r.owner, r.computerId));
    this.nodes.revoke(id); this.save(); this.changed();
  }
  owner() { return [...this.records.values()].find(r => this.hq.owns(r.owner))?.owner; }
  setup(owner: string, floor: string) {
    if (!this.hq.owns(owner) || !this.hq.is(floor)) throw Error('Only the HQ owner can connect a Mac from HQ');
    const old = [...this.records.values()].filter(r => r.owner === owner && !r.computerId);
    if (this.records.size - old.length >= 128) throw Error('HQ Mac invitation limit reached');
    const invite = this.nodes.invite('HQ Mac', 'private', owner, true);
    this.records.set(invite.id, { owner, floor, nodeId: invite.id });
    old.forEach(r => this.records.delete(r.nodeId));
    try { this.save(); } catch (e) {
      this.records.delete(invite.id); old.forEach(r => this.records.set(r.nodeId, r)); this.nodes.revoke(invite.id); throw e;
    }
    old.forEach(r => this.nodes.revoke(r.nodeId));
    this.changed(); return { token: invite.token, floorId: floor };
  }
  projectNode(owner: string) { return this.talkNode(owner); }
  private talkNode(owner: string) {
    return this.freshest(owner)?.record.nodeId ?? [...this.records.values()].find(r => r.owner === owner && this.admitted.has(r.nodeId) && this.nodes.isOnline(r.nodeId))?.nodeId;
  }
  cofounder(owner: string) { return this.freshest(owner)?.live.cofounder; }
  activity(owner: string, lead: HQLead) { return this.work.get(this.freshest(owner)?.record.nodeId, leadWorkTarget(lead)); }
  refresh() {
    if (this.work.sweep()) this.changed();
    this.pairings.sweep();
    this.talk.sweep(node => this.nodes.isOnline(node) && this.admitted.has(node));
    for (const node of this.admitted.keys()) if (!this.nodes.isOnline(node)) {
      const r = this.records.get(node);
      if (r) { r.lastSeen = this.now(); try { this.save(); } catch { /* live status still changes */ } }
      this.work.forget(node);
      this.admitted.delete(node);
    }
  }
  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify([...this.records.values()]), { mode: 0o600 });
    chmodSync(this.file + '.tmp', 0o600); renameSync(this.file + '.tmp', this.file);
  }
  private key(owner: string, computer: string) { return `${owner}:${computer}`; }
  freshest(owner: string) {
    return [...this.records.values()].filter(r => r.owner === owner && r.computerId && this.hq.owns(owner) && this.hq.is(r.floor))
      .flatMap(r => { const live = this.live.get(this.key(owner, r.computerId!)); return live?.nodeId === r.nodeId && this.nodes.isOnline(r.nodeId) && this.admitted.has(r.nodeId) && this.now() - live.observedAt < 60_000 ? [{ record: r, live }] : []; })
      .sort((a, b) => b.live.observedAt - a.live.observedAt)[0];
  }
  status(owner: string) {
    const fresh = this.freshest(owner);
    if (fresh) return { computerName: fresh.live.computerName, connected: true, lastSeen: fresh.live.observedAt };
    const online = this.nodes.state({ id: owner }).nodes.filter(n => n.online && this.admitted.has(n.id) && this.records.get(n.id)?.owner === owner).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    if (online) return { computerName: this.admitted.get(online.id)!, connected: true, lastSeen: online.lastSeen };
    const last = this.links(owner).sort((a,b) => b.lastSeen - a.lastSeen)[0];
    return last && { computerName: last.computerName, connected: last.connected, lastSeen: last.lastSeen };
  }
  rememberedSources(owner: string): LeadSource[] | undefined {
    if (!this.hq.owns(owner)) return;
    const live = [...this.live.values()].filter(l => this.records.get(l.nodeId)?.owner === owner).sort((a,b) => b.observedAt - a.observedAt)[0];
    return live?.projects.map(row => ({ mac: true, floorId: '', projects: [{ ...row.project, leadStatus: { status: 'off', updatedAt: live.observedAt }, departmentLeads: row.project.departmentLeads.map(d => ({ ...d, leadStatus: { status: 'off', updatedAt: live.observedAt } })) }], agents: [], computerName: live.computerName, observedAt: live.observedAt }));
  }
  projects(owner: string) { return this.freshest(owner)?.live.projects.map(p => p.project); }
  sources(owner: string): LeadSource[] | undefined {
    const fresh = this.freshest(owner); if (!fresh) return;
    const { live } = fresh;
    return live.projects.map(row => ({ mac: true, floorId: '', projects: [row.project], agents: row.agents, pitch: row.pitch,
      computerName: live.computerName, observedAt: live.observedAt }));
  }

  pitchViews(owner: string) {
    const fresh = this.freshest(owner); if (!fresh) return [];
    return fresh.live.projects.flatMap((row, i) => {
      if (row.project.localState === 'draft') return [];
      const view = this.pitches.view(`hq-mac-${fresh.record.nodeId}-${i}`, fresh.record.floor, 'hq');
      return view ? [{ ...view, pitch: this.decisions.view(owner, row.project.name, view.pitch), project: row.project.name, projectIndex: i }] : [];
    });
  }
  accept(nodeId: string, owner: string | undefined, raw: unknown): boolean {
    const r = this.records.get(nodeId);
    if (!r) return false;
    // Consume all frames for HQ invitations: they can never become cubby connections.
    if (!owner || owner !== r.owner || !this.hq.owns(owner) || !this.hq.is(r.floor) || !this.nodes.isOnline(nodeId) || !raw || typeof raw !== 'object') return true;
    const f = raw as any;
    if (f.t === 'hq.activity') {
      const projects = r.computerId ? this.live.get(this.key(owner, r.computerId))?.projects : undefined;
      if (this.work.accept(nodeId, f, this.admitted.has(nodeId), target => {
        if ('cofounder' in target) return true;
        const p = projects?.find(p => p.project.name === target.project)?.project;
        return !!p && (target.department === undefined ? p.hasMainLead : !!p.departmentLeads[target.department]);
      })) this.changed();
      return true;
    }
    if (f.t === 'project.result') { if (this.admitted.has(nodeId)) void this.hq.studio?.accept(nodeId, owner, f); return true; }
    if (f.t === 'lead.state' || f.t === 'lead.reply') {
      if (this.admitted.has(nodeId)) this.talk.accept(nodeId, owner, f);
      return true;
    }
    if (f.t === 'hq.hello' && id(f.computerId) && (!r.computerId || r.computerId === f.computerId)) {
      if (this.admitted.has(nodeId)) return true;
      const before = r.computerId; r.computerId = f.computerId; r.computerName = short(f.computerName, 60) || 'Mac'; r.lastSeen = this.now();
      try { this.save(); } catch { r.computerId = before; return true; }
      const binding = { t: 'hq.ready' as const, computerId: r.computerId!, owner, floor: r.floor, connection: randomUUID() };
      if (this.nodes.sendSigned(nodeId, key => ({ ...binding, signature: macSignature(key, binding) }))) {
        this.admitted.set(nodeId, short(f.computerName, 60) || 'Mac');
        this.changed();
      }
      return true;
    }
    if (this.admitted.has(nodeId) && f.computerId === r.computerId && f.t === 'hq.image' && Number.isInteger(f.projectIndex) && f.projectIndex >= 0 && f.projectIndex < 12) {
      const row = this.freshest(owner)?.live.projects[f.projectIndex];
      if (row) this.hq.studio?.acceptImage(owner, row.project.name, f);
      if (this.pitches.accept(`hq-mac-${nodeId}-${f.projectIndex}`, f)) this.changed();
      return true;
    }
    if (!this.admitted.has(nodeId) || f.computerId !== r.computerId || f.t !== 'hq.snapshot' || !Array.isArray(f.projects) || f.projects.length > 12 || Buffer.byteLength(JSON.stringify(f)) > MAC_BYTES ||
      !Number.isFinite(f.observedAt) || Math.abs(this.now() - f.observedAt) > 120_000) return true;
    let workers = 0;
    const projects: MacProject[] = [], seen = new Set<string>();
    for (const row of f.projects) {
      if (!row || !Array.isArray(row.agents) || (workers += row.agents.length) > 64) return true;
      const clean = snapshot({ agents: row.agents, projects: [row.project], pitch: row.pitch, draft: row.draft, observedAt: f.observedAt }, this.now());
      if (!clean?.projects?.[0]) return true;
      const { own: _own, workers: _workers, ...project } = clean.projects[0];
      // Department positions are the send target: never shift them by dropping malformed entries.
      if (project.departmentLeads.length !== row.project.departmentLeads.length) return true;
      const agents = clean.agents.filter(a => a.id.startsWith('harness:') && a.role !== 'lead' && ['working', 'idle'].includes(a.status) && !seen.has(a.id));
      agents.forEach(a => seen.add(a.id));
      projects.push({ project, agents, ...(clean.pitch ? { pitch: clean.pitch } : {}), ...(clean.draft ? { draft: clean.draft } : {}) });
    }
    this.live.set(this.key(owner, r.computerId!), { nodeId, computerName: this.admitted.get(nodeId)!, observedAt: Math.min(this.now(), f.observedAt), projects, cofounder: cleanLeadStatus(f.cofounder) });
    this.hq.studio?.sync(owner, projects);
    projects.forEach((p, i) => this.pitches.publish(`hq-mac-${nodeId}-${i}`, owner, p.pitch));
    this.pitches.retain(key => !key.startsWith(`hq-mac-${nodeId}-`) || projects.some((_, i) => key === `hq-mac-${nodeId}-${i}`));
    this.changed(); return true;
  }
}
