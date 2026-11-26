import { randomBytes } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanStamp } from '../../../shared/pitch/clean.js';
import { PITCH_LIMITS, type Pitch, type PitchStamp } from '../../../shared/protocol/pitch.js';
import { regularDirectory } from './design.js';
import { jsonFile } from './io.js';
type Saved = { version: string; pieceId: string } & PitchStamp;
function location(project: string) {
  const dir = path.join(project, '.agent-office'); regularDirectory(dir);
  return path.join(dir, 'pitch-feedback.json');
}
function read(project: string): Saved[] {
  try {
    const raw = jsonFile(location(project), PITCH_LIMITS.feedbackBytes);
    if (!Array.isArray(raw) || raw.length > 128) throw Error('Invalid pitch feedback');
    return raw.flatMap(r => { const stamp = cleanStamp(r); return stamp && typeof r.version === 'string' && typeof r.pieceId === 'string' ? [{ ...stamp, version: r.version.slice(0, 64), pieceId: r.pieceId.slice(0, 64) }] : []; });
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
export function mergeVerdicts(project: string, pitch: Pitch): Pitch {
  const rows = read(project);
  return { ...pitch, pieces: pitch.pieces.map(p => {
    const { stamp: _stamp, ...piece } = p;
    const row = [...rows].reverse().find(r => r.version === pitch.version && r.pieceId === p.id);
    return { ...piece, ...(row ? { stamp: cleanStamp(row) } : {}) };
  }) };
}
export function appendVerdict(project: string, pitch: Pitch, pieceId: string, stamp: PitchStamp) {
  let rows = read(project);
  if (rows.some(r => r.requestId === stamp.requestId)) throw Error('Verdict already saved');
  if (!pitch.pieces.some(p => p.id === pieceId)) throw Error('Unknown pitch piece');
  rows.push({ version: pitch.version, pieceId, ...stamp });
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
