export interface PersonalAutonomyWorker {
  id: string;
  name: string;
  floor: string;
  provider: string;
  requested?: 'off' | 'supervised' | 'autonomous';
  status: 'applied' | 'pending' | 'launch' | 'override' | 'unavailable';
  detail: string;
  roleOverride?: boolean;
  pendingApproval?: boolean;
}
export interface PersonalAutonomyState {
  configured: boolean;
  automatic: boolean;
  updatedAt?: number;
  workers: PersonalAutonomyWorker[];
}
export type PersonalAutonomyClientMsg =
  | { t: 'personal.autonomy.get'; requestId?: string }
  | { t: 'personal.autonomy.set'; requestId: string; automatic: boolean };
export type PersonalAutonomyServerMsg = { t: 'personal.autonomy.state'; requestId?: string; state?: PersonalAutonomyState; error?: string };
