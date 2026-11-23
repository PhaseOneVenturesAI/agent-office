// Departments: a floor's own corners of work (see shared/protocol/departments.ts), persistent in
// the floor's .agent-office/departments.json. A department is paperwork and furniture, never an
// auto-running team: creating one launches nothing. Launching a worker into a role composes the
// prompt from the department's brief and the role's skill references and seats it in the
// department's corner — through the same spawn every hire uses, with at most two implementation
// writers per project (the way a small studio actually staffs).
//
// The brief is explicit edits with history: every save appends a revision under a monotonic
// revision number, and a save naming a revision that isn't the current one is a conflict, not a
// silent overwrite. The file keeps the latest revisions; the numbers never repeat, so a gap shows
// what fell off. Asset references are jailed to the project (canonical paths, no secrets) or to
// http(s) (links). A failed save commits nothing: the in-memory state only changes after the file
// is safely on disk.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentEffort, AgentProvider } from '../shared/providers.js';
import type { Department, DepartmentsState, DeptBriefRev, DeptLead, DeptPolicy, DeptPreset, DeptRequest, DeptRole, ProjectSource } from '../shared/protocol.js';

/** Implementation writers one project staffs at a time, across all its departments. */
export const MAX_WRITERS = 2;
const MAX_BRIEF_REVS = 50;
const MAX_BRIEF = 20_000;
const MAX_ASSETS = 40;
const MAX_LABEL = 60;
const MAX_NAME = 40;
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w .@+\-/]{1,300}$/;
/** Names a project's people and agents must never be pointed at, even inside the checkout. Also the read-time rule for served assets (see server/docs.ts). */
export const SECRET = /(^|\/)(\.env(\.|$)|\.git(\/|$)|\.ssh(\/|$)|id_rsa|id_ed25519|credentials|\.npmrc$|\.netrc$)|\.(pem|key|p12|pfx)$/i;

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** The roles a preset comes with; references to the harness's actual skills, never a bundle dump. */
export const PRESETS: Record<DeptPreset, { name: string; roles: Omit<DeptRole, 'id'>[] }> = {
  marketing: {
    name: 'Marketing',
    roles: [
      { name: 'Story', kind: 'implementation', skills: ['skills/copywriting/SKILL.md', 'skills/brand-voice/SKILL.md', 'skills/product-marketing/SKILL.md'], hint: 'Own the message: positioning, headlines, the words on the page.' },
      { name: 'Art & frontend', kind: 'implementation', skills: ['skills/frontend-design/SKILL.md', 'skills/creative-delivery/SKILL.md'], hint: 'Own how it looks: layout, visual system, the page itself.' },
      { name: 'Film', kind: 'implementation', skills: ['skills/video/SKILL.md', 'skills/remotion-best-practices/SKILL.md', 'skills/ffmpeg/SKILL.md'], hint: 'Own the video: script, shots, the cut.' },
      { name: 'Review', kind: 'review', skills: ['skills/brand-gate/SKILL.md', 'skills/cro/SKILL.md'], hint: 'Judge takes against the brief and the brand; stage verdicts in the Review Room.' },
    ],
  },
  product: {
    name: 'Product & Engineering',
    roles: [
      { name: 'Builder', kind: 'implementation', skills: [], hint: 'Build the scoped change; open a PR when it lands.' },
      { name: 'Reviewer', kind: 'review', skills: [], hint: 'Review the PRs and the staged work; say what must change.' },
    ],
  },
  review: {
    name: 'Review',
    roles: [
      { name: 'Reviewer', kind: 'review', skills: ['skills/brand-gate/SKILL.md'], hint: 'Work the Review Room and the boards; verdicts with reasons.' },
      { name: 'Second look', kind: 'support', skills: [], hint: 'Re-check what passed: does the evidence actually support it?' },
    ],
  },
};

/** Instruction sources a project offers; listed, never read out. */
const SOURCE_CANDIDATES = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'docs'];

export class Departments {
  private departments: Department[] = [];
  /** The brief revisions that fell off the kept history, full text, by department (newest first). */
  private archive = new Map<string, DeptBriefRev[]>();
  private loadError?: string;
  private readonly file: string;
  private readonly archiveFile: string;

  constructor(
    dataDir: string,
    private projectDir: string,
    private onChange: () => void,
  ) {
    this.file = path.join(dataDir, 'departments.json');
    this.archiveFile = path.join(dataDir, 'departments-brief-archive.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved) || !saved.every(isDept)) throw new Error('Invalid department state');
      this.departments = saved;
      // Preserve the pre-versioning format without filtering any saved records.
      for (const d of this.departments) {
        d.brief.forEach((r, i) => (r.rev ??= d.brief.length - i));
        d.rev ??= d.brief.length;
        d.briefArchived ??= 0;
        // A malformed lead or policy is dropped from the live view; the file is rewritten clean on
        // the next real change, and a stale live link self-heals at launch time.
        if (d.lead && (typeof d.lead.name !== 'string' || !d.lead.name || typeof d.lead.by !== 'string' || !Number.isFinite(d.lead.at))) delete d.lead;
        if (d.lead?.objective && (typeof d.lead.objective.text !== 'string' || !d.lead.objective.text || typeof d.lead.objective.by !== 'string' || !Number.isFinite(d.lead.objective.at))) delete d.lead.objective;
        if (d.policy && (typeof d.policy.provider !== 'string' || (d.policy.mode !== 'policy' && d.policy.mode !== 'ask'))) delete d.policy;
        if (d.requests && (!Array.isArray(d.requests) || d.requests.some((r) => !r || typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.task !== 'string' || typeof r.by !== 'string' || !Number.isFinite(r.at)))) delete d.requests;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = "Couldn't load departments; preserving the original file. Repair it and reload the floor.";
    }
    try {
      const saved = JSON.parse(readFileSync(this.archiveFile, 'utf8')) as unknown;
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
          !Object.values(saved).every((revs) => Array.isArray(revs) && revs.every(isRev)))
        throw new Error('Invalid department archive');
      this.archive = new Map(Object.entries(saved as Record<string, DeptBriefRev[]>));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = "Couldn't load department history; preserving the original files. Repair them and reload the floor.";
    }
  }

  state(): DepartmentsState {
    return { departments: this.departments.map((d) => ({ ...d, brief: [...d.brief], roster: [...d.roster], assets: [...d.assets] })), sources: this.sources(), ...(this.loadError ? { error: this.loadError } : {}) };
  }

  get(id: string): Department | undefined {
    return this.departments.find((d) => d.id === id);
  }

  /** A new department from a preset: paperwork only, nothing launches. */
  add(preset: DeptPreset, name: unknown, by: string): Department | string {
    const p = PRESETS[preset];
    if (!p) return 'Unknown department preset';
    if (this.departments.some((d) => d.preset === preset)) return `${p.name} is already on this floor`;
    const dept: Department = {
      id: randomBytes(4).toString('hex'),
      preset,
      name: oneLine(String(name ?? ''), MAX_NAME) || p.name,
      rev: 0,
      desks: [],
      roles: p.roles.map((r) => ({ ...r, id: randomBytes(3).toString('hex') })),
      brief: [],
      roster: [],
      assets: [],
      briefArchived: 0,
      by,
      at: Date.now(),
    };
    const err = this.commit([...this.departments, dept]);
    if (err) return err;
    return dept;
  }

  /** Off the floor; refused while workers of its roster are still at desks. */
  remove(id: string, live: (workerId: string) => boolean): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const staffed = dept.roster.filter((r) => live(r.workerId));
    if (staffed.length) return `Send its ${staffed.length} worker${staffed.length === 1 ? '' : 's'} home first`;
    return this.commit(this.departments.filter((d) => d.id !== id));
  }

  /** Appends a brief revision; `base` must be the revision number the editor saw, or it's a conflict. */
  brief(id: string, text: string, base: number, by: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    if (base !== dept.rev) return 'Someone changed the brief since you opened it — reload it and try again';
    const clean = text.trim();
    if (!clean) return 'An empty brief says nothing — write a line first';
    if (clean.length > MAX_BRIEF) return `The brief is over ${Math.ceil(MAX_BRIEF / 1000)} KB — keep it to what a worker must know`;
    const nextRev = { rev: dept.rev + 1, text: clean, by, at: Date.now() };
    const kept = [nextRev, ...dept.brief].slice(0, MAX_BRIEF_REVS);
    // What the kept history drops is archived in full, never silently: the archive file gets it
    // before the state changes, or the whole edit is refused.
    const dropping = [nextRev, ...dept.brief].slice(MAX_BRIEF_REVS);
    if (dropping.length) {
      const err = this.saveArchive(dept.id, [...dropping.reverse(), ...(this.archive.get(dept.id) ?? [])]);
      if (err) return err;
    }
    const briefArchived = dept.briefArchived + dropping.length;
    const next: Department = { ...dept, rev: dept.rev + 1, brief: kept, briefArchived };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** Page retained historical text, newest first; only the response is bounded, never storage. */
  briefHistory(id: string, before?: number): { revs: DeptBriefRev[]; archived: number; next?: number } | string {
    if (this.loadError) return this.loadError;
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    if (before !== undefined && (!Number.isInteger(before) || before < 1)) return 'Invalid history cursor';
    // An archive write can precede a failed main-state save. Keep its durable copy, but do not
    // show the same revision twice while it is still in the current state's retained window.
    const kept = new Set(dept.brief.map((r) => r.rev));
    const all = (this.archive.get(id) ?? []).filter((r) => !kept.has(r.rev) && (before === undefined || r.rev < before));
    const revs = all.slice(0, MAX_BRIEF_REVS);
    return { revs, archived: dept.briefArchived, ...(all.length > revs.length ? { next: revs.at(-1)!.rev } : {}) };
  }

  /** A brand/asset reference: a real file inside the project (no secrets), or an http(s) link. */
  addAsset(id: string, ask: { label: unknown; kind: unknown; ref: unknown; status: unknown }, by: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    if (dept.assets.length >= MAX_ASSETS) return `The library holds ${MAX_ASSETS} references — retire a historical one first`;
    const label = oneLine(String(ask.label ?? ''), MAX_LABEL);
    if (!label) return 'Say what it is: a label';
    if (ask.kind !== 'file' && ask.kind !== 'link') return 'A reference is a file in the project or a link';
    const ref = String(ask.ref ?? '').trim();
    if (ask.kind === 'file') {
      const error = this.referenceError(ref);
      if (error) return error;
    } else {
      try {
        const u = new URL(ref);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
      } catch {
        return 'A link has to be an http(s) URL';
      }
    }
    const status = ask.status === 'historical' ? 'historical' : 'current';
    const next: Department = { ...dept, assets: [...dept.assets, { id: randomBytes(3).toString('hex'), label, kind: ask.kind, ref, status, by, at: Date.now() }] };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** Recheck stored references at use time: aliases may have changed since registration. */
  private referenceError(ref: string): string | undefined {
    if (!REL_PATH.test(ref) || SECRET.test(ref)) return 'Not a path inside the project a worker should read';
    try {
      const root = realpathSync(this.projectDir);
      const abs = realpathSync(path.resolve(root, ref));
      const relative = path.relative(root, abs).split(path.sep).join('/');
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return 'That path leaves the project';
      if (SECRET.test(relative)) return 'Not a path inside the project a worker should read';
      const info = statSync(abs);
      if (!info.isFile()) return `Nothing readable at ${ref} in this project`;
      if (info.nlink !== 1) return 'Not a path inside the project a worker should read';
      return undefined;
    } catch { return `Nothing at ${ref} in this project`; }
  }

  dropAsset(id: string, asset: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    if (!dept.assets.some((a) => a.id === asset)) return 'That reference is gone';
    const next: Department = { ...dept, assets: dept.assets.filter((a) => a.id !== asset) };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /**
   * Live implementation writers on the floor: the rostered ones, plus every other live agent at a
   * desk — an unrostered worker still writes, so it counts toward the project's cap.
   */
  writers(liveAgents: () => string[]): number {
    const ids = liveAgents();
    const rostered = new Set(this.departments.flatMap((d) => d.roster.map((r) => r.workerId)));
    let n = 0;
    for (const d of this.departments)
      for (const r of d.roster) {
        const role = d.roles.find((x) => x.id === r.role);
        if (role?.kind === 'implementation' && ids.includes(r.workerId)) n++;
      }
    for (const id of ids) if (!rostered.has(id)) n++;
    return n;
  }

  /**
   * The launch a role means: the prompt the worker starts with (brief + role + skill references +
   * the task), or why it can't launch. The caller does the actual spawn and then recordsHire.
   * `liveAgents` is re-asked here, so a check made just before the spawn is fresh.
   */
  composeLaunch(id: string, roleId: string, task: string | undefined, liveAgents: () => string[]): { prompt: string; role: DeptRole } | string {
    if (this.loadError) return this.loadError;
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const role = dept.roles.find((r) => r.id === roleId);
    if (!role) return 'That role is gone';
    if (role.kind === 'implementation' && this.writers(liveAgents) >= MAX_WRITERS)
      return `This project already has ${MAX_WRITERS} implementation writers — review or ship what's in flight first`;
    const brief = dept.brief[0];
    // The worker starts with the same direction the panel shows: the brief, and the current
    // brand/asset references (labels and where they are — never their contents).
    const current = dept.assets.filter((a) => a.status === 'current' && (a.kind === 'link' || !this.referenceError(a.ref))).slice(0, 10);
    const lines = [
      `You are the ${role.name} of the ${dept.name} department on this project.`,
      role.hint,
      role.kind === 'implementation' ? '' : 'You review and advise: you don’t write the page or the code yourself — your verdicts and reasons go to the Review Room.',
      brief ? `Department brief (rev ${brief.rev}, by ${brief.by}):\n${brief.text}` : 'The department has no brief yet — ask what "good" means before producing work.',
      current.length ? `Current brand & asset references:\n${current.map((a) => `- ${a.label}: ${a.kind === 'file' ? `${a.ref} (in this project)` : a.ref}`).join('\n')}` : '',
      role.skills.length ? `Relevant skills (read them from your skills/ directory when present): ${role.skills.join(', ')}` : '',
      'When a take is ready, stage exactly one link in the Review Room (office-workers review <url> --title …).',
      task ? `Task: ${task}` : '',
    ].filter(Boolean);
    return { prompt: lines.join('\n\n'), role };
  }

  /** A hired worker joins the roster, and its desk joins the corner. */
  recordHire(id: string, roleId: string, workerId: string, deskId: string, by: string): void {
    const dept = this.get(id);
    if (!dept) return;
    const next: Department = { ...dept, roster: [...dept.roster, { workerId, role: roleId, by, at: Date.now() }], desks: dept.desks.includes(deskId) ? dept.desks : [...dept.desks, deskId] };
    this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** A worker off the roster (it keeps its desk). */
  release(id: string, workerId: string): void {
    const dept = this.get(id);
    if (!dept || !dept.roster.some((r) => r.workerId === workerId)) return;
    const next: Department = { ...dept, roster: dept.roster.filter((r) => r.workerId !== workerId) };
    this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** Names (or replaces) the lead identity and its saved engine; never launches anything. */
  setLead(id: string, ask: { name: unknown; provider?: AgentProvider; model?: string; effort?: AgentEffort }, by: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const name = oneLine(String(ask.name ?? ''), MAX_NAME);
    if (!name) return 'Give the lead a name';
    // Replacing the identity under a live worker is refused; refreshing the saved engine is not.
    if (dept.lead?.workerId && name !== dept.lead.name) return `${dept.lead.name} is on shift — send their worker home before replacing them`;
    const lead: DeptLead = { name, by, at: Date.now() };
    if (ask.provider !== undefined) lead.provider = ask.provider;
    if (ask.model !== undefined) lead.model = ask.model;
    if (ask.effort !== undefined) lead.effort = ask.effort;
    const next: Department = { ...dept, lead };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** Takes the lead identity away; its worker, when live, keeps its desk as a normal worker. */
  clearLead(id: string): string | undefined {
    const dept = this.get(id);
    if (!dept?.lead) return 'That department has no lead';
    const workerId = dept.lead.workerId;
    const next: Department = {
      ...dept,
      lead: undefined,
      roster: workerId ? dept.roster.filter((r) => !(r.role === 'lead' && r.workerId === workerId)) : dept.roster,
    };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** The team engine policy: 'policy' runs it silently, 'ask' shows the picker prefilled from it. */
  setPolicy(id: string, ask: { provider: AgentProvider; model?: string; effort?: AgentEffort; mode: 'policy' | 'ask' }, by: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const policy: DeptPolicy = { provider: ask.provider, mode: ask.mode, by, at: Date.now() };
    if (ask.model !== undefined) policy.model = ask.model;
    if (ask.effort !== undefined) policy.effort = ask.effort;
    const next: Department = { ...dept, policy };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /**
   * The lead's shift: the prompt its worker starts with, or why it can't start. The lead orchestrates
   * — it never takes an implementation seat, so it doesn't count against the writer cap. A lead whose
   * worker is live is resumed (Talk), never duplicated; a stale workerId (its worker went home) is
   * cleared here so the identity can take a new shift.
   */
  composeLeadLaunch(id: string, task: string | undefined, liveAgents: () => string[]): { prompt: string; lead: DeptLead } | string {
    if (this.loadError) return this.loadError;
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const lead = dept.lead;
    if (!lead) return 'Name a lead first';
    if (lead.workerId && liveAgents().includes(lead.workerId)) return `${lead.name} is already on shift — talk to them instead`;
    if (lead.workerId) {
      const next: Department = { ...dept, lead: { ...lead, workerId: undefined } };
      this.commit(this.departments.map((d) => (d.id === id ? next : d)));
      lead.workerId = undefined;
    }
    const brief = dept.brief[0];
    const current = dept.assets.filter((a) => a.status === 'current' && (a.kind === 'link' || !this.referenceError(a.ref))).slice(0, 10);
    const lines = [
      `You are ${lead.name}, the ${dept.name} department's lead in this office.`,
      'You orchestrate: you don’t take an implementation seat yourself. At most two implementation writers work this project at a time, and review specialists serve you.',
      'Hire only into your department’s roles, through office-workers or by asking to have the role seated; give every hire the brief and its skill references. Delegate work through the floor queue so the project keeps one task source, and never assign the same job twice.',
      'Watch your team and report to the person who talks to you: progress, finished results, and blockers — a worker stopped on a question says what it needs and who it is.',
      brief ? `Department brief (rev ${brief.rev}, by ${brief.by}):\n${brief.text}` : 'The department has no brief yet — ask what "good" means before producing work.',
      current.length ? `Current brand & asset references:\n${current.map((a) => `- ${a.label}: ${a.kind === 'file' ? `${a.ref} (in this project)` : a.ref}`).join('\n')}` : '',
      'Takes are judged in the Review Room: stage exactly one link per take (office-workers review <url> --title …).',
      task ? `Task: ${task}` : '',
    ].filter(Boolean);
    return { prompt: lines.join('\n\n'), lead };
  }

  /** The lead's shift seat: its worker joins the roster under the pseudo-role 'lead', desk joins the corner. */
  recordLeadHire(id: string, workerId: string, deskId: string, by: string): void {
    const dept = this.get(id);
    if (!dept?.lead) return;
    const next: Department = {
      ...dept,
      lead: { ...dept.lead, workerId },
      roster: [...dept.roster, { workerId, role: 'lead', by, at: Date.now() }],
      desks: dept.desks.includes(deskId) ? dept.desks : [...dept.desks, deskId],
    };
    this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** The lead's engine as saved, or the policy's, for prefilling the next launch. */
  leadChoice(id: string): { provider?: AgentProvider; model?: string; effort?: AgentEffort } | undefined {
    const lead = this.get(id)?.lead;
    if (!lead) return undefined;
    return { ...(lead.provider !== undefined ? { provider: lead.provider } : {}), ...(lead.model !== undefined ? { model: lead.model } : {}), ...(lead.effort !== undefined ? { effort: lead.effort } : {}) };
  }

  /** An agent-triggered delegation under an 'ask' policy waits here for a person's engine decision. */
  addRequest(id: string, ask: { title: unknown; task: unknown; by: string }): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const title = oneLine(String(ask.title ?? ''), 200);
    const task = String(ask.task ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 20_000);
    if (!title || !task) return 'Give the delegation a title and the task';
    const requests = dept.requests ?? [];
    if (requests.length >= 10) return 'Too many pending requests — approve or reject some first';
    if (requests.some((r) => r.title === title)) return 'That request is already waiting for a decision';
    const next: Department = { ...dept, requests: [...requests, { id: randomBytes(3).toString('hex'), title, task, by: ask.by, at: Date.now() }] };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** Takes a pending request out (an approval seats it); a string says why it can't be taken. */
  takeRequest(id: string, request: string): DeptRequest | string {
    const dept = this.get(id);
    const found = dept?.requests?.find((r) => r.id === request);
    if (!dept || !found) return 'That request is gone';
    const next: Department = { ...dept, requests: dept.requests!.filter((r) => r.id !== request) };
    const err = this.commit(this.departments.map((d) => (d.id === id ? next : d)));
    return err ?? found;
  }

  /** Drops a pending request (a rejection). */
  dropRequest(id: string, request: string): string | undefined {
    const dept = this.get(id);
    if (!dept?.requests?.some((r) => r.id === request)) return 'That request is gone';
    const next: Department = { ...dept, requests: dept.requests.filter((r) => r.id !== request) };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** The department whose live lead is this worker, when there is one (parent ownership checks). */
  leadDeptOfWorker(workerId: string): Department | undefined {
    return this.departments.find((d) => d.lead?.workerId === workerId);
  }

  /** The CEO's scoped objective for this manager; results and blockers roll up to it. */
  setObjective(id: string, text: unknown, by: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 4000);
    if (!clean) return 'Say what the manager is to achieve';
    const next: Department = { ...dept, lead: dept.lead ? { ...dept.lead, objective: { text: clean, by, at: Date.now() } } : undefined };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  clearObjective(id: string): string | undefined {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    if (!dept.lead?.objective) return undefined;
    const next: Department = { ...dept, lead: { ...dept.lead, objective: undefined } };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** After a swap lands: the lead identity and roster rows move from the old worker to the replacement. */
  relinkWorker(fromId: string, toId: string): void {
    let changed = false;
    const next = this.departments.map((d) => {
      let dept = d;
      if (d.lead?.workerId === fromId) {
        dept = { ...dept, lead: { ...dept.lead!, workerId: toId } };
        changed = true;
      }
      if (d.roster.some((r) => r.workerId === fromId)) {
        dept = { ...dept, roster: dept.roster.map((r) => (r.workerId === fromId ? { ...r, workerId: toId } : r)) };
        changed = true;
      }
      return dept;
    });
    if (changed) this.commit(next);
  }

  /** The project's instruction sources, live-checked; paths and sizes only, never contents. */
  private sources(): ProjectSource[] {
    return SOURCE_CANDIDATES.map((p) => {
      try {
        const abs = path.resolve(this.projectDir, p);
        if (!abs.startsWith(path.resolve(this.projectDir) + path.sep)) return { path: p, exists: false };
        const st = statSync(abs);
        return { path: p, exists: true, ...(st.isFile() ? { size: st.size } : {}) };
      } catch {
        return { path: p, exists: false };
      }
    });
  }

  /** Persists the archive for one department; a failed save changes nothing. */
  private saveArchive(id: string, revs: DeptBriefRev[]): string | undefined {
    if (this.loadError) return this.loadError;
    const temp = `${this.archiveFile}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(path.dirname(this.archiveFile), { recursive: true, mode: 0o700 });
      const next = new Map(this.archive);
      // Retrying after an archive save but failed main-state save must not duplicate a decision.
      const unique = [...new Map(revs.map((r) => [r.rev, r])).values()].sort((a, b) => b.rev - a.rev);
      next.set(id, unique);
      writeFileSync(temp, JSON.stringify(Object.fromEntries(next), null, 1), { mode: 0o600 });
      renameSync(temp, this.archiveFile);
      this.archive = next;
    } catch (err) {
      rmSync(temp, { force: true });
      return `Couldn't preserve the brief's history: ${(err as Error).message}`;
    }
    return undefined;
  }

  /** Persists `next` and only then makes it the state; a failed save changes nothing. */
  private commit(next: Department[]): string | undefined {
    if (this.loadError) return this.loadError;
    const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, JSON.stringify(next, null, 1), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (err) {
      rmSync(temp, { force: true });
      return `Couldn't save the departments: ${(err as Error).message}`;
    }
    this.departments = next;
    this.onChange();
    return undefined;
  }
}

function isRev(v: unknown): v is DeptBriefRev {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Partial<DeptBriefRev>;
  return Number.isSafeInteger(r.rev) && r.rev! > 0 && typeof r.text === 'string' && typeof r.by === 'string' && Number.isFinite(r.at);
}

function isDept(v: unknown): v is Department {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = v as Partial<Department>;
  return (
    typeof d.id === 'string' &&
    (d.preset === 'marketing' || d.preset === 'product' || d.preset === 'review') &&
    typeof d.name === 'string' &&
    Array.isArray(d.desks) && d.desks.every((v) => typeof v === 'string') &&
    Array.isArray(d.roles) && d.roles.every((r) => r && typeof r.id === 'string' && typeof r.name === 'string' && ['implementation', 'review', 'support'].includes(r.kind) && typeof r.hint === 'string' && Array.isArray(r.skills) && r.skills.every((v) => typeof v === 'string')) &&
    Array.isArray(d.brief) && d.brief.every((r) => r && isRev({ ...r, rev: r.rev ?? 1 })) &&
    (d.rev === undefined || (Number.isSafeInteger(d.rev) && d.rev >= 0)) &&
    (d.briefArchived === undefined || (Number.isSafeInteger(d.briefArchived) && d.briefArchived >= 0)) &&
    Array.isArray(d.roster) && d.roster.every((r) => r && typeof r.workerId === 'string' && typeof r.role === 'string' && typeof r.by === 'string' && Number.isFinite(r.at)) &&
    Array.isArray(d.assets) && d.assets.every((a) => a && typeof a.id === 'string' && typeof a.label === 'string' && ['file', 'link'].includes(a.kind) && typeof a.ref === 'string' && ['current', 'historical'].includes(a.status) && typeof a.by === 'string' && Number.isFinite(a.at)) &&
    (d.lead === undefined || (d.lead && typeof d.lead === 'object' && typeof d.lead.name === 'string' && (d.lead.workerId === undefined || typeof d.lead.workerId === 'string') && typeof d.lead.by === 'string' && Number.isFinite(d.lead.at) && (d.lead.objective === undefined || (typeof d.lead.objective === 'object' && typeof d.lead.objective.text === 'string' && typeof d.lead.objective.by === 'string' && Number.isFinite(d.lead.objective.at))))) &&
    (d.policy === undefined || (d.policy && typeof d.policy === 'object' && typeof d.policy.provider === 'string' && ['policy', 'ask'].includes(d.policy.mode) && typeof d.policy.by === 'string' && Number.isFinite(d.policy.at))) &&
    (d.requests === undefined || (Array.isArray(d.requests) && d.requests.every((r) => r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.task === 'string' && typeof r.by === 'string' && Number.isFinite(r.at)))) &&
    typeof d.by === 'string' &&
    typeof d.at === 'number'
  );
}
