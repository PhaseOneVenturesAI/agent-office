import './linear.css';
import type { LinearPublicState, WorkStatus } from '../../shared/protocol/linear';
import type { QueueTask } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { providerPicker } from './provider';
import { openWorkerConversation } from './worker-conversation';
const labels: Record<WorkStatus, string> = { backlog: 'Backlog', todo: 'To do', inProgress: 'In progress', inReview: 'In review', completed: 'Completed', canceled: 'Canceled' };
export function linearPanel(net: Net, terminal: (id: string) => void) {
  const floor = store.floor!, root = h('section.linear-board', { 'aria-label': 'Employee tasks' });
  const status = h('p.note', { role: 'status' }, 'Checking Linear connection…'), toolbar = h('div.linear-toolbar'), content = h('div'), editor = h('div');
  root.append(status, toolbar, editor, content);
  let state: LinearPublicState | undefined, closed = false, filter: 'mine' | 'all' = 'mine', loading = false;
  const api = async <T,>(body?: unknown): Promise<T> => {
    const response = await fetch(`/api/linear?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Linear request failed'); return result;
  };
  const action = async (body: unknown) => {
    if (loading) return; loading = true;
    try { state = await api<LinearPublicState>(body); if (!closed) { editor.replaceChildren(); render(); } }
    catch (error) { status.textContent = (error as Error).message; }
    finally { loading = false; }
  };
  const refresh = async () => {
    try { const result = await api<LinearPublicState>(); if (!closed) { state = result; render(); } }
    catch (error) { if (!closed) status.textContent = (error as Error).message; }
  };
  const button = (name: string, click: () => void, disabled = false) => h('button.btn', { type: 'button', onclick: click, disabled }, name);
  function setup() {
    if (!state) return;
    const team = h('select', { 'aria-label': 'Linear team' }) as HTMLSelectElement;
    team.append(h('option', { value: '' }, 'Choose a team…'), ...state.teams.map((t) => h('option', { value: t.id }, `${t.name} (${t.key})`)));
    team.value = state.mapping?.teamId ?? '';
    const department = h('select', { 'aria-label': 'Default department for imported tasks' }) as HTMLSelectElement;
    department.append(h('option', { value: '' }, 'Unscoped — owner manages assignments'), ...state.departments.map((d) => h('option', { value: d.id }, d.name)));
    department.value = state.mapping?.departmentId ?? '';
    const project = h('input', { 'aria-label': 'Optional Linear project UUID', placeholder: 'Optional project UUID', value: state.mapping?.projectId ?? '' }) as HTMLInputElement;
    const states = h('div.linear-grid'), picks = new Map<WorkStatus, HTMLSelectElement>();
    const paintStates = () => {
      picks.clear(); states.replaceChildren();
      for (const [key, label] of Object.entries(labels)) {
        const select = h('select', { 'aria-label': `${label} workflow state` }) as HTMLSelectElement;
        select.append(h('option', { value: '' }, 'Not mapped'), ...(state!.teams.find((t) => t.id === team.value)?.states ?? []).map((s) => h('option', { value: s.id }, s.name)));
        select.value = state!.mapping?.teamId === team.value ? state!.mapping.states[key as WorkStatus] ?? '' : '';
        picks.set(key as WorkStatus, select); states.append(h('label', {}, label, select));
      }
    };
    team.addEventListener('change', paintStates); paintStates();
    const people = h('div.linear-grid'), users = new Map<string, HTMLSelectElement>();
    for (const person of state.people) {
      const select = h('select', { 'aria-label': `Office account for ${person.email}` }) as HTMLSelectElement;
      select.append(h('option', { value: '' }, 'Not mapped'), ...state.accounts.map((a) => h('option', { value: a.id }, `${a.name} · ${a.id}`)));
      select.value = state.userMap[person.id] ?? ''; users.set(person.id, select);
      people.append(h('label', {}, `${person.name} · ${person.email}`, select));
    }
    editor.replaceChildren(h('div.linear-card', {}, h('h3', {}, 'Link this floor'), h('p.note', {}, 'Choose the team, workflow states and verified people. Nothing starts an agent automatically. People mappings apply across Office.'), team, project, department, states, h('h4', {}, 'Match people explicitly'), people,
      button('Save mapping', () => void action({ action: 'map', mapping: { floorId: floor, departmentId: department.value || undefined, teamId: team.value, projectId: project.value.trim() || undefined, states: Object.fromEntries([...picks].filter(([, s]) => s.value).map(([k, s]) => [k, s.value])) }, users: Object.fromEntries([...users].filter(([, s]) => s.value).map(([k, s]) => [k, s.value])) })), button('Cancel', () => editor.replaceChildren())));
  }
  function edit(task?: QueueTask) {
    if (!state) return;
    const department = h('select', { 'aria-label': 'Task department', disabled: !!task }) as HTMLSelectElement;
    if (state.canManage) department.append(h('option', { value: '' }, 'Unscoped task'));
    department.append(...state.departments.filter((d) => d.canCreate || d.id === task?.linear?.departmentId).map((d) => h('option', { value: d.id }, d.name)));
    department.value = task?.linear?.departmentId ?? department.options[0]?.value ?? '';
    const mayAssign = task ? !!state.taskPermissions[task.id]?.assign : state.canManage || state.departments.some((d) => d.canCreate);
    const title = h('input', { 'aria-label': 'Task title', value: task?.title ?? '', placeholder: 'What needs to get done?', maxlength: 240 }) as HTMLInputElement;
    const description = h('textarea', { 'aria-label': 'Task details', rows: 4, maxlength: 20000 }) as HTMLTextAreaElement; description.value = task?.prompt ?? '';
    const person = h('select', { 'aria-label': 'Assigned employee', disabled: !mayAssign }) as HTMLSelectElement;
    person.append(h('option', { value: '' }, 'Unassigned'), ...state.people.map((p) => h('option', { value: p.id }, p.name)));
    person.value = task?.linear?.assigneeId ?? '';
    const statusPick = h('select', { 'aria-label': 'Task status' }) as HTMLSelectElement;
    statusPick.append(...Object.entries(state.mapping?.states ?? {}).map(([key, id]) => h('option', { value: id }, labels[key as WorkStatus])));
    statusPick.value = task?.linear?.stateId ?? state.mapping?.states.todo ?? '';
    const save = () => void action({ action: 'edit', taskId: task?.id, revision: task?.linear?.updatedAt, departmentId: department.value || undefined, patch: { title: title.value.trim(), description: description.value, ...(mayAssign ? { assigneeId: person.value || null } : {}), ...(statusPick.value ? { stateId: statusPick.value } : {}) } });
    editor.replaceChildren(h('div.linear-card', {}, h('h3', {}, task ? 'Edit task' : 'New employee task'), title, description, department, h('div.linear-toolbar', {}, person, statusPick), button('Save task', save), button('Cancel', () => editor.replaceChildren())));
  }
  function start(task: QueueTask) {
    const picker = providerPicker(store.project, `linear-agent-${task.id}`);
    editor.replaceChildren(h('div.linear-card', {}, h('h3', {}, 'Who should help you?'), h('p', {}, task.title), h('p.note', {}, `Runs using ${store.me.account?.name ?? 'your account'}’s connected subscription. The human assignee stays the same. Finishing an agent turn does not complete the task.`), picker.element,
      button('Start my agent', () => { if (!picker.valid()) return; net.send({ t: 'queue.startOwn', taskId: task.id, provider: picker.value(), model: picker.model(), effort: picker.effort() }); editor.replaceChildren(); }), button('Cancel', () => editor.replaceChildren())));
  }
  function row(task: QueueTask) {
    const link = task.linear!, mine = !!store.me.account && link.accountId === store.me.account.id, canEdit = !!state?.taskPermissions[task.id]?.edit;
    const busy = task.status === 'running' || task.status === 'queued';
    const ended = ['completed', 'canceled'].includes(link.workStatus) ? 'Turn ended' : 'Turn ended — review the work before completing this task';
    const actions = h('div.linear-toolbar');
    if (link.url.startsWith('https://linear.app/')) actions.append(h('a.btn', { href: link.url, target: '_blank', rel: 'noopener' }, 'Open Linear ↗'));
    if (canEdit && !link.archived) actions.append(button('Edit task', () => edit(task)));
    if (mine && !busy && !link.archived && !['completed','canceled'].includes(link.workStatus)) actions.append(button('Do myself', () => void action({ action: 'manual', taskId: task.id }), !!link.conflict), button('Start my agent', () => start(task), !!link.conflict));
    if (task.workerId && task.owner === store.me.account?.id) actions.append(button('Agent conversation', () => openWorkerConversation(net, task.workerId!, () => terminal(task.workerId!))));
    if (link.conflict && canEdit) actions.append(button('Use Linear version', () => void action({ action: 'edit', taskId: task.id, revision: task.linear?.updatedAt, resolution: 'remote' })), button('Keep Office edits', () => void action({ action: 'edit', taskId: task.id, revision: task.linear?.updatedAt, resolution: 'local' })));
    return h('article.linear-card', {}, h('div.linear-meta', {}, `${link.identifier} · ${link.archived ? 'Archived / moved' : link.stateName}${link.pending ? ' · Sync pending' : ''}`), h('h3', {}, task.title),
      h('p', {}, `👤 ${link.assigneeName ?? 'Unassigned'}${link.assigneeId && !link.accountId ? ' · Office account not mapped' : ''}`),
      task.manual ? h('p.note', {}, '✋ Working manually') : null,
      busy || task.workerId ? h('p.note', {}, `🤖 ${task.workerName ?? 'Your agent'} · ${task.status === 'done' ? ended : task.status}${task.owner && task.owner !== link.accountId ? ' · Previous assignee’s run; ownership has not changed' : ''}`) : null,
      link.conflict ? h('p.linear-error', { role: 'alert' }, link.conflict) : null, actions);
  }
  function render() {
    if (!state || closed) return;
    status.textContent = state.error ?? (state.connected ? `Linear connected${state.lastSync ? ` · synced ${timeAgo(state.lastSync)}` : ' · awaiting first sync'}` : 'Linear is not connected to this Office. The chat plugin is a separate connection.');
    toolbar.replaceChildren(button('My tasks', () => { filter = 'mine'; render(); }), button('Department tasks', () => { filter = 'all'; render(); }), button('Refresh', () => void refresh()));
    if (state.canConfigure) toolbar.append(button('Linear settings', () => {
      editor.replaceChildren(h('div.linear-card', {}, h('h3', {}, 'Linear connection'),
        h('p.note', {}, 'An app connection syncs tasks. It does not use anyone’s agent subscription.'),
        button(state!.connected ? 'Reconnect Linear' : 'Connect Linear', () => { void api<{ url: string }>({ action: 'connect' }).then((result) => { window.location.href = result.url; }).catch((e) => { status.textContent = e.message; }); }),
        state!.connected ? button('Link floor & people', setup) : null,
        state!.mapping ? button('Retry sync', () => void action({ action: 'retry' })) : null,
        button('Close settings', () => editor.replaceChildren())));
    }));
    if ((state.canManage || state.departments.some((d) => d.canCreate)) && state.mapping) toolbar.append(button('New task', () => edit()));
    const tasks = store.queue.tasks.filter((t) => t.linear && (filter === 'all' || (!!store.me.account && t.linear.accountId === store.me.account.id)));
    content.replaceChildren(...tasks.map(row));
    if (!tasks.length) content.append(h('p.queue-empty', {}, state.mapping ? filter === 'mine' ? 'No tasks assigned to your mapped account yet.' : 'No linked tasks yet. Create one here or assign one in Linear.' : 'This floor needs a Linear team mapping. Ask the Office owner to link it.'));
    if (!state.configured) content.append(h('p.note', {}, 'Host setup is required: a private Linear OAuth app and signed webhook. Your personal agent sign-ins stay separate.'));
  }
  const unsubscribe = store.on('queue', render);
  void refresh();
  return { element: root, close() { closed = true; unsubscribe(); } };
}
