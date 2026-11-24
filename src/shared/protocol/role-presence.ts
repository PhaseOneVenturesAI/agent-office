/** Public character identity plus this recipient's permitted entry points. Never a runtime worker. */
export interface RolePresence {
  key: string;
  name: string;
  title: string;
  department?: string;
  deskId: string;
  workerId?: string;
  talk: boolean;
  start: boolean;
  ask: boolean;
  reason?: string;
}
export type RolePresenceClientMsg = { t: 'role.presence.get'; requestId: string };
export type RolePresenceServerMsg = { t: 'role.presence'; requestId: string; floor: string; roles: RolePresence[]; error?: string };
