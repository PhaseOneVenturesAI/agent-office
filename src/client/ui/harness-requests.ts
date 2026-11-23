import type { HarnessClientMsg, HarnessServerMsg } from '../../shared/protocol';
import type { HarnessChange, HarnessSource } from '../../shared/protocol/harness-history';
import type { Net } from '../net';

type Request = Extract<HarnessClientMsg, { request?: string }>;
type Reply = Extract<HarnessServerMsg, { t: 'harness.file' | 'harness.result' }>;
/** Correlated acknowledgments: a refresh never silently advances an unsaved draft's base. */
export function harnessRequests(net: Net) {
  const pending = new Map<string, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const off = net.onMessage((msg) => {
    if ((msg.t !== 'harness.file' && msg.t !== 'harness.result') || !msg.request) return;
    const waiting = pending.get(msg.request); if (!waiting) return;
    clearTimeout(waiting.timer); pending.delete(msg.request);
    if (msg.error) waiting.reject(new Error(msg.error)); else waiting.resolve(msg);
  });
  const send = (ask: Request): Promise<Reply> => new Promise((resolve, reject) => {
    if (!net.up) return reject(new Error('Office is disconnected. Your draft is kept; reconnect and reload the source.'));
    const request = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(request);
      reject(new Error('No acknowledgment received. The source may have changed; reload before retrying.'));
    }, 15_000);
    pending.set(request, { resolve, reject, timer });
    net.send({ ...ask, request });
  });
  return {
    async read(path: string): Promise<HarnessSource> {
      const r = await send({ t: 'harness.read', path });
      if (r.t !== 'harness.file' || r.path !== path || !r.revision || !r.status || r.text === undefined) throw new Error('Incomplete source response.');
      return { path, text: r.text, revision: r.revision, status: r.status };
    },
    async history(path: string, before?: string) {
      const r = await send({ t: 'harness.history', path, before, request: '' });
      if (r.t !== 'harness.result' || r.path !== path || !r.history) throw new Error('Incomplete history response.');
      return r.history;
    },
    async snapshot(path: string, revision: string) {
      const r = await send({ t: 'harness.snapshot', path, revision, request: '' });
      if (r.t !== 'harness.result' || r.path !== path || !r.snapshot) throw new Error('Incomplete revision response.');
      return r.snapshot;
    },
    async change(ask: HarnessChange) {
      const r = await send(ask.action === 'edit' ? { t: 'harness.write', path: ask.path, base: ask.base, text: ask.text, request: '' }
        : { t: 'harness.restore', path: ask.path, base: ask.base, revision: ask.revision, request: '' });
      if (r.t !== 'harness.result' || r.path !== ask.path || !r.file || r.file.path !== ask.path) throw new Error('Incomplete save acknowledgment. Reload before retrying.');
      return { file: r.file, warning: r.warning };
    },
    dispose() {
      off();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Harness window closed. Draft kept.')); }
      pending.clear();
    },
  };
}
