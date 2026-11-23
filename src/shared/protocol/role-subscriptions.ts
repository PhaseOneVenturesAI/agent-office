import type { AgentProvider } from './agents.js';
export interface RoleSubscriptionState {
  floor: string; department: string; project: string; departmentName: string; provider: AgentProvider;
  custodian?: string; controllers: string[]; active: boolean; canConsent: boolean; reason?: string;
  /** Server-computed exact consent scope; stale forms cannot approve a changed list. */
  configuration: string; audience: string[]; allowStaffQA: boolean; allowWorkers: boolean;
}
export type RoleSubscriptionClientMsg =
  | { t: 'role.subscription.get'; department: string }
  | { t: 'role.subscription.set'; department: string; configuration: string; allow: boolean; allowStaffQA?: boolean };
export type RoleSubscriptionServerMsg = { t: 'role.subscription.state'; state: RoleSubscriptionState; error?: string };
