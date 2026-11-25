// `agent-office cubby wait|reply`: what a project's running lead session uses to talk with its
// owner's cubby through the bridge (bridge.ts). Local only: it reads and writes this computer's own
// cubby state for the project, and never reaches the office.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, run } from './io.js';
import { normalizeDeviceCode } from '../../../shared/protocol/cubbies.js';
import { waitForMessage, writeReply } from './bridge.js';
import { change, fileStore, pinnedFloors, readPins } from './devices.js';

const HELP = `agent-office cubby — the project lead's side of its cubby chat

Usage:
  agent-office cubby wait  --project <path> [--minutes <n>]
  agent-office cubby reply --project <path> --id <request-id> [--text <answer>]
  agent-office cubby devices [list | approve <code> | deny <code> | revoke <fingerprint>] --project <path> [--floor <id>]

wait   Blocks until the cubby's owner sends a message (already checked against the
       owner key pinned at join), prints it and exits 0. Exits 3 when --minutes
       (default 30) pass first. Run it in the background and start it again after
       each answer.
reply  Sends the answer to one message (from --text, or else standard input).
devices  The devices this computer trusts to talk to the project's lead, and the
       ones asking. approve adds the asking device whose code is <code> (compare it
       with the code that device shows); revoke removes a trusted one, never the last.
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
  const [verb, ...args] = argv;
  const words: string[] = [];
  let rest = args;
  if (verb === 'devices') { while (rest.length && !rest[0].startsWith('--')) words.push(rest.shift()!); }
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!/^--(project|minutes|id|text|floor)$/.test(a) || rest[i + 1] === undefined) {
      console.error(`agent-office cubby: unexpected ${a}\n\n${HELP}`);
      return 2;
    }
    opts[a.slice(2)] = rest[++i];
  }
  if ((verb !== 'wait' && verb !== 'reply' && verb !== 'devices') || !opts.project) {
    console.log(HELP);
    return verb === '-h' || verb === '--help' ? 0 : 2;
  }
  let state: string;
  try { state = await stateFor(opts.project); } catch (e) { console.error(`agent-office cubby: ${(e as Error).message}`); return 2; }
  if (verb === 'devices') {
    try { return devicesCommand(state, words, opts.floor); }
    catch (e) { console.error(`agent-office cubby devices: ${(e as Error).message}`); return 1; }
  }
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

function devicesCommand(state: string, words: string[], floorOpt?: string): number {
  const floors = pinnedFloors(state);
  const floor = floorOpt ?? (floors.length === 1 ? floors[0] : undefined);
  if (!floor || !floors.includes(floor)) {
    console.error(floors.length ? `agent-office cubby devices: choose --floor (${floors.join(', ')})` : 'agent-office cubby devices: no cubby is joined for this project on this computer');
    return 2;
  }
  const pins = readPins(state, floor)!;
  const store = fileStore(state, floor, pins[0].key);
  const [what = 'list', arg] = words;
  if (what === 'list') {
    console.log(`Trusted to talk to the lead (${pins.length}):`);
    for (const p of pins) console.log(`  ${p.fingerprint.match(/.{4}/g)!.join('-')}  ${p.label}${p.addedAt ? `  added ${new Date(p.addedAt).toISOString().slice(0, 16).replace('T', ' ')}` : ''}`);
    const waiting = store.waiting().filter((w) => Date.now() - w.at < 10 * 60_000);
    if (waiting.length) { console.log('Asking:'); for (const w of waiting) console.log(`  code ${w.code}  ${w.label}`); }
    return 0;
  }
  if (!arg || !['approve', 'deny', 'revoke'].includes(what)) { console.log(HELP); return 2; }
  let target: string | undefined;
  if (what === 'revoke') target = pins.find((p) => p.fingerprint === arg.replace(/-/g, '').toLowerCase())?.fingerprint ?? arg;
  else target = store.waiting().find((w) => normalizeDeviceCode(w.code) === normalizeDeviceCode(arg))?.key;
  if (!target) { console.error(`agent-office cubby devices: no device is asking with code ${arg}`); return 1; }
  const done = change(store, what === 'approve' ? 'add' : what as 'deny' | 'revoke', target, Date.now());
  if (done.error) { console.error(`agent-office cubby devices: ${done.error}`); return 1; }
  console.log(done.note);
  return 0;
}
