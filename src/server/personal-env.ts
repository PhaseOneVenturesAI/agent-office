import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** Ambient provider credentials and startup/config overrides never belong to a named account. */
const PRIVATE_PREFIX = /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_|KIMI_|MOONSHOT_|OPENAI_|CODEX_ACCESS_|GROK_|XAI_|MUSE_|CURSOR_|OPENCODE_|DEEPSEEK_|DSH_|PI_|AWS_|AZURE_|GOOGLE_|GEMINI_|GIT_CONFIG_)/;
const PRIVATE_KEYS = new Set([
  'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CODEX_HOME',
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSH', 'GIT_SSH_COMMAND',
  'BASH_ENV', 'ENV', 'ZDOTDIR', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS',
]);

/** Separate native discovery roots as well as explicit variables; this is credential routing, not an OS sandbox. */
export function personalEnv(env: Record<string, string>, home: string): Record<string, string> {
  for (const key of Object.keys(env)) if (PRIVATE_PREFIX.test(key) || PRIVATE_KEYS.has(key)) delete env[key];
  Object.assign(env, {
    HOME: home, USERPROFILE: home, ZDOTDIR: home,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    CLAUDE_CONFIG_DIR: path.join(home, 'claude'), KIMI_CODE_HOME: path.join(home, 'kimi'), CODEX_HOME: path.join(home, 'codex'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  });
  return env;
}

/** Remove only the known generated host include; retain the previous bytes and personal identity. */
export function migratePersonalGitConfig(home: string): void {
  const file = path.join(home, 'gitconfig');
  let old: string;
  try { old = readFileSync(file, 'utf8'); } catch { return; }
  if (!old.startsWith('# Written by Agent Office:')) return;
  const clean = old.replace(/^\[include\]\r?\n(?:\tpath = [^\n]*\r?\n)+/m, '');
  if (clean === old) return;
  writeFileSync(`${file}.before-personal-${randomBytes(6).toString('hex')}`, old, { mode: 0o600, flag: 'wx' });
  writeFileSync(file, clean, { mode: 0o600 });
}
