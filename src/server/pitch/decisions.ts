import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { privateJSON } from '../hq/talk.js';
import { pitchSpend, pickText, costText } from '../../shared/pitch/flow.js';
import type { Pitch, PitchAction, PitchCost } from '../../shared/protocol/pitch.js';
interface Decision { picked?: string; costs: PitchCost[]; ready?: boolean }
/** Reservations survive snapshots, reconnects and Office restarts. Only the lead reports spending. */
export class PitchDecisions {
  private rows: Record<string, Decision> = Object.create(null);
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'pitch-decisions.json');
    if (existsSync(this.file)) this.rows = JSON.parse(readFileSync(this.file, 'utf8'));
  }
  private key(owner: string, project: string, p: Pitch) { return JSON.stringify([owner, project, p.department, p.version]); }
  private save() { privateJSON(this.file, this.rows); }
  view(owner: string, project: string, p: Pitch): Pitch {
    const key = this.key(owner, project, p);
    let row = this.rows[key];
    for (const c of p.costs ?? []) if (c.status === 'spent' && !row?.costs.some(saved => saved.id === c.id)) {
      row ??= { costs: [] }; row.costs.push({ ...c }); this.rows[key] = row; this.save();
    }
    const costs = (p.costs ?? []).map(c => ({ ...c }));
    if (row) for (const saved of row.costs) {
      const i = costs.findIndex(c => c.id === saved.id), published = costs[i];
      const spent = Math.max(saved.spent ?? 0, published?.spent ?? 0);
      const cost = { ...saved, ...(spent ? { spent } : {}), ...(published?.status === 'spent' ? { status: 'spent' as const } : {}) };
      // Never release an OK reservation because a later publication omitted or renamed its card.
      if (i < 0) costs.push(cost); else costs[i] = cost;
      if (JSON.stringify(saved) !== JSON.stringify(cost)) { Object.assign(saved, cost); this.save(); }
    }
    return { ...p, ...(row?.picked ? { picked: row.picked } : {}), ...(p.costs || row?.costs.length ? { costs } : {}) };
  }
  act(owner: string, project: string, p: Pitch, msg: PitchAction, send: (text: string) => void) {
    const key = this.key(owner, project, p), previous = this.rows[key];
    const current = this.view(owner, project, p);
    const row: Decision = structuredClone(this.rows[key] ?? { costs: [] });
    let text: string;
    if (msg.action === 'pick') {
      const d = p.directions?.find(d => d.id === msg.id);
      if (!d || current.picked) throw Error('Choose one current direction; a direction is already picked or unavailable');
      row.picked = d.id; text = pickText(d.id, d.title);
    } else {
      const cost = current.costs?.find(c => c.id === msg.id);
      if (!cost || cost.status !== 'asked' || row.costs.some(c => c.id === cost.id)) throw Error('Choose a current unanswered cost card');
      if (msg.action === 'ok' && (!p.budget || cost.estimate > pitchSpend(current).remaining)) throw Error('This cost exceeds the remaining session budget');
      row.costs.push({ ...cost, status: msg.action === 'ok' ? 'ok' : 'declined' });
      text = costText(cost, msg.action === 'ok');
    }
    this.rows[key] = row; this.save();
    try { send(text); } catch (e) {
      if (previous) this.rows[key] = previous; else delete this.rows[key];
      this.save(); throw e;
    }
  }
  ready(owner: string, project: string, p: Pitch) {
    if (p.status !== 'ready') return false;
    const key = this.key(owner, project, p), row = this.rows[key] ?? { costs: [] };
    if (row.ready) return false;
    row.ready = true; this.rows[key] = row; this.save(); return true;
  }
}
