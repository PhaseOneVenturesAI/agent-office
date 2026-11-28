import { studioFeedback } from './reviews.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { FloorDef } from '../building.js';
import type { DraftsState, Launched } from '../../shared/protocol/drafts.js';
import { EMPTY_BOARDS, NEW_BADGE_MS } from '../../shared/protocol/drafts.js';
import { cleanProjectCommand, cleanProjectResult, type ProjectCommand, type ProjectResult, type StudioClientMsg } from '../../shared/protocol/studio.js';
import { privateJSON } from './talk.js';
import { leadIdentity, leadsFor } from './leads.js';
import { DraftImages } from '../cubbies/design-images.js';
import { cleanDraftBoards } from '../drafts/boards.js';
import type { MacProject } from './wire.js';
interface StudioRecord { id: string; owner: string; name: string; createdAt: number; publicId?: string }
interface Pending { owner: string; node: string; frame: ProjectCommand; at: number }
/** Private floor metadata only. A Studio never has a VPS git checkout. */
export class HQStudio {
  private records = new Map<string, StudioRecord>();
  private launched = new Map<string, Launched>();
  private boards = new Map<string, MacProject>();
  private images = new Map<string, DraftImages>();
  private pending = new Map<string, Pending>();
  private rate = new Map<string, number[]>();
  private opening = new Map<string, Promise<FloorDef>>();
  private file: string;
  constructor(private ctx: Ctx) {
    this.file = path.join(ctx.cfg.dataDir, 'studio.json');
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const r of saved.records ?? []) {
        if (!/^studio-[a-f0-9]{24}$/.test(r.id) || typeof r.name !== 'string' || typeof r.owner !== 'string') throw Error('Invalid Studio record');
        this.records.set(r.id, r);
      }
      for (const [id, value] of saved.launched ?? []) this.launched.set(id, value);
    }
  }
  private save() { privateJSON(this.file, { records: [...this.records.values()], launched: [...this.launched] }); }
  enabled(owner?: string) { return !!this.ctx.cloudflare && !!owner && this.ctx.hq.owns(owner) && !!this.ctx.accounts.get(owner)?.email; }
  owns(id: string, owner?: string) { const row = this.records.get(id); return !!row && !row.publicId && row.owner === owner && this.enabled(owner); }
  is(id: string) { return this.records.has(id); }
  isNew(id: string) { const launched = this.launched.get(id); return !!launched && Date.now() < launched.at + NEW_BADGE_MS; }
  private key(owner: string, project: string) { return `studio-${createHash('sha256').update(JSON.stringify([owner, project])).digest('hex').slice(0, 24)}`; }
  private draft(owner: string, name: string) {
    const id = this.key(owner, name);
    let record = this.records.get(id);
    if (!record) { record = { id, owner, name, createdAt: Date.now() }; this.records.set(id, record); this.save(); }
    if (!record.publicId && !this.ctx.floors.has(id)) {
      const dir = path.join(this.ctx.cfg.dataDir, 'studio', id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const def = this.ctx.building.list().find(d => d.id === id) ?? this.ctx.building.addLocal({ id, dir, name, draft: true, addedBy: this.ctx.hq.ownerName, addedAt: record.createdAt });
      if (!this.ctx.openFloor(def)) throw Error('Studio saved but its floor could not open');
      this.ctx.floorsChanged();
    }
    return record;
  }
  sync(owner: string, rows: MacProject[]) {
    if (!this.enabled(owner) || !this.ctx.openFloor) return;
    for (const row of rows) {
      const id = this.key(owner, row.project.name);
      this.boards.set(id, row);
      if (row.project.localState === 'draft') {
        try { this.draft(owner, row.project.name); } catch { /* Floor capacity or disk failure: keep the snapshot; an explicit request reports the error. */ }
      }
      if (row.draft && row.project.localState === 'draft' && !this.records.get(id)?.publicId) {
        const images = this.images.get(id) ?? new DraftImages(); images.boards(row.draft); this.images.set(id, images);
      } else this.images.delete(id);
    }
  }
  acceptImage(owner: string, project: string, frame: any) {
    const id = this.key(owner, project);
    const otherBytes = [...this.images].reduce((n, [key, images]) => n + (key === id ? 0 : images.bytes), 0);
    if (this.enabled(owner)) this.images.get(id)?.accept(frame, 32 * 1024 * 1024 - otherBytes);
  }
  image(id: string, owner: string, hash: string) { return this.owns(id, owner) ? this.images.get(id)?.get(hash) : undefined; }
  state(floor: string | undefined, owner: string | undefined, fallback: DraftsState): DraftsState {
    const state: DraftsState = { ...fallback, enabled: fallback.enabled || this.enabled(owner), ...(this.ctx.hq.enabled ? { canStart: this.enabled(owner), studio: this.enabled(owner) } : {}) };
    const launched = floor && this.launched.get(floor); if (launched) { state.enabled = true; state.launched = launched; }
    if (state.here && !state.here.studio) {
      const row = owner && this.ctx.hq.owns(owner) ? this.ctx.hq.mac?.freshest(owner)?.live.projects.find(p => p.project.name === state.here!.name) : undefined;
      state.here = { ...state.here, online: !!row?.project.hasMainLead, boards: row?.draft ?? state.here.boards };
    }
    if (!floor || !this.owns(floor, owner)) return state;
    const r = this.records.get(floor)!, row = this.ctx.hq.mac?.freshest(owner!)?.live.projects.find(p => p.project.name === r.name);
    return { enabled: true, studio: true, canStart: true, canKickoff: !!row, here: { id: r.id, name: r.name, createdAt: r.createdAt, studio: true, leadName: 'Studio lead', online: !!row, boards: row?.draft ?? this.boards.get(floor)?.draft ?? EMPTY_BOARDS, designers: 0 } };
  }
  submit(c: Client, raw: StudioClientMsg) {
    if (c.out || !this.enabled(c.accountId)) throw Error('Only the HQ owner signed in through Cloudflare can use Studio');
    const owner = c.accountId!;
    if (raw.t === 'studio.feedback') {
      return studioFeedback(this.ctx, c, raw.project, raw.cardId, raw.text);
    }
    const frame = cleanProjectCommand({ ...raw, t: raw.t.replace('studio.', 'project.') });
    if (!frame) throw Error('Check the project name, repository or exact confirmation');
    const now = Date.now(), recent = (this.rate.get(owner) ?? []).filter(at => now - at < 60_000);
    if (recent.length >= 5) throw Error('Wait a minute before another project operation');
    for (const [id, p] of this.pending) if (now - p.at > 15 * 60_000) { this.pending.delete(id); this.notify(p.owner, { t: 'project.result', id, ok: false, detail: 'Mac operation timed out. Check the Mac before retrying.' }); }
    if ([...this.pending.values()].some(p => p.owner === owner)) throw Error('Wait for your current project operation');
    const node = this.ctx.hq.mac?.projectNode(owner); if (!node) throw Error('Your Mac link is offline');
    this.rate.set(owner, [...recent, now]); this.pending.set(frame.id, { owner, node, frame, at: now });
    if (!this.ctx.nodes.sendSigned(node, () => frame)) { this.pending.delete(frame.id); throw Error('Your Mac link is offline'); }
  }
  private notify(owner: string, frame: ProjectResult & { floorId?: string }) { for (const c of this.ctx.clients.values()) if (!c.out && c.accountId === owner && this.enabled(owner)) { if (frame.floorId) this.ctx.sendTo(c, { t: 'floors', floors: this.ctx.floorInfos(c) }); this.ctx.sendTo(c, frame); } }
  async accept(node: string, owner: string, raw: unknown) {
    const result = cleanProjectResult(raw), p = result && this.pending.get(result.id);
    if (!result || !p || p.owner !== owner || p.node !== node || !this.enabled(owner)) return;
    this.pending.delete(result.id);
    try {
      if (!result.ok) return this.notify(owner, result);
      if (!result.project || p.frame.t === 'project.new' && result.project !== p.frame.name || p.frame.t === 'project.open' && result.project !== p.frame.project) throw Error('Mac returned a different project');
      const floorId = p.frame.t === 'project.new' ? this.draft(owner, result.project).id : (await this.publicFloor(owner, result)).id;
      if (result.greeting) this.ctx.hq.mac?.talk.greet(owner, `project:${leadIdentity({ name: result.project, repo: p.frame.t === 'project.new' ? undefined : result.repo })}:ceo`, result.greeting);
      const { greeting: _, ...shown } = result;
      this.notify(owner, { ...shown, floorId }); this.ctx.floorsChanged();
    } catch (e) { this.notify(owner, { ...result, ok: false, detail: (e as Error).message }); }
  }
  async publicFloor(owner: string, result: ProjectResult) {
    if (!result.repo || !result.project) throw Error('Mac did not return a repository');
    const key = result.repo.toLowerCase(), old = this.opening.get(key); if (old) return old;
    const job = this.open(owner, result.project, result.repo); this.opening.set(key, job);
    try { return await job; } finally { this.opening.delete(key); }
  }
  private async open(owner: string, name: string, repo: string) {
    const existing = this.ctx.building.list().find(d => d.repo?.toLowerCase() === repo.toLowerCase());
    const def = existing ?? await this.ctx.building.add(repo, this.ctx.hq.ownerName, () => this.ctx.floorsChanged(), owner);
    if (typeof def === 'string') throw Error(`Project is ready on your Mac. ${def}`);
    const floor = this.ctx.floors.get(def.id) ?? this.ctx.openFloor(def); if (!floor) throw Error('Repository cloned but its floor could not open');
    const id = this.key(owner, name), record = this.records.get(id), board = cleanDraftBoards(this.boards.get(id)?.draft);
    if (!this.launched.has(def.id)) {
      this.launched.set(def.id, { name, repo, at: Date.now(), brand: board.brand, screens: board.screens.filter(s => s.status === 'approved').map(s => s.title) }); this.save();
      this.ctx.broadcast({ t: 'drafts.kicked', floorId: def.id, name, by: this.ctx.hq.ownerName });
      this.ctx.toFloor(floor, { t: 'gong', why: 'merged', by: this.ctx.hq.ownerName });
    }
    if (record && !record.publicId) {
      this.ctx.hq.mac?.talk.promote(owner, `project:${name}:ceo`, `project:${repo.toLowerCase()}:ceo`);
      record.publicId = def.id; this.save();
      for (const c of this.ctx.clients.values()) if (c.peer.floor === id && c.accountId === owner) this.ctx.goToFloor(c, floor);
      const draft = this.ctx.floors.get(id); if (draft) { await draft.shutdown(); this.ctx.floors.delete(id); }
      this.ctx.building.remove(id, this.ctx.hq.ownerName); this.images.delete(id);
    }
    this.ctx.floorsChanged(); return def;
  }
}
