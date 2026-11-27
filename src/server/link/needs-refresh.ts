import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
/** Local fixed command. Never accepts an executable, flags or shell text from the office. */
/** Agreed with the AgentHarness lead (2026-11-27): a full doctor.py run rewrites needs.json; exit 1 only means a health check failed. */
export const NEEDS_COMMAND = Object.freeze({ executable: existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3', relativeScript: 'Documents/GitHub/AgentHarness/doctor.py', args: Object.freeze([] as string[]), timeout: 60_000 });
export function refreshNeeds(home: string, execute = execFile): Promise<void> {
  return new Promise((resolve, reject) => {
    execute(NEEDS_COMMAND.executable, [path.join(home, NEEDS_COMMAND.relativeScript), ...NEEDS_COMMAND.args],
      { timeout: NEEDS_COMMAND.timeout, shell: false, maxBuffer: 64 * 1024, killSignal: 'SIGKILL' }, error => error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code !== 'number' ? reject(Error('Needs refresh failed')) : resolve());
  });
}
export function startNeedsRefresh(home: string, log: (line: string) => void) {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await refreshNeeds(home); } catch { log('Needs refresh failed; retrying in 5 minutes'); } finally { running = false; } };
  void tick(); const timer = setInterval(() => void tick(), 5 * 60_000);
  return () => clearInterval(timer);
}
