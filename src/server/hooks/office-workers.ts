import { departmentWorkerError, roleDispatchError } from '../role-subscriptions/access.js';
import { publicRoleWorker, roleAccess, roleOrigin, canAccessRoleWorker } from '../role-access.js';
import { canUseWorker, OWN_WORKER } from '../worker-ownership.js';
import type http from 'node:http';
import { notLeaving } from '../leave-on-merge.js';
import { findWorker, readHireRequest, readHomeRequest, readPrRequest, workerRow, type PullsView } from '../office-workers.js';
import { gh } from '../github.js';
import type { Floor } from '../floor.js';
import { normTitle } from '../queue.js';
import { nextFreeSeat } from '../../shared/layout.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';

/**
 * Pull request `n` on a floor, for a worker to have as its own: one that's open, or merged and still
 * on the floor's list. A string says why it can't be.
 */
async function pullOf(floor: Floor, n: number, repo?: string): Promise<{ number: number; url: string } | string> {
  const here = floor.def.repo;
  if (repo && here && repo.toLowerCase() !== here.toLowerCase()) return `That pull request is in ${repo}, and this floor is ${here}`;
  const listed = floor.github.pulls.items.find((p) => p.number === n);
  let pr: { url: string; state: string } | undefined = listed;
  if (!pr) {
    try {
      pr = JSON.parse(await gh(['pr', 'view', String(n), '--json', 'url,state'], floor.dir)) as { url: string; state: string };
    } catch (err) {
      return `No pull request #${n} here: ${(err as Error).message}`;
    }
  }
  if (pr.state === 'CLOSED') return `PR #${n} was closed without merging`;
  // The office follows the open ones and the last ones merged: an older one would look open for good.
  if (!listed && pr.state === 'MERGED') return `PR #${n} merged too long ago for the office to follow: send the worker home by name instead`;
  return { number: n, url: pr.url };
}

/**
 * The floor's workers, for any worker on it (see office-workers.ts, and bin/office-workers.js, the
 * command and MCP server that call it): GET lists them, POST hires one, POST /home sends some home
 * (its worktree and branch go too, unless they hold work), POST /tell types a prompt to one, POST /pr
 * says which pull request is one's (for one the office couldn't tell by itself). The
 * worker's own hook token says who's asking, and the floor hears who did what, as from anyone.
 */
export async function officeWorkers(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const who = me.name;
  const view: PullsView = { pulls: floor.github.pulls.items, tasks: floor.queue.state().tasks, pullsOf: (id) => ctx.floors.get(id)?.github.pulls.items };
  const visible = (w: import('../../shared/protocol.js').WorkerInfo) => roleOrigin(floor, w.id) ? publicRoleWorker(w, roleAccess(ctx, floor, w.id, me.owner).kind) : w;
  const row = (id: string) => {
    const w = floor.workers.get(id);
    return w && workerRow(visible(w), view, me.id);
  };
  const action = url.pathname.slice('/office/workers'.length);
  if (req.method === 'GET' && !action) {
    const list = floor.workers.list();
    const free = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing);
    return send(res, 200, {
      floor: { id: floor.id, name: floor.def.name, repo: floor.def.repo, branch: floor.project.branch },
      you: me.id,
      leaveOnMerge: ctx.leaveOnMerge.on,
      providers: floor.project.agentProviders,
      defaultProvider: floor.workers.officeDefault.provider,
      freeDesk: free?.id ?? null,
      ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}),
      workers: list.map((w) => workerRow(visible(w), view, me.id)),
    });
  }
  if (req.method !== 'POST' || !['', '/home', '/tell', '/pr', '/review', '/delegate', '/assign'].includes(action)) return send(res, 405, { error: 'GET /office/workers, or POST to /office/workers, /office/workers/home, /office/workers/tell, /office/workers/pr, /office/workers/review, /office/workers/delegate or /office/workers/assign' });
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }

  const consentError = roleDispatchError(ctx, floor, me.id);
  if (consentError) return send(res, 403, { error: consentError });

  if (action === '/home') {
    const ask = readHomeRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    type Outcome = { worker: string; id?: string; went?: boolean; note?: string; error?: string; skipped?: string };
    const results: Outcome[] = [];
    const going: { w: WorkerInfo; why?: string }[] = [];
    if (ask.merged) {
      for (const w of floor.workers.list()) {
        const landed = floor.landed(w);
        if (!landed) continue;
        const why = landed.prs?.length ? `its pull requests merged (${landed.prs.join(', ')})` : `PR #${landed.pr} merged`;
        const staying = w.id === me.id ? "that's you" : notLeaving(w);
        if (staying) results.push({ worker: w.name, id: w.id, skipped: `${why}, but it's ${staying}` });
        else going.push({ w, why });
      }
    } else {
      for (const key of ask.workers) {
        const w = findWorker(floor.workers.list(), key);
        if (typeof w === 'string') results.push({ worker: key, error: w });
        else if (w.id === me.id) results.push({ worker: w.name, id: w.id, error: "That's you: someone else has to send you home" });
        else if (!going.some((g) => g.w === w)) going.push({ w });
      }
    }
    // One at a time: git takes a lock on the repository's refs to delete a branch.
    for (const { w, why } of going) {
      if (!canAccessRoleWorker(ctx, floor, w.id, floor.workers.ownerOf(me.id)) || !canUseWorker(ctx, floor.workers.ownerOf(me.id), floor.workers.ownerOf(w.id), w.provider)) { results.push({ worker: w.name, id: w.id, error: OWN_WORKER }); continue; }
      if (floor.workers.get(w.id) !== w) {
        results.push({ worker: w.name, id: w.id, skipped: 'it had already gone' });
        continue;
      }
      ctx.toastFloor(floor, why ? `🏠 ${who} sent ${w.name} home: ${why}` : `${who} sent ${w.name} home`);
      const { note, error } = await floor.sendHome(w.id, ask.cleanup);
      if (note) ctx.toastFloor(floor, note);
      if (error) ctx.toastFloor(floor, error, 'warn');
      results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });
    }
    return send(res, 200, { results });
  }

  if (action === '/tell') {
    const b = (body ?? {}) as { worker?: unknown; prompt?: unknown };
    const w = findWorker(floor.workers.list(), str(b.worker, 64));
    if (typeof w === 'string') return send(res, 404, { error: w });
    if (!canAccessRoleWorker(ctx, floor, w.id, floor.workers.ownerOf(me.id)) || !canUseWorker(ctx, floor.workers.ownerOf(me.id), floor.workers.ownerOf(w.id), w.provider)) return send(res, 403, { error: OWN_WORKER });
    if (w.id === me.id) return send(res, 400, { error: "That's you" });
    // A shell would run it as a command, in someone's terminal.
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const text = str(b.prompt, 20000).replace(/\r\n?/g, '\n').trim();
    if (!text) return send(res, 400, { error: 'Say what to tell it: prompt' });
    let err = floor.workers.prompt(w.id, text, who);
    // Stopped or asleep: it wakes up with this as its next message.
    if (err === 'Worker is not running') err = floor.workers.resume(w.id, text);
    if (err) return send(res, 400, { error: err });
    return send(res, 200, { ok: true, worker: row(w.id) });
  }

  if (action === '/pr') {
    const ask = readPrRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    const w = ask.worker ? findWorker(floor.workers.list(), ask.worker) : me;
    if (typeof w === 'string') return send(res, 404, { error: w });
    if (!canAccessRoleWorker(ctx, floor, w.id, floor.workers.ownerOf(me.id)) || !canUseWorker(ctx, floor.workers.ownerOf(me.id), floor.workers.ownerOf(w.id), w.provider)) return send(res, 403, { error: OWN_WORKER });
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const pr = ask.pr === undefined ? undefined : await pullOf(floor, ask.pr, ask.repo);
    if (typeof pr === 'string') return send(res, 400, { error: pr });
    const err = floor.workers.linkPr(w.id, pr);
    if (err) return send(res, 404, { error: err });
    const whose = w.id === me.id ? 'its own' : `${w.name}'s`;
    ctx.toastFloor(floor, pr ? `${who} said PR #${pr.number} is ${whose}` : `${who} said ${w.id === me.id ? 'it has' : `${w.name} has`} no pull request`);
    return send(res, 200, { ok: true, worker: row(w.id) });
  }

  if (action === '/review') {
    // A worker stages its one deliverable link in the Review Room for a person's verdict
    // (see reviews.ts); the verdict comes back to its terminal.
    const b = (body ?? {}) as { title?: unknown; url?: unknown; note?: unknown; gate?: unknown };
    const r = ctx.reviews.submit({
      title: str(b.title, 200),
      url: str(b.url, 600),
      note: str(b.note, 600),
      gate: b.gate === 'passed' || b.gate === 'failed' ? b.gate : undefined,
      by: who,
      workerId: me.id,
      floorId: floor.id,
    });
    if (typeof r === 'string') return send(res, 400, { error: r });
    ctx.toastFloor(floor, `🎬 ${who} staged “${r.title}” for review`);
    return send(res, 200, { ok: true, review: { id: r.id, title: r.title, url: r.url } });
  }

  if (action === '/assign') {
    // The CEO's assignment path (see docs/department-leads.md): only this floor's live CEO may
    // assign objectives; managers are started only on explicit execute, on the CEO's own sign-ins.
    const b = (body ?? {}) as { dept?: unknown; objective?: unknown; execute?: unknown };
    if (!floor.ceo.isCeoWorker(me.id)) {
      const named = floor.ceo.get()?.name;
      return send(res, 403, { error: named ? `Only ${named} (this floor's CEO) assigns objectives — managers delegate workers` : 'This floor has no CEO on shift' });
    }
    const preset = str(b.dept, 20);
    const dept = floor.departments.state().departments.find((d) => d.preset === preset);
    if (!dept) return send(res, 404, { error: `No ${preset} department on this floor — assignments never cross floors` });
    if (!dept.lead) return send(res, 400, { error: `Name the ${dept.name} manager first` });
    const objective = str(b.objective, 4000);
    if (!objective.trim()) return send(res, 400, { error: 'Say what the manager is to achieve: objective' });
    const go = () => {
      const r = floor.assignObjective(dept.id, objective, floor.ceo.get()!.name, { execute: b.execute === true, owner: floor.workers.ownerOf(me.id) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      ctx.toastFloor(floor, `🎯 ${who} gave ${r.manager} an objective${r.started ? ' and started their shift' : ''}`);
      send(res, 200, { ok: true, ...r });
    };
    // A started manager gets a worktree off what's on GitHub now, like every hire.
    const fetching = floor.workers.fetchBase?.();
    if (fetching) void fetching.then(go);
    else go();
    return;
  }

  if (action === '/delegate') {
    // The department-scoped orchestration path (see docs/department-leads.md): only the department's
    // live lead may delegate for it, the team policy always picks the engine, and an 'ask' policy
    // holds the delegation for a person's decision instead of letting an agent supply a provider.
    const b = (body ?? {}) as { dept?: unknown; title?: unknown; task?: unknown; provider?: unknown; model?: unknown; effort?: unknown };
    if (b.provider !== undefined || b.model !== undefined || b.effort !== undefined) return send(res, 400, { error: 'The engine is chosen by the department policy — a person decides when it asks. provider/model/effort are not accepted here.' });
    if (me.kind !== 'agent') return send(res, 403, { error: 'Only a department lead delegates' });
    const dept = floor.departments.leadDeptOfWorker(me.id);
    if (!dept) {
      const named = floor.departments.state().departments.filter((d) => d.lead).map((d) => d.lead!.name);
      return send(res, 403, { error: `You are not a department lead here${named.length ? ` (the leads are ${named.join(', ')})` : ' — no lead is on shift'}` });
    }
    const title = str(b.title, 200);
    const task = str(b.task, 20000).replace(/\r\n?/g, '\n').trim();
    if (!title || !task) return send(res, 400, { error: 'Give the delegation a title and the task: {"title": "…", "task": "…"}' });
    // The claim refuses before anything else: "already assigned" is the truer answer, for the
    // person-decided path too. queue.add re-checks synchronously, so nothing is lost.
    const claimed = floor.queue.state().tasks.some((t) => t.status !== 'done' && normTitle(t.title) === normTitle(title));
    if (claimed) return send(res, 400, { error: `“${title}” is already assigned on this project` });
    const policy = dept.policy;
    if (policy?.mode === 'ask') {
      const err = floor.departments.addRequest(dept.id, { title, task, by: who });
      if (err) return send(res, 400, { error: err });
      ctx.toastFloor(floor, `🙋 ${who} asked for an engine decision on “${title}”`);
      return send(res, 200, { ok: true, pending: true, message: 'The team policy asks each time: a person will pick the engine and approve it. The job is not queued yet.' });
    }
    const childConsent = departmentWorkerError(ctx, floor, me.id, policy?.provider ?? floor.workers.officeDefault.provider);
    if (childConsent) return send(res, 403, { error: childConsent });
    const cap = floor.writerCap();
    if (cap) return send(res, 409, { error: cap });
    const err = floor.delegate(dept.id, title, task, `${dept.lead!.name} (lead)`, floor.workers.ownerOf(me.id), me.id, { provider: policy?.provider, model: policy?.model, effort: policy?.effort });
    if (err) return send(res, 400, { error: err });
    const queued = floor.queue.state().tasks.at(-1)!;
    ctx.toastFloor(floor, `📋 ${who} delegated “${queued.title}” to the floor queue`);
    return send(res, 200, { ok: true, pending: false, task: { id: queued.id, title: queued.title, status: queued.status } });
  }

  const ask = readHireRequest(body, floor.project.agentProviders);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  // Only department managers hire agents from agents — orchestration is theirs. People still hire
  // their own standalone agents from a desk in the UI, which this hook is not.
  if (!floor.departments.leadDeptOfWorker(me.id)) return send(res, 403, { error: 'Only a department manager may hire another worker here. People hire their own agents at a desk (E).' });
  // A manager hiring adds an implementation writer: the project's cap holds here too.
  const cap = floor.writerCap();
  if (cap) return send(res, 409, { error: cap });
  const desk = ask.desk ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
  if (!desk) return send(res, 409, { error: 'Every desk and bean bag is taken: send someone home first' });
  // A model or effort is the office's default worker's unless it says whose.
  const provider = ask.provider ?? (ask.model || ask.effort ? floor.workers.officeDefault.provider : undefined);
  const worktree = ask.worktree ?? !!floor.project.branch;
  // Its worktree starts from what's on GitHub now, like one hired from a desk.
  if (worktree) await floor.workers.fetchBase();
  if (!ctx.floors.has(floor.id)) return send(res, 410, { error: 'This floor closed' });
  // It runs as whoever the asking worker runs as.
  const owner = floor.workers.ownerOf(me.id);
  const childConsent = departmentWorkerError(ctx, floor, me.id, provider ?? floor.workers.officeDefault.provider);
  if (childConsent) return send(res, 403, { error: childConsent });
  const r = floor.workers.spawn(desk, who, ask.prompt, worktree, 'agent', provider, ask.model, ask.effort, undefined, owner);
  if (typeof r === 'string') return send(res, 400, { error: r });
  ctx.toastFloor(floor, `${who} hired ${r.name}${ask.issue ? ` for issue #${ask.issue}` : ' with a task'}`);
  if (ask.issue) {
    const n = ask.issue;
    floor.queue.dropIssue(n);
    const as = owner ? ctx.signins.ghAs(owner) : undefined;
    if (typeof as === 'string') ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${as}`, 'warn');
    else void floor.github.claim(n, as).then((e) => e && ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${e}`, 'warn'));
  }
  send(res, 200, { ok: true, worker: row(r.id) });
}
