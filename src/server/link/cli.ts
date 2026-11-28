import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { officeOrigin } from '../join-access.js';
import { configureMac } from '../hq/local/config.js';
import { MacConnector } from '../hq/local/connector.js';
import { friendlyName } from '../cubbies/local/connector.js';
import { forgetToken, readToken, saveToken } from './credentials.js';
import { AccessRequired, cachedAccess, connection, reconnect, request, signInNeeded } from './transport.js';
import { startNeedsRefresh } from './needs-refresh.js';
import { startLeadTalk } from './talk.js';
import { checkAccess, serviceHeaders, ServiceTokenError } from './service-token.js';
export async function linkCommand(args: string[], home = os.homedir(), log = console.log): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { log('agent-office link <office-url> [--run | --check-access]\nApprove this Mac once in your signed-in browser. --run uses the saved token. --check-access tests ~/.agent-office/link/cf-service-token.json.'); return 0; }
  let origin: string;
  try {
    const flags = ['--run', '--check-access'];
    if (args.filter(a => !flags.includes(a)).length !== 1 || args.includes('--run') && args.includes('--check-access')) throw Error();
    origin = officeOrigin(args.find(a => !flags.includes(a))!);
    if (!origin.startsWith('https:') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error();
  } catch { log('Use agent-office link <https-office-url> [--run | --check-access]'); return 2; }
  if (args.includes('--check-access')) { const result = await checkAccess(home, origin); log(result); return result === 'service token OK' ? 0 : 1; }
  // An unsafe service token file is refused up front; launchd must not spin on it.
  try { serviceHeaders(home, origin); }
  catch (e) { if (e instanceof ServiceTokenError) { log(e.message); return args.includes('--run') ? 78 : 1; } throw e; }
  const stop = new AbortController(), interrupt = () => stop.abort();
  let talks: Awaited<ReturnType<typeof startLeadTalk>> | undefined;
  let connector: MacConnector | undefined, refresh: (() => void) | undefined;
  try {
    let token = readToken(home, origin);
    if (!token && args.includes('--run')) { log(`run \`agent-office link ${origin}\` once to approve this Mac`); return 78; }
    const config = configureMac(home), name = friendlyName();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(s, interrupt);
    if (!token) {
      const headers = await cachedAccess(origin, home);
      const pairing = await request(origin, '/api/mac-link/pair', { computerId: config.computerId, computerName: name }, headers);
      if (!/^[a-f0-9]{48}$/.test(pairing.id) || !/^[a-f0-9]{64}$/.test(pairing.secret)) throw Error('Invalid pairing response');
      log(`Approve this Mac: ${origin}/?link=${pairing.id}`);
      const expires = Math.min(Date.now() + 600_000, Number(pairing.expiresAt));
      while (!stop.signal.aborted && Date.now() < expires) {
        await delay(2000, undefined, { signal: stop.signal });
        const result = await request(origin, '/api/mac-link/poll', { id: pairing.id, secret: pairing.secret }, headers);
        if (result.state === 'denied') { log('Mac link denied'); return 1; }
        if (result.state === 'approved') { saveToken(home, origin, result.token); token = result.token; break; }
      }
      if (!token) { log('Mac pairing expired; run link again'); return 1; }
    }
    connector = new MacConnector(config, token!, undefined, frame => talks?.talk.receive(frame));
    talks = await startLeadTalk(config, frame => connector!.sendLead(frame));
    refresh = startNeedsRefresh(home, log);
    const code = await reconnect(origin, stop.signal, log, async () => connection(origin, token!, name, await cachedAccess(origin, home), connector!, stop.signal));
    if (code === 78) forgetToken(home, origin, token!);
    return code;
  } catch (e) {
    if (stop.signal.aborted) return 0;
    log(e instanceof AccessRequired ? signInNeeded(origin) : (e as Error).message); return 1;
  } finally {
    refresh?.(); await talks?.close(); await connector?.close();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(s, interrupt);
  }
}
