import { MAC_BYTES, type MacSnapshot } from '../wire.js';
/** Fit the existing node frame budget without dropping project or worker identities. */
export function boundMacSnapshot(frame: MacSnapshot): MacSnapshot {
  const fits = () => Buffer.byteLength(JSON.stringify(frame)) <= MAC_BYTES;
  if (fits()) return frame;
  for (const row of frame.projects) if (row.pitch) row.pitch = { ...row.pitch,
    pieces: row.pitch.pieces.map(({ image: _image, ...p }) => ({ ...p, notes: [], images: [] })) };
  if (fits()) return frame;
  for (const row of frame.projects) {
    row.agents = row.agents.map(a => ({ id: a.id, tool: a.tool.slice(0, 20), role: a.role, status: a.status,
      task: a.task.slice(0, 40), branch: a.branch.slice(0, 40), lead: a.lead, startedAt: a.startedAt,
      ...(a.harnessRole ? { harnessRole: a.harnessRole.slice(0, 20) } : {}) }));
    if (row.project.needs) row.project.needs.items = row.project.needs.items.map(s => s.slice(0, 80));
  }
  if (fits()) return frame;
  for (const row of frame.projects) {
    delete row.pitch;
    if (row.project.needs) row.project.needs.items = [];
    row.project.departmentLeads = row.project.departmentLeads.map(d => ({ ...d, department: d.department.slice(0, 20), title: d.title.slice(0, 30) }));
  }
  for (const width of [20, 10, 4]) {
    if (fits()) break;
    for (const row of frame.projects) {
      for (const a of row.agents) { a.task = a.task.slice(0, width); a.branch = a.branch.slice(0, width); a.tool = a.tool.slice(0, width); if (a.harnessRole) a.harnessRole = a.harnessRole.slice(0, width); }
      for (const d of row.project.departmentLeads) { d.department = d.department.slice(0, width); d.title = d.title.slice(0, width); }
    }
  }
  if (!fits()) throw Error('HQ observation exceeds transport budget');
  return frame;
}
