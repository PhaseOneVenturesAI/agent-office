export interface ConversationMessage { id: string; role: 'user' | 'assistant'; text: string; at: number; /** Who sent it, for durable role records. */ by?: string; /** 'staff' marks read-only Q&A, kept out of the controller-facing record. */ scope?: 'staff' }
export type ConversationClientMsg =
  | { t: 'conversation.open'; workerId: string }
  | { t: 'conversation.close'; workerId: string }
  | { t: 'conversation.send'; workerId: string; text: string }
  | { t: 'conversation.page'; workerId: string; before: number }
  | { t: 'conversation.interrupt'; workerId: string };
export type ConversationServerMsg =
  | { t: 'conversation.state'; workerId: string; supported: boolean; messages: ConversationMessage[] }
  | { t: 'conversation.message'; workerId: string; message: ConversationMessage }
  | { t: 'conversation.history'; workerId: string; messages: ConversationMessage[]; end: boolean };
