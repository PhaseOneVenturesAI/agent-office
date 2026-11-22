import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pty from '@lydell/node-pty';
import type { SignInKind, SignInState, SignInsState } from '../shared/protocol.js';
import { defaultKimiHome, deviceLogin, findGithub, findKimi, kimiSignedIn, lastWords, plain, run, seed, trust, writeGitConfig, type Flow } from './signin-flows.js';

/*
 * Everyone's own Claude, Kimi and GitHub
 * --------------------------------------
 * In an office with accounts, each person's workers run on that person's own Claude plan, Kimi
 * account and GitHub account. Every account gets a folder, .agent-office/homes/<id>/, holding its
 * own Claude config (CLAUDE_CONFIG_DIR), Kimi home (KIMI_CODE_HOME), gh config (GH_CONFIG_DIR) and
 * git config (GIT_CONFIG_GLOBAL), and whatever runs for that account gets those in its environment
 * in place of the office's: its workers, and what the office does on GitHub when they click
 * (comment, merge, open a PR). Nothing global changes, so any number of people can be signed in to
 * different accounts at once.
 *
 * Signing in happens from the office: it runs `claude auth login`, `kimi login` or
 * `gh auth login --web` against the account's folders and hands the browser the page to open (and
 * the one-time code). A token from `claude setup-token`, a Kimi API key, or a GitHub token can be
 * pasted instead, and a shell at a desk runs with the same folders, so `claude auth login` typed
 * there works too. Admins may keep using the office machine's own sign-ins.
 *
 * An office without accounts (you alone, on the shared password) never comes here: everything runs
 * on the machine's own CLIs, exactly as before.
 */

/** Credentials the office's own environment may carry. None of them reach anything run as someone else. */
const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'];
const KIMI_VARS = ['KIMI_API_KEY', 'KIMI_BASE_URL', 'KIMI_CODE_HOME'];
const GITHUB_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL'];
const KINDS: SignInKind[] = ['claude', 'kimi', 'github'];
/** GitHub's one-time codes last 15 minutes; a Claude sign-in link gets as long. Kimi's last 30. */
const FLOW_MS = 15 * 60_000;
const KIMI_FLOW_MS = 30 * 60_000;
/** Someone's sign-ins are looked at again at most this often, unless they ask. */
const LOOK_GAP_MS = 20_000;
/** From `claude setup-token` (sk-ant-oat01-…), or an Anthropic API key (sk-ant-api03-…). */
const CLAUDE_TOKEN = /^sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}$/;
const API_KEY = /^sk-ant-api/;
/** A Kimi (Moonshot) API key. */
const KIMI_TOKEN = /^sk-[A-Za-z0-9_-]{16,}$/;
/** ghp_…, github_pat_…, gho_… and the like. */
const GITHUB_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
const ACCOUNT_ID = /^[A-Za-z0-9]{6,64}$/;
const HELP_WHERE = '☰ → 🔐 Your sign-ins';

interface Saved {
  /** Unset: its own login, in its folder. A token pasted from `claude setup-token` (or an API key). The office machine's own (admins). */
  claude?: { use: 'token'; token: string } | { use: 'office' };
  /** Unset: its own device login. A pasted Kimi API key. The office machine's own (admins). */
  kimi?: { use: 'token'; token: string } | { use: 'office' };
  github?: { use: 'office' };
  /** Who the last look found each signed in as, so workers can start before the next look. */
  seen?: { claude?: string; kimi?: string; github?: string };
}

interface Live {
  claude: Omit<SignInState, 'how'>;
  kimi: Omit<SignInState, 'how'>;
  github: Omit<SignInState, 'how'>;
  flows: Partial<Record<SignInKind, Flow>>;
  looking?: Promise<void>;
  lookedAt: number;
}

/** Whose gh the office runs for someone: their own sign-in's environment (`key` tells logins apart). */
export interface GhAs {
  key: string;
  env: Record<string, string>;
}

export class SignIns {
  private homes: string;
  private live = new Map<string, Live>();

  constructor(
    dataDir: string,
    /** The `claude`, `kimi` and `gh` binaries, or null when they aren't installed. */
    private claude: string | null,
    private kimi: string | null,
    private gh: string | null,
    /** The office's own environment, which everyone's is built on. */
    private base: () => Record<string, string>,
    /** Whether the account may use the office's own sign-ins (admins). */
    private mayUseOffice: (accountId: string) => boolean,
    private onChange: (accountId: string) => void,
  ) {
    this.homes = path.join(dataDir, 'homes');
  }

  state(id: string): SignInsState {
    const s = this.load(id);
    const l = this.get(id);
    return {
      claude: { ...l.claude, how: this.how(id, s, 'claude') },
      kimi: { ...l.kimi, how: this.how(id, s, 'kimi') },
      github: { ...l.github, how: this.how(id, s, 'github') },
      office: this.mayUseOffice(id),
    };
  }

  /** Whether `id` has a sign-in of `which` its workers can start on, as far as the last look knows. */
  ready(id: string, which: SignInKind): boolean {
    const s = this.load(id);
    return this.how(id, s, which) !== 'login' || !!s.seen?.[which];
  }

  /** What to tell someone who needs `which` signed in first. */
  why(which: SignInKind): string {
    if (which === 'kimi') return `Sign in to Kimi first (${HELP_WHERE}): your workers run on your own Kimi account`;
    return which === 'claude'
      ? `Sign in to Claude first (${HELP_WHERE}): your workers run on your own Claude plan`
      : `Sign in to GitHub first (${HELP_WHERE}): the office acts on GitHub as you`;
  }

  /**
   * Changes whenever what `id`'s Claude signs in with changes (to read its plan's limits afresh).
   * Undefined when it's the office's own.
   */
  claudeKey(id: string): string | undefined {
    const s = this.load(id);
    const how = this.how(id, s, 'claude');
    if (how === 'office') return undefined;
    return `${how}:${s.claude?.use === 'token' ? s.claude.token.slice(-12) : ''}:${s.seen?.claude ?? ''}`;
  }

  /** The GitHub login `id` acts as (for "you" on comments); undefined when it's the office's own or none. */
  githubLogin(id: string): string | undefined {
    const s = this.load(id);
    return this.how(id, s, 'github') === 'login' ? s.seen?.github?.replace(/^@/, '') : undefined;
  }

  /**
   * Puts `id`'s own sign-ins in place of the office's in `env` (changed in place, and returned).
   * `dirs` are where a worker is about to start, to carry over the office's folder trust.
   */
  apply(id: string, env: Record<string, string>, dirs: string[] = [], only?: SignInKind): Record<string, string> {
    const s = this.load(id);
    const home = this.prepare(id);
    if (only !== 'github' && only !== 'kimi' && this.how(id, s, 'claude') !== 'office') {
      for (const k of CLAUDE_VARS) delete env[k];
      env.CLAUDE_CONFIG_DIR = path.join(home, 'claude');
      if (s.claude?.use === 'token') env[API_KEY.test(s.claude.token) ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN'] = s.claude.token;
      if (dirs.length) trust(env.CLAUDE_CONFIG_DIR, dirs, this.base());
    }
    if (only !== 'github' && only !== 'claude' && this.how(id, s, 'kimi') !== 'office') {
      for (const k of KIMI_VARS) delete env[k];
      env.KIMI_CODE_HOME = path.join(home, 'kimi');
      if (s.kimi?.use === 'token') env.KIMI_API_KEY = s.kimi.token;
    }
    if (only !== 'claude' && only !== 'kimi' && this.how(id, s, 'github') !== 'office') {
      for (const k of GITHUB_VARS) delete env[k];
      env.GH_CONFIG_DIR = path.join(home, 'gh');
      env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
    }
    return env;
  }

  /** How the office runs gh for `id`: as them (GhAs), as itself (undefined, an admin's choice), or a reason it can't. */
  ghAs(id: string): GhAs | undefined | string {
    const s = this.load(id);
    if (this.how(id, s, 'github') === 'office') return undefined;
    if (!s.seen?.github) return this.why('github');
    return { key: id, env: this.apply(id, this.base(), [], 'github') };
  }

  /** Looks at who `id` is signed in as, now if `force`, else unless it just did. */
  look(id: string, force = false): Promise<void> {
    const l = this.get(id);
    if (l.looking) return l.looking;
    if (!force && Date.now() - l.lookedAt < LOOK_GAP_MS) return Promise.resolve();
    l.looking = Promise.all([this.lookClaude(id), this.lookKimi(id), this.lookGithub(id)]).then(() => {
      l.lookedAt = Date.now();
      l.looking = undefined;
      this.onChange(id);
    });
    return l.looking;
  }

  /** Starts signing `id` in from the office. The page to open comes through state(). Returns why it can't. */
  start(id: string, which: SignInKind): string | undefined {
    return which === 'claude' ? this.startClaude(id) : which === 'kimi' ? this.startKimi(id) : this.startGithub(id);
  }

  /** The code Claude's sign-in page showed, typed in where `claude auth login` waits for it. */
  code(id: string, code: string): string | undefined {
    const l = this.get(id);
    const flow = l.flows.claude;
    if (!flow?.write) return 'Start signing in to Claude first';
    const clean = code.trim();
    if (!/^[A-Za-z0-9#_.~-]{8,2048}$/.test(clean)) return "That doesn't look like the code from Claude's sign-in page";
    flow.write(`${clean}\r`);
    l.claude = { ...l.claude, pending: { ...l.claude.pending, sent: true }, error: undefined };
    this.onChange(id);
    return undefined;
  }

  cancel(id: string, which: SignInKind) {
    this.stop(id, which);
    void this.look(id, true);
  }

  /** A pasted token: from `claude setup-token` (or an API key), a Kimi API key, or a GitHub token. Resolves to why it didn't take. */
  async token(id: string, which: SignInKind, raw: string): Promise<string | undefined> {
    const token = raw.trim();
    this.stop(id, which);
    if (which === 'kimi') {
      if (!KIMI_TOKEN.test(token)) return "That isn't a Kimi API key (sk-…): make one in Kimi's platform settings";
      const s = this.load(id);
      s.kimi = { use: 'token', token };
      this.save(id, s);
      await this.look(id, true);
      return undefined;
    }
    if (which === 'claude') {
      if (!CLAUDE_TOKEN.test(token)) return "That isn't a token from `claude setup-token` (sk-ant-oat01-…) or an Anthropic API key (sk-ant-api03-…)";
      const s = this.load(id);
      s.claude = { use: 'token', token };
      this.save(id, s);
      // Claude asks once before it uses an API key from the environment; this one is theirs, so it's approved.
      if (API_KEY.test(token)) {
        seed(path.join(this.prepare(id), 'claude'), (c) => {
          c.customApiKeyResponses ??= { approved: [], rejected: [] };
          const tail = token.slice(-20);
          if (!c.customApiKeyResponses.approved.includes(tail)) c.customApiKeyResponses.approved.push(tail);
        });
      }
      await this.look(id, true);
      return undefined;
    }
    if (!this.gh) return "The GitHub CLI (gh) isn't installed on the office's machine";
    if (!GITHUB_TOKEN.test(token)) return "That doesn't look like a GitHub token (ghp_…, github_pat_…)";
    const s = this.load(id);
    delete s.github;
    this.save(id, s);
    const r = await run(this.gh, ['auth', 'login', '--hostname', 'github.com', '--with-token', '--insecure-storage'], this.githubEnv(id), `${token}\n`);
    await this.look(id, true);
    return r.code === 0 ? undefined : `GitHub didn't take that token: ${r.last || 'gh auth login failed'}`;
  }

  /** Uses the office machine's own sign-in (admins only). */
  useOffice(id: string, which: SignInKind): string | undefined {
    if (!this.mayUseOffice(id)) return "Only admins can use the office's own sign-ins";
    this.stop(id, which);
    const s = this.load(id);
    s[which] = { use: 'office' };
    this.save(id, s);
    void this.look(id, true);
    return undefined;
  }

  async signOut(id: string, which: SignInKind) {
    this.stop(id, which);
    const s = this.load(id);
    const how = this.how(id, s, which);
    if (how === 'login') await this.logout(id, which);
    delete s[which];
    if (s.seen) delete s.seen[which];
    this.save(id, s);
    if (which === 'github') this.writeGitConfig(id);
    await this.look(id, true);
  }

  /** An account is gone: sign its logins out and delete its folder. */
  forget(id: string) {
    if (!ACCOUNT_ID.test(id)) return;
    for (const which of KINDS) this.stop(id, which);
    this.live.delete(id);
    const home = path.join(this.homes, id);
    if (!existsSync(home)) return;
    // On a Mac, Claude keeps the login in the keychain, not the folder: sign out so it goes too.
    void this.logout(id, 'claude').finally(() => {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch (err) {
        console.error(`agent-office: couldn't delete ${home}: ${(err as Error).message}`);
      }
    });
  }

  /** Deletes the folders of accounts that no longer exist (revoked from the terminal meanwhile). */
  prune(accounts: Set<string>) {
    let names: string[];
    try {
      names = readdirSync(this.homes);
    } catch {
      return;
    }
    for (const n of names) if (ACCOUNT_ID.test(n) && !accounts.has(n)) this.forget(n);
  }

  shutdown() {
    for (const [id] of this.live) for (const which of KINDS) this.stop(id, which);
  }

  // ---------------------------------------------------------------------------

  /** How `which` signs `id` in. A demoted admin's 'office' no longer counts: back to their own. */
  private how(id: string, s: Saved, which: SignInKind): SignInState['how'] {
    const use = s[which]?.use;
    if (use === 'office') return this.mayUseOffice(id) ? 'office' : 'login';
    return use === 'token' ? 'token' : 'login';
  }

  private get(id: string): Live {
    let l = this.live.get(id);
    if (!l) {
      const seen = this.load(id).seen ?? {};
      l = {
        claude: seen.claude ? { status: 'ok', who: seen.claude } : { status: 'none' },
        kimi: seen.kimi ? { status: 'ok', who: seen.kimi } : { status: 'none' },
        github: seen.github ? { status: 'ok', who: seen.github } : { status: 'none' },
        flows: {},
        lookedAt: 0,
      };
      this.live.set(id, l);
    }
    return l;
  }

  private home(id: string): string {
    if (!ACCOUNT_ID.test(id)) throw new Error(`not an account id: ${id}`);
    return path.join(this.homes, id);
  }

  /** The account's folder, made on first use. */
  private prepare(id: string): string {
    const home = this.home(id);
    if (!existsSync(path.join(home, 'gitconfig'))) {
      for (const d of [this.homes, home, path.join(home, 'claude'), path.join(home, 'kimi'), path.join(home, 'gh')]) mkdirSync(d, { recursive: true, mode: 0o700 });
      seed(path.join(home, 'claude'));
      this.writeGitConfig(id);
    }
    return home;
  }

  private load(id: string): Saved {
    try {
      const s = JSON.parse(readFileSync(path.join(this.home(id), 'signins.json'), 'utf8')) as Saved;
      return s && typeof s === 'object' ? s : {};
    } catch {
      return {};
    }
  }

  private save(id: string, s: Saved) {
    this.prepare(id);
    try {
      writeFileSync(path.join(this.home(id), 'signins.json'), JSON.stringify(s, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save ${id}'s sign-ins: ${(err as Error).message}`);
    }
  }

  private stop(id: string, which: SignInKind) {
    const l = this.live.get(id);
    const flow = l?.flows[which];
    if (!l || !flow) return;
    delete l.flows[which];
    flow.stop();
    l[which] = { ...l[which], status: l[which].who ? 'ok' : 'none', pending: undefined };
  }

  /** The environment for `claude` run as `id`'s own login (never a pasted token or the office's). */
  private claudeEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of CLAUDE_VARS) delete env[k];
    env.CLAUDE_CONFIG_DIR = path.join(this.prepare(id), 'claude');
    return env;
  }

  /** The environment for `kimi` run as `id`'s own login (never a pasted key or the office's). */
  private kimiEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of KIMI_VARS) delete env[k];
    env.KIMI_CODE_HOME = path.join(this.prepare(id), 'kimi');
    return env;
  }

  private githubEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of GITHUB_VARS) delete env[k];
    const home = this.prepare(id);
    env.GH_CONFIG_DIR = path.join(home, 'gh');
    env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
    return env;
  }

  private startClaude(id: string): string | undefined {
    if (!this.claude) return "Claude Code isn't installed where the office can run it — paste a token from `claude setup-token` instead";
    this.stop(id, 'claude');
    const l = this.get(id);
    // BROWSER=true: Claude "opens" the page with the `true` command and just prints it, for the browser to show.
    const env = { ...this.claudeEnv(id), BROWSER: 'true', TERM: 'xterm-256color' };
    let p: pty.IPty;
    try {
      // Wide, so the link comes out on one line.
      p = pty.spawn(this.claude, ['auth', 'login', '--claudeai'], { name: 'xterm-256color', cols: 4000, rows: 40, cwd: this.home(id), env });
    } catch (err) {
      return `Couldn't start Claude Code's sign-in: ${(err as Error).message}`;
    }
    let out = '';
    /** Where the output after the code was sent starts, to tell a wrong code apart from the first ask. */
    let sentAt = -1;
    const flow: Flow = {
      stop: () => {
        try {
          p.kill();
        } catch {
          // already gone
        }
      },
      write: (data) => {
        sentAt = out.length;
        p.write(data);
      },
    };
    const timer = setTimeout(flow.stop, FLOW_MS);
    p.onData((d) => {
      out = (out + d).slice(-50_000);
      if (l.flows.claude !== flow) return;
      const text = plain(out);
      if (!l.claude.pending?.url) {
        const url = /https:\/\/\S*oauth\/authorize\?\S+/.exec(text)?.[0];
        if (url) {
          l.claude = { status: 'busy', pending: { url } };
          this.onChange(id);
        }
      } else if (sentAt >= 0 && /error|invalid|expired|failed/i.test(plain(out.slice(sentAt)))) {
        // Still running after complaining: the code didn't take, and it waits for another.
        const said = lastWords(out.slice(sentAt));
        sentAt = -1;
        l.claude = { status: 'busy', pending: { url: l.claude.pending.url }, error: said || "That code didn't work — copy it again, or start over" };
        this.onChange(id);
      }
    });
    p.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (l.flows.claude !== flow) return;
      delete l.flows.claude;
      if (exitCode === 0) {
        // Signed in with its own login: that's what its workers use from now on.
        const s = this.load(id);
        delete s.claude;
        this.save(id, s);
        l.claude = { status: 'busy' };
      } else l.claude = { status: 'none', error: lastWords(out) || 'Signing in stopped before it finished' };
      this.onChange(id);
      void this.look(id, true);
    });
    l.flows.claude = flow;
    l.claude = { status: 'busy', pending: {} };
    this.onChange(id);
    return undefined;
  }

  private startKimi(id: string): string | undefined {
    if (!this.kimi) return "Kimi isn't installed where the office can run it — paste a Kimi API key instead";
    this.stop(id, 'kimi');
    const l = this.get(id);
    // BROWSER=true: Kimi "opens" the page with the `true` command and just prints it, for the browser to show.
    const env = { ...this.kimiEnv(id), BROWSER: 'true' };
    // Over pipes, kimi prints the one-time code and the page, then waits for Kimi to say yes.
    const flow = deviceLogin({
      cmd: this.kimi,
      args: ['login'],
      cwd: this.home(id),
      env,
      timeoutMs: KIMI_FLOW_MS,
      find: findKimi,
      onPending: (pending) => {
        if (l.flows.kimi !== flow || l.kimi.pending?.code) return;
        l.kimi = { status: 'busy', pending };
        this.onChange(id);
      },
      onError: (message) => this.flowFailed(id, 'kimi', flow, `Couldn't start kimi: ${message}`),
      onExit: (exitCode, out) => this.flowExited(id, 'kimi', flow, exitCode, out),
    });
    l.flows.kimi = flow;
    l.kimi = { status: 'busy', pending: {} };
    this.onChange(id);
    return undefined;
  }

  private startGithub(id: string): string | undefined {
    if (!this.gh) return "The GitHub CLI (gh) isn't installed on the office's machine";
    this.stop(id, 'github');
    const l = this.get(id);
    const env = { ...this.githubEnv(id), BROWSER: 'true', GH_BROWSER: 'true' };
    // Over pipes, gh prints the one-time code and the page, then waits for GitHub to say yes.
    const flow = deviceLogin({
      cmd: this.gh,
      args: ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--insecure-storage', '--skip-ssh-key'],
      cwd: this.home(id),
      env,
      timeoutMs: FLOW_MS,
      find: findGithub,
      onPending: (pending) => {
        if (l.flows.github !== flow || l.github.pending?.code) return;
        l.github = { status: 'busy', pending };
        this.onChange(id);
      },
      onError: (message) => this.flowFailed(id, 'github', flow, `Couldn't start gh: ${message}`),
      onExit: (exitCode, out) => this.flowExited(id, 'github', flow, exitCode, out),
    });
    l.flows.github = flow;
    l.github = { status: 'busy', pending: {} };
    this.onChange(id);
    return undefined;
  }

  /** A device-code login the office was running ended: take its login, or say why not. */
  private flowExited(id: string, which: 'kimi' | 'github', flow: Flow, exitCode: number | null, out: string) {
    const l = this.get(id);
    if (l.flows[which] !== flow) return;
    delete l.flows[which];
    if (exitCode === 0) {
      // Signed in with its own login: that's what its workers use from now on.
      const s = this.load(id);
      delete s[which];
      this.save(id, s);
      l[which] = { status: 'busy' };
    } else l[which] = { status: 'none', error: lastWords(out) || 'Signing in stopped before it finished' };
    this.onChange(id);
    void this.look(id, true);
  }

  private flowFailed(id: string, which: 'kimi' | 'github', flow: Flow, message: string) {
    const l = this.get(id);
    if (l.flows[which] !== flow) return;
    delete l.flows[which];
    l[which] = { status: 'none', error: message };
    this.onChange(id);
  }

  private async lookClaude(id: string) {
    const l = this.get(id);
    if (l.flows.claude) return;
    const s = this.load(id);
    const how = this.how(id, s, 'claude');
    if (!this.claude) {
      l.claude = how === 'token' ? { status: 'ok', who: 'a pasted token' } : { status: 'none', error: "Claude Code isn't installed on the office's machine" };
      return;
    }
    const env = how === 'office' ? this.base() : this.apply(id, this.base(), [], 'claude');
    const r = await run(this.claude, ['auth', 'status', '--json'], env);
    let status: { loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string } = {};
    try {
      status = JSON.parse(r.out);
    } catch {
      // older Claude Code, or it failed: nothing to go on
    }
    if (l.flows.claude) return;
    const plan = status.subscriptionType ? ` · ${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)}` : '';
    const pasted = s.claude?.use === 'token' ? (API_KEY.test(s.claude.token) ? 'an API key' : 'a token from claude setup-token') : 'a token';
    // A token in the environment is taken on trust: whether it works shows when a worker starts.
    const who = status.loggedIn || how === 'token' ? `${status.email ?? pasted}${plan}` : undefined;
    // Signed out, `claude auth status` still answers (and exits 1); anything else went wrong.
    l.claude = who ? { status: 'ok', who } : { status: 'none', error: r.out ? undefined : r.last || undefined };
    this.remember(id, 'claude', how === 'office' ? undefined : who);
  }

  private async lookKimi(id: string) {
    const l = this.get(id);
    if (l.flows.kimi) return;
    const s = this.load(id);
    const how = this.how(id, s, 'kimi');
    if (how === 'token') {
      // A pasted key is taken on trust: whether it works shows when a worker starts.
      l.kimi = { status: 'ok', who: 'a pasted API key' };
      this.remember(id, 'kimi', l.kimi.who);
      return;
    }
    if (how === 'office') {
      l.kimi = kimiSignedIn(defaultKimiHome(this.base())) ? { status: 'ok', who: 'the office’s own' } : { status: 'none' };
      this.remember(id, 'kimi', undefined);
      return;
    }
    if (!this.kimi) {
      l.kimi = { status: 'none', error: "Kimi isn't installed on the office's machine" };
      this.remember(id, 'kimi', undefined);
      return;
    }
    const ok = kimiSignedIn(path.join(this.prepare(id), 'kimi'));
    l.kimi = ok ? { status: 'ok', who: 'your Kimi account' } : { status: 'none' };
    this.remember(id, 'kimi', l.kimi.who);
  }

  private async lookGithub(id: string) {
    const l = this.get(id);
    if (l.flows.github) return;
    const s = this.load(id);
    const how = this.how(id, s, 'github');
    if (!this.gh) {
      l.github = { status: 'none', error: "The GitHub CLI (gh) isn't installed on the office's machine" };
      return;
    }
    const r = await run(this.gh, ['api', 'user', '--jq', '{login, id, name}'], how === 'office' ? this.base() : this.githubEnv(id));
    if (l.flows.github) return;
    let user: { login?: string; id?: number; name?: string | null } = {};
    try {
      user = r.code === 0 ? JSON.parse(r.out) : {};
    } catch {
      // not JSON: treated as not signed in
    }
    if (user.login) {
      l.github = { status: 'ok', who: `@${user.login}` };
      if (how !== 'office') this.writeGitConfig(id, { name: user.name?.trim() || user.login, email: `${user.id}+${user.login}@users.noreply.github.com` });
    } else {
      const signedOut = /auth login|not logged in|authenticat|401|bad credentials/i.test(r.last);
      l.github = { status: 'none', error: signedOut || !r.last ? undefined : r.last };
    }
    this.remember(id, 'github', how === 'office' ? undefined : l.github.who);
  }

  /** Keeps who the last look found, for the next start of the office. */
  private remember(id: string, which: SignInKind, who: string | undefined) {
    const s = this.load(id);
    if ((s.seen?.[which] ?? undefined) === who) return;
    s.seen = { ...s.seen, [which]: who };
    if (!who) delete s.seen[which];
    this.save(id, s);
  }

  private async logout(id: string, which: SignInKind) {
    if (which === 'claude') {
      if (this.claude) await run(this.claude, ['auth', 'logout'], this.claudeEnv(id));
    } else if (which === 'kimi') {
      // Kimi keeps its login as files in its home: deleting them signs it out.
      rmSync(path.join(this.home(id), 'kimi', 'credentials'), { recursive: true, force: true });
    } else {
      if (this.gh) await run(this.gh, ['auth', 'logout', '--hostname', 'github.com'], this.githubEnv(id));
      rmSync(path.join(this.home(id), 'gh', 'hosts.yml'), { force: true });
    }
  }

  /** The account's git config, refreshed (see signin-flows.ts). */
  private writeGitConfig(id: string, user?: { name: string; email: string }) {
    writeGitConfig(this.home(id), this.base(), this.gh, user);
  }
}
