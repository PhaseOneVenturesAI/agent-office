import { execFile } from 'node:child_process';
import path from 'node:path';

export type KickoffRemote = { kind: 'local'; dir: string } | { kind: 'org'; org: string };
export type KickoffRunner = (command: 'git' | 'gh', args: string[], cwd: string) => Promise<string>;
export const GIT_FLAGS = ['-c', 'user.name=Agent Office', '-c', 'user.email=office@localhost',
  '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

/** Local mode takes precedence, including over an invalid org. Invalid settings fail closed. */
export function kickoffRemote(env: NodeJS.ProcessEnv = process.env): KickoffRemote | undefined {
  const dir = env.AGENT_OFFICE_KICKOFF_REMOTE;
  if (dir !== undefined) return path.isAbsolute(dir) ? { kind: 'local', dir: path.resolve(dir) } : undefined;
  const org = env.AGENT_OFFICE_KICKOFF_ORG;
  return org && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(org) ? { kind: 'org', org } : undefined;
}

export const runKickoff: KickoffRunner = (command, args, cwd) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024,
    // gh's internal git push also must not run repository hooks or interactive prompts.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' },
  }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});

/** Only called by a kickoff with the server's explicit org configuration. Tests inject a recorder. */
export async function createOrgRemote(remote: Extract<KickoffRemote, { kind: 'org' }>, slug: string,
  cwd: string, run: KickoffRunner): Promise<string> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(remote.org) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw Error('Invalid kickoff repository');
  const repo = `${remote.org}/${slug}`;
  await run('gh', ['repo', 'create', repo, '--private', '--source', '.', '--push'], cwd);
  return repo;
}
