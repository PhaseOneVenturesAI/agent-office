import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ownerPublicKey } from '../wire.js';
import { pinOf, readPins, updatePins } from './devices.js';
import { canonical, jsonFile, run, uuid, type Run } from './io.js';

export interface LocalOptions {
  ownerKey?: string; replaceOwnerKey?: boolean;
  floor?: string; project?: string; provider?: string; session?: string; profile?: string; newLead?: boolean;
  /** The lead is the project's session already running here (the Claude app, say), reached through the bridge. */
  bridge?: boolean;
}
export interface LocalConfig {
  ownerKey: string; replaceOwnerKey?: boolean;
  floor: string; project: string; roots: string[]; branches: Map<string, string>; state: string;
  computerId: string; provider: 'claude' | 'codex'; session: string;
  executable: string; claudeHome: string; fresh: boolean;
  bridge?: boolean;
}

export async function projectScope(project: string, execute: Run = run) {
  const resolved = canonical(project);
  if (!resolved) throw new Error('Local project folder does not exist');
  const top = canonical((await execute('git', ['rev-parse', '--show-toplevel'], resolved)).trim());
  if (top !== resolved) throw new Error('--project must be an actual repository/worktree root');
  const output = await execute('git', ['worktree', 'list', '--porcelain', '-z'], resolved);
  const branches = new Map<string, string>();
  let root: string | undefined;
  for (const field of output.split('\0')) {
    if (field.startsWith('worktree ')) { root = canonical(field.slice(9)); if (root) branches.set(root, ''); }
    else if (root && field.startsWith('branch ')) branches.set(root, field.slice(7).replace(/^refs\/heads\//, ''));
  }
  if (!branches.has(resolved) || branches.size > 512) throw new Error('Cannot verify project worktrees');
  return { project: resolved, roots: [...branches.keys()], branches };
}

export async function configure(options: LocalOptions, home = os.homedir(), execute: Run = run): Promise<LocalConfig> {
  if (!options.floor || options.floor.length > 128 || !options.project) throw new Error('--cubbies requires --floor and --project');
  if (!options.ownerKey) throw new Error('--cubbies requires --owner-key from the owner browser');
  ownerPublicKey(options.ownerKey);
  if (options.provider && !['claude', 'codex'].includes(options.provider)) throw new Error('--lead-provider must be claude or codex');
  if (options.profile && !['personal', 'phase-one'].includes(options.profile)) throw new Error('--lead-profile must be personal or phase-one');
  if (options.session && !uuid(options.session)) throw new Error('--lead-session must be a UUID');
  if (options.session && options.newLead) throw new Error('Choose an existing session or --new-lead, not both');
  if (options.bridge && options.newLead) throw new Error('--lead-bridge talks to the running lead; it never starts a new one');
  const scope = await projectScope(options.project, execute);
  const registryPath = path.join(home, 'Documents/AgentHarness/projects.json');
  let entry: any;
  if (existsSync(registryPath)) {
    let registry: any;
    try { registry = jsonFile(registryPath, 256 * 1024); } catch { throw new Error('Local lead registry is unreadable'); }
    const matches = Object.values(registry.projects ?? {}).filter((r: any) => {
      const p = canonical(r?.path);
      return (p && scope.roots.includes(p)) || r?.path === options.project;
    }) as any[];
    if (matches.length > 1) throw new Error('Ambiguous local project lead registry');
    entry = matches[0];
    if (entry?.localState === 'archived') throw new Error('Project is archived; historical leads cannot be resumed');
  }
  const activeSession = entry?.leadThreadId ?? entry?.leadSessionId;
  const activeProvider = entry?.leadThreadId ? 'codex' : entry?.leadSessionId ? 'claude' : undefined;
  if (activeSession && (!uuid(activeSession) || (options.session && options.session !== activeSession) ||
    (options.provider && options.provider !== activeProvider) || options.newLead)) throw new Error('Local options conflict with the current registered lead');
  if (entry && !activeSession) throw new Error('Registered project has no confirmed active lead; update its local registry first');
  const base = path.join(home, '.agent-office/cubbies');
  const common = (await execute('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], scope.project)).trim();
  const key = createHash('sha256').update(canonical(common) ?? common).digest('hex');
  const state = path.join(base, key);
  checkOwnerPin(state, options.floor, options.ownerKey, options.replaceOwnerKey);
  let saved: any;
  if (existsSync(path.join(state, 'session.json'))) saved = jsonFile(path.join(state, 'session.json'));
  const provider = activeProvider ?? saved?.provider ?? options.provider;
  const session = activeSession ?? saved?.session ?? options.session;
  if (saved && (saved.projectKey !== key || !uuid(saved.session) || (options.provider && options.provider !== saved.provider) ||
    (options.session && options.session !== saved.session) || (activeSession && activeSession !== saved.session))) throw new Error('Local persisted lead conflicts with selected session');
  if (provider !== 'claude' && provider !== 'codex') throw new Error('Choose the local lead with --lead-provider claude|codex');
  if (!session && !options.newLead) throw new Error('Select an existing --lead-session UUID, or locally authorize --new-lead');
  if (provider === 'codex' && !session) throw new Error('New Codex leads are unavailable: native exclusive turn ownership is not supported; use an existing local conversation');
  const profile = saved?.profile ?? options.profile;
  if (saved && options.profile && saved.profile !== options.profile) throw new Error('Local lead profile conflicts with its saved account');
  if (provider !== 'claude' && profile) throw new Error('--lead-profile applies to Claude only');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const computerFile = path.join(base, 'computer.json');
  if (!existsSync(computerFile)) {
    try { writeFileSync(computerFile, JSON.stringify({ id: randomUUID() }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const computerId = jsonFile(computerFile).id;
  if (!uuid(computerId)) throw new Error('Invalid locally persisted computer identity');
  const claudeHome = profile === 'phase-one' ? path.join(home, '.claude-phase-one-ventures') : profile === 'personal'
    ? path.join(home, '.claude') : process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude');
  return { ...scope, ownerKey: options.ownerKey, replaceOwnerKey: options.replaceOwnerKey, floor: options.floor, state, computerId, provider, session: session ?? randomUUID(),
    executable: profile ? `claude-${profile}` : provider, claudeHome, fresh: !options.bridge && (!session || saved?.authorizedNew === true),
    ...(options.bridge ? { bridge: true } : {}) };
}

/** Called only under the project lock, before accepting any inbound chat. */
export function persistSelection(config: LocalConfig): void {
  const file = path.join(config.state, 'session.json');
  if (existsSync(file) && jsonFile(file).session !== config.session) throw new Error('Project lead changed while acquiring its lock');
  persistOwnerPin(config);
  const record = { projectKey: path.basename(config.state), provider: config.provider, session: config.session, authorizedNew: config.fresh,
    profile: config.executable === 'claude-personal' ? 'personal' : config.executable === 'claude-phase-one' ? 'phase-one' : undefined };
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
}

function checkOwnerPin(state: string, floor: string, ownerKey: string, replace = false): void {
  const pins = readPins(state, floor);
  if (pins && !pins.some((p) => p.key === ownerKey) && !replace) throw new Error('Different --owner-key: use --replace-owner-key locally only to authorize this device');
}
/**
 * Recheck under the project lock. The first device is pinned here; --replace-owner-key (for a key that isn't
 * trusted yet) starts the list again from this one device. More devices are added by a trusted one (devices.ts), never by join.
 */
function persistOwnerPin(config: LocalConfig): void {
  ownerPublicKey(config.ownerKey);
  updatePins(config.state, config.floor, pins => {
    if (pins?.some(p => p.key === config.ownerKey)) return pins;
    if (pins && !config.replaceOwnerKey) throw new Error('Different --owner-key: use --replace-owner-key locally only to authorize this device');
    return [pinOf(config.ownerKey, 'First device', Date.now())];
  });
}
