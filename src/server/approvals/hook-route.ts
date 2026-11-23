import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';
/** Separate from notification hooks: the response is the native PermissionRequest decision. */
export async function approvalHookRoute(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/approvals/')) return false;
  const provider = url.pathname.slice('/approvals/'.length);
  if (req.method !== 'POST' || (provider !== 'claude' && provider !== 'codex')) { send(res, 404, {}); return true; }
  const id = url.searchParams.get('worker') ?? '', token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const workers = ctx.workerFloor(id)?.workers;
  if (!workers) { send(res, 401, {}); return true; }
  let payload: unknown;
  try { payload = JSON.parse(await readBody(req, 64 * 1024)); } catch { send(res, 400, {}); return true; }
  // Validate the live process/session before lifecycle handling can adopt a supplied session id.
  const pending = workers.approvals.hold(provider, id, token, payload, () => !res.destroyed && !res.writableEnded);
  if (!pending) { send(res, 200, {}); return true; }
  if (!workers.handleProviderHook(provider, id, token, 'PermissionRequest', payload)) { pending.cancel(); send(res, 401, {}); return true; }
  const cancel = () => pending.cancel();
  res.once('close', cancel);
  try { const answer = await pending.result; if (!res.destroyed && !res.writableEnded) send(res, 200, answer); }
  finally { res.off('close', cancel); }
  return true;
}
