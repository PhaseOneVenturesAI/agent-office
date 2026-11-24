import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync, chmodSync, mkdirSync, rmSync, readdirSync, openSync, readSync, closeSync, constants } from 'node:fs';
import path from 'node:path';
import { CLAUDE_QA_SHA256, qualifyJob, type ApprovedQaJob } from './policy.js';
import { createClaudeQaBroker, type Transport } from './broker.js';
import { nativeUnitPolicyReady } from './native-policy-ready.js';

const imageFiles = new Set(['broker.sock', 'qa-ca.pem', 'qa-auth.json', 'qa-account.json', 'etc/passwd', 'etc/group', 'etc/hosts', 'etc/nsswitch.conf', 'etc/claude-code/managed-settings.json', 'opt/qa/launcher', 'opt/claude/claude', 'lib64/ld-linux-x86-64.so.2', ...['ld-linux-x86-64.so.2', 'libc.so.6', 'librt.so.1', 'libpthread.so.0', 'libdl.so.2', 'libm.so.6'].map(name => `lib/x86_64-linux-gnu/${name}`)]);
const imageDirs = new Set(['opt', 'opt/qa', 'opt/claude', 'lib', 'lib/x86_64-linux-gnu', 'lib64', 'etc', 'etc/claude-code', 'work', 'tmp', 'proc', 'dev', 'sys', 'var', 'var/tmp', 'root', 'usr', 'run']);
function fileHash(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256'), bytes = Buffer.alloc(64 * 1024);
  try { let n; while ((n = readSync(fd, bytes, 0, bytes.length, null)) > 0) hash.update(bytes.subarray(0, n)); return hash.digest('hex'); }
  finally { closeSync(fd); }
}
/** A privileged prototype entry point, NOT registered with Office or granted through sudo/polkit. */
export function verifyImage(root: string): void {
  if (realpathSync(root) !== root) throw new Error('Image must have a canonical path.');
  for (let p = root; ; p = path.dirname(p)) {
    const s = lstatSync(p);
    if (!s.isDirectory() || s.uid !== 0 || (s.mode & 0o022)) throw new Error('Image ancestry must be root-owned and immutable to other users.');
    if (p === '/') break;
  }
  const manifestStat = lstatSync(path.join(root, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.uid !== 0 || (manifestStat.mode & 0o022)) throw new Error('Unsafe image manifest.');
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { claudeVersion: string; files: Record<string,string> };
  if (!manifest.files || Object.keys(manifest.files).length !== imageFiles.size || Object.keys(manifest.files).some(p => !imageFiles.has(p))) throw new Error('Unexpected image contents.');
  if (manifest.claudeVersion !== '2.1.331' || manifest.files['opt/claude/claude'] !== CLAUDE_QA_SHA256 || !manifest.files['opt/qa/launcher']) throw new Error('Unqualified image manifest.');
  const found = new Set<string>();
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name), s = lstatSync(p), rel = path.relative(root, p);
      if (s.uid !== 0 || (s.mode & 0o022) || s.isSymbolicLink()) throw new Error('Unsafe image artifact.');
      if (s.isDirectory()) { if (!imageDirs.has(rel)) throw new Error('Unexpected image directory.'); walk(p); }
      else if (!s.isFile()) throw new Error('Unexpected image node.');
      else if (rel !== 'manifest.json') {
        found.add(rel);
        if (fileHash(p) !== manifest.files[rel]) throw new Error('Image checksum mismatch.');
      }
    }
  }
  walk(root);
  if (found.size !== Object.keys(manifest.files).length) throw new Error('Image manifest mismatch.');
}

export function unitProperties(root: string, jobDir: string, id: string, runtimeSeconds = 120): string[] {
  if (!/^[a-f0-9]{12}$/.test(id) || ![root, jobDir].every(p => /^\/[a-zA-Z0-9_./-]+$/.test(p)) || !Number.isInteger(runtimeSeconds) || runtimeSeconds < 1 || runtimeSeconds > 120) throw new Error('Invalid fixed-runner configuration.');
  return [
    `RootDirectory=${root}`, `DynamicUser=yes`, `User=qa-${id}`, 'WorkingDirectory=/work',
    'PrivateNetwork=yes', 'RestrictAddressFamilies=AF_UNIX AF_INET', 'PrivateDevices=yes',
    'ProtectSystem=strict', 'ProtectHome=yes', 'ProtectProc=invisible', 'ProcSubset=pid',
    'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=', 'RestrictNamespaces=yes',
    'RestrictSUIDSGID=yes', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectControlGroups=yes',
    'PrivateIPC=yes', 'UMask=0077', 'NoExecPaths=/', 'ExecPaths=/opt/qa /opt/claude /lib /lib64',
    'TemporaryFileSystem=/work:rw,nosuid,nodev,noexec,mode=1777,size=32M /tmp:rw,nosuid,nodev,noexec,mode=1777,size=16M',
    `BindReadOnlyPaths=${jobDir}/broker.sock:/broker.sock ${jobDir}/policy.json:/etc/claude-code/managed-settings.json ${jobDir}/ca.pem:/qa-ca.pem ${jobDir}/auth.json:/qa-auth.json ${jobDir}/account.json:/qa-account.json`,
    'KillMode=control-group', 'TimeoutStopSec=3s', `RuntimeMaxSec=${runtimeSeconds}s`, 'TasksMax=32', 'MemoryMax=1G', 'CPUQuota=100%',
  ];
}

export async function runClaudeQaIsolated(opts: { image: string; job: ApprovedQaJob; accessToken: string; transport?: Transport; runtimeSeconds?: number; runtimeId?: string }): Promise<{ ok: boolean; answer?: string; why?: string; metrics: { forwarded: boolean; accepted: number; denied: number }; policyDigest: string }> {
  if (opts.runtimeId !== undefined && !/^[a-f0-9]{12}$/.test(opts.runtimeId)) throw new Error('Invalid controller runtime identity.');
  if (process.getuid?.() !== 0 || process.platform !== 'linux') throw new Error('The isolated Claude runtime requires the reviewed root-owned Linux controller.');
  const job = structuredClone(opts.job), policy = qualifyJob(job); verifyImage(opts.image);
  const id = opts.runtimeId ?? randomBytes(6).toString('hex'), unit = `office-claude-qa-${id}`;
  const parent = path.dirname(opts.image), jobDir = path.join(parent, `job-${id}`);
  mkdirSync(jobDir, { mode: 0o700 });
  let broker: Awaited<ReturnType<typeof createClaudeQaBroker>> | undefined;
  try {
    broker = await createClaudeQaBroker({ socket: path.join(jobDir, 'broker.sock'), job, accessToken: opts.accessToken, transport: opts.transport, timeoutMs: (opts.runtimeSeconds ?? 120) * 1000, nativePolicyReady: () => nativeUnitPolicyReady(id, job.policy) });
    const n = job.policy.nativeIdentity;
    const account = { accountUuid: n.accountUuid, organizationUuid: n.organizationUuid, ...(n.workspaceUuid ? { workspaceUuid: n.workspaceUuid } : {}) };
    const files = { 'policy.json': JSON.stringify(policy.settings), 'ca.pem': broker.certificate,
      'auth.json': JSON.stringify({ claudeAiOauth: { ...account, subscriptionType: n.subscriptionType, scopes: n.scopes, expiresAt: n.expiresAt, accessToken: broker.capability, refreshToken: '' } }),
      'account.json': JSON.stringify({ oauthAccount: account, hasCompletedOnboarding: true }) };
    for (const [name, body] of Object.entries(files)) { const p = path.join(jobDir, name); writeFileSync(p, body, { mode: 0o400 }); chmodSync(p, 0o444); }
    const args = ['--quiet', '--wait', '--pipe', '--collect', '--service-type=exec', `--unit=${unit}`, ...unitProperties(opts.image, jobDir, id, opts.runtimeSeconds).flatMap(p => ['--property', p]), '--setenv', `QA_CAPABILITY=${broker.capability}`, '/opt/qa/launcher'];
    const outcome = await new Promise<{ ok: boolean; answer?: string; why?: string }>(resolve => {
      const child = spawn('/usr/bin/systemd-run', args, { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe','pipe','pipe'] });
      const chunks: Buffer[] = []; let size = 0, tooLarge = false, settled = false, policyFailed = false, errorTail = '';
      const stop = () => { try { execFileSync('/usr/bin/systemctl', ['stop', `${unit}.service`], { stdio: 'ignore', timeout: 6000 }); } catch { /* Already collected. */ } };
      const timer = setTimeout(stop, ((opts.runtimeSeconds ?? 120) + 5) * 1000);
      const finish = (result: { ok: boolean; answer?: string; why?: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 1_000_000) { tooLarge = true; stop(); } else chunks.push(chunk); });
      child.stderr.on('data', chunk => {
        size += chunk.length; errorTail = (errorTail + chunk.toString()).slice(-4096);
        if (/Managed settings failed to load|policies from the failed source are NOT in effect/.test(errorTail)) { policyFailed = true; stop(); }
        if (size > 1_000_000) { tooLarge = true; stop(); }
      });
      child.on('error', () => finish({ ok: false, why: 'Isolated Claude could not start.' }));
      child.on('close', code => {
        if (code !== 0 || tooLarge || policyFailed) return finish({ ok: false, why: 'Isolated Claude stopped without a qualified answer.' });
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (result.type !== 'result' || result.is_error || typeof result.result !== 'string' || !result.result.trim() || broker?.metrics().accepted !== 1) throw new Error();
          finish({ ok: true, answer: result.result });
        } catch { finish({ ok: false, why: 'Isolated Claude returned an unsupported result.' }); }
      });
      child.stdin.on('error', () => {}); child.stdin.end(job.prompt);
    });
    return { ...outcome, metrics: broker.metrics(), policyDigest: policy.digest };
  } finally {
    try { execFileSync('/usr/bin/systemctl', ['stop', `${unit}.service`], { stdio: 'ignore', timeout: 6000 }); } catch { /* Collected unit is already gone. */ }
    await broker?.close(); rmSync(jobDir, { recursive: true, force: true });
  }
}
