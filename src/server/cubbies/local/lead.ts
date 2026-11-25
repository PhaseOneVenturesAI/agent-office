import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LocalConfig } from './config.js';
import { jsonFile, nativeEnv, run, type Run } from './io.js';
import { alive } from './lock.js';
import { processes, type ProcessScan } from './processes.js';

export const CODEX_BLOCKER = 'Codex desktop chat unavailable: the installed native turn/start protocol can steer an active turn and has no atomic idle-only ownership guard. Use the existing Codex conversation locally; no second lead was started.';
export const APPROVAL_NOTICE = 'Native permission approval needs your local Claude terminal. Resume the same session locally to review it; Office cannot approve tools.';
export class LeadError extends Error {}
export interface Lead {
  send(text: string, signal: AbortSignal): Promise<string>;
  stop(): Promise<void>;
  readonly busy: boolean;
  readonly blocker?: string;
}
export function claudeSessionFile(config: LocalConfig): string | undefined {
  for (const root of config.roots) {
    const file = path.join(config.claudeHome, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'), `${config.session}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Native session inventory also catches a desktop whose cwd is a scratch folder.
 * Read only small metadata JSON, never the adjacent messaging keys or transcripts.
 */
export function sessionBusy(config: LocalConfig, isAlive = alive): boolean {
  const directory = path.join(config.claudeHome, 'sessions');
  let files: string[];
  try { files = readdirSync(directory).filter((name) => /^\d+\.json$/.test(name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new LeadError('Native session inventory unavailable'); }
  if (files.length > 512) throw new LeadError('Native session inventory exceeds its safety limit');
  for (const file of files) {
    let record: any;
    try { record = jsonFile(path.join(directory, file), 8192); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw new LeadError('Native session inventory unreadable'); }
    if (record.sessionId === config.session) {
      if (!Number.isSafeInteger(record.pid) || record.pid <= 1) throw new LeadError('Selected native session has invalid ownership metadata');
      if (isAlive(record.pid)) return true;
    }
  }
  return false;
}

/** Fixed native CLI and locally selected session. No remote executable/flags/path. */
export class NativeLead implements Lead {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: Promise<string>;
  private cancel?: () => void;
  private running = false;
  get busy() { return this.running; }
  get blocker() { return this.config.provider === 'codex' ? CODEX_BLOCKER : undefined; }
  constructor(private config: LocalConfig, private scan: () => Promise<ProcessScan> = () => processes(config.roots), private execute: Run = run) {}

  async send(text: string, signal: AbortSignal): Promise<string> {
    if (this.blocker) throw new LeadError(this.blocker);
    if (this.running) throw new LeadError('Project lead is busy');
    this.running = true;
    try {
      let auth: any;
      try { auth = JSON.parse(await this.execute(this.config.executable, ['auth', 'status', '--json'], this.config.project)); }
      catch { throw new LeadError('Cannot verify native Claude subscription sign-in for this local profile'); }
      if (auth.loggedIn !== true || auth.authMethod !== 'claude.ai' || auth.apiProvider !== 'firstParty') {
        throw new LeadError('This connector requires native Claude subscription sign-in; API credentials are not accepted');
      }
      const scan = await this.scan();
      if (signal.aborted) throw new LeadError('Turn cancelled');
      if (!scan.complete) throw new LeadError('Cannot verify whether the local lead is busy; process inspection is unavailable');
      if (sessionBusy(this.config)) throw new LeadError('Selected lead is open in another native terminal or desktop; close that session before connecting chat');
      // Conservative: a live same-provider project session owns its native terminal.
      if (scan.processes.some((p) => p.tool === this.config.provider || p.tool === 'agent-worker')) throw new LeadError('Project lead is busy in a local terminal; no concurrent session was started');
      const existing = claudeSessionFile(this.config);
      if (!existing && !this.config.fresh) throw new LeadError('Selected native session is missing or archived in this account profile; no new lead was created');
      const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        existing ? '--resume' : '--session-id', this.config.session];
      // Consume new-session authorization before launch. A crash or deleted/archived
      // native session must never cause automatic recreation on the next join.
      if (this.config.fresh) {
        const file = path.join(this.config.state, 'session.json');
        const saved = jsonFile(file);
        if (saved.session !== this.config.session) throw new LeadError('Local lead selection changed');
        writeFileSync(file, JSON.stringify({ ...saved, authorizedNew: false }), { mode: 0o600 });
        this.config.fresh = false;
      }
      this.pending = this.turn(args, text, signal);
      return await this.pending;
    } finally { this.running = false; this.pending = undefined; }
  }

  private turn(args: string[], text: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.executable, args, { cwd: this.config.project, env: nativeEnv(),
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let output = '', bytes = 0, answer = '', success = false, stopped: string | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const kill = (sig: NodeJS.Signals) => {
        if (!child.pid) return;
        try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* child already exited */ }
      };
      const cancel = (message = 'Turn cancelled') => {
        if (stopped) return;
        stopped = message; kill('SIGTERM');
        killTimer = setTimeout(() => kill('SIGKILL'), 750);
      };
      this.cancel = cancel;
      const abort = () => cancel();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => cancel('Native turn exceeded its ten minute limit; resume locally'), 10 * 60_000);
      const parse = (line: string) => {
        let frame: any;
        try { frame = JSON.parse(line); } catch { cancel('Native output was not valid structured data'); return; }
        if (frame.session_id !== this.config.session) {
          // Only session-bound assistant/result frames are eligible to leave this process.
          if (frame.type === 'assistant' || frame.type === 'result') cancel('Native session identity did not match the selected lead');
          return;
        }
        if (frame.type === 'assistant' && frame.parent_tool_use_id == null && Array.isArray(frame.message?.content)) {
          for (const block of frame.message.content) if (block.type === 'text' && typeof block.text === 'string') {
            answer = (answer + (answer ? '\n' : '') + block.text).slice(0, 8000);
          }
        }
        if (frame.type === 'result') {
          if (Array.isArray(frame.permission_denials) && frame.permission_denials.length) cancel(APPROVAL_NOTICE);
          else if (frame.is_error || frame.subtype !== 'success') cancel('Native lead could not complete this turn. Check the same session locally; native approval may be required.');
          else success = true;
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1024 * 1024) { cancel('Native output exceeded its size limit'); return; }
        output += chunk;
        let index: number;
        while ((index = output.indexOf('\n')) >= 0) { const line = output.slice(0, index); output = output.slice(index + 1); if (line.trim() && !stopped) parse(line); }
      });
      // Drain but never parse, log, or forward stderr/tool output.
      child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) cancel('Native output exceeded its size limit'); });
      child.stdin.on('error', () => cancel('Native lead input closed'));
      child.on('error', () => cancel('Native lead executable unavailable in the selected local profile'));
      child.on('close', (code) => {
        if (output.trim() && !stopped) parse(output);
        clearTimeout(timeout); if (killTimer) clearTimeout(killTimer);
        // If the native CLI exited before its tools, stop only its own process group.
        if (stopped) kill('SIGKILL');
        signal.removeEventListener('abort', abort);
        this.child = undefined; this.cancel = undefined;
        if (stopped) reject(new LeadError(stopped));
        else if (code !== 0 || !success) reject(new LeadError('Native lead did not finish; check the same session locally. No automatic retry.'));
        else resolve(answer || 'The lead finished without an assistant text response.');
      });
      if (signal.aborted) abort();
      else child.stdin.end(JSON.stringify({ type: 'user', session_id: this.config.session, message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n');
    });
  }

  async stop(): Promise<void> { this.cancel?.(); try { await this.pending; } catch { /* already reported or disconnected */ } }
}
