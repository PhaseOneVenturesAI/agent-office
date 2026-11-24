import { createHmac, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import type { LinearMapping, LinearPerson, LinearPublicState, LinearTeam } from '../../shared/protocol/linear.js';
import { LinearClient, type LinearConfig } from './client.js';
import { LinearStore, type IssueFields } from './store.js';
import { LinearSync, type LinearFloor } from './sync.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface LinearControlScope { floorId: string; departmentId?: string; taskId?: string; action: 'create' | 'edit' | 'assign' | 'sync' }
export class LinearService {
  readonly store: LinearStore;
  readonly client?: LinearClient;
  readonly sync?: LinearSync;
  /** Department ACL adapter: integration supplies the maintained controller policy, never admin inference. */
  constructor(dir: string, readonly config: LinearConfig | undefined, private floors: () => Iterable<LinearFloor>, private accounts: () => { id: string; name: string }[], private controller?: (account: string, scope: LinearControlScope) => boolean, request: typeof fetch = fetch) {
    this.store = new LinearStore(dir);
    if (config && this.store.data.organization && this.store.data.organization.id !== config.organizationId) { this.store.data.token = undefined; this.store.data.error = 'Configured workspace changed; host must review existing mappings before reconnecting'; this.store.save(); }
    if (config) { this.client = new LinearClient(config, this.store, request); this.sync = new LinearSync(this.store, this.client, floors); this.sync.start(); }
  }
  close() { this.sync?.close(); }
  owner(account?: string) { return !!account && account === this.config?.ownerAccountId; }
  canManage(account: string | undefined, floor: string, departmentId?: string, action: LinearControlScope['action'] = 'create', taskId?: string) { return !!account && (this.controller ? this.controller(account, { floorId: floor, departmentId, action, taskId }) : this.owner(account)); }
  state(account: string | undefined, floor: string): LinearPublicState {
    const data = this.store.data, manage = this.canManage(account, floor);
    const target = [...this.floors()].find((f) => f.id === floor);
    const departments = (target?.departments?.state().departments ?? []).map(({ id, name }) => ({ id, name, canCreate: this.canManage(account, floor, id, 'create') }));
    const taskPermissions = Object.fromEntries((target?.queue.state().tasks ?? []).filter((t) => t.linear).map((t) => [t.id, { edit: (!!account && t.linear?.accountId === account) || this.canManage(account, floor, t.linear?.departmentId, 'edit', t.id), assign: this.canManage(account, floor, t.linear?.departmentId, 'assign', t.id) }]));
    return { configured: !!this.config, connected: !!data.token && !!data.organization, canConfigure: this.owner(account), canManage: manage,
      departments, taskPermissions, organization: data.organization, lastSync: data.lastSync, error: data.error, mapping: data.mappings.find((m) => m.floorId === floor),
      people: data.people, teams: this.owner(account) ? data.teams : [], accounts: this.owner(account) ? this.accounts() : [], userMap: this.owner(account) ? data.userMap : {} };
  }
  async catalog() {
    if (!this.client) throw new Error('Host must configure the native Linear OAuth app first');
    if (this.store.data.organization && this.store.data.organization.id !== this.config!.organizationId) { this.store.data.token = undefined; this.store.save(); throw new Error('Host must review and migrate existing workspace links before connecting a different workspace'); }
    const org = await this.client.graphql<{ organization: { id: string; name: string } }>('query{organization{id name}}');
    if (org.organization.id !== this.config!.organizationId) { this.store.data.token = undefined; this.store.save(); throw new Error('This Linear workspace is not the one configured for Office'); }
    const people: LinearPerson[] = [], teams: LinearTeam[] = [];
    let after: string | null = null;
    do {
      const result: { users: { nodes: LinearPerson[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await this.client.graphql('query($after:String){users(first:50,after:$after){nodes{id name email} pageInfo{hasNextPage endCursor}}}', { after });
      people.push(...result.users.nodes); after = result.users.pageInfo.hasNextPage ? result.users.pageInfo.endCursor : null;
    } while (after);
    do {
      const result: { teams: { nodes: { id: string; name: string; key: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await this.client.graphql('query($after:String){teams(first:50,after:$after){nodes{id name key} pageInfo{hasNextPage endCursor}}}', { after });
      for (const team of result.teams.nodes) {
        const states: LinearTeam['states'] = []; let cursor: string | null = null;
        do {
          const result: { workflowStates: { nodes: LinearTeam['states']; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await this.client.graphql('query($filter:WorkflowStateFilter!,$after:String){workflowStates(filter:$filter,first:50,after:$after){nodes{id name type} pageInfo{hasNextPage endCursor}}}', { filter: { team: { id: { eq: team.id } } }, after: cursor });
          states.push(...result.workflowStates.nodes); cursor = result.workflowStates.pageInfo.hasNextPage ? result.workflowStates.pageInfo.endCursor : null;
        } while (cursor);
        teams.push({ ...team, states });
      }
      after = result.teams.pageInfo.hasNextPage ? result.teams.pageInfo.endCursor : null;
    } while (after);
    Object.assign(this.store.data, { organization: org.organization, people, teams, error: undefined }); this.store.save();
  }
  async map(account: string, mapping: LinearMapping, users: Record<string, string>) {
    if (!this.owner(account)) throw new Error('Only the configured Office owner can map Linear');
    await this.sync?.run();
    const team = this.store.data.teams.find((t) => t.id === mapping.teamId);
    if (!team || ![...this.floors()].some((f) => f.id === mapping.floorId)) throw new Error('Choose a connected team and existing floor');
    if (mapping.departmentId && ![...this.floors()].find((f) => f.id === mapping.floorId)?.departments?.state().departments.some((d) => d.id === mapping.departmentId)) throw new Error('Choose an existing department');
    if (mapping.projectId && !UUID.test(mapping.projectId)) throw new Error('Use the Linear project UUID');
    if (mapping.projectId) {
      const result = await this.client!.graphql<{ project: { teams: { nodes: { id: string }[] } } | null }>('query($id:String!){project(id:$id){teams{nodes{id}}}}', { id: mapping.projectId });
      if (!result.project?.teams.nodes.some((t) => t.id === team.id)) throw new Error('Project is not in this Linear team');
    }
    const statuses = new Set(['backlog','todo','inProgress','inReview','completed','canceled']);
    if (!mapping.states || Object.entries(mapping.states).some(([key, id]) => !statuses.has(key) || !team.states.some((s) => s.id === id))) throw new Error('Choose workflow states from this team');
    for (const [linearId, accountId] of Object.entries(users)) if (!this.store.data.people.some((p) => p.id === linearId) || !this.accounts().some((a) => a.id === accountId)) throw new Error('Mappings must identify existing Office and Linear people');
    if (new Set(Object.values(users)).size !== Object.values(users).length) throw new Error('Map each Office account to one Linear person');
    if (this.store.data.mappings.some((m) => m.floorId !== mapping.floorId && m.teamId === mapping.teamId && (!m.projectId || !mapping.projectId || m.projectId === mapping.projectId))) throw new Error('This team/project is already linked to another floor');
    const old = this.store.data.mappings.find((m) => m.floorId === mapping.floorId);
    if (old && (old.teamId !== mapping.teamId || old.projectId !== mapping.projectId)) throw new Error('Changing an existing floor link requires host review of linked tasks');
    this.store.data.mappings = [...this.store.data.mappings.filter((m) => m.floorId !== mapping.floorId), mapping];
    this.store.data.userMap = users; this.store.data.lastSync = undefined; this.store.save(); void this.sync?.run();
  }
  async edit(account: string, floorId: string, taskId: string | undefined, patch: Partial<IssueFields>, resolution?: 'remote' | 'local', departmentId?: string, revision?: string) {
    const floor = [...this.floors()].find((f) => f.id === floorId);
    if (!floor) throw new Error('No such floor');
    let task = floor.queue.state().tasks.find((t) => t.id === taskId);
    const dept = task?.linear?.departmentId ?? departmentId;
    if (dept && !floor.departments?.state().departments.some((d) => d.id === dept)) throw new Error('Choose an existing department');
    const manage = this.canManage(account, floorId, dept, taskId ? 'edit' : 'create', taskId);
    if (taskId && (!task?.linear || (!manage && task.linear.accountId !== account))) throw new Error('Only the assignee or department controller can change this task');
    if (!taskId && !manage) throw new Error('Only a department controller can assign new project tasks');
    if ('assigneeId' in patch && !this.canManage(account, floorId, dept, 'assign', taskId)) throw new Error('Only a department controller can reassign tasks');
    const map = this.store.data.mappings.find((m) => m.floorId === floorId);
    if (!map || !this.store.data.token) throw new Error('Connect this floor to Linear first');
    if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 240)) throw new Error('Use a task title of 1–240 characters');
    if (patch.description !== undefined && (typeof patch.description !== 'string' || patch.description.length > 20000)) throw new Error('Task description is too long');
    if (patch.assigneeId !== undefined && patch.assigneeId !== null && !this.store.data.people.some((p) => p.id === patch.assigneeId)) throw new Error('Choose a connected Linear employee');
    if (patch.stateId !== undefined && !this.store.data.teams.find((t) => t.id === map.teamId)?.states.some((s) => s.id === patch.stateId)) throw new Error('Choose a state from this team');
    if (Object.keys(patch).some((k) => !['title','description','assigneeId','stateId'].includes(k))) throw new Error('Unsupported task field');
    await this.sync?.run();
    task = floor.queue.state().tasks.find((t) => t.id === taskId);
    const currentDept = task?.linear?.departmentId ?? departmentId;
    const currentManage = this.canManage(account, floorId, currentDept, taskId ? 'edit' : 'create', taskId);
    if (taskId && (!task?.linear || (!currentManage && task.linear.accountId !== account))) throw new Error('Task assignment or control permission changed; refresh the board');
    if (!taskId && !currentManage) throw new Error('Task creation permission changed; refresh the board');
    if ('assigneeId' in patch && !this.canManage(account, floorId, currentDept, 'assign', taskId)) throw new Error('Task assignment permission changed; refresh the board');
    if (taskId && revision !== undefined && task?.linear?.updatedAt !== revision) throw new Error('This task changed while you were editing. Refresh and review the new version');
    if (task?.linear?.archived) throw new Error('Reopen this task in Linear first');
    const issueId = task?.linear?.issueId ?? randomUUID(), id = task?.id ?? randomBytes(6).toString('hex');
    const pending = this.store.data.outbox.find((o) => o.issueId === issueId);
    if (pending?.conflict && !resolution) throw new Error('Resolve the conflicting changes first');
    if (resolution === 'remote') { this.store.save({ ...this.store.data, outbox: this.store.data.outbox.filter((o) => o !== pending), lastSync: undefined }); void this.sync?.run(); return; }
    if (!task && !patch.title) throw new Error('Give the task a title');
    const base = this.store.data.bases[issueId] ?? { title: '', description: '', assigneeId: null, stateId: map.states.todo ?? '' };
    const next = { ...(pending?.patch ?? {}), ...patch };
    this.store.save({ ...this.store.data,
      outbox: [...this.store.data.outbox.filter((o) => o !== pending), { floorId, taskId: id, issueId, create: !task || pending?.create, base, patch: next }],
      links: { ...this.store.data.links, [issueId]: { floorId, taskId: id, departmentId: currentDept } },
    });
    if (task?.linear) floor.queue.upsertLinear(task.id, next.title ?? task.title, next.description ?? task.prompt, { ...task.linear, pending: true, conflict: undefined });
    if (!task) floor.queue.upsertLinear(id, next.title!, next.description ?? '', { departmentId: currentDept, organizationId: this.store.data.organization!.id, issueId, teamId: map.teamId, identifier: 'Pending sync', url: '', stateId: next.stateId ?? base.stateId, stateName: 'Pending sync', workStatus: 'todo', updatedAt: '', pending: true });
    void this.sync?.run();
  }
  webhook(raw: Buffer, signature: string, delivery: string) {
    if (!this.config || !/^[0-9a-f]{64}$/i.test(signature) || !UUID.test(delivery)) throw new Error('Invalid Linear webhook');
    const expected = createHmac('sha256', this.config.webhookSecret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('Invalid Linear webhook');
    const event = JSON.parse(raw.toString('utf8')) as { webhookTimestamp: number; organizationId: string; type: string; action: string; data: { id?: string } };
    if (!Number.isFinite(event.webhookTimestamp) || Math.abs(Date.now() - event.webhookTimestamp) > 60_000 || event.organizationId !== this.config.organizationId) throw new Error('Expired or foreign Linear webhook');
    if (this.store.data.deliveries.includes(delivery)) return;
    if (event.type === 'OAuthApp' && event.action === 'revoked') { this.store.data.token = undefined; this.store.data.error = 'Linear installation revoked; reconnect required'; }
    if (event.type === 'Issue' && event.data?.id && UUID.test(event.data.id)) this.store.data.inbox[delivery] = { issueId: event.data.id, removed: event.action === 'remove' };
    this.store.data.deliveries = [...this.store.data.deliveries.slice(-9999), delivery]; this.store.save();
    void this.sync?.run();
  }
}
