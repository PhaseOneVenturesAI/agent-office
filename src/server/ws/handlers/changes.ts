import { ownedWorker } from './worker-access.js';
// The Changes window at a desk: what a worker changed, and committing, discarding or opening a pull
// request for it.
import { agentCommitPrompt } from '../../changes.js';
import { childEnv } from '../../workers.js';
import type { ChangesClientMsg } from '../../../shared/protocol.js';
import { repoOf, str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const changesHandlers = {
  'changes.watch'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (w) w.floor.changes.watch(w.wid, c.id, repoOf(msg.repo));
  },
  'changes.unwatch'(ctx, c, msg) {
    const wid = str(msg.workerId, 32);
    // Its worker may have gone home already; stop watching wherever it was.
    for (const f of ctx.floors.values()) f.changes.unwatch(wid, c.id, repoOf(msg.repo));
  },
  'changes.diff'(ctx, c, msg) {
    const workerId = str(msg.workerId, 32);
    const file = str(msg.path, 4096);
    const repo = repoOf(msg.repo);
    const floor = ctx.workerFloor(workerId);
    if (!floor) {
      ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: 'No such worker' });
      return;
    }
    void floor.changes.diff(workerId, file, repo).then((r) => {
      if (typeof r === 'string') ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: r });
      else ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, ...r });
    });
  },
  'changes.commit'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (!w) return;
    const repo = repoOf(msg.repo);
    // No message typed: the worker's agent writes its own — it knows what it changed. When it can't
    // be asked (a shell, asleep or gone), the person who pressed the button types one instead.
    if (typeof msg.message !== 'string') {
      const where = w.info.kind === 'agent' ? w.floor.changes.commitWhere(w.wid, repo) : undefined;
      const err = where ? w.floor.workers.prompt(w.wid, agentCommitPrompt(where), who) : 'no agent to ask';
      if (err) ctx.sendTo(c, { t: 'changes.commitManual', workerId: w.wid, repo });
      else ctx.sendTo(c, { t: 'toast', text: `🖊️ ${who} asked ${w.info.name} to commit its changes, message and all`, level: 'info' });
      return;
    }
    // Committed as whoever pressed it: their GitHub name and email, once they've signed in to it.
    const env = c.accountId ? ctx.signins.apply(c.accountId, childEnv(), [], 'github') : undefined;
    void w.floor.changes.commit(w.wid, str(msg.message, 5000), who, env, repo).then((err) => ctx.warn(c, err));
  },
  'changes.discard'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (w) void w.floor.changes.discard(w.wid, typeof msg.path === 'string' ? str(msg.path, 4096) : undefined, who, repoOf(msg.repo)).then((err) => ctx.warn(c, err));
  },
  'changes.pr'(ctx, c, msg) {
    const who = c.peer.name;
    const w = ownedWorker(ctx, c, msg.workerId, true);
    if (w) ctx.withGitHub(c, (as) => void w.floor.changes.pullRequest(w.wid, str(msg.title, 300), str(msg.body, 20000), who, as?.env, repoOf(msg.repo)).then((err) => ctx.warn(c, err)));
  },
} satisfies HandlerMap<ChangesClientMsg>;

export const changesHooks: FeatureHooks = {
  leaving(_ctx, c, was) {
    if (was) was.changes.unwatchAll(c.id);
  },
  closedOn: (_ctx, c, floor) => floor.changes.unwatchAll(c.id),
};
