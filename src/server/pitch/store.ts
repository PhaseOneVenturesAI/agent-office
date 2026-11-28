import { cleanPitch, pitchImages } from '../../shared/pitch/clean.js';
import { PITCH_LIMITS, type Pitch, type PitchView } from '../../shared/protocol/pitch.js';
import { DraftImages } from '../cubbies/design-images.js';
/** Keyed by the publishing cubby, never by a shared floor. Access is checked by Cubbies. */
export class PitchStore {
  private rows = new Map<string, { owner: string; pitch: Pitch; images: DraftImages; notice?: PitchView['notice'] }>();
  publish(id: string, owner: string, raw: unknown) {
    const pitch = cleanPitch(raw);
    if (!pitch) { this.rows.delete(id); return; }
    delete pitch.picked;
    const images = this.rows.get(id)?.images ?? new DraftImages();
    images.references(pitchImages(pitch), PITCH_LIMITS.images);
    this.rows.set(id, { owner, pitch, images, notice: this.rows.get(id)?.pitch.version === pitch.version ? this.rows.get(id)?.notice : undefined });
  }
  notice(id: string, requestId: string, text: string) {
    const row = this.rows.get(id);
    if (row) row.notice = { requestId, text: text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 1000) };
  }
  drop(id: string) { this.rows.delete(id); }
  retain(keep: (id: string) => boolean) {
    for (const id of this.rows.keys()) if (!keep(id)) this.drop(id);
  }
  accept(id: string, frame: Record<string, unknown>) {
    const row = this.rows.get(id); if (!row) return false;
    const others = [...this.rows.values()].reduce((n, other) => n + (other !== row && other.owner === row.owner ? other.images.bytes : 0), 0);
    return row.images.accept(frame, PITCH_LIMITS.ownerImageBytes - others);
  }
  image(id: string, hash: string) { return this.rows.get(id)?.images.get(hash); }
  view(cubbyId: string, floorId: string, computerId: string): PitchView | undefined {
    const row = this.rows.get(cubbyId); if (!row) return;
    return { cubbyId, floorId, computerId, ...(row.notice ? { notice: row.notice } : {}), pitch: { ...row.pitch, ...(row.pitch.directions ? { directions: row.pitch.directions.map(({ image, ...d }) => ({ ...d, ...(image && row.images.get(image.hash) ? { image } : {}) })) } : {}), pieces: row.pitch.pieces.map(p => {
      const { image, ...rest } = p;
      return { ...rest, ...(image && row.images.get(image.hash) ? { image } : {}), images: p.images.filter(i => row.images.get(i.hash)) };
    }) } };
  }
}
