// The floor's CEO (see shared/protocol/ceo.ts and docs/department-leads.md): one persistent identity
// per project, stored in the floor's .agent-office/ceo.json — never a cross-floor role. The CEO is
// a real worker seated through the same spawn as every hire; they direct the department managers,
// who delegate the actual workers through the floor queue. The CEO orchestrates: no implementation
// seat, no second task ledger, and a manager is only ever started through the supported signed-in
// owner path, explicitly.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentEffort, AgentProvider } from '../shared/providers.js';
import type { CeoIdentity, CeoState } from '../shared/protocol.js';

const MAX_NAME = 40;

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export class FloorCeo {
  private ceo: CeoIdentity | undefined;
  private loadError?: string;
  private readonly file: string;

  constructor(dataDir: string, private onChange: () => void) {
    this.file = path.join(dataDir, 'ceo.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (saved && typeof saved === 'object' && !Array.isArray(saved) && isCeo(saved)) this.ceo = saved;
      else throw new Error('Invalid CEO state');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = "Couldn't load the CEO; preserving the original file. Repair it and reload the floor.";
    }
  }

  state(): CeoState {
    return { ...(this.ceo ? { ceo: { ...this.ceo } } : {}), ...(this.loadError ? { error: this.loadError } : {}) };
  }

  /** Name (or replace) the CEO identity and its saved engine; never launches anything. */
  set(ask: { name: unknown; provider?: AgentProvider; model?: string; effort?: AgentEffort; autonomy?: string; owner?: string }, by: string): string | undefined {
    if (this.loadError) return this.loadError;
    const name = oneLine(String(ask.name ?? ''), MAX_NAME);
    if (!name) return 'Give the CEO a name';
    // Replacing the identity under a live worker is refused; refreshing the saved engine is not —
    // and it must keep the live link, or a duplicate shift could be launched under the new save.
    if (this.ceo?.workerId && name !== this.ceo.name) return `${this.ceo.name} is on shift — send their worker home before replacing them`;
    const next: CeoIdentity = { ...(this.ceo ?? { name, by, at: Date.now() }), name, by, at: Date.now() };
    if (ask.provider !== undefined) next.provider = ask.provider;
    if (ask.model !== undefined) next.model = ask.model;
    if (ask.effort !== undefined) next.effort = ask.effort;
    if (ask.autonomy !== undefined) next.autonomy = ask.autonomy;
    if (ask.owner !== undefined) next.owner = ask.owner.trim().toLowerCase() || undefined;
    return this.commit(next);
  }

  /** Takes the identity away; a live CEO worker keeps its desk as a normal worker. */
  clear(): string | undefined {
    if (!this.ceo) return 'This floor has no CEO yet';
    const workerId = this.ceo.workerId;
    const err = this.commit(undefined);
    void workerId;
    return err;
  }

  get(): CeoIdentity | undefined {
    return this.ceo;
  }

  /** Whether this worker is the live CEO (the hook's assignment authorization). */
  isCeoWorker(workerId: string): boolean {
    return this.ceo?.workerId === workerId;
  }

  /** The shift: the prompt the CEO's worker starts with, or why it can't start. */
  composeLaunch(task: string | undefined, liveAgents: () => string[]): { prompt: string; ceo: CeoIdentity } | string {
    if (this.loadError) return this.loadError;
    const ceo = this.ceo;
    if (!ceo) return 'Name a CEO first';
    if (ceo.workerId && liveAgents().includes(ceo.workerId)) return `${ceo.name} is already on shift — talk to them instead`;
    if (ceo.workerId) {
      // Their worker went home: the identity resumes on a fresh shift, the stale link cleared.
      this.commit({ ...ceo, workerId: undefined });
      ceo.workerId = undefined;
    }
    const lines = [
      `You are ${ceo.name}, the CEO of this project floor.`,
      'You direct the department managers — Marketing, Product & Engineering, Review — and never take an implementation seat yourself. At most two implementation writers work this project at a time.',
      'Assign a manager a scoped objective with office-workers assign --dept <preset> --title "…" (pass the objective on stdin); pass execute only when the person has explicitly asked you to start the manager. Managers delegate the actual workers through the floor queue on their team engine policy — you never hire or delegate workers yourself.',
      'Managers report results and blockers to you; only a decision that truly needs the person (permissions, approvals, budget, direction) escalates out of the office — say what is needed and who it is for.',
      task ? `First objective: ${task}` : '',
    ].filter(Boolean);
    return { prompt: lines.join('\n\n'), ceo };
  }

  /** The CEO's worker takes their seat; the identity remembers them while the shift runs. */
  recordHire(workerId: string, by: string): void {
    if (!this.ceo) return;
    this.commit({ ...this.ceo, workerId });
    void by;
  }

  /** The saved engine, for prefilling the next launch. */
  savedChoice(): { provider?: AgentProvider; model?: string; effort?: AgentEffort } | undefined {
    const ceo = this.ceo;
    if (!ceo) return undefined;
    return { ...(ceo.provider !== undefined ? { provider: ceo.provider } : {}), ...(ceo.model !== undefined ? { model: ceo.model } : {}), ...(ceo.effort !== undefined ? { effort: ceo.effort } : {}) };
  }

  /** After a swap lands, the identity follows the replacement worker; routing keeps working. */
  relinkWorker(fromId: string, toId: string): string | undefined {
    if (this.ceo?.workerId !== fromId) return;
    return this.commit({ ...this.ceo, workerId: toId });
  }

  /** Persists `next` and only then makes it the state; a failed save changes nothing. */
  private commit(next: CeoIdentity | undefined): string | undefined {
    if (this.loadError) return this.loadError;
    const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      if (next === undefined) {
        if (existsSync(this.file)) rmSync(this.file);
      } else {
        writeFileSync(temp, JSON.stringify(next, null, 1), { mode: 0o600 });
        renameSync(temp, this.file);
      }
    } catch (err) {
      rmSync(temp, { force: true });
      return `Couldn't save the CEO: ${(err as Error).message}`;
    }
    this.ceo = next;
    this.onChange();
    return undefined;
  }
}

function isCeo(v: unknown): v is CeoIdentity {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Partial<CeoIdentity>;
  return typeof c.name === 'string' && !!c.name && (c.workerId === undefined || typeof c.workerId === 'string') && (c.owner === undefined || typeof c.owner === 'string') && (c.autonomy === undefined || typeof c.autonomy === 'string') && typeof c.by === 'string' && Number.isFinite(c.at);
}
