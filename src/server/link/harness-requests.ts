import { spawn } from 'node:child_process';
import path from 'node:path';
/** The harness registers office requests in projects.json. Fixed command, run by the link so it shares the link's Documents access. */
export const officeRequestsCommand = (home: string) => [path.join(home, 'Documents/GitHub/AgentHarness/bin/agent-harness'), 'office-requests'] as const;
export type Spawn = (cmd: string, args: string[]) => { kill(signal: NodeJS.Signals): void; on(event: 'exit' | 'error', fn: () => void): void };
const realSpawn: Spawn = (cmd, args) => spawn(cmd, args, { shell: false, stdio: 'ignore', detached: false });
/** Best effort: 30 s limit, output discarded, and a failure never fails the user's action. */
export function processOfficeRequests(home: string, run: Spawn = realSpawn, timeout = 30_000): Promise<void> {
  return new Promise(resolve => {
    const [cmd, ...args] = officeRequestsCommand(home);
    let child: ReturnType<Spawn>;
    try { child = run(cmd, args); } catch { resolve(); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, timeout);
    timer.unref?.();
    const end = () => { clearTimeout(timer); resolve(); };
    child.on('exit', end); child.on('error', end);
  });
}
