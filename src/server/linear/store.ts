import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LinearMapping, LinearPerson, LinearTeam } from '../../shared/protocol/linear.js';
export interface IssueFields { title: string; description: string; assigneeId: string | null; stateId: string }
export interface LinearIssue {
  id: string; identifier: string; url: string; title: string; description?: string | null; updatedAt: string;
  archivedAt?: string | null; team: { id: string }; project?: { id: string } | null;
  assignee?: { id: string; name: string } | null; state: { id: string; name: string; type: string };
}
export interface Outbound { floorId: string; taskId: string; issueId: string; create?: boolean; patch: Partial<IssueFields>; base: IssueFields; conflict?: string }
export interface LinearData {
  token?: { access: string; refresh: string; expiresAt: number };
  organization?: { id: string; name: string }; people: LinearPerson[]; teams: LinearTeam[];
  mappings: LinearMapping[]; userMap: Record<string, string>;
  links: Record<string, { floorId: string; taskId: string; departmentId?: string }>;
  bases: Record<string, IssueFields>; outbox: Outbound[];
  inbox: Record<string, { issueId: string; removed?: boolean }>; deliveries: string[];
  lastSync?: number; error?: string;
}
export class LinearStore {
  data: LinearData;
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true }); this.file = path.join(dir, 'linear.json');
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { people: [], teams: [], mappings: [], userMap: {}, links: {}, bases: {}, outbox: [], inbox: {}, deliveries: [] };
    this.data.links ??= {};
  }
  save(next: LinearData = this.data) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, this.file); // Fail loudly: never acknowledge a task or token rotation we didn't persist.
    this.data = next; // Staged user actions become visible to sync only after persistence succeeds.
  }
}
export const fields = (i: LinearIssue): IssueFields => ({ title: i.title, description: i.description ?? '', assigneeId: i.assignee?.id ?? null, stateId: i.state.id });
export const ISSUE_FIELDS = 'id identifier url title description updatedAt archivedAt team { id } project { id } assignee { id name } state { id name type }';
