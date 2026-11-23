// Departments (see server/departments.ts): a floor's own corners of work — Marketing,
// Product & Engineering, Review — persistent per project. A department is furniture plus
// paperwork: a name, a brief with explicit revision history, roles that carry skill references,
// the desks of its corner, a brand/asset reference library, and a roster of the workers hired
// into it. It never launches agents by itself, and it is not a project lead or a team.

import type { AgentEffort, AgentProvider } from '../providers.js';

export type DeptPreset = 'marketing' | 'product' | 'review';

/** What a role's worker mainly does; the office caps implementation writers per project. */
export type DeptRoleKind = 'implementation' | 'review' | 'support';

export interface DeptRole {
  id: string;
  /** e.g. "Story". */
  name: string;
  kind: DeptRoleKind;
  /** Skill references the role should read when present (paths under the harness's skills/). */
  skills: string[];
  /** One line of guidance that goes into a launch prompt. */
  hint: string;
}

/** One brief revision; an edit appends, it never rewrites. The number is monotonic per department. */
export interface DeptBriefRev {
  rev: number;
  text: string;
  by: string;
  at: number;
}

/** A brand or asset reference, project-scoped. Files live in the checkout; links are http(s). */
export interface DeptAsset {
  id: string;
  label: string;
  kind: 'file' | 'link';
  /** A path inside the project, or a URL. */
  ref: string;
  status: 'current' | 'historical';
  by: string;
  at: number;
}

/** A worker hired into the department, explicitly. */
export interface DeptRosterEntry {
  workerId: string;
  role: string;
  by: string;
  at: number;
}

/**
 * The department's lead: one persistent identity that talks to the person and orchestrates the
 * department's real workers (see docs/department-leads.md). `workerId` is set only while the lead's
 * worker is live; the identity survives restarts and its worker going home.
 */
export interface DeptLead {
  /** e.g. "Maya". */
  name: string;
  /** The live worker speaking for the lead, when its shift is running. */
  workerId?: string;
  /** The engine the lead last ran on; the next launch offers it as the saved default. */
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  /** The CEO's current objective for this manager, when one is active; results roll up to it. */
  objective?: { text: string; by: string; at: number };
  /** Human controller emails: may edit the manager and give it major objectives. */
  controllers?: string[];
  /** Emails allowed read-only Q&A; empty/absent means any signed-in colleague may ask. */
  audience?: string[];
  /** Billing/credential custodian for this manager's runs (visible, never inferred). */
  custodian?: string;
  /** Effective autonomy label ('off' when unset). Informational until the provider supports it. */
  autonomy?: string;
  by: string;
  at: number;
}

/** The department's team engine policy: chosen once, used for lead launches and delegations. */
export interface DeptPolicy {
  provider: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  /** 'policy': use this silently. 'ask': the picker shows each time, prefilled from this. */
  mode: 'policy' | 'ask';
  by: string;
  at: number;
}

/**
 * A delegation the engine policy held for a person: an agent-triggered delegation under an 'ask'
 * policy cannot choose an engine itself, so it waits here until someone approves it (picking the
 * engine) or rejects it.
 */
export interface DeptRequest {
  id: string;
  title: string;
  task: string;
  /** The lead worker that asked. */
  by: string;
  at: number;
}

export interface Department {
  id: string;
  preset: DeptPreset;
  name: string;
  /** The desks of its corner; workers launched for it sit here when they're free. */
  desks: string[];
  /** The current brief revision number: monotonic, never reused; the base a brief edit names. */
  rev: number;
  roles: DeptRole[];
  /** Newest first. The file keeps the latest revisions; `briefArchived` counts the ones that fell off. */
  brief: DeptBriefRev[];
  /** How many older brief revisions are retained in the archive. */
  briefArchived: number;
  roster: DeptRosterEntry[];
  assets: DeptAsset[];
  /** The department's lead, when one has been named; one at most, resumed rather than duplicated. */
  lead?: DeptLead;
  /** The team engine policy for lead launches and delegations. */
  policy?: DeptPolicy;
  /** Engine decisions waiting for a person (agent-triggered delegations under an 'ask' policy). */
  requests?: DeptRequest[];
  by: string;
  at: number;
}

/** An instruction source the project offers its workers (detected in the checkout, never read out). */
export interface ProjectSource {
  path: string;
  exists: boolean;
  size?: number;
}

export interface DepartmentsState {
  /** A failed load disables mutations rather than replacing retained data. */
  error?: string;
  departments: Department[];
  sources: ProjectSource[];
}

export type DepartmentsClientMsg =
  /** Add a department from a preset. Creates paperwork only — never a worker. */
  | { t: 'departments.add'; preset: DeptPreset; name?: string }
  /** Take it off the floor; refused while its roster has live workers. */
  | { t: 'departments.remove'; id: string }
  /** Append a brief revision; `base` is the revision number the editor saw (conflict check). */
  | { t: 'departments.brief'; id: string; text: string; base: number }
  /** Ask for the archived brief revisions (the older retained revisions, full text). */
  | { t: 'departments.brief.history'; id: string; before?: number }
  /** Add a brand/asset reference. */
  | { t: 'departments.asset'; id: string; label: string; kind: 'file' | 'link'; ref: string; status: 'current' | 'historical' }
  | { t: 'departments.asset.drop'; id: string; asset: string }
  /** Hire a worker into a role: a desk in its corner, the brief and skills in its prompt. */
  | { t: 'departments.launch'; id: string; role: string; prompt?: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Take a worker off the roster (the worker itself stays). */
  | { t: 'departments.release'; id: string; workerId: string }
  /** Name (or replace) the department's lead identity and its saved engine. Never launches. */
  /** Name (or replace) the lead identity and its saved engine; never launches. */
  | { t: 'departments.lead'; id: string; name: string; provider?: AgentProvider; model?: string; effort?: AgentEffort; autonomy?: string }
  /** Admins: set who controls a manager, who may ask it read-only questions, and the billing custodian. */
  | { t: 'departments.access'; id: string; controllers?: string[]; audience?: string[]; custodian?: string }
  /** Take the lead identity away (a live lead worker keeps its desk). */
  | { t: 'departments.lead.clear'; id: string }
  /** Start the lead's shift explicitly: seats its worker with the lead prompt on the policy engine. */
  | { t: 'departments.lead.launch'; id: string; prompt?: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Set the team engine policy: 'policy' runs it silently, 'ask' shows the picker prefilled from it. */
  | { t: 'departments.policy'; id: string; provider: AgentProvider; model?: string; effort?: AgentEffort; mode: 'policy' | 'ask' }
  /** The lead delegates a job to the floor queue: the project's one task source, deduped per department. */
  | { t: 'departments.delegate'; id: string; title: string; task: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Approve a pending engine request: seats the delegation on the picked engine (a person decides). */
  | { t: 'departments.request.approve'; id: string; request: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Reject a pending engine request: the delegation is dropped. */
  | { t: 'departments.request.reject'; id: string; request: string }
  /** A read-only staff question about the department: answered on a separate no-tools session. */
  | { t: 'departments.ask'; id: string; question: string };

export type DepartmentsServerMsg =
  | { t: 'departments'; state: DepartmentsState }
  /** The archived brief revisions of one department, as asked (newest first). */
  | { t: 'departments.brief.history'; id: string; revs: DeptBriefRev[]; archived: number; next?: number }
  /** The answer to a read-only staff question (separate no-tools session), or why it's unavailable. */
  | { t: 'departments.qa'; id: string; question: string; answer: string; at: number };
