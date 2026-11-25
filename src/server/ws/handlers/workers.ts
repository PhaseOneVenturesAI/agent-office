import { ownedWorker, usableWorker } from './worker-access.js';
import { canSeeWorker, canUseWorker, publicWorker, sanitizeSharedWith } from '../../worker-ownership.js';
// Workers at their desks and the board agents at their kiosks: hiring them, their terminals, their
// worktrees and pull requests.
import { MAX_REPOS, type RepoSource } from '../../workers.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type WorkerClientMsg } from '../../../shared/protocol.js';
import { issueNumber, num, str } from '../../office/input.js';
import { here } from './common.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

const CLEANUPS = new Set(['keep', 'worktree', 'all']);

// A floor's workers as `c` may see them: a private one only reaches its owner, the admins and the
// coworkers it's shared with (the meeting room's table and the board agents stay floor-wide).
export const workersView: ViewPieces['workers'] = (ctx, floor, c) =>
  floor?.workers
    .list()
    .filter((w) => canSeeWorker(ctx, c.accountId, w, floor.workers.ownerOf(w.id)))
    .map((w) => publicWorker(ctx, w, floor.workers.ownerOf(w.id))) ?? [];
export const jailView: ViewPieces['jail'] = (_ctx, floor) => floor?.jail.state() ?? { prisoners: [], bones: 0 };

/** The least time between two 'term.typing' notes from one person in one terminal. */
const TYPING_GAP_MS = 500;

export const workerHandlers = {
  'worker.spawn'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const kind = msg.kind === 'shell' ? 'shell' : 'agent';
    if (kind === 'agent' && msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    // The coworkers it's shared with from the start; nobody picked keeps it private to whoever hired it.
    const sharedWith = sanitizeSharedWith(ctx, c.accountId, msg.sharedWith);
    // Other floors' projects to work in too, each in a worktree of its own.
    const repos: RepoSource[] = [];
    for (const id of Array.isArray(msg.repos) ? [...new Set(msg.repos.slice(0, MAX_REPOS + 1).map((x) => str(x, 64)))] : []) {
      const other = ctx.floors.get(id);
      if (!ctx.floorVisible(id, c)) return ctx.warn(c, 'That project is no longer in the building');
      if (other?.def.draft) return ctx.warn(c, 'Draft work runs on your computer until kickoff');
      if (!other || other === floor) return ctx.warn(c, other ? "The worker's own floor's project is already in its workspace" : 'That project is no longer in the building');
      repos.push({ floor: other.id, name: other.def.name, repo: other.def.repo, dir: other.dir });
    }
    // A shell is theirs too: `claude auth login` or `gh auth login` typed there signs them in.
    const hire = () => {
      const r = floor.workers.spawn(str(msg.deskId, 32), who, str(msg.prompt, 20000) || undefined, msg.worktree === true, kind, msg.provider, model, effort, undefined, c.accountId, sharedWith, repos, msg.via === 'herald' ? 'herald' : undefined);
      const issue = kind === 'agent' ? issueNumber(msg.issue) : undefined;
      const across = repos.length ? ` across ${[floor.def.name, ...repos.map((x) => x.name)].join(' + ')}` : '';
      if (typeof r === 'string') ctx.warn(c, r);
      else ctx.toastWorker(floor, r, c.accountId, kind === 'shell' ? `${who} opened a shell at a desk` : `${who} hired ${r.name}${issue ? ` for issue #${issue}` : r.prompt ? ' with a task' : ''}${across}`);
      if (typeof r !== 'string' && issue) ctx.takeIssue(c, floor, issue);
    };
    // Every project it gets a worktree of starts from what's on GitHub.
    const fresh = [floor, ...repos.map((x) => ctx.floors.get(x.floor)!)];
    ctx.withSignIn(c, kind === 'agent' ? ctx.signInFor(msg.provider ?? floor.workers.officeDefault.provider) : undefined, () => (msg.worktree === true ? ctx.withFreshBase(c, fresh, hire) : hire()));
  },
  'worker.share'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    const { floor, wid, info } = w;
    const owner = floor.workers.ownerOf(wid);
    // Who on the floor can see it now, so whoever loses it is told and let go of its terminal.
    const could = new Map([...ctx.clients.values()].filter((o) => o.peer.floor === floor.id).map((o) => [o.id, canSeeWorker(ctx, o.accountId, info, owner)]));
    floor.workers.share(wid, sanitizeSharedWith(ctx, owner ?? c.accountId, msg.with));
    const names = (info.sharedWith ?? []).map((id) => ctx.accounts.get(id)?.name ?? 'a former account');
    ctx.toastWorker(floor, info, owner, names.length ? `👥 ${who} shared ${info.name} with ${names.join(', ')}` : `🔒 ${who} made ${info.name} private: only its owner and the admins see it now`);
    const frame = floor.workers.fullScreens().find((f) => f.workerId === wid)?.frame;
    for (const o of ctx.clients.values()) {
      if (o.peer.floor !== floor.id) continue;
      const can = canSeeWorker(ctx, o.accountId, info, owner);
      if (could.get(o.id) && !can) {
        o.attached.delete(wid);
        o.typingAt.delete(wid);
        floor.workers.detach(wid, o.id);
        ctx.sendTo(o, { t: 'worker.remove', workerId: wid });
        ctx.sendTo(o, { t: 'toast', text: `🔒 ${who} stopped sharing ${info.name} with you`, level: 'info' });
      } else if (!could.get(o.id) && can && frame) {
        // Newly shared: its laptop and terminal have something to show right away.
        ctx.sendTo(o, { t: 'screen', workerId: wid, ...frame, full: true });
      }
    }
  },
  'worker.people'(ctx, c) {
    const people = ctx.accounts
      .state(new Set())
      .accounts.map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    ctx.sendTo(c, { t: 'worker.people', you: c.accountId, people });
  },
  'worker.resume'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId);
    if (w) ctx.warn(c, w.floor.workers.resume(w.wid));
  },
  'worker.kill'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    const { floor, info } = w;
    const owner = floor.workers.ownerOf(info.id);
    // The worker leaves right away; its worktree is dealt with after that, and the outcome follows.
    const done = floor.sendHome(info.id, CLEANUPS.has(String(msg.cleanup)) ? msg.cleanup : undefined);
    ctx.toastWorker(floor, info, owner, `${who} sent ${info.name} home`);
    void done.then(({ note, error }) => {
      if (note) ctx.toastWorker(floor, info, owner, note);
      if (error) ctx.toastWorker(floor, info, owner, error, 'warn');
    });
  },
  'worker.worktree'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    void w.floor.workers.inspectWorktree(w.wid).then((state) => {
      if (state) ctx.sendTo(c, { t: 'worker.worktree', workerId: w.wid, state });
    });
  },
  'worker.rebuild'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    const { floor } = w;
    const owner = floor.workers.ownerOf(w.wid);
    // With `all`, every worker on the floor whose worktree was deleted, this one first.
    const ids = [w.wid, ...(msg.all === true ? floor.workers.list().filter((x) => x.lost && x.id !== w.wid && canUseWorker(ctx, c.accountId, floor.workers.ownerOf(x.id), x.provider, x.sharedWith)).map((x) => x.id) : [])];
    void (async () => {
      const names: string[] = [];
      const notes: string[] = [];
      for (const id of ids) {
        const info = floor.workers.get(id);
        // Sent home meanwhile, or back already with one before it (the rest of a meeting's table).
        if (!info || (id !== w.wid && !info.lost)) continue;
        const r = await floor.workers.rebuild(id);
        if (r.error) ctx.warn(c, r.error);
        else if (!r.rebuilt) ctx.sendTo(c, { t: 'toast', text: r.note ?? `${info.name}'s worktree is already there`, level: 'info' });
        else {
          names.push(info.name);
          if (r.note) notes.push(r.note);
        }
      }
      if (!names.length) return;
      const whose = names.length === 1 ? `${names[0]}'s worktree` : `the worktrees of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      ctx.toastWorker(floor, w.info, owner, `🌿 ${who} rebuilt ${whose}${notes.length ? ` — ${notes.join('; ')}` : ''}`);
    })();
  },
  'worker.attach'(ctx, c, msg) {
    const who = c.peer.name;
    const w = usableWorker(ctx, c, msg.workerId, true);
    const snap = w?.floor.workers.attach(w.wid, c.id, who);
    if (w && snap) {
      c.attached.add(w.wid);
      ctx.sendTo(c, { t: 'term.snapshot', workerId: w.wid, ...snap });
    }
  },
  'worker.detach'(ctx, c, msg) {
    const wid = str(msg.workerId, 32);
    c.attached.delete(wid);
    c.typingAt.delete(wid);
    ctx.workerFloor(wid)?.workers.detach(wid, c.id);
  },
  'worker.prompt'(ctx, c, msg) {
    const who = c.peer.name;
    const w = usableWorker(ctx, c, msg.workerId);
    if (!w) return;
    const err = w.floor.workers.prompt(w.wid, str(msg.prompt, 20000), who);
    ctx.warn(c, err);
    const issue = w?.info.kind === 'agent' ? issueNumber(msg.issue) : undefined;
    if (w && !err && issue) {
      ctx.toastWorker(w.floor, w.info, w.floor.workers.ownerOf(w.wid), `${who} handed issue #${issue} to ${w.info.name}`);
      ctx.takeIssue(c, w.floor, issue);
    }
  },
  'station.prompt'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const deskId = str(msg.deskId, 32);
    // Nobody there yet: whoever asks first hires it, on their own sign-ins.
    const hires = !floor.workers.deskOccupied(deskId);
    ctx.withSignIn(c, hires ? ctx.signInFor(floor.workers.officeDefault.provider) : undefined, () => {
      const r = floor.workers.station(deskId, who, str(msg.prompt, 20000), c.accountId);
      if (typeof r === 'string') ctx.warn(c, r);
      else if (r.hired) ctx.toastFloor(floor, `${who} asked the ${r.info.name} something`);
    });
  },
  'worker.pr'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    const { floor, wid } = w;
    const owner = floor.workers.ownerOf(wid);
    const tell = (text: string, level?: 'info' | 'warn') => ctx.toastWorker(floor, w.info, owner, text, level);
    ctx.withGitHub(c, (as) => void floor.workers.openPr(wid, who, as).then((r) => {
      if (typeof r === 'string') return ctx.warn(c, r);
      const info = floor.workers.get(wid);
      const name = info?.name ?? 'the worker';
      const [one] = r.prs;
      if (r.prs.length === 1 && !one.repo) tell(one.existed ? `${name}'s branch already has PR #${one.number}` : `${who} opened PR #${one.number} for ${name}`);
      else {
        // Across repositories: one line for them all.
        const list = r.prs.map((p) => `${p.repo} #${p.number}`).join(', ');
        tell(r.prs.every((p) => p.existed) ? `${name}'s pull requests are already open: ${list}` : `${who} opened ${name}'s pull requests: ${list}`);
      }
      const dirty = r.prs.filter((p) => p.dirty);
      if (dirty.length) ctx.warn(c, `${name} still has uncommitted changes in ${dirty.some((p) => p.repo) ? `its worktree${dirty.length > 1 ? 's' : ''} of ${dirty.map((p) => p.repo).join(', ')}` : 'its worktree'} — they are not in the PR`);
      for (const f of r.failed) ctx.warn(c, f);
      // Put it on the board now rather than at the next poll. A refresh already in flight
      // returns at once and can miss it, so look again shortly after.
      const own = r.prs.find((p) => !p.repo || p.repo === info?.worktree?.path.split(/[\\/]/).pop());
      void floor.github.refresh().then(() => {
        if (own && !floor.github.pulls.items.some((p) => p.number === own.number)) setTimeout(() => void floor.github.refresh(), 3000);
      });
      for (const x of info?.repos ?? []) void ctx.floors.get(x.floor)?.github.refresh();
    }));
  },
  'term.input'(ctx, c, msg) {
    const who = c.peer.name;
    const w = usableWorker(ctx, c, msg.workerId, true);
    if (w && c.attached.has(w.wid)) w.floor.workers.write(w.wid, str(msg.data, 64 * 1024), who);
  },
  'term.typing'(ctx, c, msg) {
    // Everyone else in that terminal sees who's typing. A typist says so about once a second.
    const w = usableWorker(ctx, c, msg.workerId, true);
    const now = Date.now();
    if (!w || !c.attached.has(w.wid) || now - (c.typingAt.get(w.wid) ?? 0) < TYPING_GAP_MS) return;
    c.typingAt.set(w.wid, now);
    for (const id of w.info.viewerIds) {
      const o = ctx.clients.get(id);
      if (o && o.id !== c.id) ctx.sendTo(o, { t: 'term.typing', workerId: w.wid, id: c.id });
    }
  },
  'term.resize'(ctx, c, msg) {
    const w = usableWorker(ctx, c, msg.workerId, true);
    if (w && c.attached.has(w.wid)) w.floor.workers.resize(w.wid, num(msg.cols), num(msg.rows));
  },
} satisfies HandlerMap<WorkerClientMsg>;

export const workerHooks: FeatureHooks = {
  leaving(_ctx, c, was) {
    if (was) was.workers.detachAll(c.id);
    c.attached.clear();
    c.typingAt.clear();
    c.stale.clear();
  },
  closedOn: (_ctx, c, floor) => floor.workers.detachAll(c.id),
};
