// Kimi: no terminal and no hooks, like DeepSeek Harness. The office holds an ACP connection to it
// (`kimi acp`) and draws its updates into the worker's terminal itself (see ../kimi.ts). A worker's
// Kimi runs on the sign-in of whoever hired it: KIMI_CODE_HOME, or a pasted KIMI_API_KEY, is put
// into its environment by the manager (see ../signins.ts).
import type { ProviderAdapter } from './types.js';

export const kimi: ProviderAdapter = {
  id: 'kimi',
  // No argv for prompts or resume: those go over ACP. The office's --agent-args, when it's the
  // office's own `kimi`, come first as global options, then the acp subcommand.
  launch: ({ args }) => ({ args: [...args, 'acp'] }),
  transport: 'acp',
  signIn: 'kimi',
  usage: { persisted: true },
};
