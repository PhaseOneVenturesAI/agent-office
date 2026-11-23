import type { Route } from '../router.js';
import { readBody, readBytes, sameOrigin, send } from '../util.js';
import type { LinearMapping } from '../../../shared/protocol/linear.js';
import type { IssueFields } from '../../linear/store.js';
export const linearWebhook: Route = {
  path: '/api/linear/webhook', auth: 'public', method: 'POST',
  async handle(ctx, { req, res }) {
    try { ctx.linear.webhook(await readBytes(req, 256 * 1024), String(req.headers['linear-signature'] ?? ''), String(req.headers['linear-delivery'] ?? '')); send(res, 200, { ok: true }); }
    catch { send(res, 400, { error: 'Webhook rejected' }); }
  },
};
export const linearRoutes: Route = {
  prefix: '/api/linear', auth: 'session',
  async handle(ctx, { req, res, url, path, session }) {
    const account = session.account?.id, floorId = url.searchParams.get('floor') ?? '';
    try {
      if (path === '/api/linear/callback' && req.method === 'GET') {
        if (!account || !ctx.linear.client) return send(res, 403, { error: 'Sign in as the configured Office owner first' });
        await ctx.linear.client.exchange(account, url.searchParams.get('state') ?? '', url.searchParams.get('code') ?? '');
        await ctx.linear.catalog();
        res.writeHead(302, { location: '/?linear=connected', 'cache-control': 'no-store' }).end(); return;
      }
      if (path !== '/api/linear') return send(res, 404, { error: 'No such route' });
      if (!ctx.floors.has(floorId)) return send(res, 404, { error: 'No such floor' });
      if (req.method === 'GET') return send(res, 200, ctx.linear.state(account, floorId));
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!account || !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Use your own signed-in Office session' });
      const ask = JSON.parse(await readBody(req, 32000)) as { action: string; mapping?: LinearMapping; users?: Record<string, string>; taskId?: string; revision?: string; departmentId?: string; patch?: Partial<IssueFields>; resolution?: 'local' | 'remote' };
      if (ask.action === 'connect') {
        if (!ctx.linear.client || !ctx.linear.owner(account)) throw new Error('Only the configured Office owner can connect the native integration');
        return send(res, 200, { url: ctx.linear.client.authorize(account) });
      }
      if (ask.action === 'map') {
        if (!ask.mapping || ask.mapping.floorId !== floorId || !ask.users) throw new Error('Choose floor and people mappings');
        await ctx.linear.map(account, ask.mapping, ask.users);
      } else if (ask.action === 'edit') {
        if (ask.taskId && typeof ask.revision !== 'string') throw new Error('Refresh the task before editing');
        await ctx.linear.edit(account, floorId, ask.taskId, ask.patch ?? {}, ask.resolution, ask.departmentId, ask.revision);
      }
      else if (ask.action === 'manual') {
        const task = ctx.floors.get(floorId)!.queue.state().tasks.find((t) => t.id === ask.taskId);
        if (!task?.linear || task.linear.accountId !== account) throw new Error('Only the assigned employee can take this task');
        if (task.linear.pending) throw new Error('Wait for the pending Linear changes to sync first');
        if (task.status === 'running' || task.status === 'queued') throw new Error('An agent already has this task');
        const state = ctx.linear.state(account, floorId).mapping?.states.inProgress;
        if (!state) throw new Error('Ask the owner to map an In progress state first');
        await ctx.linear.edit(account, floorId, task.id, { stateId: state }, undefined, undefined, task.linear.updatedAt);
        const error = ctx.floors.get(floorId)!.queue.manualTask(task.id); if (error) throw new Error(error);
      } else if (ask.action === 'retry') {
        if (!ctx.linear.canManage(account, floorId)) throw new Error('Only a department controller can retry the integration');
        await ctx.linear.sync?.run();
      } else throw new Error('Unknown Linear action');
      send(res, 200, ctx.linear.state(account, floorId));
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : 'Linear operation failed' }); }
  },
};
