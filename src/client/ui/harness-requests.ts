import type { HarnessClientMsg, HarnessServerMsg, PersonalHarnessClientMsg, PersonalHarnessServerMsg } from '../../shared/protocol';
import type { HarnessChange, HarnessSource } from '../../shared/protocol/harness-history';
import type { Net } from '../net';

/** The shared harness (`harness.*`) or your own (`harness.own.*`): the same requests either way. */
export type HarnessScope = 'harness' | 'harness.own';
type Request = Extract<HarnessClientMsg, { request?: string }> | Extract<PersonalHarnessClientMsg, { t: 'harness.own.create' }>;
type Reply = Extract<HarnessServerMsg | PersonalHarnessServerMsg, { t: `${HarnessScope}.file` | `${HarnessScope}.result` }>;
type FileReply = Extract<Reply, { t: `${HarnessScope}.file` }>;
type ResultReply = Extract<Reply, { t: `${HarnessScope}.result` }>;
const isFile = (r: Reply): r is FileReply => r.t.endsWith('.file');

/** Correlated acknowledgments: a refresh never silently advances an unsaved draft's base. */
export function harnessRequests(net: Net, scope: HarnessScope = 'harness') {
  const pending = new Map<string, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const off = net.onMessage((msg) => {
    if ((msg.t !== `${scope}.file` && msg.t !== `${scope}.result`) || !('request' in msg) || !msg.request) return;
    const reply = msg as Reply;
    const waiting = pending.get(msg.request); if (!waiting) return;
    clearTimeout(waiting.timer); pending.delete(msg.request);
    if (reply.error) waiting.reject(new Error(reply.error)); else waiting.resolve(reply);
  });
  /** Sent as the shared harness's message, renamed into this scope (`harness.read` → `harness.own.read`). */
  const send = (ask: Request): Promise<Reply> => new Promise((resolve, reject) => {
    if (!net.up) return reject(new Error('Office is disconnected. Your draft is kept; reconnect and reload the source.'));
    const request = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(request);
      reject(new Error('No acknowledgment received. The source may have changed; reload before retrying.'));
    }, 15_000);
    pending.set(request, { resolve, reject, timer });
    net.send({ ...ask, t: ask.t.startsWith('harness.own.') ? ask.t : ask.t.replace(/^harness\./, `${scope}.`), request } as Request | PersonalHarnessClientMsg);
  });
  const result = async (ask: Request): Promise<ResultReply> => {
    const r = await send(ask);
    if (isFile(r)) throw new Error('Incomplete response.');
    return r;
  };
  return {
    async read(path: string): Promise<HarnessSource> {
      const r = await send({ t: 'harness.read', path });
      if (!isFile(r) || r.path !== path || !r.revision || !r.status || r.text === undefined) throw new Error('Incomplete source response.');
      return { path, text: r.text, revision: r.revision, status: r.status };
    },
    async history(path: string, before?: string) {
      const r = await result({ t: 'harness.history', path, before, request: '' });
      if (r.path !== path || !r.history) throw new Error('Incomplete history response.');
      return r.history;
    },
    async snapshot(path: string, revision: string) {
      const r = await result({ t: 'harness.snapshot', path, revision, request: '' });
      if (r.path !== path || !r.snapshot) throw new Error('Incomplete revision response.');
      return r.snapshot;
    },
    async change(ask: HarnessChange) {
      const r = await result(ask.action === 'edit' ? { t: 'harness.write', path: ask.path, base: ask.base, text: ask.text, request: '' }
        : { t: 'harness.restore', path: ask.path, base: ask.base, revision: ask.revision, request: '' });
      if (r.path !== ask.path || !r.file || r.file.path !== ask.path) throw new Error('Incomplete save acknowledgment. Reload before retrying.');
      return { file: r.file, warning: r.warning };
    },
    /** A new file (your own harness only). */
    async create(path: string, text: string): Promise<HarnessSource> {
      if (scope !== 'harness.own') throw new Error('New files are only made in your own harness.');
      const r = await result({ t: 'harness.own.create', path, text, request: '' });
      if (r.path !== path || !r.file || r.file.path !== path) throw new Error('Incomplete acknowledgment. Reload before retrying.');
      return r.file;
    },
    dispose() {
      off();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Harness window closed. Draft kept.')); }
      pending.clear();
    },
  };
}
