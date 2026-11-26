import path from 'node:path';
import { cleanPitch, pitchImages } from '../../../shared/pitch/clean.js';
import { PITCH_LIMITS } from '../../../shared/protocol/pitch.js';
import type { DesignImage } from '../../drafts/image-format.js';
import { readDesign, regularDirectory } from './design.js';
import { jsonFile } from './io.js';
import { mergeVerdicts, type VerdictTrust } from './pitch-feedback.js';
export function localPitch(project: string, trust?: VerdictTrust) {
  regularDirectory(path.join(project, '.agent-office'));
  const raw = jsonFile(path.join(project, '.agent-office/pitch.json'));
  const images = new Map<string, DesignImage>();
  const resolve = (source: unknown) => {
    if (images.size >= PITCH_LIMITS.images) return;
    try { const img = readDesign(project, source, 'pitch'); images.set(img.meta.hash, img); return img.meta; } catch { return; }
  };
  for (const p of Array.isArray(raw?.pieces) ? raw.pieces.slice(0, 4) : []) {
    if (!p || typeof p !== 'object') continue;
    delete p.stamp;
    p.image = p.kind === 'site' || p.kind === 'video' ? resolve(p.image) : undefined;
    const cap = p.kind === 'slides' ? 24 : p.kind === 'ads' ? 8 : 0;
    p.images = (Array.isArray(p.images) ? p.images.slice(0, cap) : []).map(resolve).filter(Boolean);
  }
  const clean = cleanPitch(raw), pitch = clean && mergeVerdicts(project, clean, trust);
  const referenced = new Set(pitchImages(pitch).map(i => i.hash));
  for (const hash of images.keys()) if (!referenced.has(hash)) images.delete(hash);
  return { pitch, images };
}
