import type { QueueClientMsg } from '../../../shared/protocol.js';
import { isAgentEffort, isAgentProvider } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';
export const linearTaskHandlers = {
  'queue.startOwn'(ctx, c, msg) {
    const floor = here(ctx, c), account = c.accountId;
    if (!floor || !account) return ctx.warn(c, 'Sign in to your own Office account first');
    const taskId = str(msg.taskId, 32), task = floor.queue.state().tasks.find((t) => t.id === taskId);
    if (!task?.linear || task.linear.accountId !== account) return ctx.warn(c, 'Only the assigned employee can start their own agent');
    const provider = msg.provider ?? floor.workers.officeDefault.provider;
    if (!isAgentProvider(provider) || !floor.project.agentProviders.includes(provider)) return ctx.warn(c, 'Choose an available agent provider');
    ctx.withSignIn(c, ctx.signInFor(provider), () => {
      ctx.warn(c, floor.queue.startOwn(taskId, account, c.peer.name, provider, msg.model === undefined ? undefined : str(msg.model, 240), isAgentEffort(msg.effort) ? msg.effort : undefined));
    });
  },
} satisfies HandlerMap<Extract<QueueClientMsg, { t: 'queue.startOwn' }>>;
