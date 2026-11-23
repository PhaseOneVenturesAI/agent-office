export interface ConversationMessage { id: string; role: 'user' | 'assistant'; text: string; at: number }
export type ConversationClientMsg =
  | { t: 'conversation.open'; workerId: string }
  | { t: 'conversation.close'; workerId: string }
  | { t: 'conversation.send'; workerId: string; text: string }
  | { t: 'conversation.interrupt'; workerId: string };
export type ConversationServerMsg =
  | { t: 'conversation.state'; workerId: string; supported: boolean; messages: ConversationMessage[] }
  | { t: 'conversation.message'; workerId: string; message: ConversationMessage };
