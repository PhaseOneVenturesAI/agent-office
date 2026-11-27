import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deliveredText, type LeadSend } from '../../shared/protocol/lead-talk.js';
import type { SessionRecord } from '../hq/local/sessions.js';
import { uuid } from '../cubbies/local/io.js';
import { LeadError } from '../cubbies/local/lead.js';

export function markerFile(state: string, session: string) {
  if (!uuid(session)) throw new LeadError('The lead has no reachable native session');
  return path.join(state, 'office-turns', session);
}
export function writeMarker(state: string, session: string, id: string) {
  const file = markerFile(state, session), dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  // The Mac connector lock and per-session queue own this marker. Atomic replacement
  // recovers a marker left by a crashed link, without following a symlink.
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try { writeFileSync(temporary, id, { flag: 'wx', mode: 0o600 }); renameSync(temporary, file); }
  finally { try { unlinkSync(temporary); } catch { /* renamed already */ } }
}
export function removeMarker(state: string, session: string, id: string) {
  let fd: number | undefined;
  try {
    const file = markerFile(state, session);
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd), buffer = Buffer.alloc(65);
    if (stat.isFile() && stat.size <= 64 && buffer.subarray(0, readSync(fd, buffer, 0, 65, 0)).toString().trim() === id) unlinkSync(file);
  } catch { /* a hook may have consumed the marker already */ }
  finally { if (fd !== undefined) closeSync(fd); }
}
function peerToken(home: string, pid: number): string {
  const directory = path.join(home, '.claude/sessions'), candidates: string[] = [];
  const dir = opendirSync(directory);
  try {
    let entry, count = 0;
    while ((entry = dir.readSync())) {
      if (++count > 1024) throw new LeadError('The local inbox key inventory is too large');
      if (new RegExp(`^${pid}\\.[a-fA-F0-9]{64}\\.key$`).test(entry.name)) candidates.push(entry.name);
    }
  } finally { dir.closeSync(); }
  if (candidates.length !== 1) throw new LeadError('The lead inbox key is unavailable');
  let fd: number | undefined;
  try {
    fd = openSync(path.join(directory, candidates[0]), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600 || stat.size > 4096) throw Error();
    const bytes = Buffer.alloc(4097), size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size > 4096) throw Error();
    const record = JSON.parse(bytes.subarray(0, size).toString('utf8'));
    if (typeof record.peerToken !== 'string' || !/^[a-fA-F0-9]{32}$/.test(record.peerToken)) throw Error();
    return record.peerToken;
  } catch { throw new LeadError('The lead inbox key is unavailable or has unsafe permissions'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
/** The socket and key are chosen only from local records, checked at delivery time. */
export async function sendInbox(home: string, record: SessionRecord, frame: LeadSend, signal: AbortSignal): Promise<void> {
  const socketPath = record.messagingSocketPath;
  if (!socketPath || !/^(\/private)?\/tmp\/cc-socks(-\d+)?\/\d+\.sock$/.test(socketPath)) throw new LeadError('The lead inbox socket path is not allowed');
  try { const stat = lstatSync(socketPath); if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw Error(); }
  catch { throw new LeadError('The lead inbox socket is unavailable or has unsafe ownership'); }
  if (signal.aborted) throw new LeadError('Turn cancelled');
  // This capability exists only for the socket write; it is never retained on a target or pending turn.
  const token = peerToken(home, record.pid);
  await new Promise<void>((resolve, reject) => {
    const socket = connect(socketPath);
    let done = false, sent = false, endTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (done) return; done = true;
      clearTimeout(deadline); clearTimeout(endTimer); signal.removeEventListener('abort', abort);
      socket.destroy(); if (error) reject(error); else resolve();
    };
    const abort = () => finish(new LeadError('Turn cancelled'));
    const deadline = setTimeout(() => finish(new LeadError('The lead inbox did not respond')), 5000);
    signal.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(new LeadError('Could not deliver to the lead inbox')));
    socket.on('data', () => { /* drain protocol responses, never forward them */ });
    socket.on('close', () => { if (!done) finish(new LeadError('The lead inbox closed before delivery')); });
    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'auth', token }) + '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: deliveredText(frame) } }) + '\n', error => {
        if (error) return finish(new LeadError('Could not deliver to the lead inbox'));
        sent = true;
      });
      endTimer = setTimeout(() => {
        if (!sent) return finish(new LeadError('Could not deliver to the lead inbox'));
        socket.end(() => finish());
      }, 1000);
    });
    if (signal.aborted) abort();
  });
}
