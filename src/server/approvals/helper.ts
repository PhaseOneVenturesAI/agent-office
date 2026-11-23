import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
/** Self-contained command hook, installed in Office's data directory. No provider credentials. */
export function writeApprovalHelper(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'native-approval.cjs');
  writeFileSync(file, APPROVAL_HELPER, { mode: 0o600 }); return file;
}
export const APPROVAL_HELPER = String.raw`'use strict';
const MAX = 64 * 1024;
async function run(provider, input) {
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!base || !token || !worker || !['claude','codex'].includes(provider)) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.agent_id || input.agent_type) return {};
  try {
    const url = new URL('/approvals/' + provider, base);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.protocol !== 'http:') return {};
    url.searchParams.set('worker', worker);
    const response = await fetch(url, { method:'POST', headers:{ authorization:'Bearer '+token, 'content-type':'application/json' }, body:JSON.stringify(input), signal:AbortSignal.timeout(302000) });
    if (!response.ok) return {};
    const value = await response.json(), decision = value?.hookSpecificOutput?.decision?.behavior;
    if (value?.hookSpecificOutput?.hookEventName !== 'PermissionRequest' || !['allow','deny'].includes(decision)) return {};
    return {hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:decision}}};
  } catch { return {}; }
}
module.exports = { run };
if (require.main === module) {
  let bytes = 0, overflow = false; const chunks = [];
  process.stdin.on('data', c => { bytes += c.length; if (bytes > MAX) overflow = true; else chunks.push(c); });
  process.stdin.on('end', async () => {
    let input; try { if (!overflow) input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    process.stdout.write(JSON.stringify(await run(process.argv[2], input)));
  });
}
`;
