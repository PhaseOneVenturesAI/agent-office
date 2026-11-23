import { randomBytes } from 'node:crypto';
import type { TaskQueue } from '../queue.js';
import type { LinearMapping, WorkStatus } from '../../shared/protocol/linear.js';
import { LinearClient, LinearApiError } from './client.js';
import { fields, ISSUE_FIELDS, type LinearIssue, type LinearStore, type Outbound } from './store.js';
export interface LinearFloor { id: string; queue: TaskQueue; departments?: { state(): { departments: { id: string; name: string }[] } } }
export const workStatus = (type: string): WorkStatus => ({ backlog: 'backlog', unstarted: 'todo', started: 'inProgress', completed: 'completed', canceled: 'canceled' }[type] as WorkStatus | undefined) ?? 'todo';
/** A single background writer. It imports human tasks and NEVER authorizes agent execution. */
export class LinearSync {
  private running?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private next = 0;
  private failures = 0;
  private blockedUntil = 0;
  constructor(private store: LinearStore, private client: LinearClient, private floors: () => Iterable<LinearFloor>) {}
  start() { this.timer = setInterval(() => { if (Date.now() >= this.next) void this.run(); }, 30_000); this.timer.unref(); }
  close() { this.stopped = true; clearInterval(this.timer); }
  run(): Promise<void> {
    if (this.stopped || !this.store.data.token || Date.now() < this.blockedUntil) return Promise.resolve();
    return this.running ??= this.cycle().finally(() => { this.running = undefined; });
  }
  private async issue(id: string) {
    const result = await this.client.graphql<{ issues: { nodes: LinearIssue[] } }>(`query($filter:IssueFilter!){issues(filter:$filter,first:1,includeArchived:true){nodes{${ISSUE_FIELDS}}}}`, { filter: { id: { eq: id } } });
    return result.issues.nodes[0] ?? null;
  }
  private mapping(issue: LinearIssue) {
    return this.store.data.mappings.find((m) => m.teamId === issue.team.id && (!m.projectId || m.projectId === issue.project?.id));
  }
  private apply(issue: LinearIssue) {
    const data = this.store.data, map = this.mapping(issue);
    const floor = [...this.floors()].find((f) => f.id === map?.floorId);
    const existing = [...this.floors()].flatMap((f) => f.queue.state().tasks.map((t) => ({ f, t }))).find(({ t }) => t.linear?.issueId === issue.id);
    if (!map || !floor || (existing && existing.f.id !== floor.id)) {
      if (existing?.t.linear) existing.f.queue.upsertLinear(existing.t.id, existing.t.title, existing.t.prompt, { ...existing.t.linear, archived: true, conflict: 'Issue moved outside this floor mapping; review its Linear link' });
      return;
    }
    const outbound = data.outbox.find((o) => o.issueId === issue.id);
    const id = existing?.t.id ?? data.links[issue.id]?.taskId ?? outbound?.taskId ?? randomBytes(6).toString('hex');
    data.links[issue.id] = { floorId: floor.id, taskId: id, departmentId: data.links[issue.id]?.departmentId ?? map.departmentId };
    this.store.save();
    const current = fields(issue);
    if (outbound && !outbound.conflict) {
      const conflicting = (Object.keys(outbound.patch) as (keyof typeof current)[]).filter((k) => current[k] !== outbound.base[k] && current[k] !== outbound.patch[k]);
      if (conflicting.length) outbound.conflict = `Both sides changed ${conflicting.join(', ')}. Choose a version in the task.`;
    }
    data.bases[issue.id] = current;
    const patch = outbound?.patch;
    floor.queue.upsertLinear(id, patch?.title ?? issue.title, patch?.description ?? issue.description ?? '', {
      departmentId: data.links[issue.id]?.departmentId,
      organizationId: data.organization!.id, issueId: issue.id, teamId: issue.team.id, identifier: issue.identifier, url: issue.url,
      assigneeId: issue.assignee?.id, assigneeName: issue.assignee?.name,
      accountId: issue.assignee ? data.userMap[issue.assignee.id] : undefined,
      stateId: issue.state.id, stateName: issue.state.name, updatedAt: issue.updatedAt,
      workStatus: (Object.entries(map.states).find(([, id]) => id === issue.state.id)?.[0] as WorkStatus) ?? workStatus(issue.state.type),
      archived: !!issue.archivedAt, pending: !!outbound, conflict: outbound?.conflict,
    });
  }
  private async outbound(item: Outbound) {
    if (item.conflict) return;
    const map = this.store.data.mappings.find((m) => m.floorId === item.floorId);
    if (!map) { item.conflict = 'Floor mapping no longer exists'; return; }
    // A supplied UUID survives ambiguous create responses; query it before every retry.
    let remote = await this.issue(item.issueId);
    if (!remote && !item.create) { item.conflict = 'Linear issue is no longer accessible'; return; }
    if (remote) {
      if (remote.team.id !== map.teamId || (map.projectId && remote.project?.id !== map.projectId)) { item.conflict = 'Issue moved outside its mapped project'; return; }
      const current = fields(remote);
      const conflicts = (Object.keys(item.patch) as (keyof typeof current)[]).filter((k) => current[k] !== item.base[k] && current[k] !== item.patch[k]);
      if (conflicts.length) { item.conflict = `Both sides changed ${conflicts.join(', ')}`; this.apply(remote); return; }
      if (Object.entries(item.patch).some(([k, value]) => current[k as keyof typeof current] !== value)) {
        const result = await this.client.graphql<{ issueUpdate: { success: boolean; issue: LinearIssue } }>(`mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{${ISSUE_FIELDS}}}}`, { id: item.issueId, input: item.patch });
        if (!result.issueUpdate.success) throw new Error('Linear did not confirm the task update');
        remote = result.issueUpdate.issue;
      }
    } else {
      const result = await this.client.graphql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(`mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{${ISSUE_FIELDS}}}}`, { input: { ...item.patch, id: item.issueId, teamId: map.teamId, ...(map.projectId ? { projectId: map.projectId } : {}) } });
      if (!result.issueCreate.success) throw new Error('Linear did not confirm task creation');
      remote = result.issueCreate.issue;
    }
    this.store.data.outbox = this.store.data.outbox.filter((o) => o !== item);
    this.apply(remote); this.store.save();
  }
  private async poll(map: LinearMapping) {
    let after: string | null = null;
    do {
      const filter = { team: { id: { eq: map.teamId } }, ...(map.projectId ? { project: { id: { eq: map.projectId } } } : {}), ...(this.store.data.lastSync ? { updatedAt: { gte: new Date(this.store.data.lastSync - 60_000).toISOString() } } : {}) };
      const result: { issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await this.client.graphql(`query($filter:IssueFilter!,$after:String){issues(filter:$filter,first:50,after:$after,includeArchived:true){nodes{${ISSUE_FIELDS}} pageInfo{hasNextPage endCursor}}}`, { filter, after });
      for (const issue of result.issues.nodes) this.apply(issue);
      after = result.issues.pageInfo.hasNextPage ? result.issues.pageInfo.endCursor : null;
    } while (after && !this.stopped);
  }
  private async cycle() {
    const began = Date.now();
    try {
      for (const item of [...this.store.data.outbox]) { if (this.stopped) return; await this.outbound(item); }
      for (const [delivery, event] of Object.entries(this.store.data.inbox)) {
        if (this.stopped) return;
        if (event.removed) {
          for (const floor of this.floors()) for (const t of floor.queue.state().tasks) if (t.linear?.issueId === event.issueId) floor.queue.upsertLinear(t.id, t.title, t.prompt, { ...t.linear, archived: true });
        } else { const issue = await this.issue(event.issueId); if (issue) this.apply(issue); }
        delete this.store.data.inbox[delivery]; this.store.save();
      }
      for (const map of this.store.data.mappings) { if (this.stopped) return; await this.poll(map); }
      this.store.data.lastSync = began; this.store.data.error = undefined; this.failures = 0; this.blockedUntil = 0; this.next = Date.now() + 180_000;
    } catch (error) {
      this.store.data.error = error instanceof Error ? error.message : 'Linear sync failed';
      this.failures++; this.next = Date.now() + Math.max(error instanceof LinearApiError ? error.retryAfter : 60_000, Math.min(1_800_000, 30_000 * 2 ** Math.min(this.failures, 6)));
      this.blockedUntil = this.next;
    }
    this.store.save();
  }
}
