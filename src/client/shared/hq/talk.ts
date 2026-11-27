import type { HQLead } from '../../../shared/protocol/hq';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import './talk.css';
export function wireTalk(net: Net) {
  const refresh = () => net.send({ t: 'hq.leads.get' });
  store.on('floor', refresh); store.on('me', refresh); net.onStatus(up => { if (up) refresh(); });
  refresh();
}
export function leadStatus(lead: HQLead) {
  return { busy: 'working', idle: 'idle', off: 'offline', unknown: 'status unknown' }[lead.leadStatus?.status ?? 'unknown'];
}
export function openTalk(net: Net, id: string, extra?: { el: HTMLElement; close(): void }) {
  const account = store.me.account?.name;
  const log = h('div.talk-log', { 'aria-live': 'polite' }), held = h('section.talk-held'), note = h('p.talk-note');
  const text = h('textarea', { rows: 3, maxlength: 4000, 'aria-label': 'Message', placeholder: 'Write a message…' });
  const send = h('button.btn.primary', { type: 'submit' }, 'Send');
  const form = h('form.talk-form', {}, text, send), title = h('h2'), status = h('p.talk-status');
  const el = h('div.modal.lead-talk', { role: 'dialog', 'aria-label': 'Lead chat' }, h('header', {}, title), h('div.body', {}, status, log, held, note, form, extra?.el));
  const current = () => store.leadTalk?.leads.find(l => l.id === id) ?? store.hq?.leads?.find(l => l.id === id);
  const access = () => store.me.account?.name === account ? store.leadTalk : undefined;
  const paint = () => {
    const lead = current(), view = access();
    title.textContent = lead ? `${lead.project} · ${lead.title}` : 'Lead unavailable';
    status.textContent = lead ? `${lead.role} · ${leadStatus(lead)}` : '';
    const lines = view?.mine ? lead?.conversation ?? [] : [];
    log.hidden = !view?.mine;
    log.replaceChildren(...lines.map(l => h('article.talk-line', { class: l.role }, h('b', {}, l.role === 'assistant' ? lead!.title : l.from ?? 'You'),
      h('p', {}, l.text), h('small', {}, `${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${l.state === 'working' ? 'working…' : l.state === 'failed' ? `failed: ${l.error ?? 'Could not deliver'}` : l.state}`),
      l.state === 'failed' ? h('p', {}, 'Open in the Claude app') : null)));
    log.scrollTop = log.scrollHeight;
    const can = !!lead && !!view && (view.mine || view.manager);
    form.hidden = !can; text.disabled = send.disabled = !can || !!(view?.mine && lines.some(l => l.role === 'user' && !['failed', 'replied'].includes(l.state)));
    send.textContent = view?.manager ? 'Send to owner' : 'Send';
    note.textContent = view?.manager ? 'Held for the owner. Nothing reaches the lead until Pass on.' : view?.mine ? 'Talk to your lead through your Mac link.' : 'Only Jonathan can talk to his leads directly';
    held.replaceChildren(...(view ? lead?.messages ?? [] : []).map(m => h('article.talk-line', {}, h('b', {}, m.manager), h('small', {}, m.state === 'passed' ? 'passed on' : m.state), h('p', {}, m.text),
      view?.mine && m.state === 'waiting' ? h('div', {}, h('button.btn', { onclick: () => net.send({ t: 'hq.pass', id: m.id }) }, 'Pass on'), h('button.btn', { onclick: () => net.send({ t: 'hq.decline', id: m.id }) }, 'Decline')) : null)));
  };
  form.onsubmit = e => { e.preventDefault(); const view = access(); if (!text.value.trim() || !view || text.disabled) return;
    net.send({ t: view.mine ? 'hq.talk' : 'hq.message', lead: id, text: text.value.trim() }); text.value = ''; };
  text.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  const off = store.on('leadTalk', paint), offHQ = store.on('hq', paint), offMe = store.on('me', paint);
  paint(); const modal = openModal(el, { doing: '💬 talking to a lead', onClose: () => { off(); offHQ(); offMe(); extra?.close(); } });
  if (!text.disabled) text.focus(); return modal;
}
