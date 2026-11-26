import { randomBytes } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanStamp, validVerdict } from '../../../shared/pitch/clean.js';
import { PITCH_LIMITS, type Pitch, type PitchVerdictPayload } from '../../../shared/protocol/pitch.js';
import { regularDirectory } from './design.js';
import { jsonFile } from './io.js';
export type SavedVerdict = PitchVerdictPayload & { ownerSig: string };
export interface VerdictTrust {
  binding: Pick<PitchVerdictPayload, 'cubbyId' | 'floorId' | 'computerId'>;
  verify(row: SavedVerdict): boolean;
}
function verified(raw: any, trust?: VerdictTrust): raw is SavedVerdict {
  return !!trust && validVerdict(raw) && typeof raw.ownerSig === 'string' && /^[A-Za-z0-9_-]{86}$/.test(raw.ownerSig) &&
    raw.cubbyId === trust.binding.cubbyId && raw.floorId === trust.binding.floorId && raw.computerId === trust.binding.computerId && trust.verify(raw);
}
function saved(row: SavedVerdict): SavedVerdict {
  const { cubbyId, floorId, computerId, requestId, at, version, pieceId, verdict, note, ownerSig } = row;
  return { cubbyId, floorId, computerId, requestId, at, version, pieceId, verdict, ...(note !== undefined ? { note } : {}), ownerSig };
}
function location(project: string) {
  const dir = path.join(project, '.agent-office'); regularDirectory(dir);
  return path.join(dir, 'pitch-feedback.json');
}
function read(project: string, trust?: VerdictTrust): SavedVerdict[] {
  try {
    const raw = jsonFile(location(project), PITCH_LIMITS.feedbackBytes);
    if (!Array.isArray(raw) || raw.length > 128) throw Error('Invalid pitch feedback');
    return raw.filter(r => verified(r, trust)).map(saved);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
export function mergeVerdicts(project: string, pitch: Pitch, trust?: VerdictTrust): Pitch {
  const rows = read(project, trust);
  return { ...pitch, pieces: pitch.pieces.map(p => {
    const { stamp: _stamp, ...piece } = p;
    const row = [...rows].reverse().find(r => r.version === pitch.version && r.pieceId === p.id);
    return { ...piece, ...(row ? { stamp: cleanStamp(row) } : {}) };
  }) };
}
export function appendVerdict(project: string, pitch: Pitch, row: SavedVerdict, trust: VerdictTrust) {
  if (!verified(row, trust) || row.version !== pitch.version) throw Error('Unverified verdict');
  let rows = read(project, trust);
  if (rows.some(r => r.requestId === row.requestId)) throw Error('Verdict already saved');
  if (!pitch.pieces.some(p => p.id === row.pieceId)) throw Error('Unknown pitch piece');
  rows.push(saved(row));
  // Preserve all IDs in the replay window; older history can be pruned to stay bounded.
  const cutoff = Date.now() - 120_000;
  while (rows.length > 128 || Buffer.byteLength(JSON.stringify(rows)) > PITCH_LIMITS.feedbackBytes) {
    const i = rows.findIndex((r, index) => r.at < cutoff && (r.version !== pitch.version ||
      !pitch.pieces.some(p => p.id === r.pieceId) || rows.slice(index + 1).some(n => n.version === r.version && n.pieceId === r.pieceId)));
    if (i < 0) throw Error('Pitch feedback is full; wait before sending again');
    rows.splice(i, 1);
  }
  const file = location(project), tmp = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600, flag: 'wx' }); renameSync(tmp, file); }
  finally { try { unlinkSync(tmp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
}
