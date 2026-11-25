import os from 'node:os';
import type { ContextIndex, ContextMutation } from '../../../shared/protocol/project-context.js';
import { ProjectContext, ContextError } from '../../project-context/index.js';
import { MAX_CONTEXT_BYTES } from '../../project-context/paths.js';
import { floorParam } from './files.js';
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';

export const projectContextRoute: Route = {
  path: '/api/project-context', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    const floor = floorParam(ctx, url, session);
    if (!floor) return send(res, 404, { error: 'No such project floor.' });
    const me = ctx.meOf(session.account?.id);
    try {
      const context = new ProjectContext(floor.def.dir);
      if (req.method === 'GET') {
        const rel = url.searchParams.get('path');
        if (rel) {
          const revision = url.searchParams.get('revision');
          if (revision) return send(res, 200, context.snapshot(rel, revision));
          if (url.searchParams.has('history')) return send(res, 200, context.revisions(rel, url.searchParams.get('before') ?? undefined));
          return send(res, 200, context.read(rel));
        }
        const docs = await floor.docs.list();
        const body: ContextIndex = { scope: { floor: floor.id, project: floor.def.name, host: os.hostname(), source: 'project checkout', loaded: 'unknown' },
          sources: context.list(docs.files.map((d) => d.path)), more: docs.more, canEdit: me.admin };
        return send(res, 200, body);
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
      if (!sameOrigin(req, ctx.cfg) || !me.admin) return send(res, 403, { error: 'Only an Office admin on this site can change project context.' });
      let ask: ContextMutation;
      try { ask = JSON.parse(await readBody(req, MAX_CONTEXT_BYTES * 2 + 4096)); }
      catch { return send(res, 400, { error: 'Invalid or oversized context edit.' }); }
      return send(res, 200, context.mutate(ask, me.account?.name ?? 'Office admin'));
    } catch (error) {
      return send(res, error instanceof ContextError ? error.status : 500, { error: error instanceof ContextError ? error.message : 'Project context could not be read or saved. No successful change is acknowledged; inspect storage before retrying.' });
    }
  },
};
