import type { HQProject } from '../../../shared/protocol/hq';
import { needsLabel } from '../../../shared/protocol/hq';
import { fitText } from '../cubbies/props';

export function taskBoard(c: CanvasRenderingContext2D, w: number, p: HQProject) {
  c.fillStyle = '#292638'; c.font = 'bold 65px sans-serif'; c.fillText('Live tasks', 30, 80);
  c.font = '40px sans-serif';
  if (p.needs && p.needs.open !== 0) fitText(c, needsLabel(p.needs), 30, 140, w - 60);
  const workers = p.workers ?? [];
  if (!workers.length) c.fillText('No live workers', 30, 230);
  workers.slice(0, 5).forEach((a, i) => {
    const y = 210 + i * 110;
    c.font = 'bold 46px sans-serif'; fitText(c, a.title, 30, y, w - 60);
    c.font = '38px sans-serif'; fitText(c, a.doing && a.doing !== 'working' && a.doing !== 'idle' ? a.doing : a.provider ? `${a.provider} · ${a.branch || '—'}` : a.doing ?? '', 30, y + 45, w - 60);
  });
  if (workers.length > 5) { c.font = 'bold 40px sans-serif'; c.fillText(`+${workers.length - 5} more`, 30, 790); }
}
