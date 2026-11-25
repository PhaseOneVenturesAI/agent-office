import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { alive, projectLock } from './lock.js';

const WAIT_MS = 500;
const INCOMPLETE_MS = 30_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Cross-process device transaction. Never expire a live owner, even if it is slow.
 * The existing directory lock serializes acquisition/recovery, so competing stale-lock
 * removers cannot unlink a replacement lock. It is held only while inspecting the lock,
 * never during the transaction. Incomplete acquisition guards fail closed. */
export function withDeviceLock<T>(pinFile: string, edit: () => T): T {
  const file = `${pinFile}.lock`, deadline = performance.now() + WAIT_MS;
  for (;;) {
    let releaseGuard: (() => void) | undefined, fd: number | undefined;
    try {
      try { releaseGuard = projectLock(`${file}.guard`); } catch { /* another process is acquiring */ }
      if (releaseGuard) {
        try { fd = openSync(file, 'wx', 0o600); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          // Only a dead PID is stale. An incomplete file can be recovered after a grace
          // period: its writer cannot still be initializing it while we hold the guard.
          let pid: number | undefined;
          try { pid = JSON.parse(readFileSync(file, 'utf8')).pid; } catch { /* incomplete */ }
          const valid = Number.isSafeInteger(pid) && pid! > 0;
          try {
            if (valid ? !alive(pid!) : Date.now() - statSync(file).mtimeMs > INCOMPLETE_MS) unlinkSync(file);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (fd !== undefined) {
          try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); }
          catch (error) { closeSync(fd); fd = undefined; unlinkSync(file); throw error; }
        }
      }
    } finally { releaseGuard?.(); }
    if (fd !== undefined) {
      try { return edit(); }
      finally { closeSync(fd); unlinkSync(file); }
    }
    if (performance.now() >= deadline) throw new Error('Trusted devices are busy; try again shortly');
    Atomics.wait(sleeper, 0, 0, 10);
  }
}
