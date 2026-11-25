import path from 'node:path';
import os from 'node:os';
import { canonical, jsonFile, run, uuid, type Run } from './io.js';

export interface LocalProcess { pid: number; ppid: number; tool: string; cwd: string; session?: string }
export interface ProcessScan { processes: LocalProcess[]; complete: boolean }

/** Read executable names, never ps args/environment or terminal transcripts. */
export async function processes(roots: string[], execute: Run = run): Promise<ProcessScan> {
  try {
    const output = await execute('ps', ['-axo', 'pid=,ppid=,comm=']);
    const all = output.split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), bin: path.basename(match[3]) }] : [];
    });
    const candidates = all.filter((p) => /^(claude(?:-personal|-phase-one)?|codex|kimi)(?:\.exe)?$/.test(p.bin));
    if (candidates.length > 256) return { processes: [], complete: false };
    const found: LocalProcess[] = [];
    let complete = true;
    for (let i = 0; i < candidates.length; i += 8) {
      await Promise.all(candidates.slice(i, i + 8).map(async (p) => {
        try {
          const raw = await execute('lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn']);
          const cwd = canonical(raw.split('\n').find((line) => line.startsWith('n'))?.slice(1));
          if (!cwd) { complete = false; return; }
          if (!roots.includes(cwd)) return;
          let session: string | undefined;
          if (p.bin.startsWith('claude')) {
            for (const home of new Set([process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.claude-phase-one-ventures')])) {
              if (!home) continue;
              try {
                const record = jsonFile(path.join(home, 'sessions', `${p.pid}.json`), 8192);
                if (record.pid === p.pid && canonical(record.cwd) === cwd && uuid(record.sessionId)) session = record.sessionId;
              } catch { /* optional metadata; never read transcripts or session keys */ }
            }
          }
          found.push({ pid: p.pid, ppid: p.ppid, tool: p.bin.startsWith('claude') ? 'claude' : p.bin,
            cwd, ...(session ? { session } : {}) });
        } catch { complete = false; }
      }));
    }
    return { processes: found, complete };
  } catch { return { processes: [], complete: false }; }
}
