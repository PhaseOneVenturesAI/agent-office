/** Owner-account Studio commands. Paths and executable arguments never cross this boundary. */
export const STUDIO_ORG = 'PhaseOneVenturesAI';
export const validRepo = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(v) && v.split('/').every(s => !/^\.+$/.test(s) && !s.startsWith('-'));
export const validFolder = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) && !/^\.+$/.test(v) && !v.startsWith('-');
export const projectName = (v: unknown): string | undefined => typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= 60 && !/[\x00-\x1f\x7f]/.test(v) ? v : undefined;
export function projectFolder(name: unknown): string | undefined {
  const n = projectName(name), folder = n?.replace(/[^A-Za-z0-9._-]+/g, '-');
  return validFolder(folder) ? folder : undefined;
}
const idOK = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export type ProjectCommand = { t: 'project.new'; id: string; name: string } | { t: 'project.open'; id: string; project: string; confirm: string } | { t: 'project.add'; id: string; repo?: string; folder?: string };
/** `greeting` is a newly started lead's first reply, posted to its office conversation. */
export interface ProjectResult { t: 'project.result'; id: string; ok: boolean; detail: string; project?: string; repo?: string; greeting?: string }
export function cleanProjectCommand(raw: any): ProjectCommand | undefined {
  if (!raw || !idOK(raw.id)) return;
  const id = raw.id;
  if (raw.t === 'project.new' && projectFolder(raw.name)) return { t: raw.t, id, name: raw.name };
  if (raw.t === 'project.open' && projectName(raw.project) && raw.confirm === raw.project) return { t: raw.t, id, project: raw.project, confirm: raw.confirm };
  if (raw.t === 'project.add' && (raw.repo !== undefined || raw.folder !== undefined) && (raw.repo === undefined || validRepo(raw.repo)) && (raw.folder === undefined || validFolder(raw.folder))) return { t: raw.t, id, ...(raw.repo ? { repo: raw.repo } : {}), ...(raw.folder ? { folder: raw.folder } : {}) };
}
export function cleanProjectResult(raw: any): ProjectResult | undefined {
  if (!raw || raw.t !== 'project.result' || !idOK(raw.id) || typeof raw.ok !== 'boolean' || typeof raw.detail !== 'string') return;
  return { t: raw.t, id: raw.id, ok: raw.ok, detail: raw.detail.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300), ...(projectName(raw.project) ? { project: raw.project } : {}), ...(validRepo(raw.repo) ? { repo: raw.repo } : {}), ...(typeof raw.greeting === 'string' && raw.greeting.trim() ? { greeting: raw.greeting.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, 4000) } : {}) };
}
export type StudioClientMsg = { t: 'studio.new'; id: string; name: string } | { t: 'studio.open'; id: string; project: string; confirm: string } | { t: 'studio.add'; id: string; repo?: string; folder?: string } | { t: 'studio.feedback'; project: string; cardId: string; text: string };
export type StudioServerMsg = ProjectResult & { floorId?: string };
