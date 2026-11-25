import { execFile } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';

export type Run = (bin: string, args: string[], cwd?: string) => Promise<string>;
/** Fixed executables/argv only. Never expose stderr (which may contain credentials). */
export const run: Run = (bin, args, cwd) => new Promise((resolve, reject) => {
  execFile(bin, args, { cwd, encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024,
    killSignal: 'SIGKILL', env: nativeEnv() }, (error, stdout) => {
    if (error) reject(new Error('Local metadata source unavailable'));
    else resolve(stdout);
  });
});

/** Keep native configuration/account locations; never inherit API/gateway credentials. */
export function nativeEnv(env = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CLAUDE_CODE_|AGENT_OFFICE_NODE_TOKEN$|CLAUDECODE$|CLAUDE_API_KEY$)/.test(key)));
}

export function jsonFile(file: string, limit = 64 * 1024): any {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid local record');
    const buffer = Buffer.alloc(limit + 1);
    const count = readSync(fd, buffer, 0, limit + 1, 0);
    if (count > limit) throw new Error('Local record exceeds its size limit');
    return JSON.parse(buffer.subarray(0, count).toString('utf8'));
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function canonical(value: unknown): string | undefined {
  try { return typeof value === 'string' ? realpathSync(value) : undefined; } catch { return undefined; }
}
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const clean = (value: unknown, length = 120): string => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, length) : '';
