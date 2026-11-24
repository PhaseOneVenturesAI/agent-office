import './failure.css';
import { h, openModal } from '../../ui/dom';
import type { VoiceDiagnosticSnapshot } from '../../voice-diagnostics';

/** One quiet notice, replaced by the latest failure. Details stay here until explicitly copied. */
export function voiceFailureNotice() {
  let card: HTMLElement | undefined;
  let generation = 0;
  return (who: string, pending: Promise<VoiceDiagnosticSnapshot>) => {
    const current = ++generation;
    card?.remove();
    let details: string | undefined;
    const feedback = h('span.voice-failure-feedback', { role: 'status' }, 'Preparing connection details…');
    const copy = h('button.btn', { type: 'button', disabled: true }, 'Copy details');
    const dismiss = h('button.btn.close', { type: 'button', 'aria-label': 'Dismiss voice connection notice', onclick: () => { generation++; card?.remove(); card = undefined; } }, '✕');
    card = h('section.toast.warn.voice-failure', { 'aria-label': 'Voice connection problem' },
      h('div.voice-failure-heading', {}, h('strong', { role: 'status' }, `🎙️ Voice couldn’t connect with ${who}.`), dismiss),
      h('p', {}, 'Leave voice and join again. If it still fails, ask everyone in the call to reload the office.'),
      h('div.voice-failure-actions', {}, copy, feedback),
    );
    document.getElementById('toasts')?.append(card);
    void pending.then(snapshot => {
      if (current !== generation) return;
      details = JSON.stringify(snapshot, null, 2);
      copy.disabled = false;
      feedback.textContent = 'Connection details only. Nothing is sent automatically.';
    }).catch(() => {
      if (current === generation) feedback.textContent = 'Connection details are unavailable. Try joining again.';
    });
    copy.addEventListener('click', () => {
      if (!details) return;
      const text = details;
      const manualCopy = () => {
        if (current !== generation) return;
        const field = h('textarea.voice-failure-details', { readonly: true, 'aria-label': 'Voice connection details', spellcheck: false }, text);
        const el = h('div.modal.voice-failure-dialog', { role: 'dialog', 'aria-label': 'Copy voice connection details' },
          h('header', {}, h('h2', {}, 'Voice connection details')),
          h('div.body', {}, h('p', {}, 'Clipboard access was unavailable. Copy the selected details and share them with the office owner.'), field),
        );
        openModal(el);
        field.focus(); field.select();
      };
      if (!navigator.clipboard?.writeText) return manualCopy();
      void navigator.clipboard.writeText(text).then(() => {
        if (current === generation) feedback.textContent = 'Copied. You can share these details with the office owner.';
      }).catch(manualCopy);
    });
  };
}
