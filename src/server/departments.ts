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
import type { Department, DepartmentsState, DeptBriefRev, DeptPreset, DeptRole, ProjectSource } from '../shared/protocol.js';

/** Implementation writers one project staffs at a time, across all its departments. */
export const MAX_WRITERS = 2;
const MAX_BRIEF_REVS = 50;
/** Archived brief revisions kept per department, full text; older ones still count in briefArchived. */
const MAX_ARCHIVE = 200;
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
      if (Array.isArray(saved)) {
        this.departments = saved.filter(isDept);
        // A file from before monotonic revisions: number what it has, oldest first.
        for (const d of this.departments) {
          d.brief.forEach((r, i) => (r.rev ??= d.brief.length - i));
          d.rev ??= d.brief.length;
          d.briefArchived ??= 0;
        }
      }
    } catch {
      // none yet, or a broken file: the floor as it comes
    }
    try {
      const saved = JSON.parse(readFileSync(this.archiveFile, 'utf8')) as unknown;
      if (saved && typeof saved === 'object' && !Array.isArray(saved))
        for (const [id, revs] of Object.entries(saved as Record<string, unknown>)) if (Array.isArray(revs)) this.archive.set(id, revs.filter(isRev));
    } catch {
      // no archive yet
    }
  }

  state(): DepartmentsState {
    return { departments: this.departments.map((d) => ({ ...d, brief: [...d.brief], roster: [...d.roster], assets: [...d.assets] })), sources: this.sources() };
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
      const err = this.saveArchive(dept.id, [...dropping.reverse(), ...(this.archive.get(dept.id) ?? [])].slice(0, MAX_ARCHIVE));
      if (err) return err;
    }
    const briefArchived = dept.briefArchived + dropping.length;
    const next: Department = { ...dept, rev: dept.rev + 1, brief: kept, briefArchived };
    return this.commit(this.departments.map((d) => (d.id === id ? next : d)));
  }

  /** The archived brief revisions of a department, full text (newest first), and how many fell off. */
  briefHistory(id: string): { revs: DeptBriefRev[]; archived: number } | string {
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    return { revs: [...(this.archive.get(id) ?? [])], archived: dept.briefArchived };
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
      if (!REL_PATH.test(ref) || SECRET.test(ref)) return 'Not a path inside the project a worker should read';
      try {
        // The canonical path, symlinks resolved, must stay inside the checkout — and what it
        // resolves to must be something a worker should read, not a secret it points at.
        const root = realpathSync(this.projectDir);
        const abs = realpathSync(path.resolve(root, ref));
        if (abs !== root && !abs.startsWith(root + path.sep)) return 'That path leaves the project';
        if (SECRET.test(path.relative(root, abs))) return 'Not a path inside the project a worker should read';
        if (!statSync(abs).isFile()) return `Nothing readable at ${ref} in this project`;
      } catch {
        return `Nothing at ${ref} in this project`;
      }
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
    const dept = this.get(id);
    if (!dept) return 'That department is gone';
    const role = dept.roles.find((r) => r.id === roleId);
    if (!role) return 'That role is gone';
    if (role.kind === 'implementation' && this.writers(liveAgents) >= MAX_WRITERS)
      return `This project already has ${MAX_WRITERS} implementation writers — review or ship what's in flight first`;
    const brief = dept.brief[0];
    // The worker starts with the same direction the panel shows: the brief, and the current
    // brand/asset references (labels and where they are — never their contents).
    const current = dept.assets.filter((a) => a.status === 'current').slice(0, 10);
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
    const temp = `${this.archiveFile}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(path.dirname(this.archiveFile), { recursive: true, mode: 0o700 });
      this.archive.set(id, revs);
      writeFileSync(temp, JSON.stringify(Object.fromEntries(this.archive), null, 1), { mode: 0o600 });
      renameSync(temp, this.archiveFile);
    } catch (err) {
      rmSync(temp, { force: true });
      return `Couldn't preserve the brief's history: ${(err as Error).message}`;
    }
    return undefined;
  }

  /** Persists `next` and only then makes it the state; a failed save changes nothing. */
  private commit(next: Department[]): string | undefined {
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
  return typeof r.rev === 'number' && typeof r.text === 'string' && typeof r.by === 'string' && typeof r.at === 'number';
}

function isDept(v: unknown): v is Department {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = v as Partial<Department>;
  return (
    typeof d.id === 'string' &&
    (d.preset === 'marketing' || d.preset === 'product' || d.preset === 'review') &&
    typeof d.name === 'string' &&
    Array.isArray(d.desks) &&
    Array.isArray(d.roles) &&
    Array.isArray(d.brief) &&
    Array.isArray(d.roster) &&
    Array.isArray(d.assets) &&
    typeof d.by === 'string' &&
    typeof d.at === 'number'
  );
}
