/** Human task progress is independent of whether an agent's turn has ended. */
export type WorkStatus = 'backlog' | 'todo' | 'inProgress' | 'inReview' | 'completed' | 'canceled';
export interface LinearLink {
  departmentId?: string;
  organizationId: string; issueId: string; teamId: string; identifier: string; url: string;
  assigneeId?: string; assigneeName?: string; accountId?: string;
  stateId: string; stateName: string; workStatus: WorkStatus; updatedAt: string;
  archived?: boolean; conflict?: string; pending?: boolean;
}
export interface LinearPerson { id: string; name: string; email: string }
export interface LinearTeam { id: string; name: string; key: string; states: { id: string; name: string; type: string }[] }
export interface LinearMapping { floorId: string; departmentId?: string; teamId: string; projectId?: string; states: Partial<Record<WorkStatus, string>> }
export interface LinearPublicState {
  configured: boolean; connected: boolean; canConfigure: boolean; canManage: boolean;
  organization?: { id: string; name: string }; lastSync?: number; error?: string;
  mapping?: LinearMapping; people: LinearPerson[]; teams: LinearTeam[];
  departments: { id: string; name: string; canCreate: boolean }[];
  taskPermissions: Record<string, { edit: boolean; assign: boolean }>;
  accounts: { id: string; name: string }[]; userMap: Record<string, string>;
}
