import type { WorkerStatus, WorkerAction, Usage } from '../shared/protocol.js';

export interface DshEvents {
  assistant?(text: string): void;
  /** ANSI text for the worker's terminal. */
  output(text: string): void;
  status(status: WorkerStatus): void;
  action(action: WorkerAction | undefined): void;
  usage(usage: Usage): void;
  /** The session id the agent handed back, for the worker's card and for resume. */
  session(sessionId: string): void;
  /** A prompt someone typed into the terminal, for the worker's task card. */
  prompted(text: string): void;
  /** The child process ended. `quiet` marks a close the office asked for. */
  exit(code: number | null, error: string | undefined, quiet: boolean): void;
}
