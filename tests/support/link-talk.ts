import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { configureMac } from '../../src/server/hq/local/config.js';
import { harnessState } from '../../src/server/link/activity.js';
import type { TalkClock } from '../../src/server/link/talk.js';
import type { LeadSend } from '../../src/shared/protocol/lead-talk.js';
export const session = '12345678-1234-1234-1234-123456789abc';
export const appSession = 'local_12345678-1234-1234-1234-123456789abc';
export function fixture(t: TestContext) {
  mkdirSync('.paradev', { recursive: true });
  const home = realpathSync(mkdtempSync(path.resolve('.paradev/link-talk-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = configureMac(home), project = path.join(home, 'project'), sessions = path.join(home, '.claude/sessions');
  mkdirSync(project); mkdirSync(sessions, { recursive: true }); mkdirSync(path.dirname(config.projectsFile), { recursive: true });
  const registry = (projects: Record<string, unknown>, cofounder?: unknown) => writeFileSync(config.projectsFile, JSON.stringify({ projects, cofounder }));
  registry({ One: { path: project, leadSessionId: session, leadAppSession: appSession } });
  return { home, config, project, sessions, registry, stateDirectory: harnessState(home) };
}
export const frame = (project = 'One'): LeadSend => ({ t: 'lead.send', id: randomUUID(), target: { project }, from: 'Jonathan', text: 'Reply with pong' });
export const record = (status: 'busy' | 'idle' = 'idle') => ({ ids: [session, appSession], sessionId: session, pid: process.pid, running: true, status, updatedAt: Date.now(), messagingSocketPath: '/tmp/cc-socks/123.sock' });
export const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
export class Clock implements TalkClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  after = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return () => { this.timers.delete(id); }; };
  async advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.time = due[1].at; this.timers.delete(due[0]); due[1].fn(); await flush();
    }
    this.time = end; await flush();
  }
}
