import { execFileSync } from 'node:child_process';
import type { WorkerInfo } from '../../shared/protocol.js';
export type AutonomyMode = 'off' | 'supervised' | 'autonomous';
export const isAutonomy = (v: unknown): v is AutonomyMode => v === 'off' || v === 'supervised' || v === 'autonomous';
/** Old informational labels are not permission to change a runtime's security mode. */
export function confirmedAutonomy(role: { autonomy?: string; autonomyConfirmed?: boolean } | undefined): AutonomyMode | undefined {
  return role?.autonomyConfirmed && isAutonomy(role.autonomy) ? role.autonomy : undefined;
}
const versions: Record<string, string> = { claude: '2.1.330', codex: '0.171.0-alpha.13', kimi: '2.7.2' };
/** Exact installed versions inspected, not assumptions about future CLI flag semantics. */
export function prepareAutonomy(info: WorkerInfo, file: string | undefined, args: string[], readVersion = (file: string) => execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })): string | undefined {
  const mode = info.autonomyRequested;
  if (mode === undefined) return;
  delete info.autonomyApplied;
  if (!isAutonomy(mode)) return 'Unknown autonomy mode.';
  const provider = info.provider;
  if (!provider || !versions[provider] || !file) return 'This provider has no verified Office autonomy mode.';
  let version: string | undefined;
  try { version = /(\d+\.\d+\.\d+(?:-[\w.-]+)?)/.exec(readVersion(file))?.[1]; } catch { /* unavailable */ }
  if (version !== versions[provider]) return `Autonomy is not verified for this ${provider} CLI version. Keep the current session or verify this version first.`;
  if (args.some(a => /^(?:--(?:dangerously|permission-mode|allow-dangerously|approve-for-me|sandbox|ask-for-approval|auto|yolo)|-[asy])(?:$|=|-)/.test(a) || /^(?:approval_policy|sandbox_mode|permissions)\s*=/.test(a))) return 'Office launch arguments already choose a permission mode. Remove the conflicting override before applying role autonomy.';
  const automatic = mode === 'autonomous';
  if (provider === 'claude') args.push('--permission-mode', automatic ? 'auto' : 'manual');
  if (provider === 'codex') args.push('--sandbox', automatic ? 'workspace-write' : 'read-only', ...(automatic ? ['--approve-for-me'] : ['--ask-for-approval', 'on-request']));
  // Kimi ignores the root CLI flags in ACP. Its session/set_mode ACK sets applied below.
  if (provider !== 'kimi') info.autonomyApplied = { mode, provider, acknowledged: false, detail: provider === 'claude' ? `Claude ${automatic ? 'auto review' : 'manual approvals'} requested at launch` : `Codex ${automatic ? 'automatic review, workspace-write sandbox' : 'on-request approvals, read-only sandbox'} requested at launch` };
}
