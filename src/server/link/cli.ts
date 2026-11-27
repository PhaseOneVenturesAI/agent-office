import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { officeOrigin } from '../join-access.js';
import { configureMac } from '../hq/local/config.js';
import { MacConnector } from '../hq/local/connector.js';
import { friendlyName } from '../cubbies/local/connector.js';
import { forgetToken, readToken, saveToken } from './credentials.js';
import { AccessRequired, cachedAccess, connection, reconnect, request, signInNeeded } from './transport.js';
import { startNeedsRefresh } from './needs-refresh.js';
export async function linkCommand(args: string[], home = os.homedir(), log = console.log): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { log('agent-office link <office-url> [--run]\nApprove this Mac once in your signed-in browser. --run uses the saved token.'); return 0; }
  let origin: string;
  try {
    if (args.filter(a => a !== '--run').length !== 1) throw Error();
    origin = officeOrigin(args.find(a => a !== '--run')!);
    if (!origin.startsWith('https:') && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw Error();
  } catch { log('Use agent-office link <https-office-url> [--run]'); return 2; }
  const stop = new AbortController(), interrupt = () => stop.abort();
  let connector: MacConnector | undefined, refresh: (() => void) | undefined;
  try {
    let token = readToken(home, origin);
    if (!token && args.includes('--run')) { log(`run \`agent-office link ${origin}\` once to approve this Mac`); return 78; }
    const config = configureMac(home), name = friendlyName();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(s, interrupt);
    if (!token) {
      const headers = await cachedAccess(origin);
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
    connector = new MacConnector(config, token!);
    refresh = startNeedsRefresh(home, log);
    const code = await reconnect(origin, stop.signal, log, async () => connection(origin, token!, name, await cachedAccess(origin), connector!, stop.signal));
    if (code === 78) forgetToken(home, origin, token!);
    return code;
  } catch (e) {
    if (stop.signal.aborted) return 0;
    log(e instanceof AccessRequired ? signInNeeded(origin) : (e as Error).message); return 1;
  } finally {
    refresh?.(); await connector?.close();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(s, interrupt);
  }
}
