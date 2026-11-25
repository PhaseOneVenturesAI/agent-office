// The commit the office makes when a meeting in its own worktree wraps up. The message comes from
// the meeting itself: the head of the table is asked to write one (to a file in the notes, which
// the commit leaves out), and the office's canned message is the fallback when no agent answers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, statSync } from 'node:fs';

const execFileP = promisify(execFile);

/** How long the office waits for the agent's commit message before committing with its own. */
export const COMMIT_ASK_MS = 120_000;
const POLL_MS = 250;
/** The most of the agent's message that goes into the commit. */
const MESSAGE_MAX = 4_000;

/** Who is asked for the commit message, and what they're told. */
export interface CommitAsk {
  workerId: string;
  /** Where they write the message, by its full path (inside the notes, so it's kept out of the commit). */
  file: string;
  text: string;
}

/**
 * Commits everything in a meeting's checkout but `notes` (its notes, and the message file in them):
 * with the message the agent writes to `ask.file` when one comes in time, else with `canned` (the
 * agent's gets `trailer` appended, so the commit names the meeting either way). Resolves to the
 * commit's short hash, or undefined when there was nothing to commit.
 */
export async function commitMeeting(cwd: string, notes: string, canned: string, trailer: string, ask: CommitAsk | undefined, prompt: (workerId: string, text: string) => string | undefined, askMs = COMMIT_ASK_MS): Promise<string | undefined> {
  let message = canned;
  if (ask && !prompt(ask.workerId, ask.text)) {
    const since = Date.now();
    if (await waitFor(ask.file, since, askMs)) {
      const written = readMessage(ask.file);
      if (written) message = `${written}\n\n${trailer}`;
    }
  }
  return commitAll(cwd, message, notes);
}

/** Waits until `file` is there with something in it, written since `since`; false once `ms` is up. */
async function waitFor(file: string, since: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const st = statSync(file);
      if (st.isFile() && st.size > 0 && st.mtimeMs >= since - 2000) return true;
    } catch {
      // not there yet
    }
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** The agent's message, cleaned up: '' when there's nothing usable in the file. */
function readMessage(file: string): string {
  try {
    return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim().slice(0, MESSAGE_MAX).trim();
  } catch {
    return '';
  }
}

/**
 * Commits everything in a checkout but `leaveOut` (the notes); resolves to the commit's short hash, or
 * undefined when there was nothing to commit.
 */
async function commitAll(cwd: string, message: string, leaveOut: string): Promise<string | undefined> {
  const git = async (args: string[]) => (await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })).stdout.trim();
  await git(['add', '-A', '--', '.', `:(exclude)${leaveOut}`]);
  if (!(await git(['diff', '--cached', '--name-only']))) return undefined;
  await git(['commit', '-q', '-m', message]);
  return git(['rev-parse', '--short', 'HEAD']);
}
