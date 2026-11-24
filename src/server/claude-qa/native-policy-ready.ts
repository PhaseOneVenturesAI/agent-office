import { openSync, closeSync, fstatSync, readFileSync, readSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { policyHash, type PolicyEvidence } from './policy.js';

function readBounded(file: string, limit: number): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size > limit) throw new Error();
    const bytes = Buffer.alloc(limit + 1); let length = 0, n;
    while ((n = readSync(fd, bytes, length, bytes.length - length, null)) > 0) { length += n; if (length > limit) throw new Error(); }
    return bytes.subarray(0, length).toString('utf8');
  }
  finally { closeSync(fd); }
}

/** Observe only the exact transient unit's private tmpfs, without writable host mounts.
 * Held directory descriptors prevent native symlinks/renames from redirecting root reads.
 * The sole intentional symlink traversal is the kernel's /proc/PID/root namespace handle. */
export function nativeUnitPolicyReady(id: string, policy: PolicyEvidence): boolean {
  if (!/^[a-f0-9]{12}$/.test(id)) return false;
  const unit = `office-claude-qa-${id}.service`, fds: number[] = [];
  try {
    const pid = execFileSync('/usr/bin/systemctl', ['show', unit, '--property=MainPID', '--value'], { encoding: 'utf8', timeout: 1000 }).trim();
    if (!/^[1-9][0-9]{0,9}$/.test(pid)) return false;
    const stamp = () => {
      const cgroup = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
      if (!cgroup.split('\n').some(line => line.split(':').slice(2).join(':').endsWith(`/${unit}`))) throw new Error();
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    };
    const before = stamp(), directory = constants.O_RDONLY | constants.O_DIRECTORY;
    fds.push(openSync(`/proc/${pid}/root`, directory));
    for (const name of ['work', 'home']) fds.push(openSync(`/proc/self/fd/${fds.at(-1)}/${name}`, directory | constants.O_NOFOLLOW));
    if (!before || before !== stamp()) return false;
    return nativePolicyReady(`/proc/self/fd/${fds.at(-1)}`, policy);
  } catch { return false; }
  finally { for (const fd of fds.reverse()) closeSync(fd); }
}
export function nativePolicyReady(home: string, policy: PolicyEvidence): boolean {
  try {
    const log = readBounded(path.join(home, 'native-policy.log'), 1_000_000);
    if (!log.includes('[DEBUG] Policy limits: Applied new restrictions successfully') || !log.includes('[DEBUG] Remote settings: Applied new settings successfully')) return false;
    return policyHash(JSON.parse(readBounded(path.join(home, 'remote-settings.json'), 1_000_000))) === policyHash(policy.settings)
      && policyHash(JSON.parse(readBounded(path.join(home, 'policy-limits.json'), 1_000_000))) === policyHash(policy.limits);
  } catch { return false; }
}
