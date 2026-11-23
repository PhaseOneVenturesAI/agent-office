import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChangesState, FloorInfo, PeerInfo, ProjectInfo, ServerMsg, WorkerInfo } from '../shared/protocol.js';
import { isBusy } from '../shared/status.js';
import { DESK_BY_ID, nextFreeSeat } from '../shared/layout.js';
import type { AgentEffort, AgentProvider } from '../shared/providers.js';
import type { FloorDef } from './building.js';
import { excludeFromGit } from './config.js';
import { agentProviders, configuredProvider } from './agents.js';
import { WorkerManager, workedMs, type HookEnv, type RunAs } from './workers.js';
import { GitHub, MergeWatch } from './github.js';
import type { GhAs } from './signins.js';
import { TaskQueue } from './queue.js';
import { Changes } from './changes.js';
import { Decor } from './decor.js';
import { FloorPlanStore } from './floorplan.js';
import { Departments, MAX_WRITERS } from './departments.js';
import { FloorCeo } from './ceo.js';
import { LeadDispatch } from './dept-dispatch.js';
import { Docs } from './docs.js';
import { Dog } from './dog.js';
import { Court } from './court.js';
import { Jail } from './jail.js';
import { Garage } from './garage.js';
import { Jukebox } from './jukebox.js';
import { Whiteboard } from './whiteboard.js';
import { MeetingRoom } from './meetings.js';
import { Worktrees, type WorktreeCleanup } from './worktrees.js';
import { landedWork, landedWorkers, type Landed } from './leave-on-merge.js';
import type { Ledger } from './usage.js';
import type { Capacity } from './machine.js';
import { officePrompt, type PromptSource } from './prompts.js';

type ToastLevel = 'info' | 'warn' | 'error';

/** What a floor needs from the building around it. */
export interface FloorContext {
  agentCmd: string;
  agentArgs: string[];
  /** The DSH profile DeepSeek Harness workers boot (see server/dsh.ts). */
  dshProfile: string;
  hook: HookEnv;
  /** Spend, across every floor. */
  ledger: Ledger;
  /** The office's worker limit, across every floor. */
  capacity: Capacity;
  /** The office's prompts and the worker everyone starts on, as set in ⚙️ Settings. */
  prompts: PromptSource;
  /** Workers hired by an account run on its own sign-ins (see signins.ts). */
  runAs?: RunAs;
  /** How to run gh as an account: its own sign-in, the office's (undefined), or why it can't. */
  ghAs(owner: string | undefined): GhAs | undefined | string;
  /** To everyone on this floor. */
  emit(floor: Floor, msg: ServerMsg, droppable?: boolean): void;
  toast(floor: Floor, text: string, level?: ToastLevel): void;
  /** A worker's terminal output, for whoever has that terminal open. */
  termData(workerId: string, data: string, viewers: string[]): void;
  /** What a worker changed, for whoever has its Changes window open. */
  changes(state: ChangesState, clients: string[]): void;
  /** A worker on this floor changed, or left (then just its id). */
  workerChanged(floor: Floor, w: WorkerInfo | string): void;
  /** How many people are on this floor right now. */
  people(floor: Floor): number;
  /** Who's on this floor, and where they stand. */
  peers(floor: Floor): PeerInfo[];
  /** ⚙️ Settings: a worker whose pull request merged goes home by itself. */
  leaveOnMerge(): boolean;
  /** Another floor of the building: a worker across repositories works in its project too (see WorkerInfo.repos). */
  floor(id: string): Floor | undefined;
  /** This floor's pull requests came back: a worker on another floor with a repository here may have landed. */
  pullsChanged(floor: Floor): void;
  /** Whether a worker on another floor works in this floor's project too. */
  lent(floor: Floor): boolean;
  /** Whether the building's map locks up workers sent home (see MapPlan.sendHome), instead of letting them go. */
  locksUp(): boolean;
}

/** The open pull request on a floor's board whose head is `branch`. */
function openPull(floor: Floor, branch: string): { number: number; url: string } | undefined {
  const pr = floor.github.pulls.items.find((p) => p.state === 'OPEN' && p.headRefName === branch);
  return pr ? { number: pr.number, url: pr.url } : undefined;
}

/** How long after a PR list or a worker's change the office looks for workers whose PR merged. */
const LANDED_DELAY_MS = 1500;
/** Boards on a floor nobody is on, with nothing running, are asked GitHub about this seldom. */
const IDLE_REFRESH_MS = 10 * 60_000;
const REFRESH_MS = 90_000;

/** What `git` says about a checkout: its name, branch and origin for the top bar. */
export function projectInfo(dir: string, name: string, agentCmd: string, agentArgs: string[]): ProjectInfo {
  const git = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  return {
    name,
    dir,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    remote: git(['remote', 'get-url', 'origin']),
    agentCmd: [agentCmd, ...agentArgs].join(' '),
    defaultProvider: configuredProvider(agentCmd),
    agentProviders: agentProviders(configuredProvider(agentCmd)),
  };
}

const WRITING = new Set(['starting', 'idle', 'working', 'needs_input']);

/**
 * One floor of the building: a project's checkout with its own desks and workers, issues and PR
 * boards, task queue, pictures and jukebox, all kept in that checkout's .agent-office folder.
 */
export class Floor {
  readonly id: string;
  readonly dir: string;
  readonly project: ProjectInfo;
  readonly workers: WorkerManager;
  readonly github: GitHub;
  readonly queue: TaskQueue;
  readonly changes: Changes;
  readonly decor: Decor;
  /** The signs over its desks, and how far its back office is built out. */
  readonly plan: FloorPlanStore;
  readonly departments: Departments;
  /** The floor's CEO: one persistent identity per project, directing the managers (see ceo.ts). */
  readonly ceo: FloorCeo;
  /** The lead dispatch: child transitions become messages in the lead's own session. */
  readonly dispatch: LeadDispatch;
  readonly jukebox: Jukebox;
  /** The whiteboard everyone on the floor draws on together. */
  readonly whiteboard: Whiteboard;
  /** The meeting room, where workers work through a question together (see meetings.ts). */
  readonly meetings: MeetingRoom;
  /** The bookshelf: the project's Markdown files (see docs.ts). */
  readonly docs: Docs;
  /** Settles once the workers whose terminals outlived the last office are picked back up, and the rest woken. */
  readonly ready: Promise<void>;
  readonly dog: Dog;
  /** The basketball by the hoop: who has it, or how it was last thrown. */
  readonly court = new Court();
  /** The cars in the garage: who's in which, and where their drivers have left them. */
  readonly garage = new Garage();
  /** Workers sent home on a map that locks them up (see MapPlan.sendHome). */
  readonly jail: Jail;
  private timer: NodeJS.Timeout;
  /** Pull requests merging, to ring the gong for. */
  private merges = new MergeWatch();
  /** A look for workers whose pull request merged, due shortly (see sendLandedHome). */
  private landedTimer?: NodeJS.Timeout;
  /** Workers across repositories whose worktrees are being checked before they go home. */
  private landing = new Set<string>();

  constructor(
    readonly def: FloorDef,
    private ctx: FloorContext,
  ) {
    this.id = def.id;
    this.dir = def.dir;
    const dataDir = path.join(def.dir, '.agent-office');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    excludeFromGit(def.dir);
    this.project = projectInfo(def.dir, def.name, ctx.agentCmd, ctx.agentArgs);
    this.docs = new Docs(def.dir);
    // Before the workers and the dog: the back office's desks are only there once it's built.
    this.plan = new FloorPlanStore(dataDir);
    this.departments = new Departments(dataDir, def.dir, () =>
      ctx.emit(this, { t: 'departments', state: this.departments.state() }),
    );
    this.ceo = new FloorCeo(dataDir, () => ctx.emit(this, { t: 'ceo', state: this.ceo.state() }));
    this.jail = new Jail(dataDir);

    // Before the workers, so it hears about the ones who wake up needing input.
    this.dog = new Dog(def.id, dataDir, {
      workers: () => this.workers?.list() ?? [],
      people: () => ctx.peers(this),
      send: (dog) => ctx.emit(this, { t: 'dog', dog }),
      wing: () => this.plan.wing,
    });

    this.workers = new WorkerManager(
      def.dir,
      dataDir,
      ctx.agentCmd,
      ctx.agentArgs,
      ctx.hook,
      {
        update: (worker) => {
          ctx.emit(this, { t: 'worker.update', worker });
          // Still being built: the first updates come from waking the workers already at their desks.
          this.queue?.onWorker(worker);
          // After the queue reconciled the task, so a child's notice sees the final outcome.
          this.dispatch?.onWorker(worker);
          this.meetings?.onWorker(worker);
          this.dog.onWorker(worker);
          ctx.workerChanged(this, worker);
          // Its turn ended, or whoever had its terminal open closed it: it may be free to go now.
          this.sendLandedHome();
        },
        remove: (workerId, info) => {
          this.changes?.forget(workerId);
          // Sent home on a map that keeps workers (the castle locks them up, the station puts them out
          // of its airlock): it's kept, for good (a meeting's workers aren't sent home when it's over,
          // just let go).
          const jail = info && !info.meeting && ctx.locksUp() ? this.jail.add({ ...info, workedMs: workedMs(info) }) : undefined;
          ctx.emit(this, { t: 'worker.remove', workerId, ...(jail ? { jail } : {}) });
          this.queue?.onWorkerGone(workerId);
          this.meetings?.onWorkerGone(workerId);
          this.dispatch?.onWorkerGone(workerId);
          // A swap's unfinished business goes with it: a reserved source takes its idle replacement
          // home; a replacement that died frees the source to try again.
          if (info?.swap?.replacementId) void this.sendHome(info.swap.replacementId);
          else this.workers.handoffs.freeReplacement(workerId);
          this.dog.onWorkerGone(workerId);
          ctx.workerChanged(this, workerId);
        },
        data: (workerId, data, viewers) => ctx.termData(workerId, data, viewers),
        screen: (workerId, frame) => ctx.emit(this, { t: 'screen', workerId, ...frame }, true),
        toast: (text, level) => ctx.toast(this, text, level),
      },
      ctx.ledger,
      ctx.capacity,
      ctx.prompts,
      ctx.runAs,
      ctx.dshProfile,
    );
    this.workers.wing = () => this.plan.wing;

    this.github = new GitHub(
      def.dir,
      (state) => ctx.emit(this, { t: 'gh.issues', state }),
      (state) => {
        ctx.emit(this, { t: 'gh.pulls', state });
        this.queue?.onPulls(state.items);
        if (state.loading || state.error) return;
        // A worker may have opened one from a branch it made itself, mid-turn or from a shell.
        void this.workers.syncBranches();
        for (const p of this.merges.look(state.items)) {
          ctx.toast(this, `🎉 PR #${p.number} merged: ${p.title}`);
          this.merged(p.number);
        }
        this.sendLandedHome();
        ctx.pullsChanged(this);
      },
    );
    // The 📋 task queue seats workers by itself: it watches the workers and links PRs from GitHub.
    this.queue = new TaskQueue(dataDir, this.workers, !!this.project.branch, {
      update: (state) => {
        ctx.emit(this, { t: 'queue', state });
        // A task's pull request may just have been linked (or merged).
        this.sendLandedHome();
      },
      toast: (text, level) => ctx.toast(this, text, level),
      claimIssue: (issue, owner) => {
        const as = ctx.ghAs(owner);
        return typeof as === 'string' ? Promise.resolve(as) : this.github.claim(issue, as);
      },
      refreshGitHub: () => void this.github.refresh(),
      hiringPaused: () => ctx.ledger.hiringPaused,
      room: () => ctx.capacity.room(),
      writersFull: () => this.writerCap(),
      finished: (task) => this.dispatch?.onTaskFinished(task),
      emptied: () => {
        ctx.toast(this, '📋 The queue is empty: every task is done 🎉');
        ctx.emit(this, { t: 'gong', why: 'queue' });
      },
      worktreeNote: () => officePrompt(ctx.prompts, 'queue.worktree'),
    });

    // The lead dispatch: children of a department (delegated tasks' workers) report transitions to
    // the lead's own session. Reads the queue's reconciled state, so it is wired after the queue.
    this.dispatch = new LeadDispatch({
      get: (id) => this.workers.get(id),
      prompt: (id, text) => this.workers.prompt(id, text, 'office'),
      tasks: () => this.queue.state().tasks,
      departments: () => this.departments.state().departments,
      ceo: () => this.ceo.get(),
    });

    // Meetings seat their own workers round the meeting room's table and run them round by round.
    const workers = this.workers;
    this.meetings = new MeetingRoom(
      def.dir,
      dataDir,
      {
        defaultProvider: this.workers.defaultProvider,
        get officeDefault() {
          return workers.officeDefault;
        },
        list: () => this.workers.list(),
        seat: (deskId, by, prompt, provider, model, effort, meeting, owner) => this.workers.spawn(deskId, by, prompt, false, 'agent', provider, model, effort, meeting, owner),
        prompt: (id, text, by) => this.workers.prompt(id, text, by),
        write: (id, data, by) => this.workers.write(id, data, by),
        kill: (id) => this.workers.kill(id),
      },
      this.project.branch ? new Worktrees(def.dir) : undefined,
      {
        update: (state) => ctx.emit(this, { t: 'meeting', state }),
        toast: (text, level) => ctx.toast(this, text, level),
        hiringPaused: () => ctx.ledger.hiringPaused,
        postReview: (pr, file, owner) => {
          const as = ctx.ghAs(owner);
          return typeof as === 'string' ? Promise.reject(new Error(as)) : this.github.review(pr, file, as);
        },
        prompt: (id) => ctx.prompts.text(id),
      },
    );

    // What each worker changed, for the Changes window at its desk (see changes.ts).
    this.changes = new Changes(
      def.dir,
      this.project.branch,
      (workerId, repo) => {
        const w = this.workers.get(workerId);
        if (!w) return undefined;
        if (!repo) return { name: w.name, cwd: w.worktree ? path.join(def.dir, w.worktree.path) : def.dir, rel: w.worktree?.path ?? '', worktreeBase: w.worktree?.base };
        // One of the other floors' repositories it works in: diffed against, and PRs opened against, that floor's branch.
        const r = w.repos?.find((x) => x.floor === repo);
        if (!r) return undefined;
        const other = ctx.floor(r.floor);
        return {
          name: w.name,
          cwd: path.join(def.dir, r.path),
          rel: r.path,
          worktreeBase: r.base,
          baseBranch: r.from ?? null,
          openPull: (branch) => (other ? openPull(other, branch) : undefined),
          refreshGitHub: () => void other?.github.refresh(),
        };
      },
      (branch) => openPull(this, branch),
      {
        state: (state, ids) => ctx.changes(state, ids),
        toast: (text, level) => ctx.toast(this, text, level),
        refreshGitHub: () => void this.github.refresh(),
      },
    );

    this.decor = new Decor(dataDir);
    this.jukebox = new Jukebox(dataDir);
    this.whiteboard = new Whiteboard(dataDir);
    this.ready = this.workers.start();

    void this.github.refresh();
    // A floor with people on it, or work under way, keeps its boards fresh; the others check in now and then.
    this.timer = setInterval(() => {
      if (this.active() || Date.now() - this.github.issues.fetchedAt > IDLE_REFRESH_MS) void this.github.refresh();
    }, REFRESH_MS);
  }

  /** Pull request `n` merged (`by` someone, from the PR window): the gong rings, once per PR. */
  merged(n: number, by?: string) {
    if (this.merges.ring(n)) this.ctx.emit(this, { t: 'gong', why: 'merged', pr: n, by });
  }

  /**
   * With ⚙️ Settings' *go home once merged* on, sends home every worker whose pull request merged,
   * once it's at rest and nobody has its terminal open, deleting its worktree and branch unless they
   * hold work that isn't on GitHub. Called whenever that might have changed; it looks a moment later,
   * once for a burst of calls, and not from inside the event that prompted it.
   */
  sendLandedHome() {
    if (this.landedTimer || !this.ctx.leaveOnMerge()) return;
    this.landedTimer = setTimeout(() => {
      this.landedTimer = undefined;
      if (!this.ctx.leaveOnMerge()) return;
      const pullsOf = (id: string) => this.ctx.floor(id)?.github.pulls.items;
      for (const landed of landedWorkers(this.workers.list(), this.github.pulls.items, this.queue.state().tasks, pullsOf)) {
        const { worker, head, heads } = landed;
        if (!worker.repos?.length) {
          this.goHome(worker, `PR #${landed.pr} merged`, head);
          continue;
        }
        // Across repositories, one PR can merge before another repository's work even has one:
        // it goes once nothing is left that its merged PRs didn't deliver.
        if (this.landing.has(worker.id)) continue;
        this.landing.add(worker.id);
        void this.workers.holdsWork(worker.id, head, heads).catch(() => true).then((held) => {
          this.landing.delete(worker.id);
          if (!held && this.workers.get(worker.id) === worker) this.goHome(worker, `its pull requests merged (${landed.prs?.join(', ')})`, head, heads);
        });
      }
    }, LANDED_DELAY_MS);
  }

  /**
   * Whether a worker's work landed: a pull request of its merged and none is open, on this floor
   * and, for a worker across repositories, on the others too (see landedWork).
   */
  landed(worker: WorkerInfo): Landed | undefined {
    return landedWork(worker, this.github.pulls.items, this.queue.state().tasks, (id) => this.ctx.floor(id)?.github.pulls.items);
  }

  /**
   * Sends a worker home as someone asked (not by itself, see sendLandedHome): with no `cleanup`, its
   * worktree and branch go unless they hold work, where what its merged pull requests delivered
   * doesn't count. Resolves with the line about its worktree.
   */
  sendHome(workerId: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }> {
    const info = this.workers.get(workerId);
    const landed = info && this.landed(info);
    return this.workers.kill(workerId, cleanup, landed?.head, landed?.heads);
  }

  private goHome(worker: WorkerInfo, why: string, head?: string, heads?: Record<string, string | undefined>) {
    const done = this.workers.kill(worker.id, undefined, head, heads);
    this.ctx.toast(this, `🏠 ${worker.name} went home: ${why}`);
    void done.then(({ note, error }) => {
      if (note) this.ctx.toast(this, note);
      if (error) this.ctx.toast(this, error, 'warn');
    });
  }

  /** Someone just walked in: boards that haven't been looked at in a while get fetched again. */
  arrived() {
    if (Date.now() - Math.max(this.github.issues.fetchedAt, this.github.pulls.fetchedAt) > REFRESH_MS) void this.github.refresh();
  }

  /**
   * Seats (or resumes) a department's manager through the same spawn as every hire, on the team
   * policy engine unless a person picked one explicitly. Managers orchestrate: they never count
   * against the writer cap. Used by the manager panel and by the CEO's explicit execute.
   */
  startManager(deptId: string, by: string, owner: string | undefined, explicit?: { provider?: AgentProvider; model?: string; effort?: AgentEffort }, task?: string): WorkerInfo | string {
    const dept = this.departments.get(deptId);
    if (!dept) return 'That department is gone';
    const policy = dept.policy;
    const saved = this.departments.leadChoice(deptId);
    const provider = explicit?.provider ?? policy?.provider ?? saved?.provider;
    const model = explicit?.model ?? (explicit?.provider === undefined ? policy?.model : undefined) ?? saved?.model;
    const effort = explicit?.effort ?? (explicit?.provider === undefined ? policy?.effort : undefined) ?? saved?.effort;
    const liveAgents = () => this.writerIds();
    const composed = this.departments.composeLeadLaunch(deptId, task, liveAgents);
    if (typeof composed === 'string') return composed;
    const fresh = this.departments.get(deptId)!;
    const desk = fresh.desks.find((d) => !this.workers.deskOccupied(d)) ?? nextFreeSeat((x) => this.workers.deskOccupied(x), this.plan.wing)?.id;
    if (!desk) return 'No free desk — knock the back office out a row first';
    // The lead orchestrates rather than writes: it takes a worktree only when every worker here has one.
    const r = this.workers.spawn(desk, by, composed.prompt, !!this.project.branch, 'agent', provider, model, effort, undefined, owner, [], undefined, composed.lead.name);
    if (typeof r === 'string') return r;
    this.departments.recordLeadHire(deptId, r.id, desk, by);
    return r;
  }

  /** The CEO's assignment to a manager: records the objective, delivers it to a live manager, and
   * starts an off-shift one only on explicit execute — through the signed-in owner path (the
   * office's own, when whoever asked runs office-owned). */
  assignObjective(deptId: string, objective: string, by: string, opts?: { execute?: boolean; owner?: string }): string | { manager: string; started: boolean } {
    const dept = this.departments.get(deptId);
    if (!dept) return 'That department is gone';
    if (!dept.lead) return `Name the ${dept.name} manager first`;
    const err = this.departments.setObjective(deptId, objective, by);
    if (err) return err;
    const from = this.ceo.get()?.name ?? by;
    const text = `🎯 ${from} (CEO): ${objective}`;
    const live = dept.lead.workerId ? this.workers.get(dept.lead.workerId) : undefined;
    if (live) {
      // Delivered now when idle, held (never injected mid-turn) while their turn runs.
      this.dispatch.hold(live.id, `objective:${deptId}`, text);
      return { manager: live.name, started: false };
    }
    if (opts?.execute !== true) return `${dept.lead.name} is off shift — start them from the panel, or ask the CEO to execute`;
    if (dept.policy?.mode === 'ask') return `The ${dept.name} policy asks each time — start ${dept.lead.name} from the panel, where the engine is picked`;
    const r = this.startManager(deptId, by, opts.owner);
    if (typeof r === 'string') return r;
    this.dispatch.hold(r.id, `objective:${deptId}`, text);
    return { manager: r.name, started: true };
  }

  /**
   * Why no implementation writer may start right now: the project's two-writer cap, counting every
   * live agent that isn't rostered as review/support/lead. Manual hires, queue seating and hook
   * hires all ask here; department role launches keep their role-aware check in composeLaunch.
   */
  /** Agents that would write right now: active agents, minus the CEO (they direct, they never write). */
  writerIds(): string[] {
    const ceoId = this.ceo.get()?.workerId;
    return this.workers
      .list()
      .filter((w) => w.kind === 'agent' && WRITING.has(w.status) && w.id !== ceoId)
      .map((w) => w.id);
  }

  /**
   * Why no implementation writer may start right now: the project's two-writer cap, counting the
   * agents that would actually write. Manual hires, queue seating and hook hires all ask here;
   * department role launches pass the same ids to their role-aware check in composeLaunch.
   */
  writerCap(): string | undefined {
    return this.departments.writers(() => this.writerIds()) >= MAX_WRITERS
      ? `This project already has ${MAX_WRITERS} implementation writers — review or ship what's in flight first`
      : undefined;
  }

  private active(): boolean {
    return this.ctx.people(this) > 0 || this.ctx.lent(this) || this.workers.list().some((w) => isBusy(w.status)) || this.queue.state().tasks.some((t) => t.status !== 'done') || this.meetings.state().current?.status === 'running';
  }

  info(): FloorInfo {
    const ws = this.workers.list();
    return {
      id: this.id,
      name: this.def.name,
      repo: this.def.repo,
      dir: this.dir,
      branch: this.project.branch,
      palette: this.def.palette,
      addedBy: this.def.addedBy,
      addedAt: this.def.addedAt,
      workers: ws.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length,
      busy: ws.filter((w) => w.status === 'working').length,
      waiting: ws.filter((w) => w.kind === 'agent' && (w.status === 'needs_input' || (w.status === 'done' && !w.acked))).length,
      people: this.ctx.people(this),
      wing: this.plan.wing,
    };
  }

  /** With `keep` (a restart), the workers' terminals keep running for the next office to pick up. */
  shutdown(keep = false) {
    clearInterval(this.timer);
    clearTimeout(this.landedTimer);
    this.dog.stop();
    this.github.stop();
    this.queue.shutdown();
    this.meetings.shutdown();
    this.changes.stop();
    this.whiteboard.flush();
    return this.workers.shutdown(keep);
  }
}
