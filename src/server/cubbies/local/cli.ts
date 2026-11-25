// `agent-office cubby wait|reply`: what a project's running lead session uses to talk with its
// owner's cubby through the bridge (bridge.ts). Local only: it reads and writes this computer's own
// cubby state for the project, and never reaches the office.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, run } from './io.js';
import { waitForMessage, writeReply } from './bridge.js';

const HELP = `agent-office cubby — the project lead's side of its cubby chat

Usage:
  agent-office cubby wait  --project <path> [--minutes <n>]
  agent-office cubby reply --project <path> --id <request-id> [--text <answer>]

wait   Blocks until the cubby's owner sends a message (already checked against the
       owner key pinned at join), prints it and exits 0. Exits 3 when --minutes
       (default 30) pass first. Run it in the background and start it again after
       each answer.
reply  Sends the answer to one message (from --text, or else standard input).
`;

/** This computer's cubby state for the project at `project` (as join keeps it). */
export async function stateFor(project: string, home = os.homedir()): Promise<string> {
  const root = canonical(project);
  if (!root) throw new Error('Local project folder does not exist');
  const common = (await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root)).trim();
  const key = createHash('sha256').update(canonical(common) ?? common).digest('hex');
  return path.join(home, '.agent-office/cubbies', key);
}

export async function cubbyCommand(argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!/^--(project|minutes|id|text)$/.test(a) || rest[i + 1] === undefined) {
      console.error(`agent-office cubby: unexpected ${a}\n\n${HELP}`);
      return 2;
    }
    opts[a.slice(2)] = rest[++i];
  }
  if ((verb !== 'wait' && verb !== 'reply') || !opts.project) {
    console.log(HELP);
    return verb === '-h' || verb === '--help' ? 0 : 2;
  }
  let state: string;
  try { state = await stateFor(opts.project); } catch (e) { console.error(`agent-office cubby: ${(e as Error).message}`); return 2; }
  if (verb === 'wait') {
    const minutes = Math.min(240, Math.max(1, Number(opts.minutes ?? 30) || 30));
    const stop = new AbortController();
    process.once('SIGTERM', () => stop.abort());
    process.once('SIGINT', () => stop.abort());
    const m = await waitForMessage(state, minutes * 60_000, stop.signal);
    if (!m) { console.log('No cubby message yet.'); return 3; }
    console.log([
      `Cubby chat from this cubby's owner (signature checked against the owner key pinned on this computer), sent ${new Date(m.at).toISOString()}.`,
      `request: ${m.requestId}`,
      '--- message ---',
      m.text,
      '--- end ---',
      `Answer with: agent-office cubby reply --project ${opts.project} --id ${m.requestId} --text "<answer>"`,
    ].join('\n'));
    return 0;
  }
  if (!opts.id) { console.error('agent-office cubby reply: --id is required'); return 2; }
  const text = opts.text ?? readFileSync(0, 'utf8');
  if (!text.trim()) { console.error('agent-office cubby reply: the answer is empty'); return 2; }
  try { writeReply(state, opts.id, text.trim()); } catch (e) { console.error(`agent-office cubby reply: ${(e as Error).message}`); return 1; }
  console.log('Sent to your cubby.');
  return 0;
}
